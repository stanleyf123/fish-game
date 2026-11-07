#!/usr/bin/env node
// Builds client/index.html (GAME_BUILD 4.2.219) from the live 4.2.218 baseline.
// Every edit is an exact-string replacement that must match exactly once, so the patch fails loudly
// if the baseline drifts. No network access, no secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_MD5 = '0e46c5bfe7fd59c142fb3188e722eee8';
export const NEW_BUILD = '4.2.219';
export const NEW_IDS = ['o_blue_king_crab', 'o_golden_king_crab', 'o_chilean_king_crab'];
export const CRAB_IDS = ['o_king_crab', ...NEW_IDS];

export function buildClient() {
  const baseFile = path.join(root, 'baseline/live-index-4.2.218.html');
  const baseBuf = fs.readFileSync(baseFile);
  const md5 = crypto.createHash('md5').update(baseBuf).digest('hex');
  if (md5 !== BASE_MD5) throw new Error(`baseline md5 ${md5} != ${BASE_MD5}`);
  let html = baseBuf.toString('utf8');
  const walkSrc = fs.readFileSync(path.join(root, 'src/kingcrab-walk.js'), 'utf8').trimEnd();
  const patch = JSON.parse(fs.readFileSync(path.join(root, 'config/kingcrab-species-patch.json'), 'utf8'));

  const edits = [];
  const rep = (name, from, to) => {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`${name}: expected exactly 1 match, found ${n}`);
    html = html.replace(from, () => to);
    edits.push(name);
  };

  // 1. shared walk module, defined before Benthic267 so the helper can reach it lazily
  rep('inline-walk-module',
    '/* BENTHIC267: isolated new sea-floor species.',
    `${walkSrc}\n\n/* BENTHIC267: isolated new sea-floor species.`);

  // 2. meta: the four king crabs are procedural (no PNG), the other benthics are untouched
  rep('meta-o_king_crab',
    '"o_king_crab":{"file":"kingcrab275-v2.png","kind":"crab","crop":[59,111,1414,792],"pack":"/art/ocean275/","swim":false,"glow":null}});',
    '"o_king_crab":{"kind":"kingcrab","proc":"kingcrab","walk":true,"swim":false,"glow":null}});\n' +
    ` Object.assign(meta,{${NEW_IDS.map(id => `"${id}":{"kind":"kingcrab","proc":"kingcrab","walk":true,"swim":false,"glow":null}`).join(',')}});`);

  rep('image-skip-proc',
    'function image(s){const m=entry(s);if(!m)return null;if(cache.has(m.file))',
    'function image(s){const m=entry(s);if(!m)return null;if(m.proc)return null;if(cache.has(m.file))');
  rep('ready-skip-proc',
    'async function ready(){await Promise.all(Object.keys(meta).map(id=>{const im=image({id});return im.decode()}))}',
    'async function ready(){await Promise.all(Object.keys(meta).map(id=>{const im=image({id});return im?im.decode():null}))}');
  rep('draw-proc',
    '  const m=entry(s);if(!m)return false;\n  const im=image(s);',
    '  const m=entry(s);if(!m)return false;\n  if(m.proc)return root.KingCrabWalk?root.KingCrabWalk.draw(c,f,s,opt):true;\n  const im=image(s);');

  // 3. step(): king crabs face their travel direction, pivot before reversing, and drive the gait from distance walked
  rep('step-walk-flag',
    "const m=entry(s),heading=f._bHeading270||(f._bHeading270=f.face<0?-1:1);",
    "const m=entry(s),walk=!!m.walk&&!!root.KingCrabWalk,heading=f._bHeading270||(f._bHeading270=f.face<0?-1:1);");
  rep('step-speed',
    'const distance=Math.abs(dx),limit=s.speed||4;',
    'const distance=Math.abs(dx),limit=(s.speed||4)*(walk?root.KingCrabWalk.WALK_SPEED_MUL:1);');
  rep('step-steer',
    "  const want=blocked||(!food&&f.rest>0)||distance<.5?0:Math.sign(dx)*Math.min(limit,distance*1.4);",
    "  let want=blocked||(!food&&f.rest>0)||distance<.5?0:Math.sign(dx)*Math.min(limit,distance*1.4),turning=false;\n" +
    "  if(walk){const K=root.KingCrabWalk,dir=Math.sign(dx),st=K.steer(f,dir,want!==0&&distance>6,dt);turning=st.turning;if(turning||(dir&&dir!==st.heading))want=0}");
  rep('step-stop-while-turning',
    "if(blocked||distance<.5||Math.abs(v)*dt>distance)v=0;",
    "if(blocked||turning||distance<.5||Math.abs(v)*dt>distance)v=0;");
  rep('step-advance',
    "  f.phase=(f.phase||0)+dt*(.7+Math.abs(v)*.15);f.dir=heading;f.face=heading;",
    "  f.phase=(f.phase||0)+dt*(.7+Math.abs(v)*.15);\n" +
    "  if(walk){const K=root.KingCrabWalk;K.advance(f,dt,v,e.height/K.SPAN_Y,turning);f.dir=f._bHeading270;f.face=K.faceOf(f)}else{f.dir=heading;f.face=heading}");

  rep('export',
    'root.Benthic267={version:275,image,meta,is:s=>!!entry(s)&&!entry(s).swim,draw,step,ready};',
    'root.Benthic267={version:275,image,meta,is:s=>!!entry(s)&&!entry(s).swim,live:s=>!!entry(s)&&!!entry(s).proc,turnScale:(f,s)=>entry(s)?.walk&&root.KingCrabWalk?root.KingCrabWalk.turnScale(f):1,draw,step,ready};');

  // 4. render path: animated crabs are drawn live (no phase cache) and squash while pivoting
  rep('spr-bypass',
    '  draw(f,s,sc){if(!this.on)return false;/*SWIMANIM-V1',
    '  draw(f,s,sc){if(!this.on)return false;/*KINGCRAB-WALK-V1 live walk cycle, not phase-cached*/if(Benthic267.live(s))return false;/*SWIMANIM-V1');
  rep('render-turn',
    "if(Benthic267.is(s)||s.body==='shrimp'||(RX&&RX.noTilt(s))){}else if(f.vert>.02)",
    "if(Benthic267.is(s)||s.body==='shrimp'||(RX&&RX.noTilt(s))){if(Benthic267.is(s)){const q=Benthic267.turnScale(f,s);if(q!==1)ctx.scale(q,1)}}else if(f.vert>.02)");

  // 4b. shop / encyclopedia thumbnails: fit the wide, long-legged crab to the card (generic fish fit leaves it tiny)
  rep('preview-fit',
    "pdy=s.body==='frog'?2:0}\n  if(stg!=null)sc*=",
    "pdy=s.body==='frog'?2:0}\n  /*KINGCRAB-WALK-V1*/if(window.Benthic267&&Benthic267.live(s)){sc=Math.min(150/s.len,88/s.ht);pdx=-3*sc;pdy=0}\n  if(stg!=null)sc*=");

  // 5. offline / stale-config fallback (owned-ID safety net), same objects as the server patch
  rep('fallback',
    '\n/* JELLY313: retain owned jellyfish when remote configuration is unavailable. */',
    `\n/* KINGCRAB-V1: 帝王蟹三新種（與伺服器設定相同） */\nObject.assign(TURTLE185_FALLBACK,${JSON.stringify(patch.species)});\n/* JELLY313: retain owned jellyfish when remote configuration is unavailable. */`);

  // 6. shop 新上市 + 深海光境 copy
  rep('newx',
    '"o_lantern_fish","o_king_crab","b_violet_urchin"',
    `"o_lantern_fish","o_king_crab",${NEW_IDS.map(i => `"${i}"`).join(',')},"b_violet_urchin"`);
  rep('note-copy',
    '極光燈棘海膽、星潮螢海星、深海珠燈魚與赤金帝王蟹新登場。帝王蟹可用200萬金幣或500鑽，擇一付款。',
    '極光燈棘海膽、星潮螢海星、深海珠燈魚與赤金帝王蟹新登場，另有藍帝王蟹、黃金帝王蟹、智利帝王蟹三款新成員。四款帝王蟹都以長腿邁步、朝行進方向轉身，可用200萬金幣或500鑽，擇一付款。');

  // 7. build bump
  rep('game-build', "const GAME_BUILD='4.2.218';/*V406-CLIENT*/", `const GAME_BUILD='${NEW_BUILD}';/*V406-CLIENT*/`);
  rep('art-catalog-version', "export3/catalog.json?v=4.2.218", `export3/catalog.json?v=${NEW_BUILD}`);

  return {html, edits};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {html, edits} = buildClient();
  const out = path.join(root, 'client/index.html');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, html);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1e6).toFixed(2)} MB), ${edits.length} edits: ${edits.join(', ')}`);
}
