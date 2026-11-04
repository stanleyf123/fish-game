'use strict';
// BEACH-V1：每日簽到抽魚籤 ＋ 貝殼留言 ＋ 沙灘留言板 ＋ 我的貝殼
// - 以台北日期（players.day）切日；每位玩家每天簽到一次，伺服器抽籤、決定金幣。
// - 金幣用 players.grantToSave（伺服器寫入存檔、rev+1）發放，與任務／信箱獎勵同一條路，防作弊不會誤判。
// - 會員同時領取既有「會員每日簽到 💎」（player_onboard.daily_day，與 /api/newbie/daily 共用，不會重複發）。
// - 貝殼留言只有文字；伺服器清掉 HTML／控制字元、長度上限、髒話與網址過濾、限流；停權玩家無法呼叫（players.auth）。
// - PROFANITY-V1：含髒話的貝殼／回覆自動刪除（不公開、留紀錄）、記點並寄信箱通知；累計 3 次停權 7 天、到期自動解除（config.beach.profanityFilter.enabled=false 可關閉）。
// - 不會把任何人的魚放進別人的魚缸：沙灘只顯示文字貝殼。
const express = require('express');
const { HttpError, bad, RateLimiter } = require('./util');

const STYLES = [
  { id: 'coral', name: '珊瑚粉' }, { id: 'pearl', name: '珍珠白' }, { id: 'sea', name: '海玻璃藍' },
  { id: 'sunset', name: '夕陽橘' }, { id: 'lavender', name: '薰衣草紫' }, { id: 'mint', name: '薄荷綠' },
];
const TIERS = { 大吉: { coins: 200, weight: 10 }, 中吉: { coins: 150, weight: 20 }, 小吉: { coins: 100, weight: 30 }, 吉: { coins: 80, weight: 25 }, 末吉: { coins: 50, weight: 15 } };
const FORTUNES = [
  ['大吉', '今天適合繁殖，寶寶會特別可愛'], ['大吉', '金幣如泡泡般源源不絕'], ['大吉', '稀有魚正悄悄游向你'], ['大吉', '水質清澈，好運滿缸'], ['大吉', '貴人出現，好友會來幫你餵魚'], ['大吉', '圖鑑之神眷顧你'],
  ['中吉', '金魚運上升'], ['中吉', '魚兒吃得飽，心情也跟著好'], ['中吉', '今天換個造景，會有好事發生'], ['中吉', '小丑魚為你帶來笑容'], ['中吉', '努力收金幣，會有小驚喜'], ['中吉', '適合和好友分享快樂'],
  ['小吉', '慢慢游，也能游很遠'], ['小吉', '記得換水，好運會更順'], ['小吉', '一條小魚，也有大夢想'], ['小吉', '水草長得好，心也平靜'], ['小吉', '今天適合發呆賞魚'], ['小吉', '耐心等待，魚蛋終會孵化'],
  ['吉', '平平順順，就是最好的一天'], ['吉', '餵魚時多看牠們一眼'], ['吉', '泡泡會帶走煩惱'], ['吉', '小小的努力正在累積'], ['吉', '今天的魚缸特別安靜美好'], ['吉', '多喝水，魚兒也會開心'],
  ['末吉', '今天先休息，明天游更快'], ['末吉', '別忘了清潔魚缸喔'], ['末吉', '小心餵太多，魚會吃撐'], ['末吉', '慢一點沒關係，魚也在等你'], ['末吉', '雲會散，水會清'], ['末吉', '好運在下一個泡泡裡'],
].map(([tier, text], i) => ({ id: i + 1, tier, text }));
const DEF = { enabled: true, streakBonusPerDay: 10, streakBonusMaxDays: 7, maxLen: 40, reportHideAt: 3, reportMinAccountHours: 24, pageSize: 40 };

