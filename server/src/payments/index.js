'use strict';
// 金流供應商抽象層。
// 每個 provider 實作：
//   name, label, enabled
//   createCheckout(order, product, ctx) → { type: 'mock'|'form_post'|'redirect', ... , providerTxnId? }
//   parseWebhook(rawBody: Buffer, headers) → { eventId, orderId, status: 'paid'|'failed'|'refunded'|'ignored', amount?, providerTxnId?, type }
//        簽章不符時必須丟出錯誤（不可信任未驗證的通知）
//   ack(ok) → { status, contentType, body }  回應金流的格式（例如綠界要求 "1|OK"）
//   refund?(order) → 呼叫金流退款 API（尚未實作）
const { HttpError } = require('../util');
const mock = require('./mock');
const ecpay = require('./ecpay');
const stripe = require('./stripe');

function buildProviders(env, secrets) {
  const list = [mock.create(env, secrets), ecpay.create(env), stripe.create(env)];
  const map = {};
  for (const p of list) map[p.name] = p;
  return map;
}

// Webhook 共用流程：驗章 → 以 (provider, eventId) 去重 → 更新訂單（交易內冪等）
async function processWebhook({ db, commerce, providers, name, rawBody, headers }) {
  const prov = providers[name];
  if (!prov || !prov.enabled) throw new HttpError(404, 'provider_unavailable', '金流未啟用');
  const ev = prov.parseWebhook(rawBody, headers); // 驗章失敗會丟錯
  const t = Date.now();
  const ins = db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, order_id, type, payload, received_at) VALUES (?,?,?,?,?,?)')
    .run(name, String(ev.eventId), ev.orderId || null, ev.type || ev.status, rawBody.toString('utf8').slice(0, 20000), t);
  if (!ins.changes) return { duplicate: true, ack: prov.ack(true) };
  let result;
  try {
    if (ev.status === 'paid') result = commerce.markPaid(ev.orderId, { amount: ev.amount, providerTxnId: ev.providerTxnId, provider: name });
    else if (ev.status === 'failed') result = commerce.markFailed(ev.orderId, ev.reason);
    else if (ev.status === 'refunded') result = await commerce.refund(ev.orderId, { by: name, reason: '金流通知退款' });
    else result = { ignored: true };
    db.prepare('UPDATE payment_events SET result=? WHERE provider=? AND event_id=?').run(JSON.stringify({ ok: true, status: result.order && result.order.status, duplicate: !!result.duplicate }), name, String(ev.eventId));
    return { ok: true, result, ack: prov.ack(true) };
  } catch (e) {
    db.prepare('UPDATE payment_events SET result=? WHERE provider=? AND event_id=?').run(JSON.stringify({ ok: false, error: e.code || e.message }), name, String(ev.eventId));
    // 業務錯誤（金額不符、找不到訂單）仍回 ack，避免金流無限重送；錯誤留在 payment_events 供後台查核
    return { ok: false, error: e, ack: prov.ack(true) };
  }
}

module.exports = { buildProviders, processWebhook };
