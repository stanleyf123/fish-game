#!/usr/bin/env node
// Measures the pixel extents of every king crab over a full gait cycle (headless Chrome) and prints the
// FIT table used by src/kingcrab-walk.js so the walking crab fills the same sprite box the old PNG did.
//   node tools/measure-fit.mjs          check current FIT against the box (exit 1 when outside)
//   node tools/measure-fit.mjs --raw    measure the unfitted drawing and print a new FIT table
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openPage} from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MEASURE_JS = `(raw=>{
 const cv=document.createElement('canvas');cv.width=1200;cv.height=700;const c=cv.getContext('2d',{willReadFrequently:true});
 const U=300; // px per design unit (sprite box is len 107.13 x height 60 => half height 30 box px = 1 unit)
 function ext(id,g,amp){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,1200,700);c.save();c.translate(600,350);c.scale(10,10);
  KingCrabWalk.draw(c,{_bGait:g,_bAmp:amp,phase:1},{id,len:107.13,ht:60});c.restore();
  const d=c.getImageData(0,0,1200,700).data;let l=1e9,r=-1,t=1e9,b=-1;
  for(let y=0;y<700;y++)for(let x=0;x<1200;x++)if(d[(y*1200+x)*4+3]>=32){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y}
  return[(l-600)/U,(r-600)/U,(t-350)/U,(b-350)/U]}
 const out={};
 for(const id of KingCrabWalk.ids){const keep=KingCrabWalk.STYLES[id].fit;if(raw)KingCrabWalk.STYLES[id].fit=null;
  let m=[1e9,-1e9,1e9,-1e9];for(let i=0;i<24;i++){const e=ext(id,i/24,1);m=[Math.min(m[0],e[0]),Math.max(m[1],e[1]),Math.min(m[2],e[2]),Math.max(m[3],e[3])]}
  KingCrabWalk.STYLES[id].fit=keep;
  const [l,r,t,b]=m,w=r-l,h=b-t,s=Math.min(2*KingCrabWalk.ASPECT/w,2/h)*.985;
  out[id]={extent:{l,r,t,b},fit:{s:+s.toFixed(4),x:+(-(l+r)/2*s).toFixed(4),y:+(1-b*s).toFixed(4)}}}
 return JSON.stringify(out)})`;

export async function measure({raw = false} = {}) {
  const page = await openPage({width: 1200, height: 700});
  try {
    await page.goto('about:blank', 50);
    await page.eval(fs.readFileSync(path.join(root, 'src/kingcrab-walk.js'), 'utf8'));
    return JSON.parse(await page.eval(`${MEASURE_JS}(${raw})`));
  } finally { await page.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = process.argv.includes('--raw');
  const res = await measure({raw});
  if (raw) {
    console.log('const FIT={' + Object.entries(res).map(([id, v]) => `${id}:{s:${v.fit.s},x:${v.fit.x},y:${v.fit.y}}`).join(',') + '};');
  } else {
    let bad = false;
    for (const [id, v] of Object.entries(res)) {
      const {l, r, t, b} = v.extent;
      const ok = l >= -1.785 && r <= 1.785 && t >= -1.01 && b <= 1.02 && b >= 0.97;
      if (!ok) bad = true;
      console.log(`${ok ? 'ok ' : 'BAD'} ${id} x[${l.toFixed(3)},${r.toFixed(3)}] y[${t.toFixed(3)},${b.toFixed(3)}]`);
    }
    process.exit(bad ? 1 : 0);
  }
}