// 基本髒話／不當字詞（比對前先去掉空白與標點、轉小寫、全形轉半形）。只做基本把關，人工審核在後台。
const BAD_WORDS = ['幹你', '幹妳', '干你娘', '幹您娘', '操你', '操妳', '肏', '靠北', '靠杯', '靠腰', '雞掰', '機掰', '雞巴', '雞歪', '懶叫', '白癡', '白痴', '智障', '腦殘', '低能', '去死', '王八', '賤人', '賤貨', '婊子', '妓女', '他媽的', '他媽', '幹你媽', '屁眼', '傻逼', '傻b', '煞筆', '草泥馬', '尼瑪', '三小', '殺小', '垃圾人', '廢物', '畜生', '強姦', '性交', '做愛', '約炮', '援交',
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'asshole', 'nigger', 'nigga', 'porn', 'wtf', 'stfu', 'kys'];
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
function softBadWord(s) { const n = norm(s); return BAD_WORDS.some((w) => n.includes(norm(w))); }
// ---------- PROFANITY-V1：貝殼留言／回覆髒話自動刪除＋累計記點＋累計 3 次停權 7 天 ----------
// 比對前：NFKC（全形→半形）、小寫、去掉空白／標點／符號／零寬字元；英文以單字為單位另做 leet（0→o、1→i、3→e、4→a、5→s、7→t、@→a、$→s、!→i）與連續重複字母合併。
// 先把白名單詞（幹部、幹線、能幹、幹嘛、三小時、操作…）挖掉，再比對黑名單，避免誤判。
// 後台可另外新增黑名單／白名單（beach_mod_words，或 config.beach.profanityFilter.extraWords / allowWords）。
const PROF_DEF = { enabled: true, strikesToBan: 3, banDays: 7, dedupeMinutes: 10 };
const PROF_BLOCK = [
  // 幹 系列（單字「幹」→ 由白名單排除正常用法）
  '幹', '淦', 'ㄍㄋㄋ', 'ㄍㄢˋ', '姦你娘', '干林老師', '干林老师', '幹林老師',
  // 娘／媽
  '你娘', '妳娘', '您娘', '恁娘', '拎娘', '林娘', '你老母', '你媽的', '妳媽的', '他媽的', '她媽的', '你妈的', '他妈的', '草泥馬', '草泥马', '尼瑪', '尼玛',
  // 操／肏／屄
  '操你', '操妳', '操您', '操他', '操她', '我操', '操蛋', '操死', '操爆', '肏', '屄', '艹', '卧槽', '臥槽', '屌你',
  // 台語系
  '靠北', '靠杯', '靠腰', '靠夭', '靠么', '靠邀', '哭夭', '雞掰', '機掰', '雞歪', '機歪', '雞巴', '鸡巴', '基八', '懶叫', '懶覺', '卵叫', '殺小', '沙小', '啥小', '三小',
  // 人身攻擊
  '白痴', '白癡', '白痴', '北七', '智障', '腦殘', '脑残', '弱智', '傻逼', '傻b', '傻屄', '傻比', '煞筆', '沙比', '傻屌', '婊子', '賤人', '賤貨', '破麻',
  // English
  'fuck', 'fuk', 'fck', 'fuq', 'phuck', 'shit', 'bitch', 'biatch', 'cunt', 'asshole', 'dick', 'bastard', 'whore', 'slut', 'nigger', 'nigga',
];
const PROF_ALLOW = [
  '幹部', '幹線', '能幹', '才幹', '骨幹', '主幹', '樹幹', '軀幹', '枝幹', '莖幹', '幹事', '幹練', '幹勁', '精幹', '苦幹', '實幹', '巧幹', '蠻幹', '硬幹', '肯幹', '幹道', '幹員', '幹才', '幹細胞', '幹警', '幹將', '幹流', '幹渠', '幹校',
  '幹嘛', '幹嗎', '幹麻', '幹啥', '幹什麼', '幹甚麼', '幹什么', '幹活', '幹得好', '幹得不錯', '幹大事', '幹掉',
  '三小時', '三小时', '三小隻', '三小只', '三小朋友', '三小姐', '三小塊', '三小杯', '三小包', '娘家',
  '台北七', '臺北七', '東北七', '西北七', '北七星', '靠北邊', '靠北边', '殺小怪', '殺小兵', '殺小魚', '殺小蟲', '沙小姐', '操作', '操控', '操縱', '操纵', '操心', '操場', '操场', '操練', '操练', '體操', '体操', '早操', '做操', '節操', '情操', '操守', '操盤', '操刀', '操持', '操勞', '操劳', 'dickens',
];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const profNorm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}_\u200b-\u200f\u2060-\u2064\ufeff]+/gu, '');
let PROF_CUSTOM = { block: [], allow: [] };   // 後台新增的詞（Beach 啟動／修改時更新）
function profanityHits(text, extra = PROF_CUSTOM) {
  const words = [...new Set([...PROF_BLOCK, ...(extra.block || [])].map(profNorm).filter(Boolean))];
  const allow = [...new Set([...PROF_ALLOW, ...(extra.allow || [])].map(profNorm).filter(Boolean))].sort((a, b) => b.length - a.length);
  const strip = (n) => { for (const a of allow) n = n.split(a).join('\u3000'); return n; };
  const all = strip(profNorm(text));
  // 英文：以單字為單位（避免 "this hit" 被拼成 shit），再把 f u c k / f*ck 這種拆開的短片段黏回去
  const toks = String(text == null ? '' : text).normalize('NFKC').toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]).split(/[^a-z]+/).filter(Boolean);
  const glued = []; let run = '';
  for (const t of toks) { if (t.length <= 2) run += t; else { if (run) glued.push(run); run = ''; } }
  if (run) glued.push(run);
  const latin = [...toks, ...glued].flatMap((t) => [t, t.replace(/([a-z])\1+/g, '$1')]).map(strip);
  const hits = [];
  for (const w of words) { if (/^[a-z]+$/.test(w) ? latin.some((t) => t.includes(w)) : all.includes(w)) hits.push(w); }
  return hits;
}
const tpe = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`; };
// 暱稱過濾（players.setNickname）也用這個：舊的不雅字詞 ＋ PROFANITY-V1 髒話清單（含白名單）
function badWord(s) { return softBadWord(s) || profanityHits(s).length > 0; }
// 網址／聯絡方式（防詐騙、廣告）
const LINKY = /(https?:|www\.|\.(com|net|org|tw|cc|io|me|xyz|top|ly)\b|line\s*id|加line|加賴|@\w{3,}|\d{7,}|t\.me|discord\.gg)/i;
function cleanMessage(raw, maxLen) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<[^>]*>?/g, '');                                     // HTML 標籤
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, ' ');   // 控制字元、零寬字元、方向控制
  s = s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  if (chars.length > maxLen) throw bad('too_long', `留言最多 ${maxLen} 個字`);
  return s;
}
const prevDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const nextDayStart = (d) => Date.parse(d + 'T00:00:00+08:00') + 86400000;

class Beach {
  constructor(ctx) {
    this.ctx = ctx; this.db = ctx.db; this.players = ctx.players; this.now = () => Date.now();
    this.db.exec(`
CREATE TABLE IF NOT EXISTS beach_checkins (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL,
  fortune_id INTEGER NOT NULL, tier TEXT NOT NULL, text TEXT NOT NULL, coins INTEGER NOT NULL, gems INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (player_id, day));
