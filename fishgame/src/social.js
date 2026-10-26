'use strict';
// RENAME-HARBOR 2026-10-23：玩家看到的「漁港」文字改為「好友」（錯誤代碼／API 不變）
// ⚓ 漁港（v4.0.5）：拜訪玩家、好友、幫忙餵食（金幣獎勵）、跨玩家繁殖（每日 1 次免費，加購／限定魚用寶石）
// 安全設計：
//  - 拜訪者「永遠不寫」別人的存檔。幫忙餵食 → 伺服器記一筆待處理通知；主人的遊戲下次載入／同步時套用（冪等：通知只會套用一次）
//  - 拜訪者的金幣獎勵、繁殖費用、新生寶寶都由伺服器寫進「自己的」存檔（同寶石商品流程，防作弊以伺服器存檔為準）
//  - 寶石走 commerce.ledger（交易內扣款，不會負數；同一個 idempotencyKey 重送不重扣）
//  - 公開資料只回傳：暱稱（或 魚友#編號）、等級、魚缸等級、魚數、魚的外觀欄位；不回傳信箱／帳號
const express = require('express');
const { HttpError, bad, RateLimiter, toInt, clampStr } = require('./util');
const Hybrid = require('./hybrid');
const { capacityOf, usedSpaceOf, spOf, isPremium } = require('./anticheat');

