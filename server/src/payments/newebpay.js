'use strict';
// 藍新金流 NewebPay MPG（幕前支付）Version 2.0：TradeInfo＝AES-256-CBC（PKCS7）hex、TradeSha＝SHA256("HashKey=…&TradeInfo&HashIV=…") 大寫
// 加解密已用藍新文件範例（Key 12345678901234567890123456789012／IV 1234567890123456）做單元測試。
// 環境變數：NEWEBPAY_MERCHANT_ID、NEWEBPAY_HASH_KEY（32 字）、NEWEBPAY_HASH_IV（16 字）、NEWEBPAY_MODE=test|prod（預設 test）
// 回傳物件的 hashKey / hashIV 不可列舉（JSON.stringify 不會帶出）；要記錄請用 describe()。
const crypto = require('crypto');
const ENDPOINT = { test: 'https://ccore.newebpay.com/MPG/mpg_gateway', prod: 'https://core.newebpay.com/MPG/mpg_gateway' };
const QUERY = { test: 'https://ccore.newebpay.com/API/QueryTradeInfo', prod: 'https://core.newebpay.com/API/QueryTradeInfo' };

function encrypt(str, key, iv) { const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')); return c.update(str, 'utf8', 'hex') + c.final('hex'); }
// 解密：藍新以 32 位元組區塊補位（PKCS7 但 block=32，補位值可能 >16），Node 內建 PKCS7(16) 會判定失敗 → 關閉自動補位、自行去除
function decryptBuf(hex, key, iv) {
  const h = String(hex || '').trim();
  if (!h || h.length % 32 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) { const e = new Error('bad_hex'); e.step = 'bad_hex'; throw e; }
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')); d.setAutoPadding(false);
  let b = Buffer.concat([d.update(h, 'hex'), d.final()]);
  const n = b[b.length - 1];
  if (n >= 1 && n <= 32 && n <= b.length && b.subarray(b.length - n).every((x) => x === n)) b = b.subarray(0, b.length - n);
  else { let e = b.length; while (e > 0 && (b[e - 1] === 0 || b[e - 1] < 32)) e--; b = b.subarray(0, e); }
  return b;
}
function decrypt(hex, key, iv) { return decryptBuf(hex, key, iv).toString('utf8'); }
function tradeSha(tradeInfo, key, iv) { return crypto.createHash('sha256').update(`HashKey=${key}&${tradeInfo}&HashIV=${iv}`).digest('hex').toUpperCase(); }
// http_build_query（RFC1738：空白→+）
function buildQuery(o) { return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`).join('&'); }
function queryCheckValue(p, key, iv) { return crypto.createHash('sha256').update(`IV=${iv}&Amt=${p.Amt}&MerchantID=${p.MerchantID}&MerchantOrderNo=${p.MerchantOrderNo}&Key=${key}`).digest('hex').toUpperCase(); }

function newebpayConfig(env) {
  const mode = String(env.NEWEBPAY_MODE || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';
  const merchantId = String(env.NEWEBPAY_MERCHANT_ID || '').trim(), key = String(env.NEWEBPAY_HASH_KEY || ''), iv = String(env.NEWEBPAY_HASH_IV || '');
  let problem = null;
  if (!merchantId || !key || !iv) problem = '未設定 NEWEBPAY_MERCHANT_ID / NEWEBPAY_HASH_KEY / NEWEBPAY_HASH_IV';
  else if (key.length !== 32 || iv.length !== 16) problem = 'NEWEBPAY_HASH_KEY 必須 32 字、NEWEBPAY_HASH_IV 必須 16 字';
  else if (!/^[A-Za-z0-9]{6,20}$/.test(merchantId)) problem = 'NEWEBPAY_MERCHANT_ID 格式不對';
  const c = { ok: !problem, mode, merchantId, endpoint: ENDPOINT[mode], queryUrl: mode === 'test' && env.NEWEBPAY_QUERY_URL ? String(env.NEWEBPAY_QUERY_URL) : QUERY[mode], problem, describe: () => (problem ? problem : `藍新 ${mode === 'prod' ? '正式' : '測試'}商店 ${merchantId}`) };
  Object.defineProperty(c, 'hashKey', { value: key, enumerable: false });
  Object.defineProperty(c, 'hashIV', { value: iv, enumerable: false });
  return c;
}
// 解析藍新回傳（NotifyURL / ReturnURL / CustomerURL 共用表單：Status、MerchantID、Version、TradeInfo、TradeSha）
function parseResponse(form, cfg) {
  const p = form || {};
  if (!p.TradeInfo || !p.TradeSha) return { ok: false, error: 'missing_fields' };
  const want = tradeSha(p.TradeInfo, cfg.hashKey, cfg.hashIV);
  const a = Buffer.from(String(p.TradeSha).toUpperCase()), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'bad_sha' };
  let txt, info;
  try { txt = decrypt(p.TradeInfo, cfg.hashKey, cfg.hashIV); } catch (e) { return { ok: false, error: 'bad_decrypt', step: e.step || 'decipher' }; }
  try { const t = txt.trim(); info = t.startsWith('{') ? JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)) : Object.fromEntries(new URLSearchParams(t)); } catch (e) { return { ok: false, error: 'bad_json', step: 'json', len: txt.length }; }
  let R = info.Result; if (typeof R === 'string') { try { R = JSON.parse(R); } catch { R = {}; } }
  R = R || {};
  if (String(R.MerchantID || p.MerchantID) !== String(cfg.merchantId)) return { ok: false, error: 'bad_merchant' };
  return { ok: true, status: String(info.Status || p.Status || ''), message: info.Message || '', result: R };
}
// QueryTradeInfo（不扣款的查單）：CheckValue 送出、CheckCode 驗證回應
async function queryTrade(cfg, { orderId, amount }, fetchImpl = globalThis.fetch) {
  const p = { Amt: String(amount), MerchantID: cfg.merchantId, MerchantOrderNo: String(orderId) };
  const body = new URLSearchParams({ ...p, Version: '1.3', RespondType: 'JSON', CheckValue: queryCheckValue(p, cfg.hashKey, cfg.hashIV), TimeStamp: String(Math.floor(Date.now() / 1000)) });
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 12000);
  let j; try { const r = await fetchImpl(cfg.queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: ac.signal }); j = await r.json(); } finally { clearTimeout(to); }
  const R = (j && j.Result) || {};
  const cc = crypto.createHash('sha256').update(`HashIV=${cfg.hashIV}&Amt=${R.Amt}&MerchantID=${R.MerchantID}&MerchantOrderNo=${R.MerchantOrderNo}&TradeNo=${R.TradeNo}&HashKey=${cfg.hashKey}`).digest('hex').toUpperCase();
  const verified = j && j.Status === 'SUCCESS' && typeof R.CheckCode === 'string' && R.CheckCode.toUpperCase() === cc && String(R.MerchantID) === String(cfg.merchantId) && String(R.MerchantOrderNo) === String(orderId);
  return { status: j && j.Status, message: j && j.Message, verified: !!verified, tradeStatus: String(R.TradeStatus ?? ''), amt: Number(R.Amt), tradeNo: R.TradeNo || null, paymentType: R.PaymentType || null, payTime: R.PayTime || null };
}
module.exports = { queryTrade, decryptBuf, encrypt, decrypt, tradeSha, buildQuery, queryCheckValue, newebpayConfig, parseResponse, ENDPOINT };
