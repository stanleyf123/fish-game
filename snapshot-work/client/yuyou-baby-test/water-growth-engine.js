export const STORAGE_KEY = 'feedfishs.yuyou-baby.water-growth.v1';
export const FOODS = Object.freeze({
  dew: {name: '露珠果', icon: '◉', note: '清甜多汁，偏水、帶一點木', scores: {water: 4, wood: 1, earth: 0}},
  rice: {name: '潮米團', icon: '◆', note: '柔軟飽足，偏水、帶一點土', scores: {water: 3, wood: 0, earth: 1}},
  sprout: {name: '嫩芽球', icon: '♧', note: '偶爾換口味，偏木、帶一點水', scores: {water: 1, wood: 3, earth: 0}}
});
export const WAYS = Object.freeze({
  patient: {name: '耐心陪餵', note: '慢慢陪牠吃完，親密更深', heart: 3},
  play: {name: '尋食遊戲', note: '讓點心藏一點驚喜，個性活潑', heart: 1},
  regular: {name: '規律分餐', note: '分成小口，練習更專注', heart: 2}
});
export const STAGES = Object.freeze([
  {id: 'juvenile', name: '犄角', title: '幼年', line: '小小的好奇心，等你一起長大。', art: 'art/growth214/hornling-juvenile214.webp'},
  {id: 'mature', name: '澄角', title: '水系成熟', line: '會踏水，也開始學著照顧你。', art: 'art/growth214/hornling-mature214.webp'},
  {id: 'complete', name: '瀾璇', title: '水系完全', line: '把一起度過的日常，化成自在的潮流。', art: 'art/growth214/hornling-complete214.webp'}
]);
const FOOD_IDS = Object.keys(FOODS), WAY_IDS = Object.keys(WAYS);
const zero = () => ({meals: 0, care: 0, practice: 0, heart: 0, perfect: 0, foods: {dew: 0, rice: 0, sprout: 0}, ways: {patient: 0, play: 0, regular: 0}});
const cycle = () => ({fed: false, cared: false, practiced: false, food: null, way: null, score: null});
const clone = x => JSON.parse(JSON.stringify(x));
const integer = x => Number.isSafeInteger(x) && x >= 0 && x <= 1000000;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export function createProfile(id = 'water-sample') {
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw Error('INVALID_ID');
  return {schema: 1, id, rev: 0, name: '泡泡', stage: 0, round: 1, totals: zero(), stageStart: zero(), cycle: cycle(), evolutions: [], journal: []};
}
export function scores(totals) {
  const out = {water: 0, wood: 0, earth: 0};
  for (const id of FOOD_IDS) for (const element of Object.keys(out)) out[element] += totals.foods[id] * FOODS[id].scores[element];
  return out;
}
export function waterShare(totals) {
  const s = scores(totals), sum = s.water + s.wood + s.earth;
  return sum ? s.water / sum : 0;
}
export function progressSince(totals, start) {
  const out = zero();
  for (const k of ['meals', 'care', 'practice', 'heart', 'perfect']) out[k] = totals[k] - start[k];
  for (const k of FOOD_IDS) out.foods[k] = totals.foods[k] - start.foods[k];
  for (const k of WAY_IDS) out.ways[k] = totals.ways[k] - start.ways[k];
  return out;
}
function checksFor(stage, totals, start, cared) {
  if (stage >= 2) return [];
  const t = stage === 0 ? totals : progressSince(totals, start);
  const goals = stage === 0 ? {meals: 6, care: 4, practice: 3, share: .55} : {meals: 8, care: 6, practice: 5, share: .60};
  return [
    {id: 'meals', label: stage ? '成熟後的餐點' : '一起吃過的餐點', value: t.meals, goal: goals.meals},
    {id: 'care', label: stage ? '成熟後的陪伴' : '陪伴照顧', value: t.care, goal: goals.care},
    {id: 'practice', label: stage ? '成熟後的練習' : '節拍練習', value: t.practice, goal: goals.practice},
    {id: 'water', label: stage ? '成熟後的水向飲食' : '累積水向飲食', value: waterShare(t) * 100, goal: goals.share * 100, unit: '%'},
    {id: 'today', label: '這回合也陪伴過牠', value: cared ? 1 : 0, goal: 1}
  ].map(c => ({...c, done: c.value + 1e-8 >= c.goal}));
}
export function evolutionChecks(s) { return checksFor(s.stage, s.totals, s.stageStart, s.cycle.cared); }
export function canEvolve(s) { return s.stage < 2 && evolutionChecks(s).every(c => c.done); }
export function temperament(s) {
  const entries = WAY_IDS.map(k => [k, s.totals.ways[k]]).sort((a, b) => b[1] - a[1]);
  if (!entries[0][1] || entries[0][1] === entries[1][1]) return {id: 'balanced', name: '均衡夥伴', note: '喜歡和你一起嘗試不同日常'};
  return ({patient: {id: 'patient', name: '貼心夥伴', note: '成熟後，練習失手也至少保留一顆星'}, play: {id: 'play', name: '活力夥伴', note: '成熟後，練習出現兩次好拍可多一分'}, regular: {id: 'regular', name: '專注夥伴', note: '成熟後，練習的好拍範圍會更寬'}})[entries[0][0]];
}
export function practiceRules(s) {
  const role = temperament(s).id;
  return {width: [.20, .24, .28][s.stage] + (s.stage > 0 && role === 'regular' ? .04 : 0), role: s.stage ? role : 'balanced', speed: [.44, .49, .53][s.stage]};
}
export function timingPosition(seconds, speed = .44) {
  const x = Math.max(0, seconds) * speed % 2;
  return x <= 1 ? x : 2 - x;
}
export function judgeTiming(position, width) {
  if (!Number.isFinite(position) || !Number.isFinite(width)) return 0;
  const distance = Math.abs(position - .5);
  return distance <= width / 4 ? 2 : distance <= width / 2 ? 1 : 0;
}
function validTotals(t) {
  if (!t || !['meals', 'care', 'practice', 'heart', 'perfect'].every(k => integer(t[k])) || !t.foods || !t.ways) return false;
  if (!FOOD_IDS.every(k => integer(t.foods[k])) || !WAY_IDS.every(k => integer(t.ways[k]))) return false;
  return FOOD_IDS.reduce((n, k) => n + t.foods[k], 0) === t.meals && WAY_IDS.reduce((n, k) => n + t.ways[k], 0) === t.meals && t.care <= t.meals && t.practice <= t.care && t.perfect <= t.practice;
}
function within(a, b) {
  return ['meals', 'care', 'practice', 'heart', 'perfect'].every(k => a[k] <= b[k]) && FOOD_IDS.every(k => a.foods[k] <= b.foods[k]) && WAY_IDS.every(k => a.ways[k] <= b.ways[k]);
}
export function validProfile(s) {
  try {
    if (!s || s.schema !== 1 || typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id) || !integer(s.rev) || ![0, 1, 2].includes(s.stage) || !integer(s.round) || s.round < 1) return false;
    if (typeof s.name !== 'string' || [...s.name].length < 1 || [...s.name].length > 12 || /[\u0000-\u001f<>]/.test(s.name)) return false;
    if (!validTotals(s.totals) || !validTotals(s.stageStart) || !within(s.stageStart, s.totals)) return false;
    const c = s.cycle;
    if (!c || !['fed', 'cared', 'practiced'].every(k => typeof c[k] === 'boolean') || (c.cared && !c.fed) || (c.practiced && !c.cared)) return false;
    if (c.fed ? !has(FOODS, c.food) || !has(WAYS, c.way) : c.food !== null || c.way !== null) return false;
    if (c.practiced ? !integer(c.score) || c.score > 6 : c.score !== null) return false;
    if (s.totals.meals !== s.round - 1 + Number(c.fed) || (c.cared && s.totals.care === 0) || (c.practiced && s.totals.practice === 0)) return false;
    if (!Array.isArray(s.evolutions) || s.evolutions.length !== s.stage || !Array.isArray(s.journal) || s.journal.length > 48) return false;
    let previous = zero();
    for (let i = 0; i < s.evolutions.length; i++) {
      const e = s.evolutions[i];
      if (!e || e.stage !== i + 1 || e.receipt !== s.id + ':stage' + e.stage || !integer(e.round) || !validTotals(e.totals) || !within(previous, e.totals) || !within(e.totals, s.totals)) return false;
      if (e.round > s.round || e.round !== e.totals.meals || !checksFor(i, e.totals, previous, true).every(c => c.done)) return false;
      previous = e.totals;
    }
    if (JSON.stringify(previous) !== JSON.stringify(s.stageStart)) return false;
    return s.journal.every(e => e && integer(e.rev) && integer(e.round) && ['feed', 'care', 'practice', 'rest', 'evolve', 'rename'].includes(e.kind) && typeof e.text === 'string' && e.text.length <= 150);
  } catch { return false; }
}
function change(s, kind, fn) {
  if (!validProfile(s)) throw Error('INVALID_PROFILE');
  const n = clone(s), text = fn(n);
  n.rev++;
  n.journal.unshift({rev: n.rev, round: n.round, kind, text});
  n.journal.length = Math.min(n.journal.length, 48);
  if (!validProfile(n)) throw Error('INVALID_RESULT');
  return n;
}
export function feed(s, food, way) {
  return change(s, 'feed', n => {
    if (!has(FOODS, food) || !has(WAYS, way)) throw Error('INVALID_FOOD');
    if (n.cycle.fed) throw Error('ALREADY_FED');
    n.cycle.fed = true; n.cycle.food = food; n.cycle.way = way;
    n.totals.meals++; n.totals.foods[food]++; n.totals.ways[way]++; n.totals.heart += WAYS[way].heart;
    return WAYS[way].name + '，吃了' + FOODS[food].name + '。';
  });
}
export function care(s) {
  return change(s, 'care', n => {
    if (!n.cycle.fed) throw Error('FEED_FIRST');
    if (n.cycle.cared) throw Error('ALREADY_CARED');
    n.cycle.cared = true; n.totals.care++; n.totals.heart += 3;
    return '靠近陪牠一會兒，牠安心地蹭了蹭你的手。';
  });
}
export function practice(s, marks) {
  return change(s, 'practice', n => {
    if (!n.cycle.cared) throw Error('CARE_FIRST');
    if (n.cycle.practiced) throw Error('ALREADY_PRACTICED');
    if (!Array.isArray(marks) || marks.length !== 3 || marks.some(x => ![0, 1, 2].includes(x))) throw Error('INVALID_MARKS');
    let score = marks.reduce((a, b) => a + b, 0), rules = practiceRules(n);
    if (rules.role === 'patient') score = Math.max(2, score);
    if (rules.role === 'play' && marks.filter(x => x > 0).length >= 2) score = Math.min(6, score + 1);
    n.cycle.practiced = true; n.cycle.score = score; n.totals.practice++; n.totals.heart += 1 + Math.floor(score / 2);
    if (score === 6) n.totals.perfect++;
    return '一起練了三拍，留下' + Math.ceil(score / 2) + '顆星；每次嘗試都是成長。';
  });
}
export function rest(s) {
  return change(s, 'rest', n => {
    if (!n.cycle.fed) throw Error('FEED_FIRST');
    n.round++; n.cycle = cycle();
    return '好好休息，迎接下一個日常。';
  });
}
export function evolve(s) {
  return change(s, 'evolve', n => {
    if (!canEvolve(n)) throw Error('NOT_READY');
    n.stage++;
    n.evolutions.push({stage: n.stage, receipt: n.id + ':stage' + n.stage, round: n.round, totals: clone(n.totals)});
    n.stageStart = clone(n.totals);
    return '你的' + n.name + '長成了' + STAGES[n.stage].name + '，還是同一位夥伴。';
  });
}
export function rename(s, name) {
  return change(s, 'rename', n => {
    const clean = [...String(name).trim().replace(/[\u0000-\u001f<>]/g, '')].slice(0, 12).join('');
    if (!clean) throw Error('INVALID_NAME');
    n.name = clean;
    return '你叫牠' + clean + '，牠開心地回過頭。';
  });
}
export function parseProfile(raw) {
  try { const s = JSON.parse(raw); return validProfile(s) ? s : null; } catch { return null; }
}
