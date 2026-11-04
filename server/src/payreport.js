'use strict';
// v4.1.2 💰 營收報表：以台北時間切日；只算真實訂單（排除示範玩家；後台手動補入帳另列）
const PROVS = "('ecpay','newebpay')";
const H8 = 8 * 3600e3, DAY = 86400e3;
const dayOf = (ms) => new Date(ms + H8).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00+08:00');
const addDays = (d, n) => dayOf(dayStart(d) + n * DAY);
const pj = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const catOf = (sku) => { const s = String(sku || '').replace(/^pay:/, ''); return /^card/.test(s) ? 'card' : /^gems/.test(s) ? 'gems' : /^coins/.test(s) ? 'coins' : /^sponsor/.test(s) ? 'sponsor' : 'other'; };
const CAT_NAME = { gems: '💎 寶石', coins: '🪙 金幣', card: '👑 月卡', sponsor: '💖 贊助', other: '其他' };
const METHOD = (t) => (!t ? '未知' : /^Credit|^CREDIT/.test(t) ? '信用卡' : /^ATM|^VACC|^WEBATM/i.test(t) ? 'ATM' : /^CVS|^BARCODE/.test(t) ? '超商' : t);
const SINK = { diamond_egg:'魚蛋', storage:'收藏庫擴充', species: '限定魚', med: '藥品', speed: '加速', weekly: '本週限定', bg: '背景', cos: '外觀', social: '漁港', breed: '加購繁殖', gear: '設備', cutting: '水草', plant: '水草', hero: '英雄魚', hero_gear: '英雄裝備', hero_skill: '英雄技能', hero_train: '英雄訓練', deco: '裝飾', skin: '英雄造型' };
const sinkOf = (sku) => { const k = String(sku || '').split(':')[0]; return SINK[k] ? k : (k || 'other'); };

// 期間：today / yesterday / 7d / 30d / month / lastmonth / custom(from,to = YYYY-MM-DD，含頭含尾)
function resolveRange(q = {}, now = Date.now()) {
  const today = dayOf(now); let a, b;
  switch (q.range) {
    case 'yesterday': a = b = addDays(today, -1); break;
    case '7d': a = addDays(today, -6); b = today; break;
    case '30d': a = addDays(today, -29); b = today; break;
    case 'month': a = today.slice(0, 8) + '01'; b = today; break;
    case 'lastmonth': { b = addDays(today.slice(0, 8) + '01', -1); a = b.slice(0, 8) + '01'; break; }
    case 'custom': a = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : today; b = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : a; if (b < a) [a, b] = [b, a]; break;
    default: a = b = today;
  }
  const days = Math.round((dayStart(b) - dayStart(a)) / DAY) + 1;
  if (days > 400) { a = addDays(b, -399); }
  const n = Math.round((dayStart(b) - dayStart(a)) / DAY) + 1;
  let pa, pb;
  if (q.range === 'month' || q.range === 'lastmonth') { pb = addDays(a, -1); pa = pb.slice(0, 8) + '01'; if (q.range === 'month') { const lim = addDays(pa, n - 1); if (lim < pb) pb = lim; } }
  else { pb = addDays(a, -1); pa = addDays(a, -n); }
  return { range: q.range || 'today', fromDay: a, toDay: b, days: n, from: dayStart(a), to: dayStart(b) + DAY, prev: { fromDay: pa, toDay: pb, from: dayStart(pa), to: dayStart(pb) + DAY }, today };
}

