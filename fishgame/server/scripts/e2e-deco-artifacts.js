#!/usr/bin/env node
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('playwright-core')); }
const { createApp } = require('../src/app');

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
  const env = { ADMIN_PASSWORD: 'shot-admin', SESSION_SECRET: 'shot-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: serveDir };
  const { app, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  try {
    const boot = async (qs) => {
      await page.goto(BASE + '/?' + qs, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__aquarium && window.ShopV2, null, { timeout: 35000 });
    };
    await boot('api=off&shopv2=1');

    await page.evaluate(() => {
      const rows = ['coral', 'wreck', 'chest', 'crystal'].filter(k => window.__aquarium.config.decorations[k]).map((k, i) => {
        const d = window.__aquarium.config.decorations[k];
        const picked = i < 2;
        return `<section class="my-fish-row${picked ? ' di-picked' : ''}"><label class="di-check"><input type="checkbox" ${picked ? 'checked' : ''}></label><div><b>${d.name}</b><small>魚缸中</small></div><div class="my-fish-actions"><button type="button" class="di-sell">出售</button></div></section>`;
      }).join('');
      const modal = document.getElementById('modal');
      const box = document.getElementById('modalBox');
      modal.style.display = 'flex';
      modal.classList.add('show');
      box.innerHTML = `<div class="mbody"><h2>🪸 我的造景</h2><section class="fs-multi-tools"><div class="fs-multi-heading"><b>已選 2 組</b><button type="button">取消多選</button></div><div class="fs-bulk-buttons"><button type="button">全選</button><button type="button">清除</button><button type="button" class="fs-primary">收起所選</button><button type="button" class="di-sell">出售所選</button></div></section><div class="my-fish-list di-list">${rows}</div></div><div class="mb"><button type="button">關閉</button></div>`;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-multi-select-375.png'), fullPage: true });

    await page.evaluate(() => {
      const box = document.getElementById('modalBox');
      box.innerHTML = `<div class="mbody"><h2>批次出售造景</h2><p>共 2 組：</p><ul><li><b>珊瑚叢、沉船</b>（各 1 件）</li></ul><p>合計可得 <b>🪙240</b>；不退鑽石。</p></div><div class="mb"><button type="button" class="sec2">取消</button><button type="button" class="buy">確認出售</button></div>`;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-bulk-sell-confirm-375.png'), fullPage: true });
    await page.evaluate(() => { document.querySelector('#modal').style.display = 'none'; });

    await page.evaluate(() => {
      const dec = window.__aquarium.config.decorations || {};
      window.__aquarium.state.up.deco = Object.keys(dec).filter(k => !(dec[k].priceGems > 0)).slice(0, 16);
      window.__aquarium.state.up.decoPos = {};
      window.__aquarium.render();
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-16-scale-after-375.png') });

    await boot('api=off&shopv2=1&decoScaleDemo=legacy');
    await page.evaluate(() => {
      const dec = window.__aquarium.config.decorations || {};
      window.__aquarium.state.up.deco = Object.keys(dec).filter(k => !(dec[k].priceGems > 0)).slice(0, 16);
      window.__aquarium.state.up.decoPos = {};
      window.__aquarium.render();
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'screenshot-deco-16-scale-before-375.png') });

    await boot('api=off&shopv2=1');
    await page.evaluate(() => window.ShopV2.open('hardscape'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'screenshot-shop-hardscape-375.png'), fullPage: true });

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
