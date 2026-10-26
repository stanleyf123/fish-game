'use strict';
// 📷 客服圖片（SUP-IMG-420）：玩家／管理員在客服對話附加圖片（每則最多 3 張）。
// - 上傳：multipart/form-data（欄位 image，單檔），魔術位元組只收 JPEG / PNG / WebP，單檔 ≤ 5 MB
// - 伺服器端重新編碼（sharp；沒有 sharp 時改用純 JS 移除 EXIF / XMP / 文字區塊），一律去除 EXIF / GPS
// - 檔名為隨機 token，存在 DATA_DIR/uploads/support/（不在網站根目錄）；只能透過需登入的路由讀取
// - 先上傳（待送出），送出訊息時再綁到訊息；24 小時沒送出的待送出圖片自動刪除
const fs = require('fs');
const path = require('path');
const { HttpError, bad, randToken } = require('./util');

let sharp = null;
try { if (process.env.SUPPORT_IMG_NO_SHARP !== '1') { sharp = require('sharp'); sharp.concurrency(1); sharp.cache(false); } } catch (e) { sharp = null; }

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_MSG = 3;
const MAX_EDGE = 2048;            // 伺服器端再保險縮一次（前端已縮到 1600）
const PENDING_TTL = 24 * 3600e3;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ---- multipart/form-data（整包已在記憶體；只取第一個檔案欄位與少量文字欄位）----
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(String(contentType || ''));
  if (!m || !Buffer.isBuffer(buf)) throw bad('bad_multipart', '上傳格式錯誤');
  const delim = Buffer.from('--' + (m[1] || m[2]));
  const out = { fields: {}, files: [] };
  let pos = buf.indexOf(delim);
  if (pos < 0) throw bad('bad_multipart', '上傳格式錯誤');
  for (let parts = 0; parts < 8; parts++) {
    pos += delim.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;                // 結尾 --
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
    const he = buf.indexOf('\r\n\r\n', pos);
    if (he < 0) throw bad('bad_multipart', '上傳格式錯誤');
    const head = buf.toString('utf8', pos, he);
    const next = buf.indexOf(Buffer.concat([Buffer.from('\r\n'), delim]), he + 4);
    if (next < 0) throw bad('bad_multipart', '上傳格式錯誤');
    const data = buf.subarray(he + 4, next);
    const name = (/name="([^"]*)"/i.exec(head) || [])[1];
    const filename = (/filename="([^"]*)"/i.exec(head) || [])[1];
    const type = (/content-type:\s*([^\r\n;]+)/i.exec(head) || [])[1];
    if (filename !== undefined) out.files.push({ name, filename, type: type && type.trim().toLowerCase(), data });
    else if (name) out.fields[name] = data.toString('utf8').slice(0, 200);
    pos = next + 2;
  }
  return out;
}

