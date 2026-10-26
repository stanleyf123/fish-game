'use strict';
// v4.0.5 ⚓ 漁港：好友、拜訪、幫忙餵食、跨玩家繁殖（每日免費＋寶石加購、限定魚用寶石）、不公開、訪客、XSS
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, sampleSave } = require('./helpers');
const { validateConfig } = require('../src/config-validate');
const CFG = require('../seed/default-config.json');
let n = 0;
async function member(srv, nick) {
  const sdk = srv.sdk(); await sdk.ensureSession(); const me = await sdk.register(`soc${Date.now()}_${n++}@example.com`, 'fishyfish1', nick);
  srv.ctx.db.prepare('UPDATE players SET created_at=? WHERE id=?').run(Date.now() - 3 * 86400000, me.id); // 帳號滿 24 小時
  return { sdk, me, id: me.id, H: { Authorization: 'Bearer ' + sdk.token() } };
}
const adultSave = (over = {}) => { const s = sampleSave(over); s.fish.forEach((f) => { f.growth = 200; f.full = 20; }); s.coins = 5000; s.up.cap = 3; return s; };
const put = (srv, id, save) => { const r = srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(id); srv.ctx.players.writeSaveRow(id, save, (r ? r.rev : 0) + 1, Date.now(), false); };
const getSave = (srv, id) => JSON.parse(srv.ctx.db.prepare('SELECT data FROM saves WHERE player_id=?').get(id).data);

test('預設設定有漁港且通過驗證；錯誤值被擋', () => {
  assert.ok(CFG.social && CFG.social.breed);
  assert.deepEqual(validateConfig(CFG), []);
  const b = JSON.parse(JSON.stringify(CFG)); b.breedLimit = { extraGems: [10, -1] }; b.social.help.rewardFriend = -5;
  assert.ok(validateConfig(b).length >= 2);
});

