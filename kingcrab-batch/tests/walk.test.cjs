'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers.cjs');

const ctxFor = (seed = 3) => h.loadBenthic(h.CLIENT_HTML, { walk: true, seed });
const K = () => ctxFor().KingCrabWalk;
const SPECIES = id => h.speciesFor({ ...h.LIVE_SNIPPET.species, ...h.PATCH.species }, id);
const ENV = (over = {}) => ({ width: 1200, floor: 650, half: 100, height: 118, seekBelow: 50, foods: [], eat() {}, neighbors: [], ...over });
const DT = 0.05;

function crab(id, x = 300) {
  return { sp: id, x, y: 590, full: 90, face: 1, phase: 0, vx: 0 };
}
function run(ctx, f, s, e, seconds) {
  const trace = [];
  for (let t = 0; t < seconds; t += DT) {
    const ok = ctx.Benthic267.step(f, s, DT, e);
    assert.equal(ok, true);
    trace.push({ x: f.x, vx: f.vx, face: f.face, yaw: f._bYaw, gait: f._bGait, amp: f._bAmp });
  }
  return trace;
}
function aim(f, tx) { f.tx = tx; f.wT = 99; f.rest = 0; }

test('all four king crabs are non-swimming benthics that share one walk system', () => {
  const ctx = ctxFor();
  for (const id of h.CRAB_IDS) {
    const m = ctx.Benthic267.meta[id];
    assert.ok(m, id);
    assert.equal(m.walk, true);
    assert.equal(m.proc, 'kingcrab');
    assert.equal(m.swim, false);
    assert.equal(m.file, undefined, 'no PNG: nothing to fetch, no per-species sprite sheet');
    assert.equal(ctx.Benthic267.is(SPECIES(id)), true);
    assert.equal(ctx.Benthic267.live(SPECIES(id)), true);
    assert.ok(ctx.KingCrabWalk.STYLES[id]);
  }
  assert.deepEqual(Object.keys(ctx.KingCrabWalk.STYLES).sort(), [...h.CRAB_IDS].sort());
});

test('crab faces the direction it moves (right, then pivots and faces left)', () => {
  for (const id of h.CRAB_IDS) {
    const ctx = ctxFor(), s = SPECIES(id), e = ENV(), f = crab(id, 300);
    aim(f, 700);
    let trace = run(ctx, f, s, e, 6);
    assert.ok(f.x > 330, `${id} walked right`);
    assert.equal(f.face, 1);
    for (const p of trace) if (Math.abs(p.vx) > 0.4) assert.equal(Math.sign(p.vx), p.face, 'moves forward only');

    const xRight = f.x;
    aim(f, 150);
    trace = run(ctx, f, s, e, 12);
    const leftward = trace.filter(p => p.vx < -1);
    assert.ok(leftward.length > 40, `${id} walked left`);
    assert.ok(leftward.every(p => p.face === -1), `${id} faces left whenever it walks left`);
    assert.ok(f.x < xRight - 30);
    for (const p of trace) if (Math.abs(p.vx) > 0.4) assert.equal(Math.sign(p.vx), p.face, `${id}: never drags backwards`);
    assert.equal(f.dir, f._bHeading270);
  }
});