CREATE TABLE IF NOT EXISTS beach_shells (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, day TEXT NOT NULL,
  style TEXT NOT NULL, message TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '', likes INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible', hidden_reason TEXT, reviewed_at INTEGER, ip TEXT, created_at INTEGER NOT NULL, UNIQUE (player_id, day));
CREATE INDEX IF NOT EXISTS idx_beach_shells_day ON beach_shells(day, status, id);
CREATE INDEX IF NOT EXISTS idx_beach_shells_player ON beach_shells(player_id, id);
CREATE INDEX IF NOT EXISTS idx_beach_shells_reports ON beach_shells(reports, id);
CREATE TABLE IF NOT EXISTS beach_replies(id INTEGER PRIMARY KEY AUTOINCREMENT,shell_id INTEGER NOT NULL REFERENCES beach_shells(id) ON DELETE CASCADE,player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,message TEXT NOT NULL,request_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'visible',reports INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,reviewed_at INTEGER,UNIQUE(player_id,request_id));
CREATE INDEX IF NOT EXISTS idx_beach_replies_shell ON beach_replies(shell_id,status,id);
CREATE INDEX IF NOT EXISTS idx_beach_replies_player_time ON beach_replies(player_id,created_at);
CREATE TABLE IF NOT EXISTS beach_reply_reports(reply_id INTEGER NOT NULL REFERENCES beach_replies(id) ON DELETE CASCADE,player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,reason TEXT NOT NULL,counted INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(reply_id,player_id));
CREATE TABLE IF NOT EXISTS beach_likes (shell_id INTEGER NOT NULL REFERENCES beach_shells(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (shell_id, player_id));
CREATE TABLE IF NOT EXISTS beach_reports (shell_id INTEGER NOT NULL REFERENCES beach_shells(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, reason TEXT NOT NULL DEFAULT '', counted INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, PRIMARY KEY (shell_id, player_id));
CREATE TABLE IF NOT EXISTS beach_mod_strikes (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, strikes INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, bans INTEGER NOT NULL DEFAULT 0, last_at INTEGER, ban_started_at INTEGER, ban_until INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS beach_mod_log (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, kind TEXT NOT NULL, shell_id INTEGER, request_id TEXT, message TEXT NOT NULL, words TEXT NOT NULL, counted INTEGER NOT NULL, strikes INTEGER NOT NULL, banned_until INTEGER, ip TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_beach_mod_log_player ON beach_mod_log(player_id, created_at);
CREATE TABLE IF NOT EXISTS beach_mod_words (word TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('block','allow')), created_at INTEGER NOT NULL, PRIMARY KEY (word, kind));
`);
    this.loadWords();
  }
  // ---------- PROFANITY-V1 ----------
  profCfg() { const c = (this.cfg().profanityFilter) || {}, n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : d);
    return { enabled: c.enabled !== false, strikesToBan: n(c.strikesToBan, PROF_DEF.strikesToBan, 1, 20), banDays: n(c.banDays, PROF_DEF.banDays, 1, 365), dedupeMinutes: n(c.dedupeMinutes, PROF_DEF.dedupeMinutes, 0, 1440),
      extraWords: Array.isArray(c.extraWords) ? c.extraWords.map(String) : [], allowWords: Array.isArray(c.allowWords) ? c.allowWords.map(String) : [] }; }
  loadWords() { const rows = this.db.prepare('SELECT word, kind FROM beach_mod_words ORDER BY word').all(); PROF_CUSTOM = { block: rows.filter((r) => r.kind === 'block').map((r) => r.word), allow: rows.filter((r) => r.kind === 'allow').map((r) => r.word) }; return PROF_CUSTOM; }
  profHits(text) { const pc = this.profCfg(); return profanityHits(text, { block: [...PROF_CUSTOM.block, ...pc.extraWords], allow: [...PROF_CUSTOM.allow, ...pc.allowWords] }); }
  sysAudit(action, pid, detail) { this.db.prepare('INSERT INTO audit_log (at, action, target, detail, ip) VALUES (?,?,?,?,?)').run(this.now(), action, 'player:' + pid, JSON.stringify(detail).slice(0, 8000), 'system'); }
  notify(pid, title, body) { // 信箱純文字通知（沒有附件，玩家可直接刪除）
    const rid = Number(this.db.prepare("INSERT INTO rewards (title, body, target, recipients, created_at) VALUES (?,?,'player',1,?)").run(title, body, this.now()).lastInsertRowid);
    this.db.prepare('INSERT OR IGNORE INTO reward_targets (reward_id, player_id) VALUES (?,?)').run(rid, pid); return rid; }
  // 含髒話：不寫入貝殼／回覆（任何人都看不到），記錄到 beach_mod_log 供後台稽核，記點；達門檻停權 N 天（players.banned_at，到期自動解除）
  moderate(pid, kind, message, words, meta = {}) {
    const pc = this.profCfg(), label = kind === 'reply' ? '貝殼回覆' : '貝殼留言';
    const out = this.db.transaction(() => {
      const t = this.now();
      const dup = this.db.prepare('SELECT id FROM beach_mod_log WHERE player_id=? AND ((request_id IS NOT NULL AND request_id=?) OR (kind=? AND message=? AND created_at>=?)) LIMIT 1').get(pid, meta.requestId || null, kind, message, t - pc.dedupeMinutes * 60000);
      let row = this.db.prepare('SELECT * FROM beach_mod_strikes WHERE player_id=?').get(pid);
      if (!row) { this.db.prepare('INSERT INTO beach_mod_strikes (player_id, updated_at) VALUES (?,?)').run(pid, t); row = this.db.prepare('SELECT * FROM beach_mod_strikes WHERE player_id=?').get(pid); }
      let strikes = row.strikes, banUntil = null;
      if (!dup) {
        strikes = row.strikes + 1;
        if (strikes >= pc.strikesToBan) {
          banUntil = t + pc.banDays * 86400000;
          const reason = `沙灘${label}累計 ${pc.strikesToBan} 次不當用語，停權 ${pc.banDays} 天，將於 ${tpe(banUntil)}（台北時間）自動解除`;
          const b = this.db.prepare('UPDATE players SET banned_at=?, ban_reason=? WHERE id=? AND banned_at IS NULL').run(t, reason, pid);
          this.db.prepare('UPDATE beach_mod_strikes SET strikes=0, total=total+1, bans=bans+1, last_at=?, ban_started_at=?, ban_until=?, updated_at=? WHERE player_id=?').run(t, b.changes ? t : null, b.changes ? banUntil : null, t, pid);
          this.players.logEvent(pid, 'banned', { reason, auto: 'beach_profanity', until: banUntil });
        } else this.db.prepare('UPDATE beach_mod_strikes SET strikes=?, total=total+1, last_at=?, updated_at=? WHERE player_id=?').run(strikes, t, t, pid);
      }
      const logId = Number(this.db.prepare('INSERT INTO beach_mod_log (player_id, kind, shell_id, request_id, message, words, counted, strikes, banned_until, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(pid, kind, meta.shellId || null, meta.requestId || null, message, JSON.stringify(words), dup ? 0 : 1, banUntil ? pc.strikesToBan : strikes, banUntil, meta.ip ? String(meta.ip).slice(0, 64) : null, t).lastInsertRowid);
      this.players.logEvent(pid, 'beach_profanity', { kind, logId, words, counted: !dup, strikes: banUntil ? pc.strikesToBan : strikes, banUntil });
      this.sysAudit(banUntil ? 'beach.profanity.ban' : 'beach.profanity.remove', pid, { logId, kind, shellId: meta.shellId || null, words, counted: !dup, strikes: banUntil ? pc.strikesToBan : strikes, max: pc.strikesToBan, banUntil });
      if (!dup) {
        if (banUntil) this.notify(pid, '⛔ 帳號停權通知', `你的${label}含有不當用語，已被系統自動刪除。不當用語已累計 ${pc.strikesToBan} 次，帳號停權 ${pc.banDays} 天，將於 ${tpe(banUntil)}（台北時間）自動解除，屆時次數歸零。請大家一起維護友善的沙灘，謝謝！`);
        else this.notify(pid, '⚠️ 貝殼留言提醒', `你的${label}含有不當用語，已被系統自動刪除。目前累計 ${strikes}/${pc.strikesToBan} 次，累計 ${pc.strikesToBan} 次將停權 ${pc.banDays} 天。請友善留言，謝謝！`);
      }
      return { strikes: banUntil ? pc.strikesToBan : strikes, banUntil, counted: !dup, logId };
    })();
    const max = pc.strikesToBan;
    if (out.banUntil) throw new HttpError(403, 'profanity_banned', `你的${label}含有不當用語，已被刪除。累計已達 ${max} 次，帳號停權 ${pc.banDays} 天，至 ${tpe(out.banUntil)}（台北時間）自動解除。`, { strikes: max, max, banUntil: out.banUntil });
    throw new HttpError(422, 'profanity_removed', `你的${label}含有不當用語，已被刪除。目前累計 ${out.strikes}/${max} 次，累計 ${max} 次將停權 ${pc.banDays} 天。`, { strikes: out.strikes, max, counted: out.counted });
  }
  // 到期自動解除（只解除本功能下的停權；若管理員之後改成手動停權，banned_at 不同就不動）
  liftExpired() {
    const t = this.now(), rows = this.db.prepare('SELECT * FROM beach_mod_strikes WHERE ban_until IS NOT NULL AND ban_until<=?').all(t); let n = 0;
    for (const r of rows) this.db.transaction(() => {
      const u = this.db.prepare('UPDATE players SET banned_at=NULL, ban_reason=NULL WHERE id=? AND banned_at=?').run(r.player_id, r.ban_started_at);
      this.db.prepare('UPDATE beach_mod_strikes SET ban_until=NULL, ban_started_at=NULL, updated_at=? WHERE player_id=?').run(t, r.player_id);
      if (u.changes) { n++; this.players.logEvent(r.player_id, 'unbanned', { auto: 'beach_profanity' }); this.notify(r.player_id, '✅ 帳號已恢復', '你的帳號停權期已結束，已自動恢復。不當用語次數已歸零，歡迎回到沙灘，請友善留言喔！'); }
      this.sysAudit('beach.profanity.autounban', r.player_id, { lifted: !!u.changes, banUntil: r.ban_until });
    })();
    return n;
  }
  adminProfanity(q = {}) {
    const pc = this.profCfg(), before = Number(q.before) > 0 ? Number(q.before) : 2 ** 53, pq = String(q.player || '').replace(/^#/, ''), pid = /^\d+$/.test(pq) ? Number(pq) : null;
    const log = this.db.prepare(`SELECT l.*, p.nickname FROM beach_mod_log l JOIN players p ON p.id=l.player_id WHERE l.id<? ${pid ? 'AND l.player_id=?' : ''} ORDER BY l.id DESC LIMIT 51`).all(...(pid ? [before, pid] : [before]));
    const more = log.length > 50; if (more) log.pop();
    const players = this.db.prepare(`SELECT m.*, p.nickname, p.banned_at, p.ban_reason FROM beach_mod_strikes m JOIN players p ON p.id=m.player_id WHERE m.strikes>0 OR m.ban_until IS NOT NULL OR m.total>0 ${pid ? 'OR m.player_id=?' : ''} ORDER BY (m.ban_until IS NOT NULL) DESC, m.strikes DESC, m.updated_at DESC LIMIT 200`).all(...(pid ? [pid] : []));
    return { config: { enabled: pc.enabled, strikesToBan: pc.strikesToBan, banDays: pc.banDays, dedupeMinutes: pc.dedupeMinutes, extraWords: pc.extraWords, allowWords: pc.allowWords },
      words: { defaultBlock: PROF_BLOCK, defaultAllow: PROF_ALLOW, customBlock: PROF_CUSTOM.block, customAllow: PROF_CUSTOM.allow },
      players: players.map((r) => ({ playerId: r.player_id, nickname: this.displayName({ id: r.player_id, nickname: r.nickname }), strikes: r.strikes, total: r.total, bans: r.bans, lastAt: r.last_at, banUntil: r.ban_until, banned: !!r.banned_at, banReason: r.ban_reason })),
      log: log.map((l) => ({ id: l.id, playerId: l.player_id, nickname: this.displayName({ id: l.player_id, nickname: l.nickname }), kind: l.kind, shellId: l.shell_id, message: l.message, words: JSON.parse(l.words || '[]'), counted: !!l.counted, strikes: l.strikes, bannedUntil: l.banned_until, createdAt: l.created_at })),
      next: more ? log[log.length - 1].id : null };
  }
  adminClearStrikes(pid) { pid = Number(pid) || 0; if (!this.players.get(pid)) throw new HttpError(404, 'not_found', '找不到玩家'); const r = this.db.prepare('SELECT strikes FROM beach_mod_strikes WHERE player_id=?').get(pid); this.db.prepare('UPDATE beach_mod_strikes SET strikes=0, updated_at=? WHERE player_id=?').run(this.now(), pid); return { playerId: pid, before: r ? r.strikes : 0, strikes: 0 }; }
  adminUnban(pid) { pid = Number(pid) || 0; const r = this.db.prepare('SELECT * FROM beach_mod_strikes WHERE player_id=?').get(pid); if (!r || r.ban_until == null) throw new HttpError(409, 'not_banned', '這位玩家目前沒有不當用語停權（其他停權請到玩家頁處理）');
    return this.db.transaction(() => { const u = this.db.prepare('UPDATE players SET banned_at=NULL, ban_reason=NULL WHERE id=? AND banned_at=?').run(pid, r.ban_started_at); this.db.prepare('UPDATE beach_mod_strikes SET ban_until=NULL, ban_started_at=NULL, strikes=0, updated_at=? WHERE player_id=?').run(this.now(), pid); if (u.changes) this.players.logEvent(pid, 'unbanned', { by: 'admin', from: 'beach_profanity' }); return { playerId: pid, unbanned: !!u.changes }; })(); }
  adminWord(body = {}) { const kind = body.kind === 'allow' ? 'allow' : 'block', word = String(body.word || '').normalize('NFKC').trim().slice(0, 20), action = body.action === 'remove' ? 'remove' : 'add';
    if (!profNorm(word)) throw bad('word', '請輸入字詞（標點與空白會被忽略）');
    if (action === 'add') this.db.prepare('INSERT OR IGNORE INTO beach_mod_words (word, kind, created_at) VALUES (?,?,?)').run(word, kind, this.now()); else this.db.prepare('DELETE FROM beach_mod_words WHERE word=? AND kind=?').run(word, kind);
    return { word, kind, action, words: this.loadWords() }; }
  cfg() { const c = (this.ctx.configStore.active().config || {}).beach || {}; return { ...DEF, ...c }; }
  day(t = this.now()) { return this.players.day(t); }
  member(p) { return !!(p && p.username); }
  // 公開顯示名稱：與好友系統相同（空白 → 魚友#ID）；暱稱若就是信箱帳號前綴，也改用 魚友#ID，避免在公開沙灘露出信箱
  displayName(p) { const n = String(p.nickname || '').trim().slice(0, 16), local = String(p.email || '').split('@')[0]; return !n || (local && n.toLowerCase() === local.toLowerCase().slice(0, 20)) ? '魚友#' + p.id : n; }
  coinsFor(tier, streak) { const c = this.cfg(); return TIERS[tier].coins + Math.min(Math.max(0, streak - 1), c.streakBonusMaxDays) * c.streakBonusPerDay; }
  drawFortune() {
    const total = Object.values(TIERS).reduce((a, t) => a + t.weight, 0); let r = Math.random() * total, tier = '末吉';
    for (const [k, t] of Object.entries(TIERS)) { if ((r -= t.weight) < 0) { tier = k; break; } }
    const pool = FORTUNES.filter((f) => f.tier === tier); return pool[Math.floor(Math.random() * pool.length)];
  }
  checkinRow(pid, d) { return this.db.prepare('SELECT * FROM beach_checkins WHERE player_id=? AND day=?').get(pid, d); }
  shellPub(s, me) {
    if (!s) return null;
    return { id: s.id, day: s.day, style: s.style, message: s.message, nickname: s.nickname || '魚友', likes: s.likes, mine: s.player_id === me, liked: !!s.liked, reported: !!s.reported, createdAt: s.created_at };
  }
  status(pid) {
    const c = this.cfg(), t = this.now(), d = this.day(t), p = this.players.get(pid), today = this.checkinRow(pid, d), y = today ? null : this.checkinRow(pid, prevDay(d));
    const shell = this.db.prepare('SELECT * FROM beach_shells WHERE player_id=? AND day=?').get(pid, d);
    const streak = today ? today.streak : (y ? y.streak : 0);
    const nextStreak = today ? today.streak : (y ? y.streak + 1 : 1);
    const nb = this.ctx.newbie ? this.ctx.newbie.cfg() : { dailyGems: 0 };
    return { enabled: c.enabled !== false, day: d, resetAt: nextDayStart(d), checkedIn: !!today, member: this.member(p), streak, nextStreak,
      today: today ? { fortune: { id: today.fortune_id, tier: today.tier, text: today.text }, coins: today.coins, gems: today.gems, streak: today.streak } : null,
      preview: { minCoins: this.coinsFor('末吉', nextStreak), maxCoins: this.coinsFor('大吉', nextStreak), memberGems: this.member(p) ? nb.dailyGems || 0 : 0, dailyGems: nb.dailyGems || 0 },
      shell: shell ? { ...this.shellPub(shell, pid), status: shell.status } : null, canWrite: !!today && !shell,
      styles: STYLES, maxLen: c.maxLen, tiers: Object.entries(TIERS).map(([k, v]) => ({ tier: k, coins: v.coins, chance: v.weight })), rev: this.players.getSave(pid).rev };
  }
  // 簽到＋抽籤（可選擇一起寫貝殼）
  checkin(pid, body = {}) {
    const c = this.cfg(); if (c.enabled === false) throw new HttpError(403, 'disabled', '沙灘簽到暫停中');
    // 先驗證留言（錯誤時整筆不簽到，玩家可以修改後重送）
    const wantShell = body.shell && typeof body.shell === 'object' && String(body.shell.message || '').trim() !== '';
    const shell = wantShell ? this.validShell(body.shell) : null;
    if (shell && shell.profane) this.moderate(pid, 'shell', shell.message, shell.profane, { ip: body.ip });   // 一律丟出錯誤，整筆不簽到
    const out = this.db.transaction(() => {
      const t = this.now(), d = this.day(t), p = this.players.get(pid), have = this.checkinRow(pid, d);
      if (have) return { already: true };
      const row = this.players.getSave(pid);
      if (!row.save) throw new HttpError(409, 'no_save', '請先同步魚缸再簽到');
      if (body.rev != null && row.rev !== body.rev) throw new HttpError(409, 'conflict', '魚缸已更新，請重新簽到');
      const y = this.checkinRow(pid, prevDay(d)), streak = y ? y.streak + 1 : 1, f = this.drawFortune(), coins = this.coinsFor(f.tier, streak);
      // 會員每日 💎（沿用 newbie 的每日簽到紀錄，兩邊共用 daily_day，不會重複）
      let gems = 0; const nb = this.ctx.newbie;
      if (nb && this.member(p)) { const nc = nb.cfg(); if (nc.dailyGems > 0) { const r = nb.row(pid); if (r.daily_day !== d) { this.db.prepare('UPDATE player_onboard SET daily_day=? WHERE player_id=?').run(d, pid); this.ctx.commerce.ledger(pid, nc.dailyGems, 'bonus:daily', d); gems = nc.dailyGems; } } }
      this.db.prepare('INSERT INTO beach_checkins (player_id, day, fortune_id, tier, text, coins, gems, streak, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(pid, d, f.id, f.tier, f.text, coins, gems, streak, t);
      const grant = this.players.grantToSave(pid, { coins });
      this.players.logEvent(pid, 'beach_checkin', { day: d, tier: f.tier, coins, gems, streak });
      let s = null; if (shell) s = this.insertShell(pid, p, d, shell, body.ip, t);
      return { save: grant.save, rev: grant.rev, fortune: { id: f.id, tier: f.tier, text: f.text }, coins, gems, streak, shellId: s };
    })();
    if (out.already) throw new HttpError(409, 'already_checked_in', '今天已經簽到過了，明天再來抽魚籤', { status: this.status(pid) });
    const st = this.status(pid);
    return { ok: true, ...out, status: st, gemBalance: this.ctx.commerce ? this.ctx.commerce.balance(pid) : undefined };
  }
  validShell(sh) {
    const c = this.cfg(), style = String(sh.style || '');
    if (c.enabled === false) throw new HttpError(403, 'disabled', '沙灘暫停中');
    if (!STYLES.some((x) => x.id === style)) throw bad('style', '請選擇貝殼樣式');
    const message = cleanMessage(sh.message, c.maxLen);
    if (!message) throw bad('empty', '請輸入留言');
    const profane = this.profCfg().enabled ? this.profHits(message) : [];
    if (profane.length) return { style, message, profane };
    if (softBadWord(message)) throw bad('bad_words', '留言含有不適當的字詞，請修改後再送出');
    if (LINKY.test(message)) throw bad('no_links', '貝殼上不能留網址、帳號或電話號碼');
    return { style, message };
  }
  insertShell(pid, p, d, sh, ip, t) {
    try { return Number(this.db.prepare('INSERT INTO beach_shells (player_id, day, style, message, nickname, ip, created_at) VALUES (?,?,?,?,?,?,?)').run(pid, d, sh.style, sh.message, this.displayName(p), ip ? String(ip).slice(0, 64) : null, t).lastInsertRowid); }
    catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'already_written', '今天已經寫過貝殼了'); throw e; }
  }
  writeShell(pid, body = {}, ip) {
    const c = this.cfg(); if (c.enabled === false) throw new HttpError(403, 'disabled', '沙灘暫停中');
    const sh = this.validShell(body), t = this.now(), d = this.day(t);
    if (!this.checkinRow(pid, d)) throw new HttpError(409, 'not_checked_in', '先簽到抽魚籤，才能在貝殼上留言');
    if (sh.profane) this.moderate(pid, 'shell', sh.message, sh.profane, { ip });
    const id = this.insertShell(pid, this.players.get(pid), d, sh, ip, t);
    this.players.logEvent(pid, 'beach_shell', { day: d, id });
    return { ok: true, shell: { ...this.shellPub(this.db.prepare('SELECT * FROM beach_shells WHERE id=?').get(id), pid), status: 'visible' } };
  }
  board(pid, q = {}) {
    const c = this.cfg(), d = this.day(), lim = Math.max(1, Math.min(60, Number(q.limit) || c.pageSize)), before = Number(q.before) > 0 ? Number(q.before) : 2 ** 53;
    const rows = this.db.prepare(`SELECT s.*, p.nickname cur_nick, p.email cur_email, (SELECT 1 FROM beach_likes l WHERE l.shell_id=s.id AND l.player_id=?) liked, (SELECT 1 FROM beach_reports r WHERE r.shell_id=s.id AND r.player_id=?) reported
      FROM beach_shells s JOIN players p ON p.id=s.player_id WHERE s.day=? AND s.status='visible' AND s.id<? AND p.banned_at IS NULL ORDER BY s.id DESC LIMIT ?`).all(pid, pid, d, before, lim + 1);
    const more = rows.length > lim; if (more) rows.pop();
    const total = before === 2 ** 53 ? this.db.prepare("SELECT COUNT(*) n FROM beach_shells s JOIN players p ON p.id=s.player_id WHERE s.day=? AND s.status='visible' AND p.banned_at IS NULL").get(d).n : undefined;
    return { day: d, resetAt: nextDayStart(d), shells: rows.map((r) => this.shellPub({ ...r, nickname: this.displayName({ id: r.player_id, nickname: r.cur_nick, email: r.cur_email }) }, pid)), next: more ? rows[rows.length - 1].id : null, total };
  }
  todayShell(id) {
    const s = this.db.prepare('SELECT s.*, p.banned_at FROM beach_shells s JOIN players p ON p.id=s.player_id WHERE s.id=?').get(Number(id) || 0);
    if (!s || s.day !== this.day() || s.status !== 'visible' || s.banned_at) throw new HttpError(404, 'not_found', '這個貝殼已經被海浪帶走了');
    return s;
  }
  like(pid, id) {
    return this.db.transaction(() => {
      const s = this.todayShell(id);
      if (s.player_id === pid) throw new HttpError(409, 'own_shell', '不能幫自己的貝殼按讚');
      const r = this.db.prepare('INSERT OR IGNORE INTO beach_likes (shell_id, player_id, created_at) VALUES (?,?,?)').run(s.id, pid, this.now());
      if (r.changes) this.db.prepare('UPDATE beach_shells SET likes=likes+1 WHERE id=?').run(s.id);
      return { ok: true, liked: true, likes: this.db.prepare('SELECT likes FROM beach_shells WHERE id=?').get(s.id).likes, already: !r.changes };
    })();
  }
  report(pid, id, reason) {
    const c = this.cfg(), p = this.players.get(pid);
    return this.db.transaction(() => {
      const s = this.todayShell(id);
      if (s.player_id === pid) throw new HttpError(409, 'own_shell', '不能檢舉自己的貝殼');
      // 新建立的訪客帳號檢舉只記錄、不計入自動隱藏門檻（防止開小號惡意檢舉）
      const counted = this.member(p) || this.now() - p.created_at >= c.reportMinAccountHours * 3600e3 ? 1 : 0;
      const r = this.db.prepare('INSERT OR IGNORE INTO beach_reports (shell_id, player_id, reason, counted, created_at) VALUES (?,?,?,?,?)').run(s.id, pid, String(reason || '').replace(/<[^>]*>?/g, '').slice(0, 60), counted, this.now());
      let hidden = false;
      if (r.changes && counted) {
        this.db.prepare('UPDATE beach_shells SET reports=reports+1 WHERE id=?').run(s.id);
        const n = this.db.prepare('SELECT reports FROM beach_shells WHERE id=?').get(s.id).reports;
        if (n >= c.reportHideAt) { this.db.prepare("UPDATE beach_shells SET status='hidden', hidden_reason='reports' WHERE id=? AND status='visible'").run(s.id); hidden = true; }
      }
      return { ok: true, reported: true, hidden };
    })();
  }
  replyParent(pid,id,write=false){
    const s=this.db.prepare('SELECT s.*,p.banned_at,p.nickname cur_nick,p.email cur_email FROM beach_shells s JOIN players p ON p.id=s.player_id WHERE s.id=?').get(Number(id)||0);
    if(!s||s.status!=='visible'||s.banned_at||(s.day!==this.day()&&(write||s.player_id!==pid)))throw new HttpError(404,'not_found','這個貝殼目前無法回覆');
    return s;
  }
  replyPub(r,pid){return{id:r.id,message:r.message,nickname:this.displayName({id:r.player_id,nickname:r.cur_nick,email:r.cur_email}),mine:r.player_id===pid,reported:!!r.reported,createdAt:r.created_at};}
  replies(pid,id,q={}){
    const s=this.replyParent(pid,id),after=Number(q.after)||0,limit=30;
    if(!Number.isSafeInteger(after)||after<0)throw bad('cursor','請重新開啟回覆');
    const rows=this.db.prepare(`SELECT r.*,p.nickname cur_nick,p.email cur_email,(SELECT 1 FROM beach_reply_reports x WHERE x.reply_id=r.id AND x.player_id=?) reported FROM beach_replies r JOIN players p ON p.id=r.player_id WHERE r.shell_id=? AND r.status='visible' AND p.banned_at IS NULL AND r.id>? ORDER BY r.id LIMIT ?`).all(pid,s.id,after,limit+1);
    const more=rows.length>limit;if(more)rows.pop();
    return{shell:this.shellPub({...s,nickname:this.displayName({id:s.player_id,nickname:s.cur_nick,email:s.cur_email})},pid),items:rows.map(r=>this.replyPub(r,pid)),next:more?rows[rows.length-1].id:null,canReply:s.day===this.day()&&!!this.checkinRow(pid,this.day()),maxLen:120};
  }
  addReply(pid,id,body={},ip){
    if(this.profCfg().enabled){const s=this.replyParent(pid,id,true),key=body.requestId,message=cleanMessage(body.message,120);
      if(typeof key==='string'&&/^br_[a-zA-Z0-9_-]{12,80}$/.test(key)&&message&&!this.db.prepare('SELECT 1 FROM beach_replies WHERE player_id=? AND request_id=?').get(pid,key)&&this.checkinRow(pid,this.day())){const w=this.profHits(message);if(w.length)this.moderate(pid,'reply',message,w,{shellId:s.id,requestId:key,ip});}}
    return this.db.transaction(()=>{
    const s=this.replyParent(pid,id,true),key=body.requestId,message=cleanMessage(body.message,120);
    if(typeof key!=='string'||!/^br_[a-zA-Z0-9_-]{12,80}$/.test(key))throw bad('request','請重新開啟回覆');
    const prior=this.db.prepare('SELECT * FROM beach_replies WHERE player_id=? AND request_id=?').get(pid,key);
    if(prior){if(prior.shell_id!==s.id||prior.message!==message)throw new HttpError(409,'request_conflict','請重新確認回覆內容');return{ok:true,id:prior.id,reused:true};}
    if(!message)throw bad('empty','請輸入回覆');if(softBadWord(message))throw bad('bad_words','回覆含有不適當的字詞，請修改');if(LINKY.test(message))throw bad('no_links','回覆不能留網址、帳號或電話號碼');
    if(!this.checkinRow(pid,this.day()))throw new HttpError(409,'not_checked_in','先簽到抽魚籤，就能和大家聊天');
    const t=this.now(),last=this.db.prepare('SELECT MAX(created_at) t,COUNT(*) n FROM beach_replies WHERE player_id=? AND created_at>=?').get(pid,nextDayStart(this.day())-86400000);
    if(last.n>=50)throw new HttpError(429,'daily_limit','今天的回覆已達上限，明天再來聊');if(last.t&&t-last.t<10000)throw new HttpError(429,'reply_cooldown','慢一點，請稍等幾秒再回覆');
    const rid=Number(this.db.prepare('INSERT INTO beach_replies(shell_id,player_id,message,request_id,created_at) VALUES(?,?,?,?,?)').run(s.id,pid,message,key,t).lastInsertRowid);
    this.players.logEvent(pid,'beach_reply',{shellId:s.id,replyId:rid});return{ok:true,id:rid,reused:false};
  })();}
  reportReply(pid,id,reason){return this.db.transaction(()=>{
    const r=this.db.prepare("SELECT * FROM beach_replies WHERE id=? AND status='visible'").get(Number(id)||0);if(!r)throw new HttpError(404,'not_found','這則回覆已不存在');this.replyParent(pid,r.shell_id);if(r.player_id===pid)throw bad('own_reply','不能檢舉自己的回覆');
    const p=this.players.get(pid),c=this.cfg(),counted=this.member(p)||this.now()-p.created_at>=c.reportMinAccountHours*3600e3?1:0;
    const ins=this.db.prepare('INSERT OR IGNORE INTO beach_reply_reports VALUES(?,?,?,?,?)').run(r.id,pid,cleanMessage(reason||'不適當內容',60),counted,this.now());
    if(ins.changes&&counted)this.db.prepare("UPDATE beach_replies SET reports=reports+1,status=CASE WHEN reports+1>=? THEN 'hidden' ELSE status END WHERE id=?").run(c.reportHideAt,r.id);
    return{ok:true,hidden:this.db.prepare('SELECT status FROM beach_replies WHERE id=?').get(r.id).status!=='visible'};
  })();}
  deleteReply(pid,id){const r=this.db.prepare('SELECT * FROM beach_replies WHERE id=? AND player_id=?').get(Number(id)||0,pid);if(!r)throw new HttpError(404,'not_found','找不到你的回覆');this.db.prepare("UPDATE beach_replies SET status='deleted' WHERE id=?").run(r.id);return{ok:true};}
  adminReplies(q={}){const view=['all','reported','hidden'].includes(q.view)?q.view:'reported',before=Number(q.before)||Number.MAX_SAFE_INTEGER,where=view==='hidden'?"r.status='hidden'":view==='reported'?"r.reports>0 AND r.status!='deleted'":'1=1';const rows=this.db.prepare(`SELECT r.*,p.nickname,s.message parentMessage FROM beach_replies r JOIN players p ON p.id=r.player_id JOIN beach_shells s ON s.id=r.shell_id WHERE ${where} AND r.id<? ORDER BY r.id DESC LIMIT 51`).all(before);const more=rows.length>50;if(more)rows.pop();return{items:rows.map(r=>({id:r.id,shellId:r.shell_id,playerId:r.player_id,nickname:this.displayName({id:r.player_id,nickname:r.nickname}),message:r.message,parentMessage:r.parentMessage,status:r.status,reports:r.reports,createdAt:r.created_at})),next:more?rows[rows.length-1].id:null};}
  adminReplySet(id,action){const map={hide:'hidden',unhide:'visible',delete:'deleted'};if(!map[action])throw bad('action','未知操作');const r=this.db.prepare('SELECT * FROM beach_replies WHERE id=?').get(Number(id)||0);if(!r)throw new HttpError(404,'not_found','回覆不存在');if(r.status==='deleted'&&action!=='delete')throw bad('deleted','已移除的回覆無法公開');this.db.transaction(()=>{this.db.prepare(`UPDATE beach_replies SET status=?,reports=CASE WHEN ?='visible' THEN 0 ELSE reports END,reviewed_at=? WHERE id=?`).run(map[action],map[action],this.now(),r.id);if(action==='unhide')this.db.prepare('DELETE FROM beach_reply_reports WHERE reply_id=?').run(r.id)})();return{id:r.id,playerId:r.player_id,status:map[action]};}

  mine(pid, q = {}) {
    const lim = Math.max(1, Math.min(50, Number(q.limit) || 20)), before = /^\d{4}-\d{2}-\d{2}$/.test(String(q.before || '')) ? String(q.before) : '9999-12-31', d = this.day();
    // 以簽到紀錄為主（每天一筆），附上當天的貝殼
    const rows = this.db.prepare(`SELECT c.day, c.tier, c.text, c.coins, c.gems, c.streak, s.id sid, s.style, s.message, s.likes, s.status, s.hidden_reason
      FROM beach_checkins c LEFT JOIN beach_shells s ON s.player_id=c.player_id AND s.day=c.day WHERE c.player_id=? AND c.day<? ORDER BY c.day DESC LIMIT ?`).all(pid, before, lim + 1);
    const more = rows.length > lim; if (more) rows.pop();
    return { today: d, items: rows.map((r) => ({ day: r.day, isToday: r.day === d, fortune: { tier: r.tier, text: r.text }, coins: r.coins, gems: r.gems, streak: r.streak,
      shell: r.sid ? { id: r.sid, style: r.style, message: r.status === 'deleted' ? '' : r.message, likes: r.likes, status: r.status } : null })), next: more ? rows[rows.length - 1].day : null };
  }
  // ---------- 後台 ----------
  adminList(q = {}) {
    const view = ['today', 'reported', 'hidden', 'all'].includes(q.view) ? q.view : 'today', d = this.day(), lim = Math.max(1, Math.min(100, Number(q.limit) || 50)), before = Number(q.before) > 0 ? Number(q.before) : 2 ** 53;
    const where = view === 'today' ? "s.day=? AND s.status!='deleted'" : view === 'reported' ? "s.reports>0 AND s.status!='deleted'" : view === 'hidden' ? "s.status='hidden'" : '1=1';
    const args = view === 'today' ? [d] : [];
    const text = String(q.q || '').trim().slice(0, 60);
    let extra = ''; if (text) { if (/^#?\d+$/.test(text)) { extra = ' AND s.player_id=?'; args.push(Number(text.replace('#', ''))); } else { extra = " AND (s.message LIKE ? ESCAPE '\\' OR s.nickname LIKE ? ESCAPE '\\')"; const like = '%' + text.replace(/[\\%_]/g, (m) => '\\' + m) + '%'; args.push(like, like); } }
    const rows = this.db.prepare(`SELECT s.*, p.nickname cur_nick, p.banned_at FROM beach_shells s JOIN players p ON p.id=s.player_id WHERE ${where}${extra} AND s.id<? ORDER BY ${view === 'reported' ? 's.status=\'visible\' DESC, s.reports DESC, s.id DESC' : 's.id DESC'} LIMIT ?`).all(...args, before, lim + 1);
    const more = rows.length > lim; if (more) rows.pop();
    const reasons = this.db.prepare('SELECT reason, counted, created_at FROM beach_reports WHERE shell_id=? ORDER BY created_at DESC LIMIT 5');
    const count = (sql, ...a) => this.db.prepare(sql).get(...a).n;
    return { view, day: d, counts: { today: count("SELECT COUNT(*) n FROM beach_shells WHERE day=? AND status!='deleted'", d), reported: count("SELECT COUNT(*) n FROM beach_shells WHERE reports>0 AND status='visible'"), hidden: count("SELECT COUNT(*) n FROM beach_shells WHERE status='hidden'"), checkinsToday: count('SELECT COUNT(*) n FROM beach_checkins WHERE day=?', d) },
      shells: rows.map((s) => ({ id: s.id, playerId: s.player_id, nickname: s.nickname, currentNickname: s.cur_nick, banned: !!s.banned_at, day: s.day, style: s.style, message: s.message, likes: s.likes, reports: s.reports, status: s.status, hiddenReason: s.hidden_reason, createdAt: s.created_at, reviewedAt: s.reviewed_at, reportReasons: s.reports || view === 'reported' ? reasons.all(s.id) : [] })),
      next: more && view !== 'reported' ? rows[rows.length - 1].id : null };
  }
  adminSet(id, action) {
    const s = this.db.prepare('SELECT * FROM beach_shells WHERE id=?').get(Number(id) || 0); if (!s) throw new HttpError(404, 'not_found', '找不到貝殼');
    const map = { hide: ['hidden', 'admin'], unhide: ['visible', null], delete: ['deleted', 'admin_delete'] }; if (!map[action]) throw bad('action', '未知操作');
    if (action === 'unhide') this.db.prepare("UPDATE beach_shells SET status='visible', hidden_reason=NULL, reports=0, reviewed_at=? WHERE id=?").run(this.now(), s.id), this.db.prepare('UPDATE beach_reports SET counted=0 WHERE shell_id=?').run(s.id);
    else this.db.prepare('UPDATE beach_shells SET status=?, hidden_reason=?, reviewed_at=? WHERE id=?').run(map[action][0], map[action][1], this.now(), s.id);
    return { ok: true, id: s.id, status: map[action][0], playerId: s.player_id };
  }
}

function mount(app, ctx) {
  const svc = ctx.beach = new Beach(ctx);
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((o) => { if (o !== undefined && !res.headersSent) res.json(o); }).catch(next);
  const L = { ck: new RateLimiter({ windowMs: 60000, max: 10 }), wr: new RateLimiter({ windowMs: 60000, max: 6 }), ip: new RateLimiter({ windowMs: 3600000, max: 60 }), like: new RateLimiter({ windowMs: 60000, max: 60 }), rep: new RateLimiter({ windowMs: 3600000, max: 15 }), read: new RateLimiter({ windowMs: 60000, max: 120 }) };
  const lim = (name, key) => (req, res, next) => { const k = key === 'ip' ? 'ip:' + req.ip : 'p' + req.player.id, v = L[name].check(k); if (!v.ok) { res.set('Retry-After', String(v.retryAfter)); return next(new HttpError(429, 'rate_limited', '動作太頻繁，請稍後再試')); } next(); };
  const r = express.Router();
  r.use(ctx.players.auth(), express.json({ limit: '4kb' }));
  r.get('/status', lim('read'), wrap((req) => svc.status(req.player.id)));
  r.post('/checkin', lim('ck'), (req, res, next) => (req.body && req.body.shell ? lim('ip', 'ip')(req, res, next) : next()), wrap((req) => svc.checkin(req.player.id, { ...(req.body || {}), ip: req.ip })));
  r.post('/shell', lim('wr'), lim('ip', 'ip'), wrap((req) => svc.writeShell(req.player.id, req.body || {}, req.ip)));
  r.get('/board', lim('read'), wrap((req) => svc.board(req.player.id, req.query)));
  r.post('/shell/:id/like', lim('like'), wrap((req) => svc.like(req.player.id, req.params.id)));
  r.post('/shell/:id/report', lim('rep'), wrap((req) => svc.report(req.player.id, req.params.id, req.body && req.body.reason)));
  r.get('/shell/:id/replies', lim('read'), wrap(req=>svc.replies(req.player.id,req.params.id,req.query)));
  r.post('/shell/:id/replies', lim('wr'), lim('ip','ip'), wrap(req=>svc.addReply(req.player.id,req.params.id,req.body||{},req.ip)));
  r.post('/reply/:id/report', lim('rep'), wrap(req=>svc.reportReply(req.player.id,req.params.id,req.body?.reason)));
  r.post('/reply/:id/delete', lim('wr'), wrap(req=>svc.deleteReply(req.player.id,req.params.id)));
  r.get('/mine', lim('read'), wrap((req) => svc.mine(req.player.id, req.query)));
  app.use('/api/beach', r);
  const a = express.Router();
  a.use(ctx.adminAuth.require(), express.json({ limit: '4kb' }));
  a.get('/shells', wrap((req) => svc.adminList(req.query)));
  a.post('/shells/:id/:action(hide|unhide|delete)', wrap((req) => { const out = svc.adminSet(req.params.id, req.params.action); ctx.adminAuth.audit(req, 'beach.' + req.params.action, 'beach-shell:' + out.id, { playerId: out.playerId, status: out.status }); return out; }));
  a.get('/replies',wrap(req=>svc.adminReplies(req.query)));
  a.post('/replies/:id/:action(hide|unhide|delete)',wrap(req=>{const out=svc.adminReplySet(req.params.id,req.params.action);ctx.adminAuth.audit(req,'beach.reply.'+req.params.action,'beach-reply:'+out.id,{playerId:out.playerId,status:out.status});return out}));
  // PROFANITY-V1 後台：記點名單、自動刪除紀錄、清除記點、解除停權、自訂字詞、試算
  a.get('/profanity', wrap((req) => svc.adminProfanity(req.query)));
  a.post('/profanity/players/:pid/clear', wrap((req) => { const out = svc.adminClearStrikes(req.params.pid); ctx.adminAuth.audit(req, 'beach.profanity.clear', 'player:' + out.playerId, out); return out; }));
  a.post('/profanity/players/:pid/unban', wrap((req) => { const out = svc.adminUnban(req.params.pid); ctx.adminAuth.audit(req, 'beach.profanity.unban', 'player:' + out.playerId, out); return out; }));
  a.post('/profanity/words', wrap((req) => { const out = svc.adminWord(req.body || {}); ctx.adminAuth.audit(req, 'beach.profanity.word.' + out.action, out.kind + ':' + out.word, { word: out.word, kind: out.kind }); return out; }));
  a.post('/profanity/check', wrap((req) => { const text = String((req.body || {}).text || '').slice(0, 200); return { text, hits: svc.profHits(text), softBlocked: softBadWord(text) }; }));
  app.use('/admin/api/beach', a);
  try { svc.liftExpired(); } catch (e) { console.error('[beach] liftExpired', e.message); }
  const liftTimer = setInterval(() => { try { if (svc.db.open) svc.liftExpired(); } catch (e) { console.error('[beach] liftExpired', e.message); } }, 60000); if (liftTimer.unref) liftTimer.unref();
  return svc;
}
module.exports = { mount, Beach, FORTUNES, TIERS, STYLES, cleanMessage, badWord, softBadWord, profanityHits, PROF_BLOCK, PROF_ALLOW, PROF_DEFAULTS: PROF_DEF, BEACH_DEFAULTS: DEF };
