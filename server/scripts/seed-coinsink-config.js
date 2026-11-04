#!/usr/bin/env node
'use strict';
/** Seed merged live v59 + coinsink-b1 patch into dev DB. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function merge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) out[k] = merge(a[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

const root = path.join(__dirname, '../..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'config/live-config-v59.json'), 'utf8'));
const patch = JSON.parse(fs.readFileSync(path.join(root, 'config/coinsink-b1.patch.json'), 'utf8'));
const { _comment, ...rest } = patch;
const cfg = merge(base, rest);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'fishgame.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS config_versions (
  version INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  rollback_of INTEGER
)`);
const cur = db.prepare('SELECT MAX(version) v FROM config_versions').get().v || 0;
if (cur === 0) {
  db.prepare('INSERT INTO config_versions (version, json, note, created_at, created_by) VALUES (1,?,?,?,?)')
    .run(JSON.stringify(cfg), 'coinsink-b1 dev seed (v59+patch)', Date.now(), 'coinsink-script');
  console.log('Seeded config v1');
} else {
  console.log('Config already present v' + cur + ', skip seed');
}
db.close();
