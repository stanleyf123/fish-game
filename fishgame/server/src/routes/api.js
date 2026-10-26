'use strict';
// 遊戲端（公開／玩家）API：/api/*
const express = require('express');
const { HttpError, bad, RateLimiter, hmac, safeEqual, toInt } = require('../util');
const { processWebhook } = require('../payments');

module.exports = function apiRouter(ctx) {
  const { db, configStore, players, rewards, commerce, providers, env } = ctx;
  const r = express.Router();
  const auth = players.auth();
  const guestLimiter = new RateLimiter({ windowMs: 3600000, max: toInt(env.RATE_LIMIT_GUEST_PER_HOUR, 30) });
  const loginLimiter = new RateLimiter({ windowMs: 15 * 60000, max: 10 });
  const playerLimiter = new RateLimiter({ windowMs: 60000, max: toInt(env.RATE_LIMIT_PLAYER_PER_MIN, 120) });
  const limit = (lim, keyFn) => (req, res, next) => { const c = lim.check(keyFn(req)); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '請求太頻繁，請稍後再試')); } next(); };
  const perPlayer = limit(playerLimiter, (req) => 'p' + req.player.id);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);

  // Webhook 需要原始 body 驗章，必須在 JSON parser 之前
  r.post('/payments/webhook/:provider', express.raw({ type: () => true, limit: '200kb' }), wrap(async (req, res) => {
    const out = await processWebhook({ db, commerce, providers, name: req.params.provider, rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), headers: req.headers });
    res.status(out.ack.status).type(out.ack.contentType).send(out.ack.body);
  }));

  r.use(express.json({ limit: '300kb' }));
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));

  r.get('/health', (req, res) => res.json({ ok: true, time: Date.now(), configVersion: configStore.active().version }));

  // ---------- 設定 ----------
  r.get('/config', (req, res) => {
    const a = configStore.active();
    res.set({ ETag: a.etag, 'Cache-Control': 'no-cache', 'X-Config-Revision': String(a.version) });
    if (req.get('if-none-match') === a.etag) return res.status(304).end();
    res.type('application/json').send(a.publicJson);
  });
  r.get('/config/meta', (req, res) => { const a = configStore.active(); res.json({ revision: a.version, updatedAt: a.createdAt, etag: a.etag }); });

  // ---------- 公告 ----------
  r.get('/announcements', (req, res) => {
    const t = Date.now();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ announcements: db.prepare(`SELECT id, title, body, starts_at startsAt, ends_at endsAt, updated_at updatedAt FROM announcements
      WHERE active=1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?) ORDER BY COALESCE(starts_at, created_at) DESC LIMIT 20`).all(t, t) });
  });

  // ---------- 帳號 ----------
  r.post('/auth/guest', limit(guestLimiter, (req) => req.ip), wrap((req) => { const out = players.guest(req.body && req.body.deviceToken); try { if (ctx.newbie && out && out.player) ctx.newbie.attrib(out.player.id, req.body && req.body.attrib); } catch (e) { /* 只是紀錄 */ } try { const a = req.body && req.body.attrib; if (ctx.invite && out && out.player && a && a.invite) ctx.invite.attach(out.player.id, a.invite, req.ip, out.created); } catch (e) { /* 來源紀錄失敗不影響登入 */ } return out; }));
  // 會員帳號＝信箱（舊版 username 欄位仍接受，相容舊客戶端）
  const acct = (b) => (b && (b.email != null ? b.email : b.username)) || '';
  r.post('/auth/login', limit(loginLimiter, (req) => req.ip + '|' + String(acct(req.body)).trim().toLowerCase()), wrap((req) => players.login(acct(req.body), req.body.password)));
  r.post('/auth/register', limit(loginLimiter, (req) => req.ip + '|register'), auth, wrap(async (req) => { const player = await players.register(req.player.id, acct(req.body), req.body.password, req.body.nickname); const signupBonus = ctx.newbie ? ctx.newbie.signupBonus(req.player.id) : 0; try { if (ctx.friendsV2) ctx.friendsV2.linkInvite(req.player.id, 'register'); } catch (e) { /*FRIENDSV2-INVITE 不影響註冊*/ } return { player, signupBonus }; }));
  // 尚未開放：需要寄信服務（信箱驗證、忘記密碼）。前端顯示「請聯繫客服」。
  r.post('/auth/password-reset', limit(loginLimiter, (req) => req.ip + '|pwreset'), (req, res, next) => next(new HttpError(501, 'not_available', '忘記密碼功能尚未開放，請聯繫客服協助重設')));
  r.post('/auth/logout', auth, wrap((req) => { players.logout(req.playerToken); return { ok: true }; }));
  r.get('/me', auth, wrap((req) => ({ player: players.publicPlayer(players.get(req.player.id)), entitlements: commerce.entitlementsSummary(req.player.id) })));

  const fishStorage = new (require('../fish-storage').FishStorage)(db, players, commerce, configStore);
  r.get('/fish-storage', auth, wrap(req => fishStorage.state(req.player.id)));
  r.post('/fish-storage', auth, perPlayer, wrap(req => fishStorage.run(req.player.id, req.body)));

  const decoInventory = new (require('../deco-inventory').DecoInventory)(db,players,commerce,configStore);
  r.get('/deco-inventory',auth,wrap(req=>decoInventory.state(req.player.id)));
  r.post('/deco-inventory',auth,perPlayer,wrap(req=>decoInventory.run(req.player.id,req.body)));

  // ---------- 存檔 ----------
  r.get('/save', auth, wrap((req) => players.getSave(req.player.id)));
  r.put('/save', auth, perPlayer, wrap((req) => { const out = players.putSave(req.player.id, req.body); try { if (ctx.friendsV2) { ctx.friendsV2.touchIp(req.player.id, req.ip); ctx.friendsV2.linkInvite(req.player.id, 'save'); } } catch (e) { /*FRIENDSV2-INVITE 不影響存檔*/ } try { if (ctx.invite) { const st = ctx.invite.settle(req.player.id); if (st && st.invitee && out && typeof out === 'object') out.inviteReward = st.invitee; } } catch (e) { /* 邀請獎勵失敗不影響存檔 */ } return out; }));
  r.post('/aquascape/remove', auth, perPlayer, wrap((req) => ctx.plantRefund.remove(req.player.id, req.body && req.body.id)));   // v4.2 移除水草退款
  r.post('/save/reset', auth, perPlayer, wrap((req) => players.resetOwnSave(req.player.id)));

  // ---------- 心跳 / 事件 ----------
  r.post('/heartbeat', auth, perPlayer, wrap((req) => players.heartbeat(req.player.id, toInt(req.body && req.body.sessionId, 0), req.get('user-agent') || '') /*V406P*/));
  r.post('/events', auth, perPlayer, wrap((req) => ({ accepted: players.logClientEvents(req.player.id, req.body && req.body.events) })));

  // ---------- 信箱 ----------
  r.get('/mailbox/deleted', auth, wrap((req) => ({ mail: rewards.deletedMail(req.player.id) })));
  r.post('/mailbox/:id/delete', auth, perPlayer, wrap((req) => rewards.deleteMail(req.player.id, toInt(req.params.id, 0))));
  r.post('/mailbox/:id/restore', auth, perPlayer, wrap((req) => rewards.restoreMail(req.player.id, toInt(req.params.id, 0))));
  r.get('/mailbox', auth, wrap((req) => ({ mail: rewards.mailbox(req.player.id) })));
  r.post('/mailbox/:id/claim', auth, perPlayer, wrap((req) => rewards.claim(req.player.id, toInt(req.params.id, 0))));

  // ---------- 商城／會員 ----------
  r.get('/shop/products', wrap((req) => {
    let pid = null;
    const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') || '');
    if (m) { const row = db.prepare('SELECT player_id FROM player_tokens WHERE token_hash=?').get(require('../util').sha256(m[1])); if (row) pid = row.player_id; }
    return { products: commerce.storefront(pid), providers: Object.values(providers).filter((p) => p.enabled).map((p) => ({ name: p.name, label: p.label })) };
  }));
  r.post('/shop/orders', auth, perPlayer, wrap(async (req) => commerce.createOrder(req.player.id, req.body || {}, { ip: req.ip })));
  r.get('/shop/orders/:id', auth, wrap((req) => {
    const o = commerce.getOrder(req.params.id);
    if (!o || o.playerId !== req.player.id) throw new HttpError(404, 'not_found', '找不到訂單');
    return { order: o };
  }));
  // 寶石購買限定魚（伺服器扣寶石＋直接把魚寫入雲端存檔；回傳新的 save / rev）
  r.post('/shop/buy-item', auth, perPlayer, wrap((req) => commerce.buyItem(req.player.id, req.body && req.body.kind, req.body && req.body.id, req.body && req.body.idempotencyKey)));
  r.post('/shop/buy-species', auth, perPlayer, wrap((req) => commerce.buySpecies(req.player.id, req.body && req.body.species, req.body && req.body.idempotencyKey)));
  r.post('/shop/buy-with-gems', auth, perPlayer, wrap((req) => commerce.buyWithGems(req.player.id, req.body && req.body.sku, req.body && req.body.idempotencyKey)));
  r.get('/entitlements', auth, wrap((req) => commerce.entitlementsSummary(req.player.id)));
  r.get('/wallet', auth, wrap((req) => ({ gems: commerce.balance(req.player.id), ledger: commerce.ledgerOf(req.player.id, 20) })));
  r.post('/vip/daily', auth, perPlayer, wrap((req) => commerce.claimVipDaily(req.player.id)));

  // ---------- 模擬金流（僅測試／開發；PAYMENT_MOCK_ENABLED） ----------
  const mock = providers.mock;
  const mockSig = (orderId) => hmac(mock.secret, 'checkout:' + orderId);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  r.get('/payments/mock/checkout/:orderId', (req, res, next) => {
    if (!mock.enabled) return next(new HttpError(404, 'not_found', '模擬金流未啟用'));
    const o = commerce.getOrder(req.params.orderId);
    if (!o || o.provider !== 'mock') return next(new HttpError(404, 'not_found', '找不到訂單'));
    const sig = mockSig(o.id);
    res.type('html').send(`<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模擬付款</title>
<body style="font-family:system-ui,'Noto Sans TC',sans-serif;background:#0b2236;color:#eaf6ff;display:flex;justify-content:center;padding:40px">
<div style="background:#10314a;padding:24px;border-radius:14px;max-width:360px;width:100%">
<p style="background:#7a3a3a;padding:6px 10px;border-radius:8px">⚠️ 這是測試用的模擬付款頁，不會實際扣款</p>
<h2>${esc(o.productName)}</h2><p>訂單：${esc(o.id)}<br>金額：NT$ ${o.amount}<br>狀態：${esc(o.status)}</p>
<form method="post" action="/api/payments/mock/complete"><input type="hidden" name="orderId" value="${esc(o.id)}"><input type="hidden" name="sig" value="${sig}">
<button name="result" value="paid" style="padding:10px 18px;font-weight:700">✅ 模擬付款成功</button>
<button name="result" value="failed" style="padding:10px 18px">❌ 模擬付款失敗</button></form></div></body></html>`);
  });
  r.post('/payments/mock/complete', wrap(async (req, res) => {
    if (!mock.enabled) throw new HttpError(404, 'not_found', '模擬金流未啟用');
    const { orderId, result, sig } = req.body || {};
    if (!orderId || !safeEqual(String(sig || ''), mockSig(String(orderId)))) throw new HttpError(403, 'bad_signature', '簽章錯誤');
    const o = commerce.getOrder(orderId);
    if (!o) throw new HttpError(404, 'not_found', '找不到訂單');
    // 以「金流送來的 webhook」的形式走正式流程（含驗章與冪等）
    const raw = Buffer.from(JSON.stringify({ eventId: `mock-${o.id}-${result}`, orderId: o.id, status: result === 'paid' ? 'paid' : 'failed', amount: o.amount, txnId: 'MOCK-' + o.id }));
    const out = await processWebhook({ db, commerce, providers, name: 'mock', rawBody: raw, headers: { 'x-mock-signature': mock.sign(raw) } });
    const after = commerce.getOrder(o.id);
    if ((req.get('accept') || '').includes('application/json')) return { ok: out.ok !== false, order: after };
    res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0b2236;color:#eaf6ff;padding:40px;text-align:center"><h2>${after.status === 'paid' ? '✅ 付款完成' : '❌ 付款失敗'}</h2><p>訂單 ${esc(after.id)}，可以關閉此頁回到遊戲。</p></body>`);
  }));

  return r;
};
