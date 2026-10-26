#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const base = fs.readFileSync('/home/ubuntu/.cursor/projects/workspace/uploads/client-index-117_9dda.html', 'utf8');
const patch = fs.readFileSync('/tmp/scaling-no-autoscape.html', 'utf8');
let html = base;

function mustReplace(from, to, label) {
  if (!html.includes(from)) {
    console.error('MISSING:', label);
    process.exit(1);
  }
  html = html.replace(from, to);
  console.log('OK:', label);
}

// Toolbar + scale UI CSS
mustReplace(
  `<style id="deco-toolbar-dock-v2">
/* Edit bar floats over the tank; canvas and #tankBg stay full size (no padding/height tricks). */
body.aq-edit #tank,body.aq-edit #tankBg{height:100%!important;width:100%!important}
body.aq-edit #aqBar #aqTarget,body.aq-edit #aqBar #aqManage,body.aq-edit #aqBar #aqZBack,body.aq-edit #aqBar #aqDone{pointer-events:auto!important}`,
  `<style id="deco-toolbar-dock-v2">
/* Edit bar floats over the tank; canvas and #tankBg stay full size (no padding/height tricks). */
body.aq-edit #tank,body.aq-edit #tankBg{height:100%!important;width:100%!important}
body.aq-edit #aqBar{pointer-events:none!important}
body.aq-edit #aqBar #aqTxt{pointer-events:none!important}
body.aq-edit #aqBar #aqTarget,body.aq-edit #aqBar #aqManage,body.aq-edit #aqBar #aqZBack,body.aq-edit #aqBar #aqAuto,body.aq-edit #aqBar #aqDone{pointer-events:auto!important}`,
  'toolbar pointer-events'
);

const scaleCss = patch.match(/<style id="deco-scale-ui-v1">[\s\S]*?<\/style>/);
if (!scaleCss) throw new Error('scale css missing');
mustReplace(
  `</style><style id="fs-infinite-scroll-v1">`,
  `</style>${scaleCss[0]}<style id="fs-infinite-scroll-v1">`,
  'scale css'
);

mustReplace(
  `<button id="aqAuto" type="button" data-auto-scape hidden>✨ 自動造景</button><button id="aqDone">完成</button></div>
    <div id="info"></div>`,
  `<button id="aqAuto" type="button" data-auto-scape hidden>✨ 自動造景</button><button id="aqDone">完成</button></div>
    <div id="aqScaleBar" aria-hidden="true"><button type="button" id="aqZoomOut" hidden>縮小</button><span data-aq-scale-pct hidden></span><button type="button" id="aqZoomIn" hidden>放大</button><button type="button" id="aqZoomReset" hidden>還原大小</button></div>
    <div id="info"></div>`,
  'aqScaleBar html'
);

// sanitize decoS block — copy from patch
const decoSBlock = patch.match(/\{const ds=s\.up\.decoS[\s\S]*?else delete s\.up\.decoS\}/);
const decoPosEnd = `else delete s.up.decoPos}`;
if (decoSBlock && !html.includes('s.up.decoS')) {
  mustReplace(decoPosEnd, decoPosEnd + decoSBlock[0], 'sanitize decoS');
}

// scene() uses scaled box
mustReplace(
  `const d=DECOS[k],b=DECO_BOX[d.draw]||DECO_BOX0,x=decoPx(k),y=sceneryY(k);return{k,name:d.n`,
  `const d=DECOS[k],b=decoScaleBox(k),x=decoPx(k),y=sceneryY(k);return{k,name:d.n`,
  'scene decoScaleBox'
);

mustReplace(
  `const items=keys.map(id=>({id,box:DECO_BOX[DECOS[id].draw]||DECO_BOX0,preferred:DECOS[id].x??.5,saved:S.up.decoPos?.[id]}));`,
  `const items=keys.map(id=>({id,box:decoScaleBox(id),preferred:DECOS[id].x??.5,saved:S.up.decoPos?.[id]}));`,
  'sceneryLayout box'
);

