'use strict';
// 雲端存檔的伺服器端合理性檢查。
// 分兩層：
//   structural（結構錯誤）：一律拒絕（400）
//   suspicious（可疑）：依 antiCheat.mode 決定 reject（422）/ flag（接受但記錄）/ off（不檢查）
const MAX_SAVE_BYTES = 256 * 1024;
const Hybrid = require('./hybrid');
// 物種資料：設定中的魚種，或由父母推導的混種（'hx:A+B'，見 hybrid.js）。以設定物件快取。
const hyCache = new WeakMap();
function spOf(cfg, id) {
  if (Object.prototype.hasOwnProperty.call(cfg.species, id)) return cfg.species[id];
  if (!Hybrid.isHybrid(id)) return null;
  let m = hyCache.get(cfg); if (!m) { m = new Map(); hyCache.set(cfg, m); }
  if (!m.has(id)) m.set(id, Hybrid.def(cfg, id)); return m.get(id);
}
// 造景（水草／設備）：海洋館增加的空間
const AQ = (cfg) => cfg.aquascape || null;
function extraSpaceOf(cfg, save) { const A = AQ(cfg); if (!A || !save || !save.gear || !save.gear.own) return 0; let n = 0; for (const k of Object.keys(save.gear.own)) if (A.gear && A.gear[k]) n += A.gear[k].addSpace || 0; return n; }

function capacityOf(cfg, capLv, save) {
  return cfg.capacity.base + cfg.capacity.upgrades.slice(0, capLv).reduce((a, u) => a + u.add, 0) + (save ? extraSpaceOf(cfg, save) : 0);
}
// 容量改用「空間單位」時（capacity.unit === 'tankSpace'，見 species/mechanics.js），每條魚占 species.tankSpace 格
const spaceUnits = (cfg) => cfg.capacity && cfg.capacity.unit === 'tankSpace';
const tankSpaceOf = (cfg, sp) => { const s = spOf(cfg, sp); return s && s.tankSpace > 0 ? s.tankSpace : 1; };
// 能裝下這些魚的最小魚缸等級（舊存檔升級到空間制時，遊戲會免費把魚缸升到這一級，見 capV）
function fitTier(cfg, fish) { const used = usedSpaceOf(cfg, fish || []); let lv = 0; while (lv < cfg.capacity.upgrades.length && capacityOf(cfg, lv) < used) lv++; return lv; }
// 限定魚（寶石魚）：只能經由伺服器購買／發放，玩家上傳的存檔不可讓數量增加
const isPremium = (s) => !!s && (s.priceGems > 0 || s.premium === true);
function premiumCounts(cfg, fish) { const c = {}; for (const f of fish || []) if (isPremium(spOf(cfg, f.sp))) c[f.sp] = (c[f.sp] || 0) + 1; return c; }
function usedSpaceOf(cfg, fish) { return spaceUnits(cfg) ? fish.reduce((a, f) => a + tankSpaceOf(cfg, f.sp), 0) : fish.length; }
// 每格空間最多能掉多少金幣（空間制）；舊制等同「每條魚最高 coin」
function maxCoinPerSlot(cfg) {
  const vals = Object.values(cfg.species).map((s) => (s.coin || 0) / (spaceUnits(cfg) ? (s.tankSpace > 0 ? s.tankSpace : 1) : 1));
  return Math.max(0, ...vals);
}

