'use strict';
// MOVDECO：造景位置 up.decoPos {key: x 0..1} 是純外觀欄位；伺服器（防作弊結構檢查＋雲端存檔）必須照原樣接受並存回，舊存檔（沒有這欄）不受影響
const test = require('node:test');
const assert = require('node:assert');
const { checkSave, validateStructure } = require('../src/anticheat');
const { startServer, adminClient, relaxAntiCheat, sampleSave, sleep } = require('./helpers');
const cfg = () => JSON.parse(JSON.stringify(require('../seed/default-config.json')));
const errsOf = (r) => (Array.isArray(r) ? r : (r && (r.errors || r.errs)) || []);

test('MOVDECO：validateStructure／checkSave 接受 up.decoPos，也接受沒有 decoPos 的舊存檔', () => {
  const c = cfg(); c.antiCheat.minSaveIntervalSec = 0; const now = Date.now(); const deco = Object.keys(c.decorations).slice(0, 2);
  const old = sampleSave({ coins: 100, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco }, last: now });
  const moved = sampleSave({ coins: 100, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco, decoPos: { [deco[0]]: 0.73, [deco[1]]: 0.1 } }, last: now });
  assert.deepEqual(errsOf(validateStructure(c, old)), []);
  assert.deepEqual(errsOf(validateStructure(c, moved)), []);
  const r = checkSave(c, old, now - 60000, moved, now);
  assert.deepEqual(r.suspicious, [], '只移動造景不該被當成可疑');
});

test('MOVDECO：雲端存檔上傳 decoPos 後讀回不變', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const admin = await adminClient(srv); await relaxAntiCheat(admin);
  const sdk = srv.sdk(); await sdk.ensureSession();
  const deco = Object.keys(cfg().decorations).slice(0, 1);
  const s1 = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] } });
  assert.equal((await sdk.writeSave(s1)).ok, true);
  await sleep(2100);
  const s2 = sampleSave({ up: { cap: 0, food: 0, feeder: 0, filter: 0, deco, decoPos: { [deco[0]]: 0.6017 } } });
  const w = await sdk.writeSave(s2); assert.equal(w.ok, true, JSON.stringify(w).slice(0, 300));
  const back = await sdk.loadSave();
  assert.deepEqual(back.save.up.decoPos, { [deco[0]]: 0.6017 });
  assert.deepEqual(back.save.up.deco, deco);
});

test('MOVDECO：好友魚缸唯讀檢視 sceneOf 帶出造景位置（清洗過），沒有就不輸出', () => {
  const { sceneOf } = require('../src/social');
  const c = cfg(); const deco = Object.keys(c.decorations).slice(0, 3);
  const base = { up: { cap: 2, deco }, fish: [], plants: [] };
  assert.equal(sceneOf(c, base, 10).up.decoPos, undefined, '舊存檔沒有 decoPos → 不輸出');
  const sc = sceneOf(c, { ...base, up: { cap: 2, deco, decoPos: { [deco[0]]: 0.123456, [deco[1]]: 7, [deco[2]]: 'x', notOwned: 0.5 } } }, 10);
  assert.deepEqual(sc.up.decoPos, { [deco[0]]: 0.1235, [deco[1]]: 1 });
  assert.deepEqual(sc.up.deco, deco);
  assert.equal(sceneOf(c, { ...base, up: { cap: 2, deco, decoPos: [0.5] } }, 10).up.decoPos, undefined);
});
