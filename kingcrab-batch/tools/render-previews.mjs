#!/usr/bin/env node
// Renders the PR preview images with headless Chrome + ffmpeg. Local files / localhost only (no live server).
//   node kingcrab-batch/tools/render-previews.mjs [outDir]
// Output: king-crabs-sheet.png, king-crabs-walk-cycle.png, king-crabs-in-tank.png, owner-view-akin-to-phone.png,
//         shop-new-arrivals.png, encyclopedia.png, before-after-walk.png, before-after-walk.gif
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openPage} from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'previews'));
fs.mkdirSync(out, {recursive: true});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-prev-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const walkSrc = pathToFileURL(path.join(root, 'src/kingcrab-walk.js')).href;
const IDS = [
  ['o_king_crab', '赤金帝王蟹', 'Paralithodes camtschaticus', '深紅殼面、金色棘刺與關節'],
  ['o_blue_king_crab', '藍帝王蟹', 'Paralithodes platypus', '霧藍紫灰、圓潤寬背甲、細毛長腿'],
  ['o_golden_king_crab', '黃金帝王蟹', 'Lithodes aequispinus', '芥黃金色、長尖棘、纖細帶刺步足'],
  ['o_chilean_king_crab', '智利帝王蟹', 'Lithodes santolla', '鮮活橘色、大螯、斑駁背甲'],
];

async function pageShot(html, file, w, h) {
  const f = path.join(tmp, path.basename(file) + '.html');
  fs.writeFileSync(f, html);
  const page = await openPage({width: w, height: h});
  try { await page.goto(pathToFileURL(f).href, 500); await page.screenshot(path.join(out, file)); } finally { await page.close(); }
}

const BG = 'background:radial-gradient(120% 90% at 50% 0%,#2a86ad 0%,#16597f 55%,#0d3552 100%)';
const FONT = "font-family:'Noto Sans CJK TC','Noto Sans TC','PingFang TC',sans-serif";

async function sheet() {
  const cells = IDS.map(([id, name, sci, note], i) => `
   <div class="cell"><canvas id="c${i}" width="720" height="440"></canvas><div class="lab"><b>${name}</b><span>${sci}</span><em>${note}</em><code>${id}</code></div></div>`).join('');
  await pageShot(`<!doctype html><meta charset=utf8><style>
   body{margin:0;${BG};${FONT};color:#eaf6fb;width:1500px;height:1030px}
   h1{margin:0;padding:18px 28px 0;font-size:26px}
   h1 small{font-weight:400;opacity:.7;font-size:15px;margin-left:12px}
   .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px 28px}
   .cell{position:relative;border-radius:16px;overflow:hidden;background:linear-gradient(#0000 60%,#d8c08f 60%,#b79a62 100%),rgba(5,40,66,.25);border:1px solid #ffffff22}
   canvas{display:block}.lab{position:absolute;left:16px;top:12px;display:flex;flex-direction:column;gap:2px;text-shadow:0 1px 3px #0008}
   .lab b{font-size:24px}.lab span{font-style:italic;opacity:.85;font-size:14px}.lab em{font-style:normal;font-size:13px;opacity:.8}.lab code{font-size:11px;opacity:.55}
  </style><h1>帝王蟹 4 款<small>3/4 側面步行姿勢・同一套 KingCrabWalk 步態</small></h1><div class=grid>${cells}</div>
  <script src="${walkSrc}"></script><script>
  const ids=${JSON.stringify(IDS.map(x => x[0]))};
  ids.forEach((id,i)=>{const c=document.getElementById('c'+i).getContext('2d');
   c.fillStyle='rgba(20,12,0,.28)';c.beginPath();c.ellipse(360,392,230,13,0,0,7);c.fill();
   c.save();c.translate(360,222);const k=5.7;c.scale(k,k);KingCrabWalk.draw(c,{_bGait:.12,_bAmp:1,phase:.8},{id,len:107.13,ht:60});c.restore()});
  </script>`, 'king-crabs-sheet.png', 1500, 1030);
}

