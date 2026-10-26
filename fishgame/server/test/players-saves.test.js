'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, relaxAntiCheat, sampleSave, sleep } = require('./helpers');

test('玩家帳號：訪客、綁定、登入', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  await t.test('同一裝置代碼取得同一個訪客帳號', async () => {
    const a = await srv.req('POST', '/api/auth/guest', { deviceToken: 'device-token-aaaaaaaaaaaaaaaa' });
    const b = await srv.req('POST', '/api/auth/guest', { deviceToken: 'device-token-aaaaaaaaaaaaaaaa' });
    assert.equal(a.status, 200);
    assert.equal(a.data.player.id, b.data.player.id);
    assert.equal(a.data.created, true);
    assert.equal(b.data.created, false);
    assert.notEqual(a.data.token, b.data.token);
    const short = await srv.req('POST', '/api/auth/guest', { deviceToken: 'x' });
    assert.equal(short.status, 400);
  });

  await t.test('SDK：訪客 → 綁定帳號 → 其他裝置登入取得同一帳號', async () => {
    const s1 = srv.sdk();
    const p = await s1.ensureSession();
    const bound = await s1.register('FishLover@Example.com ', 'password123', '魚魚');
    assert.equal(bound.email, 'fishlover@example.com', '信箱 trim＋轉小寫');
    assert.equal(bound.account, 'fishlover@example.com'); assert.equal(bound.bound, true);
    await assert.rejects(s1.register('other@example.com', 'password123'), (e) => e.data.error === 'already_bound');
    const s2 = srv.sdk();
    const p2 = await s2.login('FISHLOVER@example.com', 'password123');
    assert.equal(p2.id, p.id, '登入信箱不分大小寫');
    await assert.rejects(s2.login('fishlover@example.com', 'wrongpass'), (e) => e.status === 401 && e.data.message === '信箱或密碼錯誤');
    const s3 = srv.sdk(); await s3.ensureSession();
    await assert.rejects(s3.register('fishLOVER@example.com', 'password123'), (e) => e.status === 409 && e.data.error === 'email_taken' && e.data.message === '此信箱已註冊');
    await assert.rejects(s3.register('not-an-email', 'password123'), (e) => e.data.error === 'invalid_email' && e.data.message === '信箱格式不正確');
    await assert.rejects(s3.register('abcd@x.com', 'abcd'), (e) => e.data.error === 'invalid_password');
  });

  await t.test('未帶 token 存取玩家 API 回 401', async () => {
    assert.equal((await srv.req('GET', '/api/save')).status, 401);
    assert.equal((await srv.req('GET', '/api/save', undefined, { Authorization: 'Bearer nope' })).status, 401);
  });
});

