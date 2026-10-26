'use strict';
// 跨種繁殖：200 組隨機配對 → 除非雙親有金魚，否則不會生出金魚；子代特徵都來自雙親；伺服器接受生成的混種
const test = require('node:test');
const assert = require('node:assert/strict');
const Hybrid = require('../src/hybrid');
const { checkSave, spOf } = require('../src/anticheat');
const { sampleSave } = require('./helpers');
const CFG = require('../seed/default-config.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const fish = (id, sp, over = {}) => ({ id, sp, name: 'x', hue: 10, size: 1, growth: 200, full: 80, health: 100, cd: 0, coinT: 10, seed: 3, ...over });
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TR = { peaceful: 0, aggressive: 1, predator: 2 };

test('200 組隨機跨種配對：不會無故生出金魚、子代特徵來自雙親、混種名稱固定且有意義', () => {
  const R = rng(20261021), keys = Object.keys(CFG.species);
  assert.equal(CFG.breeding.hybrid.parentChance, 0.3);
  let hyb = 0, par = 0, gold = 0;
  for (let i = 0; i < 200; i++) {
    let a = keys[Math.floor(R() * keys.length)], b = keys[Math.floor(R() * keys.length)]; if (a === b) b = keys[(keys.indexOf(a) + 1) % keys.length];
    const r = Hybrid.cross(CFG, a, b, R);
    if (r.sp === 'goldfish') { gold++; assert.ok(a === 'goldfish' || b === 'goldfish', `${a}×${b} → 金魚`); }
    if (r.kind === 'parent') { par++; assert.ok([a, b].includes(r.sp), `${a}×${b} → ${r.sp}`); continue; }
    assert.equal(r.kind, 'hybrid'); hyb++;
    assert.deepEqual(Hybrid.parse(r.sp), [a, b].sort());
    const d = spOf(CFG, r.sp), A = CFG.species[a], B = CFG.species[b];
    assert.ok(d && d.hybrid, r.sp);
    assert.ok(d.name && d.name !== A.name && d.name !== B.name && d.name.length <= 10, d.name);
    assert.deepEqual(spOf(CFG, r.sp).name, d.name, '同一組父母永遠同名');
    assert.ok([A.look.body || 'fish', B.look.body || 'fish'].includes(d.look.body || 'fish'), `body ${d.look.body}`);
    assert.ok([A.temperament || 'peaceful', B.temperament || 'peaceful'].includes(d.temperament), 'temperament');
    assert.ok(d.rarity >= Math.min(A.rarity | 0, B.rarity | 0), 'rarity');
    assert.ok([A.waterType || 'fresh', B.waterType || 'fresh'].includes(d.waterType), 'waterType');
    assert.ok(Math.abs(TR[d.temperament] - Math.max(TR[A.temperament] ?? 0, TR[B.temperament] ?? 0)) <= 2);
    assert.ok(d.adultSizeCm >= Math.min(A.adultSizeCm || 5, B.adultSizeCm || 5) && d.adultSizeCm <= Math.max(A.adultSizeCm || 5, B.adultSizeCm || 5) + .01, 'size between parents');
    // 伺服器接受：雙親在魚缸裡 → 生出混種不算可疑
    const T0 = Date.UTC(2026, 9, 21, 4), cfg = clone(CFG); cfg.antiCheat.mode = 'reject';
    const prev = sampleSave({ coins: 100, last: T0 - 60000 }); prev.up.cap = 8; prev.fish = [fish('pa', a), fish('pb', b)];
    const next = clone(prev); next.last = T0; next.fish.push(fish('kid', r.sp, { growth: 0 }));
    const cs = checkSave(cfg, prev, T0 - 60000, next, T0);
    assert.deepEqual(cs.structural, [], `${r.sp} ${JSON.stringify(cs.structural)}`);
    assert.ok(!cs.suspicious.some((s) => /雙親|混種|魚種/.test(s)), `${r.sp} ${JSON.stringify(cs.suspicious)}`);
  }
  assert.ok(hyb >= 120, `大部分應該生出混種（${hyb} 混種 / ${par} 原種）`);
  console.log(`200 組：混種 ${hyb}、原種 ${par}、金魚 ${gold}`);
});