// 理論最高產速（金幣/秒）：滿缸都是產量最高的魚、都是大魚、擁有全部裝飾、水質最佳、照護時鐘倍率、月卡加成。
// 對應遊戲 coinValue()：max(1, round(coin × 階段倍率 × 裝飾倍率 × 水質倍率))，每 interval 秒掉一次（取區間下限）。
// 離線收益（offline.rate ≤ 1、最多 offline.capSec）與 14 天照護補算都不會超過「全程在線」的產速，
// 所以用「距上次存檔經過秒數 × 最高產速」當上限一定涵蓋合法情況。
function maxCoinRate(cfg, capLv, vipCoinBonus = 0, extra = 0, legacyDeco = null) {
  const cap = capacityOf(cfg, capLv) + extra;
  const { maxLegacyCoinBonus } = require('./legacy-deco');
  const legacyList = legacyDeco == null ? null : (Array.isArray(legacyDeco) ? legacyDeco : []);
  const decoMax = 1 + (legacyList
    ? maxLegacyCoinBonus(cfg, { legacyDeco: legacyList })
    : Object.values(cfg.decorations || {}).reduce((a, d) => a + (d.coinBonus || 0), 0));
  const stageMult = Math.max(...cfg.stages.map((s) => s.coinMultiplier || 0));
  const waterMax = Math.max(1, ...((cfg.water && cfg.water.grades) || []).map((g) => g.coinMultiplier || 0));
  const timeScale = (cfg.care && cfg.care.timeScale) || 1;
  const intervals = cfg.coins.intervalSecByStage.filter(Boolean).map((r) => r[0]);
  const minInterval = Math.max(1, Math.min(...intervals));
  // 造景美觀加成（最多 beautyBonusMax）
  const A = AQ(cfg), beautyMax = 1 + ((A && A.rules && A.rules.beautyBonusMax) || 0);
  const perDrop = Math.max(1, Math.ceil(maxCoinPerSlot(cfg) * stageMult * decoMax * waterMax * beautyMax * (1 + vipCoinBonus)));
  // 離線收益倍率 > 1 時（後台設定）也要涵蓋
  const offlineBoost = Math.max(1, (cfg.offline && cfg.offline.rate) || 0);
  return (cap * perDrop * timeScale * offlineBoost) / minInterval + plantIncomeRate(cfg);
}
// 修剪水草賣插枝的理論最高收入（金幣/秒）：滿缸都是最會長、插枝最貴的水草，在最佳光照＋CO2 下
function plantIncomeRate(cfg) {
  const A = AQ(cfg); if (!A || !A.plants) return 0; const R = A.rules || {};
  let best = 0; for (const P of Object.values(A.plants)) { if (P.priceGems > 0) continue; const perH = (P.grow || 0) * 1.4 * (R.co2Boost || 1.4) / Math.max(1, (R.trimAt || 130) - (R.trimTo || 70)) * (P.cuttings || 0) * (P.cutSell || 0); if (perH > best) best = perH; }
  return best * (R.maxPlants || 60) * ((cfg.care && cfg.care.timeScale) || 1) / 3600;
}

function sellValueMax(cfg, sp) {
  const s = spOf(cfg, sp);
  if (!s) return 0;
  const base = s.sellPrice || s.price * cfg.sell.fallbackRateOfPrice;
  return Math.floor(base * (1 + 2 * cfg.sell.stageBonus));
}

function save_items_delta(prev, next) {
  return Math.max(0, ((next.items && next.items.bacteria) || 0) - ((prev.items && prev.items.bacteria) || 0));
}

