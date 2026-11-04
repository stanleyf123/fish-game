'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { softcapMult, theoreticalRatePerHour, multForSave } = require('../src/coin-softcap');
const { saleActive, shopVisible, parseWhen } = require('../src/sale-window');
const { checkSave, maxCoinRate } = require('../src/anticheat');

function merge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) out[k] = merge(a[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

function loadCfg() {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/live-config-v59.json'), 'utf8'));
  const patch = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/coinsink-b1.patch.json'), 'utf8'));
  const { _comment, ...rest } = patch;
  return merge(base, rest);
}

function mkFish(sp, growth, id = 'f1') {
  return { id, sp, name: 't', growth, full: 100, health: 100, coinT: 10, size: 1 };
}

function clientSoftMult(cfg, save) {
  const sc = cfg.coins?.softcap || {};
  if (sc.enabled === false) return 1;
  let r = 0;
  const g1 = cfg.stages[1]?.growth ?? 100;
  const g2 = cfg.stages[2]?.growth ?? 100;
  const stg = (f) => (f.growth >= g2 ? 2 : f.growth >= g1 ? 1 : 0);
  for (const f of save.fish || []) {
    const st = stg(f);
    const iv = cfg.coins.intervalSecByStage[st];
    if (st <= 0 || !iv) continue;
    const s = cfg.species[f.sp];
    const drop = Math.max(1, Math.round((s.coin || 0) * cfg.stages[st].coinMultiplier));
    r += drop / ((iv[0] + iv[1]) / 2) * (cfg.care?.timeScale || 1);
  }
  const R = r * 3600;
  const K = sc.kneePerHour ?? 50000;
  const exp = sc.exp ?? 0.8;
  return R <= K ? 1 : Math.pow(K / R, 1 - exp);
}

describe('COINSINK-B1-CURVE', () => {
  const cfg = loadCfg();

  it('softcap off keeps m=1', () => {
    const c = merge(cfg, { coins: { softcap: { enabled: false, kneePerHour: 50000, exp: 0.8 } } });
    assert.equal(softcapMult(c, 200000), 1);
  });

  it('Lv9-scale R below knee unchanged (m=1)', () => {
    const save = { fish: [mkFish('neon', cfg.stages[2].growth)], up: { cap: 9, deco: [], food: 0, feeder: 0, filter: 0 }, water: { cycle: 100 }, legacyDeco: [] };
    const R = theoreticalRatePerHour(cfg, save);
    assert.ok(R < 50000, `expected R<50k got ${R}`);
    assert.equal(multForSave(cfg, save), 1);
  });

  it('client and server mult match within rounding', () => {
    const save = {
      fish: Array.from({ length: 80 }, (_, i) => mkFish('neon', cfg.stages[2].growth, 'n' + i)),
      up: { cap: 11, deco: [], food: 2, feeder: 2, filter: 2 },
      water: { cycle: 100 },
      legacyDeco: [],
    };
    const sm = multForSave(cfg, save);
    const cm = clientSoftMult(cfg, save);
    assert.ok(Math.abs(sm - cm) < 0.02, `server ${sm} vs client ${cm}`);
  });

  it('anticheat accepts income at curved cap', () => {
    const prev = {
      coins: 1000,
      fish: Array.from({ length: 120 }, (_, i) => mkFish('neon', cfg.stages[2].growth, 'x' + i)),
      up: { cap: 12, deco: [], food: 2, feeder: 2, filter: 2 },
      water: { cycle: 100 },
      last: Date.now() - 3600000,
      legacyDeco: [],
    };
    const m = multForSave(cfg, prev);
    const elapsed = 3600;
    const rate = maxCoinRate(cfg, 12, 0, 0, prev.legacyDeco) * m;
    const gain = Math.floor(rate * elapsed * 0.95);
    const next = { ...prev, coins: prev.coins + gain, last: Date.now() };
    const r = checkSave(cfg, prev, prev.last, next, Date.now(), { coinRateMult: 1 });
    assert.equal(r.structural.length, 0);
    assert.equal(r.suspicious.length, 0);
  });

  it('PLAN Lv12 reference R≈14.1萬/h yields m≈0.81 (−19~24%)', () => {
    const m = softcapMult(cfg, 141000);
    assert.ok(m >= 0.79 && m <= 0.83, `expected m ~0.81 at R=141k/h, got ${m}`);
  });

  it('high-R save mult matches softcap on theoretical R', () => {
    const top = Object.entries(cfg.species)
      .filter(([, s]) => s.coin >= 80 && !s.disabled && !s.priceGems)
      .sort((a, b) => b[1].coin - a[1].coin)
      .slice(0, 6)
      .map(([k]) => k);
    assert.ok(top.length >= 3);
    const fish = [];
    for (let i = 0; i < 120; i++) fish.push(mkFish(top[i % top.length], cfg.stages[2].growth, 'h' + i));
    const save = { fish, up: { cap: 12, deco: [], food: 2, feeder: 2, filter: 2 }, water: { cycle: 100 }, legacyDeco: [] };
    const R = theoreticalRatePerHour(cfg, save);
    const mSave = multForSave(cfg, save);
    const mDirect = softcapMult(cfg, R);
    assert.ok(Math.abs(mSave - mDirect) < 1e-9);
    if (R > 50000) assert.ok(mSave < 1 && mSave > 0.2);
  });
});

describe('COINSINK-B1-XMAS gating', () => {
  const cfg = loadCfg();
  const xmasBg = cfg.cosmetics.coinBackgrounds.bg_coin_xmas_town;
  const xmasDeco = cfg.decorations.cs_b1_xmas_snowman;

  it('before window blocks purchase visibility', () => {
    const t = parseWhen(xmasBg.availableFrom) - 1000;
    assert.equal(saleActive(xmasBg, t), false);
    assert.equal(shopVisible(xmasBg, false, t), false);
  });

  it('inside window allows sale', () => {
    const t = parseWhen(xmasBg.availableFrom) + 60000;
    assert.equal(saleActive(xmasBg, t), true);
    assert.equal(shopVisible(xmasBg, false, t), true);
  });

  it('after window hides but owned stays visible', () => {
    const t = parseWhen(xmasBg.availableUntil) + 1000;
    assert.equal(saleActive(xmasBg, t), false);
    assert.equal(shopVisible(xmasBg, true, t), true);
    assert.equal(shopVisible(xmasDeco, false, t), false);
  });

  it('deco minTankLevel present on patch items', () => {
    assert.equal(cfg.decorations.cs_b1_ruins_pillar.minTankLevel, 11);
    assert.equal(cfg.decorations.cs_b1_garden_lantern.minTankLevel, 10);
  });
});
