#!/usr/bin/env node
// 英雄魚公平係數預先計算（部署前在 box 上跑）：以 seed/default-config.json（遊戲設定）＋英雄預設設定，
// 算出全部魚種 × 等級區間的公平係數與參考對手群，輸出 seed/hero-fair.json。
// 伺服器啟動時（mount.js）會把這個檔案匯入 hero_fair 表（INSERT OR IGNORE），正式機第一次開機就不必等 ~9 秒冷啟動。
// key 含設定雜湊：線上設定若不同（例如後台改過魚種），這些列只是用不到，背景 worker 會照常補算。
// 用法：node scripts/hero-precompute.js [seed/default-config.json] [seed/hero-fair.json]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { openDb } = require('../src/db');
const { HeroConfigStore } = require('../src/hero/config');
const ab = require('../src/hero/autobalance');
const S = require('../src/hero/stats');
const gameFile = process.argv[2] || path.join(__dirname, '../seed/default-config.json');
const out = process.argv[3] || path.join(__dirname, '../seed/hero-fair.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-pre-'));
const db = openDb(tmp);
const hcfg = new HeroConfigStore(db).active().config;
db.close(); fs.rmSync(tmp, { recursive: true, force: true });
const gameCfg = JSON.parse(fs.readFileSync(gameFile, 'utf8'));
const rows = {};
ab.setStore({ get: (k) => (k in rows ? rows[k] : null), put: (k, m) => { rows[k] = m; } });
const levels = ((hcfg.autoBalance || {}).levels || [1, 3, 8, 15, 30]);
const species = Object.keys(gameCfg.species).filter((k) => !gameCfg.species[k].disabled);
const hero = (sp, level) => ({ species: sp, growth: 999, level, train: {}, gear: {}, skills: {} });
const t0 = Date.now();
for (const level of levels) S.finalStats(hcfg, gameCfg, hero(species[0], level));
console.log(`參考對手群 ${levels.length} 個等級區間：${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
for (const level of levels) for (const sp of species) S.finalStats(hcfg, gameCfg, hero(sp, level));
const hash = ab.cfgHash(hcfg, gameCfg);
fs.writeFileSync(out, JSON.stringify({ hash, createdAt: Date.now(), rows }));
console.log(`已輸出 ${Object.keys(rows).length} 筆（設定雜湊 ${hash}）→ ${out}，共 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
