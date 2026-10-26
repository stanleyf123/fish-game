/* DECO-SERIES-V1 — self-contained client module (port onto 4.2.118+; needs window.__ffDeco from applyConfig). */
(function (w) {
  'use strict';
  const fx = () => w.__ffDeco?.() || {};
  const mult = (n, d = 1) => (n > 0 ? n : d);

  function seriesCfg() {
    const CFG = fx().CFG;
    return (CFG && CFG.decoSeries) || {};
  }

  function progress(sid) {
    const { CFG, DECOS, S } = fx();
    const meta = seriesCfg()[sid];
    if (!meta || !Array.isArray(meta.keys)) return { placed: 0, total: 0, complete: false };
    const tank = new Set((S && S.up && S.up.deco) || []);
    const keys = meta.keys.filter((k) => DECOS && DECOS[k]);
    const placed = keys.filter((k) => tank.has(k)).length;
    return { placed, total: keys.length, complete: placed >= keys.length && keys.length > 0 };
  }

  function combineBonus() {
    const b = { finHealMult: 1, mutationRelMult: 1, dirtRateMult: 1, growthMult: 1, sickRateMult: 1 };
    for (const sid of Object.keys(seriesCfg())) {
      if (!progress(sid).complete) continue;
      const x = seriesCfg()[sid].bonus || {};
      b.finHealMult *= mult(x.finHealMult);
      b.mutationRelMult *= mult(x.mutationRelMult);
      b.dirtRateMult *= mult(x.dirtRateMult);
      b.growthMult *= mult(x.growthMult);
      b.sickRateMult *= mult(x.sickRateMult);
    }
    return b;
  }

  const DS = {
    spec: {},
    cache: {},
    _boot: null,
    _patch: null,
    enabled() {
      const CFG = fx().CFG;
      return !!(CFG && CFG.decoSeries && Object.keys(CFG.decoSeries).length);
    },
    finHealMult: () => combineBonus().finHealMult,
    mutationRelMult: () => combineBonus().mutationRelMult,
    dirtMult: () => combineBonus().dirtRateMult,
    growthMult: () => combineBonus().growthMult,
    sickMult: () => combineBonus().sickRateMult,
    progress,
    async loadConfigPatch() {
      if (this._patch) return this._patch;
      const { CFG, ART } = fx();
      const ver = (CFG && CFG.decoSeriesCatalogVersion) || 1;
      this._patch = fetch(ART.base + 'deco-series-v1/game-config-patch.json?v=' + ver)
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          const ctx = fx();
          if (!p || !ctx.CFG) return;
          Object.assign(ctx.CFG.decorations, p.decorations || {});
          ctx.CFG.decoSeries = p.decoSeries || ctx.CFG.decoSeries;
          ctx.CFG.decoSeriesCatalogVersion = p.decoSeriesCatalogVersion || 1;
          this.refreshDecosFromCfg();
        })
        .catch(() => {});
      return this._patch;
    },
    refreshDecosFromCfg() {
      const { CFG, DECOS } = fx();
      if (!DECOS || !CFG?.decorations) return;
      for (const [k, d] of Object.entries(CFG.decorations)) {
        if (!k.startsWith('ds_')) continue;
        DECOS[k] = {
          ...(DECOS[k] || {}),
          n: d.name,
          ic: d.icon,
          cost: d.cost,
          priceGems: d.priceGems || 0,
          bonus: d.coinBonus || 0,
          mut: d.mutationBonus || 0,
          desc: d.desc,
          draw: d.draw || k,
          x: d.x ?? 0.5,
          series: d.series || null,
          centerpiece: !!d.centerpiece,
        };
      }
      this.merge();
    },
    boot() {
      if (this._boot) return this._boot;
      const { CFG, ART, LAY } = fx();
      const ver = (CFG && CFG.decoSeriesCatalogVersion) || 1;
      this._boot = Promise.all([
        this.loadConfigPatch(),
        fetch(ART.base + 'deco-series-v1/catalog.json?v=' + ver)
          .then((r) => (r.ok ? r.json() : null))
          .then((cat) => {
            if (!cat) return;
            this.cat = cat;
            for (const it of cat.items || []) this.spec[it.id] = it;
            this.merge();
            try {
              if (LAY) {
                LAY.dirty = true;
                LAY.sig = '';
              }
            } catch (e) {}
            document.documentElement.dataset.ds = '1';
          }),
      ]).catch(() => {});
      return this._boot;
    },
    merge() {
      const { DECOS, DECO_BOX } = fx();
      if (!this.cat || !DECOS) return;
      for (const it of this.cat.items || []) {
        if (!DECOS[it.id]) continue;
        DECOS[it.id] = {
          ...DECOS[it.id],
          draw: it.id,
          kind: it.kind || 'ornament',
          series: it.series || DECOS[it.id].series,
          img: it.sprite,
        };
        if (it.box && DECO_BOX) DECO_BOX[it.id] = it.box;
      }
    },
    img(path) {
      const { ART, LAY } = fx();
      if (!path || !ART) return null;
      let im = this.cache[path];
      if (!im) {
        im = new Image();
        im.decoding = 'async';
        im.src = ART.base + path;
        this.cache[path] = im;
        im.decode()
          .then(() => {
            try {
              if (LAY) {
                LAY.dirty = true;
                LAY.sig = '';
              }
            } catch (e) {}
          })
          .catch(() => {});
      }
      return im.complete && im.naturalWidth ? im : null;
    },
    blit(ctx, sprite, shadow, anchor, dw, dh, x, y) {
      const im = this.img(sprite);
      if (!im || !anchor) return null;
      const sh = shadow ? this.img(shadow) : null;
      const ax = anchor.x * dw;
      const ay = anchor.y * dh;
      if (sh) ctx.drawImage(sh, x - ax, y - ay, dw, dh);
      ctx.drawImage(im, x - ax, y - ay, dw, dh);
      return { w: dw, h: dh, ax, ay };
    },
    draw(ctx, k, D, x, fy) {
      const s = this.spec[k];
      if (!s) return false;
      const { DECO_BOX } = fx();
      const box = (DECO_BOX && DECO_BOX[k]) || [-30, 30, 60];
      ctx.save();
      ctx.fillStyle = 'rgba(10,36,40,.18)';
      ctx.beginPath();
      ctx.ellipse(x + (box[0] + box[1]) * 0.3, fy + 3, (box[1] - box[0]) * 0.48, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return !!this.blit(ctx, s.sprite, s.shadow, s.anchor, s.dw, s.dh, x, fy);
    },
    pixelHitSpec(k, dx, dy) {
      const s = this.spec[k];
      if (!s) return null;
      const im = this.img(s.sprite);
      if (!im) return { im: null };
      const w = s.dw;
      const h = s.dh;
      const ax = s.anchor.x * w;
      const ay = s.anchor.y * h;
      return { im, u: (dx + ax) / w, v: (dy + ay) / h };
    },
    shopDesc(k, baseDesc) {
      const { DECOS } = fx();
      const d = DECOS && DECOS[k];
      if (d && d.series) return d.desc || '';
      return baseDesc(k);
    },
    tankBadgesHtml() {
      const { esc } = fx();
      if (!this.enabled() || !esc) return '';
      const bits = Object.keys(seriesCfg())
        .map((sid) => {
          const m = seriesCfg()[sid];
          const p = progress(sid);
          return `<span class="col-badge${p.complete ? ' got' : ''}">${esc(m.name)} ${p.placed}/${p.total}</span>`;
        })
        .join(' ');
      return bits ? `<p class="fs-note di-series">${bits}</p>` : '';
    },
    decoShopHtml(decoMult, decoShopDesc) {
      const { esc, fmt, DECOS, S, DecoInventoryUI, ART } = fx();
      let h = `<div class="card sv2-note"><h4>🪸 造景商店</h4><div class="note">系列造景為純裝飾；集滿同一系列並全部擺在魚缸內可啟動套裝效果（見系列標題）。經典加成造景仍依「老玩家保留加成」規則。目前收益 ×${decoMult().toFixed(2)}</div></div>`;
      const inSeries = new Set();
      for (const sid of Object.keys(seriesCfg())) {
        const meta = seriesCfg()[sid];
        if (!meta) continue;
        const prog = progress(sid);
        h += `<div class="sec sv2-sec">${esc(meta.name)} <span class="col-badge${prog.complete ? ' got' : ''}">魚缸 ${prog.placed}/${prog.total}</span></div><div class="note sv2-hint">${esc(meta.bonusLabel)} — ${esc(meta.bonusDesc)}</div>`;
        for (const k of meta.keys || []) {
          if (!DECOS[k]) continue;
          inSeries.add(k);
          h += this.shopRow(k, decoShopDesc, { esc, fmt, DECOS, S, DecoInventoryUI, ART });
        }
      }
      const classic = Object.keys(DECOS)
        .filter((k) => !inSeries.has(k))
        .sort((a, b) => (DECOS[b].priceGems > 0) - (DECOS[a].priceGems > 0));
      if (classic.length) {
        h += `<div class="sec sv2-sec">沉木・石頭・經典造景</div>`;
        for (const k of classic) h += this.shopRow(k, decoShopDesc, { esc, fmt, DECOS, S, DecoInventoryUI, ART });
      }
      if (w.G41) h += '<div class="note sv2-hint">🎨 魚缸背景在 <button type="button" class="sv2-link" data-sv2cat="vip">⭐ 限定特權 →</button></div>';
      return h;
    },
    shopRow(k, decoShopDesc, ctx) {
      const { esc, fmt, DECOS, S, DecoInventoryUI, ART } = ctx;
      const d = DECOS[k];
      const own = S.up.deco.includes(k) || DecoInventoryUI.has(k);
      const s = this.spec[k];
      const ic = s?.sprite
        ? `<img alt="" src="${ART.base}${s.sprite}" style="width:46px;height:46px;object-fit:contain">`
        : d.img
          ? `<img alt="" src="${ART.base}${d.img}" style="width:46px;height:46px;object-fit:contain">`
          : d.ic;
      return `<div class="item sv2-it${d.priceGems > 0 ? ' gem-deco-card' : ''}"><div class="ic">${ic}</div><div class="txt"><div class="nm">${d.n}${d.priceGems > 0 ? '<span class="prem-badge">💎 精品造景</span>' : ''}${own ? '<span class="col-badge got">✅ 已購買</span>' : ''}</div><div class="ds">${esc(this.shopDesc(k, decoShopDesc))}</div></div><button class="buy ${own ? 'done' : ''}" data-deco="${k}" ${own || (!(d.priceGems > 0) && S.coins < d.cost) ? 'disabled' : ''}>${own ? '已購買' : d.priceGems > 0 ? '💎' + fmt(d.priceGems) : '🪙' + fmt(d.cost)}</button></div>`;
    },
    installHooks() {
      if (this._hooks) return;
      this._hooks = 1;
      w.decoSeriesProgress = (sid) => progress(sid);
      const dirt = w.dirtRatePerHour;
      if (typeof dirt === 'function') {
        w.dirtRatePerHour = function (active) {
          return dirt(active) * DS.dirtMult();
        };
      }
      const desc = w.decoShopDesc;
      if (typeof desc === 'function') {
        w.decoShopDesc = function (k) {
          return DS.shopDesc(k, desc);
        };
      }
    },
  };

  w.DECO_SERIES = DS;
})(window);
