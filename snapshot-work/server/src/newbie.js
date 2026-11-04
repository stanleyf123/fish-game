'use strict';
// v4.1.3：新手體驗（伺服器端）— 新手導覽獎勵（一次）、註冊送寶石（一次）、會員每日簽到、成就寶石、前 15 分鐘加速的防作弊放寬、來源／UTM 紀錄
const { HttpError, clampStr } = require('./util');
const DEF = { since: 0, tutorialCoins: 100, egg: { species: 'galaxybetta', hatchSec: 180 }, signupGems: 50, dailyGems: 2, boostMin: 15, boostCoinMult: 2, boostIntervalMult: 0.3,
  achievements: [{ id: 'dex10', name: '圖鑑收集 10 種', found: 10, gems: 10 }, { id: 'dex20', name: '圖鑑收集 20 種', found: 20, gems: 20 }] };

class Newbie {
  constructor({ db, configStore, players, commerce }) {
    this.db = db; this.cfgStore = configStore; this.players = players; this.commerce = commerce;
    db.exec(`CREATE TABLE IF NOT EXISTS player_onboard (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, tutorial_at INTEGER, signup_bonus_at INTEGER, signup_bonus INTEGER, daily_day TEXT, ach TEXT NOT NULL DEFAULT '{}', ref TEXT, utm TEXT, landing TEXT, first_seen INTEGER)`);
  }
  cfg() { const n = (this.cfgStore.active().config || {}).newbie || {}; return { ...DEF, ...n, egg: { ...DEF.egg, ...(n.egg || {}) }, achievements: Array.isArray(n.achievements) ? n.achievements : DEF.achievements }; }
  row(pid) { this.db.prepare('INSERT OR IGNORE INTO player_onboard (player_id) VALUES (?)').run(pid); return this.db.prepare('SELECT * FROM player_onboard WHERE player_id=?').get(pid); }
  day(t = Date.now()) { return new Date(t + 8 * 3600e3).toISOString().slice(0, 10); }
  eligible(p) { const c = this.cfg(); return !!(c.since > 0 && p && p.created_at >= c.since); }
  // 前 boostMin 分鐘（再加 10 分鐘緩衝）金幣產速上限乘上加速倍率
  coinRateMult(p, t = Date.now()) { const c = this.cfg(); return this.eligible(p) && t - p.created_at < (c.boostMin + 10) * 60000 ? Math.max(1, c.boostCoinMult / Math.max(0.05, c.boostIntervalMult)) : 1; }
  // 來源：只在第一次建立時記錄（referrer 只留網域＋路徑、UTM 各欄 60 字）
  attrib(pid, a) {
    if (!a || typeof a !== 'object') a = {};
    let ref = ''; try { if (a.ref) { const u = new URL(String(a.ref).slice(0, 500)); ref = (u.host + u.pathname).slice(0, 200); } } catch (e) { ref = ''; }
    const utm = {}; for (const k of ['source', 'medium', 'campaign', 'term', 'content']) { const v = a.utm && a.utm[k]; if (typeof v === 'string' && v.trim()) utm[k] = clampStr(v.trim(), 60); }
    const landing = typeof a.landing === 'string' ? clampStr(a.landing.replace(/[?#].*$/, ''), 120) : null;
    this.db.prepare('INSERT OR IGNORE INTO player_onboard (player_id, ref, utm, landing, first_seen) VALUES (?,?,?,?,?)').run(pid, ref || null, Object.keys(utm).length ? JSON.stringify(utm) : null, landing, Date.now());
  }
  status(pid) {
    const p = this.players.get(pid), r = this.row(pid), c = this.cfg(), ach = JSON.parse(r.ach || '{}'), member = !!p.username;
    let found = 0; try { found = Object.keys(JSON.parse(this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid).data).found || {}).length; } catch (e) { /* 沒有存檔 */ }
    return { eligible: this.eligible(p), tutorialDone: !!r.tutorial_at, eggEligible: true, tutorialCoins: c.tutorialCoins, egg: c.egg, boostMin: c.boostMin, createdAt: p.created_at,
      signupProviders: ['google', 'line'], signupEligible: member && this.hasSignupIdentity(pid), signupGems: c.signupGems, signupBonus: r.signup_bonus_at ? r.signup_bonus : 0, member, dailyGems: c.dailyGems, dailyAvailable: member && c.dailyGems > 0 && r.daily_day !== this.day(),
      achievements: c.achievements.map((a) => ({ id: a.id, name: a.name, gems: a.gems, goal: a.found, progress: Math.min(found, a.found), claimed: !!ach[a.id], claimable: member && !ach[a.id] && found >= a.found })) };
  }
  tutorial(pid) {
    return this.db.transaction(() => {
      const p=this.players.get(pid),c=this.cfg(),r=this.row(pid),row=this.players.getSave(pid),save=row.save;
      if(r.tutorial_at)throw new HttpError(409,'already_claimed','魚蛋獎勵已經領過了');
      if(!save)throw new HttpError(409,'no_save','請先同步魚缸再領取');
      if(save.egg||save.nb?.d?.hatch)throw new HttpError(409,'already_claimed','已有魚蛋或已完成孵化，不會重複發放');
      if(!c.egg?.species||!this.cfgStore.active().config.species[c.egg.species])throw new HttpError(409,'egg_unavailable','魚蛋暫時無法發放');
      const retro=!this.eligible(p),coins=retro?0:c.tutorialCoins,egg={sp:c.egg.species,at:Date.now()+(c.egg.hatchSec||180)*1000};
      this.db.prepare('UPDATE player_onboard SET tutorial_at=? WHERE player_id=?').run(Date.now(),pid);
      const out=this.players.grantToSave(pid,{coins,egg});
      this.players.logEvent(pid,retro?'legacy_task_egg':'newbie_tutorial',{coins,egg:egg.sp});
      return {ok:true,coins,egg,save:out.save,rev:out.rev,retro};
    })();
  }
  // GOOGLE-LINE-SIGNUP: verified identity required; Email alone is not eligible.
  hasSignupIdentity(pid) { return !!this.db.prepare("SELECT 1 FROM player_identities WHERE player_id=? AND provider IN ('google','line') LIMIT 1").get(pid); }
  // 每個帳號只發一次；既有已領者不追回，也不能藉由重新綁定重領
  signupBonus(pid) {
    const p = this.players.get(pid), c = this.cfg();
    if (!p || !p.username || !this.hasSignupIdentity(pid) || p.banned_at != null || !(c.signupGems > 0) || !(c.since > 0)) return 0;
    const n = Math.max(0, Math.min(200, Math.floor(c.signupGems)));
    const ok = this.db.transaction(() => { const r = this.row(pid); if (r.signup_bonus_at || this.db.prepare("SELECT 1 FROM gem_ledger WHERE player_id=? AND reason='bonus:signup' AND delta>0 LIMIT 1").get(pid)) return false; this.db.prepare('UPDATE player_onboard SET signup_bonus_at=?, signup_bonus=? WHERE player_id=?').run(Date.now(), n, pid); this.commerce.ledger(pid, n, 'bonus:signup', null); return true; })();
    if (ok) this.players.logEvent(pid, 'signup_bonus', { gems: n });
    return ok ? n : 0;
  }
  daily(pid) {
    const p = this.players.get(pid), c = this.cfg(), d = this.day();
    if (!p.username) throw new HttpError(403, 'members_only', '註冊會員才能每日簽到');
    if (!(c.dailyGems > 0)) throw new HttpError(403, 'disabled', '每日簽到未開放');
    const ok = this.db.transaction(() => { const r = this.row(pid); if (r.daily_day === d) return false; this.db.prepare('UPDATE player_onboard SET daily_day=? WHERE player_id=?').run(d, pid); this.commerce.ledger(pid, c.dailyGems, 'bonus:daily', d); return true; })();
    if (!ok) throw new HttpError(409, 'already_claimed', '今天已經簽到過了');
    return { ok: true, gems: c.dailyGems, balance: this.commerce.balance(pid) };
  }
  achieve(pid, id) {
    const st = this.status(pid), a = st.achievements.find((x) => x.id === id);
    if (!a) throw new HttpError(404, 'not_found', '找不到這個成就');
    if (!st.member) throw new HttpError(403, 'members_only', '註冊會員才能領取成就寶石');
    if (!a.claimable) throw new HttpError(409, a.claimed ? 'already_claimed' : 'not_done', a.claimed ? '已經領過了' : '還沒達成');
    const ok = this.db.transaction(() => { const r = this.row(pid), ach = JSON.parse(r.ach || '{}'); if (ach[id]) return false; ach[id] = Date.now(); this.db.prepare('UPDATE player_onboard SET ach=? WHERE player_id=?').run(JSON.stringify(ach), pid); this.commerce.ledger(pid, a.gems, 'bonus:ach', id); return true; })();
    if (!ok) throw new HttpError(409, 'already_claimed', '已經領過了');
    return { ok: true, gems: a.gems, balance: this.commerce.balance(pid) };
  }
}
module.exports = { Newbie, NEWBIE_DEFAULTS: DEF };
