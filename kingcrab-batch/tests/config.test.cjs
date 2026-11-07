'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers.cjs');

const live = h.LIVE_SNIPPET.species.o_king_crab;
const RULE_KEYS = ['rarity', 'price', 'coin', 'speed', 'bioload', 'hungerMultiplier', 'family', 'familyName', 'temperament', 'aggression',
  'sizeClass', 'adultSizeCm', 'tankSpace', 'minTankLevel', 'schooling', 'waterType', 'unlockLevel', 'longFins', 'role', 'temp', 'breedOnly',
  'noCrossBreeding', 'habitat', 'sellPrice', 'altPriceGems'];

test('baseline is the live 4.2.218 client and the snippet matches the live king crab rules', () => {
  assert.equal(h.md5(Buffer.from(h.BASELINE_HTML)), '0e46c5bfe7fd59c142fb3188e722eee8');
  assert.match(h.BASELINE_HTML, /const GAME_BUILD='4\.2\.218'/);
  assert.equal(live.price, 2000000);
  assert.equal(live.altPriceGems, 500);
  assert.equal(live.unlockLevel, 10);
  assert.deepEqual(live.habitat, { ocean: 2 });
});

test('server patch adds exactly the three new ids and none of them exist yet in the live fallback', () => {
  assert.deepEqual(Object.keys(h.PATCH.species).sort(), [...h.NEW_IDS].sort());
  const baseFallback = h.loadFallback(h.BASELINE_HTML);
  for (const id of h.NEW_IDS) assert.equal(baseFallback[id], undefined, `${id} must be free`);
  assert.ok(baseFallback.o_king_crab, 'live fallback still has the original king crab');
});

test('new crabs follow the 赤金帝王蟹 gameplay rules', () => {
  for (const id of h.NEW_IDS) {
    const sp = h.PATCH.species[id];
    for (const k of RULE_KEYS) assert.deepEqual(sp[k], live[k], `${id}.${k}`);
    assert.equal(sp.price, 2000000);
    assert.equal(sp.altPriceGems, 500);
    assert.equal(sp.unlockLevel, 10);
    assert.deepEqual(sp.habitat, { ocean: 2 });
    assert.equal(sp.role, 'bottom');
    assert.equal(sp.sizeClass, 'giant');
    assert.equal(sp.waterType, 'marine');
    assert.equal(sp.temperament, 'peaceful');
    assert.equal(sp.noCrossBreeding, true);
    assert.equal(sp.breedOnly, false);
    assert.equal(sp.look.body, 'crab');
    assert.equal(sp.look.len, live.look.len, 'same sprite box as 赤金 so sizing and floor contact match');
    assert.equal(sp.look.height, live.look.height);
    assert.ok(sp.scientificName && sp.desc && sp.name);
  }
});

test('names, scientific names and looks are distinct from every other species', () => {
  const names = new Set(), sci = new Set();
  for (const [id, sp] of Object.entries(h.PATCH.species)) {
    assert.ok(!names.has(sp.name)); names.add(sp.name);
    assert.ok(!sci.has(sp.scientificName)); sci.add(sp.scientificName);
  }
  assert.deepEqual([...names], ['藍帝王蟹', '黃金帝王蟹', '智利帝王蟹']);
  assert.deepEqual([...sci], ['Paralithodes platypus', 'Lithodes aequispinus', 'Lithodes santolla']);
  const baseFallback = h.loadFallback(h.BASELINE_HTML);
  const existingNames = new Set(Object.values(baseFallback).map(s => s.name).concat(Object.values(h.LIVE_SNIPPET.species).map(s => s.name)));
  for (const n of names) assert.ok(!existingNames.has(n), `${n} already used`);
  const hues = Object.values(h.PATCH.species).map(s => s.look.hue).concat(live.look.hue);
  assert.equal(new Set(hues).size, 4, 'four different base hues');
});

test('client fallback (TURTLE185_FALLBACK) carries the three new species identically and keeps o_king_crab', () => {
  const fb = h.loadFallback(h.CLIENT_HTML);
  for (const id of h.NEW_IDS) assert.deepEqual(fb[id], h.PATCH.species[id], id);
  assert.deepEqual(fb.o_king_crab, h.loadFallback(h.BASELINE_HTML).o_king_crab, 'same id, same config: owners keep their crab');
  // nothing else in the fallback table changed
  const base = h.loadFallback(h.BASELINE_HTML);
  for (const id of Object.keys(base)) assert.deepEqual(fb[id], base[id], id);
  assert.equal(Object.keys(fb).length, Object.keys(base).length + 3);
});

test('shop 新上市 list (NEWX) lists all four king crabs once, next to each other, original order preserved', () => {
  const now = h.extractNEWX(h.CLIENT_HTML), before = h.extractNEWX(h.BASELINE_HTML);
  for (const id of h.CRAB_IDS) assert.equal(now.filter(x => x === id).length, 1, id);
  const i = now.indexOf('o_king_crab');
  assert.deepEqual(now.slice(i, i + 4), h.CRAB_IDS);
  assert.deepEqual(now.filter(x => !h.NEW_IDS.includes(x)), before);
  // list filter used by the shop: present, not disabled, not breed-only
  const fb = h.loadFallback(h.CLIENT_HTML);
  for (const id of h.CRAB_IDS) assert.ok(fb[id] && !fb[id].disabled && !fb[id].breedOnly && fb[id].price > 0);
});

test('深海光境 copy mentions all four king crabs and the dual price', () => {
  const m = h.CLIENT_HTML.match(/海洋館 Lv2「深海光境」：[^<]*/);
  assert.ok(m, 'copy present');
  for (const n of ['赤金帝王蟹', '藍帝王蟹', '黃金帝王蟹', '智利帝王蟹', '200萬金幣', '500鑽']) assert.ok(m[0].includes(n), n);
  assert.ok(h.BASELINE_HTML.includes('海洋館 Lv2「深海光境」：極光燈棘海膽、星潮螢海星、深海珠燈魚與赤金帝王蟹新登場。'));
});

test('GAME_BUILD is bumped and the art catalog cache-buster follows it', () => {
  assert.match(h.CLIENT_HTML, /const GAME_BUILD='4\.2\.219';\/\*V406-CLIENT\*\//);
  assert.ok(h.CLIENT_HTML.includes('export3/catalog.json?v=4.2.219'));
  assert.ok(!h.CLIENT_HTML.includes('4.2.218'));
});

test('committed client is exactly what tools/build-client.mjs produces from the baseline', async () => {
  const { buildClient } = await import('../tools/build-client.mjs');
  const { html } = buildClient();
  assert.equal(h.md5(Buffer.from(html)), h.md5(Buffer.from(h.CLIENT_HTML)), 'run: node kingcrab-batch/tools/build-client.mjs');
});

test('the inlined walk module is the src/kingcrab-walk.js file and the old king-crab PNG hook is gone', () => {
  assert.ok(h.CLIENT_HTML.includes(h.WALK_SRC.trimEnd()));
  assert.ok(!h.CLIENT_HTML.includes('kingcrab275'));
  assert.ok(h.BASELINE_HTML.includes('kingcrab275-v2.png'));
});