test('漁港：好友／拜訪／幫忙餵食／限制／不公開／訪客／XSS', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv);
  const req = (m, p, b, H) => srv.req(m, '/api/social' + p, b, H);
  const XSS = '<img src=x onerror=alert(1)>';
  const A = await member(srv, '小明'), B = await member(srv, XSS), C = await member(srv, '阿花');
  for (const x of [A, B, C]) put(srv, x.id, adultSave());
  // 訪客：可以看推薦，不能互動
  const g = srv.sdk(); await g.ensureSession(); const GH = { Authorization: 'Bearer ' + g.token() };
  const gh = await req('GET', '/hub', undefined, GH); assert.equal(gh.status, 200); assert.equal(gh.data.member, false); assert.ok(gh.data.recommended.length >= 3);
  assert.ok(!JSON.stringify(gh.data).includes('@example.com'), '不外流信箱');
  assert.equal((await req('POST', '/help', { ownerId: A.id }, GH)).status, 403);
  assert.equal((await req('POST', '/friends/request', { id: A.id }, GH)).status, 403);
  assert.equal((await req('GET', '/hub')).status, 401);
  // 拜訪：公開欄位
  const v = await req('GET', '/tank/' + B.id, undefined, A.H); assert.equal(v.status, 200);
  assert.equal(v.data.player.name, XSS.slice(0, 16), '暱稱原樣回傳（前端跳脫）');
  assert.ok(!('email' in v.data.player) && !JSON.stringify(v.data).includes('@'));
  assert.deepEqual(Object.keys(v.data.fish[0]).sort(), ['hue', 'hungry', 'id', 'name', 'size', 'sp', 'stage']);
  // 搜尋：暱稱／#編號，不能用信箱
  assert.equal((await req('GET', '/search?q=' + encodeURIComponent('阿花'), undefined, A.H)).data.results.length, 1);
  assert.equal((await req('GET', '/search?q=%23' + C.id, undefined, A.H)).data.results.length, 1);
  assert.equal((await req('GET', '/search?q=example.com', undefined, A.H)).data.results.length, 0);
  // 好友：邀請 → 紅點 → 接受；拒絕；刪除
  assert.equal((await req('POST', '/friends/request', { id: A.id }, A.H)).status, 400);
  assert.equal((await req('POST', '/friends/request', { id: B.id }, A.H)).data.rel, 'sent');
  assert.equal((await req('GET', '/unread', undefined, B.H)).data.requests, 1);
  assert.equal((await req('POST', '/friends/accept', { id: A.id }, B.H)).data.rel, 'friend');
  assert.equal((await req('GET', '/hub', undefined, A.H)).data.friends[0].id, B.id);
  await req('POST', '/friends/request', { id: C.id }, A.H); assert.equal((await req('POST', '/friends/decline', { id: A.id }, C.H)).data.rel, 'none');
  assert.equal((await req('GET', '/tank/' + C.id, undefined, A.H)).data.rel, 'none');
  // 幫忙餵食：好友獎勵較多；同一人一天一次；主人收到通知並套用
  const h1 = await req('POST', '/help', { ownerId: B.id }, A.H); assert.equal(h1.status, 200);
  assert.equal(h1.data.reward, 40 + 5 * 2); assert.equal(h1.data.friend, true); assert.equal(h1.data.save.coins, 5050);
  assert.equal((await req('POST', '/help', { ownerId: B.id }, A.H)).status, 409);
  const h2 = await req('POST', '/help', { ownerId: C.id }, A.H); assert.equal(h2.data.reward, 20 + 5 * 2, '陌生人');
  assert.equal((await req('POST', '/help', { ownerId: A.id }, A.H)).status, 400, '不能餵自己');
  let un = (await req('GET', '/unread', undefined, B.H)).data; assert.ok(un.notes >= 1 && un.pending === 1);
  const ap = await req('POST', '/notes/apply', {}, B.H); assert.equal(ap.data.coins, 10); assert.equal(ap.data.applied[0].kind, 'help'); assert.equal(ap.data.applied[0].actor.name, '小明');
  assert.equal(getSave(srv, B.id).coins, 5010);
  assert.equal((await req('POST', '/notes/apply', {}, B.H)).data.applied.length, 0, '只套用一次（冪等）');
  // 不餓 → 不能餵
  const full = adultSave(); full.fish.forEach((f) => { f.full = 95; }); put(srv, C.id, full);
  const D = await member(srv, '大雄'); put(srv, D.id, adultSave());
  assert.equal((await req('POST', '/help', { ownerId: C.id }, D.H)).status, 409);
  // 新帳號（未滿 24 小時）→ 餵了但沒有獎勵
  const E = await member(srv, '新手'); put(srv, E.id, adultSave()); srv.ctx.db.prepare('UPDATE players SET created_at=? WHERE id=?').run(Date.now(), E.id);
  const he = await req('POST', '/help', { ownerId: E.id }, D.H); assert.equal(he.data.reward, 0); assert.ok(/新帳號/.test(he.data.why));
  // 每日有獎勵上限（設為 2）
  const cur = (await admin.get('/config')).data; cur.config.social.help.dailyRewarded = 2;
  assert.equal((await admin.put('/config', { config: cur.config, note: 'test', baseVersion: cur.version })).status, 200);
  const F = await member(srv, '靜香'); put(srv, F.id, adultSave());
  const h3 = await req('POST', '/help', { ownerId: F.id }, A.H); assert.equal(h3.data.reward, 0, '第 3 次沒有獎勵'); assert.ok(/已滿/.test(h3.data.why));
  // 不公開（後台旗標）：從所有名單消失、無法拜訪／餵食／借魚／加好友
  const ah = await admin.post(`/social/players/${F.id}/visits`, { hidden: true }); assert.equal(ah.status, 200); assert.equal(ah.data.noVisits, true);
  assert.equal(srv.ctx.db.prepare('SELECT no_visits FROM players WHERE id=?').get(F.id).no_visits, 1);
  for (let i = 0; i < 5; i++) assert.ok(!(await req('GET', '/hub', undefined, A.H)).data.recommended.some((x) => x.id === F.id));
  assert.equal((await req('GET', '/search?q=%23' + F.id, undefined, A.H)).data.results.length, 0);
  assert.equal((await req('GET', '/search?q=' + encodeURIComponent('靜香'), undefined, A.H)).data.results.length, 0);
  assert.equal((await req('GET', '/tank/' + F.id, undefined, A.H)).status, 404);
  assert.equal((await req('GET', '/tank/' + F.id, undefined, GH)).status, 404);
  assert.equal((await req('POST', '/help', { ownerId: F.id }, D.H)).status, 404);
  assert.equal((await req('POST', '/friends/request', { id: F.id }, D.H)).status, 404);
  assert.equal((await req('GET', `/breed/quote?ownerId=${F.id}&ownerFishId=fa1&myFishId=fa1`, undefined, D.H)).status, 404);
  // 好友也看不到不公開的人
  await req('POST', '/friends/request', { id: A.id }, D.H); await req('POST', '/friends/accept', { id: D.id }, A.H);
  await admin.post(`/social/players/${D.id}/visits`, { hidden: true });
  assert.ok(!(await req('GET', '/hub', undefined, A.H)).data.friends.some((x) => x.id === D.id));
  // 不公開的人自己仍可使用漁港
  assert.equal((await req('GET', '/tank/' + D.id, undefined, D.H)).status, 200, '看自己的');
  assert.equal((await req('GET', '/tank/' + A.id, undefined, D.H)).status, 200);
  await admin.post(`/social/players/${D.id}/visits`, { hidden: false });
  // 玩家自己的「不開放拜訪」
  assert.equal((await req('POST', '/settings', { visitable: false }, C.H)).data.visitable, false);
  assert.equal((await req('GET', '/tank/' + C.id, undefined, A.H)).status, 404);
  await req('POST', '/settings', { visitable: true }, C.H);
  // 稽核
  assert.ok(JSON.stringify((await admin.get('/audit')).data).includes('social.no_visits'));
  // 後台統計
  const st = (await admin.get('/social/stats')).data; assert.ok(st.today.helps.n >= 4); assert.ok(st.hidden >= 1);
  assert.equal((await srv.req('GET', '/admin/api/social/stats', undefined, A.H)).status, 401);
});

