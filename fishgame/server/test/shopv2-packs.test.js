'use strict';
// SHOPV2-PACKS 新手禮包（每帳號限購一次）＋首次儲值禮（第一筆真實金流入帳送 🏮 節慶背景，只送一次）
// 全部用綠界「測試特店」金鑰在本機模擬回呼；不連任何真實金流
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sampleSave } = require('./helpers');
const { checkMacValue, ecpayConfig } = require('../src/payments/ecpay');
const EC = ecpayConfig({ ECPAY_MODE: 'stage' }), MID = EC.merchantId, KEY = EC.hashKey, IV = EC.hashIV; // 綠界官方公開測試特店
let n = 0;
async function member(srv, withSave = true) {
  const sdk = srv.sdk(); await sdk.ensureSession(); const me = await sdk.register(`pk${Date.now()}_${n++}@example.com`, 'fishyfish1');
  if (withSave) { const r = await sdk.writeSave(sampleSave()); assert.ok(r.ok, 'save'); }
  return { sdk, me };
}
async function notify(srv, orderId, amt, extra = {}) {
  const cb = { MerchantID: MID, MerchantTradeNo: orderId, RtnCode: '1', RtnMsg: '交易成功', TradeNo: 'T' + orderId.slice(-10), TradeAmt: String(amt), PaymentDate: '2026/10/23 19:00:00', PaymentType: 'Credit_CreditCard', SimulatePaid: '0', ...extra };
  cb.CheckMacValue = checkMacValue(cb, KEY, IV);
  const r = await fetch(srv.base + '/api/pay/ecpay/notify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cb) });
  return r.text();
}
const save = (srv, pid) => JSON.parse(srv.ctx.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid).data);
const gemsOf = (srv, pid) => srv.ctx.commerce.balance(pid);

