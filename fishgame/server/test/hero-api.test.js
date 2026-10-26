'use strict';
// 英雄魚 API：登入／會員限制、選英雄、訓練（金幣扣款＋冷卻）、購買驗證（金幣／寶石／冪等）、PvP、防刷、後台、賽季
const test = require('node:test');
const assert = require('node:assert');
const { adminClient } = require('./helpers');
const { startHeroServer, fishOf } = require('./hero-helpers');

const ip = (n) => ({ 'X-Forwarded-For': '10.0.0.' + n });
async function mk(srv, n, opt = {}) {
  const p = await srv.player({ coins: 5000, fish: [fishOf('h' + n + 'a', opt.sp || 'betta'), fishOf('h' + n + 'b', 'goldfish'), fishOf('h' + n + 'c', 'redpiranha')], ...opt });
  p.call = (m, path, b) => srv.req(m, path, b, p.token, ip(opt.ip || n));
  return p;
}
async function heroCfgPatch(admin, fn) {
  const cur = (await admin.get('/hero/config')).data; fn(cur.config);
  const r = await admin.put('/hero/config', { config: cur.config, note: 'test', baseVersion: cur.version });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

test('英雄魚：需登入、訪客可養成但不能對戰、選英雄、訓練扣金幣＋冷卻、更換英雄', { timeout: 120000 }, async (t) => {
  const srv = await startHeroServer();
  t.after(() => srv.stop());
  assert.equal((await srv.req('GET', '/api/hero/me')).status, 401);
  assert.equal((await srv.req('POST', '/api/hero/challenge', { opponent: 'p:1' })).status, 401);

  const g = await mk(srv, 1, { member: false });
  let r = await g.call('GET', '/api/hero/me');
  assert.equal(r.status, 200); assert.equal(r.data.member, false); assert.equal(r.data.hero, null);
  r = await g.call('GET', '/api/hero/candidates');
  assert.equal(r.status, 200); assert.equal(r.data.candidates.length, 3); assert.ok(r.data.candidates[0].power > 0);
  assert.equal((await g.call('POST', '/api/hero/pick', { fishId: 'nope' })).status, 404);
  r = await g.call('POST', '/api/hero/pick', { fishId: 'h1a' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.hero.species, 'betta'); assert.equal(r.data.coins, 5000, '第一次選英雄免費');
  assert.equal(r.data.hero.rank.name, '青銅');
  // 訪客不能對戰
  r = await g.call('GET', '/api/hero/opponents');
  assert.equal(r.status, 403); assert.equal(r.data.error, 'member_required');
  assert.equal((await g.call('POST', '/api/hero/challenge', { opponent: 'npc:1' })).data.error, 'member_required');

  // 訓練：扣金幣（伺服器改存檔、rev+1）、加經驗與訓練點、冷卻
  const rev0 = srv.ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(g.id).rev;
  r = await g.call('POST', '/api/hero/train', { type: 'atk', stats: { atk: 9999 }, xp: 99999 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.coins, 5000 - 40); assert.equal(srv.coins(g.id), 4960);
  assert.equal(r.data.spent.rev, rev0 + 1); assert.equal(r.data.hero.train.atk, 1); assert.equal(r.data.hero.xp, 35, '客戶端送的 stats/xp 一律忽略');
  r = await g.call('POST', '/api/hero/train', { type: 'atk' });
  assert.equal(r.status, 429); assert.equal(r.data.error, 'training_cooldown'); assert.ok(r.data.readyAt > Date.now());
  assert.equal((await g.call('POST', '/api/hero/train', { type: 'flying' })).status, 400);
  srv.setCoins(g.id, 10);
  r = await g.call('POST', '/api/hero/train', { type: 'hp' });
  assert.equal(r.status, 402); assert.equal(r.data.error, 'insufficient_coins'); assert.equal(srv.coins(g.id), 10, '失敗不扣款');
  // 訓練點上限＝等級 × 1
  srv.setCoins(g.id, 5000);
  srv.ctx.db.prepare("UPDATE heroes SET train_ready='{}' WHERE player_id=?").run(g.id);
  r = await g.call('POST', '/api/hero/train', { type: 'atk' });
  assert.equal(r.status, 409); assert.equal(r.data.error, 'training_capped');

  // 更換英雄：第二次起收費，且有冷卻
  // （第一次選後 24 小時內免費換一次的規則在 hero-pick.test.js 驗證；這裡把建立時間調到 25 小時前，驗證一般收費）
  srv.ctx.db.prepare('UPDATE heroes SET changed_at=?, created_at=? WHERE player_id=?').run(Date.now() - 13 * 3600000, Date.now() - 25 * 3600000, g.id);
  r = await g.call('POST', '/api/hero/pick', { fishId: 'h1b' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.hero.species, 'goldfish'); assert.equal(r.data.coins, 4500, '更換花 500 金幣');
  assert.equal(r.data.hero.level, 1); assert.equal(r.data.hero.train.atk, 1, '等級與訓練保留');
  r = await g.call('POST', '/api/hero/pick', { fishId: 'h1c' });
  assert.equal(r.status, 429); assert.equal(r.data.error, 'change_cooldown');
  // 英雄魚離開魚缸（賣掉）→ 標記失效，可免費重選（不受冷卻限制）
  const row = srv.ctx.db.prepare('SELECT * FROM saves WHERE player_id=?').get(g.id), sv = JSON.parse(row.data);
  sv.fish = sv.fish.filter((f) => f.id !== 'h1b'); srv.ctx.players.writeSaveRow(g.id, sv, row.rev + 1, Date.now(), false);
  r = await g.call('GET', '/api/hero/me');
  assert.equal(r.data.hero.fishMissing, true); assert.equal(r.data.hero.change.free, true);
  assert.equal((await g.call('POST', '/api/hero/train', { type: 'hp' })).data.error, 'hero_missing');
  r = await g.call('POST', '/api/hero/pick', { fishId: 'h1c' });
  assert.equal(r.status, 200); assert.equal(r.data.coins, 4500, '魚不在了 → 免費重選'); assert.equal(r.data.hero.active, true);
});

test('購買驗證：金幣／寶石裝備、等級限制、冪等、技能裝備與升級', { timeout: 120000 }, async (t) => {
  const srv = await startHeroServer();
  t.after(() => srv.stop());
  const a = await mk(srv, 2);
  await a.call('POST', '/api/hero/pick', { fishId: 'h2a' });
  let r = await a.call('POST', '/api/hero/gear/buy', { itemId: 'w_tooth', idempotencyKey: 'k1' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.coins, 4700); assert.equal(r.data.hero.gear.equip.weapon, 'w_tooth', '自動裝上');
  r = await a.call('POST', '/api/hero/gear/buy', { itemId: 'w_tooth', idempotencyKey: 'k1' });
  assert.equal(r.status, 200); assert.equal(srv.coins(a.id), 4700, '同一冪等鍵不重複扣款');
  assert.equal((await a.call('POST', '/api/hero/gear/buy', { itemId: 'w_tooth', idempotencyKey: 'k2' })).data.error, 'already_owned');
  assert.equal((await a.call('POST', '/api/hero/gear/buy', { itemId: 'w_steel' })).data.error, 'level_too_low');
  assert.equal((await a.call('POST', '/api/hero/gear/buy', { itemId: 'w_nonexist' })).status, 404);
  assert.equal((await a.call('POST', '/api/hero/gear/buy', { itemId: '__proto__' })).status, 404);
  // 寶石裝備：伺服器寶石帳本扣款，建立訂單
  srv.ctx.db.prepare('UPDATE heroes SET level=12 WHERE player_id=?').run(a.id);
  r = await a.call('POST', '/api/hero/gear/buy', { itemId: 'c_aurora', idempotencyKey: 'g1' });
  assert.equal(r.status, 402); assert.equal(r.data.error, 'insufficient_gems');
  srv.ctx.commerce.ledger(a.id, 100, 'admin_grant', 'test');
  r = await a.call('POST', '/api/hero/gear/buy', { itemId: 'c_aurora', idempotencyKey: 'g1' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.gems, 20); assert.equal(r.data.coins, 4700, '寶石商品不扣金幣');
  await a.call('POST', '/api/hero/gear/buy', { itemId: 'c_aurora', idempotencyKey: 'g1' });
  assert.equal(srv.ctx.commerce.balance(a.id), 20, '冪等：寶石只扣一次');
  const led = srv.ctx.db.prepare("SELECT * FROM gem_ledger WHERE player_id=? AND reason='spend'").all(a.id);
  assert.equal(led.length, 1); assert.equal(led[0].delta, -80);
  assert.equal(srv.ctx.db.prepare("SELECT COUNT(*) n FROM orders WHERE player_id=? AND sku='hero:gear:c_aurora' AND status='paid'").get(a.id).n, 1);
  // 裝備欄位
  assert.equal((await a.call('POST', '/api/hero/gear/equip', { slot: 'armor', itemId: 'w_tooth' })).status, 400);
  assert.equal((await a.call('POST', '/api/hero/gear/equip', { slot: 'armor', itemId: 'a_titan' })).data.error, 'not_owned');
  r = await a.call('POST', '/api/hero/gear/equip', { slot: 'weapon', itemId: null });
  assert.equal(r.data.hero.gear.equip.weapon, undefined);
  // 技能：只能裝已解鎖、不可超過欄位數、不可重複
  r = await a.call('GET', '/api/hero/me');
  const all = r.data.hero.skillsAll, un = all.filter((s) => s.unlocked).map((s) => s.id);
  assert.equal(r.data.hero.slotCount, 3);
  assert.equal((await a.call('POST', '/api/hero/skills/equip', { slots: [un[0], un[0]] })).data.error, 'duplicate_skill');
  assert.equal((await a.call('POST', '/api/hero/skills/equip', { slots: un.concat(['bite']) })).status, 400);
  r = await a.call('POST', '/api/hero/skills/equip', { slots: [un[1], un[0]] });
  assert.equal(r.status, 200); assert.deepEqual(r.data.hero.slots.slice(0, 2), [un[1], un[0]]);
  srv.ctx.db.prepare('UPDATE heroes SET level=1 WHERE player_id=?').run(a.id);
  assert.equal((await a.call('POST', '/api/hero/skills/equip', { slots: [all[3].id] })).data.error, 'skill_locked');
  // 技能升級：金幣、等級限制
  srv.ctx.db.prepare('UPDATE heroes SET level=4 WHERE player_id=?').run(a.id);
  r = await a.call('POST', '/api/hero/skills/upgrade', { skillId: un[0], idempotencyKey: 'up1' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.coins, 4500);
  assert.equal(r.data.hero.skillsAll.find((s) => s.id === un[0]).rank, 2);
  assert.equal((await a.call('POST', '/api/hero/skills/upgrade', { skillId: un[0] })).data.error, 'level_too_low');
});

test('PvP：伺服器名單＋伺服器模擬、積分、戰報重播一致、防刷（同 IP／同對手／次數）、禁賽、排行榜', { timeout: 180000 }, async (t) => {
  const srv = await startHeroServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await heroCfgPatch(admin, (c) => { c.pvp.refreshCooldownSec = 0; });
  const A = await mk(srv, 11), B = await mk(srv, 12, { sp: 'goldfish' }), C = await mk(srv, 13, { sp: 'redpiranha' }), D = await mk(srv, 14, { ip: 11 });
  for (const [p, f] of [[A, 'h11a'], [B, 'h12a'], [C, 'h13a'], [D, 'h14a']]) assert.equal((await p.call('POST', '/api/hero/pick', { fishId: f })).status, 200);
  await B.call('GET', '/api/hero/opponents'); await C.call('GET', '/api/hero/opponents'); await D.call('GET', '/api/hero/opponents'); // 記錄 IP

  let r = await A.call('GET', '/api/hero/opponents');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const keys = r.data.opponents.map((o) => o.key);
  assert.equal(r.data.opponents.length, 5);
  assert.ok(keys.includes('p:' + B.id) && keys.includes('p:' + C.id));
  assert.ok(!keys.includes('p:' + A.id), '不會配到自己');
  assert.ok(!keys.includes('p:' + D.id), '同 IP（疑似分身）不會出現在名單');
  assert.ok(r.data.opponents.some((o) => o.npc), '人數不足時補練習對手');
  const ob = r.data.opponents.find((o) => o.key === 'p:' + B.id);
  assert.ok(ob.hero.stats.hp > 0 && ob.gain > 0 && ob.loss < 0);

  // 只能挑戰名單上的對手
  r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + D.id });
  assert.equal(r.status, 409); assert.equal(r.data.error, 'offer_expired');
  assert.equal((await A.call('POST', '/api/hero/challenge', { opponent: 'p:1 OR 1=1' })).status, 400);
  // 客戶端不能送結果：額外欄位被忽略，結果以伺服器模擬為準
  const before = { a: srv.hero.row(A.id).rating, b: srv.hero.row(B.id).rating };
  r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id, winner: 0, result: { win: true, delta: 500 }, events: [] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const bt = r.data.battle, res = r.data.result;
  assert.ok(bt.events.length > 3 && bt.a.stats && bt.d.stats);
  assert.equal(res.win, bt.winner === 0);
  assert.ok(Math.abs(res.delta) < 100);
  assert.equal(srv.hero.row(A.id).rating, before.a + res.delta);
  assert.equal(srv.hero.row(B.id).rating, before.b - Math.round(res.delta * 0.5), '防守方以 50% 變動');
  assert.equal(r.data.me.hero.tickets, 7);
  // 重播：用存下的快照＋種子重新模擬 → 完全一致
  assert.equal(srv.hero.verifyBattle(bt.id).match, true);
  r = await A.call('GET', '/api/hero/battles/' + bt.id);
  assert.equal(r.status, 200); assert.equal(JSON.stringify(r.data.battle.events), JSON.stringify(bt.events));
  assert.equal((await C.call('GET', '/api/hero/battles/' + bt.id)).status, 404, '非參與者看不到戰報');
  assert.equal((await B.call('GET', '/api/hero/battles')).data.battles[0].mine, 'defender');
  // 用過的名單項目不能再打（必須重新整理）
  assert.equal((await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id })).data.error, 'offer_expired');

  // 同一對手每日上限（3）：伺服器端也擋
  const offer = () => srv.ctx.db.prepare('INSERT OR REPLACE INTO hero_offers (player_id, opponent_key, data, created_at) VALUES (?,?,NULL,?)').run(A.id, 'p:' + B.id, Date.now());
  offer(); r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id }); assert.equal(r.status, 200);
  if (r.data.result.win && r.data.battle.flags.includes('repeat_opponent')) assert.ok(Math.abs(r.data.result.delta) <= 16);
  offer(); assert.equal((await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id })).status, 200);
  offer(); r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id });
  assert.equal(r.status, 429); assert.equal(r.data.error, 'same_opponent_limit');
  r = await A.call('GET', '/api/hero/opponents?refresh=1');
  assert.ok(!r.data.opponents.some((o) => o.key === 'p:' + B.id), '今天打滿的對手不再出現');

  // 同 IP 強行對戰（例如名單之後才換 IP）：不計分＋標記
  srv.ctx.db.prepare('INSERT OR REPLACE INTO hero_offers (player_id, opponent_key, data, created_at) VALUES (?,?,NULL,?)').run(A.id, 'p:' + D.id, Date.now());
  r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + D.id });
  assert.equal(r.status, 200); assert.equal(r.data.result.delta, 0); assert.ok(r.data.battle.flags.includes('same_ip'));

  // 練習對手：不影響積分，只給少量經驗
  r = await A.call('GET', '/api/hero/opponents?refresh=1');
  const npc = r.data.opponents.find((o) => o.npc);
  const ra = srv.hero.row(A.id).rating;
  r = await A.call('POST', '/api/hero/challenge', { opponent: npc.key });
  assert.equal(r.status, 200); assert.equal(r.data.result.delta, 0); assert.equal(srv.hero.row(A.id).rating, ra);

  // 挑戰次數用完 → 429；隨時間回復
  srv.ctx.db.prepare('UPDATE heroes SET tickets=0, tickets_at=? WHERE player_id=?').run(Date.now(), A.id);
  r = await A.call('GET', '/api/hero/opponents?refresh=1');
  r = await A.call('POST', '/api/hero/challenge', { opponent: r.data.opponents[0].key });
  assert.equal(r.status, 429); assert.equal(r.data.error, 'no_tickets'); assert.ok(r.data.nextTicketAt > Date.now());
  srv.ctx.db.prepare('UPDATE heroes SET tickets=0, tickets_at=? WHERE player_id=?').run(Date.now() - 2.5 * 90 * 60000, A.id);
  assert.equal((await A.call('GET', '/api/hero/me')).data.hero.tickets, 2);

  // 後台禁賽：被禁者不能打、不出現在名單與排行榜
  r = await admin.post('/hero/heroes/' + C.id + '/pvp-ban', { reason: '洗分' });
  assert.equal(r.status, 200);
  r = await C.call('GET', '/api/hero/opponents');
  assert.equal(r.status, 403); assert.equal(r.data.error, 'pvp_banned');
  r = await B.call('GET', '/api/hero/opponents?refresh=1');
  assert.ok(!r.data.opponents.some((o) => o.key === 'p:' + C.id));
  // 排行榜：公開；帶 token 時有自己的名次
  r = await srv.req('GET', '/api/hero/leaderboard');
  assert.equal(r.status, 200); assert.ok(r.data.leaderboard.length >= 2); assert.equal(r.data.me, null);
  assert.ok(!r.data.leaderboard.some((x) => x.playerId === C.id));
  const sorted = r.data.leaderboard.map((x) => x.rating); assert.deepEqual(sorted, [...sorted].sort((x, y) => y - x));
  r = await A.call('GET', '/api/hero/leaderboard');
  assert.ok(r.data.me && r.data.me.position >= 1);
  // 稽核紀錄
  assert.ok(srv.ctx.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='hero.pvp_ban'").get().n === 1);
  assert.equal((await admin.post('/hero/heroes/' + C.id + '/pvp-unban')).status, 200);
});

