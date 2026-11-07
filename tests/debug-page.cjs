'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HTML230 = '/home/ubuntu/.cursor/projects/agent-repos-fish-game/uploads/index_b786.html';

function serve(filePath) {
  return new Promise(resolve => {
    const html = fs.readFileSync(filePath, 'utf8');
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404); res.end('');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

(async () => {
  const { server, port } = await serve(HTML230);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', msg => { if (msg.type() === 'error') console.log('ERR:', msg.text()); });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));

  await page.route('**/art/**', async route => {
    try {
      const urlObj = new URL(route.request().url());
      const r = await context.request.fetch('https://www.feedfishs.com' + urlObj.pathname + urlObj.search, { timeout: 8000 });
      await route.fulfill({ response: r });
    } catch { await route.abort(); }
  });
  await page.route('**/sdk/**', r => r.abort());
  await page.route('**/api/**', r => r.abort());

  const url = `http://127.0.0.1:${port}/?api=off&gfx=2`;
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const aq = window.__aquarium;
    return {
      hasAQ: !!aq,
      aqState: aq ? (aq.state ? 'defined' : 'null/undefined') : 'no __aquarium',
      fishLen: aq?.state?.fish?.length,
      gameBuild: window.GAME_BUILD,
      species_count: aq?.SPECIES ? Object.keys(aq.SPECIES).length : 0,
      hasPhotoFishImages: typeof window.photoFishImages193 !== 'undefined',
      gfxInfo: aq?.gfxInfo?.(),
    };
  });

  console.log('\n=== Page State after 5s ===');
  console.log(JSON.stringify(state, null, 2));

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
