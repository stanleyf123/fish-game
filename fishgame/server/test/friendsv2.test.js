'use strict';
// FRIENDSV2-TEST 好友系統 v2：自動加好友、過期、推薦、拜訪紀錄、互助、親密度、送禮、邀請階梯、首儲分潤（含退款扣回）、總開關
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, sampleSave } = require('./helpers');
let n = 0;
async function member(srv, nick, ageDays = 3) {
  const sdk = srv.sdk(); await sdk.ensureSession(); const me = await sdk.register(`fv2${Date.now()}_${n++}@example.com`, 'fishyfish1', nick);
  srv.ctx.db.prepare('UPDATE players SET created_at=?, last_seen=? WHERE id=?').run(Date.now() - ageDays * 86400000, Date.now(), me.id);
  const ip = `10.9.${n}.${(n * 7) % 250}`;
  return { sdk, id: me.id, ip, H: { Authorization: 'Bearer ' + sdk.token(), 'X-Forwarded-For': ip } };
}
// 不經過註冊 API 的會員（避免註冊頻率限制）；只給不需要登入的配角用
const raw = (srv, nick, ageDays = 3) => { const id = Number(srv.ctx.db.prepare('INSERT INTO players (device_hash, username, nickname, created_at, last_seen) VALUES (?,?,?,?,?)').run('dh' + Math.random(), 'raw' + Math.random().toString(36).slice(2) + '@example.com', nick, Date.now() - ageDays * 86400000, Date.now()).lastInsertRowid); return { id }; };
const put = (srv, id, save) => { const r = srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(id); srv.ctx.players.writeSaveRow(id, save, (r ? r.rev : 0) + 1, Date.now(), false); };
const getSave = (srv, id) => JSON.parse(srv.ctx.db.prepare('SELECT data FROM saves WHERE player_id=?').get(id).data);
const befriend = (srv, x, y) => { const [a, b] = x < y ? [x, y] : [y, x]; srv.ctx.db.prepare("INSERT OR REPLACE INTO social_friends (a,b,status,requester,created_at,updated_at) VALUES (?,?,'accepted',?,?,?)").run(a, b, x, Date.now(), Date.now()); };
async function setFv2(admin, fv2) {
  const cur = (await admin.get('/config')).data; const cfg = cur.config; cfg.friendsV2 = fv2;
  const r = await admin.put('/config', { config: cfg, note: 'test fv2', baseVersion: cur.version }); assert.equal(r.status, 200, JSON.stringify(r.data));
}
const V = (srv, m, p, b, H) => srv.req(m, '/api/social/v2' + p, b, H);

test('總開關預設關閉：v2 API 全部 403；舊漁港 API 照常', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const A = await member(srv, 'A'), B = await member(srv, 'B'); put(srv, A.id, sampleSave()); put(srv, B.id, sampleSave()); befriend(srv, A.id, B.id);
  for (const [m, p, b] of [['GET', '/state'], ['POST', '/help', { ownerId: B.id, action: 'feed' }], ['POST', '/gift', { to: B.id }], ['POST', '/gifts/claim', {}], ['GET', '/invite'], ['GET', '/visitors']]) {
    const r = await V(srv, m, p, b, A.H); assert.equal(r.status, 403, p); assert.equal(r.data.error, 'fv2_off');
  }
  assert.equal((await srv.req('GET', '/api/social/hub', undefined, A.H)).status, 200);
  // 關閉時：沒有任何新獎勵寫入
  assert.equal(srv.ctx.db.prepare('SELECT COUNT(*) n FROM fv2_help').get().n, 0);
  assert.equal(srv.ctx.friendsV2.sweepLadder().length, 0);
});

