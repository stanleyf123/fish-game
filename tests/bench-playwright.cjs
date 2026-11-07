/**
 * PERF-231 Playwright 真實瀏覽器基準 v3
 * ─────────────────────────────────────────
 * 量測兩個版本（4.2.230 vs 4.2.231）在 Chrome 中的真實影格時間。
 *
 * 關鍵發現：
 *  - game 中 `let S` 是 script 頂層 let，不掛在 window 上
 *  - 但 window.__aquarium.state 可以存取 S
 *  - window.__aquarium.addRuntime 可直接注入魚
 *  - window.__aquarium.SPECIES 有 459 個魚種
 *  - window.__aquarium.gfx(q) 切換畫質
 *
 * 流程：
 *  1. 本機 HTTP server 伺服 HTML
 *  2. 路由 /art/* → feedfishs.com CDN
 *  3. 等 __aquarium.state 存在（newGame 完成）
 *  4. 注入 50 隻照片魚
 *  5. 等圖片開始下載（3s）
 *  6. 啟動 CPU 4× throttle
 *  7. 量測冷啟動 60 幀 → 等暖機 400 幀 → 量測暖快取 60 幀
 *  8. 截圖（全景 + 貼近）
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const BASE    = path.join(__dirname, '..');
const OUT     = path.join(BASE, 'perf231-review');
const HTML230 = '/home/ubuntu/.cursor/projects/agent-repos-fish-game/uploads/index_b786.html';
const HTML231 = path.join(BASE, 'index.html');

// 50 隻照片魚場景：guppy(len=20) × 25, koi(len=60) × 10, DMM × 15
const PHOTO_FISH = [
  ...Array(12).fill('guppy_red_leopard'),
  ...Array(5).fill('guppy_yellow_leopard'),
  ...Array(5).fill('guppy_moscow_blue'),
  ...Array(3).fill('guppy_green_snakeskin'),
  ...Array(10).fill('koi_longfin_platinum'),
  ...Array(5).fill('koi_ochiba'),
  ...Array(5).fill('p_dmm_redhook345'),
  ...Array(5).fill('p_dmm_ghost344'),
];
// 金幣測試場景（少量魚，主要觀察飛弧合併）
const COIN_FISH = [
  ...Array(6).fill('guppy_red_leopard'),
  ...Array(3).fill('koi_longfin_platinum'),
  ...Array(3).fill('p_dmm_redhook345'),
];

fs.mkdirSync(OUT, { recursive: true });

// ─── 本機 HTTP server ─────────────────────────────────────────────
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
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ─── 統計 ─────────────────────────────────────────────────────────
function stats(arr) {
  const a = [...arr].sort((a, b) => a - b);
  const p = pct => a[Math.min(a.length - 1, Math.floor(a.length * pct / 100))];
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
  return {
    avg: avg.toFixed(2),
    p50: p(50).toFixed(2),
    p95: p(95).toFixed(2),
    p99: p(99).toFixed(2)
  };
}

// ─── 路由：/art/* → feedfishs.com ────────────────────────────────
async function setupRoutes(page, context) {
  await page.route('**/art/**', async route => {
    try {
      const urlObj = new URL(route.request().url());
      const r = await context.request.fetch(
        'https://www.feedfishs.com' + urlObj.pathname + urlObj.search,
        { timeout: 10000 }
      );
      await route.fulfill({ response: r });
    } catch { await route.abort(); }
  });
  await page.route('**/sdk/**', r => r.abort());
  await page.route('**/api/**', r => r.abort());
}

// ─── 注入魚（透過 __aquarium）────────────────────────────────────
async function injectFish(page, fishList) {
  return page.evaluate((list) => {
    const aq = window.__aquarium;
    if (!aq || !aq.state) return 0;

    aq.state.fish.length = 0;  // 清空現有魚

    let added = 0;
    let idx = 0;
    for (const sp of list) {
      const s = aq.SPECIES[sp];
      if (!s) { continue; }

      // 仿 makeFish 建立最小魚物件
      const hue = ((s.hue || 0) + (idx % 7) * 5 + 360) % 360;
      const f = {
        id: Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).slice(2),
        sp, name: sp,
        hue, size: 1,
        growth: 80, full: 80, starve: 0, sick: false,
        cd: 1e9, coinT: 999,
        seed: Math.floor(Math.random() * 1e5),
        health: 100,
        phase: Math.random() * 6,
      };

      // 分散位置（左右交替，垂直均勻分佈）
      const cols = 5, row = Math.floor(idx / cols), col = idx % cols;
      const x = 38 + col * 60 + Math.random() * 20;
      const y = 80 + row * 80 + Math.random() * 20;

      aq.addRuntime(f, x, y);
      aq.state.fish.push(f);
      added++;
      idx++;
    }
    return added;
  }, fishList);
}

// ─── 收集影格時間（rAF + performance.now 差值）────────────────────
async function collectFrameTimes(page, n) {
  return page.evaluate(async (n) => {
    return new Promise(resolve => {
      const times = [];
      let last = performance.now();
      let count = 0;
      function raf(now) {
        if (count > 0) times.push(now - last);
        last = now;
        count++;
        if (count <= n) requestAnimationFrame(raf);
        else resolve(times);
      }
      requestAnimationFrame(raf);
    });
  }, n);
}

// ─── 測量一個版本 ─────────────────────────────────────────────────
async function measureVersion(label, htmlPath, port) {
  console.log(`\n=== ${label} (port ${port}) ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });

  const results = {};

  // 高畫質(2) 和省電(0) 分別測量
  for (const gfx of [2, 0]) {
    const gfxName = gfx === 2 ? 'high' : 'low';
    console.log(`\n  [${label}/${gfxName}] 初始化 gfx=${gfx}...`);

    const page = await context.newPage();
    const cdp  = await context.newCDPSession(page);

    await setupRoutes(page, context);

    // 載入（無 throttle，讓 JS 初始化快速完成）
    const url = `http://127.0.0.1:${port}/?api=off&gfx=${gfx}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等 __aquarium.state 存在（newGame 完成）
    await page.waitForFunction(() => {
      const aq = window.__aquarium;
      return aq && aq.state && typeof aq.state === 'object';
    }, { timeout: 15000 });

    // 注入 50 隻照片魚
    const added = await injectFish(page, PHOTO_FISH);
    console.log(`  注入 ${added} 隻照片魚`);

    // 設定畫質（鎖定）
    await page.evaluate((gfxQ) => window.__aquarium.gfx(gfxQ), gfx);

    // 等圖片開始下載（路由至 feedfishs.com）
    console.log(`  等圖片載入 3s...`);
    await page.waitForTimeout(3000);

    // 啟動 CPU 4× throttle（模擬 mid-range 手機）
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    console.log(`  CPU 4× throttle 啟動`);

    // 冷啟動：60 幀
    console.log(`  量測冷啟動 60 幀...`);
    const coldTimes = await collectFrameTimes(page, 60);
    const coldSt = stats(coldTimes);
    console.log(`  冷: avg=${coldSt.avg} p50=${coldSt.p50} p95=${coldSt.p95} p99=${coldSt.p99} ms`);

    // 暖機：等 400 幀
    console.log(`  等暖機 400 幀...`);
    await collectFrameTimes(page, 400);

    // 暖快取：60 幀
    console.log(`  量測暖快取 60 幀...`);
    const warmTimes = await collectFrameTimes(page, 60);
    const warmSt = stats(warmTimes);
    console.log(`  暖: avg=${warmSt.avg} p50=${warmSt.p50} p95=${warmSt.p95} p99=${warmSt.p99} ms`);

    results[gfxName] = { cold: coldSt, warm: warmSt };

    // 截圖（關閉 throttle 讓 Chrome 渲染清晰）
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUT, `${gfxName}-${label}.png`) });
    // 貼近（canvas 中央魚群最密集處）
    await page.screenshot({
      path: path.join(OUT, `${gfxName}-${label}-close.png`),
      clip: { x: 50, y: 180, width: 275, height: 380 }
    });
    console.log(`  ✓ 截圖：${gfxName}-${label}.png  ${gfxName}-${label}-close.png`);
    await page.close();
  }

  // 金幣合併截圖
  {
    console.log(`\n  [${label}] 金幣合併截圖...`);
    const pg = await context.newPage();
    await setupRoutes(pg, context);
    await pg.goto(`http://127.0.0.1:${port}/?api=off&gfx=2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pg.waitForFunction(() => window.__aquarium && window.__aquarium.state, { timeout: 15000 });
    await injectFish(pg, COIN_FISH);

    // 建立金幣並觸發 tryCoins
    await pg.evaluate(() => {
      const aq = window.__aquarium;
      if (!aq) return;
      const coins = aq.coins;
      if (!coins) return;
      coins.length = 0;
      for (let i = 0; i < 15; i++) {
        coins.push({
          x: 150 + i * 10, y: 320 + i * 8,
          vy: 0, v: 10 + i, t: 999, ground: true,
          fly: 0, ph: i * 0.4, prod: false, credited: false,
          clicked: 0, sx: 150, sy: 320, ft: 0
        });
      }
      // 觸發 tryCoins
      if (typeof aq.tryCoins === 'function') {
        aq.tryCoins(155, 324);
      }
    });

    await pg.waitForTimeout(1000);
    await pg.screenshot({ path: path.join(OUT, `coins-merge-${label}.png`) });
    console.log(`  ✓ coins-merge-${label}.png`);
    await pg.close();
  }

  await browser.close();
  return results;
}

// ─── 主程式 ───────────────────────────────────────────────────────
(async () => {
  console.log('=== PERF-231 Playwright 真實瀏覽器基準 v3 ===');
  console.log(`場景：${PHOTO_FISH.length} 隻照片魚，375×812`);
  console.log(`CPU throttle：4×（量測階段）\n`);

  const { server: s230, port: p230 } = await serve(HTML230);
  const { server: s231, port: p231 } = await serve(HTML231);

  console.log(`4.2.230 → http://127.0.0.1:${p230}`);
  console.log(`4.2.231 → http://127.0.0.1:${p231}`);

  let r230, r231;
  try {
    r230 = await measureVersion('230', HTML230, p230);
    r231 = await measureVersion('231', HTML231, p231);
  } finally {
    s230.close();
    s231.close();
  }

  // ─── timings.md ──────────────────────────────────────────────
  const md = `# PERF-231 真實影格時間測速表

## 測量方法

| 項目 | 設定 |
|------|------|
| 工具 | Playwright + Chrome Headless v158 |
| CPU throttle | 4× (Emulation.setCPUThrottlingRate)，模擬 mid-range Android |
| 視窗 | 375 × 812，deviceScaleFactor=2 |
| 場景 | ${PHOTO_FISH.length} 隻照片魚（guppy ×25、koi ×15、DMM ×10） |
| 量測方式 | rAF 回呼內 \`performance.now()\` 差值（ms/frame） |
| 冷啟動 | 注入魚後前 60 幀（PhotoAnim236 預烘焙進行中） |
| 暖快取 | 再等 400 幀後取 60 幀（預烘焙完成） |
| 圖片 | 路由至 feedfishs.com CDN；缺圖不影響 drawImage 呼叫計時 |

## 影格時間（ms/frame）

| 版本 | 畫質 | 狀態 | 平均 | p50 | p95 | p99 |
|------|------|------|------|-----|-----|-----|
| 4.2.230 | 高畫質 | 冷啟動 | ${r230.high.cold.avg} | ${r230.high.cold.p50} | ${r230.high.cold.p95} | ${r230.high.cold.p99} |
| 4.2.230 | 高畫質 | 暖快取 | ${r230.high.warm.avg} | ${r230.high.warm.p50} | ${r230.high.warm.p95} | ${r230.high.warm.p99} |
| 4.2.230 | 省電   | 冷啟動 | ${r230.low.cold.avg} | ${r230.low.cold.p50} | ${r230.low.cold.p95} | ${r230.low.cold.p99} |
| 4.2.230 | 省電   | 暖快取 | ${r230.low.warm.avg} | ${r230.low.warm.p50} | ${r230.low.warm.p95} | ${r230.low.warm.p99} |
| 4.2.231 | 高畫質 | 冷啟動 | ${r231.high.cold.avg} | ${r231.high.cold.p50} | ${r231.high.cold.p95} | ${r231.high.cold.p99} |
| 4.2.231 | 高畫質 | 暖快取 | ${r231.high.warm.avg} | ${r231.high.warm.p50} | ${r231.high.warm.p95} | ${r231.high.warm.p99} |
| 4.2.231 | 省電   | 冷啟動 | ${r231.low.cold.avg} | ${r231.low.cold.p50} | ${r231.low.cold.p95} | ${r231.low.cold.p99} |
| 4.2.231 | 省電   | 暖快取 | ${r231.low.warm.avg} | ${r231.low.warm.p50} | ${r231.low.warm.p95} | ${r231.low.warm.p99} |

## 對比（p50 ms/frame）

| 比較 | 4.2.230 | 4.2.231 | 差值 |
|------|---------|---------|------|
| 高畫質 冷啟動 | ${r230.high.cold.p50} ms | ${r231.high.cold.p50} ms | ${(parseFloat(r231.high.cold.p50) - parseFloat(r230.high.cold.p50)).toFixed(2)} ms |
| 高畫質 暖快取 | ${r230.high.warm.p50} ms | ${r231.high.warm.p50} ms | ${(parseFloat(r231.high.warm.p50) - parseFloat(r230.high.warm.p50)).toFixed(2)} ms |
| 省電 冷啟動 | ${r230.low.cold.p50} ms | ${r231.low.cold.p50} ms | ${(parseFloat(r231.low.cold.p50) - parseFloat(r230.low.cold.p50)).toFixed(2)} ms |
| 省電 暖快取 | ${r230.low.warm.p50} ms | ${r231.low.warm.p50} ms | ${(parseFloat(r231.low.warm.p50) - parseFloat(r230.low.warm.p50)).toFixed(2)} ms |

## 截圖路徑

| 圖片 | 路徑 |
|------|------|
| 高畫質全景 4.2.230 | \`perf231-review/high-230.png\` |
| 高畫質全景 4.2.231 | \`perf231-review/high-231.png\` |
| 高畫質貼近 4.2.230 | \`perf231-review/high-230-close.png\` |
| 高畫質貼近 4.2.231 | \`perf231-review/high-231-close.png\` |
| 省電全景 4.2.230 | \`perf231-review/low-230.png\` |
| 省電全景 4.2.231 | \`perf231-review/low-231.png\` |
| 省電貼近 4.2.230 | \`perf231-review/low-230-close.png\` |
| 省電貼近 4.2.231 | \`perf231-review/low-231-close.png\` |
| 金幣合併 4.2.230 | \`perf231-review/coins-merge-230.png\` |
| 金幣合併 4.2.231 | \`perf231-review/coins-merge-231.png\` |
`;

  fs.writeFileSync(path.join(OUT, 'timings.md'), md, 'utf8');

  console.log('\n=== 完成！');
  console.log('\n影格時間摘要（p50 ms/frame, 50 隻照片魚, CPU 4×）：');
  console.log('  版本  畫質  狀態     p50     p95     p99');
  for (const [lbl, r] of [['230', r230], ['231', r231]]) {
    for (const [gx, gn] of [['high', '高'], ['low', '省']]) {
      for (const [phase, pn] of [['cold', '冷'], ['warm', '暖']]) {
        const s = r[gx][phase];
        console.log(`  ${lbl}   ${gn}    ${pn}啟動   ${String(s.p50).padStart(6)}  ${String(s.p95).padStart(6)}  ${String(s.p99).padStart(6)}`);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
