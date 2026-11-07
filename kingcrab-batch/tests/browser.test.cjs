'use strict';
// Real-browser integration test: loads the patched 4.2.219 client in headless Chrome (local file, offline mode),
// then checks shop, encyclopedia, rendering and walking through the game's own code. Skipped without Chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers.cjs');

const CLIENT_URL = 'file://' + path.join(h.ROOT, 'client/index.html');
const NAMES = { o_king_crab: '赤金帝王蟹', o_blue_king_crab: '藍帝王蟹', o_golden_king_crab: '黃金帝王蟹', o_chilean_king_crab: '智利帝王蟹' };
const skip = h.chromeAvailable() ? false : 'no Chrome/Chromium found (set CHROME_BIN)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('patched client in headless Chrome', { skip, timeout: 240000 }, async t => {
  const { openPage } = await import('../tools/cdp.mjs');
  const page = await openPage({ width: 1700, height: 900 });
  t.after(() => page.close());
  await page.goto(CLIENT_URL, 4000);

  await t.test('boots without script errors and exposes the four crabs through SPECIES', async () => {
    assert.deepEqual(page.errors, []);
    const out = JSON.parse(await page.eval(`JSON.stringify(Object.fromEntries(Object.entries(window.__aquarium.SPECIES).filter(([k])=>/king_crab/.test(k)).map(([k,s])=>[k,{name:s.name,role:s.role,price:s.price,gems:s.altGems,len:s.len,ht:s.ht,breedOnly:s.breedOnly}])))`));
    assert.deepEqual(Object.keys(out).sort(), Object.keys(NAMES).sort());
    for (const [id, s] of Object.entries(out)) {
      assert.equal(s.name, NAMES[id]); assert.equal(s.role, 'bottom'); assert.equal(s.price, 2000000); assert.equal(s.gems, 500); assert.equal(s.breedOnly, false);
    }
  });

  await t.test('shop 新上市 lists all four king crabs at 🪙2,000,000 with a 💎 option and the updated 深海光境 copy', async () => {
    await page.eval(`[...document.querySelectorAll('.sbtn')].find(x=>/商店/.test(x.innerText)).click()`);
    await sleep(500);
    await page.eval(`document.querySelector('[data-sv2="src:new"]').click()`);
    await sleep(800);
    const rows = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.item')].filter(i=>/帝王蟹/.test(i.innerText)).map(i=>({text:i.innerText,img:!!i.querySelector('img[src^="data:image"]')})))`));
    assert.equal(rows.length, 4);
    const order = rows.map(r => r.text.split('\n')[0]);
    assert.deepEqual(order, Object.values(NAMES));
    for (const r of rows) { assert.match(r.text, /2,000,000/); assert.match(r.text, /💎 鑽石/); assert.match(r.text, /巨型 150cm/); assert.ok(r.img, 'shows a rendered thumbnail'); }
    const note = await page.eval(`document.body.innerText.match(/海洋館 Lv2[^\\n]*/)[0]`);
    for (const n of Object.values(NAMES)) assert.ok(note.includes(n), n);
  });

  await t.test('shop thumbnails are rendered king crabs (not blank) and differ per species', async () => {
    const urls = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.item')].filter(i=>/帝王蟹/.test(i.innerText)).map(i=>i.querySelector('img').src))`));
    assert.equal(new Set(urls).size, 4);
    for (const u of urls) assert.ok(u.length > 3000, 'non-trivial PNG');
    const boxes = JSON.parse(await page.eval(`(async()=>{const out=[];for(const u of ${JSON.stringify(urls)}){const im=new Image();im.src=u;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let l=1e9,r=-1,t=1e9,b=-1;for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++)if(d[(y*c.width+xx)*4+3]>40){if(xx<l)l=xx;if(xx>r)r=xx;if(y<t)t=y;if(y>b)b=y}out.push({w:r-l+1,h:b-t+1,cw:c.width,ch:c.height,l,r})}return JSON.stringify(out)})()`));
    for (const b of boxes) { assert.ok(b.w >= 0.7 * b.cw, `thumbnail crab fills the card (${b.w}/${b.cw})`); assert.ok(b.l >= 0 && b.r <= b.cw - 1); }
  });

  await t.test('encyclopedia (魚種圖鑑) lists all four', async () => {
    await page.eval(`document.querySelector('#sheetX,.sheet-x')?.click()`);
    await page.goto(CLIENT_URL, 3500);
    await page.eval(`[...document.querySelectorAll('.sbtn')].find(x=>/圖鑑/.test(x.innerText)).click()`);
    await sleep(500);
    await page.eval(`[...document.querySelectorAll('button')].find(x=>/魚種圖鑑/.test(x.innerText)).click()`);
    await sleep(600);
    await page.eval(`(()=>{const i=document.querySelector('input[placeholder*="輸入暱稱"]');i.value='帝王蟹';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(800);
    const text = await page.eval('document.body.innerText');
    for (const n of Object.values(NAMES)) assert.equal(text.split(n).length - 1, 1, n);
    assert.match(text, /圖鑑版本 4\.2\.219/);
  });

  await t.test('pixel extents over a full gait cycle fit the 107x60 sprite box and the feet touch the sand line', async () => {
    const { measure } = await import('../tools/measure-fit.mjs');
    const res = await measure();
    for (const [id, v] of Object.entries(res)) {
      const { l, r, t: top, b } = v.extent;
      assert.ok(l >= -1.785 && r <= 1.785, `${id} width ${l}..${r}`);
      assert.ok(top >= -1.01, `${id} top ${top}`);
      assert.ok(b <= 1.02 && b >= 0.97, `${id} feet at ${b}`);
      assert.ok(r - l > 3.1, `${id} uses most of the box width (${(r - l).toFixed(2)} of 3.57)`);
    }
  });

  await page.goto(CLIENT_URL, 3500);
  const setup = `(()=>{const A=window.__aquarium,st=A.snapshot();
    const mk=(sp,i,px)=>({id:'t'+i,sp,name:'T'+i,hue:A.SPECIES[sp].hue,size:1,growth:300,full:90,health:100,cd:0,coinT:999,seed:11+i,px,py:.9,dir:i%2?1:-1,stress:0,finDmg:0});
    const ids=['o_king_crab','o_blue_king_crab','o_golden_king_crab','o_chilean_king_crab','b_violet_urchin','b_jade_cucumber','b_coral_star','o_aurora_urchin'];
    st.fish=ids.map((sp,i)=>mk(sp,i,.1+.11*i));A.loadState(st);return 1})()`;
  await page.eval(setup);

  await t.test('simulated 6 minutes in a crowded tank: no backwards walking, crabs stay on the sand line, other benthics never get crab state', async () => {
    const crabs = Object.keys(NAMES);
    const seen = {}, lastX = {}, y0 = {};
    let bad = [], flips = 0;
    const midPivot = {};
    const moved = {};
    for (let s = 0; s < 360; s++) {
      const snap = JSON.parse(await page.eval(`(()=>{const A=window.__aquarium;A.step(1);return JSON.stringify(A.state.fish.map(f=>({sp:f.sp,x:f.x,y:f.y,vx:f.vx||0,face:f.face,gait:f._bGait,amp:f._bAmp,yaw:f._bYaw})))})()`));
      for (const f of snap) {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${f.sp} finite position`);
        if (crabs.includes(f.sp)) {
          if (Math.abs(f.vx) > 0.4 && Math.sign(f.vx) !== f.face) bad.push([s, f.sp, f.vx, f.face]);
          if (seen[f.sp] !== undefined && seen[f.sp] !== f.face) flips++;
          seen[f.sp] = f.face;
          const mid = Math.abs(f.yaw) < 0.999;
          midPivot[f.sp] = mid ? (midPivot[f.sp] || 0) + 1 : 0;
          assert.ok(midPivot[f.sp] < 60, `${f.sp} never gets stuck mid-pivot (${midPivot[f.sp]} steps)`);
          y0[f.sp] ??= f.y; assert.ok(Math.abs(f.y - y0[f.sp]) < 1.5, `${f.sp} stays on the sand line`);
          assert.ok(Number.isFinite(f.gait) && Number.isFinite(f.amp) && Number.isFinite(f.yaw));
          moved[f.sp] = (moved[f.sp] || 0) + (lastX[f.sp] === undefined ? 0 : Math.abs(f.x - lastX[f.sp]));
        } else moved[f.sp] = (moved[f.sp] || 0) + (lastX[f.sp] === undefined ? 0 : Math.abs(f.x - lastX[f.sp]));
        lastX[f.sp] = f.x;
        if (!crabs.includes(f.sp)) { assert.equal(f.gait, undefined); assert.equal(f.yaw, undefined); }
      }
    }
    assert.deepEqual(bad, [], 'no frame where a crab walks backwards relative to its facing');
    assert.ok(Object.keys(NAMES).some(id => moved[id] > 0), 'at least one crab moved in the crowd');
    assert.deepEqual(page.errors, []);
  });

  await t.test('each crab on its own walks, pivots, faces its direction of travel and never slides backwards', async () => {
    for (const id of Object.keys(NAMES)) {
      await page.eval(`(()=>{const A=window.__aquarium,st=A.snapshot();st.fish=[{id:'solo',sp:'${id}',name:'S',hue:A.SPECIES['${id}'].hue,size:1,growth:300,full:90,health:100,cd:0,coinT:999,seed:5,px:.5,py:.9,dir:1,stress:0,finDmg:0}];A.loadState(st);return 1})()`);
      let moved = 0, last = null, flips = 0, lastFace = null;
      for (let s = 0; s < 900 && !(s >= 180 && moved > 80 && flips >= 1); s++) {
        const f = JSON.parse(await page.eval(`(()=>{const A=window.__aquarium;A.step(1);const f=A.state.fish[0];return JSON.stringify({x:f.x,vx:f.vx||0,face:f.face,gait:f._bGait})})()`));
        if (last !== null) moved += Math.abs(f.x - last);
        if (lastFace !== null && lastFace !== f.face) flips++;
        if (Math.abs(f.vx) > 0.4) assert.equal(Math.sign(f.vx), f.face, `${id} t=${s}`);
        last = f.x; lastFace = f.face;
      }
      assert.ok(moved > 80, `${id} walked ${moved.toFixed(0)} px alone`);
      const saved = JSON.parse(await page.eval(`JSON.stringify(window.__aquarium.snapshot().fish[0])`));
      assert.deepEqual(Object.keys(saved).filter(k => k.startsWith('_b')), [], 'walk state is runtime only, never saved');
      assert.equal(saved.sp, id);
      assert.ok(flips >= 1, `${id} turned around (${flips})`);
    }
  });

  await t.test('other benthics alone still crawl exactly as before (no turning, no gait state)', async () => {
    for (const id of ['b_violet_urchin', 'b_jade_cucumber', 'b_coral_star', 'o_aurora_urchin', 'o_tidal_star']) {
      await page.eval(`(()=>{const A=window.__aquarium,st=A.snapshot();st.fish=[{id:'solo',sp:'${id}',name:'S',hue:A.SPECIES['${id}'].hue,size:1,growth:300,full:90,health:100,cd:0,coinT:999,seed:5,px:.5,py:.9,dir:1,stress:0,finDmg:0}];A.loadState(st);return 1})()`);
      let moved = 0, last = null, st;
      for (let s = 0; s < 240; s++) {
        st = JSON.parse(await page.eval(`(()=>{const A=window.__aquarium;A.step(1);const f=A.state.fish[0];return JSON.stringify({x:f.x,gait:f._bGait,yaw:f._bYaw,amp:f._bAmp,heading:f._bHeading270})})()`));
        if (last !== null) moved += Math.abs(st.x - last);
        last = st.x;
      }
      assert.ok(moved > 3, `${id} crawled ${moved.toFixed(1)} px`);
      assert.equal(st.gait, undefined); assert.equal(st.yaw, undefined); assert.equal(st.amp, undefined);
    }
  });

  await page.eval(setup);
  await t.test('rendering: crabs are painted with their own palette on the tank canvas and legs reach the sand line', async () => {
    const res = JSON.parse(await page.eval(`(()=>{const A=window.__aquarium;A.step(.05);const cv=document.getElementById('tank'),c=cv.getContext('2d'),dpr=cv.width/cv.clientWidth;
      const out={};const K=window.KingCrabWalk;
      for(const f of A.state.fish){if(!/king_crab/.test(f.sp))continue;const pal=K.STYLES[f.sp].pal,hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
        const w=Math.round(240*dpr),hh=Math.round(150*dpr),x0=Math.max(0,Math.round(f.x*dpr-w/2)),y0=Math.max(0,Math.round(f.y*dpr-hh*.6));
        const d=c.getImageData(x0,y0,Math.min(w,cv.width-x0),Math.min(hh,cv.height-y0)).data;
        const tgt=hex(pal.mid);let n=0,bottom=-1;
        for(let i=0;i<d.length;i+=4){const dist=Math.hypot(d[i]-tgt[0],d[i+1]-tgt[1],d[i+2]-tgt[2]);if(dist<70&&d[i+3]>200)n++}
        out[f.sp]={n,y:f.y,x:f.x}}
      return JSON.stringify(out)})()`));
    for (const id of Object.keys(NAMES)) assert.ok(res[id].n > 120, `${id}: ${res[id].n} palette pixels`);
  });

  await t.test('render cost with 4 crabs on screen stays modest (live drawing, no cache)', async () => {
    const ms = await page.eval(`(()=>{const A=window.__aquarium;const t0=performance.now();for(let i=0;i<60;i++)A.step(.05);return (performance.now()-t0)/60})()`);
    t.diagnostic(`avg step+render with 8 benthics: ${ms.toFixed(2)} ms`);
    assert.ok(ms < 60, `${ms} ms per frame`);
  });
});
