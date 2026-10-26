'use strict';
// 🐠 玩家頭像（AVATAR-V1）：頭像＝玩家從「已解鎖」魚種中挑一隻，用遊戲既有的魚種繪圖（preview）畫在圓框裡。
// - 解鎖來源（設定驅動，cfg.avatar.items 可在後台覆寫）：free 新手魚／card 月卡專屬／vip 累積儲值等級／ach 成就與里程碑／sponsor 贊助（即將推出）
// - 月卡魚：買過月卡（未被退款撤銷）就「永久解鎖」；月卡「有效期間」頭像外框才有金冠光環
// - 外框：依累積儲值（新台幣，只計 ecpay／newebpay 已付款訂單；退款訂單狀態為 refunded 不計）none/bronze/silver/gold/diamond
// - 伺服器權威：可用清單在伺服器計算；POST 設定時再驗一次；存在 players.avatar（可為 NULL＝預設新手魚）
// - 美術可替換：item.art（圖片網址）有值時客戶端改用圖片，否則用遊戲內魚種繪圖
const express = require('express');
const { HttpError, RateLimiter, clampStr, parseJSON } = require('./util');

const DEFAULTS = {
  enabled: true,
  defaultId: 'goldfish',
  topupProviders: ['ecpay', 'newebpay'],
  tiers: [
    { key: 'none', name: '一般', minTwd: 0 },
    { key: 'bronze', name: '銅框', minTwd: 1 },
    { key: 'silver', name: '銀框', minTwd: 1000 },
    { key: 'gold', name: '金框', minTwd: 5000 },
    { key: 'diamond', name: '鑽石框', minTwd: 20000 },
  ],
  groups: [
    { key: 'free', name: '🐟 新手魚' },
    { key: 'card', name: '👑 月卡專屬' },
    { key: 'vip', name: '💎 儲值等級' },
    { key: 'ach', name: '🏆 成就' },
    { key: 'sponsor', name: '💖 贊助' },
  ],
  items: [
    { id: 'goldfish', sp: 'goldfish', src: 'free' },
    { id: 'guppy', sp: 'guppy', src: 'free' },
    { id: 'neon', sp: 'neon', src: 'free' },
    { id: 'clown', sp: 'clown', src: 'free' },
    { id: 'card_imperialkoi', sp: 'p_imperialkoi', src: 'card' },
    { id: 'card_phoenixbetta', sp: 'p_phoenixbetta', src: 'card' },
    { id: 'vip_auroratetra', sp: 'p_auroratetra', src: 'vip', tier: 'bronze' },
    { id: 'vip_moonray', sp: 'p_moonray', src: 'vip', tier: 'silver' },
    { id: 'vip_sapphirearowana', sp: 'p_sapphirearowana', src: 'vip', tier: 'gold' },
    { id: 'vip_crystaldragon', sp: 'p_crystaldragon', src: 'vip', tier: 'diamond' },
    { id: 'ach_dex10', sp: 'galaxy', src: 'ach', ach: 'dex10' },
    { id: 'ach_dex20', sp: 'discusred', src: 'ach', ach: 'dex20' },
    { id: 'ach_dex50', sp: 'koitaisho', src: 'ach', found: 50 },
    { id: 'ach_breed10', sp: 'bettahm', src: 'ach', breeds: 10 },
    { id: 'ach_hero10', sp: 'redpiranha', src: 'ach', heroWins: 10 },
    { id: 'sponsor_lantern', sp: 'p_lanternfish', src: 'sponsor', comingSoon: true },
    { id: 'sponsor_coralseahorse', sp: 'p_coralseahorse', src: 'sponsor', comingSoon: true },
  ],
};

