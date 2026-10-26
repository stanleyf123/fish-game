'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, ADMIN_PASSWORD } = require('./helpers');

test('後台登入、Session、CSRF、稽核', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  await t.test('未登入：頁面轉到登入頁、API 回 401', async () => {
    const page = await fetch(srv.base + '/admin/', { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/admin/login');
    const login = await fetch(srv.base + '/admin/login');
    assert.equal(login.status, 200);
    assert.match(login.headers.get('content-security-policy'), /default-src 'self'/);
    const api = await srv.req('GET', '/admin/api/dashboard');
    assert.equal(api.status, 401);
  });

  await t.test('密碼錯誤 401；正確則設定 HttpOnly + SameSite=Strict cookie', async () => {
    const bad = await srv.req('POST', '/admin/api/login', { password: 'nope' });
    assert.equal(bad.status, 401);
    const admin = await adminClient(srv);
    assert.match(admin.rawSetCookie, /HttpOnly/);
    assert.match(admin.rawSetCookie, /SameSite=Strict/);
    assert.match(admin.rawSetCookie, /Path=\/admin/);
    const s = await admin.get('/session');
    assert.equal(s.status, 200);
    assert.equal(s.data.csrf, admin.csrf);
    const page = await fetch(srv.base + '/admin/', { headers: { Cookie: admin.cookie }, redirect: 'manual' });
    assert.equal(page.status, 200);
  });

  await t.test('寫入請求缺少 CSRF token 或跨站 Origin 會被拒絕', async () => {
    const admin = await adminClient(srv);
    const noCsrf = await admin.post('/announcements', { title: 'x' }, { csrf: false });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.data.error, 'bad_csrf');
    const evil = await admin.post('/announcements', { title: 'x' }, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.data.error, 'bad_origin');
    const good = await admin.post('/announcements', { title: '正常公告' });
    assert.equal(good.status, 200);
  });

  await t.test('登出後 session 失效', async () => {
    const admin = await adminClient(srv);
    await admin.post('/logout');
    assert.equal((await admin.get('/session')).status, 401);
  });

  await t.test('操作紀錄會記錄登入失敗與寫入動作', async () => {
    const admin = await adminClient(srv);
    const a = await admin.get('/audit');
    const actions = a.data.entries.map((e) => e.action);
    assert.ok(actions.includes('admin.login_failed'));
    assert.ok(actions.includes('admin.login'));
    assert.ok(actions.includes('announcement.create'));
  });
});

test('後台登入限流：同一 IP 連續 5 次失敗後回 429', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  for (let i = 0; i < 5; i++) assert.equal((await srv.req('POST', '/admin/api/login', { password: 'wrong' + i })).status, 401);
  const blocked = await srv.req('POST', '/admin/api/login', { password: ADMIN_PASSWORD });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

test('正式環境拒絕弱密碼設定', () => {
  const { createApp } = require('../src/app');
  assert.throws(() => createApp({ dataDir: ':memory:', env: { NODE_ENV: 'production', ADMIN_PASSWORD: 'short', SESSION_SECRET: 'x'.repeat(40) } }), /至少 8/);
  assert.throws(() => createApp({ dataDir: ':memory:', env: { ADMIN_PASSWORD: '', SESSION_SECRET: '' } }), /必須設定/);
});
