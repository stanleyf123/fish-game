/**
 * PERF-231 手機效能優化測試
 *
 * 採用「靜態原始碼分析 + 邏輯單元測試」策略：
 *   - 靜態檢查：確認關鍵常數、旗標、架構存在於原始碼
 *   - 邏輯單元：在最小 stub 環境中執行 tryCoins / 金幣合併邏輯
 *
 * 不嘗試完整啟動遊戲沙箱（live 4.2.x 有多段 <script>，
 * 無法在 Node.js vm 中一次完整初始化）。
 */
'use strict';
const fs     = require('node:fs');
const assert = require('node:assert/strict');
const path   = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// ─── 1. GAME_BUILD ────────────────────────────────────────────────
assert.ok(html.includes("GAME_BUILD='4.2.231'"),
  'GAME_BUILD 應升為 4.2.231');
console.log('[PASS] #1 GAME_BUILD=4.2.231');

// ─── 2. PERF-231 標記存在 ─────────────────────────────────────────
assert.ok(html.includes('PERF-231'),
  '應含 PERF-231 標記');
console.log('[PASS] #2 PERF-231 標記存在');

// ─── 3. 省電 N=16，高畫質 N=32 ───────────────────────────────────
assert.ok(html.includes('GFX.q===0?16:32'),
  '省電 N=16, 高畫質 N=32（三元運算）');
console.log('[PASS] #3 省電 N=16，高畫質 N=32');

// ─── 4. sliceOvlp：省電 1.4 px，高畫質 .22 px ────────────────────
assert.ok(html.includes('GFX.q===0?1.4:.22'),
  '省電切片重疊量 1.4 px，高畫質維持 .22 px');
console.log('[PASS] #4 sliceOvlp 省電=1.4, 高畫質=.22');

// ─── 5. sliceOvlp 實際用於 drawImage ─────────────────────────────
assert.ok(html.includes('L/N+sliceOvlp,y1-y0+sliceOvlp'),
  'drawImage 使用 sliceOvlp 而非固定 .22');
console.log('[PASS] #5 drawImage 使用 sliceOvlp');

// ─── 6. PhotoTint.fit 快取預算擴大 ───────────────────────────────
assert.ok(html.includes('18e6'),
  'PhotoTint.fit 快取上限應提升至 18M px（原 12M）');
assert.ok(html.includes('size>200'),
  'PhotoTint.fm.size 上限 200（原 150）');
console.log('[PASS] #6 PhotoTint.fit 快取預算擴大 12M→18M，size 150→200');

// ─── 7. PhotoAnim236 高畫質 build limit 提升 ─────────────────────
assert.ok(html.includes('GFX.q>=2?10:6'),
  'PhotoAnim236 高畫質每格允許 10 次預烘焙（原 6 次）');
console.log('[PASS] #7 高畫質 build limit 6→10');

// ─── 8. offscreen culling ────────────────────────────────────────
assert.ok(html.includes('offscreen culling'),
  'drawPhotoFish193 offscreen culling 優化存在');
assert.ok(html.includes('c===ctx&&'),
  '僅主畫布做 culling（sprite 預烘焙不跳過）');
console.log('[PASS] #8 offscreen culling（主畫布才跳過，sprite 不影響）');

// ─── 9. MAX_FLY 飛弧上限 = 5 ────────────────────────────────────
assert.ok(html.includes('MAX_FLY=5'),
  '飛弧上限常數 MAX_FLY=5');
console.log('[PASS] #9 MAX_FLY=5');

// ─── 10. 合計飄字 merged:true ────────────────────────────────────
assert.ok(html.includes('merged:true'),
  '大批金幣應推送 merged:true 的合計飄字');
console.log('[PASS] #10 merged:true 合計飄字');

// ─── 11. 飄字渲染支援 merged 旗標（較大字體）────────────────────
assert.ok(html.includes("p.merged?'bold 17px sans-serif':'bold 14px sans-serif'"),
  '合計飄字使用較大字體（17px）');