test('新手禮包與首次儲值禮', async (t) => {
  const srv = await startServer({ PUBLIC_BASE_URL: 'https://www.feedfishs.com', ECPAY_MODE: 'stage', PAYMENT_MOCK_ENABLED: '0', PAY_ORDERS_PER_MIN: '100' });
  t.after(() => srv.stop());

  await t.test('商品列表：新手禮包、首次儲值禮資訊；既有方案價格與首儲雙倍不變', async () => {
    const { sdk } = await member(srv);
    const d = await sdk.payProducts();
    const st = d.products.find((p) => p.kind === 'starter');
    assert.deepEqual({ id: st.id, price: st.priceTwd, gems: st.gems, coins: st.coins, fish: st.fish, eligible: st.eligible }, { id: 'starter_30', price: 30, gems: 120, coins: 20000, fish: 'p_sapphireshrimp', eligible: true });
    assert.equal(st.fishName, '藍寶石蝦');
    assert.deepEqual(d.firstGift, { cosmetic: 'bg_festival', name: '節慶', icon: '🏮', eligible: true });
    const old = d.products.filter((p) => p.kind !== 'starter').map((p) => `${p.id}:${p.priceTwd}:${p.qty}:${p.firstDouble ? 'x2' : ''}`);
    assert.deepEqual(old, ['card_30:300:300:', 'gems_60:30:60:x2', 'gems_330:150:330:x2', 'gems_700:300:700:x2', 'gems_2400:990:2400:x2', 'gems_5000:1990:5000:x2', 'coins_20k:30:20000:', 'coins_110k:150:110000:', 'coins_240k:300:240000:']);
    const guest = srv.sdk(); await guest.ensureSession();
    await assert.rejects(guest.payCreate('starter_30', { provider: 'ecpay', redirect: false }), (e) => e.status === 403 && e.data.error === 'members_only');
  });

  await t.test('新手禮包：付款入帳 → 💎120＋🪙20,000＋藍寶石蝦×1＋首次儲值禮；重送通知不重複；第二次購買被擋', async () => {
    const { sdk, me } = await member(srv);
    const c0 = save(srv, me.id).coins, f0 = save(srv, me.id).fish.length;
    const o = await sdk.payCreate('starter_30', { provider: 'ecpay', redirect: false });
    assert.equal(o.order.amount, 30);
    // 待付款中再下單 → 擋
    await assert.rejects(sdk.payCreate('starter_30', { provider: 'ecpay', redirect: false }), (e) => e.status === 409 && e.data.error === 'starter_pending');
    assert.equal(await notify(srv, o.order.id, 30), '1|OK');
    let s = save(srv, me.id);
    assert.equal(gemsOf(srv, me.id), 120, '💎120（不適用首儲雙倍）');
    assert.equal(s.coins, c0 + 20000);
    assert.equal(s.fish.length, f0 + 1); assert.equal(s.fish.filter((f) => f.sp === 'p_sapphireshrimp').length, 1);
    assert.deepEqual(s.cos, { own: { bg_festival: 1 }, bg: 'bg_festival' }, '首次儲值禮：節慶背景（並套用）');
    const g = JSON.parse(srv.ctx.db.prepare('SELECT grants FROM orders WHERE id=?').get(o.order.id).grants);
    assert.equal(g.firstGift, 'bg_festival'); assert.ok(!g.starterDup);
    // 重送 3 次（綠界會重送）
    for (let i = 0; i < 3; i++) assert.equal(await notify(srv, o.order.id, 30), '1|OK');
    s = save(srv, me.id);
    assert.equal(gemsOf(srv, me.id), 120); assert.equal(s.coins, c0 + 20000); assert.equal(s.fish.length, f0 + 1);
    // 再買 → 擋；商品列表 eligible=false；首次儲值禮 eligible=false
    await assert.rejects(sdk.payCreate('starter_30', { provider: 'ecpay', redirect: false }), (e) => e.status === 409 && e.data.error === 'starter_used');
    const d = await sdk.payProducts();
    assert.equal(d.products.find((p) => p.kind === 'starter').eligible, false);
    assert.equal(d.firstGift.eligible, false);
    // 第二筆儲值（寶石）：首儲雙倍照舊、不再送背景
    const o2 = await sdk.payCreate('gems_60', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, o2.order.id, 30), '1|OK');
    assert.equal(gemsOf(srv, me.id), 120 + 120, 'gems_60 首儲雙倍 = 120');
    assert.ok(!JSON.parse(srv.ctx.db.prepare('SELECT grants FROM orders WHERE id=?').get(o2.order.id).grants).firstGift);
  });

  await t.test('首次儲值禮：第一筆是月卡也送；之後不再送；重送不重複', async () => {
    const { sdk, me } = await member(srv);
    const o = await sdk.payCreate('card_30', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, o.order.id, 300), '1|OK');
    assert.equal(await notify(srv, o.order.id, 300), '1|OK');
    assert.deepEqual(save(srv, me.id).cos.own, { bg_festival: 1 });
    assert.equal(gemsOf(srv, me.id), 300);
    const rev = srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(me.id).rev;
    const o2 = await sdk.payCreate('coins_20k', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, o2.order.id, 30), '1|OK');
    const g2 = JSON.parse(srv.ctx.db.prepare('SELECT grants FROM orders WHERE id=?').get(o2.order.id).grants);
    assert.ok(!g2.firstGift);
    assert.equal(srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(me.id).rev, rev + 1, '只有金幣寫入一次');
  });

  await t.test('首次儲值禮：寶石購買（provider=gems）、後台發放、失敗／未付款訂單都不算「第一筆」；已擁有背景不重複', async () => {
    const { sdk, me } = await member(srv);
    const db = srv.ctx.db, now = Date.now();
    db.prepare("INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at, paid_at, credited_at) VALUES (?,?,?,?,?,?,?,?,'{}',?,?,?,?)").run('TGEMx' + me.id, me.id, 'species:x', 'x', 30, 'GEM', 'paid', 'gems', now, now, now, now);
    db.prepare("INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at, paid_at, credited_at) VALUES (?,?,?,?,?,?,?,?,'{}',?,?,?,?)").run('TADMx' + me.id, me.id, 'admin', 'x', 0, 'TWD', 'paid', 'admin', now, now, now, now);
    const bad = await sdk.payCreate('gems_330', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, bad.order.id, 150, { RtnCode: '10100058', RtnMsg: '付款失敗' }), '1|OK');
    assert.equal((await sdk.payProducts()).firstGift.eligible, true);
    // 先用寶石買了節慶背景 → 之後首儲：不重複擁有，標記 alreadyOwned
    srv.ctx.commerce.ledger(me.id, 100, 'test', 'test');
    await sdk.cosmeticBuy('bg_festival');
    const o = await sdk.payCreate('gems_60', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, o.order.id, 30), '1|OK');
    const g = JSON.parse(db.prepare('SELECT grants FROM orders WHERE id=?').get(o.order.id).grants);
    assert.equal(g.firstGift, 'bg_festival'); assert.equal(g.firstGiftAlreadyOwned, true);
    assert.deepEqual(save(srv, me.id).cos.own, { bg_festival: 1 });
  });

  await t.test('沒有雲端存檔的會員：禮包內容與背景改寄信箱，領取後拿到', async () => {
    const { sdk, me } = await member(srv, false);
    const o = await sdk.payCreate('starter_30', { provider: 'ecpay', redirect: false });
    assert.equal(await notify(srv, o.order.id, 30), '1|OK');
    assert.equal(gemsOf(srv, me.id), 120);
    await sdk.writeSave(sampleSave());
    const mail = srv.ctx.rewards.mailbox(me.id);
    assert.equal(mail.length >= 1, true);
    const m = mail.find((x) => x.title === '🎁 新手禮包');
    const r = srv.ctx.rewards.claim(me.id, m.id);
    const s = save(srv, me.id);
    assert.equal(s.cos.own.bg_festival, 1); assert.equal(s.fish.filter((f) => f.sp === 'p_sapphireshrimp').length, 1); assert.ok(r.granted.coins === 20000);
  });

  await t.test('後台關閉：pay.starter.enabled=false 時下架；設定驗證接受開關', async () => {
    const cs = srv.ctx.configStore, cfg = JSON.parse(JSON.stringify(cs.active().config));
    cfg.pay = { ...(cfg.pay || {}), starter: { enabled: false }, firstTopupGift: { enabled: false } };
    cs.save(cfg, 'test off', 'test');
    const { sdk } = await member(srv);
    const d = await sdk.payProducts();
    assert.ok(!d.products.some((p) => p.kind === 'starter')); assert.equal(d.firstGift, null);
    await assert.rejects(sdk.payCreate('starter_30', { provider: 'ecpay', redirect: false }), (e) => e.status === 404);
  });
});
