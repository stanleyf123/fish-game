'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

const BASELINE_HTML = read('baseline/live-index-4.2.218.html');
const CLIENT_HTML = read('client/index.html');
const WALK_SRC = read('src/kingcrab-walk.js');
const PATCH = JSON.parse(read('config/kingcrab-species-patch.json'));
const LIVE_SNIPPET = JSON.parse(read('baseline/live-kingcrab-species-v65.json'));

const CRAB_IDS = ['o_king_crab', 'o_blue_king_crab', 'o_golden_king_crab', 'o_chilean_king_crab'];
const NEW_IDS = CRAB_IDS.slice(1);

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ s >>> 15, 2246822507) ^ Math.imul(s ^ s >>> 13, 3266489909), (s ^= s >>> 16) >>> 0) / 4294967296);
}

function extractBenthic(html) {
  const start = html.indexOf('/* BENTHIC267: isolated new sea-floor species.');
  const endMark = "})(typeof window==='undefined'?globalThis:window);";
  const end = html.indexOf(endMark, start);
  if (start < 0 || end < 0) throw new Error('Benthic267 block not found');
  return html.slice(start, end + endMark.length);
}

class FakeImage {
  constructor() { this.complete = true; this.naturalWidth = 1536; this.naturalHeight = 1024; }
  decode() { return Promise.resolve(); }
  set src(v) { this._src = v; if (this.onload) this.onload(); }
  get src() { return this._src; }
}

class FakeCanvas {
  constructor() { this.width = 0; this.height = 0; Object.defineProperty(this, '_rc', { value: null, writable: true, enumerable: false }); }
  getContext() { return this._rc || (this._rc = recorder()); }
}
const fakeDocument = { createElement: () => new FakeCanvas() };

// Records every canvas call so two builds can be compared call-for-call.
function recorder() {
  const log = [];
  const grad = { addColorStop: (...a) => log.push(['stop', ...a]) };
  const target = {
    log,
    measureText: () => ({ width: 10 }),
    createLinearGradient: (...a) => { log.push(['createLinearGradient', ...a]); return grad; },
    createRadialGradient: (...a) => { log.push(['createRadialGradient', ...a]); return grad; },
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { log.push([String(k), ...a.map(v => (typeof v === 'number' ? +v.toFixed(6) : (v && v.constructor && v.constructor.name === 'FakeImage') ? 'img' : (v && v.constructor && v.constructor.name === 'FakeCanvas') ? `canvas:${v.width}x${v.height}` : v))]); };
    },
    set(t, k, v) { log.push(['set:' + String(k), typeof v === 'number' ? +v.toFixed(6) : v]); return true; },
  });
}

// Loads the Benthic267 helper (and optionally the king-crab walk module) in a fresh global.
function loadBenthic(html, { walk = false, seed = 1 } = {}) {
  const sandbox = { Image: FakeImage, document: fakeDocument, console };
  const ctx = vm.createContext(sandbox);
  sandbox.__rnd = seeded(seed);
  vm.runInContext('Math.random = __rnd', ctx);
  if (walk) vm.runInContext(WALK_SRC, ctx, { filename: 'kingcrab-walk.js' });
  vm.runInContext(extractBenthic(html), ctx, { filename: 'benthic267.js' });
  return ctx;
}

// Evaluates the TURTLE185_FALLBACK statements of a client build and returns the table.
function loadFallback(html) {
  const lines = html.split('\n').filter(l => /^(const TURTLE185_FALLBACK=|Object\.assign\(TURTLE185_FALLBACK,)/.test(l));
  const ctx = vm.createContext({});
  vm.runInContext(lines.join('\n') + '\n;globalThis.__fb=TURTLE185_FALLBACK', ctx);
  return JSON.parse(JSON.stringify(ctx.__fb));
}

function extractNEWX(html) {
  const m = html.match(/const NEWX=(\[[^\]]*\])/);
  if (!m) throw new Error('NEWX not found');
  return JSON.parse(m[1]);
}

// species as the client's SPECIES entry would look like for the Benthic path
function speciesFor(cfgSpecies, id) {
  const sp = cfgSpecies[id], L = sp.look;
  return { id, len: L.len, ht: L.height, height: L.height, speed: sp.speed, hue: L.hue };
}

function chromeAvailable() {
  for (const c of [process.env.CHROME_BIN, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (c && fs.existsSync(c)) return true;
  }
  return false;
}

module.exports = {
  ROOT, read, md5, BASELINE_HTML, CLIENT_HTML, WALK_SRC, PATCH, LIVE_SNIPPET, CRAB_IDS, NEW_IDS,
  seeded, extractBenthic, FakeImage, recorder, loadBenthic, loadFallback, extractNEWX, speciesFor, chromeAvailable,
};
