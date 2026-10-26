'use strict';
/** Per-player grandfathered decor bonuses (legacyDeco). Client cannot mutate; server owns changes. */

function normList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const k of raw) {
    if (typeof k !== 'string' || k.length > 40 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.slice(0, 40);
}

function legacyKeys(save) {
  return new Set(normList(save && save.legacyDeco));
}

function hasBonus(cfg, k) {
  const d = cfg.decorations && cfg.decorations[k];
  if (!d) return false;
  return (d.coinBonus || 0) > 0 || (d.mutationBonus || 0) > 0;
}

function activeDecoSet(save) {
  return new Set(Array.isArray(save?.up?.deco) ? save.up.deco : []);
}

/** Coin bonus multiplier contribution (0..n), only legacy keys currently in the tank. */
function coinBonusSum(cfg, save) {
  const leg = legacyKeys(save);
  const active = activeDecoSet(save);
  let s = 0;
  for (const k of leg) {
    if (!active.has(k)) continue;
    const b = cfg.decorations[k]?.coinBonus;
    if (b > 0) s += b;
  }
  return s;
}

function mutationBonusSum(cfg, save) {
  const leg = legacyKeys(save);
  const active = activeDecoSet(save);
  let s = 0;
  for (const k of leg) {
    if (!active.has(k)) continue;
    const b = cfg.decorations[k]?.mutationBonus;
    if (b > 0) s += b;
  }
  return s;
}

/** Upper bound for anti-cheat rate (all legacy bonuses at once in tank). */
function maxLegacyCoinBonus(cfg, save) {
  let s = 0;
  for (const k of legacyKeys(save)) {
    const b = cfg.decorations[k]?.coinBonus;
    if (b > 0) s += b;
  }
  return s;
}

function validateLegacyDeco(cfg, save) {
  const errs = [];
  if (save.legacyDeco == null) return errs;
  const dec = cfg.decorations || {};
  const list = normList(save.legacyDeco);
  if (!Array.isArray(save.legacyDeco)) errs.push('legacyDeco 必須是陣列');
  else if (list.length !== save.legacyDeco.length) errs.push('legacyDeco 含重複或非法鍵');
  else for (const k of list) if (!dec[k] || !hasBonus(cfg, k)) errs.push(`legacyDeco 含無加成或未知造景「${k}」`);
  return errs;
}

function stripClientLegacy(prev, next) {
  if (!next || typeof next !== 'object') return;
  if (prev && Array.isArray(prev.legacyDeco)) next.legacyDeco = prev.legacyDeco.slice();
  else delete next.legacyDeco;
}

function checkLegacyUnchanged(prev, next) {
  const a = normList(prev?.legacyDeco).sort().join(',');
  const b = normList(next?.legacyDeco).sort().join(',');
  return a === b;
}

function removeLegacy(save, ids) {
  if (!save || !Array.isArray(save.legacyDeco) || !ids?.length) return;
  const drop = new Set(ids);
  save.legacyDeco = save.legacyDeco.filter((k) => !drop.has(k));
}

function addLegacyForOwned(cfg, save, keys) {
  if (!save) return;
  const leg = new Set(normList(save.legacyDeco));
  for (const k of keys || []) {
    if (!hasBonus(cfg, k)) continue;
    leg.add(k);
  }
  if (leg.size) save.legacyDeco = [...leg];
}

function collectOwnedDecoKeys(save, storedBundles) {
  const keys = new Set(Array.isArray(save?.up?.deco) ? save.up.deco : []);
  for (const b of storedBundles || []) {
    for (const k of b.ids || []) keys.add(k);
  }
  return [...keys];
}

module.exports = {
  normList,
  legacyKeys,
  hasBonus,
  coinBonusSum,
  mutationBonusSum,
  maxLegacyCoinBonus,
  validateLegacyDeco,
  stripClientLegacy,
  checkLegacyUnchanged,
  removeLegacy,
  addLegacyForOwned,
  collectOwnedDecoKeys,
};