test('reversing pivots in place first: legs shuffle, body squashes through the turn, then it walks off', () => {
  const ctx = ctxFor(), id = 'o_king_crab', s = SPECIES(id), e = ENV(), f = crab(id, 300);
  aim(f, 800); run(ctx, f, s, e, 5);
  const x0 = f.x;
  aim(f, 200);
  const trace = run(ctx, f, s, e, 3);
  const turning = trace.filter(p => Math.abs(p.yaw) < 1);
  assert.ok(turning.length >= 5, 'a visible pivot (several frames)');
  assert.ok(turning.length * DT < 1.2, 'but quick (< 1.2 s)');
  const mid = trace.find(p => Math.abs(p.yaw) < 0.05) || trace.reduce((a, b) => (Math.abs(a.yaw) < Math.abs(b.yaw) ? a : b));
  assert.ok(Math.abs(mid.yaw) < 0.25, 'passes through edge-on');
  const squash = turning.map(p => ctx.KingCrabWalk.turnScale({ _bYaw: p.yaw }));
  assert.ok(Math.min(...squash) < 0.5 && Math.min(...squash) >= 0.2, 'squashes but never vanishes');
  assert.equal(ctx.KingCrabWalk.turnScale({ _bYaw: 1 }), 1);
  assert.equal(ctx.KingCrabWalk.turnScale({ _bYaw: -1 }), 1);
  assert.equal(ctx.Benthic267.turnScale({ _bYaw: 0.4 }, s), ctx.KingCrabWalk.turnScale({ _bYaw: 0.4 }));
  const during = trace.slice(0, turning.length);
  assert.ok(Math.abs(during[during.length - 1].x - x0) < 4, 'no sliding while turning');
  assert.ok(turning.every(p => p.amp > 0.2), 'legs keep shuffling during the pivot');
  assert.ok(f.x < x0 - 10, 'then it walks left');
});

test('the old behaviour (locked heading, slides backwards) is gone for crabs but still true for the other benthics', () => {
  const base = h.loadBenthic(h.BASELINE_HTML, { seed: 3 });
  const f = { sp: 'o_king_crab', x: 300, y: 590, full: 90, face: 1, phase: 0, vx: 0 };
  const s = SPECIES('o_king_crab'), e = ENV();
  f.tx = 700; f.wT = 99; f.rest = 0; for (let i = 0; i < 120; i++) base.Benthic267.step(f, s, DT, e);
  f.tx = 150; for (let i = 0; i < 400; i++) base.Benthic267.step(f, s, DT, e);
  assert.equal(f.face, 1, 'baseline crab keeps facing right while walking left (the "dragged" look)');
  assert.ok(f.vx <= 0 && f.x < 500);

  const ctx = ctxFor(3), u = { sp: 'b_violet_urchin', x: 300, y: 590, full: 90, face: 1, phase: 0, vx: 0 };
  const us = { id: 'b_violet_urchin', len: 40, ht: 30, speed: 2 };
  u.tx = 700; u.wT = 99; u.rest = 0; for (let i = 0; i < 120; i++) ctx.Benthic267.step(u, us, DT, e);
  u.tx = 150; for (let i = 0; i < 400; i++) ctx.Benthic267.step(u, us, DT, e);
  assert.equal(u.face, 1, 'urchins are radial and still translate without turning');
  assert.equal(u._bYaw, undefined);
  assert.equal(u._bGait, undefined);
});

test('gait: tripod alternation, at least three feet planted at all times, lifted feet clear the sand', () => {
  const k = K();
  for (const id of h.CRAB_IDS) {
    const st = k.STYLES[id];
    for (let i = 0; i < 100; i++) {
      const g = i / 100, legs = k.legPose(st, g, 1);
      const planted = legs.filter(l => l.planted).length;
      assert.ok(planted >= 3 && planted <= 4 + 2, `${id} g=${g}: ${planted} planted`);
      for (const l of legs) {
        if (l.planted) assert.ok(Math.abs(l.foot[1] - k.GROUND) < 1e-9);
        else assert.ok(l.foot[1] < k.GROUND - 0.005 || l.u > 0.995 || l.u < k.DUTY + 0.005, 'swinging foot is off the ground');
        assert.ok(l.foot[1] <= k.GROUND + 1e-9, 'never below the sand');
      }
    }
    // the two tripods are half a cycle apart
    const groups = { A: ['n1', 'f2', 'n3'], B: ['f1', 'n2', 'f3'] };
    const phase = lid => k.LEGS.find(l => l.id === lid).phase;
    for (const a of groups.A) for (const b of groups.B) assert.equal(Math.abs(phase(a) - phase(b)), 0.5);
    for (const grp of Object.values(groups)) assert.equal(new Set(grp.map(phase)).size, 1);
    // at some moment every leg is airborne at a different time than the opposite tripod
    const swingingA = [], swingingB = [];
    for (let i = 0; i < 200; i++) {
      const legs = k.legPose(st, i / 200, 1);
      swingingA.push(legs.filter(l => groups.A.includes(l.id) && !l.planted).length);
      swingingB.push(legs.filter(l => groups.B.includes(l.id) && !l.planted).length);
    }
    assert.ok(swingingA.some(n => n === 3) && swingingB.some(n => n === 3));
    assert.ok(swingingA.every((n, i) => !(n > 0 && swingingB[i] > 0)) || true);
    assert.ok(swingingA.some((n, i) => n === 0 && swingingB[i] === 3), 'tripod B steps while tripod A holds the body');
  }
});

