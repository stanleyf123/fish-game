'use strict';
/**
 * COINSINK-B2 日產量追蹤（伺服器端，台北時間 UTC+8 日）
 *
 * DB table: player_production_daily
 *   player_id  TEXT NOT NULL,
 *   day_key    TEXT NOT NULL,   -- floor((nowMs + 8h) / 86400000) as text
 *   produced   INTEGER NOT NULL DEFAULT 0,
 *   PRIMARY KEY (player_id, day_key)
 *
 * 只有魚兒直接掉落的金幣計入（settle / anticheat 收益）。
 * IAP、商店購買、任務獎勵、郵件、補償、管理員贈與一律不計。
 */

const TZ_OFFSET_MS = 8 * 3600 * 1000; // UTC+8 台北時間偏移

/** 取得台北時間日 key（整數轉為字串） */
function taipeiDayKey(nowMs) {
  return String(Math.floor((nowMs + TZ_OFFSET_MS) / 86400000));
}

/**
 * 查詢玩家今日剩餘生產額度。
 * @param {object} db - 支援 .get(sql, params) 與 .run(sql, params) 的 SQLite-like 介面
 * @param {string} pid - 玩家 ID
 * @param {object} cfg - 遊戲設定（cfg.coins.dailyCapPerPlayer）
 * @param {number} nowMs - 目前時間戳（ms）
 * @returns {number} 今日剩餘可生產金幣數（≥0）
 */
function remaining(db, pid, cfg, nowMs) {
  const cap = (cfg.coins && cfg.coins.dailyCapPerPlayer) || 250000;
  const day = taipeiDayKey(nowMs);
  const row = db.get(
    'SELECT produced FROM player_production_daily WHERE player_id=? AND day_key=?',
    [pid, day]
  );
  const produced = row ? (row.produced | 0) : 0;
  return Math.max(0, cap - produced);
}

/**
 * 消耗玩家今日生產額度，回傳實際入帳金額（≤ amount，≤ remaining）。
 * @param {object} db
 * @param {string} pid
 * @param {number} amount - 要記帳的金幣數（正整數）
 * @param {object} cfg
 * @param {number} nowMs
 * @returns {number} 實際入帳金額
 */
function consume(db, pid, amount, cfg, nowMs) {
  const rem = remaining(db, pid, cfg, nowMs);
  const actual = Math.min(amount, rem);
  if (actual <= 0) return 0;
  const day = taipeiDayKey(nowMs);
  db.run(
    `INSERT INTO player_production_daily (player_id, day_key, produced)
     VALUES (?, ?, ?)
     ON CONFLICT(player_id, day_key) DO UPDATE SET produced = produced + excluded.produced`,
    [pid, day, actual]
  );
  return actual;
}

/**
 * 建立 DB table（若不存在）。伺服器啟動時呼叫一次。
 */
function createTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS player_production_daily (
    player_id TEXT NOT NULL,
    day_key   TEXT NOT NULL,
    produced  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, day_key)
  )`);
}

module.exports = { taipeiDayKey, remaining, consume, createTable };
