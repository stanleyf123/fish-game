'use strict';
// 自動公平校正（fair factor）：任何魚種（含混種、任意技能組合）在指定「等級區間」下，
// 以二分搜尋找出戰力倍率 m，使其對「參考對手群」的模擬勝率 ≈ 50%。
// - 參考對手群：每個科別依體型挑 panelPerFamily 隻代表魚（預設技能、無訓練、無裝備），本身也先迭代校正
// - 等級區間：autoBalance.levels（預設 1/3/8/15/30，對應技能欄位解鎖），英雄等級取「不超過自己的最大區間」
// - 確定性：固定種子；同樣輸入永遠得到同樣倍率
// - 快取：記憶體＋SQLite（hero_fair），key 含設定雜湊：設定一改舊結果自動失效，重開機不必重算；啟動後可用 warmup() 分段預先計算（不卡住事件迴圈）
// - 只校正「物種＋技能組合」的先天差異；成長階段、訓練、裝備、技能等級等養成加成照常疊加
const crypto = require('crypto');
const { simulate } = require('./battle');

const cache = new Map();
const panelCache = new Map();
const cfgHashes = new WeakMap();
let store = null;

// 設定雜湊（英雄設定＋魚種資料）：設定改了 → 舊的校正結果自動失效
function cfgHash(hcfg, gameCfg) {
  let hh = cfgHashes.get(hcfg);
  if (!hh) { hh = crypto.createHash('sha256').update(JSON.stringify(hcfg)).digest('hex').slice(0, 12); cfgHashes.set(hcfg, hh); }
  let gh = cfgHashes.get(gameCfg);
  if (!gh) { gh = crypto.createHash('sha256').update(JSON.stringify(gameCfg.species) + JSON.stringify(gameCfg.stages || [])).digest('hex').slice(0, 12); cfgHashes.set(gameCfg, gh); }
  return hh + gh;
}

// 選用：持久化。傳入 better-sqlite3 db（建立 hero_fair 表），或自訂 { get(k) → m|null, put(k, m) }
// （背景 worker 用唯讀連線讀取、把寫入轉交主執行緒，避免兩條連線同時寫入造成 SQLITE_BUSY）
function setStore(db) {
  if (!db) { store = null; return; }
  if (typeof db.get === 'function' && typeof db.put === 'function' && typeof db.prepare !== 'function') { store = db; return; }
  db.exec('CREATE TABLE IF NOT EXISTS hero_fair (k TEXT PRIMARY KEY, m REAL NOT NULL, created_at INTEGER NOT NULL)');
  const g = db.prepare('SELECT m FROM hero_fair WHERE k=?'), p = db.prepare('INSERT OR REPLACE INTO hero_fair (k, m, created_at) VALUES (?,?,?)');
  store = { get: (k) => { const r = g.get(k); return r ? r.m : null; }, put: (k, m) => { p.run(k, m, Date.now()); } };
}

function bracketLevel(hcfg, level) {
  const lv = ((hcfg.autoBalance || {}).levels || [1, 3, 8, 15, 30]).slice().sort((a, b) => a - b);
  let b = lv[0];
  for (const x of lv) if (level >= x) b = x;
  return b;
}

function panelSpecies(hcfg, gameCfg) {
  const byFam = {};
  for (const [id, s] of Object.entries(gameCfg.species)) {
    if (s.disabled) continue;
    (byFam[s.family] = byFam[s.family] || []).push([id, s.adultSizeCm || 5]);
  }
  const out = [];
  const per = (hcfg.autoBalance && hcfg.autoBalance.panelPerFamily) || 1;
  for (const fam of Object.keys(byFam).sort()) {
    const arr = byFam[fam].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    // 依體型取分位數代表（1 隻＝中位數；2 隻＝第 1/3、2/3 分位…）
    const picks = new Set(); for (let i = 1; i <= per; i++) picks.add(arr[Math.min(arr.length - 1, Math.floor(arr.length * i / (per + 1)))][0]);
    out.push(...picks);
  }
  return out;
}