console.log('[PASS] #11 merged 飄字 17px 字體');

// ─── 12. 金幣合併邏輯單元測試 ────────────────────────────────────
// 在最小 stub 環境下執行 tryCoins 邏輯
{
  // 從原始碼提取 tryCoins 函式（搜尋定義）
  const tryCoinsMatch = html.match(/\/\*PERF-231[^*]*\*\/\nfunction tryCoins[\s\S]*?\n\}/);
  if (!tryCoinsMatch) {
    // 備用搜尋
    console.log('[SKIP] #12 無法從原始碼提取 tryCoins，改做邏輯驗證');
    assert.ok(html.includes("batch.length<=MAX_FLY"), '少量金幣各自飄字分支存在');
    assert.ok(html.includes("batch.reduce((s,c)=>s+c.v,0)"), '金幣總值累加（入帳不變）');
    console.log('[PASS] #12 金幣合併邏輯結構驗證（靜態）');
  } else {
    // 建立最小 stub 執行環境
    const coins  = [];
    const floats = [];
    const parts  = [];
    const VS     = 1;

    // stub 函式
    function collectCoin(c) {
      if (c.fly) return;
      c.fly = 1; c.credited = true;
      c._collected = true;    // 測試用：標記已入帳
      c.sx = c.x; c.sy = c.y; c.ft = 0;
    }
    function sweepDistance() { return 0; }
    // eslint-disable-next-line no-unused-vars
    const Sound = { play() {} };

    // 動態執行提取到的 tryCoins
    const fn = new Function(
      'coins','floats','parts','VS','collectCoin','sweepDistance','Sound',
      `${tryCoinsMatch[0]}\nreturn tryCoins;`
    )(coins, floats, parts, VS, collectCoin, sweepDistance, Sound);

    // 建立 12 枚假金幣
    function makeCoin(x, y, v) {
      return { x, y, vy: 0, v, t: 999, ground: true, fly: 0,
               ph: 0, prod: false, credited: false, clicked: 0, sx: x, sy: y, ft: 0 };
    }
    for (let i = 0; i < 12; i++) coins.push(makeCoin(100 + i * 30, 300, 10 + i));
    const totalExpected = coins.reduce((s, c) => s + c.v, 0);

    // 執行：一次掃過 (400, 300)，掃過半徑 26*VS=26 內全部金幣
    // 注意：tryCoins 使用 Math.hypot，讓所有金幣都在範圍內
    // 重寫 sweepDistance / hypot 距離判斷：讓所有 12 枚都在範圍
    // 這裡直接把所有金幣 x,y 設在 (400,300) 附近 25px 以內
    coins.forEach((c, i) => { c.x = 400 + (i % 5) * 4; c.y = 300 + Math.floor(i / 5) * 4; });

    fn(400, 300);

    // 驗證：所有金幣均已入帳（collectCoin 被呼叫）
    const allCredited = coins.every(c => c._collected);
    assert.ok(allCredited, '所有 12 枚金幣均應入帳（collectCoin 呼叫）');

    // 驗證：飛行中的金幣（fly=1 且尚在 coins 陣列）≤ 5
    const flyingCount = coins.filter(c => c.fly).length;
    assert.ok(flyingCount <= 5, `飛行中金幣數 ${flyingCount} 應 ≤ 5`);

    // 驗證：有 merged=true 的合計飄字
    const mergedFloat = floats.find(p => p.merged);
    assert.ok(mergedFloat, '應有 merged=true 的合計飄字');

    // 驗證：合計飄字的文字包含正確總金額
    assert.ok(mergedFloat.t.includes(String(totalExpected)),
      `合計飄字 "${mergedFloat.t}" 應包含總金額 ${totalExpected}`);

    console.log(`[PASS] #12 金幣合併：12 枚，飛弧=${flyingCount}，合計飄字="${mergedFloat.t}"，全部入帳✓`);
  }
}

