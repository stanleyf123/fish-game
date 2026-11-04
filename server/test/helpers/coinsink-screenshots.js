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

  await page.evaluate(() => {
    const btn = document.querySelector('[data-g41="coinbg:bg_coin_forest_spring"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('#modal h2', { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'coinsink-dual-bg-currency-modal.png'), fullPage: false });

  await page.evaluate(() => { document.querySelector('#modal button.sec2')?.click(); });
  await new Promise((r) => setTimeout(r, 400));

  await setup(12, false);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-deco-shop-before-xmas.png'), fullPage: true });

  await setup(12, true);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-deco-xmas-badge.png'), fullPage: true });

  await setup(12, false);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const row = document.querySelector('[data-deco="cs_b1_garden_lantern"]');
    if (row) row.click();
  });
  await page.waitForSelector('#modal h2', { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'coinsink-dual-deco-currency-modal.png'), fullPage: false });
  await page.evaluate(() => { document.querySelector('#modal button.sec2')?.click(); });
  await new Promise((r) => setTimeout(r, 400));

  await setup(12, true);
  await page.evaluate(() => { ShopV2.open('hardscape'); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(outDir, 'coinsink-deco-xmas-gems-only.png'), fullPage: true });

  const decoSets = {
    garden: ['cs_b1_garden_lantern', 'cs_b1_garden_moss_rock', 'cs_b1_garden_bamboo', 'cs_b1_garden_lotus', 'cs_b1_garden_bridge', 'cs_b1_garden_bench'],
    ruins: ['cs_b1_ruins_pillar', 'cs_b1_ruins_arch', 'cs_b1_ruins_steps', 'cs_b1_ruins_windmill', 'cs_b1_ruins_gate', 'cs_b1_ruins_obelisk'],
    star: ['cs_b1_star_lighthouse', 'cs_b1_star_shell_hut', 'cs_b1_star_sand_jar', 'cs_b1_star_moon_stone', 'cs_b1_star_wreck', 'cs_b1_star_flag'],
    xmas: ['cs_b1_xmas_snowman', 'cs_b1_xmas_ginger', 'cs_b1_xmas_fir', 'cs_b1_xmas_gifts', 'cs_b1_xmas_sleigh', 'cs_b1_xmas_arch'],
  };

  for (const [setName, keys] of Object.entries(decoSets)) {
    await setup(12, setName === 'xmas');
    await page.evaluate((ids) => {
      const S = window.__aquarium.state;
      S.up.deco = [...ids];
      delete S.up.decoPos;
      window.__aquarium.render?.();
    }, keys);
    await new Promise((r) => setTimeout(r, 2000));
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => { window.__aquarium.update?.(1 / 30); window.__aquarium.render?.(); });
      await new Promise((r) => setTimeout(r, 50));
    }
    await page.screenshot({ path: path.join(outDir, `coinsink-tank-6deco-${setName}-390.png`), fullPage: false });
  }

  await browser.close();
  const shots = fs.readdirSync(outDir).filter((f) => f.startsWith('coinsink-'));
  const filtered = errors.filter((e) => !/Failed to load resource|404|MIME type/.test(e));
  console.log(JSON.stringify({ errors: filtered, screenshots: shots }, null, 2));
  if (filtered.length) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
