'use strict';
// v4.5 後台唯讀報表（只用 GET、只讀資料庫，不登入玩家帳號、不改存檔）
//  - ⚓ 玩家漁港：GET /admin/api/reports/harbor/:id  — 訪客看到的魚缸＋好友／幫忙餵食／借魚繁殖紀錄
//  - 👥 邀請報表：GET /admin/api/reports/invites（JSON）、/admin/api/reports/invites.csv（CSV）
const express = require('express');
const { HttpError, toInt } = require('./util');
const { levelOf, socCfg } = require('./social');

const TZ = 8 * 3600e3;
const dayStart = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`) : null; };
const monthOf = (t) => new Date(t + TZ).toISOString().slice(0, 7);
const fmtT = (t) => (t ? new Date(t + TZ).toISOString().replace('T', ' ').slice(0, 19) : '');
const REASON = { same_ip: '與邀請人同 IP', self: '自己邀請自己', monthly_cap: '邀請人已達本月上限（被邀請者仍有獎勵）', banned: '已停權' };

function mountAdminReports(app, ctx) {
  const { db, configStore } = ctx;
  const cfg = () => configStore.active().config || {};
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  const saveOf = (id) => { const r = db.prepare('SELECT data, rev, updated_at FROM saves WHERE player_id=?').get(id); if (!r) return null; try { return { save: JSON.parse(r.data), rev: r.rev, updatedAt: r.updated_at }; } catch { return null; } };
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

  // ---------- ⚓ 玩家漁港（唯讀） ----------
  function harbor(id) {
    const p = db.prepare('SELECT id, username, nickname, created_at, last_seen, banned_at, is_demo, no_visits FROM players WHERE id=?').get(id);
    if (!p) throw new HttpError(404, 'not_found', '找不到玩家');
    const so = ctx.social, C = cfg(), S = socCfg(C), sv = saveOf(id), s = sv && sv.save;
    const prefs = so ? so.prefs(id) : null;
    const hiddenWhy = []; if (!p.username) hiddenWhy.push('訪客（漁港只顯示會員）'); if (p.banned_at) hiddenWhy.push('已停權'); if (p.is_demo) hiddenWhy.push('示範玩家'); if (p.no_visits) hiddenWhy.push('後台設定不開放拜訪'); if (prefs && prefs.visitable === false) hiddenWhy.push('玩家自己設定不開放拜訪');
    // 訪客看到的魚缸：與遊戲漁港 /api/social/tank 同一套挑選規則（不受「不開放拜訪」影響，後台一律可看）
    let view = null;
    try { if (so && p.username && !p.banned_at && !p.is_demo) view = so.tank(id, id, false); } catch (e) { view = null; }
    if (!view) {
      const fish = (s && Array.isArray(s.fish) ? s.fish : []).filter((f) => f && typeof f.sp === 'string' && C.species && C.species[f.sp]);
      view = { fish: fish.slice(0, S.visit.maxFish).map((f) => ({ id: String(f.id || '').slice(0, 24), sp: f.sp, name: String(f.name || '').slice(0, 16), hue: +f.hue || 0, size: Math.max(.5, Math.min(1.6, +f.size || 1)), hungry: (f.full ?? 100) < S.help.hungryBelow })), total: fish.length, hungry: fish.filter((f) => (f.full ?? 100) < S.help.hungryBelow).length, deco: s && s.up && Array.isArray(s.up.deco) ? s.up.deco.slice(0, 12) : [] };
    }
    view.self = undefined;
    const t30 = Date.now() - 30 * 86400e3, out = { player: { id: p.id, nickname: p.nickname, member: !!p.username, created_at: p.created_at, last_seen: p.last_seen, banned: !!p.banned_at }, level: levelOf(C, s), visitable: !hiddenWhy.length, hiddenWhy, prefs, tank: view, saveRev: sv ? sv.rev : null };
    if (has('social_friends')) {
      const fr = db.prepare('SELECT p.id, p.nickname, f.status, f.requester, f.updated_at FROM social_friends f JOIN players p ON p.id = CASE WHEN f.a=? THEN f.b ELSE f.a END WHERE f.a=? OR f.b=? ORDER BY f.updated_at DESC LIMIT 300').all(id, id, id);
      out.friends = { accepted: fr.filter((r) => r.status === 'accepted'), incoming: fr.filter((r) => r.status === 'pending' && r.requester !== id), outgoing: fr.filter((r) => r.status === 'pending' && r.requester === id), max: S.friends.max };
    }
    if (has('social_helps')) {
      const agg = (col) => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(reward),0) coins FROM social_helps WHERE ${col}=? AND created_at>=?`).get(id, t30);
      out.helps = { given30: agg('helper_id'), got30: agg('owner_id'),
        recent: db.prepare('SELECT h.helper_id, h.owner_id, h.reward, h.friend, h.created_at, a.nickname helper_name, b.nickname owner_name FROM social_helps h LEFT JOIN players a ON a.id=h.helper_id LEFT JOIN players b ON b.id=h.owner_id WHERE h.helper_id=? OR h.owner_id=? ORDER BY h.id DESC LIMIT 30').all(id, id) };
    }
    if (has('social_breeds')) out.breeds = db.prepare('SELECT id, requester_id, owner_id, owner_sp, my_sp, child_sp, kind, coins, gems, extra_gems, created_at FROM social_breeds WHERE requester_id=? OR owner_id=? ORDER BY id DESC LIMIT 30').all(id, id);
    if (has('social_notes')) out.notes = db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) unread FROM social_notes WHERE player_id=?').get(id);
    return out;
  }

  // ---------- 👥 邀請報表 ----------
  function invites(q) {
    const inv = ctx.invite, ic = inv ? inv.cfg() : { monthlyCap: 10 }, C = cfg();
    const from = dayStart(q.from), to = dayStart(q.to);
    const where = [], args = [];
    if (from != null) { where.push('i.created_at>=?'); args.push(from); }
    if (to != null) { where.push('i.created_at<?'); args.push(to + 86400e3); }
    const iq = String(q.inviter || '').trim();
    if (iq) { if (/^#?\d+$/.test(iq)) { where.push('i.inviter_id=?'); args.push(+iq.replace('#', '')); } else { where.push('(a.nickname LIKE ? OR a.username LIKE ? OR i.code=?)'); args.push(`%${iq}%`, `%${iq}%`, iq.toUpperCase()); } }
    const rows = db.prepare(`SELECT i.*, a.nickname inviter_name, a.username inviter_user, b.nickname invitee_name, b.username invitee_user, b.created_at invitee_created, b.bound_at invitee_bound, b.banned_at invitee_banned,
        (SELECT GROUP_CONCAT(provider) FROM player_identities pi WHERE pi.player_id=b.id) providers, (b.pass_hash IS NOT NULL) has_pw,
        (SELECT claimed_at FROM reward_claims rc WHERE rc.reward_id=i.reward_id AND rc.player_id=i.inviter_id) inviter_claimed,
        (SELECT claimed_at FROM reward_claims rc WHERE rc.reward_id=i.invitee_reward_id AND rc.player_id=i.invitee_id) invitee_claimed
      FROM invites i LEFT JOIN players a ON a.id=i.inviter_id LEFT JOIN players b ON b.id=i.invitee_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.created_at DESC LIMIT 5000`).all(...args);
    const list = rows.map((r) => {
      const sv = saveOf(r.invitee_id), s = sv && sv.save;
      const qualAt = r.rewarded_at || r.invitee_rewarded_at || null;
      let qualified = !!qualAt; if (!qualified && r.status === 'pending' && inv) { try { qualified = inv.qualified(r); } catch (e) { /* 唯讀判斷 */ } }
      const bind = r.providers ? r.providers.split(',').map((x) => (x === 'line' ? 'LINE' : x === 'google' ? 'Google' : x)).join('+') : r.has_pw ? '信箱' : r.invitee_user ? '會員' : '訪客（未註冊）';
      return { inviter_id: r.inviter_id, inviter_name: r.inviter_name || '', invitee_id: r.invitee_id, invitee_name: r.invitee_name || '', code: r.code, invited_at: r.created_at, bind, invitee_level: levelOf(C, s), invitee_fish: s && Array.isArray(s.fish) ? s.fish.length : 0,
        qualified, qualified_at: qualAt, qualified_note: !qualAt && qualified ? '已符合，下次同步時發獎' : '', status: r.status,
        inviter_paid: r.status === 'rewarded' ? { kind: r.reward_kind, qty: r.reward_qty, at: r.rewarded_at, claimed_at: r.inviter_claimed || null } : null,
        invitee_paid: r.invitee_reward_id ? { kind: 'coins', qty: r.invitee_qty, at: r.invitee_rewarded_at, claimed_at: r.invitee_claimed || null } : null,
        blocked: r.status === 'rejected' || r.reason ? (REASON[r.reason] || r.reason || r.status) : (r.invitee_banned ? REASON.banned : '') };
    });
    const coins = (k) => list.reduce((a, r) => a + (r[k] && r[k].kind === 'coins' ? r[k].qty || 0 : 0), 0);
    const gems = list.reduce((a, r) => a + (r.inviter_paid && r.inviter_paid.kind === 'gems' ? r.inviter_paid.qty || 0 : 0), 0);
    const summary = { clicks: null, clicksNote: '連結點擊沒有追蹤（nginx 未記到資料庫）；「連結帶入」＝用邀請連結建立的新訪客', attached: list.length, rejected: list.filter((r) => r.status === 'rejected').length,
      signups: list.filter((r) => r.bind !== '訪客（未註冊）').length, qualified: list.filter((r) => r.qualified).length, inviterRewarded: list.filter((r) => r.inviter_paid).length, inviteeRewarded: list.filter((r) => r.invitee_paid).length,
      coinsInviter: coins('inviter_paid'), coinsInvitee: coins('invitee_paid'), coinsTotal: coins('inviter_paid') + coins('invitee_paid'), gemsInviter: gems };
    // 每位邀請人：本月（台北）已發獎數 vs 上限
    const ms = inv ? inv.monthStart() : Date.parse(monthOf(Date.now()) + '-01T00:00:00+08:00');
    const per = db.prepare(`SELECT i.inviter_id id, a.nickname name, COUNT(*) total, SUM(CASE WHEN i.status='rewarded' THEN 1 ELSE 0 END) rewarded,
        SUM(CASE WHEN i.status='rewarded' AND i.rewarded_at>=? THEN 1 ELSE 0 END) month, SUM(CASE WHEN i.status='rejected' THEN 1 ELSE 0 END) rejected, SUM(CASE WHEN i.reason='monthly_cap' THEN 1 ELSE 0 END) capped
      FROM invites i LEFT JOIN players a ON a.id=i.inviter_id ${iq && /^#?\d+$/.test(iq) ? 'WHERE i.inviter_id=' + (+iq.replace('#', '')) : ''} GROUP BY i.inviter_id ORDER BY month DESC, total DESC LIMIT 500`).all(ms);
    return { month: monthOf(Date.now()), cap: ic.monthlyCap, config: { rewardKind: ic.rewardKind, rewardQty: ic.rewardQty, inviteeCoins: ic.inviteeCoins, minPlayMin: ic.minPlayMin, minFish: ic.minFish }, filters: { from: q.from || '', to: q.to || '', inviter: iq }, summary, perInviter: per.map((r) => ({ ...r, atCap: r.month >= ic.monthlyCap })), rows: list };
  }
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function invitesCsv(q) {
    const d = invites(q), H = ['邀請人ID', '邀請人暱稱', '被邀請者ID', '被邀請者暱稱', '邀請碼', '邀請時間(台北)', '綁定方式', '被邀請者等級', '符合資格', '符合時間(台北)', '邀請人獎勵', '邀請人獎勵發出(台北)', '被邀請者獎勵', '被邀請者獎勵發出(台北)', '狀態', '阻擋／濫用原因'];
    const pay = (x) => (x ? `${x.kind === 'gems' ? '💎' : '🪙'}${x.qty}${x.claimed_at ? '（已領）' : '（未領）'}` : '');
    const lines = [H.join(',')].concat(d.rows.map((r) => [r.inviter_id, r.inviter_name, r.invitee_id, r.invitee_name, r.code, fmtT(r.invited_at), r.bind, r.invitee_level, r.qualified ? '是' : '否', fmtT(r.qualified_at), pay(r.inviter_paid), fmtT(r.inviter_paid && r.inviter_paid.at), pay(r.invitee_paid), fmtT(r.invitee_paid && r.invitee_paid.at), r.status, r.blocked].map(csvCell).join(',')));
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  const a = express.Router();
  a.use(ctx.adminAuth.require());
  a.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : next(new HttpError(405, 'read_only', '報表只能讀取'))));
  a.get('/harbor/:id', wrap((req) => harbor(toInt(req.params.id, 0))));
  a.get('/invites', wrap((req) => invites(req.query || {})));
  a.get('/invites.csv', (req, res, next) => { try { const c = invitesCsv(req.query || {}); res.set('content-type', 'text/csv; charset=utf-8'); res.set('content-disposition', `attachment; filename="invites-${new Date(Date.now() + TZ).toISOString().slice(0, 10)}.csv"`); res.set('cache-control', 'no-store'); res.send(c); } catch (e) { next(e); } });
  app.use('/admin/api/reports', a);
}
module.exports = { mountAdminReports };