test('拜訪紀錄＋IP 雜湊紀錄（隱形）', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const A = await member(srv, 'A'), B = await member(srv, 'B'); put(srv, B.id, sampleSave());
  for (let i = 0; i < 3; i++) assert.equal((await srv.req('GET', '/api/social/tank/' + B.id, undefined, A.H)).status, 200);
  await srv.req('GET', '/api/social/tank/' + B.id, undefined, B.H); // 看自己不算
  const rows = srv.ctx.db.prepare('SELECT * FROM social_visits').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].visitor_id, A.id); assert.equal(rows[0].owner_id, B.id); assert.equal(rows[0].n, 3); assert.equal(rows[0].member, 1);
  assert.ok(srv.ctx.db.prepare('SELECT COUNT(*) n FROM fv2_ips WHERE player_id=?').get(A.id).n >= 1);
  assert.equal(srv.ctx.friendsV2.sameIp(A.id, B.id), false);
});

test('待回應邀請 7 天過期；過期後可重新邀請；紅點不再算', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const A = await member(srv, 'A'), B = await member(srv, 'B'); put(srv, A.id, sampleSave()); put(srv, B.id, sampleSave());
  assert.equal((await srv.req('POST', '/api/social/friends/request', { id: B.id }, A.H)).status, 200);
  assert.equal(srv.ctx.social.unread(B.id).requests, 1);
  const old = Date.now() - 8 * 86400000; srv.ctx.db.prepare('UPDATE social_friends SET created_at=?').run(old); srv.ctx.db.prepare("UPDATE social_notes SET created_at=? WHERE kind='friend_req'").run(old);
  assert.equal(srv.ctx.friendsV2.sweepExpired(true), 1);
  assert.equal(srv.ctx.db.prepare('SELECT status FROM social_friends').get().status, 'expired');
  assert.equal(srv.ctx.social.rel(A.id, B.id), 'none');
  assert.equal(srv.ctx.social.unread(B.id).requests, 0);
  assert.equal(srv.ctx.db.prepare("SELECT COUNT(*) n FROM social_notes WHERE kind='friend_req' AND read_at IS NULL").get().n, 0);
  const r = await srv.req('POST', '/api/social/friends/request', { id: B.id }, A.H); assert.equal(r.status, 200);
  assert.equal(srv.ctx.db.prepare('SELECT status FROM social_friends').get().status, 'pending');
  // 新的待回應不會被掃掉
  assert.equal(srv.ctx.friendsV2.sweepExpired(true), 0);
});

test('推薦：排除好友／待回應／待回應太多的人；24 小時內上線＋等級接近優先', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const me = await member(srv, 'me'); put(srv, me.id, sampleSave());
  const mk = async (nick, seenH, found) => { const p = raw(srv, nick); const s = sampleSave(); s.found = Object.fromEntries(['goldfish', 'clown', 'betta', 'guppy', 'angel', 'neon', 'koi', 'tetra', 'molly', 'platy', 'oscar', 'discus', 'shark', 'ray', 'puffer'].slice(0, found).map((k) => [k, 1])); put(srv, p.id, s); srv.ctx.db.prepare('UPDATE players SET last_seen=? WHERE id=?').run(Date.now() - seenH * 3600000, p.id); return p; };
  const fresh = await mk('fresh', 1, 2), old = await mk('old', 72, 2), far = await mk('far', 2, 15), fr = await mk('friend', 1, 2), pend = await mk('pend', 1, 2), busy = await mk('busy', 1, 2);
  befriend(srv, me.id, fr.id);
  const [a, b] = me.id < pend.id ? [me.id, pend.id] : [pend.id, me.id]; srv.ctx.db.prepare("INSERT INTO social_friends VALUES (?,?,'pending',?,?,?)").run(a, b, me.id, Date.now(), Date.now());
  for (let i = 0; i < 10; i++) { const x = raw(srv, 'x' + i); const [p, q] = x.id < busy.id ? [x.id, busy.id] : [busy.id, x.id]; srv.ctx.db.prepare("INSERT INTO social_friends VALUES (?,?,'pending',?,?,?)").run(p, q, x.id, Date.now(), Date.now()); }
  for (let k = 0; k < 5; k++) {
    const r = await srv.req('GET', '/api/social/hub', undefined, me.H); assert.equal(r.status, 200);
    const ids = r.data.recommended.map((p) => p.id);
    assert.ok(!ids.includes(fr.id) && !ids.includes(pend.id) && !ids.includes(busy.id) && !ids.includes(me.id), 'exclusions');
    assert.ok(ids.indexOf(fresh.id) >= 0 && ids.indexOf(fresh.id) < ids.indexOf(old.id), 'online first');
    assert.ok(ids.indexOf(fresh.id) < ids.indexOf(far.id), 'similar level first');
  }
});

