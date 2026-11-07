'use strict';
/**
 * COINSINK-B2 測試套件
 *
 * 測試對象：
 *   server/src/coin-softcap.js （DR + 全帳號 softcap）
 *   server/src/daily-production.js （每日生產上限）
 *   server/src/patch-config.js （設定驗證）
 *
 * 執行方式：node --test tests/game.test.cjs
 */

const assert = require('node:assert/strict');
const path = require('node:path');

// ── 輔助：stub 相依模組 ───────────────────────────────────────────────────────
const Module = require('node:module');
const _orig = Module._resolveFilename.bind(Module);

// stub 實際遊戲伺服器才有的模組，以免測試時 require 失敗
const STUBS = {
  './hybrid': {
    isHybrid: id => typeof id === 'string' && id.startsWith('hx:'),
    parse: id => {
      if (!id || !id.startsWith('hx:')) return null;
      const parts = id.slice(3).split('+');
      return parts.length === 2 ? parts.map(decodeURIComponent) : null;
    },
    def: (cfg, id) => {
      const p = id.slice(3).split('+').map(decodeURIComponent);
      const A = cfg.species[p[0]] || { coin: 1 };
      const B = cfg.species[p[1]] || { coin: 1 };
      const coinMax = Math.max(A.coin || 1, B.coin || 1);
      const coin = Math.min(coinMax, Math.round(((A.coin || 1) + (B.coin || 1)) / 2 * 1.1 * 10) / 10);
      return { name: `${p[0]}×${p[1]}`, coin, tankSpace: 1.5 };
    },
    isHybrid: id => typeof id === 'string' && id.startsWith('hx:'),
    baseOf: (cfg, id) => {
      if (!id.startsWith('hx:')) return [id];
      const p = id.slice(3).split('+').map(decodeURIComponent);
      return p.flatMap(x => x.startsWith('hx:') ? [x] : [x]);
    },
  },
  './legacy-deco': {
    coinBonusSum: () => 0,
    maxLegacyCoinBonus: () => 0,
    validateLegacyDeco: () => [],
    checkLegacyUnchanged: () => true,
  },
};

// stub require for the modules above
const stubRequire = (id, ...rest) => {
  if (STUBS[id]) return STUBS[id];
  return _orig(id, ...rest);
};
const origReq = Module.prototype.require;
Module.prototype.require = function(id) {
  if (STUBS[id]) return STUBS[id];
  return origReq.apply(this, arguments);
};

const coinSoftcap = require(path.join(__dirname, '../server/src/coin-softcap'));
const dailyProd   = require(path.join(__dirname, '../server/src/daily-production'));
const patchCfg    = require(path.join(__dirname, '../server/src/patch-config'));

// ── 測試用設定 ───────────────────────────────────────────────────────────────
const CFG = {
  stages: [
    { coinMultiplier: 0, growth: 0 },
    { coinMultiplier: 0.5, growth: 100 },
    { coinMultiplier: 1,   growth: 1000 },
  ],
  coins: {
    intervalSecByStage: [null, [70, 100], [50, 70]],
    softcap: { enabled: true, kneePerHour: 60000, exp: 0.8 },
    dailyCapPerPlayer: 250000,
    drThresholds: [40, 80],
    drRates: [1, 0.6, 0.3],
  },
  care: { timeScale: 1 },
  water: {
    grades: [
      { below: 30, coinMultiplier: 1.1 },
      { below: 60, coinMultiplier: 1.0 },
      { below: 101, coinMultiplier: 0.8 },
    ],
  },
  aquascape: null,
  species: {
    discusblue: { coin: 6,  tankSpace: 1.5, name: '藍鑽七彩' },
    discusred:  { coin: 6,  tankSpace: 1.5, name: '紅鴿血七彩' },
    neon:       { coin: 2,  tankSpace: 1,   name: '霓虹燈' },
    guppy:      { coin: 3,  tankSpace: 1,   name: '孔雀魚' },
    // 付費魚（豁免 DR）
    p_goldfish:  { coin: 10, tankSpace: 2,  name: '金魚', priceGems: 50 },
    // 大型魚群豁免
    p_trevally:  { coin: 8,  tankSpace: 3,  name: '竹莢魚', dmmLargeSchool: true, schoolMaxGroup: 60 },
  },
};

