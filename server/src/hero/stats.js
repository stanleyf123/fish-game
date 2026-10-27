'use strict';
// 英雄魚能力推導：魚種特性（體型／性情／攻擊性／稀有度／泳速／成長階段）＋科別輪廓 → 基礎能力；
// 再加上 等級、訓練點、裝備 → 戰鬥用快照（全部整數）。
const hybrid = require('../hybrid');

const STATS = ['hp', 'atk', 'def', 'spd', 'crit'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function speciesDef(gameCfg, sp) {
  if (!gameCfg || !gameCfg.species) return null;
  if (Object.prototype.hasOwnProperty.call(gameCfg.species, sp)) return gameCfg.species[sp];
  if (hybrid.isHybrid(sp)) return hybrid.def(gameCfg, sp);
  return null;
}

// 成長階段：0 幼魚 / 1 亞成 / 2 成年（依遊戲設定 stages 的 growth 門檻）
function stageOf(gameCfg, growth) {
  const st = (gameCfg && gameCfg.stages) || [{ growth: 0 }, { growth: 60 }, { growth: 160 }];
  let k = 0;
  for (let i = 0; i < st.length; i++) if ((growth || 0) >= (st[i].growth || 0)) k = i;
  return Math.min(2, k);
}

function familyOf(hcfg, gameCfg, sp, def) {
  if (def && def.hybrid && def.parents) {
    // 混種：招牌技＝性情較兇的親代科別；技能池＝另一親代的招牌技＋兇親代技能池前兩招；權重平均
    const [a, b] = def.parents.map((p) => speciesDef(gameCfg, p));
    const fa = familyOf(hcfg, gameCfg, def.parents[0], a), fb = familyOf(hcfg, gameCfg, def.parents[1], b);
    const rank = { peaceful: 0, aggressive: 1, predator: 2 };
    const fierceA = (rank[a && a.temperament] || 0) >= (rank[b && b.temperament] || 0);
    const main = fierceA ? fa : fb, other = fierceA ? fb : fa;
    const w = {}; for (const k of STATS) w[k] = (fa.w[k] + fb.w[k]) / 2;
    const pool = [other.signature, ...main.pool].filter((x, i, arr) => x !== main.signature && arr.indexOf(x) === i).slice(0, 3);
    return { key: 'hybrid', name: '混種', w, signature: main.signature, pool };
  }
  const fam = def && hcfg.families[def.family] ? def.family : '_default';
  const F = hcfg.families[fam];
  const body = def && def.look && def.look.body;
  const signature = (body && hcfg.signatureByBody && hcfg.signatureByBody[body]) || F.signature;
  const pool = [...F.pool];
  // 外形招牌技取代科別招牌技時，把原科別招牌技放進技能池（不重複）
  if (signature !== F.signature && !pool.includes(F.signature)) pool.unshift(F.signature);
  return { key: fam, name: F.name, w: { ...F.w }, signature, pool: pool.filter((x) => x !== signature).slice(0, 3) };
}

// 魚種 → Lv1 成年基礎能力（浮點；最後才取整）
function baseStats(hcfg, gameCfg, sp, growth, skillIds, fair, opt = {}) {
  const def = speciesDef(gameCfg, sp);
  if (!def) return null;
  const fam = familyOf(hcfg, gameCfg, sp, def);
  const T = hcfg.traits, B = hcfg.base;
  const w = { ...fam.w };
  // 體型 0..1（2cm → 0，1000cm → 1，對數）
  const cm = Math.max(0.5, def.adultSizeCm || 5);
  const sz = clamp((Math.log10(cm) - 0.3) / 2.7, 0, 1) - 0.5;
  w.hp *= 1 + T.sizeHp * sz; w.def *= 1 + T.sizeDef * sz; w.spd *= 1 - T.sizeSpd * sz;
  const ag = clamp(def.aggression | 0, 0, 5);
  w.atk *= 1 + T.aggrAtk * ag; w.crit *= 1 + T.aggrCrit * ag; w.def *= 1 - T.aggrDef * ag;
  const tm = (T.temperament || {})[def.temperament] || {};
  for (const k of STATS) if (tm[k]) w[k] *= tm[k];
  const sw = T.swimSpeed || { mid: 34, span: 30, max: 0.25 };
  w.spd *= 1 + clamp(((def.speed || sw.mid) - sw.mid) / sw.span * sw.max, -sw.max, sw.max);

  let st = { hp: B.hp * w.hp, atk: B.atk * w.atk, def: B.def * w.def, spd: B.spd * w.spd, crit: B.crit * w.crit, critDmg: B.critDmg, dodge: B.dodge };
  const stage = stageOf(gameCfg, growth);
  const stageMul = (hcfg.stage || [1, 1, 1])[stage] || 1;
  const rarity = clamp(def.rarity | 0, 0, 5);
  if (hcfg.normalize && hcfg.normalize.enabled) {
    // fair：自動公平校正倍率（autobalance.js）；bias：營運刻意加強／削弱某科別（不會被自動校正抵銷）
    const bias = opt.noBias ? 1 : ((hcfg.families[fam.key] && hcfg.families[fam.key].bias) || 1);
    const target = powerIndex(hcfg, B) * (1 + (hcfg.normalize.rarityBonus || 0) * rarity) * stageMul * (fair || 1) * bias;
    const s = Math.sqrt(target / powerIndex(hcfg, st));
    st.hp *= s; st.atk *= s;
  } else { st.hp *= Math.sqrt(stageMul); st.atk *= Math.sqrt(stageMul); }
  return { stats: st, family: fam, def, stage, rarity, sizeCm: cm };
}

// 戰力指數（≈ 有效生命 × 每秒輸出）：hp × atk × (1+def/K) × spd × 暴擊期望
function powerIndex(hcfg, s) {
  const K = (hcfg.battle && hcfg.battle.defK) || 100;
  const N = hcfg.normalize || {};
  return s.hp * s.atk * Math.pow(1 + s.def / K, N.defExp || 1) * Math.pow(s.spd / 100, N.spdExp || 1) * (1 + (s.crit / 1000) * ((s.critDmg || 150) / 100 - 1));
}

function xpToNext(hcfg, level) { const L = hcfg.level; return Math.round(L.xpBase * Math.pow(level, L.xpExp)); }

// 依等級解鎖的技能清單
function unlockedSkills(hcfg, fam, level) {
  const all = [fam.signature, ...fam.pool];
  const lv = hcfg.skillUnlock || [1, 2, 6, 12];
  return all.filter((id, i) => hcfg.skills[id] && level >= (lv[i] || 1));
}
function slotCount(hcfg, level) { return (hcfg.skillSlots.unlockLevels || [1]).filter((l) => level >= l).length; }

// 英雄（資料列物件）→ 最終能力（整數）＋戰鬥快照
// hero: { species, growth, level, train:{hp..}, gear:{equip:{slot:id}}, skills:{ranks:{id:rank}, slots:[id]} }
function finalStats(hcfg, gameCfg, hero, opt = {}) {
  const def0 = speciesDef(gameCfg, hero.species);
  if (!def0) return null;
  const fam0 = familyOf(hcfg, gameCfg, hero.species, def0);
  const skills = battleSkills(hcfg, fam0, hero);
  const ids = skills.map((x) => x.id);
  // 公平係數：opt.fair 指定（autobalance 內部使用）或自動計算
  let fair = opt.fair;
  if (fair == null) {
    const lv0 = clamp(hero.level || 1, 1, hcfg.level.max);
    fair = require('./autobalance').fairFactor(hcfg, gameCfg, { species: hero.species, level: lv0, stage: 2, growth: 999 }, ids, // 一律以成年校正；成長階段倍率另外套用
      (h, m) => snapshot(hcfg, gameCfg, h, {}, { fair: m, noBias: true }));
  }
  const b = baseStats(hcfg, gameCfg, hero.species, hero.growth, ids, fair, opt);
  if (b) b.fair = fair;
  if (!b) return null;
  b.skills = skills;
  const L = hcfg.level, lv = clamp(hero.level || 1, 1, L.max);
  const s = { ...b.stats };
  s.hp *= 1 + L.hpPerLv * (lv - 1); s.atk *= 1 + L.atkPerLv * (lv - 1); s.def *= 1 + L.defPerLv * (lv - 1);
  const tp = hero.train || {}, pv = hcfg.training.pointValue;
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] *= 1 + (tp[k] || 0) * pv[k];
  s.crit += (tp.crit || 0) * pv.crit;
  const eq = (hero.gear && hero.gear.equip) || {};
  for (const slot of Object.keys(eq)) {
    const it = eq[slot] && hcfg.gear[eq[slot]];
    if (!it || it.slot !== slot) continue;
    const m = it.mods || {};
    if (m.hpPct) s.hp *= 1 + m.hpPct / 100; if (m.atkPct) s.atk *= 1 + m.atkPct / 100; if (m.defPct) s.def *= 1 + m.defPct / 100; if (m.spdPct) s.spd *= 1 + m.spdPct / 100;
    if (m.crit) s.crit += m.crit; if (m.critDmg) s.critDmg += m.critDmg; if (m.dodge) s.dodge += m.dodge;
  }
  const out = {};
  for (const k of ['hp', 'atk', 'def', 'spd', 'crit', 'critDmg', 'dodge']) out[k] = Math.max(1, Math.round(s[k]));
  out.crit = Math.min(750, out.crit); out.dodge = Math.min(500, out.dodge);
  const power = Math.round(Math.sqrt(powerIndex(hcfg, out)) / 10);
  return { stats: out, power, base: b, level: lv };
}

