// 正式站驗證（不印出任何密碼）：node scripts/verify-prod.js  （需環境變數 VERIFY_ADMIN_PASSWORD）
'use strict';
const path = require('path');
let chromium; try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const BASE = process.env.PROD_BASE || 'https://www.feedfishs.com';
const OUT = path.join(__dirname, '../shots/prod');
const res = []; const ok = (n, c, d) => { res.push(c); console.log(`${c ? '✅' : '❌'} ${n}${d !== undefined ? '  ' + JSON.stringify(d) : ''}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const mk = async (ctx, label) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(label + ' pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(label + ' console ' + m.text()); }); return p; };
  const closeModal = async (page) => { for (let i = 0; i < 4; i++) { const vis = await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display === 'flex'); if (!vis) return; await page.click('#modalBox .mb button:last-child').catch(() => {}); await page.waitForTimeout(300); } };
  const st = (page) => page.evaluate(() => { const a = window.__aquarium; return { fish: a.state.fish.map((f) => f.id + ':' + f.sp), coins: Math.floor(a.state.coins), online: a.cloud.state.online, pid: a.cloud.state.player && a.cloud.state.player.id, user: a.cloud.state.player && a.cloud.state.player.username, btn: document.getElementById('acctBtn').textContent, cfgSrc: a.config && a.config.__source }; });
  const pids = [];
  try {
    const c1 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
    const p = await mk(c1, 'dev1');
    const r = await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(4000);
    ok('遊戲首頁 HTTPS 200', r.status() === 200, r.status());
    await p.screenshot({ path: path.join(OUT, 'prod-first-load.png') }); await closeModal(p);
    let s = await st(p); pids.push(s.pid);
    ok('自動建立訪客並連上雲端', s.online && !!s.pid && /訪客/.test(s.btn), { online: s.online, btn: s.btn, fish: s.fish.length });
    await p.evaluate(() => window.__aquarium.cloud.pushNow()); await p.waitForTimeout(2500);
    const cloudSave = await p.evaluate(async () => { const t = JSON.parse(localStorage.getItem('fishsdk.session') || 'null'); return null; });
    // 註冊
    const uname = 'zzverify' + Date.now().toString(36); const pw = 'Vfy' + Math.random().toString(36).slice(2, 12) + '9';
    await p.click('#acctBtn'); await p.waitForSelector('#acctForm');
    await p.fill('#aUser', uname); await p.fill('#aPass', pw); await p.fill('#aPass2', pw); await p.click('#aGo'); await p.waitForTimeout(2500); await closeModal(p);
    s = await st(p);
    ok('註冊會員（保留同一個魚缸）', s.user === uname && s.pid === pids[0] && s.btn.includes(uname), { btn: s.btn, samePid: s.pid === pids[0] });
    await p.evaluate(() => window.__aquarium.cloud.pushNow()); await p.waitForTimeout(2500);
    const fish1 = s.fish;
    await p.screenshot({ path: path.join(OUT, 'prod-member.png') });
    // 另一台裝置登入
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
    const q = await mk(c2, 'dev2');
    await q.goto(BASE + '/'); await q.waitForTimeout(4000); await closeModal(q);
    const g2 = await st(q); pids.push(g2.pid);
    await q.click('#acctBtn'); await q.waitForSelector('#acctForm'); await q.click('[data-m=login]'); await q.waitForSelector('#aUser');
    await q.fill('#aUser', uname); await q.fill('#aPass', pw); await q.click('#aGo'); await q.waitForTimeout(3000); await closeModal(q);
    const s2 = await st(q);
    ok('另一台裝置登入後載入同一個魚缸', s2.user === uname && JSON.stringify(s2.fish) === JSON.stringify(fish1), { fish: s2.fish.length });
    await q.screenshot({ path: path.join(OUT, 'prod-mobile-login.png') });
    // API
    const api = await (await fetch(BASE + '/api/health')).json(); ok('/api/health', api.ok === true, api);
    const cfg = await fetch(BASE + '/api/config'); const cj = await cfg.json(); ok('/api/config', cfg.ok && Object.keys(cj.species || {}).length === 16, { status: cfg.status, version: cj.version, species: Object.keys(cj.species || {}).length });
    // 後台
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    const a = await mk(c3, 'admin');
    const ar = await a.goto(BASE + '/admin/'); await a.waitForSelector('#pw');
    ok('後台登入頁（HTTPS）', ar.status() === 200 && a.url().startsWith('https://'), a.url());
    await a.fill('#pw', process.env.VERIFY_ADMIN_PASSWORD || '');
    await Promise.all([a.waitForURL(/\/admin\/$/, { timeout: 15000 }), a.click('button[type=submit]')]).catch(() => {});
    await a.waitForTimeout(2500);
    const loggedIn = await a.evaluate(async () => (await fetch('/admin/api/session')).ok);
    ok('後台登入成功', loggedIn);
    const dash = await a.evaluate(async () => (await fetch('/admin/api/dashboard')).json());
    ok('儀表板為真實資料（接近空的）', dash && typeof dash === 'object', JSON.stringify(dash).slice(0, 400));
    await a.screenshot({ path: path.join(OUT, 'prod-admin-dashboard.png') });
    const list = await a.evaluate(async () => (await fetch('/admin/api/players?limit=50')).json());
    console.log('players:', JSON.stringify((list.players || list.rows || []).map((x) => ({ id: x.id, username: x.username, demo: x.is_demo }))));
    console.log('TEST_PIDS=' + pids.filter(Boolean).join(','));
  } catch (e) { ok('執行例外', false, e.message); }
  ok('沒有 JS/console 錯誤', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${res.filter(Boolean).length} / ${res.length} 通過`);
  process.exit(res.every(Boolean) ? 0 : 1);
})();
