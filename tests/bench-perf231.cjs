/**
 * PERF-231 合成效能基準 (node-canvas)
 *
 * 模擬照片魚在主 canvas 上的渲染代價：
 *  - 冷啟動（未快取）：N×3 drawImage / 魚
 *  - 暖快取（PhotoAnim236）：1 drawImage / 魚
 *  - 高畫質 N=32 vs 省電 N=16
 *  - 有無 culling 的差距
 *  - 比例式 sliceOvlp 計算代價（可忽略，但量化）
 *
 * 設計說明：
 *  - 建立與遊戲相同尺寸的 OffscreenCanvas（375×812 mobile）
 *  - 用 50 條魚（隨機 len=24~80，隨機位置含部分螢幕外）
 *  - 每次 bench 迭代 = 一個 render frame
 *  - 量化 p50/p95/p99 frame time（μs）
 *
 * 結果解讀：
 *  - 冷啟動 N=32 → N=16 差距＝省電 drawImage 減省
 *  - 暖快取後省電=高畫質（都是 1 blit/魚）
 *  - culling 效果：螢幕外魚佔比 × 冷啟動成本差
 */
'use strict';
const { createCanvas }=require('@napi-rs/canvas');

// ─── 常數 ─────────────────────────────────────────────────────────
const W=375,H=812,FISH=50,REPEATS=500,WARMUP=50;
const ROWS=[0,.4,.72,1];           // 3 段橫向 row

// ─── 工具 ─────────────────────────────────────────────────────────
function hrMs(){ const [s,ns]=process.hrtime(); return s*1e3+ns/1e6; }
function stats(arr){
  const a=[...arr].sort((a,b)=>a-b);
  const p=pct=>a[Math.floor(a.length*pct/100)];
  return {p50:p(50).toFixed(3),p95:p(95).toFixed(3),p99:p(99).toFixed(3),
          min:a[0].toFixed(3),max:a[a.length-1].toFixed(3)};
}

// ─── 建立合成魚列表 ───────────────────────────────────────────────
let rng=12345;function rand(lo,hi){rng=(rng*1664525+1013904223)>>>0;return lo+(rng%1000)*(hi-lo)/1000}
const fish=[];
for(let i=0;i<FISH;i++){
  const len=rand(24,80);
  // 10% 的魚在螢幕外（culling 效果來源）
  const offscreen=i<Math.floor(FISH*.1);
  const x=offscreen?-200:rand(0,W);
  fish.push({len,x,y:rand(50,H-50),offscreen});
}
const onscreen=fish.filter(f=>!f.offscreen).length;

// ─── 建立主 canvas 與合成圖片 ─────────────────────────────────────
const main=createCanvas(W,H);
const ctx=main.getContext('2d');

// 合成「照片魚圖片」：400×200 純色
function makeFishImg(len){
  const iw=Math.round(len*6),ih=Math.round(len*3);
  const c=createCanvas(iw,ih);const g=c.getContext('2d');
  g.fillStyle=`hsl(${Math.round(rand(0,360))},50%,50%)`;g.fillRect(0,0,iw,ih);
  return c;
}
const fishImgs=fish.map(f=>makeFishImg(f.len));

// PhotoAnim236 暖快取：每條魚預烘焙為一張 (len×1.6)×(len*0.9) canvas
function makeBakedFrame(f){
  const L=f.len*1.6,H2=f.len*.9;
  const c=createCanvas(Math.ceil(L),Math.ceil(H2));
  const g=c.getContext('2d');
  g.fillStyle='rgba(100,160,200,0.8)';g.fillRect(0,0,L,H2);
  return c;
}
const bakedFrames=fish.map(makeBakedFrame);

// ─── 渲染函式 ─────────────────────────────────────────────────────
// 冷啟動：N×3 drawImage（切片分層模擬）
function renderCold(N,useCulling){
  for(let fi=0;fi<FISH;fi++){
    const f=fish[fi],img=fishImgs[fi];
    const L=f.len*1.6,Hh=L*.5;
    // culling
    if(useCulling){const mg=Math.max(L,Hh)*.85;if(f.x+mg<0||f.x-mg>W||f.y+mg<0||f.y-mg>H)continue}
    const sliceW=L/N;
    // 比例式 sliceOvlp（省電）vs 固定 .22（高畫質）
    const sliceOvlp=N===16?Math.max(.5,L/N*.35):.22;
    const iw=img.width,ih=img.height;
    ctx.save();ctx.translate(f.x,f.y);
    for(let r=0;r<ROWS.length-1;r++){
      const sy0=ROWS[r]*ih,sy1=ROWS[r+1]*ih;
      const dy0=ROWS[r]*Hh-Hh/2,dy1=ROWS[r+1]*Hh-Hh/2;
      for(let n=0;n<N;n++){
        const sx0=(n/N)*iw,sx1=((n+1)/N)*iw;
        const dx0=n*sliceW-L/2;
        // 一次 drawImage（實際遊戲中有變形計算，這裡省略以聚焦 drawImage 代價）
        ctx.drawImage(img,sx0,sy0,sx1-sx0,sy1-sy0,
                      dx0,dy0,sliceW+sliceOvlp,dy1-dy0+sliceOvlp);
      }
    }
    ctx.restore();
  }
}