function payReport(db, q = {}, opts = {}) {
  const now = opts.now || Date.now(), R = resolveRange(q, now);
  const cardPrice = opts.cardPrice || 300;
  const orders = db.prepare(`SELECT o.*, p.is_demo FROM orders o JOIN players p ON p.id=o.player_id WHERE o.provider IN ${PROVS}`).all();
  const isManual = (o) => /\[後台補入帳\]/.test(o.note || '');
  const real = orders.filter((o) => !o.is_demo && !isManual(o));
  const paidAt = (o) => o.paid_at || o.credited_at || o.created_at;
  const isPaid = (o) => o.credited_at != null && (o.status === 'paid' || o.status === 'refunded');
  const firstPaid = {}; for (const o of real) if (isPaid(o)) { const t = paidAt(o); if (!firstPaid[o.player_id] || t < firstPaid[o.player_id]) firstPaid[o.player_id] = t; }
  const activeIn = (a, b) => db.prepare('SELECT COUNT(DISTINCT player_id) n FROM daily_active d JOIN players p ON p.id=d.player_id WHERE p.is_demo=0 AND day>=? AND day<=?').get(dayOf(a), dayOf(b - 1)).n;
  const membersIn = (a, b) => db.prepare('SELECT COUNT(DISTINCT d.player_id) n FROM daily_active d JOIN players p ON p.id=d.player_id WHERE p.is_demo=0 AND p.username IS NOT NULL AND day>=? AND day<=?').get(dayOf(a), dayOf(b - 1)).n;
  function kpi(a, b) {
    const paid = real.filter((o) => isPaid(o) && paidAt(o) >= a && paidAt(o) < b);
    const ref = real.filter((o) => o.status === 'refunded' && o.refunded_at >= a && o.refunded_at < b);
    const gross = paid.reduce((s, o) => s + o.amount, 0), refunds = ref.reduce((s, o) => s + o.amount, 0);
    const payers = new Set(paid.map((o) => o.player_id));
    const newPayers = [...payers].filter((p) => firstPaid[p] >= a && firstPaid[p] < b).length;
    const cnt = {}; paid.forEach((o) => { cnt[o.player_id] = (cnt[o.player_id] || 0) + 1; });
    const repeat = [...payers].filter((p) => firstPaid[p] < a || cnt[p] > 1).length;
    const active = activeIn(a, b), members = membersIn(a, b), net = gross - refunds;
    const created = real.filter((o) => o.created_at >= a && o.created_at < b);
    const expired = created.filter((o) => o.status === 'pending' && o.expires_at && o.expires_at < now).length;
    return { gross, refunds, net, paidOrders: paid.length, payers: payers.size, newPayers, repeatPayers: repeat, active, members,
      conversion: active ? payers.size / active : 0, memberConversion: members ? payers.size / members : 0,
      arpu: active ? net / active : 0, arppu: payers.size ? net / payers.size : 0, avgOrder: paid.length ? gross / paid.length : 0, expiredUnpaid: expired, ordersCreated: created.length };
  }
  const cur = kpi(R.from, R.to), prev = kpi(R.prev.from, R.prev.to);
  const pend = real.filter((o) => o.status === 'pending' && !(o.expires_at && o.expires_at < now) && o.created_at > now - 30 * DAY);
  cur.pending = pend.length; cur.pendingAmount = pend.reduce((s, o) => s + o.amount, 0);
  // 每日
  const daily = []; for (let d = R.fromDay; d <= R.toDay; d = addDays(d, 1)) { const a = dayStart(d), k = kpi.call(null, a, a + DAY); daily.push({ day: d, gross: k.gross, refunds: k.refunds, net: k.net, payers: k.payers, orders: k.paidOrders }); }
  // 今日每小時
  const t0 = dayStart(R.today), hourly = Array.from({ length: 24 }, (_, h) => ({ h, amount: 0, n: 0 }));
  for (const o of real) if (isPaid(o) && paidAt(o) >= t0 && paidAt(o) < t0 + DAY) { const h = Math.floor((paidAt(o) - t0) / 3600e3); hourly[h].amount += o.amount; hourly[h].n++; }
  const inR = real.filter((o) => isPaid(o) && paidAt(o) >= R.from && paidAt(o) < R.to);
  const group = (keyf, namef) => { const m = {}; for (const o of inR) { const k = keyf(o); const g = m[k] || (m[k] = { key: k, name: namef(o, k), n: 0, amount: 0 }); g.n++; g.amount += o.amount; } return Object.values(m).sort((x, y) => y.amount - x.amount); };
  const byProduct = group((o) => o.sku, (o) => o.product_name);
  const byCategory = group((o) => catOf(o.sku), (o, k) => CAT_NAME[k]);
  const byMethod = group((o) => METHOD(o.payment_type), (o, k) => k);
  // 訂單漏斗（期間內建立的訂單）
  const cr = real.filter((o) => o.created_at >= R.from && o.created_at < R.to);
  const gotInfo = cr.filter((o) => o.pay_info || o.credited_at).length, paidN = cr.filter((o) => o.credited_at).length;
  const orderFunnel = [{ step: '建立訂單', n: cr.length }, { step: '取得繳費資訊／完成付款流程', n: gotInfo }, { step: '已付款', n: paidN }];
  // 月卡
  const vip = db.prepare("SELECT e.* FROM entitlements e JOIN players p ON p.id=e.player_id WHERE p.is_demo=0 AND e.kind='vip' AND e.revoked_at IS NULL").all();
  const activeCards = new Set(vip.filter((e) => e.starts_at <= now && (!e.expires_at || e.expires_at > now)).map((e) => e.player_id)).size;
  const cardOrders = inR.filter((o) => catOf(o.sku) === 'card');
  let cNew = 0, cRenew = 0; for (const o of cardOrders) { const prior = real.some((x) => x.player_id === o.player_id && x.id !== o.id && catOf(x.sku) === 'card' && isPaid(x) && paidAt(x) < paidAt(o)); if (prior) cRenew++; else cNew++; }
  const perPlayerExp = {}; for (const e of vip) perPlayerExp[e.player_id] = Math.max(perPlayerExp[e.player_id] || 0, e.expires_at || Infinity);
  const cExpired = Object.values(perPlayerExp).filter((t) => t >= R.from && t < Math.min(R.to, now)).length;
  let cardDays = 0; for (const d of daily) { const a = dayStart(d.day), b = a + DAY; if (a > now) break; const ps = new Set(vip.filter((e) => e.starts_at < b && (!e.expires_at || e.expires_at > a)).map((e) => e.player_id)); cardDays += ps.size; }
  const claims = db.prepare('SELECT COUNT(*) n FROM vip_daily_claims c JOIN players p ON p.id=c.player_id WHERE p.is_demo=0 AND day>=? AND day<=?').get(R.fromDay, R.toDay).n;
  const card = { active: activeCards, new: cNew, renewed: cRenew, expired: cExpired, claims, cardDays, claimRate: cardDays ? Math.min(1, claims / cardDays) : 0, mrr: activeCards * cardPrice };
  // 寶石經濟
  const led = db.prepare('SELECT l.*, p.is_demo FROM gem_ledger l JOIN players p ON p.id=l.player_id WHERE p.is_demo=0 AND l.created_at>=? AND l.created_at<?').all(R.from, R.to);
  const ordMap = {}; for (const o of db.prepare(`SELECT id, sku, grants, note, provider FROM orders WHERE id IN (${led.filter((l) => /^order:/.test(l.ref || '')).map(() => '?').join(',') || "''"})`).all(...led.filter((l) => /^order:/.test(l.ref || '')).map((l) => l.ref.slice(6)))) ordMap[o.id] = o;
  const issued = { purchased: 0, firstBonus: 0, card: 0, cardDaily: 0, admin: 0, other: 0 }, spent = {}; let refundsBack = 0;
  for (const l of led) {
    const o = /^order:/.test(l.ref || '') ? ordMap[l.ref.slice(6)] : null;
    if (l.delta > 0) {
      if (l.reason === 'purchase' && o) { const g = pj(o.grants, {}); if (catOf(o.sku) === 'card') issued.card += l.delta; else { const b = Math.min(l.delta, g.bonusGems || 0); issued.firstBonus += b; issued.purchased += l.delta - b; } }
      else if (l.reason === 'vip_daily') issued.cardDaily += l.delta;
      else if (/^admin/.test(l.reason)) issued.admin += l.delta;
      else issued.other += l.delta;
    } else if (l.delta < 0) {
      if (l.reason === 'spend' || l.reason === 'diamond_egg') { const prefix=String(l.ref||'').split(':')[0]; const k = l.reason==='diamond_egg'?'diamond_egg':o?sinkOf(o.sku):({'breed-extra':'breed',xbreed:'breed',fv2gift:'social','storage-expand':'storage'}[prefix]||'other'); spent[k] = (spent[k] || 0) - l.delta; } else refundsBack -= l.delta;
    }
  }
  const sinks = Object.entries(spent).map(([k, v]) => ({ key: k, name: SINK[k] || k, gems: v })).sort((a, b) => b.gems - a.gems);
  const outstanding = db.prepare('SELECT COALESCE(SUM(gems),0) s, COUNT(CASE WHEN gems>0 THEN 1 END) n FROM players WHERE is_demo=0').get();
  const gems = { issued, issuedTotal: Object.values(issued).reduce((a, b) => a + b, 0), sinks, spentTotal: sinks.reduce((a, b) => a + b.gems, 0), clawback: refundsBack, outstanding: outstanding.s, holders: outstanding.n };
  // 前 20 名付費玩家、最近訂單
  const sp = {}; for (const o of inR) { const s = sp[o.player_id] || (sp[o.player_id] = { playerId: o.player_id, amount: 0, n: 0, last: 0 }); s.amount += o.amount - (o.status === 'refunded' ? o.amount : 0); s.n++; s.last = Math.max(s.last, paidAt(o)); }
  const top = Object.values(sp).sort((a, b) => b.amount - a.amount || b.n - a.n).slice(0, 20);
  const names = {}; if (top.length) for (const p of db.prepare(`SELECT id, nickname, email, username FROM players WHERE id IN (${top.map(() => '?').join(',')})`).all(...top.map((t) => t.playerId))) names[p.id] = p;
  top.forEach((t) => { const p = names[t.playerId] || {}; t.name = p.nickname || ''; t.email = p.email || p.username || ''; });
  const recent = real.filter((o) => o.created_at >= R.from && o.created_at < R.to).sort((a, b) => b.created_at - a.created_at).slice(0, 15).map((o) => ({ id: o.id, playerId: o.player_id, name: o.product_name, amount: o.amount, status: o.status, method: METHOD(o.payment_type), createdAt: o.created_at, paidAt: o.credited_at ? paidAt(o) : null }));
  // 排除的
  const excl = (f) => { const l = orders.filter((o) => f(o) && isPaid(o) && paidAt(o) >= R.from && paidAt(o) < R.to); return { n: l.length, amount: l.reduce((s, o) => s + o.amount, 0) }; };
  const excluded = { demo: excl((o) => !!o.is_demo), manual: excl((o) => !o.is_demo && isManual(o)) };
  return { range: R, kpi: cur, prev, daily, hourly, byProduct, byCategory, byMethod, orderFunnel, card, gems, top, recent, excluded, funnel: funnelReport(db, R), generatedAt: now };
}

