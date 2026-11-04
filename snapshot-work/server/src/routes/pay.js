'use strict';
// 💳 儲值 API：/api/pay/*
//   GET  /api/pay/products            儲值方案（可不登入；有 token 時附上首儲雙倍資格、是否會員）
//   POST /api/pay/ecpay/create        建立綠界訂單（會員限定）→ { order, checkout:{ action, fields } }，由瀏覽器 POST 到綠界
//   POST /api/pay/ecpay/notify        綠界 ReturnURL（伺服器對伺服器）：驗章→驗金額→入帳一次→回 1|OK
//   POST /api/pay/ecpay/payinfo       綠界 PaymentInfoURL：ATM／超商代碼取號結果（訂單維持待付款）
//   POST /api/pay/ecpay/result        綠界 OrderResultURL（使用者瀏覽器帶回）：驗章後導回遊戲 /?pay=result&order=…
//   GET  /api/pay/orders[/:id]        我的儲值紀錄
const express = require('express');
const { HttpError, sha256 } = require('../util');

module.exports = function payRouter(ctx) {
  const { db, players, pay, commerce } = ctx;
  const r = express.Router();
  const auth = players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const rawForm = express.raw({ type: () => true, limit: '64kb' });
  const optPid = (req) => { const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') || ''); if (!m) return null; const row = db.prepare('SELECT player_id FROM player_tokens WHERE token_hash=?').get(sha256(m[1])); return row ? row.player_id : null; };

  // 綠界通知：回應必須是純文字 1|OK
  r.post('/ecpay/notify', rawForm, (req, res) => { const out = pay.handlePaid(req.body, 'notify'); res.status(out.status).type('text/plain').send(out.reply); });
  // 藍新：NotifyURL（伺服器）回 200；ReturnURL／CustomerURL（瀏覽器）處理後導回遊戲
  const form = (req) => Object.fromEntries(new URLSearchParams(req.body.toString('utf8')));
  const rawOf = (req) => (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
  r.post('/newebpay/notify', rawForm, (req, res) => { const out = pay.newebpay(form(req), 'notify', rawOf(req)); res.status(out.status).type('text/plain').send(out.ok ? 'SUCCESS' : 'FAIL'); });
  for (const k of ['return', 'customer']) r.post('/newebpay/' + k, rawForm, (req, res) => {
    const out = pay.newebpay(form(req), k, rawOf(req));
    const id = out.orderId || '';
    res.redirect(303, `${pay.baseUrl(req)}/?pay=result&order=${encodeURIComponent(/^[A-Za-z0-9]{1,20}$/.test(id) ? id : '')}`);
  });
  r.post('/ecpay/payinfo', rawForm, (req, res) => { const out = pay.handlePayInfo(req.body); res.status(out.status).type('text/plain').send(out.reply); });
  r.post('/ecpay/result', rawForm, (req, res) => {
    const out = pay.handlePaid(req.body, 'result');
    const id = out.orderId || new URLSearchParams(req.body.toString('utf8')).get('MerchantTradeNo') || '';
    res.redirect(303, `${pay.baseUrl(req)}/?pay=result&order=${encodeURIComponent(/^[A-Za-z0-9]{1,20}$/.test(id) ? id : '')}`);
  });

  r.use(express.json({ limit: '10kb' }));
  r.get('/products', wrap((req) => pay.storefront(optPid(req))));
  r.post('/ecpay/create', auth, wrap((req) => pay.create(req.player.id, req.body && req.body.productId, req, 'ecpay')));
  r.post('/create', auth, wrap((req) => pay.create(req.player.id, req.body && req.body.productId, req, req.body && req.body.provider)));
  r.post('/card/claim', auth, wrap((req) => { const r2 = commerce.claimVipDaily(req.player.id); return { ...r2, card: pay.cardStatus(req.player.id) }; }));
  // v4.1.1：「我已付款，立即查詢」（向藍新查單，已付款就入帳；每人每分鐘 4 次、每小時 30 次）
  const { RateLimiter } = require('../util');
  const qMin = new RateLimiter({ windowMs: 60000, max: 4 }), qHour = new RateLimiter({ windowMs: 3600000, max: 30 });
  r.post('/orders/:id/check', auth, wrap(async (req) => {
    const o = pay.order(req.params.id);
    if (!o || o.playerId !== req.player.id) throw new HttpError(404, 'not_found', '找不到訂單');
    if (o.status !== 'pending' || o.creditedAt) return { ok: true, order: pay.publicOrder(o), gems: commerce.balance(req.player.id), alreadyDone: true, saveRev: saveRev(req.player.id), vipUntil: vipUntil(req.player.id) };
    if (o.provider !== 'newebpay') throw new HttpError(400, 'not_supported', '這筆訂單無法查詢');
    for (const l of [qMin, qHour]) { const c = l.check('q' + req.player.id); if (!c.ok) throw new HttpError(429, 'rate_limited', `查詢太頻繁，請 ${Math.ceil((c.retryAfter || 30))} 秒後再試`, { retryAfter: c.retryAfter }); }
    const out = await pay.queryNewebpay(o.id, 'player_query');
    const sv = db.prepare('SELECT rev FROM saves WHERE player_id=?').get(req.player.id);
    return { ok: out.ok, paid: out.paid, tradeStatus: out.tradeStatus, tradeStatusText: out.tradeStatusText, message: out.message, order: pay.publicOrder(out.order), gems: commerce.balance(req.player.id), saveRev: sv ? sv.rev : 0, vipUntil: vipUntil(req.player.id) };
  }));
  // 漏斗事件（訪客也算；每人每分鐘最多 30 筆）
  const fLim = new RateLimiter({ windowMs: 60000, max: 30 });
  r.post('/funnel', auth, wrap((req) => {
    const step = String((req.body && req.body.step) || ''), pack = String((req.body && req.body.pack) || '');
    if (!require('../pay').FUNNEL_CLIENT.includes(step)) throw new HttpError(400, 'bad_step', 'step 不正確');
    if (fLim.check('f' + req.player.id).ok) pay.funnel(req.player.id, step, pack, pay.isMember(req.player));
    return { ok: true };
  }));
  const vipUntil = (pid) => { try { const v = db.prepare("SELECT MAX(expires_at) e FROM entitlements WHERE player_id=? AND kind='vip'").get(pid); return (v && v.e) || null; } catch (e) { return null; } };
  const saveRev = (pid) => { const sv = db.prepare('SELECT rev FROM saves WHERE player_id=?').get(pid); return sv ? sv.rev : 0; };
  r.get('/unacked', auth, wrap((req) => ({ orders: pay.unacked(req.player.id), gems: commerce.balance(req.player.id), vipUntil: vipUntil(req.player.id), saveRev: saveRev(req.player.id) })));
  r.post('/orders/:id/ack', auth, wrap((req) => pay.ack(req.player.id, req.params.id)));
  r.get('/orders', auth, wrap((req) => ({ orders: pay.myOrders(req.player.id), gems: commerce.balance(req.player.id) })));
  r.get('/orders/:id', auth, wrap((req) => {
    const o = pay.order(req.params.id);
    if (!o || o.playerId !== req.player.id) throw new HttpError(404, 'not_found', '找不到訂單');
    const sv = db.prepare('SELECT rev FROM saves WHERE player_id=?').get(req.player.id);
    return { order: pay.publicOrder(o), gems: commerce.balance(req.player.id), saveRev: sv ? sv.rev : 0, vipUntil: vipUntil(req.player.id) };
  }));
  return r;
};
