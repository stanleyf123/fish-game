'use strict';
// v4.1.4：/api/invite/me — 我的邀請連結與成果（會員才有連結；同時結算已符合條件的邀請）
const express = require('express');
module.exports = function inviteRouter({ players, invite }) {
  const r = express.Router(); const auth = players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((o) => res.json(o)).catch(next);
  r.get('/me', auth, wrap((req) => invite.status(req.player.id, req.ip)));
  return r;
};
