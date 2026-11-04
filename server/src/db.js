'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config_versions (
  version INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  rollback_of INTEGER
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  device_hash TEXT UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  email TEXT,
  bound_at INTEGER,
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  banned_at INTEGER,
  ban_reason TEXT,
  flags INTEGER NOT NULL DEFAULT 0,
  gems INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
CREATE TABLE IF NOT EXISTS player_tokens (
  token_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_player ON player_tokens(player_id);
CREATE TABLE IF NOT EXISTS saves (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL,
  coins REAL NOT NULL DEFAULT 0,
  fish_count INTEGER NOT NULL DEFAULT 0,
  found_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  client_saved_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS player_species (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sp TEXT NOT NULL,
  owned INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, sp)
);
CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  last_beat INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON game_sessions(player_id, last_beat);
CREATE INDEX IF NOT EXISTS idx_sessions_beat ON game_sessions(last_beat);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON game_sessions(started_at);
CREATE TABLE IF NOT EXISTS daily_active (
  day TEXT NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (day, player_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
CREATE TABLE IF NOT EXISTS economy_daily (
  day TEXT PRIMARY KEY,
  earned REAL NOT NULL DEFAULT 0,
  spent REAL NOT NULL DEFAULT 0,
  granted REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  starts_at INTEGER,
  ends_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  coins INTEGER NOT NULL DEFAULT 0,
  gems INTEGER NOT NULL DEFAULT 0,
  fish TEXT NOT NULL DEFAULT '[]',
  items TEXT NOT NULL DEFAULT '[]',
  target TEXT NOT NULL,
  filter TEXT,
  include_new INTEGER NOT NULL DEFAULT 0,
  order_id TEXT,
  recipients INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reward_targets (
  reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (reward_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_reward_targets_player ON reward_targets(player_id);
CREATE TABLE IF NOT EXISTS reward_claims (
  reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (reward_id, player_id)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
-- ===== 付費／會員（商業模式預備） =====
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,              -- gems / vip / item / bundle
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_twd INTEGER,               -- 現金價（新台幣，整數元）；NULL 代表不能用現金買
  price_gems INTEGER,              -- 寶石價；NULL 代表不能用寶石買
  grants TEXT NOT NULL DEFAULT '{}',
  limit_per_player INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  status TEXT NOT NULL,            -- pending / paid / failed / refunded / canceled
  provider TEXT NOT NULL,          -- mock / ecpay / stripe / admin / gems
  provider_txn_id TEXT,
  idempotency_key TEXT,
  grants TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER,
  UNIQUE (player_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_player ON orders(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_paid ON orders(paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_txn ON orders(provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id TEXT,
  type TEXT,
  payload TEXT,
  result TEXT,
  received_at INTEGER NOT NULL,
  UNIQUE (provider, event_id)
);
CREATE TABLE IF NOT EXISTS gem_ledger (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,            -- purchase / refund / admin_grant / admin_revoke / spend / vip_daily
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gem_ledger_player ON gem_ledger(player_id, id);
CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- vip / no_ads / starter / item
  key TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,              -- NULL = 永久
  perks TEXT NOT NULL DEFAULT '{}',
  order_id TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ent_player ON entitlements(player_id, kind);
CREATE TABLE IF NOT EXISTS vip_daily_claims (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  PRIMARY KEY (player_id, day)
);
`;

function openDb(dataDir) {
  let file;
  if (dataDir === ':memory:') file = ':memory:';
  else {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'fishgame.sqlite');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  // 輕量遷移：舊資料庫補欄位
  const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
  if (!cols.has('email')) db.exec('ALTER TABLE players ADD COLUMN email TEXT');
  if (!cols.has('bound_at')) db.exec('ALTER TABLE players ADD COLUMN bound_at INTEGER');
  // 會員帳號＝信箱：信箱不分大小寫唯一（舊資料若有重複信箱，索引建立失敗時只記錄警告，不影響啟動）
  if (!cols.has('email_verified_at')) db.exec('ALTER TABLE players ADD COLUMN email_verified_at INTEGER');
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email COLLATE NOCASE) WHERE email IS NOT NULL'); }
  catch (e) { console.warn('[db] 無法建立信箱唯一索引（可能有重複信箱）：', e.message); }
  require('./hero/migration').migrate(db);
  return db;
}

module.exports = { openDb };
