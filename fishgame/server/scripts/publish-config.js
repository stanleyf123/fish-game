#!/usr/bin/env node
// 發布新的遊戲設定版本（例如遊戲更新後的 seed/default-config.json）。會保留目前生效設定的 antiCheat 區塊。
// 用法：DATA_DIR=/var/lib/fishgame node scripts/publish-config.js [seed/default-config.json] ["備註"]
// 回復：後台「遊戲設定 → 版本紀錄」選前一版按回復
'use strict';
require('./load-env');
const fs = require('fs'), path = require('path');
const { openDb } = require('../src/db');
const { ConfigStore } = require('../src/config-store');
const file = process.argv[2] || path.join(__dirname, '../seed/default-config.json');
const note = process.argv[3] || '遊戲更新：' + path.basename(file);
const db = openDb(process.env.DATA_DIR || path.join(__dirname, '../data'));
const store = new ConfigStore(db);
const next = JSON.parse(fs.readFileSync(file, 'utf8'));
let prev = null; try { prev = store.active(); } catch { /* 尚無版本 */ }
if (prev && prev.config.antiCheat) next.antiCheat = { ...next.antiCheat, ...prev.config.antiCheat };
const v = store.save(next, note, 'deploy');
console.log(`已發布設定 v${v}（前一版 v${prev ? prev.version : '-'}）：${Object.keys(next.species).length} 種魚`);
db.close();
