'use strict';
// COINSINK-B1-CURVE 高等級收入軟上限：R（金幣/時）> K 時每掉 m=(K/R)^(1−α)，α=CFG.coins.softcap.exp
// COINSINK-B2-DR  同群遞減收益（帳號全缸合算），以及全缸合算 softcap。
const Hybrid = require('./hybrid');
const { coinBonusSum } = require('./legacy-deco');
const hyCache = new WeakMap();
function spOf(cfg, id) {
  if (Object.prototype.hasOwnProperty.call(cfg.species, id)) return cfg.species[id];
  if (!Hybrid.isHybrid(id)) return null;
  let m = hyCache.get(cfg); if (!m) { m = new Map(); hyCache.set(cfg, m); }
  if (!m.has(id)) m.set(id, Hybrid.def(cfg, id)); return m.get(id);
}

function softcapCfg(cfg) {
  const s = (cfg && cfg.coins && cfg.coins.softcap) || {};
  return {
    enabled: s.enabled !== false,
    kneePerHour: Number.isFinite(s.kneePerHour) ? Math.max(1, s.kneePerHour) : 60000,
    exp: Number.isFinite(s.exp) ? Math.min(1, Math.max(0, s.exp)) : 0.8,
  };
}

function stageOf(cfg, f) {
  const g1 = cfg.stages[1]?.growth ?? 100;
  const g2 = cfg.stages[2]?.growth ?? 1000;
  const g = f.growth || 0;
  if (g >= g2) return 2;
  if (g >= g1) return 1;
  return 0;
}

function avgIntervalSec(cfg, st) {
  const iv = cfg.coins?.intervalSecByStage?.[st];
  if (!iv || !iv[0]) return null;
  return (iv[0] + (iv[1] || iv[0])) / 2;
}

function waterMult(cfg, save) {
  const grades = (cfg.water && cfg.water.grades) || [];
  const dirt = save?.water?.dirt ?? 0;
  for (const g of grades) {
    if (dirt < g.below) return g.coinMultiplier || 1;
  }
  return grades.length ? (grades[grades.length - 1].coinMultiplier || 1) : 1;
}

function aquascapeBeauty(cfg, save) {
  const A = cfg.aquascape;
  const ps = save?.plants;
  if (!A || !ps?.length) return 0;
  const PL = A.plants || {};
  const R = A.rules || {};
  const zones = new Set();
  const kinds = new Set();
  let health = 0;
  let over = 0;
  let cover = 0;
  const trimAt = R.trimAt || 130;
  for (const p of ps) {
    const P = PL[p.sp];
    if (!P) continue;
    zones.add(P.zone);
    kinds.add(p.sp);
    health += (p.hp != null ? p.hp : 100) / 100;
    if ((p.g || 0) >= trimAt) over++;
    cover += Math.min(1, (p.g || 0) / 100);
  }
  const algae = (save.water && save.water.algae) || 0;
  const sc = Math.min(30, kinds.size * 4) + Math.min(25, zones.size * 5) + Math.min(25, cover * 2.5)
    + 20 * (health / ps.length) - over * 6 - Math.max(0, algae - 30) * 0.3;
  return Math.round(Math.min(100, Math.max(0, sc)));
}

function aquascapeCoinMult(cfg, save) {
  const A = cfg.aquascape;
  if (!A || A.enabled === false) return 1;
  const R = A.rules || {};
  return 1 + (R.beautyBonusMax ?? 0.08) * aquascapeBeauty(cfg, save) / 100;
}

function decoMult(cfg, save) {
  return 1 + coinBonusSum(cfg, save);
}

// ── COINSINK-B2-DR 遞減收益 ─────────────────────────────────────────────────

/**
 * 是否豁免 DR。
 * 豁免條件：priceGems > 0（付費魚）、premium===true、dmmLargeSchool===true、schoolMaxGroup>0。
 */
function isDrExempt(cfg, sp) {
  const s = spOf(cfg, sp);
  return !s || (s.priceGems > 0) || (s.premium === true) ||
    (s.dmmLargeSchool === true) || ((s.schoolMaxGroup || 0) > 0);
}

/**
 * 七彩系 DR 群組 key。
 * discusblue / discusred 本身，以及兩親本都屬 discus 群的混種，計為 'discus'。
 * 其餘物種各自成群（使用 sp 字串）。
 */
function drGroupKey(cfg, id) {
  if (id === 'discusblue' || id === 'discusred') return 'discus';
  if (Hybrid.isHybrid(id)) {
    const p = Hybrid.parse(id);
    if (p && p.length === 2 && p.every(pid => drGroupKey(cfg, pid) === 'discus')) return 'discus';
  }
  return id;
}

/**
 * 計算 fish f.sp 在 allFish 中的 DR 平均倍率。
 * allFish 為所有缸的成魚陣列（stage >= 1）。
 * @param {object} cfg
 * @param {string} sp
 * @param {Array}  allFish - [{sp, growth, ...}]
 * @returns {number} 0 < m ≤ 1
 */
