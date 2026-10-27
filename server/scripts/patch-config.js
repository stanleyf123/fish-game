#!/usr/bin/env node
// 只改目前生效設定中的指定欄位（保留後台其他修改），驗證後存成新版本（可在後台「版本紀錄」或 rollback 回復）。
// 用法：DATA_DIR=/var/lib/fishgame node scripts/patch-config.js '{"water.dirtPerBioloadHour":0.18}' "備註" [--dry-run]
'use strict';
require('./load-env');
const path = require('path');
const { openDb } = require('../src/db');
const { ConfigStore } = require('../src/config-store');
const { validateConfig } = require('../src/config-validate');
const patch = JSON.parse(process.argv[2] || '{}'), note = process.argv[3] || '設定調整', dry = process.argv.includes('--dry-run');
if (!Object.keys(patch).length) { console.error('沒有要修改的欄位'); process.exit(1); }
const db = openDb(process.env.DATA_DIR || path.join(__dirname, '../data'));
const store = new ConfigStore(db);
const cur = store.active(), next = JSON.parse(JSON.stringify(cur.config));
for (const [k, v] of Object.entries(patch)) {
  const ks = k.split('.'); let o = next; for (const x of ks.slice(0, -1)) { if (o[x] == null || typeof o[x] !== 'object') { console.error('找不到欄位 ' + k); process.exit(1); } o = o[x]; }
  console.log(`${k}: ${JSON.stringify(o[ks.at(-1)])} → ${JSON.stringify(v)}`); o[ks.at(-1)] = v;
}
const errs = validateConfig(next); if (errs.length) { console.error('驗證失敗', errs.slice(0, 5)); process.exit(1); }
const latest = store.list(1)[0];
console.log(`目前生效 v${cur.version}（建立者 ${latest && latest.created_by}）`);
if (dry) { console.log('（dry-run，未寫入）'); db.close(); process.exit(0); }
const v = store.save(next, note, 'deploy');
console.log(`已發布設定 v${v}（以 v${cur.version} 為基礎，只改上列欄位）`);
db.close();
