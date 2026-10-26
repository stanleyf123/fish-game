'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');
const { checkMacValue } = require('../src/payments/ecpay');

async function payMock(srv, orderId, result = 'paid') {
  const page = await fetch(`${srv.base}/api/payments/mock/checkout/${orderId}`);
  const html = await page.text();
  const sig = /name="sig" value="([^"]+)"/.exec(html)[1];
  const r = await fetch(srv.base + '/api/payments/mock/complete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ orderId, result, sig }) });
  return r.json();
}

test('付費 / 會員（模擬金流）', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk(); const me = await sdk.ensureSession(); await sdk.writeSave(sampleSave());

  await t.test('商品列表與可用金流', async () => {
    const { products, providers } = await sdk.listProducts();
    assert.ok(products.find((p) => p.sku === 'gems_60'));
    assert.deepEqual(providers.map((p) => p.name), ['mock']);
  });

  let order;
  await t.test('建立訂單（pending）→ 模擬付款 → 已付款、寶石入帳', async () => {
    const d = await sdk.createOrder('gems_330', { provider: 'mock', redirect: false, idempotencyKey: 'k1' });
    order = d.order;
    assert.equal(order.status, 'pending');
    assert.equal(order.amount, 150);
    assert.equal(order.currency, 'TWD');
    assert.equal(d.checkout.type, 'mock');
    const again = await sdk.createOrder('gems_330', { provider: 'mock', redirect: false, idempotencyKey: 'k1' });
    assert.equal(again.order.id, order.id, '相同 idempotencyKey 不重複建單');
    const res = await payMock(srv, order.id);
    assert.equal(res.order.status, 'paid');
    assert.equal(await sdk.getPremiumBalance(), 330);
    assert.equal((await sdk.waitForOrder(order.id)).status, 'paid');
  });

  await t.test('Webhook 冪等：同一事件重送不會重複發貨；簽章錯誤 400', async () => {
    await payMock(srv, order.id); // 同一 eventId
    assert.equal(await sdk.getPremiumBalance(), 330);
    const raw = JSON.stringify({ eventId: 'evil', orderId: order.id, status: 'paid', amount: 150 });
    const bad = await fetch(srv.base + '/api/payments/webhook/mock', { method: 'POST', headers: { 'X-Mock-Signature': 'deadbeef' }, body: raw });
    assert.equal(bad.status, 400);
    // 不同 eventId 但訂單已付款 → 也不會重複發貨
    const mock = srv.ctx.providers.mock;
    const raw2 = Buffer.from(JSON.stringify({ eventId: 'another', orderId: order.id, status: 'paid', amount: 150 }));
    const ok2 = await fetch(srv.base + '/api/payments/webhook/mock', { method: 'POST', headers: { 'X-Mock-Signature': mock.sign(raw2) }, body: raw2 });
    assert.equal(ok2.status, 200);
    assert.equal(await sdk.getPremiumBalance(), 330);
  });

  await t.test('金額不符的付款通知 → 訂單失敗、不發貨', async () => {
    const d = await sdk.createOrder('gems_60', { provider: 'mock', redirect: false });
    const mock = srv.ctx.providers.mock;
    const raw = Buffer.from(JSON.stringify({ eventId: 'amt-' + d.order.id, orderId: d.order.id, status: 'paid', amount: 1 }));
    await fetch(srv.base + '/api/payments/webhook/mock', { method: 'POST', headers: { 'X-Mock-Signature': mock.sign(raw) }, body: raw });
    assert.equal((await sdk.getOrder(d.order.id)).status, 'failed');
    assert.equal(await sdk.getPremiumBalance(), 330);
  });

  await t.test('模擬付款失敗', async () => {
    const d = await sdk.createOrder('gems_60', { provider: 'mock', redirect: false });
    const res = await payMock(srv, d.order.id, 'failed');
    assert.equal(res.order.status, 'failed');
  });

  await t.test('月卡：權益生效、每日寶石一天一次、續購延長', async () => {
    const d = await sdk.createOrder('vip_month', { provider: 'mock', redirect: false });
    await payMock(srv, d.order.id);
    let ent = await sdk.getEntitlements();
    assert.equal(ent.vip.active, true);
    assert.equal(ent.vip.perks.coinBonus, 0.1);
    assert.equal(ent.gems, 430);
    const exp1 = ent.vip.expiresAt;
    assert.ok(Math.abs(exp1 - Date.now() - 30 * 86400e3) < 60e3);
    const daily = await sdk.claimVipDaily();
    assert.equal(daily.balance, 440);
    await assert.rejects(sdk.claimVipDaily(), (e) => e.status === 409);
    const d2 = await sdk.createOrder('vip_month', { provider: 'mock', redirect: false });
    await payMock(srv, d2.order.id);
    ent = await sdk.getEntitlements();
    assert.ok(Math.abs(ent.vip.expiresAt - exp1 - 30 * 86400e3) < 60e3, '續購從原到期日延長');
    const m = await admin.get('/memberships');
    assert.equal(m.data.memberships[0].playerId, me.id);
    assert.equal(m.data.memberships[0].cards, 2);
  });

  await t.test('寶石購買：伺服器扣款＋發貨到信箱；不足回 402', async () => {
    const r = await sdk.buyWithGems('deco_crystal');
    const before = r.balance;
    assert.equal(before, 440 + 100 - 200, '440 + 續購月卡 100 − 水晶 200');
    assert.equal(before, (await sdk.getPremiumBalance()));
    const mail = await sdk.getMailbox();
    const m = mail.find((x) => x.decorations.includes('crystal'));
    assert.ok(m);
    const got = await sdk.claimMail(m.id);
    assert.ok(got.save.up.deco.includes('crystal'));
    await assert.rejects(sdk.buyWithGems('deco_crystal'), (e) => e.status === 409, '限購一次');
    const poor = srv.sdk(); await poor.ensureSession();
    await assert.rejects(poor.buyWithGems('fish_koi'), (e) => e.status === 402);
    const ledger = (await sdk.getWallet()).ledger;
    assert.ok(ledger.some((l) => l.reason === 'spend' && l.delta === -200));
  });

  await t.test('新手禮包限購一次', async () => {
    const d = await sdk.createOrder('starter_pack', { provider: 'mock', redirect: false });
    await payMock(srv, d.order.id);
    await assert.rejects(sdk.createOrder('starter_pack', { provider: 'mock', redirect: false }), (e) => e.status === 409 && e.data.error === 'limit_reached');
    const ent = await sdk.getEntitlements();
    assert.ok(ent.flags.includes('starter'));
  });

  await t.test('客戶端無法自行增加寶石：寶石不在存檔內，帳本才算數', async () => {
    const cur = await sdk.loadSave();
    const w = await sdk.writeSave({ ...cur.save, gems: 999999 });
    assert.equal(w.ok, true);
    const bal = await sdk.getPremiumBalance();
    assert.ok(bal < 999999);
  });

  await t.test('後台退款：扣回寶石（可為負）、撤銷月卡、撤回未領信箱', async () => {
    const before = await sdk.getPremiumBalance();
    const list = await admin.get('/orders?status=paid&sku=vip_month');
    const vipOrders = list.data.orders.filter((o) => o.sku === 'vip_month');
    for (const o of vipOrders) { const r = await admin.post(`/orders/${o.id}/refund`, { reason: '測試退款' }); assert.equal(r.status, 200); }
    const ent = await sdk.getEntitlements();
    assert.equal(ent.vip.active, false);
    assert.equal(ent.gems, before - 200);
    const gemOrder = (await admin.get('/orders?status=paid&sku=gems_330')).data.orders[0];
    await admin.post(`/orders/${gemOrder.id}/refund`, { reason: '玩家已花掉寶石' });
    const ent2 = await sdk.getEntitlements();
    assert.equal(ent2.gems, before - 200 - 330);
    assert.ok(ent2.gems < 0, '寶石已花掉時餘額變負數，之後無法再花');
    await assert.rejects(sdk.buyWithGems('fish_koi'), (e) => e.status === 402);
    const again = await admin.post(`/orders/${gemOrder.id}/refund`, {});
    assert.equal(again.data.duplicate, true);
    const starter = (await admin.get('/orders?status=paid&sku=starter_pack')).data.orders[0];
    const rf = await admin.post(`/orders/${starter.id}/refund`, { reason: 'x' });
    assert.equal(rf.status, 200);
    assert.ok(!(await sdk.getMailbox()).some((m) => m.title.includes('新手禮包') && !m.claimed), '未領取的購買內容被撤回');
  });

  await t.test('後台手動發放、商品管理、營收統計', async () => {
    const g = await admin.post(`/players/${me.id}/grant-product`, { sku: 'gems_60', note: '客服補償' });
    assert.equal(g.status, 200);
    assert.equal(g.data.order.provider, 'admin');
    assert.equal(g.data.order.amount, 0);
    const created = await admin.post('/products', { sku: 'gems_test', type: 'gems', name: '測試寶石', priceTwd: 10, grants: { gems: 10 } });
    assert.equal(created.status, 200);
    assert.equal((await admin.post('/products', { sku: 'gems_test', type: 'gems', name: 'dup', priceTwd: 10, grants: { gems: 1 } })).status, 409);
    assert.equal((await admin.post('/products', { sku: 'bad', type: 'gems', name: 'x', priceGems: 10, grants: { gems: 1 } })).status, 400);
    const upd = await admin.put('/products/' + created.data.id, { sku: 'gems_test', type: 'gems', name: '測試寶石', priceTwd: 10, grants: { gems: 10 }, active: false });
    assert.equal(upd.status, 200);
    assert.ok(!(await sdk.listProducts()).products.some((p) => p.sku === 'gems_test'), '下架商品不出現在商城');
    let rev = (await admin.get('/revenue?days=30')).data;
    assert.equal(rev.totals.payingUsers, 0, '全部退款的玩家不算付費玩家');
    assert.equal(rev.totals.gross, 150 + 150 + 150 + 90);
    assert.equal(rev.totals.refunds, 150 + 150 + 150 + 90);
    assert.equal(rev.totals.net, 0);
    const payer = srv.sdk(); await payer.ensureSession();
    const o = await payer.createOrder('gems_60', { provider: 'mock', redirect: false });
    await payMock(srv, o.order.id);
    rev = (await admin.get('/revenue?days=30')).data;
    assert.equal(rev.totals.payingUsers, 1);
    assert.equal(rev.totals.net, 30);
    assert.equal(rev.totals.arppu, 30);
    assert.ok(rev.totals.conversion > 0);
    assert.equal(rev.daily[rev.daily.length - 1].net, 30);
    const audit = (await admin.get('/audit')).data.entries.map((e) => e.action);
    assert.ok(audit.includes('order.refund') && audit.includes('order.admin_grant') && audit.includes('product.create'));
  });
});

