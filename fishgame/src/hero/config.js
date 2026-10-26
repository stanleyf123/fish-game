'use strict';
// 英雄魚設定：驗證、版本化儲存（hero_config_versions）、公開版本（給遊戲端）
const { HttpError } = require('../util');
const { HERO_DEFAULT_CONFIG } = require('./default-config');

const STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'crit'];
const BUFF_STATS = ['atk', 'def', 'spd', 'crit', 'dodge', 'critDmg'];
const MOD_KEYS = ['hpPct', 'atkPct', 'defPct', 'spdPct', 'crit', 'critDmg', 'dodge'];
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

function validateHeroConfig(c) {
  const e = [];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const num = (path, v, min, max) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) e.push(`${path} 必須是 ${min}–${max} 的數字（目前：${JSON.stringify(v)}）`); };
  const int = (path, v, min, max) => { if (!Number.isInteger(v) || v < min || v > max) e.push(`${path} 必須是 ${min}–${max} 的整數（目前：${JSON.stringify(v)}）`); };
  if (!isObj(c)) return ['設定必須是物件'];
  for (const k of ['base', 'normalize', 'traits', 'level', 'families', 'skills', 'training', 'gear', 'gearSlots', 'battle', 'pvp', 'season', 'change', 'skillSlots', 'skillRank']) if (!isObj(c[k])) e.push(`缺少 ${k}`);
  if (!Array.isArray(c.ranks) || !c.ranks.length) e.push('ranks 必須是非空陣列');
  if (e.length) return e;
  const B = c.base;
  int('base.hp', B.hp, 50, 100000); int('base.atk', B.atk, 1, 10000); int('base.def', B.def, 0, 10000); int('base.spd', B.spd, 10, 1000);
  int('base.crit', B.crit, 0, 750); int('base.critDmg', B.critDmg, 100, 400); int('base.dodge', B.dodge, 0, 500);
  num('normalize.rarityBonus', c.normalize.rarityBonus, 0, 0.5);
  if (c.normalize.spdExp != null) num('normalize.spdExp', c.normalize.spdExp, 0.5, 3);
  if (c.normalize.defExp != null) num('normalize.defExp', c.normalize.defExp, 0.5, 3);
  if (!Array.isArray(c.stage) || c.stage.length !== 3) e.push('stage 需為 3 個數字（幼魚／亞成／成年）'); else c.stage.forEach((v, i) => num(`stage[${i}]`, v, 0.3, 2));
  const L = c.level; int('level.max', L.max, 1, 200); num('level.xpBase', L.xpBase, 1, 1e6); num('level.xpExp', L.xpExp, 0.5, 3);
  for (const k of ['hpPerLv', 'atkPerLv', 'defPerLv']) num('level.' + k, L[k], 0, 1);
  const sk = c.skills;
  for (const [id, s] of Object.entries(sk)) {
    const p = `skills.${id}`;
    if (!ID_RE.test(id)) e.push(`${p}：代號只能用小寫英數與底線`);
    if (!isObj(s)) { e.push(`${p} 必須是物件`); continue; }
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 20) e.push(`${p}.name 需為 1–20 字`);
    int(p + '.cd', s.cd, 0, 20);
    if (s.mult != null) num(p + '.mult', s.mult, 0.05, 10);
    if (s.hits != null) int(p + '.hits', s.hits, 1, 8);
    if (s.pierce != null) num(p + '.pierce', s.pierce, 0, 1);
    if (s.stun != null) num(p + '.stun', s.stun, 0, 1);
    if (s.heal != null) num(p + '.heal', s.heal, 0, 1);
    if (s.shield != null) num(p + '.shield', s.shield, 0, 1);
    if (s.recoil != null) num(p + '.recoil', s.recoil, 0, 1);
    if (s.lifesteal != null) num(p + '.lifesteal', s.lifesteal, 0, 1);
    if (s.bleed != null) { if (!isObj(s.bleed)) e.push(p + '.bleed 必須是物件'); else { num(p + '.bleed.pct', s.bleed.pct, 0, 2); int(p + '.bleed.turns', s.bleed.turns, 1, 10); } }
    if (s.reflect != null) { if (!isObj(s.reflect)) e.push(p + '.reflect 必須是物件'); else { num(p + '.reflect.pct', s.reflect.pct, 0, 2); int(p + '.reflect.turns', s.reflect.turns, 1, 10); } }
    for (const key of ['selfBuff', 'debuff']) if (s[key] != null) {
      if (!Array.isArray(s[key])) { e.push(`${p}.${key} 必須是陣列`); continue; }
      s[key].forEach((b, i) => { if (!BUFF_STATS.includes(b.stat)) e.push(`${p}.${key}[${i}].stat 不正確`); if (b.mult != null) num(`${p}.${key}[${i}].mult`, b.mult, 0.1, 5); if (b.add != null) num(`${p}.${key}[${i}].add`, b.add, -1000, 1000); int(`${p}.${key}[${i}].turns`, b.turns, 1, 10); });
    }
    const effects = ['mult', 'heal', 'shield', 'selfBuff', 'debuff', 'reflect'].filter((k) => s[k] != null);
    if (!effects.length) e.push(`${p} 沒有任何效果`);
  }
  for (const [fk, f] of Object.entries(c.families)) {
    const p = `families.${fk}`;
    if (!isObj(f) || !isObj(f.w)) { e.push(`${p}.w 缺少`); continue; }
    for (const k of STAT_KEYS) num(`${p}.w.${k}`, f.w[k], 0.2, 3);
    if (f.bias != null) num(p + '.bias', f.bias, 0.5, 2);
    if (!sk[f.signature]) e.push(`${p}.signature 找不到技能「${f.signature}」`);
    if (!Array.isArray(f.pool)) e.push(`${p}.pool 必須是陣列`); else f.pool.forEach((id) => { if (!sk[id]) e.push(`${p}.pool 找不到技能「${id}」`); });
  }
  if (!c.families._default) e.push('families._default 必須存在');
  for (const [b, id] of Object.entries(c.signatureByBody || {})) if (!sk[id]) e.push(`signatureByBody.${b} 找不到技能「${id}」`);
  if (!Array.isArray(c.skillSlots.unlockLevels) || !c.skillSlots.unlockLevels.length || c.skillSlots.unlockLevels.length > 6) e.push('skillSlots.unlockLevels 需為 1–6 個等級');
  if (!Array.isArray(c.skillUnlock) || c.skillUnlock.length < 1) e.push('skillUnlock 需為陣列');
  const SR = c.skillRank; int('skillRank.max', SR.max, 1, 10); num('skillRank.perRank', SR.perRank, 0, 1);
  if (!Array.isArray(SR.costCoins) || SR.costCoins.length < SR.max) e.push('skillRank.costCoins 長度需 ≥ skillRank.max'); else SR.costCoins.forEach((v, i) => int(`skillRank.costCoins[${i}]`, v, 0, 1e7));
  const T = c.training;
  if (!isObj(T.types) || !Object.keys(T.types).length) e.push('training.types 不可為空');
  else for (const [k, t] of Object.entries(T.types)) {
    const p = `training.types.${k}`;
    if (!ID_RE.test(k)) e.push(`${p}：代號格式錯誤`);
    if (t.stat != null && !STAT_KEYS.includes(t.stat)) e.push(`${p}.stat 不正確`);
    num(p + '.cdMin', t.cdMin, 1, 7 * 24 * 60); int(p + '.coins', t.coins, 0, 1e7); int(p + '.coinsPerLv', t.coinsPerLv, 0, 1e6); int(p + '.xp', t.xp, 0, 1e6);
  }
  for (const k of STAT_KEYS) num('training.pointValue.' + k, (T.pointValue || {})[k], 0, 100);
  for (const [id, g] of Object.entries(c.gear)) {
    const p = `gear.${id}`;
    if (!ID_RE.test(id)) e.push(`${p}：代號格式錯誤`);
    if (!c.gearSlots[g.slot]) e.push(`${p}.slot 不正確`);
    if (typeof g.name !== 'string' || !g.name.trim()) e.push(`${p}.name 缺少`);
    const hasC = g.coins != null, hasG = g.gems != null;
    if (hasC === hasG) e.push(`${p} 必須設定 coins 或 gems 其中一種價格`);
    if (hasC) int(p + '.coins', g.coins, 1, 1e8); if (hasG) int(p + '.gems', g.gems, 1, 1e6);
    int(p + '.minLevel', g.minLevel, 1, 200);
    if (!isObj(g.mods)) e.push(`${p}.mods 缺少`); else for (const [mk, mv] of Object.entries(g.mods)) { if (!MOD_KEYS.includes(mk)) e.push(`${p}.mods.${mk} 不支援`); else num(`${p}.mods.${mk}`, mv, -100, 500); }
  }
  if (c.autoBalance != null) { const AB = c.autoBalance; if (!isObj(AB)) e.push('autoBalance 必須是物件'); else { int('autoBalance.seeds', AB.seeds, 1, 50); if (AB.panelPerFamily != null) int('autoBalance.panelPerFamily', AB.panelPerFamily, 1, 5); if (AB.panelRounds != null) int('autoBalance.panelRounds', AB.panelRounds, 0, 5); if (AB.levels != null && (!Array.isArray(AB.levels) || !AB.levels.length || AB.levels.some((x) => !Number.isInteger(x) || x < 1 || x > 200))) e.push('autoBalance.levels 需為 1–200 的整數陣列'); int('autoBalance.iterations', AB.iterations, 3, 20); num('autoBalance.min', AB.min, 0.2, 1); num('autoBalance.max', AB.max, 1, 5); } }
  const BT = c.battle; int('battle.defK', BT.defK, 1, 10000); num('battle.variance', BT.variance, 0, 0.5); int('battle.gauge', BT.gauge, 100, 100000); int('battle.maxActions', BT.maxActions, 4, 500);
  const P = c.pvp;
  if (P.ticketRefillGems != null) int('pvp.ticketRefillGems', P.ticketRefillGems, 1, 100000); int('pvp.ticketsMax', P.ticketsMax, 1, 1000); num('pvp.refillMinutes', P.refillMinutes, 1, 7 * 24 * 60); int('pvp.opponents', P.opponents, 1, 20);
  int('pvp.startRating', P.startRating, 0, 5000); int('pvp.kFactor', P.kFactor, 1, 200); int('pvp.kFactorNew', P.kFactorNew, 1, 200); num('pvp.defenderFactor', P.defenderFactor, 0, 1);
  int('pvp.maxVsSameOpponentPerDay', P.maxVsSameOpponentPerDay, 1, 100); num('pvp.minAccountAgeHours', P.minAccountAgeHours, 0, 24 * 365);
  if (!Array.isArray(P.sameOpponentDecay) || !P.sameOpponentDecay.length) e.push('pvp.sameOpponentDecay 需為陣列');
  if (!isObj(P.rateLimit)) e.push('pvp.rateLimit 缺少'); else for (const k of ['actionsPerMin', 'challengesPerMin', 'listPerMin']) int('pvp.rateLimit.' + k, P.rateLimit[k], 1, 10000);
  let prev = -1;
  c.ranks.forEach((r, i) => { if (!r || typeof r.key !== 'string' || typeof r.name !== 'string') e.push(`ranks[${i}] 缺少 key/name`); else { int(`ranks[${i}].min`, r.min, 0, 100000); if (r.min <= prev) e.push('ranks 的 min 必須遞增'); prev = r.min; } });
  if (c.ranks[0] && c.ranks[0].min !== 0) e.push('ranks[0].min 必須是 0');
  const S = c.season; num('season.softReset', S.softReset, 0, 1); int('season.minBattles', S.minBattles, 0, 10000);
  for (const [k, rw] of Object.entries(S.rewards || {})) { if (!c.ranks.some((r) => r.key === k)) e.push(`season.rewards.${k} 不是有效段位`); if (rw.coins != null) int(`season.rewards.${k}.coins`, rw.coins, 0, 1e8); if (rw.gems != null) int(`season.rewards.${k}.gems`, rw.gems, 0, 1e5); }
  const CH = c.change; int('change.coins', CH.coins, 0, 1e8); int('change.coinsStep', CH.coinsStep, 0, 1e8); int('change.coinsMax', CH.coinsMax, 0, 1e9); num('change.cooldownHours', CH.cooldownHours, 0, 24 * 30);
  return e;
}

