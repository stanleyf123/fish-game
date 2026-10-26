'use strict';
// v4.0.5：💊 寶石特效藥（伺服器扣寶石、防作弊）＋ 💬 會員客服對話
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');
const { validateConfig } = require('../src/config-validate');
const { checkSave } = require('../src/anticheat');
const { medCheck, medPrice } = require('../src/medicine');
const CFG = require('../seed/default-config.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const H = 3600000;
let mailN = 0;
async function member(srv) { const sdk = srv.sdk(); await sdk.ensureSession(); const me = await sdk.register(`med${Date.now()}_${mailN++}@example.com`, 'fishyfish1'); return { sdk, me }; }
const authH = (sdk) => ({ Authorization: 'Bearer ' + sdk.token() });

test('預設設定有藥品且通過驗證；價格依魚缸容量', () => {
  assert.ok(CFG.medicine && CFG.medicine.items.med_fish);
  assert.deepEqual(validateConfig(CFG), []);
  const T = CFG.medicine.items.med_tank;
  assert.equal(medPrice(T, 20), 60); assert.equal(medPrice(T, 50), 60); assert.equal(medPrice(T, 51), 80); assert.equal(medPrice(T, 500), 120);
  assert.equal(medPrice(CFG.medicine.items.med_fish, 999), 15);
  const bad = clone(CFG); bad.medicine.items.med_fish.priceGems = -1; bad.medicine.items['BAD key'] = { name: 'x', scope: 'fish', priceGems: 1 };
  assert.ok(validateConfig(bad).length >= 2, JSON.stringify(validateConfig(bad)));
});

test('防作弊：用藥合法 / 偽造免疫或憑空變出寶石藥會被擋', () => {
  const cfg = clone(CFG); const T0 = Date.now();
  const prev = sampleSave({ items: { bacteria: 1, med_fish: 1, med_tank: 1, med_herb: 0 } });
  // 單條特效藥
  const a = clone(prev); a.items.med_fish = 0; a.fish[0].health = 100; a.fish[0].imm = T0 + 12 * H;
  assert.deepEqual(medCheck(cfg, prev, a, T0).suspicious, []);
  // 兩條魚免疫但只用掉一份單條藥 → 可疑
  const b = clone(a); b.fish[1].imm = T0 + 12 * H;
  assert.ok(medCheck(cfg, prev, b, T0).suspicious.length > 0);
  // 全缸藥：全部免疫
  const c = clone(prev); c.items.med_tank = 0; c.fish.forEach((f) => { f.imm = T0 + 12 * H; });
  assert.deepEqual(medCheck(cfg, prev, c, T0).suspicious, []);
  // 沒用藥就免疫
  const d = clone(prev); d.fish[2].imm = T0 + 3 * H;
  assert.ok(medCheck(cfg, prev, d, T0).suspicious.length > 0);
  // 免疫時間超過上限
  const e = clone(prev); e.items.med_tank = 0; e.fish[0].imm = T0 + 400 * H;
  assert.ok(medCheck(cfg, prev, e, T0).suspicious.some((s) => s.includes('上限')));
  // 寶石藥數量自己變多 → 可疑；金幣草本藥變多 → 計入花費
  const f = clone(prev); f.items.med_fish = 5;
  assert.ok(medCheck(cfg, prev, f, T0).suspicious.length > 0);
  const g = clone(prev); g.items.med_herb = 2;
  const mg = medCheck(cfg, prev, g, T0); assert.deepEqual(mg.suspicious, []); assert.equal(mg.spent, 2 * cfg.medicine.items.med_herb.price);
  // 草本藥效
  const h = clone(prev); h.fish[0].herb = T0 + 60 * H;
  assert.ok(medCheck(cfg, prev, h, T0).suspicious.length > 0, '草本藥效超過上限');
  const h2 = clone(g); h2.items.med_herb = 1; h2.fish.forEach((x) => { x.herb = T0 + 6 * H; });
  assert.deepEqual(medCheck(cfg, prev, h2, T0).suspicious, []);
  // 舊存檔（沒有 items 的藥品欄位、魚沒有 imm）照常通過
  const old = sampleSave(); const old2 = clone(old); old2.coins += 1;
  assert.deepEqual(medCheck(cfg, old, old2, T0).suspicious, []);
  assert.equal(checkSave(cfg, old, T0 - 60000, old2, T0).structural.length, 0);
  // 結構：imm 必須是數字
  const s1 = clone(old); s1.fish[0].imm = 'x';
  assert.ok(checkSave(cfg, old, T0 - 60000, s1, T0).structural.length > 0);
});

test('寶石買藥：會員限定、寶石不足、扣款、重送不重扣、庫存上限、存檔整合', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await relaxAntiCheat(admin);
  // 訪客 → 403
  const g = srv.sdk(); await g.ensureSession(); await g.writeSave(sampleSave());
  await assert.rejects(g.buyItem('med', 'med_fish', 'g1'), (e) => e.status === 403 && e.data.error === 'members_only');
  const { sdk, me } = await member(srv);
  await assert.rejects(sdk.buyItem('med', 'med_fish', 'm0'), (e) => e.status === 409); // 還沒有存檔
  assert.equal((await sdk.writeSave(sampleSave())).ok, true);
  await assert.rejects(sdk.buyItem('med', 'med_fish', 'm1'), (e) => e.status === 402 && e.data.error === 'insufficient_gems');
  await assert.rejects(sdk.buyItem('med', 'med_herb', 'm2'), (e) => e.status === 404, '金幣藥不能用寶石買');
  await assert.rejects(sdk.buyItem('med', 'nope', 'm3'), (e) => e.status === 404);
  await admin.post(`/players/${me.id}/gems`, { delta: 100, reason: 'test' });
  const r1 = await sdk.buyItem('med', 'med_fish', 'm4');
  assert.equal(r1.balance, 85); assert.equal(r1.price, 15); assert.equal(r1.save.items.med_fish, 1); assert.equal(r1.save.items.bacteria, 1);
  // 同一個 idempotencyKey 重送 → 不重扣
  const r1b = await sdk.buyItem('med', 'med_fish', 'm4'); assert.equal(r1b.reused, true); assert.equal(r1b.balance, 85);
  // 同時連點兩次（不同 key）→ 各扣一次，餘額正確、不會負數
  const [x, y] = await Promise.allSettled([sdk.buyItem('med', 'med_tank', 'm5'), sdk.buyItem('med', 'med_tank', 'm6')]);
  assert.equal(x.status, 'fulfilled'); assert.equal(y.status, 'rejected'); assert.equal(y.reason.status, 402);
  assert.equal((await sdk.getWallet()).gems, 25); // 85 - 60（小魚缸）
  // 存檔：玩家用掉 1 份全缸藥 → 伺服器接受；偽造 med_fish 數量 → 422
  const sv = (await sdk.loadSave()).save; assert.equal(sv.items.med_tank, 1);
  const used = clone(sv); used.items.med_tank = 0; used.fish.forEach((f) => { f.health = 100; f.imm = Date.now() + 12 * H; }); used.last = Date.now();
  const w1 = await sdk.writeSave(used); assert.equal(w1.ok, true, JSON.stringify(w1));
  const fake = clone(used); fake.items.med_fish = 9; fake.last = Date.now();
  const w2 = await sdk.writeSave(fake); assert.equal(w2.rejected, true);
  // 訂單紀錄
  const orders = (await admin.get(`/players/${me.id}`)).data;
  assert.ok(JSON.stringify(orders).includes('med:med_fish'));
  // 庫存上限 / 後台關閉
  const cur = (await admin.get('/config')).data; const c2 = cur.config; c2.medicine.maxStock = 1; c2.medicine.items.med_guard.disabled = true;
  assert.equal((await admin.put('/config', { config: c2, note: 'test', baseVersion: cur.version })).status, 200);
  await assert.rejects(sdk.buyItem('med', 'med_fish', 'm7'), (e) => e.status === 409 && e.data.error === 'too_many');
  await assert.rejects(sdk.buyItem('med', 'med_guard', 'm8'), (e) => e.status === 404);
});

