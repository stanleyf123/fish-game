'use strict';

/** Set bonuses apply only when all series items are placed in the tank (not stored). */

function seriesCfg(cfg) {
  return cfg && cfg.decoSeries && typeof cfg.decoSeries === 'object' ? cfg.decoSeries : {};
}

function tankDecoSet(save) {
  return new Set(Array.isArray(save?.up?.deco) ? save.up.deco : []);
}

function progressForSeries(cfg, save, seriesId) {
  const meta = seriesCfg(cfg)[seriesId];
  if (!meta || !Array.isArray(meta.keys) || !meta.keys.length) return { placed: 0, total: 0, complete: false };
  const tank = tankDecoSet(save);
  const keys = meta.keys.filter((k) => cfg.decorations?.[k]);
  const placed = keys.filter((k) => tank.has(k)).length;
  return { placed, total: keys.length, complete: placed >= keys.length && keys.length > 0 };
}

function activeSets(cfg, save) {
  const out = [];
  for (const id of Object.keys(seriesCfg(cfg))) {
    const p = progressForSeries(cfg, save, id);
    if (p.complete) out.push(id);
  }
  return out;
}

function combineBonus(cfg, save) {
  const b = { finHealMult: 1, mutationRelMult: 1, dirtRateMult: 1, growthMult: 1, sickRateMult: 1 };
  for (const id of activeSets(cfg, save)) {
    const bonus = seriesCfg(cfg)[id]?.bonus;
    if (!bonus || typeof bonus !== 'object') continue;
    if (bonus.finHealMult > 0) b.finHealMult *= bonus.finHealMult;
    if (bonus.mutationRelMult > 0) b.mutationRelMult *= bonus.mutationRelMult;
    if (bonus.dirtRateMult > 0) b.dirtRateMult *= bonus.dirtRateMult;
    if (bonus.growthMult > 0) b.growthMult *= bonus.growthMult;
    if (bonus.sickRateMult > 0) b.sickRateMult *= bonus.sickRateMult;
  }
  return b;
}

function isSeriesDecoration(cfg, key) {
  const d = cfg.decorations?.[key];
  return !!(d && d.series && seriesCfg(cfg)[d.series]);
}

function validateDecoSeries(cfg, save) {
  const errs = [];
  const ds = seriesCfg(cfg);
  for (const id of Object.keys(ds)) {
    const meta = ds[id];
    if (!meta || !Array.isArray(meta.keys)) errs.push(`decoSeries.${id} 缺少 keys`);
    else for (const k of meta.keys) if (!cfg.decorations?.[k]) errs.push(`decoSeries.${id} 引用未知造景 ${k}`);
  }
  return errs;
}

module.exports = {
  seriesCfg,
  progressForSeries,
  activeSets,
  combineBonus,
  isSeriesDecoration,
  validateDecoSeries,
};
