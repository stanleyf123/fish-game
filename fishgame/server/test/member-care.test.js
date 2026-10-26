'use strict';
// 會員系統（綁定／登入／登出）、照護系統存檔與防作弊、繪圖程式與遊戲同步
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, adminClient, relaxAntiCheat, sampleSave, sleep } = require('./helpers');
const { build } = require('../scripts/build-render');
const { maxCoinRate, checkSave } = require('../src/anticheat');
const cfgSeed = require('../seed/default-config.json');

test('fishrender.js 與遊戲 drawFish/drawShrimp 程式碼同步（含蝦）', () => {
  const html = fs.readFileSync(path.join(__dirname, '../seed/game-index.snapshot.html'), 'utf8');
  const code = build(html, 'game-index.snapshot.html');
  assert.equal(fs.readFileSync(path.join(__dirname, '../public/fishrender.js'), 'utf8'), code, '請執行 npm run build:render');
  const R = require('../public/fishrender.js');
  const amano = R.resolve(cfgSeed.species.amano, 'amano');
  assert.equal(amano.body, 'shrimp'); assert.equal(amano.role, 'shrimp'); assert.equal(amano.ht, 9);
  // 用假的 canvas context 畫一次，確認蝦／魚都不會丟例外
  const calls = []; const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (o, k, v) => { o[k] = v; return true; } });
  R.drawFish(ctx, amano, { hue: 30, phase: 1, seed: 3 }, 1.5, {});
  R.drawFish(ctx, R.resolve(cfgSeed.species.koi), { hue: 10, phase: 1, seed: 3 }, 1.5, { sil: true });
  assert.ok(calls.includes('ellipse'));
});

test('防作弊：新的經濟與照護系統', () => {
  const r0 = maxCoinRate(cfgSeed, 0), r5 = maxCoinRate(cfgSeed, 5);
  assert.ok(r5 > r0 && r5 < 20, `產速上限合理 ${r5}`);
  assert.ok(maxCoinRate(cfgSeed, 0, .1) > r0, '月卡加成提高上限');
  const now = Date.now();
  const prev = sampleSave({ coins: 1000 });
  // 14 天沒上線後回來：照護補算＋離線收益，金幣增加在上限內
  const back = sampleSave({ coins: 1000 + Math.floor(r0 * 8 * 3600 * cfgSeed.offline.rate) });
  assert.deepEqual(checkSave(cfgSeed, prev, now - 14 * 86400000, back, now).suspicious, []);
  // 過濾器等級倒退、硝化菌罐增加要扣金幣
  const down = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] } });
  const pf = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 2, deco: [] } });
  assert.match(checkSave(cfgSeed, pf, now - 60000, down, now).suspicious.join(), /filter/);
  const bac = sampleSave({ coins: 1000, items: { bacteria: 30 } });
  const r = checkSave(cfgSeed, sampleSave({ coins: 1000, items: { bacteria: 0 } }), now - 10000, bac, now);
  assert.ok(r.info.spent >= 30 * cfgSeed.cycling.bacteria.cost);
  // 結構：健康值、水質範圍
  assert.ok(checkSave(cfgSeed, null, 0, sampleSave({ water: { dirt: 500 } }), now).structural.length);
  assert.ok(checkSave(cfgSeed, null, 0, sampleSave({ fish: [{ id: 'x', sp: 'amano', health: 120 }] }), now).structural.length);
});