const FUNNEL_ORDER = [['view', '打開儲值頁'], ['select', '點選方案'], ['order', '確認購買（建立訂單）'], ['redirect', '跳轉藍新付款頁'], ['payinfo', '取得繳費資訊'], ['paid', '已付款']];
function funnelReport(db, R) {
  const rows = db.prepare('SELECT f.step, f.pack, f.member, COUNT(DISTINCT f.player_id) u, SUM(f.n) n FROM pay_funnel f JOIN players p ON p.id=f.player_id WHERE p.is_demo=0 AND f.day>=? AND f.day<=? GROUP BY f.step, f.pack, f.member').all(R.fromDay, R.toDay);
  const uniq = (step, f = () => true) => db.prepare(`SELECT COUNT(DISTINCT f.player_id) u, COALESCE(SUM(f.n),0) n FROM pay_funnel f JOIN players p ON p.id=f.player_id WHERE p.is_demo=0 AND f.day>=? AND f.day<=? AND f.step=?`).get(R.fromDay, R.toDay, step);
  const steps = FUNNEL_ORDER.map(([k, name]) => { const a = uniq(k); return { step: k, name, users: a.u, events: a.n, members: rows.filter((r) => r.step === k && r.member).reduce((s, r) => s + r.u, 0), guests: rows.filter((r) => r.step === k && !r.member).reduce((s, r) => s + r.u, 0) }; });
  steps.forEach((s, i) => { s.fromPrev = i && steps[i - 1].users ? s.users / steps[i - 1].users : null; s.fromTop = steps[0].users ? s.users / steps[0].users : null; });
  const packs = {}; for (const r of rows) if (r.pack) { const p = packs[r.pack] || (packs[r.pack] = { pack: r.pack }); p[r.step] = (p[r.step] || 0) + r.u; }
  const extra = { registerBlock: uniq('register_block'), promptShow: uniq('prompt_show'), promptClick: uniq('prompt_click') };
  return { steps, packs: Object.values(packs).sort((a, b) => (b.paid || 0) - (a.paid || 0) || (b.select || 0) - (a.select || 0)), extra };
}

