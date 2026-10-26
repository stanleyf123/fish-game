'use strict';
// v4.2-auth：Google（Identity Services ID token）＋ LINE Login v2.1（OIDC 授權碼＋state＋nonce＋PKCE）
// 只存 provider sub＋顯示名稱／信箱（有提供時）。Channel secret 只在伺服器環境變數 LINE_CHANNEL_SECRET。
const crypto = require('crypto');
const { HttpError, bad, randToken, clampStr, sha256 } = require('./util');

const PROVIDERS = ['google', 'line'];
const PNAME = { google: 'Google', line: 'LINE' };
const b64url = (b) => Buffer.from(b).toString('base64url');
const STATE_TTL = 10 * 60000, RESULT_TTL = 10 * 60000;

class OAuth {
  constructor({ db, env, configStore, players, fetchImpl }) {
    this.db = db; this.env = env || {}; this.cfgStore = configStore; this.players = players;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    const test = this.env.NODE_ENV !== 'production';
    this.urls = {
      googleCerts: (test && this.env.GOOGLE_CERTS_URL) || 'https://www.googleapis.com/oauth2/v3/certs',
      lineAuth: (test && this.env.LINE_AUTH_URL) || 'https://access.line.me/oauth2/v2.1/authorize',
      lineToken: (test && this.env.LINE_TOKEN_URL) || 'https://api.line.me/oauth2/v2.1/token',
      lineVerify: (test && this.env.LINE_VERIFY_URL) || 'https://api.line.me/oauth2/v2.1/verify',
    };
    this.certs = { keys: null, exp: 0 };
    db.exec(`CREATE TABLE IF NOT EXISTS player_identities (provider TEXT NOT NULL, sub TEXT NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, email TEXT, name TEXT, created_at INTEGER NOT NULL, last_login INTEGER, PRIMARY KEY (provider, sub));
      CREATE INDEX IF NOT EXISTS idx_identities_player ON player_identities(player_id);
      CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, kind TEXT NOT NULL, player_id INTEGER, mode TEXT, nonce TEXT, verifier TEXT, data TEXT, created_at INTEGER NOT NULL, used_at INTEGER);`);
  }
  conf() {
    const a = (this.cfgStore.active().config || {}).auth || {};
    const gid = typeof a.googleClientId === 'string' && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(a.googleClientId.trim()) ? a.googleClientId.trim() : '';
    const lid = /^\d{6,12}$/.test(String(a.lineChannelId || '').trim()) ? String(a.lineChannelId).trim() : '';
    const base = String(this.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    return { googleClientId: gid, lineChannelId: lid, lineSecret: this.env.LINE_CHANNEL_SECRET || '', base, lineRedirect: base + '/api/auth/line/callback' };
  }
  providers() { const c = this.conf(); return { google: c.googleClientId ? { clientId: c.googleClientId } : null, line: !!(c.lineChannelId && c.lineSecret && c.base) }; }
  identities(pid) { return this.db.prepare('SELECT provider, email, name, created_at createdAt, last_login lastLogin FROM player_identities WHERE player_id=? ORDER BY created_at').all(pid); }

  // ---------- Google ----------
  async googleKeys(force) {
    if (!force && this.certs.keys && Date.now() < this.certs.exp) return this.certs.keys;
    const r = await this.fetch(this.urls.googleCerts); if (!r.ok) throw new HttpError(502, 'google_unavailable', '暫時無法連線到 Google，請稍後再試');
    const j = await r.json(); const m = /max-age=(\d+)/.exec(r.headers && r.headers.get ? r.headers.get('cache-control') || '' : '');
    this.certs = { keys: j.keys || [], exp: Date.now() + Math.min(86400, m ? Number(m[1]) : 3600) * 1000 }; return this.certs.keys;
  }
  async verifyGoogle(credential) {
    const c = this.conf(); if (!c.googleClientId) throw new HttpError(503, 'google_disabled', 'Google 登入尚未開放');
    const parts = String(credential || '').split('.'); if (parts.length !== 3 || credential.length > 4096) throw bad('bad_token', 'Google 登入資料不正確');
    let head, pl; try { head = JSON.parse(Buffer.from(parts[0], 'base64url')); pl = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch (e) { throw bad('bad_token', 'Google 登入資料不正確'); }
    if (head.alg !== 'RS256' || !head.kid) throw bad('bad_token', 'Google 登入資料不正確');
    let keys = await this.googleKeys(), jwk = keys.find((k) => k.kid === head.kid);
    if (!jwk) { keys = await this.googleKeys(true); jwk = keys.find((k) => k.kid === head.kid); }
    if (!jwk) throw bad('bad_token', 'Google 登入資料已過期，請再試一次');
    const okSig = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    if (!okSig) throw bad('bad_token', 'Google 登入資料驗證失敗');
    const now = Date.now() / 1000;
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(pl.iss)) throw bad('bad_token', 'Google 登入資料驗證失敗（iss）');
    if (pl.aud !== c.googleClientId) throw bad('bad_token', 'Google 登入資料驗證失敗（aud）');
    if (!(pl.exp > now - 60) || (pl.iat && pl.iat > now + 300)) throw bad('token_expired', 'Google 登入已逾時，請再試一次');
    if (!pl.sub || !/^[0-9A-Za-z_-]{1,64}$/.test(String(pl.sub))) throw bad('bad_token', 'Google 登入資料不正確');
    if (pl.email && pl.email_verified !== true && pl.email_verified !== 'true') throw bad('email_unverified', '這個 Google 帳號的信箱尚未驗證，請先到 Google 完成驗證');
    return { provider: 'google', sub: String(pl.sub), email: pl.email ? String(pl.email).trim().toLowerCase() : null, name: clampStr(pl.name || pl.given_name || '', 40) };
  }

  // ---------- LINE ----------
  lineBegin(cur, mode) {
    const c = this.conf(); if (!this.providers().line) throw new HttpError(503, 'line_disabled', 'LINE 登入尚未開放');
    mode = mode === 'bind' ? 'bind' : 'login';
    if (mode === 'bind' && !(cur && cur.username)) throw new HttpError(403, 'members_only', '請先登入會員再綁定 LINE');
    this.db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 24 * 3600e3);
    const state = randToken(24), nonce = randToken(24), verifier = randToken(48);
    this.db.prepare("INSERT INTO oauth_states (id, kind, player_id, mode, nonce, verifier, created_at) VALUES (?, 'line', ?, ?, ?, ?, ?)").run(sha256(state), cur ? cur.id : null, mode, nonce, verifier, Date.now());
    const q = new URLSearchParams({ response_type: 'code', client_id: c.lineChannelId, redirect_uri: c.lineRedirect, state, scope: 'openid profile', nonce, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
    return { url: this.urls.lineAuth + '?' + q.toString() };
  }
  // 回呼：換 token → 驗證 id_token → 存結果（一次性代碼 r）→ 導回遊戲
  async lineCallback(query) {
    const c = this.conf(), back = (p) => `${c.base || ''}/?${new URLSearchParams({ auth: 'line', ...p })}`;
    const st = query.state ? this.db.prepare("SELECT * FROM oauth_states WHERE id=? AND kind='line'").get(sha256(String(query.state))) : null;
    if (!st || st.used_at || Date.now() - st.created_at > STATE_TTL) return back({ err: 'expired' });
    this.db.prepare('UPDATE oauth_states SET used_at=? WHERE id=?').run(Date.now(), st.id);
    if (query.error) return back({ err: query.error === 'access_denied' ? 'cancelled' : 'failed' });
    if (!query.code || String(query.code).length > 512) return back({ err: 'failed' });
    let info;
    try {
      const tr = await this.fetch(this.urls.lineToken, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: String(query.code), redirect_uri: c.lineRedirect, client_id: c.lineChannelId, client_secret: c.lineSecret, code_verifier: st.verifier }).toString() });
      const tj = await tr.json().catch(() => ({})); if (!tr.ok || !tj.id_token) throw new Error('token ' + tr.status + ' ' + (tj.error || ''));
      const vr = await this.fetch(this.urls.lineVerify, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id_token: tj.id_token, client_id: c.lineChannelId, nonce: st.nonce }).toString() });
      const v = await vr.json().catch(() => ({})); if (!vr.ok) throw new Error('verify ' + vr.status + ' ' + (v.error || ''));
      if (v.iss !== 'https://access.line.me' || String(v.aud) !== c.lineChannelId || v.nonce !== st.nonce || !(v.exp > Date.now() / 1000 - 60) || !v.sub) throw new Error('claims');
      info = { provider: 'line', sub: String(v.sub).slice(0, 64), email: v.email ? String(v.email).trim().toLowerCase() : null, name: clampStr(v.name || '', 40) };
    } catch (e) { console.warn('[auth] LINE 驗證失敗', String(e.message || e).slice(0, 120)); return back({ err: 'failed' }); }
    const r = randToken(24);
    this.db.prepare("INSERT INTO oauth_states (id, kind, player_id, mode, data, created_at) VALUES (?, 'result', ?, ?, ?, ?)").run(sha256(r), st.player_id, st.mode, JSON.stringify(info), Date.now());
    return back({ r });
  }
  lineResult(r, cur, body) {
    const row = r ? this.db.prepare("SELECT * FROM oauth_states WHERE id=? AND kind='result'").get(sha256(String(r))) : null;
    if (!row || row.used_at || Date.now() - row.created_at > RESULT_TTL) throw bad('expired', 'LINE 登入已逾時，請再試一次');
    if (row.player_id && (!cur || cur.id !== row.player_id)) throw new HttpError(403, 'session_mismatch', '登入狀態已改變，請重新用 LINE 登入');
    const out = this.resolve(JSON.parse(row.data), cur, { mode: row.mode, choice: body.choice, guestProgress: !!body.guestProgress });
    if (out.status !== 'choice_needed') this.db.prepare('UPDATE oauth_states SET used_at=? WHERE id=?').run(Date.now(), row.id);
    return out;
  }

  // ---------- 共用：登入／建立／綁定 ----------
  resolve(info, cur, { mode = 'login', choice, guestProgress } = {}) {
    const P = this.players, db = this.db, t = Date.now(), name = PNAME[info.provider];
    const ident = db.prepare('SELECT * FROM player_identities WHERE provider=? AND sub=?').get(info.provider, info.sub);
    const emailFree = (pid) => info.email && !db.prepare('SELECT 1 FROM players WHERE email=? COLLATE NOCASE AND id<>?').get(info.email, pid || 0);
    const done = (pid, o) => { const p = P.get(pid); P.assertNotBanned(p); db.prepare('UPDATE player_identities SET last_login=? WHERE provider=? AND sub=?').run(t, info.provider, info.sub); P.touch(pid); P.logEvent(pid, 'login', { via: info.provider }); return { status: 'ok', token: P.issueToken(pid), player: P.publicPlayer(P.get(pid)), ...o }; };
    if (mode === 'bind') {
      if (!cur || !cur.username) throw new HttpError(403, 'members_only', `請先登入會員再綁定 ${name}`);
      if (ident) { if (ident.player_id === cur.id) return { status: 'ok', already: true, player: P.publicPlayer(P.get(cur.id)) }; throw new HttpError(409, 'identity_taken', `這個 ${name} 帳號已經綁定其他會員`); }
      if (db.prepare('SELECT 1 FROM player_identities WHERE player_id=? AND provider=?').get(cur.id, info.provider)) throw new HttpError(409, 'already_linked', `你的會員已經綁定另一個 ${name} 帳號，請先解除綁定`);
      db.prepare('INSERT INTO player_identities (provider, sub, player_id, email, name, created_at, last_login) VALUES (?,?,?,?,?,?,?)').run(info.provider, info.sub, cur.id, info.email, info.name || null, t, t);
      if (!cur.email && emailFree(cur.id)) db.prepare('UPDATE players SET email=? WHERE id=?').run(info.email, cur.id);
      P.logEvent(cur.id, 'identity_linked', { provider: info.provider });
      return { status: 'ok', linked: true, player: P.publicPlayer(P.get(cur.id)) };
    }
    if (ident) {
      const target = P.get(ident.player_id); P.assertNotBanned(target);
      if (cur && cur.id === target.id) return done(target.id, { switched: false });
      if (cur && !cur.username && guestProgress && choice !== 'account') {
        const sv = db.prepare('SELECT data FROM saves WHERE player_id=?').get(target.id); let fish = 0, coins = 0; try { const s = JSON.parse(sv.data); fish = (s.fish || []).length; coins = Math.floor(s.coins || 0); } catch (e) { /* 沒有存檔 */ }
        return { status: 'choice_needed', account: { nickname: target.nickname || '', fish, coins, lastSeen: target.last_seen, provider: info.provider } };
      }
      return done(target.id, { switched: true });
    }
    if (info.email && !emailFree(0)) throw new HttpError(409, 'email_registered', `這個 ${name} 信箱已經是會員：請先用信箱密碼登入，再到 👤 會員中心綁定 ${name}`);
    const uname = info.provider + ':' + info.sub, nick = clampStr(info.name || `${name}玩家`, 20);
    if (cur && cur.username) throw new HttpError(409, 'logged_in', `你已登入其他會員；要綁定 ${name} 請到 👤 會員中心`);
    let pid;
    const tx = db.transaction(() => {
      if (cur) { pid = cur.id; db.prepare("UPDATE players SET username=?, email=?, nickname=CASE WHEN nickname='' THEN ? ELSE nickname END, bound_at=?, device_hash=NULL, email_verified_at=? WHERE id=? AND username IS NULL").run(uname, info.email, nick, t, info.email ? t : null, pid); }
      else { pid = db.prepare('INSERT INTO players (username, email, nickname, bound_at, created_at, last_seen, email_verified_at) VALUES (?,?,?,?,?,?,?)').run(uname, info.email, nick, t, t, t, info.email ? t : null).lastInsertRowid; P.logEvent(pid, 'account_created', { via: info.provider }); }
      db.prepare('INSERT INTO player_identities (provider, sub, player_id, email, name, created_at, last_login) VALUES (?,?,?,?,?,?,?)').run(info.provider, info.sub, pid, info.email, info.name || null, t, t);
    });
    tx();
    P.logEvent(pid, 'account_bound', { via: info.provider });
    return done(pid, { switched: !cur, created: true });
  }
  unlink(pid, provider) {
    if (!PROVIDERS.includes(provider)) throw bad('bad_provider', '不支援的登入方式');
    const p = this.players.get(pid); if (!p || !p.username) throw new HttpError(403, 'members_only', '只有會員可以解除綁定');
    const ids = this.identities(pid); if (!ids.some((x) => x.provider === provider)) throw bad('not_linked', `尚未綁定 ${PNAME[provider]}`);
    const methods = (p.pass_hash ? 1 : 0) + ids.length;
    if (methods <= 1) throw new HttpError(409, 'last_method', `這是你唯一的登入方式，不能解除綁定（請先設定其他登入方式）`);
    this.db.prepare('DELETE FROM player_identities WHERE player_id=? AND provider=?').run(pid, provider);
    this.players.logEvent(pid, 'identity_unlinked', { provider });
    return { ok: true, player: this.players.publicPlayer(this.players.get(pid)) };
  }
}
module.exports = { OAuth, PROVIDERS };
