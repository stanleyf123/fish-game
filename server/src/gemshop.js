'use strict';
// 💎 v4.1 寶石用途：本週限定商店、加速（魚立即長大／立即完成養水）、外觀（魚缸背景主題，只改外觀）
//  - 本週 = 台北時間週一 00:00 起 7 天；同一週所有玩家看到相同商品（以週別＋魚種 id 雜湊決定，後台可用 weeklyShop.override 指定）
//  - 每位玩家每個本週商品限購 perPlayerLimit 次；價格 = 原價 ×（1 − discountPct%）
//  - 所有扣寶石＋寫存檔都在伺服器同一個 transaction 內完成；客戶端只送 id
const crypto = require('crypto');
const express = require('express');
const { HttpError, RateLimiter, clampStr } = require('./util');
const { newOrderId } = require('./commerce');

const BG = (name, icon, priceGems, desc, c) => ({ name, icon, priceGems, desc, ...c });
const DEFAULT_BACKGROUNDS = {
  bg_crystal: BG('水晶洞穴', '🔮', 150, '紫藍色晶洞、遠方水晶群閃著微光', { top: '#6f7fe0', mid: '#4b3fa8', low: '#2a1d6b', bottom: '#160f3d', ridge1: 'rgba(120,90,220,.38)', ridge2: 'rgba(70,40,150,.5)', fog: 'rgba(150,120,255,.26)', sandTop: '#cfc4ee', sandBot: '#8577b8', sparkle: 'rgba(200,180,255,.85)' }),
  bg_wreck: BG('沉船寶藏', '🏴‍☠️', 120, '幽暗的沉船海域，遠處隱約閃著金幣光', { top: '#3fa3a8', mid: '#1f6e74', low: '#0f4247', bottom: '#082a2e', ridge1: 'rgba(20,70,70,.4)', ridge2: 'rgba(10,45,48,.55)', fog: 'rgba(40,110,100,.3)', sandTop: '#cdb98a', sandBot: '#86704a', sparkle: 'rgba(255,215,110,.8)' }),
  bg_zen: BG('東方庭園', '🎋', 150, '翠綠清澈的庭園水景，像錦鯉池', { top: '#9be7c8', mid: '#4fbf9a', low: '#1f7f66', bottom: '#11523f', ridge1: 'rgba(30,110,80,.32)', ridge2: 'rgba(20,80,60,.45)', fog: 'rgba(120,200,170,.25)', sandTop: '#e3dcc6', sandBot: '#a39a80', sparkle: 'rgba(255,190,210,.7)' }),
  bg_atlantis: BG('亞特蘭提斯遺跡', '🏛️', 180, '湖水綠與金色光芒的古文明遺跡', { top: '#6fe0e6', mid: '#2fb0b8', low: '#14707c', bottom: '#0a4450', ridge1: 'rgba(200,170,90,.28)', ridge2: 'rgba(20,90,100,.5)', fog: 'rgba(230,200,120,.22)', sandTop: '#f1deb0', sandBot: '#b99b62', sparkle: 'rgba(255,225,140,.85)' }),
  bg_volcano: BG('火山熔岩', '🌋', 180, '暗紅水域與遠方熔岩光，像海底火山口', { top: '#a0524a', mid: '#6a2a2a', low: '#3c1414', bottom: '#1e0808', ridge1: 'rgba(40,10,10,.55)', ridge2: 'rgba(20,5,5,.65)', fog: 'rgba(255,90,30,.28)', sandTop: '#5a4a46', sandBot: '#2a1f1d', sparkle: 'rgba(255,130,40,.9)' }),
  bg_abyss: BG('深海奇幻', '🦑', 150, '漆黑深海裡漂著藍紫色生物冷光', { top: '#24407a', mid: '#152a5a', low: '#0b1638', bottom: '#050a1e', ridge1: 'rgba(30,40,110,.45)', ridge2: 'rgba(15,20,70,.6)', fog: 'rgba(80,120,255,.22)', sandTop: '#5d6680', sandBot: '#2b3044', sparkle: 'rgba(120,230,255,.9)' }),
  bg_space: BG('太空基地', '🚀', 200, '星空般的深色水域，滿天星點', { top: '#1c2140', mid: '#11152e', low: '#090b1c', bottom: '#04050e', ridge1: 'rgba(60,70,130,.35)', ridge2: 'rgba(30,35,80,.55)', fog: 'rgba(140,150,255,.18)', sandTop: '#8e93a8', sandBot: '#4a4e60', sparkle: 'rgba(255,255,255,.95)', stars: 1 }),
  bg_festival: BG('節慶', '🏮', 100, '溫暖的紅金色調，像掛滿燈籠的年節夜', { top: '#ffb37a', mid: '#e0603e', low: '#9c2a2a', bottom: '#5c1418', ridge1: 'rgba(150,30,30,.32)', ridge2: 'rgba(100,15,20,.45)', fog: 'rgba(255,190,90,.25)', sandTop: '#f0d29a', sandBot: '#b98a4e', sparkle: 'rgba(255,210,90,.9)' }),
};
const DEFAULTS = {
  weeklyShop: { enabled: true, fishSlots: 4, cosmeticSlots: 1, discountPct: 20, perPlayerLimit: 1, override: {} },
  speedups: { enabled: true, grow: { mini: 5, small: 8, medium: 15, large: 25, giant: 40 }, cycle: 30 },
  cosmetics: { enabled: true, backgrounds: DEFAULT_BACKGROUNDS },
};
const COLOR_KEYS = ['top', 'mid', 'low', 'bottom', 'ridge1', 'ridge2', 'fog', 'sandTop', 'sandBot', 'sparkle'];
function conf(cfg) {
  const w = (cfg && cfg.weeklyShop) || {}, s = (cfg && cfg.speedups) || {}, c = (cfg && cfg.cosmetics) || {};
  return {
    weeklyShop: { ...DEFAULTS.weeklyShop, ...w, override: w.override && typeof w.override === 'object' ? w.override : {} },
    speedups: { ...DEFAULTS.speedups, ...s, grow: { ...DEFAULTS.speedups.grow, ...(s.grow || {}) } },
    cosmetics: { ...DEFAULTS.cosmetics, ...c, backgrounds: { ...(c.backgrounds && typeof c.backgrounds === 'object' ? c.backgrounds : DEFAULT_BACKGROUNDS), ...(c.coinBackgrounds || {}) } },
  };
}
const H8 = 8 * 3600e3, DAY = 86400e3;
function weekOf(now) {
  const tp = now + H8, d0 = Math.floor(tp / DAY) * DAY, dow = new Date(d0).getUTCDay(), mon = d0 - ((dow + 6) % 7) * DAY;
  return { week: new Date(mon).toISOString().slice(0, 10), startsAt: mon - H8, endsAt: mon - H8 + 7 * DAY };
}
const hashRank = (week, id) => crypto.createHash('sha256').update(week + '|' + id).digest().readUInt32BE(0);

