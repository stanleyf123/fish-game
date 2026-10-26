'use strict';
// 測試用模擬金流：不會真的收錢。
// 流程：createOrder → 回傳 payUrl（模擬付款頁）→ 按「付款成功/失敗」→ 伺服器自己送出一筆「已簽章」的 webhook → 走與真實金流相同的處理流程。
const { hmac, safeEqual, HttpError } = require('../util');

function create(env, secrets) {
  const secret = hmac(secrets.sessionSecret, 'mock-payment-webhook');
  return {
    name: 'mock', label: '模擬金流（測試用）',
    enabled: env.PAYMENT_MOCK_ENABLED === '1' || (env.PAYMENT_MOCK_ENABLED == null && env.NODE_ENV !== 'production'),
    secret,
    sign: (raw) => hmac(secret, raw),
    async createCheckout(order) {
      return { type: 'mock', payUrl: `/api/payments/mock/checkout/${order.id}`, providerTxnId: 'MOCK-' + order.id };
    },
    parseWebhook(raw, headers) {
      const sig = headers['x-mock-signature'] || '';
      if (!safeEqual(sig, hmac(secret, raw))) throw new HttpError(400, 'bad_signature', '簽章驗證失敗');
      const b = JSON.parse(raw.toString('utf8'));
      return { eventId: b.eventId, orderId: b.orderId, status: b.status, amount: b.amount, providerTxnId: b.txnId, type: 'mock.' + b.status, reason: b.reason };
    },
    ack: () => ({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    async refund() { return { ok: true, mock: true }; },
  };
}
module.exports = { create };
