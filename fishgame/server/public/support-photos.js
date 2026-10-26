/* 📷 客服附加圖片（SUP-IMG-420）：遊戲端 /sdk/support-photos.js 與後台共用
 * - compress(file)：canvas 縮到長邊 1600px、JPEG 0.8（HEIC 由瀏覽器解碼；iPhone 相簿選取時多半已自動轉成 JPEG）
 * - Composer：選圖、縮圖預覽＋✕移除、逐張上傳進度／失敗重試
 * - hydrate(root)：把對話中的 [data-sp-img] 變成縮圖；點一下開全螢幕檢視（右上角 ✕）
 * 不使用 innerHTML 插入任何使用者資料；預覽一律用 data: URL（後台 CSP 只允許 'self' 與 data: 圖片）。 */
(function () {
  'use strict';
  if (window.FFSupPhotos) return;
  var MAX_EDGE = 1600, QUALITY = 0.8, MAX_BYTES = 5 * 1024 * 1024, MAX_FILE_IN = 40 * 1024 * 1024;
  var CSS = '' +
    /* 客服面板捲動時，ff-frame 的 ::after 外框會跟著內容捲走、蓋住下方按鈕；只在客服面板改成真正的邊框（不影響其他面板） */
    'html.ff-frame #modal .box:has(#supAtt){border:12px solid transparent;border-image:var(--ff-panel) 24 / 12px stretch;padding:10px}' +
    'html.ff-frame #modal .box:has(#supAtt)::after{display:none}' +
    /* 既有問題：ff-frame 讓客服回覆泡泡（深綠底）的字變深棕色看不清；固定泡泡內文字為淺色 */
    '#modal .sup-m.them,#modal .sup-m.me{color:#e6f6ff}' +
    '.sp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 2px;min-width:0}' +
    '.sp-pick{position:relative;display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid #3d86bd;background:#123a57;color:#e6f6ff;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;-webkit-tap-highlight-color:transparent}' +
    '.sp-pick input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0}' +
    '.sp-pick.off{opacity:.45;pointer-events:none}' +
    '.sp-hint{font-size:11.5px;opacity:.75;min-width:0}' +
    '.sp-list{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 0}' +
    '.sp-it{position:relative;width:72px;height:72px;border-radius:10px;overflow:hidden;background:#0b2236;border:1px solid #2f6b93;flex:0 0 auto}' +
    '.sp-it img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.sp-x{position:absolute;top:2px;right:2px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.66);color:#fff;font-size:13px;line-height:24px;text-align:center;padding:0;cursor:pointer;z-index:2}' +
    '.sp-st{position:absolute;left:0;right:0;bottom:0;padding:2px 3px;background:rgba(0,0,0,.6);color:#fff;font-size:10.5px;text-align:center;line-height:1.3}' +
    '.sp-pg{position:absolute;left:0;bottom:0;height:4px;background:#ffd166;transition:width .15s}' +
    '.sp-it.err{border-color:#ff5d6c}.sp-it.err .sp-st{background:rgba(160,20,40,.85);cursor:pointer}' +
    '.sp-it.done .sp-st{display:none}' +
    '.sp-imgs{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}' +
    '.sp-th{width:84px;height:84px;padding:0;border-radius:9px;overflow:hidden;border:1px solid rgba(255,255,255,.3);background:#0b2236 center/cover no-repeat;cursor:zoom-in;flex:0 0 auto}' +
    '.sp-th img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.sp-th.bad{cursor:default;font-size:11px;color:#ffb3b3}' +
    '.sp-view{position:fixed;inset:0;z-index:2147483000;background:rgba(0,6,12,.94);display:flex;align-items:center;justify-content:center;touch-action:pinch-zoom}' +
    '.sp-view img{max-width:100vw;max-height:100vh;max-height:100dvh;object-fit:contain;display:block;user-select:none;-webkit-user-select:none}' +
    '.sp-vx{position:fixed;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.55);color:#fff;font-size:22px;line-height:42px;text-align:center;padding:0;cursor:pointer;z-index:2}' +
    '.sp-nav{position:fixed;top:50%;transform:translateY(-50%);width:44px;height:64px;border:0;border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:26px;cursor:pointer;z-index:2}' +
    '.sp-nav.p{left:max(6px,env(safe-area-inset-left))}.sp-nav.n{right:max(6px,env(safe-area-inset-right))}' +
    '.sp-cnt{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;color:#fff;font-size:13px;opacity:.8}' +
    '.sp-vload{color:#fff;font-size:14px}';
  function css() { if (document.getElementById('spCss')) return; var s = document.createElement('style'); s.id = 'spCss'; s.textContent = CSS; document.head.appendChild(s); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---- 解碼＋縮圖 ----
  function readDataUrl(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(file); }); }
  function loadImg(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('decode')); }; i.src = src; }); }
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { try { return await createImageBitmap(file); } catch (e2) { /* 改用 <img> */ } } }
    return loadImg(await readDataUrl(file));
  }
  function toBlob(cv, q) { return new Promise(function (res) { if (cv.toBlob) cv.toBlob(function (b) { res(b); }, 'image/jpeg', q); else res(null); }); }
  function draw(src, w, h) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, w, h); return cv; }
  async function compress(file) {
    if (!file) throw new Error('沒有選到圖片');
    var name = String(file.name || ''), type = String(file.type || '');
    if (!/^image\//.test(type) && !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(name)) throw new Error('只能附加圖片');
    if (file.size > MAX_FILE_IN) throw new Error('原始圖片太大（超過 40 MB）');
    var img;
    try { img = await decode(file); } catch (e) {
      throw new Error(/heic|heif/i.test(type + name) ? '這台裝置無法讀取 HEIC，請在 iPhone「設定→相機→格式」選「最相容」，或截圖後再傳' : '這張圖片無法讀取，請換一張（JPG / PNG / WebP）');
    }
    var W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
    if (!W || !H) throw new Error('這張圖片無法讀取');
    var edge = MAX_EDGE, q = QUALITY, blob = null, cv = null, w = W, h = H;
    for (var k = 0; k < 4; k++) {
      var s = Math.min(1, edge / Math.max(W, H)); w = Math.max(1, Math.round(W * s)); h = Math.max(1, Math.round(H * s));
      cv = draw(img, w, h); blob = await toBlob(cv, q);
      if (!blob) { var du = cv.toDataURL('image/jpeg', q), bin = atob(du.split(',')[1]), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); blob = new Blob([u8], { type: 'image/jpeg' }); }
      if (blob.size <= MAX_BYTES * 0.95) break;
      edge = Math.round(edge * 0.8); q = Math.max(0.55, q - 0.1);
    }
    if (img.close) try { img.close(); } catch (e) { /* */ }
    if (blob.size > MAX_BYTES) throw new Error('圖片壓縮後仍超過 5 MB');
    var ts = Math.min(1, 200 / Math.max(w, h)), tcv = draw(cv, Math.max(1, Math.round(w * ts)), Math.max(1, Math.round(h * ts)));
    return { blob: blob, w: w, h: h, thumb: tcv.toDataURL('image/jpeg', 0.72) };
  }

  // ---- 上傳（XHR 才有進度）----
  function upload(url, blob, headers, onProgress) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest(); x.open('POST', url, true); x.timeout = 60000; x.withCredentials = true;
      Object.keys(headers || {}).forEach(function (k) { if (headers[k]) x.setRequestHeader(k, headers[k]); });
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () { var d = null; try { d = JSON.parse(x.responseText); } catch (e) { /* */ }
        if (x.status >= 200 && x.status < 300 && d && d.id) return res(d);
        var msg = (d && d.message) || (x.status === 413 ? '圖片太大（單張最多 5 MB）' : x.status === 429 ? '上傳太頻繁，請稍後再試' : '上傳失敗（' + x.status + '）');
        var err = new Error(msg); err.status = x.status; err.code = d && d.error; rej(err); };
      x.onerror = function () { rej(new Error('網路連線失敗，請重試')); };
      x.ontimeout = function () { rej(new Error('上傳逾時，請重試')); };
      var fd = new FormData(); fd.append('image', blob, 'photo.jpg'); x.send(fd);
    });
  }

  // ---- 選圖＋預覽＋上傳 ----
  // opts: { bar, list, uploadUrl, headers(), del(token), max, onChange, toast(msg,bad) }
  function Composer(opts) {
    css();
    var self = this, max = opts.max || 3, items = [], seq = 0;
    var bar = opts.bar, list = opts.list;
    var pick = el('label', 'sp-pick'); pick.setAttribute('data-sp', 'pick');
    pick.appendChild(document.createTextNode('📷 附加圖片'));
    var inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.setAttribute('aria-label', '附加圖片'); pick.appendChild(inp);
    var hint = el('span', 'sp-hint');
    bar.appendChild(pick); bar.appendChild(hint);
    list.classList.add('sp-list');
    function refresh() {
      var n = items.length; pick.classList.toggle('off', n >= max);
      inp.disabled = n >= max;
      hint.textContent = n ? '已選 ' + n + ' / ' + max + ' 張' : '最多 ' + max + ' 張・會自動壓縮';
      opts.onChange && opts.onChange(self);
    }
    function render(it) {
      var box = it.box;
      if (!box) {
        box = it.box = el('div', 'sp-it'); box.setAttribute('data-sp-item', String(it.k));
        it.img = el('img'); it.img.alt = '預覽'; box.appendChild(it.img);
        var x = el('button', 'sp-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '移除這張圖片'); x.onclick = function (e) { e.preventDefault(); e.stopPropagation(); self.remove(it); };
        box.appendChild(x); it.st = el('div', 'sp-st'); box.appendChild(it.st); it.pg = el('div', 'sp-pg'); box.appendChild(it.pg);
        it.st.onclick = function () { if (it.state === 'error' && it.blob) send(it); };
        list.appendChild(box);
      }
      if (it.thumb && it.img.getAttribute('src') !== it.thumb) it.img.src = it.thumb;
      box.className = 'sp-it ' + it.state;
      it.st.textContent = it.state === 'compress' ? '壓縮中…' : it.state === 'uploading' ? Math.round(it.pct * 100) + '%' : it.state === 'error' ? (it.blob ? '⚠️ 點此重試' : '⚠️ 無法使用') : '';
      if (it.state === 'error') it.st.title = it.err || '';
      it.pg.style.width = it.state === 'uploading' ? Math.round(it.pct * 100) + '%' : '0';
    }
    async function send(it) {
      it.state = 'uploading'; it.pct = 0; it.err = ''; render(it); refresh();
      try {
        var d = await upload(opts.uploadUrl, it.blob, opts.headers ? await opts.headers() : {}, function (p) { it.pct = Math.min(0.99, p); render(it); });
        if (it.gone) { opts.del && opts.del(d.id); return; }
        it.token = d.id; it.state = 'done';
      } catch (e) { it.state = 'error'; it.err = e.message; opts.toast && opts.toast('📷 ' + e.message, true); }
      render(it); refresh();
    }
    async function add(file) {
      var it = { k: ++seq, state: 'compress', pct: 0 }; items.push(it); render(it); refresh();
      try { var c = await compress(file); it.blob = c.blob; it.thumb = c.thumb; it.w = c.w; it.h = c.h; }
      catch (e) { it.state = 'error'; it.err = e.message; render(it); refresh(); opts.toast && opts.toast('📷 ' + e.message, true); return; }
      if (it.gone) return; await send(it);
    }
    inp.onchange = function () {
      var fs = Array.prototype.slice.call(inp.files || []); inp.value = '';
      var room = max - items.length;
      if (fs.length > room) opts.toast && opts.toast('每則訊息最多 ' + max + ' 張圖片' + (room > 0 ? '，只加入前 ' + room + ' 張' : ''), true);
      fs.slice(0, Math.max(0, room)).forEach(add);
    };
    this.remove = function (it) { it.gone = true; items = items.filter(function (x) { return x !== it; }); if (it.box) it.box.remove(); if (it.token && opts.del) opts.del(it.token); refresh(); };
    this.tokens = function () { return items.filter(function (x) { return x.state === 'done' && x.token; }).map(function (x) { return x.token; }); };
    this.busy = function () { return items.some(function (x) { return x.state === 'compress' || x.state === 'uploading'; }); };
    this.failed = function () { return items.filter(function (x) { return x.state === 'error'; }).length; };
    this.count = function () { return items.length; };
    this.clear = function () { items.forEach(function (x) { if (x.box) x.box.remove(); }); items = []; refresh(); };   // 送出後：圖已綁到訊息，不刪
    this.destroy = function () { items.forEach(function (x) { x.gone = true; if (x.token && opts.del) opts.del(x.token); }); items = []; };
    this.addFiles = function (files) { Array.prototype.slice.call(files).slice(0, max - items.length).forEach(add); };
    refresh();
  }

  // ---- 對話中的圖片 ----
  // spec: { src(token) → Promise<url> }；root 內 [data-sp-img] 按鈕
  function hydrate(root, spec) {
    css();
    var btns = Array.prototype.slice.call(root.querySelectorAll('[data-sp-img]'));
    btns.forEach(function (b) {
      if (b.__sp) return; b.__sp = 1; b.classList.add('sp-th'); b.type = 'button'; b.setAttribute('aria-label', '查看圖片');
      var tok = b.getAttribute('data-sp-img');
      Promise.resolve(spec.src(tok)).then(function (u) { var i = el('img'); i.alt = '圖片'; i.loading = 'lazy'; i.src = u; b.textContent = ''; b.appendChild(i); b.__u = u; })
        .catch(function () { b.classList.add('bad'); b.textContent = '⚠️ 無法載入'; });
      b.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var grp = b.closest('[data-sp-group]') || b.parentNode, all = Array.prototype.slice.call(grp.querySelectorAll('[data-sp-img]'));
        viewer(all.map(function (x) { return x.getAttribute('data-sp-img'); }), all.indexOf(b), spec);
      };
    });
  }
  var curView = null;
  function viewer(tokens, idx, spec) {
    css(); if (curView) curView.close();
    var ov = el('div', 'sp-view'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '圖片檢視'); ov.setAttribute('data-sp', 'viewer');
    var img = el('img'); img.alt = '圖片'; var ld = el('div', 'sp-vload', '載入中…');
    var x = el('button', 'sp-vx', '✕'); x.type = 'button'; x.setAttribute('aria-label', '關閉');
    var cnt = el('div', 'sp-cnt');
    ov.appendChild(ld); ov.appendChild(img); ov.appendChild(x);
    var p, n; if (tokens.length > 1) { p = el('button', 'sp-nav p', '‹'); n = el('button', 'sp-nav n', '›'); p.type = n.type = 'button'; p.setAttribute('aria-label', '上一張'); n.setAttribute('aria-label', '下一張'); ov.appendChild(p); ov.appendChild(n); ov.appendChild(cnt); }
    function show(i) { idx = (i + tokens.length) % tokens.length; img.style.display = 'none'; ld.style.display = ''; cnt.textContent = (idx + 1) + ' / ' + tokens.length;
      Promise.resolve(spec.src(tokens[idx])).then(function (u) { img.onload = function () { ld.style.display = 'none'; img.style.display = ''; }; img.onerror = function () { ld.textContent = '⚠️ 無法載入'; }; img.src = u; }).catch(function () { ld.textContent = '⚠️ 無法載入'; }); }
    function close() { ov.remove(); document.removeEventListener('keydown', key, true); curView = null; }
    function key(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowLeft' && p) show(idx - 1); else if (e.key === 'ArrowRight' && n) show(idx + 1); }
    x.onclick = function (e) { e.stopPropagation(); close(); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    if (p) { p.onclick = function (e) { e.stopPropagation(); show(idx - 1); }; n.onclick = function (e) { e.stopPropagation(); show(idx + 1); }; }
    var sx = null; ov.addEventListener('touchstart', function (e) { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    ov.addEventListener('touchend', function (e) { if (sx == null || tokens.length < 2) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1)); sx = null; }, { passive: true });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(ov); show(idx || 0);
    curView = { close: close }; return curView;
  }
  // 遊戲端：用 Bearer token 取圖 → blob URL（同一張只抓一次）
  function bearerSrc(base, tokenFn) {
    var cache = {};
    return function (tok) {
      if (cache[tok]) return cache[tok];
      cache[tok] = fetch(base + encodeURIComponent(tok), { headers: { Authorization: 'Bearer ' + tokenFn() } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(function (b) { return URL.createObjectURL(b); });
      cache[tok].catch(function () { delete cache[tok]; });
      return cache[tok];
    };
  }
  window.FFSupPhotos = { version: '420-1', compress: compress, upload: upload, Composer: Composer, hydrate: hydrate, viewer: viewer, bearerSrc: bearerSrc, css: css, MAX_EDGE: MAX_EDGE };
})();
