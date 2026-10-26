/* 悠游水族箱 — 混種（hybrid.js）：任兩種魚都能配種。跨種配對的子代可能是父母其中一種，或「A×B 混種」。
 * 混種的物種代號：'hx:<A>+<B>'（A、B 為設定中的基本魚種代號，依字母排序）。混種的資料由父母資料「確定性地」推導（同一組父母永遠得到同一個混種），
 * 所以存檔只要存代號，遊戲端與伺服器端（server/src/hybrid.js 為同一份檔案的複本）都能還原，伺服器據此驗證存檔。
 * 設定：GAME_CONFIG.breeding.hybrid = { enabled, parentChance(跨種時生出父母其中一種的機率), coinFactor, sellFactor }
 *       GAME_CONFIG.premium = { breedable, breedCooldownSec(限定魚父母的冷卻), hybridSellCap }
 */
(function (root) {
  'use strict';
  const FISHY = ['fish', 'tall', 'round', 'elongated', 'torpedo', 'disc', 'arowana', 'catfish', 'pleco'];
  const PREMIUM_LOOK = ['glow', 'shimmer', 'shimmerHue', 'aura', 'auraColor', 'trail', 'trailColor', 'hueCycle'];
  const EXT_PAT = ['tigerBars', 'leopard', 'reticulate', 'ocellus', 'calico', 'lateral', 'mask', 'gradient', 'pearl', 'pinstripe', 'marble', 'saddle', 'belly2', 'bandsShrimp', 'pearl3', 'galaxy', 'prism', 'goldleaf', 'sakura', 'flame', 'crystal', 'aurora', 'starlight'];
  const BASE=/^[a-z][a-zA-Z0-9_]{1,31}$/;
  function parse(id,depth=0){if(typeof id!=='string'||id.length>8192||depth>5||!id.startsWith('hx:'))return null;const raw=id.slice(3).split('+');if(raw.length!==2)return null;try{const p=raw.map(decodeURIComponent);if(p.some(x=>!BASE.test(x)&&!parse(x,depth+1)))return null;return p}catch(e){return null}}
  const isHybrid=id=>!!parse(id);
  function generation(id){const p=parse(id);return p?1+Math.max(...p.map(generation)):0}
  const MAX_GENERATION=6;
  const idOf=(a,b)=>'hx:'+ [a,b].sort().map(encodeURIComponent).join('+');
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const short = (n) => String(n || '').replace(/[（(].*?[）)]/g, '').trim().slice(0, 5);
  const mixHue = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };
  const TEMP_RANK = { peaceful: 0, aggressive: 1, predator: 2 };
  // 混種名稱：取兩種魚名字的特徵字組成新名字（例：鬥魚×龍魚 → 鬥龍魚、霓虹燈魚×神仙魚 → 霓虹仙魚）；同一組父母永遠同名
  const CLS = '魚龜蝦蟹螺鯊鯨魟鰻鱔豚';
  const core = (n) => { const t = short(n).replace(/[^\u4e00-\u9fff]/g, ''); return CLS.includes(t.slice(-1)) && t.length > 1 ? t.slice(0, -1) : t; };
  const clsOf = (n) => { const t = short(n).replace(/[^\u4e00-\u9fff]/g, ''); return CLS.includes(t.slice(-1)) ? t.slice(-1) : '魚'; };
  function hybridName(A, B, main, h, cfg) {
    const [F, G] = (h & 1) ? [B, A] : [A, B];
    const cf = core(F.name), cg = core(G.name);
    if (!cf || !cg) return `${short(A.name)}×${short(B.name)}`;
    const pre = cf.slice(0, Math.min(2, cf.length)), post = cg.slice(-(pre.length >= 2 ? 1 : Math.min(2, cg.length)));
    const name = pre + (post === pre ? '' : post) + clsOf(main.name);
    const taken = Object.values(cfg.species || {}).some((x) => x && x.name === name);
    return taken || name.length < 2 ? `${short(A.name)}×${short(B.name)}` : name;
  }
  // 混種資料（不含 premium/priceGems：混種一律是繁殖限定，只能賣回 sellPrice）
  function def(cfg, id) {
    const p = parse(id); if (!p) return null; const A = cfg.species[p[0]]||def(cfg,p[0]), B = cfg.species[p[1]]||def(cfg,p[1]);
    if (!A || !B || p[0] === p[1]) return null;
    const H = (cfg.breeding && cfg.breeding.hybrid) || {}, PR = cfg.premium || {};
    const h = hash(id), r = (k) => ((h >>> k) & 255) / 255; const LA = A.look || {}, LB = B.look || {};
    const fishy = FISHY.includes(LA.body || 'fish') && FISHY.includes(LB.body || 'fish');
    // 身體：兩邊都是魚形 → 隨機取一邊的身形、另一邊的尾巴；否則取「較大」那一方的身體（蝦×魚＝蝦形、龜×魚＝龜形）
    const bigA = (A.adultSizeCm || 5) >= (B.adultSizeCm || 5), main = fishy ? (r(0) < .5 ? LA : LB) : (bigA ? LA : LB), other = main === LA ? LB : LA, mainS = main === LA ? A : B;
    const look = Object.assign({}, main, { adult: undefined });
    if (fishy) { look.tail = other.tail || look.tail; if (r(8) < .5) look.fins = other.fins || look.fins; look.pattern2 = other.pattern !== look.pattern ? other.pattern : (other.pattern2 || undefined); if (other.patternColor) look.pattern2Color = other.patternColor; }
    else { look.pattern2 = other.pattern; if (other.patternColor) look.pattern2Color = other.patternColor; }
    look.hue = Math.round(mixHue(LA.hue || 0, LB.hue || 0, .3 + r(16) * .4)); look.sat = Math.round(((LA.sat ?? 70) + (LB.sat ?? 70)) / 2); look.light = Math.round(((LA.light ?? 50) + (LB.light ?? 50)) / 2);
    if (fishy) { look.len = Math.round(((LA.len || 30) + (LB.len || 30)) / 2); look.height = Math.round(((LA.height || 18) + (LB.height || 18)) / 2); }
    if (!look.accentColor && other.accentColor) look.accentColor = other.accentColor;
    if (other.mouth && r(24) < .4) look.mouth = other.mouth;
    // 第二花紋只支援擴充花紋：若不支援而主花紋支援，就交換，讓雙親花紋都看得到
    if (look.pattern2 && !EXT_PAT.includes(look.pattern2)) { if (EXT_PAT.includes(look.pattern)) { const t = look.pattern; look.pattern = look.pattern2; look.pattern2 = t; } else delete look.pattern2; }
    for (const k of Object.keys(look)) if (look[k] === undefined) delete look[k];
    // 限定魚血統：保留發光／流光／光暈／粒子
    const premA = A.priceGems > 0 || A.premium || A.premiumBlood, premB = B.priceGems > 0 || B.premium || B.premiumBlood, prem = premA || premB, PL = premA ? LA : LB;
    if (prem) for (const k of PREMIUM_LOOK) if (PL[k] != null) look[k] = PL[k];
    // Visual inheritance only. Preserve existing role/habitat/size/economy derivation above/below.
    const visualRank=s=>s.eggExclusive||s.monthlyExclusive||s.starterExclusive||s.family==='monthly'?3:s.priceGems>0||s.premium||s.premiumBlood?2:0;
    const va=visualRank(A),vb=visualRank(B);let visual=va||vb?(va===vb?(r(8)<.5?A:B):va>vb?A:B):null;
    const crustacean=['crab','shrimp','crayfish'];if(crustacean.includes(LA.body)&&crustacean.includes(LB.body)&&(LA.body==='crab'||LB.body==='crab'))visual=LA.body==='crab'?A:B;
    if(visual){const V=visual.look||{},O=visual===A?LB:LA;
      for(const k of ['body','tail','fins','len','height','tailScale','eyeScale','head','mouth','barbels','spikes','puffs','giant','adult']){if(V[k]!=null)look[k]=typeof V[k]==='object'?JSON.parse(JSON.stringify(V[k])):V[k];else delete look[k]}
      const inheritedLen=Math.max(V.len||30,((LA.len||30)+(LB.len||30))/2,.85*Math.max(LA.len||30,LB.len||30));look.len=Math.round(inheritedLen);look.height=Math.round((V.height||18)*inheritedLen/(V.len||30));look.giant=Math.max(LA.giant||1,LB.giant||1);
      look.hue=Math.round(mixHue(V.hue||0,O.hue||0,.22+r(16)*.16));look.sat=Math.round((V.sat??70)*.78+(O.sat??70)*.22);look.light=Math.round((V.light??50)*.85+(O.light??50)*.15);
      look.pattern=V.pattern||'belly';if(O.pattern!==look.pattern&&EXT_PAT.includes(O.pattern)){look.pattern2=O.pattern;if(O.patternColor)look.pattern2Color=O.patternColor}else{delete look.pattern2;delete look.pattern2Color}
      for(const k of PREMIUM_LOOK){if(V[k]!=null)look[k]=V[k];else if(O[k]!=null)look[k]=O[k];else delete look[k]}
      look.artParent=visual===A?p[0]:p[1];look.patternParent=visual===A?p[1]:p[0];
    }
    look.bodyParent=look.artParent||(main===LA?p[0]:p[1]);if(!look.patternParent)look.patternParent=main===LA?p[1]:p[0];
    const ta = TEMP_RANK[A.temperament] ?? 0, tb = TEMP_RANK[B.temperament] ?? 0;
    // 個性：通常遺傳較兇的一方，但有 35% 的混種系會「變溫和」，遺傳較溫和的一方（同一組父母固定）
    const soft = ta !== tb && r(40) < .35, fierce = soft ? (ta <= tb ? A : B) : (ta >= tb ? A : B);
    const coinMax = Math.max(A.coin || 1, B.coin || 1), coin = Math.min(coinMax, Math.round(((A.coin || 1) + (B.coin || 1)) / 2 * (H.coinFactor ?? 1.1) * 10) / 10);
    const sellOf = (s) => s.sellPrice || Math.round((s.price || 0) * ((cfg.sell && cfg.sell.fallbackRateOfPrice) || .5));
    let sell = Math.max(1, Math.round((sellOf(A) + sellOf(B)) / 2 * (H.sellFactor ?? 1.2))); if (prem) sell = Math.min(sell, PR.hybridSellCap ?? 3000);
    const cm = Math.max(((A.adultSizeCm || 5) + (B.adultSizeCm || 5)) / 2, .8 * Math.max(A.adultSizeCm || 5, B.adultSizeCm || 5));
    return {
      name: (isHybrid(p[0])||isHybrid(p[1]))?`${short(A.name)}×${short(B.name)}`:hybridName(A, B, mainS, h, cfg), hybrid: true, parents: [p[0], p[1]], premiumBlood: !!prem,
      rarity: Math.min(((cfg.rarity || []).length || 4) - 1, Math.max(A.rarity | 0, B.rarity | 0)), price: 0, sellPrice: sell, coin, breedOnly: true,
      speed: Math.round(((A.speed || 40) + (B.speed || 40)) / 2), desc: `${A.name} × ${B.name} 的混種，外觀融合了雙親的特徵${soft ? '，個性比兇的那一方溫和' : ''}。`,
      bioload: Math.max(A.bioload ?? 1, B.bioload ?? 1), hungerMultiplier: Math.max(A.hungerMultiplier ?? 1, B.hungerMultiplier ?? 1), role: mainS.role, clean: undefined,
      family: 'hybrid', familyName: '混種', temperament: fierce.temperament || 'peaceful', aggression: soft ? Math.min(A.aggression | 0, B.aggression | 0) : Math.max(A.aggression | 0, B.aggression | 0), aggressionStyle: fierce.aggressionStyle,
      sizeClass: (cm >= 100 ? 'giant' : cm >= 25 ? 'large' : cm >= 10 ? 'medium' : cm >= 4 ? 'small' : 'mini'), adultSizeCm: Math.round(cm * 10) / 10,
      tankSpace: Math.max(A.tankSpace || 1, B.tankSpace || 1), minTankLevel: Math.max(A.minTankLevel | 0, B.minTankLevel | 0), schooling: false,
      waterType: mainS.waterType || 'fresh', unlockLevel: 1, longFins: !!(A.longFins || B.longFins),
      preyMaxSizeRatio: fierce.preyMaxSizeRatio, preyTypes: fierce.preyTypes, eatsInverts: !!(A.eatsInverts && B.eatsInverts), plantEater: !!(A.plantEater || B.plantEater),
      habitat: Object.assign({}, A.habitat || {}, B.habitat || {},(A.habitat?.ocean||B.habitat?.ocean)?{ocean:Math.max(A.habitat?.ocean||0,B.habitat?.ocean||0)}:{}), temp: Array.isArray(A.temp) && Array.isArray(B.temp) ? [Math.max(A.temp[0], B.temp[0]), Math.min(A.temp[1], B.temp[1])].sort((x, y) => x - y) : (A.temp || B.temp),
      look, scientificName: `${A.scientificName || p[0]} × ${B.scientificName || p[1]}`,
    };
  }
  // 存檔中的混種代號 → 基本魚種
  const baseOf = (cfg,id) => {const p=parse(id);return p?[...new Set(p.flatMap(x=>baseOf(cfg,x)))]:cfg.species[id]?[id]:[]};
  // 配種結果（不含突變：突變池由遊戲先判斷）。rand: () => 0..1
  function cross(cfg, spA, spB, rand) {
    const H = (cfg.breeding && cfg.breeding.hybrid) || {};
    if(Math.max(generation(spA),generation(spB))>=MAX_GENERATION)return{sp:null,kind:'generation_limit'};
    if (spA === spB) return { sp: spA, kind: 'same' };
    if(H.enabled===false)return{sp:spA,kind:'same'};
    const sp=idOf(spA,spB);if(!parse(sp)||!def(cfg,sp))return{sp:null,kind:'lineage_limit'};
    return{sp,kind:'hybrid'};
  }
  function animalKinds(cfg,id){return [...new Set(baseOf(cfg,id).map(k=>{const b=cfg.species[k]?.look?.body||'fish';return b==='cetacean'?'cetacean':b==='turtle'?'turtle':b==='crocodile'?'crocodile':b==='python'?'snake':b==='crab'?'crab':['shrimp','crayfish'].includes(b)?'shrimp':b==='snail'?'snail':'fish'}))].sort()}
  function crossAnimal(cfg,a,b){return JSON.stringify(animalKinds(cfg,a))!==JSON.stringify(animalKinds(cfg,b))}
  function breedFee(cfg,a,b){const cross=crossAnimal(cfg,a,b),names=['一般血統','限定血統','月卡／新手專屬血統','UR血統'];const one=id=>{let rank=0,value=0;for(const base of baseOf(cfg,id)){const s=cfg.species[base]||{},r=s.eggExclusive?3:s.monthlyExclusive||s.starterExclusive||s.family==='monthly'?2:s.premium||s.priceGems>0?1:0;rank=Math.max(rank,r);if(r>0)value=Math.max(value,Number.isFinite(s.priceGems)&&s.priceGems>0?Math.ceil(s.priceGems):150)}return{species:id,rank,label:names[rank],gems:rank>0?value:cross?10:0}};const parents=[one(a),one(b)];return{gems:parents.reduce((n,p)=>n+p.gems,0),rank:Math.max(...parents.map(p=>p.rank)),label:'雙親價值相加',cross,mixed:a!==b,animalKinds:[animalKinds(cfg,a),animalKinds(cfg,b)],parents}}


  const api = { isHybrid, parse, idOf, def, baseOf, cross, breedFee, hash, generation, MAX_GENERATION, animalKinds, crossAnimal, PREMIUM_LOOK };
  root.FishHybrid = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
