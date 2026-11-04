'use strict';
// 🎣 釣魚後台 v11（/admin/api/fishing/*）：所有數值存在 config.fishing（跟其他遊戲參數一樣有版本、可回復），發布即生效不用部署。
// - GET  /config            目前 config.fishing、實際生效值、預設值、可編輯項目清單
// - POST /config/validate   檢查不存檔
// - PUT  /config            {fishing, note, baseVersion} 驗證 → 新版本 → audit fishing.config.save
// - GET  /stats?day=        今日數據＋近 8 日金幣發出（暴增警示）＋排行
// - GET  /players?q=        id／暱稱查詢；GET /players/:id 詳細（唯讀）
// - POST /players/:id/basket/clear {confirm:'清除', reason}  清掉卡住的魚簍（標記 admin_clear，不發獎勵）＋audit
// - PUT  /tournaments/:id   編輯尚未結算的大賽
// - GET  /audit             釣魚相關後台操作紀錄
const express = require('express');
const { HttpError } = require('./util');
const DATA = require('./fishing/data.json');
const FSELL = require('./fishing-sell');

const TOUR_REWARDS_DEF = [{ from: 1, to: 1, gems: 300, coins: 0 }, { from: 2, to: 3, gems: 120, coins: 0 }, { from: 4, to: 10, gems: 0, coins: 5000 }];
const KINDS = ['cast', 'catch', 'rare'];
const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const isNum = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function priceKeys() {
  const k = new Set(['casts.reset']);
  for (const slot of Object.keys(DATA.gear)) for (const id of Object.keys(DATA.gear[slot])) if (DATA.gear[slot][id].cur !== 'free') k.add(slot + '.' + id);
  for (const id of Object.keys(DATA.chars || {})) if (!['free', 'unlock'].includes(DATA.chars[id].cur)) k.add('char.' + id);
  return k;
}
const PRICE_KEYS = priceKeys();
const PACK_KEYS = new Set(Object.keys(DATA.gear.bait).filter((id) => DATA.gear.bait[id].pack).map((id) => 'bait.' + id));
const EX_BAITS = new Set(Object.keys(DATA.gear.bait).filter((id) => DATA.gear.bait[id].ex));