class GemShop {
  constructor(ctx) { this.ctx = ctx; this.db = ctx.db; this.commerce = ctx.commerce; this.players = ctx.players; this.now = () => Date.now(); this.db.exec(`CREATE TABLE IF NOT EXISTS coin_cosmetic_ops (player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, idem TEXT NOT NULL, cosmetic_id TEXT NOT NULL, price INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id,idem))`); this.lim = new RateLimiter({ windowMs: 60e3, max: 30 }); }
  cfg() { return this.ctx.configStore.active().config; }
  premiumIds(cfg) { return Object.keys(cfg.species || {}).filter((k) => { const s = cfg.species[k]; return s && s.priceGems > 0 && !s.disabled; }); }
  // 本週商品（同一週所有玩家相同）
  weekly(cfg, now) {
    const C = conf(cfg).weeklyShop, wk = weekOf(now), ov = C.override[wk.week];
    const bgs = conf(cfg).cosmetics.backgrounds;
    let fish, cos;
    if (Array.isArray(ov) && ov.length) {
      fish = ov.filter((id) => cfg.species[id] && cfg.species[id].priceGems > 0 && !cfg.species[id].disabled);
      cos = ov.filter((id) => bgs[id] && bgs[id].priceGems > 0 && !bgs[id].disabled);
    } else {
      fish = this.premiumIds(cfg).sort((a, b) => hashRank(wk.week, a) - hashRank(wk.week, b)).slice(0, Math.max(0, C.fishSlots | 0));
      cos = Object.keys(bgs).filter((k) => bgs[k].priceGems > 0 && !bgs[k].disabled).sort((a, b) => hashRank(wk.week, a) - hashRank(wk.week, b)).slice(0, Math.max(0, C.cosmeticSlots | 0));
    }
    const pct = Math.min(90, Math.max(0, Number(C.discountPct) || 0)), dp = (p) => Math.max(1, Math.round(p * (100 - pct) / 100));
    return { ...wk, enabled: C.enabled !== false, discountPct: pct, perPlayerLimit: Math.max(1, C.perPlayerLimit | 0),
      items: [...fish.map((id) => ({ kind: 'fish', id, name: cfg.species[id].name, priceGems: cfg.species[id].priceGems, price: dp(cfg.species[id].priceGems), sizeClass: cfg.species[id].sizeClass })),
        ...cos.map((id) => ({ kind: 'bg', id, name: bgs[id].name, icon: bgs[id].icon, priceGems: bgs[id].priceGems, price: dp(bgs[id].priceGems) }))] };
  }
  boughtThisWeek(pid, week, id) { return this.db.prepare('SELECT COUNT(*) n FROM orders WHERE player_id=? AND sku=? AND provider=\'gems\' AND status=\'paid\'').get(pid, `weekly:${week}:${id}`).n; }
  state(pid) {
    const cfg = this.cfg(), C = conf(cfg), w = this.weekly(cfg, this.now());
    const save = this.players.getSave(pid), cos = (save && save.save && save.save.cos) || {};
    return {
      weekly: { ...w, items: w.items.map((it) => { const n = this.boughtThisWeek(pid, w.week, it.id); return { ...it, bought: n, left: Math.max(0, w.perPlayerLimit - n) }; }) },
      speedups: { enabled: C.speedups.enabled !== false, grow: C.speedups.grow, cycle: C.speedups.cycle },
      cosmetics: { enabled: C.cosmetics.enabled !== false, backgrounds: C.cosmetics.backgrounds, own: cos.own || {}, bg: cos.bg || null },
      gems: this.commerce.balance(pid),
    };
  }
  reused(pid, idem) {
    if (!idem) return null;
    const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem);
    if (!ex) return null; const sv = this.players.getSave(pid);
    return { order: this.commerce.orderRow(ex), balance: this.commerce.balance(pid), save: sv.save, rev: sv.rev, reused: true };
  }
  // 扣寶石＋記一筆寶石訂單（transaction 內呼叫）
  charge(pid, sku, name, price, idem, grants) {
    const bal = this.commerce.balance(pid);
    if (bal < price) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price });
    const id = newOrderId(), t = this.now();
    this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
      VALUES (?,?,NULL,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, sku, name, price, idem, JSON.stringify(grants || {}), t, t, t);
    this.commerce.ledger(pid, -price, 'spend', 'order:' + id);
    this.players.logEvent(pid, 'gems_spent', { orderId: id, sku, gems: price });
    return id;
  }
  loadSave(pid) { const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid); if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔'); return { row, save: JSON.parse(row.data) }; }
  write(pid, row, save) { const rev = row.rev + 1; this.players.writeSaveRow(pid, save, rev, this.now(), false); return rev; }

  buyWeekly(pid, body) {
    const id0 = String((body && body.id) || ''), idem = body && body.idempotencyKey ? clampStr(body.idempotencyKey, 64) : null;
    return this.db.transaction(() => {
      const r0 = this.reused(pid, idem); if (r0) return r0;
      const cfg = this.cfg(), w = this.weekly(cfg, this.now());
      if (!w.enabled) throw new HttpError(403, 'weekly_closed', '本週限定商店暫停中');
      const it = w.items.find((x) => x.id === id0);
      if (!it) throw new HttpError(404, 'not_in_weekly', '這個商品不在本週限定商店（可能已換檔）');
      if (this.boughtThisWeek(pid, w.week, id0) >= w.perPlayerLimit) throw new HttpError(409, 'weekly_limit', `本週已購買過「${it.name}」，下週再來看看！`);
      const sku = `weekly:${w.week}:${id0}`;
      if (it.kind === 'fish') return this.commerce.buySpecies(pid, id0, idem, { price: it.price, sku, label: '本週限定・' });
      return this.grantCosmetic(pid, id0, it.price, sku, idem);
    })();
  }
  buyCosmetic(pid, body) {
    const id0 = String((body && body.id) || ''), idem = body && body.idempotencyKey ? clampStr(body.idempotencyKey, 64) : null;
    return this.db.transaction(() => {
      const r0 = this.reused(pid, idem); if (r0) return r0;
      const C = conf(this.cfg()).cosmetics, b = Object.prototype.hasOwnProperty.call(C.backgrounds, id0) ? C.backgrounds[id0] : null;
      if (C.enabled === false || !b || !(b.priceGems > 0) || b.disabled) throw new HttpError(404, 'item_not_for_sale', '找不到這個背景，或已下架');
      return this.grantCosmetic(pid, id0, b.priceGems, 'cos:' + id0, idem);
    })();
  }
  buyCoinCosmetic(pid, body = {}) {
    const id = String(body.id || ''), idem = body.idempotencyKey ? clampStr(body.idempotencyKey, 64) : null;
    if (!idem || !idem.startsWith('coin-bg-')) throw new HttpError(400, 'idempotency_required', '請重新確認購買');
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM coin_cosmetic_ops WHERE player_id=? AND idem=?').get(pid, idem);
      if (prior) {
        if (prior.cosmetic_id !== id) throw new HttpError(409, 'idempotency_conflict', '購買資料不一致');
        const fresh = this.players.getSave(pid); return { balance:this.commerce.balance(pid),save:fresh.save,rev:fresh.rev,reused:true };
      }
      const C = conf(this.cfg()).cosmetics, b = ((this.cfg().cosmetics || {}).coinBackgrounds || {})[id];
      if (C.enabled === false || !b || b.disabled || !Number.isSafeInteger(b.priceCoins) || b.priceCoins < 1) throw new HttpError(404, 'item_not_for_sale', '找不到這個金幣主題');
      const { row, save } = this.loadSave(pid);
      if (!Number.isInteger(body.baseRev) || body.baseRev !== row.rev) throw new HttpError(409, 'save_conflict', '魚缸有新異動，請同步後再購買');
      if ((save.up?.cap || 0) < (b.minTankLevel || 0)) throw new HttpError(403, 'tank_level_required', '請先升級魚缸，再解鎖這款典藏主題');
      const cos = save.cos && typeof save.cos === 'object' ? save.cos : { own: {} }; cos.own = cos.own || {};
      if (cos.own[id]) throw new HttpError(409, 'already_owned', '已擁有這款主題，不會重複扣款');
      if (!Number.isFinite(save.coins) || save.coins < b.priceCoins) throw new HttpError(402, 'insufficient_coins', '金幣不足');
      const t = this.now();
      this.db.prepare('INSERT INTO coin_cosmetic_ops(player_id,idem,cosmetic_id,price,created_at) VALUES(?,?,?,?,?)').run(pid,idem,id,b.priceCoins,t);
      save.coins -= b.priceCoins; cos.own[id] = 1; cos.bg = id; save.cos = cos;
      const rev = this.write(pid, row, save);
      this.players.econ(t, 0, b.priceCoins, 0, pid);
      this.players.logEvent(pid, 'coin_cosmetic_buy', { id, coins: b.priceCoins });
      return { balance: this.commerce.balance(pid), save, rev };
    })();
  }
  grantCosmetic(pid, id0, price, sku, idem) {
    const C = conf(this.cfg()).cosmetics, b = C.backgrounds[id0];
    const { row, save } = this.loadSave(pid);
    const cos = save.cos && typeof save.cos === 'object' ? save.cos : {}; cos.own = cos.own && typeof cos.own === 'object' ? cos.own : {};
    if (cos.own[id0]) throw new HttpError(409, 'already_owned', `已經擁有「${b.name}」`);
    const oid = this.charge(pid, sku, '背景・' + b.name, price, idem, { cosmetics: [id0] });
    cos.own[id0] = 1; cos.bg = id0; save.cos = cos;
    const rev = this.write(pid, row, save);
    return { order: this.commerce.getOrder(oid), balance: this.commerce.balance(pid), save, rev };
  }
  speedup(pid, body) {
    const kind = String((body && body.kind) || ''), idem = body && body.idempotencyKey ? clampStr(body.idempotencyKey, 64) : null;
    return this.db.transaction(() => {
      const r0 = this.reused(pid, idem); if (r0) return r0;
      const cfg = this.cfg(), C = conf(cfg).speedups;
      if (C.enabled === false) throw new HttpError(403, 'speedups_closed', '加速功能暫停中');
      const { row, save } = this.loadSave(pid);
      if (kind === 'grow') {
        const f = (save.fish || []).find((x) => x && x.id === String(body.fishId || ''));
        if (!f) throw new HttpError(404, 'fish_not_found', '找不到這條魚（請先同步存檔）');
        const s = cfg.species[f.sp] || (require('./hybrid').isHybrid(f.sp) ? { sizeClass: 'medium', name: '混種魚' } : null);
        if (!s) throw new HttpError(404, 'fish_not_found', '找不到這個魚種');
        const G2 = (cfg.stages && cfg.stages[2] && cfg.stages[2].growth) || 160;
        if ((f.growth || 0) >= G2) throw new HttpError(409, 'already_adult', '這條魚已經成年了');
        if ((s.minTankLevel || 0) > ((save.up && save.up.cap) || 0)) throw new HttpError(409, 'tank_too_small', '魚缸太小，牠長不大；先擴建魚缸再加速');
        const price = Math.max(1, Math.round(Number(C.grow[s.sizeClass] || C.grow.medium) || 15));
        const oid = this.charge(pid, 'speed:grow:' + f.sp, '加速・立即長大（' + (s.name || f.sp) + '）', price, idem, { growFish: f.id });
        f.growth = G2;
        const rev = this.write(pid, row, save);
        return { order: this.commerce.getOrder(oid), balance: this.commerce.balance(pid), save, rev, fishId: f.id };
      }
      if (kind === 'cycle') {
        save.water = save.water && typeof save.water === 'object' ? save.water : {};
        if (!((save.water.cycle ?? 100) < 100)) throw new HttpError(409, 'already_cycled', '養水已經完成了');
        const price = Math.max(1, Math.round(Number(C.cycle) || 30));
        const oid = this.charge(pid, 'speed:cycle', '加速・立即完成養水', price, idem, { cycle: 100 });
        save.water.cycle = 100;
        const rev = this.write(pid, row, save);
        return { order: this.commerce.getOrder(oid), balance: this.commerce.balance(pid), save, rev };
      }
      throw new HttpError(400, 'bad_kind', 'kind 必須是 grow 或 cycle');
    })();
  }
}

