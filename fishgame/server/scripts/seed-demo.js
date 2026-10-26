#!/usr/bin/env node
// 產生「示範資料」（假玩家、存檔、遊玩紀錄、訂單），用於後台畫面展示與截圖。
// 所有示範玩家 is_demo=1、暱稱以「示範-」開頭；公告/獎勵標題以「【示範】」開頭。
// 清除：npm run demo:clear
'use strict';
require('./load-env');
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'local-dev-only';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-only-secret';
const { createApp } = require('../src/app');
const { ctx, close } = createApp();
const { db, configStore, players, commerce } = ctx;

const N = Number(process.argv[2] || 160);
const DAY = 86400000;
const now = Date.now();
let seed = 20261020;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];

if (db.prepare('SELECT COUNT(*) n FROM players WHERE is_demo=1').get().n) { console.log('已有示範資料，略過（先執行 npm run demo:clear 可重建）'); close(); process.exit(0); }

const cfg = configStore.active().config;
const spKeys = Object.keys(cfg.species);
const weight = (k) => [10, 3, 1][cfg.species[k].rarity] || 1;
const bag = spKeys.flatMap((k) => Array(weight(k)).fill(k));
const capOf = (lv) => cfg.capacity.base + cfg.capacity.upgrades.slice(0, lv).reduce((a, u) => a + u.add, 0);
const NAMES = ['阿魚', '小藍', '泡泡王', '珊瑚', '水草控', '金金', '鯉魚躍', '海星', '小丑', '貓咪愛魚', '夜貓子', '大白', '小雨', '阿寶'];

