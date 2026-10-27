'use strict';
const { HttpError, bad, parseJSON, clampStr } = require('./util');

// 獎勵寄送與信箱領取
class Rewards {
  constructor(db, players, configStore, commerceRef) { this.db = db; this.players = players; this.cfg = configStore; this.commerceRef = commerceRef; this.db.exec('CREATE TABLE IF NOT EXISTS mailbox_deleted (player_id INTEGER NOT NULL REFERENCES players(id), reward_id INTEGER NOT NULL REFERENCES rewards(id), deleted_at INTEGER NOT NULL, PRIMARY KEY(player_id,reward_id))'); }

  normalizeContent(body) {
    const cfg = this.cfg.active().config;
    const coins = Math.max(0, Math.floor(Number(body.coins) || 0));
    const gems = Math.max(0, Math.floor(Number(body.gems) || 0));
    const fish = (Array.isArray(body.fish) ? body.fish : []).filter((f) => f && cfg.species[f.species])
      .map((f) => ({ species: f.species, count: Math.min(20, Math.max(1, Math.floor(Number(f.count) || 1))), growth: Math.max(0, Number(f.growth) || 0) }));
    const decorations = (Array.isArray(body.decorations) ? body.decorations : []).filter((d) => cfg.decorations[d]);
    const BG = require('./gemshop').conf(cfg).cosmetics.backgrounds, cosmetics = (Array.isArray(body.cosmetics) ? body.cosmetics : []).filter((c) => Object.prototype.hasOwnProperty.call(BG, c)); // SHOPV2-PACKS
    if (coins > 1e9 || gems > 1e6) throw bad('too_large', '數量過大');
    if (!coins && !gems && !fish.length && !decorations.length && !cosmetics.length) throw bad('empty_reward', '獎勵內容不可為空');
    return { coins, gems, fish, items: cosmetics.length ? { decorations, cosmetics } : { decorations } };
  }

  // 篩選條件 → SQL
  filterQuery(filter = {}) {
    const where = ['p.banned_at IS NULL'];
    const args = [];
    const t = Date.now();
    if (!filter.includeDemo) where.push('p.is_demo=0');
    if (filter.lastSeenDays) { where.push('p.last_seen >= ?'); args.push(t - Number(filter.lastSeenDays) * 86400000); }
    if (filter.createdAfter) { where.push('p.created_at >= ?'); args.push(Number(filter.createdAfter)); }
    if (filter.createdBefore) { where.push('p.created_at <= ?'); args.push(Number(filter.createdBefore)); }
    if (filter.minCoins != null && filter.minCoins !== '') { where.push('COALESCE(s.coins,0) >= ?'); args.push(Number(filter.minCoins)); }
    if (filter.maxCoins != null && filter.maxCoins !== '') { where.push('COALESCE(s.coins,0) <= ?'); args.push(Number(filter.maxCoins)); }
    if (filter.bound === 'yes') where.push('p.username IS NOT NULL');
    if (filter.bound === 'no') where.push('p.username IS NULL');
    if (filter.ownsSpecies) { where.push('EXISTS (SELECT 1 FROM player_species ps WHERE ps.player_id=p.id AND ps.sp=? AND ps.owned>0)'); args.push(String(filter.ownsSpecies)); }
    if (filter.vip === 'yes') { where.push('EXISTS (SELECT 1 FROM entitlements e WHERE e.player_id=p.id AND e.kind=\'vip\' AND e.revoked_at IS NULL AND e.expires_at > ?)'); args.push(t); }
    return { sql: `SELECT p.id FROM players p LEFT JOIN saves s ON s.player_id=p.id WHERE ${where.join(' AND ')}`, args };
  }

  previewFilter(filter) {
    const q = this.filterQuery(filter);
    return this.db.prepare(`SELECT COUNT(*) n FROM (${q.sql})`).get(...q.args).n;
  }

