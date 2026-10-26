#!/usr/bin/env node
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const { createApp } = require('../src/app');

const ART = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); return cond; };

function setupServe(gameRoot) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-art-'));
  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-serve-'));
  fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(serveDir, 'index.html'));
  for (const sub of ['public', 'species']) {
    const src = path.join(gameRoot, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(serveDir, sub), { recursive: true });
  }
  const env = { ADMIN_PASSWORD: 'e2e-admin', SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: serveDir };
  return { dataDir, serveDir, env };
}

async function shot(page, file) {
  fs.mkdirSync(ART, { recursive: true });
  await page.screenshot({ path: path.join(ART, file), fullPage: false });
}

(async () => {
  const gameRoot = path.join(__dirname, '..');
  const { dataDir, serveDir, env } = setupServe(gameRoot);
  const { app, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  let pass = true;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  async function tankMetrics(page) {
    return page.evaluate(() => {
      const tank = document.getElementById('tank');
      const bg = document.getElementById('tankBg');
      const wrap = document.getElementById('tankWrap');
      const tr = tank.getBoundingClientRect();
      const br = bg.getBoundingClientRect();
      const pb = parseFloat(getComputedStyle(wrap).paddingBottom) || 0;
      return { tankH: tr.height, bgH: br.height, padBottom: pb, aligned: Math.abs(tr.height - br.height) < 2 };
    });
  }

  for (const vp of [{ w: 390, h: 844, tag: '390x844' }, { w: 375, h: 812, tag: '375x812' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true, locale: 'zh-TW' });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + '/?api=off', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__aquarium && window.__aquarium.render, null, { timeout: 30000 });
      await page.evaluate(() => { const m = document.getElementById('modal'); if (m) m.style.display = 'none'; });
      const baseline = await page.evaluate(() => {
        const a = window.__aquarium;
        a.state.up.deco = ['wreck', 'coral'];
        a.state.up.decoPos = { wreck: 0.5, coral: 0.72 };
        delete a.state.up.decoS;
        if (!a.state.legacyDeco) a.state.legacyDeco = ['wreck'];
        a.render();
        return { wreckX: a.state.up.decoPos.wreck, deco: a.state.up.deco.slice() };
      });
      let metrics = await tankMetrics(page);
      if (!ok(`${vp.tag} 一般模式：#tank 高度 == #tankBg`, metrics.aligned, JSON.stringify(metrics))) pass = false;
      await shot(page, `normal-mode-${vp.tag}.png`);
      const afterNorm = await page.evaluate(() => {
        const cv = document.getElementById('tank');
        return { wreckX: window.__aquarium.state.up.decoPos.wreck, w: cv.width, h: cv.height };
      });
      if (!ok(`${vp.tag} 一般模式：無 decoS 時位置不變`, afterNorm.wreckX === baseline.wreckX, JSON.stringify(afterNorm))) pass = false;

      await page.evaluate(() => { window.__aquarium.setTab('aq'); window.__aquarium.aqClick('edit', {}); });
      await page.waitForTimeout(400);
      metrics = await tankMetrics(page);
      if (!ok(`${vp.tag} 編輯模式：#tank 高度 == #tankBg`, metrics.aligned, JSON.stringify(metrics))) pass = false;
      if (!ok(`${vp.tag}：#tankWrap 無 padding-bottom 縮缸`, metrics.padBottom < 4, `pad=${metrics.padBottom}`)) pass = false;

      await page.evaluate(() => {
        const a = window.__aquarium;
        a.state.up.decoS = { wreck: 1.6 };
        a.selectDeco('wreck');
        a.render();
      });
      await page.waitForTimeout(350);
      const scaleUi = await page.evaluate(() => ({
        bar: document.getElementById('aqScaleBar')?.checkVisibility?.() ?? getComputedStyle(document.getElementById('aqScaleBar')).display !== 'none',
        zoomIn: !document.getElementById('aqZoomIn')?.hidden,
        pct: document.querySelector('[data-aq-scale-pct]')?.textContent,
      }));
      if (!ok(`${vp.tag}：縮放列與放大按鈕可見`, scaleUi.bar && scaleUi.zoomIn, JSON.stringify(scaleUi))) pass = false;
      await shot(page, `edit-scaled-wreck-${vp.tag}.png`);

      if (vp.tag === '390x844') {
        await page.evaluate(() => {
          window.__aquarium.state.up.decoS = { wreck: 1 };
          window.__aquarium.selectDeco('wreck');
          window.__aquarium.render();
        });
        await shot(page, 'pinch-zoom-before.png');
        await page.evaluate(() => {
          window.__aquarium.state.up.decoS = { wreck: 1.5 };
          window.__aquarium.selectDeco('wreck');
          window.__aquarium.render();
        });
        await shot(page, 'pinch-zoom-after.png');

        await page.evaluate(() => {
          const a = window.__aquarium;
          a.state.up.decoPos.wreck = 0.5;
          a.state.up.decoS = { wreck: 1.2 };
          a.selectDeco('wreck');
          a.render();
        });
        const pierce = await page.evaluate(() => {
          const bar = document.getElementById('aqBar');
          const cv = document.getElementById('tank');
          const br = bar.getBoundingClientRect();
          const pe = getComputedStyle(bar).pointerEvents;
          for (let y = br.top + 2; y < br.bottom - 2; y += 3) {
            for (let x = br.left + 2; x < br.right - 2; x += 5) {
              if (document.elementFromPoint(x, y) === cv) return { pe, x, y, ok: true };
            }
          }
          return { pe, ok: false };
        });
        if (!ok('390x844：工具列 pointer-events 穿透', pierce.pe === 'none' && pierce.ok, JSON.stringify(pierce))) pass = false;
        if (pierce.ok) await page.mouse.click(pierce.x, pierce.y);
        await page.waitForTimeout(200);
        await shot(page, 'grab-under-edit-bar.png');
      }
      await shot(page, `edit-mode-${vp.tag}.png`);
    } catch (e) {
      ok(vp.tag, false, e.message);
      pass = false;
    } finally {
      await ctx.close();
    }
  }

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  await ctx2.route('**/api/fish-storage', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const fish = Array.from({ length: 80 }, (_, i) => ({ id: 'fs-e2e-' + i, sp: 'guppy', name: '測試魚 ' + i, hue: 0, health: 100, full: 100, finDmg: 0 }));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ storedFish: fish, storageCapacity: 200, storageMax: 2000, storageExpansion: null }) });
  });
  const page2 = await ctx2.newPage();
  try {
    await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => window.FishStorageUI && window.__aquarium?.cloud?.state?.online, null, { timeout: 35000 });
    await page2.evaluate(() => { const m = document.getElementById('modal'); if (m && getComputedStyle(m).display === 'flex') m.style.display = 'none'; });
    await page2.evaluate(() => window.FishStorageUI.open());
    await page2.waitForTimeout(300);
    const body = page2.locator('#modalBox > .mbody');
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page2.waitForTimeout(500);
    const scrollState = await page2.evaluate(() => {
      const count = document.querySelector('[data-fs-count]')?.textContent || '';
      const foot = document.querySelector('[data-fs-load-more]');
      const rows = document.querySelectorAll('[data-fs-results] .my-fish-row').length;
      return { count, rows, footHidden: foot?.hidden, footText: foot?.textContent };
    });
    if (!ok('倉庫 infinite scroll 顯示 >24 筆', scrollState.rows > 24, JSON.stringify(scrollState))) pass = false;
    await shot(page2, 'warehouse-infinite-scroll.png');
  } catch (e) {
    ok('warehouse', false, e.message);
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
