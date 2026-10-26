'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  progressForSeries,
  activeSets,
  combineBonus,
  validateDecoSeries,
} = require('../src/deco-series');

const cfg = () => JSON.parse(JSON.stringify(require('../seed/default-config.json')));

function saveWithTank(keys) {
  return {
    up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: keys },
  };
}

test('decoSeries：集滿魚缸才啟動套裝', () => {
  const c = cfg();
  const keys = c.decoSeries.sunken.keys;
  assert.equal(progressForSeries(c, saveWithTank(keys.slice(0, 9)), 'sunken').complete, false);
  assert.equal(progressForSeries(c, saveWithTank(keys), 'sunken').complete, true);
  assert.deepEqual(activeSets(c, saveWithTank(keys.slice(0, 9))), []);
  assert.deepEqual(activeSets(c, saveWithTank(keys)), ['sunken']);
});

test('decoSeries：僅魚缸內擺放計入進度', () => {
  const c = cfg();
  const keys = c.decoSeries.pirate.keys;
  const save = saveWithTank(keys.slice(0, 9));
  assert.equal(progressForSeries(c, save, 'pirate').placed, 9);
  assert.equal(progressForSeries(c, save, 'pirate').complete, false);
});

test('decoSeries：combineBonus 倍率', () => {
  const c = cfg();
  const save = {
    up: {
      cap: 0,
      food: 0,
      feeder: 0,
      filter: 0,
      deco: [...c.decoSeries.sunken.keys, ...c.decoSeries.candy.keys],
    },
  };
  const b = combineBonus(c, save);
  assert.equal(b.finHealMult, 1.25);
  assert.equal(b.growthMult, 1.1);
  assert.equal(b.mutationRelMult, 1);
});

test('decoSeries：validateDecoSeries 通過內建設定', () => {
  const c = cfg();
  assert.deepEqual(validateDecoSeries(c, saveWithTank([])), []);
});
