'use strict';
// 後台 API：/admin/api/*（需登入；寫入需 CSRF）。所有寫入動作都記錄到 audit_log。
const express = require('express');
const { HttpError, bad, parseJSON, toInt, clampStr } = require('../util');
const { validateConfig } = require('../config-validate');
const { validateStructure } = require('../anticheat');
const { USERNAME_RE } = require('../players');

module.exports = function adminRouter(ctx) {
  const { db, configStore, players, rewards, commerce, stats, adminAuth, providers, pay } = ctx;
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const audit = (req, action, target, detail) => adminAuth.audit(req, action, target, detail);

  // ---------- 登入 ----------
  r.post('/login', wrap((req, res) => {
    try { const s = adminAuth.login(req, res, req.body && req.body.password); audit(req, 'admin.login', null, { ok: true }); return s; }
    catch (e) { if (e.code === 'bad_password') audit(req, 'admin.login_failed', null, null); throw e; }
  }));
  r.post('/logout', wrap((req, res) => { adminAuth.logout(req, res); return { ok: true }; }));

  const need = adminAuth.require();
  r.use(need);
  const breedRefunds=new (require('../breed-refunds').BreedRefunds)(ctx);
  r.get('/breed-refunds',wrap(req=>breedRefunds.report(req.query)));
  r.get('/breed-refunds/scene',wrap((req,res)=>{res.set('Cache-Control','no-store');return breedRefunds.scene(req.query)})); 
  r.post('/breed-refunds',wrap(req=>{const out=breedRefunds.refund(req.body,req.admin.id);if(!out.reused)audit(req,'breed.refund',out.playerId,{source:req.body.source,ref:req.body.ref,gems:out.gems,reason:req.body.reason});return out}));
  r.get('/session', (req, res) => res.json({ csrf: req.admin.csrf, expiresAt: req.admin.expires_at }));

  // ---------- 統計 ----------
  r.get('/dashboard/updates', wrap(req => require('../dashboard-updates').dashboardUpdates(db, req.query.since)));
  r.get('/dashboard/overview', wrap(() => require('../dashboard-overview').overview(db)));
  r.get('/dashboard', wrap((req) => stats.dashboard(Math.min(90, Math.max(7, toInt(req.query.days, 30))))));
  r.get('/paid-products', wrap(req => require('../paid-product-stats').report(db, req.query)));
  r.get('/revenue', wrap((req) => stats.revenue(Math.min(365, Math.max(7, toInt(req.query.days, 30))), { excludeDemo: req.query.excludeDemo === '1' })));
  r.get('/meta', wrap(() => {
    const cfg = configStore.active().config;
    return { species: Object.entries(cfg.species).map(([k, s]) => ({ key: k, name: s.name, rarity: s.rarity, disabled: !!s.disabled })), decorations: Object.entries(cfg.decorations).map(([k, d]) => ({ key: k, name: d.name, icon: d.icon })),
      rarity: cfg.rarity, providers: Object.values(providers).map((p) => ({ name: p.name, label: p.label, enabled: p.enabled })), products: commerce.listProducts(true).map((p) => ({ sku: p.sku, name: p.name })) };
  }));

  // ---------- 遊戲設定 ----------
  r.get('/config', wrap(() => { const a = configStore.active(); return { version: a.version, createdAt: a.createdAt, config: a.config }; }));
  r.post('/config/validate', wrap((req) => ({ errors: validateConfig(req.body && req.body.config) })));
  r.put('/config', wrap((req) => {
    const { config, note, baseVersion } = req.body || {};
    const cur = configStore.active().version;
    if (baseVersion != null && baseVersion !== cur) throw new HttpError(409, 'stale', `設定已被更新為 v${cur}，請重新載入後再編輯`, { version: cur });
    const v = configStore.save(config, note || '後台編輯', 'admin');
    audit(req, 'config.save', 'v' + v, { note, from: cur });
    return { version: v };
  }));
  r.get('/config/versions', wrap(() => ({ versions: configStore.list(100), active: configStore.active().version })));
  r.get('/config/versions/:v', wrap((req) => configStore.get(toInt(req.params.v, 0))));
  r.post('/config/rollback/:v', wrap((req) => {
    const target = toInt(req.params.v, 0);
    const v = configStore.rollback(target, 'admin');
    audit(req, 'config.rollback', 'v' + target, { newVersion: v });
    return { version: v };
  }));

  // 魚種（實際上仍寫成一個新的設定版本）
  r.put('/species/:key', wrap((req) => {
    const key = req.params.key;
    const { species, baseVersion } = req.body || {};
    const a = configStore.active();
    if (baseVersion != null && baseVersion !== a.version) throw new HttpError(409, 'stale', `設定已被更新為 v${a.version}，請重新載入`);
    const cfg = JSON.parse(JSON.stringify(a.config));
    const isNew = !cfg.species[key];
    cfg.species[key] = species;
    const v = configStore.save(cfg, `${isNew ? '新增' : '編輯'}魚種：${species && species.name}（${key}）`, 'admin');
    audit(req, isNew ? 'species.create' : 'species.update', key, { version: v });
    return { version: v };
  }));
  r.post('/species/:key/disabled', wrap((req) => {
    const key = req.params.key;
    const a = configStore.active();
    const cfg = JSON.parse(JSON.stringify(a.config));
    if (!cfg.species[key]) throw new HttpError(404, 'not_found', '找不到魚種');
    const disabled = !!(req.body && req.body.disabled);
    cfg.species[key].disabled = disabled;
    const v = configStore.save(cfg, `${disabled ? '停用' : '啟用'}魚種：${cfg.species[key].name}（${key}）`, 'admin');
    audit(req, disabled ? 'species.disable' : 'species.enable', key, { version: v });
    return { version: v };
  }));

  // ---------- 玩家 ----------
  r.get('/players', wrap((req) => {
    const q = String(req.query.q || '').trim();
    const where = []; const args = [];
    if (q) {
      if (/^#?\d+$/.test(q)) { where.push('p.id=?'); args.push(Number(q.replace('#', ''))); }
      else { where.push('(p.username LIKE ? OR p.email LIKE ? OR p.nickname LIKE ? OR EXISTS (SELECT 1 FROM player_identities pi WHERE pi.player_id=p.id AND (pi.name LIKE ? OR pi.email LIKE ? OR pi.sub=?)))'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q); }
    }
    const f = req.query.filter;
    if (f === 'banned') where.push('p.banned_at IS NOT NULL');
    if (f === 'flagged') where.push('p.flags > 0');
    if (f === 'bound') where.push('p.username IS NOT NULL');
    if (f === 'guest') where.push('p.username IS NULL');
    if (f === 'google' || f === 'line') { where.push('EXISTS (SELECT 1 FROM player_identities pi WHERE pi.player_id=p.id AND pi.provider=?)'); args.push(f); }   // v4.2-auth
    if (f === 'password') where.push('p.pass_hash IS NOT NULL');
    if (f === 'demo') where.push('p.is_demo=1');
    if (f === 'real') where.push('p.is_demo=0');
    if (f === 'online') { where.push('p.is_demo=0 AND p.banned_at IS NULL'); where.push('EXISTS (SELECT 1 FROM game_sessions g WHERE g.player_id=p.id AND g.last_beat >= ?)'); args.push(Date.now() - 90000); }
    if (f === 'vip') { where.push("EXISTS (SELECT 1 FROM entitlements e WHERE e.player_id=p.id AND e.kind='vip' AND e.revoked_at IS NULL AND e.expires_at > ?)"); args.push(Date.now()); }
    /*V406P*/ const d7 = ctx.playstats ? (() => { const k = []; for (let i = 6; i >= 0; i--) k.push(ctx.playstats.day(Date.now() - i * 86400000)); return k[0]; })() : '9999';
    const sortMap = { last_seen: 'p.last_seen DESC', created: 'p.created_at DESC', coins: 'COALESCE(s.coins,0) DESC', flags: 'p.flags DESC', gems: 'p.gems DESC', play_total: 'play_total DESC, p.last_seen DESC', play_7d: 'play_7d DESC, p.last_seen DESC' };
    const sortAsc = { last_seen: 'p.last_seen ASC', play_total: 'play_total ASC, p.last_seen DESC', play_7d: 'play_7d ASC, p.last_seen DESC' };
    const order = (req.query.dir === 'asc' && sortAsc[req.query.sort]) || sortMap[req.query.sort] || sortMap.last_seen;
    const sql = `FROM players p LEFT JOIN saves s ON s.player_id=p.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const total = db.prepare('SELECT COUNT(*) n ' + sql).get(...args).n;
    const limit = Math.min(200, toInt(req.query.limit, 50)), offset = Math.max(0, toInt(req.query.offset, 0));
    const rows = db.prepare(`SELECT p.id, p.username, p.nickname, p.email, p.bound_at, p.created_at, p.last_seen, p.banned_at, p.ban_reason, p.flags, p.gems, p.is_demo, (p.pass_hash IS NOT NULL) AS has_password, (SELECT GROUP_CONCAT(pi.provider) FROM player_identities pi WHERE pi.player_id=p.id) AS providers, (SELECT e.data FROM events e WHERE e.player_id=p.id AND e.type IN ('anticheat_reject','anticheat_flag') ORDER BY e.id DESC LIMIT 1) AS flag_last, (SELECT COALESCE(SUM(d.play_ms),0) FROM player_daily d WHERE d.player_id=p.id) AS play_total, (SELECT COALESCE(SUM(d.play_ms),0) FROM player_daily d WHERE d.player_id=p.id AND d.day >= '${d7}') AS play_7d, p.device, s.coins /*V406*/, s.fish_count, s.found_count, s.rev, s.updated_at save_updated ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, players: rows };
  }));

  const getPlayerOr404 = (id) => { const p = players.get(id); if (!p) throw new HttpError(404, 'not_found', '找不到玩家'); return p; };

  r.get('/players/:id', wrap((req) => {
    const p = getPlayerOr404(toInt(req.params.id, 0));
    const { device_hash, pass_hash, ...safe } = p;
    return {
      player: { ...safe, hasDevice: !!device_hash, has_password: pass_hash ? 1 : 0, providers: db.prepare('SELECT GROUP_CONCAT(provider) v FROM player_identities WHERE player_id=?').get(p.id).v, identities: db.prepare('SELECT provider, name, email, created_at, last_login FROM player_identities WHERE player_id=? ORDER BY created_at').all(p.id) },
      save: players.getSave(p.id),
      entitlements: commerce.entitlementsSummary(p.id),
      ledger: commerce.ledgerOf(p.id, 30),
      orders: commerce.listOrders({ playerId: p.id, limit: 30 }).orders,
      mailbox: rewards.mailbox(p.id),
      sessions: db.prepare('SELECT * FROM game_sessions WHERE player_id=? ORDER BY id DESC LIMIT 10').all(p.id),
      events: db.prepare('SELECT * FROM events WHERE player_id=? ORDER BY created_at DESC, id DESC LIMIT 50').all(p.id),
      flagLog: db.prepare("SELECT id, type, data, created_at FROM events WHERE player_id=? AND type IN ('anticheat_reject','anticheat_flag','anticheat_resolved','breed_limit_reject','breed_limit_over','client_outdated','flags_cleared','med_cooldown_reject','med_cooldown_over') /*V406M*/ ORDER BY id DESC LIMIT 100").all(p.id),
      stats: ctx.playstats ? ctx.playstats.summary(p.id, configStore.active().config) : null,
      flagClears: db.prepare("SELECT at, detail, ip FROM audit_log WHERE action='player.clear_flags' AND target=? ORDER BY id DESC LIMIT 20").all(String(p.id)),
    };
  }));
  r.post('/players/:id/identities/:provider/unlink', wrap(req => require('../admin-identity').unlinkIdentity(ctx,toInt(req.params.id,0),req.params.provider,req.body,(action,target,detail)=>audit(req,action,target,detail))));
  r.get('/players/:id/events', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const args = [pid]; let extra = '';
    if (req.query.type) { const ty = String(req.query.type); if (ty.endsWith('*')) { extra += ' AND type LIKE ?'; args.push(ty.slice(0, -1).replace(/[%_]/g, '') + '%'); } else { extra += ' AND type=?'; args.push(ty); } }
    if (req.query.before) { extra += ' AND id < ?'; args.push(toInt(req.query.before, 0)); }
    // v4.0.6：分頁（limit／offset）＋總筆數＋各類型筆數 /*V406P*/
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 200))), offset = Math.max(0, toInt(req.query.offset, 0));
    const total = db.prepare(`SELECT COUNT(*) n FROM events WHERE player_id=? ${extra}`).get(...args).n;
    const types = req.query.types === '1' ? db.prepare('SELECT type, COUNT(*) n FROM events WHERE player_id=? GROUP BY type ORDER BY n DESC').all(pid) : undefined;
    return { total, limit, offset, types, events: db.prepare(`SELECT * FROM events WHERE player_id=? ${extra} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) };
  }));
  r.put('/players/:id/save', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const save = req.body && req.body.save;
    const errs = validateStructure(configStore.active().config, save);
    if (errs.length) throw bad('invalid_save', '存檔格式錯誤', { errors: errs });
    const cur = players.getSave(pid);
    const rev = cur.rev + 1;
    db.transaction(() => players.writeSaveRow(pid, save, rev, Date.now(), false))();
    players.logEvent(pid, 'admin_save_edit', { rev });
    audit(req, 'player.save_edit', pid, { rev, coinsBefore: cur.save && cur.save.coins, coinsAfter: save.coins });
    return { rev };
  }));
  r.post('/players/:id/ban', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const reason = clampStr(req.body && req.body.reason, 200);
    db.prepare('UPDATE players SET banned_at=?, ban_reason=? WHERE id=?').run(Date.now(), reason, pid);
    db.prepare('DELETE FROM player_tokens WHERE player_id=?').run(pid);
    players.logEvent(pid, 'banned', { reason });
    audit(req, 'player.ban', pid, { reason });
    return { ok: true };
  }));
  r.post('/players/:id/unban', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    db.prepare('UPDATE players SET banned_at=NULL, ban_reason=NULL WHERE id=?').run(pid);
    players.logEvent(pid, 'unbanned', {});
    audit(req, 'player.unban', pid, null);
    return { ok: true };
  }));
  r.post('/players/:id/reset', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const cur = players.getSave(pid);
    db.transaction(() => { db.prepare('DELETE FROM saves WHERE player_id=?').run(pid); db.prepare('DELETE FROM player_species WHERE player_id=?').run(pid); })();
    players.logEvent(pid, 'admin_reset', { prevRev: cur.rev });
    audit(req, 'player.reset', pid, { prevCoins: cur.save && cur.save.coins, prevFish: cur.save && cur.save.fish.length });
    return { ok: true };
  }));
  r.post('/players/:id/password', wrap(async (req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const out = await players.adminSetPassword(pid, req.body && req.body.password);
    audit(req, 'player.password_reset', pid, null); // 不記錄密碼內容
    return out;
  }));
  r.post('/players/:id/clear-flags', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    const prevFlags = db.prepare('SELECT flags FROM players WHERE id=?').get(pid).flags;
    db.prepare('UPDATE players SET flags=0 WHERE id=?').run(pid);
    const by = { by: '後台管理員', ip: req.ip || null, ua: String(req.get('user-agent') || '').slice(0, 160) };
    audit(req, 'player.clear_flags', pid, { prev: prevFlags, ...by });
    players.logEvent(pid, 'flags_cleared', { prev: prevFlags, ...by });
    return { ok: true };
  }));
  r.post('/players/:id/gems', wrap((req) => {
    const pid = toInt(req.params.id, 0); getPlayerOr404(pid);
    // { delta } 增減；{ set } 直接設定為指定數量（內部換算成差額，寫入帳本）
    let delta;
    if (req.body && req.body.set != null && req.body.set !== '') {
      const target = Number(req.body.set);
      if (!Number.isInteger(target) || target < 0 || target > 1e7) throw bad('invalid_set', '請輸入 0–10000000 的整數');
      delta = target - commerce.balance(pid);
      if (!delta) return { balance: target, unchanged: true };
    } else {
      delta = Math.trunc(Number(req.body && req.body.delta));
      if (!delta || Math.abs(delta) > 1e6) throw bad('invalid_delta', '請輸入 1–1000000 的正負整數');
    }
    const reason = clampStr(req.body.reason, 200);
    const bal = commerce.ledger(pid, delta, delta > 0 ? 'admin_grant' : 'admin_revoke', 'admin:' + reason);
    audit(req, 'player.gems', pid, { delta, set: req.body.set != null && req.body.set !== '' ? Number(req.body.set) : undefined, reason, balance: bal });
    return { balance: bal };
  }));
  r.post('/players/:id/grant-product', wrap((req) => {
    const pid = toInt(req.params.id, 0);
    const o = commerce.adminGrantProduct(pid, req.body && req.body.sku, req.body && req.body.note);
    audit(req, 'order.admin_grant', o.id, { playerId: pid, sku: o.sku, note: req.body.note });
    return { order: o };
  }));

  // ---------- 公告 ----------
  const annBody = (b) => {
    const title = clampStr(b.title, 80).trim(); if (!title) throw bad('title_required', '請輸入公告標題');
    const s = b.startsAt ? Number(b.startsAt) : null, e = b.endsAt ? Number(b.endsAt) : null;
    if (s && e && e <= s) throw bad('bad_range', '結束時間必須晚於開始時間');
    return { title, body: clampStr(b.body, 2000), s, e, active: b.active === false ? 0 : 1 };
  };
  r.get('/announcements', wrap(() => ({ announcements: db.prepare('SELECT * FROM announcements ORDER BY created_at DESC, id DESC LIMIT 200').all() })));
  r.post('/announcements', wrap((req) => {
    const a = annBody(req.body || {}); const t = Date.now();
    const id = Number(db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(a.title, a.body, a.s, a.e, a.active, t, t).lastInsertRowid);
    audit(req, 'announcement.create', id, { title: a.title });
    return { id };
  }));
  r.put('/announcements/:id', wrap((req) => {
    const a = annBody(req.body || {}); const id = toInt(req.params.id, 0);
    const x = db.prepare('UPDATE announcements SET title=?, body=?, starts_at=?, ends_at=?, active=?, updated_at=? WHERE id=?').run(a.title, a.body, a.s, a.e, a.active, Date.now(), id);
    if (!x.changes) throw new HttpError(404, 'not_found', '找不到公告');
    audit(req, 'announcement.update', id, { title: a.title, active: a.active });
    return { ok: true };
  }));
  r.delete('/announcements/:id', wrap((req) => {
    const id = toInt(req.params.id, 0);
    const x = db.prepare('DELETE FROM announcements WHERE id=?').run(id);
    if (!x.changes) throw new HttpError(404, 'not_found', '找不到公告');
    audit(req, 'announcement.delete', id, null);
    return { ok: true };
  }));

  // ---------- 獎勵 ----------
  r.get('/rewards', wrap(() => ({ rewards: rewards.list(200) })));
  r.post('/rewards/preview', wrap((req) => ({ count: req.body.target === 'all' ? db.prepare('SELECT COUNT(*) n FROM players WHERE banned_at IS NULL').get().n : rewards.previewFilter(req.body.filter || {}) })));
  r.post('/rewards', wrap((req) => {
    const out = rewards.create(req.body || {});
    audit(req, 'reward.send', out.id, { title: req.body.title, target: req.body.target, recipients: out.recipients, coins: req.body.coins, gems: req.body.gems, fish: req.body.fish, decorations: req.body.decorations, filter: req.body.filter, playerId: req.body.playerId });
    return out;
  }));
  r.post('/rewards/:id/revoke', wrap((req) => { const id = toInt(req.params.id, 0); rewards.revoke(id); audit(req, 'reward.revoke', id, null); return { ok: true }; }));

  // ---------- 商品 / 訂單 / 會員 ----------
  r.get('/products', wrap(() => ({ products: commerce.listProducts(true) })));
  r.post('/products', wrap((req) => { const id = commerce.createProduct(req.body || {}); audit(req, 'product.create', id, req.body); return { id }; }));
  r.put('/products/:id', wrap((req) => { const id = toInt(req.params.id, 0); commerce.updateProduct(id, req.body || {}); audit(req, 'product.update', id, req.body); return { ok: true }; }));
  r.get('/orders', wrap((req) => commerce.listOrders({ ...req.query, excludeDemo: req.query.excludeDemo === '1' })));
  r.get('/orders/:id', wrap((req) => {
    const o = commerce.getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'not_found', '找不到訂單');
    return { order: o, paymentEvents: db.prepare('SELECT id, provider, event_id, type, result, received_at FROM payment_events WHERE order_id=? ORDER BY id').all(o.id), ledger: db.prepare('SELECT * FROM gem_ledger WHERE ref=? ORDER BY id').all('order:' + o.id) };
  }));
  r.post('/orders/:id/refund', wrap(async (req) => {
    const out = await commerce.refund(req.params.id, { by: 'admin', reason: clampStr(req.body && req.body.reason, 200), callProvider: !!(req.body && req.body.callProvider) });
    audit(req, 'order.refund', req.params.id, { reason: req.body && req.body.reason, notes: out.notes });
    return out;
  }));
  r.post('/orders/:id/mark-paid', wrap((req) => {
    // 人工對帳用：金流後台確認已收款但 webhook 遺失時
    const o = commerce.getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'not_found', '找不到訂單');
    const out = commerce.markPaid(o.id, { amount: o.amount, providerTxnId: clampStr(req.body && req.body.providerTxnId, 80) || null });
    audit(req, 'order.mark_paid', o.id, { providerTxnId: req.body && req.body.providerTxnId });
    return out;
  }));
  // ---------- 💳 儲值（綠界） ----------
  // v4.1.2：營收報表、摘要（儀表板／新入帳提示）、CSV、寶石消費訂單
  const PR = require('../payreport');
  const cardPrice = () => { try { return require('../pay').payConfig(configStore.active().config).card.priceTwd || 300; } catch (e) { return 300; } };
  r.get('/pay/report', wrap((req) => PR.payReport(db, { range: String(req.query.range || 'today'), from: String(req.query.from || ''), to: String(req.query.to || '') }, { cardPrice: cardPrice() })));
  r.get('/pay/summary', wrap(() => PR.summary(db)));
  r.get('/pay/report.csv', (req, res, next) => { try { const c = PR.csv(db, { range: String(req.query.range || 'today'), from: String(req.query.from || ''), to: String(req.query.to || '') }); audit(req, 'pay.export', c.filename, {}); res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${c.filename}"`); res.setHeader('Cache-Control', 'no-store'); res.send(c.body); } catch (e) { next(e); } });
  r.get('/pay/gem-orders', wrap((req) => {
    const where = ["o.provider='gems'"], args = [];
    if (req.query.playerId) { where.push('o.player_id=?'); args.push(toInt(String(req.query.playerId).replace('#', ''), 0)); }
    if (req.query.q) { where.push('(o.id LIKE ? OR o.sku LIKE ? OR o.product_name LIKE ?)'); const q = `%${clampStr(req.query.q, 60)}%`; args.push(q, q, q); }
    const sql = `FROM orders o JOIN players p ON p.id=o.player_id WHERE ${where.join(' AND ')}`;
    const total = db.prepare('SELECT COUNT(*) n ' + sql).get(...args).n;
    const rows = db.prepare(`SELECT o.id, o.player_id playerId, o.sku, o.product_name productName, o.amount, o.status, o.created_at createdAt, p.nickname, p.email, p.username, p.is_demo isDemo ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...args, Math.min(100, toInt(req.query.limit, 30)), toInt(req.query.offset, 0));
    return { total, orders: rows.map((o) => ({ ...o, email: o.email || o.username, isDemo: !!o.isDemo })) };
  }));
  r.get('/pay/orders', wrap((req) => pay.list(req.query || {})));
  r.get('/pay/orders/:id', wrap((req) => {
    const o = pay.order(req.params.id); if (!o) throw new HttpError(404, 'not_found', '找不到訂單');
    return { order: o, player: players.publicPlayer(players.get(o.playerId)), events: db.prepare("SELECT id, event_id, type, result, payload, received_at FROM payment_events WHERE provider='ecpay' AND order_id=? ORDER BY id").all(o.id), ledger: db.prepare('SELECT * FROM gem_ledger WHERE ref=? ORDER BY id').all('order:' + o.id), raw: (() => { try { return db.prepare('SELECT kind, step, result, body_sha, created_at FROM payment_raw WHERE order_id=? ORDER BY id').all(o.id); } catch (e) { return []; } })(), audit: db.prepare("SELECT * FROM audit_log WHERE target=? AND action LIKE 'pay.%' ORDER BY id").all(o.id) };
  }));
  r.post('/pay/orders/:id/credit', wrap((req) => { const out = pay.adminCredit(req.params.id, { tradeNo: req.body && req.body.tradeNo, reason: req.body && req.body.reason }); audit(req, 'pay.credit', req.params.id, { tradeNo: req.body && req.body.tradeNo, reason: req.body && req.body.reason, gems: out.gems, coins: out.coins }); return out; }));
  r.post('/pay/orders/:id/query', wrap(async (req) => { const out = await pay.queryNewebpay(req.params.id, 'admin_query'); audit(req, 'pay.query', req.params.id, { tradeStatus: out.tradeStatus, paid: out.paid, credited: !!(out.credit && out.credit.credited) }); return out; }));
  r.post('/pay/orders/:id/refund', wrap((req) => { const out = pay.adminRefund(req.params.id, { reason: req.body && req.body.reason, clawback: !(req.body && req.body.clawback === false) }); audit(req, 'pay.refund', req.params.id, { reason: req.body && req.body.reason, notes: out.notes }); return out; }));
  r.get('/pay/stats', wrap((req) => pay.stats({ from: toInt(req.query.from, 0), to: toInt(req.query.to, 0) || Date.now() + 1, day: stats.day || ((ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10)) })));
  r.get('/pay/products', wrap(() => { const a = configStore.active(); return { version: a.version, pay: require('../pay').payConfig(a.config), stored: !!a.config.pay, mode: pay.ec.mode, merchant: pay.ec.merchantId, ecpayOk: pay.ec.ok, problem: pay.ec.problem, newebpay: { ok: pay.nw.ok, mode: pay.nw.mode, merchant: pay.nw.merchantId, problem: pay.nw.problem }, providers: pay.providerList(null), preview: pay.products() }; }));
  r.put('/pay/products', wrap((req) => {
    const { pay: next, baseVersion, note } = req.body || {};
    const a = configStore.active();
    if (baseVersion != null && baseVersion !== a.version) throw new HttpError(409, 'stale', `設定已被更新為 v${a.version}，請重新載入後再編輯`, { version: a.version });
    const cfg = JSON.parse(JSON.stringify(a.config)); cfg.pay = next; // 只改 pay 欄位，其餘設定原樣保留
    const v = configStore.save(cfg, clampStr(note || '後台編輯儲值方案', 200), 'admin');
    audit(req, 'pay.products', 'v' + v, { from: a.version, pay: next });
    return { version: v };
  }));
  r.get('/memberships', wrap((req) => ({ memberships: commerce.memberships({ includeExpired: req.query.all === '1' }) })));

  // ---------- 稽核 / 事件 ----------
  r.get('/audit', wrap((req) => {
    const args = []; let w = '';
    if (req.query.action) { w = 'WHERE action LIKE ?'; args.push(String(req.query.action) + '%'); }
    return { entries: db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(500, toInt(req.query.limit, 200))) };
  }));
  r.get('/events', wrap((req) => {
    const args = []; let w = '';
    if (req.query.type) { w = 'WHERE e.type=?'; args.push(String(req.query.type)); }
    return { events: db.prepare(`SELECT e.*, p.username, p.nickname FROM events e LEFT JOIN players p ON p.id=e.player_id ${w} ORDER BY e.created_at DESC, e.id DESC LIMIT 200`).all(...args) };
  }));

  return r;
};
