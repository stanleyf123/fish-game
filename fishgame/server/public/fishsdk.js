/*!
 * 悠游水族箱 FishSDK — 遊戲端呼叫後端 API 的小工具（無相依、可直接 <script> 引入）
 * 伺服器路徑：/sdk/fishsdk.js
 *
 * ──────────────────────────── 快速整合 ────────────────────────────
 * <script src="/sdk/fishsdk.js"></script>
 * <script>
 *   const sdk = FishSDK.create({ baseUrl: '' });         // 同網域部署留空；跨網域填 'https://www.feedfishs.com'
 *
 *   // 1) 設定：v1 已支援 window.AQUARIUM_CONFIG_URL，最簡單的接法：
 *   window.AQUARIUM_CONFIG_URL = '/api/config';
 *   //    或自行載入（含 ETag 快取、離線時用上次快取）：
 *   const cfg = await sdk.loadConfig();                  // → 與 index.html 內建 GAME_CONFIG 相同結構
 *
 *   // 2) 帳號：第一次會自動建立訪客帳號（裝置代碼存在 localStorage）
 *   await sdk.ensureSession();
 *   //    註冊會員（會員帳號＝信箱，之後可在其他裝置登入）：await sdk.register('me@example.com', 'password123', '魚魚');
 *   //    其他裝置登入：await sdk.login('me@example.com', 'password123');
 *
 *   // 3) 雲端存檔：用 sdk 取代 index.html 的 loadSave()/writeSave()
 *   const { save } = await sdk.loadSave();               // null 代表雲端還沒有存檔 → 用本機存檔或開新遊戲
 *   const r = await sdk.writeSave(snapshot());           // 建議每 15–30 秒、以及 pagehide 時呼叫
 *   //    r.ok === true                       → 成功
 *   //    r.conflict（409）                  → 別的裝置/後台改過存檔，r.save 是伺服器版本，請載入它
 *   //    r.rejected（422）                  → 防作弊拒絕，r.reasons 是原因；建議改用 r.serverSave（重新 loadSave）
 *   //    r.tooFrequent（429）               → 存太快，稍後再存即可
 *
 *   // 4) 心跳與事件（儀表板的在線人數、DAU、平均遊玩時長都靠這個）
 *   sdk.startHeartbeat();                                // 預設每 30 秒
 *   sdk.track('breed', { a: 'goldfish', b: 'clown', child: 'betta', mutated: true });
 *
 *   // 5) 公告與信箱
 *   const list = await sdk.getAnnouncements();
 *   const mail = await sdk.getMailbox();
 *   const got = await sdk.claimMail(mail[0].id);         // 伺服器直接把獎勵寫入雲端存檔
 *   //    got.granted = { coins, gems, fish:[完整魚物件], decorations:[] }；got.save 為新的完整存檔
 *   //    遊戲端最簡單做法：S.coins += got.granted.coins; got.granted.fish.forEach(f => S.fish.push(addRuntime(f)));
 *   //    （sdk 已自動把 rev 更新成領取後的版本，下次 writeSave 不會衝突）
 *
 *   // 6) 付費／會員（目前只有「模擬金流」可用）
 *   const { products } = await sdk.listProducts();
 *   const order = await sdk.createOrder('gems_60', { provider: 'mock' });   // 會開新分頁到付款頁
 *   const done = await sdk.waitForOrder(order.order.id);                     // 輪詢直到 paid/failed
 *   const ent = await sdk.getEntitlements();   // { gems, vip:{active,expiresAt,perks}, flags:['no_ads',...] }
 *   await sdk.buyWithGems('deco_crystal');     // 用寶石買（伺服器扣款，寶石數量以伺服器為準）
 *   const r = await sdk.buySpecies('p_starbetta'); // 寶石買限定魚：r.save / r.rev 為伺服器寫入魚之後的存檔
 * </script>
 *
 * 注意：寶石（付費貨幣）只存在伺服器，不要放進存檔，也不要相信本機數字。
 */
