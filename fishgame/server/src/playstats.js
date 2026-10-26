'use strict';
const { providerInSql, REAL_MONEY_PROVIDERS } = require('./money');
// v4.0.6 玩家遊玩時間與紀錄（後台玩家頁）
// 儲存：每位玩家「每個台北日」一列（遊玩毫秒、場次、存檔金幣收支、伺服器發放金幣）＋ players.device（粗略裝置：iPhone／Android／PC＋瀏覽器；不存 IP）
// 遊玩時間來源：心跳（遊戲畫面在前景時每 30 秒一次；兩次心跳間隔 > 2 分鐘就算新的一場）
// 回補：第一次啟動時用既有 game_sessions 回補每日遊玩時間與場次（資料從 game_sessions 最早一筆開始）
const DAY_MS = 86400000;

function migrate(db, dayFn) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_daily (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    play_ms INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    coins_earned REAL NOT NULL DEFAULT 0,
    coins_spent REAL NOT NULL DEFAULT 0,
    coins_granted REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, day)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_player_daily_day ON player_daily(day);
  CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT);`);
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  if (!cols.includes('device')) db.exec("ALTER TABLE players ADD COLUMN device TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('device_at')) db.exec('ALTER TABLE players ADD COLUMN device_at INTEGER');
  if (!db.prepare("SELECT v FROM app_meta WHERE k='playstats_backfill'").get()) backfill(db, dayFn);
}

// 下一個「當地午夜」（dayFn 換日的那一毫秒）
function nextMidnight(dayFn, t) {
  const d = dayFn(t); let lo = t, hi = t + 26 * 3600000;
  if (dayFn(hi) === d) return hi;
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (dayFn(m) === d) lo = m; else hi = m; }
  return hi;
}
// 把一段 [a, b) 依台北日切開
function splitDays(dayFn, a, b) {
  const out = []; let s = a;
  while (s < b) { const e = Math.min(b, nextMidnight(dayFn, s)); out.push([dayFn(s), e - s]); if (e <= s) break; s = e; }
  return out;
}

function backfill(db, dayFn) {
  const run = db.transaction(() => {
    const up = db.prepare(`INSERT INTO player_daily (player_id, day, play_ms, sessions) VALUES (?,?,?,?)
      ON CONFLICT(player_id, day) DO UPDATE SET play_ms=play_ms+excluded.play_ms, sessions=sessions+excluded.sessions`);
    let n = 0, first = null;
    for (const s of db.prepare('SELECT player_id, started_at, last_beat FROM game_sessions ORDER BY id').all()) {
      if (first == null || s.started_at < first) first = s.started_at;
      up.run(s.player_id, dayFn(s.started_at), 0, 1);
      if (s.last_beat > s.started_at) for (const [d, ms] of splitDays(dayFn, s.started_at, s.last_beat)) up.run(s.player_id, d, ms, 0);
      n++;
    }
    db.prepare("INSERT OR REPLACE INTO app_meta (k, v) VALUES ('playstats_backfill', ?)").run(JSON.stringify({ at: Date.now(), sessions: n, since: first }));
    return n;
  });
  return run();
}

// 粗略裝置（不存完整 UA、不存 IP）
function coarseDevice(ua) {
  ua = String(ua || ''); if (!ua) return '';
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'PC（Windows）' : /CrOS/.test(ua) ? 'PC（ChromeOS）' : /Macintosh|Mac OS X/.test(ua) ? 'PC（Mac）' : /Linux/.test(ua) ? 'PC（Linux）' : '其他';
  const br = /\bLine\//i.test(ua) ? 'LINE' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : /EdgA?\/|EdgiOS/.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung' : /OPR\/|Opera/.test(ua) ? 'Opera' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '其他瀏覽器';
  return os + ' · ' + br;
}

class PlayStats {
  constructor(db, dayFn) { this.db = db; this.day = dayFn; }
  // 心跳：continuing = 同一場（距上次心跳 ≤ 2 分鐘）→ 加上間隔；否則場次 +1
  beat(pid, t, gapMs, isNew, ua) {
    const d = this.day(t);
    this.db.prepare(`INSERT INTO player_daily (player_id, day, play_ms, sessions) VALUES (?,?,?,?)
      ON CONFLICT(player_id, day) DO UPDATE SET play_ms=play_ms+excluded.play_ms, sessions=sessions+excluded.sessions`).run(pid, d, isNew ? 0 : Math.max(0, Math.min(gapMs, 120000)), isNew ? 1 : 0);
    if (ua != null) { const dev = coarseDevice(ua); if (dev) this.db.prepare('UPDATE players SET device=?, device_at=? WHERE id=? AND (device<>? OR device_at IS NULL OR device_at<?)').run(dev, t, pid, dev, t - 3600000); }
  }
  coins(pid, t, earned, spent, granted) {
    if (!pid || !(earned || spent || granted)) return;
    this.db.prepare(`INSERT INTO player_daily (player_id, day, coins_earned, coins_spent, coins_granted) VALUES (?,?,?,?,?)
      ON CONFLICT(player_id, day) DO UPDATE SET coins_earned=coins_earned+excluded.coins_earned, coins_spent=coins_spent+excluded.coins_spent, coins_granted=coins_granted+excluded.coins_granted`)
      .run(pid, this.day(t), earned || 0, spent || 0, granted || 0);
  }
  meta() { try { return JSON.parse((this.db.prepare("SELECT v FROM app_meta WHERE k='playstats_backfill'").get() || {}).v || 'null'); } catch (e) { return null; } }

  summary(pid, cfg, now = Date.now()) {
    const db = this.db, day = this.day;
    const keys = (n) => { const out = []; let t = now; for (let i = 0; i < n; i++) { out.unshift(day(t)); t -= DAY_MS; } return [...new Set(out)]; };
    const rows = db.prepare('SELECT day, play_ms, sessions, coins_earned, coins_spent, coins_granted FROM player_daily WHERE player_id=? ORDER BY day').all(pid);
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
    const sumMs = (ks) => ks.reduce((a, k) => a + ((byDay[k] && byDay[k].play_ms) || 0), 0);
    const k30 = keys(30), k14 = k30.slice(-14), k7 = k30.slice(-7);
    const tot = rows.reduce((a, r) => { a.ms += r.play_ms; a.sessions += r.sessions; a.earned += r.coins_earned; a.spent += r.coins_spent; a.granted += r.coins_granted; return a; }, { ms: 0, sessions: 0, earned: 0, spent: 0, granted: 0 });
    const gs = db.prepare('SELECT COUNT(*) n, MIN(started_at) first, MAX(last_beat) last, SUM(CASE WHEN last_beat>started_at THEN last_beat-started_at ELSE 0 END) span FROM game_sessions WHERE player_id=?').get(pid);
    const p = db.prepare('SELECT created_at, last_seen, device, device_at FROM players WHERE id=?').get(pid) || {};
    const daysActive = db.prepare('SELECT COUNT(*) n FROM daily_active WHERE player_id=?').get(pid).n;
    // 事件統計（全部歷史）
    const cnt = Object.fromEntries(db.prepare('SELECT type, COUNT(*) n FROM events WHERE player_id=? GROUP BY type').all(pid).map((r) => [r.type, r.n]));
    const c = (t) => cnt[t] || 0;
    const bred = {}; for (const r of db.prepare("SELECT COALESCE(json_extract(data,'$.kind'),'parent') k, COUNT(*) n FROM events WHERE player_id=? AND type='c:breed' GROUP BY k").all(pid)) bred[r.k] = r.n;
    if (c('c:xbreed')) bred.cross = (bred.cross || 0) + c('c:xbreed');
    const shopCoins = db.prepare("SELECT COALESCE(SUM(CAST(json_extract(data,'$.coins') AS REAL)),0) s FROM events WHERE player_id=? AND type LIKE 'c:%' AND json_valid(data) AND json_extract(data,'$.coins') > 0").get(pid).s;
    const soldCoins = db.prepare("SELECT COALESCE(SUM(CAST(json_extract(data,'$.v') AS REAL)),0) s FROM events WHERE player_id=? AND type='c:sell_fish' AND json_valid(data)").get(pid).s;
    const rewardCoins = db.prepare('SELECT COALESCE(SUM(r.coins),0) s, COUNT(*) n FROM reward_claims c JOIN rewards r ON r.id=c.reward_id WHERE c.player_id=?').get(pid);
    const gem = db.prepare("SELECT COALESCE(SUM(CASE WHEN delta<0 AND reason IN ('spend') THEN -delta ELSE 0 END),0) spent, COALESCE(SUM(CASE WHEN delta>0 AND reason='purchase' THEN delta ELSE 0 END),0) bought, COALESCE(SUM(CASE WHEN delta>0 AND reason NOT IN ('purchase','refund') THEN delta ELSE 0 END),0) granted FROM gem_ledger WHERE player_id=?").get(pid);
    // 儲值＝只算真實金流（綠界／藍新…）已付款且未退款；寶石購買（provider='gems'）另計，不算 NT$
    const ord = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) twd FROM orders WHERE player_id=? AND status='paid' AND currency='TWD' AND ${providerInSql(this.realProviders || REAL_MONEY_PROVIDERS)}`).get(pid);
    const gemOrd = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) gems FROM orders WHERE player_id=? AND status='paid' AND provider='gems'").get(pid);
    const harbor = { helps: c('social_help'), breeds: c('social_breed'), visits: c('c:visit') };
    try { harbor.helpsGot = db.prepare('SELECT COUNT(*) n FROM social_helps WHERE owner_id=?').get(pid).n; } catch (e) { /* 舊表結構 */ }
    let save = null; try { const r = db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid); save = r ? JSON.parse(r.data) : null; } catch (e) { save = null; }
    const T = (cfg && cfg.mechanics && cfg.mechanics.progression && cfg.mechanics.progression.foundThresholds) || [0];
    const found = save && save.found ? Object.keys(save.found).length : 0; let level = 1; T.forEach((x, i) => { if (found >= x) level = i + 1; });
    let tank = null;
    if (save && cfg && cfg.capacity) { try { const ac = require('./anticheat'); const capLv = (save.up && save.up.cap) || 0; tank = { capLv, cap: Math.round(ac.capacityOf(cfg, capLv, save) * 10) / 10, used: Math.round(ac.usedSpaceOf(cfg, save.fish || []) * 10) / 10, fish: (save.fish || []).length, unit: cfg.capacity.unit || 'count' }; } catch (e) { tank = { capLv: (save.up && save.up.cap) || 0, fish: (save.fish || []).length }; } }
    const meta = this.meta();
    return {
      dataSince: meta && meta.since ? Math.min(meta.since, gs.first || meta.since) : gs.first || null,
      trackedSince: meta ? meta.at : null,
      play: { totalMs: tot.ms, todayMs: sumMs([day(now)]), d7Ms: sumMs(k7), d30Ms: sumMs(k30), sessions: gs.n, avgSessionMs: gs.n ? Math.round(gs.span / gs.n) : 0, daily14: k14.map((k) => ({ day: k, ms: (byDay[k] && byDay[k].play_ms) || 0, sessions: (byDay[k] && byDay[k].sessions) || 0 })) },
      firstPlay: gs.first || null, created: p.created_at || null, lastSeen: p.last_seen || null, daysActive, device: p.device || '', deviceAt: p.device_at || null,
      coins: { earned: Math.round(tot.earned), spent: Math.round(tot.spent), grantedServer: Math.round(tot.granted), granted: Math.round(rewardCoins.s), rewardsClaimed: rewardCoins.n, shopSpent: Math.round(shopCoins), soldFor: Math.round(soldCoins) },
      gems: { spent: gem.spent, bought: gem.bought, granted: gem.granted },
      fish: { bought: c('c:buy_fish'), boughtPremium: c('c:buy_premium'), sold: c('c:sell_fish'), bred, bredTotal: Object.values(bred).reduce((a, b) => a + b, 0), evolved: c('c:evolve'), died: c('c:fish_died') },
      care: { waterChanges: c('c:water_change'), siphon: c('c:siphon'), bacteria: c('c:bacteria'), medUsed: c('c:use_med'), medBought: c('c:buy_med') },
      harbor, purchases: { count: ord.n, twd: ord.twd, gemCount: gemOrd.n, gems: gemOrd.gems },
      level, found, tank, eventTypes: Object.entries(cnt).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
    };
  }
}

module.exports = { migrate, PlayStats, coarseDevice, splitDays, nextMidnight };