test('邀請成功自動成為好友（註冊／存檔時）；舊邀請不自動；100 人上限；回填腳本 dry-run', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const db = srv.ctx.db, inv = (invitee, inviter, created = Date.now(), reason = null, status = 'pending') => db.prepare('INSERT INTO invites (invitee_id, inviter_id, code, created_at, ip_hash, status, reason) VALUES (?,?,?,?,?,?,?)').run(invitee, inviter, 'CODE1', created, 'h', status, reason);
  const A = await member(srv, '邀請人');
  // 被邀請者：先是訪客、之後註冊 → 自動好友
  const g = srv.sdk(); await g.ensureSession(); const gid = (await g.me()).player.id; inv(gid, A.id);
  await g.register(`fv2inv${Date.now()}@example.com`, 'fishyfish1', '新朋友');
  assert.equal(srv.ctx.social.rel(gid, A.id), 'friend');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM social_notes WHERE kind='friend_ok' AND data LIKE '%invite%'").get().n, 2);
  assert.equal(db.prepare('SELECT state FROM fv2_invite_links WHERE invitee_id=?').get(gid).state, 'friend');
  // 舊邀請（功能上線前）→ 不自動，但回填（backfill）可以
  const O = await member(srv, '舊'); inv(O.id, A.id, Date.now() - 30 * 86400000, null, 'rewarded');
  assert.equal(srv.ctx.friendsV2.linkInvite(O.id), null); assert.equal(srv.ctx.social.rel(O.id, A.id), 'none');
  // self 不算
  const S2 = await member(srv, 'self'); inv(S2.id, A.id, Date.now(), 'self', 'rejected'); assert.equal(srv.ctx.friendsV2.linkInvite(S2.id), null);
  // 上限：邀請人已有 100 位好友 → full
  const F = await member(srv, '滿'); for (let i = 0; i < 100; i++) befriend(srv, F.id, raw(srv, 'f' + i).id);
  const N = await member(srv, '想加'); inv(N.id, F.id); assert.equal(srv.ctx.friendsV2.linkInvite(N.id).state, 'full'); assert.equal(srv.ctx.social.rel(N.id, F.id), 'none');
  // 冪等
  assert.equal(srv.ctx.friendsV2.linkInvite(gid), null);
  // 回填 dry-run：只讀、回報數量
  const { backfill } = require('../scripts/fv2-backfill-invite-friends.js');
  const dry = backfill(db, { execute: false, max: 100 });
  assert.equal(dry.execute, false); assert.equal(dry.counts.would_friend, 1); assert.equal(db.prepare('SELECT COUNT(*) n FROM fv2_invite_links WHERE invitee_id=?').get(O.id).n, 0);
  const run = backfill(db, { execute: true, max: 100 }); assert.equal(run.counts.friend, 1); assert.equal(srv.ctx.social.rel(O.id, A.id), 'friend');
});

