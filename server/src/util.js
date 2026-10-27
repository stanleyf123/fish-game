'use strict';
const crypto = require('crypto');

const now = () => Date.now();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(String(s)).digest('hex');
const randToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
};

// 以指定時區（預設 Asia/Taipei）取得 YYYY-MM-DD
function makeDayFn(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms = Date.now()) => f.format(new Date(ms));
}

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (code, msg, extra) => new HttpError(400, code, msg, extra);

// 簡易記憶體限流（單一程序足夠；多程序部署需改用共享儲存）
class RateLimiter {
  constructor({ windowMs, max }) { this.windowMs = windowMs; this.max = max; this.hits = new Map(); }
  check(key) {
    const t = Date.now();
    let e = this.hits.get(key);
    if (!e || t - e.start > this.windowMs) { e = { start: t, n: 0 }; this.hits.set(key, e); }
    e.n++;
    if (this.hits.size > 50000) for (const [k, v] of this.hits) if (t - v.start > this.windowMs) this.hits.delete(k);
    return { ok: e.n <= this.max, retryAfter: Math.ceil((e.start + this.windowMs - t) / 1000) };
  }
  reset(key) { this.hits.delete(key); }
}

const parseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const clampStr = (s, n) => String(s == null ? '' : s).slice(0, n);
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

module.exports = { now, sha256, hmac, randToken, safeEqual, makeDayFn, HttpError, bad, RateLimiter, parseJSON, clampStr, toInt };
