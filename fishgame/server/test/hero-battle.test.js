'use strict';
// 英雄魚：戰鬥模擬器確定性與基本不變量
const test = require('node:test');
const assert = require('node:assert');
const { simulate, mulberry32 } = require('../src/hero/battle');
const { HERO_DEFAULT_CONFIG: H } = require('../src/hero/default-config');
const S = require('../src/hero/stats');
const G = require('../seed/default-config.json');

const snap = (sp, level = 10, extra = {}) => S.snapshot(H, G, { species: sp, growth: 999, level, train: {}, gear: {}, skills: {}, ...extra });

test('同樣快照＋同樣種子 → 完全相同的戰鬥（含事件）；不同種子 → 不同', () => {
  const a = snap('redpiranha'), b = snap('t_snapper');
  const r1 = simulate(a, b, 123456, H.battle, H.skills), r2 = simulate(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 123456, H.battle, H.skills);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(r1.events), JSON.stringify(r2.events));
  let diff = 0;
  for (let s = 1; s <= 20; s++) if (JSON.stringify(simulate(a, b, s, H.battle, H.skills).events) !== JSON.stringify(r1.events)) diff++;
  assert.ok(diff >= 19, '不同種子應產生不同戰鬥');
});

test('快照與模擬只用整數；序列化往返後結果一致（伺服器存 JSON 後可重播）', () => {
  const rnd = mulberry32(99);
  const ids = Object.keys(G.species);
  for (let i = 0; i < 60; i++) {
    const a = snap(ids[Math.floor(rnd() * ids.length)], 1 + Math.floor(rnd() * 30)), b = snap(ids[Math.floor(rnd() * ids.length)], 1 + Math.floor(rnd() * 30));
    for (const s of [a, b]) for (const v of Object.values(s.stats)) assert.ok(Number.isInteger(v), '能力需為整數');
    const seed = Math.floor(rnd() * 4294967296);
    const r = simulate(a, b, seed, H.battle, H.skills);
    const again = simulate(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), seed, H.battle, H.skills);
    assert.equal(JSON.stringify(again), JSON.stringify(r));
    // 不變量
    assert.ok(r.winner === 0 || r.winner === 1);
    assert.ok(r.actions <= H.battle.maxActions);
    for (const e of r.events) for (const hp of e.hp) assert.ok(hp >= 0 && Number.isInteger(hp));
    if (r.reason === 'ko') assert.ok(r.final.hp[r.winner] > 0 && r.final.hp[1 - r.winner] === 0);
  }
});

test('技能效果：護盾吸收、流血、暈眩、增益都會出現在事件裡', () => {
  const seen = new Set();
  const pairs = [['t_redear', 'redpiranha'], ['bigeel', 'puffer'], ['figure8', 'betta'], ['koi', 'bluecray'], ['w_orca', 'goldfish']].filter(([a, b]) => G.species[a] && G.species[b]);
  for (const [x, y] of pairs) for (let s = 1; s < 30; s++) {
    const r = simulate(snap(x, 20), snap(y, 20), s, H.battle, H.skills);
    for (const e of r.events) {
      if (e.shield) seen.add('shield'); if (e.dotApplied) seen.add('dot'); if (e.stun) seen.add('stun'); if (e.buff) seen.add('buff'); if (e.debuff) seen.add('debuff');
      if (e.k === 'stunned') seen.add('stunned'); if (e.hits && e.hits.some((h) => h.crit)) seen.add('crit'); if (e.hits && e.hits.some((h) => h.miss)) seen.add('miss'); if (e.reflect || (e.hits && e.hits.some((h) => h.reflect))) seen.add('reflect');
    }
  }
  for (const k of ['shield', 'dot', 'buff', 'debuff', 'crit', 'miss']) assert.ok(seen.has(k), '應出現 ' + k);
});

test('能力推導：成長階段、等級、訓練、裝備都會提升戰力；混種可推導', () => {
  const p = (h) => S.finalStats(H, G, { species: 'betta', growth: 999, level: 10, train: {}, gear: {}, skills: {}, ...h }).power;
  const base = p({});
  assert.ok(S.finalStats(H, G, { species: 'betta', growth: 0, level: 10, train: {}, gear: {}, skills: {} }).power < base, '幼魚較弱');
  assert.ok(p({ level: 20 }) > base, '等級');
  assert.ok(p({ train: { atk: 10, hp: 10 } }) > base, '訓練');
  assert.ok(p({ gear: { equip: { weapon: 'w_steel', armor: 'a_titan' } } }) > base, '裝備');
  const hx = S.snapshot(H, G, { species: 'hx:betta+goldfish', growth: 999, level: 10, train: {}, gear: {}, skills: {} });
  assert.ok(hx && hx.family === 'hybrid' && hx.skills.length >= 1);
  // 招牌技：鰻形→放電、龜→龜殼、食人魚→撕咬、河豚→膨脹、鯊→衝撞
  const sig = (sp) => S.familyOf(H, G, sp, S.speciesDef(G, sp)).signature;
  assert.equal(sig('t_redear'), 'shell'); assert.equal(sig('redpiranha'), 'bite'); assert.equal(sig('redtailshark'), 'ram');
  const puffer = Object.keys(G.species).find((k) => G.species[k].family === 'puffer' && G.species[k].look.body !== 'eel'); assert.equal(sig(puffer), 'puff');
  const eel = Object.keys(G.species).find((k) => G.species[k].look.body === 'eel'); assert.equal(sig(eel), 'shock');
});