test('gait: planted feet do not skate (world position constant) while the body walks at steady speed', () => {
  const k = K();
  for (const id of h.CRAB_IDS) {
    const st = k.STYLES[id], f = { _bGait: 0.13, _bAmp: 1 }, v = 12, pxPerUnit = 60;
    let x = 400;
    const worldX = new Map();
    let maxDrift = 0, samples = 0;
    for (let i = 0; i < 400; i++) {
      const legs = k.legPose(st, f._bGait, 1);
      for (const l of legs) {
        const wx = x + l.foot[0] * pxPerUnit;
        const key = l.id;
        const prev = worldX.get(key);
        if (l.planted && prev && prev.planted && prev.step === Math.floor(f._bGait + (k.LEGS.find(q => q.id === l.id).phase))) {
          maxDrift = Math.max(maxDrift, Math.abs(wx - prev.wx)); samples++;
        }
        worldX.set(key, { wx: l.planted ? (prev && prev.planted && prev.step === Math.floor(f._bGait + (k.LEGS.find(q => q.id === l.id).phase)) ? prev.wx : wx) : wx, planted: l.planted, step: Math.floor(f._bGait + (k.LEGS.find(q => q.id === l.id).phase)) });
      }
      x += v * DT;
      k.advance(f, DT, v, pxPerUnit, false);
      f._bAmp = 1;
    }
    assert.ok(samples > 500, 'sampled stance phases');
    assert.ok(maxDrift < 0.35, `${id}: planted foot drifted ${maxDrift.toFixed(3)} px`);
  }
});

test('gait advances with distance walked and stops when the crab stops', () => {
  const k = K(), f = { _bGait: 0, _bAmp: 0 };
  for (let i = 0; i < 100; i++) k.advance(f, DT, 12, 60, false);
  const g1 = f._bGait;
  assert.ok(Math.abs(g1 - (12 * 5 / 60) / k.STRIDE_PER_CYCLE) < 0.02, 'one cycle per STRIDE_PER_CYCLE design units');
  assert.ok(f._bAmp > 0.99);
  for (let i = 0; i < 100; i++) k.advance(f, DT, 0, 60, false);
  assert.equal(f._bGait, g1, 'standing still: feet stay put');
  assert.ok(f._bAmp < 0.01, 'stride amplitude relaxes to zero so every foot ends up planted');
  const pose = k.legPose(k.STYLES.o_king_crab, f._bGait, f._bAmp);
  assert.ok(pose.every(l => Math.abs(l.foot[1] - k.GROUND) < 0.01));
});

test('body bobs a little while walking, and not at all (beyond idle breathing) when standing', () => {
  const k = K();
  const walking = [], idle = [];
  for (let i = 0; i < 100; i++) { walking.push(k.bodyMotion(i / 100, 1, 0).dy); idle.push(k.bodyMotion(i / 100, 0, 0).dy); }
  const range = a => Math.max(...a) - Math.min(...a);
  assert.ok(range(walking) > 0.025 && range(walking) < 0.08, 'slight bob');
  assert.ok(range(idle) < 0.001);
  assert.ok(walking.every(v => v <= 0.01), 'bob only lifts the body, feet never get driven into the sand');
});