function avatarCfg(cfg) {
  const a = (cfg && cfg.avatar && typeof cfg.avatar === 'object') ? cfg.avatar : {};
  const out = { ...DEFAULTS, ...a,
    tiers: Array.isArray(a.tiers) && a.tiers.length ? a.tiers : DEFAULTS.tiers,
    groups: Array.isArray(a.groups) && a.groups.length ? a.groups : DEFAULTS.groups,
    items: Array.isArray(a.items) && a.items.length ? a.items : DEFAULTS.items,
    topupProviders: Array.isArray(a.topupProviders) && a.topupProviders.length ? a.topupProviders : DEFAULTS.topupProviders };
  out.tiers = [...out.tiers].filter((t) => t && t.key).sort((x, y) => (+x.minTwd || 0) - (+y.minTwd || 0));
  out.items = out.items.filter((i) => i && typeof i.id === 'string' && i.id && typeof i.sp === 'string' && i.sp);
  const sc=require('./sponsor').sponsorCfg(cfg||{});
  if(sc.tiers.length)out.items=out.items.filter(i=>i.src!=='sponsor').concat(sc.tiers.map(t=>({id:'sponsor_'+t.id,sp:t.sp,src:'sponsor',sponsorTier:t.id,minTwd:t.priceTwd,comingSoon:!sc.enabled,name:t.name+'・頭像魚'})));
  return out;
}

// 累積儲值 → 外框等級
function tierOf(A, twd) { let t = A.tiers[0]; for (const x of A.tiers) if (twd >= (+x.minTwd || 0)) t = x; return t; }
function nextTier(A, twd) { return A.tiers.find((x) => (+x.minTwd || 0) > twd) || null; }
const fmtN = (n) => Number(n).toLocaleString('en-US');

// 純函式：依玩家統計判斷每個頭像是否解鎖（單元測試直接測這個）
//   st = { member, twd, cardEver, cardActive, found, breeds, heroWins, achGoals: { dex10: 10, ... }, achNames }
function evaluate(A, st, spName = (sp) => sp) {
  const tier = tierOf(A, st.twd || 0), tierIdx = A.tiers.indexOf(tier);
  return A.items.map((i) => {
    let unlocked = false, cond = '';
    if(i.src==='sponsor'){unlocked=!!(st.sponsorUnlocked||[]).includes(i.sponsorTier);cond='累積贊助 NT$'+fmtN(i.minTwd||0)+'（純外觀）';if(i.comingSoon&&!unlocked){cond='即將推出'}}
    else if (i.comingSoon) { unlocked = false; cond = '即將推出'; }
    else if (i.src === 'free') { unlocked = true; cond = '免費'; }
    else if (i.src === 'card') { unlocked = !!st.cardEver; cond = '購買 👑 月卡即永久解鎖'; }
    else if (i.src === 'vip') {
      const need = A.tiers.find((t) => t.key === i.tier) || A.tiers[A.tiers.length - 1];
      unlocked = A.tiers.indexOf(need) <= tierIdx && (st.twd || 0) >= (+need.minTwd || 0);
      cond = `累積儲值 NT$${fmtN(+need.minTwd || 0)}（${need.name}）`;
    } else if (i.src === 'ach') {
      const conds = [];
      let ok = true;
      if (i.ach) { const g = (st.achGoals || {})[i.ach]; const nm = (st.achNames || {})[i.ach] || i.ach; if (g == null) { ok = false; conds.push(`成就「${nm}」`); } else { ok = ok && (st.found || 0) >= g; conds.push(`成就「${nm}」`); } }
      if (i.found) { ok = ok && (st.found || 0) >= i.found; conds.push(`圖鑑收集 ${i.found} 種`); }
      if (i.breeds) { ok = ok && (st.breeds || 0) >= i.breeds; conds.push(`累積繁殖 ${i.breeds} 次`); }
      if (i.heroWins) { ok = ok && (st.heroWins || 0) >= i.heroWins; conds.push(`英雄魚勝利 ${i.heroWins} 場`); }
      if (!conds.length) ok = false;
      unlocked = ok; cond = conds.join('＋');
    } else { unlocked = false; cond = '即將推出'; }
    if (i.cond) cond = String(i.cond);
    // 頭像是會員功能：訪客只能看預設
    if (!st.member && i.src !== 'free') unlocked = false;
    return { id: i.id, sp: i.sp, name: i.name || spName(i.sp), src: i.src, unlocked, cond, comingSoon: !!i.comingSoon&&!unlocked, ...(i.src === 'vip' ? { tier: i.tier } : {}), ...(i.art ? { art: String(i.art) } : {}) };
  });
}

