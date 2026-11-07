'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers.cjs');

const OTHER_BENTHIC = ['b_violet_urchin', 'b_jade_cucumber', 'b_coral_star', 'p_lunar_urchin', 'p_amber_urchin', 'p_rose_cucumber',
  'p_azure_cucumber', 'p_azure_star', 'p_biscuit_star', 'o_aurora_urchin', 'o_tidal_star'];
const SWIMMER = 'o_lantern_fish';

const base = (seed = 5) => h.loadBenthic(h.BASELINE_HTML, { seed });
const patched = (seed = 5) => h.loadBenthic(h.CLIENT_HTML, { walk: true, seed });
const sp = (ctx, id) => ({ id, len: 70, ht: 40, height: 40, speed: ctx.Benthic267.meta[id]?.kind === 'cucumber' ? 3 : 2.2 });

test('metadata of every non-crab benthic is untouched', () => {
  const b = base(), p = patched();
  for (const id of [...OTHER_BENTHIC, SWIMMER]) assert.deepEqual(JSON.parse(JSON.stringify(p.Benthic267.meta[id])), JSON.parse(JSON.stringify(b.Benthic267.meta[id])), id);
  const ids = Object.keys(p.Benthic267.meta).filter(id => !h.CRAB_IDS.includes(id));
  assert.deepEqual(ids.sort(), Object.keys(b.Benthic267.meta).filter(id => id !== 'o_king_crab').sort());
  assert.equal(p.Benthic267.version, b.Benthic267.version);
});

test('is(): other benthics keep their classification; the swimming lantern fish is still not a bottom walker', () => {
  const b = base(), p = patched();
  for (const id of OTHER_BENTHIC) { assert.equal(p.Benthic267.is({ id }), true, id); assert.equal(p.Benthic267.is({ id }), b.Benthic267.is({ id })); assert.equal(p.Benthic267.live({ id }), false, `${id} is not procedural`); }
  assert.equal(p.Benthic267.is({ id: SWIMMER }), false);
  assert.equal(p.Benthic267.is({ id: 'goldfish' }), false);
  assert.equal(p.Benthic267.turnScale({ _bYaw: 0.1 }, { id: 'b_violet_urchin' }), 1, 'no pivot squash for radial animals');
});

test('step(): bit-identical motion to the live build for every other benthic (urchins, cucumbers, stars) incl. food seeking', () => {
  for (const id of OTHER_BENTHIC) {
    const traces = [base(11), patched(11)].map(ctx => {
      const s = sp(ctx, id), r = h.seeded(99), tr = [];
      const f = { sp: id, x: 400, y: 600, full: 20, face: -1, phase: 0, vx: 0 };
      const foods = [];
      const e = { width: 1000, floor: 650, half: 40, height: 40, seekBelow: 50, foods, eat(fish, fd) { fish.full = 90; fd.landed = false; foods.splice(foods.indexOf(fd), 1); }, neighbors: [{ x: 700, half: 30 }] };
      for (let i = 0; i < 4000; i++) {
        if (i % 400 === 0) { foods.push({ x: 100 + r() * 800, landed: true }); f.full = 20; }
        ctx.Benthic267.step(f, s, 0.05, e);
        if (i % 20 === 0) tr.push(JSON.stringify([f.x, f.y, f.vx, f.vy, f.face, f.dir, f.phase, f.tx, f.rest, f._bFeeding270, f._bHeading270, f.full]));
      }
      return tr;
    });
    assert.deepEqual(traces[1], traces[0], id);
    assert.ok(new Set(traces[0]).size > 20, `${id} actually moved in the simulation`);
  }
});

test('step(): other benthics never grow crab-only state', () => {
  const ctx = patched(), s = sp(ctx, 'b_jade_cucumber');
  const f = { sp: 'b_jade_cucumber', x: 400, y: 600, full: 90, face: 1, phase: 0, vx: 0 };
  for (let i = 0; i < 500; i++) ctx.Benthic267.step(f, s, 0.05, { width: 1000, floor: 650, half: 60, height: 40, seekBelow: 50, foods: [], eat() {}, neighbors: [] });
  for (const k of ['_bYaw', '_bGait', '_bAmp']) assert.equal(f[k], undefined, k);
});

test('draw(): identical canvas calls to the live build for every other benthic and the lantern fish, normal and silhouette', () => {
  for (const id of [...OTHER_BENTHIC, SWIMMER]) {
    for (const sil of [false, true]) for (const ph of [0, 1.2, 4]) for (const feeding of [false, true]) {
      const logs = [base(), patched()].map(ctx => {
        const c = h.recorder();
        const f = { phase: ph, _bFeeding270: feeding, face: 1 };
        assert.equal(ctx.Benthic267.draw(c, f, sp(ctx, id), { sil }), true);
        return c.log;
      });
      assert.deepEqual(logs[1], logs[0], `${id} sil=${sil} ph=${ph}`);
    }
  }
});

test('image()/ready(): other benthics still load their PNG; crabs load nothing and ready() does not choke on them', async () => {
  const p = patched(), b = base();
  for (const id of OTHER_BENTHIC) { const im = p.Benthic267.image({ id }); assert.ok(im, id); assert.equal(im.src, b.Benthic267.image({ id }).src, id); }
  for (const id of h.CRAB_IDS) assert.equal(p.Benthic267.image({ id }), null, id);
  await p.Benthic267.ready();
  const srcs = [...new Set(OTHER_BENTHIC.concat(SWIMMER).map(id => p.Benthic267.image({ id }).src))];
  assert.ok(srcs.every(s => /\/art\/(benthic267|benthic269|ocean275)\//.test(s)));
  assert.ok(!srcs.some(s => /kingcrab/.test(s)), 'old front-facing sprite is no longer requested');
});

test('the rest of the client is unchanged: baseline -> client differs only in the audited hunks', () => {
  const a = h.BASELINE_HTML.split('\n'), c = h.CLIENT_HTML.split('\n');
  // Walk through both files with a simple greedy diff; collect changed baseline lines.
  const changed = [];
  let i = 0, j = 0;
  while (i < a.length && j < c.length) {
    if (a[i] === c[j]) { i++; j++; continue; }
    // find resync point
    let found = false;
    for (let look = 1; look < 400 && !found; look++) {
      if (a[i + look] !== undefined && a[i + look] === c[j] && a[i + look + 1] === c[j + 1]) { for (let k = 0; k < look; k++) changed.push(a[i + k].slice(0, 60)); i += look; found = true; }
      else if (c[j + look] !== undefined && c[j + look] === a[i] && c[j + look + 1] === a[i + 1]) { j += look; found = true; }
    }
    if (!found) { const lineA = a[i], lineC = c[j]; changed.push(lineA.slice(0, 60)); i++; j++; }
  }
  assert.equal(i, a.length); assert.equal(j, c.length);
  // Edited baseline lines: meta, image, ready, draw, step(5 lines), export, SPR.draw, render, NEWX line, note line, GAME_BUILD line, catalog line (+ the blank/marker neighbours)
  assert.ok(changed.length <= 20, `unexpectedly many changed baseline lines: ${changed.length}\n${changed.join('\n')}`);
  const sizeDelta = h.CLIENT_HTML.length - h.BASELINE_HTML.length;
  assert.ok(sizeDelta > 0 && sizeDelta < 60000, `client grew by ${sizeDelta} chars`);
});
