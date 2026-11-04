'use strict';
// v4.2-auth：/api/auth/providers、/api/auth/google、/api/auth/line/*、/api/auth/unlink、/api/auth/identities
const express = require('express');
const { HttpError, RateLimiter, sha256 } = require('../util');

module.exports = function oauthRouter({ db, players, oauth, newbie }) {
  const r = express.Router();
  const auth = players.auth();
  // 有帶 token 就認得目前玩家（訪客或會員），沒帶或失效就當作未登入
  const optAuth = (req, res, next) => {
    const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') || ''); req.player = null;
    if (m) { const row = db.prepare('SELECT p.* FROM player_tokens t JOIN players p ON p.id=t.player_id WHERE t.token_hash=?').get(sha256(m[1])); if (row) { if (row.banned_at) return next(new HttpError(403, 'banned', '此帳號已被停權')); req.player = row; } }
    next();
  };
  const lims = { verify: new RateLimiter({ windowMs: 10 * 60000, max: 20 }), begin: new RateLimiter({ windowMs: 10 * 60000, max: 20 }), cb: new RateLimiter({ windowMs: 10 * 60000, max: 30 }), unlink: new RateLimiter({ windowMs: 10 * 60000, max: 10 }) };
  const limit = (lim, keyFn) => (req, res, next) => { const c = lim.check(keyFn(req)); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '請求太頻繁，請稍後再試')); } next(); };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => {
    if (out === undefined || res.headersSent) return;
    if (out.status === 'choice_needed') return res.status(409).json({ error: 'choice_needed', message: '這個帳號已經有雲端魚缸', account: out.account });
    if (out.status === 'ok' && out.player && newbie) out.signupBonus = newbie.signupBonus(out.player.id);   // v4.1.3 註冊送寶石（一次）；信箱會員綁定 Google／LINE 也算註冊（每帳號仍只發一次）
    res.json(out);
  }).catch(next);
  const json = express.json({ limit: '16kb' });
  const body = (req) => req.body || {};

  r.get('/providers', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(oauth.providers()); });
  r.post('/google', limit(lims.verify, (req) => req.ip + '|g'), json, optAuth, wrap(async (req) => {
    const b = body(req); const info = await oauth.verifyGoogle(b.credential);
    return oauth.resolve(info, req.player, { mode: b.mode === 'bind' ? 'bind' : 'login', choice: b.choice, guestProgress: !!b.guestProgress });
  }));
  r.post('/line/begin', limit(lims.begin, (req) => req.ip + '|lb'), json, optAuth, wrap((req) => oauth.lineBegin(req.player, body(req).mode)));
  r.get('/line/callback', limit(lims.cb, (req) => req.ip + '|lc'), wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.redirect(302, await oauth.lineCallback(req.query || {})); }));
  r.post('/line/result', limit(lims.verify, (req) => req.ip + '|lr'), json, optAuth, wrap((req) => oauth.lineResult(body(req).r, req.player, body(req))));
  r.post('/unlink', auth, limit(lims.unlink, (req) => 'p' + req.player.id), json, wrap((req) => oauth.unlink(req.player.id, String(body(req).provider || ''))));
  r.get('/identities', auth, wrap((req) => ({ identities: oauth.identities(req.player.id) })));
  return r;
};
