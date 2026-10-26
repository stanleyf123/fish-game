'use strict';
// v4.1.3：/api/newbie/*（新手導覽獎勵、每日簽到、成就）
const express = require('express');
const { HttpError, RateLimiter } = require('../util');
module.exports = function newbieRouter({ players, newbie, commerce }) {
  const r = express.Router(); const auth = players.auth();
  const lim = new RateLimiter({ windowMs: 60000, max: 20 });
  const limit = (req, res, next) => { const c = lim.check('p' + req.player.id); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '請求太頻繁，請稍後再試')); } next(); };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((o) => res.json(o)).catch(next);
  r.use(express.json({ limit: '4kb' }));
  r.get('/status', auth, wrap((req) => ({ ...newbie.status(req.player.id), gems: commerce.balance(req.player.id) })));
  r.post('/tutorial', auth, limit, wrap((req) => newbie.tutorial(req.player.id)));
  r.post('/daily', auth, limit, wrap((req) => newbie.daily(req.player.id)));
  r.post('/ach/:id', auth, limit, wrap((req) => newbie.achieve(req.player.id, String(req.params.id).slice(0, 20))));
  return r;
};
