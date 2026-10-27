'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db');
const { ConfigStore } = require('../src/config-store');
const { Players } = require('../src/players');
const { HttpError } = require('../src/util');
const { checkSave } = require('../src/anticheat');

function loadCfg() {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const m = html.match(/const GAME_CONFIG=(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('GAME_CONFIG missing');
  // eslint-disable-next-line no-eval
  const cfg = eval('(' + m[1] + ')');
  cfg.antiCheat = { mode: 'reject', baseAllowance: 50, rateSlack: 3, minSaveIntervalSec: 2, maxFishSlack: 2, firstUploadMaxCoins: 5000, maxClockSkewSec: 300, rejectUnversioned: false, minClientBuild: '' };
  return cfg;
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-test-'));
  const db = openDb(path.join(dir, 'data'));
  const store = new ConfigStore(db);
  const cfg = loadCfg();
  store.save(cfg, 'test', 'test');
  const players = new Players(db, store, () => '2026-01-01', { current: () => ({ vipPerks: () => ({}) }) });
  const pid = players.guest('device-token-' + Math.random().toString(36).slice(2)).player.id;
  return { db, players, pid, cfg, dir };
}

test('sync mismatch returns 409 with cloud save (not 422)', () => {
  const { players, pid, dir } = setup();
  const base = players.freshSave(loadCfg());
  players.writeSaveRow(pid, base, 1, Date.now(), true);
  const cloud = players.getSave(pid).save;
  cloud._serverSync = 5;
  players.writeSaveRow(pid, cloud, 2, Date.now(), false);
  const next = JSON.parse(JSON.stringify(cloud));
  next._serverSync = 1;
  next.coins = (next.coins || 0) + 10;
  let err;
  try {
    players.putSave(pid, { save: next, rev: 2, client: '4.2.126' });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 409);
  assert.equal(err.extra?.code, 'sync_required');
  assert.ok(err.extra?.save);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anticheat credits deco_sell event coins', () => {
  const cfg = loadCfg();
  const prev = { coins: 1000, fish: [], up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] }, found: {}, water: {}, items: {}, last: Date.now() - 60000 };
  const next = { ...prev, coins: 2000 };
  const r = checkSave(cfg, prev, Date.now() - 30000, next, Date.now(), {
    events: [{ type: 'deco_sell', data: { amount: 1000 } }],
    vipCoinBonus: 0,
    coinRateMult: 1,
  });
  assert.equal(r.suspicious.length, 0);
});

test('anticheat credits fish_storage_buy spend', () => {
  const cfg = loadCfg();
  const sp = Object.keys(cfg.species).find((k) => cfg.species[k].price > 0 && !cfg.species[k].breedOnly);
  assert.ok(sp);
  const price = cfg.species[sp].price;
  const prev = { coins: 1000 + price, fish: [], up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] }, found: {}, water: {}, items: {}, last: Date.now() - 60000 };
  const next = { ...prev, coins: 1000, fish: [{ id: 't1', sp, name: 'a', hue: 0, size: 1, growth: 0, full: 80, health: 100, cd: 0, coinT: 0, seed: 1 }] };
  const r = checkSave(cfg, prev, Date.now() - 5000, next, Date.now(), {
    events: [{ type: 'fish_storage_buy', data: { amount: price, sp } }],
    vipCoinBonus: 0,
    coinRateMult: 1,
  });
  assert.ok(!r.suspicious.some((x) => x.startsWith('金幣增加過快')));
});
