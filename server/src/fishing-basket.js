'use strict';
// 🧺 魚簍：釣到的魚先放進魚簍（伺服器端保存，重新整理／關掉也不會不見），收竿回家時一次決定去處
// - /resolve 帶 dest:'basket' → 照常記錄魚獲（排行榜、大賽積分、XP、任務），魚放進 fishing_basket（尚未結算）
// - GET  /api/fishing/basket          → 尚未結算的魚
// - POST /api/fishing/basket/settle   {items:[{id,dest}], key}  dest = tank | slot:N | storage | sell | release
//   在交易內逐條 deliver（放不下時一樣自動退到收藏庫 → 賣掉，並回報原因）；同一把 key 重送只回第一次結果；已結算的魚不會重複發放
// - 魚簍上限 basketMax（預設 60）；滿了的話新魚直接照舊放魚缸（不會讓魚消失）
const { HttpError } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fishing_basket(id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, cast_id TEXT NOT NULL UNIQUE, spot TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL, settled_at INTEGER, dest TEXT, coins INTEGER);
CREATE INDEX IF NOT EXISTS idx_fishing_basket_open ON fishing_basket(player_id,settled_at);
`;
const DEST_RE = /^(tank|storage|sell|release|slot:[1-3])$/;
const pub = (r) => { const o = JSON.parse(r.outcome); return { id: r.id, sp: o.id, r: o.r, cm: o.cm, kg: o.kg, variant: o.variant || null, giant: !!o.giant, ratio: o.ratio || 1, spot: r.spot, t: r.created_at }; };

function install(Fishing) {
  const P = Fishing.prototype;
  P.basketInit = function () { if (!this._basketInit) { this.db.exec(SCHEMA); this._basketInit = true; } };
  P.basketMax = function () { const n = Number(this.cfg().basketMax); return Number.isInteger(n) && n >= 5 && n <= 200 ? n : 60; };
  P.basketList = function (pid) { this.basketInit(); return this.db.prepare('SELECT * FROM fishing_basket WHERE player_id=? AND settled_at IS NULL ORDER BY id').all(pid).map(pub); };
  // resolveTx 內呼叫（已在交易中）
  P.toBasket = function (pid, p, o, castId, spotId, t) {
    this.basketInit();
    const n = this.db.prepare('SELECT COUNT(*) n FROM fishing_basket WHERE player_id=? AND settled_at IS NULL').get(pid).n;
    if (n >= this.basketMax()) { const d = this.deliver(pid, p, o, 'tank', spotId, t); return Object.assign(d, { reason: ['basket_full', d.reason].filter(Boolean).join(',') }); }
    const r = this.db.prepare('INSERT INTO fishing_basket(player_id,cast_id,spot,outcome,created_at) VALUES(?,?,?,?,?)').run(pid, castId, spotId, JSON.stringify(o), t);
    return { dest: 'basket', basketId: Number(r.lastInsertRowid) };
  };
  P.basketSettle = function (pid, body) {
    this.guard(); this.basketInit();
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length || items.length > 200) throw new HttpError(400, 'invalid_request', '請選擇要整理的魚');
    for (const it of items) if (!it || !Number.isInteger(it.id) || typeof it.dest !== 'string' || !DEST_RE.test(it.dest)) throw new HttpError(400, 'dest', '請選擇放魚的位置');
    if (new Set(items.map((x) => x.id)).size !== items.length) throw new HttpError(400, 'invalid_request', '同一條魚只能選一次');
    return this.db.transaction(() => this.once(pid, body.key, body, () => {
      const t = this.now(), p = this.profile(pid), results = []; let xp = 0;
      const get = this.db.prepare('SELECT * FROM fishing_basket WHERE id=? AND player_id=?');
      for (const it of items) {
        const row = get.get(it.id, pid);
        if (!row) { results.push({ id: it.id, dest: null, error: 'not_found' }); continue; }
        if (row.settled_at) { results.push({ id: it.id, dest: row.dest, coins: row.coins || 0, error: 'already_settled' }); continue; }
        const o = JSON.parse(row.outcome); let d;
        if (it.dest === 'release') { d = { dest: 'release' }; xp += 5; }
        else d = this.deliver(pid, p, o, it.dest, row.spot, t);
        this.db.prepare('UPDATE fishing_basket SET settled_at=?,dest=?,coins=? WHERE id=? AND settled_at IS NULL').run(t, d.dest, d.coins || 0, row.id);
        this.db.prepare('UPDATE fishing_catches SET dest=? WHERE cast_id=? AND player_id=?').run(d.dest, row.cast_id, pid);
        results.push({ id: row.id, sp: o.id, want: it.dest, dest: d.dest, coins: d.coins || 0, reason: d.reason || null, fish: d.fish || null });
      }
      if (xp) { xp = Math.round(xp * (1 + (this.gear(p, 'wear').xp || 0) + this.charB(p, 'xp'))); p.xp += xp; while (p.xp >= this.xpNeedOf(p.lv)) { p.xp -= this.xpNeedOf(p.lv); p.lv++; } this.saveProfile(pid, p); }
      this.players.logEvent(pid, 'fishing_basket_settle', { n: results.length, dest: results.map((r) => r.dest), coins: results.reduce((a, r) => a + (r.error ? 0 : r.coins || 0), 0) });
      return { ok: true, results, xp };
    }))();
  };
}
function mountBasket(r, svc, wrap, lim, ctx) {
  r.get('/basket', lim('read'), wrap((req) => { svc.guard(); return { basket: svc.basketList(req.player.id) }; }));
  r.post('/basket/settle', lim('act'), wrap((req) => { const out = svc.basketSettle(req.player.id, req.body || {}); const row = ctx.players.getSave(req.player.id); return { ...out, save: row.save, rev: row.rev, status: svc.status(req.player.id) }; }));
}
module.exports = { install, mountBasket, SCHEMA };