async function walkCycle() {
  const N = 8;
  await pageShot(`<!doctype html><meta charset=utf8><style>
   body{margin:0;${BG};${FONT};color:#eaf6fb;width:1760px;height:760px}
   h1{margin:0;padding:14px 22px 0;font-size:22px}h1 small{font-weight:400;opacity:.7;font-size:14px;margin-left:10px}
   canvas{display:block;margin:6px 22px}
  </style><h1>步行週期（一個完整步態，8 格）<small>三足組交替：n1+f2+n3 ／ f1+n2+f3；支撐腳不滑步，擺動腳抬起；身體隨步伐微微起伏</small></h1>
  <canvas id=c width=1716 height=690></canvas><script src="${walkSrc}"></script><script>
  const c=document.getElementById('c').getContext('2d');const ids=${JSON.stringify(IDS)};
  ids.forEach(([id,name],r)=>{const y=r*172;c.fillStyle='rgba(255,255,255,.06)';c.fillRect(0,y,1716,168);
   c.fillStyle='#eaf6fb';c.font='bold 16px sans-serif';c.fillText(name,8,y+20);
   for(let j=0;j<${N};j++){const cx=118+j*206;c.fillStyle='rgba(216,192,143,.5)';c.fillRect(cx-96,y+148,192,3);
    c.save();c.translate(cx,y+148-30*1.75);c.scale(1.75,1.75);KingCrabWalk.draw(c,{_bGait:j/${N},_bAmp:1,phase:j},{id,len:107.13,ht:60});c.restore();
    if(r===0){c.fillStyle='#eaf6fb';c.font='12px sans-serif';c.fillText('gait '+(j/${N}).toFixed(3),cx-30,y+14)}}});
  </script>`, 'king-crabs-walk-cycle.png', 1760, 760);
}

const mimeOf = f => ({'.html': 'text/html; charset=utf-8', '.png': 'image/png'}[path.extname(f)] || 'application/octet-stream');
function serve(htmlFile, extra = {}) {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const file = u === '/' || u === '/index.html' ? htmlFile : extra[u];
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': mimeOf(file)}); fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({srv, url: `http://127.0.0.1:${srv.address().port}/`})));
}

const FISH = (id, px) => `{id:'${id}',sp:'${id}',name:'${id}',hue:A.SPECIES['${id}'].hue,size:1,growth:300,full:90,health:100,cd:0,coinT:999,seed:5,px:${px},py:.9,dir:1,stress:0,finDmg:0}`;
async function bootTank(url, fish, {width = 900, height = 560, scale = 1} = {}) {
  const page = await openPage({width, height, scale});
  await page.goto(url, 4500);
  await page.eval(`(()=>{const A=window.__aquarium,st=A.snapshot();st.fish=[${fish.map(([id, px]) => FISH(id, px)).join(',')}];A.loadState(st);return 1})()`);
  return page;
}

async function inTank(clientUrl) {
  const page = await bootTank(clientUrl, [['o_king_crab', .1], ['o_blue_king_crab', .32], ['o_golden_king_crab', .54], ['o_chilean_king_crab', .76]], {width: 1500, height: 640});
  try {
    await page.eval(`(()=>{const A=window.__aquarium;for(const f of A.state.fish){f.face=1;f._bHeading270=1;f._bYaw=1;f.tx=f.x+150;f.wT=99;f.rest=0}A.step(1.6);return 1})()`);
    await sleep(300);
    await page.screenshot(path.join(out, 'king-crabs-in-tank.png'), {x: 0, y: 250, width: 1500, height: 390});
  } finally { await page.close(); }
  const owner = await bootTank(clientUrl, [['o_king_crab', .72]], {width: 1024, height: 700});
  try {
    await owner.eval(`(()=>{const A=window.__aquarium,f=A.state.fish[0];f.tx=f.x-120;f.wT=99;f.rest=0;A.step(5.3);return 1})()`);
    await sleep(300);
    await owner.screenshot(path.join(out, 'owner-view-akin-to-phone.png'), {x: 0, y: 390, width: 1024, height: 310});
  } finally { await owner.close(); }
}