mustReplace(
  `const key=W+'|'+VS+'|'+lane+'|'+JSON.stringify(items);`,
  `const key=W+'|'+VS+'|'+lane+'|'+JSON.stringify(items)+'|'+JSON.stringify(S.up.decoS||0);`,
  'scenery cache decoS'
);

mustReplace(
  `const decoX=k=>{const p=S.up&&S.up.decoPos&&S.up.decoPos[k];return Number.isFinite(p)?p:((DECOS[k]&&DECOS[k].x)??.5)};
function decoPx(k,x01){const b=DECO_BOX[(DECOS[k]||{}).draw]||DECO_BOX0,sc=sceneryScale(),lo=-b[0]*sc+8,hi=(sceneryLayout().width||W)-b[1]*sc-8,x=x01==null?(sceneryLayout().positions[k]??W*decoX(k)):W*x01;return lo<hi?clamp(x,lo,hi):W/2}`,
  patch.match(/const decoX=k=>[\s\S]*?function decoPx\(k,x01\)\{[\s\S]*?return lo<hi\?clamp\(x,lo,hi\):W\/2\}/)[0],
  'deco scale helpers + decoPx'
);

// decoPixelHit
const pixelHit = patch.match(/function decoPixelHit\(k,px,py\)\{[\s\S]*?\n\}/);
mustReplace(
  /function decoPixelHit\(k,px,py\)\{[\s\S]*?\n\}/.exec(html)[0],
  pixelHit[0],
  'decoPixelHit'
);

mustReplace(
  `function hostFrame(h){const s=e3Spec(h);if(!s||!s.anchor)return null;const x=decoPx(h),y=sceneryY(h),ds=sceneryScale();return{s,ds,left:x-s.anchor.x*s.dw*ds,top:y-s.anchor.y*s.dh*ds,w:s.dw*ds,h:s.dh*ds}}`,
  `function hostFrame(h){const s=e3Spec(h);if(!s||!s.anchor)return null;const x=decoPx(h),y=sceneryY(h),ds=sceneryScale(),us=decoUserScale(h);return{s,ds,left:x-s.anchor.x*s.dw*ds*us,top:y-s.anchor.y*s.dh*ds*us,w:s.dw*ds*us,h:s.dh*ds*us}}`,
  'hostFrame'
);

mustReplace(
  `const fy=sceneryY(k),b=DECO_BOX[DECOS[k].draw]||DECO_BOX0,cx=decoPx(k),sc=sceneryScale();if(x>cx+b[0]*sc-10&&x<cx+b[1]*sc+10&&y>fy-b[2]*sc-10&&y<fy+14&&decoPixelHit(k,x,y))return k}return decoHitSlop(x,y);`,
  `const fy=sceneryY(k),b=decoScaleBox(k),cx=decoPx(k),sc=sceneryScale();if(x>cx+b[0]*sc-10&&x<cx+b[1]*sc+10&&y>fy-b[2]*sc-10&&y<fy+14&&decoPixelHit(k,x,y))return k}return decoHitSlop(x,y);`,
  'decoHit box'
);

const hitSlop = patch.match(/function decoHitSlop\(x,y\)\{[\s\S]*?return best\}/)[0];
mustReplace(/function decoHitSlop\(x,y\)\{[\s\S]*?return best\}/.exec(html)[0], hitSlop, 'decoHitSlop');

mustReplace(
  /\/\*V420A-DECO 升級買的大型造景[\s\S]*?return r\}/.exec(html)[0],
  patch.match(/\/\*V420A-DECO 升級買的大型造景[\s\S]*?return r\}/)[0],
  'decoSpans'
);

