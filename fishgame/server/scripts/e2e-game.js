#!/usr/bin/env node
// 遊戲端端對端測試（headless Chrome）：本機存檔搬遷、訪客自動建立、註冊、信箱領取、公告、商城、另一裝置登入、伺服器離線。
// 會在暫存資料夾啟動一個獨立的伺服器（不影響 data/），截圖存到 shots/game-*.png
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let chromium; try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require(path.join(__dirname, '../../node_modules/playwright-core'))); }
const { createApp } = require('../src/app');
const GAME_DIR = process.env.GAME_DIR || path.join(__dirname, '../..');
const OUT = path.join(__dirname, '../shots');
const PW = 'e2e-admin-password-xyz';
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishgame-e2e-'));
  const env = { ADMIN_PASSWORD: PW, SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789', NODE_ENV: 'development', SERVE_GAME_DIR: GAME_DIR, PAYMENT_MOCK_ENABLED: '1', RATE_LIMIT_GUEST_PER_HOUR: '1000' };
  const { app, close } = createApp({ dataDir, env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const BASE = `http://127.0.0.1:${server.address().port}`;
  // 只有靜態檔、沒有 API 的伺服器（模擬 nginx 正常但 Node 停掉）
  const staticSrv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(GAME_DIR, 'index.html'))); }
    res.writeHead(502, { 'content-type': 'text/html' }); res.end('<h1>502 Bad Gateway</h1>');
  });
  await new Promise((r) => staticSrv.listen(0, '127.0.0.1', r));
  const STATIC = `http://127.0.0.1:${staticSrv.address().port}`;

  // 後台 API 小工具
  const lr = await fetch(BASE + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
  const csrf = (await lr.json()).csrf, cookie = lr.headers.get('set-cookie').split(';')[0];
  const adm = async (m, p, b) => (await fetch(BASE + '/admin/api' + p, { method: m, headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', origin: BASE }, body: b && JSON.stringify(b) })).json();
  await adm('POST', '/announcements', { title: '歡迎來到悠游水族箱！', body: '雲端存檔上線囉，註冊會員就能在不同裝置繼續照顧魚兒。', active: true });

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const mkPage = async (ctx, label) => {
    const page = await ctx.newPage(); page._errs = []; page._net = [];
    page.on('pageerror', (e) => page._errs.push(label + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') (/Failed to load resource/.test(m.text()) ? page._net : page._errs).push(label + ' console: ' + m.text()); });
    return page;
  };
  const closeModal = async (page) => { for (let i = 0; i < 4; i++) { const vis = await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display === 'flex'); if (!vis) return; await page.click('#modalBox .mb button:last-child').catch(() => page.evaluate(() => { document.getElementById('modal').style.display = 'none'; })); await page.waitForTimeout(250); } };
  const state = (page) => page.evaluate(() => { const a = window.__aquarium; return { coins: Math.floor(a.state.coins), fish: a.state.fish.map((f) => f.id), species: a.state.fish.map((f) => f.sp), filter: a.state.up.filter, deco: a.state.up.deco, found: Object.keys(a.state.found), dirt: Math.round(a.state.water.dirt), cloud: { online: a.cloud.state.online, player: a.cloud.state.player, status: a.cloud.state.status }, btn: document.getElementById('acctBtn').textContent }; });

  try {
    // ---------- 1. 單機（既有玩家：先在沒有後端的情況下玩出本機存檔） ----------
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
    let page = await mkPage(ctx1, 'dev1');
    await page.goto(BASE + '/?api=off'); await page.waitForTimeout(1200); await closeModal(page);
    await page.evaluate(() => { const a = window.__aquarium; a.state.coins = 260; a.setTab('shop'); });
    await page.waitForTimeout(300);
    await page.click('[data-buy="amano"]'); await page.waitForTimeout(400);
    await page.evaluate(() => { const a = window.__aquarium; a.state.up.deco.push('coral'); a.state.water.dirt = 21; });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const local = await state(page);
    ok('單機模式（?api=off）可正常遊玩', local.fish.length === 4 && /單機/.test(local.btn), local.btn);

    // ---------- 2. 接上後端：自動建立訪客、本機存檔搬到雲端 ----------
    await page.goto(BASE + '/'); await page.waitForTimeout(2500);
    const annShown = await page.evaluate(() => document.getElementById('modalBox').textContent.includes('歡迎來到悠游水族箱'));
    await page.screenshot({ path: path.join(OUT, 'game-announcement.png') });
    ok('開啟遊戲時顯示新公告', annShown);
    await closeModal(page);
    let st = await state(page);
    ok('自動建立訪客帳號', st.cloud.online && st.cloud.player && st.cloud.player.bound === false, '#' + (st.cloud.player && st.cloud.player.id));
    ok('沿用本機魚缸（含新買的沼蝦、珊瑚、水質）', JSON.stringify(st.fish) === JSON.stringify(local.fish) && st.deco.includes('coral'));
    await page.waitForTimeout(800);
    const pid = st.cloud.player.id;
    let det = await adm('GET', '/players/' + pid);
    ok('本機存檔已上傳到雲端', det.save && det.save.save && det.save.save.fish.length === 4 && det.save.save.fish.some((f) => f.sp === 'amano'), 'rev ' + (det.save && det.save.rev));
    await page.screenshot({ path: path.join(OUT, 'game-guest.png') });

    // ---------- 3. 註冊會員（UI） ----------
    await page.click('#acctBtn'); await page.waitForSelector('#acctForm');
    await page.fill('#aUser', 'not-an-email'); await page.click('#aGo'); await page.waitForTimeout(150);
    ok('註冊表單：信箱格式錯誤', /信箱格式不正確/.test(await page.textContent('#aErr')));
    await page.fill('#aUser', ' E2E@Example.com '); await page.fill('#aPass', 'abc'); await page.click('#aGo');
    const e1 = await page.textContent('#aErr');
    ok('註冊表單即時錯誤訊息（密碼太短）', /至少需要 8/.test(e1), e1);
    await page.fill('#aPass', 'fishfish88'); await page.fill('#aPass2', 'fishfish89'); await page.click('#aGo');
    ok('註冊表單：兩次密碼不一致', /不一致/.test(await page.textContent('#aErr')));
    await page.fill('#aPass2', 'fishfish88'); await page.click('[data-eye]');
    await page.screenshot({ path: path.join(OUT, 'game-register.png') });
    await page.click('#aGo'); await page.waitForTimeout(1500);
    st = await state(page);
    ok('註冊成功，頂部顯示會員信箱', st.cloud.player.bound && /e2e@example\.com/.test(st.btn), st.btn);
    ok('註冊後仍是同一個魚缸', st.cloud.player.id === pid && JSON.stringify(st.fish) === JSON.stringify(local.fish));
    await closeModal(page);
    det = await adm('GET', '/players/' + pid);
    ok('後台看到會員信箱（小寫）', det.player.email === 'e2e@example.com', JSON.stringify({ u: det.player.username, e: det.player.email }));

    // ---------- 4. 信箱領取 ----------
    await adm('POST', '/rewards', { title: '新會員禮', body: '感謝註冊！', coins: 500, fish: [{ species: 'cherry', count: 1 }], target: 'player', playerIds: [pid] });
    const before = (await state(page)).coins;
    await page.click('#mailBtn'); await page.waitForSelector('[data-claim]');
    await page.screenshot({ path: path.join(OUT, 'game-mailbox.png') });
    await page.click('[data-claim]'); await page.waitForTimeout(1800);
    st = await state(page);
    ok('信箱領取：金幣與魚寫入魚缸', st.coins >= before + 500 && st.species.includes('cherry'), `${before} → ${st.coins}`);
    await closeModal(page);

    // ---------- 5. 商城（開發環境有上架商品時顯示） ----------
    const storeVis = await page.evaluate(() => getComputedStyle(document.getElementById('storeTab')).display !== 'none');
    ok('有上架商品時顯示「💎 商城」分頁', storeVis);
    if (storeVis) { await page.click('#storeTab'); await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, 'game-store.png') }); }
    // 月卡加成：後台手動發放月卡
    await adm('POST', `/players/${pid}/grant-product`, { sku: 'vip_month', note: 'e2e' });
    await page.click('#acctBtn'); await page.waitForTimeout(300);
    await page.evaluate(() => window.__aquarium.cloud.state && 0);
    await closeModal(page);
    await page.evaluate(async () => { /* 觸發 refreshEnt */ document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1200);
    const vip = await page.evaluate(() => { const c = window.__aquarium.cloud.state; return { active: c.ent && c.ent.vip.active, gems: c.gems }; });
    ok('月卡權益套用（VIP 有效、寶石入帳）', vip.active && vip.gems >= 100, JSON.stringify(vip));
    await page.click('#acctBtn'); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'game-member.png') });
    await closeModal(page);
    await page.click('[data-tab=shop]');

    // 同步一次
    await page.evaluate(() => window.__aquarium.cloud.pushNow()); await page.waitForTimeout(500);
    const dev1Final = await state(page);

    // ---------- 6. 另一台裝置登入 ----------
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' });
    const p2 = await mkPage(ctx2, 'dev2');
    await p2.goto(BASE + '/'); await p2.waitForTimeout(2500); await closeModal(p2);
    const g2 = await state(p2);
    ok('第二台裝置先以新訪客進入', g2.cloud.player && !g2.cloud.player.bound && g2.cloud.player.id !== pid);
    await p2.screenshot({ path: path.join(OUT, 'game-mobile-guest.png') });
    await p2.waitForTimeout(800); { const mt = await p2.evaluate(() => getComputedStyle(document.getElementById('modal')).display === 'flex' ? document.getElementById('modalBox').innerText.slice(0, 80) : ''); if (mt) console.log('   （延遲出現的視窗：' + mt.replace(/\n/g, ' ') + '）'); } await closeModal(p2);
    await p2.click('#acctBtn'); await p2.waitForSelector('#acctForm');
    await p2.click('[data-m=login]'); await p2.waitForSelector('#aUser');
    await p2.fill('#aUser', 'e2e@EXAMPLE.com'); await p2.fill('#aPass', 'wrongpass1'); await p2.click('#aGo'); await p2.waitForTimeout(1200);
    ok('登入錯誤密碼顯示中文錯誤', /信箱或密碼錯誤/.test(await p2.textContent('#aErr')));
    await p2.fill('#aPass', 'fishfish88');
    await p2.screenshot({ path: path.join(OUT, 'game-mobile-login.png') });
    await p2.click('#aGo'); await p2.waitForTimeout(2000); await closeModal(p2);
    const s2 = await state(p2);
    ok('其他裝置登入後載入完整魚缸', s2.cloud.player.id === pid && JSON.stringify(s2.fish) === JSON.stringify(dev1Final.fish) && s2.deco.includes('coral') && s2.found.includes('cherry') && Math.abs(s2.coins - dev1Final.coins) < 50, `fish ${s2.fish.length} coins ${s2.coins}`);
    const pos = await p2.evaluate(() => window.__aquarium.state.fish.map((f) => [f.px, f.py]));
    ok('魚的位置也一併還原', pos.every(([x, y]) => typeof x === 'number' && typeof y === 'number'));
    await p2.screenshot({ path: path.join(OUT, 'game-mobile-member.png') });

    // ---------- 7. 衝突：裝置 2 改動後，裝置 1 的舊版本上傳會收到 409 並載入最新 ----------
    await p2.evaluate(() => { window.__aquarium.state.coins += 5; }); await p2.evaluate(() => window.__aquarium.cloud.pushNow()); await p2.waitForTimeout(400);
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.__aquarium.cloud.pushNow()); await page.waitForTimeout(1200);
    const afterConflict = await page.evaluate(() => window.__aquarium.cloud.state.status);
    ok('多裝置衝突處理（409 → 載入雲端最新）', afterConflict === 'ok');
    await closeModal(page);

    // ---------- 8. 登出 ----------
    await p2.click('#acctBtn'); await p2.waitForTimeout(300);
    await p2.click('[data-a=logout]'); await p2.waitForTimeout(200); await p2.click('#modalBox .mb button:last-child'); await p2.waitForTimeout(2500);
    const lo = await state(p2);
    ok('登出後變成新的訪客與全新魚缸', lo.cloud.player && !lo.cloud.player.bound && lo.cloud.player.id !== pid && lo.fish.length === 3, lo.btn);
    await closeModal(p2);

    // ---------- 9. 後端無法連線（nginx 正常、Node 停掉 → /api 與 /sdk 回 502） ----------
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
    const p3 = await mkPage(ctx3, 'nodown');
    const t0 = Date.now();
    await p3.goto(STATIC + '/'); await p3.waitForTimeout(3500);
    await closeModal(p3);
    const s3 = await state(p3);
    ok('API 無法連線時遊戲照常啟動（內建設定、本機存檔）', s3.fish.length === 3 && !s3.cloud.online, `${s3.btn}・${Date.now() - t0}ms`);
    await p3.click('canvas#tank', { position: { x: 400, y: 300 } }); await p3.waitForTimeout(300);
    const foods = await p3.evaluate(() => window.__aquarium.foods.length);
    ok('離線時仍可餵食', foods > 0);
    await p3.screenshot({ path: path.join(OUT, 'game-offline.png') });

    const errs = [page, p2, p3].flatMap((p) => p._errs);
    ok('沒有 JavaScript 錯誤（console error / pageerror）', errs.length === 0, errs.join(' | '));
    const net = p3._net.length; console.log(`（離線測試中瀏覽器記錄了 ${net} 筆預期中的 502 資源載入失敗）`);
    // 後台會員／訪客顯示
    const pl = await adm('GET', '/players?filter=bound');
    ok('後台玩家列表可篩選會員', pl.players.some((p) => p.email === 'e2e@example.com'));
  } catch (e) { ok('E2E 執行', false, e.stack); }
  finally {
    await browser.close(); staticSrv.close(); server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const fail = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fail} / ${results.length} 通過`);
  process.exit(fail ? 1 : 0);
})();
