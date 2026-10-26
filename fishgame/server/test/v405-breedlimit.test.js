'use strict';
// v4.0.5 🐣 每日繁殖次數：自家＋漁港共用；每天免費 3 次（漁港最多 1 次免費）；加購 💎10/20/30/40/50（最多 5 次）；台北午夜重置；防作弊
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, sampleSave } = require('./helpers');
const { validateConfig } = require('../src/config-validate');
const { blCfg, coinBuyable } = require('../src/breedlimit');
const CFG = require('../seed/default-config.json');
let n = 0;
async function player(srv, member = true) {
  const sdk = srv.sdk(); await sdk.ensureSession();
  let id; if (member) id = (await sdk.register(`bl${Date.now()}_${n++}@example.com`, 'fishyfish1')).id; else id = (await sdk.me ? (await sdk.me()).id : null);
  const H = { Authorization: 'Bearer ' + sdk.token() };
  if (!id) id = (await srv.req('GET', '/api/breed/today', undefined, H), srv.ctx.db.prepare('SELECT player_id FROM player_tokens ORDER BY rowid DESC LIMIT 1').get().player_id);
  return { sdk, id, H };
}
const key = () => 'k' + Math.random().toString(36).slice(2, 12);

test('預設設定：每天免費 3 次（漁港 1 次）、加購 10/20/30/40/50、最多 5 次、月卡加成已開啟；設定驗證', () => {
  const C = blCfg(CFG);
  assert.equal(C.freePerDay, 3); assert.equal(C.harborFreePerDay, 1); assert.deepEqual(C.extraGems, [10, 20, 30, 40, 50]); assert.equal(C.maxExtraPerDay, 5); assert.equal(C.cardPerk, true);
  assert.ok(CFG.breedLimit, '遊戲設定裡有 breedLimit'); assert.deepEqual(validateConfig(CFG), []);
  const b = JSON.parse(JSON.stringify(CFG)); b.breedLimit = { freePerDay: 1, harborFreePerDay: 2, extraGems: [10, -1] };
  assert.ok(validateConfig(b).length >= 2, JSON.stringify(validateConfig(b)));
  assert.equal(coinBuyable(CFG, 'goldfish'), true); assert.equal(coinBuyable(CFG, 'platinumarowana'), false);
});

