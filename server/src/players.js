'use strict';
const bcrypt = require('bcryptjs');
const { sha256, randToken, HttpError, bad, parseJSON, clampStr, RateLimiter } = require('./util');
const { checkSave } = require('./anticheat');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const maskEmail = (e) => { const [u, d] = e.split('@'); return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d; };
const EVENT_TYPE_RE = /^[a-z][a-z0-9_.:-]{0,39}$/;

// 版本比較：'4.0.6' < '4.1.0'（數字逐段比較）
function cmpBuild(a, b) { const x = String(a).split(/[.\-]/).map((n) => parseInt(n, 10) || 0), y = String(b).split(/[.\-]/).map((n) => parseInt(n, 10) || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; }

class Players {
  constructor(db, configStore, dayFn, commerceRef) {
    this.db = db; this.cfg = configStore; this.day = dayFn; this.commerceRef = commerceRef;
    this._syncRejectRl = new RateLimiter({ windowMs: 60000, max: 12 });
  }

  // ---------- 帳號 ----------
  // 會員帳號＝信箱。publicPlayer 只回給玩家本人，所以給完整信箱（畫面窄時由遊戲端遮罩），另附 emailMasked。
  publicPlayer(p) {
    const email = p.email || (p.username && p.username.includes('@') ? p.username : null);
    let providers = []; try { providers = this.db.prepare('SELECT provider, name FROM player_identities WHERE player_id=? ORDER BY created_at').all(p.id); } catch (e) { /* v4.2-auth 之前沒有此表 */ }
    const oa = /^(google|line):/.exec(p.username || ''), label = oa ? (oa[1] === 'line' ? 'LINE' : 'Google') + ' 會員' : null;
    return { id: p.id, username: oa ? null : (p.username || null), account: email || label || p.username || null, hasPassword: !!p.pass_hash, providers: providers.map((x) => ({ provider: x.provider, name: x.name || null })), nickname: p.nickname, bound: !!p.username, email, emailMasked: email ? maskEmail(email) : null, emailVerified: !!p.email_verified_at, createdAt: p.created_at, gems: p.gems };
  }
  findByAccount(id) {
    if (typeof id !== 'string' || !id.trim()) return null;
    const k = id.trim();
    if (k.includes('@')) { const e = normEmail(k); return this.db.prepare('SELECT * FROM players WHERE email=? COLLATE NOCASE OR username=? COLLATE NOCASE ORDER BY id LIMIT 1').get(e, e); }
    return this.db.prepare('SELECT * FROM players WHERE username=?').get(k); // 舊版「帳號名稱」會員仍可登入
  }
  get(id) { return this.db.prepare('SELECT * FROM players WHERE id=?').get(id); }
  assertNotBanned(p) { if (p.banned_at) throw new HttpError(403, 'banned', '此帳號已被停權', { reason: p.ban_reason || '' }); }

  issueToken(pid) {
    const token = randToken(32);
    const t = Date.now();
    this.db.prepare('INSERT INTO player_tokens (token_hash, player_id, created_at, last_used) VALUES (?,?,?,?)').run(sha256(token), pid, t, t);
    // 每位玩家最多保留 10 個 token
    this.db.prepare('DELETE FROM player_tokens WHERE player_id=? AND token_hash NOT IN (SELECT token_hash FROM player_tokens WHERE player_id=? ORDER BY last_used DESC LIMIT 10)').run(pid, pid);
    return token;
  }

  guest(deviceToken) {
    if (typeof deviceToken !== 'string' || deviceToken.length < 20 || deviceToken.length > 200) throw bad('invalid_device_token', 'deviceToken 需為 20–200 字元的隨機字串');
    const h = sha256('device:' + deviceToken);
    let p = this.db.prepare('SELECT * FROM players WHERE device_hash=?').get(h);
    let created = false;
    if (!p) {
      const t = Date.now();
      const id = this.db.prepare('INSERT INTO players (device_hash, created_at, last_seen) VALUES (?,?,?)').run(h, t, t).lastInsertRowid;
      p = this.get(id); created = true;
      this.logEvent(id, 'account_created', { via: 'guest' });
    }
    this.assertNotBanned(p);
    this.touch(p.id);
    return { token: this.issueToken(p.id), player: this.publicPlayer(p), created };
  }

  // 綁定（註冊）：把目前的訪客帳號升級為會員帳號，魚缸／存檔／寶石全部保留。
  // 綁定後清除裝置 token 對應（device_hash），之後只能用 player token 或帳密登入，避免共用裝置登出後被自動登回。
  // 會員帳號＝信箱：email 會 trim＋轉小寫，不分大小寫唯一。帳號欄位（username）同樣存信箱，讓既有「已綁定」判斷不變。
  // TODO(信箱驗證)：接上寄信服務後，在這裡寄出驗證信（email_verified_at 目前一律為 NULL）。
  async register(pid, email, password, nickname) {
    const p = this.get(pid);
    if (p.username) throw bad('already_bound', '此帳號已經是會員');
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) throw bad('invalid_email', '信箱格式不正確');
    email = normEmail(email);
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('invalid_password', '密碼長度需為 8–128 字元');
    const pl = password.toLowerCase();
    if (/^\d+$/.test(password) || pl === email || pl === email.split('@')[0]) throw bad('weak_password', '密碼太簡單：不可全為數字或與信箱相同');
    if (this.findByAccount(email)) throw new HttpError(409, 'email_taken', '此信箱已註冊');
    const hash = await bcrypt.hash(password, 10);
    try {
      this.db.prepare('UPDATE players SET username=?, pass_hash=?, nickname=?, email=?, bound_at=?, device_hash=NULL WHERE id=?').run(email, hash, clampStr(nickname || email.split('@')[0], 20), email, Date.now(), pid);
    } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'email_taken', '此信箱已註冊'); throw e; }
    this.logEvent(pid, 'account_bound', { email: maskEmail(email) });
    return this.publicPlayer(this.get(pid));
  }

  // NICKNAME-V1：會員自助改暱稱（綁定後也能改）。過濾控制字元／HTML、1–16 字、沿用沙灘不雅字詞過濾；24 小時內最多改 3 次。
  setNickname(pid, raw) {
    const p = this.get(pid);
    if (!p) throw new HttpError(404, 'not_found', '找不到玩家');
    if (!p.username) throw new HttpError(403, 'members_only', '請先註冊或登入會員再修改暱稱');
    if (typeof raw !== 'string') throw bad('invalid_nickname', '請輸入暱稱');
    let n = raw.normalize('NFKC').replace(/<[^>]*>/g, '').replace(/[<>&"'`\\]/g, '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const len = Array.from(n).length;
    if (!len) throw bad('invalid_nickname', '請輸入暱稱（不能只有空白或符號）');
    if (len > 16) throw bad('nickname_too_long', '暱稱最多 16 個字');
    if (require('./beach').badWord(n)) throw bad('bad_words', '暱稱含有不適當的字詞，請換一個');
    if (/^魚友\s*#|管理員|官方|客服|系統|^gm$|admin/i.test(n)) throw bad('reserved_nickname', '這個暱稱不能使用，請換一個');
    if (n === p.nickname) return { player: this.publicPlayer(p), unchanged: true };
    const used = this.db.prepare("SELECT COUNT(*) n FROM events WHERE player_id=? AND type='nickname_changed' AND created_at>?").get(pid, Date.now() - 86400000).n;
    if (used >= 3) throw new HttpError(429, 'nickname_limit', '24 小時內最多改 3 次暱稱，請明天再試');
    this.db.prepare('UPDATE players SET nickname=? WHERE id=?').run(n, pid);
    this.logEvent(pid, 'nickname_changed', { from: String(p.nickname || '').slice(0, 20), to: n });
    return { player: this.publicPlayer(this.get(pid)) };
  }

  // 後台重設會員密碼（並登出所有裝置）。TODO(忘記密碼)：接上寄信服務後，提供玩家自助重設（寄送一次性連結）。
  async adminSetPassword(pid, password) {
    const p = this.get(pid);
    if (!p) throw new HttpError(404, 'not_found', '找不到玩家');
    if (!p.username) throw bad('not_member', '訪客帳號沒有密碼可重設');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('invalid_password', '密碼長度需為 8–128 字元');
    this.db.prepare('UPDATE players SET pass_hash=? WHERE id=?').run(await bcrypt.hash(password, 10), pid);
    this.db.prepare('DELETE FROM player_tokens WHERE player_id=?').run(pid);
    this.logEvent(pid, 'password_reset_by_admin', {});
    return { ok: true };
  }

  async login(account, password) {
    const p = this.findByAccount(account);
    // 帳號不存在時也跑一次 bcrypt，避免以回應時間判斷帳號是否存在
    const ok = await bcrypt.compare(String(password || ''), p && p.pass_hash ? p.pass_hash : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8DPLKXt1FYlwYpQW2G3cAwjKoh2WZe');
    if (p && !p.pass_hash && /^(google|line):/.test(p.username || '')) throw new HttpError(401, 'use_provider', `這個會員是用 ${p.username.startsWith('line:') ? 'LINE' : 'Google'} 登入的，請點「${p.username.startsWith('line:') ? 'LINE' : 'Google'} 登入」`);
    if (!p || !p.pass_hash || !ok) throw new HttpError(401, 'bad_credentials', '信箱或密碼錯誤');
    this.assertNotBanned(p);
    this.touch(p.id);
    this.logEvent(p.id, 'login', {});
    return { token: this.issueToken(p.id), player: this.publicPlayer(p) };
  }

  logout(token) { this.db.prepare('DELETE FROM player_tokens WHERE token_hash=?').run(sha256(token)); }

  // Express middleware：Authorization: Bearer <token>
  auth() {
    return (req, res, next) => {
      const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') || '');
      if (!m) return next(new HttpError(401, 'unauthorized', '需要登入'));
      const row = this.db.prepare('SELECT p.*, t.token_hash FROM player_tokens t JOIN players p ON p.id=t.player_id WHERE t.token_hash=?').get(sha256(m[1]));
      if (!row) return next(new HttpError(401, 'unauthorized', '登入已失效'));
      try { this.assertNotBanned(row); } catch (e) { return next(e); }
      this.db.prepare('UPDATE player_tokens SET last_used=? WHERE token_hash=?').run(Date.now(), row.token_hash);
      req.player = row; req.playerToken = m[1];
      next();
    };
  }

  touch(pid, t = Date.now()) {
    this.db.prepare('UPDATE players SET last_seen=? WHERE id=?').run(t, pid);
    this.db.prepare('INSERT OR IGNORE INTO daily_active (day, player_id) VALUES (?,?)').run(this.day(t), pid);
  }

  // ---------- 心跳 / 事件 ----------
  heartbeat(pid, sessionId, ua) { /*V406P*/
    const t = Date.now();
    let s = sessionId ? this.db.prepare('SELECT * FROM game_sessions WHERE id=? AND player_id=?').get(sessionId, pid) : null;
    const cont = !!(s && t - s.last_beat <= 120000), gap = cont ? t - s.last_beat : 0;
    if (cont) this.db.prepare('UPDATE game_sessions SET last_beat=? WHERE id=?').run(t, s.id);
    else s = { id: this.db.prepare('INSERT INTO game_sessions (player_id, started_at, last_beat) VALUES (?,?,?)').run(pid, t, t).lastInsertRowid };
    if (this.ps) try { this.ps.beat(pid, t, gap, !cont, ua); } catch (e) { /* 統計失敗不影響心跳 */ }
    this.touch(pid, t);
    return { sessionId: Number(s.id), serverTime: t };
  }

  logEvent(pid, type, data, t = Date.now()) {
    this.db.prepare('INSERT INTO events (player_id, type, data, created_at) VALUES (?,?,?,?)').run(pid, type, data == null ? null : JSON.stringify(data), t);
  }

  logClientEvents(pid, events) {
    if (!Array.isArray(events) || !events.length) throw bad('invalid_events', 'events 需為非空陣列');
    if (events.length > 50) throw bad('too_many_events', '一次最多 50 筆事件');
    const ins = this.db.transaction(() => {
      let n = 0;
      for (const e of events) {
        if (!e || typeof e.type !== 'string' || !EVENT_TYPE_RE.test(e.type)) continue;
        const data = e.data == null ? null : JSON.stringify(e.data);
        if (data && data.length > 2048) continue;
        this.db.prepare('INSERT INTO events (player_id, type, data, created_at) VALUES (?,?,?,?)').run(pid, 'c:' + e.type, data, Date.now());
        n++;
      }
      return n;
    });
    return ins();
  }

  // ---------- 存檔 ----------
  getSave(pid) {
    const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid);
    if (!row) return { save: null, rev: 0, updatedAt: null };
    const save=JSON.parse(row.data);require('./breed-value329').hydrate(this.db,pid,save.fish);if(this.aquarist?.enabled())save._aquarist=this.aquarist.summary(pid)||this.aquarist.observe(pid,save);else delete save._aquarist;
    return { save, rev: row.rev, updatedAt: row.updated_at };
  }

  putSave(pid, body) { /*V406*/
    if (!body || typeof body !== 'object') throw bad('invalid_body', '缺少內容');
    const next = body.save;
    const build = typeof body.client === 'string' && /^[0-9][0-9A-Za-z.\-]{0,19}$/.test(body.client) ? body.client : null;
    const baseRev = Number.isInteger(body.rev) ? body.rev : 0;
    const t = Date.now();
    const cfg = this.cfg.active().config;
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid);
      const curRev = row ? row.rev : 0;
      if (baseRev !== curRev) throw new HttpError(409, 'conflict', '雲端存檔已被其他裝置或後台更新，請重新載入', { rev: curRev, save: row ? JSON.parse(row.data) : null });
      if (this.fishStorage) this.fishStorage.activeGuard(pid, next && next.fish);
      const prev = row ? JSON.parse(row.data) : null;
      // PLANT182: old cached pages may trim an expanded tank to their old 60-plant ceiling.
      if(cfg.aquascape?.rules?.tankScaledPlants&&prev?.plants?.length>60&&Array.isArray(next?.plants)&&next.plants.length<prev.plants.length&&(!build||cmpBuild(build,'4.2.182')<0))return {rejected:{code:'client_outdated',reload:true,reasons:['水草容量已擴充，請手動重新載入新版，避免漏存水草']}};

      // A current SDK revision alone cannot prove an old queued snapshot adopted a server grant.
      // Pin every server-written state until the client echoes its generation; no flags on sync races.
      if (prev && prev._serverSync && next && typeof next === 'object' && !Array.isArray(next) && next._serverSync !== prev._serverSync) {
        const syncKey = `sync:${pid}:${prev._serverSync}:${baseRev}`;
        const rl = this._syncRejectRl.check(syncKey);
        if (!rl.ok) throw new HttpError(429, 'too_frequent', '同步衝突過於頻繁，請稍後再試', { retryAfter: rl.retryAfter });
        // 一律回 409 + 雲端存檔，讓現行客戶端自動採用並重試（避免舊版卡在 422 無限重試）
        throw new HttpError(409, 'server_state_changed', '儲值、獎勵或魚缸資料已更新，已保留雲端版本', { rev: curRev, save: prev, code: 'sync_required', reload: false, reasons: ['儲值或獎勵已安全入帳，請載入最新魚缸後再同步'] });
      }
      if(next && typeof next === 'object' && !Array.isArray(next)) next._serverSync = prev?._serverSync || 0;

      // 🎨 外觀（寶石購買）由伺服器發放；舊版客戶端不認得 cos 欄位，存檔沒帶時沿用上一份，避免弄丟
      if (prev && prev.cos && next && typeof next === 'object' && !Array.isArray(next) && next.cos == null) next.cos = prev.cos;
      // Permanent purchased scenery belongs to the cloud account; older cached pages may omit it.
      if (prev && Array.isArray(next?.up?.deco)) for (const id of (prev.up?.deco || [])) {
        if (cfg.decorations[id]?.priceGems > 0 && !next.up.deco.includes(id)) next.up.deco.push(id);
      }
      // DECO-OWNERSHIP147: only inventory operations may remove an owned decoration.
      // A missing entry in a stale/partial client save must not erase a coin purchase.
      if (prev && Array.isArray(next?.up?.deco)) {
        const missing = (prev.up?.deco || []).filter(id => cfg.decorations[id] && !next.up.deco.includes(id));
        if (missing.length) throw new HttpError(409, 'server_state_changed', '造景資料已更新，已保留雲端版本，請載入最新魚缸', { rev: curRev, save: prev, code: 'sync_required', reload: false, reasons: ['已保留購買的造景；收納或出售請從造景管理操作'] });
      }
      if(this.decoInventory)this.decoInventory.guard(pid,next);
      const { stripClientLegacy, pruneLegacyDeco } = require('./legacy-deco');
      stripClientLegacy(prev, next);
      if (next && this.decoInventory) {
        const bundles = this.decoInventory.list(pid).map((b) => ({ ids: b.ids }));
        if(this.multiTanks)bundles.push({ids:this.multiTanks.deco(pid)});
        pruneLegacyDeco(cfg, next, bundles);
      }
      if (next && typeof next === 'object' && !Array.isArray(next)) {
        const { sanitizeDecoS } = require('./deco-scale');
        sanitizeDecoS(next);
        // BACTERIA-AUTO-NUM-V1: 4.2.115+ clients wrote water.bacteriaAuto=true; normalize legacy values instead of rejecting the save.
        const w = next.water;
        if (w && typeof w === 'object' && !Array.isArray(w) && Object.prototype.hasOwnProperty.call(w, 'bacteriaAuto')) {
          const v = w.bacteriaAuto;
          if (typeof v === 'boolean') w.bacteriaAuto = v ? 1 : 0;
          else if (v != null && !(typeof v === 'number' && Number.isFinite(v))) delete w.bacteriaAuto;
        }
      }
      const vipBonus = this.commerceRef.current ? this.commerceRef.current.vipPerks(pid).coinBonus || 0 : 0;
      // 這段存檔時間內的客戶端繁殖／賣魚事件（反作弊補算「生了又賣掉」的魚）
      const events = prev && row.client_saved_at ? this.db.prepare("SELECT type, data FROM events WHERE player_id=? AND created_at>? AND created_at<=? AND type IN ('c:breed','c:sell_fish','c:fish_died','c:fish_eaten','deco_sell','fish_storage_buy','fish_storage_sell','fish_storage_sell_many','task_coin_claim') ORDER BY id LIMIT 500").all(pid, row.client_saved_at - 15000, t).map((e) => { let d = null; try { d = JSON.parse(e.data); } catch {} return { type: e.type, data: d }; }) : [];
      // Preserve owned jellyfish omitted by a client with an incomplete fallback catalogue.
      require('./jelly-preserve313').preserveJellies(prev,next,cfg,events);
      require('./mammal-protect321').preserveMammals(prev,next,cfg,events);
      const BV329=require('./breed-value329');if(prev?.fish)BV329.hydrate(this.db,pid,prev.fish);BV329.sync(this.db,pid,prev?.fish,next?.fish);
      for(const f of prev?.fish||[]){if(next?.fish?.some(q=>q.id===f.id))continue;const e=events.find(e=>e.type==='c:sell_fish'&&e.data?.id===f.id&&e.data.sp===f.sp);if(!e)continue;const sp=require('./anticheat').spOf(cfg,f.sp),st=2,v=BV329.value(cfg,f,sp,st);if(v!=null&&e.data.v>v)return{rejected:{code:'breed_sale_price_changed',reload:true,reasons:['繁殖魚售價已更新，魚隻與雲端金幣仍保留，請正常重新開啟遊戲確認新價格'],info:{fishId:f.id,price:v}}};}
      // A due, server-issued egg creates one baby without purchase or breeding costs.
      // Validate against a virtual baseline containing only that newborn; all other checks stay active.
      // Older pages do not understand nested hybrid IDs. Keep those fish server-side when omitted.
      if(prev&&Array.isArray(next?.fish))for(const f of prev.fish||[]){if(!f.sp?.includes('%')||next.fish.some(q=>q.id===f.id))continue;const deliberate=events.some(e=>['c:sell_fish','c:fish_died'].includes(e.type)&&e.data?.sp===f.sp&&(!e.data.id||e.data.id===f.id));if(!deliberate){next.fish.push({...f});next.found=next.found||{};next.found[f.sp]=prev.found?.[f.sp]||1;if(prev.adult?.[f.sp]){next.adult=next.adult||{};next.adult[f.sp]=prev.adult[f.sp]}}}
      let validationPrev=prev,hatchFish=null;
      if(prev?.egg&&!next?.egg&&Array.isArray(next?.fish)&&Number.isFinite(prev.egg.at)&&prev.egg.at<=t&&this.db.prepare('SELECT tutorial_at FROM player_onboard WHERE player_id=?').get(pid)?.tutorial_at){
        const oldIds=new Set((prev.fish||[]).map(f=>f.id)),added=next.fish.filter(f=>!oldIds.has(f.id));
        if(added.length===1&&added[0].sp===prev.egg.sp&&added[0].growth>=0&&added[0].growth<cfg.stages[2].growth){
          hatchFish=added[0];validationPrev={...prev,fish:[...prev.fish,{...hatchFish,growth:0}],egg:null};
          next.nb=next.nb||{g:3,skip:1,legacy:1,claimed:1};next.nb.d=next.nb.d||{};next.nb.d.hatch=next.nb.d.hatch||t;
        }
      }
      if(prev?.egg&&!next?.egg&&!hatchFish)throw new HttpError(409,'egg_hatch_pending','魚蛋孵化尚未確認，已保留雲端魚蛋',{rev:curRev,save:prev});
      // Parent records are authoritative and survive saves from older clients.
      const priorFish=new Map((prev?.fish||[]).map(f=>[f.id,f]));for(const f of next.fish||[]){const old=priorFish.get(f.id);if(old?.gift===1)f.gift=1;if(old?.giftFrom)f.giftFrom=old.giftFrom;else delete f.giftFrom}for(const f of next.fish||[]){const prior=priorFish.get(f.id);if(prior?.lineage){f.lineage=prior.lineage;if(prior.lineage.correctedFrom&&f.sp===prior.lineage.correctedFrom)f.sp=prior.sp}else delete f.lineage}
      // FISHING-CAUGHT-KEEP-V1: 釣魚來源標記 f.caught 只由伺服器寫入；舊版客戶端存檔會漏掉它 → 依 id 從雲端沿用，客戶端自己加的一律移除
      { const pc=new Map(); for(const f of (prev&&prev.fish)||[]) if(f&&f.caught&&typeof f.caught==='object') pc.set(f.id,f.caught); for(const f of (next&&Array.isArray(next.fish)?next.fish:[])) { if(!f||typeof f!=='object') continue; if(pc.has(f.id)) f.caught=pc.get(f.id); else if(f.caught!==undefined) delete f.caught; } }
      // COINSINK-B2: 全帳號合算 softcap + 每日生產上限
      const dailyProd = require('./daily-production');
      const otherTankSaves = this.multiTanks ? this.multiTanks.rows(pid).filter(r => r.data).map(r => JSON.parse(r.data)) : [];
      const allSaves = next ? [next, ...otherTankSaves] : otherTankSaves;
      const dailyRem = dailyProd.remaining(this.db, pid, cfg, t);
      // 若金幣增量超出每日剩餘，夾住 next.coins（不拒絕整份存檔，誠實玩家不會被 422 炸傷）
      if (prev && next && typeof next.coins === 'number') {
        const rawDelta = Math.max(0, (next.coins || 0) - (prev.coins || 0));
        if (rawDelta > dailyRem) next.coins = (prev.coins || 0) + dailyRem;
      }
      const r = checkSave(cfg, validationPrev, row ? row.client_saved_at : 0, next, t, { vipCoinBonus: vipBonus, events, coinRateMult: this.newbieRef ? this.newbieRef.coinRateMult(this.get(pid), t) : 1, coinsinkPurchases: require('./coinsink-purchase').loadPurchaseSets(this.db, pid), allSaves, dailyProductionRemaining: dailyRem, ...(this.breedQuotaRef && this.breedQuotaRef.current ? { serverBreeds: this.breedQuotaRef.current.usesBetween(pid, row ? row.client_saved_at - 15000 : 0, t) } : {}) });
      if (r.structural.length) throw bad('invalid_save', '存檔格式錯誤', { errors: r.structural });
      // FSV1-SAVE-GUARD: 舊版頁面（設定裡還沒有 fs_ 釣魚魚種）載入存檔時會把 fs_ 魚濾掉；不能讓它把釣到的魚／圖鑑紀錄蓋掉
      if (prev && next && typeof next === 'object' && Array.isArray(next.fish)) {
        for (const k of Object.keys((prev.found && typeof prev.found === 'object') ? prev.found : {})) if (k.startsWith('fs_') && cfg.species[k]) { next.found = next.found && typeof next.found === 'object' ? next.found : {}; if (!next.found[k]) next.found[k] = prev.found[k]; }
        for (const f of prev.fish || []) {
          if (!f || typeof f.sp !== 'string' || !f.sp.startsWith('fs_') || next.fish.some((q) => q && q.id === f.id)) continue;
          // FSV1-PREDATION177: a recorded capture is an intentional removal, not an outdated client.
          // Bind both identities to the prior cloud tank; a species-only/mismatched event cannot erase a fish.
          const eaten = events.some(e => e.type === 'c:fish_eaten' && e.data?.preyId === f.id && e.data.preySp === f.sp && e.data.predId !== f.id && (prev.fish || []).some(p => p.id === e.data.predId && p.sp === e.data.predSp));
          const gone = eaten || events.some((e) => ['c:sell_fish', 'c:fish_died'].includes(e.type) && e.data && (e.data.id ? e.data.id === f.id : e.data.sp === f.sp));
          if (!gone) { this.logEvent(pid, 'fsv1_fish_missing', { id: f.id, sp: f.sp, build }); return { rejected: { code: 'client_outdated', reload: true, reasons: ['釣到的魚已升級成「釣魚限定」魚種，請重新整理網頁'], info: { fsv1: f.id } } }; } // 422 + 重新整理提示（409+save 會讓舊頁面一直重送）
        }
      }
      // MONTHLY-SAVE-GUARD-V1: old clients must not silently erase a claimed monthly fish.
      for(const f of (prev&&prev.fish)||[]){
        if(!cfg.species[f.sp]?.monthlyExclusive||next.fish.some(q=>q.id===f.id))continue;
        if(!this.db.prepare('SELECT 1 FROM monthly_fish_claims WHERE player_id=? AND fish_id=? AND claimed_at IS NOT NULL').get(pid,f.id))continue;
        const removedDeliberately=events.some(e=>['c:sell_fish','c:fish_died'].includes(e.type)&&e.data&&e.data.sp===f.sp&&(!e.data.id||e.data.id===f.id));
        if(!removedDeliberately)throw new HttpError(409,'monthly_fish_missing','月卡魚遭到未確認的移除，已保留雲端版本；請重新整理遊戲載入最新保護',{rev:curRev,save:prev});
      }

      // 🐣 每日繁殖次數：新寶寶要有伺服器的繁殖 token；只能繁殖得到的魚沒有 token → 可疑；一般魚沒有 token → 算金幣購買
      const bv = this.breedVerify && prev ? this.breedVerify(pid, cfg, validationPrev, next) : null;
      if (bv) { r.suspicious.push(...bv.suspicious); if (bv.spent && r.info && Number.isFinite(r.info.allowed) && next.coins > r.info.allowed - bv.spent && !r.suspicious.some((x) => x.startsWith('金幣增加過快'))) r.suspicious.push(`金幣增加過快：新買的魚 🪙${bv.spent} 沒有扣到金幣`); }
      if (r.tooFrequent) throw new HttpError(429, 'too_frequent', '存檔太頻繁，請稍後再試');
      const mode = (cfg.antiCheat && cfg.antiCheat.mode) || 'off';
      const minB = (cfg.antiCheat && cfg.antiCheat.minClientBuild) || '';
      // 舊版網頁（版本低於設定的最低版本）：不存、不算可疑，請客戶端重新整理
      if (minB && ((build && cmpBuild(build, minB) < 0) || (!build && cfg.antiCheat.rejectUnversioned === true))) {
        this.logEvent(pid, 'client_outdated', { build, min: minB });
        return { rejected: { code: 'client_outdated', reload: true, reasons: ['遊戲已更新，請重新整理網頁'], info: { build, min: minB } } };
      }
      const limit = (bv && bv.limit) || [];
      if (r.suspicious.length && mode !== 'off') {
        this.db.prepare('UPDATE players SET flags=flags+1 WHERE id=?').run(pid);
        this.logEvent(pid, mode === 'reject' ? 'anticheat_reject' : 'anticheat_flag', { reasons: r.suspicious, info: r.info, ...(limit.length ? { limit } : {}), build, flagged: true });
        if (mode === 'reject') return { rejected: { code: 'suspicious', reasons: [...r.suspicious, ...limit], info: r.info } };
      }
      // 🌿 草本藥冷卻中：不是作弊（舊分頁沒有冷卻檢查）→ 不加 flags；拒絕並請客戶端載回雲端、重新整理 /*V406M*/
      const medLimit = (r.info && r.info.medLimit) || [];
      if (medLimit.length && mode === 'reject' && !limit.length) {
        this.logEvent(pid, 'med_cooldown_reject', { reasons: medLimit, build });
        return { rejected: { code: 'med_cooldown', reload: true, reasons: medLimit, info: {} } };
      }
      if (medLimit.length && mode === 'flag') this.logEvent(pid, 'med_cooldown_over', { reasons: medLimit, build });
      // 🐣 超過每日繁殖次數：不是作弊（多半是沒重新整理的舊分頁）→ 不加 flags；拒絕這份存檔並請客戶端載回雲端、重新整理
      if (limit.length && mode === 'reject') {
        this.logEvent(pid, 'breed_limit_reject', { reasons: limit, info: { ...(bv.limitInfo || {}), elapsed: r.info && r.info.elapsed }, build });
        return { rejected: { code: 'breed_limit', reload: true, reasons: limit, info: bv.limitInfo || {} } };
      }
      if (limit.length) this.logEvent(pid, 'breed_limit_over', { reasons: limit, info: bv.limitInfo || {}, build });
      const rev = curRev + 1;
      if (bv) bv.commit();
      this.writeSaveRow(pid, next, rev, t, true, true);
      if(hatchFish)this.logEvent(pid,'tutorial_egg_hatch',{id:hatchFish.id,sp:hatchFish.sp,eggAt:prev.egg.at});
      const delta = (next.coins || 0) - (prev ? prev.coins || 0 : 0);
      if (prev) this.econ(t, delta > 0 ? delta : 0, delta < 0 ? -delta : 0, 0, pid);
      // COINSINK-B2: 記帳魚兒直接生產的金幣（扣除賣魚/造景等其他收入，剩下的算生產）
      if (prev && delta > 0 && dailyRem > 0) {
        const sold = (r.info && r.info.sold) || 0;
        const spent = (r.info && r.info.spent) || 0;
        const produced = Math.max(0, delta - sold + spent);
        if (produced > 0) dailyProd.consume(this.db, pid, produced, cfg, t);
      }
      return { rev, updatedAt: t, info: r.info, flagged: r.suspicious.length ? r.suspicious : undefined /* MANUAL-UPDATES: routine deployments never request a refresh; owner decides rollout. */ };
    });
    const out = tx();
    if (out.rejected) throw new HttpError(422, 'suspicious_save', '存檔數值異常，已被伺服器拒絕', out.rejected);
    this.touch(pid, t);
    if(this.aquarist?.enabled())out.progression=this.aquarist.summary(pid);
    return out;
  }

  // 與遊戲 freshState() + newGame() 相同的開局存檔
  freshSave(cfg) {
    const t = Date.now();
    const fish = [], found = {};
    for (const it of cfg.start.fish || []) {
      const s = cfg.species[it.species]; if (!s) continue;
      fish.push({ id: 'n' + randToken(6).replace(/[-_]/g, 'x'), sp: it.species, name: cfg.names[Math.floor(Math.random() * cfg.names.length)], hue: (s.look.hue + 360) % 360, size: 1, growth: it.growth || 0, full: cfg.hunger.startFullness, health: 100, cd: 0, coinT: 12, seed: Math.floor(Math.random() * 1e5) });
      found[it.species] = 1;
    }
    return { v: cfg.version, coins: cfg.start.coins, fish, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] }, found,
      water: { dirt: cfg.water.startDirt, waste: 0, algae: 0, cycle: cfg.cycling.startProgress, changeCdH: 0, lastChange: t, lastFed: t, feederAccH: 0 },
      items: { bacteria: cfg.cycling.bacteria.startCount }, leftover: 0, last: t, tut: 0, capV: 2 };
  }

  // 玩家自己按「重置進度」：伺服器寫入全新開局存檔（之後的上傳會以此為基準檢查）
  resetOwnSave(pid) {
    if(this.multiTanks&&this.multiTanks.rows(pid).length>1)throw bad('multi_tank_reset','多缸帳號如需重置全部進度，請先聯絡客服');
    const cfg = this.cfg.active().config;
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(pid);
      const save = this.freshSave(cfg);
      const rev = (row ? row.rev : 0) + 1;
      this.writeSaveRow(pid, save, rev, Date.now(), true);
      this.logEvent(pid, 'save_reset_by_player', {});
      return { save, rev };
    })();
  }

  writeSaveRow(pid, save, rev, t, fromClient, clientUpload = false) {
    if(this.multiTanks)this.multiTanks.assertSave(pid,save);
    if (!clientUpload) save._serverSync = rev;
    delete save._aquarist;if(this.aquarist?.enabled())save._aquarist=this.aquarist.observe(pid,save,t,clientUpload);
    const found = save.found && typeof save.found === 'object' ? Object.keys(save.found) : [];
    this.db.prepare(`INSERT INTO saves (player_id, data, rev, coins, fish_count, found_count, updated_at, client_saved_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(player_id) DO UPDATE SET data=excluded.data, rev=excluded.rev, coins=excluded.coins, fish_count=excluded.fish_count, found_count=excluded.found_count, updated_at=excluded.updated_at,
      client_saved_at=CASE WHEN ? THEN excluded.client_saved_at ELSE saves.client_saved_at END`)
      .run(pid, JSON.stringify(save), rev, save.coins || 0, (save.fish || []).length+(this.multiTanks?this.multiTanks.fish(pid).length:0), found.length, t, fromClient ? t : 0, fromClient ? 1 : 0);
    if (this.activityTracks) this.activityTracks.observeSave(pid, save);
    // 物種擁有／發現的反正規化表（給統計用）
    this.db.prepare('DELETE FROM player_species WHERE player_id=?').run(pid);
    const owned = {};
    for (const f of [...(save.fish || []), ...(this.fishStorage ? this.fishStorage.list(pid) : []), ...(this.multiTanks ? this.multiTanks.fish(pid) : [])]) owned[f.sp] = (owned[f.sp] || 0) + 1;
    const ins = this.db.prepare('INSERT INTO player_species (player_id, sp, owned, found) VALUES (?,?,?,?)');
    for (const sp of new Set([...Object.keys(owned), ...found])) ins.run(pid, sp, owned[sp] || 0, found.includes(sp) ? 1 : 0);
  }

  econ(t, earned, spent, granted, pid) {
    if (pid && this.ps) try { this.ps.coins(pid, t, earned, spent, granted); } catch (e) { /* 統計失敗不影響存檔 */ }
    this.db.prepare(`INSERT INTO economy_daily (day, earned, spent, granted) VALUES (?,?,?,?)
      ON CONFLICT(day) DO UPDATE SET earned=earned+excluded.earned, spent=spent+excluded.spent, granted=granted+excluded.granted`).run(this.day(t), earned, spent, granted);
  }

  // 伺服器端直接把內容加進存檔（信箱領取用）。必須在 transaction 內呼叫。
  grantToSave(pid, grant) {
    const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid);
    if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔再領取');
    const cfg = this.cfg.active().config;
    const save = JSON.parse(row.data);
    const added = [];
    if (grant.coins) save.coins = (save.coins || 0) + grant.coins;
    for (const it of grant.fish || []) {
      const s = cfg.species[it.species];
      if (!s) continue;
      for (let i = 0; i < Math.min(50, it.count || 1); i++) {
        const f = {
          id: 'm' + randToken(6).replace(/[-_]/g, 'x'), sp: it.species, name: cfg.names[Math.floor(Math.random() * cfg.names.length)],
          hue: ((s.look.hue + (Math.random() * 16 - 8)) + 360) % 360, size: 1, growth: it.growth || 0, full: cfg.hunger.offspringFullness,
          health: 100, cd: 0, coinT: 10, seed: Math.floor(Math.random() * 1e5),
        };
        save.fish.push(f); added.push(f);
        save.found = save.found || {}; save.found[it.species] = 1;
      }
    }
    save.up = save.up || { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] };
    if (grant.items) { save.items = save.items || {}; for (const [k, n] of Object.entries(grant.items)) if (Number.isInteger(n) && n > 0) save.items[k] = (save.items[k] || 0) + n; }
    // 造景：設備（燈具／海洋館…）、水草插枝
    const AQ = cfg.aquascape || {};
    for (const gid of grant.gear || []) if (AQ.gear && AQ.gear[gid]) { save.gear = save.gear && typeof save.gear === 'object' ? save.gear : { own: {}, light: null, temp: null }; save.gear.own = save.gear.own || {}; save.gear.own[gid] = 1; if (AQ.gear[gid].cat === 'light' && !AQ.gear[gid].nightOnly && (!save.gear.light || (AQ.gear[gid].L || 0) > (AQ.gear[save.gear.light]?.L || 0))) save.gear.light = gid; }
    if (grant.cuttings) { save.cut = save.cut || {}; for (const [k, n] of Object.entries(grant.cuttings)) if (AQ.plants && AQ.plants[k] && Number.isInteger(n) && n > 0) save.cut[k] = Math.min(99, (save.cut[k] || 0) + n); }
    if (grant.gcut) { save.gcut = save.gcut || {}; for (const [k, n] of Object.entries(grant.gcut)) if (AQ.plants && AQ.plants[k] && Number.isInteger(n) && n > 0) save.gcut[k] = Math.min((save.cut && save.cut[k]) || 0, (save.gcut[k] || 0) + n); }   // v4.2 寶石插枝（可退寶石）
    for (const d of grant.decorations || []) if (cfg.decorations[d] && !save.up.deco.includes(d)&&!this.decoInventory?.has(pid,d)&&!this.multiTanks?.deco(pid).includes(d)){save.up.deco.push(d);this.decoInventory?.reactivate(pid,d)}
    // SHOPV2-PACKS 外觀（背景）：由伺服器發放；沒有正在使用的背景時直接套上
    const cosAlreadyOwned = [];
    if (Array.isArray(grant.cosmetics) && grant.cosmetics.length) { const BG = require('./gemshop').conf(cfg).cosmetics.backgrounds; const cos = save.cos && typeof save.cos === 'object' ? save.cos : {}; cos.own = cos.own && typeof cos.own === 'object' ? cos.own : {};
      for (const id of grant.cosmetics) { if (!Object.prototype.hasOwnProperty.call(BG, id)) continue; if (cos.own[id]) { cosAlreadyOwned.push(id); continue; } cos.own[id] = 1; if (!cos.bg) cos.bg = id; } save.cos = cos; }
    if (grant.egg && cfg.species[grant.egg.sp] && !save.egg) save.egg = { sp: grant.egg.sp, at: grant.egg.at };   // v4.1.3 新手魚蛋
    const t = Date.now();
    this.writeSaveRow(pid, save, row.rev + 1, t, false);
    if (grant.coins) this.econ(t, 0, 0, grant.coins, pid);
    return { save, rev: row.rev + 1, addedFish: added, cosAlreadyOwned };
  }
}

module.exports = { cmpBuild, Players, USERNAME_RE, EMAIL_RE, normEmail, maskEmail };
