'use strict';
// 平衡模擬：同等級、無訓練、無裝備（或指定）下，讓每個魚種與其他魚種對打，統計勝率。
// 每一對都「互換攻守」各打一次並使用不同種子，排除先後手偏差。
const { snapshot, speciesDef } = require('./stats');
const { simulate, mulberry32 } = require('./battle');

function runBalance(hcfg, gameCfg, opt = {}) {
  const level = opt.level || 10, growth = opt.growth == null ? 999 : opt.growth;
  let ids = opt.species || Object.keys(gameCfg.species).filter((k) => !gameCfg.species[k].disabled);
  if (opt.hybrids) {
    const rnd = mulberry32(opt.seed || 7), base = Object.keys(gameCfg.species).filter((k) => !gameCfg.species[k].disabled);
    const H = require('../hybrid');
    for (let i = 0; i < opt.hybrids; i++) { const a = base[Math.floor(rnd() * base.length)], b = base[Math.floor(rnd() * base.length)]; if (a !== b) ids.push(H.idOf(a, b)); }
    ids = [...new Set(ids)];
  }
  const snaps = {};
  for (const sp of ids) { const s = snapshot(hcfg, gameCfg, { species: sp, growth, level, train: opt.train || {}, gear: opt.gear || {}, skills: {} }); if (s) snaps[sp] = s; }
  ids = Object.keys(snaps);
  const per = opt.opponents || 0; // 0 = 全部對全部
  const rnd = mulberry32(opt.seed || 12345);
  const W = {}, N = {}, fam = {};
  for (const id of ids) { W[id] = 0; N[id] = 0; }
  let battles = 0, timeouts = 0, actionsSum = 0;
  const play = (a, b, seed) => {
    const r = simulate(snaps[a], snaps[b], seed, hcfg.battle, hcfg.skills);
    battles++; actionsSum += r.actions; if (r.reason === 'timeout') timeouts++;
    const w = r.winner === 0 ? a : b;
    W[w]++; N[a]++; N[b]++;
  };
  if (!per) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      play(ids[i], ids[j], (i * 7919 + j * 104729 + 1) >>> 0); play(ids[j], ids[i], (j * 7919 + i * 104729 + 3) >>> 0);
    }
  } else {
    for (const a of ids) for (let k = 0; k < per; k++) { const b = ids[Math.floor(rnd() * ids.length)]; if (b === a) continue; const s = Math.floor(rnd() * 4294967296); play(a, b, s); play(b, a, s ^ 0x9e3779b9); }
  }
  const rows = ids.map((id) => {
    const s = snaps[id], d = speciesDef(gameCfg, id);
    const f = s.family; fam[f] = fam[f] || { w: 0, n: 0, count: 0 }; fam[f].w += W[id]; fam[f].n += N[id]; fam[f].count++;
    return { id, name: d.name, family: f, fair: s.fair, rarity: d.rarity | 0, sizeCm: d.adultSizeCm, power: s.power, hp: s.stats.hp, atk: s.stats.atk, def: s.stats.def, spd: s.stats.spd, crit: s.stats.crit, skills: s.skills.map((x) => x.id), wins: W[id], games: N[id], winrate: N[id] ? W[id] / N[id] : 0 };
  }).sort((x, y) => y.winrate - x.winrate);
  const families = Object.entries(fam).map(([k, v]) => ({ family: k, species: v.count, winrate: v.n ? v.w / v.n : 0 })).sort((x, y) => y.winrate - x.winrate);
  return { level, battles, timeouts, avgActions: battles ? actionsSum / battles : 0, max: rows[0], min: rows[rows.length - 1], rows, families };
}


module.exports = { runBalance };