// 存檔裡的外觀欄位驗證（反作弊）：cos = { own: { bg_x: 1 }, bg: 'bg_x' | null }；新擁有的外觀只能由伺服器發放
function checkCos(cfg, prev, next) {
  const errs = [], suspicious = [];
  if (next.cos == null) return { errs, suspicious };
  const B = conf(cfg).cosmetics.backgrounds, c = next.cos;
  if (!c || typeof c !== 'object' || Array.isArray(c) || (c.own != null && (typeof c.own !== 'object' || Array.isArray(c.own)))) { errs.push('cos（外觀）格式錯誤'); return { errs, suspicious }; }
  const own = c.own || {};
  if (Object.entries(own).some(([k, v]) => !B[k] || v !== 1)) errs.push('cos.own 含未知外觀');
  if (c.bg != null && (typeof c.bg !== 'string' || !own[c.bg])) errs.push('cos.bg 必須是已擁有的背景');
  const po = (prev && prev.cos && prev.cos.own) || {};
  for (const k of Object.keys(own)) if (!po[k] && B[k]) suspicious.push(`背景「${B[k].name}」只能由伺服器購買或發放`);
  return { errs, suspicious };
}

function validate(cfg, err) {
  {const c=cfg.cosmetics;
    if (c && c.coinBackgrounds != null) {
      if (typeof c.coinBackgrounds !== 'object' || Array.isArray(c.coinBackgrounds)) err('cosmetics.coinBackgrounds','必須是物件');
      else for (const [k,b] of Object.entries(c.coinBackgrounds)) {
        if (!/^bg_coin_[a-z0-9_]{1,22}$/.test(k) || c.backgrounds?.[k]) err('cosmetics.coinBackgrounds.'+k,'金幣背景ID格式錯誤或重複');
        if (!b || typeof b !== 'object') { err('cosmetics.coinBackgrounds.'+k,'必須是物件'); continue; }
        if (typeof b.name !== 'string' || !b.name) err('cosmetics.coinBackgrounds.'+k+'.name','必填');
        if (!Number.isSafeInteger(b.priceCoins) || b.priceCoins < 1 || b.priceCoins > 10000000 || b.priceGems != null) err('cosmetics.coinBackgrounds.'+k+'.priceCoins','必須是1–10000000的金幣價格，不可同時售鑽石');
        if (!Number.isInteger(b.minTankLevel) || b.minTankLevel < 0 || b.minTankLevel > (cfg.capacity?.upgrades?.length || 12)) err('cosmetics.coinBackgrounds.'+k+'.minTankLevel','魚缸等級格式錯誤');
        for (const ck of COLOR_KEYS) if (b[ck] != null && !(typeof b[ck] === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., ]+\)|hsla?\([0-9.,% ]+\))$/.test(b[ck]))) err('cosmetics.coinBackgrounds.'+k+'.'+ck,'顏色格式錯誤');
      }
    }
  }

  if (cfg.weeklyShop != null) { const w = cfg.weeklyShop;
    if (typeof w !== 'object') err('weeklyShop', '必須是物件');
    else { for (const [k, lo, hi] of [['fishSlots', 0, 12], ['cosmeticSlots', 0, 6], ['discountPct', 0, 90], ['perPlayerLimit', 1, 10]]) if (w[k] != null && !(Number.isInteger(w[k]) && w[k] >= lo && w[k] <= hi)) err('weeklyShop.' + k, `必須是 ${lo}–${hi} 的整數`);
      if (w.override != null && (typeof w.override !== 'object' || Object.entries(w.override).some(([k, v]) => !/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v) || v.some((x) => typeof x !== 'string')))) err('weeklyShop.override', '格式：{"2026-10-19": ["p_x", "bg_y"]}（週一日期）'); } }
  if (cfg.speedups != null) { const s = cfg.speedups;
    if (typeof s !== 'object') err('speedups', '必須是物件');
    else { if (s.grow != null) for (const [k, v] of Object.entries(s.grow)) if (!['mini', 'small', 'medium', 'large', 'giant'].includes(k) || !(Number.isInteger(v) && v >= 1 && v <= 9999)) err('speedups.grow.' + k, '必須是 1–9999 的整數');
      if (s.cycle != null && !(Number.isInteger(s.cycle) && s.cycle >= 1 && s.cycle <= 9999)) err('speedups.cycle', '必須是 1–9999 的整數'); } }
  if (cfg.cosmetics != null) { const c = cfg.cosmetics;
    if (typeof c !== 'object') err('cosmetics', '必須是物件');
    else if (c.backgrounds != null) for (const [k, b] of Object.entries(c.backgrounds)) {
      if (!/^bg_[a-z0-9_]{1,30}$/.test(k)) err('cosmetics.backgrounds.' + k, 'id 必須是 bg_ 開頭的英數');
      if (!b || typeof b !== 'object') { err('cosmetics.backgrounds.' + k, '必須是物件'); continue; }
      if (typeof b.name !== 'string' || !b.name) err(`cosmetics.backgrounds.${k}.name`, '必填');
      if (!(Number.isInteger(b.priceGems) && b.priceGems >= 1 && b.priceGems <= 99999)) err(`cosmetics.backgrounds.${k}.priceGems`, '必須是 1–99999 的整數');
      for (const ck of COLOR_KEYS) if (b[ck] != null && !(typeof b[ck] === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., ]+\)|hsla?\([0-9.,% ]+\))$/.test(b[ck]))) err(`cosmetics.backgrounds.${k}.${ck}`, '顏色格式錯誤'); } }
}