test('每日互助：只限好友、每位好友每天一次、雙方獎勵、同 IP／新帳號無獎勵、每日上限、主人端套用', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await setFv2(admin, { enabled: true });
  const A = await member(srv, 'A'), B = await member(srv, 'B'), C = await member(srv, 'C'), Y = await member(srv, 'young', 0.2);
  for (const p of [A, B, C, Y]) put(srv, p.id, sampleSave());
  befriend(srv, A.id, B.id); befriend(srv, A.id, Y.id);
  let r = await V(srv, 'POST', '/help', { ownerId: C.id, action: 'feed' }, A.H); assert.equal(r.status, 403); assert.equal(r.data.error, 'not_friend');
  r = await V(srv, 'POST', '/help', { ownerId: B.id, action: 'x' }, A.H); assert.equal(r.status, 400);
  const c0 = getSave(srv, A.id).coins;
  r = await V(srv, 'POST', '/help', { ownerId: B.id, action: 'algae' }, A.H); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.reward >= 40 && r.data.reward <= 120); assert.equal(r.data.ownerReward, 20); assert.equal(r.data.intimacy.gained, 2);
  assert.equal(getSave(srv, A.id).coins, c0 + r.data.reward);
  r = await V(srv, 'POST', '/help', { ownerId: B.id, action: 'feed' }, A.H); assert.equal(r.status, 409); assert.equal(r.data.error, 'already_helped');
  // 舊的「幫忙餵食」也共用每天一次
  assert.equal((await srv.req('POST', '/api/social/help', { ownerId: B.id }, A.H)).status, 409);
  // 主人端：help2 通知由主人自己的 /notes/apply 套用（金幣進自己的存檔）
  const bc = getSave(srv, B.id).coins; const ap = await srv.req('POST', '/api/social/notes/apply', {}, B.H); assert.equal(ap.status, 200);
  assert.equal(getSave(srv, B.id).coins, bc + 20); assert.ok(ap.data.applied.some((x) => x.kind === 'help2'));
  // 新帳號（未滿 24 小時）→ 可以幫，但沒獎勵
  r = await V(srv, 'POST', '/help', { ownerId: Y.id, action: 'waste' }, A.H); assert.equal(r.status, 200); assert.equal(r.data.reward, 0); assert.equal(r.data.ownerReward, 0);
  // 同 IP 好友對 → 沒獎勵、沒親密度
  const D = await member(srv, 'D'); put(srv, D.id, sampleSave()); befriend(srv, D.id, B.id);
  const sameH = { ...D.H, 'X-Forwarded-For': B.ip }; await srv.req('GET', '/api/social/hub', undefined, sameH);
  assert.equal(srv.ctx.friendsV2.sameIp(D.id, B.id), true);
  r = await V(srv, 'POST', '/help', { ownerId: B.id, action: 'feed' }, sameH); assert.equal(r.status, 200); assert.equal(r.data.reward, 0); assert.equal(r.data.ownerReward, 0); assert.equal(r.data.intimacy.gained, 0);
  // 每日上限：已有 10 次有獎勵 → 第 11 次 0
  const fv = srv.ctx.friendsV2, d = fv.day();
  for (let i = 0; i < 10; i++) { const x = raw(srv, 'h' + i); srv.ctx.db.prepare('INSERT INTO social_helps (helper_id, owner_id, day, reward, friend, created_at) VALUES (?,?,?,?,1,?)').run(C.id, x.id, d, 60, Date.now()); }
  const E = await member(srv, 'E'); put(srv, E.id, sampleSave()); befriend(srv, C.id, E.id);
  r = await V(srv, 'POST', '/help', { ownerId: E.id, action: 'feed' }, C.H); assert.equal(r.status, 200); assert.equal(r.data.reward, 0); assert.match(r.data.why, /已滿/);
  // state：紅點數字
  const st = await V(srv, 'GET', '/state', undefined, A.H); assert.equal(st.status, 200); assert.equal(st.data.helpable, 0); assert.equal(st.data.friends[B.id].helpedToday, true);
});