const tx = db.transaction(() => {
  const ids = [];
  for (let i = 0; i < N; i++) {
    const created = now - Math.floor(Math.pow(rnd(), 0.8) * 45 * DAY);
    const bound = rnd() < .35;
    const id = Number(db.prepare('INSERT INTO players (device_hash, username, nickname, created_at, last_seen, is_demo) VALUES (?,?,?,?,?,1)')
      .run('demo-' + i + '-' + Math.random(), bound ? `demo_${i}` : null, `示範-${pick(NAMES)}${i}`, created, created).lastInsertRowid);
    ids.push(id);
    // 活躍天數：越新的玩家越活躍；部分玩家流失
    const churn = rnd() < .35 ? created + ri(1, 10) * DAY : now;
    let last = created;
    for (let t = created; t <= Math.min(now, churn); t += DAY) {
      if (rnd() < .55 || t === created) {
        const sessions = ri(1, 3);
        for (let s = 0; s < sessions; s++) {
          const start = Math.min(now - 60000, t + ri(0, 20) * 3600e3 * .9);
          if (start < created) continue;
          const dur = ri(2, 45) * 60000;
          const end = Math.min(now, start + dur);
          db.prepare('INSERT INTO game_sessions (player_id, started_at, last_beat) VALUES (?,?,?)').run(id, start, end);
          db.prepare('INSERT OR IGNORE INTO daily_active (day, player_id) VALUES (?,?)').run(players.day(start), id);
          last = Math.max(last, end);
          const earned = Math.round(dur / 1000 * rnd() * 1.2);
          players.econ(start, earned, Math.round(earned * (.5 + rnd() * .45)), 0);
          if (rnd() < .4) players.logEvent(id, pick(['c:breed', 'c:buy_fish', 'c:upgrade', 'c:sell_fish', 'c:collect']), { demo: true }, start + 1000);
        }
      }
    }
    // 目前在線（最近 1 分鐘心跳）
    if (i % 23 === 0) { db.prepare('INSERT INTO game_sessions (player_id, started_at, last_beat) VALUES (?,?,?)').run(id, now - ri(3, 30) * 60000, now - ri(0, 50) * 1000); db.prepare('INSERT OR IGNORE INTO daily_active (day, player_id) VALUES (?,?)').run(players.day(now), id); last = now; }
    db.prepare('UPDATE players SET last_seen=? WHERE id=?').run(last, id);
    // 存檔
    const age = (last - created) / DAY;
    const capLv = Math.min(cfg.capacity.upgrades.length, Math.floor(age / 4 + rnd() * 2));
    const nFish = Math.min(capOf(capLv), ri(2, capOf(capLv)));
    const fish = [];
    const found = {};
    for (let f = 0; f < nFish; f++) { const sp = pick(bag); fish.push({ id: `d${i}f${f}`, sp, name: pick(cfg.names), hue: cfg.species[sp].look.hue, size: 1, growth: ri(0, 220), full: ri(30, 100), health: ri(55, 100), cd: 0, coinT: 10, seed: ri(1, 99999), px: +rnd().toFixed(3), py: +(.2 + rnd() * .6).toFixed(3), dir: rnd() < .5 ? 1 : -1 }); found[sp] = 1; }
    for (const k of spKeys) if (!found[k] && rnd() < .15 * weight(k) / 4) found[k] = 1;
    const decoKeys = Object.keys(cfg.decorations).filter(() => rnd() < Math.min(.8, age / 30));
    const save = { v: cfg.version, coins: Math.round(Math.pow(rnd(), 2) * 20000 * Math.min(3, 1 + age / 10)), fish, up: { cap: capLv, food: Math.min(cfg.food.tiers.length - 1, Math.floor(age / 8)), feeder: Math.min(cfg.feeder.tiers.length - 1, Math.floor(age / 10)), filter: Math.min(cfg.filter.tiers.length - 1, Math.floor(age / 12)), deco: decoKeys }, found,
      water: { dirt: ri(3, 60), waste: ri(0, 20), algae: ri(0, 50), cycle: 100, changeCdH: 0, lastChange: last - ri(1, 48) * 3600000, lastFed: last - ri(1, 12) * 3600000, feederAccH: 0 }, items: { bacteria: ri(0, 2) }, leftover: 0, last, tut: 1 };
    players.writeSaveRow(id, save, ri(5, 400), last, true);
    if (i % 31 === 7) { db.prepare('UPDATE players SET flags=? WHERE id=?').run(ri(1, 4), id); players.logEvent(id, 'anticheat_reject', { reasons: ['金幣增加過快（示範資料）'] }, last); }
    if (i % 53 === 11) db.prepare('UPDATE players SET banned_at=?, ban_reason=? WHERE id=?').run(last, '示範：使用外掛', id);
  }

  // 訂單（模擬金流）：約 9% 付費
  const prod = Object.fromEntries(commerce.listProducts(true).map((p) => [p.sku, p]));
  const cashSkus = ['gems_60', 'gems_60', 'gems_330', 'vip_month', 'vip_month', 'starter_pack', 'gems_1280', 'no_ads'];
  let n = 0;
  for (const id of ids) {
    if (rnd() > .09) continue;
    const p = players.get(id);
    const k = ri(1, 3);
    for (let j = 0; j < k; j++) {
      const sku = pick(cashSkus); const pr = prod[sku]; if (!pr) continue;
      const t = p.created_at + rnd() * (p.last_seen - p.created_at);
      const oid = 'FGDEMO' + (n++).toString(36).toUpperCase().padStart(4, '0');
      const r = rnd(); const status = r < .86 ? 'paid' : r < .95 ? 'failed' : 'refunded';
      db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, provider_txn_id, grants, note, created_at, updated_at, paid_at, refunded_at)
        VALUES (?,?,?,?,?,?,'TWD',?,'mock',?,?,'示範資料',?,?,?,?)`).run(oid, id, pr.id, sku, pr.name, pr.priceTwd, 'pending', 'MOCK-' + oid, JSON.stringify(pr.grants), t, t, null, null);
      if (status === 'failed') { db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(oid); continue; }
      db.prepare("UPDATE orders SET status='paid', paid_at=? WHERE id=?").run(t + 60000, oid);
      commerce.fulfill(commerce.getOrder(oid));
      // fulfill 用現在時間計算月卡，示範資料改成依購買時間
      db.prepare("UPDATE entitlements SET starts_at=?, expires_at=? + (expires_at - starts_at), created_at=? WHERE order_id=? AND kind='vip'").run(t, t, t, oid);
      db.prepare("UPDATE gem_ledger SET created_at=? WHERE ref=?").run(t, 'order:' + oid);
      if (status === 'refunded') { db.prepare("UPDATE orders SET status='refunded', refunded_at=? WHERE id=?").run(t + 2 * DAY, oid); db.prepare('UPDATE entitlements SET revoked_at=? WHERE order_id=?').run(t + 2 * DAY, oid); }
    }
  }
  const t = Date.now();
  db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run('【示範】秋季錦鯉祭開跑！', '活動期間繁殖突變機率提升，快來收集傳說魚種吧！', t - 2 * DAY, t + 12 * DAY, 1, t, t);
  db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run('【示範】10/25 凌晨維護公告', '預計 02:00–03:00 進行伺服器維護。', t + 3 * DAY, t + 5 * DAY, 1, t, t);
  db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run('【示範】開服感謝', '感謝大家的支持！', t - 30 * DAY, t - 20 * DAY, 1, t, t);
  return ids;
});
const ids = tx();
ctx.rewards.create({ title: '【示範】秋季錦鯉祭登入禮', body: '送你 300 金幣與一條錦鯉！', target: 'filter', filter: { includeDemo: true, lastSeenDays: 7 }, coins: 300, fish: [{ species: 'koi', count: 1 }] });
const r2 = ctx.rewards.create({ title: '【示範】維修補償', body: '造成不便敬請見諒', target: 'player', playerIds: ids.slice(0, 5), coins: 1000, gems: 20 });
for (const id of ids.slice(0, 3)) db.prepare('INSERT INTO reward_claims (reward_id, player_id, claimed_at) VALUES (?,?,?)').run(r2.id, id, Date.now());
console.log(`已建立 ${ids.length} 位示範玩家（is_demo=1）與相關遊玩紀錄、訂單、公告、獎勵。`);
close();
