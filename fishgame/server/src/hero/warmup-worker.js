'use strict';
// 背景預先計算公平係數（worker thread）：所有魚種 × 各等級區間 × 預設技能組合。
// 只用「唯讀」連線讀取已存在的結果；新結果傳回主執行緒寫入 hero_fair（單一寫入者，不會和遊戲交易互相鎖住）。
const { workerData, parentPort } = require('worker_threads');
const Database = require('better-sqlite3');
const ab = require('./autobalance');
const S = require('./stats');

const { file, hcfg, gameCfg } = workerData;
const db = new Database(file, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 10000');
let hasTable = true;
try { db.prepare('SELECT 1 FROM hero_fair LIMIT 1').get(); } catch (e) { hasTable = false; }
const get = hasTable ? db.prepare('SELECT m FROM hero_fair WHERE k=?') : null;
let buf = [];
const flush = () => { if (buf.length) { parentPort.postMessage({ put: buf }); buf = []; } };
ab.setStore({ get: (k) => { const r = get && get.get(k); return r ? r.m : null; }, put: (k, m) => { buf.push([k, m]); if (buf.length >= 50) flush(); } });

const levels = ((hcfg.autoBalance || {}).levels || [1, 3, 8, 15, 30]);
const species = Object.keys(gameCfg.species).filter((k) => !gameCfg.species[k].disabled);
const total = levels.length * species.length;
let done = 0;
const t0 = Date.now();
const hero = (sp, level) => ({ species: sp, growth: 999, level, train: {}, gear: {}, skills: {} });
// 先把每個等級區間的參考對手群算好（最貴、且每個請求都會用到），再算各魚種
for (const level of levels) { S.finalStats(hcfg, gameCfg, hero(species[0], level)); flush(); }
for (const level of levels) {
  for (const sp of species) {
    S.finalStats(hcfg, gameCfg, hero(sp, level));
    done++;
    if (done % 50 === 0) { flush(); parentPort.postMessage({ done, total }); }
  }
}
flush();
parentPort.postMessage({ done, total, finished: true, ms: Date.now() - t0 });
db.close();