// ---- 純 JS 去除中繼資料（沒有 sharp 時使用；也用來讀尺寸）----
function stripJpeg(b) {
  // 逐段走：遇到 SOS 後掃到下一個真正的標記（略過 FF00 填充與 RSTn）；EOI 之後的資料（例如 iPhone 的 MPF 第二張圖＋其 EXIF）一律丟掉
  const parts = [b.subarray(0, 2)]; let i = 2, w = 0, h = 0, eoi = false;
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) throw bad('bad_image', '圖片檔案損毀');
    const mk = b[i + 1];
    if (mk === 0xff) { i++; continue; }
    if (mk === 0xd9) { parts.push(b.subarray(i, i + 2)); eoi = true; break; }
    if (mk >= 0xd0 && mk <= 0xd7) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) break;
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw bad('bad_image', '圖片檔案損毀');
    if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc && len >= 7) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); }
    // 丟掉 APP1(EXIF/XMP)…APP15、COM；只保留 APP0(JFIF)、APP2 中的 ICC_PROFILE、APP14(Adobe 色彩轉換)
    const isIcc = mk === 0xe2 && b.toString('latin1', i + 4, i + 15) === 'ICC_PROFILE';
    const drop = (mk >= 0xe1 && mk <= 0xef && mk !== 0xee && !isIcc) || mk === 0xfe;
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
    if (mk === 0xda) {                                                     // 熵編碼資料
      let j = i;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      parts.push(b.subarray(i, j)); i = j;
    }
  }
  if (!eoi) parts.push(Buffer.from([0xff, 0xd9]));
  return { buf: Buffer.concat(parts), width: w, height: h };
}
function stripPng(b) {
  const parts = [b.subarray(0, 8)]; let i = 8, w = 0, h = 0;
  const DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8);
    if (i + 12 + len > b.length) throw bad('bad_image', '圖片檔案損毀');
    if (type === 'IHDR') { w = b.readUInt32BE(i + 8); h = b.readUInt32BE(i + 12); }
    if (!DROP.has(type)) parts.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return { buf: Buffer.concat(parts), width: w, height: h };
}
function stripWebp(b) {
  const parts = []; let i = 12, w = 0, h = 0, vp8x = -1;
  while (i + 8 <= b.length) {
    const type = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4), full = 8 + len + (len & 1);
    if (i + 8 + len > b.length) throw bad('bad_image', '圖片檔案損毀');
    const c = Buffer.from(b.subarray(i, Math.min(b.length, i + full)));
    if (type === 'VP8X') { vp8x = parts.length; w = 1 + c.readUIntLE(12, 3); h = 1 + c.readUIntLE(15, 3); c[8] &= ~0x0c; }   // 清掉 EXIF / XMP 旗標
    else if (type === 'VP8 ' && !w) { w = c.readUInt16LE(14) & 0x3fff; h = c.readUInt16LE(16) & 0x3fff; }
    else if (type === 'VP8L' && !w) { const v = c.readUInt32LE(9); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; }
    if (type !== 'EXIF' && type !== 'XMP ') parts.push(c);
    i += full;
  }
  const body = Buffer.concat(parts), hd = Buffer.alloc(12);
  hd.write('RIFF', 0, 'latin1'); hd.writeUInt32LE(body.length + 4, 4); hd.write('WEBP', 8, 'latin1');
  void vp8x; return { buf: Buffer.concat([hd, body]), width: w, height: h };
}
function stripPureJs(buf, mime) { return mime === 'image/jpeg' ? stripJpeg(buf) : mime === 'image/png' ? stripPng(buf) : stripWebp(buf); }

