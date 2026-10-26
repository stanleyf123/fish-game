'use strict';
// 英雄魚服務：選英雄、訓練、技能、裝備（金幣／寶石，伺服器扣款）、非同步 PvP（伺服器權威模擬）、排行榜、賽季。
// 原則：客戶端只送「意圖」（選哪條魚、做哪個訓練、挑戰哪個名單上的對手）；所有數值、結果、扣款都在伺服器決定。
const crypto = require('crypto');
const { HttpError, bad, parseJSON, clampStr, hmac } = require('../util');
const S = require('./stats');
const { simulate, mulberry32 } = require('./battle');

const DAY = 86400000;
const J = (s, d) => parseJSON(s, d);

class HeroService {
  constructor(ctx, heroCfg) {
    this.ctx = ctx; this.db = ctx.db; this.players = ctx.players; this.commerce = ctx.commerce; this.rewards = ctx.rewards;
    this.gameCfgStore = ctx.configStore; this.heroCfg = heroCfg;
    this.ipKey = (ctx.env && ctx.env.SESSION_SECRET) || 'hero';
    require('./autobalance').setStore(this.db);
    this.monthly = new (require('./monthly-awards').MonthlyAwards)(ctx);
  }
  get H() { return this.heroCfg.active().config; }

  // 背景預先計算公平係數（worker thread；記憶體資料庫或 HERO_WARMUP=0 時略過）
  startWarmup() {
    const file = this.db.name;
    if (!file || file === ':memory:' || (this.ctx.env && this.ctx.env.HERO_WARMUP === '0')) return null;
    const ab = require('./autobalance');
    const key = ab.cfgHash(this.H, this.G);
    if (this.warm && this.warm.key === key && !this.warm.error) return this.warm;
    const { Worker } = require('worker_threads');
    const w = { key, done: 0, total: 0, finished: false, startedAt: Date.now() };
    this.warm = w;
    try {
      const worker = new Worker(require('path').join(__dirname, 'warmup-worker.js'), { workerData: { file, hcfg: this.H, gameCfg: this.G } });
      const put = this.db.prepare('INSERT OR REPLACE INTO hero_fair (k, m, created_at) VALUES (?,?,?)');
      const putAll = this.db.transaction((rows, t) => { for (const [k, m] of rows) put.run(k, m, t); });
      worker.on('message', (m) => {
        if (m.put) { try { putAll(m.put, Date.now()); } catch (e) { console.warn('[hero] 寫入公平係數失敗：', e.message); } return; }
        Object.assign(w, m);
      });
      worker.on('error', (e) => { w.error = e.message; console.warn('[hero] 公平係數預先計算失敗：', e.message); });
      worker.unref();
      w.worker = worker;
    } catch (e) { w.error = e.message; }
    return w;
  }
  warmupStatus() { const w = this.warm; return w ? { done: w.done, total: w.total, finished: !!w.finished, error: w.error || null, startedAt: w.startedAt, ms: w.ms || null } : null; }
  get G() { return this.gameCfgStore.active().config; }
  ipHash(ip) { return ip ? hmac(this.ipKey, 'ip:' + ip).slice(0, 24) : null; }

  // ---------- 共用 ----------
  row(pid) { return this.db.prepare('SELECT * FROM heroes WHERE player_id=?').get(pid); }
  heroObj(r) {
    return { ...r, train: J(r.train, {}), train_ready: J(r.train_ready, {}), skills: J(r.skills, {}), gear: J(r.gear, {}) };
  }
  saveOf(pid) { const r = this.db.prepare('SELECT data, rev, coins FROM saves WHERE player_id=?').get(pid); return r ? { save: J(r.data, null), rev: r.rev } : null; }
  isMember(p) { return !!(p && p.username); }
  requireMember(p) { if (this.H.pvp.memberOnly !== false && !this.isMember(p)) throw new HttpError(403, 'member_required', '英雄魚對戰只開放給註冊會員，請先用信箱註冊（魚缸與進度會保留）'); }
  requireHero(pid) { const r = this.row(pid); if (!r) throw new HttpError(404, 'no_hero', '還沒有英雄魚，請先從魚缸挑選一條'); return this.heroObj(r); }

  // 以伺服器存檔同步英雄魚的狀態（成長、名字、顏色、物種演化）；魚不在了就標記失效
  syncFromSave(h, saveObj) {
    const sv = saveObj || this.saveOf(h.player_id);
    const fish = sv && sv.save && Array.isArray(sv.save.fish) ? sv.save.fish.find((f) => f && f.id === h.fish_id) : null;
    const t = Date.now();
    if (!fish || !S.speciesDef(this.G, fish.sp)) {
      if (h.active) { this.db.prepare('UPDATE heroes SET active=0, updated_at=? WHERE player_id=?').run(t, h.player_id); h.active = 0; }
      return h;
    }
    const growth = Number(fish.growth) || 0, name = clampStr(fish.name || '', 20), hue = Number.isFinite(fish.hue) ? fish.hue : null;
    if (!h.active || h.growth !== growth || h.fish_name !== name || h.species !== fish.sp || h.hue !== hue) {
      this.db.prepare('UPDATE heroes SET active=1, growth=?, fish_name=?, species=?, hue=?, updated_at=? WHERE player_id=?').run(growth, name, fish.sp, hue, t, h.player_id);
      Object.assign(h, { active: 1, growth, fish_name: name, species: fish.sp, hue });
    }
    return h;
  }

  tickets(h, t = Date.now()) {
    const P = this.H.pvp, per = P.refillMinutes * 60000;
    let n = h.tickets, at = h.tickets_at || t;
    if (n >= P.ticketsMax) return { tickets: Math.min(n, P.ticketsMax), at: t, nextAt: null };
    const gained = Math.floor((t - at) / per);
    if (gained > 0) { n = Math.min(P.ticketsMax, n + gained); at = n >= P.ticketsMax ? t : at + gained * per; }
    return { tickets: n, at, nextAt: n >= P.ticketsMax ? null : at + per };
  }

