#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.DECO_SERIES_SRC || path.join(ROOT, '..', 'deco-series');
const OUT = path.join(ROOT, 'public', 'art', 'deco-series-v1');
const items = JSON.parse(fs.readFileSync(path.join(SRC, 'series-items.json'), 'utf8'));
const itemDescs = JSON.parse(fs.readFileSync(path.join(SRC, 'item-descs.json'), 'utf8'));

const SERIES = {
  sunken: {
    name: '沉沒古城',
    bonusLabel: '受傷魚鰭修復 +25%',
    bonusDesc: '魚缸內擺滿本系列 10 件時，魚鰭修復速度提高 25%（不增加金幣收益）。',
    bonus: { finHealMult: 1.25 },
  },
  pirate: {
    name: '海盜沉船',
    bonusLabel: '繁殖突變機率 +10%',
    bonusDesc: '魚缸內擺滿本系列 10 件時，繁殖突變機率相對提高 10%。',
    bonus: { mutationRelMult: 1.1 },
  },
  zen: {
    name: '日式庭園',
    bonusLabel: '污染累積 −10%',
    bonusDesc: '魚缸內擺滿本系列 10 件時，水質污染累積速度 ×0.9。',
    bonus: { dirtRateMult: 0.9 },
  },
  candy: {
    name: '糖果樂園',
    bonusLabel: '魚成長 +10%',
    bonusDesc: '魚缸內擺滿本系列 10 件時，魚成長速度 ×1.1。',
    bonus: { growthMult: 1.1 },
  },
  crystal: {
    name: '海底水晶洞',
    bonusLabel: '生病機率 −10%',
    bonusDesc: '魚缸內擺滿本系列 10 件時，因水質生病的累積 ×0.9。',
    bonus: { sickRateMult: 0.9 },
  },
};

function priceFor(it) {
  if (it.centerpiece) return { sunken: 1500, pirate: 1400, zen: 1300, candy: 1200, crystal: 1350 }[it.series] || 1400;
  const area = (it.w || 300) * (it.h || 300);
  if (area < 140000) return 160;
  if (area < 200000) return 280;
  if (area < 280000) return 420;
  return 580;
}

function layoutFor(it) {
  const ref = Math.max(it.w, it.h);
  const scale = ref > 520 ? 0.2 : ref > 420 ? 0.22 : 0.24;
  const dw = Math.round(it.w * scale);
  const dh = Math.round(it.h * scale);
  const hw = Math.round(dw * 0.48);
  const hh = Math.round(dh * 0.92);
  return {
    dw,
    dh,
    anchor: { x: 0.5, y: 1 },
    box: [-hw, hw, hh],
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const catalogItems = [];
  const decorations = {};
  const decoSeries = {};
  for (const sid of Object.keys(SERIES)) {
    decoSeries[sid] = { ...SERIES[sid], keys: [] };
  }

  for (const it of items) {
    const png = path.join(SRC, 'png', `${it.key}.png`);
    if (!fs.existsSync(png)) throw new Error('missing ' + png);
    const webp = path.join(OUT, `${it.key}.webp`);
    let buf = await sharp(png).webp({ quality: 82, effort: 6 }).toBuffer();
    if (buf.length > 150 * 1024) {
      buf = await sharp(png).webp({ quality: 68, effort: 6 }).toBuffer();
    }
    if (buf.length > 150 * 1024) {
      buf = await sharp(png).resize({ width: Math.round(it.w * 0.85) }).webp({ quality: 65 }).toBuffer();
    }
    fs.writeFileSync(webp, buf);
    const lay = layoutFor(it);
    const cost = priceFor(it);
    const rel = `deco-series-v1/${it.key}.webp`;
    catalogItems.push({
      id: it.key,
      name: it.name,
      series: it.series,
      seriesName: it.seriesName,
      centerpiece: !!it.centerpiece,
      cost,
      icon: it.centerpiece ? '🏛️' : '✨',
      desc: itemDescs[it.key] || `${it.name}，造型細緻耐看。`,
      kind: 'ornament',
      sprite: rel,
      shadow: null,
      ...lay,
    });
    decorations[it.key] = {
      name: it.name,
      icon: it.centerpiece ? '🏛️' : '✨',
      cost,
      coinBonus: 0,
      mutationBonus: 0,
      desc: itemDescs[it.key] || `${it.name}，造型細緻耐看。`,
      draw: it.key,
      x: 0.5,
      series: it.series,
      centerpiece: !!it.centerpiece,
    };
    decoSeries[it.series].keys.push(it.key);
    DECO_BOX_register(it.key, lay.box);
  }

  const catalog = { version: 1, series: SERIES, items: catalogItems };
  fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(
    path.join(ROOT, 'seed', 'deco-series-pack.json'),
    JSON.stringify({ decorations, decoSeries }, null, 2)
  );
  console.log('wrote', catalogItems.length, 'items to', OUT);
}

function DECO_BOX_register() {}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
