'use strict';
const { providerInSql, REAL_MONEY_PROVIDERS } = require('./money');
// 後台儀表板統計。日期一律以 TZ（預設 Asia/Taipei）切日。
class Stats {
  constructor(db, configStore, dayFn) { this.db = db; this.cfg = configStore; this.day = dayFn; }

  dayKeys(days, t = Date.now()) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(this.day(t - i * 86400000));
    return [...new Set(out)];
  }

  bucket(rows, field, days, valueFn = () => 1) {
    const keys = this.dayKeys(days); const m = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const r of rows) { const k = this.day(r[field]); if (k in m) m[k] += valueFn(r); }
    return keys.map((k) => ({ day: k, value: m[k] }));
  }

  dashboard(days = 30) {
    const db = this.db, t = Date.now(), since = t - days * 86400000;
    const keys = this.dayKeys(days);
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const totalPlayers = one('SELECT COUNT(*) n FROM players').n;
    const demoPlayers = one('SELECT COUNT(*) n FROM players WHERE is_demo=1').n;
    const boundPlayers = one('SELECT COUNT(*) n FROM players WHERE username IS NOT NULL').n;
    const banned = one('SELECT COUNT(*) n FROM players WHERE banned_at IS NOT NULL').n;
    const flagged = one('SELECT COUNT(*) n FROM players WHERE flags > 0').n;
    const today = this.day(t);
    const dauRows = db.prepare('SELECT day, COUNT(*) n FROM daily_active WHERE day >= ? GROUP BY day').all(keys[0]);
    const dauMap = Object.fromEntries(dauRows.map((r) => [r.day, r.n]));
    const dau = keys.map((k) => ({ day: k, value: dauMap[k] || 0 }));
    const last7 = this.dayKeys(7), last30 = this.dayKeys(30);
    const wau = one('SELECT COUNT(DISTINCT player_id) n FROM daily_active WHERE day >= ?', last7[0]).n;
    const mau = one('SELECT COUNT(DISTINCT player_id) n FROM daily_active WHERE day >= ?', last30[0]).n;
    const newPlayers = this.bucket(db.prepare('SELECT created_at FROM players WHERE created_at >= ?').all(since - 86400000), 'created_at', days);
    const onlineNow = one('SELECT COUNT(DISTINCT player_id) n FROM game_sessions WHERE last_beat >= ?', t - 90000).n;
    const sess = one('SELECT COUNT(*) n, AVG(last_beat - started_at) avg FROM game_sessions WHERE started_at >= ? AND last_beat > started_at', t - 7 * 86400000);
    const sessionSeries = (() => {
      const rows = db.prepare('SELECT started_at, last_beat FROM game_sessions WHERE started_at >= ?').all(since - 86400000);
      const sum = {}, cnt = {};
      for (const r of rows) { const k = this.day(r.started_at); sum[k] = (sum[k] || 0) + (r.last_beat - r.started_at); cnt[k] = (cnt[k] || 0) + 1; }
      return keys.map((k) => ({ day: k, value: cnt[k] ? Math.round(sum[k] / cnt[k] / 60000 * 10) / 10 : 0 }));
    })();
    const coins = one('SELECT COUNT(*) saves, COALESCE(SUM(coins),0) total, COALESCE(AVG(coins),0) avg, COALESCE(MAX(coins),0) max FROM saves');
    const coinBuckets = [[0, 100], [100, 500], [500, 2000], [2000, 10000], [10000, 50000], [50000, 1e15]].map(([a, b]) => ({ label: b >= 1e15 ? `${a.toLocaleString()}+` : `${a.toLocaleString()}–${b.toLocaleString()}`, value: one('SELECT COUNT(*) n FROM saves WHERE coins >= ? AND coins < ?', a, b).n }));
    const econRows = db.prepare('SELECT * FROM economy_daily WHERE day >= ?').all(keys[0]);
    const econMap = Object.fromEntries(econRows.map((r) => [r.day, r]));
    const economy = keys.map((k) => ({ day: k, earned: Math.round(econMap[k]?.earned || 0), spent: Math.round(econMap[k]?.spent || 0), granted: Math.round(econMap[k]?.granted || 0) }));
    const cfg = this.cfg.active().config;
    const spName = (k) => (cfg.species[k] ? cfg.species[k].name : k);
    const ownership = db.prepare('SELECT sp, SUM(owned) owned, COUNT(DISTINCT CASE WHEN owned>0 THEN player_id END) owners FROM player_species GROUP BY sp ORDER BY owned DESC').all()
      .map((r) => ({ key: r.sp, name: spName(r.sp), rarity: cfg.species[r.sp]?.rarity ?? 0, owned: r.owned, owners: r.owners }));
    const saveCount = coins.saves || 1;
    const discovered = db.prepare('SELECT sp, COUNT(*) n FROM player_species WHERE found=1 GROUP BY sp ORDER BY n DESC').all()
      .map((r) => ({ key: r.sp, name: spName(r.sp), rarity: cfg.species[r.sp]?.rarity ?? 0, players: r.n, pct: Math.round(r.n / saveCount * 1000) / 10 }));
    const topEvents = db.prepare('SELECT type, COUNT(*) n FROM events WHERE created_at >= ? GROUP BY type ORDER BY n DESC LIMIT 12').all(t - 7 * 86400000);
    return {
      generatedAt: t, days, today,
      totals: { totalPlayers, demoPlayers, boundPlayers, banned, flagged, dauToday: dauMap[today] || 0, wau, mau, onlineNow, avgSessionMin: sess.avg ? Math.round(sess.avg / 6000) / 10 : 0, sessions7d: sess.n,
        coinsTotal: Math.round(coins.total), coinsAvg: Math.round(coins.avg), coinsMax: Math.round(coins.max), saves: coins.saves },
      dau, newPlayers, sessionSeries, economy, coinBuckets, ownership, discovered, topEvents,
    };
  }

  revenue(days = 30, { excludeDemo = false } = {}) {
    const db = this.db, t = Date.now(), since = t - days * 86400000;
    const keys = this.dayKeys(days);
    const demo = excludeDemo ? 'AND p.is_demo=0' : '';
    const realProv = providerInSql(this.realProviders || REAL_MONEY_PROVIDERS, 'o.provider');   // 只算真實金流（排除 gems／admin／mock）
    const paid = db.prepare(`SELECT o.* FROM orders o JOIN players p ON p.id=o.player_id WHERE o.currency='TWD' AND ${realProv} AND o.paid_at >= ? AND o.status IN ('paid','refunded') ${demo}`).all(since - 86400000);
    const refunds = db.prepare(`SELECT o.* FROM orders o JOIN players p ON p.id=o.player_id WHERE o.currency='TWD' AND ${realProv} AND o.status='refunded' AND o.refunded_at >= ? ${demo}`).all(since - 86400000);
    const gross = {}, ref = {}, cnt = {};
    for (const o of paid) { const k = this.day(o.paid_at); gross[k] = (gross[k] || 0) + o.amount; cnt[k] = (cnt[k] || 0) + 1; }
    for (const o of refunds) { const k = this.day(o.refunded_at); ref[k] = (ref[k] || 0) + o.amount; }
    const daily = keys.map((k) => ({ day: k, gross: gross[k] || 0, refunds: ref[k] || 0, net: (gross[k] || 0) - (ref[k] || 0), orders: cnt[k] || 0 }));
    const inRange = paid.filter((o) => o.paid_at >= since);
    const grossTotal = inRange.reduce((a, o) => a + o.amount, 0);
    const refundTotal = refunds.filter((o) => o.refunded_at >= since).reduce((a, o) => a + o.amount, 0);
    const net = grossTotal - refundTotal;
    const payers = new Set(inRange.filter((o) => o.status === 'paid').map((o) => o.player_id));
    const active = db.prepare(`SELECT COUNT(DISTINCT d.player_id) n FROM daily_active d JOIN players p ON p.id=d.player_id WHERE d.day >= ? ${demo}`).get(keys[0]).n;
    const statusCounts = db.prepare(`SELECT o.status, COUNT(*) n FROM orders o JOIN players p ON p.id=o.player_id WHERE o.created_at >= ? AND o.currency='TWD' AND ${realProv} ${demo} GROUP BY o.status`).all(since);
    const topProducts = db.prepare(`SELECT o.sku, o.product_name name, COUNT(*) n, SUM(o.amount) amount FROM orders o JOIN players p ON p.id=o.player_id WHERE o.status='paid' AND o.currency='TWD' AND ${realProv} AND o.paid_at >= ? ${demo} GROUP BY o.sku ORDER BY amount DESC LIMIT 10`).all(since);
    const vipActive = db.prepare(`SELECT COUNT(DISTINCT e.player_id) n FROM entitlements e JOIN players p ON p.id=e.player_id WHERE e.kind='vip' AND e.revoked_at IS NULL AND e.expires_at > ? ${demo}`).get(t).n;
    const gemsOutstanding = db.prepare(`SELECT COALESCE(SUM(gems),0) n FROM players p WHERE 1=1 ${demo}`).get().n;
    return {
      days, daily,
      totals: { gross: grossTotal, refunds: refundTotal, net, orders: inRange.length, payingUsers: payers.size, activeUsers: active,
        arppu: payers.size ? Math.round(net / payers.size) : 0, arpu: active ? Math.round(net / active * 10) / 10 : 0,
        conversion: active ? Math.round(payers.size / active * 1000) / 10 : 0, vipActive, gemsOutstanding },
      statusCounts, topProducts,
    };
  }
}
module.exports = { Stats };