// 製造指定數量成魚的陣列
function makeFish(sp, count, growth = 1200) {
  return Array.from({ length: count }, (_, i) => ({ id: sp + i, sp, growth }));
}

function makeSave(fish, waterDirt = 0) {
  return {
    fish,
    water: { dirt: waterDirt },
    up: { cap: 0, deco: [] },
    plants: [],
  };
}

// ── 測試 1：DR：10 條 discusblue → 倍率 1.0 ─────────────────────────────────
{
  const allFish = makeFish('discusblue', 10);
  const m = coinSoftcap.drMultForFish(CFG, 'discusblue', allFish);
  assert.equal(m, 1, `測試 1 失敗：10 條 discusblue DR 倍率應為 1，實際 ${m}`);
  console.log('✓ 測試 1：10 條 discusblue → DR 倍率 1.0');
}

// ── 測試 2：DR：50 條 discusblue → 加權平均倍率 ─────────────────────────────
{
  const allFish = makeFish('discusblue', 50);
  const m = coinSoftcap.drMultForFish(CFG, 'discusblue', allFish);
  // 前 40 條 × 1.0，後 10 條 × 0.6；平均 = (40×1 + 10×0.6) / 50 = 0.92
  const expected = (40 * 1 + 10 * 0.6) / 50;
  assert.ok(Math.abs(m - expected) < 1e-9, `測試 2 失敗：50 條 discusblue DR 倍率應約 ${expected.toFixed(4)}，實際 ${m}`);
  console.log('✓ 測試 2：50 條 discusblue → DR 加權平均倍率 0.92');
}

// ── 測試 3：DR：30 discusblue + 30 discusred 同屬 discus 群 ─────────────────
{
  const allFish = [...makeFish('discusblue', 30), ...makeFish('discusred', 30)]; // 共 60 條
  const m = coinSoftcap.drMultForFish(CFG, 'discusblue', allFish);
  // 60 條在 discus 群：前 40 × 1.0，後 20 × 0.6；平均 = (40 + 12) / 60 ≈ 0.8667
  const expected = (40 * 1 + 20 * 0.6) / 60;
  assert.ok(Math.abs(m - expected) < 1e-9, `測試 3 失敗：混群 60 條 DR 應約 ${expected.toFixed(4)}，實際 ${m}`);
  console.log('✓ 測試 3：30 discusblue + 30 discusred 合算同群，DR ≈ 0.867');
}

// ── 測試 4：DR 豁免：priceGems > 0 → 倍率恆 1.0 ─────────────────────────────
{
  // 100 條付費魚，不套用 DR
  const allFish = makeFish('p_goldfish', 100);
  const m = coinSoftcap.drMultForFish(CFG, 'p_goldfish', allFish);
  assert.equal(m, 1, `測試 4 失敗：付費魚 DR 應為 1，實際 ${m}`);
  console.log('✓ 測試 4：priceGems 付費魚豁免 DR → 倍率 1.0');
}

// ── 測試 5：DR 豁免：dmmLargeSchool → 倍率恆 1.0 ───────────────────────────
{
  const allFish = makeFish('p_trevally', 100);
  const m = coinSoftcap.drMultForFish(CFG, 'p_trevally', allFish);
  assert.equal(m, 1, `測試 5 失敗：dmmLargeSchool 魚 DR 應為 1，實際 ${m}`);
  console.log('✓ 測試 5：dmmLargeSchool 魚豁免 DR → 倍率 1.0');
}

// ── 測試 6：混種 discusblue × discusred 歸屬 discus 群 ───────────────────────
{
  const hybridSp = 'hx:discusblue+discusred';
  // 加入 30 discusblue + 30 hybrid = 60 條 discus 群魚
  const allFish = [...makeFish('discusblue', 30), ...makeFish(hybridSp, 30)];
  const mHybrid = coinSoftcap.drMultForFish(CFG, hybridSp, allFish);
  const mDiscus = coinSoftcap.drMultForFish(CFG, 'discusblue', allFish);
  // 兩者都在同一 discus 群，DR 倍率應相同
  assert.ok(Math.abs(mHybrid - mDiscus) < 1e-9, `測試 6 失敗：混種 DR 倍率 ${mHybrid} 應等於 discusblue DR 倍率 ${mDiscus}`);
  console.log('✓ 測試 6：hx:discusblue+discusred 混種歸屬 discus 群，DR 與 discusblue 一致');
}

