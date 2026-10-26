'use strict';
// v4：水草造景／燈具設備／海洋館、混種與限定魚繁殖的伺服器端驗證
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');
const { validateConfig } = require('../src/config-validate');
const { checkSave, capacityOf, spOf, plantIncomeRate } = require('../src/anticheat');
const Hybrid = require('../src/hybrid');
const CFG = require('../seed/default-config.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const fish = (id, sp, over = {}) => ({ id, sp, name: 'x', hue: 10, size: 1, growth: 100, full: 80, health: 100, cd: 0, coinT: 10, seed: 3, ...over });
const T0 = Date.UTC(2026, 9, 21, 4);

test('設定：預設設定含造景與混種欄位且通過驗證；錯誤欄位會被擋下', () => {
  assert.deepEqual(validateConfig(CFG), []);
  assert.ok(Object.keys(CFG.aquascape.plants).length >= 25);
  assert.ok(CFG.aquascape.gear.ocean3 && CFG.species.w_orca && CFG.species.t_redear);
  assert.equal(CFG.premium.breedable, true); assert.ok(CFG.premium.breedCooldownSec > 0);
  const bad = clone(CFG);
  bad.aquascape.plants.java_fern.type = 'tree'; bad.aquascape.gear.heater.addSpace = 50; bad.aquascape.plants.java_moss.cutSell = 99999;
  bad.premium.breedCooldownSec = -1; bad.breeding.hybrid.parentChance = 2; bad.species.t_redear.habitat = { gear: 'nope' };
  const e = validateConfig(bad).join('\n');
  for (const k of ['java_fern.type', 'heater.addSpace', 'java_moss.cutSell', 'premium.breedCooldownSec', 'hybrid.parentChance', 't_redear.habitat.gear']) assert.match(e, new RegExp(k.replace('.', '\\.')));
});

test('混種：確定性推導、名稱、限定魚血統保留發光、回收價上限', () => {
  const id = Hybrid.idOf('goldfish', 'p_starbetta');
  assert.equal(id, Hybrid.idOf('p_starbetta', 'goldfish'));
  const d = spOf(CFG, id);
  assert.ok(d.name && d.name !== CFG.species.goldfish.name && d.name !== CFG.species.p_starbetta.name, d.name); assert.deepEqual(d.parents, ['goldfish', 'p_starbetta']); assert.match(d.desc, /金魚.*×.*星月鬥魚|星月鬥魚.*×.*金魚/); assert.equal(d.hybrid, true); assert.equal(d.premiumBlood, true);
  assert.ok(!d.priceGems && !d.premium, '混種不是限定魚');
  assert.ok(d.sellPrice <= CFG.premium.hybridSellCap);
  assert.deepEqual(spOf(CFG, id), d);
  assert.equal(spOf(CFG, 'hx:goldfish+goldfish'), null);
  assert.equal(spOf(CFG, 'hx:goldfish+nope'), null);
  const cross = Hybrid.cross(CFG, 'goldfish', 'clown', () => .99);
  assert.equal(cross.kind, 'hybrid');
});

test('防作弊：混種與限定魚繁殖', () => {
  const cfg = clone(CFG); cfg.antiCheat.mode = 'reject';
  const prev = sampleSave({ coins: 100, last: T0 - 60000 });
  // 1. 雙親都在魚缸 → 合法
  const okNext = clone(prev); okNext.last = T0; okNext.fish.push(fish('h1', Hybrid.idOf('goldfish', 'clown'), { growth: 0 }));
  let r = checkSave(cfg, prev, T0 - 60000, okNext, T0);
  assert.deepEqual(r.structural, []); assert.deepEqual(r.suspicious, []);
  // 2. 雙親不在 → 可疑
  const badNext = clone(prev); badNext.last = T0; badNext.fish.push(fish('h2', Hybrid.idOf('goldfish', 'p_starbetta'), { growth: 0 }));
  r = checkSave(cfg, prev, T0 - 60000, badNext, T0);
  assert.ok(r.suspicious.some((s) => /雙親/.test(s)), JSON.stringify(r));
  // 3. 不合法混種代號 → 結構錯誤
  const junk = clone(prev); junk.fish.push(fish('h3', 'hx:goldfish+zzz'));
  assert.ok(checkSave(cfg, prev, T0 - 60000, junk, T0).structural.length);
  // 4. 限定魚繁殖：兩條同種限定魚 → +1 條，pbreed 時間合法
  const pp = clone(prev); pp.fish.push(fish('p1', 'p_starbetta'), fish('p2', 'p_starbetta')); pp.pbreed = { p_starbetta: T0 - 5 * 3600e3 };
  const bred = clone(pp); bred.last = T0; bred.fish.push(fish('p3', 'p_starbetta', { growth: 0 })); bred.pbreed = { p_starbetta: T0 - 1000 };
  r = checkSave(cfg, pp, T0 - 60000, bred, T0);
  assert.deepEqual(r.suspicious, []); assert.equal(r.info.premiumBred, 'p_starbetta');
  // 5. 冷卻時間未到 → 可疑
  const early = clone(bred); early.pbreed = { p_starbetta: pp.pbreed.p_starbetta + 600e3 };
  assert.ok(checkSave(cfg, pp, T0 - 60000, early, T0).suspicious.some((s) => /限定魚/.test(s)));
  // 6. 一次多 2 條 / 沒有 pbreed → 可疑
  const two = clone(bred); two.fish.push(fish('p4', 'p_starbetta', { growth: 0 }));
  assert.ok(checkSave(cfg, pp, T0 - 60000, two, T0).suspicious.length);
  const nopb = clone(bred); delete nopb.pbreed;
  assert.ok(checkSave(cfg, pp, T0 - 60000, nopb, T0).suspicious.length);
  // 7. 只有一條限定魚 → 不能繁殖
  const one = clone(prev); one.fish.push(fish('p1', 'p_starbetta')); one.pbreed = {};
  const one2 = clone(one); one2.fish.push(fish('p9', 'p_starbetta')); one2.pbreed = { p_starbetta: T0 - 1000 };
  assert.ok(checkSave(cfg, one, T0 - 60000, one2, T0).suspicious.length);
});

test('防作弊：水草、設備、海洋館', () => {
  const cfg = clone(CFG); cfg.antiCheat.mode = 'reject';
  const prev = sampleSave({ coins: 5000, last: T0 - 30000, plants: [], cut: {}, gear: { own: { airstone: 1 }, light: null, temp: null }, pfound: {} });
  // 金幣買燈＋種水草：扣款正確 → 合法；沒扣錢 → 可疑
  const next = clone(prev); next.last = T0; next.gear.own.light_led = 1; next.gear.light = 'light_led';
  next.plants.push({ id: 'pl1', sp: 'java_fern', x: .3, d: .5, g: 10, hp: 100, seed: 1 }, { id: 'pl2', sp: 'vallisneria', x: .6, d: .2, g: 10, hp: 100, seed: 2 });
  next.pfound = { java_fern: 1, vallisneria: 1 };
  const cost = cfg.aquascape.gear.light_led.price + cfg.aquascape.plants.java_fern.price + cfg.aquascape.plants.vallisneria.price;
  next.coins = prev.coins - cost;
  let r = checkSave(cfg, prev, T0 - 30000, next, T0);
  assert.deepEqual(r.structural, []); assert.deepEqual(r.suspicious, []); assert.equal(r.info.spent, cost);
  const free = clone(next); free.coins = prev.coins + 2000;
  assert.ok(checkSave(cfg, prev, T0 - 30000, free, T0).suspicious.length, '沒付錢的設備／水草');
  // 用插枝種：不扣錢
  const p2 = clone(next); p2.cut = { java_fern: 2 };
  const n2 = clone(p2); n2.plants.push({ id: 'pl3', sp: 'java_fern', x: .4, d: .5, g: 0, hp: 100, seed: 3 }); n2.cut = { java_fern: 1 };
  r = checkSave(cfg, p2, T0 - 30000, n2, T0); assert.equal(r.info.spent, 0); assert.deepEqual(r.suspicious, []);
  // 寶石設備／水草不能由客戶端自己加
  const g1 = clone(next); g1.gear.own.light_aurora = 1;
  assert.ok(checkSave(cfg, next, T0 - 30000, g1, T0).suspicious.some((s) => /寶石/.test(s)));
  const g2 = clone(next); g2.cut = { bucephalandra: 3 };
  assert.ok(checkSave(cfg, next, T0 - 30000, g2, T0).suspicious.some((s) => /寶石/.test(s)));
  // 結構：未知水草 / 超出範圍
  const s1 = clone(next); s1.plants[0].sp = 'triffid'; s1.plants[1].g = 999;
  assert.equal(checkSave(cfg, next, T0 - 30000, s1, T0).structural.length, 2);
  // 海洋館增加容量
  const oc = clone(next); oc.up.cap = 8; oc.gear.own.ocean1 = 1;
  assert.equal(capacityOf(cfg, 8, oc), capacityOf(cfg, 8) + cfg.aquascape.gear.ocean1.addSpace);
  assert.ok(plantIncomeRate(cfg) > 0 && plantIncomeRate(cfg) < 5);
});

test('寶石購買設備／水草（/api/shop/buy-item）與海洋生物棲地檢查', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk(); const me = await sdk.ensureSession();
  await assert.rejects(sdk.buyItem('gear', 'light_aurora', 'a0'), (e) => e.status === 409);
  await sdk.writeSave(sampleSave({ gear: { own: { airstone: 1 }, light: null, temp: null }, plants: [], cut: {} }));
  await assert.rejects(sdk.buyItem('gear', 'light_aurora', 'a1'), (e) => e.status === 402);
  await assert.rejects(sdk.buyItem('gear', 'light_led', 'a2'), (e) => e.status === 404, '金幣商品不能用寶石買');
  await assert.rejects(sdk.buyItem('weird', 'x', 'a3'), (e) => e.status === 400);
  await admin.post(`/players/${me.id}/gems`, { delta: 2000, reason: 'test' });
  const r1 = await sdk.buyItem('gear', 'light_aurora', 'a4');
  assert.equal(r1.save.gear.own.light_aurora, 1); assert.equal(r1.save.gear.light, 'light_aurora'); assert.equal(r1.balance, 2000 - CFG.aquascape.gear.light_aurora.priceGems);
  assert.equal((await sdk.buyItem('gear', 'light_aurora', 'a4')).reused, true);
  await assert.rejects(sdk.buyItem('gear', 'light_aurora', 'a5'), (e) => e.status === 409 && e.data.error === 'already_owned');
  await assert.rejects(sdk.buyItem('gear', 'ocean2', 'a6'), (e) => e.status === 409 && e.data.error === 'requires');
  const r2 = await sdk.buyItem('plant', 'bucephalandra', 'a7');
  assert.equal(r2.save.cut.bucephalandra, 1);
  // 鯨豚需要海洋館
  await assert.rejects(sdk.buySpecies('w_dolphin', 'a8'), (e) => e.status === 409 && e.data.error === 'habitat_missing');
  // 存檔寫入後再上傳（客戶端以伺服器存檔為基準）不被判作弊
  const sv = await sdk.loadSave(); sv.save.last = Date.now();
  const w = await sdk.writeSave(sv.save); assert.ok(w.rev > sv.rev);
});
