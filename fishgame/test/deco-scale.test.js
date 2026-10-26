'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeDecoS, clampScale, validateDecoS } = require('../src/deco-scale');
const { validateStructure } = require('../src/anticheat');
const { validateLegacyDeco, pruneLegacyDeco, normList } = require('../src/legacy-deco');
const { sampleSave, startServer, relaxAntiCheat, adminClient } = require('./helpers');
const cfg = () => JSON.parse(JSON.stringify(require('../seed/default-config.json')));

test('decoS：sanitize 夾在 0.5–2 並移除預設 1', () => {
  const save = sampleSave({
    up: {
      cap: 0,
      food: 0,
      feeder: 0,
      filter: 0,
      deco: ['coral', 'wreck'],
      decoS: { coral: 3, wreck: 1, crystal: 1.5 },
    },
  });
  sanitizeDecoS(save);
  assert.equal(save.up.decoS.coral, 2);
  assert.equal(save.up.decoS.wreck, undefined);
  assert.equal(save.up.decoS.crystal, undefined);
});

test('decoS：validateStructure 接受合法倍率', () => {
  const c = cfg();
  const save = sampleSave({
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'], decoS: { coral: 1.2 } },
  });
  assert.deepEqual(validateDecoS(c, save), []);
});

test('legacyDeco：validate 會修剪未持有的鍵而不報錯', () => {
  const c = cfg();
  const save = sampleSave({
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'] },
    legacyDeco: ['coral', 'wreck'],
  });
  assert.deepEqual(validateLegacyDeco(c, save), []);
  assert.deepEqual(normList(save.legacyDeco), ['coral']);
});

test('putSave：decoS 夾在 0.5–2', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  await relaxAntiCheat(await adminClient(srv));
  const sdk = srv.sdk();
  await sdk.ensureSession();
  const gs = await sdk.loadSave();
  const s0 = sampleSave({
    ...gs.save,
    up: { ...(gs.save?.up || {}), cap: 0, food: 0, feeder: 0, filter: 0, deco: ['coral'], decoS: { coral: 4 } },
    last: Date.now(),
  });
  const w = await sdk.writeSave(s0);
  assert.ok(!w.rejected, JSON.stringify(w));
  const back = await sdk.loadSave();
  assert.ok(back.save);
  assert.equal(back.save.up.decoS.coral, 2);
});