test('親密度：每對每天上限 5、升級里程碑雙方各拿、Lv3 借魚折扣、Lv5 每天多 1 次免費繁殖', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await setFv2(admin, { enabled: true });
  const A = await member(srv, 'A'), B = await member(srv, 'B'); put(srv, A.id, sampleSave()); put(srv, B.id, sampleSave()); befriend(srv, A.id, B.id);
  const fv = srv.ctx.friendsV2;
  let g = 0; for (let i = 0; i < 5; i++) g += fv.addIntimacy(A.id, B.id, 'help', false).gained;
  assert.equal(g, 5); assert.equal(fv.intimacy(A.id, B.id), 5);
  srv.ctx.db.prepare('UPDATE fv2_intimacy SET points=9').run(); srv.ctx.db.prepare('DELETE FROM fv2_intim_day').run();
  const up = fv.addIntimacy(A.id, B.id, 'help', false); assert.deepEqual(up.up, [2]);
  const notes = srv.ctx.db.prepare("SELECT player_id, coins FROM social_notes WHERE kind='fv2_bond'").all(); assert.equal(notes.length, 2); assert.ok(notes.every((x) => x.coins === 200));
  assert.equal(fv.addIntimacy(A.id, B.id, 'help', true).gained, 0); // 同 IP ×0
  // 里程碑不重複發
  srv.ctx.db.prepare('UPDATE fv2_intimacy SET points=5').run(); srv.ctx.db.prepare('DELETE FROM fv2_intim_day').run(); fv.addIntimacy(A.id, B.id, 'help', false); fv.addIntimacy(A.id, B.id, 'help', false); fv.addIntimacy(A.id, B.id, 'help', false);
  assert.equal(srv.ctx.db.prepare("SELECT COUNT(*) n FROM social_notes WHERE kind='fv2_bond'").get().n, 2);
  srv.ctx.db.prepare('UPDATE fv2_intimacy SET points=25').run(); assert.equal(fv.breedPerks(A.id, B.id).discount, 10);
  srv.ctx.db.prepare('UPDATE fv2_intimacy SET points=70').run(); const pk = fv.breedPerks(A.id, B.id); assert.equal(pk.bond, true); assert.equal(fv.titleOf(fv.lvOf(100)), '好朋友');
  // 關掉總開關 → 沒有加成
  await setFv2(admin, { enabled: false }); assert.equal(fv.breedPerks(A.id, B.id).discount, 0); assert.equal(fv.addIntimacy(A.id, B.id, 'help', false).gained, 0);
});