function drMultForFish(cfg, sp, allFish) {
  if (isDrExempt(cfg, sp)) return 1;
  const drCfg = cfg.coins || {};
  const th = drCfg.drThresholds || [40, 80];
  const rt = drCfg.drRates || [1, 0.6, 0.3];
  const key = drGroupKey(cfg, sp);
  let n = 0;
  for (const f of allFish) {
    if (stageOf(cfg, f) >= 1 && !isDrExempt(cfg, f.sp) && drGroupKey(cfg, f.sp) === key) n++;
  }
  if (n <= th[0]) return rt[0];
  if (n <= th[1]) return (th[0] * rt[0] + (n - th[0]) * rt[1]) / n;
  return (th[0] * rt[0] + (th[1] - th[0]) * rt[1] + (n - th[1]) * rt[2]) / n;
}

// ── 金幣計算 ────────────────────────────────────────────────────────────────

/**
 * 單條魚每次掉幣（未乘 softcap、未乘新手加速）。
 * opts.allFish: 供 DR 合算的全帳號成魚陣列（若未提供則不套用 DR）。
 */
function baseDrop(cfg, save, f, opts = {}) {
  const s = spOf(cfg, f.sp);
  if (!s) return 0;
  const st = stageOf(cfg, f);
  if (st <= 0) return 0;
  const stageMult = cfg.stages[st]?.coinMultiplier || 0;
  const vip = opts.vipCoinBonus || 0;
  const aqM = opts.aquascapeCoinMult != null ? opts.aquascapeCoinMult : aquascapeCoinMult(cfg, save);
  const raw = (s.coin || 0) * stageMult * decoMult(cfg, save) * waterMult(cfg, save) * (1 + vip) * aqM;
  const base = Math.max(1, Math.round(raw));
  // DR 倍率
  const drM = opts.allFish ? drMultForFish(cfg, f.sp, opts.allFish) : 1;
  return Math.round(base * drM) || 1;
}

/**
 * 完美照護下的理論產速 R（金幣/小時）。
 * opts.allFish: 供 DR 合算的全帳號成魚陣列。
 */
function theoreticalRatePerHour(cfg, save, opts = {}) {
  if (!save || !Array.isArray(save.fish)) return 0;
  const timeScale = (cfg.care && cfg.care.timeScale) || 1;
  const aqM = aquascapeCoinMult(cfg, save);
  const dropOpts = { ...opts, aquascapeCoinMult: aqM };
  let perSec = 0;
  for (const f of save.fish) {
    const st = stageOf(cfg, f);
    const iv = avgIntervalSec(cfg, st);
    if (st <= 0 || !iv) continue;
    perSec += baseDrop(cfg, save, f, dropOpts) / iv;
  }
  return perSec * timeScale * 3600;
}

function clientMirrorRatePerHour(cfg, save, opts = {}) {
  return theoreticalRatePerHour(cfg, save, opts);
}

function newbieActive(cfg, save, nowMs = Date.now()) {
  const nb = save?.nb;
  const ncfg = cfg.newbie || {};
  return !!(nb && !nb.legacy && nb.t0 && nowMs - nb.t0 < (ncfg.boostMin || 15) * 60000);
}

function softcapMult(cfg, ratePerHour, opts = {}) {
  const sc = softcapCfg(cfg);
  if (!sc.enabled) return 1;
  if (opts.newbieActive || (opts.save && newbieActive(cfg, opts.save, opts.nowMs))) return 1;
  const R = Math.max(0, ratePerHour);
  const K = sc.kneePerHour;
  if (R <= K) return 1;
  return Math.pow(K / R, 1 - sc.exp);
}

/** 單一存檔的 softcap（供 anticheat 向下相容） */
function multForSave(cfg, save, opts = {}) {
  const R = theoreticalRatePerHour(cfg, save, opts);
  return softcapMult(cfg, R, { ...opts, save });
}

/**
 * 全帳號合算 softcap。
 * @param {object}   cfg
 * @param {Array}    saves  - 玩家所有缸的存檔陣列（含主缸）
 * @param {object}   opts   - 同 softcapMult；新手判斷取第一個 save
 * @returns {number} softcap 乘數（0 < m ≤ 1）
 */
function multForPlayer(cfg, saves, opts = {}) {
  if (!saves || !saves.length) return 1;
  // 先蒐集全帳號成魚（供 DR 合算）
  const allFish = saves.flatMap(sv => (sv && Array.isArray(sv.fish) ? sv.fish : []));
  const drOpts = { ...opts, allFish };
  // 合算各缸產速
  let totalR = 0;
  for (const sv of saves) {
    totalR += theoreticalRatePerHour(cfg, sv, drOpts);
  }
  return softcapMult(cfg, totalR, { ...opts, save: saves[0] });
}

module.exports = {
  softcapCfg,
  theoreticalRatePerHour,
  clientMirrorRatePerHour,
  softcapMult,
  multForSave,
  multForPlayer,
  baseDrop,
  stageOf,
  newbieActive,
  waterMult,
  aquascapeCoinMult,
  isDrExempt,
  drGroupKey,
  drMultForFish,
};
