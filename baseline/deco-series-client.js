/* DECO-SERIES-V1 (feedfishs 4.2.119+): 五套系列造景。純裝飾；同系列 10 件全部擺在魚缸內才有套裝效果。
   造景資料（名稱、價格、系列）只來自遊戲設定 CFG；本檔只載入圖片目錄（大小／錨點）。需要 index.html 的 window.__ffDeco。 */
(function (w) {
  'use strict';
  var CAT_V = 'r8b';
  var fx = function () { return (w.__ffDeco && w.__ffDeco()) || {}; };
  var mult = function (n) { return typeof n === 'number' && n > 0 ? n : 1; };
  function seriesCfg() { var C = fx().CFG; return (C && C.decoSeries && typeof C.decoSeries === 'object') ? C.decoSeries : {}; }
  function ids() { return Object.keys(seriesCfg()); }
  function keysOf(sid) { var m = seriesCfg()[sid], D = fx().DECOS || {}; return (m && Array.isArray(m.keys) ? m.keys : []).filter(function (k) { return D[k]; }); }
  function progress(sid) {
    var f = fx(), S = f.S, inv = f.DecoInventoryUI, keys = keysOf(sid);
    var tank = new Set((S && S.up && S.up.deco) || []);
    var placed = 0, owned = 0;
    keys.forEach(function (k) { var t = tank.has(k); if (t) placed++; if (t || (inv && inv.has && inv.has(k))) owned++; });
    return { placed: placed, owned: owned, total: keys.length, complete: keys.length > 0 && placed >= keys.length };
  }
  var memo = { sig: '', b: null };
  function combineBonus() {
    var S = fx().S, sig = JSON.stringify((S && S.up && S.up.deco) || []) + '|' + ids().join();
    if (memo.b && memo.sig === sig) return memo.b;
    var b = { finHealMult: 1, mutationRelMult: 1, dirtRateMult: 1, growthMult: 1, sickRateMult: 1 };
    ids().forEach(function (sid) {
      if (!progress(sid).complete) return;
      var x = seriesCfg()[sid].bonus || {};
      for (var k in b) b[k] *= mult(x[k]);
    });
    memo = { sig: sig, b: b };
    return b;
  }
  function lay() { try { var L = fx().LAY; if (L) { L.dirty = true; L.sig = ''; } } catch (e) {} }
  var DS = {
    spec: {}, cache: {}, cat: null, _boot: null,
    enabled: function () { return ids().length > 0; },
    ids: ids, keysOf: keysOf, progress: progress, meta: function (sid) { return seriesCfg()[sid] || null; },
    seriesOf: function (k) { var D = fx().DECOS || {}; var s = D[k] && D[k].series; return s && seriesCfg()[s] ? s : null; },
    finHealMult: function () { return combineBonus().finHealMult; },
    mutationRelMult: function () { return combineBonus().mutationRelMult; },
    dirtMult: function () { return combineBonus().dirtRateMult; },
    growthMult: function () { return combineBonus().growthMult; },
    sickMult: function () { return combineBonus().sickRateMult; },
    boot: function () {
      if (this._boot) return this._boot;
      var self = this, ART = fx().ART;
      if (!ART) return Promise.resolve();
      this._boot = fetch(ART.base + 'deco-series-v1/catalog.json?v=' + CAT_V)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cat) {
          if (!cat || !Array.isArray(cat.items)) return;
          self.cat = cat;
          cat.items.forEach(function (it) { self.spec[it.id] = it; });
          self.merge(); lay();
          document.documentElement.dataset.ds = '1';
        }).catch(function () {});
      return this._boot;
    },
    merge: function () {
      var f = fx(), D = f.DECOS, B = f.DECO_BOX;
      if (!this.cat || !D) return;
      this.cat.items.forEach(function (it) {
        if (!D[it.id]) return;
        D[it.id].draw = it.id; D[it.id].kind = 'ornament'; D[it.id].img = it.sprite;
        if (it.box && B) B[it.id] = it.box;
      });
    },
    img: function (path) {
      var ART = fx().ART;
      if (!path || !ART) return null;
      var im = this.cache[path];
      if (!im) {
        im = new Image(); im.decoding = 'async'; im.src = ART.base + path; this.cache[path] = im;
        if (im.decode) im.decode().then(lay).catch(function () {});
      }
      return im.complete && im.naturalWidth ? im : null;
    },
    draw: function (ctx, k, D, x, fy) {
      var s = this.spec[k];
      if (!s) return false;
      var im = this.img(s.sprite);
      if (!im) return true;
      var box = s.box || [-30, 30, 60];
      ctx.save(); ctx.fillStyle = 'rgba(10,36,40,.18)'; ctx.beginPath();
      ctx.ellipse(x + (box[0] + box[1]) * 0.3, fy + 3, (box[1] - box[0]) * 0.46, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      var ax = s.anchor.x * s.dw, ay = s.anchor.y * s.dh;
      ctx.drawImage(im, x - ax, fy - ay, s.dw, s.dh);
      return true;
    },
    pixelHitSpec: function (k, dx, dy) {
      var s = this.spec[k];
      if (!s) return null;
      var im = this.img(s.sprite);
      if (!im) return { im: null };
      return { im: im, u: (dx + s.anchor.x * s.dw) / s.dw, v: (dy + s.anchor.y * s.dh) / s.dh };
    },
    badge: function (sid) {
      var p = progress(sid), m = seriesCfg()[sid] || {};
      return { name: m.name || sid, label: m.bonusLabel || '', desc: m.bonusDesc || '', p: p };
    }
  };
  w.DECO_SERIES = DS;
})(window);
