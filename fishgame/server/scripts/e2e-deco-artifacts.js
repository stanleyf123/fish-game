#!/usr/bin/env node
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('playwright-core')); }
const { createApp } = require('../src/app');
const { sampleSave } = require('../test/helpers');

const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const W = 375, H = 700;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const gameRoot = path.join(__dirname, '../..');
  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-shots-'));
  fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(serveDir, 'index.html'));
  for (const sub of ['public', 'species']) {
    const src = path.join(gameRoot, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(serveDir, sub), { recursive: true });
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-shots-db-'));
  const PW = 'shot-admin';
  const env = { ADMIN_PASSWORD: PW, SESSION_SECRET: 'shot-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: serveDir, RATE_LIMIT_GUEST_PER_HOUR: '1000' };
  const { app, ctx, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctxPage = await browser.newContext({ viewport: { width: W, height: H }, locale: 'zh-TW' });
  const page = await ctxPage.newPage();

  const lr = await fetch(BASE + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
  const { csrf } = await lr.json();
  const cookie = lr.headers.get('set-cookie').split(';')[0];

  try {
    const boot = async (qs) => {
      await page.goto(BASE + '/?' + qs, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__aquarium && window.ShopV2, null, { timeout: 35000 });
      const m = page.locator('#modal');
      if (await m.isVisible().catch(() => false)) await page.click('#modalBox .mb button').catch(() => {});
    };

    await boot('shopv2=1');
    await page.evaluate(async () => { await window.DecoInventoryUI.open(); });
    await page.waitForSelector('[data-di-multi]', { timeout: 20000 });
    await page.click('[data-di-multi]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-multi-select-375.png'), fullPage: true });

    const cfgRow = ctx.db.prepare('SELECT json FROM config_versions ORDER BY version DESC LIMIT 1').get();
    const cfg = JSON.parse(cfgRow.json);
    const dec = Object.keys(cfg.decorations || {}).filter((k) => !(cfg.decorations[k].priceGems > 0)).slice(0, 2);
    const hostId = Number(
      ctx.db
        .prepare('INSERT INTO players (device_hash, username, nickname, created_at, last_seen, is_demo) VALUES (?,?,?,?,?,0)')
        .run('shot-host-' + Date.now(), 'shot_host_' + Date.now() + '@example.com', '展示魚友', Date.now(), Date.now()).lastInsertRowid
    );
    const hostSave = sampleSave({
      fish: sampleSave().fish,
      up: { cap: 0, food: 0, feeder: 0, filter: 0, deco: dec, decoPos: { [dec[0]]: 0.35, [dec[1]]: 0.65 }, decoZ: dec },
    });
    ctx.players.writeSaveRow(hostId, hostSave, 1, Date.now(), false);

    await page.goto(BASE + '/?viewTank=' + hostId + '&shared=1&shopv2=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.FTV && (window.FTV.ready || window.FTV.error), null, { timeout: 45000 });
    const ftErr = await page.evaluate(() => window.FTV?.error);
    if (ftErr) throw new Error('friend tank: ' + ftErr);
    await page.waitForFunction(() => window.FTV && window.FTV.ready, null, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'screenshot-friend-tank-375.png'), fullPage: true });

    await boot('shopv2=1');
    await page.evaluate(() => {
      const dec = window.__aquarium.config.decorations || {};
      window.__aquarium.state.up.deco = Object.keys(dec).filter((k) => !(dec[k].priceGems > 0)).slice(0, 16);
      window.__aquarium.state.up.decoPos = {};
      window.__aquarium.render();
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-16-scale-after-375.png') });

    await boot('shopv2=1');
    await page.evaluate(() => window.ShopV2.open('hardscape'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'screenshot-shop-hardscape-375.png'), fullPage: true });

    await page.evaluate(() => window.ShopV2.open('aq'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'screenshot-shop-aq-plants-375.png'), fullPage: true });

    fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(OUT, 'index.html'));
    console.log('Artifacts written to', OUT);
  } finally {
    await browser.close();
    server.close();
    close();
    fs.rmSync(serveDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
