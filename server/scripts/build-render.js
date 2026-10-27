#!/usr/bin/env node
// 從遊戲 index.html 直接擷取魚隻繪圖程式碼（rng / colors / bodyPath / drawShrimp / drawFish / pattern
// 以及 applyConfig 內的魚種參數展開），產生 public/fishrender.js。
// 後台的魚種預覽因此與遊戲畫面「同一份程式碼」，遊戲改了畫法只要重跑：npm run build:render
// 用法：node scripts/build-render.js [index.html] [out.js]   加 --check 只檢查是否需要重新產生
'use strict';
const fs = require('fs');
const path = require('path');

const FUNCS = ['rng', 'colors', 'bodyPath', 'drawShrimp', 'drawFish', 'pattern'];

function grabFunction(src, name) {
  const re = new RegExp('(^|\\n)function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('找不到 function ' + name);
  const start = m.index + m[1].length;
  let i = src.indexOf('){', start) + 1, depth = 0, q = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('function ' + name + ' 大括號不對稱');
}

// 戰鬥重播可選的療癒畫風（opt.gentle / opt.rim）。只加在產生結果上，
// 不改遊戲 index 的 drawFish，魚缸仍用原本嘴型。錨點對不上就失敗，避免靜默漏補。
function applyCozyBattle(code) {
  const reps = [
    ['var T = 0, SPECIES = {}, RX = null;', 'var T = 0, SPECIES = {}, RX = null, DRAW_GENTLE = false;'],
    ['function drawFish(c,f,opt={}){\n', 'function drawFish(c,f,opt={}){\n  DRAW_GENTLE=!!opt.gentle;\n'],
    [
      "  // 嘴（肉食魚：下顎＋牙齒）\n  if(!(RX&&RX.mouth(c,f,s,L,Hh,col))&&RX&&RX.teeth&&RX.menaceOf(s)===2)RX.teeth(c,f,s,L,Hh);else if(!(RX&&RX.mouth(c,f,s,L,Hh,col))){c.strokeStyle='rgba(0,0,0,.35)';c.lineWidth=1;c.beginPath();const mo=(f.chomp||0)*2;c.moveTo(L*.47,Hh*.04-mo);c.lineTo(L*.4,Hh*.08);c.lineTo(L*.47,Hh*.1+mo);c.stroke()}",
      "  // 嘴：戰鬥／療癒繪本用微笑（不露牙）；其餘維持原本嘴型\n  if(opt.gentle){c.strokeStyle='rgba(90,50,45,.55)';c.lineWidth=1.15;c.lineCap='round';c.beginPath();const mo=(f.chomp||0)*1.4;c.moveTo(L*.40,Hh*.07);c.quadraticCurveTo(L*.47,Hh*.16+mo,L*.52,Hh*.055);c.stroke()}\n  else if(!(RX&&RX.mouth(c,f,s,L,Hh,col))&&RX&&RX.teeth&&RX.menaceOf(s)===2)RX.teeth(c,f,s,L,Hh);else if(!(RX&&RX.mouth(c,f,s,L,Hh,col))){c.strokeStyle='rgba(0,0,0,.35)';c.lineWidth=1;c.beginPath();const mo=(f.chomp||0)*2;c.moveTo(L*.47,Hh*.04-mo);c.lineTo(L*.4,Hh*.08);c.lineTo(L*.47,Hh*.1+mo);c.stroke()}",
    ],
    [
      "  if(f.sick){bodyPath(c,s,L,Hh,0);c.fillStyle='rgba(120,200,90,.3)';c.fill()}\n}",
      "  if(f.sick){bodyPath(c,s,L,Hh,0);c.fillStyle='rgba(120,200,90,.3)';c.fill()}\n  if(opt.rim&&!sil){c.save();bodyPath(c,s,L,Hh,f.puff||0);c.clip();const rg=c.createLinearGradient(0,-Hh,0,Hh*.2);rg.addColorStop(0,'rgba(207,246,255,.55)');rg.addColorStop(1,'rgba(207,246,255,0)');c.globalCompositeOperation='source-atop';c.fillStyle=rg;c.fillRect(-L,-Hh*1.3,L*2,Hh*1.6);const warm=c.createLinearGradient(0,Hh*.2,0,Hh);warm.addColorStop(0,'rgba(255,217,168,0)');warm.addColorStop(1,'rgba(255,217,168,.30)');c.fillStyle=warm;c.fillRect(-L,0,L*2,Hh);c.restore()}\n}",
    ],
    [
      'function realEye(c, f, s, ex, ey, er, col) { const m = menaceOf(s), t = T();',
      'function realEye(c, f, s, ex, ey, er, col) { const m = DRAW_GENTLE ? 0 : menaceOf(s), t = T();',
    ],
  ];
  for (const [from, to] of reps) {
    if (!code.includes(from)) throw new Error('療癒戰鬥補丁對不上錨點：' + from.slice(0, 48));
    code = code.replace(from, to);
  }
  return code;
}

function build(html, srcName) {
  const parts = FUNCS.map((n) => grabFunction(html, n));
  const m = /function flatSpecies\(id,sp\)\{const L=sp\.look\|\|\{\};return (Object\.assign\(\{body:[\s\S]*?\}\))\}\n/.exec(html) || /SPECIES\[id\]=(Object\.assign\(\{body:[\s\S]*?\}\))\}\n/.exec(html);
  // v4 寫實畫風的輔助宣告（脊椎彎曲 BEND/bendY、景深 zOf）
  for (const re of [/\nlet BEND=null;[^\n]*/, /\nconst zOf=[^\n]*/]) { const x = re.exec(html); if (x) parts.unshift(x[0].trim()); }
  if (!m) throw new Error('找不到 applyConfig 內的 SPECIES[id]=Object.assign(...)');
  // 外觀擴充模組（<script id="mod-render-ext">，遊戲的 drawFish 會呼叫 RX.view / RX.pattern2 …）
  const mx = /<script id="mod-render-ext">([\s\S]*?)<\/script>/.exec(html);
  const ext = mx ? mx[1] : '';
  const hash = require('crypto').createHash('sha256').update(parts.join('\n') + m[1] + ext).digest('hex').slice(0, 12);
  const raw = `/*! 悠游水族箱 魚隻繪圖 — 由 scripts/build-render.js 從遊戲 ${srcName} 自動擷取產生，請勿手動修改（source hash ${hash}）
 * 與遊戲共用同一份 drawFish / drawShrimp / pattern 程式碼，後台的魚種預覽＝遊戲內畫面。
 * 用法：
 *   const sp = FishRender.resolve(config.species.goldfish, 'goldfish'); // 轉成執行期參數（與遊戲 applyConfig 相同）
 *   FishRender.drawPreview(canvas, sp, { t: seconds, hue, sil });        // 畫在 canvas 中央
 *   FishRender.drawFish(ctx, sp, fish, t, { sil })                       // 低階：在目前座標系畫一條魚
 */
(function (root) {
  'use strict';
  var T = 0, SPECIES = {}, RX = null;
  // ---- 以下自遊戲原始碼擷取 ----
${parts.join('\n')}
${ext ? `  // ---- 外觀擴充（render-ext）----
  var __rx = {};
  (function (window, globalThis, module) {
${ext}
  })(__rx, __rx, undefined);
  RX = __rx.createRenderExt ? __rx.createRenderExt({ rng: rng, getT: function () { return T; }, pattern: function () { return pattern.apply(null, arguments); } }) : null;` : ''}
  // ---- 擷取結束 ----
  function resolve(sp, id) { sp = sp || {}; id = id || 'preview'; var L = sp.look || {}; return ${m[1]}; }
  var S = { fish: [] };
  function drawFishAt(c, s, f, t, opt) {
    T = t || 0; SPECIES = { __p: s };
    var ff = {}; for (var k in f) ff[k] = f[k]; ff.sp = '__p';
    drawFish(c, ff, opt || {});
  }
  // 在 canvas 中央畫預覽；縮放方式與遊戲 preview() 相同。opt: { t, hue, sil, seed, puff, bg, stage(0 幼魚/1 亞成/2 成年，預設 2) }
  function drawPreview(canvas, s, opt) {
    opt = opt || {};
    var c = canvas.getContext('2d'), W = canvas.width, H = canvas.height, t = opt.t || 0;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    if (opt.bg !== false) { var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3fb0dc'); g.addColorStop(1, '#0f4f75'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    var k = Math.min(W / 160, H / 100);
    var sc = Math.min(120 / (s.len * (s.tail === 'flow' ? 1.9 : 1.5)), 70 / (s.ht * (s.fins === 'tall' || s.fins === 'flowing' ? 2.5 : 1.3))) * k;
    var f = { hue: opt.hue != null ? opt.hue : s.hue, phase: 1.2 + t * 5, seed: opt.seed || 7, full: 100, puff: opt.puff || 0, chomp: 0, stg: opt.stage != null ? opt.stage : 2 };
    c.save(); c.translate(W / 2 + (s.tail === 'flow' ? 12 : 6) * sc / 2, H / 2 + Math.sin(t * 1.4) * 3 * k); c.scale(sc, sc);
    drawFishAt(c, s, f, t, { sil: opt.sil }); c.restore();
  }
  var api = { resolve: resolve, drawFish: drawFishAt, drawPreview: drawPreview, sourceHash: '${hash}' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FishRender = api;
})(typeof window !== 'undefined' ? window : this);
`;
  return applyCozyBattle(raw);
}
module.exports = { build };

if (require.main === module) {
  const args = process.argv.slice(2).filter((a) => a !== '--check');
  const src = args[0] || path.join(__dirname, '../../index.html');
  const out = args[1] || path.join(__dirname, '../public/fishrender.js');
  const code = build(fs.readFileSync(src, 'utf8'), path.basename(src));
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== code) { console.error('fishrender.js 與遊戲繪圖程式不同步，請執行 npm run build:render'); process.exit(1); }
    console.log('fishrender.js 與遊戲同步');
  } else { fs.writeFileSync(out, code); console.log('已產生 ' + out); }
}