function validateStructure(cfg, save) {
  const errs = [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!isObj(save)) return ['存檔必須是物件'];
  if (JSON.stringify(save).length > MAX_SAVE_BYTES) errs.push('存檔過大');
  if (!fin(save.coins) || save.coins < 0 || save.coins > 1e13) errs.push('coins 數值不合法');
  if (!Array.isArray(save.fish) || save.fish.length > 500) errs.push('fish 必須是陣列（最多 500）');
  else {
    const ids = new Set();
    save.fish.forEach((f, i) => {
      if (!isObj(f)) return errs.push(`fish[${i}] 必須是物件`);
      if (typeof f.id !== 'string' || f.id.length > 40) errs.push(`fish[${i}].id 不合法`);
      else if (ids.has(f.id)) errs.push(`fish[${i}].id 重複`); else ids.add(f.id);
      if (typeof f.sp !== 'string' || f.sp.length > 8192 || !spOf(cfg, f.sp)) errs.push(`fish[${i}].sp 未知魚種「${f.sp}」`);
      if (f.name != null && (typeof f.name !== 'string' || f.name.length > 20)) errs.push(`fish[${i}].name 不合法`);
      for (const k of ['hue', 'size', 'growth', 'full', 'health', 'cd', 'coinT', 'px', 'py', 'stress', 'finDmg', 'imm', 'herb']) if (f[k] != null && !fin(f[k])) errs.push(`fish[${i}].${k} 必須是數字`);
      if (fin(f.stress) && (f.stress < 0 || f.stress > 100)) errs.push(`fish[${i}].stress 超出範圍`);
      if (fin(f.finDmg) && (f.finDmg < 0 || f.finDmg > 1)) errs.push(`fish[${i}].finDmg 超出範圍`);
      if (fin(f.health) && (f.health < 0 || f.health > 100)) errs.push(`fish[${i}].health 超出範圍`);
      if (fin(f.size) && (f.size < .3 || f.size > 3)) errs.push(`fish[${i}].size 超出範圍`);
      if (fin(f.full) && (f.full < 0 || f.full > 100)) errs.push(`fish[${i}].full 超出範圍`);
      if (fin(f.growth) && (f.growth < 0 || f.growth > 1e6)) errs.push(`fish[${i}].growth 超出範圍`);
      if (f.evoFrom != null && ![0, 1].includes(f.evoFrom)) errs.push(`fish[${i}].evoFrom 必須是 0 或 1（待播放的進化動畫起始階段）`);
    });
  }
  const up = save.up;
  if (!isObj(up)) errs.push('up 必須是物件');
  else {
    const lim = { cap: cfg.capacity.upgrades.length, food: cfg.food.tiers.length - 1, feeder: cfg.feeder.tiers.length - 1, filter: cfg.filter ? cfg.filter.tiers.length - 1 : 0 };
    for (const k of Object.keys(lim)) {
      if (k === 'filter' && up[k] == null) continue; // 舊存檔沒有 filter
      if (!Number.isInteger(up[k]) || up[k] < 0 || up[k] > lim[k]) errs.push(`up.${k} 等級不合法（0–${lim[k]}）`);
    }
    if (!Array.isArray(up.deco) || up.deco.some((d) => !cfg.decorations[d]) || new Set(up.deco).size !== up.deco.length) errs.push('up.deco 含未知或重複的裝飾');
  }
  if (save.water != null) {
    if (!isObj(save.water)) errs.push('water 必須是物件');
    else for (const [k, v] of Object.entries(save.water)) if (v != null && !fin(v)) errs.push(`water.${k} 必須是數字`);
    else if (['dirt', 'algae', 'cycle'].includes(k) && (v < 0 || v > 100)) errs.push(`water.${k} 超出範圍（0–100）`);
  }
  if (save.items != null) {
    if (!isObj(save.items)) errs.push('items 必須是物件');
    else for (const [k, v] of Object.entries(save.items)) if (!Number.isInteger(v) || v < 0 || v > 100000) errs.push(`items.${k} 數量不合法`);
  }
  if (save.found != null && (!isObj(save.found) || Object.keys(save.found).some((k) => !spOf(cfg, k)))) errs.push('found 含未知魚種');
  if (save.adult != null && (!isObj(save.adult) || Object.keys(save.adult).some((k) => !spOf(cfg, k)))) errs.push('adult（圖鑑成年型態）含未知魚種');
  if (save.capV != null && (!Number.isInteger(save.capV) || save.capV < 0 || save.capV > 100)) errs.push('capV 不合法');
  if (save.last != null && !fin(save.last)) errs.push('last 必須是時間戳');
  if (save.pbreed != null && (!isObj(save.pbreed) || Object.entries(save.pbreed).some(([k, v]) => !isPremium(cfg.species[k]) || !fin(v)))) errs.push('pbreed（限定魚繁殖時間）不合法');
  const { validateLegacyDeco } = require('./legacy-deco');
  errs.push(...validateLegacyDeco(cfg, save));
  // 造景
  const A = AQ(cfg), PL = (A && A.plants) || {}, GE = (A && A.gear) || {}, R = (A && A.rules) || {};
  if (save.plants != null) {
    if (!Array.isArray(save.plants) || save.plants.length > (R.maxPlants || 60)) errs.push(`plants 必須是陣列（最多 ${R.maxPlants || 60} 株）`);
    else { const ids = new Set(); save.plants.forEach((p, i) => {
      if (!isObj(p)) return errs.push(`plants[${i}] 必須是物件`);
      if (typeof p.id !== 'string' || p.id.length > 40 || ids.has(p.id)) errs.push(`plants[${i}].id 不合法或重複`); else ids.add(p.id);
      if (!PL[p.sp]) errs.push(`plants[${i}].sp 未知水草「${p.sp}」`);
      for (const [k, lo, hi] of [['x', 0, 1], ['d', 0, 1], ['g', 0, 200], ['hp', 0, 100]]) if (!fin(p[k]) || p[k] < lo || p[k] > hi) errs.push(`plants[${i}].${k} 超出範圍`);
      if (p.seed != null && !Number.isInteger(p.seed)) errs.push(`plants[${i}].seed 必須是整數`);
      if (p.src != null && !['c', 'g', 'cut'].includes(p.src)) errs.push(`plants[${i}].src 不合法`); }); }
  }
  if (save.cut != null && (!isObj(save.cut) || Object.entries(save.cut).some(([k, v]) => !PL[k] || !Number.isInteger(v) || v < 0 || v > 99))) errs.push('cut（插枝庫存）不合法');
  if (save.pfound != null && (!isObj(save.pfound) || Object.keys(save.pfound).some((k) => !PL[k]))) errs.push('pfound（水草圖鑑）含未知水草');
  if (save.gear != null) {
    const g = save.gear;
    if (!isObj(g) || !isObj(g.own) || Object.entries(g.own).some(([k, v]) => !GE[k] || v !== 1)) errs.push('gear.own（設備）含未知設備');
    else {
      if (g.light != null && (!GE[g.light] || GE[g.light].cat !== 'light' || !g.own[g.light])) errs.push('gear.light 必須是已擁有的燈具');
      if (g.temp != null && !['tropical', 'cold', 'room'].includes(g.temp)) errs.push('gear.temp 必須是 tropical / cold / room');
    }
  }
  return errs;
}