test('自家繁殖：免費 3 次 → 加購遞增、寶石不足 402、重送不重扣、同時送不重複、上限 429、台北午夜重置；訪客不能加購', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv);
  let now = Date.parse('2026-10-22T15:58:00Z'); srv.ctx.social.now = () => now; // 台北 23:58
  const A = await player(srv);
  const use = (k = key(), P = A) => srv.req('POST', '/api/breed/use', { idempotencyKey: k }, P.H);
  const tdy = async (P = A) => (await srv.req('GET', '/api/breed/today', undefined, P.H)).data.today;
  let d = await tdy(); assert.equal(d.freeLeft, 3); assert.equal(d.ownNext, 0); assert.equal(d.harborNext, 0);
  const tokens = new Set();
  for (let i = 0; i < 3; i++) { const r = await use(); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.gems, 0); assert.match(r.data.token, /^[0-9a-f]{24}$/); tokens.add(r.data.token); }
  assert.equal(tokens.size, 3);
  d = await tdy(); assert.equal(d.used, 3); assert.equal(d.freeLeft, 0); assert.equal(d.ownNext, 10); assert.equal(d.harborNext, 10);
  // 寶石不足
  const r402 = await use(); assert.equal(r402.status, 402); assert.equal(r402.data.error, 'insufficient_gems');
  await admin.post(`/players/${A.id}/gems`, { delta: 200, reason: 'test' });
  // 同一個 key 重送 → 同一個 token、只扣一次
  const k1 = key(); const a1 = await use(k1), a1b = await use(k1);
  assert.equal(a1.data.gems, 10); assert.equal(a1b.data.reused, true); assert.equal(a1b.data.token, a1.data.token);
  assert.equal(srv.ctx.commerce.balance(A.id), 190);
  // 同時送兩次（不同 key）→ 💎20、💎30
  const [p1, p2] = await Promise.all([use(), use()]);
  assert.deepEqual([p1.data.gems, p2.data.gems].sort((a, b) => a - b), [20, 30]); assert.equal(srv.ctx.commerce.balance(A.id), 140);
  assert.equal((await use()).data.gems, 40); assert.equal((await use()).data.gems, 50); assert.equal(srv.ctx.commerce.balance(A.id), 50);
  d = await tdy(); assert.equal(d.extrasUsed, 5); assert.equal(d.extrasLeft, 0); assert.equal(d.ownNext, null);
  const r429 = await use(); assert.equal(r429.status, 429); assert.equal(srv.ctx.commerce.balance(A.id), 50, '超過上限不扣');
  // 台北午夜（16:00Z）重置
  now = Date.parse('2026-10-22T16:00:05Z');
  d = await tdy(); assert.equal(d.used, 0); assert.equal(d.freeLeft, 3); assert.equal(d.ownNext, 0);
  assert.equal((await use()).data.gems, 0);
  // 訪客：免費 3 次可以，加購要會員
  const G = await player(srv, false);
  for (let i = 0; i < 3; i++) assert.equal((await use(key(), G)).status, 200);
  const g4 = await use(key(), G); assert.equal(g4.status, 403); assert.equal(g4.data.error, 'members_only');
  // 沒有 idempotencyKey
  assert.equal((await srv.req('POST', '/api/breed/use', {}, A.H)).status, 400);
  // 後台可調：免費 1 次、加購價改 [5]
  const cur = (await admin.get('/config')).data; cur.config.breedLimit = { ...(cur.config.breedLimit || {}), freePerDay: 1, harborFreePerDay: 1, extraGems: [5] };
  assert.equal((await admin.put('/config', { config: cur.config, note: 'test', baseVersion: cur.version })).status, 200);
  now = Date.parse('2026-10-23T16:00:05Z');
  assert.equal((await use()).data.gems, 0); assert.equal((await use()).data.gems, 5); assert.equal((await use()).data.gems, 5);
});

test('自家＋漁港共用計數：漁港只有第 1 次免費，第 2 次起一定要加購（即使自家還有免費次數）', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv);
  const A = await player(srv); const BL = srv.ctx.breedLimit;
  await admin.post(`/players/${A.id}/gems`, { delta: 500, reason: 'test' });
  const harbor = () => srv.ctx.db.transaction(() => BL.record(A.id, 'harbor'))();
  const own = () => srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, A.H);
  let d = BL.today(A.id); assert.equal(d.harborNext, 0); assert.equal(d.harborFreeLeft, 1);
  assert.equal(harbor().gems, 0); // 漁港第 1 次免費
  d = BL.today(A.id); assert.equal(d.freeLeft, 2); assert.equal(d.harborFreeLeft, 0); assert.equal(d.harborNext, 10); assert.equal(d.ownNext, 0);
  assert.equal(harbor().gems, 10); // 漁港第 2 次 → 💎10（自家還有 2 次免費）
  d = BL.today(A.id); assert.equal(d.freeLeft, 2); assert.equal(d.ownNext, 0); assert.equal(d.harborNext, 20);
  assert.equal((await own()).data.gems, 0); assert.equal((await own()).data.gems, 0); // 自家用完剩下 2 次免費
  d = BL.today(A.id); assert.equal(d.used, 4); assert.equal(d.freeLeft, 0); assert.equal(d.ownNext, 20, '加購價格自家／漁港共用遞增');
  assert.equal((await own()).data.gems, 20); assert.equal(harbor().gems, 30);
  assert.equal(srv.ctx.commerce.balance(A.id), 500 - 10 - 20 - 30);
  // 自家先用完 3 次免費 → 漁港也沒有免費
  const B = await player(srv); await admin.post(`/players/${B.id}/gems`, { delta: 100, reason: 'test' });
  for (let i = 0; i < 3; i++) await srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, B.H);
  d = BL.today(B.id); assert.equal(d.harborFreeLeft, 0); assert.equal(d.harborNext, 10);
});