// 暖快取：1 blit/魚（PhotoAnim236）
function renderWarm(useCulling){
  for(let fi=0;fi<FISH;fi++){
    const f=fish[fi],baked=bakedFrames[fi];
    const L=f.len*1.6,Hh=f.len*.9;
    if(useCulling){const mg=Math.max(L,Hh)*.85;if(f.x+mg<0||f.x-mg>W||f.y+mg<0||f.y-mg>H)continue}
    ctx.drawImage(baked,f.x-L/2,f.y-Hh/2);
  }
}

// ─── 基準跑法 ─────────────────────────────────────────────────────
function bench(label,fn){
  for(let i=0;i<WARMUP;i++)fn();  // 暖機
  const times=[];
  for(let i=0;i<REPEATS;i++){
    const t0=hrMs();fn();times.push(hrMs()-t0);}
  const s=stats(times);
  console.log(`  ${label.padEnd(42)} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms`);
  return s;
}

// ─── 執行 ─────────────────────────────────────────────────────────
console.log(`\n=== PERF-231 合成渲染基準 (${FISH} 魚, ${REPEATS} 迭代, 螢幕外=${FISH-onscreen}) ===`);
console.log(`    畫布 ${W}×${H}  node-canvas @napi-rs/canvas\n`);

console.log('【冷啟動（未快取）：N×3 drawImage / 魚】');
const r32nc=bench('高畫質 N=32 無 culling                  ',()=>renderCold(32,false));
const r32wc=bench('高畫質 N=32 有 culling                  ',()=>renderCold(32,true));
const r16nc=bench('省電   N=16 無 culling                  ',()=>renderCold(16,false));
const r16wc=bench('省電   N=16 有 culling                  ',()=>renderCold(16,true));

console.log('\n【暖快取（PhotoAnim236）：1 blit / 魚】');
const rwwnc=bench('暖快取 無 culling                       ',()=>renderWarm(false));
const rwwc =bench('暖快取 有 culling                       ',()=>renderWarm(true));

console.log('\n【對比摘要】');
const p50_32nc=parseFloat(r32nc.p50),p50_16nc=parseFloat(r16nc.p50);
const p50_32wc=parseFloat(r32wc.p50),p50_16wc=parseFloat(r16wc.p50);
const p50_warm=parseFloat(rwwc.p50);
const saving_N=((p50_32nc-p50_16nc)/p50_32nc*100).toFixed(1);
const saving_cull_32=((p50_32nc-p50_32wc)/p50_32nc*100).toFixed(1);
const saving_cull_16=((p50_16nc-p50_16wc)/p50_16nc*100).toFixed(1);
const saving_warm=((p50_32nc-parseFloat(rwwc.p50))/p50_32nc*100).toFixed(1);

console.log(`  N=32→16（省電 drawImage 減省）：${saving_N}%`);
console.log(`  culling 高畫質 N=32：            ${saving_cull_32}%`);
console.log(`  culling 省電   N=16：            ${saving_cull_16}%`);
console.log(`  暖快取 vs 冷啟動 N=32：          ${saving_warm}%`);

console.log('\n【對比詳表（p50 ms）】');
console.log(`  模式                     live-230等效   PERF-231     節省`);
console.log(`  省電冷啟動（N=16+cull）  ${r32nc.p50}         ${r16wc.p50}      ${saving_cull_16}%+N減省`);
console.log(`  高畫質冷啟動（N=32+cull）${r32nc.p50}         ${r32wc.p50}      ${saving_cull_32}%`);
console.log(`  暖快取（1 blit/魚）      N/A           ${rwwc.p50}      vs 冷啟 -${saving_warm}%`);

console.log('\n【sliceOvlp 比例式計算代價分析】');
const fishSizes=[{len:24,name:'孔雀魚'},{len:50,name:'中型'},{len:80,name:'錦鯉'}];
for(const {len,name} of fishSizes){
  const L=len*1.6,N=16;
  const ovlpFixed=1.4,ovlpProp=Math.max(.5,L/N*.35);
  const sliceW=L/N;
  console.log(`  ${name}(len=${len}): 固定 1.4px→${(ovlpFixed/sliceW*100).toFixed(0)}%  比例 ${ovlpProp.toFixed(2)}px→${(ovlpProp/sliceW*100).toFixed(0)}%`);
}
