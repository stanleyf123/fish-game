'use strict';
// 公平係數：等級區間、SQLite 持久化（重開機不重算）、設定變更自動失效
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const ab = require('../src/hero/autobalance');
const S = require('../src/hero/stats');
const { HERO_DEFAULT_CONFIG } = require('../src/hero/default-config');
const gameCfg = require('../seed/default-config.json');

test('公平係數：等級區間對應、持久化後重算不必重跑、設定一改就失效', { timeout: 180000 }, () => {
  const H = JSON.parse(JSON.stringify(HERO_DEFAULT_CONFIG));
  assert.equal(ab.bracketLevel(H, 1), 1); assert.equal(ab.bracketLevel(H, 2), 1); assert.equal(ab.bracketLevel(H, 7), 3);
  assert.equal(ab.bracketLevel(H, 14), 8); assert.equal(ab.bracketLevel(H, 50), 30);
  const db = new Database(':memory:');
  require('../src/hero/migration').migrate(db);
  ab.setStore(db); ab.clearCache();
  const hero = { species: 'redpiranha', growth: 999, level: 2, train: {}, gear: {}, skills: {} };
  const f1 = S.finalStats(H, gameCfg, hero).base.fair;
  assert.ok(f1 >= H.autoBalance.min && f1 <= H.autoBalance.max);
  const n = db.prepare('SELECT COUNT(*) n FROM hero_fair').get().n;
  assert.ok(n > 10, '參考對手群＋魚種倍率都存入 hero_fair');
  // 模擬重開機：清掉記憶體快取，改由資料庫讀取 → 很快且結果相同
  ab.clearCache();
  const t = Date.now();
  const f2 = S.finalStats(H, gameCfg, { ...hero, level: 1 }).base.fair;
  assert.equal(f2, f1, '同一區間（Lv1–2）共用倍率');
  assert.ok(Date.now() - t < 1500, '從資料庫讀取，不需重新校正：' + (Date.now() - t) + 'ms');
  // 設定改變 → 雜湊不同 → 不會誤用舊倍率
  const H2 = JSON.parse(JSON.stringify(H)); H2.battle.variance = 0.2;
  assert.notEqual(ab.cfgHash(H2, gameCfg), ab.cfgHash(H, gameCfg));
  ab.setStore(new Database(':memory:')); ab.clearCache();
});

test('背景預先計算（worker）：結果交給主執行緒寫入，和遊戲交易同時進行不會鎖住資料庫', { timeout: 180000 }, async (t) => {
  const { startHeroServer, fishOf } = require('./hero-helpers');
  const srv = await startHeroServer({ HERO_WARMUP: '1', HERO_FAIR_FILE: '/nonexistent/hero-fair.json' });   // 不匯入預先計算檔，才測得到 worker
  t.after(async () => { if (srv.hero.warm && srv.hero.warm.worker) await srv.hero.warm.worker.terminate(); await srv.stop(); });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(srv.hero.warmupStatus(), 'worker 已啟動');
  const p = await srv.player({ coins: 99999, fish: [fishOf('w1', 'goldfish')] });
  assert.equal((await p.call('POST', '/api/hero/pick', { fishId: 'w1' })).status, 200);
  const count = () => srv.ctx.db.prepare('SELECT COUNT(*) n FROM hero_fair').get().n;
  const n0 = count();
  // worker 寫入的同時不斷做會寫存檔的交易
  const deadline = Date.now() + 60000;
  let ops = 0;
  while (Date.now() < deadline && count() <= n0 + 40) {
    srv.ctx.db.prepare("UPDATE heroes SET train_ready='{}', train='{}' WHERE player_id=?").run(p.id);
    const r = await p.call('POST', '/api/hero/train', { type: ['hp', 'atk', 'def', 'spd'][ops % 4] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const g = await p.call('GET', '/api/hero/me'); assert.equal(g.status, 200);
    ops++;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.ok(count() > n0 + 40, `worker 結果已寫入 hero_fair（${n0} → ${count()}，期間 ${ops} 次訓練交易）`);
  assert.equal(srv.hero.warmupStatus().error, null);
});

test('預先計算的公平係數（seed/hero-fair.json）開機時匯入，預設設定不需要冷啟動計算', { timeout: 60000 }, async (t) => {
  const { startHeroServer } = require('./hero-helpers');
  const srv = await startHeroServer({ HERO_WARMUP: '1' });
  t.after(async () => { if (srv.hero.warm && srv.hero.warm.worker) await srv.hero.warm.worker.terminate(); await srv.stop(); });
  const rows = Object.keys(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'seed', 'hero-fair.json'), 'utf8')).rows).length;
  assert.ok(srv.ctx.db.prepare('SELECT COUNT(*) n FROM hero_fair').get().n >= rows);
  const t0 = Date.now();
  while (!(srv.hero.warmupStatus() || {}).finished && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  const w = srv.hero.warmupStatus();
  assert.ok(w.finished && !w.error, JSON.stringify(w));
  assert.ok(Date.now() - t0 < 5000, `預熱應該幾乎立即完成（${Date.now() - t0}ms）—若改了魚種或英雄設定，請重新執行 node scripts/hero-precompute.js`);
});

test('部署用的 public/hero.js 與 hero/hero.js 一致（/sdk/hero.js）', () => {
  const fs = require('fs'), path = require('path');
  const a = path.join(__dirname, '..', 'public', 'hero.js'), b = path.join(__dirname, '..', '..', 'hero', 'hero.js');
  if (!fs.existsSync(b)) return;   // 部署環境只有 public/hero.js
  assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'), '請重跑 species/build-v4.sh');
});
