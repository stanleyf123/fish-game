'use strict';
// 寶石限定魚（伺服器端原子扣款＋發魚）、成長進化欄位、舊存檔空間制免費升級
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');
const { validateConfig } = require('../src/config-validate');
const { fitTier } = require('../src/anticheat');

const fishOf = (sv, sp) => sv.fish.filter((f) => f.sp === sp);

test('寶石限定魚：只能透過伺服器購買，扣寶石與發魚在同一個交易內', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk(); const me = await sdk.ensureSession();

  await t.test('公開設定含限定魚與寶石價格（即使寶石商品未上架）', async () => {
    const pub = await (await fetch(srv.base + '/api/config')).json();
    const prem = Object.entries(pub.species).filter(([, s]) => s.priceGems > 0);
    const configured=Object.entries((await admin.get('/config')).data.config.species).filter(([,s])=>!s.disabled&&s.priceGems>0).map(([id])=>id).sort();
    assert.ok(configured.length>0);assert.deepEqual(prem.map(([id])=>id).sort(),configured);
    for (const [, s] of prem) { assert.equal(s.price, 0, '限定魚不能用金幣買'); assert.equal(s.premium, true); }
    assert.equal(pub.species.p_starbetta.priceGems, 120);
  });

  await t.test('沒有雲端存檔 → 409 no_save；寶石不足 → 402，不扣款也不發魚', async () => {
    await assert.rejects(sdk.buySpecies('p_starbetta', 'x0'), (e) => e.status === 409 && (e.data && e.data.error) === 'no_save');
    await sdk.writeSave(sampleSave());
    await assert.rejects(sdk.buySpecies('p_starbetta', 'x1'), (e) => e.status === 402 && (e.data && e.data.error) === 'insufficient_gems');
    const sv = await sdk.loadSave();
    assert.equal(fishOf(sv.save, 'p_starbetta').length, 0);
  });

  await t.test('不是限定魚 / 不存在 → 404', async () => {
    await assert.rejects(sdk.buySpecies('goldfish', 'x2'), (e) => e.status === 404 && (e.data && e.data.error) === 'species_not_for_sale');
    await assert.rejects(sdk.buySpecies('__proto__', 'x3'), (e) => e.status === 404);
  });

  let bought;
  await t.test('後台發放寶石 → 購買成功：扣款、魚寫入存檔（幼魚）、rev +1、訂單與帳本', async () => {
    const g = await admin.post(`/players/${me.id}/gems`, { delta: 500, reason: 'test' });
    assert.equal(g.status, 200);
    const before = await sdk.loadSave();
    bought = await sdk.buySpecies('p_starbetta', 'buy-1');
    assert.equal(bought.balance, 380);
    assert.equal(bought.rev, before.rev + 1);
    assert.equal(bought.fish.sp, 'p_starbetta');
    assert.equal(bought.fish.growth, 0);
    assert.equal(fishOf(bought.save, 'p_starbetta').length, 1);
    assert.equal(bought.save.found.p_starbetta, 1);
    assert.equal(bought.order.status, 'paid');
    assert.equal(bought.order.sku, 'species:p_starbetta');
    const w = await sdk.getWallet();
    assert.equal(w.gems, 380);
    assert.ok(w.ledger.some((l) => l.delta === -120));
  });

  await t.test('相同 idempotencyKey 重送不重複扣款', async () => {
    const again = await sdk.buySpecies('p_starbetta', 'buy-1');
    assert.equal(again.reused, true);
    assert.equal(again.balance, 380);
    assert.equal(fishOf(again.save, 'p_starbetta').length, 1);
  });

  await t.test('購買後客戶端照常上傳存檔（限定魚數量不變）', async () => {
    const sv = await sdk.loadSave();
    const r = await sdk.writeSave({ ...sv.save, last: Date.now() });
    assert.equal(r.ok, true);
  });

  await t.test('客戶端自己多塞一條限定魚 → 伺服器拒絕', async () => {
    const sv = (await sdk.loadSave()).save;
    const f = { ...fishOf(sv, 'p_starbetta')[0], id: 'hack1' };
    assert.equal((await sdk.writeSave({ ...sv, fish: [...sv.fish, f], last: Date.now() })).rejected, true);
    const sdk2 = srv.sdk(); await sdk2.ensureSession();
    const fresh = sampleSave(); fresh.fish.push({ ...fresh.fish[0], id: 'hack2', sp: 'p_rubyshrimp' });
    assert.equal((await sdk2.writeSave(fresh)).rejected, true, '首次上傳也不能帶限定魚');
  });

  await t.test('魚缸等級不足 → 409 tank_too_small，不扣款', async () => {
    await assert.rejects(sdk.buySpecies('p_goldarowana', 'x4'), (e) => e.status === 409 && (e.data && e.data.error) === 'tank_too_small');
    assert.equal((await sdk.getWallet()).gems, 380);
  });

  await t.test('後台停用限定魚 → 404 並從公開設定移除寶石價格', async () => {
    const d = await admin.post('/species/p_auroratetra/disabled', { disabled: true });
    assert.equal(d.status, 200);
    await assert.rejects(sdk.buySpecies('p_auroratetra', 'x6'), (e) => e.status === 404);
    const pub = await (await fetch(srv.base + '/api/config')).json();
    assert.ok(!(pub.species.p_auroratetra.priceGems > 0));
  });

  await t.test('後台改價立即生效', async () => {
    const cur = (await admin.get('/config')).data;
    cur.config.species.p_rubyshrimp.priceGems = 10;
    const r = await admin.put('/config', { config: cur.config, note: 'test: 改價', baseVersion: cur.version });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const sdk3 = srv.sdk(); const p3 = await sdk3.ensureSession(); await sdk3.writeSave(sampleSave());
    await admin.post(`/players/${p3.id}/gems`, { delta: 10, reason: 'test' });
    const b = await sdk3.buySpecies('p_rubyshrimp', 'cheap');
    assert.equal(b.balance, 0);
  });
});

