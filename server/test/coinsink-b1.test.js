'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { softcapMult, theoreticalRatePerHour, multForSave, softcapCfg, clientMirrorRatePerHour } = require('../src/coin-softcap');
const { saleActive, shopVisible, parseWhen } = require('../src/sale-window');
const { gateNewDecoPurchase } = require('../src/deco-purchase-gate');
const { checkSave, maxCoinRate } = require('../src/anticheat');
const { coinBonusSum } = require('../src/legacy-deco');
const { loadPurchaseSets } = require('../src/coinsink-purchase');
const { clientMultFromHtml } = require('./client-coinsoftcap-html');
const Database = require('better-sqlite3');

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

function mkPurchaseDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE deco_inventory_ops(player_id INTEGER NOT NULL, idem_key TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id, idem_key))`);
  db.exec(`CREATE TABLE coin_cosmetic_ops(player_id INTEGER NOT NULL, idem TEXT NOT NULL, cosmetic_id TEXT NOT NULL, price INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id, idem))`);
  return db;
}

function mkFish(sp, growth, id = 'f1') {
  return { id, sp, name: 't', growth, full: 100, health: 100, coinT: 10, size: 1 };
}

function richSave(cfg, decoIds = []) {
  return {
    coins: 500000,
    fish: Array.from({ length: 80 }, (_, i) => mkFish('neon', cfg.stages[2].growth, 'n' + i)),
    up: { cap: 12, deco: decoIds, food: 2, feeder: 2, filter: 2 },
    water: { dirt: 10 },
    legacyDeco: [],
  };
}

function htmlHelpers(cfg, save) {
  return {
    decoMult: () => 1 + coinBonusSum(cfg, save),
    waterGrade: () => {
      const grades = cfg.water?.grades || [];
      const d = save.water?.dirt ?? 0;
      for (const g of grades) if (d < g.below) return g;
      return grades[grades.length - 1] || { coinMultiplier: 1 };
    },
    vip: { coinBonus: 0 },
    nbOn: () => false,
    AQ: null,
    aqMods: () => ({ coin: 1 }),
  };
}

describe('COINSINK-B1-CURVE', () => {
  const cfg = loadCfg();

  it('patch config uses K=60000/h', () => {
    assert.equal(cfg.coins.softcap.kneePerHour, 60000);
    assert.equal(cfg.coins.softcap.exp, 0.8);
  });

  it('default knee is 60000 when unset', () => {
    const sc = softcapCfg({ coins: { softcap: { enabled: true, exp: 0.8 } } });
    assert.equal(sc.kneePerHour, 60000);
  });

  it('softcap off keeps m=1', () => {
    const c = merge(cfg, { coins: { softcap: { enabled: false, kneePerHour: 60000, exp: 0.8 } } });
    assert.equal(softcapMult(c, 200000), 1);
  });

  it('Lv9-scale R below knee unchanged (m=1)', () => {
    const save = { fish: [mkFish('neon', cfg.stages[2].growth)], up: { cap: 9, deco: [], food: 0, feeder: 0, filter: 0 }, water: { dirt: 10 }, legacyDeco: [] };
    const R = theoreticalRatePerHour(cfg, save);
    assert.ok(R < 60000, `expected R<60k got ${R}`);
    assert.equal(multForSave(cfg, save), 1);
    assert.equal(softcapMult(cfg, 24000), 1);
  });

  it('softcap mult within 0.5% of (60000/R)^0.2 at reference R', () => {
    const exp = 0.8;
    for (const R of [73500, 85000, 141000, 250000]) {
      const expected = Math.pow(60000 / R, 1 - exp);
      const got = softcapMult(cfg, R);
      assert.ok(Math.abs(got - expected) / expected < 0.005, `R=${R} got ${got} expected ${expected}`);
    }
  });

  it('client index.html coinSoftMult matches server mirror within 0.5%', () => {
    const save = {
      fish: Array.from({ length: 80 }, (_, i) => mkFish('neon', cfg.stages[2].growth, 'n' + i)),
      up: { cap: 11, deco: [], food: 2, feeder: 2, filter: 2 },
      water: { dirt: 12 },
      legacyDeco: [],
    };
    const sm = multForSave(cfg, save);
    const cmHtml = clientMultFromHtml(cfg, save, htmlHelpers(cfg, save));
    assert.ok(Math.abs(sm - cmHtml) / Math.max(sm, 1e-9) < 0.005, `server ${sm} vs html ${cmHtml}`);
    const R = clientMirrorRatePerHour(cfg, save);
    assert.ok(Math.abs(softcapMult(cfg, R) - sm) < 1e-9);
  });

  it('anticheat accepts income at curved cap', () => {
    const prev = {
      coins: 1000,
      fish: Array.from({ length: 120 }, (_, i) => mkFish('neon', cfg.stages[2].growth, 'x' + i)),
      up: { cap: 12, deco: [], food: 2, feeder: 2, filter: 2 },
      water: { dirt: 10 },
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

  it('K=60000 impact at plan reference R (Lv10/Lv11/Lv12)', () => {
    const drop = (R) => (1 - softcapMult(cfg, R)) * 100;
    assert.equal(softcapMult(cfg, 48000), 1);
    assert.ok(Math.abs(drop(73586) - 4) < 0.15, `Lv10 ~4% got ${drop(73586).toFixed(2)}%`);
    assert.ok(Math.abs(drop(85000) - 6.73) < 0.2, `Lv11 ~7% got ${drop(85000).toFixed(2)}%`);
    assert.ok(Math.abs(drop(141000) - 15.71) < 0.2, `Lv12 ~16% got ${drop(141000).toFixed(2)}%`);
    assert.ok(Math.abs(softcapMult(cfg, 141000) - 0.8429201340427603) < 1e-12);
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
    const save = { fish, up: { cap: 12, deco: [], food: 2, feeder: 2, filter: 2 }, water: { dirt: 8 }, legacyDeco: [] };
    const R = theoreticalRatePerHour(cfg, save);
    const mSave = multForSave(cfg, save);
    const mDirect = softcapMult(cfg, R);
    assert.ok(Math.abs(mSave - mDirect) < 1e-9);
    if (R > 60000) assert.ok(mSave < 1 && mSave > 0.2);
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

  it('Christmas decos omit minTankLevel', () => {
    assert.equal(cfg.decorations.cs_b1_xmas_snowman.minTankLevel, undefined);
  });

  it('gate rejects xmas deco before sale window', () => {
    const t = parseWhen(xmasDeco.availableFrom) - 1000;
    const save = { up: { cap: 12, deco: [] }, coins: 1e9 };
    assert.equal(gateNewDecoPurchase(cfg, 'cs_b1_xmas_snowman', save, t), 'sale_window');
  });

  it('anticheat flags forged coinsink decos before sale / below cap', () => {
    const beforeXmas = parseWhen(xmasDeco.availableFrom) - 86400000;
    const prev = { coins: 5e6, fish: [], up: { cap: 8, deco: [], food: 0, feeder: 0, filter: 0 }, water: { dirt: 0 }, last: beforeXmas - 1000 };
    const next = {
      ...prev,
      up: { cap: 8, deco: ['cs_b1_xmas_snowman', 'cs_b1_star_flag'], food: 0, feeder: 0, filter: 0 },
      last: beforeXmas,
    };
    const r = checkSave(cfg, prev, prev.last, next, beforeXmas, { coinsinkPurchases: { decos: new Set(), backgrounds: new Set() } });
    assert.ok(r.suspicious.some((s) => s.includes('不在販售期間')));
    assert.ok(r.suspicious.some((s) => s.includes('魚缸容量 Lv12')));
  });
});

describe('COINSINK-B1 patch assets', () => {
  const cfg = loadCfg();

  it('coin background images omit art/ prefix', () => {
    for (const th of Object.values(cfg.cosmetics.coinBackgrounds || {})) {
      if (!th.image || String(th.image).startsWith('/')) continue;
      assert.ok(!String(th.image).startsWith('art/'), th.image);
      assert.match(String(th.image), /^coinsink\//);
    }
  });

  it('coin backgrounds have portrait + wide paths', () => {
    const bg = cfg.cosmetics.coinBackgrounds;
    assert.equal(cfg.coinsinkEvents.xmas2026.label, '🎄 雪夜小鎮');
    assert.equal(bg.bg_coin_xmas_town.name, '雪夜小鎮');
    assert.match(bg.bg_coin_forest_spring.image, /^coinsink\/bg_coin_forest_spring\.webp$/);
    assert.match(bg.bg_coin_forest_spring.imageWide, /^coinsink\/bg_coin_forest_spring-wide\.webp$/);
    for (const id of ['forest_spring', 'summer_cloud', 'cloud_ruins', 'star_sea', 'xmas_town']) {
      const b = bg['bg_coin_' + id];
      assert.equal(b.image, `coinsink/bg_coin_${id}.webp`);
      assert.equal(b.imageWide, `coinsink/bg_coin_${id}-wide.webp`);
    }
  });
});

describe('COINSINK-B1 prices (×2)', () => {
  const cfg = loadCfg();
  const bg = cfg.cosmetics.coinBackgrounds;
  const d = cfg.decorations;

  it('collector backgrounds coin + gem dual prices', () => {
    assert.equal(bg.bg_coin_forest_spring.priceCoins, 600000);
    assert.equal(bg.bg_coin_forest_spring.priceGems, 500);
    assert.equal(bg.bg_coin_summer_cloud.priceCoins, 1200000);
    assert.equal(bg.bg_coin_summer_cloud.priceGems, 650);
    assert.equal(bg.bg_coin_cloud_ruins.priceCoins, 2400000);
    assert.equal(bg.bg_coin_cloud_ruins.priceGems, 800);
    assert.equal(bg.bg_coin_star_sea.priceCoins, 4000000);
    assert.equal(bg.bg_coin_star_sea.priceGems, 1000);
  });

  it('christmas gems-only (no coin prices)', () => {
    assert.equal(bg.bg_coin_xmas_town.priceGems, 500);
    assert.equal(bg.bg_coin_xmas_town.priceCoins, undefined);
    assert.equal(d.cs_b1_xmas_snowman.priceGems, 100);
    assert.equal(d.cs_b1_xmas_snowman.cost, 0);
    assert.equal(d.cs_b1_xmas_arch.priceGems, 300);
  });

  it('collector deco coin + gem dual prices', () => {
    assert.equal(d.cs_b1_garden_lantern.cost, 100000);
    assert.equal(d.cs_b1_garden_lantern.priceGems, 100);
    assert.equal(d.cs_b1_ruins_pillar.cost, 200000);
    assert.equal(d.cs_b1_ruins_pillar.priceGems, 200);
    assert.equal(d.cs_b1_star_flag.cost, 360000);
    assert.equal(d.cs_b1_star_flag.priceGems, 300);
  });
});

describe('COINSINK-B1 server purchases', () => {
  const cfg = loadCfg();
  const { openDb } = require('../src/db');
  const { Players } = require('../src/players');
  const { Commerce } = require('../src/commerce');
  const { GemShop } = require('../src/gemshop');
  const { DecoInventory } = require('../src/deco-inventory');
  const { loadPurchaseSets } = require('../src/coinsink-purchase');
  const { HttpError } = require('../src/util');

  function harness(gems = 500, cap = 12) {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const di = new DecoInventory(db, players, commerce, configStore);
    players.decoInventory = di;
    const gs = new GemShop({ db, configStore, players, commerce });
    const t = Date.parse('2026-12-15T12:00:00+08:00');
    gs.now = () => t;
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, ?)').run('dev1', 't', t, t, gems);
    const save = { coins: 1e9, up: { cap, deco: [] }, fish: [], cos: { own: {}, bg: null } };
    players.writeSaveRow(1, save, 1, t, false);
    return { db, gs, di, commerce, players, pid: 1, t, rev: 1 };
  }

  it('buys collectible background with gems', () => {
    const { gs, db, pid } = harness();
    const r = gs.buyCoinCosmetic(pid, { id: 'bg_coin_forest_spring', idempotencyKey: 'coin-bg-test1', baseRev: 1, currency: 'gems' });
    assert.ok(r.save.cos.own.bg_coin_forest_spring);
    assert.equal(gs.commerce.balance(pid), 500 - 500);
    assert.ok(loadPurchaseSets(db, pid).backgrounds.has('bg_coin_forest_spring'));
  });

  it('buys collectible background with coins', () => {
    const { gs, db, pid } = harness();
    const r = gs.buyCoinCosmetic(pid, { id: 'bg_coin_forest_spring', idempotencyKey: 'coin-bg-test2', baseRev: 1, currency: 'coins' });
    assert.ok(r.save.cos.own.bg_coin_forest_spring);
    assert.ok(loadPurchaseSets(db, pid).backgrounds.has('bg_coin_forest_spring'));
  });

  it('rejects gem bg buy when insufficient gems', () => {
    const { gs, pid } = harness(100);
    assert.throws(() => gs.buyCoinCosmetic(pid, { id: 'bg_coin_forest_spring', idempotencyKey: 'coin-bg-test3', baseRev: 1, currency: 'gems' }), (e) => e instanceof HttpError && e.code === 'insufficient_gems');
  });

  it('rejects bg buy below minTankLevel', () => {
    const { gs, pid } = harness(500, 8);
    assert.throws(() => gs.buyCoinCosmetic(pid, { id: 'bg_coin_forest_spring', idempotencyKey: 'coin-bg-test4', baseRev: 1, currency: 'gems' }), (e) => e instanceof HttpError && e.code === 'tank_level_required');
  });

  it('buys collectible deco with gems via deco-inventory', () => {
    const { di, db, pid } = harness();
    const r = di.run(pid, { action: 'buy', id: 'cs_b1_garden_lantern', rev: 1, idempotencyKey: 'di_buygemtest00000001', currency: 'gems' });
    assert.ok(r.save.up.deco.includes('cs_b1_garden_lantern'));
    assert.ok(loadPurchaseSets(db, pid).decos.has('cs_b1_garden_lantern'));
  });

  it('buys collectible deco with coins unchanged', () => {
    const { di, db, pid } = harness();
    di.run(pid, { action: 'buy', id: 'cs_b1_garden_lantern', rev: 1, idempotencyKey: 'di_buycointest0000001', currency: 'coins' });
    assert.ok(loadPurchaseSets(db, pid).decos.has('cs_b1_garden_lantern'));
  });

  it('rejects deco gem buy when insufficient gems', () => {
    const { di, pid } = harness(50);
    assert.throws(() => di.run(pid, { action: 'buy', id: 'cs_b1_garden_lantern', rev: 1, idempotencyKey: 'di_buygemtest00000002', currency: 'gems' }), (e) => e instanceof HttpError && e.code === 'insufficient_gems');
  });

  it('rejects xmas deco outside sale window', () => {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const di = new DecoInventory(db, players, commerce, configStore);
    const t = parseWhen(cfg.decorations.cs_b1_xmas_snowman.availableFrom) - 86400000;
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, 999)').run('dev1', 't', t, t);
    players.writeSaveRow(1, { coins: 0, up: { cap: 12, deco: [] }, fish: [] }, 1, t, false);
    assert.throws(() => di.run(1, { action: 'buy', id: 'cs_b1_xmas_snowman', rev: 1, idempotencyKey: 'di_xmasout0000000001', currency: 'gems' }), (e) => e instanceof HttpError && e.message.includes('無法購買'));
  });
});

describe('COINSINK-B1 deco scale', () => {
  const { validateConfig } = require('../src/config-validate');
  const cfg = loadCfg();

  it('cs_b1 items have balanced scale in 0.4–2.0', () => {
    for (const [k, deco] of Object.entries(cfg.decorations)) {
      if (!k.startsWith('cs_b1_')) continue;
      assert.ok(deco.scale >= 0.4 && deco.scale <= 2, `${k} scale ${deco.scale}`);
    }
    assert.equal(cfg.decorations.cs_b1_garden_lotus.scale, 0.85);
    assert.equal(cfg.decorations.cs_b1_ruins_windmill.scale, 1);
    assert.equal(cfg.decorations.cs_b1_star_lighthouse.scale, 1.2);
  });

  it('validateConfig rejects out-of-range scale', () => {
    const bad = merge(cfg, {
      decorations: {
        cs_b1_garden_lantern: { ...cfg.decorations.cs_b1_garden_lantern, scale: 2.5 },
      },
    });
    const errs = validateConfig(bad);
    assert.ok(errs.some((e) => e.includes('decorations.cs_b1_garden_lantern.scale')));
  });

  it('legacy decoration without scale still validates', () => {
    const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/live-config-v59.json'), 'utf8'));
    const sampleKey = Object.keys(base.decorations || {}).find((k) => base.decorations[k].cost > 0 && !k.startsWith('cs_b1_'));
    assert.ok(sampleKey, 'need a legacy deco key');
    const deco = { ...base.decorations[sampleKey] };
    delete deco.scale;
    const mini = merge(base, { decorations: { [sampleKey]: deco } });
    const errs = validateConfig(mini).filter((e) => e.includes('.scale'));
    assert.equal(errs.length, 0);
  });

  it('merged patch config validates', () => {
    const errs = validateConfig(cfg);
    assert.equal(errs.length, 0, errs.join('; '));
  });
});

describe('COINSINK-B1 purchase records on save', () => {
  const cfg = loadCfg();
  const PID = 42;
  const decoId = 'cs_b1_garden_lantern';
  const cost = cfg.decorations[decoId].cost;

  it('rejects forged deco after long elapsed time without purchase record', () => {
    const db = mkPurchaseDb();
    const purchases = loadPurchaseSets(db, PID);
    const t0 = Date.now() - 98000;
    const prev = { ...richSave(cfg), coins: 50000, last: t0 };
    const m = multForSave(cfg, prev);
    const rate = maxCoinRate(cfg, 12, 0, 0, prev.legacyDeco) * m;
    const gain = Math.floor(rate * 98 * 0.95);
    const next = {
      ...prev,
      coins: prev.coins + gain,
      up: { ...prev.up, deco: [decoId] },
      last: t0 + 98000,
    };
    const r = checkSave(cfg, prev, t0, next, t0 + 98000, { coinRateMult: 1, coinsinkPurchases: purchases });
    assert.ok(r.suspicious.some((s) => s.includes('商店購買')), r.suspicious.join('; '));
    if (next.coins >= prev.coins + cost) {
      assert.ok(!r.suspicious.some((s) => s.startsWith('金幣增加過快')), 'coin allowance alone must not legitimize unpaid deco');
    }
  });

  it('accepts deco added after honest server buy record and coin spend', () => {
    const db = mkPurchaseDb();
    const receipt = JSON.stringify({ action: 'buy', id: decoId, ids: [decoId], amount: 0 });
    db.prepare('INSERT INTO deco_inventory_ops VALUES (?,?,?,?,?)').run(PID, 'di_testbuy001', '{"action":"buy","id":"cs_b1_garden_lantern"}', receipt, Date.now());
    const purchases = loadPurchaseSets(db, PID);
    assert.ok(purchases.decos.has(decoId));
    const t0 = Date.now() - 5000;
    const prev = { ...richSave(cfg), coins: 600000, last: t0 };
    const next = {
      ...prev,
      coins: prev.coins - cost,
      up: { ...prev.up, deco: [decoId] },
      last: t0 + 5000,
    };
    const r = checkSave(cfg, prev, t0, next, t0 + 5000, { coinRateMult: 1, coinsinkPurchases: purchases });
    assert.equal(r.structural.length, 0);
    assert.equal(r.suspicious.length, 0, r.suspicious.join('; '));
  });

  it('keeps decos already in previous save without purchase record', () => {
    const db = mkPurchaseDb();
    const purchases = loadPurchaseSets(db, PID);
    const t0 = Date.now() - 60000;
    const prev = { ...richSave(cfg, [decoId]), coins: 1000, last: t0 };
    const next = { ...prev, coins: prev.coins + 100, last: t0 + 60000 };
    const r = checkSave(cfg, prev, t0, next, t0 + 60000, { coinRateMult: 1, coinsinkPurchases: purchases });
    assert.ok(!r.suspicious.some((s) => s.includes('商店購買')));
  });

  it('rejects forged coin background without coin_cosmetic_ops', () => {
    const db = mkPurchaseDb();
    const purchases = loadPurchaseSets(db, PID);
    const bg = 'bg_coin_forest_spring';
    const t0 = Date.now() - 1000;
    const prev = { ...richSave(cfg), cos: { own: {}, bg: null }, last: t0 };
    const next = {
      ...prev,
      cos: { own: { [bg]: 1 }, bg },
      last: t0 + 1000,
    };
    const r = checkSave(cfg, prev, t0, next, t0 + 1000, { coinsinkPurchases: purchases });
    assert.ok(r.suspicious.some((s) => s.includes('背景') && s.includes('商店購買')));
  });
});

describe('COINSINK-B1 weekly shop guard', () => {
  const cfg = loadCfg();
  const { GemShop, weekOf } = require('../src/gemshop');
  const { openDb } = require('../src/db');
  const { Players } = require('../src/players');
  const { Commerce } = require('../src/commerce');
  const { HttpError } = require('../src/util');

  const nov24 = Date.parse('2025-11-24T12:00:00+08:00');

  function gsAt(t) {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const gs = new GemShop({ db, configStore, players, commerce });
    gs.now = () => t;
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, ?)').run('dev1', 't', t, t, 99999);
    players.writeSaveRow(1, { coins: 0, up: { cap: 0, deco: [] }, fish: [], cos: { own: {}, bg: null } }, 1, t, false);
    return { gs, db, pid: 1 };
  }

  it('excludes coin-sink backgrounds from weekly rotation at 2025-11-24', () => {
    const { gs } = gsAt(nov24);
    const w = gs.weekly(cfg, nov24);
    const bgIds = w.items.filter((it) => it.kind === 'bg').map((it) => it.id);
    assert.ok(!bgIds.some((id) => id.startsWith('bg_coin_')));
    assert.ok(!bgIds.includes('bg_coin_summer_cloud'));
  });

  it('rejects weekly buy of coin background even when forced in override', () => {
    const t = nov24;
    const wk = weekOf(t).week;
    const patched = merge(cfg, { weeklyShop: { override: { [wk]: ['bg_coin_summer_cloud'] } } });
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: patched, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const gs = new GemShop({ db, configStore, players, commerce });
    gs.now = () => t;
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, ?)').run('dev1', 't', t, t, 99999);
    players.writeSaveRow(1, { coins: 0, up: { cap: 0, deco: [] }, fish: [], cos: { own: {}, bg: null } }, 1, t, false);
    const items = gs.weekly(patched, t).items.filter((it) => it.kind === 'bg');
    assert.equal(items.length, 0);
    assert.throws(
      () => gs.buyWeekly(1, { id: 'bg_coin_summer_cloud', idempotencyKey: 'wk-coin-bg-test001' }),
      (e) => e instanceof HttpError && e.code === 'not_in_weekly',
    );
  });
});

describe('COINSINK-B1 deco sell price', () => {
  const cfg = loadCfg();
  const { openDb } = require('../src/db');
  const { Players } = require('../src/players');
  const { Commerce } = require('../src/commerce');
  const { DecoInventory } = require('../src/deco-inventory');

  it('dual-priced collectible resells at half coin cost not gem*10', () => {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const di = new DecoInventory(db, players, commerce, configStore);
    const cost = cfg.decorations.cs_b1_garden_lantern.cost;
    assert.equal(di.price('cs_b1_garden_lantern'), Math.floor(cost * 0.5));
  });
});

describe('COINSINK-B1 currency validation', () => {
  const cfg = loadCfg();
  const { openDb } = require('../src/db');
  const { Players } = require('../src/players');
  const { Commerce } = require('../src/commerce');
  const { DecoInventory } = require('../src/deco-inventory');
  const { GemShop } = require('../src/gemshop');
  const { HttpError } = require('../src/util');

  it('returns 400 when dual deco buy omits currency', () => {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const di = new DecoInventory(db, players, commerce, configStore);
    const t = Date.parse('2026-12-15T12:00:00+08:00');
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, ?)').run('dev1', 't', t, t, 500);
    players.writeSaveRow(1, { coins: 1e9, up: { cap: 12, deco: [] }, fish: [] }, 1, t, false);
    assert.throws(
      () => di.run(1, { action: 'buy', id: 'cs_b1_garden_lantern', rev: 1, idempotencyKey: 'di_nocur00000000001' }),
      (e) => e instanceof HttpError && e.status === 400 && e.code === 'currency_required',
    );
  });

  it('returns 400 when dual background buy omits currency', () => {
    const db = openDb(':memory:');
    const configStore = { active: () => ({ config: cfg, version: 1 }) };
    const commerceRef = { current: null };
    const players = new Players(db, configStore, () => '2026-01-01', commerceRef);
    const commerce = new Commerce(db, players, null, configStore, () => '2026-01-01');
    commerceRef.current = commerce;
    const gs = new GemShop({ db, configStore, players, commerce });
    const t = Date.parse('2026-12-15T12:00:00+08:00');
    gs.now = () => t;
    db.prepare('INSERT INTO players (id, device_hash, nickname, created_at, last_seen, gems) VALUES (1, ?, ?, ?, ?, ?)').run('dev1', 't', t, t, 500);
    players.writeSaveRow(1, { coins: 1e9, up: { cap: 12, deco: [] }, fish: [], cos: { own: {}, bg: null } }, 1, t, false);
    assert.throws(
      () => gs.buyCoinCosmetic(1, { id: 'bg_coin_forest_spring', idempotencyKey: 'coin-bg-nocur00001', baseRev: 1 }),
      (e) => e instanceof HttpError && e.status === 400 && e.code === 'currency_required',
    );
  });
});
