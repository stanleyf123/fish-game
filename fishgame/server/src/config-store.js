'use strict';
const fs = require('fs');
const { validateConfig, publicConfig } = require('./config-validate');
const { HttpError, sha256 } = require('./util');

class ConfigStore {
  constructor(db) { this.db = db; this.cache = null; }

  ensureSeed(seedFile, note = '初始版本：由遊戲 index.html 的 GAME_CONFIG 匯入') {
    const n = this.db.prepare('SELECT COUNT(*) n FROM config_versions').get().n;
    if (n) return false;
    const cfg = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    this.save(cfg, note, 'system');
    return true;
  }

  active() {
    if (this.cache) return this.cache;
    const row = this.db.prepare('SELECT * FROM config_versions ORDER BY version DESC LIMIT 1').get();
    if (!row) throw new Error('尚未有任何遊戲設定版本');
    const config = JSON.parse(row.json);
    const pub = JSON.stringify(publicConfig(config));
    this.cache = { version: row.version, createdAt: row.created_at, config, publicJson: pub, etag: '"cfg-' + row.version + '-' + sha256(pub).slice(0, 12) + '"' };
    return this.cache;
  }

  save(cfg, note, by, rollbackOf = null) {
    const errors = validateConfig(cfg);
    if (errors.length) throw new HttpError(422, 'invalid_config', '設定驗證失敗', { errors });
    const cur = this.db.prepare('SELECT MAX(version) v FROM config_versions').get().v || 0;
    const version = cur + 1;
    this.db.prepare('INSERT INTO config_versions (version, json, note, created_at, created_by, rollback_of) VALUES (?,?,?,?,?,?)')
      .run(version, JSON.stringify(cfg), String(note || '').slice(0, 200), Date.now(), by || 'admin', rollbackOf);
    this.cache = null;
    return version;
  }

  list(limit = 50) {
    return this.db.prepare('SELECT version, note, created_at, created_by, rollback_of, length(json) size FROM config_versions ORDER BY version DESC LIMIT ?').all(limit);
  }

  get(version) {
    const row = this.db.prepare('SELECT * FROM config_versions WHERE version=?').get(version);
    if (!row) throw new HttpError(404, 'not_found', '找不到此版本');
    return { ...row, json: undefined, config: JSON.parse(row.json) };
  }

  rollback(version, by) {
    const old = this.get(version);
    return this.save(old.config, `回復至 v${version}`, by, version);
  }
}

module.exports = { ConfigStore };