const DEF = {
  enabled: true,
  visit: { maxFish: 40, recentDays: 7, recommend: 12, sceneMaxFish: 80 }, /*FRIENDTANK-SCENE sceneMaxFish：拜訪畫面最多畫幾條魚（前端手機會再依畫質限制）*/
  friends: { max: 100, requestsPerHour: 20 },
  help: { hungryBelow: 60, feedAmount: 40, rewardStranger: 20, rewardFriend: 40, rewardPerLevel: 5, rewardMax: 120, dailyRewarded: 10, ownerBonus: 10, minOwnerAgeHours: 24 },
  breed: { enabled: true, minStage: 2, coinBase: 100, coinPerRarity: 150, gemFactor: 0.1, gemMin: 10, gemMax: 150, studFee: 30 },
};
const LV_DEF = [0, 2, 5, 9, 14, 20, 27, 35, 44, 55];
function socCfg(cfg) {
  const s = (cfg && cfg.social) || {};
  return { enabled: s.enabled !== false, visit: { ...DEF.visit, ...(s.visit || {}) }, friends: { ...DEF.friends, ...(s.friends || {}) }, help: { ...DEF.help, ...(s.help || {}) }, breed: { ...DEF.breed, ...(s.breed || {}) } };
}
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim().slice(0, 16);
const pubName = (p) => cleanName(p && p.nickname) || ('魚友#' + (p && p.id));
function levelOf(cfg, save) {
  const T = (cfg.mechanics && cfg.mechanics.progression && cfg.mechanics.progression.foundThresholds) || LV_DEF;
  const n = save && save.found ? Object.keys(save.found).length : 0; let lv = 1; T.forEach((x, i) => { if (n >= x) lv = i + 1; }); return lv;
}
const stageOf = (cfg, f) => { const st = cfg.stages || []; const g = (f && f.growth) || 0; return st[2] && g >= st[2].growth ? 2 : st[1] && g >= st[1].growth ? 1 : 0; };
function gemPriceOf(cfg, sp) {
  const s = spOf(cfg, sp); if (!s) return 0;
  if (isPremium(s)) return s.priceGems || 0;
  if (s.premiumBlood) return Math.max(0, ...Hybrid.baseOf(cfg, sp).map((b) => { const x = cfg.species[b]; return x && isPremium(x) ? x.priceGems || 0 : 0; }));
  return 0;
}
const isGemFish = (cfg, sp) => { const s = spOf(cfg, sp); return !!s && (isPremium(s) || !!s.premiumBlood); };
// FRIENDTANK-SCENE-BEGIN：拜訪時畫「真正的魚缸」用的公開場景（只白名單欄位：造景水草、裝飾、背景、設備／燈、水質外觀、魚的外觀與位置）。
// 不含金幣、道具、圖鑑、信箱、權杖、付款等任何私人資料；數值四捨五入、字串限長。
const FT_ID = /^[A-Za-z0-9_\-]{1,40}$/;
const ftNum = (v, lo, hi, dp = 3) => { const n = +v; if (!Number.isFinite(n)) return lo; const k = 10 ** dp; return Math.round(Math.max(lo, Math.min(hi, n)) * k) / k; };
const ftKey = (v) => (typeof v === 'string' && FT_ID.test(v) ? v : null);
/*MOVDECO-SCENE 造景位置（只留畫面上有的造景、0..1 四位小數；沒有就不輸出）*/
function decoPosOf(up) { const dp = up && up.decoPos, o = {}; if (!dp || typeof dp !== 'object' || Array.isArray(dp)) return {}; for (const k of (Array.isArray(up.deco) ? up.deco : []).slice(0, 30)) { const n = +dp[k]; if (ftKey(k) && dp[k] != null && Number.isFinite(n)) o[k] = ftNum(n, 0, 1, 4); } return Object.keys(o).length ? { decoPos: o } : {}; }
function decoSOf(up) { const ds = up && up.decoS, o = {}; if (!ds || typeof ds !== 'object' || Array.isArray(ds)) return {}; for (const k of (Array.isArray(up.deco) ? up.deco : []).slice(0, 30)) { const n = +ds[k]; if (ftKey(k) && ds[k] != null && Number.isFinite(n)) o[k] = ftNum(n, 0.5, 2, 2); } return Object.keys(o).length ? { decoS: o } : {}; }
/* EQUIPMENT-V5: preserve visible epiphyte attachment points in visits/admin read-only scenes. */
function mossOf(up) {
 const raw=up&&up.moss;if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 const owned=new Set((Array.isArray(up.deco)?up.deco:[]).map(ftKey).filter(Boolean).slice(0,30)),moss=Object.create(null);
 for(const id of owned){const m=raw[id];if(!m||typeof m!=='object'||Array.isArray(m))continue;
  if(m.host==null){moss[id]={host:null,point:null,stage:'f'};continue}
  const host=ftKey(m.host),point=ftKey(m.point),free=m.freeHost===host&&Number.isFinite(m.fx)&&Number.isFinite(m.fy);if(!host||(!point&&!free)||host===id||!owned.has(host))continue;
  moss[id]={host,point,stage:'f',...(free?{freeHost:host,fx:ftNum(m.fx,0,1,4),fy:ftNum(m.fy,-.5,1,4)}:{})};
 }
 return Object.keys(moss).length?{moss}:{};
}
function sceneOf(cfg, s, maxFish, ordered) {
  s = s || {}; const up = s.up || {}, gear = s.gear || {}, w = s.water || {}, cos = s.cos || {};
  const own = {}; if (gear.own && typeof gear.own === 'object') for (const k of Object.keys(gear.own).slice(0, 40)) if (ftKey(k) && gear.own[k]) own[k] = 1;
  const plants = (Array.isArray(s.plants) ? s.plants : []).slice(0, 80).filter((p) => p && ftKey(p.sp)).map((p) => ({ id: clampStr(String(p.id || ''), 24), sp: p.sp, x: ftNum(p.x, 0, 1, 4), d: ftNum(p.d, 0, 1, 3), g: ftNum(p.g, 0, 400, 1), hp: ftNum(p.hp, 0, 100, 0), seed: Math.max(0, Math.min(1e9, +p.seed | 0)), ...(ftKey(p.host)&&(up.deco||[]).includes(p.host)&&Number.isFinite(p.hx)&&Number.isFinite(p.hy)?{host:p.host,hx:ftNum(p.hx,0,1,4),hy:ftNum(p.hy,-.5,1,4)}:{}) }));
  const src = Array.isArray(ordered) ? ordered : (Array.isArray(s.fish) ? s.fish : []);
  const fish = src.filter((f) => f && typeof f.sp === 'string' && spOf(cfg, f.sp)).slice(0, Math.max(0, maxFish | 0)).map((f) => ({ id: clampStr(String(f.id || ''), 24), sp: f.sp, name: cleanName(f.name), hue: ftNum(f.hue, -720, 720, 1), size: ftNum(f.size || 1, .5, 1.6, 3), growth: ftNum(f.growth, 0, 1e4, 1), full: ftNum(f.full ?? 100, 0, 100, 0), health: ftNum(f.health ?? 100, 0, 100, 0), seed: Math.max(0, Math.min(1e9, +f.seed | 0)), px: ftNum(f.px ?? Math.random(), 0, 1, 3), py: ftNum(f.py ?? .5, 0, 1, 3), dir: +f.dir < 0 ? -1 : 1, finDmg: ftNum(f.finDmg || 0, 0, 1, 2) }));
  return {
    up: { cap: Math.max(0, up.cap | 0), filter: Math.max(0, up.filter | 0), feeder: Math.max(0, up.feeder | 0), deco: (Array.isArray(up.deco) ? up.deco : []).map(ftKey).filter(Boolean).slice(0, 30), ...decoPosOf(up), ...decoSOf(up), ...mossOf(up), ...(Array.isArray(up.decoZ)?{decoZ:up.decoZ.map(ftKey).filter(k=>k&&(up.deco||[]).includes(k)).slice(0,30)}:{}) }, /*MOVDECO-SCENE*/
    capV: s.capV | 0 || 2,
    plants, fish,
    gear: { own, light: ftKey(gear.light), temp: gear.temp == null ? null : ftNum(gear.temp, 0, 40, 1) },
    cos: ftKey(cos.bg) ? { bg: cos.bg } : {},
    water: { dirt: ftNum(w.dirt, 0, 100, 0), waste: ftNum(w.waste, 0, 100, 0), algae: ftNum(w.algae, 0, 100, 0), cycle: ftNum(w.cycle ?? 100, 0, 100, 0) },
  };
}
// FRIENDTANK-SCENE-END

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS social_friends (
  a INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  requester INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS idx_social_friends_b ON social_friends(b, status);
CREATE TABLE IF NOT EXISTS social_helps (
  id INTEGER PRIMARY KEY,
  helper_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0,
  friend INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (helper_id, owner_id, day)
);
CREATE INDEX IF NOT EXISTS idx_social_helps_day ON social_helps(day, helper_id);
CREATE TABLE IF NOT EXISTS social_breeds (
  id INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  idem_key TEXT,
  owner_fish TEXT NOT NULL, owner_sp TEXT NOT NULL,
  my_fish TEXT NOT NULL, my_sp TEXT NOT NULL,
  child_id TEXT NOT NULL, child_sp TEXT NOT NULL, kind TEXT,
  coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, extra_gems INTEGER NOT NULL DEFAULT 0, extra_n INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (requester_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_social_breeds_day ON social_breeds(requester_id, day);
CREATE TABLE IF NOT EXISTS social_notes (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_id INTEGER,
  data TEXT,
  coins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  applied_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_social_notes_player ON social_notes(player_id, id);
CREATE TABLE IF NOT EXISTS social_prefs (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  breed_open INTEGER NOT NULL DEFAULT 1
);`);
  // 帳號層級旗標（在 players 表，不在遊戲存檔）：不開放漁港拜訪（後台設定）
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  if (!cols.includes('no_visits')) db.exec('ALTER TABLE players ADD COLUMN no_visits INTEGER NOT NULL DEFAULT 0');
  const pc = db.prepare('PRAGMA table_info(social_prefs)').all().map((c) => c.name);
  if (!pc.includes('visitable')) db.exec('ALTER TABLE social_prefs ADD COLUMN visitable INTEGER NOT NULL DEFAULT 1');
}
// 不公開：後台旗標 players.no_visits=1，或玩家自己在漁港設定「不開放拜訪」
const HIDDEN_SQL = '(p.no_visits=1 OR EXISTS (SELECT 1 FROM social_prefs sp WHERE sp.player_id=p.id AND sp.visitable=0))';

class Social {
  constructor(ctx) { this.ctx = ctx; this.db = ctx.db; this.now = () => Date.now(); migrate(this.db); }
  get cfg() { return this.ctx.configStore.active().config; }
  get S() { return socCfg(this.cfg); }
  day(ms) { return this.ctx.commerce.day(ms == null ? this.now() : ms); }
  player(id) { return this.db.prepare('SELECT id, username, nickname, created_at, last_seen, banned_at, is_demo, no_visits FROM players WHERE id=?').get(id) || null; }
  hidden(id) { const p = this.player(id); if (!p) return true; if (p.no_visits) return true; const r = this.db.prepare('SELECT visitable FROM social_prefs WHERE player_id=?').get(id); return !!(r && !r.visitable); }
  // 可以被拜訪／幫忙餵食／借魚／加好友的對象（會員、未停權、非示範、未設定不公開）
  target(id) { const p = this.member(id); return p && !p.is_demo && !this.hidden(id) ? p : null; }
  saveOf(id) { const r = this.db.prepare('SELECT data, rev FROM saves WHERE player_id=?').get(id); if (!r) return null; try { return { save: JSON.parse(r.data), rev: r.rev }; } catch { return null; } }
  writeOwn(pid, save, rev, coinsDelta) { const t = this.now(); this.ctx.players.writeSaveRow(pid, save, rev + 1, t, false); if (coinsDelta > 0 && this.ctx.players.econ) this.ctx.players.econ(t, 0, 0, coinsDelta, pid); /*V406P*/ return { save, rev: rev + 1 }; }
  member(id) { const p = this.player(id); return p && p.username && !p.banned_at ? p : null; }
  pair(x, y) { return x < y ? [x, y] : [y, x]; }
  rel(me, other) {
    const [a, b] = this.pair(me, other); const r = this.db.prepare('SELECT * FROM social_friends WHERE a=? AND b=?').get(a, b);
    if (!r || r.status === 'expired') return 'none'; /*FRIENDSV2-EXPIRED*/ if (r.status === 'accepted') return 'friend'; return r.requester === me ? 'sent' : 'incoming';
  }
  friendIds(me) { return this.db.prepare("SELECT CASE WHEN a=? THEN b ELSE a END AS id FROM social_friends WHERE (a=? OR b=?) AND status='accepted'").all(me, me, me).map((r) => r.id); }
  breedOpen(id) { const r = this.db.prepare('SELECT breed_open FROM social_prefs WHERE player_id=?').get(id); return r ? !!r.breed_open : true; }
  card(p, withSeen) {
    const sv = this.saveOf(p.id), s = sv && sv.save, cfg = this.cfg; const cap = (s && s.up && s.up.cap) || 0;
    const tier = cap > 0 ? ((cfg.capacity.upgrades[cap - 1] || {}).name || ('Lv' + cap)) : '小魚缸';
    const o = { id: p.id, name: pubName(p), level: levelOf(cfg, s), tankLv: cap, tank: tier, fish: s && s.fish ? s.fish.length : 0 };
    if (withSeen) o.lastSeen = p.last_seen;
    return o;
  }
  note(pid, kind, actor, data, coins = 0) { this.db.prepare('INSERT INTO social_notes (player_id, kind, actor_id, data, coins, created_at) VALUES (?,?,?,?,?,?)').run(pid, kind, actor || null, JSON.stringify(data || {}), coins | 0, this.now()); }
  // ---- 今日用量 ----
  today(me) {
    const S = this.S, d = this.day();
    const helps = this.db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN reward>0 THEN 1 ELSE 0 END) r FROM social_helps WHERE helper_id=? AND day=?').get(me, d);
    // 繁殖次數：自家＋漁港共用（src/breedlimit.js）；漁港每天最多 harborFreePerDay 次免費
    const bl = this.ctx.breedLimit.today(me);
    return { day: d, helps: helps.n, rewardedHelps: helps.r || 0, helpCap: S.help.dailyRewarded, breeds: bl.harborUsed, freeBreedsLeft: bl.harborFreeLeft, extrasUsed: bl.extrasUsed, extrasLeft: bl.extrasLeft, unlimitedExtras:bl.unlimitedExtras, nextExtraGems: bl.harborNext, breedLimit: bl };
  }
  // ---- 漁港首頁 ----
  hub(me, isMember) {
    const S = this.S, t = this.now(); const FV = this.ctx.friendsV2; /*FRIENDSV2-REC*/ if (FV) try { FV.sweepExpired(); } catch (e) { /* 不影響漁港 */ }
    const rec = FV && FV.F.recommend.enabled ? FV.recommend(me, isMember, S.visit.recommend, HIDDEN_SQL) : this.db.prepare(`SELECT p.id, p.nickname, p.last_seen FROM players p JOIN saves s ON s.player_id=p.id
      WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND p.is_demo=0 AND NOT ${HIDDEN_SQL} AND p.id<>? AND p.last_seen>? AND s.fish_count>0 ORDER BY random() LIMIT ?`).all(me, t - S.visit.recentDays * 86400000, S.visit.recommend);
    const out = { enabled: S.enabled, member: !!isMember, recommended: rec.map((p) => this.card(p)) };
    if (!isMember) return out;
    const d = this.day();
    const fr = this.db.prepare(`SELECT p.id, p.nickname, p.last_seen, f.status, f.requester FROM social_friends f JOIN players p ON p.id = CASE WHEN f.a=? THEN f.b ELSE f.a END
      WHERE (f.a=? OR f.b=?) AND p.banned_at IS NULL AND NOT ${HIDDEN_SQL} ORDER BY f.updated_at DESC LIMIT 300`).all(me, me, me);
    const helped = new Set(this.db.prepare('SELECT owner_id FROM social_helps WHERE helper_id=? AND day=?').all(me, d).map((r) => r.owner_id));
    out.friends = fr.filter((r) => r.status === 'accepted').map((p) => ({ ...this.card(p, true), helpedToday: helped.has(p.id) }));
    out.incoming = fr.filter((r) => r.status === 'pending' && r.requester !== me).map((p) => this.card(p));
    out.outgoing = fr.filter((r) => r.status === 'pending' && r.requester === me).map((p) => this.card(p));
    out.recommended = out.recommended.map((c) => ({ ...c, rel: this.rel(me, c.id) }));
    out.today = this.today(me); out.breedOpen = this.breedOpen(me); out.prefs = this.prefs(me); out.notesUnread = this.unread(me).notes; out.limits = { friends: S.friends.max };
    out.config = { help: S.help, breed: S.breed };
    return out;
  }
  search(me, q) {
    q = cleanName(q); if (!q) return { results: [] };
    let rows;
    const m = /^#?(\d{1,9})$/.exec(q);
    if (m) rows = this.db.prepare(`SELECT p.id, p.nickname, p.last_seen FROM players p WHERE p.id=? AND p.username IS NOT NULL AND p.banned_at IS NULL AND p.is_demo=0 AND NOT ${HIDDEN_SQL}`).all(+m[1]);
    else rows = this.db.prepare(`SELECT p.id, p.nickname, p.last_seen FROM players p WHERE p.nickname LIKE ? ESCAPE '\\' AND p.username IS NOT NULL AND p.banned_at IS NULL AND p.is_demo=0 AND NOT ${HIDDEN_SQL} ORDER BY p.last_seen DESC LIMIT 20`).all('%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    return { results: rows.filter((p) => p.id !== me).map((p) => ({ ...this.card(p), rel: this.rel(me, p.id) })) };
  }
  // ---- 拜訪（唯讀魚缸快照）----
  tank(me, id, isMember) {
    const p = me === id ? this.member(id) : this.target(id); if (!p || p.is_demo) throw new HttpError(404, 'not_found', '找不到這位玩家，或對方不開放拜訪');
    const sv = this.saveOf(id); const s = sv && sv.save; const cfg = this.cfg, S = this.S;
    const fish = (s && Array.isArray(s.fish) ? s.fish : []).filter((f) => f && typeof f.sp === 'string' && spOf(cfg, f.sp));
    const score = (f) => { const x = spOf(cfg, f.sp); return (isGemFish(cfg, f.sp) ? 100 : 0) + ((x.rarity | 0) * 10) + stageOf(cfg, f); };
    const sorted = fish.slice().sort((a, b) => score(b) - score(a)).slice(0, S.visit.maxFish);
    const pub = sorted.map((f) => ({ id: clampStr(f.id, 24), sp: f.sp, name: cleanName(f.name), hue: +f.hue || 0, size: Math.max(.5, Math.min(1.6, +f.size || 1)), stage: stageOf(cfg, f), hungry: (f.full ?? 100) < S.help.hungryBelow }));
    const out = { player: this.card(p), fish: pub, total: fish.length, hungry: fish.filter((f) => (f.full ?? 100) < S.help.hungryBelow).length, deco: (s && s.up && Array.isArray(s.up.deco) ? s.up.deco.slice(0, 12) : []),
      breedOpen: this.breedOpen(id), self: me === id };
    /*FRIENDTANK-SCENE*/ out.plants = s && Array.isArray(s.plants) ? s.plants.length : 0; out.scene = sceneOf(cfg, s, S.visit.sceneMaxFish, sorted.concat(fish.filter((f) => !sorted.includes(f))));
    if (me !== id && this.ctx.friendsV2) this.ctx.friendsV2.logVisit(me, id, isMember); /*FRIENDSV2-VISITLOG*/
    if (isMember && me !== id) { out.rel = this.rel(me, id); out.helpedToday = !!this.db.prepare('SELECT 1 FROM social_helps WHERE helper_id=? AND owner_id=? AND day=?').get(me, id, this.day()); out.today = this.today(me); }
    return out;
  }
  // FRIENDTANK-ADMIN：後台檢視用（與 tank() 相同的公開欄位）
  adminTank(p) {
    const sv = this.saveOf(p.id); const s = sv && sv.save; const cfg = this.cfg, S = this.S;
    const fish = (s && Array.isArray(s.fish) ? s.fish : []).filter((f) => f && typeof f.sp === 'string' && spOf(cfg, f.sp));
    return { player: this.card(p), admin: true, total: fish.length, hungry: fish.filter((f) => (f.full ?? 100) < S.help.hungryBelow).length, plants: s && Array.isArray(s.plants) ? s.plants.length : 0, breedOpen: this.breedOpen(p.id), scene: sceneOf(cfg, s, S.visit.sceneMaxFish) };
  }
  // ---- 好友 ----
  friendCount(id) { return this.db.prepare("SELECT COUNT(*) n FROM social_friends WHERE (a=? OR b=?) AND status='accepted'").get(id, id).n; }
  request(me, id) {
    const S = this.S; id = toInt(id, 0);
    if (id === me) throw bad('self', '不能加自己為好友');
    const p = this.target(id); if (!p) throw new HttpError(404, 'not_found', '找不到這位玩家，或對方不開放拜訪');
    return this.db.transaction(() => {
      const [a, b] = this.pair(me, id); let r = this.db.prepare('SELECT * FROM social_friends WHERE a=? AND b=?').get(a, b), t = this.now();
      if (r && r.status === 'expired') { this.db.prepare("DELETE FROM social_friends WHERE a=? AND b=? AND status='expired'").run(a, b); r = null; } /*FRIENDSV2-EXPIRED*/
      if (r && r.status === 'accepted') return { rel: 'friend' };
      if (r && r.requester === me) return { rel: 'sent' };
      if (this.friendCount(me) >= S.friends.max) throw new HttpError(409, 'friends_full', `好友最多 ${S.friends.max} 位`);
      if (r) { // 對方已經邀請我 → 直接成為好友
        if (this.friendCount(id) >= S.friends.max) throw new HttpError(409, 'friends_full', '對方的好友已滿');
        this.db.prepare("UPDATE social_friends SET status='accepted', updated_at=? WHERE a=? AND b=?").run(t, a, b); this.note(id, 'friend_ok', me); return { rel: 'friend' };
      }
      this.db.prepare("INSERT INTO social_friends (a, b, status, requester, created_at, updated_at) VALUES (?,?,'pending',?,?,?)").run(a, b, me, t, t);
      this.note(id, 'friend_req', me); return { rel: 'sent' };
    })();
  }
  accept(me, id) {
    const S = this.S; id = toInt(id, 0); const [a, b] = this.pair(me, id);
    return this.db.transaction(() => {
      const r = this.db.prepare('SELECT * FROM social_friends WHERE a=? AND b=?').get(a, b);
      if (!r || r.status !== 'pending' || r.requester === me) throw new HttpError(404, 'no_request', '沒有這個好友邀請');
      if (this.friendCount(me) >= S.friends.max || this.friendCount(id) >= S.friends.max) throw new HttpError(409, 'friends_full', `好友最多 ${S.friends.max} 位`);
      this.db.prepare("UPDATE social_friends SET status='accepted', updated_at=? WHERE a=? AND b=?").run(this.now(), a, b); this.note(id, 'friend_ok', me); return { rel: 'friend' };
    })();
  }
  decline(me, id) { id = toInt(id, 0); const [a, b] = this.pair(me, id); this.db.prepare("DELETE FROM social_friends WHERE a=? AND b=? AND status='pending'").run(a, b); return { rel: 'none' }; }
  remove(me, id) { id = toInt(id, 0); const [a, b] = this.pair(me, id); this.db.prepare('DELETE FROM social_friends WHERE a=? AND b=?').run(a, b); return { rel: 'none' }; }
  setPrefs(me, body) {
    body = body || {}; const cur = this.db.prepare('SELECT breed_open, visitable FROM social_prefs WHERE player_id=?').get(me) || { breed_open: 1, visitable: 1 };
    const open = body.breedOpen == null ? !!cur.breed_open : body.breedOpen !== false, vis = body.visitable == null ? !!cur.visitable : body.visitable !== false;
    this.db.prepare('INSERT INTO social_prefs (player_id, breed_open, visitable) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET breed_open=excluded.breed_open, visitable=excluded.visitable').run(me, open ? 1 : 0, vis ? 1 : 0);
    return this.prefs(me);
  }
  prefs(me) { const r = this.db.prepare('SELECT breed_open, visitable FROM social_prefs WHERE player_id=?').get(me) || { breed_open: 1, visitable: 1 }; const p = this.player(me) || {}; return { breedOpen: !!r.breed_open, visitable: !!r.visitable, adminHidden: !!p.no_visits }; }
  adminSetHidden(id, hidden) { const p = this.player(id); if (!p) throw new HttpError(404, 'not_found', '找不到玩家'); this.db.prepare('UPDATE players SET no_visits=? WHERE id=?').run(hidden ? 1 : 0, id); return { id, noVisits: !!hidden }; }
  // ---- 幫忙餵食 ----
  help(me, ownerId) {
    const S = this.S, H = S.help, cfg = this.cfg; ownerId = toInt(ownerId, 0);
    if (ownerId === me) throw bad('self', '自己的魚請在自己的魚缸餵喔');
    const o = this.target(ownerId); if (!o) throw new HttpError(404, 'not_found', '找不到這位玩家，或對方不開放拜訪');
    return this.db.transaction(() => {
      const d = this.day(), t = this.now();
      if (this.db.prepare('SELECT 1 FROM social_helps WHERE helper_id=? AND owner_id=? AND day=?').get(me, ownerId, d)) throw new HttpError(409, 'already_helped', '今天已經幫這位魚友餵過了，明天再來吧');
      const os = this.saveOf(ownerId); const ofish = (os && os.save && os.save.fish) || [];
      const hungry = ofish.filter((f) => (f.full ?? 100) < H.hungryBelow).length;
      if (!hungry) throw new HttpError(409, 'not_hungry', '這缸的魚都吃得很飽，不需要餵');
      const mine = this.saveOf(me); if (!mine) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
      const friend = this.rel(me, ownerId) === 'friend';
      const rewarded = this.db.prepare('SELECT COUNT(*) n FROM social_helps WHERE helper_id=? AND day=? AND reward>0').get(me, d).n;
      let reward = 0, why = '';
      if (rewarded >= H.dailyRewarded) why = `今天的獎勵次數已滿（${H.dailyRewarded} 次）`;
      else if (t - o.created_at < H.minOwnerAgeHours * 3600000) why = '對方是新帳號，暫時沒有獎勵';
      else reward = Math.min(H.rewardMax, (friend ? H.rewardFriend : H.rewardStranger) + H.rewardPerLevel * levelOf(cfg, mine.save));
      this.db.prepare('INSERT INTO social_helps (helper_id, owner_id, day, reward, friend, created_at) VALUES (?,?,?,?,?,?)').run(me, ownerId, d, reward, friend ? 1 : 0, t);
      this.note(ownerId, 'help', me, { feed: H.feedAmount, below: H.hungryBelow }, H.ownerBonus);
      let w = { save: null, rev: null };
      if (reward > 0) { mine.save.coins = (mine.save.coins || 0) + reward; w = this.writeOwn(me, mine.save, mine.rev, reward); }
      this.ctx.players.logEvent && this.ctx.players.logEvent(me, 'social_help', { owner: ownerId, reward, friend });
      return { reward, why, friend, hungry, save: w.save, rev: w.rev, today: this.today(me) };
    })();
  }
  // ---- 通知（主人套用：幫忙餵食的飽足度在遊戲端加，金幣獎勵由伺服器寫入主人自己的存檔）----
  unread(me) {
    const r = this.db.prepare('SELECT SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) n, SUM(CASE WHEN applied_at IS NULL AND (coins>0 OR kind IN (\'help\',\'help2\')) THEN 1 ELSE 0 END) a /*FRIENDSV2-APPLY*/ FROM social_notes WHERE player_id=?').get(me);
    const req = this.db.prepare("SELECT COUNT(*) n FROM social_friends WHERE (a=? OR b=?) AND status='pending' AND requester<>?").get(me, me, me).n;
    return { notes: r.n || 0, pending: r.a || 0, requests: req };
  }
  pubNote(n) { const a = n.actor_id ? this.player(n.actor_id) : null; let data = {}; try { data = JSON.parse(n.data || '{}'); } catch { data = {}; } return { id: n.id, kind: n.kind, actor: a ? { id: a.id, name: pubName(a) } : null, data, coins: n.coins, at: n.created_at, read: !!n.read_at, applied: !!n.applied_at }; }
  notes(me) { const u = this.unread(me); return { unread: u.notes, pending: u.pending, requests: u.requests, notes: this.db.prepare('SELECT * FROM social_notes WHERE player_id=? ORDER BY id DESC LIMIT 40').all(me).map((n) => this.pubNote(n)) }; }
  readNotes(me) { this.db.prepare('UPDATE social_notes SET read_at=? WHERE player_id=? AND read_at IS NULL').run(this.now(), me); return { ok: true }; }
  apply(me) {
    return this.db.transaction(() => {
      const list = this.db.prepare("SELECT * FROM social_notes WHERE player_id=? AND applied_at IS NULL AND (coins>0 OR kind IN ('help','help2')) ORDER BY id LIMIT 100").all(me);
      if (!list.length) return { applied: [], coins: 0, save: null, rev: null };
      const sv = this.saveOf(me); if (!sv) return { applied: [], coins: 0, save: null, rev: null };
      const coins = list.reduce((a, n) => a + (n.coins || 0), 0);
      this.db.prepare(`UPDATE social_notes SET applied_at=? WHERE id IN (${list.map(() => '?').join(',')})`).run(this.now(), ...list.map((n) => n.id));
      let w = { save: sv.save, rev: sv.rev };
      if (coins > 0) { sv.save.coins = (sv.save.coins || 0) + coins; w = this.writeOwn(me, sv.save, sv.rev, coins); }
      return { applied: list.map((n) => this.pubNote(n)), coins, save: w.save, rev: w.rev };
    })();
  }
  // ---- 跨玩家繁殖 ----
  quote(me, q) {
    const S = this.S, B = S.breed, cfg = this.cfg;
    if (!B.enabled) throw new HttpError(403, 'breed_off', '借魚繁殖暫停中');
    const ownerId = toInt(q.ownerId, 0); if (ownerId === me) throw bad('self', '要拜訪別人的魚缸才能借魚繁殖');
    const o = this.target(ownerId); if (!o) throw new HttpError(404, 'not_found', '找不到這位玩家，或對方不開放拜訪');
    if (!this.breedOpen(ownerId)) throw new HttpError(403, 'not_open', '這位魚友不開放借魚繁殖');
    const os = this.saveOf(ownerId), ms = this.saveOf(me); if (!ms) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
    const of = ((os && os.save.fish) || []).find((f) => f.id === String(q.ownerFishId || '')), mf = (ms.save.fish || []).find((f) => f.id === String(q.myFishId || ''));
    if (!of || !spOf(cfg, of.sp)) throw new HttpError(404, 'no_fish', '找不到對方的這條魚');
    if (!mf || !spOf(cfg, mf.sp)) throw new HttpError(404, 'no_fish', '找不到你的這條魚（請先同步存檔）');
    if([of,mf].some(f=>Hybrid.generation(f.sp)>=Hybrid.MAX_GENERATION))throw new HttpError(422,'generation_limit','第六代已達繁殖上限，不能再作為親魚，本次未扣鑽');
    const need = B.minStage, stName = (cfg.stages[need] || {}).name || '成年';
    if (stageOf(cfg, of) < need || stageOf(cfg, mf) < need) throw new HttpError(409, 'too_young', `兩條魚都要長到「${stName}」才能繁殖`);
    const gemFish = isGemFish(cfg, of.sp) || isGemFish(cfg, mf.sp);
    if (gemFish && cfg.premium && cfg.premium.breedable === false) throw new HttpError(409, 'premium_no_breed', '💎 限定魚目前無法繁殖');
    const rar = Math.max(spOf(cfg, of.sp).rarity | 0, spOf(cfg, mf.sp).rarity | 0);
    if(of.sp!==mf.sp&&!Hybrid.cross(cfg,of.sp,mf.sp,Math.random).sp)throw new HttpError(422,'lineage_limit','無法保留這組雙親血統，本次未扣鑽');
    const bloodFee=Hybrid.breedFee(cfg,of.sp,mf.sp);
    const coins = (gemFish||bloodFee.cross) ? 0 : B.coinBase + B.coinPerRarity * rar;
    const gp = Math.max(gemPriceOf(cfg, of.sp), gemPriceOf(cfg, mf.sp));
    const gems = bloodFee.gems;
    const td = this.today(me);
    const perks = this.ctx.friendsV2 ? this.ctx.friendsV2.breedPerks(me, ownerId) : { discount: 0, bond: false }; /*FRIENDSV2-BREED*/
    const bond = !!(perks.bond && (td.freeBreedsLeft <= 0));
    if (td.nextExtraGems == null && !bond) throw new HttpError(429, 'breed_limit', `今天的繁殖次數已用完（免費 ${td.breedLimit.freeTotal} 次、好友借魚免費 ${td.breedLimit.harborFreeTotal} 次＋加購 ${td.breedLimit.maxExtra} 次），台北時間午夜重置`);
    const extraGems = bond ? 0 : td.nextExtraGems || 0; const dcoins = perks.discount ? Math.round(coins * (100 - perks.discount) / 100) : coins; /*FRIENDSV2-BREED*/
    return { parentFees:bloodFee.parents,owner: o, os, ms, of, mf, coins: dcoins, coinsBase: coins, discount: perks.discount || 0, bond, gems, extraGems, totalGems: gems + extraGems, gemFish, rarity: rar, today: td, extra: !bond && td.freeBreedsLeft <= 0 };
  }
  breed(me, body) {
    const idem = body && body.idempotencyKey ? clampStr(body.idempotencyKey, 64) : null;
    return this.db.transaction(() => {
      if (idem) { const ex = this.db.prepare('SELECT * FROM social_breeds WHERE requester_id=? AND idem_key=?').get(me, idem); if (ex) { const sv = this.saveOf(me); return { reused: true, destination: this.db.prepare('SELECT 1 FROM fish_storage WHERE player_id=? AND fish_id=?').get(me,ex.child_id)?'storage':'tank', child: (sv.save.fish || []).find((f) => f.id === ex.child_id) || (this.ctx.players.fishStorage?.list(me)||[]).find(f=>f.id===ex.child_id) || { id: ex.child_id, sp: ex.child_sp }, kind: ex.kind, coins: ex.coins, gems: ex.gems + ex.extra_gems, balance: this.ctx.commerce.balance(me), save: sv.save, rev: sv.rev, today: this.today(me) }; } }
      const x = this.quote(me, body || {}), cfg = this.cfg, B = this.S.breed, save = x.ms.save;if(x.totalGems>0&&body.acceptedGems!==x.totalGems)throw new HttpError(409,'breed_price_changed','繁殖費用已更新，請重新確認（尚未扣鑽）');
      if ((save.coins || 0) < x.coins) throw new HttpError(402, 'insufficient_coins', `金幣不足（需要 ${x.coins}）`, { need: x.coins });
      const bal = this.ctx.commerce.balance(me);
      if (bal < x.totalGems) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price: x.totalGems });
      // 寶寶魚種：沿用遊戲的全物種／混種規則（跨種不會直接生出限定魚，改生混種）
      let r = Hybrid.cross(cfg, x.of.sp, x.mf.sp, Math.random);
      const rs = spOf(cfg, r.sp);
      if (r.kind === 'parent' && rs && isPremium(rs) && x.of.sp !== x.mf.sp) { const o = r.sp === x.of.sp ? x.mf.sp : x.of.sp, ob = Hybrid.baseOf(cfg, o); const base = ob.find((b) => b !== r.sp) || ob[0]; r = base && base !== r.sp ? { sp: Hybrid.idOf(r.sp, base), kind: 'hybrid' } : { sp: o, kind: 'parent' }; }
      if (!r.sp||!spOf(cfg,r.sp))throw new HttpError(422,'lineage_limit','無法保留這組雙親血統，本次未扣鑽');
      if(!r.sp)throw new HttpError(422,'lineage_limit','這組血統資料過長，本次未扣鑽');
      const child = { lineage:{at:this.now(),parents:[[x.of,x.owner.id],[x.mf,me]].map(([f,ownerId])=>({id:f.id,sp:f.sp,name:f.name||spOf(cfg,f.sp)?.name||'',ownerId}))},id: 'x' + Math.random().toString(36).slice(2, 10), sp: r.sp, name: cfg.names[Math.floor(Math.random() * cfg.names.length)],
        hue:r.kind==='hybrid'?spOf(cfg,r.sp).look?.hue||0:((((+x.of.hue || 0) + (+x.mf.hue || 0)) / 2 + (Math.random() * 16 - 8)) + 360) % 360, size: Math.max(.85, Math.min(1.15, (((+x.of.size || 1) + (+x.mf.size || 1)) / 2) + (Math.random() * .1 - .05))),
        growth: 0, full: cfg.hunger.offspringFullness, health: 100, cd: 0, coinT: 10, seed: Math.floor(Math.random() * 1e5), px: .5, py: .5, dir: 1 };
      const cap = capacityOf(cfg, (save.up && save.up.cap) || 0, save);
      const destination=require('./newborn').deliver(this.db,me,cfg,save,child);
      const t = this.now(), d = this.day();
      const id = this.db.prepare(`INSERT INTO social_breeds (requester_id, owner_id, day, idem_key, owner_fish, owner_sp, my_fish, my_sp, child_id, child_sp, kind, coins, gems, extra_gems, extra_n, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(me, x.owner.id, d, idem, x.of.id, x.of.sp, x.mf.id, x.mf.sp, child.id, child.sp, r.kind, x.coins, x.gems, x.extraGems, x.extra ? x.today.extrasUsed + 1 : 0, t).lastInsertRowid;
      let balance = bal;
      // 共用每日繁殖次數：記一次漁港繁殖（需要加購時在這裡扣寶石）
      const bu = x.bond ? (this.db.prepare('INSERT INTO fv2_bond_breeds (player_id, day, owner_id, ref, created_at) VALUES (?,?,?,?,?)').run(me, d, x.owner.id, 'xbreed:' + id, t), { gems: 0, balance: null }) : this.ctx.breedLimit.record(me, 'harbor', { ref: 'xbreed:' + id }); /*FRIENDSV2-BREED 親密度 Lv5 每天 1 次不佔繁殖次數*/
      if (bu.gems !== x.extraGems) throw new HttpError(409, 'price_changed', '加購價格已變動，請重新確認');
      if (bu.balance != null) balance = bu.balance;
      if (x.gems > 0) balance = this.ctx.commerce.ledger(me, -x.gems, 'spend', 'xbreed:' + id);
      save.coins = (save.coins || 0) - x.coins; save.found = save.found || {}; save.found[child.sp] = 1;
      const w = this.writeOwn(me, save, x.ms.rev, 0);
      this.note(x.owner.id, 'breed', me, { sp: x.of.sp, child: child.sp, fishName: cleanName(x.of.name) }, B.studFee);
      if (this.ctx.friendsV2 && this.rel(me, x.owner.id) === 'friend') this.ctx.friendsV2.addIntimacy(me, x.owner.id, 'breed', this.ctx.friendsV2.sameIp(me, x.owner.id)); /*FRIENDSV2-BREED*/
      if (x.totalGems > 0) this.ctx.players.logEvent(me, 'gems_spent', { ref: 'xbreed:' + id, gems: x.totalGems, sku: 'social:breed' });
      this.ctx.players.logEvent(me, 'social_breed', { owner: x.owner.id, child: child.sp, coins: x.coins, gems: x.gems, extraGems: x.extraGems });
      return { child, destination, kind: r.kind, coins: x.coins, discount: x.discount, bond: x.bond, gems: x.gems + x.extraGems, extraGems: x.extraGems, balance, save: w.save, rev: w.rev, today: this.today(me) };
    })();
  }
  // ---- 後台 ----
  stats() {
    const d = this.day(), d7 = this.day(this.now() - 6 * 86400000);
    const q = (sql, ...a) => this.db.prepare(sql).get(...a);
    return {
      day: d,
      breedUses: q("SELECT COUNT(*) n, SUM(CASE WHEN source='own' THEN 1 ELSE 0 END) own, SUM(CASE WHEN source='harbor' THEN 1 ELSE 0 END) harbor, COALESCE(SUM(gems),0) gems FROM breed_uses WHERE day=?", d),
      today: { helps: q('SELECT COUNT(*) n, COALESCE(SUM(reward),0) coins FROM social_helps WHERE day=?', d), breeds: q('SELECT COUNT(*) n, SUM(CASE WHEN gems>0 THEN 1 ELSE 0 END) gem, COALESCE(SUM(gems+extra_gems),0) gems, COALESCE(SUM(coins),0) coins, SUM(CASE WHEN extra_n>0 THEN 1 ELSE 0 END) extra FROM social_breeds WHERE day=?', d) },
      week: { helps: q('SELECT COUNT(*) n, COALESCE(SUM(reward),0) coins FROM social_helps WHERE day>=?', d7), breeds: q('SELECT COUNT(*) n, COALESCE(SUM(gems+extra_gems),0) gems, COALESCE(SUM(coins),0) coins FROM social_breeds WHERE day>=?', d7) },
      friends: q("SELECT SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM social_friends"),
      optOut: q('SELECT COUNT(*) n FROM social_prefs WHERE breed_open=0').n, hidden: q('SELECT COUNT(*) n FROM players p WHERE ' + HIDDEN_SQL).n,
      topHelpers: this.db.prepare('SELECT h.helper_id id, p.nickname, COUNT(*) n, SUM(h.reward) coins FROM social_helps h JOIN players p ON p.id=h.helper_id WHERE h.day>=? GROUP BY h.helper_id ORDER BY n DESC LIMIT 10').all(d7),
      recentBreeds: this.db.prepare('SELECT b.id, b.requester_id, b.owner_id, b.child_sp, b.kind, b.coins, b.gems, b.extra_gems, b.created_at FROM social_breeds b ORDER BY b.id DESC LIMIT 20').all(),
      config: this.S,
    };
  }
}

function mountSocial(app, ctx) {
  const so = new Social(ctx); ctx.social = so;
  const env = ctx.env || {};
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const readLim = new RateLimiter({ windowMs: 60000, max: toInt(env.SOCIAL_READ_PER_MIN, 90) });
  const actLim = new RateLimiter({ windowMs: 60000, max: toInt(env.SOCIAL_ACT_PER_MIN, 30) });
  const friendLim = new Map();
  const lim = (L, max) => (req, res, next) => { const c = L.check('so' + req.player.id); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試')); } next(); };
  const member = (req, res, next) => { if (!req.player.username) return next(new HttpError(403, 'members_only', '🤝 好友功能的互動只開放給註冊會員，請先註冊或登入')); next(); };
  const on = (req, res, next) => { if (!so.S.enabled) return next(new HttpError(403, 'social_off', '好友功能暫停開放')); next(); };
  const friendReq = (req, res, next) => { // 好友邀請：每小時上限（後台可調）
    const max = so.S.friends.requestsPerHour, k = 'fr' + req.player.id, t = Date.now();
    const arr = (friendLim.get(k) || []).filter((x) => t - x < 3600000);
    if (arr.length >= max) { res.set('Retry-After', '600'); return next(new HttpError(429, 'rate_limited', `好友邀請太頻繁（每小時最多 ${max} 次）`)); }
    arr.push(t); friendLim.set(k, arr); if (friendLim.size > 20000) for (const [kk, v] of friendLim) if (!v.length || t - v[v.length - 1] > 3600000) friendLim.delete(kk); next();
  };
  // Public, read-only shared scenes use the same visit privacy checks as guest visits.
  const shareLim = new RateLimiter({windowMs:60000,max:60});
  app.get('/api/share/tank/:id', (req,res,next)=>{const c=shareLim.check('share:'+req.ip);if(!c.ok){res.set('Retry-After',String(c.retryAfter));return next(new HttpError(429,'rate_limited','參觀太頻繁，請稍後再試'))}next()},on,wrap((req,res)=>{res.set('Cache-Control','no-store');const v=so.tank(0,toInt(req.params.id,0),false);return{player:{id:v.player.id,name:v.player.name,level:v.player.level,tank:v.player.tank},total:v.total,plants:v.plants,scene:v.scene}}));
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));
  r.use(ctx.players.auth());
  r.use((req, res, next) => { if (ctx.friendsV2) ctx.friendsV2.touchIp(req.player.id, req.ip); next(); }); /*FRIENDSV2-IP*/
  r.use(on);
  r.get('/hub', lim(readLim), wrap((req) => so.hub(req.player.id, !!req.player.username)));
  r.get('/search', lim(readLim), wrap((req) => so.search(req.player.id, req.query.q)));
  r.get('/tank/:id', lim(readLim), wrap((req) => so.tank(req.player.id, toInt(req.params.id, 0), !!req.player.username)));
  r.get('/unread', lim(readLim), member, wrap((req) => so.unread(req.player.id)));
  r.get('/notes', lim(readLim), member, wrap((req) => so.notes(req.player.id)));
  r.post('/notes/read', lim(readLim), member, wrap((req) => so.readNotes(req.player.id)));
  r.post('/notes/apply', lim(actLim), member, wrap((req) => so.apply(req.player.id)));
  r.post('/friends/request', lim(actLim), member, friendReq, wrap((req) => so.request(req.player.id, req.body && req.body.id)));
  r.post('/friends/accept', lim(actLim), member, wrap((req) => so.accept(req.player.id, req.body && req.body.id)));
  r.post('/friends/decline', lim(actLim), member, wrap((req) => so.decline(req.player.id, req.body && req.body.id)));
  r.post('/friends/remove', lim(actLim), member, wrap((req) => so.remove(req.player.id, req.body && req.body.id)));
  r.post('/settings', lim(actLim), member, wrap((req) => so.setPrefs(req.player.id, req.body)));
  r.post('/help', lim(actLim), member, wrap((req) => so.help(req.player.id, req.body && req.body.ownerId)));
  r.get('/breed/quote', lim(readLim), member, wrap((req) => { const x = so.quote(req.player.id, req.query); return { parentFees:x.parentFees,coins: x.coins, coinsBase: x.coinsBase, discount: x.discount, bond: x.bond, gems: x.gems, extraGems: x.extraGems, totalGems: x.totalGems, gemFish: x.gemFish, extra: x.extra, today: x.today, balance: ctx.commerce.balance(req.player.id), myCoins: Math.floor(x.ms.save.coins || 0) }; }));
  r.post('/breed', lim(actLim), member, wrap((req) => so.breed(req.player.id, req.body || {})));
  app.use('/api/social', r);
  const a = express.Router();
  a.use(ctx.adminAuth.require());
  a.use(express.json({ limit: '5kb' }));
  a.get('/stats', wrap(() => so.stats()));
  a.get('/players/:id', wrap((req) => { const id = toInt(req.params.id, 0); const p = so.player(id); if (!p) throw new HttpError(404, 'not_found', '找不到玩家'); return { id, noVisits: !!p.no_visits, prefs: so.prefs(id) }; }));
  a.post('/players/:id/visits', wrap((req) => { const id = toInt(req.params.id, 0), hidden = !!(req.body && req.body.hidden); const out = so.adminSetHidden(id, hidden); ctx.adminAuth.audit(req, 'social.no_visits', 'player:' + id, { hidden }); return out; }));
  // FRIENDTANK-ADMIN：後台唯讀「用遊戲畫面看玩家魚缸」（/?viewTank=ID）；只 GET、只讀，不受不開放拜訪影響；不回傳私人資料
  a.get('/tank/:id', wrap((req) => { const id = toInt(req.params.id, 0); const p = so.player(id); if (!p) throw new HttpError(404, 'not_found', '找不到玩家'); return so.adminTank(p); }));
  app.use('/admin/api/social', a);
  return so;
}

module.exports = { mountSocial, Social, migrate, socCfg, levelOf, DEF, sceneOf };