// 回傳錯誤訊息陣列（中文）；空陣列＝通過
function validateFishing(f, DEF) {
  const e = [];
  if (!isObj(f)) return ['fishing 設定必須是物件'];
  const known = new Set([...Object.keys(DEF), 'sell', 'missions', 'tourRewards', 'alertCoinsDay', 'alertPlayerCoins', 'basketMax']);
  for (const k of Object.keys(f)) if (!known.has(k)) e.push(`不認得的欄位：${k}`);
  for (const k of ['enabled', 'missionsEnabled', 'autoSpecies']) if (f[k] != null && typeof f[k] !== 'boolean') e.push(`${k} 必須是 開／關`);
  if (f.resetGem != null && !isInt(f.resetGem, 0, 5000)) e.push('resetGem 必須是 0～5000 的整數');
  if (f.resetGems != null) { if (!isObj(f.resetGems)) e.push('resetGems 格式錯誤'); else for (const [k, v] of Object.entries(f.resetGems)) { if (!DATA.spots[k]) e.push(`重置價格：沒有釣點 ${k}`); else if (!isInt(v, 0, 5000)) e.push(`重置價格（${DATA.spots[k].name}）必須是 0～5000 的整數`); } }
  if (f.boxCasts != null) { if (!isObj(f.boxCasts)) e.push('boxCasts 格式錯誤'); else for (const [k, v] of Object.entries(f.boxCasts)) { if (!DATA.gear.box[k]) e.push(`每日次數：沒有魚簍 ${k}`); else if (!isInt(v, 1, 50)) e.push(`每日次數（${DATA.gear.box[k].name}）必須是 1～50`); } }
  if (f.prices != null) { if (!isObj(f.prices)) e.push('prices 格式錯誤'); else for (const [k, v] of Object.entries(f.prices)) { if (!PRICE_KEYS.has(k)) e.push(`價格：不認得的項目 ${k}`); else if (!isInt(v, 0, 10000000)) e.push(`價格 ${k} 必須是 0～10,000,000 的整數`); } }
  if (f.packs != null) { if (!isObj(f.packs)) e.push('packs 格式錯誤'); else for (const [k, v] of Object.entries(f.packs)) { if (!PACK_KEYS.has(k)) e.push(`每包次數：不認得的項目 ${k}`); else if (!isInt(v, 1, 100)) e.push(`每包次數 ${k} 必須是 1～100`); } }
  if (f.exRate != null) { if (!isObj(f.exRate)) e.push('exRate 格式錯誤'); else for (const [k, v] of Object.entries(f.exRate)) { if (!EX_BAITS.has(k)) e.push(`掉落率：${k} 不是活動餌`); else if (!isNum(v, 0, 1)) e.push(`掉落率 ${k} 必須介於 0～1（0.14 = 14%）`); } }
  if (f.pityN != null && !isInt(f.pityN, 10, 1000)) e.push('保底竿數必須是 10～1000');
  for (const k of ['albinoPct', 'goldPct', 'giantPct', 'treasurePct', 'bottlePct']) if (f[k] != null && !isNum(f[k], 0, 50)) e.push(`${k} 必須介於 0～50（%）`);
  if ((f.treasurePct || 0) + (f.bottlePct || 0) > 60) e.push('寶箱＋漂流瓶機率合計不能超過 60%');
  if (f.chestGemChance != null && !isNum(f.chestGemChance, 0, 1)) e.push('寶箱出💎機率必須介於 0～1');
  for (const [k, mx] of [['chestGems', 500], ['chestCoins', 1e6], ['bottleCoins', 1e6]]) if (f[k] != null && !(Array.isArray(f[k]) && f[k].length === 2 && f[k].every((v) => isInt(v, 0, mx)) && f[k][0] <= f[k][1])) e.push(`${k} 必須是 [最小, 最大]`);
  if (f.sellMult != null && !isNum(f.sellMult, 0, 10)) e.push('sellMult 必須介於 0～10');
  if (f.perfectMaxPerDay != null && !isInt(f.perfectMaxPerDay, 0, 1000)) e.push('perfectMaxPerDay 必須是 0～1000');
  if (f.basketMax != null && !isInt(f.basketMax, 5, 200)) e.push('魚簍上限必須是 5～200');
  for (const k of ['alertCoinsDay', 'alertPlayerCoins']) if (f[k] != null && !isInt(f[k], 0, 1e9)) e.push(`${k} 必須是整數`);
  if (f.spots != null) {
    if (!isObj(f.spots)) e.push('spots 格式錯誤');
    else for (const [k, s] of Object.entries(f.spots)) {
      if (!DATA.spots[k]) { e.push(`沒有釣點 ${k}`); continue; } const nm = DATA.spots[k].name;
      if (!isObj(s)) { e.push(`釣點 ${nm} 格式錯誤`); continue; }
      for (const x of Object.keys(s)) if (!['lv', 'unlockGem', 'w'].includes(x)) e.push(`釣點 ${nm}：不能改 ${x}`);
      if (s.lv != null && !isInt(s.lv, 1, 200)) e.push(`釣點 ${nm} 等級必須是 1～200`);
      if (s.unlockGem != null && !isInt(s.unlockGem, 0, 100000)) e.push(`釣點 ${nm} 解鎖💎必須是 0～100000`);
      if (s.w != null && !(Array.isArray(s.w) && s.w.length === 4 && s.w.every((v) => isNum(v, 0, 1000)) && s.w[0] + s.w[1] + s.w[2] > 0)) e.push(`釣點 ${nm} 稀有度權重必須是 4 個 ≥0 的數字（普通／稀有／傳說／限定）`);
    }
  }
  if (f.missions != null) {
    if (!Array.isArray(f.missions) || f.missions.length > 6) e.push('每日任務最多 6 個');
    else { const ids = new Set(); f.missions.forEach((m, i) => { const n = `任務 ${i + 1}`;
      if (!isObj(m)) return e.push(`${n} 格式錯誤`);
      if (!/^[a-z0-9_]{1,20}$/.test(m.id || '')) e.push(`${n}：代號只能用英數字與底線（1～20 字）`); else if (ids.has(m.id)) e.push(`${n}：代號重複`); else ids.add(m.id);
      if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 30) e.push(`${n}：名稱 1～30 字`);
      if (!KINDS.includes(m.kind)) e.push(`${n}：種類錯誤`);
      if (!isInt(m.n, 1, 50)) e.push(`${n}：次數 1～50`);
      if (!isInt(m.coins || 0, 0, 5000)) e.push(`${n}：金幣 0～5000`);
      if (!isInt(m.gems || 0, 0, 50)) e.push(`${n}：💎 0～50`);
      if (m.icon != null && (typeof m.icon !== 'string' || m.icon.length > 4)) e.push(`${n}：圖示最多 4 字`); }); }
  }
  if (f.tourRewards != null) e.push(...validateRewards(f.tourRewards));
  e.push(...FSELL.validateSell(f.sell));
  return e;
}
function validateRewards(rw) {
  const e = [];
  if (!Array.isArray(rw) || rw.length > 20) return ['大賽獎勵最多 20 列'];
  rw.forEach((r, i) => { if (!isObj(r) || !isInt(r.from, 1, 10000) || !isInt(r.to, 1, 10000) || r.to < r.from) e.push(`獎勵第 ${i + 1} 列：名次範圍錯誤`); else if (!isInt(r.gems || 0, 0, 5000) || !isInt(r.coins || 0, 0, 5000000)) e.push(`獎勵第 ${i + 1} 列：💎 0～5000、🪙 0～5,000,000`); });
  return e;
}
const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]));
const dayStart = (d) => Date.parse(d + 'T00:00:00+08:00');

