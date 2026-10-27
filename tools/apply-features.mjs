#!/usr/bin/env node
import fs from 'node:fs';

const path = '/workspace/index.html';
let html = fs.readFileSync(path, 'utf8');

const NEW_PLANTS = {
  riccia: { name: '鹿角苔', rarity: 1, price: 90, difficulty: 1, light: 2, co2: false, grow: 2.8, zone: 'attach', type: 'moss', hue: 95, sat: 60, lit: 38, h: 0.08, w: 40, absorb: 0.9, tough: true, cuttings: 3, cutSell: 4, water: 'fresh', desc: '分叉像小鹿角的漂浮／附著苔類，成團後像一片翠綠絨毯。' },
  anubias_petite: { name: '小榕', rarity: 1, price: 130, difficulty: 1, light: 1, co2: false, grow: 0.9, zone: 'attach', type: 'anubias', hue: 125, sat: 45, lit: 28, h: 0.1, w: 28, absorb: 1, tough: true, cuttings: 1, cutSell: 8, water: 'fresh', desc: '葉子厚實的小型榕類，根莖貼在沉木或石頭上慢慢長。' },
  green_palace: { name: '綠宮廷', rarity: 1, price: 150, difficulty: 2, light: 2, co2: false, grow: 2.2, zone: 'mid', type: 'bushy', hue: 110, sat: 58, lit: 40, h: 0.28, w: 36, absorb: 1.1, tough: false, cuttings: 3, cutSell: 5, water: 'fresh', desc: '層次分明的翠綠中景草，叢生後像一座綠意宮殿。' },
  limnophila_pagoda: { name: '大寶塔', rarity: 1, price: 180, difficulty: 2, light: 2, co2: false, grow: 3.2, zone: 'back', type: 'bushy', hue: 100, sat: 55, lit: 42, h: 0.55, w: 32, absorb: 1.2, tough: false, cuttings: 3, cutSell: 5, water: 'fresh', desc: '輪生細葉一層層往上堆，遠看像綠色寶塔，適合當背景主角。' },
  water_orchid: { name: '水蘭', rarity: 0, price: 100, difficulty: 1, light: 1, co2: false, grow: 2.5, zone: 'mid', type: 'ribbon', hue: 108, sat: 50, lit: 40, h: 0.4, w: 30, absorb: 1, tough: false, cuttings: 2, cutSell: 4, water: 'fresh', desc: '帶狀柔葉隨水流輕擺，清新像水中蘭草。' },
  bolbitis: { name: '黑木蕨', rarity: 1, price: 110, difficulty: 1, light: 1, co2: false, grow: 1.1, zone: 'attach', type: 'fern', hue: 125, sat: 38, lit: 22, h: 0.2, w: 34, absorb: 0.95, tough: true, cuttings: 1, cutSell: 7, water: 'fresh', desc: '墨綠羽狀葉攀在沉木上，葉緣細裂像小樹林。' },
  staurogyne_repens: { name: '趴地矮珍珠', rarity: 1, price: 170, difficulty: 2, light: 2, co2: false, grow: 2.3, zone: 'fore', type: 'carpet', hue: 115, sat: 52, lit: 36, h: 0.06, w: 48, absorb: 1, tough: false, cuttings: 3, cutSell: 5, water: 'fresh', desc: '矮小的圓葉沿底砂蔓延，前景像柔軟的綠毯。' },
  crypt_balansae: { name: '綠胤', rarity: 1, price: 125, difficulty: 2, light: 2, co2: false, grow: 1.8, zone: 'back', type: 'ribbon', hue: 105, sat: 48, lit: 34, h: 0.45, w: 26, absorb: 1.05, tough: true, cuttings: 2, cutSell: 5, water: 'fresh', desc: '長帶狀葉從根部展開，隨水流輕晃的中後景草。' },
  blyxa_japonica: { name: '日本芭蕉', rarity: 1, price: 140, difficulty: 2, light: 2, co2: false, grow: 2.4, zone: 'mid', type: 'grass', hue: 112, sat: 54, lit: 38, h: 0.18, w: 30, absorb: 1, tough: false, cuttings: 2, cutSell: 4, water: 'fresh', desc: '細長柔葉成簇直立，色澤翠綠帶一點金邊感。' },
  salvinia_minima: { name: '細葉槐葉萍', rarity: 0, price: 70, difficulty: 1, light: 1, co2: false, grow: 3.5, zone: 'float', type: 'float', hue: 100, sat: 50, lit: 42, h: 0.04, w: 22, absorb: 0.8, tough: false, cuttings: 2, cutSell: 3, water: 'fresh', desc: '水面漂浮的細小葉片，成片後像淺綠浮毯。' },
};

const marker = '"gracilaria":';
const idx = html.indexOf(marker);
if (idx < 0) throw new Error('gracilaria plant marker not found');
const gearIdx = html.indexOf('},"gear":', idx);
if (gearIdx < 0) throw new Error('plants end marker not found');
const insert = Object.entries(NEW_PLANTS)
  .map(([k, v]) => `,"${k}":${JSON.stringify(v)}`)
  .join('');
