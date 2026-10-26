#!/usr/bin/env node
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const { createApp } = require('../src/app');

const ART = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); return cond; };

(async () => {
  const gameRoot = path.join(__dirname, '..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-ds-'));
  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-ds-serve-'));
  fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(serveDir, 'index.html'));
  for (const sub of ['public', 'species']) {
    const src = path.join(gameRoot, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(serveDir, sub), { recursive: true });
  }
  const artSrc = path.join(gameRoot, 'public', 'art');
  if (fs.existsSync(artSrc)) fs.cpSync(artSrc, path.join(serveDir, 'art'), { recursive: true });
  const env = { ADMIN_PASSWORD: 'e2e-admin', SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: serveDir };
  const { app, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  let pass = true;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/?api=off', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aquarium && window.__ffDeco && window.DECO_SERIES, null, { timeout: 30000 });
    await page.evaluate(async () => {
      await DECO_SERIES.boot();
    });
    await page.waitForFunction(() => window.__ffDeco()?.CFG?.decoSeries?.sunken, null, { timeout: 15000 });
    await page.evaluate(async () => {
      const a = window.__aquarium;
      if (window.DECO_SERIES) await DECO_SERIES.boot();
      const keys = window.__ffDeco().CFG.decoSeries.sunken.keys;
      a.state.coins = 999999;
      a.state.up.deco = keys.slice();
      a.state.up.decoPos = a.state.up.decoPos || {};
      keys.forEach((k, i) => { a.state.up.decoPos[k] = 0.12 + (i % 10) * 0.076; });
      a.render();
    });
    await page.waitForTimeout(800);
    fs.mkdirSync(ART, { recursive: true });
    await page.screenshot({ path: path.join(ART, 'deco-series-sunken-full-tank-390.png'), fullPage: false });
    const complete = await page.evaluate(() => window.decoSeriesProgress && decoSeriesProgress('sunken').complete);
    if (!ok('沉沒古城套裝：魚缸內 10/10', complete)) pass = false;

    await page.evaluate(() => {
      if (window.ShopV2) ShopV2.open('hardscape');
      else {
        document.querySelector('.sbtn[data-side=shop]')?.click();
        document.querySelector('[data-sv2cat="hardscape"]')?.click();
      }
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ART, 'deco-series-shop-390.png'), fullPage: false });
    const headers = await page.evaluate(() => [...document.querySelectorAll('.sv2-sec')].map((el) => el.textContent.trim()).filter((t) => t.includes('沉沒') || t.includes('海盜')));
    if (!ok('造景商店：系列分組標題', headers.length >= 2, headers.join(' | '))) pass = false;
  } catch (e) {
    ok('deco-series e2e', false, e.message);
    pass = false;
  } finally {
    await browser.close();
    server.close();
    close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(serveDir, { recursive: true, force: true });
  }
  process.exit(pass ? 0 : 1);
})();
