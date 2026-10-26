#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { validateConfig } = require('../src/config-validate');

const ROOT = path.join(__dirname, '..');
const cfgPath = path.join(ROOT, 'seed', 'default-config.json');
const packPath = path.join(ROOT, 'seed', 'deco-series-pack.json');
const catalogPath = path.join(ROOT, 'public', 'art', 'deco-series-v1', 'catalog.json');

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

cfg.decorations = cfg.decorations || {};
for (const [k, d] of Object.entries(pack.decorations || {})) {
  cfg.decorations[k] = { ...d, coinBonus: 0, mutationBonus: 0 };
}

const SERIES_META = {};
for (const [sid, s] of Object.entries(pack.decoSeries || {})) {
  SERIES_META[sid] = {
    name: s.name,
    bonusLabel: s.bonusLabel,
    bonusDesc: s.bonusDesc,
    bonus: s.bonus,
    keys: s.keys,
  };
}
cfg.decoSeries = SERIES_META;
cfg.decoSeriesCatalogVersion = catalog.version || 1;

const errs = validateConfig(cfg);
const decoErrs = errs.filter((e) => String(e).includes('decoSeries') || String(e).includes('decorations.ds_'));
if (decoErrs.length) {
  console.error('validate issues (deco-series):', decoErrs.slice(0, 8));
  if (decoErrs.length > 8) process.exit(1);
}

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('merged', Object.keys(pack.decorations).length, 'decorations into', cfgPath);
