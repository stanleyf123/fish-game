'use strict';
// 魚缸 Lv9–12（海洋館系列）：設定驗證、容量、換水價、全缸藥價、防作弊（Lv12 約 500 格的魚）
const test = require('node:test');
const assert = require('node:assert');
const { validateConfig } = require('../src/config-validate');
const { checkSave, capacityOf, usedSpaceOf, validateStructure } = require('../src/anticheat');
const { costOf } = require('../src/watercost');
const { medPrice } = require('../src/medicine');
const { sampleSave } = require('./helpers');
const LV = [{ cost: 150000, add: 60, name: '小型海洋館' }, { cost: 400000, add: 80, name: '中型海洋館' }, { cost: 1000000, add: 100, name: '大型海洋館' }, { cost: 2500000, add: 140, name: '水族館主展缸' }];
const cfgWith = () => { const c = JSON.parse(JSON.stringify(require('../seed/default-config.json'))); c.capacity.upgrades = c.capacity.upgrades.slice(0, 8).concat(LV.map((u) => ({ ...u }))); return c; };

test('魚缸 Lv9–12：設定可通過驗證（單級 +140），容量 180/260/360/500', () => {
  const c = cfgWith();
  assert.deepEqual(validateConfig(c), []);
  assert.equal(c.capacity.upgrades.length, 12);
  assert.deepEqual([8, 9, 10, 11, 12].map((l) => capacityOf(c, l)), [120, 180, 260, 360, 500]);
  const bad = cfgWith(); bad.capacity.upgrades[11].add = 1001; assert.ok(validateConfig(bad).some((e) => e.includes('add')));
  const nm = cfgWith(); nm.capacity.upgrades[11].name = 'x'.repeat(21); assert.ok(validateConfig(nm).some((e) => e.includes('name')));
});

test('魚缸 Lv12：換水／清潔價格與全缸特效藥價', () => {
  const c = cfgWith(), cap = capacityOf(c, 12);
  // 預設公式 round5(base + perSpace × 容量)
  assert.equal(costOf({ water: { costs: { small: { base: 10, perSpace: 0.8 }, big: { base: 20, perSpace: 1.8 }, clean: { base: 5, perSpace: 0.5 }, round: 5, min: 5 } } }, 'small', cap), 410);
  assert.equal(costOf({}, 'big', cap), 920);
  assert.equal(costOf({}, 'clean', cap), 255);
  const tank = { priceByCap: [[50, 60], [120, 80], [100000, 120]] };
  assert.equal(medPrice(tank, capacityOf(c, 8)), 80);
  assert.equal(medPrice(tank, capacityOf(c, 9)), 120);
  assert.equal(medPrice(tank, cap), 120);
});

test('魚缸 Lv8→9 扣 150000；Lv12 約 500 格的魚可上傳，超過容量才可疑', () => {
  const c = cfgWith(); c.antiCheat.minSaveIntervalSec = 0; const now = Date.now();
  const mk = (cap, coins, fish) => sampleSave({ coins, up: { cap, food: 0, feeder: 0, filter: 0, deco: [] }, capV: 2, fish, last: now });
  const base = sampleSave().fish;
  const prev = mk(8, 160000, base), up9 = mk(9, 10000, base);
  assert.deepEqual(checkSave(c, prev, now - 60000, up9, now).suspicious, []);
  const cheat = mk(9, 160000, base);
  assert.ok(checkSave(c, prev, now - 60000, cheat, now).suspicious.some((x) => x.includes('金幣')));
  // Lv12：500 格（goldfish tankSpace 1）
  const sp = c.species.goldfish.tankSpace > 0 ? c.species.goldfish.tankSpace : 1, n = Math.floor(500 / sp);
  const fish = Array.from({ length: n }, (_, i) => ({ ...base[0], id: 'g' + i, seed: i }));
  const p12 = mk(12, 1000, fish.slice(0, n - 10)), n12 = mk(12, 1000, fish);
  assert.deepEqual(validateStructure(c, n12), []);
  assert.ok(usedSpaceOf(c, n12.fish) <= 500);
  assert.deepEqual(checkSave(c, p12, now - 60000, n12, now).suspicious, []);
  assert.ok(JSON.stringify(n12).length < 256 * 1024);
  const big = Object.keys(c.species).find((k) => c.species[k].tankSpace >= 3 && !(c.species[k].priceGems > 0) && !c.species[k].premium);
  const over = mk(12, 1000, fish.map((f, i) => (i < 10 ? { ...f, sp: big } : f)));
  assert.ok(usedSpaceOf(c, over.fish) > 500);
  assert.ok(checkSave(c, n12, now - 60000, over, now).suspicious.some((x) => x.includes('容量')));
  assert.equal(validateStructure(c, mk(13, 0, base)).some((e) => e.includes('up.cap')), true);
});
