#!/usr/bin/env node
// FRIENDSV2-BACKFILL 一次性回填：既有「邀請人 × 被邀請者」→ 自動成為好友（遵守 100 人上限）
// 預設 DRY-RUN（唯讀開啟資料庫，只回報數量）。真的要寫入必須加 --execute（需站長核准）。
// 用法：node scripts/fv2-backfill-invite-friends.js [db路徑] [--execute] [--json]
'use strict';
const path = require('path');

function backfill(db, { execute = false, max = 100, now = Date.now() } = {}) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const linked = has('fv2_invite_links') ? new Set(db.prepare('SELECT invitee_id FROM fv2_invite_links').all().map((r) => r.invitee_id)) : new Set();
  const P = db.prepare('SELECT id, username, banned_at, is_demo FROM players WHERE id=?');
  const rel = db.prepare('SELECT status FROM social_friends WHERE a=? AND b=?');
  const cnt = new Map(); const fc = (id) => { if (!cnt.has(id)) cnt.set(id, db.prepare("SELECT COUNT(*) n FROM social_friends WHERE (a=? OR b=?) AND status='accepted'").get(id, id).n); return cnt.get(id); };
  const counts = { invites: 0, self: 0, already_linked: 0, invitee_not_member: 0, inviter_not_member: 0, banned_or_demo: 0, already_friends: 0, full: 0, [execute ? 'friend' : 'would_friend']: 0, upgraded_pending: 0, same_ip_pairs_included: 0 };
  const rows = db.prepare('SELECT * FROM invites ORDER BY created_at').all(); const todo = [];
  for (const i of rows) {
    counts.invites++;
    if (i.reason === 'self' || i.inviter_id === i.invitee_id) { counts.self++; continue; }
    if (linked.has(i.invitee_id)) { counts.already_linked++; continue; }
    const a = P.get(i.invitee_id), b = P.get(i.inviter_id);
    if (!a || !a.username) { counts.invitee_not_member++; continue; }
    if (!b || !b.username) { counts.inviter_not_member++; continue; }
    if (a.banned_at || b.banned_at || a.is_demo || b.is_demo) { counts.banned_or_demo++; continue; }
    const [x, y] = i.invitee_id < i.inviter_id ? [i.invitee_id, i.inviter_id] : [i.inviter_id, i.invitee_id];
    const r = rel.get(x, y);
    if (r && r.status === 'accepted') { counts.already_friends++; continue; }
    if (fc(x) >= max || fc(y) >= max) { counts.full++; continue; }
    cnt.set(x, fc(x) + 1); cnt.set(y, fc(y) + 1);
    if (r) counts.upgraded_pending++;
    if (i.flag === 'same_ip' || i.reason === 'same_ip') counts.same_ip_pairs_included++;
    counts[execute ? 'friend' : 'would_friend']++; todo.push({ i, x, y, exists: !!r });
  }
  if (execute && todo.length) {
    const up = db.prepare("UPDATE social_friends SET status='accepted', updated_at=? WHERE a=? AND b=?");
    const ins = db.prepare("INSERT INTO social_friends (a, b, status, requester, created_at, updated_at) VALUES (?,?,'accepted',?,?,?)");
    const note = db.prepare("INSERT INTO social_notes (player_id, kind, actor_id, data, coins, created_at) VALUES (?, 'friend_ok', ?, ?, 0, ?)");
    const link = db.prepare("INSERT OR IGNORE INTO fv2_invite_links (invitee_id, inviter_id, state, via, created_at) VALUES (?,?,'friend','backfill',?)");
    db.transaction(() => { for (const { i, x, y, exists } of todo) {
      if (exists) up.run(now, x, y); else ins.run(x, y, i.inviter_id, now, now);
      const d = JSON.stringify({ via: 'invite' }); note.run(i.inviter_id, i.invitee_id, d, now); note.run(i.invitee_id, i.inviter_id, d, now); link.run(i.invitee_id, i.inviter_id, now);
    } })();
  }
  return { execute, counts, pairs: todo.map((t) => ({ invitee: t.i.invitee_id, inviter: t.i.inviter_id })) };
}
module.exports = { backfill };

if (require.main === module) {
  const args = process.argv.slice(2), execute = args.includes('--execute');
  const file = args.find((a) => !a.startsWith('--')) || process.env.DB_PATH || '/var/lib/fishgame/fishgame.sqlite';
  const Database = require('better-sqlite3');
  const db = new Database(path.resolve(file), { readonly: !execute, fileMustExist: true });
  if (execute && !db.prepare("SELECT 1 FROM sqlite_master WHERE name='fv2_invite_links'").get()) { console.error('fv2_invite_links 不存在：請先部署 friendsv2 並重啟服務'); process.exit(2); }
  const out = backfill(db, { execute });
  if (args.includes('--json')) console.log(JSON.stringify(out)); else { console.log(execute ? '已執行回填' : 'DRY-RUN（沒有寫入任何資料）'); console.table(out.counts); }
  db.close();
}