class Avatars {
  constructor(ctx) {
    this.ctx = ctx; this.db = ctx.db;
    this.lim = new RateLimiter({ windowMs: 60000, max: 30 });
    this.limOf = new RateLimiter({ windowMs: 60000, max: 60 });
    migrate(this.db);
  }
  gameCfg() { return (this.ctx.configStore.active() || {}).config || {}; }
  cfg() { return avatarCfg(this.gameCfg()); }
  spName(sp) { const s = (this.gameCfg().species || {})[sp]; return (s && s.name) || sp; }
  twd(pid, A = this.cfg()) {
    const prov = A.topupProviders.map(String);
    const q = `SELECT COALESCE(SUM(amount),0) n FROM orders WHERE player_id=? AND status='paid' AND currency='TWD' AND json_extract(grants,'$.sponsor') IS NULL AND provider IN (${prov.map(() => '?').join(',')})`;
    return this.db.prepare(q).get(pid, ...prov).n || 0;
  }
  card(pid, t = Date.now()) {
    const ever = !!this.db.prepare("SELECT 1 FROM entitlements WHERE player_id=? AND kind='vip' AND revoked_at IS NULL LIMIT 1").get(pid);
    const active = !!this.db.prepare("SELECT 1 FROM entitlements WHERE player_id=? AND kind='vip' AND revoked_at IS NULL AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1").get(pid, t, t);
    return { ever, active };
  }
  stats(pid, { light = false } = {}) {
    const p = this.db.prepare('SELECT id, username, banned_at FROM players WHERE id=?').get(pid);
    const A = this.cfg(), c = this.card(pid);
    const support=require('./sponsor').progress(this.db,pid,this.gameCfg());
    const st = { sponsorUnlocked:support.unlocked,sponsorTier:support.tier, member: !!(p && p.username), twd: this.twd(pid, A), cardEver: c.ever, cardActive: c.active, found: 0, breeds: 0, heroWins: 0, achGoals: {}, achNames: {} };
    if (light) return st;
    try { st.found = Object.keys(parseJSON(this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid).data, {}).found || {}).length; } catch (e) { /* 沒有存檔 */ }
    try { st.breeds = this.db.prepare('SELECT COUNT(*) n FROM breed_uses WHERE player_id=?').get(pid).n; } catch (e) { /* 表不存在 */ }
    try { st.heroWins = (this.db.prepare('SELECT wins FROM heroes WHERE player_id=?').get(pid) || {}).wins || 0; } catch (e) { /* 表不存在 */ }
    try { const n = this.ctx.newbie && this.ctx.newbie.cfg(); for (const a of (n && n.achievements) || []) { st.achGoals[a.id] = +a.found || 0; st.achNames[a.id] = a.name; } } catch (e) { /* 沒有成就設定 */ }
    return st;
  }
  frame(A, st) { const t = tierOf(A, st.twd || 0); return { tier: t.key, tierName: t.name, card: !!st.cardActive, sponsor: st.sponsorTier?{level:st.sponsorTier.level,name:st.sponsorTier.name,badge:st.sponsorTier.badge}:null }; }
  stored(pid) { const r = this.db.prepare('SELECT avatar FROM players WHERE id=?').get(pid); return r ? r.avatar : null; }
  // 目前有效的頭像：存的那個仍然解鎖才用，否則回到預設新手魚
  current(A, items, storedId) {
    const ok = items.find((i) => i.id === storedId && i.unlocked);
    return ok || items.find((i) => i.id === A.defaultId) || items.find((i) => i.unlocked) || null;
  }
  state(pid) {
    const A = this.cfg(), st = this.stats(pid), items = evaluate(A, st, (sp) => this.spName(sp));
    const cur = this.current(A, items, this.stored(pid)), nt = nextTier(A, st.twd);
    return { enabled: A.enabled !== false, member: st.member, current: cur ? cur.id : null, sp: cur ? cur.sp : null, ...(cur && cur.art ? { art: cur.art } : {}),
      frame: this.frame(A, st), twd: st.twd, nextTier: nt ? { key: nt.key, name: nt.name, minTwd: +nt.minTwd || 0, need: Math.max(0, (+nt.minTwd || 0) - st.twd) } : null,
      card: { owned: st.cardEver, active: st.cardActive }, groups: A.groups, items };
  }
  set(pid, id) {
    const A = this.cfg();
    if (A.enabled === false) throw new HttpError(403, 'disabled', '頭像功能暫停中');
    id = clampStr(id, 40);
    const st = this.stats(pid);
    if (!st.member) throw new HttpError(403, 'members_only', '註冊會員才能更換頭像');
    const it = evaluate(A, st, (sp) => this.spName(sp)).find((i) => i.id === id);
    if (!it) throw new HttpError(404, 'unknown_avatar', '找不到這個頭像');
    if (!it.unlocked) throw new HttpError(403, 'locked', it.comingSoon ? '即將推出' : `尚未解鎖：${it.cond}`, { cond: it.cond });
    this.db.prepare('UPDATE players SET avatar=? WHERE id=?').run(id, pid);
    return this.state(pid);
  }
  // 其他玩家（漁港等）顯示用：只回傳魚種、外框、月卡光環；不回傳金額
  publicOf(ids) {
    const A = this.cfg(), out = {};
    for (const pid of ids) {
      const p = this.db.prepare('SELECT id, username, avatar, banned_at, is_demo FROM players WHERE id=?').get(pid);
      if (!p || p.banned_at != null) continue;
      const st = this.stats(pid, { light: true });
      // 成就類（單調遞增）信任設定當下的驗證，避免逐一解析存檔；月卡／儲值魚即時驗證（退款後失效）
      const raw = A.items.find((i) => i.id === p.avatar);
      let it = null;
      if (raw && (!raw.comingSoon||raw.src==='sponsor') && st.member) {
        if (raw.src === 'ach') it = raw; else { const ev = evaluate(A, st).find((i) => i.id === raw.id); if (ev && ev.unlocked) it = raw; }
      }
      if (!it) it = A.items.find((i) => i.id === A.defaultId) || A.items[0];
      out[pid] = { sp: it ? it.sp : null, ...(it && it.art ? { art: String(it.art) } : {}), frame: st.member ? this.frame(A, st) : { tier: A.tiers[0].key, card: false } };
    }
    return out;
  }
}

function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
  if (!cols.has('avatar')) db.exec('ALTER TABLE players ADD COLUMN avatar TEXT');   // 可為 NULL＝預設新手魚（舊行為）
}

function mountAvatar(app, ctx) {
  const av = new Avatars(ctx);
  ctx.avatars = av;
  const r = express.Router();
  const auth = ctx.players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((o) => res.json(o)).catch(next);
  const limit = (L, k) => (req, res, next) => { const c = L.check(k + req.player.id); if (!c.ok) { res.set('Retry-After', String(c.retryAfter)); return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試')); } next(); };
  r.use(express.json({ limit: '2kb' }));
  r.get('/', auth, wrap((req) => av.state(req.player.id)));
  r.post('/', auth, limit(av.lim, 'a'), wrap((req) => av.set(req.player.id, req.body && req.body.id)));
  r.get('/of', auth, limit(av.limOf, 'o'), wrap((req) => {
    const ids = [...new Set(String(req.query.ids || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
    return { avatars: av.publicOf(ids) };
  }));
  app.use('/api/avatar', r);
  return av;
}

module.exports = { mountAvatar, Avatars, avatarCfg, evaluate, tierOf, nextTier, migrate, AVATAR_DEFAULTS: DEFAULTS };