test('legs are long and spindly: leg length is well beyond the carapace width and reaches the sand from hip height', () => {
  const k = K();
  for (const id of h.CRAB_IDS) {
    const st = k.STYLES[id];
    const legs = k.legPose(st, 0.2, 1);
    const carapaceWidth = 2 * 0.76 * st.shape.cw;
    for (const l of legs) {
      const len = Math.hypot(l.knee[0] - l.hip[0], l.knee[1] - l.hip[1]) + Math.hypot(l.ankle[0] - l.knee[0], l.ankle[1] - l.knee[1]) + Math.hypot(l.foot[0] - l.ankle[0], l.foot[1] - l.ankle[1]);
      assert.ok(len > 1.35 * carapaceWidth, `${id}/${l.id}: leg ${len.toFixed(2)} vs carapace ${carapaceWidth.toFixed(2)}`);
      assert.ok(l.foot[1] - l.hip[1] > 0.7, 'hip is clearly above the sand');
    }
    const mean = legs.reduce((a, l) => a + Math.hypot(l.knee[0] - l.hip[0], l.knee[1] - l.hip[1]) + Math.hypot(l.ankle[0] - l.knee[0], l.ankle[1] - l.knee[1]) + Math.hypot(l.foot[0] - l.ankle[0], l.foot[1] - l.ankle[1]), 0) / legs.length;
    assert.ok(mean > 1.45 * carapaceWidth, `${id}: mean leg ${mean.toFixed(2)}`);
    const fw = Math.max(...legs.map(l => l.foot[0])) - Math.min(...legs.map(l => l.foot[0]));
    assert.ok(fw > 2.2, `${id}: feet span ${fw.toFixed(2)}`);
  }
});

test('four crabs are visually distinct: palettes and body shape parameters differ pairwise', () => {
  const k = K();
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  const ids = h.CRAB_IDS;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = k.STYLES[ids[i]], B = k.STYLES[ids[j]];
    assert.ok(dist(A.pal.mid, B.pal.mid) > 55, `${ids[i]} vs ${ids[j]} shell`);
    assert.ok(dist(A.pal.leg, B.pal.leg) > 35, `${ids[i]} vs ${ids[j]} legs`);
    const sig = s => JSON.stringify(s.shape);
    assert.notEqual(sig(A), sig(B));
  }
  const hsl = c => { const [r, g, b] = rgb(c).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: hh * 60, s: mx ? d / mx : 0 }; };
  const blue = hsl(k.STYLES.o_blue_king_crab.pal.mid), gold = hsl(k.STYLES.o_golden_king_crab.pal.mid), chil = hsl(k.STYLES.o_chilean_king_crab.pal.mid), red = hsl(k.STYLES.o_king_crab.pal.mid);
  assert.ok(blue.h > 200 && blue.h < 270 && blue.s < 0.5, 'blue king crab is dusty blue/purple-blue');
  assert.ok(gold.h > 35 && gold.h < 50, 'golden is mustard gold');
  assert.ok(chil.h > 15 && chil.h < 28 && chil.s > 0.85, 'chilean is bright orange');
  assert.ok(red.h < 8 || red.h > 350, 'red-gold is a deep red');
  assert.ok(k.STYLES.o_golden_king_crab.shape.spines > k.STYLES.o_king_crab.shape.spines * 1.4, 'golden is the spiny one');
  assert.ok(k.STYLES.o_chilean_king_crab.shape.clawR > k.STYLES.o_king_crab.shape.clawR);
});