test('會員系統：註冊（含 Email）、登出換裝置代碼、其他裝置取回完整魚缸', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);

  const dev1 = srv.sdk();
  const guest = await dev1.ensureSession();
  assert.equal(guest.bound, false);
  const tank = sampleSave({ coins: 300 });
  tank.fish.push({ id: 'shr1', sp: 'amano', name: '蝦蝦', hue: 30, size: 1, growth: 10, full: 80, health: 90, cd: 0, coinT: 5, seed: 9, px: .4, py: .9, dir: 1 });
  tank.water.dirt = 33; tank.up.filter = 1; tank.up.deco = ['coral']; tank.found.amano = 1;
  assert.equal((await dev1.writeSave(tank)).ok, true);

  await assert.rejects(dev1.register('owner@example.com', '12345678'), (e) => e.data.error === 'weak_password');
  await assert.rejects(dev1.register('owner@example.com', 'OWNER'), (e) => e.data.error === 'invalid_password');
  await assert.rejects(dev1.register('owner@example.com', 'owner@example.com'), (e) => e.data.error === 'weak_password');
  await assert.rejects(dev1.register('not-an-email', 'goodpass99'), (e) => e.data.error === 'invalid_email');
  const me = await dev1.register('Owner@Example.com', 'goodpass99');
  assert.equal(me.bound, true); assert.equal(me.id, guest.id, '綁定後仍是同一個玩家（訪客進度併入會員）');
  assert.equal(me.email, 'owner@example.com', '會員帳號＝信箱（本人可看到完整信箱）');
  assert.equal(me.emailMasked, 'ow***@example.com');
  const det = await admin.get('/players/' + me.id);
  assert.equal(det.data.player.email, 'owner@example.com');
  assert.ok(det.data.player.bound_at);
  assert.equal(det.data.player.hasDevice, false, '綁定後裝置代碼不再能登入會員帳號');
  const list = await admin.get('/players?filter=bound&q=OWNER@example');
  assert.ok(list.data.players.some((p) => p.id === me.id && p.email === 'owner@example.com'), '後台可用信箱搜尋');

  // 另一台裝置登入：完整魚缸（位置、水質、升級、裝飾、圖鑑、金幣）
  const dev2 = srv.sdk();
  await dev2.ensureSession();
  const p2 = await dev2.login('owner@example.com', 'goodpass99');
  assert.equal(p2.id, me.id);
  const cloud = (await dev2.loadSave()).save;
  assert.equal(cloud.coins, 300); assert.equal(cloud.water.dirt, 33); assert.equal(cloud.up.filter, 1);
  assert.deepEqual(cloud.up.deco, ['coral']); assert.equal(cloud.found.amano, 1);
  const shrimp = cloud.fish.find((f) => f.id === 'shr1'); assert.equal(shrimp.px, .4); assert.equal(shrimp.health, 90);

  // 登出：換新的裝置代碼 → 下次是全新訪客，不會自動登回會員
  await dev1.logout();
  const fresh = await dev1.ensureSession();
  assert.notEqual(fresh.id, me.id); assert.equal(fresh.bound, false);
  assert.equal((await dev1.loadSave()).save, null);
});

test('玩家重置進度：伺服器寫入開局存檔，之後的上傳以它為基準', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const s = srv.sdk(); await s.ensureSession();
  assert.equal((await s.writeSave(sampleSave({ coins: 5000, up: { cap: 3, food: 1, feeder: 1, filter: 1, deco: ['coral'] } }))).ok, true);
  const r = await s.resetSave();
  assert.equal(r.save.coins, cfgSeed.start.coins);
  assert.equal(r.save.fish.length, cfgSeed.start.fish.length);
  assert.equal(r.save.water.cycle, cfgSeed.cycling.startProgress);
  const ok = await s.writeSave(sampleSave({ coins: 80 }));
  assert.equal(ok.ok, true, '重置後上傳開局存檔（升級歸零）不會被判定為倒退');
  const cheat = await s.writeSave(sampleSave({ coins: 900000 }));
  assert.equal(cheat.rejected, true);
});

test('信箱發放的魚使用新的健康欄位，領取後存檔可正常再上傳', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const s = srv.sdk(); const p = await s.ensureSession();
  await s.writeSave(sampleSave());
  const cr = await admin.post('/rewards', { title: '送蝦', coins: 10, fish: [{ species: 'cherry', count: 2 }], target: 'player', playerIds: [p.id] });
  assert.equal(cr.status, 200, JSON.stringify(cr.data));
  const mail = await s.getMailbox();
  const got = await s.claimMail(mail[0].id);
  const added = got.save.fish.filter((f) => f.sp === 'cherry');
  assert.equal(added.length, 2); assert.equal(added[0].health, 100); assert.equal(added[0].sick, undefined);
  await sleep(10);
  const again = await s.writeSave(got.save);
  assert.equal(again.ok, true);
});
