'use strict';
// 英雄魚後台 API：/admin/api/hero/*（需後台登入；寫入需 CSRF；所有寫入記錄到 audit_log）
const express = require('express');
const { HttpError, bad, toInt, clampStr, parseJSON } = require('../util');
const { validateHeroConfig } = require('./config');
const { HERO_DEFAULT_CONFIG } = require('./default-config');
const { runBalance } = require('./balance');
const S = require('./stats');

module.exports = function heroAdminRouter(ctx, hero) {
  const { db, adminAuth } = ctx;
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));
  r.use(adminAuth.require());
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const audit = (req, action, target, detail) => adminAuth.audit(req, action, target, detail);
  const store = hero.heroCfg;

  // ---------- 設定 ----------
  r.get('/config', wrap(() => { const a = store.active(); return { version: a.version, createdAt: a.createdAt, config: a.config, defaults: HERO_DEFAULT_CONFIG }; }));
  r.post('/config/validate', wrap((req) => ({ errors: validateHeroConfig(req.body && req.body.config) })));
  r.put('/config', wrap((req) => {
    const { config, note, baseVersion } = req.body || {};
    const cur = store.active().version;
    if (baseVersion != null && baseVersion !== cur) throw new HttpError(409, 'stale', `設定已被更新為 v${cur}，請重新載入後再編輯`, { version: cur });
    const v = store.save(config, note || '後台編輯', 'admin');
    audit(req, 'hero.config.save', 'v' + v, { note, from: cur });
    hero.startWarmup(); // 設定改了：背景重新計算公平係數
    return { version: v };
  }));
  r.get('/config/versions', wrap(() => ({ versions: store.list(100), active: store.active().version })));
  r.post('/config/rollback/:v', wrap((req) => { const v = store.rollback(toInt(req.params.v, 0), 'admin'); audit(req, 'hero.config.rollback', 'v' + v, { to: toInt(req.params.v, 0) }); return { version: v }; }));

  // ---------- 平衡模擬（取樣：每個魚種隨機對手 N 場；完整版請跑測試） ----------
  r.post('/balance', wrap((req) => {
    const b = req.body || {};
    const level = Math.max(1, Math.min(50, toInt(b.level, 10))), opponents = Math.max(4, Math.min(40, toInt(b.opponents, 12)));
    const cfg = b.config || store.active().config;
    const errs = validateHeroConfig(cfg); if (errs.length) throw new HttpError(422, 'invalid_config', '設定驗證失敗', { errors: errs });
    const t = Date.now();
    const out = runBalance(cfg, ctx.configStore.active().config, { level, opponents, seed: 4242 });
    return { level, ms: Date.now() - t, battles: out.battles, timeouts: out.timeouts, avgActions: out.avgActions, families: out.families, rows: out.rows.map((x) => ({ id: x.id, name: x.name, family: x.family, winrate: x.winrate, games: x.games, power: x.power, hp: x.hp, atk: x.atk, def: x.def, spd: x.spd, crit: x.crit, skills: x.skills, fair: x.fair })) };
  }));

  // ---------- 英雄／排行榜 ----------
  r.get('/overview', wrap(() => {
    const t = Date.now();
    const q = (sql, ...a) => db.prepare(sql).get(...a);
    return {
      heroes: q('SELECT COUNT(*) n FROM heroes').n, active: q('SELECT COUNT(*) n FROM heroes WHERE active=1').n, banned: q('SELECT COUNT(*) n FROM heroes WHERE pvp_banned_at IS NOT NULL').n,
      battles24h: q('SELECT COUNT(*) n FROM hero_battles WHERE created_at>?', t - 86400000).n, pvp24h: q('SELECT COUNT(*) n FROM hero_battles WHERE created_at>? AND defender_id IS NOT NULL', t - 86400000).n,
      flagged7d: q("SELECT COUNT(*) n FROM hero_battles WHERE created_at>? AND flags<>'[]'", t - 7 * 86400000).n,
      season: hero.currentSeason(), warmup: hero.warmupStatus(),
      rankDist: db.prepare('SELECT rating FROM heroes h JOIN players p ON p.id=h.player_id WHERE p.username IS NOT NULL').all().reduce((m, r) => { const k = S.rankOf(hero.H, r.rating).name; m[k] = (m[k] || 0) + 1; return m; }, {}),
      species: db.prepare('SELECT species, COUNT(*) n FROM heroes GROUP BY species ORDER BY n DESC LIMIT 10').all().map((x) => ({ ...x, name: (S.speciesDef(hero.G, x.species) || {}).name || x.species })),
    };
  }));
  r.get('/leaderboard', wrap((req) => hero.leaderboard(null, toInt(req.query.limit, 100))));
  r.get('/heroes', wrap((req) => {
    const where = [], args = [];
    if (req.query.q) { const q = String(req.query.q); if (/^\d+$/.test(q)) { where.push('h.player_id=?'); args.push(Number(q)); } else { where.push('(p.nickname LIKE ? OR p.username LIKE ? OR h.species LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); } }
    if (req.query.banned === '1') where.push('h.pvp_banned_at IS NOT NULL');
    const rows = db.prepare(`SELECT h.*, p.nickname, p.username FROM heroes h JOIN players p ON p.id=h.player_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY h.rating DESC LIMIT 200`).all(...args);
    return { heroes: rows.map((h) => { const rk = S.rankOf(hero.H, h.rating), def = S.speciesDef(hero.G, h.species); return { playerId: h.player_id, nickname: h.nickname, username: h.username, species: h.species, spName: def ? def.name : h.species, fishName: h.fish_name, level: h.level, rating: h.rating, rank: rk.name, wins: h.wins, losses: h.losses, defWins: h.def_wins, defLosses: h.def_losses, active: !!h.active, pvpBannedAt: h.pvp_banned_at, pvpBanReason: h.pvp_ban_reason, updatedAt: h.updated_at }; }) };
  }));
  r.get('/heroes/:pid', wrap((req) => {
    const pid = toInt(req.params.pid, 0), p = ctx.players.get(pid);
    if (!p || !hero.row(pid)) throw new HttpError(404, 'not_found', '找不到英雄魚');
    const v = hero.view(p);
    const purchases = db.prepare('SELECT * FROM hero_purchases WHERE player_id=? ORDER BY id DESC LIMIT 50').all(pid);
    return { player: { id: p.id, nickname: p.nickname, username: p.username }, ...v, purchases, battles: hero.battles(p, 30).battles };
  }));
  r.post('/heroes/:pid/pvp-ban', wrap((req) => {
    const pid = toInt(req.params.pid, 0);
    const reason = clampStr(req.body && req.body.reason, 200);
    const n = db.prepare('UPDATE heroes SET pvp_banned_at=?, pvp_ban_reason=? WHERE player_id=?').run(Date.now(), reason, pid).changes;
    if (!n) throw new HttpError(404, 'not_found', '找不到英雄魚');
    db.prepare('DELETE FROM hero_offers WHERE opponent_key=?').run('p:' + pid);
    audit(req, 'hero.pvp_ban', 'player:' + pid, { reason });
    return { ok: true };
  }));
  r.post('/heroes/:pid/pvp-unban', wrap((req) => {
    const pid = toInt(req.params.pid, 0);
    const n = db.prepare('UPDATE heroes SET pvp_banned_at=NULL, pvp_ban_reason=NULL WHERE player_id=?').run(pid).changes;
    if (!n) throw new HttpError(404, 'not_found', '找不到英雄魚');
    audit(req, 'hero.pvp_unban', 'player:' + pid, null);
    return { ok: true };
  }));
  r.post('/heroes/:pid/rating', wrap((req) => {
    const pid = toInt(req.params.pid, 0), rating = toInt(req.body && req.body.rating, NaN);
    if (!(rating >= 0 && rating <= 5000)) throw bad('invalid_rating', '分數需為 0–5000');
    const old = hero.row(pid); if (!old) throw new HttpError(404, 'not_found', '找不到英雄魚');
    db.prepare('UPDATE heroes SET rating=? WHERE player_id=?').run(rating, pid);
    audit(req, 'hero.rating_set', 'player:' + pid, { from: old.rating, to: rating, note: clampStr(req.body && req.body.note, 200) });
    return { ok: true };
  }));

  // ---------- 戰報 ----------
  r.get('/battles', wrap((req) => {
    const where = [], args = [];
    if (req.query.playerId) { where.push('(attacker_id=? OR defender_id=?)'); args.push(toInt(req.query.playerId, 0), toInt(req.query.playerId, 0)); }
    if (req.query.flagged === '1') where.push("flags<>'[]'");
    if (req.query.pvp === '1') where.push('defender_id IS NOT NULL');
    const rows = db.prepare(`SELECT * FROM hero_battles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(500, toInt(req.query.limit, 100)));
    const nick = db.prepare('SELECT nickname FROM players WHERE id=?');
    return { battles: rows.map((b) => ({ ...hero.battleRowView(b, null), attackerNick: (nick.get(b.attacker_id) || {}).nickname, defenderNick: b.defender_id ? (nick.get(b.defender_id) || {}).nickname : null })) };
  }));
  r.get('/battles/:id', wrap((req) => ({ ...hero.battle(null, toInt(req.params.id, 0), { admin: true }), verify: hero.verifyBattle(toInt(req.params.id, 0)) })));
  // 可疑配對：7 天內互打次數多、同 IP 標記
  r.get('/suspicious', wrap(() => {
    const t = Date.now() - 7 * 86400000;
    const pairs = db.prepare(`SELECT MIN(attacker_id, defender_id) a, MAX(attacker_id, defender_id) b, COUNT(*) n, SUM(CASE WHEN flags LIKE '%same_ip%' THEN 1 ELSE 0 END) sameIp,
      SUM(a_delta) delta FROM hero_battles WHERE defender_id IS NOT NULL AND created_at>? GROUP BY a, b HAVING n>=? OR sameIp>0 ORDER BY n DESC LIMIT 100`).all(t, Math.max(2, hero.H.pvp.pairFlagThreshold - 2));
    const nick = db.prepare('SELECT nickname FROM players WHERE id=?');
    return { pairs: pairs.map((p) => ({ ...p, aNick: (nick.get(p.a) || {}).nickname, bNick: (nick.get(p.b) || {}).nickname })) };
  }));

  // ---------- 賽季 ----------
  r.get('/seasons', wrap(() => ({ seasons: db.prepare('SELECT * FROM hero_seasons ORDER BY id DESC').all().map((s) => ({ ...s, summary: parseJSON(s.summary, null) })), current: hero.currentSeason() })));
  r.post('/seasons/close', wrap((req) => {
    const b = req.body || {};
    if (b.confirm !== 'CLOSE') throw bad('confirm_required', '請輸入 CLOSE 確認結算');
    const out = hero.closeSeason({ nextName: b.nextName, endsAt: b.endsAt ? Number(b.endsAt) : null });
    audit(req, 'hero.season_close', 'season:' + out.closed, out);
    return out;
  }));
  return r;
};