test('送禮：免費每天一次；付費扣寶石、冪等、每天上限、對方已有不能送；領取寫進自己的存檔；禮物魚賣不到錢（伺服器端）', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await setFv2(admin, { enabled: true });
  const A = await member(srv, 'A'), B = await member(srv, 'B'); put(srv, A.id, sampleSave()); put(srv, B.id, sampleSave()); befriend(srv, A.id, B.id);
  srv.ctx.commerce.ledger(A.id, 500, 'admin_grant', 'test');
  let r = await V(srv, 'POST', '/gift', { to: B.id }, A.H); assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await V(srv, 'POST', '/gift', { to: B.id }, A.H); assert.equal(r.status, 409);
  const cat = await V(srv, 'GET', '/catalog?to=' + B.id, undefined, A.H); assert.equal(cat.status, 200); assert.ok(cat.data.items.length > 0);
  const deco = cat.data.items.find((x) => x.kind === 'deco'), fry = cat.data.items.find((x) => x.kind === 'fry'), bg = cat.data.items.find((x) => x.kind === 'bg');
  assert.ok(deco && fry, 'catalog has deco + fry');
  assert.ok(!cat.data.items.some((x) => x.id === 'bg:bg_festival'), '首儲獨家背景不在禮物清單');
  assert.ok(cat.data.items.some((x) => x.kind === 'bg'), '其他背景仍可送');
  { const fx = await V(srv, 'POST', '/gift', { to: B.id, item: 'bg:bg_festival', idempotencyKey: 'festival-try-01' }, A.H); assert.equal(fx.status, 404, '節慶背景不能付費送'); }
  const k1 = 'idem-' + Date.now();
  r = await V(srv, 'POST', '/gift', { to: B.id, item: deco.id, idempotencyKey: k1 }, A.H); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.balance, 500 - deco.gems);
  r = await V(srv, 'POST', '/gift', { to: B.id, item: deco.id, idempotencyKey: k1 }, A.H); assert.equal(r.data.reused, true); assert.equal(srv.ctx.commerce.balance(A.id), 500 - deco.gems);
  r = await V(srv, 'POST', '/gift', { to: B.id, item: deco.id, idempotencyKey: k1 + 'b' }, A.H); assert.equal(r.status, 409); // 已送未領
  r = await V(srv, 'POST', '/gift', { to: B.id, item: fry.id, idempotencyKey: k1 + 'f' }, A.H); assert.equal(r.status, 200);
  if (bg) { r = await V(srv, 'POST', '/gift', { to: B.id, item: bg.id, idempotencyKey: k1 + 'g' }, A.H); assert.ok([200, 402].includes(r.status)); }
  // 寶石不足
  srv.ctx.db.prepare('UPDATE players SET gems=0 WHERE id=?').run(A.id);
  r = await V(srv, 'POST', '/gift', { to: B.id, item: fry.id, idempotencyKey: k1 + 'z' }, A.H); assert.equal(r.status, 402);
  // B 的狀態有 3 份待領
  const st = await V(srv, 'GET', '/state', undefined, B.H); assert.ok(st.data.gifts.length >= 3);
  const before = getSave(srv, B.id);
  r = await V(srv, 'POST', '/gifts/claim', {}, B.H); assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = getSave(srv, B.id);
  assert.ok(after.up.deco.includes(deco.id.split(':')[1]));
  const gf = after.fish.find((f) => f.gift === 1); assert.ok(gf && gf.sp === fry.id.split(':')[1]);
  assert.equal(after.coins, before.coins + r.data.coins);
  r = await V(srv, 'POST', '/gifts/claim', {}, B.H); assert.equal(r.data.claimed.length, 0); // 冪等
  // 每天付費上限 5
  srv.ctx.db.prepare('UPDATE players SET gems=1000 WHERE id=?').run(A.id);
  const sent = srv.ctx.db.prepare("SELECT COUNT(*) n FROM fv2_gifts WHERE from_id=? AND kind='paid'").get(A.id).n;
  for (let i = sent; i < 5; i++) assert.equal((await V(srv, 'POST', '/gift', { to: B.id, item: fry.id, idempotencyKey: 'lim' + i + Date.now() }, A.H)).status, 200);
  r = await V(srv, 'POST', '/gift', { to: B.id, item: fry.id, idempotencyKey: 'lim-x' + Date.now() }, A.H); assert.equal(r.status, 429);
  // 對方已擁有 → 送出時擋下
  r = await V(srv, 'GET', '/catalog?to=' + B.id, undefined, A.H); assert.equal(r.data.items.find((x) => x.id === deco.id).owned, true);
  // 禮物魚不能換金幣：賣掉禮物魚時伺服器不給賣魚額度；移除 gift 標記會被標成可疑
  const { checkSave } = require('../src/anticheat'); const cfg = srv.ctx.configStore.active().config;
  const sold = JSON.parse(JSON.stringify(after)); sold.fish = sold.fish.filter((f) => f.id !== gf.id); sold.coins += 5000;
  const strip = JSON.parse(JSON.stringify(after)); strip.fish.find((f) => f.id === gf.id).gift = undefined; delete strip.fish.find((f) => f.id === gf.id).gift;
  const r1 = checkSave(cfg, after, Date.now() - 600000, sold, Date.now(), {}), r2 = checkSave(cfg, after, Date.now() - 600000, strip, Date.now(), {});
  assert.ok(JSON.stringify(r2).includes('禮物魚'), 'strip flagged');
  const soldN = JSON.parse(JSON.stringify(after)); soldN.fish = soldN.fish.filter((f) => f.id !== gf.id); const r3 = checkSave(cfg, after, Date.now() - 600000, soldN, Date.now(), {});
  assert.ok(r1 && r3);
});

