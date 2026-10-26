#!/usr/bin/env node
'use strict';
/**
 * Idempotent migration: mark currently owned bonus decor as legacyDeco (grandfathered bonuses).
 * Run as fishgame user, e.g.:
 *   DATA_DIR=/var/lib/fishgame node scripts/migrate-legacy-deco.js
 *   DATA_DIR=/var/lib/fishgame node scripts/migrate-legacy-deco.js --dry-run
 */
const path = require('path');
const { openDb } = require('../src/db');
const { ConfigStore } = require('../src/config-store');
const {
  collectOwnedDecoKeys,
  addLegacyForOwned,
  normList,
  hasBonus,
  pruneLegacyDeco,
} = require('../src/legacy-deco');

const dry = process.argv.includes('--dry-run');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = openDb(dataDir);
const cfg = new ConfigStore(db).active().config;

let playersScanned = 0;
let playersMarked = 0;
let keysMarked = 0;

function migrateSave(save, bundles) {
  const before = new Set(normList(save.legacyDeco));
  pruneLegacyDeco(cfg, save, bundles);
  const owned = collectOwnedDecoKeys(save, bundles);
  const toAdd = owned.filter((k) => hasBonus(cfg, k) && !before.has(k) && !normList(save.legacyDeco).includes(k));
  if (toAdd.length) addLegacyForOwned(cfg, save, toAdd);
  const after = new Set(normList(save.legacyDeco));
  if (before.size === after.size && [...before].every((k) => after.has(k))) return { changed: false, keysDelta: 0 };
  let keysDelta = 0;
  for (const k of after) if (!before.has(k)) keysDelta++;
  for (const k of before) if (!after.has(k)) keysDelta++;
  return { changed: true, keysDelta };
}

const runMigration = () => {
  const storedRows = db.prepare('SELECT player_id, bundle FROM deco_storage').all();
  const byPlayer = new Map();
  for (const r of storedRows) {
    let bundle;
    try {
      bundle = JSON.parse(r.bundle);
    } catch {
      continue;
    }
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(bundle);
  }
  const rows = db.prepare('SELECT player_id, data, rev FROM saves').all();
  const pending = [];
  for (const row of rows) {
    playersScanned++;
    let save;
    try {
      save = JSON.parse(row.data);
    } catch {
      continue;
    }
    const bundles = byPlayer.get(row.player_id) || [];
    const { changed, keysDelta } = migrateSave(save, bundles);
    if (!changed) continue;
    playersMarked++;
    keysMarked += keysDelta;
    pending.push({ row, save });
  }
  if (!pending.length) return;
  const t = Date.now();
  const upd = db.prepare(
    `UPDATE saves SET data=?, rev=?, updated_at=?, coins=?, fish_count=?, found_count=? WHERE player_id=?`
  );
  for (const { row, save } of pending) {
    const rev = row.rev + 1;
    save._serverSync = rev;
    const found = save.found && typeof save.found === 'object' ? Object.keys(save.found) : [];
    upd.run(
      JSON.stringify(save),
      rev,
      t,
      save.coins || 0,
      (save.fish || []).length,
      found.length,
      row.player_id
    );
  }
};

if (!dry) db.transaction(runMigration)();
else runMigration();
db.close();

const dbPath = dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'fishgame.sqlite');
console.log(
  JSON.stringify(
    {
      dryRun: dry,
      dbPath,
      configDecor: Object.keys(cfg.decorations || {}).length,
      playersScanned,
      playersMarked,
      keysMarked,
    },
    null,
    2
  )
);
