#!/usr/bin/env node
// 刪除指定玩家（測試帳號清理）：DATA_DIR=/var/lib/fishgame node scripts/delete-players.js 17,18
// 只刪除列出的 id；有訂單／寶石的帳號需加 --force
'use strict';
require('./load-env');
const path = require('path');
const { openDb } = require('../src/db');
const ids = String(process.argv[2] || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!ids.length) { console.error('用法：delete-players.js <id,id,...> [--force]'); process.exit(1); }
const force = process.argv.includes('--force');
const db = openDb(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const out = db.transaction(() => ids.map((id) => {
  const p = db.prepare('SELECT id, email, gems FROM players WHERE id=?').get(id);
  if (!p) return `#${id} 不存在`;
  const orders = tables.includes('orders') ? db.prepare('SELECT COUNT(*) n FROM orders WHERE player_id=?').get(id).n : 0;
  if ((orders || p.gems) && !force) return `#${id} 有訂單/寶石，略過（加 --force）`;
  for (const t of tables) { const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); if (t !== 'players' && cols.includes('player_id')) db.prepare(`DELETE FROM ${t} WHERE player_id=?`).run(id); }
  db.prepare('DELETE FROM players WHERE id=?').run(id);
  return `#${id} 已刪除${p.email ? '（' + p.email + '）' : ''}`;
}))();
console.log(out.join('\n'));
db.close();