test('跨玩家繁殖：一般魚扣金幣、限定魚扣寶石、每天 1 次免費、寶石加購遞增、不重扣、台北午夜重置、主人不借', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv);
  const req = (m, p, b, H) => srv.req(m, '/api/social' + p, b, H);
  const A = await member(srv, '借魚的'), O = await member(srv, '魚主人');
  const prem = Object.keys(CFG.species).find((k) => CFG.species[k].priceGems === 200) || Object.keys(CFG.species).find((k) => CFG.species[k].priceGems > 0);
  const os = adultSave(); os.fish.push({ id: 'pp1', sp: prem, name: '寶石', hue: 10, size: 1, growth: 200, full: 80, health: 100, cd: 0, coinT: 10, seed: 9, px: .5, py: .5, dir: 1 }); put(srv, O.id, os);
  const ms = adultSave(); ms.fish.push({ id: 'young', sp: 'goldfish', name: '小', hue: 10, size: 1, growth: 10, full: 80, health: 100, cd: 0, coinT: 10, seed: 9, px: .5, py: .5, dir: 1 }); ms.up.cap = 8; put(srv, A.id, ms);
  // 時鐘：台北 2026-10-22 23:00
  let now = Date.parse('2026-10-22T15:00:00Z'); srv.ctx.social.now = () => now;
  const q = (of, mf) => req('GET', `/breed/quote?ownerId=${O.id}&ownerFishId=${of}&myFishId=${mf}`, undefined, A.H);
  assert.equal((await q('fa1', 'young')).status, 409, '幼魚不能繁殖');
  const q1 = (await q('fa1', 'fa1')).data; assert.equal(q1.gems, 0); assert.ok(q1.coins >= 100); assert.equal(q1.extraGems, 0); assert.equal(q1.today.freeBreedsLeft, 1);
  const r1 = await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa1', myFishId: 'fa1', idempotencyKey: 'b1' }, A.H);
  assert.equal(r1.status, 200, JSON.stringify(r1.data)); const sv1 = getSave(srv, A.id);
  assert.equal(sv1.coins, 5000 - q1.coins); assert.ok(sv1.fish.some((f) => f.id === r1.data.child.id)); assert.equal(sv1.fish.length, ms.fish.length + 1);
  assert.deepEqual(getSave(srv, O.id).fish, os.fish, '主人的魚沒有被動到');
  // 重送同一個 key → 不重複
  const r1b = await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa1', myFishId: 'fa1', idempotencyKey: 'b1' }, A.H);
  assert.equal(r1b.data.reused, true); assert.equal(getSave(srv, A.id).fish.length, ms.fish.length + 1);
  // 第 2 次：需要加購 💎10；寶石不足 → 402
  const q2 = (await q('fa2', 'fa2')).data; assert.equal(q2.extra, true); assert.equal(q2.extraGems, 10); assert.equal(q2.today.freeBreedsLeft, 0);
  assert.equal((await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa2', myFishId: 'fa2', idempotencyKey: 'b2' }, A.H)).status, 402);
  await admin.post(`/players/${A.id}/gems`, { delta: 45, reason: 'test' });
  // 同時送兩次（不同 key）：第 1 筆 💎10、第 2 筆 💎20 → 共 30，餘 15
  const [x1, x2] = await Promise.all([req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa2', myFishId: 'fa2', idempotencyKey: 'b3' }, A.H), req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa3', myFishId: 'fa3', idempotencyKey: 'b4' }, A.H)]);
  assert.equal(x1.status, 200); assert.equal(x2.status, 200);
  assert.deepEqual([x1.data.extraGems, x2.data.extraGems].sort((a, b) => a - b), [10, 20]);
  assert.equal(srv.ctx.commerce.balance(A.id), 15);
  // 限定魚 💎：售價 × 0.1（10–150）＋加購 💎30 → 寶石不足
  const q3 = (await q('pp1', 'fa1')).data; assert.equal(q3.gemFish, true); assert.equal(q3.coins, 0);
  assert.equal(q3.gems, Math.max(10, Math.min(150, Math.round(CFG.species[prem].priceGems * 0.1)))); assert.equal(q3.extraGems, 30);
  assert.equal((await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'pp1', myFishId: 'fa1', idempotencyKey: 'b5' }, A.H)).status, 402);
  assert.equal(srv.ctx.commerce.balance(A.id), 15, '失敗不扣');
  // 台北午夜（16:00Z）→ 重置：免費 1 次，限定魚只付限定魚寶石
  now = Date.parse('2026-10-22T16:00:30Z');
  const q4 = (await q('pp1', 'fa1')).data; assert.equal(q4.today.freeBreedsLeft, 1); assert.equal(q4.extraGems, 0);
  await admin.post(`/players/${A.id}/gems`, { delta: 100, reason: 'test' });
  const b0 = srv.ctx.commerce.balance(A.id);
  const r5 = await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'pp1', myFishId: 'fa1', idempotencyKey: 'b6' }, A.H);
  assert.equal(r5.status, 200); assert.equal(srv.ctx.commerce.balance(A.id), b0 - q4.gems);
  assert.ok(!CFG.species[r5.data.child.sp] || !(CFG.species[r5.data.child.sp].priceGems > 0), '跨種不會直接生出限定魚');
  // 主人收到通知＋借魚費
  const on = (await req('GET', '/notes', undefined, O.H)).data; assert.ok(on.notes.filter((x) => x.kind === 'breed').length >= 4);
  // 每天加購上限
  const cur = (await admin.get('/config')).data; cur.config.breedLimit = { ...(cur.config.breedLimit || {}), maxExtraPerDay: 0 };
  await admin.put('/config', { config: cur.config, note: 'test', baseVersion: cur.version });
  assert.equal((await q('fa1', 'fa1')).status, 429);
  // 主人不開放借魚
  cur.config.breedLimit.maxExtraPerDay = 5; await admin.put('/config', { config: cur.config, note: 'test', baseVersion: cur.version + 1 });
  await req('POST', '/settings', { breedOpen: false }, O.H);
  assert.equal((await q('fa1', 'fa1')).status, 403);
  await req('POST', '/settings', { breedOpen: true }, O.H);
  // 伺服器寫入的寶寶 → 下一次玩家存檔通過防作弊
  const cur2 = (await admin.get('/config')).data; cur2.config.antiCheat.minSaveIntervalSec = 0; await admin.put('/config', { config: cur2.config, note: 't', baseVersion: cur2.version });
  const sv = await A.sdk.loadSave(); const nx = JSON.parse(JSON.stringify(sv.save)); nx.last = Date.now();
  const w = await A.sdk.writeSave(nx); assert.equal(w.ok, true, JSON.stringify(w));
  // 空間不夠
  const tight = getSave(srv, A.id); tight.up.cap = 0; for (let i = 0; i < 40; i++) tight.fish.push({ ...tight.fish[0], id: 'z' + i }); put(srv, A.id, tight);
  assert.equal((await req('POST', '/breed', { ownerId: O.id, ownerFishId: 'fa1', myFishId: 'fa1', idempotencyKey: 'b9' }, A.H)).status, 409);
});