test('限流：挑戰／名單／一般操作每分鐘上限', { timeout: 120000 }, async (t) => {
  const srv = await startHeroServer({ HERO_RATE_MULT: '1' });
  t.after(() => srv.stop());
  const A = await mk(srv, 21);
  await A.call('POST', '/api/hero/pick', { fishId: 'h21a' });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await A.call('POST', '/api/hero/challenge', { opponent: 'npc:' + i })).status);
  assert.equal(codes.slice(0, 6).filter((c) => c === 429).length, 0, JSON.stringify(codes));
  assert.equal(codes[6], 429, '每分鐘最多 6 次挑戰請求');
  const r = await A.call('POST', '/api/hero/challenge', { opponent: 'npc:1' });
  assert.equal(r.data.error, 'rate_limited'); assert.ok(Number(r.headers.get('retry-after')) > 0);
  let last = 0;
  for (let i = 0; i < 41; i++) last = (await A.call('GET', '/api/hero/me')).status;
  assert.equal(last, 429, '一般操作每分鐘 40 次');
});

test('後台：設定驗證／版本、戰報驗證、可疑配對、賽季結算寄獎勵到信箱', { timeout: 180000 }, async (t) => {
  const srv = await startHeroServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  // 需後台登入
  assert.equal((await srv.req('GET', '/admin/api/hero/config')).status, 401);
  let r = await admin.get('/hero/config');
  assert.equal(r.status, 200); assert.ok(r.data.config.skills.bite);
  const bad = JSON.parse(JSON.stringify(r.data.config)); bad.skills.bite.cd = -1; bad.families.piranha.signature = 'nope'; bad.gear.w_tooth.gems = 5;
  r = await admin.post('/hero/config/validate', { config: bad });
  assert.ok(r.data.errors.length >= 3, JSON.stringify(r.data.errors));
  r = await admin.put('/hero/config', { config: bad, note: 'bad' });
  assert.equal(r.status, 422);
  assert.equal((await admin.put('/hero/config', { config: (await admin.get('/hero/config')).data.config, baseVersion: 999 })).status, 409);
  await heroCfgPatch(admin, (c) => { c.season.minBattles = 1; c.pvp.refreshCooldownSec = 0; });
  assert.equal((await admin.get('/hero/config/versions')).data.versions.length, 2);
  // 公開設定立即生效
  assert.equal((await srv.req('GET', '/api/hero/config')).data.version, 2);

  const A = await mk(srv, 31), B = await mk(srv, 32, { sp: 'goldfish' });
  await A.call('POST', '/api/hero/pick', { fishId: 'h31a' }); await B.call('POST', '/api/hero/pick', { fishId: 'h32a' });
  await B.call('GET', '/api/hero/opponents');
  r = await A.call('GET', '/api/hero/opponents');
  r = await A.call('POST', '/api/hero/challenge', { opponent: 'p:' + B.id });
  assert.equal(r.status, 200);
  const bid = r.data.battle.id;
  r = await admin.get('/hero/battles/' + bid);
  assert.equal(r.status, 200); assert.equal(r.data.verify.match, true); assert.ok(r.data.battle.events.length);
  assert.ok((await admin.get('/hero/battles?pvp=1')).data.battles.length === 1);
  assert.equal((await admin.get('/hero/heroes?q=' + A.id)).data.heroes[0].playerId, A.id);
  assert.equal((await admin.get('/hero/suspicious')).status, 200);
  assert.ok((await admin.get('/hero/overview')).data.heroes === 2);
  r = await admin.post('/hero/heroes/' + A.id + '/rating', { rating: 1900, note: '補償' });
  assert.equal(r.status, 200);
  // 賽季結算：需確認字串；依段位寄獎勵（信箱）、分數軟重置、開新賽季
  assert.equal((await admin.post('/hero/seasons/close', {})).status, 400);
  r = await admin.post('/hero/seasons/close', { confirm: 'CLOSE', nextName: '第 2 季' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.participants, 1, '只有進攻過的 A 有賽季場次');
  const mail = await A.sdk.getMailbox();
  const m = mail.find((x) => /英雄魚/.test(x.title));
  assert.ok(m, '賽季獎勵寄到信箱'); assert.ok(m.gems >= 50, '傳奇段位＋第一名獎勵');
  assert.equal(srv.hero.row(A.id).rating, 1000 + Math.round((1900 - 1000) * 0.5));
  assert.equal((await srv.req('GET', '/api/hero/leaderboard')).data.season.name, '第 2 季');
  assert.ok(srv.ctx.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'hero.%'").get().n >= 3);
});
