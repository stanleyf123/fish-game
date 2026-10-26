'use strict';
// 後台登入：密碼來自環境變數 ADMIN_PASSWORD；Session 存在 SQLite（只存雜湊）；
// Cookie：HttpOnly + SameSite=Strict (+ Secure)；非 GET 請求需帶 X-CSRF-Token 且 Origin 必須同源；登入限流。
const { sha256, hmac, randToken, safeEqual, HttpError, RateLimiter } = require('./util');

const COOKIE = 'fg_admin';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

class AdminAuth {
  constructor(db, { password, sessionSecret, secureCookie, ttlHours = 12 }) {
    this.db = db; this.password = password; this.secret = sessionSecret; this.secure = secureCookie; this.ttl = ttlHours * 3600000;
    this.ipLimiter = new RateLimiter({ windowMs: 15 * 60000, max: 5 });
    this.globalLimiter = new RateLimiter({ windowMs: 15 * 60000, max: 50 });
  }

  idHash(id) { return hmac(this.secret, 'admin-session:' + id); }

  cookie(value, maxAgeSec) {
    return `${COOKIE}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${this.secure ? '; Secure' : ''}`;
  }

  login(req, res, password) {
    const ip = req.ip;
    const a = this.ipLimiter.check(ip), g = this.globalLimiter.check('all');
    if (!a.ok || !g.ok) { res.set('Retry-After', String(a.ok ? g.retryAfter : a.retryAfter)); throw new HttpError(429, 'rate_limited', `嘗試次數過多，請 ${Math.ceil((a.ok ? g.retryAfter : a.retryAfter) / 60)} 分鐘後再試`); }
    const ok = typeof password === 'string' && safeEqual(sha256(password), sha256(this.password));
    if (!ok) throw new HttpError(401, 'bad_password', '密碼錯誤');
    this.ipLimiter.reset(ip);
    const id = randToken(32), csrf = randToken(24), t = Date.now();
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(t);
    this.db.prepare('INSERT INTO admin_sessions (id_hash, csrf, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)').run(this.idHash(id), csrf, t, t + this.ttl, ip, String(req.get('user-agent') || '').slice(0, 200));
    res.append('Set-Cookie', this.cookie(id, Math.floor(this.ttl / 1000)));
    return { csrf, expiresAt: t + this.ttl };
  }

  session(req) {
    const id = parseCookies(req.get('cookie'))[COOKIE];
    if (!id) return null;
    const s = this.db.prepare('SELECT * FROM admin_sessions WHERE id_hash=?').get(this.idHash(id));
    if (!s || s.expires_at < Date.now()) return null;
    return s;
  }

  logout(req, res) {
    const id = parseCookies(req.get('cookie'))[COOKIE];
    if (id) this.db.prepare('DELETE FROM admin_sessions WHERE id_hash=?').run(this.idHash(id));
    res.append('Set-Cookie', this.cookie('', 0));
  }

  // API 用：未登入回 401；寫入類請求檢查 CSRF + Origin
  require() {
    return (req, res, next) => {
      const s = this.session(req);
      if (!s) return next(new HttpError(401, 'admin_unauthorized', '請先登入後台'));
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('origin');
        if (origin) {
          const host = req.get('x-forwarded-host') || req.get('host');
          let oh; try { oh = new URL(origin).host; } catch { oh = ''; }
          if (oh !== host) return next(new HttpError(403, 'bad_origin', '來源不符'));
        }
        if (!safeEqual(req.get('x-csrf-token') || '', s.csrf)) return next(new HttpError(403, 'bad_csrf', 'CSRF 驗證失敗，請重新整理頁面'));
      }
      req.admin = s;
      next();
    };
  }

  audit(req, action, target, detail) {
    this.db.prepare('INSERT INTO audit_log (at, action, target, detail, ip) VALUES (?,?,?,?,?)')
      .run(Date.now(), action, target == null ? null : String(target), detail == null ? null : JSON.stringify(detail).slice(0, 8000), req.ip);
  }
}

module.exports = { AdminAuth, parseCookies, COOKIE };
