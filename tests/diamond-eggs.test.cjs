'use strict';
// Tests for diamond-eggs.js – Scheme C breakpoints and DRAFT pricing
// Run with: node --test tests/diamond-eggs.test.cjs

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');

// ---- Parse constants directly from the source file ----
const src = fs.readFileSync(require('node:path').join(__dirname, '../diamond-eggs.js'), 'utf8');

// Extract TIER array text
const tierMatch = src.match(/const TIER=(\[[\s\S]*?\]);/);
assert.ok(tierMatch, 'TIER constant should be defined');
// eslint-disable-next-line no-eval
const TIER = eval(tierMatch[1].replace(/1e9/g, '1000000000'));

// Extract DRAW_PRICE and TEN_PRICE
const priceMatch = src.match(/const DRAW_PRICE=(\d+),TEN_PRICE=(\d+)/);
assert.ok(priceMatch, 'DRAW_PRICE and TEN_PRICE should be defined as named constants');
const DRAW_PRICE = Number(priceMatch[1]);
const TEN_PRICE = Number(priceMatch[2]);

// ---- Helper: get tier id for a given priceGems ----
function getTierId(priceGems) {
  const t = TIER.find(t => t.min !== undefined && priceGems >= t.min && priceGems <= t.max);
  return t?.id ?? null;
}

// ---- Scheme C breakpoint tests ----

test('R tier: priceGems=1 → spark', () => {
  assert.equal(getTierId(1), 'spark');
});

test('R tier: priceGems=100 → spark', () => {
  assert.equal(getTierId(100), 'spark');
});

test('R tier boundary: priceGems=199 → spark (Scheme C max R)', () => {
  assert.equal(getTierId(199), 'spark');
});

test('SR tier boundary: priceGems=200 → rare (Scheme C min SR)', () => {
  assert.equal(getTierId(200), 'rare');
});

test('SR tier: priceGems=300 → rare', () => {
  assert.equal(getTierId(300), 'rare');
});

test('SR tier boundary: priceGems=399 → rare (Scheme C max SR)', () => {
  assert.equal(getTierId(399), 'rare');
});

test('SSR tier boundary: priceGems=400 → apex (Scheme C min SSR)', () => {
  assert.equal(getTierId(400), 'apex');
});

test('SSR tier: priceGems=600 → apex', () => {
  assert.equal(getTierId(600), 'apex');
});

test('SSR tier: priceGems=1000 → apex', () => {
  assert.equal(getTierId(1000), 'apex');
});

// Old Scheme A boundary 120 should now be R (not SR)
test('Scheme C vs old: priceGems=120 must be R (not SR)', () => {
  assert.equal(getTierId(120), 'spark');
});

// Old Scheme A boundary 480 should now be SSR (was SSR)
test('Scheme C vs old: priceGems=480 must still be SSR', () => {
  assert.equal(getTierId(480), 'apex');
});

// Old boundary: priceGems=121 was SR in old scheme, must still be R (<=199)
test('Scheme C vs old: priceGems=121 is R (old was SR, now R)', () => {
  assert.equal(getTierId(121), 'spark');
});

// ---- Rarity field tests ----
test('spark tier rarity is R', () => {
  const t = TIER.find(t => t.id === 'spark');
  assert.equal(t.rarity, 'R');
});

test('rare tier rarity is SR', () => {
  const t = TIER.find(t => t.id === 'rare');
  assert.equal(t.rarity, 'SR');
});

test('apex tier rarity is SSR', () => {
  const t = TIER.find(t => t.id === 'apex');
  assert.equal(t.rarity, 'SSR');
});

test('exclusive tier rarity is UR', () => {
  const t = TIER.find(t => t.id === 'exclusive');
  assert.equal(t.rarity, 'UR');
});

// ---- Weight sanity tests (must stay at 85/13/1.8/0.2) ----
test('weights sum to 10000', () => {
  const sum = TIER.reduce((s, t) => s + t.weight, 0);
  assert.equal(sum, 10000);
});

test('spark weight = 8500 (85%)', () => {
  assert.equal(TIER.find(t => t.id === 'spark').weight, 8500);
});

test('rare weight = 1300 (13%)', () => {
  assert.equal(TIER.find(t => t.id === 'rare').weight, 1300);
});

test('apex weight = 180 (1.8%)', () => {
  assert.equal(TIER.find(t => t.id === 'apex').weight, 180);
});

test('exclusive weight = 20 (0.2%)', () => {
  assert.equal(TIER.find(t => t.id === 'exclusive').weight, 20);
});

// ---- DRAFT pricing tests ----
test('DRAW_PRICE equals 120', () => {
  assert.equal(DRAW_PRICE, 120);
});

test('TEN_PRICE equals 1200', () => {
  assert.equal(TEN_PRICE, 1200);
});

test('TEN_PRICE is exactly 10x DRAW_PRICE', () => {
  assert.equal(TEN_PRICE, DRAW_PRICE * 10);
});

test('No hardcoded count*30 in draw() logic', () => {
  // Ensure the old price (30) is not hardcoded in draw cost calculation
  const drawFn = src.match(/function draw\([\s\S]*?\nmodule\.exports/)?.[0] || src;
  // The pattern "b.count*30" or "count*30" should not appear
  assert.ok(!drawFn.includes('count*30'), 'draw() must not use hardcoded count*30');
  assert.ok(!drawFn.includes('*30'), 'draw() must not use hardcoded *30 multiplier');
});

test('DRAW_PRICE and TEN_PRICE defined before draw()', () => {
  const priceIdx = src.indexOf('const DRAW_PRICE=');
  const drawIdx = src.indexOf('draw(pid,b)');
  assert.ok(priceIdx < drawIdx, 'DRAW_PRICE must be defined before draw()');
});

test('DRAFT-PRICING comment present', () => {
  assert.ok(src.includes('DRAFT-PRICING'), 'Source must contain DRAFT-PRICING marker');
});

test('DRAFT-CABINETS comment present', () => {
  assert.ok(src.includes('DRAFT-CABINETS'), 'Source must contain DRAFT-CABINETS marker');
});

test('SCHEME-C comment present', () => {
  assert.ok(src.includes('SCHEME-C'), 'Source must contain SCHEME-C marker');
});
