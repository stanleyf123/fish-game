/* KINGCRAB-WALK-V1
 * Shared procedural king-crab art + walk cycle for Benthic267 species:
 *   o_king_crab (赤金), o_blue_king_crab (藍), o_golden_king_crab (黃金), o_chilean_king_crab (智利)
 *
 * Pure Canvas 2D, no images, no network, no saves. Everything is drawn in a design space where
 * half the sprite height is 1 unit, the sprite faces +x and the sand line is y = +1. The Benthic267
 * box (len x height) maps onto x in [-ASPECT, ASPECT], y in [-1, 1].
 *
 * Animation state lives on the fish runtime object only (never persisted):
 *   f._bGait   gait cycles (one cycle = every leg steps once)
 *   f._bAmp    0..1 walking amplitude (0 = standing still, feet planted)
 *   f._bYaw    -1..1 turning state; sign = facing, |yaw| < 1 while pivoting
 */
(function(root){
 'use strict';
 if(root.KingCrabWalk?.version===1)return;
 const TAU=Math.PI*2,ASPECT=1.785,DUTY=.62,STRIDE=.2,LIFT=.2,GROUND=1,TURN_RATE=4.2,MIN_SQUASH=.26;
 const SPAN_Y=1.97,WALK_SPEED_MUL=2.4,STRIDE_PER_CYCLE=2*STRIDE/DUTY;

 const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
 const toHex=a=>'#'+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
 const mix=(a,b,t)=>{const x=hex(a),y=hex(b);return toHex(x.map((v,i)=>v+(y[i]-v)*t))};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const rng=seed=>{let s=seed>>>0||1;return()=>((s=Math.imul(s^s>>>15,2246822507)^Math.imul(s^s>>>13,3266489909),(s^=s>>>16)>>>0)/4294967296)};

 // Palettes. Dusty/matte colours with light accents so they read as living animals, not cooked seafood.
 const RAW={
  o_king_crab:{label:'赤金帝王蟹',sci:'Paralithodes camtschaticus',
   pal:{top:'#d2503a',mid:'#a8302a',dark:'#5a1620',spine:'#e2a94a',tip:'#f7d98a',belly:'#e8c48e',leg:'#b83a2e',legDark:'#7a2222',band:'#efbb58',speck:'#f0b95a',eye:'#1c0f12',claw:'#c2402f'},
   shape:{cw:1,ch:1.2,spines:1,spineLen:1,leg:1,thick:1,claw:1,clawR:1,bumps:14,seta:0,mottle:0,gold:1}},
  o_blue_king_crab:{label:'藍帝王蟹',sci:'Paralithodes platypus',
   pal:{top:'#9aa6c6',mid:'#6e7aa6',dark:'#2c3258',spine:'#cfc8e6',tip:'#efeaf8',belly:'#cdcbe0',leg:'#7a86ae',legDark:'#464f80',band:'#bdb2dc',speck:'#d9d4f0',eye:'#10121e',claw:'#7d88b3'},
   shape:{cw:1.1,ch:1.24,spines:.62,spineLen:.8,leg:1.05,thick:1.14,claw:1.1,clawR:1.12,bumps:22,seta:1,mottle:0,gold:0}},
  o_golden_king_crab:{label:'黃金帝王蟹',sci:'Lithodes aequispinus',
   pal:{top:'#ecc95e',mid:'#c99a2c',dark:'#5e420f',spine:'#7a4f14',tip:'#f6e6a6',belly:'#f0dfad',leg:'#d3a73a',legDark:'#8b6419',band:'#f6e08f',speck:'#8a5c18',eye:'#1d1407',claw:'#d8ae40'},
   shape:{cw:.94,ch:1.18,spines:1.55,spineLen:1.55,leg:1.07,thick:.88,claw:.94,clawR:1.05,bumps:12,seta:0,mottle:0,gold:0,thorns:1}},
  o_chilean_king_crab:{label:'智利帝王蟹',sci:'Lithodes santolla',
   pal:{top:'#ff9b3e',mid:'#f2681a',dark:'#8f3208',spine:'#ffd08c',tip:'#fff1cc',belly:'#ffd9aa',leg:'#f77a26',legDark:'#bd470e',band:'#ffc774',speck:'#fff0c2',eye:'#1d0f08',claw:'#f9742a'},
   shape:{cw:1.04,ch:1.15,spines:.75,spineLen:.85,leg:.96,thick:1.05,claw:1.22,clawR:1.3,bumps:16,seta:0,mottle:1,gold:0}}
 };
 // Measured over a full gait cycle (tools/measure-fit.mjs): scale + offset that fit the whole crab, legs at full stride, in the sprite box.
 const FIT={o_king_crab:{s:.9134,x:-.0107,y:.0591},o_blue_king_crab:{s:.8968,x:-.009,y:.0763},o_golden_king_crab:{s:.9009,x:-.009,y:.0721},o_chilean_king_crab:{s:.922,x:-.0907,y:.0503}};
 const STYLES={};
 for(const id of Object.keys(RAW)){
  const r=RAW[id],p=r.pal,far={};
  for(const k of Object.keys(p))far[k]=['eye'].includes(k)?p[k]:mix(p[k],'#0d2740',.42);
  STYLES[id]=Object.assign({id,fit:FIT[id],seed:[...id].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)},r,{far});
 }

 // Leg slots: tripod gait (n1,f2,n3 | f1,n2,f3). hip is in body space, rest is the foot x on the sand.
 const LEGS=[
  {id:'f1',far:true,hip:[.5,-.02],kn:[.6,-.46],rest:1.46,phase:.5},
  {id:'f2',far:true,hip:[.14,-.05],kn:[.3,-.6],rest:.5,phase:0},
  {id:'f3',far:true,hip:[-.3,-.02],kn:[-.46,-.5],rest:-.7,phase:.5},
  {id:'n1',far:false,hip:[.4,.15],kn:[.64,-.3],rest:1.06,phase:0},
  {id:'n2',far:false,hip:[.0,.2],kn:[.1,-.5],rest:-.16,phase:.5},
  {id:'n3',far:false,hip:[-.4,.17],kn:[-.6,-.32],rest:-1.2,phase:0}
 ];
 const BODY={x:.02,y:-.33};

 const IDENT={s:1,x:0,y:0};
 const wrap01=v=>((v%1)+1)%1;
 const ease=t=>t*t*(3-2*t);

 function bodyMotion(gait,amp,idle){
  const bob=-.04*amp*(.5+.5*Math.sin(TAU*2*gait+.6))+.006*Math.sin(idle*.9);
  const rot=.03*amp*Math.sin(TAU*gait+.4)+.004*Math.sin(idle*.7);
  return{dy:bob,rot};
 }
 function bodyPoint(m,x,y){const c=Math.cos(m.rot),s=Math.sin(m.rot);return[BODY.x+x*c-y*s,BODY.y+m.dy+x*s+y*c]}

 /* Foot trajectory: stance = foot slides backwards relative to the body at exactly body speed (no skating);
    swing = foot lifts and returns forward. amp scales stride and lift, amp 0 plants every foot. */
 function footAt(slot,gait,amp){
  const u=wrap01(gait+slot.phase),A=STRIDE*amp;
  if(u<DUTY)return{x:slot.rest+A*(1-2*u/DUTY),y:GROUND,planted:true,u};
  const w=(u-DUTY)/(1-DUTY);
  return{x:slot.rest+A*(-1+2*ease(w)),y:GROUND-LIFT*amp*Math.sin(Math.PI*w)**.8,planted:false,u};
 }
 function ik(a,b,len1,len2,bend){
  let dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1e-6;
  const reach=len1+len2-1e-4;if(d>reach){dx*=reach/d;dy*=reach/d;d=reach}
  const x=(len1*len1-len2*len2+d*d)/(2*d),h=Math.sqrt(Math.max(0,len1*len1-x*x)),ux=dx/d,uy=dy/d;
  return[a[0]+ux*x+bend*uy*h,a[1]+uy*x-bend*ux*h];
 }
 function legPose(style,gait,amp,idle=0){
  const m=bodyMotion(gait,amp,idle),lm=style.shape.leg;
  return LEGS.map(slot=>{
   const foot=footAt(slot,gait,amp),hip=bodyPoint(m,slot.hip[0],slot.hip[1]);
   const sway=(foot.x-slot.rest)*.28;
   const knee=[hip[0]+slot.kn[0]*lm+sway,hip[1]+slot.kn[1]*lm];
   const bend=foot.x>=knee[0]?1:-1;
   const ankle=ik(knee,[foot.x,foot.y],.78*lm,.98*lm,bend);
   return{id:slot.id,far:slot.far,hip,knee,ankle,foot:[foot.x,foot.y],planted:foot.planted,u:foot.u,bend};
  });
 }

 // ---------- drawing helpers ----------
 function smoothClosed(c,pts){
  const n=pts.length;c.moveTo(pts[0][0],pts[0][1]);
  for(let i=0;i<n;i++){
   const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
   c.bezierCurveTo(p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6,p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6,p2[0],p2[1]);
  }
  c.closePath();
 }
 function taper(c,x0,y0,r0,x1,y1,r1){
  const dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy)||1e-6,a=Math.atan2(dy,dx),b=Math.acos(clamp((r0-r1)/d,-1,1));
  c.moveTo(x0+Math.cos(a+b)*r0,y0+Math.sin(a+b)*r0);
  c.arc(x0,y0,r0,a+b,a-b+TAU);
  c.arc(x1,y1,r1,a-b,a+b);
  c.closePath();
 }
 function spike(c,x,y,nx,ny,len,w){
  c.moveTo(x-ny*w,y+nx*w);c.lineTo(x+nx*len,y+ny*len);c.lineTo(x+ny*w,y-nx*w);c.closePath();
 }

 function carapacePoints(st){
  const sh=st.shape,base=[
   [.82,-.05,0],[.64,-.27,.8],[.32,-.43,1],[-.08,-.48,.9],[-.42,-.4,1],[-.67,-.18,.8],[-.7,.07,.5],[-.5,.25,0],[-.08,.32,0],[.38,.25,0],[.68,.11,0]
  ];
  const out=[];
  for(let i=0;i<base.length;i++){
   const p=base[i];out.push([p[0]*sh.cw,p[1]*sh.ch,p[2]]);
   if(sh.thorns&&i>0&&i<6){const q=base[i+1],mx=(p[0]+q[0])/2*sh.cw,my=(p[1]+q[1])/2*sh.ch;out.push([mx,my,.7])}
  }
  return out;
 }

 function outlinePath(c,pts,dx,dy,sx=1,sy=1){
  smoothClosed(c,pts.map(p=>[p[0]*sx+dx,p[1]*sy+dy]));
 }

 function drawLegs(c,st,legs,far,opt){
  const P=far?st.far:st.pal,sil=opt.sil,SC=opt.silColor,lm=st.shape.thick;
  const col=k=>sil?SC:P[k];
  for(const L of legs){
   if(L.far!==far)continue;
   const rs=[.11*lm,.086*lm,.064*lm,.044*lm,.012],pts=[L.hip,L.knee,L.ankle];
   const fx=L.foot,pr=[L.ankle[0]+(fx[0]-L.ankle[0])*.72,L.ankle[1]+(fx[1]-L.ankle[1])*.72];
   const chain=[[L.hip,rs[0]],[L.knee,rs[1]],[L.ankle,rs[2]],[pr,rs[3]],[fx,rs[4]]];
   const draw=(grow,fill)=>{c.fillStyle=fill;c.beginPath();for(let i=0;i<chain.length-1;i++){const a=chain[i],b=chain[i+1];taper(c,a[0][0],a[0][1],a[1]+grow,b[0][0],b[0][1],b[1]+grow)}c.fill()};
   draw(.02,sil?SC:P.dark);
   draw(0,col(far?'leg':'leg'));
   if(!sil){
    // darker lower leg and bright joint bands
    c.fillStyle=P.legDark;c.beginPath();taper(c,L.ankle[0],L.ankle[1],rs[2]*.9,pr[0],pr[1],rs[3]*.9);taper(c,pr[0],pr[1],rs[3]*.9,fx[0],fx[1],rs[4]);c.fill();
    c.fillStyle=P.band;
    for(const [pt,r] of [[L.knee,rs[1]*1.12],[L.ankle,rs[2]*1.12]]){c.beginPath();c.ellipse(pt[0],pt[1],r*1.02,r*.78,0,0,TAU);c.fill()}
    // top-lit streak along upper segments
    c.strokeStyle=far?'rgba(255,255,255,.1)':'rgba(255,240,210,.34)';c.lineCap='round';c.lineWidth=.026;
    c.beginPath();c.moveTo(L.hip[0],L.hip[1]-.03);c.lineTo(L.knee[0],L.knee[1]-.03);c.lineTo(L.ankle[0]+.01,L.ankle[1]-.02);c.stroke();
    // spines on merus / carpus
    c.fillStyle=P.spine;c.beginPath();
    const segs=[[L.hip,L.knee,.11],[L.knee,L.ankle,.09]],sc=st.shape.spineLen*(st.shape.thorns?1.25:1)*.75,n=st.shape.thorns?4:3;
    for(const [a,b,w] of segs){
     const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1;let nx=dy/d,ny=-dx/d;if(ny>0){nx=-nx;ny=-ny}
     for(let i=1;i<=n;i++){const t=i/(n+1),x=a[0]+dx*t,y=a[1]+dy*t;spike(c,x+nx*.05,y+ny*.05,nx,ny,.045*sc*(1-.12*i/n),.016)}
    }
    c.fill();
    if(st.shape.seta){
     c.strokeStyle='rgba(225,230,250,.5)';c.lineWidth=.008;c.beginPath();
     for(const [a,b] of [[L.hip,L.knee],[L.knee,L.ankle],[L.ankle,pr]]){
      const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1;let nx=dy/d,ny=-dx/d;
      for(let i=1;i<9;i++){const t=i/9,x=a[0]+dx*t,y=a[1]+dy*t;c.moveTo(x,y);c.lineTo(x+nx*.05-dx/d*.012,y+ny*.05-dy/d*.012);c.moveTo(x,y);c.lineTo(x-nx*.05-dx/d*.012,y-ny*.05-dy/d*.012)}
     }
     c.stroke();
    }
   }
  }
 }

 function drawClaw(c,st,P,opt,x,y,ang,sc,open,palm){
  const sil=opt.sil,SC=opt.silColor,col=k=>sil?SC:P[k];
  c.save();c.translate(x,y);c.rotate(ang);c.scale(sc,sc);
  const pw=palm||1;
  // dactyl (upper finger)
  c.fillStyle=sil?SC:P.dark;
  c.beginPath();c.moveTo(.05,-.2*pw);c.bezierCurveTo(.34,-.3*pw-open,.64,-.2*pw-open*1.4,.72,-.04-open*.9);c.bezierCurveTo(.5,-.1-open*.5,.32,-.06-open*.2,.14,-.02);c.closePath();c.fill();
  c.fillStyle=col('claw');
  c.beginPath();c.moveTo(.05,-.19*pw);c.bezierCurveTo(.34,-.28*pw-open,.62,-.19*pw-open*1.4,.69,-.05-open*.9);c.bezierCurveTo(.5,-.11-open*.5,.32,-.07-open*.2,.14,-.03);c.closePath();c.fill();
  // fixed finger (lower)
  c.fillStyle=sil?SC:P.dark;
  c.beginPath();c.moveTo(.0,.16*pw);c.bezierCurveTo(.3,.3*pw,.6,.25,.73,.1);c.bezierCurveTo(.5,.08,.34,.03,.14,.0);c.closePath();c.fill();
  c.fillStyle=col('claw');
  c.beginPath();c.moveTo(.0,.15*pw);c.bezierCurveTo(.3,.28*pw,.58,.23,.7,.1);c.bezierCurveTo(.5,.09,.34,.04,.14,.01);c.closePath();c.fill();
  // palm
  c.fillStyle=sil?SC:P.dark;c.beginPath();c.ellipse(-.02,0,.36,.27*pw+.02,0,0,TAU);c.fill();
  c.fillStyle=col('mid');c.beginPath();c.ellipse(-.02,0,.34,.25*pw,0,0,TAU);c.fill();
  if(!sil){
   const g=c.createLinearGradient(0,-.27*pw,0,.27*pw);g.addColorStop(0,P.top);g.addColorStop(.55,P.mid);g.addColorStop(1,P.dark);
   c.fillStyle=g;c.beginPath();c.ellipse(-.02,0,.34,.25*pw,0,0,TAU);c.fill();
   c.fillStyle='rgba(255,236,200,.28)';c.beginPath();c.ellipse(-.06,-.1*pw,.2,.07,-.1,0,TAU);c.fill();
   c.fillStyle=P.speck;c.globalAlpha=.8;c.beginPath();
   for(const [bx,by] of [[-.18,-.1],[-.06,-.14],[.06,-.08],[-.2,.05],[-.08,.06],[.04,.12],[.12,.0],[-.14,.16]]){c.moveTo(bx+.022,by*pw);c.arc(bx,by*pw,.022,0,TAU)}
   c.fill();c.globalAlpha=1;
   // teeth on the cutting edges
   c.fillStyle=P.tip;c.beginPath();
   for(let i=0;i<5;i++){const t=.2+i*.1;c.moveTo(t,-.045-open*.4*(t));c.lineTo(t+.03,-.0);c.lineTo(t-.02,-.0);c.closePath();c.moveTo(t+.01,.045);c.lineTo(t+.04,.012);c.lineTo(t-.01,.012);c.closePath()}
   c.fill();
   c.fillStyle=P.dark;c.beginPath();c.moveTo(.72,-.04-open*.9);c.quadraticCurveTo(.76,-.0,.73,.1);c.lineTo(.68,.06);c.lineTo(.68,-.05-open*.9);c.fill();
  }
  c.restore();
 }
 function drawArm(c,st,P,opt,pts,r0){
  const sil=opt.sil,SC=opt.silColor;
  const chain=pts.map((p,i)=>[p,r0*(1-i*.14)]);
  const go=(g,f)=>{c.fillStyle=f;c.beginPath();for(let i=0;i<chain.length-1;i++){const a=chain[i],b=chain[i+1];taper(c,a[0][0],a[0][1],a[1]+g,b[0][0],b[0][1],b[1]+g)}c.fill()};
  go(.02,sil?SC:P.dark);go(0,sil?SC:P.leg);
  if(!sil){c.fillStyle=P.band;for(let i=1;i<chain.length;i++){c.beginPath();c.ellipse(chain[i][0][0],chain[i][0][1],chain[i][1]*1.1,chain[i][1]*.8,0,0,TAU);c.fill()}
   c.fillStyle=P.spine;c.beginPath();for(let i=0;i<chain.length-1;i++){const a=chain[i][0],b=chain[i+1][0];for(let k=1;k<=3;k++){const t=k/4;spike(c,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t-.05,0,-1,.045*st.shape.spineLen,.016)}}c.fill()}
 }

 function drawBody(c,st,opt,m,idle,feeding){
  const P=st.pal,sil=opt.sil,SC=opt.silColor,sh=st.shape;
  c.save();c.translate(BODY.x,BODY.y+m.dy);c.rotate(m.rot);
  const pts=carapacePoints(st);
  // side wall / underside gives the 3/4 depth
  c.fillStyle=sil?SC:P.belly;c.beginPath();outlinePath(c,pts,0,.1,.97,1.0);c.fill();
  c.fillStyle=sil?SC:mix(P.belly,P.dark,.35);c.beginPath();outlinePath(c,pts,0,.06,.99,1.0);c.fill();
  // carapace
  c.fillStyle=sil?SC:P.dark;c.beginPath();outlinePath(c,pts,0,0,1.025,1.04);c.fill();
  if(sil){c.fillStyle=SC;c.beginPath();outlinePath(c,pts,0,0,1,1);c.fill()}
  else{
   const g=c.createLinearGradient(0,-.5*sh.ch,0,.34*sh.ch);g.addColorStop(0,P.top);g.addColorStop(.5,P.mid);g.addColorStop(1,mix(P.mid,P.dark,.7));
   c.fillStyle=g;c.beginPath();outlinePath(c,pts,0,0,1,1);c.fill();
   c.save();c.beginPath();outlinePath(c,pts,0,0,1,1);c.clip();
   if(sh.mottle){c.fillStyle='rgba(120,34,6,.22)';const r=rng(st.seed);for(let i=0;i<26;i++){const x=-.6+r()*1.3,y=-.4+r()*.6,w=.05+r()*.1;c.beginPath();c.ellipse(x*sh.cw,y*sh.ch,w,w*.6,r()*3,0,TAU);c.fill()}}
   // grooves of the carapace regions
   c.strokeStyle='rgba(40,8,10,.28)';c.lineWidth=.02;c.lineCap='round';c.beginPath();
   c.moveTo(-.1*sh.cw,-.42*sh.ch);c.bezierCurveTo(-.2*sh.cw,-.2*sh.ch,-.12*sh.cw,-.02*sh.ch,.1*sh.cw,.08*sh.ch);
   c.moveTo(.3*sh.cw,-.34*sh.ch);c.bezierCurveTo(.2*sh.cw,-.18*sh.ch,.28*sh.cw,-.02*sh.ch,.44*sh.cw,.04*sh.ch);
   c.moveTo(-.46*sh.cw,-.26*sh.ch);c.bezierCurveTo(-.36*sh.cw,-.14*sh.ch,-.3*sh.cw,.0,-.18*sh.cw,.12*sh.ch);
   c.stroke();
   // soft highlight and rim light
   c.fillStyle='rgba(255,240,210,.2)';c.beginPath();c.ellipse(-.02*sh.cw,-.33*sh.ch,.46*sh.cw,.1*sh.ch,-.08,0,TAU);c.fill();
   c.fillStyle='rgba(255,255,255,.1)';c.beginPath();c.ellipse(.1*sh.cw,-.38*sh.ch,.2*sh.cw,.04*sh.ch,-.1,0,TAU);c.fill();
   // granules
   const rr=rng(st.seed+11);c.fillStyle=P.speck;c.globalAlpha=.75;c.beginPath();
   for(let i=0;i<sh.bumps;i++){const a=rr()*TAU,d=Math.sqrt(rr())*.88,x=Math.cos(a)*d*.58*sh.cw,y=Math.sin(a)*d*.32*sh.ch-.08*sh.ch,r=.012+rr()*.014;c.moveTo(x+r,y);c.arc(x,y,r,0,TAU)}
   c.fill();c.globalAlpha=1;
   c.restore();
  }
  // marginal spines + gastric bosses
  c.fillStyle=sil?SC:P.spine;c.beginPath();
  const n=pts.length;
  for(let i=0;i<n;i++){
   const p=pts[i],L=p[2];if(!L)continue;
   const a=pts[(i-1+n)%n],b=pts[(i+1)%n];let tx=b[0]-a[0],ty=b[1]-a[1];const d=Math.hypot(tx,ty)||1;let nx=ty/d,ny=-tx/d;
   const side=nx*(p[0])+ny*(p[1]);if(side<0){nx=-nx;ny=-ny}
   spike(c,p[0]-nx*.02,p[1]-ny*.02,nx,ny,.1*L*sh.spineLen*sh.spines**.4,.032*(sh.thorns?.8:1));
  }
  c.fill();
  if(!sil){
   c.fillStyle=P.tip;c.beginPath();
   for(const [bx,by,r] of [[.0,-.3,.036],[.24,-.24,.03],[-.24,-.22,.03],[.02,-.12,.026],[.36,-.1,.022],[-.4,-.08,.022]].slice(0,2+Math.round(sh.spines*2.2))){c.moveTo(bx*sh.cw+r,by*sh.ch);c.arc(bx*sh.cw,by*sh.ch,r*(sh.thorns?.8:1),0,TAU)}
   c.fill();
   c.fillStyle=P.spine;c.beginPath();
   const bosses=[[.0,-.3],[.24,-.24],[-.24,-.22]];
   for(const [bx,by] of bosses)spike(c,bx*sh.cw,by*sh.ch-.02,0,-1,.07*sh.spineLen,.02);
   c.fill();
   if(sh.gold){c.strokeStyle=P.band;c.globalAlpha=.55;c.lineWidth=.02;c.beginPath();outlinePath(c,pts,0,0,.985,.985);c.stroke();c.globalAlpha=1}
  }
  c.restore();
 }
 function drawFace(c,st,opt,m,idle){
  const P=st.pal,sil=opt.sil,SC=opt.silColor;
  c.save();c.translate(BODY.x,BODY.y+m.dy);c.rotate(m.rot);
  const sh=st.shape,wob=Math.sin(idle*1.3)*.01;
  // antennae
  if(!sil){c.strokeStyle=P.leg;c.lineWidth=.016;c.lineCap='round';c.beginPath();c.moveTo(.74*sh.cw,-.02);c.bezierCurveTo(.92*sh.cw,-.16+wob,1.02*sh.cw,-.26+wob,1.2*sh.cw,-.28);c.moveTo(.72*sh.cw,-.06);c.bezierCurveTo(.86*sh.cw,-.24,.94*sh.cw,-.34+wob,1.06*sh.cw,-.42);c.stroke()}
  // eyes on stalks
  for(const [ex,ey,r] of [[.54*sh.cw,-.31*sh.ch,.045],[.64*sh.cw,-.2*sh.ch,.052]]){
   c.fillStyle=sil?SC:P.mid;c.beginPath();taper(c,ex-.04,ey+.07,.04,ex,ey,.034);c.fill();
   c.fillStyle=sil?SC:P.eye;c.beginPath();c.arc(ex,ey,r,0,TAU);c.fill();
   if(!sil){c.fillStyle='rgba(255,255,255,.85)';c.beginPath();c.arc(ex+r*.28,ey-r*.32,r*.3,0,TAU);c.fill();c.strokeStyle=P.band;c.lineWidth=.01;c.globalAlpha=.7;c.beginPath();c.arc(ex,ey,r*1.18,0,TAU);c.stroke();c.globalAlpha=1}
  }
  c.restore();
 }

 function draw(c,f,s,opt={}){
  const id=s&&s.id,st=STYLES[id];if(!st)return false;
  const L=s.len,H=s.ht||s.height,k=Math.min(H/2,L/(2*ASPECT)),idle=f.phase||0;
  const still=!!(opt.sizeMeasure||opt.pv);
  const amp=!still&&Number.isFinite(f._bAmp)?f._bAmp:1;
  const gait=opt.sizeMeasure?.2:(!still&&Number.isFinite(f._bGait)?f._bGait:idle/TAU);
  const feeding=!!f._bFeeding270;
  const o={sil:!!opt.sil,silColor:'#06192a'};
  const legs=legPose(st,gait,amp,idle),m=bodyMotion(gait,amp,idle);
  c.save();
  try{
   c.scale(k,k);const fit=st.fit||IDENT;c.translate(fit.x,fit.y);c.scale(fit.s,fit.s);c.lineJoin='round';c.lineCap='round';
   drawLegs(c,st,legs,true,o);
   // far claw (smaller, behind)
   const fcl=.2*Math.sin(TAU*gait+1)*amp+.04*Math.sin(idle*.8);
   const sh=st.shape;
   drawArm(c,st,st.far,o,[bodyPoint(m,.5,-.06),bodyPoint(m,.78,.0),[1.12+fcl*.1,-.12+m.dy]],.07*sh.thick);
   drawClaw(c,st,st.far,o,1.2+fcl*.1,-.22+m.dy,-.3,.5*sh.claw,.03,.9);
   drawLegs(c,st,legs,false,o);
   drawBody(c,st,o,m,idle,feeding);
   drawFace(c,st,o,m,idle);
   // near claw (large)
   const open=(feeding?.07+.06*Math.sin(idle*5):.04+.018*Math.sin(idle*.9+TAU*gait*.5))*sh.clawR;
   const sway=.025*Math.sin(TAU*gait*2+.8)*amp;
   const sp=bodyPoint(m,.56,.14),el=[.92,.4+sway+m.dy],wr=[1.1,.2+sway+m.dy];
   drawArm(c,st,st.pal,o,[sp,el,wr],.09*sh.thick);
   drawClaw(c,st,st.pal,o,wr[0]+.1,wr[1]-.02,-.2,.72*sh.claw*(sh.clawR>1.2?1.08:1),open,1.02*(sh.clawR>1.2?1.1:1));
  }finally{c.restore()}
  return true;
 }

 // ---------- walking / steering ----------
 // Returns the sign the sprite faces right now (flips at the middle of a pivot).
 function faceOf(f){return(Number.isFinite(f._bYaw)?f._bYaw:(f._bHeading270||1))<0?-1:1}
 function turnScale(f){
  const y=Number.isFinite(f._bYaw)?Math.abs(f._bYaw):1;
  return y>=1?1:Math.max(MIN_SQUASH,y);
 }
 /* dir: sign of the wanted travel (-1,0,1). Returns {turning}. The crab only walks once it faces its goal. */
 function steer(f,dir,wantsMove,dt){
  let heading=f._bHeading270||(f._bHeading270=f.face<0?-1:1);
  if(!Number.isFinite(f._bYaw))f._bYaw=heading;
  if(wantsMove&&dir&&dir!==heading){heading=f._bHeading270=dir}
  if(f._bYaw!==heading){
   const step=TURN_RATE*dt;
   f._bYaw=f._bYaw<heading?Math.min(heading,f._bYaw+step):Math.max(heading,f._bYaw-step);
  }
  return{turning:f._bYaw!==heading,heading};
 }
 /* v: current horizontal speed (px/s), pxPerUnit: screen px per design unit. */
 function advance(f,dt,v,pxPerUnit,turning){
  const target=turning?.55:clamp(Math.abs(v)/1.2,0,1);
  const a=Number.isFinite(f._bAmp)?f._bAmp:0;
  f._bAmp=a+(target-a)*Math.min(1,dt*6);
  if(turning){f._bGait=(f._bGait||0)+dt*.7;return}
  const unitsPerSec=Math.abs(v)/Math.max(1,pxPerUnit);
  f._bGait=(f._bGait||0)+unitsPerSec/STRIDE_PER_CYCLE*dt;
 }

 root.KingCrabWalk={version:1,STYLES,ids:Object.keys(STYLES),LEGS,BODY,ASPECT,SPAN_Y,DUTY,STRIDE,LIFT,GROUND,WALK_SPEED_MUL,STRIDE_PER_CYCLE,legPose,footAt,bodyMotion,draw,steer,advance,faceOf,turnScale,is:id=>!!STYLES[id]};
})(typeof window==='undefined'?globalThis:window);