// Explicit opt-in is confined to this isolated legacy-webhook fixture. Production stays disabled.
test('綠界 / Stripe webhook 驗章骨架', async (t) => {
  const whsec = 'whsec_test_123';
  const srv = await startServer({ ECPAY_LEGACY_SHOP: '1', PUBLIC_BASE_URL: 'https://www.feedfishs.com', ECPAY_MERCHANT_ID: '2000132', ECPAY_HASH_KEY: '5294y06JbISpM5x9', ECPAY_HASH_IV: 'v77hoKGq4kWxNNIS', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: whsec });
  t.after(() => srv.stop());
  const sdk = srv.sdk(); const me = await sdk.ensureSession();

  await t.test('綠界：建立付款表單含 CheckMacValue；回呼驗章成功才發貨，回應 1|OK', async () => {
    const d = await sdk.createOrder('gems_60', { provider: 'ecpay', redirect: false });
    assert.equal(d.checkout.type, 'form_post');
    assert.match(d.checkout.action, /payment-stage\.ecpay\.com\.tw/);
    assert.ok(d.order.id.length <= 20 && /^[A-Za-z0-9]+$/.test(d.order.id), 'MerchantTradeNo 限 20 碼英數');
    const f = d.checkout.fields;
    assert.equal(f.CheckMacValue, checkMacValue(f, '5294y06JbISpM5x9', 'v77hoKGq4kWxNNIS'));
    const cb = { MerchantID: '2000132', MerchantTradeNo: d.order.id, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2410201234567890', TradeAmt: '30', PaymentDate: '2026/10/20 21:00:00', PaymentType: 'Credit_CreditCard', SimulatePaid: '0' };
    const bad = await fetch(srv.base + '/api/payments/webhook/ecpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...cb, CheckMacValue: 'WRONG' }) });
    assert.equal(bad.status, 400);
    cb.CheckMacValue = checkMacValue(cb, '5294y06JbISpM5x9', 'v77hoKGq4kWxNNIS');
    const ok = await fetch(srv.base + '/api/payments/webhook/ecpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cb) });
    assert.equal(await ok.text(), '1|OK');
    assert.equal((await sdk.getOrder(d.order.id)).status, 'paid');
    assert.equal(await sdk.getPremiumBalance(), 60);
  });

  await t.test('Stripe：Stripe-Signature 驗章（t + v1 HMAC），過期或錯誤拒絕', async () => {
    // 直接建立一張 stripe pending 單（避免呼叫真正的 Stripe API）
    const id = 'FGSTRIPETEST1';
    const now = Date.now();
    srv.ctx.db.prepare("INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at) VALUES (?,?,?,?,?,'TWD','pending','stripe',?,?,?)").run(id, me.id, 'gems_60', '一小袋寶石', 30, JSON.stringify({ gems: 60 }), now, now);
    const ev = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 3000, metadata: { order_id: id } } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', whsec).update(`${ts}.${ev}`).digest('hex');
    const bad = await fetch(srv.base + '/api/payments/webhook/stripe', { method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${'0'.repeat(64)}` }, body: ev });
    assert.equal(bad.status, 400);
    const old = await fetch(srv.base + '/api/payments/webhook/stripe', { method: 'POST', headers: { 'Stripe-Signature': `t=${ts - 3600},v1=${crypto.createHmac('sha256', whsec).update(`${ts - 3600}.${ev}`).digest('hex')}` }, body: ev });
    assert.equal(old.status, 400, '超過 5 分鐘的簽章拒絕（防重放）');
    const ok = await fetch(srv.base + '/api/payments/webhook/stripe', { method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` }, body: ev });
    assert.equal(ok.status, 200);
    assert.equal((await sdk.getOrder(id)).status, 'paid');
    assert.equal(await sdk.getPremiumBalance(), 120);
  });
});
