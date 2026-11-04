'use strict';
// 🎣 FISHING-V1：釣魚模式（伺服器端）
// - 預設關閉：config.fishing.enabled 必須為 true 才開放；環境變數 FISHING_FORCE_OFF=1 可強制關閉（不用發佈設定）。
// - 每日免費拋竿（台北日期切日）＋ 💎 加購；魚種／尺寸／變種全部由伺服器擲骰（客戶端只負責拉扯小遊戲）。
// - 釣到的魚：放進目前魚缸（grantToSave）、其他魚缸（多魚缸 player_tanks）、收藏庫（fish_storage）或現場賣掉換金幣。
// - 只新增 fishing_* 資料表；不改動任何既有資料表結構。
const express = require('express');
const { HttpError, bad, RateLimiter, randToken } = require('./util');
const { capacityOf, usedSpaceOf, spOf } = require('./anticheat');
const StorageCap = require('./storage-capacity');
const DATA = require('./fishing/data.json');
const FSELL = require('./fishing-sell');   // v11：賣價公式（config.fishing.sell）

const DEF = {
  enabled: false,
  // 每日釣魚次數由「擁有的最好魚簍」決定（2026-10-30）：竹編 3／🪙打氣桶 5／💎黃金活水艙 8；用完可花 💎 重置回滿（不限次數）
  boxCasts: {},                             // 個別覆寫：{ "basket": 3, "bucket": 5, "gold": 8 }
  resetGem: 50,                             // 重置次數 💎（舊欄位：resetGems 沒列到的釣點才用；prices["casts.reset"] 仍可整體覆寫）
  resetGems: { shallow: 50, reef: 65, night: 80, deep: 150 },   // v11：依「目前所在釣點」的重置價格（後台可改）
  packs: {},                                // v11：每包次數覆寫 { "bait.star": 5 }
  exRate: {},                               // v11：活動餌專屬魚機率覆寫 { "moon": 0.14 }
  missionsEnabled: true,                    // 每日釣魚任務開關
  treasurePct: DATA.cfg.treasure, bottlePct: DATA.cfg.bottle,
  albinoPct: DATA.cfg.albinoPct, goldPct: DATA.cfg.goldPct, giantPct: DATA.cfg.giantPct,
  chestGemChance: 0.35, chestGems: [5, 15], chestCoins: [300, 1200], bottleCoins: [50, 200],
  perfectMaxPerDay: 30,                     // 完美拋竿（加成）每日上限
  castTtlSec: 240,                          // 拋竿後幾秒內必須回報結果，逾時算脫鉤
  pityN: 100,                               // 限定餌保底：同一種限定餌連續 N 竿沒遇到專屬魚 → 第 N 竿必定是專屬魚
  specialGrowth: 160,                       // 特殊寵物（限定餌專屬魚）放進魚缸直接是成年型態（光環／流光完整顯示）
  autoSpecies: true,                        // 啟動時自動把缺少的釣魚魚種加進遊戲設定 config.species
  minFightSec: [2, 3, 3.5, 4],            // 依稀有度：最短拉扯時間（秒），過快視為作弊
  catchGrowth: [60, 60, 60, 60],            // 放入魚缸時的成長值（0 幼魚／60 亞成／160 成年）
  sellMult: 1,                              // 現場賣魚金幣倍率
  priceMult: { coin: 1, gem: 1 },           // 釣具價格倍率
  prices: {},                               // 個別覆寫：{ "rod.dragon": 400 }
  spots: {},                                // 個別覆寫：{ "deep": { "lv": 10, "unlockGem": 300 } }
  leaderboardSize: 50,
  flagSuccessRate: 0.95, flagMinCasts: 20,
};
const SLOTS = Object.keys(DATA.gear);
const CHARS = DATA.chars || {}, CHAR_FREE = Object.keys(CHARS).filter((k) => CHARS[k].cur === 'free'), CHAR_DEF = CHAR_FREE[0] || null;
const PRED = new Set(DATA.PRED);
const ADDON = require('./fishing/species-addon.json');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// 與客戶端 core.js seeded() / extra.js wx() 相同：天氣由「台北整點＋釣點」決定，雙方算出來一樣
function seeded(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const tpeHour = (now) => new Date(now + 8 * 3600e3).getUTCHours();
function wxKind(now, spotId) { const x = seeded('wx' + new Date(now + 8 * 3600e3).toISOString().slice(0, 13) + spotId)(); return x < .5 ? 'clear' : x < .68 ? 'cloud' : x < .86 ? 'rain' : 'wind'; }
// 限定餌條件：night＝夜釣點或台北 18:00–06:00；rain＝該釣點目前下雨；spot:X＝在指定釣點
function exOK(ex, spotId, spot, now) {
  if (!ex) return false; const c = ex.c;
  if (!c) return true;   // 2026-10-30：限定餌改成不限時間／天氣／釣點（沒有 c 就一律成立）
  if (c === 'night') { const h = tpeHour(now); return !!(spot && spot.night) || h >= 18 || h < 6; }
  if (c === 'rain') return wxKind(now, spotId) === 'rain';
  if (/^spot:/.test(c)) return spotId === c.slice(5);
  return false;
}
const xpNeed = (lv) => Math.round(120 * Math.pow(lv, 1.45));
const KEY_RE = /^fi_[A-Za-z0-9_-]{12,80}$/;
const fail = (status, code, msg, extra) => { throw new HttpError(status, code, msg, extra); };
const weekOf = (day) => { const d = new Date(day + 'T00:00:00Z'), w = (d.getUTCDay() + 6) % 7; return new Date(d - w * 86400000).toISOString().slice(0, 10); };
const freshProfile = () => ({ v: 1, xp: 0, lv: 1, own: Object.fromEntries(SLOTS.filter((k) => k !== 'bait').map((k) => [k, { [Object.keys(DATA.gear[k])[0]]: 1 }])), eq: Object.fromEntries(SLOTS.map((k) => [k, Object.keys(DATA.gear[k])[0]])), baits: {}, unlocked: { shallow: 1 }, chars: Object.fromEntries(CHAR_FREE.map((k) => [k, 1])), char: CHAR_DEF, stats: { casts: 0, caught: 0, lost: 0, kg: 0 } });

class Fishing {
  constructor(ctx) {
    this.ctx = ctx; this.db = ctx.db; this.players = ctx.players; this.commerce = ctx.commerce; this.now = () => Date.now();
    this.db.exec(Fishing.SCHEMA);
    // v11：每竿記下當時的裝備（後台玩家紀錄用）；後台補發紀錄表
    try { const cols = new Set(this.db.prepare('PRAGMA table_info(fishing_casts)').all().map((c) => c.name)); if (!cols.has('gear')) this.db.exec('ALTER TABLE fishing_casts ADD COLUMN gear TEXT'); } catch (e) { console.error('[fishing] gear column', e.message); }
    this.db.exec('CREATE TABLE IF NOT EXISTS fishing_admin_grants(id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, admin TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL, reason TEXT NOT NULL, mail_id INTEGER, detail TEXT, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_fishing_admin_grants_player ON fishing_admin_grants(player_id, created_at);');
  }
  cfg() { const c = (this.ctx.configStore.active().config || {}).fishing || {}; return { ...DEF, ...c, priceMult: { ...DEF.priceMult, ...(c.priceMult || {}) }, prices: c.prices || {}, packs: c.packs || {}, exRate: c.exRate || {}, boxCasts: c.boxCasts || {} }; }
  enabled() { return this.cfg().enabled === true && String((this.ctx.env || {}).FISHING_FORCE_OFF || '') !== '1'; }
  guard() { if (!this.enabled()) fail(403, 'fishing_disabled', '釣魚模式尚未開放'); this.autoSpecies(); }
  // 釣魚模式「開啟後」才把缺的魚種補進遊戲設定（每個 process 只做一次；關閉時完全不動設定）
  autoSpecies() {
    if (this._autoDone) return; this._autoDone = true;
    try { const n = this.ensureSpecies(); if (n) console.log(`[fishing] 已自動新增 ${n} 種釣魚魚種到遊戲設定`); } catch (e) { console.error('[fishing] ensureSpecies 失敗（魚種沒有加入，釣到會自動賣掉）：', e.message); }
  }
  day(t = this.now()) { return this.players.day(t); }
  spot(id) { const s = DATA.spots[id]; if (!s) return null; return { ...s, ...((this.cfg().spots || {})[id] || {}) }; }
  item(slot, id) {
    const g = DATA.gear[slot] && DATA.gear[slot][id]; if (!g) return null; const c = this.cfg();
    const ov = c.prices[slot + '.' + id], base = ov != null ? ov : Math.round(g.price * (c.priceMult[g.cur] != null ? c.priceMult[g.cur] : 1));
    const pk = c.packs[slot + '.' + id];
    return { ...g, price: g.cur === 'free' ? 0 : Math.max(0, Math.round(base)), ...(g.pack && Number.isInteger(pk) && pk >= 1 ? { pack: pk } : {}) };
  }
  charItem(id) {
    const ch = CHARS[id]; if (!ch) return null; const c = this.cfg();
    const ov = c.prices['char.' + id], base = ov != null ? ov : Math.round(ch.price * (c.priceMult[ch.cur] != null ? c.priceMult[ch.cur] : 1));
    return { ...ch, price: ch.cur === 'free' || ch.cur === 'unlock' ? 0 : Math.max(0, Math.round(base)) };
  }
  // 隱藏大魔王：只能靠成就解鎖（集滿其他釣手＋釣到傳說/限定魚），伺服器端驗證
  bossProgress(pid, p) {
    const others = Object.keys(CHARS).filter((k) => CHARS[k].cur !== 'unlock'), have = others.filter((k) => p.chars[k]).length;
    const normalLeg = !!this.db.prepare('SELECT 1 FROM fishing_catches WHERE player_id=? AND rarity>=2 LIMIT 1').get(pid);
    // 比賽魚獲成功收線後也算傳說／限定；未安裝比賽表的舊版本仍保留一般釣魚判斷。
    const contestTables = !normalLeg && this.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('fishing_contests221','fishing_contest_casts221')").get().n === 2;
    // 以 contest_id + player_id 使用既有 contest221_player 索引，不掃描全體玩家的拋竿。
    const contestLeg = contestTables && !!this.db.prepare("SELECT 1 FROM fishing_contest_casts221 WHERE contest_id IN (SELECT id FROM fishing_contests221) AND player_id=? AND status='caught' AND CASE WHEN json_valid(outcome) THEN json_extract(outcome,'$.r') END IN (2,3) LIMIT 1").get(pid);
    const leg = normalLeg || contestLeg;
    return { have, need: others.length, leg, ok: have === others.length && leg };
  }
  // 每日次數上限＝擁有的魚簍中最高的那個（不是看裝備中的）；買到更好的魚簍當天立即補上差額
  maxCasts(p) {
    const c = this.cfg(), own = Object.assign({}, (p.own && p.own.box) || {}, { [Object.keys(DATA.gear.box)[0]]: 1 });
    return Math.max(...Object.keys(own).filter((id) => DATA.gear.box[id]).map((id) => (c.boxCasts[id] != null ? c.boxCasts[id] : DATA.gear.box[id].casts) || 0));
  }
  // v11：重置價格看「目前所在的釣點」（resetGems[spot]）；沒設定的釣點用 prices['casts.reset'] → resetGem
  resetGem(spotId) { const c = this.cfg(), raw = ((this.ctx.configStore.active().config || {}).fishing || {}).resetGems || {}, ov = c.prices['casts.reset'];
    const v = spotId && raw[spotId] != null ? raw[spotId] : ov != null ? ov : spotId && DEF.resetGems[spotId] != null ? DEF.resetGems[spotId] : c.resetGem != null ? c.resetGem : 50;   // 後台設定的釣點價格 → 舊的整體覆寫 → 預設釣點價格
    return Math.max(0, Math.round(v)); }
  // v11.1：重置價格＝今天（台北日）有拋竿過的釣點中「最貴」的那個；今天還沒拋過才看目前釣點（防止跑去便宜釣點重置）
  resetGemToday(pid, p, want, t = this.now()) { const rows = this.db.prepare('SELECT DISTINCT spot FROM fishing_casts WHERE player_id=? AND day=?').all(pid, this.day(t)).filter((r) => this.spot(r.spot));
    if (!rows.length) return { gems: this.resetGem(this.curSpot(pid, p, want)), spot: this.curSpot(pid, p, want) };
    let best = null; for (const r of rows) { const g = this.resetGem(r.spot); if (!best || g > best.gems) best = { gems: g, spot: r.spot }; } return best; }
  resetGemsAll() { return Object.fromEntries(Object.keys(DATA.spots).map((id) => [id, this.resetGem(id)])); }
  // 玩家目前所在釣點：client 送來且已解鎖 → 用它；否則看最後一竿的釣點；都沒有就第一個釣點
  curSpot(pid, p, want) { if (want && this.spot(want) && this.spotOpen(p, want)) return want; const r = this.db.prepare('SELECT spot FROM fishing_casts WHERE player_id=? ORDER BY created_at DESC LIMIT 1').get(pid); return r && this.spot(r.spot) ? r.spot : Object.keys(DATA.spots)[0]; }
  castsLeft(p, d) { return Math.max(0, this.maxCasts(p) + d.extra - d.used); }
  charB(p, k) { const ch = CHARS[p.char]; return (ch && ch.bonus && ch.bonus[k]) || 0; }
  gear(p, slot) { return DATA.gear[slot][p.eq[slot]] || Object.values(DATA.gear[slot])[0]; }

  profile(pid) {
    const r = this.db.prepare('SELECT data FROM fishing_profile WHERE player_id=?').get(pid);
    const p = r ? JSON.parse(r.data) : freshProfile();
    for (const k of SLOTS) if (!DATA.gear[k][p.eq[k]]) p.eq[k] = Object.keys(DATA.gear[k])[0];
    // 釣手角色（存在 profile JSON，舊資料自動補上免費角色；不需要改表）
    p.chars = Object.fromEntries(Object.keys(p.chars || {}).filter((k) => CHARS[k]).map((k) => [k, 1]));
    for (const k of CHAR_FREE) p.chars[k] = 1;
    if (!CHARS[p.char] || !p.chars[p.char]) p.char = CHAR_DEF;
    return p;
  }
  saveProfile(pid, p) { this.db.prepare('INSERT INTO fishing_profile(player_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(pid, JSON.stringify(p), this.now()); }
  daily(pid, d = this.day()) { return this.db.prepare('SELECT * FROM fishing_daily WHERE player_id=? AND day=?').get(pid, d) || { player_id: pid, day: d, used: 0, extra: 0, perfect: 0 }; }
  saveDaily(r) { this.db.prepare('INSERT INTO fishing_daily(player_id,day,used,extra,perfect) VALUES(?,?,?,?,?) ON CONFLICT(player_id,day) DO UPDATE SET used=excluded.used,extra=excluded.extra,perfect=excluded.perfect').run(r.player_id, r.day, r.used, r.extra, r.perfect); }

  // 冪等：同一把 key 重送只回傳第一次的結果
  once(pid, key, body, fn) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) fail(400, 'invalid_request', '請重新操作');
    const req = JSON.stringify({ ...body, key: undefined, rev: undefined });
    const prior = this.db.prepare('SELECT * FROM fishing_ops WHERE player_id=? AND op_key=?').get(pid, key);
    if (prior) { if (prior.request !== req) fail(409, 'request_conflict', '操作內容已變更'); return { ...JSON.parse(prior.receipt), reused: true }; }
    const out = fn();
    this.db.prepare('INSERT INTO fishing_ops(player_id,op_key,request,receipt,created_at) VALUES(?,?,?,?,?)').run(pid, key, req, JSON.stringify(out), this.now());
    return out;
  }

  status(pid) {
    const c = this.cfg(), p = this.profile(pid), d = this.daily(pid), t = this.now();
    const pending = this.db.prepare("SELECT id,spot,outcome,created_at FROM fishing_casts WHERE player_id=? AND status='pending' AND created_at>?").get(pid, t - c.castTtlSec * 1000);
    const row = this.players.getSave(pid);
    return {
      enabled: this.enabled(), day: d.day, max: this.maxCasts(p), free: this.maxCasts(p), used: d.used, extra: d.extra, left: this.castsLeft(p, d), resetGem: this.resetGemToday(pid, p).gems, todaySpots: this.db.prepare('SELECT DISTINCT spot FROM fishing_casts WHERE player_id=? AND day=?').all(pid, d.day).map((r) => r.spot), resetGems: this.resetGemsAll(), sell: FSELL.sellPublic(this.ctx.configStore.active().config), missionsOn: c.missionsEnabled !== false,
      perfectLeft: Math.max(0, c.perfectMaxPerDay - d.perfect), pityN: c.pityN || 100,
      profile: p, xpNeed: xpNeed(p.lv), coins: row.save ? row.save.coins || 0 : 0, rev: row.rev, balance: this.commerce.balance(pid),
      spots: Object.fromEntries(Object.keys(DATA.spots).map((id) => { const s = this.spot(id); return [id, { name: s.name, lv: s.lv, unlockGem: s.unlockGem, open: this.spotOpen(p, id) }]; })),
      shop: Object.fromEntries(SLOTS.map((k) => [k, Object.fromEntries(Object.keys(DATA.gear[k]).map((id) => { const g = this.item(k, id); return [id, { cur: g.cur, price: g.price, pack: g.pack, ...(g.casts ? { casts: this.cfg().boxCasts[id] != null ? this.cfg().boxCasts[id] : g.casts } : {}), ...(g.legacy ? { legacy: 1 } : {}) }]; }))])),
      chars: Object.fromEntries(Object.keys(CHARS).map((id) => { const g = this.charItem(id); return [id, { name: g.name, cur: g.cur, price: g.price, bonus: g.bonus, ...(g.hidden ? { hidden: 1, req: g.req } : {}) }]; })),
      boss: this.bossProgress(pid, p),
      pending: pending ? { castId: pending.id, spot: pending.spot, outcome: this.publicOutcome(JSON.parse(pending.outcome)) } : null,
      tournament: this.tourPublic(pid),
      basket: this.basketList(pid),
    };
  }
  // 所有釣得到的魚都要能放進魚缸：把遊戲設定裡「還沒有」的釣魚魚種加進 config.species（新版本，可在後台回復；已存在的不覆寫）
  ensureSpecies() {
    if (this.cfg().autoSpecies === false) return 0;
    const cur = this.ctx.configStore.active().config, have = cur.species || {}, add = {};
    for (const id of Object.keys(DATA.species)) if (!have[id] && ADDON.species[id]) add[id] = ADDON.species[id];
    for (const id of Object.values(DATA.tankMap || {})) if (!have[id] && ADDON.species[id]) add[id] = ADDON.species[id];   // FSV1：釣魚限定野生個體 fs_*
    const n = Object.keys(add).length; if (!n) return 0;
    const cfg = JSON.parse(JSON.stringify(cur)); cfg.species = Object.assign({}, cfg.species, add);
    this.ctx.configStore.save(cfg, `🎣 釣魚模式：自動新增 ${n} 種釣魚魚種（${Object.keys(add).join(', ').slice(0, 120)}）`, 'system:fishing');
    return n;
  }
  spotOpen(p, id) { const s = this.spot(id); return !!s && (p.lv >= s.lv || !!p.unlocked[id]); }

  // 伺服器擲骰（由 fishing/v2 core.js rollOutcome 移植，數值相同）
  roll(p, spotId, perfect) {
    const c = this.cfg(), sp = this.spot(spotId), b = this.gear(p, 'bait'), rod = this.gear(p, 'rod'), line = this.gear(p, 'line');
    // 限定餌保底：計數存在 profile.pity[餌]，第 pityN 竿必定是專屬魚（不會變成寶箱／瓶子）
    const bid = p.eq.bait, exb = !!(b.ex && DATA.species[b.ex.sp]); p.pity = p.pity || {};
    const forced = exb && (p.pity[bid] || 0) >= (c.pityN || 100) - 1;
    const r0 = forced ? 100 : Math.random() * 100;
    if (r0 < c.treasurePct) { if (exb) p.pity[bid] = (p.pity[bid] || 0) + 1; return { kind: 'chest', r: 1, S: .55, pool: .35, taps: 7, nib: rint(0, 1), cm: 0, wait: 1 }; }
    if (r0 < c.treasurePct + c.bottlePct) { if (exb) p.pity[bid] = (p.pity[bid] || 0) + 1; return { kind: 'bottle', r: 0, S: .4, pool: .25, taps: 5, nib: rint(0, 1), cm: 0, wait: 1 }; }
    const pf = perfect ? [1.1, 1.15] : [1, 1], st = (line.stealth || 1) > 1.2 ? 1.1 : 1;
    const cr = 1 + this.charB(p, 'rare'), w = [sp.w[0], sp.w[1] * b.rare * rod.luck * pf[0] * st * cr, sp.w[2] * b.leg * rod.luck * pf[1] * cr, b.lim ? sp.w[3] * b.lim * cr : 0];
    let x = Math.random() * w.reduce((a, v) => a + v, 0), r = 0; for (; r < 3; r++) { if (x < w[r]) break; x -= w[r]; }
    const list = sp.pool[r] && sp.pool[r].length ? sp.pool[r] : sp.pool[0], ws = list.map((id) => (PRED.has(id) ? b.pred : 1));
    let y = Math.random() * ws.reduce((a, v) => a + v, 0), id = list[0]; for (let i = 0; i < list.length; i++) { if (y < ws[i]) { id = list[i]; break; } y -= ws[i]; }
    // 限定餌：條件符合時有機率遇到專屬魚（只能靠這個餌拿到）
    const exP = typeof c.exRate[bid] === 'number' ? clamp(c.exRate[bid], 0, 1) : b.ex && b.ex.p, ex = exb && (forced || (exOK(b.ex, spotId, sp, this.now()) && Math.random() < exP)); if (ex) { id = b.ex.sp; r = 3; } else if (exb) p.pity[bid] = (p.pity[bid] || 0) + 1;
    const info = DATA.species[id];
    let f = clamp(1 + gauss() * .16, .62, 1.38), giant = false;
    if (Math.random() * 100 < c.giantPct) { f = rnd(1.35, 1.7); giant = true; }
    f *= b.size; const cm = Math.round(info.cm * f * 10) / 10;
    let variant = null; const vr = Math.random() * 100;
    if (b.gold && vr < c.goldPct * b.gold) variant = 'gold'; else if (vr < c.goldPct * (b.gold || 0) + c.albinoPct * b.albino) variant = 'albino';
    const kg = Math.round((DATA.WK[info.body] || .013) * cm * cm * cm / 1000 * (1 + this.charB(p, 'kg')) * 1000) / 1000;
    const St = ([.6, .85, 1.08, 1.22][r] + Math.min(.5, Math.log10(kg + 1) * .18)) * sp.diff * (giant ? 1.12 : 1) * (variant === 'gold' ? 1.08 : 1);
    const pool = [.6, .85, 1.2, 1.4][r] + Math.log10(kg + 1) * .15 + (giant ? .25 : 0);
    const taps = Math.round(([6, 9, 12, 15][r] + Math.min(5, Math.log10(kg + 1) * 2.5)) * (giant ? 1.15 : 1));
    const bf = sp.salt ? b.salt : b.fresh, wait = bf > 1.1 ? .75 : bf < .85 ? 1.45 : 1;
    const o = { kind: 'fish', id, r, cm, kg, ratio: Math.round(cm / info.cm * 1000) / 1000, variant, giant, S: clamp(St, .45, 2.1), pool, dart: [.12, .2, .28, .32][r], taps, nib: rint(0, 1 + Math.min(2, r)), wait };
    const ab = rod.ab || {};
    if (ex) { o.ex = 1; if (forced) o.pity = 1; }
    if (ab.k === 'guard' && perfect) o.calm = ab.sec || 3;                                  // 彩虹鯨靈竿：完美拋竿 → 拉扯開頭安撫
    if (ab.k === 'double' && r === 0 && Math.random() < (ab.p || .08)) o.dbl = this.rollSmall(p, sp, b);   // 珊瑚星輝竿：普通魚 8% 雙魚
    return o;
  }
  rollSmall(p, sp, b) {
    const list = sp.pool[0], id = list[Math.floor(Math.random() * list.length)], info = DATA.species[id];
    const cm = Math.round(info.cm * clamp(1 + gauss() * .16, .62, 1.38) * b.size * 10) / 10;
    const kg = Math.round((DATA.WK[info.body] || .013) * cm * cm * cm / 1000 * (1 + this.charB(p, 'kg')) * 1000) / 1000;
    return { kind: 'fish', id, r: 0, cm, kg, ratio: Math.round(cm / info.cm * 1000) / 1000, variant: null, giant: false };
  }
  publicOutcome(o) { return o; }   // 結果本來就由伺服器決定；客戶端需要知道魚種／力量才能演出拉扯
  // v11：共用公式（fishing-sell.js）；金幣加成＝服裝＋釣手，再乘魚簍 keep 與 sellMult
  sellPrice(p, o) {
    const keep = this.gear(p, 'box').keep || 1, wear = (this.gear(p, 'wear').coin || 0) + this.charB(p, 'coin');
    return FSELL.fishSell(this.ctx.configStore.active().config, o, wear, keep * (this.cfg().sellMult != null ? this.cfg().sellMult : 1));
  }
  points(o) { return Math.round(100 * (o.ratio || 1) * [1, 2, 4, 8][o.r] * (o.variant === 'gold' ? 3 : o.variant === 'albino' ? 1.6 : 1) * (o.giant ? 1.3 : 1)); }

  cast(pid, body) {
    this.guard();
    return this.db.transaction(() => this.once(pid, body.key, body, () => {
      const c = this.cfg(), t = this.now(), p = this.profile(pid), d = this.daily(pid, this.day(t));
      const spotId = String(body.spot || ''); if (!this.spot(spotId)) fail(400, 'spot', '釣點不存在');
      if (!this.spotOpen(p, spotId)) fail(403, 'spot_locked', '釣點尚未解鎖');
      if (!this.players.getSave(pid).save) fail(409, 'no_save', '請先同步魚缸');
      // 逾時未回報的拋竿 → 算脫鉤
      this.db.prepare("UPDATE fishing_casts SET status='expired',resolved_at=? WHERE player_id=? AND status='pending' AND created_at<=?").run(t, pid, t - c.castTtlSec * 1000);
      if (this.db.prepare("SELECT 1 FROM fishing_casts WHERE player_id=? AND status='pending'").get(pid)) fail(409, 'cast_pending', '上一竿還沒收線');
      if (this.castsLeft(p, d) <= 0) fail(402, 'no_casts', '今天次數用完了', { resetGem: this.resetGemToday(pid, p, spotId, t).gems, max: this.maxCasts(p) });
      let perfect = body.perfect === true && d.perfect < c.perfectMaxPerDay;
      if (perfect) d.perfect++;
      d.used++; this.saveDaily(d);
      const bait = p.eq.bait;
      if (bait !== Object.keys(DATA.gear.bait)[0]) { p.baits[bait] = Math.max(0, (p.baits[bait] || 0) - 1); }
      const o = this.roll(p, spotId, perfect);
      if (bait !== Object.keys(DATA.gear.bait)[0] && !p.baits[bait]) p.eq.bait = Object.keys(DATA.gear.bait)[0];
      p.stats.casts++; this.saveProfile(pid, p);
      const id = 'c' + randToken(9).replace(/[-_]/g, 'x');
      const gearSnap = JSON.stringify({ ...Object.fromEntries(SLOTS.filter((k) => k !== 'bait').map((k) => [k, p.eq[k]])), char: p.char || null });
      this.db.prepare('INSERT INTO fishing_casts(id,player_id,day,spot,bait,perfect,outcome,status,created_at,gear) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, pid, d.day, spotId, bait, perfect ? 1 : 0, JSON.stringify(o), 'pending', t, gearSnap);
      return { ok: true, castId: id, perfect, outcome: this.publicOutcome(o), left: this.castsLeft(p, d), expiresAt: t + c.castTtlSec * 1000 };
    }))();
  }

  makeFish(cfg, sp, growth, o, spotId) {
    const s = cfg.species[sp], names = cfg.names && cfg.names.length ? cfg.names : ['魚'];
    return { id: 'm' + randToken(6).replace(/[-_]/g, 'x'), sp, name: names[Math.floor(Math.random() * names.length)], hue: ((((s.look && s.look.hue) || 0) + (Math.random() * 16 - 8)) + 360) % 360, size: 1, growth, full: cfg.hunger.offspringFullness, health: 100, cd: 0, coinT: 10, seed: Math.floor(Math.random() * 1e5), caught: { t: Date.now(), cm: o.cm, kg: o.kg, r: o.r, v: o.variant || undefined, g: o.giant ? 1 : undefined, spot: spotId } };
  }
  habitatReason(cfg, s, save) {
    const own = (save.gear && save.gear.own) || {}, GE = (cfg.aquascape && cfg.aquascape.gear) || {}, h = s.habitat || {}, ocean = Object.keys(own).reduce((m, k) => Math.max(m, (GE[k] && GE[k].ocean) || 0), 0);
    if (h.gear && !own[h.gear]) return 'habitat_missing';
    if (h.ocean && ocean < h.ocean) return 'habitat_missing';
    if ((s.minTankLevel || 0) > ((save.up && save.up.cap) || 0)) return 'tank_too_small';
    return null;
  }
  // 放魚：tank（目前魚缸）/ slot:N（多魚缸）/ storage（收藏庫）/ sell。放不下時依序退到 收藏庫 → 賣掉，並回報實際去處。
  // FSV1：釣到的魚放進魚缸／收藏庫時一律變成釣魚限定 fs_<id>（魚店魚種不會再出現在釣魚魚獲裡）；設定裡還沒有 fs_ 時退回原 id
  tankSp(cfg, id) { const m = (DATA.tankMap || {})[id]; return m && spOf(cfg, m) ? m : id; }
  deliver(pid, p, o, dest, spotId, t) {
    const cfg = this.ctx.configStore.active().config, c = this.cfg(), tsp = this.tankSp(cfg, o.id), s = spOf(cfg, tsp), growth = s && s.specialPet && c.specialGrowth ? c.specialGrowth : c.catchGrowth[o.r] != null ? c.catchGrowth[o.r] : 60;
    const sellOut = (why) => { const coins = this.sellPrice(p, o), g = this.players.grantToSave(pid, { coins }); return { dest: 'sell', coins, reason: why, save: g.save, rev: g.rev }; };
    if (!s || dest === 'sell') return sellOut(!s ? 'species_not_in_game' : null);
    const row = this.players.getSave(pid), save = row.save, notes = [];
    save.fish = save.fish || []; save.up = save.up || { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] };
    const markFound = (sv) => { sv.found = sv.found || {}; sv.found[tsp] = 1; };
    if (dest === 'tank') {
      const why = this.habitatReason(cfg, s, save), fish = this.makeFish(cfg, tsp, growth, o, spotId);
      if (!why && save.fish.length < 500 && usedSpaceOf(cfg, [...save.fish, fish]) <= capacityOf(cfg, save.up.cap || 0, save) + 1e-9) {
        save.fish.push(fish); markFound(save); if (this.ctx.multiTanks) save._tankId = this.ctx.multiTanks.active(pid);
        this.players.writeSaveRow(pid, save, row.rev + 1, t, false); return { dest: 'tank', fish, save, rev: row.rev + 1 };
      }
      notes.push(why || 'tank_full'); dest = 'storage';
    }
    const m = /^slot:([1-3])$/.exec(dest || '');
    if (m) {
      const mt = this.ctx.multiTanks, slot = Number(m[1]);
      const r = mt && slot !== mt.active(pid) ? mt.rows(pid).find((x) => x.slot === slot && x.data) : null;
      if (!mt || (mt && slot === mt.active(pid))) { dest = 'tank'; return this.deliver(pid, p, o, 'tank', spotId, t); }
      if (r) {
        const target = JSON.parse(r.data), fish = this.makeFish(cfg, tsp, growth, o, spotId), why = this.habitatReason(cfg, s, target);
        target.fish = target.fish || [];
        if (!why && target.fish.length < 500 && usedSpaceOf(cfg, [...target.fish, fish]) <= capacityOf(cfg, (target.up && target.up.cap) || 0, target) + 1e-9) {
          target.fish.push(fish);
          this.db.prepare('UPDATE player_tanks SET data=?,version=version+1,updated_at=? WHERE player_id=? AND slot=?').run(JSON.stringify(target), t, pid, slot);
          markFound(save); this.players.writeSaveRow(pid, save, row.rev + 1, t, false);
          return { dest: 'slot:' + slot, fish, save, rev: row.rev + 1 };
        }
        notes.push(why || 'tank_full');
      } else notes.push('slot_locked');
      dest = 'storage';
    }
    if (dest === 'storage') {
      const cap = StorageCap.capacity(this.db, pid);
      if (StorageCap.used(this.db, pid) < cap) {
        const fish = this.makeFish(cfg, tsp, growth, o, spotId);
        this.db.prepare('INSERT INTO fish_storage VALUES(?,?,?,?)').run(pid, fish.id, JSON.stringify(fish), t);
        markFound(save); this.players.writeSaveRow(pid, save, row.rev + 1, t, false);
        return { dest: 'storage', fish, save, rev: row.rev + 1, reason: notes[0] };
      }
      notes.push('storage_full');
    } else if (!m) fail(400, 'dest', '請選擇放魚的位置');
    return sellOut(notes.join(','));
  }

  resolve(pid, body) {
    this.guard();
    const out = this.resolveTx(pid, body);
    if (out.error) fail(out.error[0], out.error[1], out.error[2]);
    // FEEDBACK201: settlement committed; discovery sync must never make a successful catch fail.
    if(out.result==='caught')try{this.ctx.activityTracks?.observeSave(pid,this.players.getSave(pid).save||{})}catch(e){console.error('[fishing-activity]',e.message)}   // 拒絕紀錄已寫入（交易已提交），再回錯誤
    return out;
  }
  resolveTx(pid, body) {
    return this.db.transaction(() => this.once(pid, body.key, body, () => {
      const c = this.cfg(), t = this.now(), cast = this.db.prepare('SELECT * FROM fishing_casts WHERE id=? AND player_id=?').get(String(body.castId || ''), pid);
      if (!cast) fail(404, 'cast', '找不到這一竿');
      if (cast.status !== 'pending') fail(409, 'cast_done', '這一竿已經結束');
      const o = JSON.parse(cast.outcome), p = this.profile(pid), age = (t - cast.created_at) / 1000;
      if (age > c.castTtlSec) { this.db.prepare("UPDATE fishing_casts SET status='expired',resolved_at=? WHERE id=?").run(t, cast.id); return { ok: false, error: [409, 'cast_expired', '魚已經跑掉了'] }; }
      const caught = body.result === 'caught';
      if (!caught) {
        this.db.prepare("UPDATE fishing_casts SET status='lost',resolved_at=? WHERE id=?").run(t, cast.id);
        p.stats.lost++; this.saveProfile(pid, p); return { ok: true, result: 'lost' };
      }
      let minSec = o.kind === 'fish' ? c.minFightSec[o.r] + Math.min(3, Math.log10((o.kg || 0) + 1)) : 1.5;
      if (o.kind === 'fish' && o.calm > 0) minSec = Math.max(1.5, minSec - 1.5);   // 鯨靈守護：開頭自動收線，合理的最短拉扯時間縮短
      if (age < minSec) { this.db.prepare("UPDATE fishing_casts SET status='rejected',resolved_at=? WHERE id=?").run(t, cast.id); this.players.logEvent(pid, 'fishing_too_fast', { cast: cast.id, age, minSec }); return { ok: false, error: [422, 'too_fast', '收線速度異常，這一竿不算'] }; }
      let out = { ok: true, result: 'caught', kind: o.kind }, xp = 5;
      if (o.ex && cast.bait) { p.pity = p.pity || {}; p.pity[cast.bait] = 0; }   // 釣到專屬魚 → 保底歸零
      if (o.kind === 'chest') {
        const gem = Math.random() < c.chestGemChance, n = gem ? rint(c.chestGems[0], c.chestGems[1]) : rint(c.chestCoins[0], c.chestCoins[1]);
        if (gem) { this.commerce.ledger(pid, n, 'bonus:fishing_chest', cast.id); out.gems = n; const r = this.players.getSave(pid); out.save = r.save; out.rev = r.rev; }
        else { const g = this.players.grantToSave(pid, { coins: n }); out.coins = n; out.save = g.save; out.rev = g.rev; }
      } else if (o.kind === 'bottle') {
        const n = rint(c.bottleCoins[0], c.bottleCoins[1]), g = this.players.grantToSave(pid, { coins: n }); out.coins = n; out.save = g.save; out.rev = g.rev;
      } else if (body.dest === 'release') {
        out.dest = 'release';   // 放生：不給魚、+5 XP，不列入排行榜
      } else {
        const d = body.dest === 'basket' ? this.toBasket(pid, p, o, cast.id, cast.spot, t) : this.deliver(pid, p, o, String(body.dest || 'tank'), cast.spot, t);   // 🧺 魚簍：先記錄，回家再決定去處
        Object.assign(out, d, { fish: d.fish || null });
        const pts = this.points(o);
        xp = Math.round([10, 25, 60, 150][o.r] * (o.ratio || 1) * (o.variant === 'gold' ? 3 : o.variant === 'albino' ? 1.6 : 1) * (o.giant ? 1.3 : 1));
        this.db.prepare('INSERT INTO fishing_catches(player_id,cast_id,day,week,spot,sp,rarity,cm,kg,variant,giant,points,dest,fight_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(pid, cast.id, cast.day, weekOf(cast.day), cast.spot, o.id, o.r, o.cm, o.kg, o.variant || null, o.giant ? 1 : 0, pts, out.dest, Math.round(age * 1000), t);
        const tour = this.activeTour(t);
        if (tour && (!tour.spot || tour.spot === cast.spot)) {
          this.db.prepare('INSERT INTO fishing_tournament_entries(tournament_id,player_id,score,n,best_kg,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(tournament_id,player_id) DO UPDATE SET score=score+excluded.score,n=n+1,best_kg=MAX(best_kg,excluded.best_kg),updated_at=excluded.updated_at').run(tour.id, pid, pts, o.kg, t);
          out.tourPoints = pts;
        }
        p.stats.caught++; p.stats.kg = Math.round((p.stats.kg + o.kg) * 1000) / 1000; out.points = pts;
        // 星輝雙魚：第二條（伺服器擲出的普通魚）跟著第一條的實際去處
        if (o.dbl && DATA.species[o.dbl.id]) {
          const o2 = o.dbl, want = out.dest === 'sell' ? 'sell' : out.dest, d2 = want === 'basket' ? this.toBasket(pid, p, o2, cast.id + '#2', cast.spot, t) : this.deliver(pid, p, o2, want, cast.spot, t), pts2 = this.points(o2);
          this.db.prepare('INSERT INTO fishing_catches(player_id,cast_id,day,week,spot,sp,rarity,cm,kg,variant,giant,points,dest,fight_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(pid, cast.id + '#2', cast.day, weekOf(cast.day), cast.spot, o2.id, 0, o2.cm, o2.kg, null, 0, pts2, d2.dest, Math.round(age * 1000), t);
          if (tour && (!tour.spot || tour.spot === cast.spot)) { this.db.prepare('UPDATE fishing_tournament_entries SET score=score+?,n=n+1,best_kg=MAX(best_kg,?) WHERE tournament_id=? AND player_id=?').run(pts2, o2.kg, tour.id, pid); out.tourPoints += pts2; }
          p.stats.caught++; p.stats.kg = Math.round((p.stats.kg + o2.kg) * 1000) / 1000; out.points += pts2; xp += 10;
          out.dbl = { id: o2.id, cm: o2.cm, kg: o2.kg, dest: d2.dest, coins: d2.coins, reason: d2.reason, fish: d2.fish || null, points: pts2, basketId: d2.basketId };
        }
      }
      xp = Math.round(xp * (1 + (this.gear(p, 'wear').xp || 0) + this.charB(p, 'xp'))); p.xp += xp; let up = 0; while (p.xp >= xpNeed(p.lv)) { p.xp -= xpNeed(p.lv); p.lv++; up++; }
      this.saveProfile(pid, p);
      this.db.prepare("UPDATE fishing_casts SET status='caught',resolved_at=?,dest=? WHERE id=?").run(t, out.dest || o.kind, cast.id);
      this.players.logEvent(pid, 'fishing_catch', { cast: cast.id, kind: o.kind, sp: o.id, r: o.r, kg: o.kg, dest: out.dest, coins: out.coins, gems: out.gems });
      out.xp = xp; out.levelUp = up; out.outcome = o; out.balance = this.commerce.balance(pid);
      delete out.save; delete out.rev;   // 回傳時一律帶最新存檔（下方）
      return out;
    }))();
  }

  buy(pid, body) {
    this.guard();
    const r = this.db.transaction(() => this.once(pid, body.key, body, () => {
      const c = this.cfg(), t = this.now(), p = this.profile(pid), ref = 'fishing:' + body.key;
      if (body.kind === 'casts') fail(410, 'removed', '單次加購已改成「💎重置次數」');
      // 重置次數：用完才能重置，💎 扣在 gem_ledger；次數補回到魚簍上限（不限每日重置次數；同一把 key 重送不重扣）
      if (body.kind === 'reset') {
        const d = this.daily(pid, this.day(t)), max = this.maxCasts(p), { gems, spot: spotR } = this.resetGemToday(pid, p, String(body.spot || ''), t);
        if (this.castsLeft(p, d) > 0) fail(409, 'casts_left', '還有次數，用完再重置', { left: this.castsLeft(p, d) });
        if (gems > 0) this.commerce.ledger(pid, -gems, 'spend', ref);
        d.extra = d.used;   // left = max + extra - used = max
        this.saveDaily(d);
        this.players.logEvent(pid, 'fishing_reset_casts', { gems, max, spot: spotR }); return { ok: true, bought: { reset: max }, gems, spot: spotR, left: this.castsLeft(p, d) };
      }
      if (body.kind === 'spot') {
        const s = this.spot(String(body.id || '')); if (!s) fail(400, 'spot', '釣點不存在');
        if (this.spotOpen(p, body.id)) fail(409, 'owned', '已經解鎖');
        if (!(s.unlockGem > 0)) fail(400, 'spot', '這個釣點只能升級解鎖');
        this.commerce.ledger(pid, -s.unlockGem, 'spend', ref); p.unlocked[body.id] = 1; this.saveProfile(pid, p);
        this.players.logEvent(pid, 'fishing_buy_spot', { spot: body.id, gems: s.unlockGem }); return { ok: true, bought: { spot: body.id }, gems: s.unlockGem };
      }
      if (body.kind === 'char') {
        const id = String(body.id || ''), g = this.charItem(id);
        if (!g || g.cur === 'free') fail(400, 'item', '角色不存在');
        if (p.chars[id]) fail(409, 'owned', '已經擁有這位釣手');
        let coins = 0, gems = 0;
        if (g.cur === 'unlock') { if (!this.bossProgress(pid, p).ok) fail(403, 'locked', '尚未達成隱藏角色解鎖條件'); }
        else if (g.cur === 'gem') { this.commerce.ledger(pid, -g.price, 'spend', ref); gems = g.price; }
        else {
          const row = this.players.getSave(pid); if (!row.save) fail(409, 'no_save', '請先同步魚缸');
          if (body.rev != null && body.rev !== row.rev) throw new HttpError(409, 'conflict', '魚缸已更新，請重試', { rev: row.rev });
          if ((row.save.coins || 0) < g.price) fail(402, 'insufficient_coins', '金幣不足');
          row.save.coins -= g.price; this.players.writeSaveRow(pid, row.save, row.rev + 1, t, false); this.players.econ(t, 0, g.price, 0, pid); coins = g.price;
        }
        p.chars[id] = 1; p.char = id; this.saveProfile(pid, p);
        this.players.logEvent(pid, 'fishing_buy_char', { id, coins, gems }); return { ok: true, bought: { char: id }, coins, gems };
      }
      if (body.kind === 'gear') {
        const slot = String(body.slot || ''), id = String(body.id || ''), g = this.item(slot, id);
        if (!g || g.cur === 'free' || g.legacy) fail(400, 'item', '商品不存在');
        const consumable = slot === 'bait';
        if (!consumable && p.own[slot] && p.own[slot][id]) fail(409, 'owned', '已經擁有');
        let coins = 0, gems = 0;
        if (g.cur === 'gem') { this.commerce.ledger(pid, -g.price, 'spend', ref); gems = g.price; }
        else {
          const row = this.players.getSave(pid); if (!row.save) fail(409, 'no_save', '請先同步魚缸');
          if (body.rev != null && body.rev !== row.rev) throw new HttpError(409, 'conflict', '魚缸已更新，請重試', { rev: row.rev });
          if ((row.save.coins || 0) < g.price) fail(402, 'insufficient_coins', '金幣不足');
          row.save.coins -= g.price; this.players.writeSaveRow(pid, row.save, row.rev + 1, t, false); this.players.econ(t, 0, g.price, 0, pid); coins = g.price;
        }
        if (consumable) p.baits[id] = (p.baits[id] || 0) + (g.pack || 1); else (p.own[slot] = p.own[slot] || {})[id] = 1;
        p.eq[slot] = id; this.saveProfile(pid, p);
        this.players.logEvent(pid, 'fishing_buy_gear', { slot, id, coins, gems }); return { ok: true, bought: { slot, id }, coins, gems };
      }
      fail(400, 'kind', '未知商品');
    }))();
    const row = this.players.getSave(pid);
    return { ...r, save: row.save, rev: row.rev, status: this.status(pid) };
  }
  equip(pid, body) {
    this.guard();
    const slot = String(body.slot || ''), id = String(body.id || ''), p = this.profile(pid);
    if (slot === 'char') {
      if (!CHARS[id]) fail(400, 'item', '角色不存在');
      if (!p.chars[id]) fail(403, 'not_owned', '還沒有這位釣手');
      p.char = id; this.saveProfile(pid, p); return { ok: true, profile: p };
    }
    if (!DATA.gear[slot] || !DATA.gear[slot][id]) fail(400, 'item', '道具不存在');
    const free = Object.keys(DATA.gear[slot])[0] === id, have = slot === 'bait' ? (p.baits[id] || 0) > 0 : !!(p.own[slot] && p.own[slot][id]);
    if (!free && !have) fail(403, 'not_owned', '還沒有這件道具');
    p.eq[slot] = id; this.saveProfile(pid, p); return { ok: true, profile: p };
  }

  displayName(p) { const n = String(p.nickname || '').trim().slice(0, 16), local = String(p.email || '').split('@')[0]; return !n || (local && n.toLowerCase() === local.toLowerCase().slice(0, 20)) ? '魚友#' + p.id : n; }
  // MYFISH-V1 只讀：列出這位玩家「釣魚放進魚缸／收藏庫」的魚 id（從釣魚收據找，包含 v11 前、存檔裡已沒有 caught 標記的魚）。不改任何存檔。
  myFish(pid) {
    const rows = this.db.prepare(`SELECT json_extract(receipt,'$.fish') f FROM fishing_ops WHERE player_id=? AND json_extract(receipt,'$.fish.id') IS NOT NULL
      UNION ALL SELECT json_extract(receipt,'$.dbl.fish') FROM fishing_ops WHERE player_id=? AND json_extract(receipt,'$.dbl.fish.id') IS NOT NULL
      UNION ALL SELECT json_extract(j.value,'$.fish') FROM fishing_ops o, json_each(o.receipt,'$.results') j WHERE o.player_id=? AND json_type(o.receipt,'$.results')='array' AND json_extract(j.value,'$.fish.id') IS NOT NULL`).all(pid, pid, pid);
    const fish = {};
    for (const r of rows) { let f; try { f = JSON.parse(r.f); } catch (e) { continue; } if (!f || typeof f.id !== 'string' || !f.sp) continue; const c = f.caught || {}; fish[f.id] = { sp: f.sp, cm: c.cm, kg: c.kg, v: c.v, g: c.g, t: c.t }; }
    return { fish };
  }
  publicRecords(pid, q={}) {
    pid=Number(pid);const pl=Number.isSafeInteger(pid)&&pid>0?this.players.get(pid):null;
    if(!pl||pl.banned_at)throw new HttpError(404,'not_found','找不到釣手');
    const before=Number(q.before)||Number.MAX_SAFE_INTEGER;
    if(!Number.isSafeInteger(before)||before<=0)throw bad('cursor','紀錄頁碼不正確');
    const summary=this.db.prepare('SELECT COUNT(*) caught,COALESCE(SUM(kg),0) kg,COALESCE(MAX(kg),0) bestKg,COALESCE(MAX(cm),0) bestCm,COUNT(DISTINCT sp) species FROM fishing_catches WHERE player_id=?').get(pid);
    const heavy=q.sort==='weight';
    let rows;
    if(heavy){const cursor=before===Number.MAX_SAFE_INTEGER?null:this.db.prepare('SELECT kg FROM fishing_catches WHERE player_id=? AND id=?').get(pid,before);if(before!==Number.MAX_SAFE_INTEGER&&!cursor)throw bad('cursor','紀錄頁碼不正確');
      rows=cursor?this.db.prepare('SELECT id,sp,cm,kg,rarity,variant,giant,spot,created_at FROM fishing_catches WHERE player_id=? AND (kg<? OR (kg=? AND id<?)) ORDER BY kg DESC,id DESC LIMIT 21').all(pid,cursor.kg,cursor.kg,before):this.db.prepare('SELECT id,sp,cm,kg,rarity,variant,giant,spot,created_at FROM fishing_catches WHERE player_id=? ORDER BY kg DESC,id DESC LIMIT 21').all(pid);
    }else rows=this.db.prepare('SELECT id,sp,cm,kg,rarity,variant,giant,spot,created_at FROM fishing_catches WHERE player_id=? AND id<? ORDER BY id DESC LIMIT 21').all(pid,before);
    const more=rows.length>20;
    const records=rows.slice(0,20).map(r=>({id:r.id,species:r.sp,name:DATA.species[r.sp]?.name||r.sp,cm:r.cm,kg:r.kg,rarity:r.rarity,variant:r.variant,giant:!!r.giant,spot:r.spot,createdAt:r.created_at}));
    return {playerId:pid,name:this.displayName(pl),summary,records,next:more?records[records.length-1].id:null};
  }
  leaderboard(pid, q = {}) {
    const by = q.by === 'pts' ? 'points' : q.by === 'big' ? 'big' : q.by === 'bigspot' ? 'bigspot' : 'kg', period = q.period === 'day' ? 'day' : 'week', d = this.day(), key = period === 'day' ? d : weekOf(d), n = this.cfg().leaderboardSize;
    const col = period === 'day' ? 'day' : 'week', agg = by === 'big' ? 'MAX(kg)' : by === 'points' ? 'SUM(points)' : 'SUM(kg)';
    // RANKSPOT-V1：bigspot＝每個釣點本週「單條最重」前 3 名（每列是一條魚）；spot=…＝只算該釣點
    if (by === 'bigspot') {
      const top = this.db.prepare(`SELECT player_id, sp, kg, cm, variant, giant FROM fishing_catches WHERE ${col}=? AND spot=? ORDER BY kg DESC, created_at LIMIT 3`);
      const spots = Object.keys(DATA.spots).map((id) => ({ spot: id, name: this.spot(id).name, rows: top.all(key, id).map((r, i) => ({ rank: i + 1, playerId: r.player_id, name: this.displayName(this.players.get(r.player_id) || { id: r.player_id }), sp: r.sp, spName: (DATA.species[r.sp] && DATA.species[r.sp].name) || r.sp, kg: Math.round(r.kg * 1000) / 1000, cm: r.cm, variant: r.variant || null, giant: !!r.giant, me: r.player_id === pid })) }));
      return { by, period, key, spots };
    }
    const spot = q.spot && DATA.spots[q.spot] ? String(q.spot) : null, sw = spot ? ' AND spot=?' : '', sa = spot ? [spot] : [];
    const rows = this.db.prepare(`SELECT player_id, ${agg} v, COUNT(*) n FROM fishing_catches WHERE ${col}=?${sw} GROUP BY player_id ORDER BY v DESC, MIN(created_at) LIMIT ?`).all(key, ...sa, n);
    const me = this.db.prepare(`SELECT ${agg} v, COUNT(*) n FROM fishing_catches WHERE ${col}=?${sw} AND player_id=?`).get(key, ...sa, pid);
    return { by, period, key, spot, rows: rows.map((r, i) => { const pl = this.players.get(r.player_id) || { id: r.player_id }; return { rank: i + 1, playerId:r.player_id, name: this.displayName(pl), v: Math.round(r.v * 1000) / 1000, n: r.n, me: r.player_id === pid }; }), me: me && me.n ? { v: Math.round(me.v * 1000) / 1000, n: me.n } : null };
  }

  activeTour(t = this.now()) { return this.db.prepare("SELECT * FROM fishing_tournaments WHERE status='scheduled' AND start_at<=? AND end_at>? ORDER BY start_at LIMIT 1").get(t, t); }
  tourPublic(pid, id) {
    const t = this.now();
    const T = id ? this.db.prepare('SELECT * FROM fishing_tournaments WHERE id=?').get(id) : (this.activeTour(t) || this.db.prepare("SELECT * FROM fishing_tournaments WHERE status='scheduled' AND start_at>? ORDER BY start_at LIMIT 1").get(t) || this.db.prepare("SELECT * FROM fishing_tournaments WHERE end_at<=? ORDER BY end_at DESC LIMIT 1").get(t));
    if (!T) return null;
    const top = this.db.prepare('SELECT player_id,score,n,best_kg FROM fishing_tournament_entries WHERE tournament_id=? ORDER BY score DESC,updated_at LIMIT 20').all(T.id);
    const mine = pid ? this.db.prepare('SELECT score,n FROM fishing_tournament_entries WHERE tournament_id=? AND player_id=?').get(T.id, pid) : null;
    const myRank = mine ? this.db.prepare('SELECT COUNT(*)+1 k FROM fishing_tournament_entries WHERE tournament_id=? AND score>?').get(T.id, mine.score).k : null;
    const rw = pid ? this.db.prepare('SELECT rank,gems,coins FROM fishing_tournament_rewards WHERE tournament_id=? AND player_id=?').get(T.id, pid) : null;
    return { id: T.id, name: T.name, spot: T.spot, startAt: T.start_at, endAt: T.end_at, status: T.status, live: T.start_at <= t && t < T.end_at && T.status === 'scheduled', rewards: JSON.parse(T.rewards), top: top.map((r, i) => ({ rank: i + 1, playerId:r.player_id, name: this.displayName(this.players.get(r.player_id) || { id: r.player_id }), score: r.score, n: r.n, me: r.player_id === pid })), me: mine ? { ...mine, rank: myRank } : null, myReward: rw || null };
  }
  createTour(b) {
    const name = String(b.name || '').trim().slice(0, 30), start = Number(b.startAt), end = Number(b.endAt);
    if (!name) throw bad('name', '請輸入名稱');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 14 * 86400000) throw bad('time', '時間不正確（最長 14 天）');
    if (b.spot && !DATA.spots[b.spot]) throw bad('spot', '釣點不存在');
    const rewards = Array.isArray(b.rewards) ? b.rewards.map((r) => ({ from: Math.max(1, r.from | 0), to: Math.max(1, r.to | 0), gems: Math.max(0, Math.min(5000, r.gems | 0)), coins: Math.max(0, Math.min(5e6, r.coins | 0)) })).filter((r) => r.to >= r.from) : (this.cfg().tourRewards || require('./fishing-admin').TOUR_REWARDS_DEF).map((r) => ({ ...r }));
    if (this.db.prepare("SELECT 1 FROM fishing_tournaments WHERE status='scheduled' AND start_at<? AND end_at>?").get(end, start)) throw bad('overlap', '與其他大賽時間重疊');
    const id = Number(this.db.prepare("INSERT INTO fishing_tournaments(name,spot,start_at,end_at,rewards,status,created_at) VALUES(?,?,?,?,?,'scheduled',?)").run(name, b.spot || null, start, end, JSON.stringify(rewards), this.now()).lastInsertRowid);
    return this.tourPublic(null, id);
  }
  cancelTour(id) { const r = this.db.prepare("UPDATE fishing_tournaments SET status='cancelled' WHERE id=? AND status='scheduled'").run(id); if (!r.changes) throw bad('state', '只能取消尚未結算的大賽'); return { ok: true }; }
  // 結算：冪等（fishing_tournament_rewards 有主鍵；重複按只會補發還沒發的）
  settleTour(id) {
    const t = this.now(), T = this.db.prepare('SELECT * FROM fishing_tournaments WHERE id=?').get(id);
    if (!T) fail(404, 'not_found', '大賽不存在');
    if (T.end_at > t) throw bad('running', '大賽還沒結束');
    if (T.status === 'cancelled') throw bad('cancelled', '大賽已取消');
    const rewards = JSON.parse(T.rewards), rows = this.db.prepare('SELECT player_id,score FROM fishing_tournament_entries WHERE tournament_id=? AND score>0 ORDER BY score DESC,updated_at').all(T.id);
    let paid = 0, gemsTotal = 0, coinsTotal = 0, skipped = 0;
    this.db.transaction(() => {
      rows.forEach((r, i) => {
        const rank = i + 1, rw = rewards.find((x) => rank >= x.from && rank <= x.to); if (!rw || (!rw.gems && !rw.coins)) return;
        if (this.db.prepare('SELECT 1 FROM fishing_tournament_rewards WHERE tournament_id=? AND player_id=?').get(T.id, r.player_id)) return;
        let coins = rw.coins;
        if (coins) { try { this.players.grantToSave(r.player_id, { coins }); } catch (e) { if (e.code === 'no_save') { coins = 0; skipped++; } else throw e; } }
        if (rw.gems) this.commerce.ledger(r.player_id, rw.gems, 'bonus:fishing_tour', 'ft' + T.id);
        this.db.prepare('INSERT INTO fishing_tournament_rewards(tournament_id,player_id,rank,gems,coins,created_at) VALUES(?,?,?,?,?,?)').run(T.id, r.player_id, rank, rw.gems, coins, t);
        this.players.logEvent(r.player_id, 'fishing_tour_reward', { tournament: T.id, rank, gems: rw.gems, coins });
        paid++; gemsTotal += rw.gems; coinsTotal += coins;
      });
      this.db.prepare("UPDATE fishing_tournaments SET status='settled',settled_at=? WHERE id=?").run(t, T.id);
    })();
    return { ok: true, id: T.id, paid, gems: gemsTotal, coins: coinsTotal, skippedNoSave: skipped };
  }

  adminSummary(days = 7) {
    const d0 = this.day(this.now() - (days - 1) * 86400000);
    const byDay = this.db.prepare("SELECT day, COUNT(*) casts, SUM(status='caught') caught, SUM(status='lost') lost, SUM(status IN ('expired','rejected')) bad, COUNT(DISTINCT player_id) players FROM fishing_casts WHERE day>=? GROUP BY day ORDER BY day DESC").all(d0);
    const rare = this.db.prepare('SELECT rarity, COUNT(*) n, ROUND(SUM(kg),2) kg FROM fishing_catches WHERE day>=? GROUP BY rarity').all(d0);
    const dest = this.db.prepare('SELECT dest, COUNT(*) n FROM fishing_catches WHERE day>=? GROUP BY dest').all(d0);
    const gems = this.db.prepare("SELECT COALESCE(SUM(-delta),0) spent FROM gem_ledger WHERE reason='spend' AND ref LIKE 'fishing:%' AND created_at>=?").get(Date.parse(d0 + 'T00:00:00+08:00')).spent;
    const gemsOut = this.db.prepare("SELECT COALESCE(SUM(delta),0) n FROM gem_ledger WHERE reason IN ('bonus:fishing_chest','bonus:fishing_tour') AND created_at>=?").get(Date.parse(d0 + 'T00:00:00+08:00')).n;
    return { enabled: this.enabled(), forcedOff: String((this.ctx.env || {}).FISHING_FORCE_OFF || '') === '1', config: this.cfg(), since: d0, byDay, rarity: rare, dest, gemsSpent: gems, gemsGranted: gemsOut };
  }
  adminFlags(days = 7) {
    const c = this.cfg(), d0 = this.day(this.now() - (days - 1) * 86400000);
    const rows = this.db.prepare("SELECT player_id, COUNT(*) casts, SUM(status='caught') caught, SUM(status='rejected') rejected FROM fishing_casts WHERE day>=? GROUP BY player_id HAVING (casts>=? AND 1.0*caught/casts>=?) OR rejected>0 ORDER BY rejected DESC, casts DESC LIMIT 200").all(d0, c.flagMinCasts, c.flagSuccessRate);
    return { since: d0, rows: rows.map((r) => { const pl = this.players.get(r.player_id) || {}; const fast = this.db.prepare('SELECT MIN(fight_ms) m, AVG(fight_ms) a FROM fishing_catches WHERE player_id=? AND day>=?').get(r.player_id, d0); return { ...r, rate: Math.round(r.caught / r.casts * 1000) / 10, name: this.displayName({ ...pl, id: r.player_id }), minFightMs: fast.m, avgFightMs: Math.round(fast.a || 0) }; }) };
  }
  adminPlayer(pid) { return { profile: this.profile(pid), today: this.daily(pid), recent: this.db.prepare('SELECT * FROM fishing_catches WHERE player_id=? ORDER BY id DESC LIMIT 50').all(pid) }; }
}

Fishing.SCHEMA = `
CREATE TABLE IF NOT EXISTS fishing_profile(player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fishing_daily(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, extra INTEGER NOT NULL DEFAULT 0, perfect INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(player_id,day));
CREATE TABLE IF NOT EXISTS fishing_casts(id TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL, spot TEXT NOT NULL, bait TEXT, perfect INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL, status TEXT NOT NULL, dest TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_fishing_casts_player ON fishing_casts(player_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_fishing_casts_day ON fishing_casts(day);
CREATE TABLE IF NOT EXISTS fishing_catches(id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, cast_id TEXT NOT NULL UNIQUE, day TEXT NOT NULL, week TEXT NOT NULL, spot TEXT NOT NULL, sp TEXT NOT NULL, rarity INTEGER NOT NULL, cm REAL NOT NULL, kg REAL NOT NULL, variant TEXT, giant INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL, dest TEXT, fight_ms INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fishing_catches_week ON fishing_catches(week,player_id);
CREATE INDEX IF NOT EXISTS idx_fishing_catches_day ON fishing_catches(day,player_id);
CREATE INDEX IF NOT EXISTS idx_fishing_catches_player ON fishing_catches(player_id,id);
CREATE TABLE IF NOT EXISTS fishing_ops(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, op_key TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id,op_key));
CREATE TABLE IF NOT EXISTS fishing_tournaments(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, spot TEXT, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, rewards TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'scheduled', created_at INTEGER NOT NULL, settled_at INTEGER);
CREATE TABLE IF NOT EXISTS fishing_tournament_entries(tournament_id INTEGER NOT NULL REFERENCES fishing_tournaments(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, score INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, best_kg REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(tournament_id,player_id));
CREATE INDEX IF NOT EXISTS idx_fishing_tour_score ON fishing_tournament_entries(tournament_id,score);
CREATE TABLE IF NOT EXISTS fishing_tournament_rewards(tournament_id INTEGER NOT NULL REFERENCES fishing_tournaments(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, rank INTEGER NOT NULL, gems INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(tournament_id,player_id));
`;

function mount(app, ctx) {
  const svc = ctx.fishing = new Fishing(ctx);
  try { if (svc.enabled()) svc.autoSpecies(); } catch (e) { /* 設定讀取失敗：第一次 API 呼叫時再試 */ }
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((o) => { if (o !== undefined && !res.headersSent) res.json(o); }).catch(next);
  const L = { read: new RateLimiter({ windowMs: 60000, max: 120 }), act: new RateLimiter({ windowMs: 60000, max: 40 }), buy: new RateLimiter({ windowMs: 60000, max: 20 }) };
  const lim = (name) => (req, res, next) => { const v = L[name].check('p' + req.player.id); if (!v.ok) { res.set('Retry-After', String(v.retryAfter)); return next(new HttpError(429, 'rate_limited', '動作太頻繁，請稍後再試')); } next(); };
  const r = express.Router();
  // 公開：只回答是否開放（遊戲端決定要不要顯示 🎣 按鈕；不需登入）
  r.get('/enabled', (req, res) => res.json({ enabled: svc.enabled() }));
  r.use(ctx.players.auth(), express.json({ limit: '4kb' }));
  r.get('/status', lim('read'), wrap((req) => { svc.guard(); return svc.status(req.player.id); }));
  r.post('/cast', lim('act'), wrap((req) => svc.cast(req.player.id, req.body || {})));
  r.post('/resolve', lim('act'), wrap((req) => { const out = svc.resolve(req.player.id, req.body || {}); const row = ctx.players.getSave(req.player.id); return { ...out, save: row.save, rev: row.rev, status: svc.status(req.player.id) }; }));
  r.post('/buy', lim('buy'), wrap((req) => svc.buy(req.player.id, req.body || {})));
  r.post('/equip', lim('act'), wrap((req) => svc.equip(req.player.id, req.body || {})));
  r.get('/my-fish', lim('read'), wrap((req) => { svc.guard(); return svc.myFish(req.player.id); }));
  r.get('/records',lim('read'),wrap(req=>{svc.guard();return svc.publicRecords(req.player.id,req.query)}));
  r.get('/players/:id/records',lim('read'),wrap(req=>{svc.guard();return svc.publicRecords(req.params.id,req.query)}));
  r.get('/leaderboard', lim('read'), wrap((req) => { svc.guard(); return svc.leaderboard(req.player.id, req.query); }));
  r.get('/tournament', lim('read'), wrap((req) => { svc.guard(); return { tournament: svc.tourPublic(req.player.id) }; }));
  require('./fishing-missions').mountMissions(r, svc, wrap, lim); // 每日釣魚任務（主遊戲任務中心）
  require('./fishing-basket').mountBasket(r, svc, wrap, lim, ctx); // 🧺 魚簍結算
  app.use('/api/fishing', r);

  require('./fishing-admin').mountAdmin(app, svc, ctx, wrap, DEF);   // v11：完整釣魚後台（設定／數據／玩家查詢／稽核）
  const a = express.Router();
  a.use(ctx.adminAuth.require(), express.json({ limit: '8kb' }));
  a.get('/summary', wrap((req) => svc.adminSummary(Math.min(60, Math.max(1, Number(req.query.days) || 7)))));
  a.get('/flags', wrap((req) => svc.adminFlags(Math.min(60, Math.max(1, Number(req.query.days) || 7)))));
  a.get('/player/:id', wrap((req) => svc.adminPlayer(Number(req.params.id) || 0)));
  a.get('/tournaments', wrap(() => ({ rows: svc.db.prepare('SELECT t.*, (SELECT COUNT(*) FROM fishing_tournament_entries e WHERE e.tournament_id=t.id) entries FROM fishing_tournaments t ORDER BY id DESC LIMIT 50').all() })));
  a.get('/tournaments/:id', wrap((req) => svc.tourPublic(null, Number(req.params.id))));
  a.post('/tournaments', wrap((req) => { const out = svc.createTour(req.body || {}); ctx.adminAuth.audit(req, 'fishing.tournament.create', 'fishing-tour:' + out.id, { name: out.name, rewards: out.rewards }); return out; }));
  a.post('/tournaments/:id/cancel', wrap((req) => { const out = svc.cancelTour(Number(req.params.id)); ctx.adminAuth.audit(req, 'fishing.tournament.cancel', 'fishing-tour:' + req.params.id, {}); return out; }));
  a.post('/tournaments/:id/settle', wrap((req) => { const out = svc.settleTour(Number(req.params.id)); ctx.adminAuth.audit(req, 'fishing.tournament.settle', 'fishing-tour:' + out.id, out); return out; }));
  require('./fishing-contest').mount(r,a,svc,wrap,lim,ctx);
  app.use('/admin/api/fishing', a);
  return svc;
}

Fishing.prototype.xpNeedOf = xpNeed;
require('./fishing-basket').install(Fishing);

module.exports = { mount, Fishing, FISHING_DEFAULTS: DEF, weekOf, wxKind, exOK, ADDON };
