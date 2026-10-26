/*! 悠游水族箱 魚隻繪圖 — 由 scripts/build-render.js 從遊戲 game-index.snapshot.html 自動擷取產生，請勿手動修改（source hash 9e91737a7c30）
 * 與遊戲共用同一份 drawFish / drawShrimp / pattern 程式碼，後台的魚種預覽＝遊戲內畫面。
 * 用法：
 *   const sp = FishRender.resolve(config.species.goldfish, 'goldfish'); // 轉成執行期參數（與遊戲 applyConfig 相同）
 *   FishRender.drawPreview(canvas, sp, { t: seconds, hue, sil });        // 畫在 canvas 中央
 *   FishRender.drawFish(ctx, sp, fish, t, { sil })                       // 低階：在目前座標系畫一條魚
 */
(function (root) {
  'use strict';
  var T = 0, SPECIES = {}, RX = null, DRAW_GENTLE = false;
  // ---- 以下自遊戲原始碼擷取 ----
const zOf=f=>{if(f.z!=null)return f.z;const s=SPECIES[f.sp];return f.z=(!s||s.role!=='swim'||s.giant)?0:(((f.seed||1)*9301+49297)%233280)/233280};
let BEND=null;const bendY=x=>{if(!BEND)return 0;const k=Math.max(0,(BEND.L*.15-x)/(BEND.L*.6));return BEND.A*k*k*Math.sin(BEND.ph-k*1.9)};
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function colors(f,s){let h=f.hue;if(s.hueCycle)h=(f.hue+T*s.hueCycle)%360;const l=s.lit,m=s.temper==='predator'?1:s.temper==='aggressive'?.5:0;
  return{h,main:`hsl(${h},${s.sat}%,${l}%)`,dark:`hsl(${h},${Math.min(100,s.sat*1.05)}%,${Math.max(5,l-24-8*m)}%)`,deep:`hsl(${h},${s.sat}%,${Math.max(3,l-38-8*m)}%)`,light:`hsl(${h},${Math.round(s.sat*.6)}%,${Math.min(93,l+22)}%)`,fin:s.tailColor||`hsla(${h},${s.sat}%,${Math.min(90,l+6)}%,.7)`,finA:a=>`hsla(${h},${s.sat}%,${Math.min(90,l+8)}%,${(a*.78).toFixed(3)})`}}
function bodyPath(c,s,L,Hh,puff){c.beginPath();const n=L*.5,t=-L*.44;
  if(RX&&RX.bodyPath(c,s,L,Hh,puff)){c.closePath();return}
  if(s.body==='round'){c.ellipse(0,0,L*.46*(1+puff*.25),Hh*.5*(1+puff*.45),0,0,Math.PI*2)}
  else if(s.body==='tall'){c.moveTo(n,0);c.quadraticCurveTo(L*.32,-Hh*.5,-L*.05,-Hh*.5);c.quadraticCurveTo(-L*.34,-Hh*.3,t,0);c.quadraticCurveTo(-L*.34,Hh*.3,-L*.05,Hh*.5);c.quadraticCurveTo(L*.32,Hh*.5,n,0)}
  else{const sh=s.temper==='predator'?1:s.temper==='aggressive'?.5:0,cx1=n*(.85-.3*sh),cy1=Hh*(.62-.06*sh),N=18;
    const cub=(u,a,b,c2,d)=>{const v=1-u;return v*v*v*a+3*v*v*u*b+3*v*u*u*c2+u*u*u*d};
    c.moveTo(n,bendY(n));for(let i=1;i<=N;i++){const u=i/N,x=cub(u,n,cx1,-L*.22,t),y=cub(u,0,-cy1,-Hh*.56,-Hh*.07);c.lineTo(x,y+bendY(x))}
    c.lineTo(t,Hh*.07+bendY(t));for(let i=N-1;i>=0;i--){const u=i/N,x=cub(u,n,cx1*(1+.04*sh),-L*.22,t),y=cub(u,0,cy1*(1-.08*sh),Hh*.56,Hh*.07);c.lineTo(x,y+bendY(x))}}
  c.closePath()}
function drawShrimp(c,f,s,col,sil){
  const L=s.len,Hh=s.ht,ph=f.phase||0,seg=6,clear=s.sat<30,body=sil?'#06192a':`hsla(${col.h},${s.sat}%,${s.lit}%,${clear?.5:.9})`,dark=sil?'#06192a':`hsla(${col.h},${Math.min(100,s.sat+5)}%,${Math.max(8,s.lit-26)}%,${clear?.65:.95})`,edge=sil?'rgba(140,180,210,.35)':`hsla(${col.h},${s.sat}%,${Math.max(8,s.lit-30)}%,.75)`;
  // 觸角與步足（細）
  c.strokeStyle=edge;c.lineWidth=.45;c.beginPath();c.moveTo(L*.44,-Hh*.22);c.quadraticCurveTo(L*.9,-Hh*1.25,L*1.25+Math.sin(ph*.7)*3,-Hh*.55);c.moveTo(L*.44,-Hh*.16);c.quadraticCurveTo(L*.85,-Hh*.45,L*1.15,Hh*.25+Math.sin(ph*.9)*2);c.moveTo(L*.46,-Hh*.1);c.lineTo(L*.66,-Hh*.05);c.stroke();
  c.lineWidth=.55;for(let i=0;i<5;i++){const x=L*.3-i*L*.12,a=Math.sin(ph*2+i)*2;c.beginPath();c.moveTo(x,Hh*.25);c.lineTo(x+a+1,Hh*.55);c.lineTo(x+a,Hh*.8);c.stroke()}
  for(let i=0;i<4;i++){const x=-L*.05-i*L*.08,a=Math.sin(ph*3+i*.8)*1.5;c.beginPath();c.moveTo(x,Hh*.3);c.lineTo(x+a,Hh*.52);c.stroke()}
  // 尾扇（半透明＋紋路）
  c.fillStyle=sil?'#06192a':`hsla(${col.h},${s.sat}%,${s.lit}%,${clear?.35:.7})`;c.beginPath();c.moveTo(-L*.42,0);c.lineTo(-L*.64,-Hh*.48);c.quadraticCurveTo(-L*.7,-Hh*.05,-L*.6,Hh*.32);c.closePath();c.fill();
  if(!sil){c.strokeStyle=edge;c.lineWidth=.4;c.beginPath();for(let k=0;k<4;k++){c.moveTo(-L*.43,0);c.lineTo(-L*(.6+k*.02),-Hh*(.42-k*.24))}c.stroke()}
  // 分節身體（從尾到頭，每節有背暗腹亮＋高光）
  for(let i=seg-1;i>=0;i--){const t=i/(seg-1),x=L*.35-t*L*.75,y=-Math.sin(t*Math.PI)*Hh*.25+t*Hh*.05,rx=L*(.16-t*.05),ry=Hh*(.48-t*.18);
    if(sil){c.fillStyle=body}else{const g=c.createLinearGradient(x,y-ry,x,y+ry);g.addColorStop(0,dark);g.addColorStop(.45,body);g.addColorStop(1,`hsla(${col.h},${Math.round(s.sat*.5)}%,${Math.min(92,s.lit+25)}%,${clear?.35:.75})`);c.fillStyle=g}
    c.beginPath();c.ellipse(x,y,rx,ry,-.15+t*.4,0,7);c.fill();c.strokeStyle=edge;c.lineWidth=.5;c.stroke();
    if(!sil){c.strokeStyle='rgba(255,255,255,.45)';c.lineWidth=Math.max(.4,ry*.12);c.beginPath();c.ellipse(x,y,rx*.8,ry*.78,-.15+t*.4,Math.PI*1.15,Math.PI*1.75);c.stroke()}}
  if(sil)return;
  // 頭胸甲額角
  c.fillStyle=dark;c.beginPath();c.moveTo(L*.38,-Hh*.3);c.lineTo(L*.62,-Hh*.24);c.lineTo(L*.4,-Hh*.16);c.closePath();c.fill();
  if(s.pattern==='dots'){c.fillStyle=s.patternColor||'rgba(120,80,60,.7)';const r=rng(f.seed||3);for(let i=0;i<12;i++){c.beginPath();c.arc(L*.3-r()*L*.7,-Hh*.2+r()*Hh*.4,.6,0,7);c.fill()}}
  if(RX&&RX.pattern2)RX.pattern2(c,f,s,L,Hh,col);
  // 眼柄＋小而亮的複眼
  const er=Math.max(.9,Hh*.09);c.strokeStyle=dark;c.lineWidth=er*.8;c.beginPath();c.moveTo(L*.38,-Hh*.18);c.lineTo(L*.45,-Hh*.24);c.stroke();
  c.fillStyle='#050505';c.beginPath();c.arc(L*.46,-Hh*.25,er,0,7);c.fill();c.fillStyle='rgba(255,255,255,.85)';c.beginPath();c.arc(L*.46+er*.35,-Hh*.25-er*.35,er*.3,0,7);c.fill();
  if(f.sick){c.fillStyle='rgba(120,200,90,.35)';c.beginPath();c.ellipse(0,0,L*.45,Hh*.45,0,0,7);c.fill()}
}
function drawFish(c,f,opt={}){
  DRAW_GENTLE=!!opt.gentle;
  const s=RX?RX.view(SPECIES[f.sp],f):SPECIES[f.sp],L=s.len,Hh=s.ht,col=colors(f,s),ph=f.phase||0,wig=Math.sin(ph);
  const sil=opt.sil;const fill=x=>sil?'#06192a':x;
  if(RX&&RX.special(c,f,s,col,sil))return;
  if(s.body==='shrimp'){drawShrimp(c,f,s,col,sil);return}
  BEND=(s.body==='fish'||!s.body)&&!opt.noBend?{L,A:Hh*.14*(f.sick?.4:1),ph}:null;
  // 尾巴（兩段擺動：根部轉動＋尾端延遲波動）
  const wig2=Math.sin(ph-1.15),big=s.tailScale||1,tY=wig2*Hh*(s.tail==='flow'?.32:.2);
  c.save();c.translate(-L*.4,bendY(-L*.4));c.rotate(wig*(s.tail==='flow'?.3:.22)+(BEND?(bendY(-L*.42)-bendY(-L*.38))/(L*.04)*.6:0));
  if(sil)c.fillStyle='#06192a';else if(s.tailColor)c.fillStyle=s.tailColor;else{const tg=c.createLinearGradient(0,0,-L*.6*big,0);tg.addColorStop(0,col.finA(.92));tg.addColorStop(1,col.finA(.38));c.fillStyle=tg}
  c.beginPath();
  if(RX&&RX.tailPath(c,f,s,L,Hh,tY,big,col,sil)){}else if(s.tail==='fan'){c.moveTo(4,0);c.quadraticCurveTo(-L*.12,-Hh*.2,-L*.34,-Hh*.52+tY);c.quadraticCurveTo(-L*.24,tY*.6,-L*.34,Hh*.52+tY);c.quadraticCurveTo(-L*.12,Hh*.2,4,0)}
  else if(s.tail==='fork'){c.moveTo(4,0);c.quadraticCurveTo(-L*.15,-Hh*.2,-L*.33,-Hh*.5+tY);c.quadraticCurveTo(-L*.24,-Hh*.1+tY*.5,-L*.2,tY*.5);c.quadraticCurveTo(-L*.24,Hh*.1+tY*.5,-L*.33,Hh*.5+tY);c.quadraticCurveTo(-L*.15,Hh*.2,4,0)}
  else if(s.tail==='small'){c.moveTo(3,0);c.quadraticCurveTo(-L*.14,-Hh*.36,-L*.22,-Hh*.3+tY);c.lineTo(-L*.16,tY*.5);c.lineTo(-L*.22,Hh*.3+tY);c.quadraticCurveTo(-L*.14,Hh*.36,3,0)}
  else{c.moveTo(4,0);c.bezierCurveTo(-L*.25,-Hh*.9*big,-L*.7*big,-Hh*.75*big+tY,-L*.62*big,tY);c.bezierCurveTo(-L*.7*big,Hh*.75*big+tY,-L*.25,Hh*.9*big,4,0)}
  c.fill();
  if(!sil&&!(RX&&RX.noRays(s))){c.strokeStyle=`hsla(${col.h},30%,88%,.3)`;c.lineWidth=.5;const tl=s.tail==='flow'?L*.58*big:L*.3;for(let i=-2;i<=2;i++){c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(-tl*.5,i*Hh*.16+tY*.3,-tl,i*Hh*(s.tail==='flow'?.3:.18)+tY);c.stroke()}}
  c.restore();
  // 背鰭 / 腹鰭
  c.fillStyle=sil?'#06192a':s.tailColor?col.dark:col.finA(.62);c.beginPath();
  if(RX&&RX.finPath(c,f,s,L,Hh,wig,col,sil)){}else if(s.fins==='tall'){c.moveTo(L*.12,-Hh*.4);c.quadraticCurveTo(-L*.15,-Hh*1.15,-L*.34,-Hh*1.1+wig*2);c.lineTo(-L*.28,-Hh*.25);c.closePath();c.moveTo(L*.12,Hh*.4);c.quadraticCurveTo(-L*.15,Hh*1.15,-L*.34,Hh*1.1+wig*2);c.lineTo(-L*.28,Hh*.25);c.closePath()}
  else if(s.fins==='flowing'){c.moveTo(L*.15,-Hh*.4);c.bezierCurveTo(-L*.1,-Hh*1.6,-L*.5,-Hh*1.3+wig*4,-L*.4,-Hh*.2);c.closePath();c.moveTo(L*.15,Hh*.4);c.bezierCurveTo(-L*.05,Hh*1.6,-L*.5,Hh*1.4+wig*4,-L*.4,Hh*.2);c.closePath()}
  else if(s.fins==='round'){c.moveTo(-L*.1,-Hh*.45);c.quadraticCurveTo(-L*.2,-Hh*.75,-L*.32,-Hh*.4);c.closePath()}
  else{c.moveTo(L*.16,-Hh*.4);c.quadraticCurveTo(-L*.02,-Hh*.9+wig,-L*.27,-Hh*.32);c.closePath();c.moveTo(-L*.05,Hh*.38);c.quadraticCurveTo(-L*.15,Hh*.68,-L*.28,Hh*.3);c.closePath()}
  c.fill();
  if(!sil&&!(RX&&RX.noRays(s))){c.save();c.clip();c.strokeStyle=`hsla(${col.h},30%,90%,.22)`;c.lineWidth=.45;c.beginPath();for(let i=0;i<12;i++){const x=L*.18-i*L*.045;c.moveTo(x,-Hh*.3);c.lineTo(x-L*.12,-Hh*1.7);c.moveTo(x,Hh*.3);c.lineTo(x-L*.12,Hh*1.7)}c.stroke();c.restore()}
  // 身體
  bodyPath(c,s,L,Hh,f.puff||0);
  if(sil){c.fillStyle='#06192a';c.fill();c.strokeStyle='rgba(140,180,210,.35)';c.lineWidth=1;c.stroke();return}
  const g=c.createLinearGradient(0,-Hh*.5,0,Hh*.5);g.addColorStop(0,col.deep);g.addColorStop(.22,col.dark);g.addColorStop(.5,col.main);g.addColorStop(.82,col.light);g.addColorStop(1,col.dark);c.fillStyle=g;c.fill();
  c.save();bodyPath(c,s,L,Hh,f.puff||0);c.clip();pattern(c,f,s,L,Hh,col);
  if(RX&&RX.volume){RX.scaleFill(c,s,L,Hh);RX.volume(c,f,s,L,Hh,()=>bodyPath(c,s,L,Hh,f.puff||0));RX.anatomy(c,f,s,L,Hh,col,L*(s.body==='round'?.22:s.body==='arowana'||s.body==='elongated'||s.body==='torpedo'?.34:.29));}else{
  // 鱗片紋理與光澤
  if(s.pattern!=='scales'){c.strokeStyle='rgba(255,255,255,.09)';c.lineWidth=.6;for(let y=-Hh*.35;y<Hh*.4;y+=Hh*.2)for(let x=-L*.32;x<L*.25;x+=L*.075){c.beginPath();c.arc(x+(Math.round(y/Hh*5)%2?L*.037:0),y,L*.045,-1.1,1.1);c.stroke()}}
  const rg=c.createRadialGradient(L*.12,-Hh*.22,0,L*.12,-Hh*.22,L*.42);rg.addColorStop(0,'rgba(255,255,255,.28)');rg.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=rg;c.fillRect(-L,-Hh,L*2,Hh*2);
  const sx=((T*.35+(f.seed||0)%10*.1)%2.2-.6)*L;const sg=c.createLinearGradient(sx-L*.15,0,sx+L*.15,0);sg.addColorStop(0,'rgba(255,255,255,0)');sg.addColorStop(.5,'rgba(255,255,255,.16)');sg.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=sg;c.fillRect(sx-L*.15,-Hh,L*.3,Hh*2);}
  c.restore();BEND=null;
  bodyPath(c,s,L,Hh,f.puff||0);c.strokeStyle=s.role==='glass'?'rgba(255,255,255,.85)':`hsla(${col.h},${s.sat}%,${Math.max(5,s.lit-30)}%,.45)`;c.lineWidth=s.role==='glass'?1.3:.8;c.stroke();
  // 胸鰭
  c.save();c.translate(L*.05,Hh*.12);c.rotate(.5+Math.sin(ph*1.6)*.35);c.fillStyle=s.tailColor?'rgba(255,255,255,.3)':`hsla(${col.h},${s.sat}%,${Math.min(92,s.lit+15)}%,.45)`;c.beginPath();c.ellipse(-L*.08,0,L*.12,Hh*.09,0,0,Math.PI*2);c.fill();c.strokeStyle=`hsla(${col.h},30%,92%,.35)`;c.lineWidth=.4;c.beginPath();for(let i=-2;i<=2;i++){c.moveTo(L*.03,0);c.lineTo(-L*.19,i*Hh*.035)}c.stroke();c.restore();
  // 眼睛
  let er=Math.max(1.3,Hh*.095*(s.eyeScale||1)*((f.stg??2)===0?1.25:1)),ex=L*(s.body==='round'?.22:.29),ey=-Hh*.08;
  if(RX){const o=RX.eyes(c,f,s,L,Hh,col,er,ex,ey);if(o){er=o.er;ex=o.ex;ey=o.ey}}
  if(RX&&RX.realEye)RX.realEye(c,f,s,ex,ey,er,col);else{
  const blink=((T+(f.seed||0)%97*.13)%4.6)<.13;
  c.fillStyle='#fff';c.beginPath();c.arc(ex,ey,er,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.25)';c.lineWidth=.5;c.stroke();
  if(blink&&!f.sick){c.fillStyle=col.dark;c.beginPath();c.arc(ex,ey,er*1.02,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.5)';c.lineWidth=.8;c.beginPath();c.moveTo(ex-er*.8,ey);c.quadraticCurveTo(ex,ey+er*.5,ex+er*.8,ey);c.stroke()}
  else if(f.sick){c.strokeStyle='#223';c.lineWidth=1.2;c.beginPath();c.moveTo(ex-er*.6,ey-er*.6);c.lineTo(ex+er*.6,ey+er*.6);c.moveTo(ex+er*.6,ey-er*.6);c.lineTo(ex-er*.6,ey+er*.6);c.stroke()}
  else{const lx=ex+er*(.12+.26*(f.lookX??.6)),ly=ey+er*.28*(f.lookY||0);c.fillStyle='#0b1420';c.beginPath();c.arc(lx,ly,er*.6,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.beginPath();c.arc(lx+er*.18,ly-er*.28,er*.22,0,Math.PI*2);c.fill()}}
  // 嘴：戰鬥／療癒繪本用微笑（不露牙）；其餘維持原本嘴型
  if(opt.gentle){c.strokeStyle='rgba(90,50,45,.55)';c.lineWidth=1.15;c.lineCap='round';c.beginPath();const mo=(f.chomp||0)*1.4;c.moveTo(L*.40,Hh*.07);c.quadraticCurveTo(L*.47,Hh*.16+mo,L*.52,Hh*.055);c.stroke()}
  else if(!(RX&&RX.mouth(c,f,s,L,Hh,col))&&RX&&RX.teeth&&RX.menaceOf(s)===2)RX.teeth(c,f,s,L,Hh);else if(!(RX&&RX.mouth(c,f,s,L,Hh,col))){c.strokeStyle='rgba(0,0,0,.35)';c.lineWidth=1;c.beginPath();const mo=(f.chomp||0)*2;c.moveTo(L*.47,Hh*.04-mo);c.lineTo(L*.4,Hh*.08);c.lineTo(L*.47,Hh*.1+mo);c.stroke()}
  if(s.barbels){c.strokeStyle=`hsl(${col.h},80%,40%)`;c.lineWidth=1.2;c.beginPath();c.moveTo(L*.46,Hh*.12);c.quadraticCurveTo(L*.56,Hh*.3,L*.6+wig*2,Hh*.45);c.moveTo(L*.44,Hh*.14);c.quadraticCurveTo(L*.52,Hh*.32,L*.54+wig*2,Hh*.5);c.stroke()}
  RX&&RX.after(c,f,s,L,Hh,col,ph,wig);
  if(f.sick){bodyPath(c,s,L,Hh,0);c.fillStyle='rgba(120,200,90,.3)';c.fill()}
  if(opt.rim&&!sil){c.save();bodyPath(c,s,L,Hh,f.puff||0);c.clip();const rg=c.createLinearGradient(0,-Hh,0,Hh*.2);rg.addColorStop(0,'rgba(207,246,255,.55)');rg.addColorStop(1,'rgba(207,246,255,0)');c.globalCompositeOperation='source-atop';c.fillStyle=rg;c.fillRect(-L,-Hh*1.3,L*2,Hh*1.6);const warm=c.createLinearGradient(0,Hh*.2,0,Hh);warm.addColorStop(0,'rgba(255,217,168,0)');warm.addColorStop(1,'rgba(255,217,168,.30)');c.fillStyle=warm;c.fillRect(-L,0,L*2,Hh);c.restore()}
}
function pattern(c,f,s,L,Hh,col){
  if(RX&&RX.pattern(c,f,s,L,Hh,col)){}else switch(s.pattern){
  case'bands':for(const x of[L*.26,-L*.02,-L*.3]){c.fillStyle='#1b1b22';c.fillRect(x-L*.07,-Hh,L*.14,Hh*2);c.fillStyle=s.patternColor||'#fff';c.fillRect(x-L*.05,-Hh,L*.1,Hh*2)}break;
  case'neonStripe':c.fillStyle=s.patternColor||'hsl(0,90%,55%)';c.beginPath();c.moveTo(-L*.45,Hh*.02);c.lineTo(L*.05,Hh*.08);c.lineTo(L*.05,Hh*.6);c.lineTo(-L*.45,Hh*.6);c.fill();
    c.shadowColor=`hsl(${f.hue},100%,60%)`;c.shadowBlur=6;c.fillStyle=`hsl(${f.hue},100%,62%)`;c.fillRect(-L*.45,-Hh*.18,L*.85,Hh*.2);c.shadowBlur=0;break;
  case'palette':c.fillStyle=s.patternColor||'#0c1530';c.beginPath();c.moveTo(L*.3,-Hh*.12);c.quadraticCurveTo(0,-Hh*.5,-L*.4,-Hh*.25);c.quadraticCurveTo(-L*.1,-Hh*.05,-L*.1,Hh*.2);c.quadraticCurveTo(L*.1,-Hh*.1,L*.3,-Hh*.12);c.fill();break;
  case'vstripes':c.fillStyle=s.patternColor||'rgba(30,30,40,.55)';for(const x of[L*.18,-L*.06,-L*.28])c.fillRect(x-2,-Hh,4,Hh*2);break;
  case'spots':{const r=rng(f.seed);c.fillStyle=s.patternColor||`hsl(${f.hue+10},60%,30%)`;for(let i=0;i<14;i++){const x=(r()-.5)*L*.8,y=(r()-.8)*Hh*.6;c.beginPath();c.arc(x,y,1.3+r()*1.6,0,7);c.fill()}c.fillStyle='rgba(255,255,255,.6)';c.beginPath();c.ellipse(0,Hh*.3,L*.35,Hh*.25,0,0,7);c.fill();break}
  case'patches':{const r=rng(f.seed);c.fillStyle=s.patternColor||`hsl(${f.hue},90%,50%)`;for(let i=0;i<4;i++){c.beginPath();c.ellipse((r()-.5)*L*.8,(r()-.7)*Hh*.5,L*(.08+r()*.1),Hh*(.15+r()*.15),r()*3,0,7);c.fill()}if(f.seed%3===0){c.fillStyle='#1a1a1a';c.beginPath();c.arc(-L*.1,-Hh*.1,Hh*.1,0,7);c.fill()}break}
  case'scales':c.strokeStyle=`hsla(${f.hue+10},100%,80%,.7)`;c.lineWidth=.8;for(let y=-Hh*.4;y<Hh*.5;y+=Hh*.22)for(let x=-L*.4;x<L*.35;x+=L*.09){c.beginPath();c.arc(x+(Math.round(y)%2?L*.045:0),y,L*.05,-1.2,1.2);c.stroke()}
    c.fillStyle=`rgba(255,255,220,${.25+.2*Math.sin(T*3+f.seed)})`;c.fillRect(-L*.5+((T*30+f.seed)%(L*1.4)),-Hh,6,Hh*2);break;
  case'rainbow':for(let i=0;i<6;i++){c.fillStyle=`hsla(${(f.hue+T*50+i*55)%360},90%,62%,.85)`;c.fillRect(-L*.5,-Hh*.5+i*Hh/6,L,Hh/6+.5)}
    c.fillStyle='rgba(255,255,255,.8)';for(let i=0;i<3;i++){const a=T*2+i*2.1+f.seed;c.beginPath();c.arc(Math.sin(a)*L*.3,Math.cos(a*1.3)*Hh*.25,1.2,0,7);c.fill()}break;
  case'stripe':c.fillStyle=s.patternColor||'#222';c.beginPath();c.moveTo(L*.48,-Hh*.02);c.lineTo(-L*.46,-Hh*.06);c.lineTo(-L*.46,Hh*.1);c.lineTo(L*.4,Hh*.1);c.fill();break;
  case'sheen':c.fillStyle=`hsla(${f.hue+40},100%,70%,.3)`;c.beginPath();c.ellipse(0,-Hh*.1,L*.3,Hh*.18,0,0,7);c.fill();break;
  default:c.fillStyle='rgba(255,255,255,.18)';c.beginPath();c.ellipse(L*.05,Hh*.25,L*.3,Hh*.18,0,0,7);c.fill();
  }
  RX&&RX.pattern2(c,f,s,L,Hh,col);
  // 鱗光（v4：交給 RX.volume 的鏡面高光，這裡只留很淡的一層）
  if(!RX||!RX.volume){c.fillStyle='rgba(255,255,255,.18)';c.beginPath();c.ellipse(L*.1,-Hh*.25,L*.22,Hh*.08,-.1,0,7);c.fill()}
}
  // ---- 外觀擴充（render-ext）----
  var __rx = {};
  (function (window, globalThis, module) {
/* ==== 內嵌自 species/render-ext.js（node species/inline-modules.js 產生，請改原始檔） ==== */
/* 悠游水族箱 — 魚種外觀擴充（render-ext.js）
 * 與 index.html 的 drawFish / bodyPath / pattern 同一套座標系：魚頭朝 +x，鼻尖 x=L*.5，尾柄 x=-L*.44，身高 ±Hh/2。
 * SPECIES[id] 由 applyConfig 把 look 欄位平鋪在 s 上（s.body / s.tail / s.pattern2 / s.accentColor…），s.ht=高度、s.lit=亮度。
 *
 * 用法（index.html）：
 *   由 species/inline-modules.js 內嵌在 index.html 主 script 之前（或以 script src 載入）
 *   const RX=window.createRenderExt?createRenderExt({rng,getT:()=>T,pattern:(...a)=>pattern(...a)}):null;
 * 然後在 drawFish / bodyPath / pattern / render / preview 加入 10 個 hook（見 MECHANICS.md「整合」或 apply-integration.js）。
 * 每個 hook 回傳 true＝已處理（略過原本的繪製），false/undefined＝交回原本程式。未載入本檔時 RX=null，遊戲行為完全不變。
 */
(function (root) {
  'use strict';
  const EXT_BODIES = ['elongated', 'torpedo', 'disc', 'arowana', 'catfish', 'pleco'];
  const SPECIAL_BODIES = ['eel', 'ray', 'crab', 'crayfish', 'snail', 'seahorse', 'turtle', 'cetacean', 'whaleshark', 'manta'];
  const EXT_TAILS = ['lyre', 'sword', 'round', 'double', 'crescent', 'none'];
  const EXT_FINS = ['sail', 'shark', 'long', 'spiny', 'none', 'finlets', 'knife', 'pennant', 'lion', 'whip'];
  const EXT_PATTERNS = ['tigerBars', 'leopard', 'reticulate', 'ocellus', 'calico', 'lateral', 'mask', 'gradient', 'pearl', 'pinstripe', 'marble', 'saddle', 'belly2', 'bandsShrimp', 'pearl3', 'galaxy', 'prism', 'goldleaf', 'sakura', 'flame', 'crystal', 'aurora', 'starlight'];
  const PREMIUM_PATTERNS = ['galaxy', 'prism', 'goldleaf', 'sakura', 'flame', 'crystal', 'aurora', 'starlight'];
  const EXT_MOUTHS = ['up', 'under', 'sucker', 'beak', 'snout', 'lips', 'jaw', 'trunk', 'o', 'pompom', 'barbel1'];
  const SIL = '#06192a', SIL_EDGE = 'rgba(140,180,210,.35)';
  const IRIS = { red: '#d4202a', blue: '#2a8cff', yellow: '#ffd21a' };

  function createRenderExt(api) {
    api = api || {};
    const rng = api.rng || (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; });
    const T = () => (api.getT ? api.getT() : 0);
    const patCache = {}; let lastE = null;

    // ---------- 身體輪廓（H4：bodyPath 內，beginPath 之後） ----------
    function bodyPath(c, s, L, Hh, puff) {
      const n = L * .5, t = -L * .44;
      switch (s.body) {
        case 'elongated': c.moveTo(n, Hh * .02); c.bezierCurveTo(L * .44, -Hh * .52, -L * .25, -Hh * .55, t, -Hh * .12); c.lineTo(t, Hh * .12); c.bezierCurveTo(-L * .25, Hh * .55, L * .44, Hh * .52, n, Hh * .02); return true;
        case 'torpedo': c.moveTo(n, Hh * .04); c.bezierCurveTo(L * .44, -Hh * .32, L * .25, -Hh * .52, 0, -Hh * .5); c.bezierCurveTo(-L * .22, -Hh * .48, -L * .38, -Hh * .2, t, -Hh * .1); c.lineTo(t, Hh * .1); c.bezierCurveTo(-L * .38, Hh * .2, -L * .22, Hh * .45, 0, Hh * .45); c.bezierCurveTo(L * .25, Hh * .45, L * .44, Hh * .3, n, Hh * .04); return true;
        case 'disc': c.moveTo(n, Hh * .04); c.bezierCurveTo(L * .48, -Hh * .45, L * .1, -Hh * .56, -L * .12, -Hh * .5); c.bezierCurveTo(-L * .34, -Hh * .42, -L * .42, -Hh * .18, t, -Hh * .06); c.lineTo(t, Hh * .06); c.bezierCurveTo(-L * .42, Hh * .18, -L * .34, Hh * .42, -L * .12, Hh * .5); c.bezierCurveTo(L * .1, Hh * .56, L * .48, Hh * .45, n, Hh * .04); return true;
        case 'arowana': c.moveTo(n, -Hh * .3); c.lineTo(L * .3, -Hh * .46); c.bezierCurveTo(0, -Hh * .52, -L * .3, -Hh * .42, t, -Hh * .12); c.lineTo(t, Hh * .12); c.bezierCurveTo(-L * .3, Hh * .46, -L * .05, Hh * .54, L * .2, Hh * .44); c.quadraticCurveTo(L * .46, Hh * .3, n, -Hh * .3); return true;
        case 'catfish': c.moveTo(n, Hh * .12); c.bezierCurveTo(n, -Hh * .3, L * .32, -Hh * .5, L * .1, -Hh * .5); c.bezierCurveTo(-L * .15, -Hh * .48, -L * .35, -Hh * .2, t, -Hh * .08); c.lineTo(t, Hh * .08); c.bezierCurveTo(-L * .35, Hh * .2, -L * .15, Hh * .42, L * .1, Hh * .46); c.bezierCurveTo(L * .35, Hh * .5, n, Hh * .4, n, Hh * .12); return true;
        case 'pleco': c.moveTo(n, Hh * .32); c.bezierCurveTo(L * .48, -Hh * .1, L * .32, -Hh * .5, L * .05, -Hh * .5); c.bezierCurveTo(-L * .2, -Hh * .46, -L * .36, -Hh * .18, t, -Hh * .08); c.lineTo(t, Hh * .1); c.bezierCurveTo(-L * .3, Hh * .3, -L * .15, Hh * .5, L * .05, Hh * .5); c.lineTo(L * .4, Hh * .5); c.quadraticCurveTo(n, Hh * .5, n, Hh * .32); return true;
      }
      return false;
    }

    // ---------- 尾巴（H2：tail if-chain 前；座標原點在尾柄，已旋轉） ----------
    function finColor(c, s, col, sil) { if (sil) return SIL; return s.tailColor || col.finA(.85); }
    function tailFill(c, f, s, L, Hh, big, col, sil) {
      if (sil || !s.tailPattern) return;
      const base = s.tailColor || col.finA(.9), tl = L * (s.tail === 'flow' ? .62 * big : .38);
      if (s.tailPattern === 'bars') { const g = c.createLinearGradient(0, -Hh * .55, 0, Hh * .55); const st = [base, '#151515', '#f4f4f4', '#151515', base, '#151515', '#f4f4f4', '#151515', base]; st.forEach((cc, i) => { g.addColorStop(Math.max(0, i / st.length), cc); g.addColorStop(Math.min(1, (i + 1) / st.length - .001), cc); }); c.fillStyle = g; }
      else if (s.tailPattern === 'edge') { const g = c.createLinearGradient(0, 0, -tl, 0); g.addColorStop(0, base); g.addColorStop(.72, base); g.addColorStop(.8, s.accentColor || '#111'); g.addColorStop(1, s.accentColor || '#111'); c.fillStyle = g; }
      else if (s.tailPattern === 'spots' && typeof document !== 'undefined') {
        const key = 'sp|' + base; let p = patCache[key];
        if (!p) { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const x = cv.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, 8, 8); x.fillStyle = 'rgba(15,15,30,.55)'; x.beginPath(); x.arc(2, 2, 1.3, 0, 7); x.arc(6, 6, 1, 0, 7); x.fill(); p = patCache[key] = c.createPattern(cv, 'repeat'); }
        c.fillStyle = p;
      }
    }
    function tailPath(c, f, s, L, Hh, tY, big, col, sil) {
      const dmg = (f && f.finDmg) || 0; if (dmg > .02 && !sil) c.globalAlpha *= 1 - .45 * Math.min(1, dmg);
      tailFill(c, f, s, L, Hh, big, col, sil);
      switch (s.tail) {
        case 'lyre': c.moveTo(4, 0); c.quadraticCurveTo(-L * .15, -Hh * .2, -L * .52 * big, -Hh * .72 + tY); c.quadraticCurveTo(-L * .3, -Hh * .22 + tY * .5, -L * .2, tY * .5); c.quadraticCurveTo(-L * .3, Hh * .22 + tY * .5, -L * .52 * big, Hh * .72 + tY); c.quadraticCurveTo(-L * .15, Hh * .2, 4, 0); return true;
        case 'sword': c.moveTo(4, 0); c.quadraticCurveTo(-L * .1, -Hh * .25, -L * .3, -Hh * .45 + tY); c.quadraticCurveTo(-L * .26, tY * .4, -L * .3, Hh * .18 + tY); c.lineTo(-L * .72, Hh * .34 + tY * 1.2); c.lineTo(-L * .7, Hh * .44 + tY * 1.2); c.quadraticCurveTo(-L * .3, Hh * .42, 4, Hh * .06);
          if (!sil) { c.fill(); c.beginPath(); c.fillStyle = s.accentColor || '#151515'; c.moveTo(-L * .3, Hh * .3 + tY); c.lineTo(-L * .72, Hh * .34 + tY * 1.2); c.lineTo(-L * .7, Hh * .44 + tY * 1.2); c.lineTo(-L * .28, Hh * .38 + tY); } return true;
        case 'round': c.moveTo(4, 0); c.bezierCurveTo(-L * .05, -Hh * .52, -L * .4 * big, -Hh * .48 + tY, -L * .38 * big, tY); c.bezierCurveTo(-L * .4 * big, Hh * .48 + tY, -L * .05, Hh * .52, 4, 0); return true;
        case 'double': for (const k of [-1, 1]) { c.moveTo(4, 0); c.bezierCurveTo(-L * .12, k * Hh * .55 * big, -L * .52 * big, k * Hh * .7 * big + tY, -L * .58 * big, k * Hh * .12 + tY); c.quadraticCurveTo(-L * .3 * big, k * Hh * .02 + tY * .4, 4, 0); } return true;
        case 'crescent': c.moveTo(4, -Hh * .06); c.quadraticCurveTo(-L * .12, -Hh * .18, -L * .32, -Hh * .66 + tY); c.quadraticCurveTo(-L * .14, tY * .3, -L * .32, Hh * .66 + tY); c.quadraticCurveTo(-L * .12, Hh * .18, 4, Hh * .06); return true;
        case 'none': return true;
      }
      if (s.tail === 'flow' && s.tailPattern === 'rays') { // 冠尾：鋸齒邊
        const N = 9; c.moveTo(4, 0); for (let i = 0; i <= N; i++) { const a = -1 + 2 * i / N, r = (i % 2 ? .52 : .66) * L * big; c.lineTo(-r * Math.cos(a * .9), a * Hh * .95 * big + tY * (1 - Math.abs(a) * .3)); } c.closePath(); return true;
      }
      return false;
    }
    const noRays = s => s.tail === 'none' || s.tail === 'double' || s.tail === 'sword';

    // ---------- 背鰭／腹鰭（H3） ----------
    function finPath(c, f, s, L, Hh, wig, col, sil) {
      switch (s.fins) {
        case 'none': return true;
        case 'sail': c.moveTo(L * .3, -Hh * .42); c.bezierCurveTo(L * .2, -Hh * 1.45, -L * .3, -Hh * 1.35 + wig * 2, -L * .4, -Hh * .2); c.closePath(); c.moveTo(-L * .05, Hh * .38); c.quadraticCurveTo(-L * .18, Hh * .75, -L * .32, Hh * .3); c.closePath(); return true;
        case 'shark': c.moveTo(L * .12, -Hh * .45); c.lineTo(-L * .06, -Hh * 1.05 + wig); c.lineTo(-L * .14, -Hh * .42); c.closePath(); c.moveTo(-L * .18, Hh * .36); c.lineTo(-L * .3, Hh * .62); c.lineTo(-L * .3, Hh * .3); c.closePath(); return true;
        case 'long': c.moveTo(L * .05, -Hh * .45); c.quadraticCurveTo(-L * .2, -Hh * .78 + wig, -L * .44, -Hh * .3); c.lineTo(-L * .4, -Hh * .1); c.closePath(); c.moveTo(L * .0, Hh * .42); c.quadraticCurveTo(-L * .2, Hh * .75 + wig, -L * .44, Hh * .3); c.lineTo(-L * .4, Hh * .1); c.closePath(); return true;
        case 'spiny': for (let i = 0; i < 7; i++) { const x = L * .22 - i * L * .07, h = Hh * (.95 - i * .04) + (i % 2) * Hh * .1; c.moveTo(x + L * .03, -Hh * .4); c.lineTo(x, -h + wig); c.lineTo(x - L * .04, -Hh * .38); c.closePath(); } c.moveTo(-L * .05, Hh * .38); c.quadraticCurveTo(-L * .15, Hh * .7, -L * .28, Hh * .3); c.closePath(); return true;
        case 'finlets': for (let i = 0; i < 9; i++) { const x = L * .12 - i * L * .065; c.moveTo(x, -Hh * .42); c.lineTo(x - L * .015, -Hh * .85 + Math.sin(T() * 3 + i) * 1.2); c.lineTo(x - L * .05, -Hh * .7); c.lineTo(x - L * .045, -Hh * .4); c.closePath(); } c.moveTo(-L * .2, Hh * .3); c.quadraticCurveTo(-L * .3, Hh * .6, -L * .4, Hh * .15); c.closePath(); return true;
        case 'knife': { const N = 14; c.moveTo(L * .2, Hh * .38); for (let i = 0; i <= N; i++) { const x = L * .2 - i * (L * .66 / N); c.lineTo(x, Hh * (.5 + .2 * Math.abs(Math.sin(T() * 4 + i * .6))) + Hh * .05 * (1 - i / N)); } c.lineTo(-L * .46, Hh * .05); c.closePath(); return true; }
        case 'pennant': c.moveTo(L * .14, -Hh * .42); c.quadraticCurveTo(L * .05, -Hh * 1.1, -L * .1 + wig * 2, -Hh * 1.9); c.quadraticCurveTo(-L * .05, -Hh * 1, -L * .28, -Hh * .35); c.closePath(); c.moveTo(-L * .05, Hh * .38); c.quadraticCurveTo(-L * .15, Hh * .7, -L * .28, Hh * .3); c.closePath(); return true;
        case 'lion': for (let i = 0; i < 12; i++) { const x = L * .24 - i * L * .055, h = Hh * (1.5 - Math.abs(i - 3) * .07); c.moveTo(x + L * .015, -Hh * .38); c.lineTo(x - L * .02 + wig, -h); c.lineTo(x - L * .03, -Hh * .36); c.closePath(); }
          for (let i = 0; i < 7; i++) { const a = .3 + i * .22; c.moveTo(L * .12, Hh * .1); c.lineTo(L * .12 - Math.cos(a) * L * .55, Hh * .1 + Math.sin(a) * Hh * 1.1 + wig); c.lineTo(L * .12 - Math.cos(a + .12) * L * .5, Hh * .1 + Math.sin(a + .12) * Hh * 1.0); c.closePath(); } return true;
        case 'whip': c.moveTo(L * .2, Hh * .3); c.quadraticCurveTo(L * .1, Hh * 1.1, -L * .1 + wig * 3, Hh * 1.4); c.lineTo(L * .17, Hh * .35); c.closePath(); c.moveTo(-L * .1, Hh * .35); c.quadraticCurveTo(-L * .2, Hh * 1.1, -L * .35 + wig * 3, Hh * 1.3); c.lineTo(-L * .13, Hh * .38); c.closePath(); return true;
      }
      return false;
    }

    // ---------- 花紋（H5：pattern() 開頭；已 clip 在身體內） ----------
    const pcOf = (s, def) => s.patternColor || def;
    function drawPattern(c, f, s, L, Hh, col, name, color) {
      const r = rng((f.seed || 7) * 31 + name.length), n = s.stripeCount;
      switch (name) {
        case 'tigerBars': { const N = n || 4; c.fillStyle = color || '#151515'; for (let i = 0; i < N; i++) { const x = L * .36 - (i + .5) * (L * .82 / N), w = L * (N > 6 ? .035 : .07); c.beginPath(); c.moveTo(x - w + L * .03, -Hh); c.quadraticCurveTo(x + w * .3, 0, x - w - L * .02, Hh); c.lineTo(x + w - L * .02, Hh); c.quadraticCurveTo(x + w * 1.4, 0, x + w + L * .03, -Hh); c.fill(); } break; }
        case 'leopard': { c.fillStyle = color || '#151515'; for (let i = 0; i < 34; i++) { const x = (r() - .5) * L * .95, y = (r() - .5) * Hh * .95, rr = Math.max(.6, Math.min(L, Hh) * (.025 + r() * .035)); c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); } break; }
        case 'reticulate': { c.strokeStyle = color || 'rgba(20,20,20,.6)'; c.lineWidth = Math.max(.6, Hh * .035); const st = Math.max(3, L * .08); c.beginPath(); for (let x = -L; x < L; x += st) { c.moveTo(x, -Hh); c.lineTo(x + Hh * 1.2, Hh); c.moveTo(x, Hh); c.lineTo(x + Hh * 1.2, -Hh); } c.stroke(); break; }
        case 'ocellus': { const N = n || 1; for (let i = 0; i < N; i++) { const x = -L * .3 + (N > 1 ? i * L * .1 : 0), y = N > 1 ? Hh * .15 : 0, rr = Hh * (N > 1 ? .1 : .16); c.fillStyle = color || '#151515'; c.beginPath(); c.arc(x, y, rr * 1.35, 0, 7); c.fill(); if (color && color !== '#111' && color !== '#151515') { c.fillStyle = '#121212'; c.beginPath(); c.arc(x, y, rr * .8, 0, 7); c.fill(); } else { c.strokeStyle = 'rgba(255,240,200,.75)'; c.lineWidth = .8; c.stroke(); } } break; }
        case 'calico': { const cols = [color || 'hsl(5,90%,50%)', s.accentColor || '#151515', color || 'hsl(5,90%,50%)']; for (let i = 0; i < 6; i++) { c.fillStyle = cols[i % 3]; c.beginPath(); c.ellipse((r() - .5) * L * .85, (r() - .6) * Hh * .7, L * (.06 + r() * .1), Hh * (.12 + r() * .16), r() * 3, 0, 7); c.fill(); } c.fillStyle = s.accentColor || '#151515'; for (let i = 0; i < 8; i++) { c.beginPath(); c.arc((r() - .5) * L * .8, (r() - .5) * Hh * .7, .6 + r() * 1.2, 0, 7); c.fill(); } break; }
        case 'lateral': { const N = n || 2; c.fillStyle = color || '#151515'; const th = Math.max(.8, Hh * (N > 3 ? .07 : .1)); for (let i = 0; i < N; i++) { const y = N === 1 ? -Hh * .02 : -Hh * .32 + i * (Hh * .64 / (N - 1)); c.beginPath(); c.moveTo(L * .45, y - th * .3); c.lineTo(-L * .5, y - th * .5); c.lineTo(-L * .5, y + th * .5); c.lineTo(L * .4, y + th * .4); c.fill(); } if (s.accentColor && N === 2) { c.fillStyle = s.accentColor; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(L * .2 - i * L * .25, 0, L * .05, Hh * .08, 0, 0, 7); c.fill(); } } break; }
        case 'mask': { c.fillStyle = color || '#151515'; c.beginPath(); c.moveTo(L * .55, -Hh); c.quadraticCurveTo(L * .14, -Hh * .2, L * .2, Hh); c.lineTo(L * .6, Hh); c.fill(); break; }
        case 'gradient': { const g = c.createLinearGradient(L * .15, 0, -L * .3, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color || '#151515'); c.fillStyle = g; c.fillRect(-L, -Hh, L * 2, Hh * 2); break; }
        case 'belly2': { const g = c.createLinearGradient(0, -Hh * .05, 0, Hh * .5); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.45, color || 'hsla(5,85%,50%,.9)'); g.addColorStop(1, color || 'hsla(5,85%,50%,.9)'); c.fillStyle = g; c.fillRect(-L, -Hh, L * 2, Hh * 2); break; }
        case 'pearl': { c.fillStyle = color || 'rgba(255,255,255,.85)'; const st = Math.max(2.4, Math.min(L, Hh * 2) * .085); for (let y = -Hh * .45, row = 0; y < Hh * .5; y += st, row++) for (let x = -L * .48 + (row % 2) * st * .5; x < L * .42; x += st) { c.beginPath(); c.arc(x + (r() - .5) * st * .3, y, Math.max(.5, st * .2), 0, 7); c.fill(); } break; }
        case 'pearl3': { c.fillStyle = color || '#fff'; for (const [x, y] of [[L * .02, -Hh * .38], [-L * .08, Hh * .1], [L * .12, Hh * .14]]) { c.beginPath(); c.arc(x, y, Hh * .1, 0, 7); c.fill(); } break; }
        case 'pinstripe': { c.strokeStyle = color || 'rgba(20,20,20,.5)'; c.lineWidth = Math.max(.5, Hh * .03); c.beginPath(); for (let y = -Hh * .45; y < Hh * .5; y += Math.max(1.6, Hh * .1)) { c.moveTo(L * .5, y + Hh * .05); c.quadraticCurveTo(0, y - Hh * .04, -L * .5, y); } c.stroke(); break; }
        case 'marble': { c.strokeStyle = color || 'rgba(20,20,20,.6)'; c.lineCap = 'round'; for (let i = 0; i < 7; i++) { c.lineWidth = Math.max(.8, Hh * (.05 + r() * .08)); c.beginPath(); let x = (r() - .5) * L, y = (r() - .5) * Hh; c.moveTo(x, y); for (let k = 0; k < 3; k++) { const nx = x + (r() - .5) * L * .5, ny = y + (r() - .5) * Hh * .6; c.quadraticCurveTo((x + nx) / 2 + (r() - .5) * L * .2, (y + ny) / 2 + (r() - .5) * Hh * .3, nx, ny); x = nx; y = ny; } c.stroke(); } break; }
        case 'saddle': { c.fillStyle = color || '#151515'; if (n === 1 || s.body === 'shrimp') { c.beginPath(); c.moveTo(L * .45, -Hh * .35); c.quadraticCurveTo(0, -Hh * .6, -L * .5, -Hh * .3); c.lineTo(-L * .5, -Hh * .12); c.quadraticCurveTo(0, -Hh * .38, L * .45, -Hh * .18); c.fill(); break; } for (let i = 0; i < 3; i++) { const x = L * .2 - i * L * .27; c.beginPath(); c.ellipse(x, -Hh * .42, L * .09, Hh * .3, 0, 0, 7); c.fill(); } break; }
        case 'bandsShrimp': { c.fillStyle = color || '#fff'; for (let i = 0; i < 3; i++) c.fillRect(L * .25 - i * L * .32, -Hh, L * .14, Hh * 2); break; }
        // ---- 限定魚（寶石）專屬花紋 ----
        case 'galaxy': { const t = T(); const g = c.createLinearGradient(0, -Hh * .5, 0, Hh * .5); g.addColorStop(0, 'rgba(10,8,40,.92)'); g.addColorStop(.6, 'rgba(40,16,90,.82)'); g.addColorStop(1, 'rgba(90,40,150,.55)'); c.fillStyle = g; c.fillRect(-L, -Hh, L * 2, Hh * 2);
          c.save(); c.globalCompositeOperation = 'lighter'; for (const [x, y, rr, h] of [[-L * .18, -Hh * .1, .32, 300], [L * .12, Hh * .12, .26, 190], [-L * .34, Hh * .18, .2, 260]]) { const ng = c.createRadialGradient(x, y, 0, x, y, L * rr); ng.addColorStop(0, `hsla(${(h + t * 20) % 360},90%,60%,.45)`); ng.addColorStop(1, `hsla(${h},90%,50%,0)`); c.fillStyle = ng; c.fillRect(-L, -Hh, L * 2, Hh * 2); }
          for (let i = 0; i < 34; i++) { const x = (r() - .5) * L * .95, y = (r() - .5) * Hh * .95, tw = .4 + .6 * Math.abs(Math.sin(t * (1.5 + r() * 2) + i)); c.fillStyle = `rgba(255,255,255,${tw})`; c.beginPath(); c.arc(x, y, Math.max(.35, Hh * (.012 + r() * .03)), 0, 7); c.fill(); } c.restore(); break; }
        case 'prism': { const t = T(); c.save(); c.globalAlpha *= .5; const w = Math.max(3, L * .12); for (let i = -10; i < 12; i++) { c.fillStyle = `hsl(${(i * 40 + t * 60) % 360},95%,62%)`; c.beginPath(); const x = i * w + (t * 12) % w - L * .2; c.moveTo(x, -Hh); c.lineTo(x + w, -Hh); c.lineTo(x + w - Hh * .8, Hh); c.lineTo(x - Hh * .8, Hh); c.fill(); } c.restore(); break; }
        case 'goldleaf': { const t = T(); for (let i = 0; i < 26; i++) { const x = (r() - .5) * L * .9, y = (r() - .5) * Hh * .85, a = r() * 3, sz = Math.max(.8, Math.min(L, Hh) * (.05 + r() * .06)); c.fillStyle = `hsla(${42 + r() * 10},95%,${55 + 20 * Math.abs(Math.sin(t * 2 + i))}%,.95)`; c.beginPath(); c.moveTo(x + Math.cos(a) * sz, y + Math.sin(a) * sz); c.lineTo(x + Math.cos(a + 2) * sz * .6, y + Math.sin(a + 2) * sz * .6); c.lineTo(x + Math.cos(a + 3.3) * sz, y + Math.sin(a + 3.3) * sz); c.lineTo(x + Math.cos(a + 4.6) * sz * .5, y + Math.sin(a + 4.6) * sz * .5); c.fill(); } break; }
        case 'sakura': { for (let k = 0; k < 7; k++) { const x = (r() - .5) * L * .85, y = (r() - .5) * Hh * .8, R = Math.max(1.2, Hh * (.08 + r() * .06)); c.fillStyle = color || 'hsl(340,90%,86%)'; for (let p = 0; p < 5; p++) { const a = p * 1.2566 + k; c.beginPath(); c.ellipse(x + Math.cos(a) * R * .55, y + Math.sin(a) * R * .55, R * .55, R * .32, a, 0, 7); c.fill(); } c.fillStyle = 'hsl(48,95%,62%)'; c.beginPath(); c.arc(x, y, R * .22, 0, 7); c.fill(); } break; }
        case 'flame': { const t = T(); const g = c.createLinearGradient(-L * .5, 0, L * .2, 0); g.addColorStop(0, 'rgba(255,60,20,.9)'); g.addColorStop(.5, 'rgba(255,150,30,.6)'); g.addColorStop(1, 'rgba(255,220,80,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(-L * .5, -Hh); for (let i = 0; i <= 8; i++) { const y = -Hh + i * Hh * .25; c.lineTo(L * (.02 + .12 * Math.sin(t * 6 + i * 1.7)) - (i % 2) * L * .12, y); } c.lineTo(-L * .5, Hh); c.fill(); break; }
        case 'crystal': { c.strokeStyle = color || 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(.4, Hh * .025); c.beginPath(); const pts = []; for (let i = 0; i < 14; i++) pts.push([(r() - .5) * L * .95, (r() - .5) * Hh * .95]); for (let i = 0; i < pts.length; i++) for (const j of [i + 1, i + 3]) if (pts[j]) { c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[j][0], pts[j][1]); } c.stroke();
          c.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i + 2 < pts.length; i += 3) { c.beginPath(); c.moveTo(...pts[i]); c.lineTo(...pts[i + 1]); c.lineTo(...pts[i + 2]); c.fill(); } break; }
        case 'aurora': { const t = T(); c.save(); c.globalCompositeOperation = 'lighter'; for (let b = 0; b < 3; b++) { c.fillStyle = `hsla(${[150, 185, 280][b]},95%,60%,.33)`; c.beginPath(); c.moveTo(-L, Hh); for (let x = -L * .55; x <= L * .55; x += L * .05) c.lineTo(x, -Hh * .3 + b * Hh * .22 + Math.sin(x / L * 7 + t * 1.6 + b * 2) * Hh * .14); c.lineTo(L, Hh); c.closePath(); c.fill(); } c.restore(); break; }
        case 'starlight': { const t = T(); c.fillStyle = 'rgba(220,235,255,.25)'; c.fillRect(-L, -Hh, L * 2, Hh * 2); for (let i = 0; i < 9; i++) { const x = (r() - .5) * L * .85, y = (r() - .5) * Hh * .8, tw = Math.abs(Math.sin(t * 2.2 + i * 1.3)); star4(c, x, y, Math.max(1, Hh * (.06 + r() * .06)) * (.5 + tw * .8), `rgba(255,255,255,${.5 + tw * .5})`); } break; }
        default: return false;
      }
      return true;
    }
    function star4(c, x, y, R, fill) { c.fillStyle = fill; c.beginPath(); c.moveTo(x, y - R); c.quadraticCurveTo(x, y, x + R, y); c.quadraticCurveTo(x, y, x, y + R); c.quadraticCurveTo(x, y, x - R, y); c.quadraticCurveTo(x, y, x, y - R); c.fill(); }
    function pattern(c, f, s, L, Hh, col) {
      if (s._patA != null) c.globalAlpha *= s._patA; // 成長階段：幼魚花紋淡、亞成一半（drawFish 的 clip save/restore 會還原）
      if (s.transparent) { // 透明魚：脊椎與內臟
        c.strokeStyle = 'rgba(40,60,80,.35)'; c.lineWidth = Math.max(.6, Hh * .05); c.beginPath(); c.moveTo(L * .3, -Hh * .05); c.lineTo(-L * .45, -Hh * .02); c.stroke();
        c.lineWidth = .5; c.beginPath(); for (let x = L * .2; x > -L * .4; x -= L * .06) { c.moveTo(x, -Hh * .05); c.lineTo(x - L * .03, -Hh * .35); c.moveTo(x, -Hh * .03); c.lineTo(x - L * .03, Hh * .3); } c.stroke();
        c.fillStyle = 'rgba(120,130,150,.45)'; c.beginPath(); c.ellipse(L * .14, Hh * .12, L * .1, Hh * .16, 0, 0, 7); c.fill();
      }
      return EXT_PATTERNS.includes(s.pattern) && drawPattern(c, f, s, L, Hh, col, s.pattern, s.patternColor);
    }
    function pattern2(c, f, s, L, Hh, col) { // H5b：在原本 switch 之後、鱗光之前疊第二層花紋
      if (s.pattern2 && EXT_PATTERNS.includes(s.pattern2)) drawPattern(c, f, s, L, Hh, col, s.pattern2, s.pattern2Color);
      if (s.shimmer) { // 限定魚：流光掃過身體
        const t = T(), sx = (((t * .55 + ((f.seed || 0) % 13) * .17) % 1.8) - .5) * L * 1.6, w = L * .22; c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
        const g = c.createLinearGradient(sx - w, -Hh * .3, sx + w, Hh * .3); const sc = s.shimmerHue != null ? `hsla(${(s.shimmerHue + t * (s.hueCycle ? 30 : 0)) % 360},100%,86%,` : 'rgba(255,250,220,';
        g.addColorStop(0, sc + '0)'); g.addColorStop(.5, sc + (s._stage === 0 ? '.25)' : '.55)')); g.addColorStop(1, sc + '0)'); c.fillStyle = g; c.fillRect(-L, -Hh, L * 2, Hh * 2); c.restore(); }
    }

    // ---------- 眼睛前（H6）：頭瘤、望遠眼、水泡、大胸鰭、眼罩；回傳新的眼睛位置 ----------
    function eyes(c, f, s, L, Hh, col, er, ex, ey) {
      let o = null;
      if (s.body === 'pleco' || s.body === 'catfish') o = { er: er * .8, ex: L * .3, ey: -Hh * .2 };
      else if (s.body === 'arowana') o = { er, ex: L * .36, ey: -Hh * .12 };
      else if (s.body === 'disc') o = { er: er * .8, ex: L * .33, ey: -Hh * .1 };
      else if (s.body === 'elongated' || s.body === 'torpedo') o = { er, ex: L * .34, ey: -Hh * .1 };
      if (s.mouth === 'beak') o = { er: er * .9, ex: L * .22, ey: -Hh * .1 };
      const E = o || { er, ex, ey };
      if (s.eyes === 'none') E.er = .01;
      if (s.eyes === 'telescope') { E.er *= 1.25; E.ex += er * .5; E.ey -= er * .4; c.fillStyle = col.main; c.beginPath(); c.ellipse(E.ex - er * .4, E.ey + er * .2, E.er * 1.25, E.er * 1.1, 0, 0, 7); c.fill(); }
      if (s.eyes === 'celestial') { E.ey -= er * .6; E.er *= 1.15; c.fillStyle = col.main; c.beginPath(); c.ellipse(E.ex, E.ey + er * .3, E.er * 1.2, E.er * 1.2, 0, 0, 7); c.fill(); }
      if (s.eyes === 'bubble') { const g = c.createRadialGradient(E.ex - 2, E.ey + er * 1.6, 1, E.ex, E.ey + er * 1.9, er * 2.1); g.addColorStop(0, 'rgba(255,255,255,.7)'); g.addColorStop(.6, `hsla(${col.h},60%,80%,.55)`); g.addColorStop(1, `hsla(${col.h},60%,60%,.75)`); c.fillStyle = g; c.beginPath(); c.ellipse(E.ex - er * .3, E.ey + er * 1.9, er * 2, er * 1.6, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = .6; c.stroke(); }
      if (s.eyes === 'mask') { c.fillStyle = 'rgba(15,15,20,.85)'; c.beginPath(); c.ellipse(E.ex, E.ey, E.er * 1.9, E.er * 1.7, 0, 0, 7); c.fill(); }
      if (s.head === 'wen') { c.fillStyle = s.accentColor || col.light; const r = rng(f.seed || 5); for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(L * (.2 + r() * .26), -Hh * (.22 + r() * .26), Hh * (.08 + r() * .07), 0, 7); c.fill(); } c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = .5; c.stroke(); }
      if (s.head === 'hump') { c.fillStyle = col.main; c.beginPath(); const hk = s._headK || 1; c.ellipse(L * .26, -Hh * (.38 + .1 * (1 - hk)), L * .17 * hk, Hh * .28 * hk, -.35, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.ellipse(L * .24, -Hh * (.5 + .1 * (1 - hk)), L * .09 * hk, Hh * .1 * hk, -.35, 0, 7); c.fill(); }
      if (s.head === 'dot') { c.fillStyle = s.accentColor || 'hsl(0,95%,48%)'; c.beginPath(); c.ellipse(L * .3, -Hh * .3, L * .07, Hh * .16, 0, 0, 7); c.fill(); }
      if (s.pectoral === 'big' || s.pectoral === 'wing') { const ph = f.phase || 0, wing = s.pectoral === 'wing'; c.save(); c.translate(L * .08, Hh * .1); c.rotate(.35 + Math.sin(ph * 1.6) * .3 - (wing ? .7 : 0)); c.fillStyle = s.accentColor || col.finA(.7); c.beginPath(); c.ellipse(-L * .18, 0, L * (wing ? .28 : .22), Hh * (wing ? .25 : .38), 0, 0, 7); c.fill(); c.restore(); }
      if (s.feelers) { const ph = f.phase || 0; c.strokeStyle = s.tailColor || col.finA(.8); c.lineWidth = .7; c.beginPath(); c.moveTo(L * .14, Hh * .38); c.quadraticCurveTo(-L * .05, Hh * 1.1, -L * .3 + Math.sin(ph) * 3, Hh * 1.2); c.moveTo(L * .12, Hh * .38); c.quadraticCurveTo(-L * .1, Hh * .9, -L * .35 + Math.sin(ph + 1) * 3, Hh * 1.05); c.stroke(); }
      lastE = E; return (o || s.eyes || s.head) ? E : null;
    }

    // ---------- 嘴（H7）：回傳 true 則略過原本的嘴 ----------
    function mouth(c, f, s, L, Hh, col) {
      if (!EXT_MOUTHS.includes(s.mouth)) return false;
      const mo = (f.chomp || 0) * 2, dk = `hsla(${col.h},${s.sat}%,${Math.max(5, s.lit - 30)}%,.8)`;
      c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.4)';
      switch (s.mouth) {
        case 'up': c.beginPath(); c.moveTo(L * .5, -Hh * .3 - mo); c.lineTo(L * .36, -Hh * .12); c.stroke(); break;
        case 'under': c.beginPath(); c.moveTo(L * .44, Hh * .2); c.quadraticCurveTo(L * .38, Hh * .28 + mo, L * .32, Hh * .22); c.stroke(); break;
        case 'sucker': c.fillStyle = dk; c.beginPath(); c.ellipse(L * .4, Hh * .44, L * .07, Hh * .08 + mo * .3, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.stroke(); break;
        case 'beak': c.fillStyle = col.main; c.beginPath(); c.moveTo(L * .34, -Hh * .2); c.lineTo(L * .95, -Hh * .02); c.lineTo(L * .95, Hh * .04); c.lineTo(L * .34, Hh * .2); c.fill(); c.beginPath(); c.moveTo(L * .4, Hh * .0); c.lineTo(L * .94, Hh * .01 + mo); c.stroke(); if (/gar/.test(s.id || '')) { c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = .5; c.beginPath(); for (let x = L * .45; x < L * .9; x += L * .05) { c.moveTo(x, Hh * .0); c.lineTo(x + L * .015, Hh * .05); } c.stroke(); } break;
        case 'snout': c.fillStyle = col.main; c.beginPath(); c.moveTo(L * .4, -Hh * .12); c.lineTo(L * .62, -Hh * .02); c.lineTo(L * .62, Hh * .05); c.lineTo(L * .4, Hh * .14); c.fill(); c.beginPath(); c.moveTo(L * .62, 0); c.lineTo(L * .5, Hh * .02 + mo); c.stroke(); break;
        case 'lips': c.fillStyle = `hsl(${col.h},${Math.min(90, s.sat + 10)}%,${Math.min(80, s.lit + 10)}%)`; c.beginPath(); c.ellipse(L * .48, Hh * .02 - mo * .5, L * .05, Hh * .07, 0, 0, 7); c.ellipse(L * .48, Hh * .14 + mo * .5, L * .05, Hh * .07, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.25)'; c.stroke(); break;
        case 'jaw': c.fillStyle = 'rgba(30,10,10,.6)'; c.beginPath(); c.moveTo(L * .5, Hh * .02 - mo); c.lineTo(L * .3, Hh * .1); c.lineTo(L * .5, Hh * .2 + mo); c.fill(); c.fillStyle = '#fff'; c.beginPath(); for (let i = 0; i < 4; i++) { const x = L * (.48 - i * .045); c.moveTo(x, Hh * .03 - mo); c.lineTo(x - L * .012, Hh * .09); c.lineTo(x - L * .025, Hh * .03 - mo); c.moveTo(x, Hh * .19 + mo); c.lineTo(x - L * .012, Hh * .12); c.lineTo(x - L * .025, Hh * .19 + mo); } c.fill(); break;
        case 'trunk': c.strokeStyle = col.main; c.lineCap = 'round'; c.lineWidth = Math.max(2, Hh * .16); c.beginPath(); c.moveTo(L * .45, Hh * .15); c.quadraticCurveTo(L * .7, Hh * .2, L * .72, Hh * .55 + Math.sin((f.phase || 0) * .7) * 2); c.stroke(); c.lineCap = 'butt'; break;
        case 'o': c.fillStyle = 'rgba(60,10,10,.7)'; c.beginPath(); c.ellipse(L * .47, Hh * .08, L * .035, Hh * .07 + mo * .3, 0, 0, 7); c.fill(); c.strokeStyle = col.light; c.lineWidth = 1.2; c.stroke(); break;
        case 'pompom': c.beginPath(); c.moveTo(L * .47, Hh * .04 - mo); c.lineTo(L * .4, Hh * .08); c.lineTo(L * .47, Hh * .1 + mo); c.stroke(); { const r = rng(f.seed || 9); for (const [px, py] of [[L * .42, -Hh * .1], [L * .47, -Hh * .04]]) for (let i = 0; i < 9; i++) { c.fillStyle = `hsla(${(s.accentColor ? 0 : 5)},90%,${50 + r() * 15}%,.95)`; c.beginPath(); c.arc(px + (r() - .5) * Hh * .2, py + (r() - .5) * Hh * .2, Hh * .05, 0, 7); c.fill(); } } break;
        case 'barbel1': c.beginPath(); c.moveTo(L * .47, Hh * .04 - mo); c.lineTo(L * .4, Hh * .08); c.lineTo(L * .47, Hh * .1 + mo); c.stroke(); c.strokeStyle = col.dark; c.beginPath(); c.moveTo(L * .44, Hh * .14); c.quadraticCurveTo(L * .48, Hh * .3, L * .45, Hh * .45); c.stroke(); break;
      }
      return true;
    }

    // ---------- 最後疊加（H8）：鬍鬚、棘刺、虹膜顏色、發光、鰭損傷、被咬閃紅 ----------
    function after(c, f, s, L, Hh, col, ph, wig) {
      const t = T();
      if (s.whiskers && s.whiskers !== 'none') {
        c.strokeStyle = s.body === 'catfish' || s.whiskers === 'long' ? col.dark : `hsl(${col.h},30%,40%)`; c.lineWidth = Math.min(s.whiskers === 'long' ? 1.1 : .9, Math.max(.35, Hh * .05)); c.beginPath();
        const mx = s.body === 'pleco' ? L * .42 : L * .48, my = s.body === 'pleco' ? Hh * .4 : Hh * .1;
        if (s.whiskers === 'bristle') { for (let i = 0; i < 6; i++) { const a = -1.2 + i * .45; c.moveTo(L * .44, -Hh * .1 + i * Hh * .08); c.lineTo(L * .44 + Math.cos(a) * L * .1, -Hh * .1 + i * Hh * .08 + Math.sin(a) * Hh * .12); } }
        else { const len = s.whiskers === 'long' ? L * .55 : L * .1, dr = s.whiskers === 'long' ? 1 : .45; for (const [dy, k] of [[0, 1], [Hh * .06, .8], [Hh * .1, .55]]) { c.moveTo(mx, my + dy); c.quadraticCurveTo(mx + len * .5 * k, my + dy + Hh * .25 * dr, mx + len * k + wig * dr, my + dy + Hh * (.25 + .3 * k) * dr); } if (s.whiskers === 'long') { c.moveTo(mx - L * .05, my - Hh * .05); c.quadraticCurveTo(mx + len * .3, my - Hh * .6, mx + len * .75 + wig * 2, my - Hh * .3); } }
        c.stroke();
      }
      if (s.spikes && s.body !== 'snail') {
        c.strokeStyle = `hsla(${col.h},30%,${Math.max(15, s.lit - 35)}%,.85)`; c.lineWidth = .8; c.beginPath();
        if (s.puffs || s.body === 'round') { const pf = f.puff || 0, rx = L * .46 * (1 + pf * .25), ry = Hh * .5 * (1 + pf * .45); for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2, len = 1.5 + pf * 4; c.moveTo(Math.cos(a) * rx * .96, Math.sin(a) * ry * .96); c.lineTo(Math.cos(a) * (rx + len), Math.sin(a) * (ry + len)); } }
        else { c.moveTo(L * .2, -Hh * .1); c.lineTo(L * .1, -Hh * .2); c.moveTo(L * .2, Hh * .05); c.lineTo(L * .08, Hh * .02); }
        c.stroke();
      }
      if (IRIS[s.eyes] && lastE) { const E = lastE;
        c.strokeStyle = IRIS[s.eyes]; c.lineWidth = Math.max(.6, E.er * .32); c.beginPath(); c.arc(E.ex + E.er * .2, E.ey, E.er * .62, 0, 7); c.stroke(); }
      if (!SPRITE) liveFx(c, f, s, L, Hh, col, t);
      finDamage(c, f, s, L, Hh);
      if (!SPRITE && f.hitT > 0) { c.save(); c.globalAlpha = Math.min(.5, f.hitT); c.fillStyle = '#ff3b3b'; c.beginPath(); c.ellipse(0, 0, L * .45, Hh * .45, 0, 0, 7); c.fill(); c.restore(); }
    }
    // 外圈光暈／限定魚光環／受傷閃紅：用 lighter 疊在背景上，快取精靈圖時改成每格即時畫（見 index.html 精靈快取）
    function liveFx(c, f, s, L, Hh, col, t) {
      if (s.glow) { c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(0, 0, 0, 0, 0, L * .7); g.addColorStop(0, `hsla(${col.h},90%,70%,${.14 + .06 * Math.sin(t * 2 + (f.seed || 0))})`); g.addColorStop(1, `hsla(${col.h},90%,70%,0)`); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, L * .7, Math.max(Hh, L * .3) * .9, 0, 0, 7); c.fill(); c.restore(); }
      if (s.aura) { // 限定魚：外圈光暈＋環繞星光
        const t = T(), k = s._stage === 0 ? .5 : 1; c.save(); c.globalCompositeOperation = 'lighter'; const R = Math.max(L * .62, Hh * .9), ac = s.auraColor || `hsl(${col.h},95%,70%)`;
        const g = c.createRadialGradient(0, 0, R * .2, 0, 0, R); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.6, withA(ac, (.16 + .08 * Math.sin(t * 2.4 + (f.seed || 0))) * k)); g.addColorStop(1, withA(ac, 0)); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, R, R * .75, 0, 0, 7); c.fill();
        for (let i = 0; i < 4; i++) { const a = t * 1.3 + i * 1.571 + (f.seed || 0), tw = Math.abs(Math.sin(t * 3 + i)); star4(c, Math.cos(a) * R * .85, Math.sin(a) * R * .55, Math.max(1, Hh * .1) * (.4 + tw) * k, `rgba(255,255,240,${.35 + tw * .55})`); }
        c.restore(); }
    }
    let SPRITE = false;
    const setSprite = (b) => { SPRITE = !!b; };
    // 精靈快取模式下每格即時畫的部分（光暈、光環、受傷閃紅）；回傳是否有東西要畫
    function fxLive(c, f, s0, col) { const s = view(s0, f), L = s.len, Hh = s.ht; if (!(s.glow || s.aura || f.hitT > 0)) return false;
      liveFx(c, f, s, L, Hh, col, T());
      if (f.hitT > 0) { c.save(); c.globalAlpha = Math.min(.5, f.hitT); c.fillStyle = '#ff3b3b'; c.beginPath(); c.ellipse(0, 0, L * .45, Hh * .45, 0, 0, 7); c.fill(); c.restore(); }
      return true; }
    function finDamage(c, f, s, L, Hh) {
      const d = f.finDmg || 0; if (d < .05) return;
      const r = rng((f.seed || 3) * 7), N = 1 + Math.round(d * 5);
      c.save(); c.fillStyle = 'rgba(150,30,30,.55)'; c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = .5;
      for (let i = 0; i < N; i++) { // 尾鰭缺口
        const y = (r() - .5) * Hh * .9, x = -L * (.62 + r() * .15);
        c.beginPath(); c.moveTo(x, y - 2); c.lineTo(x + L * .08, y); c.lineTo(x, y + 2); c.fill(); c.stroke();
      }
      if (d > .4) for (let i = 0; i < N - 1; i++) { const x = L * .1 - r() * L * .35; c.beginPath(); c.moveTo(x - 2, -Hh * .75); c.lineTo(x, -Hh * .48); c.lineTo(x + 2, -Hh * .75); c.fill(); }
      c.restore();
    }

    // ---------- 特殊身體（H1：drawFish 開頭）：鰻、魟、蟹、螯蝦、螺、海馬、擴充蝦 ----------
    function sickTint(c, f, L, Hh) { if (f.sick) { c.fillStyle = 'rgba(120,200,90,.35)'; c.beginPath(); c.ellipse(0, 0, L * .45, Hh * .45, 0, 0, 7); c.fill(); } }
    function eyeDot(c, x, y, r, s) { r *= .8; c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.arc(x, y, r * 1.2, 0, 7); c.fill(); const g = c.createRadialGradient(x - r * .2, y - r * .2, r * .1, x, y, r); g.addColorStop(0, IRIS[s.eyes] || '#6b5a3a'); g.addColorStop(1, '#0a0a0a'); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.fillStyle = '#030507'; c.beginPath(); c.arc(x + r * .12, y, r * .55, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(x + r * .32, y - r * .28, Math.max(.3, r * .18), 0, 7); c.fill(); }
    function bodyFill(c, col, s, sil, Hh) { if (sil) return SIL; const g = c.createLinearGradient(0, -Hh * .5, 0, Hh * .5); g.addColorStop(0, col.deep || col.dark); g.addColorStop(.22, col.dark); g.addColorStop(.5, col.main); g.addColorStop(.82, col.light); g.addColorStop(1, col.dark); return g; }
    function clipPattern(c, f, s, L, Hh, col, pathFn) { c.save(); pathFn(); c.clip(); if (api.pattern) api.pattern(c, f, s, L, Hh, col); else pattern(c, f, s, L, Hh, col); volume(c, f, s, L, Hh, pathFn); c.restore(); }

    function drawEel(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = (f.phase || 0), N = 26, top = [], bot = [];
      for (let i = 0; i <= N; i++) { const u = i / N, x = L * .5 - u * L * 1.05, amp = Hh * .9 * u, y = Math.sin(ph * .8 - u * 5) * amp, w = Hh * .5 * (u < .12 ? .75 + u * 2 : 1 - (u - .12) * .8); top.push([x, y - w]); bot.push([x, y + w]); }
      const path = () => { c.beginPath(); c.moveTo(top[0][0] + Hh * .2, top[0][1] + Hh * .5); top.forEach(p => c.lineTo(p[0], p[1])); for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]); c.closePath(); };
      if (s.fins !== 'none') { c.fillStyle = sil ? SIL : col.finA(.55); c.beginPath(); c.moveTo(top[4][0], top[4][1]); for (let i = 4; i <= N; i++) c.lineTo(top[i][0], top[i][1] - Hh * (s.fins === 'finlets' ? (i % 3 === 0 ? .5 : .15) : .28)); for (let i = N; i >= 4; i--) c.lineTo(top[i][0], top[i][1] + 1); c.fill(); c.beginPath(); c.moveTo(bot[12][0], bot[12][1]); for (let i = 12; i <= N; i++) c.lineTo(bot[i][0], bot[i][1] + Hh * .25); for (let i = N; i >= 12; i--) c.lineTo(bot[i][0], bot[i][1] - 1); c.fill(); }
      path(); c.fillStyle = bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      clipPattern(c, f, s, L, Hh, col, path);
      path(); c.strokeStyle = `hsla(${col.h},${s.sat}%,${Math.max(5, s.lit - 30)}%,.5)`; c.lineWidth = .8; c.stroke();
      const hx = L * .36, hy = top[2][1] + Hh * .3; eyeDot(c, hx, hy, Math.max(1.6, Hh * .16 * (s.eyeScale || 1)), s);
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.moveTo(L * .5, hy + Hh * .2); c.lineTo(L * .38, hy + Hh * .3); c.stroke();
      if (s.mouth === 'jaw') { c.fillStyle = '#fff'; c.beginPath(); for (let i = 0; i < 3; i++) { const x = L * (.48 - i * .035); c.moveTo(x, hy + Hh * .22); c.lineTo(x - 1, hy + Hh * .32); c.lineTo(x - 2, hy + Hh * .22); } c.fill(); }
      if (s.whiskers === 'long' || s.whiskers === 'short') { c.strokeStyle = s.glow ? 'hsl(45,90%,70%)' : col.dark; c.lineWidth = 1; c.beginPath(); const k = s.whiskers === 'long' ? 1 : .4; c.moveTo(L * .48, hy + Hh * .1); c.quadraticCurveTo(L * .7 * k + L * .4, hy - Hh * .5, L * .55 + L * .5 * k + Math.sin(ph) * 3, hy - Hh * (1.2 * k)); c.moveTo(L * .48, hy + Hh * .2); c.quadraticCurveTo(L * .7 * k + L * .4, hy + Hh * .8, L * .55 + L * .5 * k + Math.sin(ph + 1) * 3, hy + Hh * (1.3 * k)); c.stroke(); }
      if (s.glow) after(c, f, Object.assign({}, s, { whiskers: null, spikes: null, eyes: null }), L, Hh, col, ph, 0); else finDamage(c, f, s, L, Hh);
      sickTint(c, f, L, Hh); return true;
    }
    function drawRay(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, rx = L * .42, ry = Hh * .48;
      c.strokeStyle = sil ? SIL : col.dark; c.lineWidth = Math.max(1.2, Hh * .06); c.lineCap = 'round'; c.beginPath(); c.moveTo(-rx * .8, 0); c.quadraticCurveTo(-L * .65, Math.sin(ph) * Hh * .1, -L * .9, Math.sin(ph - 1) * Hh * .15); c.stroke(); c.lineCap = 'butt';
      const path = () => { c.beginPath(); const N = 40; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, w = 1 + .05 * Math.sin(a * 3 + ph * 2) * Math.abs(Math.sin(a)); const x = Math.cos(a) * rx * w, y = Math.sin(a) * ry * w; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
      path(); c.fillStyle = bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      clipPattern(c, f, s, L, Hh, col, path); path(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = .8; c.stroke();
      const g = c.createRadialGradient(rx * .2, -ry * .3, 0, 0, 0, rx); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; path(); c.fill();
      for (const dy of [-ry * .28, ry * .02]) { c.fillStyle = col.dark; c.beginPath(); c.ellipse(rx * .5, dy, Hh * .07, Hh * .06, 0, 0, 7); c.fill(); eyeDot(c, rx * .5, dy - Hh * .02, Math.max(1.2, Hh * .045), s); }
      finDamage(c, f, s, L, Hh); sickTint(c, f, L, Hh); return true;
    }
    function legs(c, L, Hh, ph, n, col, sil, ox, oy, spread) {
      c.strokeStyle = sil ? SIL : col.dark; c.lineWidth = Math.max(.5, Math.min(1.4, Hh * .035)); c.lineCap = 'round';
      for (const side of [-1, 1]) for (let i = 0; i < n; i++) { const a = Math.sin(ph * 2 + i * 1.3 + (side > 0 ? 1.5 : 0)) * Hh * .04, x0 = ox + side * L * (.06 + i * .07) * spread, y0 = oy; const kx = x0 + side * L * (.12 + i * .03) * spread, ky = y0 - Hh * .12 + a; c.beginPath(); c.moveTo(x0, y0); c.lineTo(kx, ky); c.lineTo(kx + side * L * .07 * spread, y0 + Hh * .3); c.stroke(); }
      c.lineCap = 'butt';
    }
    function claw(c, x, y, sz, dir, col, sil, ph) {
      c.save(); c.translate(x, y); c.rotate(dir); c.fillStyle = sil ? SIL : col; c.beginPath(); c.ellipse(0, 0, sz, sz * .55, 0, 0, 7); c.fill();
      const open = .25 + .15 * Math.sin(ph * 1.5); c.beginPath(); c.moveTo(sz * .6, -sz * .2); c.quadraticCurveTo(sz * 1.5, -sz * (.5 + open), sz * 1.6, -sz * .05); c.lineTo(sz * .8, 0); c.closePath(); c.moveTo(sz * .6, sz * .2); c.quadraticCurveTo(sz * 1.4, sz * (.4 + open * .5), sz * 1.45, sz * .1); c.lineTo(sz * .8, 0); c.closePath(); c.fill(); c.restore();
    }
    function drawCrab(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, cw = L * .34, ch = Hh * .48;
      legs(c, L, Hh, ph, 3, col, sil, 0, Hh * .1, 1.1);
      const cc = s.accentColor || col.main, cs = Math.min(L * .13, Hh * .3); claw(c, cw * 1.05, -ch * .35, cs, -.9, cc, sil, ph); claw(c, -cw * 1.05, -ch * .35, cs, Math.PI + .9, cc, sil, ph + 1);
      const path = () => { c.beginPath(); c.moveTo(-cw, Hh * .05); c.quadraticCurveTo(-cw * 1.05, -ch * 1.1, 0, -ch); c.quadraticCurveTo(cw * 1.05, -ch * 1.1, cw, Hh * .05); c.quadraticCurveTo(0, ch * .6, -cw, Hh * .05); c.closePath(); };
      path(); c.fillStyle = bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      clipPattern(c, f, s, L, Hh, col, path); path(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = .7; c.stroke();
      c.strokeStyle = col.dark; c.lineWidth = Math.max(.5, Hh * .03); for (const x of [-cw * .25, cw * .25]) { c.beginPath(); c.moveTo(x, -ch * .9); c.lineTo(x * 1.15, -ch * 1.25); c.stroke(); c.fillStyle = s.eyes === 'yellow' ? '#ffd21a' : '#111'; c.beginPath(); c.arc(x * 1.15, -ch * 1.3, Math.max(.8, Hh * .055), 0, 7); c.fill(); }
      finDamage(c, f, s, L, Hh); sickTint(c, f, L, Hh); return true;
    }
    function drawCrayfish(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, body = sil ? SIL : `hsl(${col.h},${s.sat}%,${s.lit}%)`, edge = sil ? SIL_EDGE : `hsla(${col.h},${s.sat}%,${Math.max(8, s.lit - 25)}%,.85)`;
      c.strokeStyle = edge; c.lineWidth = .7; c.beginPath(); c.moveTo(L * .4, -Hh * .2); c.quadraticCurveTo(L * .9, -Hh * 1.3, L * 1.25 + Math.sin(ph * .7) * 3, -Hh * .9); c.moveTo(L * .4, -Hh * .1); c.quadraticCurveTo(L * .85, -Hh * .9, L * 1.2, -Hh * .2 + Math.sin(ph * .9) * 2); c.stroke();
      c.lineWidth = .9; for (let i = 0; i < 4; i++) { const x = L * .25 - i * L * .08, a = Math.sin(ph * 2 + i) * 2; c.beginPath(); c.moveTo(x, Hh * .2); c.lineTo(x + a, Hh * .6); c.stroke(); }
      const cc = s.accentColor || body, cs = L * .12; c.strokeStyle = sil ? SIL : body; c.lineWidth = Math.max(1, Hh * .1); c.beginPath(); c.moveTo(L * .38, Hh * .1); c.lineTo(L * .55, Hh * .02); c.moveTo(L * .36, Hh * .2); c.lineTo(L * .52, Hh * .28); c.stroke(); claw(c, L * .6, Hh * .0, cs, -.15, cc, sil, ph); claw(c, L * .57, Hh * .3, cs * .9, .25, cc, sil, ph + 1);
      c.fillStyle = body; c.beginPath(); c.moveTo(-L * .42, 0); c.lineTo(-L * .62, -Hh * .45); c.quadraticCurveTo(-L * .7, 0, -L * .62, Hh * .45); c.closePath(); c.fill();
      for (let i = 5; i >= 0; i--) { const x = -L * .1 - i * L * .065, ry = Hh * (.4 - i * .03); c.fillStyle = body; c.beginPath(); c.ellipse(x, -Hh * .03, L * .07, ry, 0, 0, 7); c.fill(); c.strokeStyle = edge; c.lineWidth = .6; c.stroke(); }
      const path = () => { c.beginPath(); c.ellipse(L * .18, -Hh * .05, L * .27, Hh * .42, 0, 0, 7); };
      path(); c.fillStyle = sil ? SIL : bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) return true;
      clipPattern(c, f, s, L, Hh, col, path); path(); c.strokeStyle = edge; c.stroke();
      c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.ellipse(L * .15, -Hh * .25, L * .17, Hh * .07, 0, 0, 7); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.arc(L * .42, -Hh * .22, Math.max(1.3, Hh * .1), 0, 7); c.fill();
      if (s.glow) after(c, f, Object.assign({}, s, { whiskers: null, spikes: null }), L, Hh, col, ph, 0); else finDamage(c, f, s, L, Hh);
      sickTint(c, f, L, Hh); return true;
    }
    function drawSnail(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, foot = sil ? SIL : `hsla(${s.hermit ? 20 : 40},${s.hermit ? 60 : 20}%,${s.hermit ? 55 : 72}%,.95)`;
      if (s.hermit) { const lc = sil ? SIL : (s.accentColor || 'hsl(10,60%,40%)'); c.strokeStyle = lc; c.lineWidth = Math.max(.6, L * .04); c.lineCap = 'round'; for (let i = 0; i < 3; i++) { const x0 = L * (.12 + i * .06), a = Math.sin(ph * 2 + i) * L * .02; c.beginPath(); c.moveTo(x0, Hh * .1); c.lineTo(x0 + L * .14 + a, Hh * .05); c.lineTo(x0 + L * .2, Hh * .5); c.stroke(); } c.lineCap = 'butt'; claw(c, L * .36, -Hh * .05, L * .09, .1, lc, sil, ph); c.fillStyle = sil ? SIL : 'hsl(20,40%,55%)'; c.beginPath(); c.ellipse(L * .22, -Hh * .1, L * .1, Hh * .2, 0, 0, 7); c.fill(); c.strokeStyle = sil ? SIL : '#333'; c.lineWidth = Math.max(.4, L * .02); c.beginPath(); c.moveTo(L * .26, -Hh * .25); c.lineTo(L * .3, -Hh * .6); c.moveTo(L * .23, -Hh * .25); c.lineTo(L * .22, -Hh * .62); c.stroke(); c.fillStyle = '#111'; c.beginPath(); c.arc(L * .3, -Hh * .62, Math.max(.5, L * .025), 0, 7); c.arc(L * .22, -Hh * .64, Math.max(.5, L * .025), 0, 7); c.fill(); }
      else {
        c.fillStyle = foot; c.beginPath(); c.moveTo(-L * .42, Hh * .4); c.quadraticCurveTo(0, Hh * .22, L * .36, Hh * .28); c.quadraticCurveTo(L * .46, Hh * .42, L * .3, Hh * .5); c.lineTo(-L * .38, Hh * .5); c.closePath(); c.fill();
        c.strokeStyle = foot; c.lineWidth = Math.max(.5, Hh * .06); c.lineCap = 'round'; c.beginPath(); c.moveTo(L * .34, Hh * .3); c.quadraticCurveTo(L * .44, Hh * .1, L * .48 + Math.sin(ph * .8), -Hh * .05); c.moveTo(L * .3, Hh * .3); c.quadraticCurveTo(L * .36, Hh * .12, L * .36, Hh * .0); c.stroke(); c.lineCap = 'butt';
      }
      const R = Math.max(Hh * .5, L * (s.hermit ? .32 : .28)), cx = s.hermit ? -L * .08 : -L * .1, cy = Hh * .45 - R * .95;
      const path = s.coneShell ? () => { c.beginPath(); c.moveTo(L * .2, Hh * .3); c.quadraticCurveTo(L * .15, -Hh * .3, -L * .1, -Hh * .5); c.lineTo(-L * .55, -Hh * .1); c.quadraticCurveTo(-L * .3, Hh * .35, L * .2, Hh * .3); c.closePath(); } : () => { c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); };
      path(); c.fillStyle = bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      c.save(); path(); c.clip();
      if (s.pattern === 'lateral') { c.strokeStyle = s.patternColor || '#151515'; c.lineWidth = Math.max(.8, R * .14); const N = s.stripeCount || 5; c.beginPath(); if (s.coneShell) { for (let i = 0; i < N; i++) { const x = L * .15 - i * L * .14; c.moveTo(x, Hh * .4); c.lineTo(x - L * .08, -Hh * .5); } } else for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2 + .3; c.moveTo(cx, cy); c.quadraticCurveTo(cx + Math.cos(a + .6) * R * .8, cy + Math.sin(a + .6) * R * .8, cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2); } c.stroke(); }
      else if (api.pattern && s.pattern !== 'sheen') api.pattern(c, f, s, L, Hh, col);
      c.restore();
      c.strokeStyle = `hsla(${col.h},${s.sat}%,${Math.max(8, s.lit - 30)}%,.75)`; c.lineWidth = .8;
      if (!s.coneShell) { c.beginPath(); for (let a = 0; a < 12; a += .2) { const rr = R * (1 - a / 13), x = cx + Math.cos(a + 1) * rr * .85, y = cy + Math.sin(a + 1) * rr * .85; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
      path(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.ellipse(cx + R * .2, cy - R * .5, R * .35, R * .12, -.4, 0, 7); c.fill();
      if (s.spikes) { c.fillStyle = col.dark; for (let i = 0; i < 5; i++) { const a = -Math.PI * .9 + i * .35, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; c.beginPath(); c.moveTo(x - 1.2, y); c.lineTo(x + Math.cos(a) * R * .45, y + Math.sin(a) * R * .45); c.lineTo(x + 1.2, y); c.fill(); } }
      if (!s.hermit) { c.fillStyle = '#111'; c.beginPath(); c.arc(L * .33, Hh * .3, Math.max(.5, Hh * .05), 0, 7); c.fill(); }
      sickTint(c, f, L, Hh); return true;
    }
    function drawSeahorse(c, f, s, col, sil) {
      const L = s.len, H = L, W = s.ht, ph = f.phase || 0;
      const path = () => { c.beginPath(); c.moveTo(H * .05, -H * .42); c.quadraticCurveTo(H * .3, -H * .44, H * .42, -H * .36); c.lineTo(H * .42, -H * .31); c.quadraticCurveTo(H * .25, -H * .32, H * .14, -H * .26); c.quadraticCurveTo(H * .22, -H * .05, H * .14, H * .12); c.quadraticCurveTo(H * .06, H * .26, -H * .02, H * .32); c.quadraticCurveTo(-H * .2, H * .46, -H * .06, H * .52); c.quadraticCurveTo(H * .06, H * .52, H * .02, H * .44); c.quadraticCurveTo(-H * .04, H * .4, -H * .1, H * .3 + Math.sin(ph) * .5); c.quadraticCurveTo(-H * .16, H * .1, -H * .12, -H * .1); c.quadraticCurveTo(-H * .1, -H * .3, -H * .04, -H * .4); c.closePath(); };
      c.fillStyle = sil ? SIL : col.finA(.55); c.beginPath(); c.moveTo(-H * .12, -H * .05); c.quadraticCurveTo(-H * .3 + Math.sin(ph * 3) * 2, H * .02, -H * .13, H * .1); c.closePath(); c.fill();
      path(); c.fillStyle = bodyFill(c, col, s, sil, H); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      c.save(); path(); c.clip(); c.strokeStyle = `hsla(${col.h},${s.sat}%,${Math.max(8, s.lit - 25)}%,.5)`; c.lineWidth = .7; c.beginPath(); for (let y = -H * .3; y < H * .45; y += H * .05) { c.moveTo(-H * .2, y); c.lineTo(H * .25, y + H * .02); } c.stroke(); c.restore();
      path(); c.strokeStyle = `hsla(${col.h},${s.sat}%,${Math.max(5, s.lit - 30)}%,.6)`; c.lineWidth = .8; c.stroke();
      c.fillStyle = col.dark; c.beginPath(); c.moveTo(-H * .02, -H * .42); c.lineTo(H * .02, -H * .5); c.lineTo(H * .06, -H * .42); c.fill();
      eyeDot(c, H * .1, -H * .36, Math.max(1.5, H * .035), s); sickTint(c, f, H * .5, H); return true;
    }
    function drawShrimpX(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, seg = 6, body = sil ? SIL : `hsla(${col.h},${s.sat}%,${s.lit}%,${s.sat < 30 ? .6 : .92})`, edge = sil ? SIL_EDGE : `hsla(${col.h},${s.sat}%,${Math.max(10, s.lit - 25)}%,.8)`;
      c.strokeStyle = edge; c.lineWidth = .7; c.beginPath(); c.moveTo(L * .42, -Hh * .2); c.quadraticCurveTo(L * .9, -Hh * 1.2, L * 1.2 + Math.sin(ph * .7) * 3, -Hh * .6); c.moveTo(L * .42, -Hh * .15); c.quadraticCurveTo(L * .8, -Hh * .4, L * 1.1, Hh * .2 + Math.sin(ph * .9) * 2); c.stroke();
      if (s.accentColor) { c.strokeStyle = s.accentColor; c.lineWidth = .6; c.beginPath(); c.moveTo(L * .44, -Hh * .25); c.quadraticCurveTo(L * 1.1, -Hh * 1.6, L * 1.5, -Hh * 1.1); c.stroke(); }
      c.strokeStyle = edge; c.lineWidth = .8; for (let i = 0; i < 5; i++) { const x = L * .3 - i * L * .13, a = Math.sin(ph * 2 + i) * 2; c.beginPath(); c.moveTo(x, Hh * .25); c.lineTo(x + a, Hh * .75); c.stroke(); }
      if (s.fanArms && !sil) { for (const k of [0, 1]) { const o = Math.sin(ph * 3 + k) * .5 + .5; c.fillStyle = `hsla(${col.h},40%,70%,${.4 + .3 * o})`; c.beginPath(); c.moveTo(L * .45, Hh * .1); c.lineTo(L * (.7 + k * .05), Hh * (.1 + o * .4)); c.lineTo(L * (.62 + k * .05), Hh * (.45 + o * .3)); c.closePath(); c.fill(); } }
      c.fillStyle = body; c.beginPath(); c.moveTo(-L * .42, 0); c.lineTo(-L * .62, -Hh * .45); c.lineTo(-L * .58, Hh * .3); c.closePath(); c.fill();
      for (let i = seg - 1; i >= 0; i--) { const t = i / (seg - 1), x = L * .35 - t * L * .75, y = -Math.sin(t * Math.PI) * Hh * .25 + t * Hh * .05, rx = L * (.16 - t * .05), ry = Hh * (.48 - t * .18); c.fillStyle = (s.pattern === 'bandsShrimp' && !sil && i % 2 === 1) ? (s.patternColor || '#fff') : body; c.beginPath(); c.ellipse(x, y, rx, ry, -.15 + t * .4, 0, 7); c.fill(); c.strokeStyle = edge; c.lineWidth = .6; c.stroke(); }
      if (sil) return true;
      if (s.pattern === 'saddle' || s.pattern === 'lateral') { c.strokeStyle = s.patternColor || '#fff'; c.lineWidth = Math.max(.8, Hh * .12); c.beginPath(); c.moveTo(L * .42, -Hh * .3); c.quadraticCurveTo(0, -Hh * .62, -L * .45, -Hh * .1); c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.ellipse(L * .05, -Hh * .2, L * .3, Hh * .08, 0, 0, 7); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.arc(L * .44, -Hh * .18, Math.max(1.2, Hh * .12), 0, 7); c.fill();
      sickTint(c, f, L, Hh); return true;
    }
    // ---------- 成長階段外觀（幼魚 → 亞成 → 成年） ----------
    // 遊戲在 updateFish 設定 f.stg（0/1/2）；進化動畫期間以 f.evS 指定要畫哪個階段。預覽（沒有 stg）一律畫成年型態。
    const LONG_FIN = ['tall', 'flowing', 'sail', 'pennant', 'long', 'whip', 'lion'], LONG_TAIL = ['flow', 'lyre', 'double', 'sword'];
    const vcache = new WeakMap();
    const stageOf = f => (f && f.evS != null ? f.evS : f && f.stg != null ? f.stg : 2);
    function view(s, f) {
      if (!s || s.stages === false) return s; const st = stageOf(f); let v = vcache.get(s); if (!v) vcache.set(s, v = []);
      return v[st] || (v[st] = makeView(s, st));
    }
    function makeView(s, st) {
      const big = s.tailScale || 1, A = s.adult || {};
      if (st >= 2) { // 成年：飽和色、長鰭、完整花紋＋物種特徵（look.adult 可覆寫）
        const ad = { _stage: 2, sat: Math.min(100, s.sat * 1.08 + 2) };
        if (LONG_TAIL.includes(s.tail) || s.longFins) ad.tailScale = big * 1.12;
        Object.assign(ad, A); if (A.headScale) ad._headK = A.headScale; return Object.assign({}, s, ad);
      }
      if (st === 1) { // 亞成：顏色偏淡、鰭較短、花紋一半、頭瘤／肉冠長一半、還不會發光
        return Object.assign({}, s, { _stage: 1, sat: s.sat * .8, lit: Math.min(78, s.lit + 5), tailScale: big * .82, _patA: .62, _headK: .55,
          fins: s.fins === 'flowing' || s.fins === 'pennant' || s.fins === 'sail' ? 'tall' : s.fins === 'lion' ? 'spiny' : s.fins === 'whip' ? 'std' : s.fins,
          glow: false, aura: s.aura && !s.premium ? false : s.aura, hueCycle: (s.hueCycle || 0) * .7, whiskers: s.whiskers === 'long' ? 'short' : s.whiskers });
      }
      // 幼魚：小、蒼白、短鰭、花紋很淡、沒有第二層花紋與頭瘤、大眼睛、身形圓一點
      return Object.assign({}, s, { _stage: 0, sat: s.sat * .55, lit: Math.min(84, s.lit + 12), tailScale: big * .62, _patA: .3, _headK: 0,
        tail: LONG_TAIL.includes(s.tail) ? (s.tail === 'double' ? 'fan' : s.body === 'fish' || s.body === 'tall' ? 'fan' : s.tail) : s.tail,
        fins: LONG_FIN.includes(s.fins) ? 'std' : s.fins, head: s.head === 'hump' || s.head === 'wen' ? undefined : s.head, pattern2: undefined,
        whiskers: s.whiskers === 'long' ? 'short' : s.whiskers, glow: false, eyeScale: (s.eyeScale || 1) * 1.22, ht: s.ht * 1.06, hueCycle: (s.hueCycle || 0) * .4, longFins: false });
    }
    // ---------- 烏龜 ----------
    function drawTurtle(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, bask = f.bask === 2, sw = bask ? 0 : Math.sin(ph * 1.2);
      const skin = sil ? SIL : (s.accentColor && s.flipper ? s.accentColor : `hsl(${col.h},${Math.max(10, s.sat - 10)}%,${Math.min(60, s.lit + 12)}%)`), dark = sil ? SIL : col.dark;
      const limb = (x, y, a, len, w) => { c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = skin; c.beginPath(); c.ellipse(len * .5, 0, len * .55, w, 0, 0, 7); c.fill(); if (!sil) { c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = .6; c.stroke(); } c.restore(); };
      const fl = s.flipper ? 1.6 : 1;
      limb(L * .2, Hh * .22, .6 + sw * .6 * fl, L * .22 * fl, Hh * .09); limb(-L * .22, Hh * .24, 2.4 - sw * .5, L * .16, Hh * .08);
      limb(L * .2, Hh * .16, .3 - sw * .6 * fl, L * .2 * fl, Hh * .08); limb(-L * .25, Hh * .2, 2.7 + sw * .5, L * .14, Hh * .07);
      // 尾巴、頭
      c.fillStyle = skin; c.beginPath(); c.moveTo(-L * .42, Hh * .05); c.lineTo(-L * .55, Hh * .12); c.lineTo(-L * .4, Hh * .16); c.fill();
      const hx = L * .44 + (bask ? L * .05 : 0), hy = Hh * (bask ? -.02 : .06);
      c.beginPath(); c.ellipse(hx, hy, L * .13, Hh * .15, bask ? -.25 : 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(L * .34, hy + Hh * .03, L * .08, Hh * .12, 0, 0, 7); c.fill();
      if (!sil) { if (s.accentColor && !s.flipper) { c.fillStyle = s.accentColor; c.beginPath(); c.ellipse(hx - L * .03, hy - Hh * .02, L * .05, Hh * .035, 0, 0, 7); c.fill(); c.strokeStyle = s.accentColor; c.lineWidth = .8; c.beginPath(); c.moveTo(hx - L * .1, hy + Hh * .06); c.lineTo(hx + L * .06, hy + Hh * .07); c.stroke(); }
        eyeDot(c, hx + L * .05, hy - Hh * .04, Math.max(1, Hh * .045), s); }
      // 腹甲＋背甲
      c.fillStyle = sil ? SIL : `hsl(${col.h + 20},40%,${Math.min(75, s.lit + 30)}%)`; c.beginPath(); c.ellipse(0, Hh * .14, L * .4, Hh * .14, 0, 0, 7); c.fill();
      const path = () => { c.beginPath(); c.moveTo(-L * .42, Hh * .12); c.bezierCurveTo(-L * .4, -Hh * (s.ridge ? .78 : .6), L * .38, -Hh * (s.ridge ? .78 : .6), L * .42, Hh * .12); c.closePath(); };
      path(); c.fillStyle = bodyFill(c, col, s, sil, Hh); c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      clipPattern(c, f, s, L, Hh, col, path);
      c.save(); path(); c.clip(); c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = Math.max(.6, Hh * .025);
      for (let i = -2; i <= 2; i++) { const x = i * L * .16; c.beginPath(); c.moveTo(x - L * .07, -Hh * .3); c.lineTo(x + L * .07, -Hh * .3); c.lineTo(x + L * .1, Hh * .05); c.lineTo(x - L * .1, Hh * .05); c.closePath(); c.stroke(); }
      c.restore(); path(); c.strokeStyle = dark; c.lineWidth = Math.max(.8, Hh * .04); c.stroke();
      const g = c.createRadialGradient(-L * .08, -Hh * .35, 0, 0, -Hh * .2, L * .4); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; path(); c.fill();
      sickTint(c, f, L, Hh); return true;
    }
    // ---------- 鯨豚（海豚／白鯨／座頭鯨／虎鯨）與鯨鯊 ----------
    function drawCetacean(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, flick = Math.sin(ph * .8), shark = s.body === 'whaleshark';
      const main = sil ? SIL : col.main, dark = sil ? SIL : col.dark, belly = sil ? SIL : (s.pattern === 'patches' ? '#f4f6f8' : `hsl(${col.h},${Math.max(5, s.sat - 10)}%,${Math.min(92, s.lit + 30)}%)`);
      // 尾鰭（上下擺動：鯨豚）／左右（鯨鯊）
      c.save(); c.translate(-L * .46, 0); c.rotate(flick * .25); c.fillStyle = dark;
      if (shark) { c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-L * .12, -Hh * .5, -L * .2, -Hh * .9); c.quadraticCurveTo(-L * .1, -Hh * .1, -L * .04, 0); c.quadraticCurveTo(-L * .1, Hh * .2, -L * .14, Hh * .5); c.closePath(); c.fill(); }
      else { c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-L * .08, -Hh * .1, -L * .16, -Hh * .42); c.quadraticCurveTo(-L * .1, -Hh * .05, -L * .07, 0); c.quadraticCurveTo(-L * .1, Hh * .05, -L * .16, Hh * .42); c.quadraticCurveTo(-L * .08, Hh * .1, 0, 0); c.fill(); }
      c.restore();
      // 胸鰭
      const wing = s.pectoral === 'wing'; c.save(); c.translate(L * .12, Hh * .18); c.rotate(.5 + Math.sin(ph * .6) * .2); c.fillStyle = dark; c.beginPath(); c.ellipse(-L * (wing ? .14 : .05), 0, L * (wing ? .2 : .08), Hh * (wing ? .07 : .09), 0, 0, 7); c.fill();
      if (wing && !sil) { c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(-L * .14, Hh * .02, L * .18, Hh * .04, 0, 0, 7); c.fill(); } c.restore();
      const path = () => { c.beginPath(); c.moveTo(L * .5, Hh * (shark ? 0 : .05));
        if (shark) { c.quadraticCurveTo(L * .5, -Hh * .45, L * .2, -Hh * .5); } else { c.quadraticCurveTo(L * .56, -Hh * .05, L * .44, -Hh * .2); c.quadraticCurveTo(L * .4, -Hh * (s.head === 'dot' ? .62 : .45), L * .15, -Hh * .5); }
        c.quadraticCurveTo(-L * .25, -Hh * .45, -L * .48, -Hh * .04); c.lineTo(-L * .48, Hh * .04); c.quadraticCurveTo(-L * .2, Hh * .5, L * .2, Hh * .42); c.quadraticCurveTo(L * .48, Hh * .3, L * .5, Hh * .05); c.closePath(); };
      // 背鰭
      if (s.fins === 'shark') { c.fillStyle = dark; c.beginPath(); c.moveTo(-L * .02, -Hh * .45); c.quadraticCurveTo(-L * .05, -Hh * (s.pattern === 'patches' ? 1.3 : .95), -L * .14, -Hh * (s.pattern === 'patches' ? 1.25 : .85)); c.quadraticCurveTo(-L * .1, -Hh * .6, -L * .16, -Hh * .38); c.fill(); }
      path(); const g = sil ? SIL : c.createLinearGradient(0, -Hh * .5, 0, Hh * .5); if (!sil) { g.addColorStop(0, dark); g.addColorStop(.45, main); g.addColorStop(.62, belly); g.addColorStop(1, belly); } c.fillStyle = g; c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); return true; }
      c.save(); path(); c.clip();
      if (s.pattern === 'patches') { c.fillStyle = '#f4f6f8'; c.beginPath(); c.ellipse(L * .3, -Hh * .2, L * .06, Hh * .1, -.2, 0, 7); c.fill(); c.fillStyle = 'rgba(200,205,210,.8)'; c.beginPath(); c.ellipse(-L * .12, -Hh * .38, L * .1, Hh * .07, 0, 0, 7); c.fill(); c.fillStyle = '#f4f6f8'; c.beginPath(); c.ellipse(-L * .02, Hh * .32, L * .3, Hh * .2, 0, 0, 7); c.fill(); }
      else if (shark) { c.fillStyle = 'rgba(240,248,255,.85)'; const r = rng(11); for (let i = 0; i < 70; i++) { const x = (r() - .5) * L * .9, y = -Hh * .45 + r() * Hh * .7; c.beginPath(); c.arc(x, y, Math.max(.6, Hh * .035), 0, 7); c.fill(); } c.strokeStyle = 'rgba(240,248,255,.35)'; c.lineWidth = .7; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-L * .35, -Hh * (.1 + i * .12)); c.lineTo(L * .3, -Hh * (.15 + i * .12)); c.stroke(); } }
      else if (s.pattern === 'belly2') { c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = .7; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(L * .4 - i * L * .03, Hh * .2); c.lineTo(L * .05 - i * L * .03, Hh * .42); c.stroke(); } }
      c.restore(); path(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = .8; c.stroke();
      // 眼睛、嘴
      const ex = L * (shark ? .38 : .33), ey = shark ? -Hh * .05 : Hh * .02; c.fillStyle = '#0b1420'; c.beginPath(); c.arc(ex, ey, Math.max(1, Hh * .05), 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(ex + Hh * .015, ey - Hh * .015, Math.max(.4, Hh * .015), 0, 7); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = .9; c.beginPath(); if (shark) { c.moveTo(L * .5, Hh * .02); c.lineTo(L * .4, Hh * .08); } else { c.moveTo(L * .5, Hh * .06); c.quadraticCurveTo(L * .42, Hh * .14, L * .36, Hh * .08); } c.stroke();
      if (f.bubble) {} sickTint(c, f, L, Hh); return true;
    }
    function drawManta(c, f, s, col, sil) {
      const L = s.len, Hh = s.ht, ph = f.phase || 0, flap = Math.sin(ph * .7);
      const top = sil ? SIL : col.dark, main = sil ? SIL : col.main;
      c.save(); c.scale(1, 1);
      const path = () => { c.beginPath(); c.moveTo(L * .3, 0); c.quadraticCurveTo(L * .1, -Hh * (.55 + flap * .2), -L * .15, -Hh * (.6 + flap * .3)); c.quadraticCurveTo(-L * .05, -Hh * .15, -L * .3, 0); c.quadraticCurveTo(-L * .05, Hh * .15, -L * .15, Hh * (.6 - flap * .3)); c.quadraticCurveTo(L * .1, Hh * (.55 - flap * .2), L * .3, 0); c.closePath(); };
      c.strokeStyle = top; c.lineWidth = Math.max(1, Hh * .02); c.beginPath(); c.moveTo(-L * .28, 0); c.quadraticCurveTo(-L * .5, Math.sin(ph) * Hh * .05, -L * .7, Math.sin(ph - 1) * Hh * .1); c.stroke();
      path(); const g = sil ? SIL : c.createLinearGradient(0, -Hh * .6, 0, Hh * .6); if (!sil) { g.addColorStop(0, top); g.addColorStop(.5, main); g.addColorStop(1, top); } c.fillStyle = g; c.fill(); if (sil) { c.strokeStyle = SIL_EDGE; c.stroke(); c.restore(); return true; }
      c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.ellipse(L * .05, 0, L * .12, Hh * .12, 0, 0, 7); c.fill();
      c.fillStyle = top; for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(L * .33, sd * Hh * .07, L * .05, Hh * .025, sd * .4, 0, 7); c.fill(); }
      eyeDot(c, L * .26, -Hh * .1, Math.max(1, Hh * .025), s); eyeDot(c, L * .26, Hh * .1, Math.max(1, Hh * .025), s);
      c.restore(); sickTint(c, f, L, Hh); return true;
    }
    function special(c, f, s, col, sil) {
      switch (s.body) {
        case 'turtle': return drawTurtle(c, f, s, col, sil);
        case 'cetacean': case 'whaleshark': return drawCetacean(c, f, s, col, sil);
        case 'manta': return drawManta(c, f, s, col, sil);
        case 'eel': return drawEel(c, f, s, col, sil);
        case 'ray': return drawRay(c, f, s, col, sil);
        case 'crab': return drawCrab(c, f, s, col, sil);
        case 'crayfish': return drawCrayfish(c, f, s, col, sil);
        case 'snail': return drawSnail(c, f, s, col, sil);
        case 'seahorse': return drawSeahorse(c, f, s, col, sil);
        case 'shrimp': if (s.pattern === 'bandsShrimp' || s.pattern === 'saddle' || s.pattern === 'lateral' || s.fanArms || s.accentColor) return drawShrimpX(c, f, s, col, sil); return false;
      }
      return false;
    }

    // ---------- render()／preview() 用 ----------
    const noTilt = s => ['crab', 'crayfish', 'snail', 'ray', 'seahorse', 'manta'].includes(s.body);
    function transform(ctx, f, s) { if (s.flip) ctx.scale(1, -1); }
    const withA = (col, a) => /^hsl\(/.test(col) ? col.replace(/^hsl\((.*)\)$/, `hsla($1,${a})`) : /^#/.test(col) ? col + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0') : col;
    function previewFit(s, sc) { // 回傳 {sc, dx, dy} 讓特殊體型在 160×100 預覽框中置中
      const L = s.len, Hh = s.ht;
      if (s.body === 'seahorse') return { sc: Math.min(120 / (L * .6), 86 / L), dx: -4, dy: 0 };
      if (s.body === 'crab') return { sc: Math.min(120 / (L * 1.1), 70 / (Hh * 1.6)), dx: 0, dy: 4 };
      if (s.body === 'crayfish') return { sc: Math.min(140 / (L * 1.9), 70 / (Hh * 1.9)), dx: -14, dy: 6 };
      if (s.body === 'snail') return { sc: Math.min(120 / (L * 1.1), 70 / (L * .75)), dx: 0, dy: 8 };
      if (s.body === 'ray') return { sc: Math.min(120 / (L * 1.4), 70 / (Hh * 1.1)), dx: 10, dy: 0 };
      if (s.body === 'turtle') return { sc: Math.min(130 / (L * 1.25), 70 / (Hh * 1.3)), dx: -4, dy: 6 };
      if (s.body === 'cetacean' || s.body === 'whaleshark') return { sc: Math.min(140 / (L * 1.25), 70 / (Hh * 1.9)), dx: 8, dy: 4 };
      if (s.body === 'manta') return { sc: Math.min(130 / (L * 1.1), 80 / (Hh * 1.5)), dx: 6, dy: 0 };
      if (s.body === 'eel') return { sc: Math.min(130 / (L * 1.25), 70 / (Hh * 3)), dx: 0, dy: 0 };
      { const big = s.tailScale || 1, tl = s.tail === 'flow' ? .62 * big : s.tail === 'double' ? .58 * big : s.tail === 'lyre' ? .52 * big : s.tail === 'sword' ? .72 : .38, w = L * (.52 + .4 + tl); if (tl > .6) { const vh = Hh * 2 * Math.max(s.fins === 'tall' || s.fins === 'flowing' ? 1.2 : .62, s.tail === 'double' || s.tail === 'flow' ? .6 * big : 0), k = Math.min(sc, 140 / w, 92 / vh); return { sc: k, dx: (tl - .45) * L * .5 * k, dy: 0 }; } }
      if (s.mouth === 'beak' || s.mouth === 'trunk') return { sc: Math.min(sc, 120 / (L * 1.75)), dx: -10, dy: 0 };
      if (s.fins === 'pennant' || s.fins === 'lion' || s.fins === 'sail') return { sc: Math.min(sc, 70 / (Hh * 3.4)), dx: 0, dy: 6 };
      if (s.whiskers === 'long') return { sc: Math.min(sc, 120 / (L * 1.7)), dx: -8, dy: 0 };
      return null;
    }

    // ================= 立體寫實畫風（v4）：體積光影、鱗片紋理、寫實眼睛、側線、鰓蓋、焦散 =================
    // 品質等級 Q：2＝全部效果、1＝無模糊／焦散減半、0＝省電（無鱗片紋理、無邊緣光）。遊戲依 FPS 自動調整（setQuality）。
    let Q = 2; const setQuality = (q) => { Q = Math.max(0, Math.min(2, q | 0)); }; const quality = () => Q;
    const SCALELESS = ['eel', 'catfish', 'shrimp', 'crab', 'crayfish', 'snail', 'turtle', 'cetacean', 'manta', 'ray', 'seahorse'];
    const menaceOf = (s) => s.temper === 'predator' ? 2 : s.temper === 'aggressive' ? 1 : 0;
    // 鱗片紋理：每種魚一張小圖（offscreen canvas）做成 pattern，快取
    const tileCache = {};
    function scaleTile(s) { const key = s.id + '|' + (s.ht | 0); if (tileCache[key] !== undefined) return tileCache[key];
      if (typeof document === 'undefined') return tileCache[key] = null;
      const N = 24, cv = document.createElement('canvas'); cv.width = N; cv.height = N; const c = cv.getContext('2d');
      for (const [x, y] of [[0, 0], [N, 0], [N / 2, N / 2], [0, N], [N, N], [N * 1.5, N / 2], [-N / 2, N / 2]]) {
        c.strokeStyle = 'rgba(0,0,0,.42)'; c.lineWidth = 1.3; c.beginPath(); c.arc(x, y, N * .52, Math.PI * .5, Math.PI * 1.5); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.32)'; c.lineWidth = 1; c.beginPath(); c.arc(x + 1.6, y, N * .46, Math.PI * .62, Math.PI * 1.12); c.stroke(); }
      return tileCache[key] = cv; }
    function scaleFill(c, s, L, Hh, alpha) { if (Q < 1 || SCALELESS.includes(s.body)) return; const t = scaleTile(s); if (!t) return; const p = c.createPattern(t, 'repeat'); if (!p) return;
      const u = Math.max(1.1, Hh * .1); if (p.setTransform && typeof DOMMatrix !== 'undefined') p.setTransform(new DOMMatrix().scale(u * 2 / 24));
      c.save(); c.globalAlpha = alpha == null ? (s.pattern === 'scales' ? .25 : .5) : alpha; c.fillStyle = p; c.fillRect(-L, -Hh, L * 2, Hh * 2); c.restore(); }
    // 體積光影（必須在 clip 到身體輪廓後呼叫）：邊緣暗化、背光邊緣光、高光、焦散流光
    function volume(c, f, s, L, Hh, pathFn, opt) { opt = opt || {}; const t = T(), m = menaceOf(s);
      c.save(); c.scale(L * .5, Hh * .5); // 單位圓 → 身體橢圓
      const g = c.createRadialGradient(.15, -.35, .05, 0, -.05, 1.12); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.62, 'rgba(0,8,20,0)'); g.addColorStop(1, `rgba(0,8,20,${.5 + m * .08})`);
      c.fillStyle = g; c.fillRect(-2, -2, 4, 4); c.restore();
      // 腹側反光（底砂反射）
      const vb = c.createLinearGradient(0, Hh * .15, 0, Hh * .55); vb.addColorStop(0, 'rgba(255,250,235,0)'); vb.addColorStop(1, `rgba(255,250,235,${.1 - m * .03})`); c.fillStyle = vb; c.fillRect(-L, Hh * .1, L * 2, Hh);
      if (Q >= 1 && pathFn) { // 背部邊緣光
        pathFn(); const rg = c.createLinearGradient(0, -Hh * .55, 0, -Hh * .1); rg.addColorStop(0, 'rgba(210,240,255,.55)'); rg.addColorStop(1, 'rgba(210,240,255,0)'); c.strokeStyle = rg; c.lineWidth = Math.max(1, Hh * .13); c.stroke(); }
      // 鏡面高光（小而銳利）
      const hx = L * (opt.hx ?? .16), hy = -Hh * (opt.hy ?? .27), sp = c.createRadialGradient(hx, hy, 0, hx, hy, L * .2); sp.addColorStop(0, 'rgba(255,255,255,.5)'); sp.addColorStop(.25, 'rgba(255,255,255,.16)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      c.save(); c.translate(hx, hy); c.scale(1, .32); c.translate(-hx, -hy); c.fillStyle = sp; c.fillRect(hx - L * .25, hy - L * .25, L * .5, L * .5); c.restore();
      // 焦散：隨世界位置移動的光斑
      if (Q >= 1) { const wx = (f.x || 0) * .02, ph = t * .9 + wx + (f.seed || 0) % 7; c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < (Q >= 2 ? 3 : 2); i++) { const cx = Math.sin(ph * (.7 + i * .23) + i * 2.1) * L * .32, cy = -Hh * .22 + Math.cos(ph * .8 + i) * Hh * .14, r = L * (.1 + i * .03); const cg = c.createRadialGradient(cx, cy, 0, cx, cy, r);
          cg.addColorStop(0, 'rgba(220,255,250,.13)'); cg.addColorStop(1, 'rgba(220,255,250,0)'); c.fillStyle = cg; c.fillRect(cx - r, cy - r, r * 2, r * 2); } c.restore(); }
    }
    // 側線＋鰓蓋（身體內，clip 之後）
    function anatomy(c, f, s, L, Hh, col, ex) { const gx = Math.min(L * .3, (ex ?? L * .29) - Hh * .2);
      c.strokeStyle = 'rgba(0,0,0,.26)'; c.lineWidth = Math.max(.5, Hh * .035); c.beginPath(); c.moveTo(gx + Hh * .05, -Hh * .36); c.quadraticCurveTo(gx - Hh * .16, Hh * .02, gx + Hh * .02, Hh * .36); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = Math.max(.4, Hh * .02); c.beginPath(); c.moveTo(gx - Hh * .02, -Hh * .3); c.quadraticCurveTo(gx - Hh * .22, Hh * .02, gx - Hh * .05, Hh * .3); c.stroke();
      if (Q >= 1 && L > 14) { c.save(); c.setLineDash([Math.max(.8, L * .018), Math.max(.8, L * .02)]); c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = Math.max(.4, Hh * .025); c.beginPath(); c.moveTo(gx - Hh * .1, -Hh * .14); c.bezierCurveTo(L * .02, -Hh * .2, -L * .2, -Hh * .04, -L * .42, 0); c.stroke(); c.restore(); } }
    // 寫實眼睛：眼窩陰影＋虹膜漸層＋瞳孔＋小反光；肉食／兇猛魚加眉骨（凶狠）
    function realEye(c, f, s, ex, ey, er, col) { const m = DRAW_GENTLE ? 0 : menaceOf(s), t = T();
      if (er < .3) return; const irisH = IRIS[s.eyes] ? null : m === 2 ? (s.hue > 300 || s.hue < 20 ? 45 : 8) : m === 1 ? 40 : (col.h + 35) % 360;
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(ex, ey, er * 1.22, 0, 7); c.fill();
      const ig = c.createRadialGradient(ex - er * .2, ey - er * .25, er * .1, ex, ey, er); if (IRIS[s.eyes]) { ig.addColorStop(0, IRIS[s.eyes]); ig.addColorStop(1, 'rgba(0,0,0,.85)'); }
      else { ig.addColorStop(0, `hsl(${irisH},${m ? 85 : 45}%,${m ? 58 : 66}%)`); ig.addColorStop(.7, `hsl(${irisH},${m ? 80 : 35}%,${m ? 36 : 42}%)`); ig.addColorStop(1, 'rgba(10,10,10,.9)'); }
      c.fillStyle = f.sick ? '#8f9a9a' : ig; c.beginPath(); c.arc(ex, ey, er, 0, 7); c.fill();
      const lx = ex + er * (.08 + .16 * (f.lookX ?? .6)), ly = ey + er * .14 * (f.lookY || 0); c.fillStyle = f.sick ? 'rgba(200,210,210,.8)' : '#030507'; c.beginPath(); c.arc(lx, ly, er * (m === 2 ? .5 : .56), 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.92)'; c.beginPath(); c.arc(lx + er * .22, ly - er * .26, Math.max(.35, er * .17), 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.arc(lx - er * .2, ly + er * .3, Math.max(.25, er * .1), 0, 7); c.fill();
      if (m) { c.fillStyle = `hsla(${col.h},${s.sat}%,${Math.max(5, s.lit - 32)}%,.92)`; c.beginPath(); c.moveTo(ex - er * 1.7, ey - er * 1.25); c.quadraticCurveTo(ex, ey - er * 1.75, ex + er * 1.55, ey - er * .55); c.lineTo(ex + er * 1.25, ey - er * .25); c.quadraticCurveTo(ex, ey - er * 1.05, ex - er * 1.6, ey - er * .85); c.closePath(); c.fill(); } }
    // 半透明鰭＋鰭條
    function finRays(c, x0, y0, pts, col, a) { c.save(); c.strokeStyle = `hsla(${col.h},30%,${a > .5 ? 92 : 80}%,${a})`; c.lineWidth = .55; c.beginPath(); for (const [x, y] of pts) { c.moveTo(x0, y0); c.lineTo(x, y); } c.stroke(); c.restore(); }
    // 肉食魚下顎＋牙齒（嘴型為預設時）
    function teeth(c, f, s, L, Hh) { const mo = (f.chomp || 0) * 2; c.fillStyle = 'rgba(25,8,8,.7)'; c.beginPath(); c.moveTo(L * .5, Hh * .02 - mo * .5); c.lineTo(L * .34, Hh * .1); c.lineTo(L * .53, Hh * .16 + mo); c.closePath(); c.fill();
      c.fillStyle = '#f4f1e6'; c.beginPath(); for (let i = 0; i < 4; i++) { const x = L * (.5 - i * .035); c.moveTo(x, Hh * .03 - mo * .5); c.lineTo(x - L * .01, Hh * .075); c.lineTo(x - L * .02, Hh * .035 - mo * .5); c.moveTo(x + L * .02, Hh * .15 + mo); c.lineTo(x + L * .01, Hh * .1); c.lineTo(x, Hh * .145 + mo); } c.fill(); }
    return { setSprite, fxLive, view, stageOf, star4, setQuality, quality, scaleFill, volume, anatomy, realEye, finRays, teeth, menaceOf, PREMIUM_PATTERNS, bodyPath, tailPath, noRays, finPath, pattern, pattern2, eyes, mouth, after, special, noTilt, transform, previewFit, vocab: { EXT_BODIES, SPECIAL_BODIES, EXT_TAILS, EXT_FINS, EXT_PATTERNS, EXT_MOUTHS } };
  }
  root.createRenderExt = createRenderExt;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRenderExt };
})(typeof window !== 'undefined' ? window : globalThis);

  })(__rx, __rx, undefined);
  RX = __rx.createRenderExt ? __rx.createRenderExt({ rng: rng, getT: function () { return T; }, pattern: function () { return pattern.apply(null, arguments); } }) : null;
  // ---- 擷取結束 ----
  function resolve(sp, id) { sp = sp || {}; id = id || 'preview'; var L = sp.look || {}; return Object.assign({body:'fish',tail:'fan',tailScale:1,fins:'std',pattern:'belly',eyeScale:1,hueCycle:0,len:30,height:18,hue:0,sat:80,light:55},L,{id,hybrid:!!sp.hybrid,premiumBlood:!!sp.premiumBlood,parents:sp.parents||null,name:sp.name,r:sp.rarity|0,price:sp.price||0,coin:sp.coin||1,sell:sp.sellPrice||0,breedOnly:(!!sp.breedOnly||!sp.price)&&!(sp.priceGems>0),gems:sp.priceGems>0&&!sp.disabled?sp.priceGems:0,premium:sp.priceGems>0||!!sp.premium,speed:sp.speed||40,role:sp.role||'swim',clean:sp.clean||null,bioload:sp.bioload??1,hungerMultiplier:sp.hungerMultiplier??1,desc:sp.desc||'',ht:L.height||18,lit:L.light??55,temper:sp.temperament||null}); }
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
  var api = { resolve: resolve, drawFish: drawFishAt, drawPreview: drawPreview, sourceHash: '9e91737a7c30' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FishRender = api;
})(typeof window !== 'undefined' ? window : this);