// 戰鬥用技能清單：已裝備且已解鎖的技能（依欄位順序）；若沒裝備，預設用已解鎖技能填滿可用欄位
function battleSkills(hcfg, fam, hero) {
  const lv = hero.level || 1, unlocked = unlockedSkills(hcfg, fam, lv), n = slotCount(hcfg, lv);
  const ranks = (hero.skills && hero.skills.ranks) || {};
  let slots = (hero.skills && Array.isArray(hero.skills.slots) ? hero.skills.slots : null);
  if (!slots || !slots.length) slots = unlocked.slice(0, n);
  return slots.filter((id, i, a) => id && unlocked.includes(id) && a.indexOf(id) === i).slice(0, n).map((id) => ({ id, rank: clamp(ranks[id] || 1, 1, hcfg.skillRank.max) }));
}

function snapshot(hcfg, gameCfg, hero, extra = {}, opt = {}) {
  const f = finalStats(hcfg, gameCfg, hero, opt);
  if (!f) return null;
  const def = f.base.def;
  return {
    name: hero.fish_name || hero.fishName || def.name, sp: hero.species, spName: def.name, hue: hero.hue != null ? hero.hue : (def.look && def.look.hue) || 0,
    level: f.level, stage: f.base.stage, family: f.base.family.key, fair: f.base.fair, stats: f.stats, power: f.power,
    skills: f.base.skills, ...extra,
  };
}

function rankOf(hcfg, rating) {
  let r = hcfg.ranks[0];
  for (const x of hcfg.ranks) if (rating >= x.min) r = x;
  return r;
}

module.exports = { STATS, speciesDef, stageOf, familyOf, baseStats, powerIndex, xpToNext, unlockedSkills, slotCount, finalStats, battleSkills, snapshot, rankOf };