// 給遊戲端的公開設定（不含校正係數等內部數值以外的東西都公開也無妨；這裡只拿掉 pvp 防濫用細節）
function publicHeroConfig(c) {
  const P = c.pvp;
  return {
    enabled: c.enabled !== false, base: c.base, level: { max: c.level.max }, skills: c.skills, skillSlots: c.skillSlots, skillUnlock: c.skillUnlock, skillRank: c.skillRank,
    training: c.training, gear: c.gear, gearSlots: c.gearSlots, change: c.change, ranks: c.ranks,
    families: Object.fromEntries(Object.entries(c.families).map(([k, f]) => [k, { name: f.name, signature: f.signature, pool: f.pool }])),
    pvp: { memberOnly: P.memberOnly, ticketsMax: P.ticketsMax, refillMinutes: P.refillMinutes, ticketRefillGems: P.ticketRefillGems ?? 20, opponents: P.opponents, maxVsSameOpponentPerDay: P.maxVsSameOpponentPerDay, startRating: P.startRating },
    season: { rewards: c.season.rewards, topBonus: c.season.topBonus, minBattles: c.season.minBattles },
  };
}

class HeroConfigStore {
  constructor(db) { this.db = db; this.cache = null; }
  ensureSeed() {
    if (this.db.prepare('SELECT COUNT(*) n FROM hero_config_versions').get().n) return false;
    this.save(JSON.parse(JSON.stringify(HERO_DEFAULT_CONFIG)), '初始版本：英雄魚預設設定', 'system');
    return true;
  }
  active() {
    if (this.cache) return this.cache;
    const row = this.db.prepare('SELECT * FROM hero_config_versions ORDER BY version DESC LIMIT 1').get();
    if (!row) { this.ensureSeed(); return this.active(); }
    const config = JSON.parse(row.json);
    this.cache = { version: row.version, createdAt: row.created_at, config, publicConfig: publicHeroConfig(config) };
    return this.cache;
  }
  save(cfg, note, by, rollbackOf = null) {
    const errors = validateHeroConfig(cfg);
    if (errors.length) throw new HttpError(422, 'invalid_config', '英雄魚設定驗證失敗', { errors });
    const v = (this.db.prepare('SELECT MAX(version) v FROM hero_config_versions').get().v || 0) + 1;
    this.db.prepare('INSERT INTO hero_config_versions (version, json, note, created_at, created_by, rollback_of) VALUES (?,?,?,?,?,?)').run(v, JSON.stringify(cfg), String(note || '').slice(0, 200), Date.now(), by || 'admin', rollbackOf);
    this.cache = null;
    return v;
  }
  list(limit = 50) { return this.db.prepare('SELECT version, note, created_at, created_by, rollback_of, length(json) size FROM hero_config_versions ORDER BY version DESC LIMIT ?').all(limit); }
  get(v) { const row = this.db.prepare('SELECT * FROM hero_config_versions WHERE version=?').get(v); if (!row) throw new HttpError(404, 'not_found', '找不到此版本'); return { version: row.version, note: row.note, createdAt: row.created_at, config: JSON.parse(row.json) }; }
  rollback(v, by) { return this.save(this.get(v).config, `回復至 v${v}`, by, v); }
}

module.exports = { validateHeroConfig, publicHeroConfig, HeroConfigStore };
