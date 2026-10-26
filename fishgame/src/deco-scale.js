'use strict';

const MIN = 0.5;
const MAX = 2;

function clampScale(v) {
  const n = +v;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(MIN, Math.min(MAX, n)) * 100) / 100;
}

/** Clamp decoS to [0.5,2] for placed decor only; drop default 1 and unknown keys. */
function sanitizeDecoS(save) {
  if (!save?.up || typeof save.up !== 'object') return;
  const deco = Array.isArray(save.up.deco) ? save.up.deco : [];
  const raw = save.up.decoS;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    delete save.up.decoS;
    return;
  }
  const o = {};
  for (const k of deco) {
    if (raw[k] == null) continue;
    const c = clampScale(raw[k]);
    if (c != null && Math.abs(c - 1) > 0.001) o[k] = c;
  }
  if (Object.keys(o).length) save.up.decoS = o;
  else delete save.up.decoS;
}

function validateDecoS(cfg, save) {
  const errs = [];
  const raw = save?.up?.decoS;
  if (raw == null) return errs;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errs.push('up.decoS 必須是物件');
    return errs;
  }
  const deco = new Set(Array.isArray(save?.up?.deco) ? save.up.deco : []);
  for (const [k, v] of Object.entries(raw)) {
    if (!deco.has(k)) continue;
    const c = clampScale(v);
    if (c == null || c < MIN || c > MAX) errs.push(`up.decoS.${k} 超出範圍（${MIN}–${MAX}）`);
  }
  return errs;
}

module.exports = { MIN, MAX, clampScale, sanitizeDecoS, validateDecoS };
