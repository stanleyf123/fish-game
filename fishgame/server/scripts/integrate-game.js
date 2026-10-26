#!/usr/bin/env node
// 把 integration/cloud-module.js 注入遊戲 index.html 的 // ==== CLOUD-BEGIN ==== … // ==== CLOUD-END ==== 區塊。
// 用法：node scripts/integrate-game.js [index.html]
'use strict';
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.join(__dirname, '../../index.html');
const mod = fs.readFileSync(path.join(__dirname, '../integration/cloud-module.js'), 'utf8').trim();
let html = fs.readFileSync(file, 'utf8');
const re = /\/\/ ==== CLOUD-BEGIN ====\n[\s\S]*?\/\/ ==== CLOUD-END ====\n/;
if (!re.test(html)) { console.error('找不到 CLOUD-BEGIN/END 標記'); process.exit(1); }
html = html.replace(re, () => '// ==== CLOUD-BEGIN ====\n' + mod + '\n// ==== CLOUD-END ====\n');
fs.writeFileSync(file, html);
console.log('已注入雲端模組 → ' + file);
