#!/usr/bin/env node
// 用 headless Chrome 截圖後台各頁 → shots/*.png（需先啟動伺服器並建立示範資料）
'use strict';
require('./load-env');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const BASE = process.env.SHOT_BASE || `http://127.0.0.1:${process.env.PORT || 3100}`;
const OUT = path.join(__dirname, '..', 'shots');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--font-render-hinting=none'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-TW', timezoneId: 'Asia/Taipei' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + '/admin/login');
  await page.screenshot({ path: path.join(OUT, '00-login.png') });
  await page.fill('#pw', process.env.ADMIN_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin\/$/), page.click('button[type=submit]')]);
  const shots = [
    ['01-dashboard', '#dashboard'],
    ['02-config-form', '#config', async () => { await page.click('[data-sec=upgrades]'); }],
    ['03-config-json', '#config', async () => { await page.click('[data-tab=json]'); }],
    ['04-config-history', '#config', async () => { await page.click('[data-tab=history]'); await page.click('[data-view]'); }],
    ['05-species-editor', '#species/koi'],
    ['05b-species-shrimp', '#species/amano'],
    ['06-species-new', '#species', async () => { await page.click('[data-new]'); await page.fill('#newKey', 'seahorse'); await page.fill('[data-sp="name"]', '海馬'); await page.selectOption('[data-sp="look.body"]', 'tall'); await page.selectOption('[data-sp="look.pattern"]', 'spots'); await page.selectOption('[data-sp="look.tail"]', 'small'); await page.fill('input[type=number][data-sp="look.hue"]', '300'); await page.dispatchEvent('input[type=number][data-sp="look.hue"]', 'input'); }],
    ['07-players', '#players'],
    ['08-player-detail', null, async () => { await page.goto(BASE + '/admin/#players'); await page.waitForSelector('tr[data-id]'); await page.click('tr[data-id]'); }],
    ['09-announcements', '#announcements'],
    ['10-rewards', '#rewards', async () => { await page.check('input[name=tgt][value=filter]'); await page.fill('#rTitle', '週末加碼'); await page.fill('#rCoins', '500'); await page.fill('#fDays', '7'); await page.check('#fDemo'); await page.click('#preview'); }],
    ['11-revenue', '#revenue'],
    ['12-products', '#products'],
    ['13-orders', '#orders'],
    ['14-members', '#members'],
    ['15-audit', '#audit'],
  ];
  for (const [name, hash, fn] of shots) {
    if (hash) { await page.goto(BASE + '/admin/' + hash); }
    await page.waitForFunction(() => !document.querySelector('#main .loading'), null, { timeout: 10000 });
    if (fn) await fn();
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    console.log('📸', name);
  }
  console.log(errors.length ? 'Console 錯誤：\n' + errors.join('\n') : '無 console 錯誤');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
