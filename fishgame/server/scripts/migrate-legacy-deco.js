#!/usr/bin/env node
'use strict';
/**
 * Idempotent migration: mark currently owned bonus decor as legacyDeco (grandfathered bonuses).
 * Run as fishgame user, e.g.:
 *   DATA_DIR=/var/lib/fishgame node scripts/migrate-legacy-deco.js
 *   DATA_DIR=/var/lib/fishgame node scripts/migrate-legacy-deco.js --dry-run
 */
const path = require('path');
const Database = require('better-sqlite3');
const { collectOwnedDecoKeys, addLegacyForOwned, normList, hasBonus } = require('../src/legacy-deco');

const dry = process.argv.includes('--dry-run');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'fishgame.db');
const cfg = require(path.join(__dirname, '..', 'seed', 'default-config.json'));

const db = new Database(dbPath, { readonly: dry });
const stored = db.prepare('SELECT player_id, bundle FROM deco_storage').all();
const byPlayer = new Map();
for (const r of stored) {
  let bundle;
  try {
    bundle = JSON.parse(r.bundle);
  } catch {
    continue;
  }
  if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
  byPlayer.get(r.player_id).push(bundle);
}

const rows = db.prepare('SELECT player_id, data FROM saves').all();
let players = 0;
let updated = 0;
let keysAdded = 0;

const upd = dry ? null : db.prepare('UPDATE saves SET data=? WHERE player_id=?');

for (const row of rows) {
  players++;
  let save;
  try {
    save = JSON.parse(row.data);
  } catch {
    continue;
  }
  const before = new Set(normList(save.legacyDeco));
  const owned = collectOwnedDecoKeys(save, byPlayer.get(row.player_id) || []);
  const toAdd = owned.filter((k) => hasBonus(cfg, k) && !before.has(k));
  if (!toAdd.length) continue;
  addLegacyForOwned(cfg, save, toAdd);
  const after = normList(save.legacyDeco);
  if (after.length === before.size) continue;
  updated++;
  keysAdded += after.length - before.size;
  if (!dry) upd.run(JSON.stringify(save), row.player_id);
}

console.log(JSON.stringify({ dryRun: dry, dbPath, players, updated, keysAdded }, null, 2));
if (!dry) db.close();
