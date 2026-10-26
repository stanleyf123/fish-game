'use strict';
// 💬 客服訊息（v4.0.5）：會員 ↔ 管理員的對話。每位會員一個對話串；文字只存純文字，前端一律跳脫後顯示。
// 掛載：app.js 在 404 handler 之前呼叫 require('./support').mountSupport(app, ctx)
// 遊戲端：/api/support/*（需登入、會員）；後台：/admin/api/support/*（後台登入＋CSRF）
const express = require('express');
const { HttpError, bad, RateLimiter, toInt } = require('./util');
const { SupportImages, parseMultipart, MAX_BYTES } = require('./support-images');   // 📷 SUP-IMG-420

const CATS = ['意見', 'Bug回報', '儲值問題', '其他'];
const MAX_LEN = 1000;
const clean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS support_threads (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '其他',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  last_msg_at INTEGER NOT NULL,
  last_from TEXT NOT NULL DEFAULT 'player',
  player_unread INTEGER NOT NULL DEFAULT 0,
  admin_unread INTEGER NOT NULL DEFAULT 0,
  msg_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_support_threads_last ON support_threads(admin_unread, last_msg_at);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, id);`);
}

class Support {
  constructor(ctx) { this.ctx = ctx; this.db = ctx.db; migrate(this.db); this.img = new SupportImages({ db: this.db, env: ctx.env || {} }); }
  threadOf(pid) { return this.db.prepare('SELECT * FROM support_threads WHERE player_id=?').get(pid) || null; }
  pubThread(t) { return t && { id: t.id, category: t.category, status: t.status, createdAt: t.created_at, lastMsgAt: t.last_msg_at, lastFrom: t.last_from, unread: t.player_unread, count: t.msg_count }; }
  messages(tid, limit = 200) {
    const ms = this.db.prepare('SELECT * FROM (SELECT id, sender, category, body, created_at FROM support_messages WHERE thread_id=? ORDER BY id DESC LIMIT ?) ORDER BY id').all(tid, limit)
      .map((m) => ({ id: m.id, from: m.sender, category: m.category, body: m.body, at: m.created_at }));
    const im = this.img.byMessages(ms.map((m) => m.id));   // 📷 SUP-IMG-420
    return ms.map((m) => (im.has(m.id) ? { ...m, images: im.get(m.id) } : m));
  }
  // ---- 玩家 ----
  playerThread(pid) { const t = this.threadOf(pid); return { thread: this.pubThread(t), messages: t ? this.messages(t.id) : [], categories: CATS, maxLen: MAX_LEN, images: { max: 3, maxBytes: MAX_BYTES } }; }
  playerUnread(pid) { const t = this.threadOf(pid); return { unread: t ? t.player_unread : 0, lastMsgAt: t ? t.last_msg_at : null }; }
  playerSend(pid, category, body, images) {
    const cat = CATS.includes(category) ? category : null;
    if (!cat) throw bad('bad_category', `分類必須是 ${CATS.join(' / ')}`);
    const text = clean(body);
    const imgIds = this.img.claimable({ uploader: 'player', playerId: pid }, images);
    if (!text && !imgIds.length) throw bad('empty', '請輸入訊息內容');
    if (text.length > MAX_LEN) throw bad('too_long', `訊息最多 ${MAX_LEN} 字`);
    const t = Date.now();
    return this.db.transaction(() => {
      let th = this.threadOf(pid);
      if (!th) { const id = this.db.prepare('INSERT INTO support_threads (player_id, category, status, created_at, last_msg_at, last_from) VALUES (?,?,?,?,?,?)').run(pid, cat, 'open', t, t, 'player').lastInsertRowid; th = this.db.prepare('SELECT * FROM support_threads WHERE id=?').get(id); }
      const mid = this.db.prepare('INSERT INTO support_messages (thread_id, sender, category, body, created_at) VALUES (?,?,?,?,?)').run(th.id, 'player', cat, text, t).lastInsertRowid;
      this.img.attach(imgIds, mid, th.id);
      this.db.prepare("UPDATE support_threads SET category=?, status='open', last_msg_at=?, last_from='player', admin_unread=admin_unread+1, msg_count=msg_count+1 WHERE id=?").run(cat, t, th.id);
      this.ctx.players.logEvent && this.ctx.players.logEvent(pid, 'support_message', { category: cat, len: text.length, ...(imgIds.length ? { images: imgIds.length } : {}) });
      return this.playerThread(pid);
    })();
  }
  playerRead(pid) { this.db.prepare('UPDATE support_threads SET player_unread=0 WHERE player_id=?').run(pid); return { ok: true }; }
  // ---- 後台 ----
  adminUnread() { const r = this.db.prepare('SELECT COUNT(*) threads, COALESCE(SUM(admin_unread),0) msgs FROM support_threads WHERE admin_unread>0').get(); return { threads: r.threads, messages: r.msgs }; }
  adminList({ status, category, q, limit = 100 } = {}) {
    const w = [], a = [];
    if (status === 'open' || status === 'closed') { w.push('t.status=?'); a.push(status); }
    if (CATS.includes(category)) { w.push('t.category=?'); a.push(category); }
    const qs = String(q || '').trim();
    if (qs) { if (/^#?\d+$/.test(qs)) { w.push('t.player_id=?'); a.push(+qs.replace('#', '')); } else { w.push('(p.email LIKE ? OR p.username LIKE ? OR p.nickname LIKE ?)'); const like = '%' + qs.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; a.push(like, like, like); } }
    const sql = `SELECT t.*, p.email, p.username, p.nickname, (SELECT body FROM support_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) last_body
      FROM support_threads t JOIN players p ON p.id=t.player_id ${w.length ? 'WHERE ' + w.join(' AND ').replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'") : ''}
      ORDER BY (t.admin_unread>0) DESC, t.last_msg_at DESC LIMIT ?`;
    return { threads: this.db.prepare(sql).all(...a, Math.min(500, Math.max(1, limit))).map((t) => ({ id: t.id, playerId: t.player_id, account: t.email || t.username || null, nickname: t.nickname, category: t.category, status: t.status,
      lastMsgAt: t.last_msg_at, lastFrom: t.last_from, adminUnread: t.admin_unread, count: t.msg_count, preview: String(t.last_body || '').slice(0, 80) || '📷 圖片' })), categories: CATS, unread: this.adminUnread() };
  }
  adminThread(id) {
    const t = this.db.prepare('SELECT * FROM support_threads WHERE id=?').get(id);
    if (!t) throw new HttpError(404, 'not_found', '找不到這個對話');
    this.db.prepare('UPDATE support_threads SET admin_unread=0 WHERE id=?').run(id);
    const p = this.db.prepare('SELECT id, email, username, nickname, created_at, last_seen, banned_at FROM players WHERE id=?').get(t.player_id) || {};
    let save = null; try { const r = this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(t.player_id); save = r ? JSON.parse(r.data) : null; } catch (e) { save = null; }
    const cfg = this.ctx.configStore.active().config;
    const T = (cfg.mechanics && cfg.mechanics.progression && cfg.mechanics.progression.foundThresholds) || [0];
    const found = save && save.found ? Object.keys(save.found).length : 0; let level = 1; T.forEach((x, i) => { if (found >= x) level = i + 1; });
    let gems = null; try { gems = this.ctx.commerce.balance(t.player_id); } catch (e) { gems = null; }
    let orders = []; try { orders = this.db.prepare('SELECT id, product_name, amount, currency, status, provider, created_at FROM orders WHERE player_id=? ORDER BY created_at DESC LIMIT 5').all(t.player_id)
      .map((o) => ({ id: o.id, name: o.product_name, amount: o.amount, currency: o.currency, status: o.status, provider: o.provider, at: o.created_at })); } catch (e) { orders = []; }
    return { thread: { id: t.id, playerId: t.player_id, category: t.category, status: t.status, createdAt: t.created_at, lastMsgAt: t.last_msg_at, count: t.msg_count },
      player: { id: p.id, account: p.email || p.username || null, nickname: p.nickname, createdAt: p.created_at, lastSeen: p.last_seen, banned: !!p.banned_at, level, found, coins: save ? Math.floor(save.coins || 0) : null, fish: save && save.fish ? save.fish.length : null, gems },
      orders, messages: this.messages(t.id, 500), unread: this.adminUnread() };
  }
  adminReply(id, body, images) {
    const text = clean(body);
    if (text.length > 2000) throw bad('too_long', '回覆最多 2000 字');
    const t = this.db.prepare('SELECT * FROM support_threads WHERE id=?').get(id);
    if (!t) throw new HttpError(404, 'not_found', '找不到這個對話');
    const imgIds = this.img.claimable({ uploader: 'admin', playerId: t.player_id, threadId: t.id }, images);
    if (!text && !imgIds.length) throw bad('empty', '請輸入回覆內容');
    const now = Date.now();
    this.db.transaction(() => {
      const mid = this.db.prepare('INSERT INTO support_messages (thread_id, sender, category, body, created_at) VALUES (?,?,?,?,?)').run(id, 'admin', null, text, now).lastInsertRowid;
      this.img.attach(imgIds, mid, id);
      this.db.prepare("UPDATE support_threads SET last_msg_at=?, last_from='admin', player_unread=player_unread+1, admin_unread=0, msg_count=msg_count+1 WHERE id=?").run(now, id);
    })();
    return this.adminThread(id);
  }
  adminStatus(id, status) {
    if (!['open', 'closed'].includes(status)) throw bad('bad_status', 'status 必須是 open 或 closed');
    const r = this.db.prepare('UPDATE support_threads SET status=? WHERE id=?').run(status, id);
    if (!r.changes) throw new HttpError(404, 'not_found', '找不到這個對話');
    return this.adminThread(id);
  }
}

function mountSupport(app, ctx) {
  const sup = new Support(ctx); ctx.support = sup;
  const env = ctx.env || {};
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const sendLim = new RateLimiter({ windowMs: 10 * 60000, max: toInt(env.SUPPORT_MSG_PER_10MIN, 10) });
  const readLim = new RateLimiter({ windowMs: 60000, max: 60 });
  // 玩家
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));
  r.use(ctx.players.auth());
  r.use((req, res, next) => { if (!req.player.username) return next(new HttpError(403, 'members_only', '客服訊息只開放給註冊會員，請先註冊或登入')); next(); });
  const lim = (L) => (req, res, next) => { const c = L.check('s' + req.player.id); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '訊息太頻繁，請稍後再試')); } next(); };
  r.get('/thread', lim(readLim), wrap((req) => sup.playerThread(req.player.id)));
  r.get('/unread', lim(readLim), wrap((req) => sup.playerUnread(req.player.id)));
  r.post('/messages', lim(sendLim), wrap((req) => sup.playerSend(req.player.id, req.body && req.body.category, req.body && req.body.body, req.body && req.body.images)));
  // 📷 SUP-IMG-420：上傳（multipart，欄位 image）、讀取（只限自己的對話串）、移除待送出的圖
  const raw = express.raw({ type: 'multipart/form-data', limit: MAX_BYTES + 512 * 1024 });
  const imgLim = new RateLimiter({ windowMs: 60000, max: 300 });
  const onePart = (req) => { const mp = parseMultipart(req.body, req.get('content-type')); const f = mp.files.find((x) => x.name === 'image') || mp.files[0]; if (!f) throw bad('no_file', '請選擇圖片'); return f; };
  r.post('/uploads', raw, wrap(async (req) => sup.img.upload({ uploader: 'player', playerId: req.player.id }, onePart(req))));
  r.get('/images/:token', lim(imgLim), (req, res, next) => { const im = sup.img.get(req.params.token, { playerId: req.player.id }); if (!im) return next(new HttpError(404, 'not_found', '找不到這張圖片')); sup.img.send(res, im); });
  r.delete('/images/:token', wrap((req) => sup.img.removePending(req.params.token, { uploader: 'player', playerId: req.player.id })));
  r.post('/read', lim(readLim), wrap((req) => sup.playerRead(req.player.id)));
  app.use('/api/support', r);
  // 後台
  const a = express.Router();
  a.use(express.json({ limit: '50kb' }));
  a.use(ctx.adminAuth.require());
  const audit = (req, action, target, detail) => ctx.adminAuth.audit(req, action, target, detail);
  a.get('/unread', wrap(() => sup.adminUnread()));
  a.get('/threads', wrap((req) => sup.adminList({ status: req.query.status, category: req.query.category, q: req.query.q })));
  a.get('/threads/:id', wrap((req) => sup.adminThread(toInt(req.params.id, 0))));
  a.post('/threads/:id/reply', wrap((req) => { const id = toInt(req.params.id, 0); const out = sup.adminReply(id, req.body && req.body.body, req.body && req.body.images); audit(req, 'support.reply', 'thread:' + id, { len: String((req.body && req.body.body) || '').length, ...(Array.isArray(req.body && req.body.images) && req.body.images.length ? { images: req.body.images.length } : {}) }); return out; }));
  // 📷 SUP-IMG-420（後台登入＋CSRF；上傳路徑放在 /admin/api/support/uploads/ 方便 nginx 單獨放寬上傳大小）
  const araw = express.raw({ type: 'multipart/form-data', limit: MAX_BYTES + 512 * 1024 });
  a.post('/uploads/:threadId', araw, wrap(async (req) => {
    const t = sup.db.prepare('SELECT id, player_id FROM support_threads WHERE id=?').get(toInt(req.params.threadId, 0));
    if (!t) throw new HttpError(404, 'not_found', '找不到這個對話');
    const mp = parseMultipart(req.body, req.get('content-type')); const f = mp.files.find((x) => x.name === 'image') || mp.files[0]; if (!f) throw bad('no_file', '請選擇圖片');
    return sup.img.upload({ uploader: 'admin', playerId: t.player_id, threadId: t.id }, f);
  }));
  a.get('/images/:token', (req, res, next) => { const im = sup.img.get(req.params.token, { admin: true }); if (!im) return next(new HttpError(404, 'not_found', '找不到這張圖片')); sup.img.send(res, im); });
  a.delete('/images/:token', wrap((req) => sup.img.removePending(req.params.token, { uploader: 'admin' })));
  a.post('/threads/:id/status', wrap((req) => { const id = toInt(req.params.id, 0); const out = sup.adminStatus(id, req.body && req.body.status); audit(req, 'support.status', 'thread:' + id, { status: req.body && req.body.status }); return out; }));
  app.use('/admin/api/support', a);
  return sup;
}

module.exports = { mountSupport, Support, migrate, CATS };