test('雲端存檔與伺服器端合理性檢查', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  const sdk = srv.sdk();
  const me = await sdk.ensureSession();

  await t.test('第一次上傳、讀回、rev 遞增', async () => {
    assert.equal((await sdk.loadSave()).save, null);
    const r = await sdk.writeSave(sampleSave());
    assert.equal(r.ok, true);
    assert.equal(r.rev, 1);
    const back = await sdk.loadSave();
    assert.equal(back.save.coins, 60);
    assert.equal(back.rev, 1);
  });

  await t.test('存檔間隔太短回 429（預設 2 秒）', async () => {
    const r = await sdk.writeSave(sampleSave({ coins: 61 }));
    assert.equal(r.tooFrequent, true);
  });

  await t.test('rev 不符 → 409 conflict，並回傳伺服器版本', async () => {
    await sleep(2100);
    const r = await srv.req('PUT', '/api/save', { save: sampleSave(), rev: 0 }, { Authorization: 'Bearer ' + sdk.token() });
    assert.equal(r.status, 409);
    assert.equal(r.data.rev, 1);
    assert.equal(r.data.save.coins, 60);
  });

  await relaxAntiCheat(admin);

  await t.test('合理的金幣成長被接受', async () => {
    const r = await sdk.writeSave(sampleSave({ coins: 400 }));
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  await t.test('金幣暴增被拒絕（422），記錄事件並增加可疑次數', async () => {
    const r = await sdk.writeSave(sampleSave({ coins: 9_999_999 }));
    assert.equal(r.rejected, true);
    assert.ok(r.reasons[0].includes('金幣增加過快'));
    const d = await admin.get('/players/' + me.id);
    assert.equal(d.data.player.flags, 1);
    assert.ok(d.data.events.some((e) => e.type === 'anticheat_reject'));
    assert.equal(d.data.save.save.coins, 400, '伺服器存檔不變');
  });

  await t.test('買升級需要扣掉對應金幣；升級倒退與超過容量視為可疑', async () => {
    // 有 400 → 擴建魚缸（100）後最多大約剩 300 + 容許值
    const ok = await sdk.writeSave(sampleSave({ coins: 300, up: { cap: 1, food: 0, feeder: 0, deco: [] } }));
    assert.equal(ok.ok, true);
    const down = await sdk.writeSave(sampleSave({ coins: 300, up: { cap: 0, food: 0, feeder: 0, deco: [] } }));
    assert.equal(down.rejected, true);
    assert.ok(down.reasons.some((x) => x.includes('倒退')));
    const many = sampleSave({ coins: 300, up: { cap: 1, food: 0, feeder: 0, deco: [] } });
    for (let i = 0; i < 20; i++) many.fish.push({ ...many.fish[0], id: 'x' + i });
    const over = await sdk.writeSave(many);
    assert.equal(over.rejected, true);
    assert.ok(over.reasons.some((x) => x.includes('容量')));
  });

  await t.test('結構錯誤（未知魚種、負金幣）一律 400', async () => {
    const bad = sampleSave({ coins: 300, up: { cap: 1, food: 0, feeder: 0, deco: [] } });
    bad.fish[0].sp = '__invalid_test_species__';
    const invalid = await sdk.writeSave(bad); assert.equal(invalid.rejected, true); assert.equal(invalid.code, 'invalid'); assert.ok(invalid.reasons.some(x=>x.includes('__invalid_test_species__')));
    assert.equal((await srv.req('PUT','/api/save',{save:bad,rev:sdk.rev},{Authorization:'Bearer '+sdk.token()})).status,400);
    const negative=await sdk.writeSave(sampleSave({coins:-1})); assert.equal(negative.rejected,true); assert.equal(negative.code,'invalid');
  });

  await t.test('客戶端時鐘超前太多 → 可疑', async () => {
    const r = await sdk.writeSave(sampleSave({ coins: 300, up: { cap: 1, food: 0, feeder: 0, deco: [] }, last: Date.now() + 3600e3 }));
    assert.equal(r.rejected, true);
  });

  await t.test('flag 模式：接受但標記', async () => {
    await relaxAntiCheat(admin, { mode: 'flag' });
    const r = await sdk.writeSave(sampleSave({ coins: 5_000_000, up: { cap: 1, food: 0, feeder: 0, deco: [] } }));
    assert.equal(r.ok, true);
    assert.ok(r.flagged.length);
    const d = await admin.get('/players/' + me.id);
    assert.ok(d.data.events.some((e) => e.type === 'anticheat_flag'));
  });

  await t.test('後台編輯存檔 → 玩家下次存檔收到 409 並取得新版', async () => {
    const cur = (await admin.get('/players/' + me.id)).data.save;
    const edited = { ...cur.save, coins: 12345 };
    const r = await admin.put(`/players/${me.id}/save`, { save: edited });
    assert.equal(r.status, 200);
    const w = await sdk.writeSave(sampleSave({ coins: 1, up: { cap: 1, food: 0, feeder: 0, deco: [] } }));
    assert.equal(w.conflict, true);
    assert.equal(w.save.coins, 12345);
    const bad = await admin.put(`/players/${me.id}/save`, { save: { coins: 'lots' } });
    assert.equal(bad.status, 400);
  });

  await t.test('後台重置存檔', async () => {
    const r = await admin.post(`/players/${me.id}/reset`);
    assert.equal(r.status, 200);
    assert.equal((await sdk.loadSave()).save, null);
  });
});

