'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkSave, validateStructure } = require('../src/anticheat');
const { DecoInventory } = require('../src/deco-inventory');
const {
  addLegacyForOwned,
  normList,
  coinBonusSum,
  mutationBonusSum,
  checkLegacyUnchanged,
  validateLegacyDeco,
  pruneLegacyDeco,
} = require('../src/legacy-deco');
const { startServer, adminClient, relaxAntiCheat, sampleSave, sleep } = require('./helpers');
const cfg = () => JSON.parse(JSON.stringify(require('../seed/default-config.json')));

test('legacyDeco：加成只算缸內且已 grandfather 的造景', () => {
  const c = cfg();
  const save = sampleSave({
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral', 'wreck'] },
    legacyDeco: ['coral', 'wreck'],
  });
  assert.equal(coinBonusSum(c, save), 0.08 + 0.12);
  save.up.deco = ['coral'];
  assert.equal(coinBonusSum(c, save), 0.08);
  save.legacyDeco = ['wreck'];
  assert.equal(coinBonusSum(c, save), 0);
  save.up.deco = ['crystal'];
  save.legacyDeco = ['crystal'];
  assert.equal(mutationBonusSum(c, save), 0.08);
});

test('legacyDeco：客戶端不能注入 legacyDeco', () => {
  const c = cfg();
  c.antiCheat.minSaveIntervalSec = 0;
  const now = Date.now();
  const prev = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] }, last: now });
  const next = sampleSave({
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'] },
    legacyDeco: ['coral'],
    last: now,
  });
  const r = checkSave(c, prev, now - 60000, next, now);
  assert.ok(r.structural.some((e) => e.includes('legacyDeco')));
});

test('legacyDeco：出售後失去 grandfather（deco-inventory）', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk();
  await sdk.ensureSession();
  const deco = Object.keys(cfg().decorations).find((k) => cfg().decorations[k].coinBonus > 0);
  await sdk.ensureSession();
  const me = await srv.req('GET', '/api/me', undefined, { Authorization: 'Bearer ' + sdk.token() });
  const pid = me.data.player.id;
  const gs = await sdk.loadSave();
  const s0 = sampleSave({ coins: 5000, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [deco] }, legacyDeco: [deco] });
  srv.ctx.players.writeSaveRow(pid, s0, (gs.rev || 0) + 1, Date.now(), false);
  const key = 'di_test_' + Date.now();
  const rev = (await sdk.loadSave()).rev;
  const r = await srv.req('POST', '/api/deco-inventory', { action: 'sell', id: deco, rev, idempotencyKey: key }, { Authorization: 'Bearer ' + sdk.token() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = await sdk.loadSave();
  assert.ok(!back.save.legacyDeco?.includes(deco));
  assert.ok(!back.save.up.deco.includes(deco));
});

test('legacyDeco：新購買不進 legacyDeco', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk();
  await sdk.ensureSession();
  const deco = Object.keys(cfg().decorations).find((k) => cfg().decorations[k].cost > 0 && !cfg().decorations[k].priceGems);
  const me = await srv.req('GET', '/api/me', undefined, { Authorization: 'Bearer ' + sdk.token() });
  const pid = me.data.player.id;
  const gs = await sdk.loadSave();
  const s0 = sampleSave({ coins: 99999, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] } });
  srv.ctx.players.writeSaveRow(pid, s0, gs.rev + 1, Date.now(), false);
  const key = 'di_buy_' + Date.now();
  const rev = (await sdk.loadSave()).rev;
  const r = await srv.req('POST', '/api/deco-inventory', { action: 'buy', id: deco, rev, idempotencyKey: key }, { Authorization: 'Bearer ' + sdk.token() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = await sdk.loadSave();
  assert.ok(back.save.up.deco.includes(deco));
  assert.ok(!back.save.legacyDeco?.includes(deco));
});

test('legacyDeco：過期或無加成鍵不觸發 structural 錯誤', () => {
  const c = cfg();
  const save = sampleSave({ legacyDeco: ['coral', 'removed_fake', 'crystal'] });
  assert.deepEqual(validateLegacyDeco(c, save), []);
});

test('legacyDeco：prune 移除未持有的 grandfather 鍵', () => {
  const c = cfg();
  const save = sampleSave({
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'] },
    legacyDeco: ['coral', 'wreck'],
  });
  const n = pruneLegacyDeco(c, save, []);
  assert.equal(n, 1);
  assert.deepEqual(normList(save.legacyDeco), ['coral']);
});

test('migrate-legacy-deco：idempotent add', () => {
  const c = cfg();
  const save = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'] } });
  addLegacyForOwned(c, save, ['coral']);
  assert.deepEqual(normList(save.legacyDeco), ['coral']);
  addLegacyForOwned(c, save, ['coral']);
  assert.deepEqual(normList(save.legacyDeco), ['coral']);
  assert.ok(checkLegacyUnchanged(save, save));
});
