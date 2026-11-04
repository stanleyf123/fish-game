'use strict';
// 🪙 釣魚魚獲賣價（2026-10-30 v11）：現場賣、魚簍結算賣、魚缸／收藏庫轉賣共用同一套公式（config.fishing.sell 可在後台調整）
//   V = base × S × clamp(ratio, ratioMin, ratioMax)^exp
//   base = 遊戲設定 species.sellPrice || species.price × basePriceRate(0.5)（不在遊戲設定裡時用釣魚資料的 price）
//   S = mult（1.5），特殊寵物 petMult（2）；金色 ×gold（3）、白化 ×albino（1.5）
//   夾在稀有度 [min[r], max[r]] 之間，再乘 (1 + 服裝/釣手金幣加成) × sellMult
// 魚缸／收藏庫：有 caught 標記（釣魚釣到）的魚，轉賣價最高 = max[r] × 成長階段係數 (1+stage×stageBonus)/(1+stageBonus)
const DATA = require('./fishing/data.json');
const SELL_DEF = { mult: 1.5, petMult: 2, gold: 3, albino: 1.5, ratioMin: 0.6, ratioMax: 1.7, exp: 1.5, basePriceRate: 0.5,
  min: [10, 100, 800, 2500], max: [400, 1500, 4000, 6000], tankCap: true };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
function sellCfg(cfg) {
  const s = ((cfg && cfg.fishing) || {}).sell || {}, o = { ...SELL_DEF };
  for (const k of ['mult', 'petMult', 'gold', 'albino', 'ratioMin', 'ratioMax', 'exp', 'basePriceRate']) o[k] = num(s[k], SELL_DEF[k]);
  for (const k of ['min', 'max']) o[k] = SELL_DEF[k].map((d, i) => num(Array.isArray(s[k]) ? s[k][i] : undefined, d));
  o.tankCap = s.tankCap !== false;
  return o;
}
// 這條魚在釣魚模式的稀有度：outcome 的 r 優先，否則看釣魚資料
function rarityOf(sp, r) { if (Number.isInteger(r) && r >= 0 && r <= 3) return r; const d = DATA.species[sp] || (typeof sp === 'string' && sp.startsWith('fs_') ? DATA.species[sp.slice(3)] : null); return d ? d.r : 0; }   // FSV1
function baseOf(cfg, sp, S = sellCfg(cfg)) {
  const s = (cfg && cfg.species && cfg.species[sp]) || null;
  if (s && s.sellPrice > 0) return s.sellPrice;
  if (s && s.price > 0) return s.price * S.basePriceRate;
  const d = DATA.species[sp]; return d ? d.price * S.basePriceRate : 0;
}
function isPet(cfg, sp) { const s = cfg && cfg.species && cfg.species[sp]; return !!(s && s.specialPet); }
// o: {id, r, ratio, variant}；bonus = 服裝＋釣手金幣加成（0.1 = +10%）；mult = config.fishing.sellMult × 魚簍 keep
function fishSell(cfg, o, bonus = 0, mult = 1) {
  const S = sellCfg(cfg), r = rarityOf(o.id, o.r);
  let v = baseOf(cfg, o.id, S) * (isPet(cfg, o.id) ? S.petMult : S.mult) * Math.pow(clamp(num(o.ratio, 1), S.ratioMin, S.ratioMax), S.exp);
  if (o.variant === 'gold') v *= S.gold; else if (o.variant === 'albino') v *= S.albino;
  v = clamp(v, S.min[r], S.max[r]);
  return Math.max(0, Math.round(v * (1 + (bonus || 0)) * (mult == null ? 1 : mult)));
}
// 魚缸／收藏庫的釣魚魚轉賣上限（沒有 caught 標記 → Infinity，不影響原本的魚）
function tankCapOf(cfg, f, stage) {
  if (!f || !f.caught) return Infinity;
  const S = sellCfg(cfg); if (!S.tankCap) return Infinity;
  const sb = (cfg && cfg.sell && cfg.sell.stageBonus) != null ? cfg.sell.stageBonus : 0.5;
  return Math.floor(S.max[rarityOf(f.sp, f.caught.r)] * (1 + stage * sb) / (1 + sb));
}
// 給 client 的版本：公式參數＋每個釣魚魚種的 base 與特殊寵物清單
function sellPublic(cfg) {
  const S = sellCfg(cfg), base = {}, pet = [];
  for (const id of Object.keys(DATA.species)) { base[id] = Math.round(baseOf(cfg, id, S) * 100) / 100; if (isPet(cfg, id)) pet.push(id); }
  return { ...S, base, pet, rar: Object.fromEntries(Object.keys(DATA.species).map((id) => [id, DATA.species[id].r])) };
}
function validateSell(s) {
  const e = []; if (s == null) return e; if (typeof s !== 'object' || Array.isArray(s)) return ['sell 必須是物件'];
  const rng = (k, a, b) => { if (s[k] != null && !(typeof s[k] === 'number' && s[k] >= a && s[k] <= b)) e.push(`sell.${k} 必須介於 ${a}～${b}`); };
  rng('mult', 0.1, 10); rng('petMult', 0.1, 10); rng('gold', 1, 20); rng('albino', 1, 20); rng('ratioMin', 0.1, 1); rng('ratioMax', 1, 5); rng('exp', 0, 4); rng('basePriceRate', 0.05, 2);
  for (const k of ['min', 'max']) if (s[k] != null && !(Array.isArray(s[k]) && s[k].length === 4 && s[k].every((v) => Number.isInteger(v) && v >= 0 && v <= 1e6))) e.push(`sell.${k} 必須是 4 個 0～1,000,000 的整數（普通／稀有／傳說／限定）`);
  const mn = s.min || SELL_DEF.min, mx = s.max || SELL_DEF.max; if (Array.isArray(mn) && Array.isArray(mx)) for (let i = 0; i < 4; i++) if (mn[i] > mx[i]) e.push(`sell 稀有度 ${i} 的最低價不能高於最高價`);
  if (s.ratioMin != null && s.ratioMax != null && s.ratioMin > s.ratioMax) e.push('sell.ratioMin 不能大於 ratioMax');
  return e;
}
module.exports = { SELL_DEF, sellCfg, fishSell, tankCapOf, sellPublic, baseOf, rarityOf, validateSell };
