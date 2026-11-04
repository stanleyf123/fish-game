'use strict';
// 每日釣魚任務（主遊戲「任務中心」→「每日釣魚」）
// - 進度完全由伺服器從 fishing_casts 當日（台北日）紀錄計算，前端無法回報進度
// - 領獎冪等：fishing_mission_claims 主鍵 (player_id, day, mission)；重複領取回 409 already_claimed
// - 只在 config.fishing.enabled=true（且未 FISHING_FORCE_OFF）時可查詢/領取；關閉時 API 回 403，任務卡隱藏
// - 每天 3 次免費拋竿（竹簍）即可全部完成；獎勵可用 config.fishing.missions 覆寫（陣列），
//   config.fishing.missionsEnabled=false 可單獨關閉任務
const { HttpError } = require('./util');

const KINDS = {
  cast: '完成拋竿（收線或脫鉤都算）',
  catch: '釣到魚（放魚缸／倉庫／賣出／放生都算）',
  rare: '釣到稀有以上的魚',
};
const MISSIONS_DEF = [
  { id: 'cast1', icon: '🎣', name: '今日拋竿 1 次', kind: 'cast', n: 1, coins: 200, gems: 0 },
  { id: 'catch1', icon: '🐟', name: '釣到 1 條魚', kind: 'catch', n: 1, coins: 300, gems: 0 },
  { id: 'cast3', icon: '🧺', name: '用完 3 次拋竿', kind: 'cast', n: 3, coins: 0, gems: 5 },
];
const SCHEMA = `CREATE TABLE IF NOT EXISTS fishing_mission_claims(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL, mission TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(player_id,day,mission));`;
const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;

function list(cfg) {
  const m = cfg.missions;
  if (!Array.isArray(m) || !m.length) return MISSIONS_DEF;
  const ok = m.filter((x) => x && /^[a-z0-9_]{1,20}$/.test(x.id) && KINDS[x.kind] && int(x.n, 1, 50) && int(x.coins || 0, 0, 5000) && int(x.gems || 0, 0, 50) && typeof x.name === 'string' && x.name.length <= 30)
    .slice(0, 6).map((x) => ({ id: x.id, icon: typeof x.icon === 'string' ? x.icon.slice(0, 4) : '🎣', name: x.name, kind: x.kind, n: x.n, coins: x.coins || 0, gems: x.gems || 0 }));
  return ok.length ? ok : MISSIONS_DEF;
}

class FishingMissions {
  constructor(svc) { this.svc = svc; this.db = svc.db; this.db.exec(SCHEMA); }
  on() { return this.svc.enabled() && this.svc.cfg().missionsEnabled !== false; }
  guard() { if (!this.on()) throw new HttpError(403, 'fishing_disabled', '釣魚任務尚未開放'); }
  progress(pid, day) {
    const q = (sql) => this.db.prepare(sql).get(pid, day).n;
    return {
      cast: q("SELECT COUNT(*) n FROM fishing_casts WHERE player_id=? AND day=? AND status IN ('caught','lost')"),
      // 收線成功且擲出的是魚（放生也算；寶箱/漂流瓶不算；雙鉤只算一次）
      catch: q("SELECT COUNT(*) n FROM fishing_casts WHERE player_id=? AND day=? AND status='caught' AND json_extract(outcome,'$.kind')='fish'"),
      rare: q("SELECT COUNT(*) n FROM fishing_casts WHERE player_id=? AND day=? AND status='caught' AND json_extract(outcome,'$.kind')='fish' AND json_extract(outcome,'$.r')>=1"),
    };
  }
  state(pid) {
    this.guard();
    const day = this.svc.day(), p = this.progress(pid, day);
    const claimed = new Set(this.db.prepare('SELECT mission FROM fishing_mission_claims WHERE player_id=? AND day=?').all(pid, day).map((r) => r.mission));
    const missions = list(this.svc.cfg()).map((m) => {
      const have = Math.min(m.n, p[m.kind] || 0);
      return { id: m.id, icon: m.icon, name: m.name, hint: KINDS[m.kind], n: m.n, have, done: have >= m.n, claimed: claimed.has(m.id), coins: m.coins, gems: m.gems };
    });
    return { day, missions, claimable: missions.filter((m) => m.done && !m.claimed).length };
  }
  claim(pid, body) {
    this.guard();
    const id = String((body && body.id) || '');
    const day = this.svc.day(), m = list(this.svc.cfg()).find((x) => x.id === id);
    if (!m) throw new HttpError(400, 'bad_mission', '沒有這個任務');
    const have = this.progress(pid, day)[m.kind] || 0;
    if (have < m.n) throw new HttpError(409, 'not_done', '任務還沒完成', { have, n: m.n });
    const t = this.svc.now();
    this.db.transaction(() => {
      const r = this.db.prepare('INSERT OR IGNORE INTO fishing_mission_claims(player_id,day,mission,coins,gems,created_at) VALUES(?,?,?,?,?,?)').run(pid, day, m.id, m.coins, m.gems, t);
      if (!r.changes) throw new HttpError(409, 'already_claimed', '今天已經領過了');
      if (m.coins) this.svc.players.grantToSave(pid, { coins: m.coins });
      if (m.gems) this.svc.commerce.ledger(pid, m.gems, 'bonus:fishing_mission', 'fm:' + day + ':' + m.id);
      this.svc.players.logEvent(pid, 'fishing_mission_claim', { day, mission: m.id, coins: m.coins, gems: m.gems });
    })();
    return { ok: true, mission: m.id, coins: m.coins, gems: m.gems, gemsBalance: this.svc.commerce.balance(pid), ...this.state(pid) };
  }
}

// 掛在 /api/fishing 的 router 上（已經過 players.auth）
function mountMissions(r, svc, wrap, lim) {
  const fm = svc.missions = new FishingMissions(svc);
  r.get('/missions', lim('read'), wrap((req) => fm.state(req.player.id)));
  r.post('/missions/claim', lim('act'), wrap((req) => { const out = fm.claim(req.player.id, req.body || {}); const row = svc.players.getSave(req.player.id); return { ...out, rev: row && row.rev }; }));
  return fm;
}

module.exports = { mountMissions, FishingMissions, MISSIONS_DEF };
