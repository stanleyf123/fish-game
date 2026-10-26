'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, adminClient } = require('./helpers');
const { extract } = require('../scripts/extract-config');
const { validateConfig } = require('../src/config-validate');

test('設定種子：從遊戲 index.html 擷取的 GAME_CONFIG 通過驗證', () => {
  const html = fs.readFileSync(path.join(__dirname, '../seed/game-index.snapshot.html'), 'utf8');
  const cfg = extract(html);
  assert.deepEqual(validateConfig(cfg), []);
  assert.equal(cfg.species.goldfish.price, 15);
  assert.equal(cfg.offline.capSec, 8 * 3600);
  assert.deepEqual(cfg.breeding.mutation.pools[0].species.slice(0, 3), ['koi', 'dragon', 'rainbow']);
  assert.equal(cfg.capacity.upgrades.length, 8, '8 級魚缸');
  assert.equal(cfg.capacity.upgrades.at(-1).cost, 60000);
  assert.ok(Object.keys(cfg.species).length >= 312);
  const prem = Object.keys(cfg.species).filter((k) => cfg.species[k].priceGems > 0);
  assert.ok(prem.length >= 12 && prem.length <= 20, '限定魚 12–20 種');
  assert.deepEqual(cfg.stages.map((s) => s.name), ['幼魚', '亞成', '成年']);
  assert.equal(cfg.mechanics.evolution.enabled, true);
});

test('設定 CRUD、版本紀錄與回復', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);

  await t.test('公開 GET /api/config：不含 antiCheat、支援 ETag/304', async () => {
    const r = await fetch(srv.base + '/api/config');
    assert.equal(r.status, 200);
    const cfg = await r.json();
    assert.equal(cfg.antiCheat, undefined);
    assert.equal(cfg.species.koi.name, '錦鯉');
    assert.equal(r.headers.get('x-config-revision'), '1');
    const r2 = await fetch(srv.base + '/api/config', { headers: { 'If-None-Match': r.headers.get('etag') } });
    assert.equal(r2.status, 304);
  });

  await t.test('無效設定被拒絕並回傳中文錯誤清單', async () => {
    const cur = (await admin.get('/config')).data;
    const bad = JSON.parse(JSON.stringify(cur.config));
    bad.species.goldfish.price = -5;
    bad.stages[2].growth = 1;
    bad.breeding.mutation.pools[0].species.push('nosuchfish');
    const r = await admin.put('/config', { config: bad, note: 'bad' });
    assert.equal(r.status, 422);
    assert.ok(r.data.errors.some((e) => e.startsWith('species.goldfish.price')));
    assert.ok(r.data.errors.some((e) => e.includes('nosuchfish')));
    assert.ok(r.data.errors.some((e) => e.startsWith('stages')));
    const v = await admin.post('/config/validate', { config: bad });
    assert.ok(v.data.errors.length >= 3);
  });

  let v2;
  await t.test('合法修改 → 新版本 v2，遊戲端立即讀到', async () => {
    const cur = (await admin.get('/config')).data;
    const cfg = cur.config;
    cfg.species.koi.coin = 99;
    cfg.offline.capSec = 4 * 3600;
    const r = await admin.put('/config', { config: cfg, note: '錦鯉加強', baseVersion: cur.version });
    assert.equal(r.status, 200);
    v2 = r.data.version;
    assert.equal(v2, 2);
    const pub = await (await fetch(srv.base + '/api/config')).json();
    assert.equal(pub.species.koi.coin, 99);
    assert.equal(pub.offline.capSec, 14400);
  });

  await t.test('以舊的 baseVersion 儲存會回 409（避免覆蓋別人的修改）', async () => {
    const cur = (await admin.get('/config')).data;
    const r = await admin.put('/config', { config: cur.config, note: 'stale', baseVersion: 1 });
    assert.equal(r.status, 409);
  });

  await t.test('回復到 v1 會建立 v3 且內容等於 v1', async () => {
    const r = await admin.post('/config/rollback/1');
    assert.equal(r.status, 200);
    assert.equal(r.data.version, 3);
    const pub = await (await fetch(srv.base + '/api/config')).json();
    assert.equal(pub.species.koi.coin, 8);
    const list = await admin.get('/config/versions');
    assert.deepEqual(list.data.versions.map((v) => v.version), [3, 2, 1]);
    assert.equal(list.data.versions[0].rollback_of, 1);
    assert.match(list.data.versions[0].note, /回復至 v1/);
  });

  await t.test('魚種新增 / 停用：停用後下架並移出突變池', async () => {
    const species = { name: '海馬', rarity: 1, price: 180, coin: 7, breedOnly: false, disabled: false, speed: 22, desc: '測試魚種', look: { body: 'tall', tail: 'small', fins: 'round', pattern: 'spots', len: 24, height: 26, hue: 30, sat: 80, light: 60 } };
    const c = await admin.put('/species/testhorse', { species });
    assert.equal(c.status, 200);
    let pub = await (await fetch(srv.base + '/api/config')).json();
    assert.equal(pub.species.testhorse.name, '海馬');
    const badSp = await admin.put('/species/bad', { species: { ...species, look: { ...species.look, body: 'cube' } } });
    assert.equal(badSp.status, 422);
    const d = await admin.post('/species/koi/disabled', { disabled: true });
    assert.equal(d.status, 200);
    pub = await (await fetch(srv.base + '/api/config')).json();
    assert.equal(pub.species.koi.price, 0);
    assert.equal(pub.species.koi.breedOnly, true);
    assert.ok(!pub.breeding.mutation.pools.some((p) => p.species.includes('koi')));
    const adminView = (await admin.get('/config')).data.config;
    assert.equal(adminView.species.koi.disabled, true);
    assert.ok(adminView.breeding.mutation.pools[0].species.includes('koi'), '後台保留原始突變池，重新啟用即可恢復');
    const audit = (await admin.get('/audit')).data.entries.map((e) => e.action);
    for (const a of ['config.save', 'config.rollback', 'species.create', 'species.disable']) assert.ok(audit.includes(a), a);
  });
});
