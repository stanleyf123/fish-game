'use strict';
// 英雄魚測試共用：啟動「已掛載英雄魚模組」的伺服器（不修改既有 app.js：把英雄魚路由插到 404 handler 之前）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { mountHero } = require('../src/hero/mount');
const FishSDK = require('../public/fishsdk.js');
const { ADMIN_PASSWORD, sampleSave } = require('./helpers');

function mountBefore404(app, ctx) {
  const stack = app._router.stack;
  const n0 = stack.length;
  const hero = mountHero(app, ctx);
  const added = stack.splice(n0);
  // createApp 的最後兩層是 404 handler 與 error handler（4 個參數）
  if (stack[n0 - 1].handle.length !== 4) throw new Error('預期最後一層是 error handler');
  stack.splice(n0 - 2, 0, ...added);
  return hero;
}

async function startHeroServer(envExtra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-hero-'));
  const env = { ADMIN_PASSWORD, SESSION_SECRET: 'test-session-secret-0123456789abcdef', NODE_ENV: 'test', RATE_LIMIT_GUEST_PER_HOUR: '1000', RATE_LIMIT_PLAYER_PER_MIN: '10000', PAYMENT_MOCK_ENABLED: '1', HERO_WARMUP: '0', HERO_RATE_MULT: '100', ...envExtra };
  const { app, ctx, close } = createApp({ dataDir, env });
  const hero = mountBefore404(app, ctx);
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const srv = {
    base, ctx, hero, dataDir,
    async stop() { await new Promise((r) => server.close(r)); close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
    sdk() { const storage = FishSDK.memoryStorage(); const s = FishSDK.create({ baseUrl: base, storage }); s.token = () => storage.getItem('fishsdk.token'); return s; },
    async req(method, p, body, token, headers = {}) {
      const h = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers };
      const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data, headers: r.headers };
    },
    // 建立玩家（可選會員）並寫入含指定魚的雲端存檔
    async player({ member = true, email, coins = 5000, fish } = {}) {
      const s = srv.sdk(); const g = await s.ensureSession();
      const save = sampleSave({ coins });
      if (fish) save.fish = fish;
      await s.writeSave(save);
      if (member) await s.register(email || `p${g.id}_${Date.now()}@test.tw`, 'fishyfish1', 'Player' + g.id);
      const tok = s.token();
      return { sdk: s, id: g.id, token: tok, call: (m, p, b) => srv.req(m, p, b, tok) };
    },
    setCoins(pid, coins) { const row = ctx.db.prepare('SELECT * FROM saves WHERE player_id=?').get(pid); const sv = JSON.parse(row.data); sv.coins = coins; ctx.players.writeSaveRow(pid, sv, row.rev + 1, Date.now(), false); },
    coins(pid) { return JSON.parse(ctx.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid).data).coins; },
  };
  return srv;
}

const fishOf = (id, sp, growth = 200, name = '勇者') => ({ id, sp, name, hue: 30, size: 1, growth, full: 80, health: 100, cd: 0, coinT: 10, seed: 5, px: .5, py: .5, dir: 1 });

module.exports = { startHeroServer, mountBefore404, fishOf };
