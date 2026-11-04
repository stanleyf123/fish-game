'use strict';
// v4.1.4：邀請朋友 — 被邀請者註冊（信箱／Google／LINE）＋稍微玩過一下後，邀請人收到獎勵（預設 🪙5,000，寄到 📬 信箱）。
// 防濫用：同一個被邀請者只算一次、不能邀請自己、與邀請人同 IP 不算、每月上限。數值都在設定 invite：{ enabled, rewardKind, rewardQty, monthlyCap, minPlayMin, minFish }
const crypto = require('crypto');
const { HttpError } = require('./util');
const DEF = { enabled: true, rewardKind: 'coins', rewardQty: 5000, monthlyCap: 10, minPlayMin: 5, minFish: 2, inviteeCoins: 5000,
  // 修正：同 IP（同一個家用 Wi-Fi）不再直接拒絕，改成「標記」— 同一個 IP 每月最多 sameIpMonthlyCap 筆已發獎的邀請（不分邀請人）；
  // sameIpRequireIdentity=true 時，被標記的被邀請者另需綁定 Google／LINE 或已驗證信箱
  sameIpPolicy: 'flag', sameIpMonthlyCap: 3, sameIpRequireIdentity: false,
  // 修正：playMeasure='heartbeat' 時用實際遊玩時間（player_daily.play_ms）判定；'wallclock' 為舊規則（建立帳號到最後存檔的時間差）
  playMeasure: 'wallclock' };
// v4.2：被邀請者也得 invite.inviteeCoins（預設 🪙5,000）— 與邀請人同一時間判定、每個被邀請帳號一次；每月上限只限制邀請人
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ipHash = (ip) => (ip ? crypto.createHash('sha256').update('ip:' + String(ip)).digest('hex').slice(0, 32) : null);