test('魚缸空間不足時不能買限定魚', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk(); const me = await sdk.ensureSession();
  const sv = sampleSave(); sv.fish.push({ ...sv.fish[0], id: 'gfx', growth: 0 }, { ...sv.fish[2], id: 'clx', growth: 0 }); // 7.5 / 8
  await sdk.writeSave(sv);
  await admin.post(`/players/${me.id}/gems`, { delta: 300, reason: 'test' });
  await assert.rejects(sdk.buySpecies('p_starbetta', 'full'), (e) => e.status === 409 && (e.data && e.data.error) === 'tank_full');
  assert.equal((await sdk.getWallet()).gems, 300);
  const ok = await sdk.buySpecies('p_rubyshrimp', 'small'); // 0.5 格剛好放得下
  assert.equal(ok.balance, 260);
});

test('成長進化欄位與舊存檔空間制遷移', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const sdk = srv.sdk(); const me = await sdk.ensureSession();
  const cfg = (await admin.get('/config')).data.config;

  await t.test('evoFrom / adult / capV 欄位可上傳；不合法值被拒', async () => {
    const sv = sampleSave({ capV: 2, adult: { goldfish: 1 } });
    sv.fish[0].evoFrom = 1; sv.fish[0].growth = 170;
    assert.equal((await sdk.writeSave(sv)).ok, true);
    const bad = { ...sv, fish: sv.fish.map((f, i) => (i ? f : { ...f, evoFrom: 3 })), last: Date.now() };
    const invalid=await sdk.writeSave(bad);assert.equal(invalid.rejected,true);assert.equal(invalid.code,'invalid');
    assert.equal((await srv.req('PUT','/api/save',{save:bad,rev:sdk.rev},{Authorization:'Bearer '+sdk.token()})).status,400);
    const unknown=await sdk.writeSave({...sv,adult:{__invalid_test_species__:1},last:Date.now()});assert.equal(unknown.rejected,true);assert.equal(unknown.code,'invalid');
  });

  await t.test('舊存檔（無 capV、魚超過新容量）第一次以空間制上傳：免費升到 fitTier', async () => {
    const sdk2 = srv.sdk(); const p2 = await sdk2.ensureSession();
    const old = sampleSave();
    old.fish = Array.from({ length: 13 }, (_, i) => ({ ...old.fish[0], id: 'o' + i, growth: 100 })); // 13 × 1.5 = 19.5 格
    delete old.capV;
    // 舊版（以條數計算）伺服器已接受的存檔：直接寫入資料庫模擬
    srv.ctx.players.writeSaveRow(p2.id, old, 1, Date.now() - 1000, true);
    sdk2.setRev && sdk2.setRev(1);
    const lv = fitTier(cfg, old.fish);
    assert.equal(lv, 3, '19.5 格需要 21 格的 Lv3：' + lv + ' cfg=' + JSON.stringify(cfg.capacity) + ' gs=' + cfg.species.goldfish.tankSpace);
    const cur = await sdk2.loadSave();
    const migrated = { ...cur.save, capV: 2, up: { ...cur.save.up, cap: lv }, last: Date.now() };
    const r = await sdk2.writeSave(migrated);
    assert.equal(r.ok, true, JSON.stringify(r));

    // 對照：已是空間制的存檔，不花金幣直接升 3 級 → 被拒
    const sdk3 = srv.sdk(); const p3 = await sdk3.ensureSession();
    srv.ctx.players.writeSaveRow(p3.id, { ...old, capV: 2 }, 1, Date.now() - 1000, true);
    const c3 = await sdk3.loadSave();
    assert.equal((await sdk3.writeSave({ ...c3.save, up: { ...c3.save.up, cap: 3 }, last: Date.now() })).rejected, true);
  });

  await t.test('設定驗證：進化參數與限定魚規則', () => {
    assert.deepEqual(validateConfig(cfg), []);
    const c1 = structuredClone(cfg); c1.mechanics.evolution.goodCareMult = -1;
    assert.ok(validateConfig(c1).length > 0);
    const c2 = structuredClone(cfg); c2.species.p_starbetta.price = 100;
    assert.ok(validateConfig(c2).some((e) => /priceGems|限定|金幣/.test(e)), validateConfig(c2).join());
    const c3 = structuredClone(cfg); c3.species.p_starbetta.priceGems = 1.5;
    assert.ok(validateConfig(c3).length > 0);
  });
});

test('後台直接設定玩家寶石與金幣（含操作紀錄）', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  const sdk = srv.sdk(); const me = await sdk.ensureSession(); await sdk.writeSave(sampleSave());
  let r = await admin.post(`/players/${me.id}/gems`, { set: 999999, reason: '自己的帳號' });
  assert.equal(r.status, 200); assert.equal(r.data.balance, 999999);
  r = await admin.post(`/players/${me.id}/gems`, { set: 50, reason: 'down' });
  assert.equal(r.data.balance, 50);
  assert.equal((await admin.post(`/players/${me.id}/gems`, { set: -1 })).status, 400);
  const cur = (await admin.get(`/players/${me.id}`)).data.save;
  const save = { ...cur.save, coins: 123456789 };
  assert.equal((await admin.put(`/players/${me.id}/save`, { save })).status, 200);
  const sv = await sdk.loadSave();
  assert.equal(sv.save.coins, 123456789);
  const audit = (await admin.get('/audit')).data.entries.map((e) => e.action);
  assert.ok(audit.includes('player.gems') && audit.includes('player.save_edit'));
  assert.equal((await sdk.getWallet()).gems, 50);
});
