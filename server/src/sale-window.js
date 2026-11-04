'use strict';
// COINSINK-B1-XMAS 限時商品：availableFrom / availableUntil（ISO-8601 或毫秒時間戳，台北時區字串可含 +08:00）

function parseWhen(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** 是否在可購買窗口內（disabled 一律不可買） */
function saleActive(item, nowMs = Date.now()) {
  if (!item || item.disabled) return false;
  const from = parseWhen(item.availableFrom);
  const until = parseWhen(item.availableUntil);
  if (from != null && nowMs < from) return false;
  if (until != null && nowMs >= until) return false;
  return true;
}

/** 已擁有或窗口內才在商店列表顯示（過季下架，持有者保留） */
function shopVisible(item, owned, nowMs = Date.now()) {
  if (!item || item.disabled) return !!owned;
  return !!owned || saleActive(item, nowMs);
}

function formatTaipeiDate(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
}

function saleBadge(item, nowMs = Date.now()) {
  if (!item?.eventBadge) return '';
  const until = parseWhen(item.availableUntil);
  if (until != null && nowMs < until) return `限定 · 至 ${formatTaipeiDate(until - 1)}`;
  return item.eventBadge;
}

module.exports = { parseWhen, saleActive, shopVisible, saleBadge, formatTaipeiDate };
