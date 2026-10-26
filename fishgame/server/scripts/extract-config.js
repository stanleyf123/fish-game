#!/usr/bin/env node
// 從遊戲 index.html 讀出內建的 GAME_CONFIG（遊戲本身的設定結構），補上伺服器專用的 antiCheat 區塊，
// 輸出成 seed/default-config.json，作為後台設定的第 1 版。
// 用法：node scripts/extract-config.js [path/to/index.html] [out.json]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_ANTICHEAT = {
  mode: 'reject',            // reject：拒絕可疑存檔；flag：接受但記錄；off：不檢查金幣增量
  baseAllowance: 500,        // 每次存檔額外容許的金幣增量（手動點擊、出售誤差等）
  rateSlack: 3,              // 理論最高產速的倍數容忍
  minSaveIntervalSec: 2,     // 兩次存檔最短間隔
  maxClockSkewSec: 300,      // 客戶端時間最多可超前伺服器幾秒
  maxFishSlack: 0,           // 魚數可超過容量幾條
  firstUploadMaxCoins: 200000, // 第一次上傳（例如從 localStorage 搬遷）允許的最高金幣
};

function extract(html) {
  const m = html.match(/const GAME_CONFIG=(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('無法在 index.html 找到 const GAME_CONFIG={...};');
  const cfg = vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 1000 });
  const out = JSON.parse(JSON.stringify(cfg)); // 確保為純 JSON（例如 8*3600 已計算）
  for (const sp of Object.values(out.species)) if (sp.disabled == null) sp.disabled = false;
  out.antiCheat = { ...DEFAULT_ANTICHEAT };
  return out;
}

module.exports = { extract, DEFAULT_ANTICHEAT };

if (require.main === module) {
  const src = process.argv[2] || path.join(__dirname, '../../index.html');
  const out = process.argv[3] || path.join(__dirname, '../seed/default-config.json');
  const cfg = extract(fs.readFileSync(src, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`已從 ${src} 擷取 GAME_CONFIG：${Object.keys(cfg.species).length} 種魚、${Object.keys(cfg.decorations).length} 種裝飾 → ${out}`);
}
