'use strict';
// 回歸測試：同一段存檔時間內「繁殖 → 賣掉」的魚（兩份存檔都沒有），不該被判「金幣增加過快」（玩家 #323 誤判）
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sampleSave, sleep } = require('./helpers');
const { checkSave } = require('../src/anticheat');
const CFG = require('../seed/default-config.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const ev = (type, data) => ({ type, data });

test('單元：生了白金龍又賣掉 → 依事件補算賣魚收入；沒有繁殖事件、魚種不符、超過合理次數都不補', () => {
  const T0 = Date.now(), prev = sampleSave({ coins: 1000 }), next = clone(prev); next.coins = 1000 + 6000;
  const run = (events, o = {}) => checkSave(CFG, prev, T0 - 30000, next, T0, { events, ...o });
  assert.ok(run([]).suspicious.some((s) => s.includes('金幣增加過快')), '沒有事件 → 還是擋');
  const ok = run([ev('c:breed', { a: 'goldfish', b: 'goldfish', child: 'platinumarowana', kind: 'mutation' }), ev('c:sell_fish', { sp: 'platinumarowana', v: 6000 })]);
  assert.deepEqual(ok.suspicious, [], JSON.stringify(ok.info)); assert.equal(ok.info.bredSold, 1);
  assert.ok(run([ev('c:sell_fish', { sp: 'platinumarowana', v: 6000 })]).suspicious.length, '只有賣、沒有生 → 不補');
  assert.ok(run([ev('c:breed', { child: 'goldfish' }), ev('c:sell_fish', { sp: 'platinumarowana', v: 6000 })]).suspicious.length, '生的魚種跟賣的不同 → 不補');
  assert.ok(run([ev('c:breed', { child: 'platinumarowana' }), ev('c:sell_fish', { sp: 'platinumarowana', v: 999999 })], { serverBreeds: 0 }).suspicious.length, '伺服器繁殖紀錄 0 次（v4.1 每日繁殖上限）→ 不補');
  // 偽造很多次生了又賣：最多補「合理繁殖次數」（3 條魚 → 1 對 × (30 秒 / 90 秒冷卻 + 1) = 1 次）
  const many = clone(prev); many.coins = 1000 + 6000 * 5;
  const evs = []; for (let i = 0; i < 5; i++) evs.push(ev('c:breed', { child: 'platinumarowana' }), ev('c:sell_fish', { sp: 'platinumarowana' }));
  const r = checkSave(CFG, prev, T0 - 30000, many, T0, { events: evs });
  assert.equal(r.info.bredSold, 1); assert.ok(r.suspicious.some((s) => s.includes('金幣增加過快')));
  // 上一份存檔裡本來就有、這次賣掉的魚不會重複算
  const p2 = sampleSave({ coins: 1000 }); p2.fish.push({ ...p2.fish[0], id: 'pa1', sp: 'platinumarowana' });
  const n2 = clone(p2); n2.fish = n2.fish.filter((f) => f.id !== 'pa1'); n2.coins = 1000 + 6000 * 3;
  const r2 = checkSave(CFG, p2, T0 - 30000, n2, T0, { events: [ev('c:sell_fish', { sp: 'platinumarowana' })] });
  assert.equal(r2.info.bredSold, undefined);
});

test('整合：會員在一個存檔區間內繁殖後賣掉 → 存檔被接受；沒有事件時一樣會被拒絕（正式站 reject 模式）', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const sdk = srv.sdk(); await sdk.ensureSession();
  const s0 = sampleSave({ coins: 1000 });
  assert.ok((await sdk.writeSave(s0)).ok);
  await sleep(2100);
  const bad = clone(s0); bad.coins = 7000; bad.last = Date.now();
  const r0 = await sdk.writeSave(bad); assert.ok(r0.rejected, '沒有事件時被拒絕：' + JSON.stringify(r0));
  // v4.0.5 起每次繁殖都要先向伺服器登記（每日繁殖次數）；沒登記的繁殖不會被補算
  const H = { Authorization: 'Bearer ' + sdk.token() };
  if (srv.ctx.breedLimit) assert.equal((await srv.req('POST', '/api/breed/use', { idempotencyKey: 'bs' + Date.now() }, H)).status, 200);
  // 客戶端在存檔之前送出 c:breed / c:sell_fish（SDK 存檔前會先 flush 事件佇列）
  sdk.track('breed', { a: 'goldfish', b: 'goldfish', child: 'platinumarowana', kind: 'mutation' });
  sdk.track('sell_fish', { sp: 'platinumarowana', v: 6000 });
  await sleep(2100);
  const good = clone(s0); good.coins = 7000; good.last = Date.now();
  const r1 = await sdk.writeSave(good); assert.ok(r1.ok, JSON.stringify(r1)); assert.ok(!r1.flagged, JSON.stringify(r1.flagged));
});
