#!/usr/bin/env node
// 清除所有示範資料（is_demo=1 的玩家及其存檔/紀錄/訂單，以及標題以「【示範】」開頭的公告與獎勵）
'use strict';
require('./load-env');
const path = require('path');
const { openDb } = require('../src/db');
const db = openDb(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const tx = db.transaction(() => {
  const ids = db.prepare('SELECT id FROM players WHERE is_demo=1').all().map((r) => r.id);
  for (const id of ids) { db.prepare('DELETE FROM orders WHERE player_id=?').run(id); db.prepare('DELETE FROM players WHERE id=?').run(id); }
  const a = db.prepare("DELETE FROM announcements WHERE title LIKE '【示範】%'").run().changes;
  const r = db.prepare("DELETE FROM rewards WHERE title LIKE '【示範】%' OR order_id LIKE 'FGDEMO%'").run().changes;
  return { players: ids.length, a, r };
});
const out = tx();
// economy_daily 是彙總表，示範資料無法逐筆扣除 → 若已無真實玩家則整張清空
if (!db.prepare('SELECT COUNT(*) n FROM players').get().n) db.prepare('DELETE FROM economy_daily').run();
console.log(`已刪除示範玩家 ${out.players} 位、示範公告 ${out.a} 則、示範獎勵 ${out.r} 筆。`);
db.close();