  // target: player | all | filter
  create(body, opts = {}) {
    const title = clampStr(body.title, 60).trim();
    if (!title) throw bad('title_required', '請輸入標題');
    const content = this.normalizeContent(body);
    const target = body.target;
    if (!['player', 'all', 'filter'].includes(target)) throw bad('invalid_target', '寄送對象錯誤');
    const t = Date.now();
    const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
    return this.db.transaction(() => {
      let ids = [];
      if (target === 'player') {
        ids = (Array.isArray(body.playerIds) ? body.playerIds : [body.playerId]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!ids.length) throw bad('player_required', '請指定玩家 ID');
        const missing = ids.filter((id) => !this.db.prepare('SELECT 1 FROM players WHERE id=?').get(id));
        if (missing.length) throw new HttpError(404, 'player_not_found', `找不到玩家 #${missing.join(', #')}`);
      } else if (target === 'filter') {
        const q = this.filterQuery(body.filter || {});
        ids = this.db.prepare(q.sql).all(...q.args).map((r) => r.id);
      }
      const recipients = target === 'all' ? this.db.prepare('SELECT COUNT(*) n FROM players WHERE banned_at IS NULL').get().n : ids.length;
      const rid = this.db.prepare(`INSERT INTO rewards (title, body, coins, gems, fish, items, target, filter, include_new, order_id, recipients, created_at, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, clampStr(body.body, 500), content.coins, content.gems, JSON.stringify(content.fish), JSON.stringify(content.items),
        target, target === 'filter' ? JSON.stringify(body.filter || {}) : null, body.includeNew ? 1 : 0, opts.orderId || null, recipients, t, expiresAt).lastInsertRowid;
      const ins = this.db.prepare('INSERT OR IGNORE INTO reward_targets (reward_id, player_id) VALUES (?,?)');
      for (const id of ids) ins.run(rid, id);
      return { id: Number(rid), recipients };
    })();
  }

  list(limit = 100) {
    return this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM reward_claims c WHERE c.reward_id=r.id) claimed FROM rewards r ORDER BY r.id DESC LIMIT ?`).all(limit)
      .map((r) => ({ ...r, fish: parseJSON(r.fish, []), items: parseJSON(r.items, {}), filter: parseJSON(r.filter, null) }));
  }

  revoke(id) {
    const r = this.db.prepare('UPDATE rewards SET revoked=1 WHERE id=?').run(id);
    if (!r.changes) throw new HttpError(404, 'not_found', '找不到獎勵');
  }

  mailboxSql() {
    return `SELECT r.*, c.claimed_at FROM rewards r
      JOIN players p ON p.id=@pid
      LEFT JOIN reward_claims c ON c.reward_id=r.id AND c.player_id=@pid
      WHERE r.revoked=0 AND NOT EXISTS (SELECT 1 FROM mailbox_deleted md WHERE md.player_id=@pid AND md.reward_id=r.id) AND (r.expires_at IS NULL OR r.expires_at > @now OR c.claimed_at IS NOT NULL)
        AND ( (r.target='all' AND (r.include_new=1 OR p.created_at <= r.created_at))
           OR EXISTS (SELECT 1 FROM reward_targets t WHERE t.reward_id=r.id AND t.player_id=@pid) )`;
  }

  mailbox(pid) {
    require('./monthly-mail').enroll(this.db, pid);
    return this.db.prepare(this.mailboxSql() + ' ORDER BY r.id DESC LIMIT 100').all({ pid, now: Date.now() }).map((r) => ({
      id: r.id, title: r.title, body: r.body, action: parseJSON(r.items, {}).action || null, coins: r.coins, gems: r.gems, fish: parseJSON(r.fish, []), decorations: parseJSON(r.items, {}).decorations || [],
      createdAt: r.created_at, expiresAt: r.expires_at, claimed: !!r.claimed_at, claimedAt: r.claimed_at,
    }));
  }

  deletedMail(pid) {
    const sql=this.mailboxSql().replace('NOT EXISTS (SELECT 1 FROM mailbox_deleted','EXISTS (SELECT 1 FROM mailbox_deleted');
    return this.db.prepare(sql+' ORDER BY r.id DESC LIMIT 100').all({pid,now:Date.now()}).map(r=>({id:r.id,title:r.title,body:r.body}));
  }
  deleteMail(pid,id) {
    return this.db.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM mailbox_deleted WHERE player_id=? AND reward_id=?').get(pid,id))return {deleted:true,id};
      const r=this.db.prepare(this.mailboxSql()+' AND r.id=@rid').get({pid,rid:id,now:Date.now()});
      if(!r)throw new HttpError(404,'not_found','找不到此信件');
      const items=parseJSON(r.items,{}),hasReward=r.coins||r.gems||parseJSON(r.fish,[]).length||(items.decorations||[]).length||(items.cosmetics||[]).length;
      if(hasReward&&!r.claimed_at)throw new HttpError(409,'unclaimed_reward','這封信還有獎勵，請先領取後再刪除');
      this.db.prepare('INSERT INTO mailbox_deleted(player_id,reward_id,deleted_at) VALUES(?,?,?)').run(pid,id,Date.now());return {deleted:true,id};
    })();
  }
  restoreMail(pid,id) {const r=this.db.prepare('DELETE FROM mailbox_deleted WHERE player_id=? AND reward_id=?').run(pid,id);if(!r.changes)throw new HttpError(404,'not_found','找不到已刪除信件');return {restored:true,id};}

  claim(pid, rewardId) {
    return this.db.transaction(() => {
      const r = this.db.prepare(this.mailboxSql() + ' AND r.id=@rid').get({ pid, now: Date.now(), rid: rewardId });
      if (!r) throw new HttpError(404, 'not_found', '找不到此信件或已過期');
      if (r.claimed_at) throw new HttpError(409, 'already_claimed', '已經領取過了');
      // INVITE-SOCIAL-V1: includes unclaimed invitation mail issued before this rule.
      const inviteReward=this.db.prepare('SELECT 1 FROM invites WHERE (reward_id=? AND inviter_id=?) OR (invitee_reward_id=? AND invitee_id=?) LIMIT 1').get(r.id,pid,r.id,pid);
      if(inviteReward&&!this.db.prepare("SELECT 1 FROM player_identities WHERE player_id=? AND provider IN ('google','line') LIMIT 1").get(pid))throw new HttpError(403,'social_binding_required','領取邀請獎勵前，請先到會員中心綁定 Google 或 LINE');
      const fish = parseJSON(r.fish, []);
      const decorations = parseJSON(r.items, {}).decorations || [], cosmetics = parseJSON(r.items, {}).cosmetics || []; // SHOPV2-PACKS
      let result = { save: null, rev: null, addedFish: [] };
      if (r.coins || fish.length || decorations.length || cosmetics.length) result = this.players.grantToSave(pid, { coins: r.coins, fish, decorations, cosmetics });
      let gems = null;
      if (r.gems) gems = this.commerceRef.current.ledger(pid, r.gems, 'reward', 'reward:' + r.id);
      this.db.prepare('INSERT INTO reward_claims (reward_id, player_id, claimed_at) VALUES (?,?,?)').run(r.id, pid, Date.now());
      this.players.logEvent(pid, 'reward_claimed', { rewardId: r.id, coins: r.coins, gems: r.gems, fish, decorations });
      return { rewardId: r.id, granted: { coins: r.coins, gems: r.gems, fish: result.addedFish, decorations }, save: result.save, rev: result.rev, gemBalance: gems };
    })();
  }
}

module.exports = { Rewards };
