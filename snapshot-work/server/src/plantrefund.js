'use strict';
// v4.2（待核准）：造景移除水草退款 — 伺服器端計算、每株只退一次。
// 退款＝原價 × aquascape.removeRefundRate（預設 0.5，上限 0.9），無條件捨去；以「當初的付款貨幣」退回：
//   src 'c' 金幣購買 → 退金幣（寫入雲端存檔）；src 'g' 寶石購買的插枝 → 退寶石（寶石帳本）；
//   修剪來的插枝、新手／贈送、舊存檔沒有來源紀錄 → 0。價格一律以伺服器目前設定為準。
const { HttpError } = require('./util');
const rateOf = (cfg) => { const r = Number(((cfg || {}).aquascape || {}).removeRefundRate); return Number.isFinite(r) ? Math.min(0.9, Math.max(0, r)) : 0.5; };
function refundFor(cfg, plant) {
  const P = (((cfg || {}).aquascape || {}).plants || {})[plant && plant.sp], rate = rateOf(cfg);
  if (!P || P.starter || P.free) return { kind: null, qty: 0, rate };
  if (plant.src === 'c' && P.price > 0 && !(P.priceGems > 0)) return { kind: 'coins', qty: Math.floor(P.price * rate), rate };
  if (plant.src === 'g' && P.priceGems > 0) return { kind: 'gems', qty: Math.floor(P.priceGems * rate), rate };
  return { kind: null, qty: 0, rate };
}
class PlantRefund {
  constructor({ db, configStore, players, commerce }) {
    this.db = db; this.cfgStore = configStore; this.players = players; this.commerce = commerce;
    db.exec(`CREATE TABLE IF NOT EXISTS plant_refunds (player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, plant_id TEXT NOT NULL, sp TEXT NOT NULL, src TEXT,
      kind TEXT, qty INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (player_id, plant_id));`);
  }
  quote(pid, plantId) { const cfg = this.cfgStore.active().config; const row = this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid); const s = row ? JSON.parse(row.data) : {};
    const p = (s.plants || []).find((x) => x && x.id === plantId); return p ? refundFor(cfg, p) : { kind: null, qty: 0, rate: rateOf(cfg) }; }
  remove(pid, plantId) {
    const id = String(plantId || '').slice(0, 40); if (!id) throw new HttpError(400, 'bad_plant', '缺少水草 id');
    return this.db.transaction(() => {
      const done = this.db.prepare('SELECT * FROM plant_refunds WHERE player_id=? AND plant_id=?').get(pid, id);
      const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid);
      if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
      const save = JSON.parse(row.data), cfg = this.cfgStore.active().config, i = (save.plants || []).findIndex((x) => x && x.id === id);
      if (done) {   // 已處理過：不再退款（重送／重複點擊）；若存檔裡又出現同 id，也只移除不退
        if (i >= 0) { save.plants.splice(i, 1); this.players.writeSaveRow(pid, save, row.rev + 1, Date.now(), false); return { reused: true, kind: done.kind, qty: 0, save, rev: row.rev + 1, balance: this.commerce.balance(pid) }; }
        return { reused: true, kind: done.kind, qty: 0, save, rev: row.rev, balance: this.commerce.balance(pid) };
      }
      if (i < 0) throw new HttpError(404, 'plant_not_found', '找不到這株水草（請先同步）');
      const p = save.plants[i], rf = refundFor(cfg, p), t = Date.now();
      save.plants.splice(i, 1);
      if (rf.kind === 'coins' && rf.qty > 0) save.coins = (save.coins || 0) + rf.qty;
      this.db.prepare('INSERT INTO plant_refunds (player_id, plant_id, sp, src, kind, qty, created_at) VALUES (?,?,?,?,?,?,?)').run(pid, id, p.sp, p.src || null, rf.kind, rf.qty, t);
      this.players.writeSaveRow(pid, save, row.rev + 1, t, false);
      if (rf.kind === 'coins' && rf.qty > 0) this.players.econ(t, 0, 0, rf.qty, pid);
      if (rf.kind === 'gems' && rf.qty > 0) this.commerce.ledger(pid, rf.qty, 'plant_refund', 'plant:' + id);
      this.players.logEvent(pid, 'plant_refund', { plant: id, sp: p.sp, src: p.src || null, kind: rf.kind, qty: rf.qty });
      return { kind: rf.kind, qty: rf.qty, save, rev: row.rev + 1, balance: this.commerce.balance(pid) };
    })();
  }
}
module.exports = { PlantRefund, refundFor, rateOf };
