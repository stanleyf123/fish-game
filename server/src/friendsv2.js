'use strict';
// FRIENDSV2-SERVER 好友系統 v2（第一批＋第二批）
//  - 隱形功能（可直接上線，各自有開關）：邀請成功自動成為好友、推薦排序、待回應邀請 7 天過期、拜訪紀錄（social_visits）、IP 雜湊紀錄（同 IP 判定用）
//  - 玩家看得到的功能與新的獎勵發放（每日互助、親密度、送禮、邀請階梯、首儲分潤）全部在 friendsV2.enabled（預設 false＝關）之後
//  - 所有獎勵由伺服器結算、只寫進「自己的」存檔；給別人的金幣走 social_notes（主人上線時套用，冪等）
//  - 所有數值集中在 FV2_DEF（後台設定 friendsV2 可覆寫）
const express = require('express');
const { HttpError, bad, RateLimiter, toInt, clampStr } = require('./util');
const { ipHash } = require('./invite');
const { REAL_MONEY_PROVIDERS, providerInSql } = require('./money');

// ======================= FRIENDSV2-CONFIG（全部數值都在這裡；等站長核准）=======================
const FV2_DEF = {
  enabled: false,                 // 總開關（玩家看得到的功能＋新獎勵）。預設關閉；前端另可用 ?friendsv2=0 強制關
  // --- 隱形、純功能（可先上線） ---
  autoFriend: true,               // 邀請成功（被邀請者成為會員）→ 自動成為好友（遵守 100 人上限）
  recommend: { enabled: true, onlineHours: 24, maxIncomingPending: 10, pool: 200, levelWeight: 8, onlineBonus: 100, hourBonus: 20, jitter: 15 },
  expireDays: 7,                  // 待回應好友邀請 N 天後自動過期（0＝不過期）
  visitLog: true,                 // 伺服器記錄拜訪（social_visits）
  ipLog: true,                    // 記錄 IP 雜湊（同 IP 好友對判定）
  sameIpDays: 30,                 // 同 IP 判定看最近幾天
  minAgeHours: 24,                // 帳號未滿 N 小時：互助／送禮不給獎勵
  // --- 💰 邀請階梯＋首儲分潤（另外的開關，預設關） ---
  inviteLadder: { enabled: false, tiers: [[3, 30], [5, 50], [10, 100]] },        // [達成合格邀請數, 💎]
  rebate: { enabled: false, pct: 10, gemsPerTwd: 2, min: 5, max: 100, holdHours: 24 }, // 被邀請者首次真錢儲值：金額×10%×2💎/NT$，5–100💎，付款滿 24 小時才發；退款會扣回
  // --- 第二批（在總開關之後） ---
  help: { enabled: true, helperBase: 40, helperPerLevel: 5, helperMax: 120, ownerCoins: 20, dailyRewarded: 10, dailyCoinCap: 1000, ownerDailyRewarded: 10,
    feedAmount: 40, algaeAmount: 25, wasteAmount: 25 },
  intimacy: { enabled: true, thresholds: [0, 10, 25, 45, 70, 100, 140, 190, 250, 320], gain: { help: 2, giftFree: 1, giftPaid: 5, breed: 2 }, dailyPairCap: 5, sameIpFactor: 0,
    milestones: { 2: { coins: 200 }, 3: { coins: 300 }, 4: { coins: 500 }, 5: { coins: 500 }, 6: { coins: 500, title: '好朋友' }, 7: { coins: 800 }, 8: { coins: 1000 }, 9: { coins: 1000 }, 10: { coins: 2000, title: '摯友' } },
    breedDiscount: [[3, 10], [7, 20]],   // [Lv, 借魚繁殖金幣費 −%]
    bondBreedLv: 5 },                    // Lv5 起：每天多 1 次免費借魚繁殖（向親密度 ≥Lv5 的好友借，每人每天 1 次）
  gifts: { enabled: true, freePool: [[30, 50], [50, 35], [80, 15]], recipientDailyRewarded: 10,   // 免費禮物：🪙30（50%）／50（35%）／80（15%）；每人每天最多 10 份有金幣
    paid: { enabled: true, perSenderDaily: 5, decoGems: 10, fryGems: 20, fryMaxRarity: 2, bgUseShopPrice: true, excludeBg: ['bg_festival'] }, expireDays: 30 },
};
// ===========================================================================================
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
function merge(a, b) { if (!isObj(b)) return a; const o = { ...a }; for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; }
function fv2Cfg(cfg) { return merge(FV2_DEF, (cfg && cfg.friendsV2) || {}); }
const ACTIONS = { feed: '餵食', algae: '刷藻', waste: '撈髒污' };
const DAY = 86400000;

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS fv2_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS fv2_ips (player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, ip_hash TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (player_id, ip_hash));
CREATE INDEX IF NOT EXISTS idx_fv2_ips_hash ON fv2_ips(ip_hash, last_at);
CREATE TABLE IF NOT EXISTS social_visits (visitor_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, member INTEGER NOT NULL DEFAULT 0, friend INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (visitor_id, owner_id, day));
CREATE INDEX IF NOT EXISTS idx_social_visits_owner ON social_visits(owner_id, day);
CREATE INDEX IF NOT EXISTS idx_social_visits_day ON social_visits(day);
CREATE TABLE IF NOT EXISTS fv2_invite_links (invitee_id INTEGER PRIMARY KEY, inviter_id INTEGER NOT NULL, state TEXT NOT NULL, via TEXT NOT NULL DEFAULT 'auto', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fv2_bonus (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL UNIQUE, player_id INTEGER NOT NULL, invitee_id INTEGER, order_id TEXT, amount_twd INTEGER, gems INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'paid', ref TEXT, created_at INTEGER NOT NULL, clawed_at INTEGER, claw_gems INTEGER);
CREATE INDEX IF NOT EXISTS idx_fv2_bonus_player ON fv2_bonus(player_id, kind);
CREATE TABLE IF NOT EXISTS fv2_intimacy (a INTEGER NOT NULL, b INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS fv2_intim_day (a INTEGER NOT NULL, b INTEGER NOT NULL, day TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b, day));
CREATE TABLE IF NOT EXISTS fv2_milestones (a INTEGER NOT NULL, b INTEGER NOT NULL, lv INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (a, b, lv));
CREATE TABLE IF NOT EXISTS fv2_help (id INTEGER PRIMARY KEY, helper_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, day TEXT NOT NULL, action TEXT NOT NULL, helper_coins INTEGER NOT NULL DEFAULT 0, owner_coins INTEGER NOT NULL DEFAULT 0, intimacy INTEGER NOT NULL DEFAULT 0, why TEXT, created_at INTEGER NOT NULL, UNIQUE (helper_id, owner_id, day));
CREATE INDEX IF NOT EXISTS idx_fv2_help_owner ON fv2_help(owner_id, day);
CREATE TABLE IF NOT EXISTS fv2_gifts (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, idem_key TEXT, status TEXT NOT NULL DEFAULT 'sent', why TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER, UNIQUE (from_id, idem_key));
CREATE UNIQUE INDEX IF NOT EXISTS idx_fv2_gifts_free ON fv2_gifts(from_id, to_id, day) WHERE kind='free';
CREATE INDEX IF NOT EXISTS idx_fv2_gifts_to ON fv2_gifts(to_id, status);
CREATE TABLE IF NOT EXISTS fv2_bond_breeds (player_id INTEGER NOT NULL, day TEXT NOT NULL, owner_id INTEGER NOT NULL, ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (player_id, day));
CREATE INDEX IF NOT EXISTS idx_social_friends_pending ON social_friends(status, created_at);`);
  // 自動成為好友只套用在這個時間點之後建立的邀請（之前的用一次性回填腳本，需站長核准）
  db.prepare('INSERT OR IGNORE INTO fv2_meta (k, v) VALUES (?, ?)').run('autofriend_since', String(Date.now()));
}

class FriendsV2 {
  constructor(ctx) { this.ctx = ctx; this.db = ctx.db; migrate(this.db); this._sweepAt = 0; this._ipSeen = new Map(); }
  get now() { return this.ctx.social ? this.ctx.social.now : Date.now; }
  get cfg() { return this.ctx.configStore.active().config; }
  get F() { return fv2Cfg(this.cfg); }
  get so() { return this.ctx.social; }
  t() { return this.now(); }
  day(ms) { return this.ctx.commerce.day(ms == null ? this.t() : ms); }
  meta(k) { const r = this.db.prepare('SELECT v FROM fv2_meta WHERE k=?').get(k); return r ? r.v : null; }
  on(feature) { const F = this.F; if (F.enabled !== true) return false; if (!feature) return true; const f = F[feature]; return !(f && f.enabled === false); }
  need(feature) { if (!this.on(feature)) throw new HttpError(403, 'fv2_off', '這個好友功能還沒開放'); }
  pair(x, y) { return x < y ? [x, y] : [y, x]; }

  // ---------- IP 雜湊 ----------
  touchIp(pid, ip) {
    if (!pid || !ip || !this.F.ipLog) return; const h = ipHash(ip); if (!h) return;
    const k = pid + '|' + h, t = this.t(), last = this._ipSeen.get(k) || 0; if (t - last < 600000) return; this._ipSeen.set(k, t);
    if (this._ipSeen.size > 50000) this._ipSeen.clear();
    try { this.db.prepare('INSERT INTO fv2_ips (player_id, ip_hash, first_at, last_at) VALUES (?,?,?,?) ON CONFLICT(player_id, ip_hash) DO UPDATE SET last_at=excluded.last_at').run(pid, h, t, t); } catch (e) { /* 只是紀錄 */ }
  }
  // 同 IP 好友對：最近 sameIpDays 天出現過相同 IP 雜湊，或兩人之間的邀請被標記同 IP
  sameIp(x, y) {
    const since = this.t() - this.F.sameIpDays * DAY;
    if (this.db.prepare('SELECT 1 FROM fv2_ips a JOIN fv2_ips b ON b.ip_hash=a.ip_hash AND b.player_id=? WHERE a.player_id=? AND a.last_at>? AND b.last_at>? LIMIT 1').get(y, x, since, since)) return true;
    const inv = this.db.prepare('SELECT flag, reason FROM invites WHERE (invitee_id=? AND inviter_id=?) OR (invitee_id=? AND inviter_id=?)').all(x, y, y, x);
    if (inv.some((r) => r.flag === 'same_ip' || r.reason === 'same_ip' || r.reason === 'same_ip_identity' || r.reason === 'same_ip_cap')) return true;
    // 邀請碼頁面記錄的 IP（邀請人）× 被邀請者 attach 時的 IP
    const ic = this.db.prepare('SELECT ip_hash FROM invite_codes WHERE player_id IN (?,?) AND ip_hash IS NOT NULL').all(x, y).map((r) => r.ip_hash);
    if (ic.length && this.db.prepare(`SELECT 1 FROM fv2_ips WHERE player_id IN (?,?) AND last_at>? AND ip_hash IN (${ic.map(() => '?').join(',')}) GROUP BY ip_hash HAVING COUNT(DISTINCT player_id)>1 LIMIT 1`).get(x, y, since, ...ic)) return true;
    return false;
  }
  young(p) { return !p || this.t() - p.created_at < this.F.minAgeHours * 3600000; }

  // ---------- 拜訪紀錄 ----------
  logVisit(visitor, owner, isMember) {
    if (!this.F.visitLog || !visitor || !owner || visitor === owner) return;
    try {
      const t = this.t(), d = this.day(t), fr = isMember && this.so && this.so.rel(visitor, owner) === 'friend' ? 1 : 0;
      this.db.prepare(`INSERT INTO social_visits (visitor_id, owner_id, day, n, member, friend, first_at, last_at) VALUES (?,?,?,1,?,?,?,?)
        ON CONFLICT(visitor_id, owner_id, day) DO UPDATE SET n=MIN(n+1, 1000), last_at=excluded.last_at, friend=excluded.friend`).run(visitor, owner, d, isMember ? 1 : 0, fr, t, t);
    } catch (e) { /* 只是紀錄 */ }
  }
  visitors(me) {
    const d7 = this.day(this.t() - 6 * DAY);
    return this.db.prepare(`SELECT v.visitor_id id, p.nickname, MAX(v.last_at) at, SUM(v.n) n, MAX(v.friend) friend FROM social_visits v JOIN players p ON p.id=v.visitor_id
      WHERE v.owner_id=? AND v.day>=? AND v.member=1 AND p.banned_at IS NULL GROUP BY v.visitor_id ORDER BY at DESC LIMIT 30`).all(me, d7)
      .map((r) => ({ id: r.id, name: (String(r.nickname || '').trim().slice(0, 16)) || ('魚友#' + r.id), at: r.at, n: r.n, friend: !!r.friend }));
  }

  // ---------- 待回應邀請過期（節流：每 10 分鐘最多一次）----------
  sweepExpired(force) {
    const days = +this.F.expireDays || 0; if (days <= 0) return 0; const t = this.t();
    if (!force && t - this._sweepAt < 600000) return 0; this._sweepAt = t;
    const cut = t - days * DAY;
    return this.db.transaction(() => {
      const n = this.db.prepare("UPDATE social_friends SET status='expired', updated_at=? WHERE status='pending' AND created_at<?").run(t, cut).changes;
      // 已過期（不再待回應）的 friend_req 通知標記為已讀，紅點不再算它
      this.db.prepare(`UPDATE social_notes SET read_at=? WHERE kind='friend_req' AND read_at IS NULL AND created_at<? AND actor_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM social_friends f WHERE f.a=MIN(social_notes.player_id, social_notes.actor_id) AND f.b=MAX(social_notes.player_id, social_notes.actor_id) AND f.status='pending')`).run(t, cut);
      return n;
    })();
  }

  // ---------- 推薦（取代 ORDER BY random()）----------
  levelOfFound(n) { const T = (this.cfg.mechanics && this.cfg.mechanics.progression && this.cfg.mechanics.progression.foundThresholds) || [0, 2, 5, 9, 14, 20, 27, 35, 44, 55]; let lv = 1; T.forEach((x, i) => { if (n >= x) lv = i + 1; }); return lv; }
  recommend(me, isMember, limit, hiddenSql) {
    const R = this.F.recommend, t = this.t(), S = this.so.S;
    const mine = this.db.prepare('SELECT found_count FROM saves WHERE player_id=?').get(me); const myLv = this.levelOfFound(mine ? mine.found_count : 0);
    const rows = this.db.prepare(`SELECT p.id, p.nickname, p.last_seen, s.found_count FROM players p JOIN saves s ON s.player_id=p.id
      WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND p.is_demo=0 AND NOT ${hiddenSql} AND p.id<>? AND p.last_seen>? AND s.fish_count>0
        AND NOT EXISTS (SELECT 1 FROM social_friends f WHERE f.a=MIN(p.id, ?) AND f.b=MAX(p.id, ?) AND f.status IN ('pending','accepted'))
        AND (SELECT COUNT(*) FROM social_friends f WHERE (f.a=p.id OR f.b=p.id) AND f.status='pending' AND f.requester<>p.id) < ?
        AND (SELECT COUNT(*) FROM social_friends f WHERE (f.a=p.id OR f.b=p.id) AND f.status='accepted') < ?
      ORDER BY p.last_seen DESC LIMIT ?`).all(me, t - S.visit.recentDays * DAY, me, me, R.maxIncomingPending, S.friends.max, R.pool);
    const scored = rows.map((p) => {
      const lv = this.levelOfFound(p.found_count || 0), age = t - p.last_seen;
      const sc = (age < R.onlineHours * 3600000 ? R.onlineBonus : 0) + (age < 3600000 ? R.hourBonus : 0) - R.levelWeight * Math.abs(lv - myLv) + Math.random() * R.jitter;
      return { p, sc };
    }).sort((a, b) => b.sc - a.sc).slice(0, limit);
    return scored.map((x) => x.p);
  }

  // ---------- 邀請成功 → 自動成為好友 ----------
  linkInvite(inviteeId, via = 'auto', opts = {}) {
    if (!this.F.autoFriend && !opts.force) return null;
    const inv = this.db.prepare('SELECT * FROM invites WHERE invitee_id=?').get(inviteeId); if (!inv) return null;
    if (inv.reason === 'self' || inv.inviter_id === inviteeId) return null;
    if (!opts.backfill) { const since = +this.meta('autofriend_since') || 0; if (inv.created_at < since) return null; }
    if (this.db.prepare('SELECT 1 FROM fv2_invite_links WHERE invitee_id=?').get(inviteeId)) return null;
    const P = this.ctx.players, a = P.get(inviteeId), b = P.get(inv.inviter_id);
    if (!a || !a.username) return null; // 被邀請者還沒成為會員：之後再試
    const max = this.so.S.friends.max, t = this.t();
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM fv2_invite_links WHERE invitee_id=?').get(inviteeId)) return null;
      let state;
      if (!b || !b.username || b.banned_at || a.banned_at || a.is_demo || b.is_demo) state = 'skip';
      else {
        const [x, y] = this.pair(inviteeId, inv.inviter_id); const r = this.db.prepare('SELECT * FROM social_friends WHERE a=? AND b=?').get(x, y);
        if (r && r.status === 'accepted') state = 'already';
        else if (this.so.friendCount(inviteeId) >= max || this.so.friendCount(inv.inviter_id) >= max) state = 'full';
        else {
          if (r) this.db.prepare("UPDATE social_friends SET status='accepted', updated_at=? WHERE a=? AND b=?").run(t, x, y);
          else this.db.prepare("INSERT INTO social_friends (a, b, status, requester, created_at, updated_at) VALUES (?,?,'accepted',?,?,?)").run(x, y, inv.inviter_id, t, t);
          this.so.note(inv.inviter_id, 'friend_ok', inviteeId, { via: 'invite' }); this.so.note(inviteeId, 'friend_ok', inv.inviter_id, { via: 'invite' });
          state = 'friend';
        }
      }
      this.db.prepare('INSERT INTO fv2_invite_links (invitee_id, inviter_id, state, via, created_at) VALUES (?,?,?,?,?)').run(inviteeId, inv.inviter_id, state, via, t);
      try { P.logEvent(inviteeId, 'fv2_invite_friend', { inviter: inv.inviter_id, state, via }); } catch (e) { /* 只是紀錄 */ }
      return { inviter: inv.inviter_id, state };
    })();
  }

  // ---------- 💰 邀請階梯／首儲分潤（定期掃描；退款扣回）----------
  qualifiedInvites(pid) {
    return this.db.prepare(`SELECT COUNT(*) n FROM invites i JOIN players p ON p.id=i.invitee_id WHERE i.inviter_id=? AND i.status='rewarded' AND (i.flag IS NULL OR i.flag<>'same_ip') AND p.banned_at IS NULL`).get(pid).n;
  }
  bonusGrant(kind, key, pid, gems, extra, noteData) {
    const t = this.t();
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM fv2_bonus WHERE key=?').get(key)) return null;
      const ref = 'fv2:' + key;
      this.db.prepare('INSERT INTO fv2_bonus (kind, key, player_id, invitee_id, order_id, amount_twd, gems, status, ref, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(kind, key, pid, extra.invitee || null, extra.order || null, extra.amount || null, gems, 'paid', ref, t);
      this.ctx.commerce.ledger(pid, gems, kind === 'ladder' ? 'invite_ladder' : 'invite_rebate', ref);
      this.so.note(pid, 'fv2_' + kind, extra.invitee || null, { gems, ...(noteData || {}) });
      try { this.ctx.players.logEvent(pid, 'fv2_' + kind, { key, gems }); } catch (e) { /* 只是紀錄 */ }
      return { key, gems };
    })();
  }
  sweepLadder(onlyPid) {
    const F = this.F; if (!F.enabled || !F.inviteLadder.enabled) return [];
    const out = [], ids = onlyPid ? [onlyPid] : this.db.prepare("SELECT DISTINCT inviter_id id FROM invites WHERE status='rewarded'").all().map((r) => r.id);
    for (const pid of ids) {
      const p = this.ctx.players.get(pid); if (!p || !p.username || p.banned_at) continue;
      const n = this.qualifiedInvites(pid);
      for (const [need, gems] of F.inviteLadder.tiers) if (n >= need && gems > 0) { const r = this.bonusGrant('ladder', `ladder:${pid}:${need}`, pid, gems, {}, { tier: need }); if (r) out.push({ pid, ...r }); }
    }
    return out;
  }
  rebateGems(amount) { const R = this.F.rebate; return Math.max(R.min, Math.min(R.max, Math.round(amount * R.pct / 100 * R.gemsPerTwd))); }
  sweepRebates() {
    const F = this.F, out = { paid: [], clawed: [] }, t = this.t();
    // 1) 扣回：已發分潤的訂單後來被退款（不論開關，只要有發過就處理）
    for (const b of this.db.prepare("SELECT b.*, o.status ostatus FROM fv2_bonus b JOIN orders o ON o.id=b.order_id WHERE b.kind='rebate' AND b.status='paid' AND o.status='refunded'").all()) {
      this.db.transaction(() => {
        const cur = this.db.prepare("SELECT status FROM fv2_bonus WHERE id=?").get(b.id); if (cur.status !== 'paid') return;
        this.ctx.commerce.ledger(b.player_id, -b.gems, 'refund', 'fv2-claw:' + b.key, true);
        this.db.prepare("UPDATE fv2_bonus SET status='clawed', clawed_at=?, claw_gems=? WHERE id=?").run(t, b.gems, b.id);
        try { this.ctx.players.logEvent(b.player_id, 'fv2_rebate_clawback', { key: b.key, order: b.order_id, gems: b.gems }); } catch (e) { /* 紀錄 */ }
        out.clawed.push({ pid: b.player_id, key: b.key, gems: b.gems });
      })();
    }
    if (!F.enabled || !F.rebate.enabled) return out;
    // 2) 發放：被邀請者「第一筆」真錢訂單（ecpay／newebpay／stripe、TWD、已入帳、狀態 paid），付款滿 holdHours 小時
    const since = +this.meta('rebate_since') || (() => { this.db.prepare('INSERT OR IGNORE INTO fv2_meta (k, v) VALUES (?, ?)').run('rebate_since', String(t)); return t; })();
    const prov = providerInSql(REAL_MONEY_PROVIDERS, 'o.provider');
    const rows = this.db.prepare(`SELECT i.invitee_id, i.inviter_id, i.flag, i.reason, i.status istatus, i.created_at icreated,
        (SELECT o.id FROM orders o WHERE o.player_id=i.invitee_id AND ${prov} AND COALESCE(o.currency,'TWD')='TWD' AND o.credited_at IS NOT NULL ORDER BY o.credited_at, o.id LIMIT 1) first_order
      FROM invites i WHERE i.status<>'rejected' OR i.reason='same_ip'`).all();
    for (const r of rows) {
      if (!r.first_order || r.reason === 'self') continue;
      const key = 'rebate:' + r.invitee_id; if (this.db.prepare('SELECT 1 FROM fv2_bonus WHERE key=?').get(key)) continue;
      const o = this.db.prepare('SELECT * FROM orders WHERE id=?').get(r.first_order);
      if (!o || o.status !== 'paid' || o.credited_at < since || o.credited_at < r.icreated || t - o.credited_at < F.rebate.holdHours * 3600000) continue;
      if (r.flag === 'same_ip' || r.reason === 'same_ip' || this.sameIp(r.invitee_id, r.inviter_id)) { this.markSkip(key, r, o, 'same_ip'); continue; }
      const p = this.ctx.players.get(r.inviter_id); if (!p || !p.username || p.banned_at) continue;
      const g = this.bonusGrant('rebate', key, r.inviter_id, this.rebateGems(o.amount), { invitee: r.invitee_id, order: o.id, amount: o.amount }, { amount: o.amount });
      if (g) out.paid.push({ pid: r.inviter_id, ...g });
    }
    return out;
  }
  markSkip(key, r, o, why) { this.db.prepare("INSERT OR IGNORE INTO fv2_bonus (kind, key, player_id, invitee_id, order_id, amount_twd, gems, status, ref, created_at) VALUES ('rebate',?,?,?,?,?,0,?,NULL,?)").run(key, r.inviter_id, r.invitee_id, o.id, o.amount, 'skip_' + why, this.t()); }
  inviteStatus(pid) {
    const F = this.F, n = this.qualifiedInvites(pid);
    const got = this.db.prepare("SELECT key, gems, status, kind, created_at FROM fv2_bonus WHERE player_id=? ORDER BY id DESC LIMIT 50").all(pid);
    return { ladder: { enabled: !!(F.enabled && F.inviteLadder.enabled), qualified: n, tiers: F.inviteLadder.tiers.map(([need, gems]) => ({ need, gems, done: got.some((g) => g.key === `ladder:${pid}:${need}`) })) },
      rebate: { enabled: !!(F.enabled && F.rebate.enabled), pct: F.rebate.pct, max: F.rebate.max, paid: got.filter((g) => g.kind === 'rebate' && g.status === 'paid').reduce((a, g) => a + g.gems, 0) } };
  }

  // ---------- 親密度 ----------
  intimacy(x, y) { const [a, b] = this.pair(x, y); const r = this.db.prepare('SELECT points FROM fv2_intimacy WHERE a=? AND b=?').get(a, b); return r ? r.points : 0; }
  lvOf(points) { const T = this.F.intimacy.thresholds; let lv = 1; T.forEach((x, i) => { if (points >= x) lv = i + 1; }); return lv; }
  titleOf(lv) { const M = this.F.intimacy.milestones; let t = null; for (let i = 1; i <= lv; i++) if (M[i] && M[i].title) t = M[i].title; return t; }
  intimInfo(points) { const T = this.F.intimacy.thresholds, lv = this.lvOf(points); return { pts: points, lv, next: lv < T.length ? T[lv] : null, title: this.titleOf(lv) }; }
  // 在呼叫端交易裡加親密度；回傳 { gained, lv, up }
  addIntimacy(x, y, kind, sameIp) {
    if (!this.on('intimacy')) return { gained: 0 };
    const I = this.F.intimacy, [a, b] = this.pair(x, y), d = this.day(), t = this.t();
    let g = Math.floor((I.gain[kind] || 0) * (sameIp ? I.sameIpFactor : 1)); if (g <= 0) return { gained: 0, why: sameIp ? 'same_ip' : '' };
    const used = (this.db.prepare('SELECT points FROM fv2_intim_day WHERE a=? AND b=? AND day=?').get(a, b, d) || { points: 0 }).points;
    g = Math.min(g, Math.max(0, I.dailyPairCap - used)); if (g <= 0) return { gained: 0, why: 'daily_cap' };
    const before = this.intimacy(a, b), after = before + g;
    this.db.prepare('INSERT INTO fv2_intim_day (a, b, day, points) VALUES (?,?,?,?) ON CONFLICT(a, b, day) DO UPDATE SET points=points+excluded.points').run(a, b, d, g);
    this.db.prepare('INSERT INTO fv2_intimacy (a, b, points, updated_at) VALUES (?,?,?,?) ON CONFLICT(a, b) DO UPDATE SET points=excluded.points, updated_at=excluded.updated_at').run(a, b, after, t);
    const l0 = this.lvOf(before), l1 = this.lvOf(after), ups = [];
    for (let lv = l0 + 1; lv <= l1; lv++) {
      const m = I.milestones[lv] || {}; const ins = this.db.prepare('INSERT OR IGNORE INTO fv2_milestones (a, b, lv, coins, created_at) VALUES (?,?,?,?,?)').run(a, b, lv, m.coins | 0, t);
      if (!ins.changes) continue; ups.push(lv);
      for (const [p, o] of [[a, b], [b, a]]) this.so.note(p, 'fv2_bond', o, { lv, title: m.title || null }, m.coins | 0);
    }
    return { gained: g, lv: l1, up: ups };
  }
  breedPerks(me, owner) {
    if (!this.on('intimacy') || this.so.rel(me, owner) !== 'friend') return { discount: 0, bond: false, lv: 0 };
    const I = this.F.intimacy, lv = this.lvOf(this.intimacy(me, owner)); let discount = 0; for (const [l, pct] of I.breedDiscount) if (lv >= l) discount = pct;
    const bond = lv >= I.bondBreedLv && !this.db.prepare('SELECT 1 FROM fv2_bond_breeds WHERE player_id=? AND day=?').get(me, this.day());
    return { discount, bond, lv };
  }

  // ---------- 每日互助 ----------
  help(me, body) {
    this.need('help'); const H = this.F.help, so = this.so, ownerId = toInt(body && body.ownerId, 0), action = String((body && body.action) || '');
    if (!ACTIONS[action]) throw bad('bad_action', '請選擇：餵食／刷藻／撈髒污');
    if (ownerId === me) throw bad('self', '自己的魚缸請自己照顧喔');
    const o = so.target(ownerId); if (!o) throw new HttpError(404, 'not_found', '找不到這位玩家，或對方不開放拜訪');
    if (so.rel(me, ownerId) !== 'friend') throw new HttpError(403, 'not_friend', '每日互助只限好友');
    return this.db.transaction(() => {
      const d = this.day(), t = this.t();
      if (this.db.prepare('SELECT 1 FROM social_helps WHERE helper_id=? AND owner_id=? AND day=?').get(me, ownerId, d)) throw new HttpError(409, 'already_helped', '今天已經幫過這位好友了，明天再來吧');
      const mine = so.saveOf(me); if (!mine) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
      const meP = so.player(me), same = this.sameIp(me, ownerId);
      const rewarded = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(reward),0) c FROM social_helps WHERE helper_id=? AND day=? AND reward>0').get(me, d);
      const ownerGot = this.db.prepare('SELECT COUNT(*) n FROM fv2_help WHERE owner_id=? AND day=? AND owner_coins>0').get(ownerId, d).n;
      let hc = 0, oc = 0, why = '';
      if (same) why = '同一個網路的好友互助不給獎勵';
      else if (this.young(meP) || this.young(o)) why = '新帳號（未滿 24 小時）暫時沒有獎勵';
      else {
        if (rewarded.n >= H.dailyRewarded) why = `今天的互助獎勵次數已滿（${H.dailyRewarded} 次）`;
        else hc = Math.max(0, Math.min(H.helperMax, H.helperBase + H.helperPerLevel * this.levelOfFound(Object.keys(mine.save.found || {}).length), H.dailyCoinCap - rewarded.c));
        if (ownerGot < H.ownerDailyRewarded) oc = H.ownerCoins;
      }
      this.db.prepare('INSERT INTO social_helps (helper_id, owner_id, day, reward, friend, created_at) VALUES (?,?,?,?,1,?)').run(me, ownerId, d, hc, t);
      const im = this.addIntimacy(me, ownerId, 'help', same);
      this.db.prepare('INSERT INTO fv2_help (helper_id, owner_id, day, action, helper_coins, owner_coins, intimacy, why, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(me, ownerId, d, action, hc, oc, im.gained || 0, why || null, t);
      const amt = action === 'feed' ? H.feedAmount : action === 'algae' ? H.algaeAmount : H.wasteAmount;
      so.note(ownerId, 'help2', me, { action, amount: amt }, oc);
      let w = { save: null, rev: null };
      if (hc > 0) { mine.save.coins = (mine.save.coins || 0) + hc; w = so.writeOwn(me, mine.save, mine.rev, hc); }
      try { this.ctx.players.logEvent(me, 'fv2_help', { owner: ownerId, action, hc, oc, same }); } catch (e) { /* 紀錄 */ }
      return { action, reward: hc, ownerReward: oc, why, intimacy: { ...this.intimInfo(this.intimacy(me, ownerId)), gained: im.gained || 0, up: im.up || [] }, save: w.save, rev: w.rev };
    })();
  }

  // ---------- 送禮 ----------
  catalog() {
    const cfg = this.cfg, G = this.F.gifts.paid, out = [];
    const bgs = (cfg.cosmetics && cfg.cosmetics.backgrounds) || require('./gemshop').DEFAULT_BACKGROUNDS || {};
    // FRIENDSV2-NOFESTIVAL：首次儲值禮的背景（pay.firstTopupGift.cosmetic，預設 bg_festival）維持獨家，不可當禮物
    const ex = new Set([...(Array.isArray(G.excludeBg) ? G.excludeBg : []), 'bg_festival']);
    try { const ft = cfg.pay && cfg.pay.firstTopupGift; ex.add((ft && ft.cosmetic) || 'bg_festival'); } catch (e) { /* 預設 */ }
    for (const [id, b] of Object.entries(bgs)) if (b && b.priceGems > 0 && !b.disabled && !ex.has(id)) out.push({ id: 'bg:' + id, kind: 'bg', ref: id, name: b.name, icon: b.icon || '🖼️', gems: b.priceGems });
    for (const [id, d] of Object.entries(cfg.decorations || {})) if (d && !d.disabled) out.push({ id: 'deco:' + id, kind: 'deco', ref: id, name: d.name, icon: d.icon || '🎁', gems: G.decoGems });
    for (const [id, s] of Object.entries(cfg.species || {})) if (s && !s.disabled && !s.premium && !s.breedOnly && !(s.priceGems > 0) && (s.price || 0) > 0 && (s.rarity | 0) <= G.fryMaxRarity) out.push({ id: 'fry:' + id, kind: 'fry', ref: id, name: (s.name || id) + '魚苗', icon: '🐟', gems: G.fryGems });
    return out;
  }
  owns(save, it) {
    if (!save) return false;
    if (it.kind === 'bg') return !!(save.cos && save.cos.own && save.cos.own[it.ref]);
    if (it.kind === 'deco') return Array.isArray(save.up && save.up.deco) && save.up.deco.includes(it.ref);
    return false;
  }
  giftFree(me, to) {
    this.need('gifts'); const G = this.F.gifts, so = this.so;
    const o = this.giftTarget(me, to);
    return this.db.transaction(() => {
      const d = this.day(), t = this.t();
      if (this.db.prepare("SELECT 1 FROM fv2_gifts WHERE from_id=? AND to_id=? AND day=? AND kind='free'").get(me, to, d)) throw new HttpError(409, 'already_gifted', '今天已經送過這位好友免費禮物了');
      const same = this.sameIp(me, to), got = this.db.prepare("SELECT COUNT(*) n FROM fv2_gifts WHERE to_id=? AND day=? AND kind='free' AND coins>0").get(to, d).n;
      let coins = 0, why = null;
      if (same) why = 'same_ip'; else if (this.young(so.player(me)) || this.young(o)) why = 'young'; else if (got >= G.recipientDailyRewarded) why = 'recipient_cap';
      else { const tot = G.freePool.reduce((a, x) => a + x[1], 0); let r = Math.random() * tot; for (const [c, w] of G.freePool) { if ((r -= w) < 0) { coins = c; break; } } if (!coins) coins = G.freePool[0][0]; }
      const id = this.db.prepare("INSERT INTO fv2_gifts (from_id, to_id, day, kind, item, coins, gems, status, why, created_at) VALUES (?,?,?,'free','free',?,0,'sent',?,?)").run(me, to, d, coins, why, t).lastInsertRowid;
      const im = this.addIntimacy(me, to, 'giftFree', same);
      try { this.ctx.players.logEvent(me, 'fv2_gift', { to, kind: 'free', coins, why }); } catch (e) { /* 紀錄 */ }
      return { id: Number(id), kind: 'free', intimacy: { ...this.intimInfo(this.intimacy(me, to)), gained: im.gained || 0, up: im.up || [] } };
    })();
  }
  giftTarget(me, to) {
    if (to === me) throw bad('self', '不能送禮給自己');
    const o = this.so.target(to); if (!o) throw new HttpError(404, 'not_found', '找不到這位玩家');
    if (this.so.rel(me, to) !== 'friend') throw new HttpError(403, 'not_friend', '送禮只限好友');
    return o;
  }
  giftPaid(me, to, itemId, idem) {
    this.need('gifts'); const P = this.F.gifts.paid; if (!P.enabled) throw new HttpError(403, 'fv2_off', '付費禮物暫停中');
    idem = typeof idem === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(idem) ? idem : null; if (!idem) throw bad('bad_request', '缺少 idempotencyKey');
    this.giftTarget(me, to);
    return this.db.transaction(() => {
      const ex = this.db.prepare('SELECT * FROM fv2_gifts WHERE from_id=? AND idem_key=?').get(me, idem);
      if (ex) return { id: ex.id, reused: true, gems: ex.gems, balance: this.ctx.commerce.balance(me) };
      const it = this.catalog().find((x) => x.id === String(itemId || '')); if (!it) throw new HttpError(404, 'no_item', '找不到這個禮物');
      const d = this.day(), t = this.t();
      if (this.db.prepare("SELECT COUNT(*) n FROM fv2_gifts WHERE from_id=? AND day=? AND kind='paid'").get(me, d).n >= P.perSenderDaily) throw new HttpError(429, 'gift_limit', `付費禮物每天最多送 ${P.perSenderDaily} 份`);
      const rs = this.so.saveOf(to); if (this.owns(rs && rs.save, it)) throw new HttpError(409, 'already_owned', '對方已經有這個了，換一個吧');
      if ((it.kind === 'bg' || it.kind === 'deco') && this.db.prepare("SELECT 1 FROM fv2_gifts WHERE to_id=? AND item=? AND status='sent'").get(to, it.id)) throw new HttpError(409, 'already_owned', '對方已經收到這個禮物（還沒領），換一個吧');
      const bal = this.ctx.commerce.balance(me); if (bal < it.gems) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price: it.gems });
      const id = this.db.prepare("INSERT INTO fv2_gifts (from_id, to_id, day, kind, item, coins, gems, idem_key, status, created_at) VALUES (?,?,?,'paid',?,0,?,?,'sent',?)").run(me, to, d, it.id, it.gems, idem, t).lastInsertRowid;
      const balance = this.ctx.commerce.ledger(me, -it.gems, 'spend', 'fv2gift:' + id);
      const im = this.addIntimacy(me, to, 'giftPaid', this.sameIp(me, to));
      this.ctx.players.logEvent(me, 'gems_spent', { ref: 'fv2gift:' + id, gems: it.gems, sku: 'social:gift:' + it.kind });
      return { id: Number(id), kind: 'paid', item: it, gems: it.gems, balance, intimacy: { ...this.intimInfo(this.intimacy(me, to)), gained: im.gained || 0, up: im.up || [] } };
    })();
  }
  inbox(me) {
    return this.db.prepare("SELECT g.*, p.nickname FROM fv2_gifts g JOIN players p ON p.id=g.from_id WHERE g.to_id=? AND g.status='sent' AND g.created_at>? ORDER BY g.id LIMIT 50").all(me, this.t() - this.F.gifts.expireDays * DAY)
      .map((g) => ({ id: g.id, from: { id: g.from_id, name: String(g.nickname || '').trim().slice(0, 16) || ('魚友#' + g.from_id) }, kind: g.kind, item: g.item, coins: g.coins, at: g.created_at }));
  }
  claim(me) {
    this.need('gifts'); const so = this.so, cfg = this.cfg;
    return this.db.transaction(() => {
      const list = this.inbox(me); if (!list.length) return { claimed: [], coins: 0, save: null, rev: null };
      const sv = so.saveOf(me); if (!sv) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
      const save = sv.save, t = this.t(), claimed = [], left = []; let coins = 0;
      const { capacityOf, usedSpaceOf } = require('./anticheat');
      for (const g of list) {
        if (g.kind === 'free') { coins += g.coins | 0; claimed.push(g); continue; }
        const [k, ref] = g.item.split(':');
        if (k === 'bg') { save.cos = isObj(save.cos) ? save.cos : {}; save.cos.own = isObj(save.cos.own) ? save.cos.own : {}; if (!save.cos.own[ref]) { save.cos.own[ref] = 1; claimed.push(g); } else { this.refund(g, 'dup'); claimed.push({ ...g, refunded: true }); continue; } }
        else if (k === 'deco') { save.up = isObj(save.up) ? save.up : {}; save.up.deco = Array.isArray(save.up.deco) ? save.up.deco : []; if (!save.up.deco.includes(ref)) { save.up.deco.push(ref); claimed.push(g); } else { this.refund(g, 'dup'); claimed.push({ ...g, refunded: true }); continue; } }
        else if (k === 'fry') {
          const s = cfg.species[ref]; if (!s) { this.refund(g, 'gone'); continue; }
          const child = { id: 'g' + Math.random().toString(36).slice(2, 10), sp: ref, name: cfg.names[Math.floor(Math.random() * cfg.names.length)], hue: Math.floor(Math.random() * 360), size: 1, growth: 0, full: (cfg.hunger && cfg.hunger.offspringFullness) || 80, health: 100, cd: 0, coinT: 10, seed: Math.floor(Math.random() * 1e5), px: .5, py: .5, dir: 1, gift: 1 };
          const cap = capacityOf(cfg, (save.up && save.up.cap) || 0, save);
          if (usedSpaceOf(cfg, (save.fish || []).concat([child])) > cap) { left.push({ ...g, why: 'no_space' }); continue; }
          save.fish = save.fish || []; save.fish.push(child); save.found = save.found || {}; save.found[ref] = 1; claimed.push(g);
        }
        this.db.prepare("UPDATE fv2_gifts SET status='claimed', claimed_at=? WHERE id=? AND status='sent'").run(t, g.id);
      }
      for (const g of claimed.filter((x) => x.kind === 'free')) this.db.prepare("UPDATE fv2_gifts SET status='claimed', claimed_at=? WHERE id=? AND status='sent'").run(t, g.id);
      if (!claimed.length) return { claimed, left, coins: 0, save: null, rev: null };
      save.coins = (save.coins || 0) + coins;
      const w = so.writeOwn(me, save, sv.rev, coins);
      return { claimed, left, coins, save: w.save, rev: w.rev };
    })();
  }
  refund(g, why) { // 對方已擁有／魚種下架：寶石退給送禮的人
    const r = this.db.prepare("UPDATE fv2_gifts SET status='refunded', why=?, claimed_at=? WHERE id=? AND status='sent'").run(why, this.t(), g.id);
    if (r.changes) { const row = this.db.prepare('SELECT * FROM fv2_gifts WHERE id=?').get(g.id); if (row.gems > 0) this.ctx.commerce.ledger(row.from_id, row.gems, 'refund', 'fv2gift-refund:' + g.id); }
  }

  // ---------- 好友頁狀態（紅點＋每位好友的親密度／今天是否已互助、送禮）----------
  state(me) {
    this.need(); const F = this.F, so = this.so, d = this.day();
    const ids = so.friendIds(me);
    const helped = new Set(this.db.prepare('SELECT owner_id FROM social_helps WHERE helper_id=? AND day=?').all(me, d).map((r) => r.owner_id));
    const gifted = new Set(this.db.prepare("SELECT to_id FROM fv2_gifts WHERE from_id=? AND day=? AND kind='free'").all(me, d).map((r) => r.to_id));
    const friends = {}; for (const id of ids) { friends[id] = { ...this.intimInfo(this.intimacy(me, id)), helpedToday: helped.has(id), giftedToday: gifted.has(id) }; }
    const hiddenIds = new Set(ids.filter((id) => so.hidden(id)));
    const helpable = this.on('help') ? ids.filter((id) => !helped.has(id) && !hiddenIds.has(id)).length : 0;
    const gifts = this.on('gifts') ? this.inbox(me) : [];
    const rw = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(reward),0) c FROM social_helps WHERE helper_id=? AND day=? AND reward>0').get(me, d);
    return { enabled: true, features: { help: this.on('help'), intimacy: this.on('intimacy'), gifts: this.on('gifts'), paidGifts: this.on('gifts') && F.gifts.paid.enabled, ladder: !!F.inviteLadder.enabled, rebate: !!F.rebate.enabled },
      day: d, friends, helpable, gifts, incoming: so.unread(me).requests,
      today: { rewardedHelps: rw.n, helpCap: F.help.dailyRewarded, coins: rw.c, coinCap: F.help.dailyCoinCap },
      config: { actions: ACTIONS, help: F.help, intimacy: { thresholds: F.intimacy.thresholds, milestones: F.intimacy.milestones, breedDiscount: F.intimacy.breedDiscount, bondBreedLv: F.intimacy.bondBreedLv, dailyPairCap: F.intimacy.dailyPairCap }, gifts: { freePool: F.gifts.freePool, perSenderDaily: F.gifts.paid.perSenderDaily } } };
  }

  // ---------- 後台 ----------
  adminStats() {
    const d = this.day(), d7 = this.day(this.t() - 6 * DAY), q = (s, ...a) => this.db.prepare(s).get(...a), all = (s, ...a) => this.db.prepare(s).all(...a);
    return { day: d, config: this.F,
      visits: all('SELECT day, COUNT(*) pairs, SUM(n) n, COUNT(DISTINCT visitor_id) visitors, COUNT(DISTINCT owner_id) owners, SUM(friend) friendPairs FROM social_visits WHERE day>=? GROUP BY day ORDER BY day', d7),
      inviteLinks: all('SELECT state, via, COUNT(*) n FROM fv2_invite_links GROUP BY state, via'),
      expired: q("SELECT COUNT(*) n FROM social_friends WHERE status='expired'").n,
      sameIpFriendPairs: q("SELECT COUNT(*) n FROM social_friends f WHERE f.status='accepted' AND EXISTS (SELECT 1 FROM fv2_ips x JOIN fv2_ips y ON y.ip_hash=x.ip_hash AND y.player_id=f.b WHERE x.player_id=f.a)").n,
      bonus: all('SELECT kind, status, COUNT(*) n, COALESCE(SUM(gems),0) gems FROM fv2_bonus GROUP BY kind, status'),
      help2: q('SELECT COUNT(*) n, COALESCE(SUM(helper_coins),0) hc, COALESCE(SUM(owner_coins),0) oc FROM fv2_help WHERE day=?', d),
      gifts: all('SELECT kind, status, COUNT(*) n, COALESCE(SUM(coins),0) coins, COALESCE(SUM(gems),0) gems FROM fv2_gifts WHERE day>=? GROUP BY kind, status', d7),
      topSocialIncome: all(`SELECT pid id, SUM(c) coins FROM (SELECT helper_id pid, helper_coins c FROM fv2_help WHERE day=? UNION ALL SELECT owner_id, owner_coins FROM fv2_help WHERE day=? UNION ALL SELECT to_id, coins FROM fv2_gifts WHERE day=? AND kind='free') GROUP BY pid ORDER BY coins DESC LIMIT 10`, d, d, d) };
  }
}

function mountFriendsV2(app, ctx) {
  const fv = new FriendsV2(ctx); ctx.friendsV2 = fv;
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const lim = new RateLimiter({ windowMs: 60000, max: 40 });
  const L = (req, res, next) => { const c = lim.check('fv' + req.player.id); if (!c.ok) return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試')); next(); };
  const member = (req, res, next) => { if (!req.player.username) return next(new HttpError(403, 'members_only', '好友互動只開放給註冊會員，請先註冊或登入')); next(); };
  const r = express.Router();
  r.use(express.json({ limit: '4kb' })); r.use(ctx.players.auth()); r.use(member); r.use(L);
  r.use((req, res, next) => { fv.touchIp(req.player.id, req.ip); next(); });
  r.get('/state', wrap((req) => fv.state(req.player.id)));
  r.get('/visitors', wrap((req) => { fv.need(); return { visitors: fv.visitors(req.player.id) }; }));
  r.get('/invite', wrap((req) => { fv.need(); fv.sweepLadder(req.player.id); return fv.inviteStatus(req.player.id); }));
  r.post('/help', wrap((req) => fv.help(req.player.id, req.body)));
  r.post('/gift', wrap((req) => { const b = req.body || {}, to = toInt(b.to, 0); return b.item && b.item !== 'free' ? fv.giftPaid(req.player.id, to, clampStr(b.item, 64), b.idempotencyKey) : fv.giftFree(req.player.id, to); }));
  r.get('/catalog', wrap((req) => { fv.need('gifts'); const to = toInt(req.query.to, 0), sv = to ? ctx.social.saveOf(to) : null; return { items: fv.catalog().map((it) => ({ ...it, owned: fv.owns(sv && sv.save, it) })), balance: ctx.commerce.balance(req.player.id) }; }));
  r.post('/gifts/claim', wrap((req) => fv.claim(req.player.id)));
  app.use('/api/social/v2', r);
  const a = express.Router(); a.use(ctx.adminAuth.require()); a.get('/stats', wrap(() => fv.adminStats()));
  app.use('/admin/api/social/v2', a);
  if (ctx.env && ctx.env.NODE_ENV !== 'test') { const tick = () => { try { fv.sweepExpired(); fv.sweepRebates(); fv.sweepLadder(); } catch (e) { console.warn('[friendsv2] sweep', e.message); } }; const h = setInterval(tick, 5 * 60000); h.unref && h.unref(); setTimeout(tick, 15000).unref?.(); }
  return fv;
}

module.exports = { mountFriendsV2, FriendsV2, FV2_DEF, fv2Cfg, migrate };