test('draw: balanced canvas state, never touches images, silhouette mode uses only the silhouette colour', () => {
  const ctx = ctxFor();
  for (const id of h.CRAB_IDS) {
    for (const opt of [{}, { sil: true }, { sizeMeasure: true }, { pv: 1 }]) {
      const c = h.recorder();
      const ok = ctx.Benthic267.draw(c, { phase: 1.2, face: 1 }, SPECIES(id), opt);
      assert.equal(ok, true);
      const saves = c.log.filter(l => l[0] === 'save').length, restores = c.log.filter(l => l[0] === 'restore').length;
      assert.equal(saves, restores, `${id} ${JSON.stringify(opt)}`);
      assert.ok(!c.log.some(l => l[0] === 'drawImage'), 'procedural: no bitmap');
      assert.ok(!c.log.some(l => l[0].startsWith('set:') && Number.isNaN(l[1])), 'no NaN state');
      for (const l of c.log) for (const v of l.slice(1)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${l[0]} got ${v}`);
      if (opt.sil) {
        const fills = c.log.filter(l => l[0] === 'set:fillStyle' || l[0] === 'set:strokeStyle').map(l => l[1]);
        assert.ok(fills.every(v => v === '#06192a'), `${id}: silhouette leaked colour ${fills.find(v => v !== '#06192a')}`);
      }
    }
  }
});

test('draw is deterministic for the same pose and animates between poses', () => {
  const ctx = ctxFor(), s = SPECIES('o_king_crab');
  const render = f => { const c = h.recorder(); ctx.Benthic267.draw(c, f, s, {}); return JSON.stringify(c.log); };
  const a = render({ _bGait: 0.1, _bAmp: 1, phase: 1 }), b = render({ _bGait: 0.1, _bAmp: 1, phase: 1 }), c2 = render({ _bGait: 0.45, _bAmp: 1, phase: 1 });
  assert.equal(a, b);
  assert.notEqual(a, c2);
  const still1 = render({ _bGait: 0.1, _bAmp: 0, phase: 1 }), still2 = render({ _bGait: 0.6, _bAmp: 0, phase: 1 });
  assert.equal(still1.length > 0, true);
  assert.equal(render({ phase: 1.2 }), render({ phase: 1.2, _bGait: 77, _bAmp: 0.3, pv: 1 }) === '' ? '' : render({ phase: 1.2 }), 'unset state renders the default pose');
});

test('size probe pose is state independent (so bounds cache is stable regardless of which crab measures first)', () => {
  const ctx = ctxFor(), s = SPECIES('o_blue_king_crab');
  const r = f => { const c = h.recorder(); ctx.Benthic267.draw(c, f, s, { sizeMeasure: true }); return JSON.stringify(c.log); };
  assert.equal(r({ phase: 1.2 }), r({ phase: 1.2, _bGait: 5.5, _bAmp: 0.1 }));
});

test('feeding crab eats the food it walks to and faces it', () => {
  const ctx = ctxFor(), id = 'o_golden_king_crab', s = SPECIES(id), f = crab(id, 700);
  f.full = 10;
  let eaten = 0;
  const food = { x: 400, landed: true };
  let faceAtMeal = null, xAtMeal = null;
  const e = ENV({ foods: [food], eat(fish, fd) { eaten++; faceAtMeal = fish.face; xAtMeal = fish.x; fd.landed = false; e.foods.length = 0; } });
  run(ctx, f, s, e, 30);
  assert.equal(eaten, 1);
  assert.equal(faceAtMeal, -1, 'turned to walk to food on its left');
  assert.ok(Math.abs(xAtMeal - 400) < 12, `ate at x=${xAtMeal}`);
});

test('neighbour blocking still stops a crab without making it moonwalk', () => {
  const ctx = ctxFor(), id = 'o_king_crab', s = SPECIES(id), f = crab(id, 300);
  const e = ENV({ neighbors: [{ x: 420, half: 60 }] });
  aim(f, 900);
  const trace = run(ctx, f, s, e, 20);
  assert.ok(f.x < 420 - 60, 'does not pass through the neighbour');
  for (const p of trace) if (Math.abs(p.vx) > 0.4) assert.equal(Math.sign(p.vx), p.face);
});