function summary(db, now = Date.now()) {
  const R = resolveRange({ range: 'today' }, now), r = payReport(db, { range: 'today' }, { now });
  const red = db.prepare(`SELECT COUNT(DISTINCT player_id) u FROM pay_funnel WHERE day=? AND step='redirect'`).get(R.today).u;
  const latest = db.prepare(`SELECT o.id, o.player_id playerId, o.product_name name, o.amount, o.payment_type, o.credited_at creditedAt, p.nickname, p.email FROM orders o JOIN players p ON p.id=o.player_id WHERE o.provider IN ${PROVS} AND o.credited_at IS NOT NULL AND p.is_demo=0 ORDER BY o.credited_at DESC LIMIT 5`).all().map((o) => ({ ...o, method: METHOD(o.payment_type) }));
  return { today: R.today, net: r.kpi.net, gross: r.kpi.gross, paidOrders: r.kpi.paidOrders, pending: r.kpi.pending, pendingAmount: r.kpi.pendingAmount, redirectToday: red, latest, lastPaidAt: latest[0] ? latest[0].creditedAt : 0, generatedAt: now };
}

function csv(db, q = {}, now = Date.now()) {
  const R = resolveRange(q, now);
  const rows = db.prepare(`SELECT o.*, p.is_demo, p.nickname FROM orders o JOIN players p ON p.id=o.player_id WHERE o.provider IN ${PROVS} AND o.created_at>=? AND o.created_at<? ORDER BY o.created_at`).all(R.from, R.to);
  const tf = (ms) => (ms ? new Date(ms + H8).toISOString().replace('T', ' ').slice(0, 19) : '');
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const head = ['訂單編號', '玩家ID', '暱稱', '方案', '類別', '金額NT$', '狀態', '付款方式', '金流', '建立(台北)', '付款(台北)', '退款(台北)', '示範玩家', '後台補入帳'];
  const lines = [head.join(',')];
  for (const o of rows) lines.push([o.id, o.player_id, o.nickname, o.product_name, CAT_NAME[catOf(o.sku)], o.amount, o.status, METHOD(o.payment_type), o.provider, tf(o.created_at), tf(o.credited_at ? (o.paid_at || o.credited_at) : null), tf(o.refunded_at), o.is_demo ? 'Y' : '', /\[後台補入帳\]/.test(o.note || '') ? 'Y' : ''].map(esc).join(','));
  return { filename: `revenue-${R.fromDay}_${R.toDay}.csv`, body: '\uFEFF' + lines.join('\r\n') + '\r\n' };
}

module.exports = { payReport, funnelReport, summary, csv, resolveRange, catOf, METHOD, dayOf };
