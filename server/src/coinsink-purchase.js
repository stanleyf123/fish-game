'use strict';
// COINSINK-B1: server-side purchase records required before save may gain coin-sink cosmetics.

function isCoinsinkBackgroundId(id, cfg) {
  if (!id || typeof id !== 'string') return false;
  if (id.startsWith('bg_coin_')) return true;
  const b = cfg?.cosmetics?.coinBackgrounds?.[id];
  return !!b && String(b.shopGroup || '').startsWith('coinsink');
}

/** @param {import('better-sqlite3').Database} db */
function loadPurchaseSets(db, playerId) {
  const decos = new Set();
  const backgrounds = new Set();
  if (!db || playerId == null) return { decos, backgrounds };
  for (const row of db.prepare('SELECT receipt FROM deco_inventory_ops WHERE player_id=?').all(playerId)) {
    try {
      const rec = JSON.parse(row.receipt);
      if (rec.action !== 'buy') continue;
      if (rec.id) decos.add(rec.id);
      if (Array.isArray(rec.ids)) rec.ids.forEach((id) => decos.add(id));
    } catch (_) { /* ignore corrupt receipt */ }
  }
  for (const row of db.prepare('SELECT cosmetic_id FROM coin_cosmetic_ops WHERE player_id=?').all(playerId)) {
    if (row.cosmetic_id) backgrounds.add(row.cosmetic_id);
  }
  return { decos, backgrounds };
}

function verifyNewCoinsinkInSave(cfg, prev, next, purchases) {
  const suspicious = [];
  if (!next || !purchases) return suspicious;
  const po = (prev && prev.cos && prev.cos.own) || {};
  const own = (next.cos && next.cos.own) || {};
  for (const id of Object.keys(own)) {
    if (po[id]) continue;
    if (!isCoinsinkBackgroundId(id, cfg)) continue;
    const b = cfg.cosmetics?.coinBackgrounds?.[id] || cfg.cosmetics?.backgrounds?.[id];
    if (!purchases.backgrounds.has(id)) suspicious.push(`背景「${b?.name || id}」需經商店購買後才能解鎖`);
  }
  return suspicious;
}

function recordDecoBuyReceipt(db, playerId, decoId, idemKey, t = Date.now()) {
  if (!db || playerId == null || !decoId || !idemKey) return;
  const request = JSON.stringify({ action: 'buy', id: decoId });
  const receipt = JSON.stringify({ action: 'buy', id: decoId, ids: [decoId], amount: 0 });
  db.prepare('INSERT OR IGNORE INTO deco_inventory_ops(player_id,idem_key,request,receipt,created_at) VALUES(?,?,?,?,?)').run(playerId, idemKey, request, receipt, t);
}

module.exports = { isCoinsinkBackgroundId, loadPurchaseSets, verifyNewCoinsinkInSave, recordDecoBuyReceipt };