(function (root) {
  'use strict';

  function create(opts) {
    opts = opts || {};
    var base = (opts.baseUrl || '').replace(/\/$/, '');
    var store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : memoryStorage());
    var K = { token: 'fishsdk.token', device: 'fishsdk.device', rev: 'fishsdk.rev', cfg: 'fishsdk.config', cfgEtag: 'fishsdk.config.etag', sid: 'fishsdk.session' };
    var listeners = {};
    var hbTimer = null, flushTimer = null, queue = [];
    var rev = Number(store.getItem(K.rev) || 0);
    var timeoutMs = opts.timeoutMs || 8000;
    var player = null;
    var clientBuild = opts.clientBuild || null; // 遊戲版本（v4.0.6 起隨存檔送出，伺服器可據此請舊分頁重新整理）

    function emit(ev, data) { (listeners[ev] || []).forEach(function (f) { try { f(data); } catch (e) { console.error(e); } }); }
    function setRev(r) { rev = r || 0; store.setItem(K.rev, String(rev)); }
    function token() { return store.getItem(K.token); }

    function request(method, path, body, extra) {
      extra = extra || {};
      var headers = { 'Accept': 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token() && !extra.noAuth) headers['Authorization'] = 'Bearer ' + token();
      if (extra.headers) for (var k in extra.headers) headers[k] = extra.headers[k];
      var ctl = typeof AbortController !== 'undefined' && !extra.keepalive ? new AbortController() : null;
      var tm = ctl ? setTimeout(function () { ctl.abort(); }, extra.timeoutMs || timeoutMs) : null;
      return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive: !!extra.keepalive, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          clearTimeout(tm);
          var ct = r.headers.get('content-type') || '';
          if (r.status !== 304 && ct.indexOf('json') < 0) { var ne = new Error('伺服器暫時無法使用（HTTP ' + r.status + '）'); ne.status = r.status; ne.offline = true; throw ne; }
          if (r.status === 304) return { status: 304, data: null, res: r };
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (r.status === 401 && !extra.noAuth) { store.removeItem(K.token); emit('unauthorized', data); }
            if (r.status === 403 && data.error === 'banned') emit('banned', data);
            return { status: r.status, data: data, res: r };
          });
        });
    }
    function ok(res) { if (res.status >= 200 && res.status < 300) return res.data; var e = new Error(res.data && res.data.message || ('HTTP ' + res.status)); e.status = res.status; e.data = res.data; throw e; }

    function deviceToken() {
      var d = store.getItem(K.device);
      if (!d) {
        var a = new Uint8Array(24); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
        d = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        store.setItem(K.device, d);
      }
      return d;
    }
    function setSession(data) { store.setItem(K.token, data.token); player = data.player; emit('session', player); return data.player; }
    function oauthDone(d) { if (d.token) { if (d.switched) setRev(0); setSession(d); } else if (d.player) { player = d.player; emit('session', player); } return d; }
    function newDevice() { store.removeItem(K.device); store.removeItem(K.sid); }

    var sdk = {
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return sdk; },

      // ---------- 設定 ----------
      loadConfig: function () {
        var etag = store.getItem(K.cfgEtag);
        return request('GET', '/api/config', undefined, { noAuth: true, headers: etag ? { 'If-None-Match': etag } : {} }).then(function (r) {
          if (r.status === 304) return JSON.parse(store.getItem(K.cfg));
          var cfg = ok(r);
          try { store.setItem(K.cfg, JSON.stringify(cfg)); store.setItem(K.cfgEtag, r.res.headers.get('ETag') || ''); } catch (e) { /* 空間不足時略過快取 */ }
          return cfg;
        }).catch(function (e) { var c = store.getItem(K.cfg); if (c) return JSON.parse(c); throw e; });
      },

      // ---------- 帳號 ----------
      isLoggedIn: function () { return !!token(); },
      ensureSession: function () { return token() ? sdk.me().then(function (m) { player = m.player; emit('session', player); return m.player; }).catch(function (e) { if (e.status === 401) return sdk.guest(); throw e; }) : sdk.guest(); },
      get player() { return player; },
      isBound: function () { return !!(player && player.bound); },
      guest: function () { return request('POST', '/api/auth/guest', { deviceToken: deviceToken(), attrib: root.__ffAttrib || undefined }, { noAuth: true }).then(ok).then(setSession); },
      // 會員帳號＝信箱
      login: function (email, password) { return request('POST', '/api/auth/login', { email: email, password: password }, { noAuth: true }).then(ok).then(function (d) { setRev(0); return setSession(d); }); },
      // 綁定：把目前的訪客帳號升級成會員（魚缸、寶石全部保留）。會員帳號＝信箱
      register: function (email, password, nickname) { return request('POST', '/api/auth/register', { email: email, password: password, nickname: nickname || undefined }).then(ok).then(function (d) { player = d.player; emit('session', player); return d.player; }); },
      // 登出：清除 token 並換一組新的裝置代碼（下次會是全新的訪客，不會自動登回會員帳號）
      logout: function () { var done = function () { store.removeItem(K.token); newDevice(); setRev(0); player = null; }; return request('POST', '/api/auth/logout', {}).then(done, done); },
      me: function () { return request('GET', '/api/me').then(ok); },
      // v4.2-auth：Google／LINE 登入與綁定
      // v4.1.3：新手體驗
      newbieStatus: function () { return request('GET', '/api/newbie/status').then(ok); },
      inviteMe: function () { return request('GET', '/api/invite/me').then(ok); },
      newbieTutorial: function () { return request('POST', '/api/newbie/tutorial', {}).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      newbieDaily: function () { return request('POST', '/api/newbie/daily', {}).then(ok); },
      newbieAch: function (id) { return request('POST', '/api/newbie/ach/' + encodeURIComponent(id), {}).then(ok); },
      authProviders: function () { return request('GET', '/api/auth/providers', undefined, { noAuth: true }).then(ok); },
      oauthGoogle: function (body) { return request('POST', '/api/auth/google', body).then(ok).then(oauthDone); },
      lineBegin: function (mode) { return request('POST', '/api/auth/line/begin', { mode: mode }).then(ok); },
      lineResult: function (body) { return request('POST', '/api/auth/line/result', body).then(ok).then(oauthDone); },
      unlinkProvider: function (provider) { return request('POST', '/api/auth/unlink', { provider: provider }).then(ok).then(function (d) { player = d.player; emit('session', player); return d; }); },

      // ---------- 存檔 ----------
      loadSave: function () { return request('GET', '/api/save').then(ok).then(function (d) { setRev(d.rev); return d; }); },
      writeSave: function (save, o) {
        o = o || {};
        var pre = !o.keepalive && queue.length ? sdk.flush() : Promise.resolve(0);
        return pre.then(function () { var b = { save: save, rev: rev }; if (clientBuild) b.client = clientBuild; return request('PUT', '/api/save', b, { keepalive: !!o.keepalive }); }).then(function (r) {
          if (r.status === 200) { setRev(r.data.rev); return { ok: true, rev: r.data.rev, flagged: r.data.flagged, minClient: r.data.minClient, inviteReward: r.data.inviteReward }; }
          if (r.status === 409) { setRev(r.data.rev); emit('conflict', r.data); return { ok: false, conflict: true, save: r.data.save, rev: r.data.rev }; }
          if (r.status === 422 && r.data.error === 'suspicious_save') return { ok: false, rejected: true, reasons: r.data.reasons || [], code: r.data.code || 'suspicious', reload: !!r.data.reload };
          if (r.status === 400 && r.data && r.data.error === 'invalid_save') return { ok: false, rejected: true, reasons: r.data.errors || [r.data.message || '存檔格式錯誤'], code: 'invalid' };
          if (r.status === 429) return { ok: false, tooFrequent: true };
          return ok(r);
        });
      },
      get rev() { return rev; },
      get clientBuild() { return clientBuild; }, set clientBuild(v) { clientBuild = v ? String(v) : null; },
      // 重新開始：伺服器建立全新的開局存檔（之後再以 writeSave 覆蓋）
      resetSave: function () { return request('POST', '/api/save/reset', {}).then(ok).then(function (d) { setRev(d.rev); return d; }); },

      // ---------- 心跳 / 事件 ----------
      heartbeat: function () {
        return request('POST', '/api/heartbeat', { sessionId: Number(store.getItem(K.sid) || 0) }).then(ok).then(function (d) { store.setItem(K.sid, String(d.sessionId)); return d; });
      },
      startHeartbeat: function (ms) {
        sdk.stopHeartbeat();
        var beat = function () { if (typeof document === 'undefined' || !document.hidden) sdk.heartbeat().catch(function () {}); };
        beat(); hbTimer = setInterval(beat, ms || 30000);
        flushTimer = setInterval(function () { sdk.flush(); }, 10000);
        if (typeof addEventListener === 'function') addEventListener('pagehide', function () { sdk.flush(true); });
      },
      stopHeartbeat: function () { clearInterval(hbTimer); clearInterval(flushTimer); hbTimer = flushTimer = null; },
      track: function (type, data) { queue.push({ type: String(type), data: data == null ? null : data }); if (queue.length >= 40) sdk.flush(); },
      flush: function (keepalive) {
        if (!queue.length || !token()) return Promise.resolve(0);
        var batch = queue.splice(0, 50);
        return request('POST', '/api/events', { events: batch }, { keepalive: !!keepalive }).then(ok).then(function (d) { return d.accepted; }).catch(function () { queue = batch.concat(queue).slice(0, 200); return 0; });
      },

      // ---------- 公告 / 信箱 ----------
      getAnnouncements: function () { return request('GET', '/api/announcements', undefined, { noAuth: true }).then(ok).then(function (d) { return d.announcements; }); },
      getMailbox: function () { return request('GET', '/api/mailbox').then(ok).then(function (d) { return d.mail; }); },
      claimMail: function (id) { return request('POST', '/api/mailbox/' + id + '/claim', {}).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },

      // ---------- 商城 / 會員 ----------
      listProducts: function () { return request('GET', '/api/shop/products').then(ok); },
      createOrder: function (sku, o) {
        o = o || {};
        var idem = o.idempotencyKey || (sku + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
        return request('POST', '/api/shop/orders', { sku: sku, provider: o.provider || 'mock', idempotencyKey: idem }).then(ok).then(function (d) {
          if (o.redirect !== false && typeof window !== 'undefined') sdk.openCheckout(d.checkout);
          return d;
        });
      },
      // 依金流回傳的類型開啟付款頁
      openCheckout: function (c) {
        if (!c) return;
        if (c.type === 'mock') window.open(base + c.payUrl, '_blank');
        else if (c.type === 'redirect') location.href = c.url;
        else if (c.type === 'form_post') {
          var f = document.createElement('form'); f.method = 'POST'; f.action = c.action;
          for (var k in c.fields) { var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = c.fields[k]; f.appendChild(i); }
          document.body.appendChild(f); f.submit();
        }
      },
      getOrder: function (id) { return request('GET', '/api/shop/orders/' + encodeURIComponent(id)).then(ok).then(function (d) { return d.order; }); },
      waitForOrder: function (id, o) {
        o = o || {}; var until = Date.now() + (o.timeoutMs || 10 * 60000);
        return new Promise(function (resolve, reject) {
          (function poll() {
            sdk.getOrder(id).then(function (ord) {
              if (ord.status !== 'pending') return resolve(ord);
              if (Date.now() > until) return resolve(ord);
              setTimeout(poll, o.intervalMs || 3000);
            }).catch(reject);
          })();
        });
      },
      // 寶石購買限定魚：伺服器扣寶石並把魚寫入雲端存檔，回傳 { order, balance, save, rev, fish }（請先 writeSave 同步）
      removePlant: function (id) { return request('POST', '/api/aquascape/remove', { id: id }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },   // v4.2
      buyItem: function (kind, id, idempotencyKey) { return request('POST', '/api/shop/buy-item', { kind: kind, id: id, idempotencyKey: idempotencyKey || ('it-' + kind + '-' + id + '-' + Date.now()) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      buySpecies: function (species, idempotencyKey) { return request('POST', '/api/shop/buy-species', { species: species, idempotencyKey: idempotencyKey || ('sp-' + species + '-' + Date.now()) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      buyWithGems: function (sku) { return request('POST', '/api/shop/buy-with-gems', { sku: sku, idempotencyKey: sku + '-' + Date.now() }).then(ok); },
      getEntitlements: function () { return request('GET', '/api/entitlements').then(ok); },
      getWallet: function () { return request('GET', '/api/wallet').then(ok); },
      getPremiumBalance: function () { return sdk.getWallet().then(function (w) { return w.gems; }); },
      claimVipDaily: function () { return request('POST', '/api/vip/daily', {}).then(ok); },

      // ---------- 💳 儲值（綠界） ----------
      payProducts: function () { return request('GET', '/api/pay/products').then(ok); },
      // 建立訂單後由瀏覽器 POST 到綠界付款頁（同一個分頁，手機不會被擋彈出視窗）；o.redirect=false 時只回傳資料
      payCreate: function (productId, o) {
        o = o || {};
        return request('POST', o.provider ? '/api/pay/create' : '/api/pay/ecpay/create', o.provider ? { productId: productId, provider: o.provider } : { productId: productId }).then(ok).then(function (d) {
          if (o.redirect !== false && typeof window !== 'undefined') sdk.openCheckout(d.checkout);
          return d;
        });
      },
      // 💎 本週限定／加速／外觀（v4.1）：回傳的 save / rev 為伺服器寫入後的存檔
      gemShop: function () { return request('GET', '/api/gemshop').then(ok); },
      weeklyBuy: function (id, idempotencyKey) { return request('POST', '/api/gemshop/weekly/buy', { id: id, idempotencyKey: idempotencyKey || ('wk-' + id + '-' + Date.now()) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      coinCosmeticBuy: function (id, key) { return request('POST', '/api/gemshop/cosmetic/coin-buy', { id: id, baseRev: rev, idempotencyKey: key || ('coin-bg-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8)) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      cosmeticBuy: function (id, idempotencyKey) { return request('POST', '/api/gemshop/cosmetic/buy', { id: id, idempotencyKey: idempotencyKey || ('cs-' + id + '-' + Date.now()) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      speedup: function (kind, fishId, idempotencyKey) { return request('POST', '/api/gemshop/speedup', { kind: kind, fishId: fishId, idempotencyKey: idempotencyKey || ('su-' + kind + '-' + (fishId || '') + '-' + Date.now()) }).then(ok).then(function (d) { if (d.rev) setRev(d.rev); return d; }); },
      cardClaim: function () { return request('POST', '/api/pay/card/claim', {}).then(ok); },
      payOrder: function (id) { return request('GET', '/api/pay/orders/' + encodeURIComponent(id)).then(ok); },
      payOrders: function () { return request('GET', '/api/pay/orders').then(ok); },
      payCheck: function (id) { return request('POST', '/api/pay/orders/' + encodeURIComponent(id) + '/check', {}).then(ok); },
      payUnacked: function () { return request('GET', '/api/pay/unacked').then(ok); },
      payAck: function (id) { return request('POST', '/api/pay/orders/' + encodeURIComponent(id) + '/ack', {}).then(ok); },
      payFunnel: function (step, pack) { return request('POST', '/api/pay/funnel', { step: step, pack: pack || '' }).then(ok); },
    };
    return sdk;
  }
  function memoryStorage() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }

  var api = { create: create, memoryStorage: memoryStorage, version: '1.1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FishSDK = api;
})(typeof window !== 'undefined' ? window : globalThis);