// aqBarTxt — merge aqAuto + scaling
const aqBarMerged = `function aqBarTxt(){$('#aqAuto').hidden=!aqEdit;/*V45-EDIT*/aqEditCls();$('#aqManage').hidden=!aqEditSession;$('#aqTarget').hidden=!aqEdit;{const zb=$('#aqZBack');if(zb)zb.hidden=!(aqEdit&&aqDeco&&DECOS[aqDeco]&&(S.up.deco||[]).includes(aqDeco))}$('#aqTarget').textContent=aqTargetDeco?'選水草':'選造景';const decoPick=aqEdit&&aqDeco&&DECOS[aqDeco]&&!isEpiphyte(aqDeco)&&!(S.up.moss?.[aqDeco]?.host);document.body.classList.toggle('aq-deco-pick',!!decoPick);{const zi=$('#aqZoomIn'),zo=$('#aqZoomOut'),zr=$('#aqZoomReset'),zp=document.querySelector('[data-aq-scale-pct]');for(const el of [zi,zo,zr,zp])if(el)el.hidden=!decoPick;if(zp&&decoPick)zp.textContent=Math.round(decoUserScale(aqDeco)*100)+'%'}if(!aqPlace&&!aqEdit){$('#aqBar').style.display='none';return}$('#aqBar').style.display='flex';
  if(aqEdit){/*MOVDECO-BAR*/$('#aqTxt').textContent=aqDeco&&DECOS[aqDeco]?(isEpiphyte(aqDeco)?\`✥ 在任意處拖曳「\${DECOS[aqDeco].n}」到沉木／石頭或底砂・點空白取消\`:\`↔️ 任意處拖曳「\${DECOS[aqDeco].n}」・雙指可縮放\`):aqTargetDeco?'🪨 點選造景，再拖曳移動':'🌿 按住水草拖曳（可放上沉木／石頭）・點一下修剪';$('#aqDone').textContent='完成';return}
  const P=AQ.plants()[aqPlace.sp],n=aqPlace.move?'':aqPlace.fromCut?\`・插枝剩 \${(S.cut||{})[aqPlace.sp]||0}\`:\`・每株 🪙\${fmt(P.price)}\`;$('#aqTxt').textContent=\`🌱 \${aqPlace.move?'移動':'種植'}「\${P.name}」：點\${P.zone==='float'?'水面':'底砂'}放置\${n}\`}`;