// ── 測試 7：全帳號 softcap（multForPlayer 合算兩缸費率）────────────────────
{
  // 使用 p_goldfish（coin=10、priceGems>0 → 豁免 DR），方便計算理論費率
  // 每條成魚：baseDrop = round(10×1×decoM×waterMult) = round(10×1×1.1) = 11
  //          avgInterval = 60s → 11/60 ≈ 0.1833/s × 3600 = 660 金幣/小時
  // kneePerHour = 60000 → 需 ≥ 92 條才超過 knee
  //
  // 情境 A：單缸 50 條 → R = 50 × 660 = 33000/hr < K → softcap = 1
  // 情境 B：兩缸各 50 條（合計 100 條）→ R = 100 × 660 = 66000/hr > K → softcap < 1

  const save1 = makeSave(makeFish('p_goldfish', 50));
  const save2 = makeSave(makeFish('p_goldfish', 50));

  const m1 = coinSoftcap.multForPlayer(CFG, [save1]);           // 單缸
  const mPlayer = coinSoftcap.multForPlayer(CFG, [save1, save2]); // 兩缸合算

  assert.equal(m1, 1, `測試 7a 失敗：50 條付費魚單缸 softcap 應為 1，實際 ${m1}`);
  assert.ok(mPlayer < 1, `測試 7b 失敗：100 條合算後 softcap 應 < 1，實際 ${mPlayer}`);
  assert.ok(mPlayer < m1, `測試 7c 失敗：合算兩缸後 softcap 應比單缸低，合算 ${mPlayer} < 單缸 ${m1}`);

  // R(2缸) ≈ 66000；公式：m = (60000/66000)^0.2
  const K = 60000, R2 = 66000, exp = 0.8;
  const expected = Math.pow(K / R2, 1 - exp);
  assert.ok(Math.abs(mPlayer - expected) < 0.02,
    `測試 7d 失敗：合算 softcap 應 ≈ ${expected.toFixed(4)}，實際 ${mPlayer.toFixed(4)}`);
  console.log(`✓ 測試 7：全帳號合算 softcap（兩缸 100 條付費魚→softcap≈${mPlayer.toFixed(4)}，低於單缸 ${m1}）`);
}

// ── 測試 8：每日生產上限 ─────────────────────────────────────────────────────
{
  // 以記憶體 Map 模擬 SQLite-like 介面
  const store = new Map();
  const db = {
    get(sql, params) {
      const key = params.join(':');
      return store.get(key) || null;
    },
    run(sql, params) {
      if (sql.includes('INSERT INTO player_production_daily')) {
        const key = `${params[0]}:${params[1]}`;
        const existing = store.get(key) || { produced: 0 };
        // simulate ON CONFLICT DO UPDATE SET produced = produced + excluded.produced
        store.set(key, { produced: existing.produced + params[2] });
      }
    },
  };

  const pid = 'player1';
  const cfg = { coins: { dailyCapPerPlayer: 250000 } };
  const nowMs = Date.now();

  // 初始剩餘應為上限
  const rem0 = dailyProd.remaining(db, pid, cfg, nowMs);
  assert.equal(rem0, 250000, `測試 8a 失敗：初始剩餘應為 250000，實際 ${rem0}`);

  // consume 100000
  const actual1 = dailyProd.consume(db, pid, 100000, cfg, nowMs);
  assert.equal(actual1, 100000, `測試 8b 失敗：應入帳 100000，實際 ${actual1}`);

  const rem1 = dailyProd.remaining(db, pid, cfg, nowMs);
  assert.equal(rem1, 150000, `測試 8c 失敗：剩餘應為 150000，實際 ${rem1}`);

  // consume 超出剩餘的量（200000 > 150000）
  const actual2 = dailyProd.consume(db, pid, 200000, cfg, nowMs);
  assert.equal(actual2, 150000, `測試 8d 失敗：超出部分應截斷為 150000，實際 ${actual2}`);

  const rem2 = dailyProd.remaining(db, pid, cfg, nowMs);
  assert.equal(rem2, 0, `測試 8e 失敗：耗盡後剩餘應為 0，實際 ${rem2}`);

  // consume 超出後應回傳 0
  const actual3 = dailyProd.consume(db, pid, 1000, cfg, nowMs);
  assert.equal(actual3, 0, `測試 8f 失敗：超出後應回傳 0，實際 ${actual3}`);

  console.log('✓ 測試 8：每日生產上限 250,000 枚，consume / remaining 行為正確');
}

