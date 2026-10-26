#!/usr/bin/env node
// 造景編輯：375px 觸控拖曳水草時，插入點在手指下方（PLANT-TOP-DRAG-V1）
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const { createApp } = require('../src/app');

const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); return cond; };

(async () => {
  const serverRoot = path.join(__dirname, '..');
  const gameRoot = path.join(serverRoot, '..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-decor-touch-'));
  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-decor-serve-'));
  fs.copyFileSync(path.join(gameRoot, 'client-index.html'), path.join(serveDir, 'index.html'));
  for (const sub of ['public', 'species']) {
    const src = path.join(gameRoot, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(serveDir, sub), { recursive: true });
  }

  const env = { ADMIN_PASSWORD: 'e2e-admin', SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: serveDir };
  const { app, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  let pass = true;

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true, locale: 'zh-TW' });
  const page = await ctx.newPage();

  try {
    await page.goto(BASE + '/?api=off', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aquarium && window.__aquarium.AQ, null, { timeout: 25000 });
    await page.evaluate(() => { const m = document.getElementById('modal'); if (m) m.style.display = 'none'; });

    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const a = window.__aquarium;
      const sp = 'hairgrass';
      const p = { id: 'e2e-plant-1', sp, src: 'c', x: 0.5, d: 0.08, g: 85, hp: 100, seed: 4242 };
      a.state.plants = [p];
      a.state.up.deco = [];
      a.state.pfound = a.state.pfound || {}; a.state.pfound[sp] = 1;
      a.render();
    });
    const editOn = await page.evaluate(() => { window.__aquarium.setTab('aq'); window.__aquarium.aqClick('edit', {}); return window.__aquarium.aqT.edit; });
    if (!ok('375px：進入造景編輯', editOn)) pass = false;
    await page.waitForTimeout(200);
    const finger = await page.evaluate(() => {
      const a = window.__aquarium;
      const p = a.state.plants[0];
      const grab = a.aqT.plantGrab(p);
      return grab ? { ...grab, hit: a.aqT.hit(grab.x, grab.y)?.id === p.id } : null;
    });
    if (!ok('375px：找到水草拖曳起點', !!finger && finger.hit, JSON.stringify(finger))) pass = false;

    const liftInfo = await page.evaluate(({ x, y }) => {
      const a = window.__aquarium;
      const p = a.state.plants[0];
      const { lift, ghost } = a.aqT.fingerInsert(x, y, p);
      const gy = ghost.y != null ? ghost.y : y + lift;
      return { lift, liftOk: lift >= 40, below: gy > y + 20, ghostOk: ghost.ok };
    }, finger);
    if (!ok('375px：插入點在手指下方且 lift≥40', liftInfo.liftOk && liftInfo.below, JSON.stringify(liftInfo))) pass = false;

    const dragPts = { sx: finger.x, sy: finger.y, ex: finger.x + 25, ey: finger.y + 55 };
    const sim = await page.evaluate(({ sx, sy, ex, ey }) => {
      const cv = document.getElementById('tank');
      const r = cv.getBoundingClientRect();
      const W = cv.width;
      const H = cv.height;
      const pe = (type, x, y) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: r.left + (x * r.width) / W,
        clientY: r.top + (y * r.height) / H,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      });
      const hitBefore = window.__aquarium.aqT.hit(sx, sy)?.id;
      cv.dispatchEvent(pe('pointerdown', sx, sy));
      cv.dispatchEvent(pe('pointermove', ex, ey));
      const pl = window.__aquarium.aqT.place;
      return { hitBefore, drag: !!(pl && pl.drag), lift: pl && pl.lift };
    }, dragPts);
    if (!ok('375px：模擬拖曳命中水草', sim.hitBefore === 'e2e-plant-1', JSON.stringify(sim))) pass = false;
    await page.waitForTimeout(100);

    const drag = await page.evaluate(() => {
      const pl = window.__aquarium.aqT.place;
      return { active: !!(pl && pl.drag), lift: pl && pl.lift, liftOk: (pl && pl.lift) >= 40 };
    });
    if (!ok('375px：觸控拖曳進入 drag 模式', drag.active, JSON.stringify(drag))) pass = false;

    const before = await page.evaluate(() => ({ x: window.__aquarium.state.plants[0].x, d: window.__aquarium.state.plants[0].d }));
    await page.evaluate(({ ex, ey }) => {
      const cv = document.getElementById('tank');
      const r = cv.getBoundingClientRect();
      const W = cv.width;
      const H = cv.height;
      cv.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: r.left + (ex * r.width) / W,
        clientY: r.top + (ey * r.height) / H,
        button: 0,
        buttons: 0,
      }));
    }, dragPts);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({ x: window.__aquarium.state.plants[0].x, d: window.__aquarium.state.plants[0].d, edit: window.__aquarium.aqT.edit }));

    const moved = Math.abs(after.x - before.x) > 0.01 || Math.abs(after.d - before.d) > 0.02;
    if (!ok('375px：放開後以插入點更新位置', moved && after.edit, JSON.stringify({ before, after }))) pass = false;
  } catch (e) {
    ok('執行', false, e.stack);
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
