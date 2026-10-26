'use strict';
// RENAME-HARBOR 2026-10-23：玩家看到的「漁港」文字改為「好友」（錯誤代碼／API 不變）
// 🐣 每日繁殖次數（台北時間）：自家魚缸與好友借魚各有免費額度，加購次數共用
//  - 每天免費 freePerDay 次（預設 3）；另有好友借魚 harborFreePerDay 次（預設 1）免費
//  - 之後用 💎 加購，價格遞增 extraGems（預設 10/20/30/40/50），超過設定價目後按最後一級差額持續累加，沒有每日加購上限
//  - 月卡 +2（只加自家魚缸免費次數）：cardPerk=true 時才生效（v4.1 開啟），現在保留掛鉤
//  - 自家繁殖：客戶端先 POST /api/breed/use 取得一次性 token，寶寶帶 bt=token；存檔時伺服器核對並註銷
//  - 防作弊：新出現、只能繁殖得到的魚（突變／混種／限定／只能繁殖）必須帶有效 token；一般魚沒有 token 視為用金幣買
const crypto = require('crypto');
const express = require('express');
const { HttpError, RateLimiter } = require('./util');
const Hybrid = require('./hybrid');

const DEFAULTS = { enabled: true, freePerDay: 3, harborFreePerDay: 1, extraGems: [10, 20, 30, 40, 50], maxExtraPerDay: 5, cardPerk: false };
function blCfg(cfg) { const b = (cfg && cfg.breedLimit) || {}; return { ...DEFAULTS, ...b, extraGems: Array.isArray(b.extraGems) && b.extraGems.length ? b.extraGems : DEFAULTS.extraGems }; }

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS breed_uses (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  free INTEGER NOT NULL DEFAULT 1,
  gems INTEGER NOT NULL DEFAULT 0,
  idem_key TEXT,
  token TEXT,
  child_id TEXT,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_breed_uses_day ON breed_uses(player_id, day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_breed_uses_token ON breed_uses(token);`);
}

// 這個魚種能不能用金幣直接買（不能買的只能靠繁殖／伺服器發放）
function coinBuyable(cfg, sp) {
  if (Hybrid.isHybrid(sp)) return false;
  const s = cfg.species && cfg.species[sp];
  return !!(s && !s.breedOnly && !s.premium && !(s.priceGems > 0) && (s.price || 0) > 0);
}

class BreedLimit {
  constructor(ctx) {
    this.ctx = ctx; this.db = ctx.db;
    this.now = () => (ctx.social && ctx.social.now ? ctx.social.now() : Date.now()); // 測試可共用漁港的時鐘
    this.day = (ms) => ctx.commerce.day(ms == null ? this.now() : ms);
    this.lim = new RateLimiter({ windowMs: 60000, max: 30 });
  }
  C() { return blCfg(this.ctx.configStore.active().config); }
  cardBonus(pid) { const C = this.C(); if (!C.cardPerk || !this.ctx.commerce) return 0; return Math.max(0, Math.min(10, Number(this.ctx.commerce.vipPerks(pid).extraBreeds) || 0)); }
  today(pid) {
    const C = this.C(), d = this.day(this.now());
    const r = this.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(free),0) fr, COALESCE(SUM(CASE WHEN free=1 AND source='own' THEN 1 ELSE 0 END),0) ofr, COALESCE(SUM(CASE WHEN free=1 AND source='harbor' THEN 1 ELSE 0 END),0) hf, COALESCE(SUM(CASE WHEN source='harbor' THEN 1 ELSE 0 END),0) h FROM breed_uses WHERE player_id=? AND day=?").get(pid, d);
    const card = this.cardBonus(pid), freeTotal = C.freePerDay + card, extrasUsed = r.n - r.fr, extrasLeft = null;
    const L=C.extraGems,step=Math.max(1,L.length>1?L[L.length-1]-L[L.length-2]:L[0]),price=extrasUsed<L.length?L[extrasUsed]:L[L.length-1]+(extrasUsed-L.length+1)*step;
    const ownFreeLeft = Math.max(0, freeTotal - r.ofr);
    const harborFreeLeft = Math.max(0, C.harborFreePerDay - r.hf);
    return { day: d, enabled: C.enabled !== false, used: r.n, freeTotal, freeUsed: r.ofr, allFreeUsed:r.fr, freeLeft: ownFreeLeft, harborFreeTotal: C.harborFreePerDay, harborFreeUsed: r.hf, harborFreeLeft, harborUsed: r.h,
      extrasUsed, extrasLeft, maxExtra: null, unlimitedExtras:true, nextGems: price, card,
      // 下一次（自家／漁港）要花多少寶石：0＝免費，加購價隨次數增加，沒有每日次數上限
      ownNext: ownFreeLeft > 0 ? 0 : price, harborNext: harborFreeLeft > 0 ? 0 : price };
  }
  // 在呼叫端的交易裡記一次繁殖（source：own｜harbor）；回傳 { row, gems, today }。寶石在這裡扣（伺服器帳本）
  record(pid, source, { idem = null, ref = '' } = {}) {
    const C = this.C(), td = this.today(pid), t = this.now();
    if (C.enabled === false) { const id = this.db.prepare('INSERT INTO breed_uses (player_id, day, source, free, gems, idem_key, token, created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid, td.day, source, 1, 0, idem, source === 'own' ? crypto.randomBytes(12).toString('hex') : null, t).lastInsertRowid; return { row: this.db.prepare('SELECT * FROM breed_uses WHERE id=?').get(id), gems: 0, balance: null }; }
    const next = source === 'harbor' ? td.harborNext : td.ownNext;
    if (next == null) throw new HttpError(429, 'breed_limit', `今天的繁殖次數已用完（免費 ${td.freeTotal} 次＋加購 ${td.maxExtra} 次），台北時間午夜重置`, { today: td });
    let balance = null;
    if (next > 0) {
      const p = this.ctx.players.get(pid);
      if (!p || !p.username) throw new HttpError(403, 'members_only', source === 'harbor' ? `今天的好友借魚免費繁殖已用完，加購需要 💎${next}（會員限定）` : `今天的免費繁殖已用完，加購需要 💎${next}：請先註冊會員`);
      const bal = this.ctx.commerce.balance(pid);
      if (bal < next) throw new HttpError(402, 'insufficient_gems', `寶石不足：加購繁殖需要 💎${next}，你有 💎${bal}`, { need: next, balance: bal, today: td });
    }
    const id = this.db.prepare('INSERT INTO breed_uses (player_id, day, source, free, gems, idem_key, token, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(pid, td.day, source, next > 0 ? 0 : 1, next || 0, idem, source === 'own' ? crypto.randomBytes(12).toString('hex') : null, t).lastInsertRowid;
    if (next > 0) balance = this.ctx.commerce.ledger(pid, -next, 'spend', 'breed-extra:' + id + (ref ? ':' + ref : ''));
    return { row: this.db.prepare('SELECT * FROM breed_uses WHERE id=?').get(id), gems: next || 0, balance };
  }
  // 自家魚缸繁殖：拿一次性 token（同一個 idempotencyKey 重送 → 回傳同一筆，不重複扣）
  use(pid, body) {
    const idem = typeof (body && body.idempotencyKey) === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.idempotencyKey) ? body.idempotencyKey : null;
    if (!idem) throw new HttpError(400, 'bad_request', '缺少 idempotencyKey');
    return this.db.transaction(() => {
      const ex = this.db.prepare('SELECT * FROM breed_uses WHERE player_id=? AND idem_key=?').get(pid, idem);
      if (ex) return { token: ex.token, gems: ex.gems, reused: true, balance: this.ctx.commerce.balance(pid), today: this.today(pid) };
      const r = this.record(pid, 'own', { idem });
      this.ctx.players.logEvent(pid, 'breed_use', { gems: r.gems, free: !!r.row.free });
      return { token: r.row.token, gems: r.gems, balance: r.balance == null ? this.ctx.commerce.balance(pid) : r.balance, today: this.today(pid) };
    })();
  }
  usesBetween(pid, t0, t1) { return this.db.prepare('SELECT COUNT(*) n FROM breed_uses WHERE player_id=? AND created_at>? AND created_at<=?').get(pid, t0, t1).n; }
  // 存檔檢查（在 putSave 交易裡呼叫）：回傳 { suspicious, spent, commit() }
  verify(pid, cfg, prev, next) {
    const out = { suspicious: [], limit: [], spent: 0, commit: () => {} }; /*V406*/
    if (!prev || !next || !Array.isArray(next.fish) || blCfg(cfg).enabled === false) return out;
    const prevIds = new Set((prev.fish || []).map((f) => f.id)), use = [], unregIds = [];
    for (const f of next.fish) {
      if (prevIds.has(f.id)) continue;
      if(Hybrid.isHybrid(f.sp)||Hybrid.breedFee(cfg,f.sp,f.sp).gems>0){out.limit.push('雜交與付費血統繁殖需先確認鑽石費用，請重新開啟繁殖功能（尚未扣款）');continue;}
      if (typeof f.bt === 'string' && f.bt) {
        const row = this.db.prepare("SELECT * FROM breed_uses WHERE token=? AND player_id=? AND source='own'").get(f.bt, pid);
        if (!row || (row.consumed_at && row.child_id !== f.id) || use.some((u) => u.id === row.id)) { out.suspicious.push('繁殖紀錄無效或重複使用'); continue; }
        use.push({ id: row.id, child: f.id });
      } else if (coinBuyable(cfg, f.sp)) out.spent += cfg.species[f.sp].price || 0; // 一般魚：視為用金幣購買
      else unregIds.push(f.id);
    }
    // 沒有 token 的繁殖（舊版網頁、尚未重新整理的分頁）：今天還有免費次數就直接記一次（不扣寶石）；超過才算可疑
    let auto = [];
    if (unregIds.length) { const td = this.today(pid); if (unregIds.length <= td.freeLeft) auto = unregIds; else { out.limit.push(`有 ${unregIds.length} 條新繁殖的魚超過今天的繁殖次數（免費只剩 ${td.freeLeft} 次、也沒有加購紀錄）`); out.limitInfo = { newBred: unregIds.length, freeLeft: td.freeLeft, freeUsed: td.freeUsed, freeTotal: td.freeTotal, extraUsed: td.extraUsed }; } }
    out.commit = () => { const t = this.now(), d = this.day(t);
      for (const u of use) this.db.prepare('UPDATE breed_uses SET consumed_at=COALESCE(consumed_at, ?), child_id=? WHERE id=?').run(t, u.child, u.id);
      for (const id of auto) this.db.prepare("INSERT INTO breed_uses (player_id, day, source, free, gems, child_id, consumed_at, created_at) VALUES (?,?,'own',1,0,?,?,?)").run(pid, d, String(id).slice(0, 64), t, t); };
    out.autoRegistered = auto.length;
    return out;
  }
}

function mountBreedLimit(app, ctx) {
  migrate(ctx.db);
  require('./breed-birth').migrateBirth(ctx.db);
  const bl = new BreedLimit(ctx);
  ctx.breedLimit = bl;
  ctx.players.breedQuotaRef = { current: bl };
  ctx.players.breedVerify = (pid, cfg, prev, next) => bl.verify(pid, cfg, prev, next);
  const r = express.Router();
  const auth = ctx.players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((o) => { if (o !== undefined && !res.headersSent) res.json(o); }).catch(next);
  const lim = (req, res, next) => { const c = bl.lim.check('b' + req.player.id); if (!c.ok) return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試', { retryAfter: c.retryAfter })); next(); };
  r.use(express.json({ limit: '16kb' }));
  r.get('/today', auth, wrap((req) => ({ today: bl.today(req.player.id), gems: ctx.commerce.balance(req.player.id) })));
  r.post('/use', auth, lim, wrap((req) => bl.use(req.player.id, req.body)));
  r.get('/lineage',auth,wrap(req=>require('./breed-birth').lineage(ctx,req.player.id,req.query.fishId)));
  r.post('/quote', auth, lim, wrap(req=>require('./breed-birth').quote(ctx,bl,req.player.id,req.body.parents)));
  r.post('/birth', auth, lim, wrap(req=>require('./breed-birth').birth(ctx,bl,req.player.id,req.body)));
  app.use('/api/breed', r);
  return bl;
}
module.exports = { mountBreedLimit, BreedLimit, blCfg, coinBuyable, DEFAULTS, migrate };