// ── 測試 9：每日 key 以台北時間（UTC+8）計算 ──────────────────────────────
{
  // UTC 2024-01-15 15:59:59（UTC+8 = 2024-01-15 23:59:59）
  const msA = Date.UTC(2024, 0, 15, 15, 59, 59);
  // UTC 2024-01-15 16:00:00（UTC+8 = 2024-01-16 00:00:00）→ 新的一天
  const msB = Date.UTC(2024, 0, 15, 16, 0, 0);
  const keyA = dailyProd.taipeiDayKey(msA);
  const keyB = dailyProd.taipeiDayKey(msB);
  assert.notEqual(keyA, keyB, `測試 9 失敗：UTC 16:00:00 應進入新的台北時間日`);
  assert.equal(Number(keyB), Number(keyA) + 1, `測試 9 失敗：新的一天 key 應比前一天大 1`);
  console.log('✓ 測試 9：台北時間日 key 在 UTC 16:00:00 切換');
}

// ── 測試 10：設定 v73 驗證 ───────────────────────────────────────────────────
{
  const goodCfg = {
    species: {
      discusblue: { coin: 6 },
      discusred:  { coin: 6 },
    },
    coins: {
      dailyCapPerPlayer: 250000,
      drThresholds: [40, 80],
      drRates: [1, 0.6, 0.3],
    },
  };
  const errs0 = patchCfg.verifyConfigV73(goodCfg);
  assert.equal(errs0.length, 0, `測試 10a 失敗：正確設定不應有錯誤，實際：${errs0.join(', ')}`);

  const badCfg = { ...goodCfg, species: { discusblue: { coin: 11 }, discusred: { coin: 11 } } };
  const errs1 = patchCfg.verifyConfigV73(badCfg);
  assert.ok(errs1.some(e => e.includes('discusblue')), `測試 10b 失敗：舊 coin 值應被偵測到`);
  assert.ok(errs1.some(e => e.includes('discusred')),  `測試 10c 失敗：舊 coin 值應被偵測到`);
  console.log('✓ 測試 10：patch-config verifyConfigV73 正確偵測設定問題');
}

// ── 測試 11：softcap 公式正確（m = (K/R)^0.2） ───────────────────────────────
{
  const K = 60000, exp = 0.8;
  const R = 120000; // R = 2K → m = (1/2)^0.2 ≈ 0.8706
  const m = coinSoftcap.softcapMult(CFG, R);
  const expected = Math.pow(K / R, 1 - exp);
  assert.ok(Math.abs(m - expected) < 1e-10, `測試 11 失敗：softcap 公式錯誤，預期 ${expected.toFixed(6)}，實際 ${m}`);
  console.log(`✓ 測試 11：softcap 公式 (K/R)^(1-exp) 正確（m=${m.toFixed(4)}）`);
}

// ── 測試 12：drGroupKey 正確辨識 ──────────────────────────────────────────────
{
  assert.equal(coinSoftcap.drGroupKey(CFG, 'discusblue'), 'discus', '測試 12a');
  assert.equal(coinSoftcap.drGroupKey(CFG, 'discusred'),  'discus', '測試 12b');
  assert.equal(coinSoftcap.drGroupKey(CFG, 'hx:discusblue+discusred'), 'discus', '測試 12c：混種應歸 discus 群');
  assert.equal(coinSoftcap.drGroupKey(CFG, 'neon'),       'neon',   '測試 12d：霓虹燈不在 discus 群');
  console.log('✓ 測試 12：drGroupKey 正確分群');
}

console.log('\n✅ 全部 12 項測試通過');
