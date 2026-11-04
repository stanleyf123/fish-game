'use strict';
// Stripe Checkout — 骨架／尚未正式串接。
// 需要：STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET（Dashboard → Webhooks 建立端點後取得 whsec_...）。
// Webhook 端點：POST {PUBLIC_BASE_URL}/api/payments/webhook/stripe，訂閱 checkout.session.completed、
//   checkout.session.async_payment_failed、checkout.session.expired、charge.refunded。
// ⚠️ TWD 在 Stripe 的金額單位請上線前再次確認（目前以 ×100 送出）；台灣法人帳戶可用性與手續費也需確認。
const crypto = require('crypto');
const { HttpError, safeEqual } = require('../util');

function verifySignature(raw, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.split('=')).filter((a) => a.length === 2));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  return safeEqual(parts.v1, expected);
}

function create(env) {
  const key = env.STRIPE_SECRET_KEY, whsec = env.STRIPE_WEBHOOK_SECRET;
  return {
    name: 'stripe', label: 'Stripe',
    enabled: !!(key && whsec && env.PUBLIC_BASE_URL),
    async createCheckout(order) {
      const form = new URLSearchParams({
        mode: 'payment', client_reference_id: order.id,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'twd',
        'line_items[0][price_data][unit_amount]': String(order.amount * 100),
        'line_items[0][price_data][product_data][name]': order.productName,
        'metadata[order_id]': order.id, 'payment_intent_data[metadata][order_id]': order.id,
        success_url: `${env.PUBLIC_BASE_URL}/?order=${order.id}&paid=1`, cancel_url: `${env.PUBLIC_BASE_URL}/?order=${order.id}&canceled=1`,
      });
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': order.id }, body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error && j.error.message || 'Stripe 錯誤');
      return { type: 'redirect', url: j.url, providerTxnId: j.id };
    },
    parseWebhook(raw, headers) {
      if (!verifySignature(raw, headers['stripe-signature'], whsec)) throw new HttpError(400, 'bad_signature', 'Stripe 簽章驗證失敗');
      const ev = JSON.parse(raw.toString('utf8'));
      const obj = ev.data && ev.data.object || {};
      const orderId = obj.metadata && obj.metadata.order_id;
      let status = 'ignored', amount;
      if (ev.type === 'checkout.session.completed' && obj.payment_status === 'paid') { status = 'paid'; amount = obj.amount_total / 100; }
      else if (ev.type === 'checkout.session.async_payment_succeeded') { status = 'paid'; amount = obj.amount_total / 100; }
      else if (ev.type === 'checkout.session.async_payment_failed' || ev.type === 'checkout.session.expired') status = 'failed';
      else if (ev.type === 'charge.refunded') status = 'refunded';
      return { eventId: ev.id, orderId, status, amount, providerTxnId: obj.id, type: ev.type };
    },
    ack: () => ({ status: 200, contentType: 'application/json', body: '{"received":true}' }),
    async refund() { throw new HttpError(501, 'not_implemented', 'Stripe 退款 API 尚未串接（POST /v1/refunds），請至 Stripe Dashboard 操作'); },
  };
}

module.exports = { create, verifySignature };