function mountGemShop(app, ctx) {
  const gs = new GemShop(ctx); ctx.gemShop = gs;
  const r = express.Router(), auth = ctx.players.auth();
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((o) => { if (o !== undefined && !res.headersSent) res.json(o); }).catch(next);
  const lim = (req, res, next) => { const c = gs.lim.check('g' + req.player.id); if (!c.ok) return next(new HttpError(429, 'rate_limited', '操作太頻繁，請稍後再試', { retryAfter: c.retryAfter })); next(); };
  r.use(express.json({ limit: '4kb' }));
  r.get('/', auth, wrap((req) => gs.state(req.player.id)));
  r.post('/weekly/buy', auth, lim, wrap((req) => gs.buyWeekly(req.player.id, req.body)));
  r.post('/cosmetic/buy', auth, lim, wrap((req) => gs.buyCosmetic(req.player.id, req.body)));
  r.post('/cosmetic/coin-buy', auth, lim, wrap((req) => gs.buyCoinCosmetic(req.player.id, req.body)));
  r.post('/speedup', auth, lim, wrap((req) => gs.speedup(req.player.id, req.body)));
  app.use('/api/gemshop', r);
  return gs;
}
module.exports = { mountGemShop, GemShop, checkCos, validate, conf, weekOf, DEFAULTS, DEFAULT_BACKGROUNDS };
