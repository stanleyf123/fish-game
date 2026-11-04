'use strict';
/** Evaluates coinSoftMult R logic extracted from client/index.html (COINSINK-B1-CURVE). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let cachedFn;

function extractCoinSoftMultBody() {
  const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
  const m = html.match(/function coinSoftMult\(\)\{([\s\S]+?return _csM)\}/);
  if (!m) throw new Error('coinSoftMult not found in index.html');
  return m[1];
}

function clientMultFromHtml(cfg, save, helpers = {}) {
  if (!cachedFn) {
    const body = extractCoinSoftMultBody();
    cachedFn = vm.compileFunction(
      `"use strict"; let _csM=1,_csKey='',_csSec=0; ${body}; return _csM;`,
      ['CFG', 'S', 'SPECIES', 'decoMult', 'waterGrade', 'VIP', 'AQ', 'nbOn', 'stage', 'aqMods', 'Date'],
    );
  }
  const VIP = helpers.vip || { coinBonus: 0 };
  const decoMult = helpers.decoMult || (() => 1);
  const waterGrade = helpers.waterGrade || (() => ({ coinMultiplier: 1 }));
  const stage = helpers.stage || ((f) => {
    const g1 = cfg.stages[1]?.growth ?? 100;
    const g2 = cfg.stages[2]?.growth ?? 1000;
    const g = f.growth || 0;
    if (g >= g2) return 2;
    if (g >= g1) return 1;
    return 0;
  });
  const nbOn = helpers.nbOn || (() => false);
  const AQ = helpers.AQ || null;
  const aqMods = helpers.aqMods || (() => ({ coin: 1 }));
  return cachedFn(cfg, save, cfg.species, decoMult, waterGrade, VIP, AQ, nbOn, stage, aqMods, Date);
}

module.exports = { clientMultFromHtml, extractCoinSoftMultBody };
