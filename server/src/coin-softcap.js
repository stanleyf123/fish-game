'use strict';
// COINSINK-B1-CURVE 高等級收入軟上限：R（金幣/時）> K 時每掉 m=(K/R)^(1−α)，α=CFG.coins.softcap.exp
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
    kneePerHour: Number.isFinite(s.kneePerHour) ? Math.max(1, s.kneePerHour) : 50000,
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
  const w = save?.water || {};
  const grades = (cfg.water && cfg.water.grades) || [];
  let best = 1;
  for (const g of grades) {
    const cycle = g.minCycle != null ? g.minCycle : 0;
    if ((w.cycle || 0) >= cycle) best = Math.max(best, g.coinMultiplier || 1);
  }
  return best;
}

function decoMult(cfg, save) {
  return 1 + coinBonusSum(cfg, save);
}

/** 單條魚每次掉幣（未乘 softcap、未乘新手加速） */
function baseDrop(cfg, save, f, opts = {}) {
  const s = spOf(cfg, f.sp);
  if (!s) return 0;
  const st = stageOf(cfg, f);
  if (st <= 0) return 0;
  const stageMult = cfg.stages[st]?.coinMultiplier || 0;
  const vip = opts.vipCoinBonus || 0;
  const raw = (s.coin || 0) * stageMult * decoMult(cfg, save) * waterMult(cfg, save) * (1 + vip);
  return Math.max(1, Math.round(raw));
}

/** 完美照護下的理論產速 R（金幣/小時） */
function theoreticalRatePerHour(cfg, save, opts = {}) {
  if (!save || !Array.isArray(save.fish)) return 0;
  const timeScale = (cfg.care && cfg.care.timeScale) || 1;
  let perSec = 0;
  for (const f of save.fish) {
    const st = stageOf(cfg, f);
    const iv = avgIntervalSec(cfg, st);
    if (st <= 0 || !iv) continue;
    perSec += baseDrop(cfg, save, f, opts) / iv;
  }
  return perSec * timeScale * 3600;
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

function multForSave(cfg, save, opts = {}) {
  const R = theoreticalRatePerHour(cfg, save, opts);
  return softcapMult(cfg, R, { ...opts, save });
}

module.exports = {
  softcapCfg,
  theoreticalRatePerHour,
  softcapMult,
  multForSave,
  baseDrop,
  stageOf,
  newbieActive,
};
