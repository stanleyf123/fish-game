'use strict';
// v4.2：換水／清潔要花金幣，價格依魚缸容量（空間格數）計算；設定 water.costs（後台可改）
// cost = round5(base + perSpace × 容量)，最少 min；同一份公式也寫在遊戲網頁（wcCost）
const DEF = { enabled: true, small: { base: 10, perSpace: 0.8 }, big: { base: 20, perSpace: 1.8 }, clean: { base: 5, perSpace: 0.5 }, round: 5, min: 5 };
const KINDS = { small: 'paidSmall', big: 'paidBig', clean: 'paidClean' };
function costsOf(cfg) { const c = ((cfg && cfg.water) || {}).costs || {}; return { ...DEF, ...c, small: { ...DEF.small, ...(c.small || {}) }, big: { ...DEF.big, ...(c.big || {}) }, clean: { ...DEF.clean, ...(c.clean || {}) } }; }
function costOf(cfg, kind, cap) {
  const C = costsOf(cfg); if (C.enabled === false) return 0; const k = C[kind]; if (!k) return 0;
  const r = Math.max(1, C.round || 1), v = (k.base || 0) + (k.perSpace || 0) * Math.max(0, cap || 0);
  return Math.max(C.min || 0, Math.round(v / r) * r);
}
module.exports = { costOf, costsOf, KINDS, DEF };