// prev：上一份伺服器存檔（物件）或 null；prevClientSavedAt：上次客戶端存檔的伺服器時間
function checkSave(cfg, prev, prevClientSavedAt, next, nowMs, opts = {}) {
  const ac = cfg.antiCheat || { mode: 'off' };
  const structural = validateStructure(cfg, next);
  const suspicious = [];
  const info = {};
  if (structural.length) return { structural, suspicious, info };
  const { checkLegacyUnchanged } = require('./legacy-deco');
  if (prev && !checkLegacyUnchanged(prev, next)) structural.push('legacyDeco 只能由伺服器管理');
  if (structural.length) return { structural, suspicious, info };
  // GEM-DECO-V1: reject client-forged premium scenery even on first upload and with anticheat disabled.
  { const before=new Set(prev?.up?.deco||[]), after=new Set(next.up.deco);
    for(const id of after) if(cfg.decorations[id]?.priceGems>0&&!before.has(id)) structural.push('寶石造景只能由伺服器發放');
    for(const id of before) if(cfg.decorations[id]?.priceGems>0&&!after.has(id)) structural.push('已購買的寶石造景不能遺失');
    if(structural.length)return {structural,suspicious,info};
  }
  // 🎨 外觀（v4.1）：只能由伺服器發放
  { const cc = require('./gemshop').checkCos(cfg, prev, next); if (cc.errs.length) return { structural: cc.errs, suspicious, info }; suspicious.push(...cc.suspicious); }
  if (next.last != null && next.last > nowMs + ac.maxClockSkewSec * 1000) suspicious.push('客戶端時間超前伺服器太多');
  const capLv = next.up.cap;
  const cap = capacityOf(cfg, capLv, next);
  const prevFishN = prev && Array.isArray(prev.fish) ? prev.fish.length : 0;
  const used = usedSpaceOf(cfg, next.fish), prevUsed = prev && Array.isArray(prev.fish) ? usedSpaceOf(cfg, prev.fish) : 0;
  if (used > Math.max(cap + ac.maxFishSlack, prevUsed, spaceUnits(cfg) ? 0 : prevFishN)) suspicious.push(spaceUnits(cfg) ? `魚缸空間 ${used} 超過容量 ${cap}` : `魚數 ${next.fish.length} 超過魚缸容量 ${cap}`);
  // 限定魚數量只能由伺服器增加（寶石購買／信箱發放會直接寫入伺服器存檔）
  { const pc = premiumCounts(cfg, prev && prev.fish), nc = premiumCounts(cfg, next.fish);
    // 限定魚可以繁殖（兩條同種限定魚配對）：每次增加 1 條，且 pbreed[sp] 時間需晚於上次 + 冷卻時間、不超過伺服器時間
    const cd = ((cfg.premium && cfg.premium.breedCooldownSec) || 14400) * 1000, skew = ((ac.maxClockSkewSec || 300) * 1000);
    for (const [sp, n] of Object.entries(nc)) { const p0 = pc[sp] || 0; if (n <= p0) continue;
      const t1 = next.pbreed && next.pbreed[sp], t0 = (prev && prev.pbreed && prev.pbreed[sp]) || 0;
      const bredOk = cfg.premium && cfg.premium.breedable !== false && n === p0 + 1 && p0 >= 2 && typeof t1 === 'number' && t1 <= nowMs + skew && t1 >= t0 + cd - 60000;
      if (!bredOk) suspicious.push(`限定魚「${cfg.species[sp].name}」數量 ${p0} → ${n}（只能用寶石購買，或由兩條同種限定魚繁殖、冷卻 ${Math.round(cd / 3600000)} 小時）`); else info.premiumBred = sp; }
    // 混種：新出現的混種，雙親魚種必須在上一份存檔的魚缸裡（或是其他混種的親代）
    const prevBase = new Set(); for (const f of (prev && prev.fish) || []) for (const b of Hybrid.baseOf(cfg, f.sp)) prevBase.add(b);
    const prevIds = new Set(((prev && prev.fish) || []).map((f) => f.id));
    if (prev) for (const f of next.fish) if (Hybrid.isHybrid(f.sp) && !prevIds.has(f.id)) { const [a, b] = Hybrid.parse(f.sp); if (!prevBase.has(a) || !prevBase.has(b)) suspicious.push(`混種「${spOf(cfg, f.sp).name}」的雙親不在魚缸裡`); } }
  if (!prev) {
    if (next.coins > ac.firstUploadMaxCoins) suspicious.push(`首次上傳金幣 ${Math.floor(next.coins)} 超過上限 ${ac.firstUploadMaxCoins}`);
    return { structural, suspicious, info };
  }
  // 升級不可倒退
  for (const k of ['cap', 'food', 'feeder', 'filter']) if ((next.up[k] || 0) < (prev.up?.[k] || 0)) suspicious.push(`升級 ${k} 等級倒退`);
  // 金幣增量
  const elapsed = Math.max(0, (nowMs - (prevClientSavedAt || nowMs)) / 1000);
  const rate = maxCoinRate(cfg, Math.max(capLv, prev.up?.cap || 0), opts.vipCoinBonus || 0, Math.max(extraSpaceOf(cfg, next), extraSpaceOf(cfg, prev)), prev?.legacyDeco) * Math.max(1, Math.min(20, opts.coinRateMult || 1));   // v4.1.3：新手前 15 分鐘加速
  let spent = 0, sold = 0;
  // 舊存檔（沒有 capV）第一次以空間制上傳：遊戲會免費升級到「裝得下原本所有魚」的等級，這幾級不算花費
  const freeCapTo = !prev.capV && next.capV ? fitTier(cfg, prev.fish) : 0;
  for (let l = prev.up?.cap || 0; l < next.up.cap; l++) if (l >= freeCapTo) spent += cfg.capacity.upgrades[l].cost;
  if (freeCapTo > (prev.up?.cap || 0)) info.freeCapTo = freeCapTo;
  for (let l = prev.up?.food || 0; l < next.up.food; l++) spent += cfg.food.tiers[l + 1].cost;
  for (let l = prev.up?.feeder || 0; l < next.up.feeder; l++) spent += cfg.feeder.tiers[l + 1].cost;
  if (cfg.filter) for (let l = prev.up?.filter || 0; l < (next.up.filter || 0); l++) spent += cfg.filter.tiers[l + 1].cost;
  // 硝化菌罐：數量只增加時視為用金幣購買（伺服器發放的會先寫入 prev，不會被算到）
  const bac = cfg.cycling && cfg.cycling.bacteria;
  const bd=Math.max(0,Math.floor((next.water?.bacteriaDoses||0)-(prev.water?.bacteriaDoses||0)));
  const usedDelta=(next.water?.bacteriaUsed||0)-(prev.water?.bacteriaUsed||0);
  const bacteriaUsedCount=Number.isSafeInteger(usedDelta)&&usedDelta>=0?usedDelta:0;
  if(usedDelta<0||!Number.isSafeInteger(usedDelta)||usedDelta>20000)suspicious.push('硝化菌用量紀錄異常');
  if (bac) { const purchased=Math.max(0,((next.items?.bacteria||0)-(prev.items?.bacteria||0))+Math.max(bd,bacteriaUsedCount)); spent+=purchased*bac.cost; }
  { const until=next.water?.bacteriaUntil||0,old=prev.water?.bacteriaUntil||0;
    if(until>old){if(!bd||bd>200)suspicious.push('硝化菌強化缺少使用紀錄');if(until>nowMs+4*3600000+120000)suspicious.push('硝化菌強化時間超出上限');}
  }
  // 💊 藥品：寶石藥只能由伺服器增加；金幣藥計入花費；新的免疫／草本藥效必須有用掉對應的藥
  { const mc = require('./medicine').medCheck(cfg, prev, next, nowMs); spent += mc.spent; suspicious.push(...mc.suspicious); if (mc.limit && mc.limit.length) info.medLimit = mc.limit; } /*V406M*/
  // v4.2 換水／清潔付費：water.paidSmall／paidBig／paidClean 只會增加，每次依（上一份存檔的）魚缸容量計費；換水時間前進卻沒有付費紀錄 → 可疑
  { const { costOf, KINDS } = require('./watercost'), pw = prev.water || {}, nw = next.water || {}, capPrev = capacityOf(cfg, prev.up?.cap || 0, prev); let paidChanges = 0;
    for (const [kind, key] of Object.entries(KINDS)) { const d = Math.floor((nw[key] || 0) - (pw[key] || 0)); if (d < 0) suspicious.push(`water.${key} 不能減少`); else if (d > 0) { spent += d * costOf(cfg, kind, capPrev); if (kind !== 'clean') paidChanges += d; } }
    if (pw.paidSmall != null && (nw.lastChange || 0) > (pw.lastChange || 0) && !paidChanges && costOf(cfg, 'small', capPrev) > 0) suspicious.push('換水沒有付費紀錄'); }
  const prevDeco = new Set(prev.up?.deco || []);
  for (const d of next.up.deco) if (!prevDeco.has(d)) spent += cfg.decorations[d].cost;
  // 造景：新買的設備／海洋館、新種的水草（扣掉用插枝種的）、賣掉的插枝
  { const A = AQ(cfg);
    if (A) { const GE = A.gear || {}, PL = A.plants || {}, po = (prev.gear && prev.gear.own) || {}, no = (next.gear && next.gear.own) || {};
      for (const k of Object.keys(no)) if (!po[k] && GE[k] && !GE[k].starter) { if (GE[k].priceGems > 0) suspicious.push(`設備「${GE[k].name}」只能用寶石購買`); else spent += GE[k].price || 0; }
      for (const k of Object.keys(po)) if (!no[k] && GE[k] && !GE[k].starter) suspicious.push(`設備「${GE[k].name}」不見了`);
      const pids = new Set((prev.plants || []).map((p) => p.id)), add = {}; for (const p of next.plants || []) if (!pids.has(p.id)) add[p.sp] = (add[p.sp] || 0) + 1;
      const pcut = prev.cut || {}, ncut = next.cut || {};
      for (const sp of new Set([...Object.keys(add), ...Object.keys(pcut), ...Object.keys(ncut)])) { const P = PL[sp]; if (!P) continue;
        const used = Math.max(0, (pcut[sp] || 0) - (ncut[sp] || 0)), planted = add[sp] || 0;
        const bought = Math.max(0, planted - used), soldCut = Math.max(0, used - planted);
        if (P.priceGems > 0) { if (bought > 0 || (ncut[sp] || 0) > (pcut[sp] || 0)) suspicious.push(`水草「${P.name}」只能用寶石購買`);  sold += soldCut * (P.cutSell || 0); }
        else { spent += bought * (P.price || 0); sold += soldCut * (P.cutSell || 0); }
        // v4.2 退款來源：新種的 src:'c' 不能多於金幣買的、src:'g' 不能多於用掉的寶石插枝；gcut 只有伺服器能增加
        { const nw = (next.plants || []).filter((p) => !pids.has(p.id) && p.sp === sp), nc = nw.filter((p) => p.src === 'c').length, ng = nw.filter((p) => p.src === 'g').length;
          const pg = (prev.gcut && prev.gcut[sp]) || 0, xg = (next.gcut && next.gcut[sp]) || 0;
          if (xg > pg) suspicious.push(`寶石插枝「${P.name}」不能由客戶端增加`); if (xg > (ncut[sp] || 0)) suspicious.push(`寶石插枝「${P.name}」多於插枝庫存`);
          if (nc > bought) suspicious.push(`水草「${P.name}」金幣來源數量不符`); if (ng > Math.max(0, pg - xg)) suspicious.push(`水草「${P.name}」寶石來源數量不符`); } }
      { const pm = new Map((prev.plants || []).map((p) => [p.id, p.src || null])); for (const p of next.plants || []) if (pm.has(p.id) && (p.src || null) !== pm.get(p.id)) suspicious.push(`水草 ${p.id} 的來源被修改`); }
      // 修剪得到的插枝 → 立刻賣掉（同一段時間內）：由 plantIncomeRate 涵蓋
    } }
  const nextIds = new Set(next.fish.map((f) => f.id));
  const goneSp = {};
  for (const f of prev.fish || []) if (!nextIds.has(f.id)) { sold += f.gift ? 0 : sellValueMax(cfg, f.sp); goneSp[f.sp] = (goneSp[f.sp] || 0) + 1; } // FRIENDSV2-GIFTFISH 好友送的魚賣不到錢
  { const nx = new Map(next.fish.map((f) => [f.id, f])); for (const f of prev.fish || []) if (f.gift && nx.has(f.id) && !nx.get(f.id).gift) suspicious.push(`禮物魚 ${f.id} 的標記被移除`); }
  // 繁殖後又在同一段時間內賣掉的魚（上一份、這一份存檔都沒有）：依這段時間的客戶端 c:breed／c:sell_fish 事件補算，
  // 只認「這段時間生出來的魚種」、以伺服器售價計，數量上限＝合理繁殖次數（每對成魚每個冷卻時間 1 次；有伺服器繁殖紀錄時再取較小值）
  { const ev = Array.isArray(opts.events) ? opts.events : [], bred = {}, sells = {};
    for (const e of ev) { const d = e && e.data; if (!d || typeof d !== 'object') continue;
      if (e.type === 'c:breed' && typeof d.child === 'string' && spOf(cfg, d.child)) bred[d.child] = (bred[d.child] || 0) + 1;
      else if (e.type === 'c:sell_fish' && typeof d.sp === 'string' && spOf(cfg, d.sp)) sells[d.sp] = (sells[d.sp] || 0) + 1; }
    const adults = Math.max((prev.fish || []).length, next.fish.length), cd = Math.max(10, (cfg.breeding && cfg.breeding.cooldownSec) || 90);
    let cap = Math.max(1, Math.floor(adults / 2)) * (Math.floor(elapsed / cd) + 1);
    if (Number.isFinite(opts.serverBreeds)) cap = Math.min(cap, opts.serverBreeds);
    let n = 0, ghost = 0;
    for (const sp of Object.keys(sells)) { const k = Math.min(Math.max(0, sells[sp] - (goneSp[sp] || 0)), bred[sp] || 0);
      for (let i = 0; i < k && n < cap; i++, n++) ghost += sellValueMax(cfg, sp); }
    if (n) { sold += ghost; info.bredSold = n; info.bredSoldCoins = ghost; } }
  const allowed = (prev.coins || 0) + ac.baseAllowance + elapsed * rate * ac.rateSlack + sold - spent;
  Object.assign(info, { elapsed: Math.round(elapsed), maxRate: +rate.toFixed(3), spent, sold, allowed: Math.floor(allowed), delta: Math.floor(next.coins - (prev.coins || 0)) });
  if (next.coins > allowed) suspicious.push(`金幣增加過快：+${Math.floor(next.coins - prev.coins)}，${Math.round(elapsed)} 秒內上限約 ${Math.floor(allowed - prev.coins)}`);
  return { structural, suspicious, info, tooFrequent: elapsed < ac.minSaveIntervalSec };
}

module.exports = { checkSave, capacityOf, usedSpaceOf, maxCoinRate, validateStructure, fitTier, isPremium, spOf, extraSpaceOf, plantIncomeRate };
