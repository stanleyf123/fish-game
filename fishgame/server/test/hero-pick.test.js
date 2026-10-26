'use strict';
// 英雄魚選擇：候選清單＝魚缸裡現有的魚（含寶石魚、混種），寶石魚可選；第一次選完 24 小時內可免費換一次；魚不在了可免費重選
const test = require('node:test');
const assert = require('node:assert');
const { startHeroServer, fishOf } = require('./hero-helpers');

test('英雄魚候選清單＝魚缸裡的魚，寶石魚可以選、換魚規則清楚', { timeout: 60000 }, async (t) => {
  const srv = await startHeroServer();
  t.after(() => srv.stop());
  const p = await srv.player({ coins: 5000, fish: [fishOf('a1', 'goldfish', 200, '金金')] });
  // 直接寫入（模擬玩家用寶石買到的魚，與正式機玩家 #10 的魚缸組成相同）
  const tank = [fishOf('n1', 'neon', 213, '波波'), fishOf('g1', 'goldfish', 180, '金金'), fishOf('m1', 'p_moonray', 5, '豆豆'), fishOf('r1', 'p_goldarowana', 127, '阿金'), fishOf('s1', 'p_starbetta', 77, '星星'), fishOf('c1', 'cory', 4000, '鼠鼠')];
  const row = srv.ctx.db.prepare('SELECT * FROM saves WHERE player_id=?').get(p.id); const sv = JSON.parse(row.data); sv.fish = tank;
  srv.ctx.players.writeSaveRow(p.id, sv, row.rev + 1, Date.now(), false);

  const c = await p.call('GET', '/api/hero/candidates');
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.deepEqual(c.data.candidates.map((x) => x.fishId).sort(), tank.map((f) => f.id).sort(), '候選清單應該剛好是魚缸裡的魚');
  const moon = c.data.candidates.find((x) => x.fishId === 'm1');
  assert.ok(moon && moon.premium && moon.name === '豆豆' && moon.stage === 0 && moon.rarity === 2 && moon.power > 0, JSON.stringify(moon));
  assert.ok(c.data.candidates.slice(0, 3).every((x) => x.premium), '寶石魚排在前面：' + c.data.candidates.map((x) => x.species).join(','));

  // 先選霓虹燈（像玩家 #10），再改選寶石魚：24 小時內第一次更換免費、不受冷卻限制
  assert.equal((await p.call('POST', '/api/hero/pick', { fishId: 'n1' })).status, 200);
  const c2 = await p.call('GET', '/api/hero/candidates');
  assert.ok(c2.data.change.free && c2.data.change.reason === 'first_change', JSON.stringify(c2.data.change));
  const coins0 = srv.coins(p.id);
  const r = await p.call('POST', '/api/hero/pick', { fishId: 'm1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.hero.species, 'p_moonray'); assert.equal(r.data.hero.fishName, '豆豆');
  assert.equal(srv.coins(p.id), coins0, '第一次更換不扣金幣');
  assert.ok(r.data.hero.stats && r.data.hero.stats.hp > 0, '寶石魚的英雄能力計算正常');

  // 第二次更換：要冷卻＋金幣，錯誤訊息清楚
  const r3 = await p.call('POST', '/api/hero/pick', { fishId: 'r1' });
  assert.equal(r3.status, 429); assert.match(r3.data.message, /冷卻中.*小時.*🪙/);
  const me = await p.call('GET', '/api/hero/me');
  assert.ok(!me.data.hero.change.free && me.data.hero.change.readyAt > Date.now() && me.data.hero.change.coins > 0);

  // 英雄的魚被賣掉 → 提示重選、免費、沒有冷卻
  const row2 = srv.ctx.db.prepare('SELECT * FROM saves WHERE player_id=?').get(p.id); const sv2 = JSON.parse(row2.data); sv2.fish = sv2.fish.filter((f) => f.id !== 'm1');
  srv.ctx.players.writeSaveRow(p.id, sv2, row2.rev + 1, Date.now(), false);
  const me2 = await p.call('GET', '/api/hero/me');
  assert.ok(me2.data.hero.fishMissing && me2.data.hero.change.free, JSON.stringify(me2.data.hero.change));
  const r4 = await p.call('POST', '/api/hero/pick', { fishId: 'r1' });
  assert.equal(r4.status, 200, JSON.stringify(r4.data)); assert.equal(r4.data.hero.species, 'p_goldarowana');
  // 英雄成長跟著魚缸裡的魚
  const row3 = srv.ctx.db.prepare('SELECT * FROM saves WHERE player_id=?').get(p.id); const sv3 = JSON.parse(row3.data); sv3.fish.find((f) => f.id === 'r1').growth = 300;
  srv.ctx.players.writeSaveRow(p.id, sv3, row3.rev + 1, Date.now(), false);
  const me3 = await p.call('GET', '/api/hero/me');
  assert.equal(me3.data.hero.growth, 300); assert.equal(me3.data.hero.stage, 2);
});
