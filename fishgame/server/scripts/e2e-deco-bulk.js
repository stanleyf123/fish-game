#!/usr/bin/env node
'use strict';
/** Real-path e2e: DecoInventoryUI bulk store + bulk sell against local server API. */
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const { createApp } = require('../src/app');
const { sampleSave } = require('../test/helpers');

const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); return cond; };

(async () => {
  const gameRoot = path.join(__dirname, '../..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-deco-bulk-'));
  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-deco-bulk-serve-'));
  fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(serveDir, 'index.html'));
  for (const sub of ['public', 'species']) {
    const src = path.join(gameRoot, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(serveDir, sub), { recursive: true });
  }

  const PW = 'e2e-deco-bulk-admin';
  const env = {
    ADMIN_PASSWORD: PW,
    SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789',
    NODE_ENV: 'development',
    SERVE_GAME_DIR: serveDir,
    RATE_LIMIT_GUEST_PER_HOUR: '1000',
    RATE_LIMIT_PLAYER_PER_MIN: '10000',
  };
  const { app, ctx, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;

  const lr = await fetch(BASE + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
  const { csrf } = await lr.json();
  const cookie = lr.headers.get('set-cookie').split(';')[0];
  const adm = async (m, p, b) => {
    const r = await fetch(BASE + '/admin/api' + p, {
      method: m,
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', origin: BASE },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const cur = (await adm('GET', '/config')).data;
  const ac = cur.config.antiCheat || {};
  Object.assign(ac, { minSaveIntervalSec: 0 });
  await adm('PUT', '/config', { config: { ...cur.config, antiCheat: ac }, note: 'e2e bulk', baseVersion: cur.version });

  let pass = true;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 375, height: 700 }, locale: 'zh-TW' });

  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aquarium && window.DecoInventoryUI && window.__aquarium.cloud?.state?.online, null, { timeout: 35000 });
    await page.evaluate(() => { const m = document.getElementById('modal'); if (m) m.style.display = 'none'; });

    const pid = await page.evaluate(() => window.__aquarium.cloud.state.player.id);
    const decoKeys = ['coral', 'wreck'].filter((k) => cur.config.decorations[k]);
    const save = sampleSave({ coins: 5000, up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: decoKeys } });
    const row = ctx.db.prepare('SELECT rev FROM saves WHERE player_id=?').get(pid);
    ctx.players.writeSaveRow(pid, save, (row?.rev || 0) + 1, Date.now(), false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DecoInventoryUI && window.__aquarium.cloud?.state?.online, null, { timeout: 35000 });
    await page.evaluate(() => { const m = document.getElementById('modal'); if (m) m.style.display = 'none'; });

    const before = await page.evaluate(() => ({
      coins: Math.floor(window.__aquarium.state.coins),
      deco: (window.__aquarium.state.up.deco || []).slice(),
    }));
    if (!ok('初始魚缸有 2 件造景', before.deco.length >= 2, JSON.stringify(before.deco))) pass = false;

    await page.evaluate(async () => { await window.DecoInventoryUI.open(); });
    await page.waitForSelector('[data-di-multi]', { timeout: 20000 });
    await page.click('[data-di-multi]');
    await page.click('[data-di-all]');
    await page.click('[data-di-bulk-store]');
    await page.getByRole('button', { name: '確定' }).click();
    await page.waitForTimeout(1500);

    const afterStore = await page.evaluate(async () => {
      await window.DecoInventoryUI.refresh();
      const s = window.__aquarium.state;
      return { tank: (s.up.deco || []).length, stored: window.DecoInventoryUI.current().length };
    });
    if (!ok('批次收起：魚缸清空、收納庫有貨', afterStore.tank === 0 && afterStore.stored >= 2, JSON.stringify(afterStore))) pass = false;

    await page.evaluate(async () => { await window.DecoInventoryUI.open(); });
    if (!(await page.locator('[data-di-pane="stored"][aria-pressed="true"]').count())) await page.click('[data-di-pane="stored"]');
    await page.waitForSelector('[data-di-multi]', { timeout: 15000 });
    if (!(await page.locator('[data-di-all]').count())) await page.click('[data-di-multi]');
    await page.waitForSelector('[data-di-pick]', { timeout: 10000 });
    const storedIds = await page.evaluate(async () => {
      await window.DecoInventoryUI.refresh();
      return window.DecoInventoryUI.current().map((b) => b.id);
    });
    for (const id of storedIds) await page.locator(`[data-di-pick="${id}"]`).check();
    const coinsBeforeSell = await page.evaluate(() => Math.floor(window.__aquarium.state.coins));
    await page.click('[data-di-bulk-sell]');
    await page.getByRole('button', { name: '確定' }).click();
    await page.waitForTimeout(2000);

    const afterSell = await page.evaluate(async () => {
      await window.DecoInventoryUI.refresh();
      return {
        coins: Math.floor(window.__aquarium.state.coins),
        stored: window.DecoInventoryUI.current().length,
        tank: (window.__aquarium.state.up.deco || []).length,
      };
    });
    if (!ok('批次出售：收納庫清空且金幣增加', afterSell.stored === 0 && afterSell.coins > coinsBeforeSell, JSON.stringify({ coinsBeforeSell, afterSell }))) pass = false;

    process.exitCode = pass ? 0 : 1;
  } finally {
    await browser.close();
    server.close();
    close();
    fs.rmSync(serveDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
