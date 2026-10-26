'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient, relaxAntiCheat, sampleSave } = require('./helpers');

test('獎勵寄送、信箱領取、公告、停權、心跳統計', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await adminClient(srv);
  await relaxAntiCheat(admin);
  const alice = srv.sdk(); const a = await alice.ensureSession(); await alice.writeSave(sampleSave());
  const bob = srv.sdk(); const b = await bob.ensureSession(); await bob.writeSave(sampleSave({ coins: 5000 }));

  await t.test('寄給指定玩家 → 只有他看得到 → 領取後寫入雲端存檔', async () => {
    const r = await admin.post('/rewards', { title: '維修補償', body: '謝謝耐心等候', target: 'player', playerId: a.id, coins: 500, fish: [{ species: 'koi', count: 2 }], decorations: ['coral'] });
    assert.equal(r.status, 200);
    assert.equal(r.data.recipients, 1);
    const mail = await alice.getMailbox();
    assert.equal(mail.length, 1);
    assert.equal(mail[0].claimed, false);
    assert.equal((await bob.getMailbox()).length, 0);
    const revBefore = alice.rev;
    const got = await alice.claimMail(mail[0].id);
    assert.equal(got.granted.coins, 500);
    assert.equal(got.granted.fish.length, 2);
    assert.equal(got.granted.fish[0].sp, 'koi');
    assert.equal(got.save.coins, 560);
    assert.ok(got.save.up.deco.includes('coral'));
    assert.equal(got.save.found.koi, 1);
    assert.equal(alice.rev, revBefore + 1, 'SDK 自動更新 rev');
    await assert.rejects(alice.claimMail(mail[0].id), (e) => e.status === 409);
    // 領取後客戶端接著存檔（含獎勵）不會衝突、也不會被判定作弊
    const next = { ...got.save, coins: got.save.coins + 10 };
    const w = await alice.writeSave(next);
    assert.equal(w.ok, true, JSON.stringify(w));
  });

  await t.test('寄給全部玩家（含寶石）；之後才加入的新玩家預設收不到', async () => {
    const r = await admin.post('/rewards', { title: '開服禮', target: 'all', coins: 100, gems: 30 });
    assert.equal(r.status, 200);
    const late = srv.sdk(); await late.ensureSession();
    assert.equal((await late.getMailbox()).length, 0);
    const mail = await bob.getMailbox();
    const m = mail.find((x) => x.title === '開服禮');
    const got = await bob.claimMail(m.id);
    assert.equal(got.gemBalance, 30);
    assert.equal((await bob.getWallet()).gems, 30);
    const r2 = await admin.post('/rewards', { title: '常駐新手禮', target: 'all', includeNew: true, coins: 1 });
    assert.equal(r2.status, 200);
    assert.equal((await late.getMailbox()).length, 1);
  });

  await t.test('依條件篩選（金幣 ≥ 1000）', async () => {
    const pv = await admin.post('/rewards/preview', { target: 'filter', filter: { minCoins: 1000 } });
    assert.equal(pv.data.count, 1);
    const r = await admin.post('/rewards', { title: '富翁獎', target: 'filter', filter: { minCoins: 1000 }, coins: 1 });
    assert.equal(r.data.recipients, 1);
    assert.ok((await bob.getMailbox()).some((m) => m.title === '富翁獎'));
    assert.ok(!(await alice.getMailbox()).some((m) => m.title === '富翁獎'));
  });

  await t.test('撤回獎勵後未領取者看不到；空獎勵被拒絕', async () => {
    const r = await admin.post('/rewards', { title: '誤發', target: 'player', playerId: b.id, coins: 99999 });
    await admin.post(`/rewards/${r.data.id}/revoke`);
    assert.ok(!(await bob.getMailbox()).some((m) => m.title === '誤發'));
    assert.equal((await admin.post('/rewards', { title: '空', target: 'all' })).status, 400);
  });

  await t.test('沒有雲端存檔時領取金幣類獎勵回 409 no_save', async () => {
    const c = srv.sdk(); const p = await c.ensureSession();
    const r = await admin.post('/rewards', { title: '測', target: 'player', playerId: p.id, coins: 5 });
    await assert.rejects(c.claimMail(r.data.id), (e) => e.status === 409 && e.data.error === 'no_save');
  });

  await t.test('公告：只回傳啟用中且在時間範圍內的', async () => {
    const now = Date.now();
    await admin.post('/announcements', { title: '現在顯示', body: 'hi' });
    await admin.post('/announcements', { title: '未來', startsAt: now + 3600e3 });
    await admin.post('/announcements', { title: '已過期', startsAt: now - 7200e3, endsAt: now - 3600e3 });
    await admin.post('/announcements', { title: '停用', active: false });
    const list = await alice.getAnnouncements();
    assert.deepEqual(list.map((x) => x.title), ['現在顯示']);
    assert.equal((await admin.post('/announcements', { title: '錯', startsAt: now, endsAt: now - 1 })).status, 400);
  });

  await t.test('心跳 / 事件 → 儀表板在線人數、DAU、事件統計', async () => {
    await alice.heartbeat(); await bob.heartbeat();
    alice.track('breed', { a: 'goldfish', b: 'clown' }); alice.track('bad type!', {});
    assert.equal(await alice.flush(), 1);
    const d = (await admin.get('/dashboard?days=7')).data;
    assert.ok(d.totals.onlineNow >= 2);
    assert.ok(d.totals.dauToday >= 2);
    assert.ok(d.topEvents.some((e) => e.type === 'c:breed'));
    assert.ok(d.ownership.some((o) => o.key === 'koi' && o.owned === 2));
    assert.ok(d.discovered.some((o) => o.key === 'goldfish'));
  });

  await t.test('停權：踢出所有 token、訪客登入 403、解除後恢復', async () => {
    const r = await admin.post(`/players/${b.id}/ban`, { reason: '使用外掛' });
    assert.equal(r.status, 200);
    let banned = null; bob.on('banned', (x) => { banned = x; });
    await assert.rejects(bob.loadSave(), (e) => e.status === 401);
    await assert.rejects(bob.guest(), (e) => e.status === 403 && e.data.reason === '使用外掛');
    assert.ok(banned);
    const list = await admin.get('/players?filter=banned');
    assert.deepEqual(list.data.players.map((p) => p.id), [b.id]);
    await admin.post(`/players/${b.id}/unban`);
    await bob.guest();
    assert.equal((await bob.loadSave()).save.coins >= 5000, true);
    const audit = (await admin.get('/audit')).data.entries.map((e) => e.action);
    assert.ok(audit.includes('player.ban') && audit.includes('player.unban') && audit.includes('reward.send'));
  });

  await t.test('玩家搜尋', async () => {
    const r = await admin.get('/players?q=%23' + a.id);
    assert.equal(r.data.players[0].id, a.id);
  });
});
