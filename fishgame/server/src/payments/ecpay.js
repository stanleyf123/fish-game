'use strict';
// 綠界 ECPay 全方位金流（AIO）：CheckMacValue／設定。儲值流程見 src/pay.js、src/routes/pay.js。
// 需要：特店編號 MerchantID、HashKey、HashIV（綠界特店後台取得），ReturnURL 必須是公開 HTTPS。
// 文件：https://developers.ecpay.com.tw/ （全方位金流 AioCheckOut V5、CheckMacValue 產生方式）
// CheckMacValue 已用綠界文件範例（2902、2878、2881）做單元測試，並在 payment-stage 實際建立訂單驗證。
const crypto = require('crypto');
const { HttpError, safeEqual } = require('../util');

// 綠界規定的 .NET 風格 URL encode
function ecpayUrlEncode(s) {
  return encodeURIComponent(s).replace(/%20/g, '+').replace(/'/g, '%27').replace(/~/g, '%7e')
    .toLowerCase()
    .replace(/%2d/g, '-').replace(/%5f/g, '_').replace(/%2e/g, '.').replace(/%21/g, '!').replace(/%2a/g, '*').replace(/%28/g, '(').replace(/%29/g, ')');
}

function checkMacValue(params, hashKey, hashIV) {
  const keys = Object.keys(params).filter((k) => k !== 'CheckMacValue').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const raw = `HashKey=${hashKey}&` + keys.map((k) => `${k}=${params[k]}`).join('&') + `&HashIV=${hashIV}`;
  return crypto.createHash('sha256').update(ecpayUrlEncode(raw)).digest('hex').toUpperCase();
}

function taipeiDate(ms) {
  const d = new Date(ms + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 綠界官方公開的「測試環境」特店（https://developers.ecpay.com.tw/2856/）。只能用在 payment-stage，不會真的收錢。
const STAGE_MERCHANT = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
const STAGE_IDS = new Set(['3002607', '2000132', '3002599', '2000933', '2000214']);
const ENDPOINT = { stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', prod: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5' };

// 讀取綠界設定：ECPAY_MODE=stage|prod（預設 stage）。
// - stage：一律用綠界官方公開測試特店（或另外指定的 ECPAY_STAGE_MERCHANT_ID/HASH_KEY/HASH_IV），
//          絕不使用 ECPAY_HASH_KEY / ECPAY_HASH_IV（那是正式金鑰），避免測試時誤用正式特店。
// - prod ：一定要 ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV 三個都有，且不可是測試特店。
// 回傳物件的 hashKey / hashIV 不可列舉（JSON.stringify 不會帶出）；要記錄請用 describe()。
function ecpayConfig(env) {
  const mode = String(env.ECPAY_MODE || 'stage').toLowerCase() === 'prod' ? 'prod' : 'stage';
  let merchantId, hashKey, hashIV, problem = null, usingStageDefaults = false;
  if (mode === 'prod') {
    ({ ECPAY_MERCHANT_ID: merchantId, ECPAY_HASH_KEY: hashKey, ECPAY_HASH_IV: hashIV } = env);
    if (!(merchantId && hashKey && hashIV)) problem = 'ECPAY_MODE=prod 但 ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV 未完整設定';
    else if (STAGE_IDS.has(String(merchantId))) problem = 'ECPAY_MODE=prod 不可使用綠界測試特店編號';
  } else if (env.ECPAY_STAGE_MERCHANT_ID && env.ECPAY_STAGE_HASH_KEY && env.ECPAY_STAGE_HASH_IV) {
    ({ ECPAY_STAGE_MERCHANT_ID: merchantId, ECPAY_STAGE_HASH_KEY: hashKey, ECPAY_STAGE_HASH_IV: hashIV } = env);
  } else { ({ merchantId, hashKey, hashIV } = STAGE_MERCHANT); usingStageDefaults = true; }
  const cfg = { mode, merchantId, endpoint: ENDPOINT[mode], ok: !problem && !!(merchantId && hashKey && hashIV), problem, usingStageDefaults };
  Object.defineProperty(cfg, 'hashKey', { value: hashKey, enumerable: false });
  Object.defineProperty(cfg, 'hashIV', { value: hashIV, enumerable: false });
  cfg.describe = () => `mode=${mode} merchant=${merchantId || '-'}${usingStageDefaults ? '（官方測試特店）' : ''}${problem ? ' ⚠️ ' + problem : ''}`;
  return cfg;
}

// 舊的「商城商品（products 表）走綠界」路徑：已由 /api/pay/ecpay/*（遊戲設定裡的儲值商品）取代，預設停用，
// 只有 ECPAY_LEGACY_SHOP=1 才啟用，避免同時有兩條綠界通知路徑。
function create(env) {
  const merchantId = env.ECPAY_MERCHANT_ID, hashKey = env.ECPAY_HASH_KEY, hashIV = env.ECPAY_HASH_IV;
  const stage = env.ECPAY_STAGE !== '0' && String(env.ECPAY_MODE || 'stage').toLowerCase() !== 'prod';
  return {
    name: 'ecpay', label: '綠界 ECPay',
    enabled: env.ECPAY_LEGACY_SHOP === '1' && !!(merchantId && hashKey && hashIV && env.PUBLIC_BASE_URL),
    async createCheckout(order) {
      const fields = {
        MerchantID: merchantId,
        MerchantTradeNo: order.id, // ≤ 20 碼英數
        MerchantTradeDate: taipeiDate(order.createdAt),
        PaymentType: 'aio',
        TotalAmount: String(order.amount),
        TradeDesc: '悠游水族箱',
        ItemName: order.productName.replace(/#/g, ''),
        ReturnURL: `${env.PUBLIC_BASE_URL}/api/payments/webhook/ecpay`,
        ClientBackURL: `${env.PUBLIC_BASE_URL}/`,
        ChoosePayment: 'ALL',
        EncryptType: '1',
        CustomField1: String(order.playerId),
      };
      fields.CheckMacValue = checkMacValue(fields, hashKey, hashIV);
      return { type: 'form_post', action: stage ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5' : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5', fields };
    },
    parseWebhook(raw) {
      const params = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      if (!params.CheckMacValue || !safeEqual(params.CheckMacValue, checkMacValue(params, hashKey, hashIV))) throw new HttpError(400, 'bad_signature', 'CheckMacValue 驗證失敗');
      if (params.MerchantID !== merchantId) throw new HttpError(400, 'bad_merchant', 'MerchantID 不符');
      // SimulatePaid=1 是綠界後台「模擬付款」，正式環境不可發貨
      const simulated = params.SimulatePaid === '1';
      const paid = params.RtnCode === '1' && (!simulated || stage);
      return {
        eventId: `${params.MerchantTradeNo}:${params.TradeNo}:${params.RtnCode}`,
        orderId: params.MerchantTradeNo, status: paid ? 'paid' : simulated ? 'ignored' : 'failed',
        amount: Number(params.TradeAmt), providerTxnId: params.TradeNo, type: 'ecpay.return', reason: params.RtnMsg,
      };
    },
    ack: (ok) => ({ status: 200, contentType: 'text/plain', body: ok ? '1|OK' : '0|ERROR' }),
    async refund() {
      // TODO：信用卡退刷需呼叫綠界「信用卡請退款功能」API（CreditDetail/DoAction），ATM/超商代碼無法線上退款需人工處理。
      throw new HttpError(501, 'not_implemented', '綠界退款 API 尚未串接，請至綠界後台操作');
    },
  };
}

module.exports = { create, checkMacValue, ecpayUrlEncode, ecpayConfig, taipeiDate, STAGE_MERCHANT, ENDPOINT };
