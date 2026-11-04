#!/usr/bin/env node
'use strict';
/**
 * Headless shop screenshots for COINSINK-B1 (390px, CPU throttle).
 * Requires: server on PORT (default 3000). Optional devDep: npx puppeteer (not bundled in package.json).
 */
const fs = require('fs');
const path = require('path');

async function main() {
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch (e) {
    console.error('Install puppeteer: npm i -D puppeteer');
    process.exit(1);
  }
  const port = process.env.PORT || 3000;
  const outDir = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/screenshots';
  fs.mkdirSync(outDir, { recursive: true });
  const url = `http://127.0.0.1:${port}/?api=off`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__aquarium?.state && window.ShopV2, { timeout: 120000 });
  await page.evaluate(async () => {
    try {
      const r = await fetch('/api/config', { cache: 'no-cache' });
      if (r.ok) window.__aquarium.applyConfig(await r.json());
    } catch (e) { console.warn('config', e); }
  });

  const setup = async (cap, xmasActive) => {
    await page.evaluate((capLv, xmasOn) => {
      const S = window.__aquarium.state;
      const CFG = window.__aquarium.config;
      S.coins = 999999999;
      S.up = S.up || { cap: 8, deco: [], food: 0, feeder: 0, filter: 0 };
      S.up.cap = capLv;
      S.cos = S.cos || { own: {}, bg: null };
      if (CFG.coinsinkEvents?.xmas2026 && xmasOn) {
        CFG.coinsinkEvents.xmas2026.availableFrom = '2020-01-01T00:00:00+08:00';
        CFG.coinsinkEvents.xmas2026.availableUntil = '2030-01-01T00:00:00+08:00';
      }
      const bs = CFG.cosmetics?.coinBackgrounds || {};
      for (const b of Object.values(bs)) {
        if (xmasOn && b.eventKey === 'xmas2026') {
          b.availableFrom = '2020-01-01T00:00:00+08:00';
          b.availableUntil = '2030-01-01T00:00:00+08:00';
        }
      }
      if (CFG.decorations) {
        for (const d of Object.values(CFG.decorations)) {
          if (d.shopGroup === 'coinsink_event' && xmasOn) {
            d.availableFrom = '2020-01-01T00:00:00+08:00';
            d.availableUntil = '2030-01-01T00:00:00+08:00';
          }
        }
      }
      window.__aquarium.applyConfig(CFG);
    }, cap, xmasActive);
  };

  await setup(8, false);
  await page.evaluate(() => { ShopV2.open('vip'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-vip-locked-cap8.png'), fullPage: true });

  await setup(12, false);
  await page.evaluate(() => { ShopV2.open('vip'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-vip-unlocked-cap12.png'), fullPage: true });

  await setup(12, false);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-deco-shop-before-xmas.png'), fullPage: true });

  await setup(12, true);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-deco-xmas-badge.png'), fullPage: true });

  await page.evaluate(() => {
    const S = window.__aquarium.state;
    const k = 'cs_b1_garden_lantern';
    if (!S.up.deco.includes(k)) S.up.deco.push(k);
    S.up.decoPos = S.up.decoPos || {};
    S.up.decoPos[k] = 0.5;
    window.__aquarium.render?.();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const loopOk = await page.evaluate(async () => {
    const errs = [];
    const prev = window.onerror;
    window.onerror = (m) => { errs.push(String(m)); };
    for (let i = 0; i < 30; i++) {
      try { window.__aquarium.update?.(1 / 30); window.__aquarium.render?.(); } catch (e) { errs.push(String(e)); }
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.onerror = prev;
    return errs;
  });
  await page.screenshot({ path: path.join(outDir, 'coinsink-tank-coin-deco-placed.png'), fullPage: false });
  if (loopOk.length) errors.push(...loopOk);

  await browser.close();
  const shots = fs.readdirSync(outDir).filter((f) => f.startsWith('coinsink-'));
  const filtered = errors.filter((e) => !/Failed to load resource|404|MIME type/.test(e));
  console.log(JSON.stringify({ errors: filtered, screenshots: shots }, null, 2));
  if (filtered.length) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
