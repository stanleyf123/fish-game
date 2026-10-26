'use strict';
// 英雄魚 API：/api/hero/*（尚未掛載；整合方式見 hero/INTEGRATION.md）
// 所有寫入皆需登入；對戰相關（opponents / challenge / leaderboard 的「我」）需註冊會員。
const express = require('express');
const { HttpError, RateLimiter, toInt } = require('../util');

module.exports = function heroRouter(ctx, hero) {
  const { players, env } = ctx;
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));
  const auth = players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const RL = () => hero.H.pvp.rateLimit;
  const mult = Number((env && env.HERO_RATE_MULT) || 1); // 測試可放寬
  const limiters = { act: new RateLimiter({ windowMs: 60000, max: 1e9 }), ch: new RateLimiter({ windowMs: 60000, max: 1e9 }), list: new RateLimiter({ windowMs: 60000, max: 1e9 }) };
  const limit = (name, key) => (req, res, next) => {
    const lim = limiters[name]; lim.max = Math.max(1, Math.round(RL()[key] * mult));
    const c = lim.check('p' + req.player.id);
    if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試')); }
    next();
  };
  const act = limit('act', 'actionsPerMin'), ch = limit('ch', 'challengesPerMin'), list = limit('list', 'listPerMin');

  r.get('/config', (req, res) => { const a = hero.heroCfg.active(); res.set('Cache-Control', 'no-cache'); res.json({ version: a.version, config: a.publicConfig }); });
  r.get('/me', auth, act, wrap((req) => hero.view(req.player)));
  r.get('/candidates', auth, act, wrap((req) => hero.candidates(req.player)));
  r.post('/pick', auth, act, wrap((req) => hero.pick(req.player, req.body && req.body.fishId, req.body && req.body.idempotencyKey)));
  r.post('/train', auth, act, wrap((req) => hero.train(req.player, req.body && req.body.type)));
  r.post('/skills/equip', auth, act, wrap((req) => hero.equipSkills(req.player, req.body && req.body.slots)));
  r.post('/skills/upgrade', auth, act, wrap((req) => hero.upgradeSkill(req.player, req.body && req.body.skillId, req.body && req.body.idempotencyKey)));
  r.post('/gear/buy', auth, act, wrap((req) => hero.buyGear(req.player, req.body && req.body.itemId, req.body && req.body.idempotencyKey)));
  r.post('/gear/equip', auth, act, wrap((req) => hero.equipGear(req.player, req.body && req.body.slot, req.body && req.body.itemId)));

  // ---- PvP（會員限定） ----
  r.get('/opponents', auth, list, wrap((req) => hero.opponents(req.player, { refresh: req.query.refresh === '1', ip: req.ip })));
  // 只接受「挑戰誰」；結果完全由伺服器模擬。任何客戶端送來的結果欄位都會被忽略。
  r.post('/tickets/refill', auth, act, wrap((req) => hero.refillTickets(req.player, req.body && req.body.idempotencyKey)));
  r.post('/challenge', auth, ch, wrap((req) => hero.challenge(req.player, req.body && req.body.opponent, { ip: req.ip })));
  r.get('/battles', auth, act, wrap((req) => hero.battles(req.player, toInt(req.query.limit, 30))));
  r.get('/battles/:id', auth, act, wrap((req) => hero.battle(req.player, toInt(req.params.id, 0))));
  r.get('/leaderboard', wrap((req, res) => {
    // 排行榜公開；有帶 token 時附上「我的名次」
    let player = null;
    const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') || '');
    if (m) { const row = ctx.db.prepare('SELECT p.* FROM player_tokens t JOIN players p ON p.id=t.player_id WHERE t.token_hash=?').get(require('../util').sha256(m[1])); if (row) player = row; }
    res.set('Cache-Control', 'no-cache');
    return hero.leaderboard(player, toInt(req.query.limit, 50));
  }));
  return r;
};
