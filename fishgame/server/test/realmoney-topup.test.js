'use strict';
// 儲值金額只算真實金流：寶石購買（provider='gems'）、後台發放、正式環境的模擬金流都不算 NT$ 儲值
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminClient } = require('./helpers');
const { realMoneyProviders, isRealMoneyOrder, REAL_MONEY_PROVIDERS } = require('../src/money');

test('realMoneyProviders：正式環境排除 mock；gems／admin 永遠不算', () => {
  assert.deepEqual(realMoneyProviders({ NODE_ENV: 'production', PAYMENT_MOCK_ENABLED: '1' }), [...REAL_MONEY_PROVIDERS]);
  assert.deepEqual(realMoneyProviders({ NODE_ENV: 'production', PAYMENT_MOCK_ENABLED: '0' }), [...REAL_MONEY_PROVIDERS]);
  assert.ok(realMoneyProviders({ NODE_ENV: 'test', PAYMENT_MOCK_ENABLED: '1' }).includes('mock'));
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test', PAYMENT_MOCK_ENABLED: '1' }]) {
    const L = realMoneyProviders(env);
    assert.ok(!L.includes('gems') && !L.includes('admin'));
  }
  assert.equal(isRealMoneyOrder({ provider: 'gems', currency: 'GEM' }), false);
  assert.equal(isRealMoneyOrder({ provider: 'newebpay', currency: 'TWD' }), true);
});

async function seedOrders(srv, pid) {
  const db = srv.ctx.db, now = Date.now(); let i = 0;
  const ins = (provider, currency, amount, status, extra = {}) => db.prepare(`INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at, paid_at, refunded_at, credited_at)
    VALUES (?,?,?,?,?,?,?,?,'{}',?,?,?,?,?)`).run(`TRM${pid}x${++i}`, pid, 'sku' + i, 'p' + i, amount, currency, status, provider, now, now, status === 'pending' ? null : now, extra.refundedAt || null, provider === 'gems' ? null : now);
  ins('gems', 'GEM', 30, 'paid');        // 💎30 限定魚
  ins('gems', 'GEM', 15, 'paid');        // 💎15 特效藥
  ins('newebpay', 'TWD', 30, 'paid');    // 真實儲值
  ins('ecpay', 'TWD', 300, 'paid');      // 真實儲值
  ins('newebpay', 'TWD', 150, 'pending');
  ins('newebpay', 'TWD', 90, 'refunded', { refundedAt: now });
  ins('admin', 'TWD', 0, 'paid');        // 後台發放
}

test('後台玩家頁：儲值只算真實金流已付款，寶石購買另列', async () => {
  const srv = await startServer({ NODE_ENV: 'test', PAYMENT_MOCK_ENABLED: '0' });
  try {
    const admin = await adminClient(srv);
    const gemOnly = srv.sdk(); const g = await gemOnly.ensureSession();
    const payer = srv.sdk(); const p = await payer.ensureSession();
    const db = srv.ctx.db, now = Date.now();
    const ins = db.prepare(`INSERT INTO orders (id, player_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at, paid_at) VALUES (?,?,?,?,?,?,'paid',?,'{}',?,?,?)`);
    ins.run('TRMg1', g.id, 'species:p_sapphireshrimp', '限定魚・藍寶石蝦', 30, 'GEM', 'gems', now, now, now);
    ins.run('TRMg2', g.id, 'med:med_fish', '藥品・特效藥', 15, 'GEM', 'gems', now, now, now);
    ins.run('TRMm1', g.id, 'gems_60', '模擬', 30, 'TWD', 'mock', now, now, now);   // 未啟用模擬金流時不算
    await seedOrders(srv, p.id);

    const a = (await admin.get('/players/' + g.id)).data.stats.purchases;
    assert.equal(a.twd, 0, '只買寶石商品的玩家儲值應為 0');
    assert.equal(a.count, 0);
    assert.equal(a.gems, 45); assert.equal(a.gemCount, 2);

    const b = (await admin.get('/players/' + p.id)).data.stats.purchases;
    assert.equal(b.twd, 330, '只算已付款的 ecpay/newebpay（不含 pending／refunded／admin／gems）');
    assert.equal(b.count, 2);
    assert.equal(b.gems, 45); assert.equal(b.gemCount, 2);

    const rev = (await admin.get('/revenue?days=30')).data;
    assert.equal(rev.totals.payingUsers, 1, '寶石購買／模擬金流玩家不算付費玩家');
    assert.equal(rev.totals.gross, 330 + 90);
    assert.equal(rev.totals.refunds, 90);
    assert.equal(rev.totals.net, 330);
    assert.ok(!rev.topProducts.some((x) => /^(species|med):/.test(x.sku) || x.name === '模擬'));
    const st = Object.fromEntries(rev.statusCounts.map((r) => [r.status, r.n]));
    assert.equal(st.paid, 2, 'statusCounts 不含 admin／mock');

    // 頭像框儲值等級也只看真實金流
    if (srv.ctx.avatars || srv.ctx.avatar) { const av = srv.ctx.avatars || srv.ctx.avatar; if (av.twd) { assert.equal(av.twd(g.id), 0); assert.equal(av.twd(p.id), 330); } }
  } finally { await srv.stop(); }
});