class FishingAdmin {
  constructor(svc, ctx, DEF) { this.svc = svc; this.ctx = ctx; this.db = svc.db; this.DEF = DEF; }
  config() {
    const a = this.ctx.configStore.active(), MD = require('./fishing-missions').MISSIONS_DEF;
    const gear = Object.fromEntries(Object.keys(DATA.gear).map((slot) => [slot, Object.fromEntries(Object.entries(DATA.gear[slot]).map(([id, g]) => [id, { name: g.name, cur: g.cur, price: g.price, pack: g.pack || 0, casts: g.casts, legacy: g.legacy ? 1 : 0, ex: g.ex ? { sp: g.ex.sp, p: g.ex.p, name: (DATA.species[g.ex.sp] || {}).name } : null }]))]));
    const chars = Object.fromEntries(Object.entries(DATA.chars || {}).map(([id, c]) => [id, { name: c.name, cur: c.cur, price: c.price }]));
    const spots = Object.fromEntries(Object.entries(DATA.spots).map(([id, s]) => [id, { name: s.name, lv: s.lv, unlockGem: s.unlockGem, w: s.w }]));
    const gc = a.config.species || {}, species = Object.fromEntries(Object.entries(DATA.species).map(([id, d]) => { const g = gc[id] || {}; return [id, { name: d.name || g.name, r: d.r, price: g.price > 0 ? g.price : d.price, sellPrice: g.sellPrice || 0, pet: !!g.specialPet, cmMax: d.cm || null }]; }));
    return { version: a.version, createdAt: a.createdAt, species, stageBonus: (a.config.sell || {}).stageBonus, fishing: a.config.fishing || {}, effective: this.svc.cfg(), defaults: { ...this.DEF, sell: FSELL.SELL_DEF, missions: MD, tourRewards: TOUR_REWARDS_DEF },
      catalog: { gear, chars, spots, kinds: { cast: '完成拋竿', catch: '釣到魚', rare: '釣到稀有以上' }, slotNames: { rod: '魚竿', reel: '捲線器', line: '釣線', float: '浮標', hook: '魚鉤', bait: '魚餌', box: '魚簍', boot: '防滑鞋', wear: '服裝' } } };
  }
  save(req, body) {
    const { fishing, note, baseVersion } = body || {}, a = this.ctx.configStore.active();
    if (baseVersion != null && baseVersion !== a.version) throw new HttpError(409, 'version_conflict', `設定已被更新為 v${a.version}，請重新整理再改`, { version: a.version });
    const errors = validateFishing(fishing, this.DEF);
    if (errors.length) throw new HttpError(422, 'invalid_fishing', '釣魚設定驗證失敗', { errors });
    const cfg = JSON.parse(JSON.stringify(a.config)), before = cfg.fishing || {};
    const keys = changedKeys(before, fishing); if (!keys.length) return { ok: true, version: a.version, unchanged: true };
    cfg.fishing = fishing;
    const v = this.ctx.configStore.save(cfg, ('🎣 釣魚設定：' + String(note || keys.join('、'))).slice(0, 200), 'admin');
    this.ctx.adminAuth.audit(req, 'fishing.config.save', 'v' + v, { from: a.version, keys, note: note || null, before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, fishing[k]])) });
    return { ok: true, version: v, keys };
  }
  stats(dayQ) {
    const today = this.svc.day(), day = /^\d{4}-\d{2}-\d{2}$/.test(dayQ || '') ? dayQ : today, t0 = dayStart(day), t1 = t0 + 86400000;
    const one = (sql, ...a) => this.db.prepare(sql).get(...a);
    const casts = one("SELECT COUNT(*) n, COUNT(DISTINCT player_id) players, SUM(status='caught') caught, SUM(status='lost') lost FROM fishing_casts WHERE day=?", day);
    const catches = one('SELECT COUNT(*) n, SUM(rarity>=2) leg, SUM(variant IS NOT NULL) var FROM fishing_catches WHERE day=?', day);
    const byDest = this.db.prepare('SELECT dest, COUNT(*) n FROM fishing_catches WHERE day=? GROUP BY dest').all(day);
    const ev = this.db.prepare("SELECT player_id, type, data FROM events WHERE type IN ('fishing_catch','fishing_basket_settle','fishing_reset_casts','fishing_mission_claim','fishing_tour_reward') AND created_at>=? AND created_at<?").all(t0, t1);
    const src = { sell: 0, chest: 0, bottle: 0, basket: 0, mission: 0, tour: 0 }, per = new Map(); let sells = 0, resets = 0, resetGems = 0;
    for (const r of ev) { let d = {}; try { d = JSON.parse(r.data || '{}') || {}; } catch (e) { /* */ }
      let c = 0;
      if (r.type === 'fishing_catch') { c = d.coins || 0; if (d.kind === 'chest') src.chest += c; else if (d.kind === 'bottle') src.bottle += c; else if (d.dest === 'sell') { src.sell += c; sells++; } }
      else if (r.type === 'fishing_basket_settle') { c = d.coins || 0; src.basket += c; sells += (d.dest || []).filter((x) => x === 'sell').length; }
      else if (r.type === 'fishing_mission_claim') { c = d.coins || 0; src.mission += c; }
      else if (r.type === 'fishing_tour_reward') { c = d.coins || 0; src.tour += c; }
      else if (r.type === 'fishing_reset_casts') { resets++; resetGems += d.gems || 0; }
      if (c) { const m = per.get(r.player_id) || { coins: 0 }; m.coins += c; per.set(r.player_id, m); } }
    const coinsOut = Object.values(src).reduce((a, b) => a + b, 0);
    const gemsSpent = one("SELECT COALESCE(SUM(-delta),0) n FROM gem_ledger WHERE reason='spend' AND ref LIKE 'fishing:%' AND created_at>=? AND created_at<?", t0, t1).n;
    const gemsOut = one("SELECT COALESCE(SUM(delta),0) n FROM gem_ledger WHERE reason IN ('bonus:fishing_chest','bonus:fishing_tour','bonus:fishing_mission') AND created_at>=? AND created_at<?", t0, t1).n;
    // 近 8 日金幣發出（暴增警示）
    const series = [];
    for (let i = 7; i >= 0; i--) { const d = this.svc.day(t0 - i * 86400000 + 12 * 3600e3), a = dayStart(d), b = a + 86400000;
      const rows = this.db.prepare("SELECT data FROM events WHERE type IN ('fishing_catch','fishing_basket_settle','fishing_mission_claim','fishing_tour_reward') AND created_at>=? AND created_at<?").all(a, b);
      series.push({ day: d, coins: rows.reduce((s, r) => { try { return s + ((JSON.parse(r.data || '{}') || {}).coins || 0); } catch (e) { return s; } }, 0), casts: one('SELECT COUNT(*) n FROM fishing_casts WHERE day=?', d).n }); }
    const prev = series.slice(0, -1).map((x) => x.coins).sort((a, b) => a - b), med = prev.length ? prev[Math.floor(prev.length / 2)] : 0, c = this.svc.cfg();
    const lim = c.alertCoinsDay != null ? c.alertCoinsDay : 300000, plim = c.alertPlayerCoins != null ? c.alertPlayerCoins : 100000;
    const alerts = [];
    if (coinsOut > lim && coinsOut > med * 3) alerts.push({ level: 'bad', text: `今日金幣發出 🪙${coinsOut.toLocaleString()}，是前 7 日中位數（🪙${med.toLocaleString()}）的 ${med ? (coinsOut / med).toFixed(1) : '∞'} 倍，超過警示門檻 🪙${lim.toLocaleString()}` });
    const name = (pid) => { const p = this.ctx.players.get(pid) || { id: pid }; return this.svc.displayName(p); };
    const topCoins = [...per.entries()].sort((a, b) => b[1].coins - a[1].coins).slice(0, 10).map(([pid, m]) => ({ id: pid, name: name(pid), coins: m.coins }));
    for (const p of topCoins) if (p.coins > plim) alerts.push({ level: 'warn', text: `玩家 #${p.id}「${p.name}」今日從釣魚拿到 🪙${p.coins.toLocaleString()}（門檻 🪙${plim.toLocaleString()}）` });
    const topCatch = this.db.prepare('SELECT player_id id, COUNT(*) n, ROUND(SUM(kg),1) kg, SUM(points) pts FROM fishing_catches WHERE day=? GROUP BY player_id ORDER BY n DESC, pts DESC LIMIT 10').all(day).map((r) => ({ ...r, name: name(r.id) }));
    return { day, today, casts: casts.n || 0, players: casts.players || 0, caught: casts.caught || 0, lost: casts.lost || 0, catches: catches.n || 0, legendary: catches.leg || 0, variants: catches.var || 0, byDest, sells, resets, resetGems, gemsSpent, gemsOut, coinsOut, coinsBySource: src, series, median7: med, alerts, topCoins, topCatch, thresholds: { day: lim, player: plim } };
  }
  findPlayers(q) {
    q = String(q || '').trim().slice(0, 40); if (!q) return { rows: [] };
    const rows = /^\d+$/.test(q) ? this.db.prepare('SELECT id, nickname, created_at FROM players WHERE id=?').all(Number(q)) : this.db.prepare('SELECT id, nickname, created_at FROM players WHERE nickname LIKE ? ORDER BY id DESC LIMIT 30').all('%' + q + '%');
    return { rows: rows.map((r) => ({ id: r.id, nickname: r.nickname, name: this.svc.displayName(r), fishing: !!this.db.prepare('SELECT 1 FROM fishing_profile WHERE player_id=?').get(r.id), casts: this.db.prepare('SELECT COUNT(*) n FROM fishing_casts WHERE player_id=?').get(r.id).n })) };
  }
  player(pid) {
    const pl = this.ctx.players.get(pid); if (!pl) throw new HttpError(404, 'not_found', '找不到這位玩家');
    this.svc.basketInit();
    const has = !!this.db.prepare('SELECT 1 FROM fishing_profile WHERE player_id=?').get(pid), p = this.svc.profile(pid);
    const all = (sql, ...a) => this.db.prepare(sql).all(...a);
    const ev = (types, n) => all(`SELECT type, data, created_at FROM events WHERE player_id=? AND type IN (${types.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ${n}`, pid, ...types).map((r) => ({ ...r, data: (() => { try { return JSON.parse(r.data || 'null'); } catch (e) { return null; } })() }));
    const tot = this.db.prepare("SELECT COUNT(*) casts, SUM(status='caught') caught, SUM(status='lost') lost, SUM(status='rejected') rejected FROM fishing_casts WHERE player_id=?").get(pid);
    return {
      player: { id: pl.id, nickname: pl.nickname, name: this.svc.displayName(pl), createdAt: pl.created_at }, hasProfile: has,
      profile: { lv: p.lv, xp: p.xp, xpNeed: this.svc.xpNeedOf ? this.svc.xpNeedOf(p.lv) : null, eq: p.eq, own: p.own, baits: p.baits, chars: Object.keys(p.chars || {}), char: p.char, unlocked: p.unlocked, stats: p.stats, pity: p.pity || {} },
      totals: tot, today: this.svc.daily(pid), maxCasts: this.svc.maxCasts(p), pityN: this.svc.cfg().pityN || 100,
      basket: all('SELECT id, cast_id, spot, outcome, created_at FROM fishing_basket WHERE player_id=? AND settled_at IS NULL ORDER BY id', pid).map((r) => { const o = JSON.parse(r.outcome); return { id: r.id, sp: o.id, name: (DATA.species[o.id] || {}).name, r: o.r, cm: o.cm, kg: o.kg, variant: o.variant || null, spot: r.spot, t: r.created_at }; }),
      basketSettled: all('SELECT id, outcome, dest, coins, created_at, settled_at FROM fishing_basket WHERE player_id=? AND settled_at IS NOT NULL ORDER BY settled_at DESC LIMIT 20', pid).map((r) => { const o = JSON.parse(r.outcome); return { id: r.id, sp: o.id, name: (DATA.species[o.id] || {}).name, dest: r.dest, coins: r.coins, t: r.settled_at }; }),
      catches: all('SELECT id, day, spot, sp, rarity, cm, kg, variant, giant, points, dest, fight_ms, created_at FROM fishing_catches WHERE player_id=? ORDER BY id DESC LIMIT 60', pid).map((r) => ({ ...r, name: (DATA.species[r.sp] || {}).name })),
      resets: ev(['fishing_reset_casts'], 30),
      ledger: all("SELECT delta, balance_after, reason, ref, created_at FROM gem_ledger WHERE player_id=? AND (ref LIKE 'fishing:%' OR reason LIKE 'bonus:fishing%') ORDER BY id DESC LIMIT 60", pid),
      events: ev(['fishing_catch', 'fishing_basket_settle', 'fishing_mission_claim', 'fishing_tour_reward', 'fishing_too_fast', 'fishing_basket_admin_clear'], 60),
      missions: all('SELECT day, mission, coins, gems, created_at FROM fishing_mission_claims WHERE player_id=? ORDER BY created_at DESC LIMIT 20', pid),
    };
  }
  clearBasket(req, pid, body) {
    if (!body || body.confirm !== '清除') throw new HttpError(400, 'confirm', '請輸入「清除」確認');
    const reason = String(body.reason || '').trim().slice(0, 100); if (!reason) throw new HttpError(400, 'reason', '請填寫原因');
    this.svc.basketInit();
    const t = Date.now();
    const out = this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id, cast_id, outcome FROM fishing_basket WHERE player_id=? AND settled_at IS NULL').all(pid);
      if (!rows.length) throw new HttpError(409, 'empty', '這位玩家的魚簍是空的');
      const up = this.db.prepare("UPDATE fishing_basket SET settled_at=?, dest='admin_clear', coins=0 WHERE id=? AND settled_at IS NULL"), upc = this.db.prepare("UPDATE fishing_catches SET dest='admin_clear' WHERE cast_id=? AND player_id=?");
      for (const r of rows) { up.run(t, r.id); upc.run(r.cast_id, pid); }
      const items = rows.map((r) => { const o = JSON.parse(r.outcome); return { id: r.id, sp: o.id, cm: o.cm }; });
      this.ctx.players.logEvent(pid, 'fishing_basket_admin_clear', { n: rows.length, reason });
      return { ok: true, cleared: rows.length, items };
    })();
    this.ctx.adminAuth.audit(req, 'fishing.basket.clear', 'player:' + pid, { reason, ...out });
    return out;
  }
  updateTour(id, b) {
    const T = this.db.prepare('SELECT * FROM fishing_tournaments WHERE id=?').get(id);
    if (!T) throw new HttpError(404, 'not_found', '找不到這場大賽');
    if (T.status !== 'scheduled') throw new HttpError(409, 'state', '已結算或已取消的大賽不能修改');
    const now = this.svc.now(), started = T.start_at <= now;
    const name = b.name != null ? String(b.name).trim().slice(0, 30) : T.name; if (!name) throw new HttpError(400, 'name', '請輸入名稱');
    const start = b.startAt != null ? Number(b.startAt) : T.start_at, end = b.endAt != null ? Number(b.endAt) : T.end_at;
    if (started && start !== T.start_at) throw new HttpError(409, 'started', '大賽已開始，不能改開始時間');
    if (started && b.spot !== undefined && (b.spot || null) !== T.spot) throw new HttpError(409, 'started', '大賽已開始，不能改釣點');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 14 * 86400000) throw new HttpError(400, 'time', '時間不正確（最長 14 天）');
    if (end <= now) throw new HttpError(400, 'time', '結束時間必須晚於現在（要提早結束請按「結束」）');
    const spot = b.spot !== undefined ? (b.spot || null) : T.spot; if (spot && !DATA.spots[spot]) throw new HttpError(400, 'spot', '釣點不存在');
    let rewards = JSON.parse(T.rewards); if (b.rewards != null) { const er = validateRewards(b.rewards); if (er.length) throw new HttpError(422, 'rewards', er[0]); rewards = b.rewards.map((r) => ({ from: r.from, to: r.to, gems: r.gems || 0, coins: r.coins || 0 })); }
    if (this.db.prepare("SELECT 1 FROM fishing_tournaments WHERE status='scheduled' AND id<>? AND start_at<? AND end_at>?").get(id, end, start)) throw new HttpError(400, 'overlap', '與其他大賽時間重疊');
    this.db.prepare('UPDATE fishing_tournaments SET name=?, spot=?, start_at=?, end_at=?, rewards=? WHERE id=?').run(name, spot, start, end, JSON.stringify(rewards), id);
    return { before: { name: T.name, spot: T.spot, startAt: T.start_at, endAt: T.end_at, rewards: JSON.parse(T.rewards) }, after: this.svc.tourPublic(null, id) };
  }
  // 提早結束：把結束時間改成現在（之後可按結算發獎）
  endTour(id) {
    const T = this.db.prepare('SELECT * FROM fishing_tournaments WHERE id=?').get(id), now = this.svc.now();
    if (!T || T.status !== 'scheduled') throw new HttpError(409, 'state', '只能結束進行中／尚未結算的大賽');
    if (T.start_at > now) throw new HttpError(409, 'state', '大賽還沒開始，請用「取消」');
    this.db.prepare('UPDATE fishing_tournaments SET end_at=? WHERE id=? AND end_at>?').run(now, id, now);
    return { ok: true, endAt: Math.min(now, T.end_at) };
  }
  // ---------- 補發道具（寫入 fishing_admin_grants＋audit＋信箱通知） ----------
  grantCatalog() {
    const SL = { rod: '魚竿', reel: '捲線器', line: '釣線', float: '浮標', hook: '魚鉤', boot: '防滑鞋', wear: '服裝', box: '魚簍', bait: '魚餌' };
    const gear = [];
    for (const slot of Object.keys(DATA.gear)) for (const [id, g] of Object.entries(DATA.gear[slot])) if (g.cur !== 'free' && !g.legacy) gear.push({ kind: slot === 'bait' ? 'bait' : 'gear', slot, id, name: g.name, slotName: SL[slot] || slot, pack: g.pack || 0, event: !!g.ex });
    return { items: gear, extra: [{ kind: 'casts', name: '今日加拋竿次數', max: 50 }, { kind: 'resets', name: '免費重置（今日立刻補滿 N 次份）', max: 10 }] };
  }
  grant(req, pid, b) {
    const pl = this.ctx.players.get(pid); if (!pl) throw new HttpError(404, 'not_found', '找不到這位玩家');
    b = b || {};
    if (b.confirm !== '補發') throw new HttpError(400, 'confirm', '請輸入「補發」確認');
    const reason = String(b.reason || '').trim().slice(0, 120); if (reason.length < 2) throw new HttpError(400, 'reason', '請填寫補發原因（至少 2 個字）');
    const kind = String(b.kind || ''), qty = Number(b.qty);
    const admin = String((req.admin && (req.admin.name || req.admin.user || req.admin.label)) || 'admin').slice(0, 40);
    let item, label, apply;
    const p = this.svc.profile(pid);
    if (kind === 'gear') {
      const slot = String(b.slot || ''), id = String(b.id || ''), g = DATA.gear[slot] && DATA.gear[slot][id];
      if (!g || slot === 'bait' || g.cur === 'free') throw new HttpError(400, 'item', '道具不存在');
      if (qty !== 1) throw new HttpError(400, 'qty', '裝備數量只能是 1');
      if (p.own[slot] && p.own[slot][id]) throw new HttpError(409, 'owned', '玩家已經擁有這個裝備');
      item = slot + '.' + id; label = g.name; apply = () => { (p.own[slot] = p.own[slot] || {})[id] = 1; this.svc.saveProfile(pid, p); };
    } else if (kind === 'bait') {
      const id = String(b.id || ''), g = DATA.gear.bait[id];
      if (!g || g.cur === 'free') throw new HttpError(400, 'item', '魚餌不存在');
      if (!isInt(qty, 1, 500)) throw new HttpError(400, 'qty', '魚餌次數 1～500');
      item = 'bait.' + id; label = `${g.name} ×${qty} 次`; apply = () => { p.baits[id] = (p.baits[id] || 0) + qty; this.svc.saveProfile(pid, p); };
    } else if (kind === 'casts' || kind === 'resets') {
      const max = kind === 'casts' ? 50 : 10; if (!isInt(qty, 1, max)) throw new HttpError(400, 'qty', `數量 1～${max}`);
      const per = kind === 'casts' ? 1 : this.svc.maxCasts(p), add = qty * per;
      item = kind; label = kind === 'casts' ? `今日拋竿次數 +${qty}` : `免費重置 ×${qty}（今日 +${add} 次）`;
      apply = () => { const d = this.svc.daily(pid); d.extra += add; this.svc.saveDaily(d); };
    } else throw new HttpError(400, 'kind', '補發種類錯誤');
    const t = Date.now();
    const out = this.db.transaction(() => {
      apply();
      const title = '🎣 釣魚補發：' + label, body = `已補發到你的釣魚帳號：${label}\n原因：${reason}\n道具已直接放進釣魚背包，打開🎣釣魚就能使用（這封信按「領取」只是標記已讀）。`;
      const mid = Number(this.db.prepare("INSERT INTO rewards(title,body,coins,gems,fish,items,target,filter,recipients,created_at,expires_at) VALUES(?,?,0,0,'[]',?, 'filter', ?, 1, ?, ?)").run(title, body, JSON.stringify({ decorations: [] }), 'fishing-grant:' + pid + ':' + t, t, t + 30 * 86400000).lastInsertRowid);
      this.db.prepare('INSERT INTO reward_targets(reward_id,player_id) VALUES(?,?)').run(mid, pid);
      const gid = Number(this.db.prepare('INSERT INTO fishing_admin_grants(player_id,admin,kind,item,qty,reason,mail_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(pid, admin, kind, item, qty, reason, mid, JSON.stringify({ label }), t).lastInsertRowid);
      this.ctx.players.logEvent(pid, 'fishing_admin_grant', { grant: gid, kind, item, qty });
      return { ok: true, grantId: gid, mailId: mid, label };
    })();
    this.ctx.adminAuth.audit(req, 'fishing.grant', 'player:' + pid, { admin, kind, item, qty, reason, grantId: out.grantId, mailId: out.mailId });
    return out;
  }
  // ---------- 玩家完整釣魚紀錄（唯讀，分頁＋篩選） ----------
  records(pid, q) {
    const pl = pid==null?null:this.ctx.players.get(pid); if (pid!=null&&!pl) throw new HttpError(404, 'not_found', '找不到這位玩家');
    this.svc.basketInit();
    const type = ['casts', 'resets', 'missions', 'grants', 'buys'].includes(q.type) ? q.type : 'casts';
    const size = Math.min(100, Math.max(10, Number(q.size) || 30)), page = Math.max(1, Number(q.page) || 1), off = (page - 1) * size;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? dayStart(q.from) : 0, to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? dayStart(q.to) + 86400000 : 9e15;
    const J = (x) => { try { return JSON.parse(x || 'null'); } catch (e) { return null; } };
    let total = 0, rows = [];
    if (type === 'casts') {
      const w = ['f.created_at>=?', 'f.created_at<?'], a = [from, to];if(pid!=null){w.push('f.player_id=?');a.push(pid)}
      if (q.spot && DATA.spots[q.spot]) { w.push('f.spot=?'); a.push(q.spot); }
      if (q.rarity !== undefined && q.rarity !== '' && isInt(Number(q.rarity), 0, 3)) { w.push("json_extract(f.outcome,'$.kind')='fish' AND json_extract(f.outcome,'$.r')=?"); a.push(Number(q.rarity)); }
      if (q.variant === 'gold' || q.variant === 'albino') { w.push("json_extract(f.outcome,'$.variant')=?"); a.push(q.variant); } else if (q.variant === 'any') w.push("json_extract(f.outcome,'$.variant') IS NOT NULL");
      if (q.status && ['caught', 'lost', 'expired', 'rejected', 'pending'].includes(q.status)) { w.push('f.status=?'); a.push(q.status); }
      const W = w.join(' AND ');
      total = this.db.prepare(`SELECT COUNT(*) n FROM fishing_casts f WHERE ${W}`).get(...a).n;
      const list = this.db.prepare(`SELECT f.id, f.player_id, f.spot, f.bait, f.gear, f.perfect, f.outcome, f.status, f.dest, f.created_at, f.resolved_at, c.dest cdest, c.fight_ms, c.points, b.dest bdest, b.coins bcoins, b.settled_at bset FROM fishing_casts f LEFT JOIN fishing_catches c ON c.cast_id=f.id LEFT JOIN fishing_basket b ON b.cast_id=f.id WHERE ${W} ORDER BY f.created_at DESC,f.id DESC LIMIT ? OFFSET ?`).all(...a, size, off);
      const ids = list.map((r) => r.id), ev = new Map();
      if (ids.length) for (const e of this.db.prepare(`SELECT json_extract(data,'$.cast') c, json_extract(data,'$.coins') coins, json_extract(data,'$.gems') gems FROM events WHERE (? IS NULL OR player_id=?) AND type='fishing_catch' AND created_at>=? AND json_extract(data,'$.cast') IN (${ids.map(() => '?').join(',')})`).all(pid,pid, Math.min(...list.map((r) => r.created_at)), ...ids)) ev.set(e.c, e);
      rows = list.map((r) => { const o = J(r.outcome) || {}, e = ev.get(r.id) || {}, sp = o.kind === 'fish' ? DATA.species[o.id] : null;
        const final = r.bdest ? (r.bset ? r.bdest : 'basket_open') : (r.cdest || r.dest || null);
        return {playerId:r.player_id,playerName:this.svc.displayName(this.ctx.players.get(r.player_id)||{id:r.player_id}), id: r.id, t: r.created_at, spot: r.spot, bait: r.bait, gear: J(r.gear), perfect: !!r.perfect, status: r.status, kind: o.kind, sp: o.id || null, name: sp ? sp.name : o.kind === 'chest' ? '寶箱' : o.kind === 'bottle' ? '漂流瓶' : null, r: o.r, cm: o.cm, kg: o.kg, variant: o.variant || null, giant: !!o.giant, firstDest: r.dest, dest: final, coins: r.bdest ? r.bcoins : e.coins || 0, gems: e.gems || 0, fightMs: r.fight_ms, points: r.points }; });
    } else if (type === 'resets' || type === 'buys' || type === 'missions') {
      const types = type === 'resets' ? ['fishing_reset_casts'] : type === 'buys' ? ['fishing_buy_gear', 'fishing_buy_char', 'fishing_buy_spot'] : ['fishing_mission_claim'];
      const W = `player_id=? AND type IN (${types.map(() => '?').join(',')}) AND created_at>=? AND created_at<?`, a = [pid, ...types, from, to];
      total = this.db.prepare(`SELECT COUNT(*) n FROM events WHERE ${W}`).get(...a).n;
      rows = this.db.prepare(`SELECT type, data, created_at t FROM events WHERE ${W} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...a, size, off).map((r) => ({ type: r.type, t: r.t, ...(J(r.data) || {}) }));
    } else {
      const W = 'player_id=? AND created_at>=? AND created_at<?', a = [pid, from, to];
      total = this.db.prepare(`SELECT COUNT(*) n FROM fishing_admin_grants WHERE ${W}`).get(...a).n;
      rows = this.db.prepare(`SELECT id, admin, kind, item, qty, reason, mail_id, detail, created_at t FROM fishing_admin_grants WHERE ${W} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...a, size, off).map((r) => ({ ...r, label: (J(r.detail) || {}).label || r.item }));
    }
    return { type, page, size, total, pages: Math.max(1, Math.ceil(total / size)), rows };
  }
  summary(pid) {
    const one = (sql, ...a) => this.db.prepare(sql).get(...a);
    const casts = one("SELECT COUNT(*) n, SUM(status='caught') caught, SUM(status='lost') lost, SUM(status IN ('expired','rejected')) bad, MIN(created_at) first, MAX(created_at) last FROM fishing_casts WHERE player_id=?", pid);
    const fish = one('SELECT COUNT(*) n, SUM(variant IS NOT NULL) var, SUM(giant) giant, ROUND(SUM(kg),1) kg FROM fishing_catches WHERE player_id=?', pid);
    const rare = this.db.prepare('SELECT sp, rarity, cm, kg, variant, giant, spot, created_at FROM fishing_catches WHERE player_id=? ORDER BY rarity DESC, (variant IS NOT NULL) DESC, kg DESC LIMIT 1').get(pid);
    let coinsEarned = 0, coinsSpent = 0;
    for (const r of this.db.prepare("SELECT type, data FROM events WHERE player_id=? AND type IN ('fishing_catch','fishing_basket_settle','fishing_mission_claim','fishing_tour_reward','fishing_buy_gear','fishing_buy_char')").all(pid)) { let d = {}; try { d = JSON.parse(r.data || '{}') || {}; } catch (e) { /* */ } if (r.type.startsWith('fishing_buy')) coinsSpent += d.coins || 0; else coinsEarned += d.coins || 0; }
    const gemsSpent = one("SELECT COALESCE(SUM(-delta),0) n FROM gem_ledger WHERE player_id=? AND reason='spend' AND ref LIKE 'fishing:%'", pid).n;
    const gemsEarned = one("SELECT COALESCE(SUM(delta),0) n FROM gem_ledger WHERE player_id=? AND reason LIKE 'bonus:fishing%'", pid).n;
    const resets = one("SELECT COUNT(*) n, COALESCE(SUM(json_extract(data,'$.gems')),0) g FROM events WHERE player_id=? AND type='fishing_reset_casts'", pid);
    const grants = one('SELECT COUNT(*) n FROM fishing_admin_grants WHERE player_id=?', pid).n;
    const p = this.svc.profile(pid), pityN = this.svc.cfg().pityN || 100;
    const pity = Object.keys(DATA.gear.bait).filter((k) => DATA.gear.bait[k].ex).map((k) => ({ bait: k, name: DATA.gear.bait[k].name, n: (p.pity || {})[k] || 0, of: pityN, left: (p.baits || {})[k] || 0, fish: (DATA.species[DATA.gear.bait[k].ex.sp] || {}).name }));
    return { casts, fish, rarest: rare ? { ...rare, name: (DATA.species[rare.sp] || {}).name } : null, coinsEarned, coinsSpent, gemsSpent, gemsEarned, resets, grants, pity };
  }
  audit(limit = 200) {
    return { rows: this.db.prepare("SELECT id, at, action, target, detail FROM audit_log WHERE action LIKE 'fishing.%' OR (action IN ('config.save','config.rollback') AND detail LIKE '%🎣%') ORDER BY id DESC LIMIT ?").all(limit).map((r) => ({ ...r, detail: (() => { try { return JSON.parse(r.detail || 'null'); } catch (e) { return r.detail; } })() })) };
  }
}

function mountAdmin(app, svc, ctx, wrap, DEF) {
  const fa = svc.admin = new FishingAdmin(svc, ctx, DEF);
  const a = express.Router();
  a.use(ctx.adminAuth.require(), express.json({ limit: '128kb' }));
  a.get('/config', wrap(() => fa.config()));
  a.post('/config/validate', wrap((req) => ({ errors: validateFishing((req.body || {}).fishing, DEF) })));
  a.put('/config', wrap((req) => fa.save(req, req.body)));
  a.get('/stats', wrap((req) => fa.stats(req.query.day)));
  a.get('/players', wrap((req) => fa.findPlayers(req.query.q)));
  a.get('/players/:id', wrap((req) => fa.player(Number(req.params.id) || 0)));
  a.post('/players/:id/basket/clear', wrap((req) => fa.clearBasket(req, Number(req.params.id) || 0, req.body)));
  a.put('/tournaments/:id', wrap((req) => { const out = fa.updateTour(Number(req.params.id) || 0, req.body || {}); ctx.adminAuth.audit(req, 'fishing.tournament.update', 'fishing-tour:' + req.params.id, out); return out.after; }));
  a.post('/tournaments/:id/end', wrap((req) => { const out = fa.endTour(Number(req.params.id) || 0); ctx.adminAuth.audit(req, 'fishing.tournament.end', 'fishing-tour:' + req.params.id, out); return out; }));
  a.get('/audit', wrap(() => fa.audit()));
  a.get('/grant-catalog', wrap(() => fa.grantCatalog()));
  a.post('/players/:id/grant', wrap((req) => fa.grant(req, Number(req.params.id) || 0, req.body)));
  a.get('/records',wrap(req=>{const q=req.query||{};if(q.playerId&&!/^\d+$/.test(q.playerId))throw new HttpError(400,'player_id','請填寫正確玩家 ID');return fa.records(q.playerId?Number(q.playerId):null,{...q,type:'casts'})}));
  a.get('/players/:id/records', wrap((req) => fa.records(Number(req.params.id) || 0, req.query || {})));
  a.get('/players/:id/summary', wrap((req) => fa.summary(Number(req.params.id) || 0)));
  app.use('/admin/api/fishing', a);
  return fa;
}

module.exports = { mountAdmin, validateFishing, validateRewards, FishingAdmin, TOUR_REWARDS_DEF };
