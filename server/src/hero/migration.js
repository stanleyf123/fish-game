'use strict';
// 英雄魚資料表（冪等：CREATE IF NOT EXISTS；可重複執行）。整合時在 db.js openDb() 最後呼叫 migrate(db)。
const HERO_SCHEMA = `
CREATE TABLE IF NOT EXISTS hero_config_versions (
  version INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  rollback_of INTEGER
);
CREATE TABLE IF NOT EXISTS heroes (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  fish_id TEXT NOT NULL,
  species TEXT NOT NULL,
  fish_name TEXT NOT NULL DEFAULT '',
  hue REAL,
  growth REAL NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  train TEXT NOT NULL DEFAULT '{}',          -- 訓練點 {hp,atk,def,spd,crit}
  train_ready TEXT NOT NULL DEFAULT '{}',    -- 各訓練下次可用時間 {type: ms}
  skills TEXT NOT NULL DEFAULT '{}',         -- {ranks:{id:rank}, slots:[id]}
  gear TEXT NOT NULL DEFAULT '{}',           -- {owned:{id:1}, equip:{slot:id}}
  rating INTEGER NOT NULL DEFAULT 1000,
  peak_rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  def_wins INTEGER NOT NULL DEFAULT 0,
  def_losses INTEGER NOT NULL DEFAULT 0,
  season_battles INTEGER NOT NULL DEFAULT 0,
  tickets INTEGER NOT NULL DEFAULT 8,
  tickets_at INTEGER NOT NULL DEFAULT 0,
  changes INTEGER NOT NULL DEFAULT 0,
  changed_at INTEGER,
  last_refresh INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,         -- 0：英雄魚已不在魚缸（賣掉／死亡），需重新選擇
  pvp_banned_at INTEGER,
  pvp_ban_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heroes_rating ON heroes(rating);
CREATE TABLE IF NOT EXISTS hero_battles (
  id INTEGER PRIMARY KEY,
  season_id INTEGER,
  attacker_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  defender_id INTEGER,                       -- NULL：練習對手（NPC）
  npc TEXT,
  seed INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  winner INTEGER NOT NULL,                   -- 0 進攻方勝 / 1 防守方勝
  reason TEXT NOT NULL,
  actions INTEGER NOT NULL,
  a_rating INTEGER, a_delta INTEGER NOT NULL DEFAULT 0,
  d_rating INTEGER, d_delta INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  a_snap TEXT NOT NULL,
  d_snap TEXT NOT NULL,
  log TEXT NOT NULL,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hb_attacker ON hero_battles(attacker_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hb_defender ON hero_battles(defender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hb_created ON hero_battles(created_at);
CREATE TABLE IF NOT EXISTS hero_offers (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  opponent_key TEXT NOT NULL,                -- 'p:<playerId>' 或 'npc:<seed>'
  data TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, opponent_key)
);
CREATE TABLE IF NOT EXISTS hero_purchases (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- gear / skill_rank / train / change
  item TEXT NOT NULL,
  currency TEXT NOT NULL,                    -- coins / gems
  amount INTEGER NOT NULL,
  order_id TEXT,
  idem TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idem)
);
CREATE INDEX IF NOT EXISTS idx_hp_player ON hero_purchases(player_id, created_at);
CREATE TABLE IF NOT EXISTS hero_fair (       -- 自動公平校正結果快取（key 含設定雜湊）
  k TEXT PRIMARY KEY,
  m REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hero_seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at INTEGER,
  closed_at INTEGER,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS hero_season_results (
  season_id INTEGER NOT NULL REFERENCES hero_seasons(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  rank_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  battles INTEGER NOT NULL,
  reward_id INTEGER,
  PRIMARY KEY (season_id, player_id)
);
`;

function migrate(db) {
  db.exec(HERO_SCHEMA);
  if (!db.prepare('SELECT COUNT(*) n FROM hero_seasons').get().n) db.prepare('INSERT INTO hero_seasons (name, started_at) VALUES (?, ?)').run('第 1 季', Date.now());
  return true;
}

module.exports = { migrate, HERO_SCHEMA };