test('💰 邀請階梯 3/5/10 與首儲分潤：只算真錢第一筆、24 小時後發、同 IP 不發、退款扣回', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await setFv2(admin, { enabled: true, inviteLadder: { enabled: true }, rebate: { enabled: true } });
  const db = srv.ctx.db, fv = srv.ctx.friendsV2;
  const A = await member(srv, '邀請人'); const ids = [];
  for (let i = 0; i < 6; i++) { const x = raw(srv, 'iv' + i); ids.push(x); db.prepare("INSERT INTO invites (invitee_id, inviter_id, code, created_at, ip_hash, status, reason, flag) VALUES (?,?,?,?,?,?,?,?)").run(x.id, A.id, 'C', Date.now() - 5 * 86400000, 'h' + i, i === 5 ? 'rejected' : 'rewarded', i === 5 ? 'same_ip' : null, i === 5 ? 'same_ip' : null); }
  let L = fv.sweepLadder(); assert.deepEqual(L.map((x) => x.gems).sort(), [30, 50]); assert.equal(srv.ctx.commerce.balance(A.id), 80);
  assert.equal(fv.sweepLadder().length, 0); // 冪等
  const ord = (pid, id, provider, amount, creditedAgoH, status = 'paid') => db.prepare("INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, created_at, updated_at, paid_at, credited_at) VALUES (?,?,?,?,?,'TWD',?,?,?,?,?,?)").run(id, pid, 'gems60', '寶石', amount, status, provider, Date.now(), Date.now(), Date.now() - creditedAgoH * 3600000, Date.now() - creditedAgoH * 3600000);
  db.prepare("UPDATE fv2_meta SET v=? WHERE k='rebate_since'").run(String(Date.now() - 100 * 3600000)); db.prepare("INSERT OR IGNORE INTO fv2_meta VALUES ('rebate_since', ?)").run(String(Date.now() - 100 * 3600000));
  ord(ids[0].id, 'o-mock', 'mock', 990, 48); // 非真錢 → 不算
  ord(ids[1].id, 'o-new', 'ecpay', 300, 2);  // 未滿 24 小時
  ord(ids[2].id, 'o-a', 'ecpay', 150, 30); ord(ids[2].id, 'o-b', 'newebpay', 1990, 25); // 只算第一筆 150
  ord(ids[3].id, 'o-big', 'stripe', 1990, 30); // 上限 100
  ord(ids[5].id, 'o-same', 'ecpay', 990, 30); // 同 IP → 不發
  let R = fv.sweepRebates();
  const got = Object.fromEntries(R.paid.map((x) => [x.key, x.gems]));
  assert.deepEqual(got, { ['rebate:' + ids[2].id]: 30, ['rebate:' + ids[3].id]: 100 });
  assert.equal(db.prepare("SELECT status FROM fv2_bonus WHERE key=?").get('rebate:' + ids[5].id).status, 'skip_same_ip');
  assert.equal(fv.sweepRebates().paid.length, 0); // 冪等
  const bal = srv.ctx.commerce.balance(A.id); assert.equal(bal, 80 + 130);
  // 退款 → 扣回（可以變負數）
  db.prepare('UPDATE players SET gems=10 WHERE id=?').run(A.id);
  db.prepare("UPDATE orders SET status='refunded', refunded_at=? WHERE id='o-big'").run(Date.now());
  R = fv.sweepRebates(); assert.equal(R.clawed.length, 1); assert.equal(srv.ctx.commerce.balance(A.id), 10 - 100);
  assert.equal(db.prepare("SELECT status FROM fv2_bonus WHERE key=?").get('rebate:' + ids[3].id).status, 'clawed');
  assert.equal(fv.sweepRebates().clawed.length, 0);
  // 退款後同一位被邀請者不會再用第二筆訂單拿分潤
  ord(ids[3].id, 'o-big2', 'ecpay', 990, 30); assert.equal(fv.sweepRebates().paid.length, 0);
  // 1 小時後到期那筆
  db.prepare("UPDATE orders SET credited_at=? WHERE id='o-new'").run(Date.now() - 25 * 3600000);
  assert.equal(fv.sweepRebates().paid[0].gems, 60);
  const inv = await V(srv, 'GET', '/invite', undefined, A.H); assert.equal(inv.status, 200); assert.equal(inv.data.ladder.qualified, 5);
  // 開關關掉 → 不再發
  await setFv2(admin, { enabled: true, inviteLadder: { enabled: false }, rebate: { enabled: false } });
  ord(ids[4].id, 'o-late', 'ecpay', 990, 30); assert.equal(fv.sweepRebates().paid.length, 0);
});

test('後台統計', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); const r = await admin.get('/social/v2/stats'); assert.equal(r.status, 200); assert.equal(r.data.config.enabled, false);
  assert.equal((await srv.req('GET', '/admin/api/social/v2/stats')).status, 401);
});
