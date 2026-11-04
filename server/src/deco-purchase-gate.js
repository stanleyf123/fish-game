'use strict';
// COINSINK-B1: 造景購買條件（與 deco-inventory buy 一致），供 anticheat 驗證存檔新增造景
const { saleActive } = require('./sale-window');

function isCoinsinkDeco(d) {
  return !!d && String(d.shopGroup || '').startsWith('coinsink');
}

/** @returns {null|string} 拒絕原因碼 */
function gateNewDecoPurchase(cfg, decoId, save, nowMs = Date.now()) {
  const d = cfg.decorations && cfg.decorations[decoId];
  if (!d) return 'missing';
  if (!isCoinsinkDeco(d)) return null;
  if (!saleActive(d, nowMs)) return 'sale_window';
  if (d.priceGems > 0 && !(d.cost > 0)) return 'gem_only';
  if (!(d.cost > 0)) return 'not_for_sale';
  if ((save.up?.cap || 0) < (d.minTankLevel || 0)) return 'tank_level';
  return null;
}

module.exports = { isCoinsinkDeco, gateNewDecoPurchase };