  // One ticket per purchase. Debit and ticket update commit or roll back together.
  refillTickets(player, idem) {
    this.requireMember(player);
    if (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw bad('invalid_idempotency_key', '請重新開啟對戰頁後再試');
    const pid = player.id;
    return this.db.transaction(() => {
      const h = this.pvpReady(player);
      const prior = this.idemCheck(pid, idem);
      if (prior) {
        if (prior.kind !== 'ticket' || prior.item !== 'pvp_refill') throw new HttpError(409, 'idempotency_conflict', '這筆操作代碼已用於其他購買，請重新開啟對戰頁');
        return { ...this.view(player), reused: true, spent: { orderId: prior.order_id, gems: this.commerce.balance(pid), amount: 0 } };
      }
      const t = Date.now(), P = this.H.pvp, tk = this.tickets(h, t);
      if (tk.tickets >= P.ticketsMax) throw new HttpError(409, 'tickets_full', '對戰次數已滿，不需要花鑽石恢復');
      const price = P.ticketRefillGems ?? 20;
      const spent = this.spendGems(pid, price, 'hero:pvp_refill', '對戰次數恢復 1 次', idem);
      const next = tk.tickets + 1;
      this.db.prepare('UPDATE heroes SET tickets=?, tickets_at=?, updated_at=? WHERE player_id=?').run(next, next >= P.ticketsMax ? t : tk.at, t, pid);
      this.recordPurchase(pid, 'ticket', 'pvp_refill', 'gems', price, spent.orderId, idem);
      this.players.logEvent(pid, 'hero_ticket_refill', { price, tickets: next, orderId: spent.orderId });
      return { ...this.view(player), spent: { ...spent, amount: 0 }, restored: 1 };
    })();
  }

  changeCost(h) {
    const C = this.H.change;
    if (!h) return { coins: 0, free: true };
    if (!h.active) return { coins: 0, free: true, reason: 'fish_missing' };
    // 第一次選完後 firstChangeFreeHours（預設 24）小時內，可以免費、不受冷卻限制地換一次（選錯魚的補救）
    const fh = C.firstChangeFreeHours ?? 24;
    if (fh > 0 && (h.changes | 0) <= 1 && h.created_at && Date.now() - h.created_at < fh * 3600000) return { coins: 0, free: true, reason: 'first_change', freeUntil: h.created_at + fh * 3600000 };
    return { coins: Math.min(C.coinsMax, C.coins + C.coinsStep * Math.max(0, h.changes - (C.firstFree ? 1 : 0))), free: false };
  }

  changeInfo(h) {
    const c = this.changeCost(h);
    return { ...c, readyAt: !c.free && h && h.changed_at && h.active ? h.changed_at + this.H.change.cooldownHours * 3600000 : null };
  }

  // 伺服器端扣金幣：直接修改雲端存檔（rev+1），回傳新的金幣與 rev。必須在 transaction 內呼叫。
  spendCoins(pid, amount, ref) {
    amount = Math.floor(amount);
    if (!(amount > 0)) return null;
    const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid);
    if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
    const save = JSON.parse(row.data);
    const have = Math.floor(Number(save.coins) || 0);
    if (have < amount) throw new HttpError(402, 'insufficient_coins', `金幣不足（需要 ${amount}，目前 ${have}）`, { coins: have, price: amount });
    save.coins = (Number(save.coins) || 0) - amount;
    const t = Date.now();
    this.players.writeSaveRow(pid, save, row.rev + 1, t, false);
    this.players.econ(t, 0, amount, 0);
    this.players.logEvent(pid, 'hero_coins_spent', { amount, ref });
    return { coins: save.coins, rev: row.rev + 1, amount };
  }
  spendGems(pid, amount, sku, name, idem) {
    const { newOrderId } = require('../commerce');
    const id = newOrderId(), t = Date.now();
    const bal = this.commerce.balance(pid);
    if (bal < amount) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price: amount });
    this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
      VALUES (?,?,NULL,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, sku, name, amount, idem ? 'hero:' + idem : null, JSON.stringify({ hero: sku }), t, t, t);
    this.commerce.ledger(pid, -amount, 'spend', 'order:' + id);
    this.players.logEvent(pid, 'gems_spent', { orderId: id, sku, gems: amount });
    return { orderId: id, gems: this.commerce.balance(pid) };
  }
  idemCheck(pid, idem) {
    if (!idem) return null;
    return this.db.prepare('SELECT * FROM hero_purchases WHERE player_id=? AND idem=?').get(pid, clampStr(idem, 64));
  }
  recordPurchase(pid, kind, item, currency, amount, orderId, idem) {
    this.db.prepare('INSERT INTO hero_purchases (player_id, kind, item, currency, amount, order_id, idem, created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid, kind, item, currency, amount, orderId || null, idem ? clampStr(idem, 64) : null, Date.now());
  }

  addXp(h, xp) {
    const L = this.H.level; let level = h.level, cur = h.xp + Math.max(0, Math.floor(xp)), ups = 0;
    while (level < L.max && cur >= S.xpToNext(this.H, level)) { cur -= S.xpToNext(this.H, level); level++; ups++; }
    if (level >= L.max) cur = Math.min(cur, S.xpToNext(this.H, level));
    return { level, xp: cur, levelUps: ups };
  }

  // ---------- 狀態 ----------
  view(player, opt = {}) {
    const pid = player.id, H = this.H, t = Date.now();
    const sv = this.saveOf(pid);
    const out = { member: this.isMember(player), enabled: H.enabled !== false, coins: sv && sv.save ? Math.floor(sv.save.coins || 0) : null, rev: sv ? sv.rev : 0, gems: this.commerce.balance(pid), hero: null, season: this.currentSeason() };
    const r = this.row(pid);
    if (!r) return out;
    const h = this.syncFromSave(this.heroObj(r), sv);
    out.hero = this.heroView(h, t);
    return out;
  }
  heroView(h, t = Date.now()) {
    const H = this.H, def = S.speciesDef(this.G, h.species);
    const fs = def ? S.finalStats(H, this.G, h) : null;
    const fam = def ? S.familyOf(H, this.G, h.species, def) : null;
    const tk = this.tickets(h, t), rank = S.rankOf(H, h.rating);
    const cap = h.level * H.training.capPerStatPerLevel;
    const unlocked = fam ? S.unlockedSkills(H, fam, h.level) : [];
    return {
      fishId: h.fish_id, species: h.species, spName: def ? def.name : h.species, fishName: h.fish_name, hue: h.hue, growth: h.growth, stage: S.stageOf(this.G, h.growth),
      active: !!h.active, fishMissing: !h.active,
      level: h.level, xp: h.xp, xpNext: S.xpToNext(H, h.level), maxLevel: H.level.max,
      stats: fs ? fs.stats : null, power: fs ? fs.power : 0, family: fam ? { key: fam.key, name: fam.name } : null,
      skillsAll: fam ? [fam.signature, ...fam.pool].map((id, i) => ({ id, unlockLevel: (H.skillUnlock || [])[i] || 1, unlocked: unlocked.includes(id), rank: (h.skills.ranks || {})[id] || 1 })) : [],
      slots: fs ? fs.base.skills.map((x) => x.id) : [], slotCount: S.slotCount(H, h.level), customSlots: Array.isArray(h.skills.slots) && h.skills.slots.length > 0,
      train: { hp: 0, atk: 0, def: 0, spd: 0, crit: 0, ...h.train }, trainCap: cap, trainReady: h.train_ready,
      gear: { owned: Object.keys((h.gear && h.gear.owned) || {}), equip: (h.gear && h.gear.equip) || {} },
      rating: h.rating, peak: h.peak_rating, rank: { key: rank.key, name: rank.name, color: rank.color }, wins: h.wins, losses: h.losses, defWins: h.def_wins, defLosses: h.def_losses, seasonBattles: h.season_battles,
      tickets: tk.tickets, ticketsMax: H.pvp.ticketsMax, nextTicketAt: tk.nextAt,
      change: this.changeInfo(h),
      pvpBanned: !!h.pvp_banned_at, pvpBanReason: h.pvp_ban_reason || null,
    };
  }

  // 魚缸中可當英雄的魚（附預估戰力）
  candidates(player) {
    const sv = this.saveOf(player.id);
    if (!sv || !sv.save) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
    const r = this.row(player.id), lv = r ? r.level : 1;
    const list = [];
    for (const f of (sv.save.fish || []).slice(0, 500)) {
      const def = f && S.speciesDef(this.G, f.sp);
      if (!def) continue;
      const fam = S.familyOf(this.H, this.G, f.sp, def);
      const st = S.finalStats(this.H, this.G, { species: f.sp, growth: f.growth, level: lv, train: {}, gear: {}, skills: {} });
      list.push({ tank: list.length, fishId: f.id, species: f.sp, spName: def.name, name: f.name, hue: f.hue, growth: f.growth, stage: S.stageOf(this.G, f.growth), rarity: def.rarity | 0, hybrid: !!def.hybrid, premium: !!(def.priceGems > 0 || def.premium || def.premiumBlood),
        family: fam.name, signature: fam.signature, stats: st.stats, power: st.power, current: !!(r && r.fish_id === f.id) });
    }
    list.sort((a, b) => (b.current - a.current) || (b.premium - a.premium) || (b.rarity - a.rarity) || (b.power - a.power) || (a.tank - b.tank));
    const h = r && this.syncFromSave(this.heroObj(r), sv);
    return { candidates: list, change: h ? this.changeInfo(h) : { coins: 0, free: true }, total: (sv.save.fish || []).length };
  }

  pick(player, fishId, idem) {
    const pid = player.id, H = this.H;
    if (typeof fishId !== 'string' || !fishId || fishId.length > 64) throw bad('invalid_fish', '請選擇一條魚');
    return this.db.transaction(() => {
      if (idem && this.idemCheck(pid, idem)) return this.view(player);
      const sv = this.saveOf(pid);
      if (!sv || !sv.save) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔');
      const fish = (sv.save.fish || []).find((f) => f && f.id === fishId);
      if (!fish) throw new HttpError(404, 'fish_not_found', '魚缸裡找不到這條魚（請先同步存檔）');
      const def = S.speciesDef(this.G, fish.sp);
      if (!def) throw bad('invalid_species', '這條魚的魚種無法當英雄');
      const t = Date.now();
      let r = this.row(pid);
      let spent = null;
      if (r) {
        const h = this.syncFromSave(this.heroObj(r), sv);
        if (h.fish_id === fishId && h.active) throw new HttpError(409, 'same_fish', '這條魚已經是你的英雄魚');
        const cost = this.changeCost(h);
        const readyAt = h.changed_at ? h.changed_at + H.change.cooldownHours * 3600000 : 0;
        if (h.active && !cost.free && readyAt > t) { const m = Math.ceil((readyAt - t) / 60000); throw new HttpError(429, 'change_cooldown', `更換英雄魚冷卻中，還要 ${m >= 60 ? Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分' : m + ' 分鐘'}才能再換（更換費用 🪙${cost.coins}）`, { readyAt }); }
        if (cost.coins > 0) spent = this.spendCoins(pid, cost.coins, 'hero_change');
        this.db.prepare(`UPDATE heroes SET fish_id=?, species=?, fish_name=?, hue=?, growth=?, skills=?, active=1, changes=changes+1, changed_at=?, updated_at=? WHERE player_id=?`)
          .run(fishId, fish.sp, clampStr(fish.name || '', 20), Number.isFinite(fish.hue) ? fish.hue : null, Number(fish.growth) || 0, JSON.stringify({ ranks: (h.skills && h.skills.ranks) || {}, slots: [] }), t, t, pid);
        this.recordPurchase(pid, 'change', fish.sp, 'coins', cost.coins, null, idem);
        this.players.logEvent(pid, 'hero_change', { from: h.species, to: fish.sp, coins: cost.coins });
      } else {
        const P = H.pvp;
        this.db.prepare(`INSERT INTO heroes (player_id, fish_id, species, fish_name, hue, growth, rating, peak_rating, tickets, tickets_at, changes, changed_at, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(pid, fishId, fish.sp, clampStr(fish.name || '', 20), Number.isFinite(fish.hue) ? fish.hue : null, Number(fish.growth) || 0, P.startRating, P.startRating, P.ticketsMax, t, t, t, t);
        this.recordPurchase(pid, 'change', fish.sp, 'coins', 0, null, idem);
        this.players.logEvent(pid, 'hero_pick', { species: fish.sp });
      }
      return { ...this.view(player), spent };
    })();
  }

  train(player, type) {
    const pid = player.id, H = this.H, T = H.training.types[type];
    if (!T || !Object.prototype.hasOwnProperty.call(H.training.types, type)) throw bad('invalid_training', '沒有這種訓練');
    return this.db.transaction(() => {
      const h = this.syncFromSave(this.requireHero(pid));
      if (!h.active) throw new HttpError(409, 'hero_missing', '英雄魚已不在魚缸，請重新選擇（免費）');
      const t = Date.now(), ready = h.train_ready[type] || 0;
      if (ready > t) throw new HttpError(429, 'training_cooldown', `${T.name}冷卻中，還要 ${Math.ceil((ready - t) / 60000)} 分鐘`, { readyAt: ready });
      const cap = h.level * H.training.capPerStatPerLevel;
      if (T.stat && (h.train[T.stat] || 0) >= cap) throw new HttpError(409, 'training_capped', `${T.name}已達目前等級上限（${cap} 點），升級後可再訓練`);
      const cost = T.coins + T.coinsPerLv * (h.level - 1);
      const spent = this.spendCoins(pid, cost, 'hero_train:' + type);
      if (T.stat) h.train[T.stat] = (h.train[T.stat] || 0) + 1;
      h.train_ready[type] = t + T.cdMin * 60000;
      const lv = this.addXp(h, T.xp);
      this.db.prepare('UPDATE heroes SET train=?, train_ready=?, level=?, xp=?, updated_at=? WHERE player_id=?').run(JSON.stringify(h.train), JSON.stringify(h.train_ready), lv.level, lv.xp, t, pid);
      this.recordPurchase(pid, 'train', type, 'coins', cost, null, null);
      return { ...this.view(player), spent, gained: { xp: T.xp, stat: T.stat, levelUps: lv.levelUps } };
    })();
  }

  equipSkills(player, slots) {
    const pid = player.id, H = this.H;
    if (!Array.isArray(slots)) throw bad('invalid_slots', 'slots 必須是陣列');
    const h = this.requireHero(pid), def = S.speciesDef(this.G, h.species);
    if (!def) throw new HttpError(409, 'hero_missing', '英雄魚資料錯誤');
    const fam = S.familyOf(H, this.G, h.species, def), un = S.unlockedSkills(H, fam, h.level), n = S.slotCount(H, h.level);
    const ids = slots.filter((x) => x != null && x !== '');
    if (ids.length > n) throw bad('too_many_skills', `目前只能裝備 ${n} 個技能`);
    for (const id of ids) if (typeof id !== 'string' || !un.includes(id)) throw bad('skill_locked', `技能「${(H.skills[id] || {}).name || id}」尚未解鎖`);
    if (new Set(ids).size !== ids.length) throw bad('duplicate_skill', '同一個技能不能裝兩次');
    h.skills.slots = ids;
    this.db.prepare('UPDATE heroes SET skills=?, updated_at=? WHERE player_id=?').run(JSON.stringify(h.skills), Date.now(), pid);
    return this.view(player);
  }

  upgradeSkill(player, skillId, idem) {
    const pid = player.id, H = this.H, R = H.skillRank;
    return this.db.transaction(() => {
      if (idem && this.idemCheck(pid, idem)) return this.view(player);
      const h = this.requireHero(pid), def = S.speciesDef(this.G, h.species);
      const fam = S.familyOf(H, this.G, h.species, def);
      if (typeof skillId !== 'string' || !S.unlockedSkills(H, fam, h.level).includes(skillId)) throw bad('skill_locked', '技能尚未解鎖');
      h.skills.ranks = h.skills.ranks || {};
      const cur = h.skills.ranks[skillId] || 1, next = cur + 1;
      if (next > R.max) throw new HttpError(409, 'max_rank', '技能已達最高等級');
      const need = (next - 1) * R.minLevelPerRank;
      if (h.level < need) throw new HttpError(409, 'level_too_low', `需要英雄等級 ${need}`);
      const cost = R.costCoins[next - 1];
      const spent = this.spendCoins(pid, cost, 'hero_skill:' + skillId);
      h.skills.ranks[skillId] = next;
      this.db.prepare('UPDATE heroes SET skills=?, updated_at=? WHERE player_id=?').run(JSON.stringify(h.skills), Date.now(), pid);
      this.recordPurchase(pid, 'skill_rank', skillId + ':' + next, 'coins', cost, null, idem);
      return { ...this.view(player), spent };
    })();
  }

  buyGear(player, itemId, idem) {
    const pid = player.id, H = this.H;
    const it = typeof itemId === 'string' && Object.prototype.hasOwnProperty.call(H.gear, itemId) ? H.gear[itemId] : null;
    if (!it || it.disabled) throw new HttpError(404, 'item_not_found', '找不到這個裝備');
    return this.db.transaction(() => {
      if (idem && this.idemCheck(pid, idem)) return { ...this.view(player), reused: true };
      const h = this.requireHero(pid);
      h.gear.owned = h.gear.owned || {};
      if (h.gear.owned[itemId]) throw new HttpError(409, 'already_owned', `已經擁有「${it.name}」`);
      if (h.level < it.minLevel) throw new HttpError(409, 'level_too_low', `需要英雄等級 ${it.minLevel}`);
      let spent = null, orderId = null;
      if (it.gems != null) { spent = this.spendGems(pid, it.gems, 'hero:gear:' + itemId, '英雄裝備・' + it.name, idem); orderId = spent.orderId; }
      else spent = this.spendCoins(pid, it.coins, 'hero_gear:' + itemId);
      h.gear.owned[itemId] = 1;
      h.gear.equip = h.gear.equip || {};
      if (!h.gear.equip[it.slot]) h.gear.equip[it.slot] = itemId; // 該欄位沒裝東西就自動裝上
      this.db.prepare('UPDATE heroes SET gear=?, updated_at=? WHERE player_id=?').run(JSON.stringify(h.gear), Date.now(), pid);
      this.recordPurchase(pid, 'gear', itemId, it.gems != null ? 'gems' : 'coins', it.gems != null ? it.gems : it.coins, orderId, idem);
      return { ...this.view(player), spent };
    })();
  }

  equipGear(player, slot, itemId) {
    const pid = player.id, H = this.H;
    if (!Object.prototype.hasOwnProperty.call(H.gearSlots, slot)) throw bad('invalid_slot', '裝備欄位錯誤');
    const h = this.requireHero(pid);
    h.gear.equip = h.gear.equip || {};
    if (itemId == null || itemId === '') delete h.gear.equip[slot];
    else {
      const it = H.gear[itemId];
      if (!it || !(h.gear.owned || {})[itemId]) throw new HttpError(409, 'not_owned', '尚未擁有此裝備');
      if (it.slot !== slot) throw bad('wrong_slot', '裝備欄位不符');
      if (h.level < it.minLevel) throw new HttpError(409, 'level_too_low', `需要英雄等級 ${it.minLevel}`);
      h.gear.equip[slot] = itemId;
    }
    this.db.prepare('UPDATE heroes SET gear=?, updated_at=? WHERE player_id=?').run(JSON.stringify(h.gear), Date.now(), pid);
    return this.view(player);
  }

  // ---------- PvP ----------
  pvpReady(player, ip) {
    this.requireMember(player);
    const H = this.H;
    if (H.enabled === false) throw new HttpError(503, 'hero_disabled', '英雄魚對戰暫停中');
    const h = this.syncFromSave(this.requireHero(player.id));
    if (h.pvp_banned_at) throw new HttpError(403, 'pvp_banned', '你的英雄魚已被禁止參加對戰' + (h.pvp_ban_reason ? '：' + h.pvp_ban_reason : ''), { reason: h.pvp_ban_reason || '' });
    if (!h.active) throw new HttpError(409, 'hero_missing', '英雄魚已不在魚缸，請重新選擇（免費）');
    const ih = this.ipHash(ip);
    if (ih && ih !== h.ip_hash) { this.db.prepare('UPDATE heroes SET ip_hash=? WHERE player_id=?').run(ih, player.id); h.ip_hash = ih; }
    return h;
  }

  opponentSnapshot(r) {
    const h = this.heroObj(r);
    const snap = S.snapshot(this.H, this.G, h, { nickname: r.nickname || '神秘魚主', playerId: r.player_id, rating: r.rating });
    return snap;
  }
  npcHero(seed, me) {
    const rnd = mulberry32(seed), G = this.G;
    const ids = Object.keys(G.species).filter((k) => !G.species[k].disabled).sort();
    const sp = ids[Math.floor(rnd() * ids.length)];
    const level = Math.max(1, Math.min(this.H.level.max, me.level + Math.floor(rnd() * 3) - 1));
    const total = Object.values(me.train || {}).reduce((a, b) => a + b, 0), train = {};
    const keys = ['hp', 'atk', 'def', 'spd', 'crit'];
    for (let i = 0; i < Math.floor(total * 0.8); i++) { const k = keys[Math.floor(rnd() * 5)]; if ((train[k] || 0) < level) train[k] = (train[k] || 0) + 1; }
    const names = (G.names && G.names.length ? G.names : ['小藍']);
    const def = G.species[sp];
    return { species: sp, growth: 999, level, train, gear: {}, skills: {}, fish_name: names[Math.floor(rnd() * names.length)], hue: def.look ? def.look.hue : 0 };
  }

  eloDelta(ra, rb, score, k) { const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400)); return k * (score - ea); }

  opponents(player, { refresh = false, ip } = {}) {
    const H = this.H, P = H.pvp, pid = player.id, t = Date.now();
    const me = this.pvpReady(player, ip);
    let offers = this.db.prepare('SELECT * FROM hero_offers WHERE player_id=? ORDER BY created_at').all(pid);
    const fresh = offers.length && t - offers[0].created_at < P.offerTtlSec * 1000;
    if (refresh && offers.length && t - (me.last_refresh || 0) < P.refreshCooldownSec * 1000) throw new HttpError(429, 'refresh_cooldown', '換一批太快了，請稍等幾秒');
    if (!fresh || refresh) {
      const minCreated = t - P.minAccountAgeHours * 3600000;
      const recent = new Map(this.db.prepare('SELECT defender_id d, COUNT(*) n FROM hero_battles WHERE attacker_id=? AND defender_id IS NOT NULL AND created_at>? GROUP BY defender_id').all(pid, t - DAY).map((x) => [x.d, x.n]));
      const rows = this.db.prepare(`SELECT h.*, p.nickname FROM heroes h JOIN players p ON p.id=h.player_id
        WHERE h.player_id<>? AND p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND h.active=1 AND p.created_at<=?
        AND (? IS NULL OR h.ip_hash IS NULL OR h.ip_hash<>?)
        ORDER BY ABS(h.rating-?) LIMIT 60`).all(pid, minCreated, me.ip_hash, me.ip_hash, me.rating)
        .filter((r) => (recent.get(r.player_id) || 0) < P.maxVsSameOpponentPerDay && Math.abs(r.rating - me.rating) <= P.ratingWindow * 3);
      // 從最接近的 3N 人中隨機挑 N 人（每次換一批都不同）
      const pool = rows.slice(0, P.opponents * 3);
      const rnd = mulberry32((crypto.randomBytes(4).readUInt32LE(0)) >>> 0);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const chosen = pool.slice(0, P.opponents);
      this.db.prepare('DELETE FROM hero_offers WHERE player_id=?').run(pid);
      const ins = this.db.prepare('INSERT INTO hero_offers (player_id, opponent_key, data, created_at) VALUES (?,?,?,?)');
      for (const r of chosen) ins.run(pid, 'p:' + r.player_id, null, t);
      if (P.npcFill) for (let i = chosen.length; i < P.opponents; i++) { const seed = crypto.randomBytes(4).readUInt32LE(0) >>> 0; ins.run(pid, 'npc:' + seed, JSON.stringify({ rating: me.rating + Math.floor(rnd() * 120) - 60 }), t); }
      this.db.prepare('UPDATE heroes SET last_refresh=? WHERE player_id=?').run(t, pid);
      offers = this.db.prepare('SELECT * FROM hero_offers WHERE player_id=? ORDER BY created_at').all(pid);
    }
    const k = me.season_battles < P.newBattles ? P.kFactorNew : P.kFactor;
    const list = [];
    for (const o of offers) {
      if (o.opponent_key.startsWith('p:')) {
        const r = this.db.prepare('SELECT h.*, p.nickname FROM heroes h JOIN players p ON p.id=h.player_id WHERE h.player_id=?').get(Number(o.opponent_key.slice(2)));
        if (!r) continue;
        const snap = this.opponentSnapshot(r); if (!snap) continue;
        const rank = S.rankOf(H, r.rating);
        list.push({ key: o.opponent_key, npc: false, nickname: r.nickname || '神秘魚主', rating: r.rating, rank: { key: rank.key, name: rank.name, color: rank.color }, wins: r.wins, losses: r.losses,
          hero: snap, gain: Math.max(P.minDelta, Math.round(this.eloDelta(me.rating, r.rating, 1, k))), loss: Math.round(this.eloDelta(me.rating, r.rating, 0, k)) });
      } else {
        const seed = Number(o.opponent_key.slice(4)), d = J(o.data, {});
        const nh = this.npcHero(seed, me), snap = S.snapshot(H, this.G, nh, { nickname: '野生挑戰者', npc: true });
        const rank = S.rankOf(H, d.rating || me.rating);
        list.push({ key: o.opponent_key, npc: true, nickname: '野生挑戰者（練習）', rating: d.rating || me.rating, rank: { key: rank.key, name: rank.name, color: rank.color }, hero: snap, gain: 0, loss: 0 });
      }
    }
    list.sort((a, b) => b.rating - a.rating);
    const tk = this.tickets(me, t);
    return { opponents: list, tickets: tk.tickets, ticketsMax: P.ticketsMax, nextTicketAt: tk.nextAt, expiresAt: (offers[0] ? offers[0].created_at : t) + P.offerTtlSec * 1000 };
  }

  challenge(player, key, { ip } = {}) {
    this.monthly.tick();
    const H = this.H, P = H.pvp, pid = player.id;
    if (typeof key !== 'string' || !/^(p:\d{1,12}|npc:\d{1,10})$/.test(key)) throw bad('invalid_opponent', '對手不正確');
    const tx = this.db.transaction(() => {
      const t = Date.now();
      const me = this.pvpReady(player, ip);
      const offer = this.db.prepare('SELECT * FROM hero_offers WHERE player_id=? AND opponent_key=?').get(pid, key);
      // 只能挑戰伺服器剛發給你的名單（防止指定小帳刷分）
      if (!offer || t - offer.created_at > P.offerTtlSec * 1000) throw new HttpError(409, 'offer_expired', '對手名單已過期，請重新整理');
      const tk = this.tickets(me, t);
      if (tk.tickets < 1) throw new HttpError(429, 'no_tickets', '挑戰次數用完了，稍後會自動回復', { nextTicketAt: tk.nextAt });
      const flags = [];
      let defRow = null, dSnap, npc = null;
      if (key.startsWith('p:')) {
        defRow = this.db.prepare('SELECT h.*, p.nickname, p.username, p.banned_at FROM heroes h JOIN players p ON p.id=h.player_id WHERE h.player_id=?').get(Number(key.slice(2)));
        if (!defRow || defRow.player_id === pid || !defRow.username || defRow.banned_at || defRow.pvp_banned_at) { this.db.prepare('DELETE FROM hero_offers WHERE player_id=? AND opponent_key=?').run(pid, key); throw new HttpError(409, 'opponent_unavailable', '這位對手目前無法挑戰'); }
        const dh = this.syncFromSave(this.heroObj(defRow));
        if (!dh.active) { this.db.prepare('DELETE FROM hero_offers WHERE player_id=? AND opponent_key=?').run(pid, key); throw new HttpError(409, 'opponent_unavailable', '這位對手的英雄魚已離開魚缸'); }
        const n = this.db.prepare('SELECT COUNT(*) n FROM hero_battles WHERE attacker_id=? AND defender_id=? AND created_at>?').get(pid, defRow.player_id, t - DAY).n;
        if (n >= P.maxVsSameOpponentPerDay) throw new HttpError(429, 'same_opponent_limit', `今天已挑戰這位對手 ${n} 次`);
        dSnap = S.snapshot(H, this.G, dh, { nickname: defRow.nickname || '神秘魚主', playerId: defRow.player_id, rating: defRow.rating });
      } else {
        npc = this.npcHero(Number(key.slice(4)), me);
        dSnap = S.snapshot(H, this.G, npc, { nickname: '野生挑戰者', npc: true, rating: (J(offer.data, {}).rating) || me.rating });
      }
      const aSnap = S.snapshot(H, this.G, me, { nickname: player.nickname || '我', playerId: pid, rating: me.rating });
      if (!aSnap || !dSnap) throw new HttpError(409, 'snapshot_failed', '無法建立戰鬥資料');
      const seed = crypto.randomBytes(4).readUInt32LE(0) >>> 0;
      const res = simulate(aSnap, dSnap, seed, { ...H.battle, rankPer: H.skillRank.perRank }, H.skills);
      const win = res.winner === 0;
      // ---- 積分 ----
      let aDelta = 0, dDelta = 0;
      if (defRow) {
        const k = me.season_battles < P.newBattles ? P.kFactorNew : P.kFactor;
        let raw = this.eloDelta(me.rating, defRow.rating, win ? 1 : 0, k);
        // 同一天反覆打同一人：分數遞減
        const prevWins = this.db.prepare('SELECT COUNT(*) n FROM hero_battles WHERE attacker_id=? AND defender_id=? AND winner=0 AND created_at>?').get(pid, defRow.player_id, t - DAY).n;
        if (win && prevWins > 0) { const dec = P.sameOpponentDecay[Math.min(prevWins, P.sameOpponentDecay.length - 1)]; raw *= dec; flags.push('repeat_opponent'); }
        if (P.sameIpNoRating && me.ip_hash && defRow.ip_hash && me.ip_hash === defRow.ip_hash) { raw = 0; flags.push('same_ip'); }
        aDelta = raw === 0 ? 0 : win ? Math.max(P.minDelta, Math.round(raw)) : Math.min(-P.minDelta, Math.round(raw));
        dDelta = -Math.round(aDelta * P.defenderFactor);
        // 7 天內兩人互打次數過多 → 標記（後台「可疑配對」）
        const pair = this.db.prepare('SELECT COUNT(*) n FROM hero_battles WHERE ((attacker_id=? AND defender_id=?) OR (attacker_id=? AND defender_id=?)) AND created_at>?').get(pid, defRow.player_id, defRow.player_id, pid, t - 7 * DAY).n;
        if (pair + 1 >= P.pairFlagThreshold) flags.push('pair_frequent');
      }
      const xpGain = Math.round((win ? P.xp.win : P.xp.lose) * (npc ? P.npcXpFactor : 1));
      const lv = this.addXp(me, xpGain);
      const newRating = Math.max(0, me.rating + aDelta);
      const tkNew = { tickets: tk.tickets - 1, at: tk.tickets >= P.ticketsMax ? t : tk.at };
      this.db.prepare(`UPDATE heroes SET rating=?, peak_rating=MAX(peak_rating, ?), wins=wins+?, losses=losses+?, season_battles=season_battles+?, tickets=?, tickets_at=?, level=?, xp=?, updated_at=? WHERE player_id=?`)
        .run(newRating, newRating, win ? 1 : 0, win ? 0 : 1, defRow ? 1 : 0, tkNew.tickets, tkNew.at, lv.level, lv.xp, t, pid);
      if (defRow) {
        const dl = win ? { level: defRow.level, xp: defRow.xp } : this.addXp(this.heroObj(defRow), P.xp.defendWin);
        this.db.prepare('UPDATE heroes SET rating=MAX(0, rating+?), def_wins=def_wins+?, def_losses=def_losses+?, level=?, xp=?, updated_at=? WHERE player_id=?').run(dDelta, win ? 0 : 1, win ? 1 : 0, dl.level, dl.xp, t, defRow.player_id);
      }
      this.db.prepare('DELETE FROM hero_offers WHERE player_id=? AND opponent_key=?').run(pid, key);
      const season = this.currentSeason();
      const bid = this.db.prepare(`INSERT INTO hero_battles (season_id, attacker_id, defender_id, npc, seed, sim_version, winner, reason, actions, a_rating, a_delta, d_rating, d_delta, xp, flags, a_snap, d_snap, log, ip_hash, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(season ? season.id : null, pid, defRow ? defRow.player_id : null, npc ? key : null, seed, res.v, res.winner, res.reason, res.actions,
        me.rating, aDelta, defRow ? defRow.rating : null, dDelta, xpGain, JSON.stringify(flags), JSON.stringify(aSnap), JSON.stringify(dSnap), JSON.stringify(res.events), me.ip_hash || null, t).lastInsertRowid;
      this.players.logEvent(pid, 'hero_battle', { id: Number(bid), win, opp: defRow ? defRow.player_id : 'npc', delta: aDelta, flags });
      this.monthly.capture(t);
      const before = S.rankOf(H, me.rating), after = S.rankOf(H, newRating);
      return {
        battle: { id: Number(bid), seed, simVersion: res.v, winner: res.winner, reason: res.reason, actions: res.actions, events: res.events, final: res.final, a: aSnap, d: dSnap, npc: !!npc, flags },
        result: { win, ratingBefore: me.rating, ratingAfter: newRating, delta: aDelta, rankBefore: { key: before.key, name: before.name, color: before.color }, rankAfter: { key: after.key, name: after.name, color: after.color }, rankChanged: before.key !== after.key, xp: xpGain, levelUps: lv.levelUps, level: lv.level },
      };
    });
    const out = tx();
    out.me = this.view(player);
    return out;
  }

  battleRowView(r, viewer) {
    const a = J(r.a_snap, {}), d = J(r.d_snap, {});
    const mine = viewer === r.attacker_id ? 'attacker' : viewer === r.defender_id ? 'defender' : null;
    return { id: r.id, createdAt: r.created_at, attackerId: r.attacker_id, defenderId: r.defender_id, npc: !!r.npc, winner: r.winner, reason: r.reason, actions: r.actions,
      a: { nickname: a.nickname, name: a.name, sp: a.sp, spName: a.spName, hue: a.hue, level: a.level, power: a.power }, d: { nickname: d.nickname, name: d.name, sp: d.sp, spName: d.spName, hue: d.hue, level: d.level, power: d.power },
      aDelta: r.a_delta, dDelta: r.d_delta, aRating: r.a_rating, dRating: r.d_rating, xp: r.xp, flags: J(r.flags, []), mine,
      won: mine === 'attacker' ? r.winner === 0 : mine === 'defender' ? r.winner === 1 : null };
  }
  battles(player, limit = 30) {
    const rows = this.db.prepare('SELECT * FROM hero_battles WHERE attacker_id=? OR defender_id=? ORDER BY id DESC LIMIT ?').all(player.id, player.id, Math.min(100, limit));
    return { battles: rows.map((r) => this.battleRowView(r, player.id)) };
  }
  battle(player, id, { admin = false } = {}) {
    const r = this.db.prepare('SELECT * FROM hero_battles WHERE id=?').get(id);
    if (!r || (!admin && r.attacker_id !== player.id && r.defender_id !== player.id)) throw new HttpError(404, 'not_found', '找不到戰報');
    const v = this.battleRowView(r, player && player.id);
    return { battle: { ...v, seed: r.seed, simVersion: r.sim_version, a: J(r.a_snap, {}), d: J(r.d_snap, {}), events: J(r.log, []) } };
  }
  // 以存下的快照＋種子重新模擬，驗證戰報（確定性檢查）
  verifyBattle(id) {
    const r = this.db.prepare('SELECT * FROM hero_battles WHERE id=?').get(id);
    if (!r) throw new HttpError(404, 'not_found', '找不到戰報');
    const H = this.H;
    const res = simulate(J(r.a_snap, {}), J(r.d_snap, {}), r.seed, { ...H.battle, rankPer: H.skillRank.perRank }, H.skills);
    return { id: r.id, match: JSON.stringify(res.events) === r.log && res.winner === r.winner, winner: res.winner, stored: r.winner };
  }

  leaderboard(player, limit = 50) {
    this.monthly.tick();
    const H = this.H;
    const rows = this.db.prepare(`SELECT h.player_id, h.rating, h.wins, h.losses, h.level, h.species, h.fish_name, h.hue, p.nickname FROM heroes h JOIN players p ON p.id=h.player_id
      WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND (h.wins+h.losses+h.def_wins+h.def_losses)>0 ORDER BY h.rating DESC, h.player_id LIMIT ?`).all(Math.min(200, limit));
    const list = rows.map((r, i) => { const rk = S.rankOf(H, r.rating), def = S.speciesDef(this.G, r.species); return { position: i + 1, playerId: r.player_id, nickname: r.nickname || '神秘魚主', rating: r.rating, rank: { key: rk.key, name: rk.name, color: rk.color }, wins: r.wins, losses: r.losses, level: r.level, species: r.species, spName: def ? def.name : r.species, fishName: r.fish_name, hue: r.hue, me: player ? r.player_id === player.id : false }; });
    let me = null;
    if (player) {
      const h = this.row(player.id);
      if (h) {
        const pos = this.db.prepare(`SELECT COUNT(*) n FROM heroes h JOIN players p ON p.id=h.player_id WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND (h.wins+h.losses+h.def_wins+h.def_losses)>0 AND (h.rating>? OR (h.rating=? AND h.player_id<?))`).get(h.rating, h.rating, h.player_id).n + 1;
        const rk = S.rankOf(H, h.rating);
        me = { position: pos, rating: h.rating, rank: { key: rk.key, name: rk.name, color: rk.color } };
      }
    }
    return { leaderboard: list, me, season: this.currentSeason(), monthlyRewards: this.monthly.info() };
  }

  currentSeason() { const s = this.db.prepare('SELECT * FROM hero_seasons WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get(); return s ? { id: s.id, name: s.name, startedAt: s.started_at, endsAt: s.ends_at } : null; }

  // ---------- 後台 ----------
  // 賽季結算：依段位＋名次寄送獎勵到信箱（沿用既有 rewards／信箱機制），分數軟重置，開新賽季
  closeSeason({ nextName, endsAt } = {}) {
    this.monthly.tick();
    const H = this.H, SS = H.season, P = H.pvp;
    return this.db.transaction(() => {
      const cur = this.db.prepare('SELECT * FROM hero_seasons WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get();
      if (!cur) throw new HttpError(409, 'no_season', '沒有進行中的賽季');
      const rows = this.db.prepare(`SELECT h.* FROM heroes h JOIN players p ON p.id=h.player_id WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND h.season_battles>=? ORDER BY h.rating DESC, h.player_id`).all(SS.minBattles);
      let sent = 0;
      const ins = this.db.prepare('INSERT INTO hero_season_results (season_id, player_id, rating, rank_key, position, battles, reward_id) VALUES (?,?,?,?,?,?,?)');
      rows.forEach((h, i) => {
        const rk = S.rankOf(H, h.rating), base = (SS.rewards || {})[rk.key] || {};
        let coins = base.coins || 0, gems = base.gems || 0;
        const tb = (SS.topBonus || []).slice().sort((a, b) => a.top - b.top).find((x) => i + 1 <= x.top);
        if (tb) { coins += tb.coins || 0; gems += tb.gems || 0; }
        let rewardId = null;
        if (coins || gems) {
          const rw = this.rewards.create({ title: `英雄魚 ${cur.name} 賽季獎勵`, body: `最終段位：${rk.name}（${h.rating} 分，第 ${i + 1} 名）。感謝參與英雄魚對戰！`, target: 'player', playerId: h.player_id, coins, gems });
          rewardId = rw && (rw.id || rw.rewardId || rw);
          sent++;
        }
        ins.run(cur.id, h.player_id, h.rating, rk.key, i + 1, h.season_battles, typeof rewardId === 'number' ? rewardId : null);
      });
      const st = P.startRating, k = SS.softReset;
      this.db.prepare('UPDATE heroes SET rating = ? + CAST(ROUND((rating - ?) * ?) AS INTEGER), season_battles=0').run(st, st, k);
      const t = Date.now();
      this.db.prepare('UPDATE hero_seasons SET closed_at=?, summary=? WHERE id=?').run(t, JSON.stringify({ participants: rows.length, rewarded: sent }), cur.id);
      const nid = this.db.prepare('INSERT INTO hero_seasons (name, started_at, ends_at) VALUES (?,?,?)').run(clampStr(nextName || `第 ${cur.id + 1} 季`, 40), t, endsAt || null).lastInsertRowid;
      return { closed: cur.id, participants: rows.length, rewarded: sent, newSeason: Number(nid) };
    })();
  }
}

module.exports = { HeroService };