// 有 sharp：解碼→依 EXIF 轉正→縮到 2048 內→重新編碼（預設不寫回任何中繼資料）
async function sanitize(buf, mime) {
  if (sharp) {
    let img;
    try {
      img = sharp(buf, { limitInputPixels: 50e6, failOn: 'error', pages: 1 }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
      if (mime === 'image/png') img = img.png({ compressionLevel: 8 });
      else if (mime === 'image/webp') img = img.webp({ quality: 85 });
      else img = img.jpeg({ quality: 85 });
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      return { buf: data, width: info.width, height: info.height, engine: 'sharp' };
    } catch (e) { throw bad('bad_image', '圖片無法讀取，請換一張（支援 JPG / PNG / WebP）'); }
  }
  const r = stripPureJs(buf, mime);
  if (!r.width || !r.height) throw bad('bad_image', '圖片無法讀取，請換一張（支援 JPG / PNG / WebP）');
  if (r.width > 8000 || r.height > 8000) throw bad('too_big_dim', '圖片尺寸過大');
  return { ...r, engine: 'js' };
}

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS support_images (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  thread_id INTEGER,
  message_id INTEGER REFERENCES support_messages(id) ON DELETE CASCADE,
  uploader TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_support_images_msg ON support_images(message_id);
CREATE INDEX IF NOT EXISTS idx_support_images_up ON support_images(uploader, player_id, created_at);`);
}

class SupportImages {
  constructor({ db, env = {} }) {
    this.db = db; migrate(db);
    const base = env.SUPPORT_UPLOAD_DIR || (db.name && db.name !== ':memory:' ? path.join(path.dirname(db.name), 'uploads', 'support') : path.join(require('os').tmpdir(), 'fishgame-support-' + process.pid));
    this.dir = base; fs.mkdirSync(this.dir, { recursive: true, mode: 0o750 });
    this.perHour = Math.max(1, parseInt(env.SUPPORT_IMG_PER_HOUR, 10) || 20);
    this.adminPerHour = Math.max(1, parseInt(env.SUPPORT_IMG_ADMIN_PER_HOUR, 10) || 200);
    this.maxTotal = (parseInt(env.SUPPORT_IMG_MAX_TOTAL_MB, 10) || 1024) * 1024 * 1024;
    this.engine = sharp ? 'sharp' : 'js';
    if (env.NODE_ENV !== 'test') { this.sweep(); this.timer = setInterval(() => { try { this.sweep(); } catch (e) { /* ignore */ } }, 3600e3); this.timer.unref && this.timer.unref(); }
  }
  file(token, mime) { return path.join(this.dir, token + '.' + EXT[mime]); }
  // 上傳一張（尚未綁訊息）。who = { uploader:'player'|'admin', playerId, threadId }
  async upload(who, part) {
    if (!part || !part.data || !part.data.length) throw bad('no_file', '請選擇圖片');
    if (part.data.length > MAX_BYTES) throw new HttpError(413, 'too_large', '圖片太大（單張最多 5 MB）');
    const mime = sniff(part.data);
    if (!mime) throw new HttpError(415, 'bad_type', '只支援 JPG / PNG / WebP 圖片');
    const since = Date.now() - 3600e3;
    const n = this.db.prepare('SELECT COUNT(*) n FROM support_images WHERE uploader=? AND player_id=? AND created_at>?').get(who.uploader, who.playerId, since).n;
    const lim = who.uploader === 'admin' ? this.adminPerHour : this.perHour;
    if (n >= lim) throw new HttpError(429, 'rate_limited', `圖片上傳太頻繁（每小時最多 ${lim} 張），請稍後再試`, { retryAfter: 600 });
    const pend = this.db.prepare('SELECT COUNT(*) n FROM support_images WHERE uploader=? AND player_id=? AND message_id IS NULL AND deleted_at IS NULL').get(who.uploader, who.playerId).n;
    if (pend >= 9) throw new HttpError(429, 'too_many_pending', '待送出的圖片太多，請先送出或移除');
    const tot = this.db.prepare('SELECT COALESCE(SUM(bytes),0) s FROM support_images WHERE deleted_at IS NULL').get().s;
    if (tot > this.maxTotal) throw new HttpError(507, 'storage_full', '圖片空間已滿，請稍後再試');
    const out = await sanitize(part.data, mime);
    if (out.buf.length > MAX_BYTES) throw new HttpError(413, 'too_large', '圖片太大（單張最多 5 MB）');
    const token = randToken(18), f = this.file(token, mime), tmp = f + '.tmp';
    fs.writeFileSync(tmp, out.buf, { mode: 0o640 }); fs.renameSync(tmp, f);
    try {
      this.db.prepare('INSERT INTO support_images (token, player_id, thread_id, uploader, mime, bytes, width, height, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(token, who.playerId, who.threadId || null, who.uploader, mime, out.buf.length, out.width, out.height, Date.now());
    } catch (e) { try { fs.unlinkSync(f); } catch (x) { /* */ } throw e; }
    return { id: token, w: out.width, h: out.height, bytes: out.buf.length, type: mime };
  }
  // 送出訊息前檢查：只能綁自己上傳、尚未送出的圖片
  claimable(who, tokens) {
    if (tokens == null) return [];
    if (!Array.isArray(tokens)) throw bad('bad_images', '圖片格式錯誤');
    const uniq = [...new Set(tokens.map(String))];
    if (uniq.length > MAX_PER_MSG) throw bad('too_many_images', `每則訊息最多 ${MAX_PER_MSG} 張圖片`);
    return uniq.map((t) => {
      const r = TOKEN_RE.test(t) && this.db.prepare('SELECT * FROM support_images WHERE token=?').get(t);
      const okThread = who.uploader === 'admin' ? r && r.thread_id === who.threadId : true;
      if (!r || r.uploader !== who.uploader || r.player_id !== who.playerId || r.message_id != null || r.deleted_at != null || !okThread) throw bad('bad_image_ref', '圖片已失效，請重新選擇');
      return r.id;
    });
  }
  attach(ids, messageId, threadId) { const st = this.db.prepare('UPDATE support_images SET message_id=?, thread_id=? WHERE id=? AND message_id IS NULL'); for (const id of ids) st.run(messageId, threadId, id); }
  byMessages(ids) {
    const map = new Map(); if (!ids.length) return map;
    const rows = [];
    for (let i = 0; i < ids.length; i += 500) { const ch = ids.slice(i, i + 500); rows.push(...this.db.prepare(`SELECT token, message_id, width, height FROM support_images WHERE deleted_at IS NULL AND message_id IN (${ch.map(() => '?').join(',')}) ORDER BY id`).all(...ch)); }
    for (const r of rows) { if (!map.has(r.message_id)) map.set(r.message_id, []); map.get(r.message_id).push({ id: r.token, w: r.width, h: r.height }); }
    return map;
  }
  // 讀圖權限：玩家只能看「自己對話串」的圖（自己上傳的，或管理員已送出的）；管理員都能看
  get(token, viewer) {
    if (!TOKEN_RE.test(String(token || ''))) return null;
    const r = this.db.prepare('SELECT * FROM support_images WHERE token=? AND deleted_at IS NULL').get(token);
    if (!r) return null;
    if (viewer.admin) return r;
    if (r.player_id !== viewer.playerId) return null;
    if (r.uploader !== 'player' && r.message_id == null) return null;
    return r;
  }
  removePending(token, who) {
    const r = TOKEN_RE.test(String(token || '')) && this.db.prepare('SELECT * FROM support_images WHERE token=?').get(token);
    if (!r || r.uploader !== who.uploader || (who.uploader === 'player' && r.player_id !== who.playerId) || r.message_id != null || r.deleted_at != null) throw new HttpError(404, 'not_found', '找不到這張圖片');
    this.db.prepare('UPDATE support_images SET deleted_at=? WHERE id=?').run(Date.now(), r.id);
    try { fs.unlinkSync(this.file(r.token, r.mime)); } catch (e) { /* */ }
    return { ok: true };
  }
  send(res, r) {
    res.set({ 'Content-Type': r.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="support-${r.token.slice(0, 8)}.${EXT[r.mime]}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin', ETag: '"' + r.token + '"' });
    if (res.req && res.req.get('if-none-match') === '"' + r.token + '"') return res.status(304).end();
    fs.createReadStream(this.file(r.token, r.mime)).on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'not_found', message: '找不到這張圖片' }); else res.end(); }).pipe(res);
  }
  // 清理：24 小時沒送出的待送出圖片、DB 已無紀錄的孤兒檔（例如玩家被刪除）
  sweep(now = Date.now()) {
    const old = this.db.prepare('SELECT id, token, mime FROM support_images WHERE message_id IS NULL AND deleted_at IS NULL AND created_at<?').all(now - PENDING_TTL);
    for (const r of old) { try { fs.unlinkSync(this.file(r.token, r.mime)); } catch (e) { /* */ } this.db.prepare('UPDATE support_images SET deleted_at=? WHERE id=?').run(now, r.id); }
    let orphans = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^([A-Za-z0-9_-]{20,40})\.(jpg|png|webp)(\.tmp)?$/.exec(f); if (!m) continue;
      const st = fs.statSync(path.join(this.dir, f)); if (now - st.mtimeMs < PENDING_TTL) continue;
      const r = this.db.prepare('SELECT deleted_at FROM support_images WHERE token=?').get(m[1]);
      if (m[3] || !r || r.deleted_at != null) { try { fs.unlinkSync(path.join(this.dir, f)); orphans++; } catch (e) { /* */ } }
    }
    return { pending: old.length, orphans };
  }
}

module.exports = { SupportImages, migrate, sniff, parseMultipart, stripJpeg, stripPng, stripWebp, sanitize, MAX_BYTES, MAX_PER_MSG, hasSharp: () => !!sharp };