test('防作弊：寶寶要有伺服器的繁殖 token；只能繁殖得到的魚沒有 token → 拒絕；token 不能重複用／用別人的', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const A = await player(srv), B = await player(srv);
  const base = sampleSave({ coins: 1000 }); base.up.cap = 7;
  const seed = (P) => { srv.ctx.players.writeSaveRow(P.id, base, 1, Date.now(), false); srv.ctx.db.prepare('UPDATE saves SET client_saved_at=? WHERE player_id=?').run(Date.now() - 60000, P.id); };
  const push = async (P, s) => { const rev = srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(P.id).rev; const r = await srv.req('PUT', '/api/save', { save: s, rev }, P.H); srv.ctx.db.prepare('UPDATE saves SET client_saved_at=? WHERE player_id=?').run(Date.now() - 60000, P.id); return r; };
  const kid = (id, sp, bt) => ({ ...base.fish[0], id, sp, growth: 0, ...(bt ? { bt } : {}) });
  seed(A); seed(B);
  // 1) 舊版網頁（沒有 token）：今天還有免費次數 → 接受並記一次；免費用完 → 422
  const s0 = JSON.parse(JSON.stringify(base)); s0.fish.push(kid('k0', 'platinumarowana'));
  const r0 = await push(A, s0); assert.equal(r0.status, 200, JSON.stringify(r0.data));
  assert.equal(srv.ctx.breedLimit.today(A.id).freeUsed, 1, '沒有 token 的繁殖也算一次');
  assert.equal((await push(A, s0)).status, 200, '同一條魚之後的存檔不再重算');
  assert.equal(srv.ctx.breedLimit.today(A.id).freeUsed, 1);
  const s1 = JSON.parse(JSON.stringify(s0)); s1.fish.push(kid('k1a', 'platinumarowana'), kid('k1b', 'platinumarowana'), kid('k1c', 'platinumarowana'));
  const r1 = await push(A, s1); assert.equal(r1.status, 422, JSON.stringify(r1.data)); assert.ok(JSON.stringify(r1.data).includes('繁殖'));
  assert.equal(srv.ctx.breedLimit.today(A.id).freeUsed, 1, '被拒絕的存檔不會記次數');
  // 2) 有 token → 接受，token 註銷
  const tk = (await srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, A.H)).data.token;
  const s2 = JSON.parse(JSON.stringify(base)); s2.fish.push(kid('k2', 'platinumarowana', tk));
  const r2 = await push(A, s2); assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(srv.ctx.db.prepare('SELECT child_id FROM breed_uses WHERE token=?').get(tk).child_id, 'k2');
  // 同一條魚之後的存檔照常（不是新魚）
  assert.equal((await push(A, s2)).status, 200);
  // 3) 同一個 token 再生一條 → 拒絕
  const s3 = JSON.parse(JSON.stringify(s2)); s3.fish.push(kid('k3', 'platinumarowana', tk));
  assert.equal((await push(A, s3)).status, 422);
  // 4) 用別人的 token → 拒絕
  const tb = (await srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, B.H)).data.token;
  const s4 = JSON.parse(JSON.stringify(s2)); s4.fish.push(kid('k4', 'platinumarowana', tb));
  assert.equal((await push(A, s4)).status, 422);
  // 5) 一般魚（可以用金幣買）沒有 token：金幣有扣 → 接受；沒扣 → 拒絕
  const s5 = JSON.parse(JSON.stringify(s2)); s5.fish.push(kid('k5', 'blackpiranha')); s5.up.cap = 7;
  s5.coins = 1000 + 5000; // 沒扣 6600
  assert.equal((await push(A, s5)).status, 422);
  // 6) 超過今天免費次數又沒加購（拿不到 token）→ 生不出只能繁殖得到的魚
  await srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, A.H); // 第 3 次免費
  assert.equal(srv.ctx.breedLimit.today(A.id).freeLeft, 0);
  assert.equal((await srv.req('POST', '/api/breed/use', { idempotencyKey: key() }, A.H)).status, 402);
  const s6 = JSON.parse(JSON.stringify(s2)); s6.fish.push(kid('k6', 'platinumarowana'));
  assert.equal((await push(A, s6)).status, 422);
  // 舊存檔：原本就有的魚（沒有 bt）完全不受影響
  const s7 = JSON.parse(JSON.stringify(s2)); s7.coins += 10; assert.equal((await push(A, s7)).status, 200);
});