async function shopAndBook(clientUrl) {
  const page = await openPage({width: 1100, height: 1400});
  try {
    await page.goto(clientUrl, 4500);
    await page.eval(`[...document.querySelectorAll('.sbtn')].find(x=>/商店/.test(x.innerText)).click()`);
    await sleep(500);
    await page.eval(`document.querySelector('[data-sv2="src:new"]').click()`);
    await sleep(900);
    const clip = JSON.parse(await page.eval(`(()=>{const items=[...document.querySelectorAll('.item')].filter(i=>/帝王蟹/.test(i.innerText));items[0].scrollIntoView({block:'start'});window.scrollBy(0,-8);
      const hd=document.querySelector('.sv2-note h4');const a=items[0].getBoundingClientRect(),b=items[3].getBoundingClientRect();const par=items[0].closest('#panel,.panel,#sv2,.modal,body');
      return JSON.stringify({x:Math.max(0,a.left-12),y:Math.max(0,a.top-12),width:Math.min(1100,a.width+24),height:b.bottom-a.top+24})})()`));
    await sleep(300);
    await page.screenshot(path.join(out, 'shop-new-arrivals.png'), clip);
  } finally { await page.close(); }
  const book = await openPage({width: 1100, height: 1000});
  try {
    await book.goto(clientUrl, 4500);
    await book.eval(`(()=>{const A=window.__aquarium,st=A.snapshot();st.found=st.found||{};for(const k of ['o_king_crab','o_blue_king_crab','o_golden_king_crab','o_chilean_king_crab'])st.found[k]=1;A.loadState(st);1})()`);
    await book.eval(`[...document.querySelectorAll('.sbtn')].find(x=>/圖鑑/.test(x.innerText)).click()`);
    await sleep(500);
    await book.eval(`[...document.querySelectorAll('button')].find(x=>/魚種圖鑑/.test(x.innerText)).click()`);
    await sleep(600);
    await book.eval(`(()=>{const i=document.querySelector('input[placeholder*="輸入暱稱"]');i.value='帝王蟹';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(900);
    await book.eval(`(()=>{const c=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent==='赤金帝王蟹');c&&c.scrollIntoView({block:'center'})})()`);
    await sleep(300);
    await book.screenshot(path.join(out, 'encyclopedia.png'));
  } finally { await book.close(); }
}

// Time-lapse of one crab walking right, then reversing. Same scenario in the live 4.2.218 build and the patched build.
async function captureWalk(url, label, dir, {frames = 30, dt = 0.4} = {}) {
  fs.mkdirSync(dir, {recursive: true});
  const page = await bootTank(url, [['o_king_crab', .26]], {width: 1024, height: 700});
  try {
    await page.eval(`(()=>{const A=window.__aquarium,f=A.state.fish[0];f.tx=A.state.fish[0].x+380;f.wT=999;f.rest=0;
      const d=document.createElement('div');d.textContent=${JSON.stringify(label)};d.style.cssText='position:fixed;left:70px;top:440px;z-index:99999;font:700 15px/1.2 sans-serif;color:#fff;background:#0b2a40cc;padding:5px 10px;border-radius:8px;border:1px solid #ffffff44';document.body.appendChild(d);
      const e=document.createElement('style');e.textContent='.sbtn,#mobileMenuToggle166,#acctBtn,#wsChip,#mailBtn,#muteBtn,#zenBtn,#nlBtn,#hintPill{visibility:hidden!important}';document.head.appendChild(e);return 1})()`);
    const files = [];
    for (let i = 0; i < frames; i++) {
      if (i === 11) await page.eval(`(()=>{const f=window.__aquarium.state.fish[0];f.tx=f.x-340;f.wT=999;f.rest=0;return 1})()`);
      await page.eval(`window.__aquarium.step(${dt})`);
      const info = JSON.parse(await page.eval(`(()=>{const f=window.__aquarium.state.fish[0];return JSON.stringify({x:f.x,face:f.face,vx:f.vx})})()`));
      const file = path.join(dir, `f${String(i).padStart(3, '0')}.png`);
      await page.screenshot(file, {x: 0, y: 430, width: 1024, height: 270});
      files.push({file, ...info});
    }
    return files;
  } finally { await page.close(); }
}

async function beforeAfter(newUrl) {
  const oldHtml = path.join(root, 'baseline/live-index-4.2.218.html');
  const oldPng = path.join(root, 'baseline/art/ocean275/kingcrab275-v2.png');
  const a = await serve(oldHtml, {'/art/ocean275/kingcrab275-v2.png': oldPng});
  const b = await serve(path.join(root, 'client/index.html'));
  let before, after;
  try {
    before = await captureWalk(a.url, 'BEFORE 4.2.218 (live): 靜態貼圖平移，不轉身', path.join(tmp, 'before'));
    after = await captureWalk(b.url, 'AFTER 4.2.219: 長腿步行，轉身朝行進方向', path.join(tmp, 'after'));
  } finally { a.srv.close(); b.srv.close(); }
  const pick = [0, 5, 10, 13, 18, 25];
  const cell = f => `<figure><img src="${pathToFileURL(f.file).href}"><figcaption>x=${f.x.toFixed(0)} · face=${f.face > 0 ? '→' : '←'}</figcaption></figure>`;
  await pageShot(`<!doctype html><meta charset=utf8><style>body{margin:0;background:#0b2233;${FONT};color:#eaf6fb;width:1700px}
   h1{margin:0;padding:14px 20px 4px;font-size:22px}h1 small{font-weight:400;font-size:14px;opacity:.7;margin-left:8px}
   .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;padding:6px 20px 14px}h2{margin:6px 0 0;font-size:16px}
   figure{margin:0;position:relative}img{width:100%;display:block;border-radius:8px}figcaption{position:absolute;right:8px;bottom:6px;font-size:13px;background:#000a;padding:1px 7px;border-radius:6px}
  </style><h1>步行前後對照<small>同一場景：往右走，再折返往左。每格約 0.4 遊戲秒（縮時）；左＝live 4.2.218，右＝4.2.219</small></h1>
  <div class=grid><h2>BEFORE：正面短腿貼圖，倒退時仍面向右、被拖著滑</h2><h2>AFTER：3/4 側面長腿，交替步行，轉身後面向左</h2>
  ${pick.map(i => cell(before[i]) + cell(after[i])).join('')}</div>`, 'before-after-walk.png', 1700, 1000);

  // animated comparison (stacked), 12 fps
  const seq = (dir, name) => path.join(tmp, name + '-%03d.png');
  for (const [fr, name] of [[before, 'b'], [after, 'a']]) fr.forEach((f, i) => fs.copyFileSync(f.file, path.join(tmp, `${name}-${String(i).padStart(3, '0')}.png`)));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '6', '-i', seq(0, 'b'), '-framerate', '6', '-i', seq(0, 'a'),
    '-filter_complex', '[0][1]vstack=inputs=2,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', path.join(out, 'before-after-walk.gif')]);
  fs.writeFileSync(path.join(out, 'before-after-walk.json'), JSON.stringify({before: before.map(({x, face}) => ({x: +x.toFixed(1), face})), after: after.map(({x, face}) => ({x: +x.toFixed(1), face}))}));
}

const {srv, url} = await serve(path.join(root, 'client/index.html'));
try {
  await sheet();
  await walkCycle();
  await inTank(url);
  await shopAndBook(url);
  await beforeAfter(url);
} finally { srv.close(); fs.rmSync(tmp, {recursive: true, force: true}); }
console.log('previews written to', out);