test('客服對話：會員收發、未讀、限流、訪客擋下、XSS 原樣保存、不能讀別人的、後台權限', async (t) => {
  const srv = await startServer({ SUPPORT_MSG_PER_10MIN: '5' }); t.after(() => srv.stop());
  const admin = await adminClient(srv);
  // 沒 token → 401；訪客 → 403
  assert.equal((await srv.req('GET', '/api/support/thread')).status, 401);
  const g = srv.sdk(); await g.ensureSession();
  const gr = await srv.req('POST', '/api/support/messages', { category: '意見', body: 'hi' }, authH(g));
  assert.equal(gr.status, 403); assert.equal(gr.data.error, 'members_only');
  const A = await member(srv), B = await member(srv);
  // 驗證
  assert.equal((await srv.req('POST', '/api/support/messages', { category: 'xx', body: 'hi' }, authH(A.sdk))).status, 400);
  assert.equal((await srv.req('POST', '/api/support/messages', { category: '意見', body: '   ' }, authH(A.sdk))).status, 400);
  assert.equal((await srv.req('POST', '/api/support/messages', { category: '意見', body: 'x'.repeat(1001) }, authH(A.sdk))).status, 400);
  const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&\u202Eabc';
  const s1 = await srv.req('POST', '/api/support/messages', { category: 'Bug回報', body: XSS }, authH(A.sdk));
  assert.equal(s1.status, 200); const m0 = s1.data.messages.at(-1);
  assert.equal(m0.body, '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&abc', '原樣保存（去掉 bidi 控制字元），由前端跳脫');
  // 後台未讀
  let u = (await admin.get('/support/unread')).data; assert.equal(u.threads, 1); assert.equal(u.messages, 1);
  const list = (await admin.get('/support/threads')).data; const th = list.threads[0];
  assert.equal(th.unread || th.adminUnread, 1);
  // 搜尋 email / 玩家編號
  assert.equal((await admin.get('/support/threads?q=' + encodeURIComponent(A.me.email || 'med'))).data.threads.length >= 1, true);
  assert.equal((await admin.get('/support/threads?q=%23' + A.me.id)).data.threads.length, 1);
  assert.equal((await admin.get('/support/threads?q=' + encodeURIComponent('%_'))).data.threads.length, 0);
  const view = (await admin.get('/support/threads/' + th.id)).data;
  assert.equal(view.messages[0].body, m0.body); assert.ok(view.player && view.player.id === A.me.id);
  u = (await admin.get('/support/unread')).data; assert.equal(u.threads, 0, '打開後已讀');
  // 後台回覆需要 CSRF
  assert.equal((await admin.post(`/support/threads/${th.id}/reply`, { body: 'x' }, { csrf: false })).status, 403);
  assert.equal((await admin.post(`/support/threads/${th.id}/reply`, { body: '收到，<b>謝謝</b>！' })).status, 200);
  // 玩家未讀紅點
  let pu = await srv.req('GET', '/api/support/unread', undefined, authH(A.sdk)); assert.equal(pu.data.unread, 1);
  assert.equal((await srv.req('GET', '/api/support/unread', undefined, authH(B.sdk))).data.unread, 0, 'B 沒有未讀');
  // B 讀不到 A 的對話（只會拿到自己的空對話）
  const bt = await srv.req('GET', '/api/support/thread', undefined, authH(B.sdk)); assert.equal(bt.data.thread, null); assert.equal(bt.data.messages.length, 0);
  const at = await srv.req('GET', '/api/support/thread', undefined, authH(A.sdk)); assert.equal(at.data.messages.length, 2); assert.equal(at.data.messages[1].from, 'admin');
  await srv.req('POST', '/api/support/read', {}, authH(A.sdk));
  pu = await srv.req('GET', '/api/support/unread', undefined, authH(A.sdk)); assert.equal(pu.data.unread, 0);
  // 玩家不能打後台 API
  assert.equal((await srv.req('GET', '/admin/api/support/threads', undefined, authH(A.sdk))).status, 401);
  // 結案 / 重開；玩家再傳訊息會自動重開
  assert.equal((await admin.post(`/support/threads/${th.id}/status`, { status: 'closed' })).status, 200);
  assert.equal((await admin.get('/support/threads?status=closed')).data.threads.length, 1);
  await srv.req('POST', '/api/support/messages', { category: '其他', body: '還有一個問題' }, authH(A.sdk));
  assert.equal((await admin.get('/support/threads?status=open')).data.threads.length, 1);
  assert.equal((await admin.post(`/support/threads/${th.id}/status`, { status: 'weird' })).status, 400);
  // 限流（測試設為 5／10 分鐘；正式 10）
  let last; for (let i = 0; i < 6; i++) last = await srv.req('POST', '/api/support/messages', { category: '意見', body: 'spam ' + i }, authH(A.sdk));
  assert.equal(last.status, 429); assert.ok(last.headers.get('retry-after'));
  // 稽核紀錄
  const audit = JSON.stringify((await admin.get('/audit')).data || {});
  assert.ok(audit.includes('support.reply'));
});