function search(hcfg, mk, panel) {
  const AB = hcfg.autoBalance || {};
  const seeds = AB.seeds || 6, iters = AB.iterations || 9;
  const bcfg = { ...hcfg.battle, rankPer: 0 };
  const winrate = (m) => {
    const me = mk(m);
    let w = 0, n = 0;
    for (let i = 0; i < panel.length; i++) for (let s = 0; s < seeds; s++) {
      const seed = (i * 2654435761 + s * 40503 + 17) >>> 0;
      if (simulate(me, panel[i], seed, bcfg, hcfg.skills).winner === 0) w++;
      if (simulate(panel[i], me, seed ^ 0x5bd1e995, bcfg, hcfg.skills).winner === 1) w++;
      n += 2;
    }
    return w / n;
  };
  // 在 log 空間二分搜尋 m ∈ [min, max]
  let lo = Math.log(AB.min || 0.6), hi = Math.log(AB.max || 1.7);
  for (let i = 0; i < iters; i++) { const mid = (lo + hi) / 2; if (winrate(Math.exp(mid)) > 0.5) hi = mid; else lo = mid; }
  return Math.round(Math.exp((lo + hi) / 2) * 1000) / 1000;
}

// 參考對手群本身也要先校正（否則「對未校正代表魚 50%」≠「對整體 50%」）：
// 以未校正群組為起點反覆 panelRounds 輪：每位代表魚對其他代表魚二分搜尋倍率，再以校正後群組為新基準。
// 倍率會存進 hero_fair（key: panel|<hash>|<level>|<species>），所以重開機只需讀取。
function getPanel(hcfg, gameCfg, level, snapshotFn) {
  const h = cfgHash(hcfg, gameCfg);
  const k = h + '|' + level;
  if (panelCache.has(k)) return panelCache.get(k);
  const AB = hcfg.autoBalance || {};
  const ids = panelSpecies(hcfg, gameCfg);
  const heroOf = (sp) => ({ species: sp, growth: 999, level, train: {}, gear: {}, skills: {} });
  const pk = (sp) => `panel|${h}|${level}|${sp}`;
  let mult = ids.map((sp) => (store ? store.get(pk(sp)) : null));
  if (mult.some((m) => m == null)) {
    mult = ids.map(() => 1);
    let panel = ids.map((sp) => snapshotFn(heroOf(sp), 1));
    for (let round = 0; round < (AB.panelRounds == null ? 2 : AB.panelRounds); round++) {
      mult = ids.map((sp, i) => search(hcfg, (m) => snapshotFn(heroOf(sp), m), panel.filter((_, j) => j !== i)));
      panel = ids.map((sp, i) => snapshotFn(heroOf(sp), mult[i]));
    }
    if (store) ids.forEach((sp, i) => store.put(pk(sp), mult[i]));
  }
  const panel = ids.map((sp, i) => snapshotFn(heroOf(sp), mult[i]));
  if (panelCache.size > 200) panelCache.clear();
  panelCache.set(k, panel);
  return panel;
}

// snapshotFn(heroLike, factor) → 戰鬥快照（以 factor 調整戰力）
function fairFactor(hcfg, gameCfg, hero, skillIds, snapshotFn) {
  const AB = hcfg.autoBalance || {};
  if (AB.enabled === false) return 1;
  const level = bracketLevel(hcfg, hero.level || 1);
  const key = cfgHash(hcfg, gameCfg) + '|' + hero.species + '|' + level + '|' + skillIds.join(',');
  if (cache.has(key)) return cache.get(key);
  const dk = 'fair|' + key;
  let m = store ? store.get(dk) : null;
  if (m == null) {
    const panel = getPanel(hcfg, gameCfg, level, snapshotFn);
    m = search(hcfg, (x) => snapshotFn({ ...hero, level, train: {}, gear: {}, skills: { slots: skillIds } }, x), panel);
    if (store) store.put(dk, m);
  }
  if (cache.size > 50000) cache.clear();
  cache.set(key, m);
  return m;
}

function clearCache() { cache.clear(); panelCache.clear(); }
function stats() { return { cached: cache.size, panels: [...panelCache.keys()] }; }

module.exports = { fairFactor, panelSpecies, bracketLevel, clearCache, setStore, stats, cfgHash };