class Invite {
  constructor({ db, configStore, players, rewards, baseUrl }) {
    this.db = db; this.cfgStore = configStore; this.players = players; this.rewards = rewards; this.baseUrl = baseUrl || '';
    db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, ip_hash TEXT);
      CREATE TABLE IF NOT EXISTS invites (invitee_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, inviter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, code TEXT NOT NULL,
        created_at INTEGER NOT NULL, ip_hash TEXT, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, rewarded_at INTEGER, reward_kind TEXT, reward_qty INTEGER, reward_id INTEGER);
      CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id, status);`);
    const cols = db.prepare('PRAGMA table_info(invites)').all().map((c) => c.name);
    if (!cols.includes('flag')) db.exec('ALTER TABLE invites ADD COLUMN flag TEXT');
    if (!cols.includes('invitee_reward_id')) db.exec('ALTER TABLE invites ADD COLUMN invitee_reward_id INTEGER; ALTER TABLE invites ADD COLUMN invitee_rewarded_at INTEGER; ALTER TABLE invites ADD COLUMN invitee_qty INTEGER;');
  }
  cfg() { const c = (this.cfgStore.active().config || {}).invite || {}; const o = { ...DEF, ...c }; o.rewardKind = o.rewardKind === 'gems' ? 'gems' : 'coins'; o.rewardQty = Math.max(0, Math.floor(Number(o.rewardQty) || 0)); o.monthlyCap = Math.max(0, Math.floor(Number(o.monthlyCap) || 0)); o.inviteeCoins = Math.max(0, Math.floor(Number(o.inviteeCoins) || 0)); o.sameIpPolicy = o.sameIpPolicy === 'reject' ? 'reject' : 'flag'; o.sameIpMonthlyCap = Math.max(0, Math.floor(Number(o.sameIpMonthlyCap) || 0)); o.sameIpRequireIdentity = o.sameIpRequireIdentity === true; o.playMeasure = o.playMeasure === 'heartbeat' ? 'heartbeat' : 'wallclock'; return o; }
  month(t = Date.now()) { return new Date(t + 8 * 3600e3).toISOString().slice(0, 7); }
  monthStart(t = Date.now()) { const m = this.month(t); return Date.parse(m + '-01T00:00:00+08:00'); }
  codeFor(pid, ip) {
    let r = this.db.prepare('SELECT * FROM invite_codes WHERE player_id=?').get(pid);
    if (!r) {
      for (let i = 0; i < 20 && !r; i++) {
        const code = Array.from(crypto.randomBytes(7), (b) => ALPH[b % ALPH.length]).join('');
        try { this.db.prepare('INSERT INTO invite_codes (player_id, code, created_at, ip_hash) VALUES (?,?,?,?)').run(pid, code, Date.now(), ipHash(ip)); r = { player_id: pid, code }; } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; if (this.db.prepare('SELECT 1 FROM invite_codes WHERE player_id=?').get(pid)) break; }
      }
      r = this.db.prepare('SELECT * FROM invite_codes WHERE player_id=?').get(pid);
    } else if (ip) this.db.prepare('UPDATE invite_codes SET ip_hash=? WHERE player_id=?').run(ipHash(ip), pid);
    return r.code;
  }
  // 新訪客第一次建立時呼叫（code 來自 ?ref=）
  attach(inviteeId, code, ip, created) {
    const c = this.cfg();
    if (!created || !c.enabled || typeof code !== 'string') return null;
    code = code.trim().toUpperCase(); if (!/^[A-Z0-9]{5,12}$/.test(code)) return null;
    const owner = this.db.prepare('SELECT * FROM invite_codes WHERE code=?').get(code); if (!owner) return null;
    let status = 'pending', reason = null, flag = null; const ih = ipHash(ip);
    if (owner.player_id === inviteeId) { status = 'rejected'; reason = 'self'; }
    else if (ih && owner.ip_hash && ih === owner.ip_hash) { if (c.sameIpPolicy === 'reject') { status = 'rejected'; reason = 'same_ip'; } else flag = 'same_ip'; }
    this.db.prepare('INSERT OR IGNORE INTO invites (invitee_id, inviter_id, code, created_at, ip_hash, status, reason, flag) VALUES (?,?,?,?,?,?,?,?)').run(inviteeId, owner.player_id, code, Date.now(), ih, status, reason, flag);
    try { this.players.logEvent(inviteeId, 'invite_attach', { inviter: owner.player_id, status, reason, flag }); } catch (e) { /* 只是紀錄 */ }
    return { inviter: owner.player_id, status, reason, flag };
  }
  // 被邀請者是否符合：已綁定 Google／LINE、玩了一段時間、有魚
  qualified(inv, t = Date.now()) {
    const c = this.cfg(), p = this.players.get(inv.invitee_id); if (!p || !p.username || p.banned_at || !this.strongIdentity(inv.invitee_id)) return false;
    const s = this.db.prepare('SELECT updated_at, fish_count FROM saves WHERE player_id=?').get(inv.invitee_id); if (!s) return false;
    const need = c.minPlayMin * 60000;
    if ((s.fish_count || 0) < c.minFish || t - p.created_at < need) return false;
    if (c.playMeasure === 'heartbeat') return this.playMs(inv.invitee_id) >= need;
    return s.updated_at - p.created_at >= need;
  }
  playMs(pid) { try { return this.db.prepare('SELECT COALESCE(SUM(play_ms),0) ms FROM player_daily WHERE player_id=?').get(pid).ms; } catch (e) { return 0; } }
  // 同 IP 標記的邀請：被邀請者要有 Google／LINE 身分或已驗證信箱（不能只是訪客＋密碼）
  strongIdentity(pid) {
    return !!this.db.prepare("SELECT 1 FROM player_identities WHERE player_id=? AND provider IN ('google','line') LIMIT 1").get(pid);
  }
  // 檢查並發獎（每個被邀請者一次；每月上限）。回傳這次新發出的獎勵
  settle(inviteeId) {
    const inv = this.db.prepare("SELECT * FROM invites WHERE invitee_id=? AND status='pending'").get(inviteeId); if (!inv) return null;
    const c = this.cfg(); if (!c.enabled || !(c.rewardQty > 0 || c.inviteeCoins > 0) || !this.qualified(inv)) return null;
    const inviter = this.players.get(inv.inviter_id); if (!inviter || inviter.banned_at) return null;
    if (inv.flag === 'same_ip') {
      if (c.sameIpRequireIdentity && !this.strongIdentity(inviteeId)) { if (inv.reason !== 'same_ip_identity') this.db.prepare("UPDATE invites SET reason='same_ip_identity' WHERE invitee_id=?").run(inviteeId); return null; }
      // 每個 IP 每月上限：計算同一個 ip_hash 這個月已發獎的邀請（任何邀請人）
      const m = inv.ip_hash ? this.db.prepare("SELECT COUNT(*) n FROM invites WHERE ip_hash=? AND status='rewarded' AND rewarded_at>=?").get(inv.ip_hash, this.monthStart()).n : 0;
      if (m >= c.sameIpMonthlyCap) { if (inv.reason !== 'same_ip_cap') this.db.prepare("UPDATE invites SET reason='same_ip_cap' WHERE invitee_id=?").run(inviteeId); return null; }
    }
    const out = this.db.transaction(() => {
      const cur = this.db.prepare("SELECT status, invitee_reward_id FROM invites WHERE invitee_id=?").get(inviteeId); if (!cur || cur.status !== 'pending') return null;
      const o = {};
      // 被邀請者的獎勵：不受邀請人每月上限影響，每個被邀請帳號只發一次
      if (c.inviteeCoins > 0 && cur.invitee_reward_id == null) {
        const nm = (inviter.nickname || '').trim() || '朋友';
        const rw2 = this.rewards.create({ title: '👥 好友邀請獎勵', body: `你透過「${nm}」的邀請加入了悠游水族箱！送你 🪙${c.inviteeCoins.toLocaleString('en-US')}，一起養魚吧。`, coins: c.inviteeCoins, gems: 0, target: 'player', playerId: inviteeId });
        this.db.prepare('UPDATE invites SET invitee_reward_id=?, invitee_rewarded_at=?, invitee_qty=? WHERE invitee_id=?').run(rw2.id, Date.now(), c.inviteeCoins, inviteeId);
        o.invitee = { kind: 'coins', qty: c.inviteeCoins };
      }
      if (!(c.rewardQty > 0)) return o;
      const n = this.db.prepare("SELECT COUNT(*) n FROM invites WHERE inviter_id=? AND status='rewarded' AND rewarded_at>=?").get(inv.inviter_id, this.monthStart()).n;
      if (n >= c.monthlyCap) { this.db.prepare("UPDATE invites SET reason='monthly_cap' WHERE invitee_id=?").run(inviteeId); return o; }
      const friend = this.players.get(inviteeId), name = (friend && (friend.nickname || '').trim()) || '新朋友';
      const rw = this.rewards.create({ title: '👥 邀請獎勵', body: `你邀請的「${name}」加入了悠游水族箱！謝謝你的分享。`, coins: c.rewardKind === 'coins' ? c.rewardQty : 0, gems: c.rewardKind === 'gems' ? c.rewardQty : 0, target: 'player', playerId: inv.inviter_id });
      this.db.prepare("UPDATE invites SET status='rewarded', reason=NULL, rewarded_at=?, reward_kind=?, reward_qty=?, reward_id=? WHERE invitee_id=?").run(Date.now(), c.rewardKind, c.rewardQty, rw.id, inviteeId);
      o.inviter = { id: inv.inviter_id, kind: c.rewardKind, qty: c.rewardQty };
      return o;
    })();
    if (!out) return null;
    try { if (out.invitee) this.players.logEvent(inviteeId, 'invite_invitee_reward', { inviter: inv.inviter_id, qty: out.invitee.qty }); if (out.inviter) this.players.logEvent(inv.inviter_id, 'invite_reward', { invitee: inviteeId, kind: c.rewardKind, qty: c.rewardQty }); } catch (e) { /* 只是紀錄 */ }
    return out.inviter || out.invitee ? { inviter: out.inviter ? inv.inviter_id : null, kind: c.rewardKind, qty: out.inviter ? c.rewardQty : 0, invitee: out.invitee || null } : null;
  }
  status(pid, ip) {
    const c = this.cfg(), p = this.players.get(pid), member = !!(p && p.username);
    if (member) for (const r of this.db.prepare("SELECT invitee_id FROM invites WHERE inviter_id=? AND status='pending'").all(pid)) this.settle(r.invitee_id);
    const code = member ? this.codeFor(pid, ip) : null;
    const all = this.db.prepare("SELECT status, reward_kind, reward_qty, rewarded_at FROM invites WHERE inviter_id=?").all(pid);
    const ms = this.monthStart(), rewarded = all.filter((r) => r.status === 'rewarded');
    return { enabled: c.enabled, member, code, link: code ? `${this.baseUrl}/?ref=${code}` : null, rewardKind: c.rewardKind, rewardQty: c.rewardQty, inviteeCoins: c.inviteeCoins, monthlyCap: c.monthlyCap, minPlayMin: c.minPlayMin,
      joined: all.filter((r) => r.status !== 'rejected').length, rejected: all.filter((r) => r.status === 'rejected').length, rewarded: rewarded.length, pending: all.filter((r) => r.status === 'pending').length,
      earned: rewarded.filter((r) => r.reward_kind === c.rewardKind).reduce((a, r) => a + (r.reward_qty || 0), 0), thisMonth: rewarded.filter((r) => r.rewarded_at >= ms).length };
  }
}
module.exports = { Invite, INVITE_DEFAULTS: DEF, ipHash };