mustReplace(/function aqBarTxt\(\)\{[\s\S]*?\`🌱 \$\{aqPlace\.move\?'移動':'種植'\}[\s\S]*?放置\$\{n\}\`\}/.exec(html)[0], aqBarMerged, 'aqBarTxt');

// makeAutoScape fit() respects per-item user scale
mustReplace(
  ` const fit=(k,x)=>{const b=catalog[k].box||[-30,30,60],lo=(8-b[0]*scale)/width,hi=(width-8-b[1]*scale)/width;return lo<hi?clamp(x,lo,hi):.5};`,
  ` const us=(k)=>{const v=+(state.up?.decoS?.[k]);return Number.isFinite(v)?Math.max(.5,Math.min(2,Math.round(v*100)/100)):1};
 const fit=(k,x)=>{const raw=catalog[k].box||[-30,30,60],u=us(k),b=[raw[0]*u,raw[1]*u,raw[2]*u],lo=(8-b[0]*scale)/width,hi=(width-8-b[1]*scale)/width;return lo<hi?clamp(x,lo,hi):.5};`,
  'makeAutoScape fit scale'
);

mustReplace(
  `const catalog=Object.fromEntries(Object.entries(DECOS).map(([k,d])=>[k,{...d,box:DECO_BOX[d.draw]||DECO_BOX0}]));`,
  `const catalog=Object.fromEntries(Object.entries(DECOS).map(([k,d])=>{const raw=DECO_BOX[d.draw]||DECO_BOX0;const v=+(S.up?.decoS?.[k]);const u=Number.isFinite(v)?Math.max(.5,Math.min(2,Math.round(v*100)/100)):1;return[k,{...d,box:[raw[0]*u,raw[1]*u,raw[2]*u]}]}));`,
  'AutoScape catalog box'
);

mustReplace(
  `$('#aqTarget').onclick=()=>{aqTargetDeco=!aqTargetDeco;aqDeco=null;aqSel=null;aqBarTxt()};$('#aqZBack').onclick`,
  `$('#aqTarget').onclick=()=>{aqTargetDeco=!aqTargetDeco;aqDeco=null;aqSel=null;aqBarTxt()};$('#aqZBack').onclick`,
  'noop zback anchor'
);
mustReplace(
  `$('#aqZBack').onclick=e=>{e.stopPropagation();if(!aqDeco||!DECOS[aqDeco])return;decoZSet(aqDeco,'back');save();try{Sound.play('click')}catch(_){}toast(\`已將「\${DECOS[aqDeco].n}」移到最後面\`);aqBarTxt()};
$('#aqManage').onclick`,
  `$('#aqZBack').onclick=e=>{e.stopPropagation();if(!aqDeco||!DECOS[aqDeco])return;decoZSet(aqDeco,'back');save();try{Sound.play('click')}catch(_){}toast(\`已將「\${DECOS[aqDeco].n}」移到最後面\`);aqBarTxt()};
$('#aqZoomIn').onclick=e=>{e.stopPropagation();if(aqDeco)decoScaleBump(aqDeco,DECO_S_STEP)};$('#aqZoomOut').onclick=e=>{e.stopPropagation();if(aqDeco)decoScaleBump(aqDeco,-DECO_S_STEP)};$('#aqZoomReset').onclick=e=>{e.stopPropagation();if(aqDeco)decoScaleReset(aqDeco)};
$('#aqManage').onclick`,
  'zoom buttons'
);

// drawDecos
mustReplace(
  /function drawDecos\(\)\{[\s\S]*?ctx\.fill\(\)\}\}/.exec(html)[0],
  patch.match(/function drawDecos\(\)\{[\s\S]*?ctx\.fill\(\)\}\}/)[0],
  'drawDecos'
);

mustReplace(
  `|'+JSON.stringify(S.up.decoPos||0)+(aqEdit&&aqDeco||'')/*MOVDECO*/`,
  `|'+JSON.stringify(S.up.decoPos||0)+'|'+JSON.stringify(S.up.decoS||0)+(aqEdit&&aqDeco||'')/*MOVDECO*/`,
  'laySig decoS'
);

mustReplace(
  `...(sc.up.decoPos&&typeof sc.up.decoPos==='object'?{decoPos:Object.assign({},sc.up.decoPos)}:{})/*MOVDECO-FT*/,...(sc.up.moss`,
  `...(sc.up.decoPos&&typeof sc.up.decoPos==='object'?{decoPos:Object.assign({},sc.up.decoPos)}:{})/*MOVDECO-FT*/,...(sc.up.decoS&&typeof sc.up.decoS==='object'?{decoS:Object.assign({},sc.up.decoS)}:{}),...(sc.up.moss`,
  'ftBoot decoS'
);

// pointer pinch
mustReplace(
  `cv.addEventListener('pointerdown',e=>{e.preventDefault();Sound.init();if(press||coinSweep!==null)return;if(aqPointer('down',e))return;`,
  `cv.addEventListener('pointerdown',e=>{e.preventDefault();Sound.init();if(press||coinSweep!==null)return;aqPinchTrack('down',e);if(aqPointer('down',e))return;`,
  'pinch down'
);
mustReplace(
  `cv.addEventListener('pointermove',e=>{if(aqPointer('move',e))return;`,
  `cv.addEventListener('pointermove',e=>{aqPinchTrack('move',e);if(aqPointer('move',e))return;`,
  'pinch move'
);
mustReplace(
  `coinSweep=null;coinPoint=null;return}if(aqPointer('up',e))return;`,
  `coinSweep=null;coinPoint=null;return}aqPinchTrack('up',e);if(aqPointer('up',e))return;`,
  'pinch up'
);
mustReplace(
  `cv.addEventListener('pointercancel',e=>{/*DECOR-TOUCH-V1*/`,
  `cv.addEventListener('pointercancel',e=>{aqPinchTrack('cancel',e);/*DECOR-TOUCH-V1*/`,
  'pinch cancel'
);

// __aquarium selectDeco
if (!html.includes('selectDeco(k)')) {
  mustReplace(
    `window.__aquarium={`,
    `window.__aquarium={selectDeco(k){if(!k||!DECOS[k])return;aqDeco=k;aqBarTxt();try{LAY.dirty=true;LAY.sig=''}catch(e){}},`,
    'selectDeco'
  );
}

const out = path.join(__dirname, '../client-index.html');
fs.writeFileSync(out, html);
console.log('wrote', out, html.length);