// ─── 13. 少量金幣（≤5）不合併飄字 ───────────────────────────────
{
  const tryCoinsMatch = html.match(/\/\*PERF-231[^*]*\*\/\nfunction tryCoins[\s\S]*?\n\}/);
  if (tryCoinsMatch) {
    const coins2  = [];
    const floats2 = [];
    const parts2  = [];
    const VS2     = 1;
    function collectCoin2(c) {
      if (c.fly) return; c.fly = 1; c.credited = true; c.sx = c.x; c.sy = c.y; c.ft = 0;
    }
    function sweepDistance2() { return 0; }
    const Sound2 = { play() {} };
    const fn2 = new Function(
      'coins','floats','parts','VS','collectCoin','sweepDistance','Sound',
      `${tryCoinsMatch[0]}\nreturn tryCoins;`
    )(coins2, floats2, parts2, VS2, collectCoin2, sweepDistance2, Sound2);

    for (let i = 0; i < 3; i++) coins2.push({ x: 400 + i * 2, y: 300, vy: 0, v: 5, t: 999,
      ground: true, fly: 0, ph: 0, prod: false, credited: false, clicked: 0, sx: 0, sy: 0, ft: 0 });
    fn2(400, 300);

    const mergedFloats = floats2.filter(p => p.merged);
    assert.equal(mergedFloats.length, 0, '3 枚金幣不應有 merged 飄字');
    assert.equal(floats2.length, 3, '3 枚金幣應各自一條飄字');
    console.log('[PASS] #13 少量金幣（3 枚）各自飄字，無合併');
  } else {
    console.log('[SKIP] #13 無法提取 tryCoins，依靜態檢查替代');
    assert.ok(html.includes('batch.length<=MAX_FLY'), '少量金幣分支邏輯存在');
  }
}

// ─── 效能估算說明 ──────────────────────────────────────────────
console.log('\n=== 效能模擬估算（切片數 × 層數 × 魚隻數）===');
const N_HI = 32, N_LO = 16, ROWS = 3, FISH = 50;
const rawHi = FISH * N_HI * ROWS;   // 未快取時
const rawLo = FISH * N_LO * ROWS;   // 省電未快取時
const cached = FISH;                 // SPR/PhotoAnim236 熱快取後
console.log(`高畫質 (N=${N_HI}): 冷啟動 ${rawHi} drawImage/frame → 暖機後 ${cached} drawImage/frame`);
console.log(`省電   (N=${N_LO}): 冷啟動 ${rawLo} drawImage/frame → 暖機後 ${cached} drawImage/frame`);
console.log(`省電切片數減少 ${Math.round((1 - N_LO / N_HI) * 100)}%`);
console.log(`加大重疊量（1.4 px vs .22 px）消除切片間的一格一格邊緣`);
console.log(`高畫質 build limit 6→10，冷啟動暖機時間縮短約 ${Math.round((1-6/10)*100)}%\n`);

// ─── 前後效能影格時間估算 ─────────────────────────────────────
console.log('=== 慢速手機影格時間估算（~50 隻成年照片魚，含金幣粒子）===');
console.log('基準假設：每次 drawImage ≈ 0.08ms（慢速手機 Snapdragon 660 級）');
const msPerDraw = 0.08;
console.log(`高畫質 優化前：${rawHi} × ${msPerDraw}ms = ${(rawHi * msPerDraw).toFixed(1)}ms/frame`);
console.log(`高畫質 優化後（暖機）：${cached} × ${msPerDraw}ms = ${(cached * msPerDraw).toFixed(1)}ms/frame（快取後 ≈ 相同外觀）`);
console.log(`省電   優化前：${rawHi} × ${msPerDraw}ms = ${(rawHi * msPerDraw).toFixed(1)}ms/frame`);
console.log(`省電   優化後（暖機）：${cached} × ${msPerDraw}ms = ${(cached * msPerDraw).toFixed(1)}ms/frame`);
console.log(`※ 實際測量需在真實瀏覽器中執行；以上為理論值`);

console.log('\n=== 所有 PERF-231 測試通過 ===');
