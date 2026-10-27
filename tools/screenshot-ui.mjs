#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'image/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.includes('/art/') || url.includes('/sdk/')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  }
  const file = path.join(root, url === '/' ? 'index.html' : url.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];

async function shot(name, w, h, fn) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/index.html?shopv2=1&api=off', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.ShopV2 && window.__aquarium && window.__aquarium.SPECIES, null, { timeout: 120000 });
  await fn(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
  await ctx.close();
  console.log('saved', name);
}

await shot('shop-fish-search-390x844.png', 390, 844, async (page) => {
  await page.evaluate(() => {
    mxShopQ = { text: '燈', n: 48 };
    ShopV2.state.src = 'coin';
    ShopV2.open('fish');
  });
  await page.waitForSelector('.sv2-fish-find');
});

await shot('shop-fish-family-sort-375x812.png', 375, 812, async (page) => {
  await page.evaluate(() => {
    mxShopQ = { familyName: '燈魚・脂鯉', sort: 'rarity', sortDir: 'desc', n: 48 };
    ShopV2.state.src = 'coin';
    ShopV2.open('fish');
  });
  await page.waitForSelector('.sv2-fam-scroll .mx-chip.on');
});

await shot('shop-fish-dex-detail-390x844.png', 390, 844, async (page) => {
  await page.evaluate(() => {
    mxShopQ = { text: '霓虹', n: 48 };
    ShopV2.state.src = 'coin';
    ShopV2.open('fish');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const sp = window.__aquarium.SPECIES;
    const keys = window.__aquarium.SP_KEYS;
    const k = keys.find((id) => sp[id].name.includes('霓虹')) || keys[0];
    FishDexUI.openFromShop(k);
  });
  await page.waitForSelector('.dex-detail, #modalBox .dex-hero');
});

await shot('shop-plants-category-375x812.png', 375, 812, async (page) => {
  await page.evaluate(() => {
    aqMode = 'plants';
    ShopV2.open('aq');
  });
  await page.waitForSelector('[data-aq="buy:riccia"],[data-aq^="buy:"]');
});

await shot('tank-ten-new-plants-390x844.png', 390, 844, async (page) => {
  const keys = ['riccia', 'anubias_petite', 'green_palace', 'limnophila_pagoda', 'water_orchid', 'bolbitis', 'staurogyne_repens', 'crypt_balansae', 'blyxa_japonica', 'salvinia_minima'];
  await page.evaluate((plantKeys) => {
    const S = window.__aquarium.state;
    S.plants = plantKeys.map((sp, i) => ({ id: 'p' + i, sp, x: 0.08 + i * 0.085, d: 0.45, g: 55, hp: 100, seed: 1000 + i }));
    S.gear = S.gear || { own: {}, light: null, temp: null };
    if (window.LAY) { window.LAY.dirty = true; window.LAY.sig = ''; }
    window.__aquarium.render();
    document.querySelector('#panel')?.classList.remove('open');
    document.body.classList.remove('sheet-open');
  }, keys);
});

await browser.close();
server.close();
if (errors.length) {
  console.error('JS errors:', errors.slice(0, 20).join('\n'));
  process.exit(1);
}