html = html.slice(0, gearIdx) + insert + html.slice(gearIdx);

// shopList rarity sort + name-only option + sortDir
const shopListOld = `    function shopList(ids, q) {
      q = q || {}; let out = ids.filter(id => { const s = SPC[id], i = info(id); if (!s || !i || s.disabled) return false; if (q.premium ? !i.premium : i.breedOnly) return false;
        if (q.temperament && i.temperament !== q.temperament) return false; if (q.sizeClass && i.sizeClass !== q.sizeClass) return false;
        if(q.family==='predator_plain'){if(!['true_shark','crocodile','python'].includes(i.family)||!/_classic$/.test(id))return false}else if(q.family==='predator_pattern'){if(!['true_shark','crocodile','python'].includes(i.family)||/_classic$/.test(id))return false}else if(q.family==='shark_plain'){if(i.family!=='true_shark'||!/_classic$/.test(id))return false}else if(q.family==='shark_pattern'){if(i.family!=='true_shark'||/_classic$/.test(id))return false}else if (q.family && i.family !== q.family) return false; if (q.water && i.water !== q.water) return false;
        if (q.cleaner != null && !!s.clean !== q.cleaner) return false;
        if (q.text && !(s.name.includes(q.text) || (s.scientificName || '').toLowerCase().includes(q.text.toLowerCase()) || i.familyName.includes(q.text))) return false;
        if (q.hideLocked && q.level != null && !isUnlocked(id, q.level)) return false;
        if (q.collect && q.found) { const got = !!q.found[id]; if (q.collect === 'new' ? got : !got) return false; } return true; });
      const key = { price: id => SPC[id].price || SPC[id].priceGems || 0, level: id => info(id).unlockLevel * 1e6 + SPC[id].price, size: id => info(id).cm, name: id => 0 }[q.sort || 'level'];
      out.sort((a, b) => key(a) - key(b) || (q.sort === 'name' ? SPC[a].name.localeCompare(SPC[b].name, 'zh-Hant') : 0));
      return out;
    }`;

const shopListNew = `    function shopList(ids, q) {
      q = q || {}; let out = ids.filter(id => { const s = SPC[id], i = info(id); if (!s || !i || s.disabled) return false; if (q.premium ? !i.premium : i.breedOnly) return false;
        if (q.temperament && i.temperament !== q.temperament) return false; if (q.sizeClass && i.sizeClass !== q.sizeClass) return false;
        if(q.family==='predator_plain'){if(!['true_shark','crocodile','python'].includes(i.family)||!/_classic$/.test(id))return false}else if(q.family==='predator_pattern'){if(!['true_shark','crocodile','python'].includes(i.family)||/_classic$/.test(id))return false}else if(q.family==='shark_plain'){if(i.family!=='true_shark'||!/_classic$/.test(id))return false}else if(q.family==='shark_pattern'){if(i.family!=='true_shark'||/_classic$/.test(id))return false}else if (q.family && i.family !== q.family) return false; if (q.water && i.water !== q.water) return false;
        if (q.cleaner != null && !!s.clean !== q.cleaner) return false;
        if (q.text) { const t = String(q.text); if (q.nameZhOnly) { if (!s.name.includes(t)) return false; } else if (!(s.name.includes(t) || (s.scientificName || '').toLowerCase().includes(t.toLowerCase()) || i.familyName.includes(t))) return false; }
        if (q.hideLocked && q.level != null && !isUnlocked(id, q.level)) return false;
        if (q.collect && q.found) { const got = !!q.found[id]; if (q.collect === 'new' ? got : !got) return false; } return true; });
      const desc = q.sortDir === 'desc' ? -1 : 1;
      const key = { price: id => SPC[id].price || SPC[id].priceGems || 0, rarity: id => (SPC[id].r || 0) * 1e9 + (SPC[id].price || 0), level: id => info(id).unlockLevel * 1e6 + SPC[id].price, size: id => info(id).cm, name: id => 0 }[q.sort || 'level'];
      out.sort((a, b) => desc * (key(a) - key(b)) || (q.sort === 'name' ? SPC[a].name.localeCompare(SPC[b].name, 'zh-Hant') : 0));
      return out;
    }`;

if (!html.includes(shopListOld)) throw new Error('shopList block not found');
html = html.replace(shopListOld, shopListNew);

// drawPlant bushy fine list
html = html.replace(
  "const fine=['rotala_wallichii','hornwort','cabomba','limnophila'].includes(p.sp)||bush;",
  "const fine=['rotala_wallichii','hornwort','cabomba','limnophila','limnophila_pagoda','green_palace','blyxa_japonica'].includes(p.sp)||bush;"
);

fs.writeFileSync(path, html);
console.log('Patched plants + shopList + drawPlant');
