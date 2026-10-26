'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const FishSDK = require('../public/fishsdk.js');

const ADMIN_PASSWORD = 'test-admin-password-123';

async function startServer(envExtra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-test-'));
  const env = { ADMIN_PASSWORD, SESSION_SECRET: 'test-session-secret-0123456789abcdef', NODE_ENV: 'test', RATE_LIMIT_GUEST_PER_HOUR: '1000', RATE_LIMIT_PLAYER_PER_MIN: '10000', PAYMENT_MOCK_ENABLED: '1', ...envExtra };
  const { app, ctx, close } = createApp({ dataDir, env });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, ctx, dataDir,
    async stop() { await new Promise((r) => server.close(r)); close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
    sdk() { const storage = FishSDK.memoryStorage(); const s = FishSDK.create({ baseUrl: base, storage }); s.token = () => storage.getItem('fishsdk.token'); return s; },
    async req(method, p, body, headers = {}) {
      const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data, headers: r.headers };
    },
  };
}

// 登入後台並回傳帶 cookie + CSRF 的請求函式
async function adminClient(srv, password = ADMIN_PASSWORD) {
  const r = await fetch(srv.base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const data = await r.json();
  if (r.status !== 200) throw Object.assign(new Error('login failed'), { status: r.status, data });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body, { csrf = true, origin } = {}) => {
    const headers = { Cookie: cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = data.csrf;
    if (origin) headers.Origin = origin;
    const res = await fetch(srv.base + '/admin/api' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { cookie, csrf: data.csrf, rawSetCookie: r.headers.get('set-cookie'), get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b || {}, o), put: (p, b, o) => call('PUT', p, b || {}, o), del: (p, o) => call('DELETE', p, undefined, o) };
}

// 讓測試不用等存檔間隔
async function relaxAntiCheat(admin, patch = {}) {
  const cur = (await admin.get('/config')).data;
  const cfg = cur.config;
  Object.assign(cfg.antiCheat, { minSaveIntervalSec: 0 }, patch);
  const r = await admin.put('/config', { config: cfg, note: 'test: relax anticheat', baseVersion: cur.version });
  if (r.status !== 200) throw new Error('relax failed ' + JSON.stringify(r.data));
  return r.data.version;
}

function sampleSave(over = {}) {
  return { v: 1, coins: 60, fish: [
    { id: 'fa1', sp: 'goldfish', name: '小花', hue: 28, size: 1, growth: 65, full: 75, health: 100, cd: 0, coinT: 10, seed: 1, px: .3, py: .5, dir: 1 },
    { id: 'fa2', sp: 'goldfish', name: '阿福', hue: 30, size: 1, growth: 65, full: 75, health: 100, cd: 0, coinT: 10, seed: 2, px: .5, py: .4, dir: -1 },
    { id: 'fa3', sp: 'clown', name: '泡泡', hue: 24, size: 1, growth: 0, full: 75, health: 100, cd: 0, coinT: 10, seed: 3, px: .7, py: .6, dir: 1 },
  ], up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: [] }, found: { goldfish: 1, clown: 1 },
  water: { dirt: 5, waste: 0, algae: 0, cycle: 60, changeCdH: 0, lastChange: Date.now(), lastFed: Date.now(), feederAccH: 0 }, items: { bacteria: 1 }, leftover: 0, last: Date.now(), tut: 1, tapHint: 1, ...over };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { startServer, adminClient, relaxAntiCheat, sampleSave, sleep, ADMIN_PASSWORD };
