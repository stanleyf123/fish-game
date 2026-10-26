'use strict';
// 會員帳號＝信箱：註冊／登入／後台重設密碼／舊帳號相容
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');
const { normEmail, maskEmail, EMAIL_RE } = require('../src/players');

test('信箱工具函式', () => {
  assert.equal(normEmail('  AbC@Gmail.COM '), 'abc@gmail.com');
  assert.equal(maskEmail('abcdef@gmail.com'), 'ab***@gmail.com');
  assert.equal(maskEmail('a@x.io'), 'a*@x.io');
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com.tw']) assert.ok(EMAIL_RE.test(ok), ok);
  for (const no of ['', 'abc', 'a@b', 'a b@c.com', '@x.com', 'a@.c']) assert.ok(!EMAIL_RE.test(no), no);
});

test('信箱帳號：訪客綁定保留魚缸、重複信箱、後台搜尋與重設密碼', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);

  const a = srv.sdk(); const g = await a.ensureSession();
  await a.writeSave(sampleSave({ coins: 777 }));
  const me = await a.register(' Mixed.Case@Gmail.com', 'fishyfish1');
  assert.equal(me.id, g.id); assert.equal(me.email, 'mixed.case@gmail.com'); assert.equal(me.emailMasked, 'mi***@gmail.com');
  assert.equal(me.emailVerified, false, 'TODO：尚未有寄信服務，信箱一律未驗證');
  assert.equal((await a.loadSave()).save.coins, 777, '綁定後魚缸保留');
  assert.equal((await a.me()).player.email, 'mixed.case@gmail.com');

  // 另一個訪客用同信箱（大小寫不同）註冊 → 409 此信箱已註冊
  const b = srv.sdk(); await b.ensureSession();
  await assert.rejects(b.register('MIXED.case@gmail.com', 'anotherpw1'), (e) => e.status === 409 && e.data.message === '此信箱已註冊');
  // DB 層也有不分大小寫的唯一索引
  const idx = srv.ctx.db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_players_email'").get();
  assert.match(idx.sql, /COLLATE NOCASE/);

  // 後台：以信箱搜尋
  const found = await admin.get('/players?q=' + encodeURIComponent('Mixed.Case@'));
  assert.deepEqual(found.data.players.map((p) => p.id), [me.id]);

  // 後台重設密碼：舊密碼失效、所有裝置登出、新密碼可登入
  assert.equal((await admin.post(`/players/${me.id}/password`, { password: 'short' })).status, 400);
  assert.equal((await admin.post(`/players/${g.id}/password`, { password: 'newpassword1' })).status, 200);
  assert.equal((await srv.req('GET', '/api/me', undefined, { Authorization: 'Bearer ' + a.token() })).status, 401, '重設密碼後舊 token 失效');
  const c = srv.sdk();
  await assert.rejects(c.login('mixed.case@gmail.com', 'fishyfish1'), (e) => e.status === 401);
  assert.equal((await c.login('Mixed.Case@GMAIL.com', 'newpassword1')).id, me.id);
  const logs = await admin.get('/audit?limit=20');
  if (logs.status === 200) { const s = JSON.stringify(logs.data); assert.ok(s.includes('player.password_reset')); assert.ok(!s.includes('newpassword1'), '操作紀錄不可含密碼'); }

  // 訪客沒有密碼可重設
  const gst = srv.sdk(); const gp = await gst.ensureSession();
  assert.equal((await admin.post(`/players/${gp.id}/password`, { password: 'whatever12' })).status, 400);

  // 忘記密碼：尚未開放（沒有寄信服務）
  const pr = await srv.req('POST', '/api/auth/password-reset', { email: 'mixed.case@gmail.com' });
  assert.equal(pr.status, 501); assert.equal(pr.data.error, 'not_available');
});

test('舊版「帳號名稱」會員仍可登入（相容）', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const now = Date.now();
  srv.ctx.db.prepare('INSERT INTO players (username, pass_hash, nickname, created_at, last_seen, bound_at) VALUES (?,?,?,?,?,?)').run('old_member', bcrypt.hashSync('legacypass1', 4), '老玩家', now, now, now);
  const s = srv.sdk();
  const p = await s.login('old_member', 'legacypass1');
  assert.equal(p.username, 'old_member'); assert.equal(p.bound, true); assert.equal(p.email, null);
  // 舊客戶端仍送 username 欄位
  const r = await srv.req('POST', '/api/auth/login', { username: 'old_member', password: 'legacypass1' });
  assert.equal(r.status, 200);
});
