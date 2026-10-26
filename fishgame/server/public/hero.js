/* 悠游水族箱 — 英雄魚 / 非同步 PvP 前端模組（hero.js）
 * 單一檔案、無相依；可選用 window.FishRender（/sdk/fishrender.js）畫出真實魚種。
 *
 *   const ui = HeroUI.mount(document.getElementById('heroRoot'), {
 *     baseUrl: '',                       // API 來源（與遊戲 Cloud 相同）
 *     getToken: () => localStorage.getItem('fishsdk.token'),
 *     getSpecies: (id) => SPECIES[id],   // 選用：遊戲端已整理好的魚種外觀（含混種）
 *     beforeSpend: () => Cloud.pushNow(),// 選用：花金幣前先把本機存檔推上雲端
 *     onSaveChanged: ({ coins, rev }) => {...}, // 伺服器扣了金幣 → 遊戲同步
 *     onNeedRegister: () => Cloud.acctModal('register', '...'),
 *     onClose: () => {...},              // 選用：顯示右上角關閉鈕
 *   });
 *   ui.open('battle'); ui.refresh(); ui.destroy();
 *
 * 原則：所有數值、扣款、戰鬥結果都由伺服器決定；本模組只顯示與送出「意圖」。
 */
(function (root) {
  'use strict';
  const STAT_LABEL = { hp: '生命', atk: '攻擊', def: '防禦', spd: '速度', crit: '暴擊', dodge: '閃避', critDmg: '暴傷' };
  const TABS = [['hero', '英雄'], ['train', '訓練'], ['skills', '技能'], ['gear', '裝備'], ['battle', '對戰'], ['rank', '排行榜'], ['log', '戰報']];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('zh-TW'));
  const pct = (v) => (v / 10).toFixed(1).replace(/\.0$/, '') + '%';
  const dur = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const tf = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  const when = (ms) => (tf ? tf.format(new Date(ms)) : new Date(ms).toLocaleString());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const CSS = `
.hx{--bg:#06090f;--p1:#0c121c;--p2:#121b29;--ln:#22314a;--tx:#dfe8f5;--mu:#7d8ea8;--cy:#38e1ff;--rd:#ff3b5c;--gd:#ffc847;--gr:#41e39a;--pu:#b77dff;
  position:relative;color:var(--tx);background:radial-gradient(120% 80% at 50% 0%,#0f1a2b 0%,var(--bg) 60%);font:14px/1.45 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;border:1px solid var(--ln);border-radius:14px;overflow:hidden;min-height:420px;letter-spacing:.2px}
.hx *{box-sizing:border-box}
.hx button{font:inherit;color:inherit}
.hx .hx-top{display:flex;gap:14px;align-items:center;padding:14px 16px;background:linear-gradient(180deg,rgba(56,225,255,.06),transparent);border-bottom:1px solid var(--ln)}
.hx .hx-por{width:112px;height:70px;flex:none;border-radius:10px;background:#03060b;border:1px solid var(--ln);box-shadow:inset 0 0 24px rgba(56,225,255,.12)}
.hx .hx-id{flex:1;min-width:0}
.hx .hx-nm{font-weight:800;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx .hx-sub{color:var(--mu);font-size:12px}
.hx .hx-xp{height:6px;background:#0a1220;border-radius:3px;overflow:hidden;margin-top:6px;border:1px solid #1a2840}
.hx .hx-xp i{display:block;height:100%;background:linear-gradient(90deg,#2a7dff,var(--cy))}
.hx .hx-res{display:flex;flex-direction:column;gap:4px;align-items:flex-end;font-variant-numeric:tabular-nums}
.hx .hx-chip{display:inline-flex;gap:5px;align-items:center;background:#0a111c;border:1px solid var(--ln);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap}
.hx .rk{display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:12px;padding:2px 9px 2px 7px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);background:rgba(255,255,255,.07);color:var(--c);border-left:2px solid var(--c)}
.hx .hx-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--ln);overflow-x:auto;scrollbar-width:none;background:#080d15}
.hx .hx-tabs button{background:none;border:0;padding:10px 13px;color:var(--mu);font-weight:800;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.hx .hx-tabs button.on{color:var(--tx);border-bottom-color:var(--cy);text-shadow:0 0 12px rgba(56,225,255,.5)}
.hx .hx-x{position:absolute;right:8px;top:6px;background:none;border:0;color:var(--mu);font-size:22px;cursor:pointer;z-index:5}
.hx .hx-body{padding:14px 16px 18px}
.hx .hx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.hx .cd{background:linear-gradient(180deg,var(--p2),var(--p1));border:1px solid var(--ln);border-radius:10px;padding:12px;position:relative}
.hx .cd h4{margin:0 0 4px;font-size:15px}
.hx .cd .ds{color:var(--mu);font-size:12px;min-height:34px}
.hx .cd.off{opacity:.55}
.hx .cd.sel{border-color:var(--cy);box-shadow:0 0 0 1px var(--cy),0 0 18px rgba(56,225,255,.18)}
.hx .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hx .sp{flex:1}
.hx .mu{color:var(--mu)} .hx .sm{font-size:12px}
.hx .bt{background:linear-gradient(180deg,#1d3554,#13243b);border:1px solid #2c4a70;border-radius:8px;padding:7px 13px;font-weight:800;cursor:pointer;white-space:nowrap}
.hx .bt:hover:not(:disabled){filter:brightness(1.2)}
.hx .bt:disabled{opacity:.45;cursor:not-allowed}
.hx .bt.pr{background:linear-gradient(180deg,#ff5470,#c51f3d);border-color:#ff6f86;color:#fff;box-shadow:0 0 16px rgba(255,59,92,.25)}
.hx .bt.cy{background:linear-gradient(180deg,#1aa9d6,#0b6f97);border-color:#38e1ff;color:#fff}
.hx .bt.gm{background:linear-gradient(180deg,#8b5cf6,#5b2dc2);border-color:#b77dff;color:#fff}
.hx .bt.sm{padding:4px 9px;font-size:12px}
.hx .st{display:grid;grid-template-columns:52px 1fr 64px;gap:8px;align-items:center;margin:6px 0;font-variant-numeric:tabular-nums}
.hx .st .b{height:8px;background:#0a1220;border-radius:2px;overflow:hidden;border:1px solid #1a2840}
.hx .st .b i{display:block;height:100%}
.hx .st .v{text-align:right;font-weight:800}
.hx .pw{font-size:30px;font-weight:900;color:var(--gd);text-shadow:0 0 18px rgba(255,200,71,.35);font-variant-numeric:tabular-nums}
.hx .tag{display:inline-block;font-size:11px;font-weight:800;border:1px solid currentColor;border-radius:4px;padding:0 5px;margin-right:4px}
.hx .bar2{height:5px;background:#0a1220;border-radius:3px;overflow:hidden;margin:6px 0}
.hx .bar2 i{display:block;height:100%;background:var(--cy)}
.hx .cdn{font-variant-numeric:tabular-nums;color:var(--gd);font-weight:800}
.hx .slot{border:1px dashed #33507a;border-radius:10px;padding:10px;min-height:60px;display:flex;gap:8px;align-items:center}
.hx .slot.f{border-style:solid;background:rgba(56,225,255,.06)}
.hx .ic{font-size:22px;width:34px;text-align:center;flex:none}
.hx table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.hx th,.hx td{padding:8px 6px;border-bottom:1px solid #18243a;text-align:left}
.hx th{color:var(--mu);font-size:12px}
.hx tr.me td{background:rgba(56,225,255,.08)}
.hx tr.ck{cursor:pointer} .hx tr.ck:hover td{background:rgba(255,255,255,.03)}
.hx .num{text-align:right}
.hx .win{color:var(--gr);font-weight:800} .hx .lose{color:var(--rd);font-weight:800}
.hx .opp{display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center}
.hx .opp canvas{width:96px;height:60px;border-radius:8px;background:#03060b;border:1px solid var(--ln)}
.hx .gain{font-size:12px;font-variant-numeric:tabular-nums;margin-bottom:6px;text-align:right}
.hx .reg{text-align:center;padding:26px 14px;border:1px solid #3a2a55;background:linear-gradient(180deg,rgba(183,125,255,.08),transparent);border-radius:12px}
.hx .reg h3{margin:0 0 6px;font-size:18px}
.hx .empty{color:var(--mu);text-align:center;padding:30px}
.hx .toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:#0d1626;border:1px solid var(--ln);border-left:3px solid var(--gr);padding:9px 14px;border-radius:8px;z-index:30;max-width:90%;box-shadow:0 8px 30px rgba(0,0,0,.5);font-weight:700}
.hx .toast.bad{border-left-color:var(--rd)}
.hx .ov{position:fixed;inset:0;background:#041018;z-index:90;display:flex;flex-direction:column}
.hx .ov canvas{flex:1;width:100%;min-height:0;display:block;touch-action:none}
.hx .ovb{display:flex;gap:6px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:rgba(8,18,32,.94);border-top:1px solid rgba(226,203,166,.4);align-items:center;flex-wrap:wrap}
.hx .ovb .bt.on{border-color:#E2CBA6;color:#FFF8EC}
.hx .rs{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(closest-side,rgba(0,0,0,.55),rgba(0,0,0,.85));z-index:25;animation:hxIn .35s ease-out}
.hx .rsb{text-align:center;padding:24px 28px;min-width:280px;max-width:92%;background:linear-gradient(180deg,#0f1828,#090e17);border:1px solid var(--ln);border-radius:14px;box-shadow:0 0 60px rgba(0,0,0,.6)}
.hx .rsb .big{font-size:44px;font-weight:900;letter-spacing:6px;margin:0}
.hx .rsb .big.w{color:var(--gd);text-shadow:0 0 30px rgba(255,200,71,.6)}
.hx .rsb .big.l{color:#8c9ab3;text-shadow:0 0 20px rgba(255,59,92,.4)}
.hx .rsb .rt{font-size:26px;font-weight:900;font-variant-numeric:tabular-nums;margin:10px 0 4px}
.hx .rsb .dl{font-size:18px;font-weight:900;margin-left:8px}
.hx .promo{display:inline-block;margin-top:8px;font-weight:900;padding:4px 12px;border-radius:6px;background:rgba(255,200,71,.12);color:var(--gd);border:1px solid rgba(255,200,71,.5);animation:hxPulse 1.2s ease-in-out infinite}
.hx .promo.down{background:rgba(255,59,92,.1);color:#ff8ba0;border-color:rgba(255,59,92,.4);animation:none}
@keyframes hxIn{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}
@keyframes hxPulse{50%{box-shadow:0 0 20px rgba(255,200,71,.45)}}
.hx .ld{color:var(--mu);text-align:center;padding:40px}
@media (max-width:560px){
 .hx .hx-top{flex-wrap:wrap;gap:10px;padding:12px}
 .hx .hx-por{width:88px;height:56px}
 .hx .hx-res{flex-direction:row;flex-wrap:wrap;width:100%;justify-content:flex-start}
 .hx .hx-body{padding:12px 10px 16px}
 .hx .hx-grid{grid-template-columns:1fr}
 .hx .opp{grid-template-columns:72px 1fr}
 .hx .opp canvas{width:72px;height:46px}
 .hx .opp .oa{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}
 .hx .hide-m{display:none}
 .hx .rsb .big{font-size:34px}
}`;

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('hx-css')) return;
    const s = document.createElement('style'); s.id = 'hx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // 魚種外觀：遊戲端提供 getSpecies；否則抓 /api/config 一次（混種退回父本外觀）
  function SpeciesBook(opts) {
    let raw = null, loading = null;
    const cache = {};
    const FR = () => opts.fishRender || root.FishRender || null;
    function load() {
      if (raw || loading) return loading;
      loading = fetch((opts.baseUrl || '') + '/api/config').then((r) => r.json()).then((j) => { raw = (j.config || j).species || {}; }).catch(() => { raw = {}; });
      return loading;
    }
    function get(id) {
      if (!id) return null;
      if (cache[id]) return cache[id];
      let s = null;
      try { if (opts.getSpecies) s = opts.getSpecies(id); } catch (e) { s = null; }
      if (!s && raw && FR()) {
        let d = raw[id];
        const m = /^hx:([^+]+)\+(.+)$/.exec(id);
        if (!d && m && raw[m[1]]) d = Object.assign({}, raw[m[1]], { name: '混種' });
        if (d) s = FR().resolve(d, id);
      }
      if (s) cache[id] = s;
      return s;
    }
    return { load, get, FR };
  }

  // 後備畫法（沒有 FishRender 時）：鋒利的剪影
  function drawFallbackFish(c, hue, t, L) {
    const w = Math.sin(t * 8) * 0.18;
    c.save();
    const g = c.createLinearGradient(0, -L * 0.3, 0, L * 0.3);
    g.addColorStop(0, `hsl(${hue},45%,30%)`); g.addColorStop(0.5, `hsl(${hue},60%,55%)`); g.addColorStop(1, `hsl(${hue},40%,22%)`);
    c.fillStyle = g;
    c.beginPath(); c.moveTo(L * 0.5, 0); c.quadraticCurveTo(L * 0.1, -L * 0.32, -L * 0.32, -L * 0.06); c.lineTo(-L * 0.32, L * 0.06); c.quadraticCurveTo(L * 0.1, L * 0.3, L * 0.5, 0); c.fill();
    c.save(); c.translate(-L * 0.3, 0); c.rotate(w);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-L * 0.26, -L * 0.22); c.lineTo(-L * 0.18, 0); c.lineTo(-L * 0.26, L * 0.22); c.closePath(); c.fill(); c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(L * 0.3, -L * 0.05, L * 0.04, 0, 7); c.fill();
    c.fillStyle = '#000'; c.beginPath(); c.arc(L * 0.31, -L * 0.05, L * 0.02, 0, 7); c.fill();
    c.restore();
  }

  // 在 (x,y) 畫一條長度約 len 像素、面向 dir（1 右 / -1 左）的魚
  function drawArtSlices(c, im, m, len, t, extra) {
    extra = extra || {};
    if (root.FFART && typeof root.FFART.slices === 'function') { root.FFART.slices(c, im, m, len, t, extra); return; }   // V420A-TAIL：新版遊戲頁提供「只擺尾巴」畫法（頭不動）
    const L = len * ((m && m.lenRef) || 1), ar = (m && m.ar) || (im.width / im.height), Hh = L / ar;
    const ph = t * (extra.swim || 6), N = 12, sw = im.width / N;
    const tail = m && m.tailStart != null ? m.tailStart : 0.45, bend = (m && m.bend) || 0.08, amp = (m && m.tailAmp) || 0.16;
    const rush = extra.swim > 10 ? 1.5 : 1;
    for (let i = 0; i < N; i++) {
      const u = 1 - (i + 0.5) / N;
      const k = u < 1 - tail ? u * bend : bend + (u - (1 - tail)) * amp * 3;
      const dy = Math.sin(ph - u * 2.6) * Hh * k * rush;
      const sx = (N - 1 - i) * sw;
      c.drawImage(im, sx, 0, sw + 1, im.height, -L / 2 + (N - 1 - i) * L / N, -Hh / 2 + dy, L / N + 0.6, Hh);
    }
  }
  function drawFishAt(book, c, sp, hue, x, y, len, dir, t, extra) {
    extra = extra || {};
    const s = book.get(sp), FR = book.FR();
    c.save(); c.translate(x, y);
    if (extra.rot) c.rotate(extra.rot);
    c.scale(dir, 1);
    if (extra.alpha != null) c.globalAlpha *= extra.alpha;
    const art = root.FFART, aid = art && art.baseId ? art.baseId(sp) : null, aim = aid && art.get ? art.get(sp) : null;
    if (aim && art.meta && art.meta[aid] && !extra.sil) { drawArtSlices(c, aim, art.meta[aid], len, t, extra); c.restore(); return; }
    if (s && FR) {
      const sc = len / ((s.len || 30) * 1.25);
      c.scale(sc, sc);
      try { FR.drawFish(c, s, { hue: hue != null ? hue : s.hue, phase: t * (extra.swim || 6), seed: 7, full: 100, puff: extra.puff || 0, chomp: extra.chomp || 0, stg: 2 }, t, { sil: !!extra.sil, gentle: extra.gentle !== false, rim: extra.rim !== false }); }
      catch (e) { drawFallbackFish(c, hue || 200, t, (s.len || 30) * 1.25); }
    } else drawFallbackFish(c, hue != null ? hue : 200, t, len);
    c.restore();
  }

  // 小型肖像（深色背景）
  function drawPortrait(book, cv, sp, hue, t) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createRadialGradient(W / 2, H * 0.4, 4, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#11253b'); g.addColorStop(1, '#03060b');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(56,225,255,.08)'; c.lineWidth = 1;
    for (let i = 0; i < W; i += 12) { c.beginPath(); c.moveTo(i, H); c.lineTo(i + (i - W / 2) * 0.3, H * 0.62); c.stroke(); }
    drawFishAt(book, c, sp, hue, W / 2, H / 2 + Math.sin(t * 1.6) * 2, Math.min(W * 0.7, H * 1.25), 1, t, { swim: 4 });
  }

  // ===========================================================================
  // 戰鬥重播（Canvas）：伺服器 events 的播放層。不改事件順序與結果。
  // ===========================================================================
  const FX = {
    IMPACT_AT: 0.45,
    REDUCE_FLASH: 0.3,
    SHAKE_DECAY: 2.4,
    FLASH_DECAY: 3.2,
    FLASH_CAP: 0.6,
    ELEM: {
      normal: { c: '#FFF3DC', l: '#FFFFFF', d: '#B8A68C' },
      fire: { c: '#FF6A1F', l: '#FFC847', d: '#D62A10' },
      water: { c: '#2F9BFF', l: '#A8E6FF', d: '#1A56D6' },
      volt: { c: '#FFD21F', l: '#FFF6A0', d: '#FF9A12' },
      poison: { c: '#B77DFF', l: '#E6CCFF', d: '#6B3FB0' },
      light: { c: '#FFE28A', l: '#FFFAF0', d: '#FFAD3A' },
      ink: { c: '#5A4B3C', l: '#A89580', d: '#2A2018' },
      heal: { c: '#41E39A', l: '#C8FFE4', d: '#1E9E66' },
    },
    FX_ELEM: {
      bite: 'normal', ram: 'normal', pinch: 'normal', break: 'normal', slash: 'normal', swarm: 'normal', basic: 'normal',
      shock: 'volt', dragon: 'fire', frenzy: 'fire', sonar: 'water', bubble: 'water', tide: 'water', shell: 'water', evade: 'water',
      sting: 'poison', flash: 'light', focus: 'light', ink: 'ink', heal: 'heal', puff: 'normal',
    },
    elemOf(fx) { return this.ELEM[this.FX_ELEM[fx] || 'normal']; },
    chargeEnd(e) { return e && e.k === 'skill' ? 0.38 : 0.30; },
    durOf(e) {
      if (!e) return 0.9;
      if (e.k === 'ko') return 1.7;
      if (e.k === 'timeout') return 1.8;
      if (e.k === 'stunned') return 0.75;
      if (e.k === 'skill') return 1.14; // 蓄力 0.38×1.14s ≈ 普通攻擊蓄力的 1.6 倍
      return 0.9;
    },
  };
  const NUMF = '"Baloo 2", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  const GLYPHS = ['dot', 'softDot', 'spark', 'star4', 'ring', 'shock', 'droplet', 'bubble', 'splash', 'streak', 'flare', 'sunburst', 'glint', 'plus', 'shard', 'smoke'];
  let PART_ATLAS = null;
  function paintGlyph(g, name, r) {
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = Math.max(2, r * 0.16);
    if (name === 'dot') { g.beginPath(); g.arc(0, 0, r * 0.42, 0, 7); g.fill(); }
    else if (name === 'softDot' || name === 'flare' || name === 'smoke') {
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, r);
      rg.addColorStop(0, '#fff'); rg.addColorStop(name === 'flare' ? 0.35 : 0.55, 'rgba(255,255,255,.7)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    } else if (name === 'spark' || name === 'streak') {
      g.beginPath(); g.moveTo(-r, 0); g.lineTo(name === 'streak' ? r * 0.15 : r, 0); g.stroke();
    } else if (name === 'star4' || name === 'glint') {
      g.beginPath();
      const n = name === 'glint' ? 4 : 4;
      for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n - Math.PI / 2, rr = i % 2 ? r * 0.22 : r * (name === 'glint' ? 0.9 : 0.85); const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (!i) g.moveTo(px, py); else g.lineTo(px, py); }
      g.closePath(); g.fill();
    } else if (name === 'ring' || name === 'bubble') {
      g.lineWidth = r * 0.16; g.beginPath(); g.arc(0, 0, r * 0.62, 0, 7); g.stroke();
      if (name === 'bubble') { g.beginPath(); g.arc(-r * 0.18, -r * 0.2, r * 0.2, Math.PI * 1.05, Math.PI * 1.7); g.stroke(); }
    } else if (name === 'shock') {
      g.beginPath(); g.moveTo(-r * 0.1, -r); g.lineTo(r * 0.28, -r * 0.05); g.lineTo(-r * 0.02, r * 0.02); g.lineTo(r * 0.32, r); g.lineTo(-r * 0.22, r * 0.08); g.lineTo(r * 0.02, -r * 0.02); g.closePath(); g.fill();
    } else if (name === 'droplet') {
      g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(r * 0.85, -r * 0.05, r * 0.7, r * 0.65, 0, r * 0.72); g.bezierCurveTo(-r * 0.7, r * 0.65, -r * 0.85, -r * 0.05, 0, -r); g.fill();
    } else if (name === 'splash') {
      g.beginPath(); g.arc(0, r * 0.2, r * 0.32, 0, 7); g.fill();
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.42; g.save(); g.translate(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.5); g.rotate(a + Math.PI / 2); g.beginPath(); g.ellipse(0, 0, r * 0.1, r * 0.26, 0, 0, 7); g.fill(); g.restore(); }
    } else if (name === 'sunburst') {
      for (let i = 0; i < 10; i++) { g.save(); g.rotate(i * Math.PI / 5); g.fillRect(-r * 0.06, -r, r * 0.12, r * 0.72); g.restore(); }
      g.beginPath(); g.arc(0, 0, r * 0.22, 0, 7); g.fill();
    } else if (name === 'plus') {
      g.lineWidth = r * 0.28; g.beginPath(); g.moveTo(-r * 0.7, 0); g.lineTo(r * 0.7, 0); g.moveTo(0, -r * 0.7); g.lineTo(0, r * 0.7); g.stroke();
    } else {
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.42, r * 0.35); g.lineTo(-r * 0.18, r * 0.7); g.closePath(); g.fill();
    }
  }
  function partAtlas() {
    if (PART_ATLAS) return PART_ATLAS;
    if (typeof document === 'undefined') return null;
    const cell = 64, cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    GLYPHS.forEach((name, i) => { g.save(); g.translate((i % 4) * cell + cell / 2, ((i / 4) | 0) * cell + cell / 2); paintGlyph(g, name, cell * 0.36); g.restore(); });
    PART_ATLAS = { cv, index: Object.fromEntries(GLYPHS.map((k, i) => [k, i])), tint: new Map() };
    return PART_ATLAS;
  }
  function tintAtlas(hex) {
    const a = partAtlas(); if (!a) return null;
    const key = hex || '#fff';
    if (a.tint.has(key)) return a.tint.get(key);
    const cv = document.createElement('canvas'); cv.width = a.cv.width; cv.height = a.cv.height;
    const g = cv.getContext('2d'); g.drawImage(a.cv, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = key; g.fillRect(0, 0, cv.width, cv.height);
    a.tint.set(key, cv); return cv;
  }
  function hexA(hex, a) {
    const h = String(hex || '#fff').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (!Number.isFinite(n)) return `rgba(255,255,255,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function Replay(canvas, battle, opt) {
    const book = opt.book, cfg = opt.cfg || {}, SK = cfg.skills || {};
    const ctx = canvas.getContext('2d');
    const ev = battle.events || [];
    const snaps = [battle.a, battle.d];
    const maxHp = [snaps[0].stats.hp, snaps[1].stats.hp];
    const readReduce = () => {
      if (opt.reduceFlash != null) return !!opt.reduceFlash;
      try { return root.localStorage && root.localStorage.getItem('ff.reduceFlash') === '1'; } catch (e) { return false; }
    };
    const st = {
      hp: maxHp.slice(), lag: maxHp.slice(), sh: [0, 0], buffs: [[], []], stun: [false, false], dotKind: {},
      i: -1, p: 0, speed: opt.speed || 1, t: 0, sim: 0, shake: 0, flash: 0, flashCol: '#fff', done: false, ended: false, koSide: null,
      pos: [0, 1].map(() => ({ dx: 0, dy: 0, chomp: 0, hit: 0, puffT: 0 })),
      parts: [], texts: [], fx: [], banner: null, finalText: null, aura: [null, null], ghost: [0, 0], ink: [0, 0],
      reduce: readReduce(), freezeUntil: 0, slowUntil: 0, slowScale: 1, zoom: 1, panX: 0, panY: 0,
      trails: [[], []], trailCol: ['#FFF3DC', '#FFF3DC'], blooms: [], sheets: [], queue: [], fast: false,
    };
    let raf = 0, last = 0, W = 0, H = 0, dpr = 1;
    const hitCv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const snow = Array.from({ length: 48 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2.2 + 0.6, v: Math.random() * 0.018 + 0.004, ph: i }));
    const portrait = () => W > 0 && H > 0 && W / H < 0.8;
    // 直式：尾鰭朝外，身體略往中間，避免長尾被畫面裁掉；仍是斜向對峙。
    const home = (side) => (portrait()
      ? { x: W * (side === 0 ? 0.40 : 0.62), y: H * (side === 0 ? 0.70 : 0.36) }
      : { x: W * (side === 0 ? 0.28 : 0.72), y: H * 0.58 });
    const fishLen = () => (portrait() ? Math.min(W * 0.36, H * 0.20) : Math.min(W * 0.26, H * 0.42));
    const BIG_FX = { dragon: 1, shock: 1, ram: 1, flash: 1, swarm: 1, frenzy: 1 };
    const isBig = (e) => !!(e && BIG_FX[e.fx]);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    const durOf = (e) => FX.durOf(e);
    const partCap = (add) => {
      const coarse = !!(root.matchMedia && root.matchMedia('(pointer:coarse)').matches);
      const phone = coarse || W < 700;
      return phone ? (add ? 600 : 300) : (add ? 1200 : 600);
    };

    function resize() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = canvas.clientWidth || 640; H = canvas.clientHeight || 360;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    resize();

    function emit(kind, x, y, o) {
      o = o || {};
      const n = o.n || 1, add = o.add !== false;
      const cap = partCap(add);
      for (let i = 0; i < n; i++) {
        const same = st.parts.filter((p) => !!p.add === add);
        if (same.length >= cap) {
          const idx = st.parts.findIndex((p) => !!p.add === add);
          if (idx >= 0) st.parts.splice(idx, 1);
        }
        const a = o.dir != null ? o.dir + rnd(-0.55, 0.55) : rnd(0, Math.PI * 2);
        const sp = o.sp == null ? 160 : o.sp, v = sp <= 0 ? 0 : rnd(sp * 0.35, sp);
        st.parts.push({
          kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up || 0),
          g: o.g != null ? o.g : 280, size: rnd((o.size || 16) * 0.75, o.size || 16),
          col: o.col || '#fff', life: rnd((o.life || 0.55) * 0.75, o.life || 0.55), age: 0, add, rot: rnd(0, 6.2), spin: rnd(-3, 3),
        });
      }
    }
    function bloom(x, y, r, col) {
      st.blooms.push({ x, y, r, col, age: 0, life: 0.25 });
      if (st.blooms.length > 8) st.blooms.shift();
    }
    function text(side, str, col, size, o) {
      o = o || {};
      const h = home(side);
      st.texts.push({
        x: h.x + (o.dx != null ? o.dx : rnd(-12, 12)), y: h.y - fishLen() * 0.46 + (o.dy || 0),
        str, col, size: size || 28, age: 0, life: o.life || 1, crit: !!o.crit,
        rot: o.crit ? rnd(-6, 6) * Math.PI / 180 : 0, delay: o.delay || 0,
      });
    }
    function addFx(kind, from, to, life, data) { st.fx.push({ kind, from, to, life: life || 0.6, age: 0, data: data || {} }); }
    function sheetIm(name) {
      const im = (opt.sheets && opt.sheets[name]) || (root.FFART && root.FFART.sheets && root.FFART.sheets[name]);
      return im && im.complete && im.naturalWidth ? im : null;
    }
    function playSheet(name, x, y, scale) {
      const im = sheetIm(name);
      if (!im) return;
      st.sheets.push({ im, x, y, scale: scale || 1, age: 0, life: 0.55 });
    }
    const buffName = (b) => (STAT_LABEL[b.stat] || b.stat) + ((b.mult != null ? b.mult >= 1 : b.add >= 0) ? '↑' : '↓');
    function hitStop(sec) {
      if (st.reduce || st.fast || !(sec > 0)) return;
      const until = (root.performance ? root.performance.now() : Date.now()) + sec * 1000;
      if (until > st.freezeUntil) st.freezeUntil = until;
    }
    function isFinisher(e) {
      return !!(e && e.hp && (e.k === 'atk' || e.k === 'skill' || e.k === 'act') && (e.hp[0] <= 0 || e.hp[1] <= 0));
    }

    function startEvent(e) {
      const a = e.a;
      if (e.k === 'skill') { const d = SK[e.sk] || {}; st.banner = { side: a, str: (d.icon ? d.icon + ' ' : '') + (d.name || e.sk), age: 0 }; }
      if (e.dot) { text(a, '-' + e.dot, st.dotKind[a] === 'poison' ? '#B77DFF' : '#E8566C', 20, { dy: 10 }); st.hp[a] = Math.max(e.hp ? e.hp[a] : 0, st.hp[a] - e.dot); st.pos[a].hit = 1; }
      if (e.k === 'stunned') { text(a, '麻痺中…', '#FFE28A', 20); st.stun[a] = false; }
      if (e.k === 'ko') {
        st.finalText = { str: 'K.O.', age: 0, col: '#E8566C' }; st.shake = Math.max(st.shake, st.reduce ? 0 : 1); st.koSide = e.a;
        const c = { x: W / 2, y: H * 0.46 };
        playSheet('ko', c.x, c.y, 1.4);
        if (!st.fast) {
          if (!sheetIm('ko')) addFx('sunburst', c, c, 0.6, { col: '#FFE28A' });
          if (battle.winner === 0) {
            const cols = ['#FF9A4D', '#FFC845', '#5CC9D6', '#FFF8EC', '#E8566C', '#4CC38A'];
            for (let i = 0; i < 40; i++) emit(i % 3 ? 'shard' : 'softDot', rnd(W * 0.08, W * 0.92), rnd(-30, 10), { n: 1, col: cols[i % cols.length], sp: rnd(30, 120), g: 240, life: 1.7, size: rnd(10, 18), add: false, dir: Math.PI / 2 });
          }
        }
      }
      if (e.k === 'timeout') st.finalText = { str: '時間到', age: 0, col: '#FFC845' };
      if (e.k === 'act' || e.k === 'atk' || e.k === 'skill' || e.k === 'stunned') st.buffs[a] = (st.buffs[a] || []).map((b) => ({ ...b, turns: b.turns - 1 })).filter((b) => b.turns > 0);
    }

    function popHit(side, h, i, el) {
      const dx = i ? ((i % 2) ? 1 : -1) * (22 + i * 16) : 0;
      const dy = i ? -i * 20 : 0;
      if (h.miss) { text(side, '閃避', '#9aa9c2', 22, { dx, delay: 0 }); return; }
      const total = h.dmg + (h.absorbed || 0);
      if (h.crit) {
        text(side, '暴擊 ' + total, '#FFC847', 44, { dx, dy, life: 1.05, crit: true });
        const hp = home(side); emit('sunburst', hp.x + dx, hp.y - fishLen() * 0.5, { n: 1, col: el.l, sp: 0, g: 0, size: 70, life: 0.28, add: true });
      } else text(side, '-' + total, '#FFF8EC', 30, { dx, dy });
      if (h.absorbed) text(side, '護盾 ' + h.absorbed, '#A8E6FF', 16, { dx, dy: 28 });
    }

    function splashAt(x, y, el, L, fx) {
      const normal = !fx || ['bite', 'ram', 'pinch', 'break', 'slash', 'swarm', 'basic'].includes(fx);
      const sheetName = normal ? (fx === 'slash' ? 'slash' : 'splash') : fx === 'shock' ? 'lightning' : (fx === 'dragon' || fx === 'frenzy') ? 'flame' : (fx === 'heal' || fx === 'tide') ? 'heal' : null;
      const painted = !!(sheetName && sheetIm(sheetName));
      bloom(x, y, L * (painted ? 0.28 : 0.55), el.c);
      if (!painted) addFx('ring', { x, y }, { x, y }, fx === 'dragon' || fx === 'shock' ? 0.42 : 0.32, { col: el.l });
      if (normal) {
        if (!painted) {
          emit('splash', x, y, { n: 1, col: el.l, sp: 0, g: 0, size: Math.max(48, L * 0.9), life: 0.55, add: true });
          emit('droplet', x, y, { n: 14, col: el.l, sp: 260, g: 420, life: 0.85, size: 22, up: 40, add: true });
        }
        emit('bubble', x, y, { n: painted ? 4 : 8, col: '#F2FFFF', sp: 50, g: -70, life: 1.1, size: 16, add: false });
        playSheet(sheetName, x, y, 1);
      } else if (fx === 'shock') {
        if (!painted) {
          emit('spark', x, y, { n: 18, col: el.l, sp: 320, g: 40, life: 0.7, size: 26, add: true });
          emit('shock', x, y, { n: 5, col: el.c, sp: 30, g: 0, size: 72, life: 0.45, add: true });
        }
        playSheet('lightning', x, y, 1.1);
      } else if (fx === 'dragon' || fx === 'frenzy') {
        if (!painted) {
          emit('softDot', x, y, { n: 22, col: el.l, sp: 220, g: -50, life: 0.95, size: 36, add: true });
          emit('smoke', x, y, { n: 8, col: el.d, sp: 50, g: -24, life: 1.0, size: 40, add: true });
        }
        playSheet('flame', x, y, 1.15);
      } else if (fx === 'sting') {
        emit('droplet', x, y, { n: 10, col: el.l, sp: 160, g: 80, life: 0.7, size: 14, add: true });
      } else if (fx === 'heal' || fx === 'tide') {
        if (!painted) {
          emit('plus', x, y - 8, { n: 8, col: el.l, sp: 50, g: -80, life: 0.8, size: 18, add: true });
          emit('bubble', x, y, { n: 6, col: el.c, sp: 30, g: -50, life: 0.9, size: 14, add: true });
        }
        playSheet('heal', x, y, 1);
      } else {
        emit('softDot', x, y, { n: 10, col: el.l, sp: 160, g: 60, life: 0.45, size: 16, add: true });
      }
    }

    function impact(e) {
      if (!e) return;
      const a = e.a, b = 1 - a, A = home(a), B = home(b), L = fishLen();
      const fx = e.fx || 'basic', hits = e.hits || [];
      const el = FX.elemOf(fx);
      const dir = a === 0 ? 1 : -1;
      const tx = B.x - dir * L * 0.05, ty = B.y;
      st.trailCol[a] = el.c;
      const landed = hits.some((h) => !h.miss);
      const crit = hits.some((h) => h.crit && !h.miss);
      const fin = isFinisher(e);
      const big = e.k === 'skill' && (fx === 'dragon' || fx === 'shock' || fx === 'ram' || fx === 'flash' || hits.length >= 3);
      if (landed) {
        splashAt(tx, ty, el, L, fx);
        st.flash = Math.min(FX.FLASH_CAP, Math.max(st.flash, fx === 'flash' ? 0.6 : crit ? 0.5 : 0.34));
        st.flashCol = el.l;
        let sh = big ? 0.85 : 0.5;
        if (crit) sh *= 1.3;
        if (e.k === 'skill') sh *= 1.5;
        if (fin) sh = Math.max(sh, 1.15);
        if (!st.reduce) st.shake = Math.max(st.shake, Math.min(1.5, sh));
        const kick = big ? 1.08 : crit ? 1.05 : 1.02;
        st.zoom = Math.max(st.zoom, kick);
        if (!st.reduce && !st.fast) {
          if (fin) { hitStop(0.14); const now = root.performance ? root.performance.now() : Date.now(); st.slowUntil = now + 140 + 550; st.slowScale = 0.35; }
          else if (crit) hitStop(0.11);
          else hitStop(0.06);
        }
        st.pos[b].hit = 1;
      }
      if (fx === 'shock') addFx('bolt', A, B, 0.7, { col: el.l });
      if (fx === 'dragon') addFx('flame', A, B, 1.05, { col: el.c });
      if (fx === 'sonar') { addFx('sonar', A, B, 0.8, { col: el.l }); addFx('reticle', B, B, 0.9, { col: el.l }); }
      if (fx === 'sting') addFx('needle', A, B, 0.4, { col: el.l });
      if (fx === 'slash') addFx('arc', B, B, 0.4, { col: el.l });
      if (fx === 'ram') addFx('ring', B, B, 0.45, { col: '#fff' });
      if (fx === 'puff') { st.pos[a].puffT = 1.6; addFx('spikes', A, A, 0.7, { col: el.l }); }
      if (fx === 'shell' || fx === 'bubble' || fx === 'tide') addFx('shieldUp', A, A, 0.8, { col: el.l });
      if (fx === 'heal' || fx === 'tide') splashAt(A.x, A.y, FX.elemOf('heal'), L, 'heal');
      if (fx === 'frenzy') { st.aura[a] = { col: el.c, t: 3 }; bloom(A.x, A.y, L * 0.7, el.c); }
      if (fx === 'focus') { st.aura[a] = { col: el.l, t: 3 }; addFx('reticle', B, B, 0.9, { col: el.l }); }
      if (fx === 'evade') st.ghost[a] = 3;
      if (fx === 'ink') { st.ink[a] = 3; emit('smoke', A.x, A.y, { n: 14, col: el.l, sp: 90, g: -8, life: 1.1, size: 26, add: false }); }
      if (fx === 'flash') { st.flash = FX.FLASH_CAP; st.flashCol = el.l; addFx('ring', A, A, 0.5, { col: el.l }); }
      const multi = (fx === 'slash' || fx === 'swarm') && hits.length > 1 && !st.fast;
      if (multi) {
        const now = root.performance ? root.performance.now() : Date.now();
        hits.forEach((h, i) => st.queue.push({ at: now + i * 100, h, side: b, i, el }));
      } else hits.forEach((h, i) => popHit(b, h, i, el));
      hits.forEach((h) => { if (h.reflect) text(a, '反彈 -' + h.reflect, '#ff7ad9', 18, { dy: 8 }); });
      if (e.heal) text(a, '+' + e.heal, '#41E39A', 26);
      if (e.shield) text(a, '護盾 +' + e.shield, '#A8E6FF', 18, { dy: 24 });
      if (e.recoil) text(a, '反作用 -' + e.recoil, '#FF9A4D', 16, { dy: 30 });
      (e.buff || []).forEach((bf, i) => { st.buffs[a].push({ ...bf, good: true }); text(a, buffName(bf), '#5CC9D6', 15, { dy: 46 + i * 16 }); });
      (e.debuff || []).forEach((bf, i) => { st.buffs[b].push({ ...bf, turns: bf.turns + 1, good: false }); text(b, buffName(bf), '#E8566C', 15, { dy: 46 + i * 16 }); });
      if (e.dotApplied) { st.dotKind[b] = e.dotApplied.kind; text(b, e.dotApplied.kind === 'poison' ? '中毒' : '流血', e.dotApplied.kind === 'poison' ? '#B77DFF' : '#E8566C', 16, { dy: 64 }); }
      if (e.stun) { st.stun[b] = true; text(b, '麻痺！', '#FFE28A', 22, { dy: 40 }); }
      if (e.reflectOn) st.buffs[a].push({ stat: 'reflect', turns: e.reflectOn, good: true });
      if (e.hp) st.hp = e.hp.slice();
      st.sh = (e.sh || [0, 0]).slice();
    }
    function lungeOf(e) {
      if (!(e.hits && e.hits.length)) return 0;
      if (e.fx === 'ram') return 0.95;
      if (['shock', 'sonar', 'sting', 'dragon', 'swarm', 'flash'].includes(e.fx)) return 0.16;
      return 0.62;
    }
    function updEvent(e, p, prev) {
      if (!e || e.k === 'ko' || e.k === 'timeout') return;
      const a = e.a; if (a == null) return;
      const P = st.pos[a];
      const lg = lungeOf(e);
      const h0 = home(0), h1 = home(1);
      const ax = h1.x - h0.x, ay = h1.y - h0.y, dist = Math.hypot(ax, ay) || 1;
      const ux = ax / dist, uy = ay / dist;
      const gap = Math.max(8, dist - fishLen() * 0.85);
      const cEnd = FX.chargeEnd(e), iAt = FX.IMPACT_AT, back = 22 * (lg ? 1 : 0.35);
      let off;
      if (p < cEnd) off = -Math.sin((p / Math.max(0.05, cEnd)) * Math.PI / 2) * back;
      else if (p < iAt) off = -back + ((p - cEnd) / (iAt - cEnd)) * (gap * lg + back);
      else off = gap * lg * (1 - easeOut((p - iAt) / (1 - iAt)));
      const s = a === 0 ? 1 : -1;
      P.dx = off * ux * s; P.dy = off * uy * s;
      st.trailCol[a] = FX.elemOf(e.fx).c;
      P.chomp = (e.fx === 'bite' || e.fx === 'pinch') && p > 0.28 && p < 0.62 ? 1 : 0;
      if (prev < iAt && p >= iAt) impact(e);
    }

    function drawBg(t) {
      const arena = root.FFART && root.FFART.arena;
      if (arena && arena.complete && arena.naturalWidth) {
        const sc = Math.max(W / arena.width, H / arena.height), dw = arena.width * sc, dh = arena.height * sc;
        ctx.drawImage(arena, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#163E5C'); g.addColorStop(0.18, '#1E6F8C'); g.addColorStop(0.55, '#0E4C68'); g.addColorStop(1, '#062433');
      ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = W * (0.12 + i * 0.24) + Math.sin(t * 0.25 + i) * 18;
        const lg = ctx.createLinearGradient(x, 0, x + 30, H);
        lg.addColorStop(0, 'rgba(255,230,176,.11)'); lg.addColorStop(1, 'rgba(255,230,176,0)');
        ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(x - 16, -20); ctx.lineTo(x + 34, -20); ctx.lineTo(x + 80, H); ctx.lineTo(x - 40, H); ctx.fill();
      }
      ctx.restore();
      }
      for (let side = 0; side < 2; side++) {
        const h = home(side), L = fishLen();
        const rg = ctx.createRadialGradient(h.x, h.y + L * 0.42, 4, h.x, h.y + L * 0.5, L * 0.75);
        rg.addColorStop(0, 'rgba(233,210,166,.62)'); rg.addColorStop(0.55, 'rgba(201,168,120,.28)'); rg.addColorStop(1, 'rgba(201,168,120,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(h.x, h.y + L * 0.46, L * 0.62, L * 0.16, side ? -0.15 : 0.12, 0, 7); ctx.fill();
      }
      ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#1C5C52';
      const blobs = [[0.02, 0.72, 0.16], [0.94, 0.28, 0.14], [0.08, 0.34, 0.1], [0.9, 0.78, 0.12]];
      for (const [px, py, s] of blobs) { ctx.beginPath(); ctx.ellipse(W * px, H * py, W * s, H * s * 0.55, 0, 0, 7); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = 'rgba(242,255,255,.45)';
      for (const s of snow) {
        s.y -= s.v * 0.016; if (s.y < 0) s.y += 1;
        const x = (s.x + Math.sin(t * 0.6 + s.ph) * 0.012) * W, y = s.y * H;
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x - s.r * 0.2, y - s.r * 0.25, s.r * 0.45, Math.PI * 1.1, Math.PI * 1.8); ctx.stroke();
      }
    }
    function paintFish(sn, x, y, L, dir, t, extra, hitA) {
      if (!(hitA > 0.04) || !hitCv) { drawFishAt(book, ctx, sn.sp, sn.hue, x, y, L, dir, t, extra); return; }
      const S = Math.ceil(L * 2.6), pd = Math.min(2, dpr);
      if (hitCv.width !== Math.ceil(S * pd)) { hitCv.width = Math.ceil(S * pd); hitCv.height = Math.ceil(S * pd); }
      const g = hitCv.getContext('2d');
      g.setTransform(pd, 0, 0, pd, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.clearRect(0, 0, S, S);
      drawFishAt(book, g, sn.sp, sn.hue, S / 2, S / 2, L, dir, t, extra);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(255,255,255,${Math.min(0.92, hitA)})`; g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
      ctx.drawImage(hitCv, x - S / 2, y - S / 2, S, S);
    }
    function drawRibbon(side, L) {
      const tr = st.trails[side]; if (tr.length < 2) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.strokeStyle = st.trailCol[side] || '#fff';
      for (let i = 1; i < tr.length; i++) {
        const k = i / (tr.length - 1);
        ctx.globalAlpha = 0.5 * k; ctx.lineWidth = L * 0.28 * k;
        ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
      }
      ctx.restore();
    }
    function drawFighter(side, t) {
      const P = st.pos[side], h = home(side), L = fishLen(), sn = snaps[side], dir = side === 0 ? 1 : -1;
      let x = h.x + P.dx, y = h.y + (P.dy || 0) + Math.sin(t * 1.6 + side * 2) * 3, rot = 0, alpha = 1;
      const ko = st.koSide === side && (st.ended || (ev[st.i] && ev[st.i].k === 'ko'));
      if (ko) {
        const k = st.ended ? 1 : Math.min(1, st.p);
        rot = k * Math.PI; y -= k * Math.min(H * 0.16, 120); alpha = 1 - k * 0.28;
        if (Math.random() < 0.45) emit('bubble', x + rnd(-8, 8), y + rnd(0, 10), { n: 1, col: '#F2FFFF', sp: 10, g: -40, life: 0.8, size: 10, add: false });
      }
      const headX = x + dir * L * 0.42, headY = y;
      if (Math.hypot(P.dx, P.dy || 0) > 10) { st.trails[side].push({ x: headX, y: headY }); if (st.trails[side].length > 8) st.trails[side].shift(); }
      else if (st.trails[side].length) st.trails[side].shift();
      ctx.save(); ctx.fillStyle = 'rgba(20,40,30,.28)'; ctx.beginPath(); ctx.ellipse(x, y + L * 0.42, L * 0.38, L * 0.08, 0, 0, 7); ctx.fill(); ctx.restore();
      drawRibbon(side, L);
      const au = st.aura[side];
      if (au) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const rg = ctx.createRadialGradient(x, y, L * 0.1, x, y, L * 0.8);
        rg.addColorStop(0, hexA(au.col, 0.45)); rg.addColorStop(1, hexA(au.col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, L * 0.8, 0, 7); ctx.fill(); ctx.restore();
      }
      if (st.ghost[side] > 0) for (let k = 1; k <= 3; k++) drawFishAt(book, ctx, sn.sp, sn.hue, x - dir * k * 14, y, L, dir, t, { alpha: 0.16, gentle: true, rim: true });
      const puff = Math.min(1, P.puffT || 0);
      ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.translate(-x, -y); ctx.globalAlpha = alpha;
      paintFish(sn, x, y, L * (1 + puff * 0.25), dir, t, { puff, chomp: P.chomp, swim: Math.hypot(P.dx, P.dy || 0) > 8 ? 14 : 6, gentle: true, rim: true }, P.hit || 0);
      ctx.restore();
      if (st.sh[side] > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(168,230,255,.7)'; ctx.lineWidth = 2;
        const r = L * 0.62; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.restore();
      }
      if (st.ink[side] > 0) { ctx.save(); ctx.fillStyle = 'rgba(42,32,24,.28)'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + Math.sin(t + k) * L * 0.35, y + Math.cos(t * 0.7 + k) * L * 0.18, L * 0.22, 0, 7); ctx.fill(); } ctx.restore(); }
      if (st.stun[side]) { ctx.save(); ctx.font = '700 16px ' + NUMF; ctx.textAlign = 'center'; ctx.fillStyle = '#FFE28A'; for (let k = 0; k < 3; k++) { const a0 = t * 4 + k * 2.1; ctx.fillText('✦', x + Math.cos(a0) * L * 0.35, y - L * 0.48 + Math.sin(a0) * 6); } ctx.restore(); }
    }
    function drawHex(x, y, r, rot, col, al) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.72; if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.28, 0, 0, 7); ctx.stroke();
      ctx.restore();
    }
    function drawFx(dt) {
      ctx.save();
      for (const f of st.fx) {
        f.age += dt; const k = f.age / f.life; if (k >= 1) continue;
        const A = f.from, B = f.to, L = fishLen(), al = 1 - k, col = (f.data && f.data.col) || '#fff';
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, al);
        if (f.kind === 'bolt') {
          ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.shadowColor = col; ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.moveTo(A.x, A.y);
          const zig = [];
          for (let i = 1; i <= 8; i++) zig.push([A.x + (B.x - A.x) * i / 8, A.y + (B.y - A.y) * i / 8 + (i < 8 ? rnd(-22, 22) : 0)]);
          for (const [x, y] of zig) ctx.lineTo(x, y);
          ctx.stroke();
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.moveTo(A.x, A.y); for (const [x, y] of zig) ctx.lineTo(x, y); ctx.stroke();
        } else if (f.kind === 'ring') {
          ctx.strokeStyle = col; ctx.lineWidth = 6 * (1 - k); ctx.beginPath(); ctx.arc(B.x, B.y, L * (0.1 + easeOut(k) * 0.8), 0, 7); ctx.stroke();
        } else if (f.kind === 'arc') {
          ctx.strokeStyle = col; ctx.lineWidth = 6 * al; ctx.shadowColor = col; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(B.x, B.y, L * 0.45, -1.1, 0.6 + k); ctx.stroke();
        } else if (f.kind === 'flame') {
          const q = Math.min(1, k * 1.35), x = A.x + (B.x - A.x) * q, y = A.y + (B.y - A.y) * q;
          const rad = L * (0.62 + 0.2 * q);
          const rg = ctx.createRadialGradient(x, y, 2, x, y, rad);
          rg.addColorStop(0, hexA('#FFF6A0', al)); rg.addColorStop(0.4, hexA('#FF6A1F', al * 0.85)); rg.addColorStop(1, 'rgba(255,80,0,0)');
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
          if (k > 0.35) {
            const rg2 = ctx.createRadialGradient(B.x, B.y, 2, B.x, B.y, L * 0.7);
            rg2.addColorStop(0, hexA('#FFC847', al * 0.9)); rg2.addColorStop(1, 'rgba(255,80,0,0)');
            ctx.fillStyle = rg2; ctx.beginPath(); ctx.arc(B.x, B.y, L * 0.7, 0, 7); ctx.fill();
          }
          if (k < 0.85) emit('softDot', x, y, { n: 1, col: '#FFC847', sp: 40, g: -30, life: 0.5, size: 20, add: true });
        } else if (f.kind === 'sonar') {
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) { const q = (k + i * 0.25) % 1, x = A.x + (B.x - A.x) * q, y = A.y + (B.y - A.y) * q; ctx.beginPath(); ctx.arc(x, y, 10 + q * 26, 0, 7); ctx.stroke(); }
        } else if (f.kind === 'reticle') {
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; const r = L * (0.45 - k * 0.12);
          ctx.beginPath(); ctx.arc(B.x, B.y, r, 0, 7); ctx.stroke();
        } else if (f.kind === 'needle') {
          const q = Math.min(1, k * 2.2), x = A.x + (B.x - A.x) * q, y = A.y + (B.y - A.y) * q;
          ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(x, y); ctx.stroke();
          emit('spark', x, y, { n: 1, col, sp: 0, g: 0, size: 16, life: 0.15, add: true });
        } else if (f.kind === 'spikes') {
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          for (let i = 0; i < 12; i++) { const a0 = i * Math.PI / 6, r0 = L * 0.35, r1 = L * (0.5 + 0.15 * Math.min(1, k * 3)); ctx.beginPath(); ctx.moveTo(A.x + Math.cos(a0) * r0, A.y + Math.sin(a0) * r0); ctx.lineTo(A.x + Math.cos(a0) * r1, A.y + Math.sin(a0) * r1); ctx.stroke(); }
        } else if (f.kind === 'shieldUp') {
          ctx.strokeStyle = col; ctx.lineWidth = 3; const r = L * (0.85 - k * 0.2);
          ctx.beginPath();
          for (let i = 0; i < 6; i++) { const a0 = i * Math.PI / 3 + k; const px = A.x + Math.cos(a0) * r, py = A.y + Math.sin(a0) * r; if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
          ctx.closePath(); ctx.stroke();
        } else if (f.kind === 'sunburst') {
          ctx.translate(B.x, B.y); ctx.rotate(k * 1.2); ctx.strokeStyle = col; ctx.lineWidth = 3;
          for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i) * L * (0.2 + k), Math.sin(i) * L * (0.2 + k)); ctx.stroke(); }
        }
        ctx.restore();
      }
      st.fx = st.fx.filter((f) => f.age < f.life);
      ctx.restore();
    }
    function drawParts(dt) {
      const atlas = partAtlas();
      let nBloom = 0;
      for (const b of st.blooms) {
        b.age += dt; if (b.age >= b.life || nBloom >= 6) continue; nBloom++;
        const k = b.age / b.life;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        rg.addColorStop(0, hexA(b.col, 0.8 * (1 - k))); rg.addColorStop(1, hexA(b.col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.restore();
      }
      st.blooms = st.blooms.filter((b) => b.age < b.life);
      for (const p of st.parts) {
        p.age += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot = (p.rot || 0) + (p.spin || 0) * dt;
        const al = Math.max(0, 1 - p.age / p.life);
        ctx.save(); if (p.add) ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al;
        if (atlas) {
          const src = tintAtlas(p.col) || atlas.cv, i = atlas.index[p.kind] || 0;
          ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
          ctx.drawImage(src, (i % 4) * 64, ((i / 4) | 0) * 64, 64, 64, -p.size / 2, -p.size / 2, p.size, p.size);
        } else { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2, p.size * 0.18), 0, 7); ctx.fill(); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      st.parts = st.parts.filter((p) => p.age < p.life);
    }
    function drawSheets(dt) {
      for (const s of st.sheets) {
        s.age += dt; if (!s.im || s.age >= s.life) continue;
        const i = Math.min(7, Math.floor((s.age / s.life) * 8));
        const iw = s.im.width / 4, ih = s.im.height / 2;
        const dw = fishLen() * 1.5 * s.scale;
        const k = s.age / s.life;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k < 0.72 ? 1 : Math.max(0, 1 - (k - 0.72) / 0.28);
        ctx.drawImage(s.im, (i % 4) * iw, ((i / 4) | 0) * ih, iw, ih, s.x - dw / 2, s.y - dw / 2, dw, dw);
        ctx.restore();
      }
      st.sheets = st.sheets.filter((s) => s.age < s.life);
    }
    function drawTexts(dt) {
      ctx.save(); ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      for (const x of st.texts) {
        x.age += dt; const t = x.age - (x.delay || 0); if (t < 0) continue;
        const life = x.life || 1, popTo = x.crit ? 1.5 : 1.2;
        let sc = 1;
        if (t < 0.15) sc = 0.6 + (t / 0.15) * (popTo - 0.6);
        else if (t < 0.28) sc = popTo + ((t - 0.15) / 0.13) * (1 - popTo);
        const rise = 60 * easeOut(t / life);
        const fade = t > life * 0.72 ? Math.max(0, 1 - (t - life * 0.72) / (life * 0.28)) : 1;
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(x.x, x.y - rise); ctx.rotate((x.rot || 0) * Math.min(1, t / 0.18)); ctx.scale(sc, sc);
        ctx.font = `900 ${x.size || 28}px ${NUMF}`; ctx.lineWidth = x.crit ? 6 : 4; ctx.strokeStyle = 'rgba(28,16,24,.88)';
        ctx.strokeText(x.str, 0, 0); ctx.fillStyle = x.col; ctx.fillText(x.str, 0, 0); ctx.restore();
      }
      ctx.restore();
      st.texts = st.texts.filter((x) => x.age < (x.life || 1) + (x.delay || 0) + 0.05);
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function drawHud() {
      const narrow = portrait() || W < 520;
      const pad = narrow ? 8 : 14, bw = Math.min(narrow ? W * 0.40 : W * 0.34, narrow ? 168 : 320), top = narrow ? 8 : 14;
      for (let side = 0; side < 2; side++) {
        const sn = snaps[side], x = side === 0 ? pad : W - pad - bw, hp = st.hp[side], mx = maxHp[side];
        st.lag[side] += (hp - st.lag[side]) * 0.08;
        ctx.save();
        const ax = side === 0 ? x : x + bw;
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.font = `800 ${narrow ? 12 : 14}px ${NUMF}`; ctx.fillStyle = '#FFF8EC';
        const nm = String(sn.nickname || sn.name || '');
        ctx.fillText((nm.length > (narrow ? 6 : 12) ? nm.slice(0, narrow ? 5 : 11) + '…' : nm) + '  Lv.' + sn.level, ax, top + 12);
        if (!narrow) { ctx.font = '600 11px system-ui,sans-serif'; ctx.fillStyle = '#D7CBB4'; ctx.fillText((sn.spName || '') + (sn.npc ? '・練習' : ''), ax, top + 26); }
        const y = top + (narrow ? 18 : 32), h = 12;
        roundRect(x, y, bw, h, 6); ctx.fillStyle = 'rgba(8,20,32,.72)'; ctx.fill();
        ctx.save(); roundRect(x, y, bw, h, 6); ctx.clip();
        const fw = (v) => bw * Math.max(0, Math.min(1, v / mx)), fx0 = (w) => (side === 0 ? x : x + bw - w);
        ctx.fillStyle = 'rgba(255,248,236,.45)'; ctx.fillRect(fx0(fw(st.lag[side])), y, fw(st.lag[side]), h);
        const r = hp / mx, c1 = r > 0.5 ? '#4CC38A' : r > 0.25 ? '#FFC845' : '#E8566C';
        ctx.fillStyle = c1; ctx.fillRect(fx0(fw(hp)), y, fw(hp), h);
        if (st.sh[side] > 0) { const sw = fw(Math.min(mx, st.sh[side])); ctx.fillStyle = 'rgba(168,230,255,.9)'; ctx.fillRect(fx0(sw), y, sw, 3); }
        ctx.restore();
        ctx.font = `800 ${narrow ? 10 : 11}px ${NUMF}`; ctx.fillStyle = '#3A2D50'; ctx.textAlign = 'left';
        const label = `${Math.max(0, Math.round(hp))} / ${mx}`;
        ctx.fillText(label, side === 0 ? x + 6 : x + bw - ctx.measureText(label).width - 6, y + 10);
        ctx.restore();
      }
      ctx.save(); ctx.textAlign = 'center';
      const vw = narrow ? 36 : 42, vh = narrow ? 18 : 22;
      roundRect(W / 2 - vw / 2, top + 2, vw, vh, 8); ctx.fillStyle = '#FFF8EC'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#E8566C'; ctx.stroke();
      ctx.font = `900 ${narrow ? 12 : 14}px ${NUMF}`; ctx.fillStyle = '#E8566C'; ctx.fillText('VS', W / 2, top + (narrow ? 15 : 18));
      const n = st.i >= 0 && ev[st.i] ? ev[st.i].n + 1 : 0;
      ctx.font = '700 11px system-ui,sans-serif'; ctx.fillStyle = '#F6E8D2';
      ctx.fillText('行動 ' + Math.min(n, battle.actions || n), W / 2, top + (narrow ? 34 : 40));
      ctx.restore();
    }
    function drawBanner(dt) {
      const b = st.banner; if (!b) return;
      b.age += dt; if (b.age > 1.15) { st.banner = null; return; }
      const k = Math.min(1, b.age / 0.16), al = b.age > 0.85 ? Math.max(0, 1 - (b.age - 0.85) / 0.3) : 1;
      const h = home(b.side);
      ctx.save(); ctx.globalAlpha = al; ctx.translate(h.x, h.y + fishLen() * 0.62);
      ctx.font = `900 16px ${NUMF}`; const tw = ctx.measureText(b.str).width + 28;
      roundRect(-tw / 2, -16, tw, 28, 10); ctx.fillStyle = '#FFF8EC'; ctx.fill(); ctx.strokeStyle = '#E2CBA6'; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = '#3A2D50'; ctx.fillText(b.str, 0, 4); ctx.restore();
    }
    function drawFinal(dt) {
      const f = st.finalText; if (!f) return;
      f.age += dt; const k = Math.min(1, f.age / 0.28);
      ctx.save(); ctx.textAlign = 'center'; ctx.translate(W / 2, portrait() ? H * 0.5 : H * 0.46);
      const sc = 0.6 + 0.4 * k; ctx.scale(sc, sc); ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.font = `900 ${Math.round(Math.min(W, 640) / 7)}px ${NUMF}`;
      ctx.lineWidth = 10; ctx.strokeStyle = '#E8566C'; ctx.strokeText(f.str, 0, 0);
      ctx.fillStyle = '#FFF8EC'; ctx.fillText(f.str, 0, 0); ctx.restore();
    }
    function skillDark() {
      const e = st.i >= 0 ? ev[st.i] : null;
      if (!e || e.k !== 'skill' || !isBig(e) || st.ended) return 0;
      const dur = durOf(e), fs = 1 - Math.min(0.5, dur) / dur, cEnd = FX.chargeEnd(e);
      if (st.p < cEnd) return 0.6 * (st.p / cEnd);
      if (st.p < fs) return 0.6;
      return 0.6 * Math.max(0, 1 - (st.p - fs) / Math.max(0.05, 1 - fs));
    }
    function finish() { st.ended = true; if (!st.done) { st.done = true; setTimeout(() => opt.onDone && opt.onDone(), 250); } }
    function step(dt) {
      if (st.ended) return;
      if (st.i < 0) { st.p += dt / 0.55; if (st.p >= 1) { st.i = 0; st.p = 0; if (ev[0]) startEvent(ev[0]); else finish(); } return; }
      const e = ev[st.i]; if (!e) return finish();
      const prev = st.p; st.p += dt / durOf(e);
      updEvent(e, Math.min(1, st.p), prev);
      if (st.p >= 1) {
        if (e.a != null && st.pos[e.a]) { st.pos[e.a].dx = 0; st.pos[e.a].dy = 0; }
        if (e.k === 'ko' || e.k === 'timeout' || st.i >= ev.length - 1) finish();
        else { st.i++; st.p = 0; startEvent(ev[st.i]); }
      }
    }
    function pump(now) {
      if (!st.queue.length) return;
      const due = st.queue.filter((q) => q.at <= now);
      st.queue = st.queue.filter((q) => q.at > now);
      for (const q of due) { popHit(q.side, q.h, q.i, q.el); if (!q.h.miss) { hitStop(0.04); st.flash = Math.min(FX.FLASH_CAP, Math.max(st.flash, 0.22)); st.pos[q.side].hit = Math.max(st.pos[q.side].hit, 0.7); } }
    }
    function updateCam(rdt) {
      const e = st.i >= 0 ? ev[st.i] : null;
      let target = 1;
      if (e && (e.k === 'atk' || e.k === 'skill') && e.a != null && st.p < FX.chargeEnd(e)) {
        const k = st.p / FX.chargeEnd(e); target = 1.03;
        const h = home(e.a);
        st.panX += ((h.x - W / 2) * 0.08 * k - st.panX) * Math.min(1, rdt * 5);
        st.panY += ((h.y - H / 2) * 0.08 * k - st.panY) * Math.min(1, rdt * 5);
      } else { st.panX *= Math.exp(-5 * rdt); st.panY *= Math.exp(-5 * rdt); }
      st.zoom = target + (st.zoom - target) * Math.exp(-6 * rdt);
    }
    function draw(rdt, dt) {
      for (let s = 0; s < 2; s++) {
        const P = st.pos[s];
        P.hit = Math.max(0, (P.hit || 0) - rdt * 4);
        P.puffT = Math.max(0, (P.puffT || 0) - rdt * 0.6);
        if (st.aura[s]) { st.aura[s].t -= rdt; if (st.aura[s].t <= 0) st.aura[s] = null; }
        st.ghost[s] = Math.max(0, st.ghost[s] - rdt); st.ink[s] = Math.max(0, st.ink[s] - rdt);
      }
      if (!st.reduce) st.shake = Math.max(0, st.shake - FX.SHAKE_DECAY * rdt); else st.shake = 0;
      st.flash = Math.max(0, st.flash - FX.FLASH_DECAY * rdt);
      updateCam(rdt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (!st.reduce && st.shake > 0.02) { const amp = st.shake * 18; ctx.translate(Math.sin(st.t * 67) * amp, Math.sin(st.t * 91) * amp * 0.65); }
      const z = st.zoom, fx = W / 2 + st.panX, fy = H / 2 + st.panY;
      ctx.translate(fx, fy); ctx.scale(z, z); ctx.translate(-fx, -fy);
      drawBg(st.t);
      const dark = skillDark();
      if (dark > 0.02) { ctx.fillStyle = `rgba(4,16,28,${dark})`; ctx.fillRect(-W * 0.3, -H * 0.3, W * 1.6, H * 1.6); }
      const e = st.i >= 0 ? ev[st.i] : null;
      if (e && e.k === 'skill' && isBig(e) && e.a != null && dark > 0.04 && st.p < FX.chargeEnd(e) + 0.08) {
        const P = st.pos[e.a], h = home(e.a), el = FX.elemOf(e.fx), L = fishLen();
        drawHex(h.x + P.dx, h.y + (P.dy || 0) + L * 0.58, L * 0.46, st.t * 0.9, el.l, Math.min(0.55, dark * 0.7));
        if (Math.random() < 0.5) emit('softDot', h.x + P.dx, h.y + (P.dy || 0), { n: 1, col: el.l, sp: 20, g: -10, size: 18, life: 0.4, add: true });
      }
      drawFighter(0, st.sim); drawFighter(1, st.sim);
      drawFx(dt); drawParts(dt); drawSheets(dt); drawTexts(dt);
      ctx.restore();
      drawBanner(dt); drawHud(); drawFinal(rdt);
      const fa = Math.min(FX.FLASH_CAP, st.flash) * (st.reduce ? FX.REDUCE_FLASH : 1);
      if (fa > 0.02) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fa; ctx.fillStyle = st.flashCol; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
      const edge = (!st.reduce && (root.performance ? root.performance.now() : Date.now()) < st.slowUntil) ? 0.75 : 0.45;
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${edge})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    function frame(now) {
      raf = root.requestAnimationFrame(frame);
      const wall = root.performance ? root.performance.now() : now;
      const rdt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      st.t += rdt;
      const frozen = !st.reduce && wall < st.freezeUntil;
      const slow = !st.reduce && !frozen && wall < st.slowUntil;
      const scale = st.paused ? 0 : (frozen ? 0.02 : slow ? st.slowScale : 1) * st.speed;
      const dt = rdt * scale;
      st.sim += dt;
      if (!st.paused) step(dt);
      pump(wall);
      if (canvas.clientWidth && Math.abs(Math.round(canvas.clientWidth * dpr) - canvas.width) > 2) resize();
      draw(rdt, st.paused ? rdt : dt);
    }
    function clearMotion() {
      st.texts = []; st.fx = []; st.parts = []; st.blooms = []; st.sheets = []; st.queue = []; st.banner = null;
      st.shake = 0; st.flash = 0; st.zoom = 1; st.panX = 0; st.panY = 0; st.freezeUntil = 0; st.slowUntil = 0;
      st.trails = [[], []];
    }
    raf = root.requestAnimationFrame(frame);
    return {
      state: st,
      setSpeed(s) { st.speed = s; },
      setReduce(v) { st.reduce = !!v; if (st.reduce) { st.shake = 0; st.slowUntil = 0; st.freezeUntil = 0; } },
      pause(v) { st.paused = v !== false; },
      skip() {
        st.fast = true;
        const lastE = ev[ev.length - 1];
        if (lastE) {
          st.hp = (lastE.hp || st.hp).slice(); st.lag = st.hp.slice(); st.sh = (lastE.sh || [0, 0]).slice(); st.i = ev.length - 1; st.p = 1;
          if (lastE.k === 'ko') { st.koSide = lastE.a; st.finalText = { str: 'K.O.', age: 1, col: '#E8566C' }; }
          else if (lastE.k === 'timeout') st.finalText = { str: '時間到', age: 1, col: '#FFC845' };
        }
        clearMotion(); st.fast = false; finish();
      },
      seek(n, p) {
        st.fast = true;
        while (st.i < n && st.i < ev.length - 1) {
          if (st.i >= 0 && st.p < FX.IMPACT_AT && ev[st.i]) impact(ev[st.i]);
          st.i++; st.p = 0; st.sheets = []; if (ev[st.i]) startEvent(ev[st.i]);
        }
        st.texts = []; st.fx = []; st.parts = []; st.queue = []; st.blooms = []; st.banner = null;
        const e = ev[st.i]; const target = p || 0; let q = 0;
        if (e) while (q < target) { const nq = Math.min(target, q + 0.05); updEvent(e, nq, q); q = nq; }
        st.p = target;
        st.fast = false; st.freezeUntil = 0; st.slowUntil = 0; st.shake = 0; st.flash = 0; st.zoom = 1;
      },
      destroy() { root.cancelAnimationFrame(raf); },
    };
  }

  // ===========================================================================
  // 主介面
  // ===========================================================================
  function mount(container, opts) {
    opts = opts || {};
    injectCss();
    const base = (opts.baseUrl || '').replace(/\/$/, '');
    const book = SpeciesBook(opts);
    const S = { tab: opts.tab || 'hero', cfg: null, me: null, cand: null, opps: null, lb: null, logs: null, skillSel: null, busy: false, err: null, replay: null, replayEl: null, picking: false, needReg: false };
    const el = document.createElement('div'); el.className = 'hx'; container.appendChild(el);
    let alive = true, timer = 0, raf = 0;

    async function token() { const t = opts.getToken ? await opts.getToken() : null; return t || null; }
    async function api(method, path, body) {
      const tk = await token();
      const h = {}; if (tk) h.Authorization = 'Bearer ' + tk; if (body !== undefined) h['Content-Type'] = 'application/json';
      const r = await fetch(base + '/api/hero' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.message || ('錯誤 ' + r.status)); e.status = r.status; e.retryAfter = Math.max(1,Number(r.headers.get('Retry-After'))||60); e.code = j.error; e.data = j; throw e; }
      return j;
    }
    function toast(msg, bad) {
      const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; el.appendChild(t);
      setTimeout(() => t.remove(), bad ? 4200 : 2600);
    }
    function onErr(e) {
      if (e.code === 'member_required') { S.needReg = true; render(); if (opts.onNeedRegister) opts.onNeedRegister(e.message); return; }
      toast(e.message || '發生錯誤', true);
    }
    function applyView(v) {
      if (!v || v.hero === undefined) return;
      S.me = { ...(S.me || {}), ...v };
      if (v.spent && v.coins != null && opts.onSaveChanged) opts.onSaveChanged({ coins: v.coins, rev: v.spent.rev != null ? v.spent.rev : v.rev, amount: v.spent.amount || 0, gems: v.gems });
    }
    // 花錢的操作：先讓遊戲把存檔推上雲端（避免覆蓋），伺服器扣款後再通知遊戲同步
    async function spend(path, body, okMsg) {
      if (S.busy) return null; S.busy = true; render();
      try {
        if (opts.beforeSpend) { const r = await opts.beforeSpend(); if (r !== undefined && r !== true && r !== 'ok' && r !== 'idle') throw new Error('雲端同步失敗，請稍後再試（未扣款）'); }
        const r = await api('POST', path, body);
        applyView(r);
        if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
        return r;
      } catch (e) { onErr(e); return null; } finally { S.busy = false; render(); }
    }
    async function act(path, body, okMsg) {
      if (S.busy) return null; S.busy = true;
      try { const r = await api('POST', path, body); applyView(r); if (okMsg) toast(okMsg); return r; } catch (e) { onErr(e); return null; } finally { S.busy = false; render(); }
    }
    async function load() {
      S.err = null;
      try {
        const [c, me] = await Promise.all([api('GET', '/config'), token().then((t) => (t ? api('GET', '/me') : null))]);
        S.cfg = c.config; S.me = me;
        if (!me) { S.err = '請先登入（遊戲會自動建立訪客身分）'; render(); return; }
        if (!opts.getSpecies) await book.load();
        if (!me.hero) await loadCand();
      } catch (e) { S.err = e.message; }
      render();
      if (S.me && S.me.hero && S.tab !== 'hero') openTab(S.tab);
    }
    async function loadCand() { try { if (opts.beforeSpend) { try { await opts.beforeSpend(); } catch (e) { /* 同步失敗仍顯示伺服器上的魚缸 */ } } S.cand = await api('GET', '/candidates'); } catch (e) { onErr(e); } }
    async function openTab(t) {
      S.tab = t; S.needReg = false; S.picking = false; render();
      try {
        if (t === 'battle' && S.me && S.me.hero) { if (!S.me.member) { S.needReg = true; render(); return; } S.opps = null; render(); S.opps = await api('GET', '/opponents'); }
        if (t === 'rank') S.lb = await api('GET', '/leaderboard');
        if (t === 'log') S.logs = await api('GET', '/battles');
      } catch (e) { if (t === 'battle') S.opps = { opponents: [] }; onErr(e); }
      render();
    }

    // ---------------- 畫面片段 ----------------
    const SKD = (id) => (S.cfg && S.cfg.skills[id]) || { name: id, icon: '❔', desc: '', cd: 0 };
    const rankChip = (r) => (r ? `<span class="rk" style="--c:${esc(r.color)}">◆ ${esc(r.name)}</span>` : '');
    const portrait = (sp, hue, cls, w, h) => `<canvas class="${cls || 'hx-por'}" data-sp="${esc(sp)}" data-hue="${hue == null ? '' : hue}" ${w ? `style="width:${w}px;height:${h}px"` : ''}></canvas>`;
    function header() {
      const m = S.me, h = m.hero, xpP = h.xpNext ? Math.min(100, (h.xp / h.xpNext) * 100) : 100;
      return `<div class="hx-top">${portrait(h.species, h.hue)}
        <div class="hx-id"><div class="hx-nm">${esc(h.fishName || h.spName)} <span class="mu sm">Lv.${h.level}</span></div>
          <div class="hx-sub">${esc(h.spName)}・${esc(h.family ? h.family.name : '')}・戰力 <b style="color:var(--gd)">${fmt(h.power)}</b></div>
          <div class="hx-xp" title="經驗 ${h.xp}/${h.xpNext}"><i style="width:${xpP}%"></i></div></div>
        <div class="hx-res"><div class="row">${rankChip(h.rank)}<span class="hx-chip">積分 ${fmt(h.rating)}</span></div>
          <div class="row"><span class="hx-chip">🪙 ${fmt(m.coins)}</span><span class="hx-chip">💎 ${fmt(m.gems)}</span>
          ${m.member ? `<span class="hx-chip" title="挑戰次數">⚔️ ${h.tickets}/${h.ticketsMax}${h.nextTicketAt ? ` <span class="cdn" data-until="${h.nextTicketAt}"></span>` : ''}</span>` : '<span class="hx-chip" style="color:#b77dff">訪客</span>'}</div></div></div>`;
    }
    const tabs = () => `<div class="hx-tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    function statRows(st) {
      const mx = { hp: 1400, atk: 420, def: 260, spd: 260, crit: 600, dodge: 600 };
      const col = { hp: '#41e39a', atk: '#ff3b5c', def: '#6fa8ff', spd: '#38e1ff', crit: '#ffc847', dodge: '#b77dff' };
      return ['hp', 'atk', 'def', 'spd', 'crit', 'dodge'].map((k) => `<div class="st"><span class="mu">${STAT_LABEL[k]}</span><span class="b"><i style="width:${Math.min(100, (st[k] / mx[k]) * 100)}%;background:${col[k]}"></i></span><span class="v">${k === 'crit' || k === 'dodge' ? pct(st[k]) : fmt(st[k])}</span></div>`).join('');
    }
    function viewPick() {
      const c = S.cand;
      if (!c) return '<div class="ld">讀取魚缸…</div>';
      const h = S.me.hero, ch = c.change || {}, cool = !!(h && !ch.free && ch.readyAt && ch.readyAt > Date.now());
      const STG = ['幼魚', '亞成魚', '成魚'], RAR = ['普通', '稀有', '傳說'];
      const costTxt = ch.free ? (ch.reason === 'first_change' ? '<b class="win">免費</b>（第一次選擇後 24 小時內可免費換一次）' : '<b class="win">免費</b>') : '🪙 ' + fmt(ch.coins);
      return `<div class="row" style="margin-bottom:10px"><div class="sp"><h3 style="margin:0">${h ? '更換英雄魚' : '選擇你的英雄魚'}</h3>
        <div class="mu sm">下面是你魚缸裡的 ${c.candidates.length} 條魚（含 💎 寶石魚、混種），任選一條培養成英雄；英雄的能力依這條魚的魚種與成長決定，各魚種已自動平衡。${h ? `更換費用：${costTxt}（等級、訓練、技能等級、裝備保留）` : '第一次選擇免費。'}</div>
        ${cool ? `<div class="sm" style="color:var(--gd);margin-top:4px">⏳ 更換冷卻中，<span class="cdn" data-until="${ch.readyAt}"></span> 後可以更換</div>` : ''}</div>
        ${h ? '<button class="bt" data-act="pickCancel">返回</button>' : ''}</div>
        <div class="hx-grid">${c.candidates.map((f) => `<div class="cd ${f.current ? 'sel' : ''}">
          <div class="row">${portrait(f.species, f.hue, 'hx-por', 96, 60)}<div class="sp"><h4>${esc(f.name || f.spName)}</h4><div class="mu sm">${esc(f.spName)}・${STG[f.stage] || ''}・${RAR[f.rarity] || ''}${f.hybrid ? ' <span class="tag" style="color:#ff9ad5">混種</span>' : ''}${f.premium ? ' <span class="tag" style="color:#b77dff">💎 寶石魚</span>' : ''}</div><div class="sm mu">${esc(f.family)}・招牌 ${esc(SKD(f.signature).icon + ' ' + SKD(f.signature).name)}</div></div></div>
          <div class="row" style="margin-top:8px"><span class="mu sm">戰力</span><b style="color:var(--gd);font-size:18px">${fmt(f.power)}</b><span class="sp"></span>${f.stage < 2 ? '<span class="tag mu">未成年・能力較低</span>' : ''}
          ${f.current ? '<span class="tag" style="color:var(--cy)">目前英雄</span>' : `<button class="bt cy sm" data-act="pick" data-id="${esc(f.fishId)}" ${S.busy || cool ? 'disabled' : ''}>選擇</button>`}</div></div>`).join('') || '<div class="empty">魚缸裡還沒有魚</div>'}</div>`;
    }
    function viewHero() {
      const h = S.me.hero, wr = h.wins + h.losses ? Math.round((h.wins / (h.wins + h.losses)) * 100) : 0;
      return `${h.fishMissing ? '<div class="cd" style="border-color:var(--rd);margin-bottom:10px">⚠️ 你的英雄魚已經不在魚缸了（賣掉或移除）。可以<b>免費</b>重新選一條。 <button class="bt pr sm" data-act="pickOpen">重新選擇</button></div>' : ''}
      ${h.pvpBanned ? `<div class="cd" style="border-color:var(--rd);margin-bottom:10px">⛔ 對戰資格已被停權${h.pvpBanReason ? '：' + esc(h.pvpBanReason) : ''}</div>` : ''}
      <div class="hx-grid">
        <div class="cd"><div class="row"><span class="mu sm">綜合戰力</span><span class="sp"></span>${rankChip(h.rank)}</div><div class="pw">${fmt(h.power)}</div>${statRows(h.stats)}<div class="mu sm">暴擊傷害 ${h.stats.critDmg}%</div></div>
        <div class="cd"><h4>戰績</h4>
          <table><tr><td class="mu">本季</td><td class="num">${h.seasonBattles} 場</td></tr><tr><td class="mu">進攻</td><td class="num"><span class="win">${h.wins} 勝</span> / <span class="lose">${h.losses} 敗</span>（${wr}%）</td></tr>
          <tr><td class="mu">防守</td><td class="num">${h.defWins} 勝 / ${h.defLosses} 敗</td></tr><tr><td class="mu">最高積分</td><td class="num">${fmt(h.peak)}</td></tr><tr><td class="mu">賽季</td><td class="num">${esc(S.me.season ? S.me.season.name : '—')}</td></tr></table>
          <div class="row" style="margin-top:10px"><button class="bt" data-act="pickOpen">更換英雄魚</button><span class="mu sm">${h.change.free ? '免費' : '🪙 ' + fmt(h.change.coins)}${h.change.readyAt && h.change.readyAt > Date.now() ? '・冷卻 <span class="cdn" data-until="' + h.change.readyAt + '"></span>' : ''}</span></div></div>
        <div class="cd"><h4>出戰技能</h4>${h.slots.map((id) => { const d = SKD(id); return `<div class="row" style="margin:6px 0"><span class="ic">${d.icon}</span><div class="sp"><b>${esc(d.name)}</b><div class="mu sm">${esc(d.desc)}</div></div></div>`; }).join('')}
          <button class="bt sm" data-tab="skills">調整技能</button></div>
      </div>`;
    }
    function viewTrain() {
      const h = S.me.hero, T = S.cfg.training, now = Date.now(), pv = T.pointValue || {};
      return `<div class="mu sm" style="margin-bottom:10px">每項訓練有獨立冷卻（真實時間），花費金幣並獲得經驗。每個能力的訓練點上限 = 等級 × ${T.capPerStatPerLevel}（目前 ${h.trainCap}）。</div>
      <div class="hx-grid">${Object.entries(T.types).map(([k, t]) => {
        const cost = t.coins + t.coinsPerLv * (h.level - 1), ready = (h.trainReady || {})[k] || 0, cd = ready > now;
        const pts = t.stat ? h.train[t.stat] || 0 : null, capped = !!t.stat && pts >= h.trainCap;
        const gain = t.stat ? (t.stat === 'crit' ? `暴擊 +${(pv.crit / 10).toFixed(1)}%／點` : `${STAT_LABEL[t.stat]} +${(pv[t.stat] * 100).toFixed(1)}%／點`) : '大量經驗';
        const cdTxt = t.cdMin >= 60 ? (t.cdMin / 60) + ' 小時' : t.cdMin + ' 分';
        return `<div class="cd ${cd || capped ? 'off' : ''}"><div class="row"><span class="ic">${t.icon}</span><div class="sp"><h4>${esc(t.name)}</h4><div class="mu sm">${gain}・經驗 +${t.xp}</div></div></div>
          <div class="ds" style="margin-top:6px">${esc(t.desc)}</div>
          ${t.stat ? `<div class="row sm"><span class="mu">訓練點</span><span class="sp"></span><b>${pts} / ${h.trainCap}</b></div><div class="bar2"><i style="width:${Math.min(100, (pts / Math.max(1, h.trainCap)) * 100)}%"></i></div>` : '<div class="row sm"><span class="mu">不加能力點，只給經驗</span></div><div class="bar2"><i style="width:0"></i></div>'}
          <div class="row">${cd ? '<span class="mu sm">冷卻中</span> <span class="cdn" data-until="' + ready + '"></span>' : capped ? '<span class="mu sm">已達本級上限</span>' : `<span class="mu sm">冷卻 ${cdTxt}</span>`}<span class="sp"></span>
          <button class="bt cy sm" data-act="train" data-id="${k}" ${cd || capped || S.busy || h.fishMissing || S.me.coins < cost ? 'disabled' : ''}>🪙 ${fmt(cost)}</button></div></div>`;
      }).join('')}</div>`;
    }
    function viewSkills() {
      const h = S.me.hero, R = S.cfg.skillRank, unlockLv = S.cfg.skillSlots.unlockLevels || [];
      if (!S.skillSel) S.skillSel = h.slots.slice();
      const sel = S.skillSel, changed = sel.join(',') !== h.slots.join(',');
      return `<div class="mu sm" style="margin-bottom:8px">技能欄 ${h.slotCount} 格（Lv ${unlockLv.join(' / ')} 解鎖）。戰鬥 AI 依欄位順序判斷施放，越前面越優先。點技能卡加入／移除。</div>
      <div class="hx-grid" style="margin-bottom:12px">${unlockLv.map((lv, i) => {
        const id = sel[i], d = id && SKD(id), locked = i >= h.slotCount;
        return `<div class="slot ${id ? 'f' : ''}" ${locked ? 'style="opacity:.4"' : ''}><b class="mu">${i + 1}</b>${locked ? `<span class="mu sm">🔒 Lv.${lv} 解鎖</span>` : id ? `<span class="ic">${d.icon}</span><div class="sp"><b>${esc(d.name)}</b><div class="mu sm">冷卻 ${d.cd} 行動</div></div><button class="bt sm" data-act="skUp" data-i="${i}" ${i ? '' : 'disabled'} title="提前">↑</button>` : '<span class="mu sm">空欄</span>'}</div>`;
      }).join('')}</div>
      <div class="row" style="margin-bottom:12px"><button class="bt pr" data-act="skSave" ${changed && !S.busy ? '' : 'disabled'}>儲存技能配置</button>${changed ? '<button class="bt" data-act="skReset">還原</button>' : ''}<span class="mu sm">${h.customSlots ? '使用自訂配置' : '目前為預設配置'}</span></div>
      <div class="hx-grid">${h.skillsAll.map((s, idx) => {
        const d = SKD(s.id), on = sel.includes(s.id), next = s.rank + 1, need = s.rank * R.minLevelPerRank, cost = R.costCoins[s.rank];
        return `<div class="cd ${s.unlocked ? '' : 'off'} ${on ? 'sel' : ''}" ${s.unlocked ? `data-act="skToggle" data-id="${s.id}" style="cursor:pointer"` : ''}>
          <div class="row"><span class="ic">${d.icon}</span><div class="sp"><h4>${esc(d.name)} <span class="mu sm">Rank ${s.rank}/${R.max}</span></h4><div class="mu sm">冷卻 ${d.cd} 行動${idx === 0 ? '・<span style="color:var(--gd)">招牌技</span>' : ''}</div></div></div>
          <div class="ds">${esc(d.desc)}${s.rank > 1 ? `（效果 +${Math.round((s.rank - 1) * R.perRank * 100)}%）` : ''}</div>
          <div class="row">${s.unlocked ? (next <= R.max ? `<span class="mu sm">升到 Rank ${next}${h.level < need ? `・需 Lv.${need}` : ''}</span><span class="sp"></span><button class="bt sm" data-act="skRank" data-id="${s.id}" ${h.level < need || S.busy || S.me.coins < cost ? 'disabled' : ''}>🪙 ${fmt(cost)}</button>` : '<span class="mu sm">已滿級</span>') : `<span class="mu sm">🔒 Lv.${s.unlockLevel} 解鎖</span>`}</div></div>`;
      }).join('')}</div>`;
    }
    function modsText(m) {
      const L = { hpPct: '生命', atkPct: '攻擊', defPct: '防禦', spdPct: '速度' };
      return Object.entries(m || {}).map(([k, v]) => (L[k] ? `${L[k]} +${v}%` : k === 'crit' ? `暴擊 +${v / 10}%` : k === 'dodge' ? `閃避 +${v / 10}%` : k === 'critDmg' ? `暴傷 +${v}%` : `${k} +${v}`)).join('・');
    }
    function viewGear() {
      const h = S.me.hero, G = S.cfg.gear, own = new Set(h.gear.owned), eq = h.gear.equip || {};
      return `<div class="mu sm" style="margin-bottom:8px">裝備用金幣或寶石購買（伺服器扣款），永久擁有；更換英雄魚時裝備一起帶走。</div>
      ${Object.entries(S.cfg.gearSlots).map(([slot, nm]) => `<h4 style="margin:14px 0 8px">${esc(nm)} <span class="mu sm">${eq[slot] && G[eq[slot]] ? '已裝備：' + esc(G[eq[slot]].name) : '未裝備'}</span></h4>
      <div class="hx-grid">${Object.entries(G).filter(([, it]) => it.slot === slot && !it.disabled).map(([id, it]) => {
        const o = own.has(id), on = eq[slot] === id, low = h.level < it.minLevel, gem = it.gems != null, afford = gem ? S.me.gems >= it.gems : S.me.coins >= it.coins;
        return `<div class="cd ${on ? 'sel' : ''} ${low && !o ? 'off' : ''}"><div class="row"><span class="ic">${it.icon}</span><div class="sp"><h4>${esc(it.name)}${gem ? ' <span class="tag" style="color:#b77dff">寶石</span>' : ''}</h4><div class="sm" style="color:#9fe6c3">${esc(modsText(it.mods))}</div></div></div>
          <div class="row" style="margin-top:8px"><span class="mu sm">${it.minLevel > 1 ? '需 Lv.' + it.minLevel : ''}${o ? '　已擁有' : ''}</span><span class="sp"></span>
          ${o ? (on ? `<button class="bt sm" data-act="unequip" data-slot="${slot}">卸下</button>` : `<button class="bt cy sm" data-act="equip" data-slot="${slot}" data-id="${id}" ${low ? 'disabled' : ''}>裝備</button>`)
            : `<button class="bt ${gem ? 'gm' : 'cy'} sm" data-act="buy" data-id="${id}" ${low || !afford || S.busy ? 'disabled' : ''}>${gem ? '💎 ' + fmt(it.gems) : '🪙 ' + fmt(it.coins)}</button>`}</div></div>`;
      }).join('')}</div>`).join('')}`;
    }
    const viewReg = () => `<div class="reg"><h3>⚔️ 英雄魚對戰只開放給註冊會員</h3><p class="mu">用信箱註冊只要 10 秒，魚缸、金幣與英雄魚的養成進度都會保留。<br>訪客仍然可以培養英雄魚（訓練、技能、裝備）。</p><button class="bt pr" data-act="register">立即註冊會員</button></div>`;
    function viewBattle() {
      const h = S.me.hero;
      if (!S.me.member || S.needReg) return viewReg();
      if (h.pvpBanned) return `<div class="reg"><h3>⛔ 對戰資格已停權</h3><p class="mu">${esc(h.pvpBanReason || '')}</p></div>`;
      if (h.fishMissing) return '<div class="reg"><h3>英雄魚不在魚缸了</h3><p class="mu">請先免費重新選擇一條英雄魚。</p><button class="bt pr" data-act="pickOpen">重新選擇</button></div>';
      const o = S.opps, refillPrice = S.cfg.pvp.ticketRefillGems ?? 20;
      const wait=Math.max(0,Math.ceil(((S.challengeUntil||0)-Date.now())/1000));
      const head = `${wait?'<div role="status" style="padding:12px;margin-bottom:12px;border:1px solid #dbbc77;border-radius:10px;color:#ffe6a5">連續挑戰較快，請等 <b data-challenge-wait>'+wait+'</b> 秒再挑戰。剩餘次數保留，無須補買。</div>':''}<div class="row" style="margin-bottom:10px"><div class="sp"><b>挑戰次數 ${h.tickets}/${h.ticketsMax}</b> ${h.nextTicketAt ? `<span class="mu sm">下一次回復 <span class="cdn" data-until="${h.nextTicketAt}"></span></span>` : '<span class="mu sm">已滿</span>'}
        <div class="mu sm">依積分配對；對方離線也能挑戰（使用對方英雄的快照）。戰鬥由伺服器模擬，結果無法竄改。</div></div><button class="bt" data-act="refresh" ${S.busy ? 'disabled' : ''}>↻ 換一批</button></div>
        <div class="row" style="margin-bottom:14px;flex-wrap:wrap"><button class="bt gm" data-act="ticketRefill" ${S.busy || h.tickets >= h.ticketsMax || S.me.gems < refillPrice ? 'disabled' : ''}>💎 ${fmt(refillPrice)} 恢復 1 次</button><span class="mu sm">${h.tickets >= h.ticketsMax ? '次數已滿' : S.me.gems < refillPrice ? '鑽石不足' : '保留原本自動恢復進度'}</span></div>`;
      if (!o) return head + '<div class="ld">配對中…</div>';
      return head + `<div style="display:flex;flex-direction:column;gap:10px">${o.opponents.map((x) => `<div class="cd opp">${portrait(x.hero.sp, x.hero.hue, '', 0, 0)}
        <div><div class="row"><b>${esc(x.nickname)}</b>${x.npc ? '<span class="tag mu">練習・不計分</span>' : rankChip(x.rank)}</div>
          <div class="mu sm">${esc(x.hero.spName)}・Lv.${x.hero.level}・戰力 <b style="color:var(--gd)">${fmt(x.hero.power)}</b>${x.npc ? '' : '・積分 ' + fmt(x.rating)}</div>
          <div class="mu sm hide-m">${(x.hero.skills || []).map((s) => SKD(s.id).icon + ' ' + SKD(s.id).name).join('　')}</div></div>
        <div class="oa"><div class="gain">${x.npc ? '<span class="mu">少量經驗</span>' : `<span class="win">勝 +${x.gain}</span>　<span class="lose">敗 ${x.loss}</span>`}</div>
          <button class="bt pr" data-act="fight" data-id="${esc(x.key)}" ${S.busy || wait>0 || h.tickets <= 0 ? 'disabled' : ''}>⚔️ 挑戰</button></div></div>`).join('') || '<div class="empty">目前沒有可配對的對手</div>'}</div>`;
    }
    function viewRank() {
      const l = S.lb; if (!l) return '<div class="ld">讀取排行榜…</div>';
      return `<div class="row" style="margin-bottom:8px"><b>${esc(l.season ? l.season.name : '')} 排行榜</b><span class="sp"></span><span class="mu sm hide-m">${S.cfg.ranks.map((r) => `<span style="color:${esc(r.color)}">${esc(r.name)}</span> ${r.min}`).join('・')}</span></div>
      ${l.monthlyRewards?`<div class="cd" style="margin-bottom:10px"><b>🏆 ${esc(l.monthlyRewards.month)} 每月前五名鑽石獎勵</b><p>${l.monthlyRewards.prizes.map(x=>`第 ${x.position} 名 💎${x.gems}`).join(' · ')}</p><div class="mu sm">台灣時間每月底依排行榜積分結算，同分依玩家 ID 排序；獎勵於次月初發至遊戲信箱領取。</div></div>`:''}
      ${l.me ? `<div class="cd sel" style="margin-bottom:10px"><div class="row"><b>我的名次 #${l.me.position}</b>${rankChip(l.me.rank)}<span class="sp"></span><b>${fmt(l.me.rating)}</b></div></div>` : ''}
      <table><tr><th>#</th><th>玩家</th><th class="hide-m">英雄</th><th>段位</th><th class="num">積分</th><th class="num hide-m">勝/敗</th></tr>
      ${l.leaderboard.map((x) => `<tr class="${x.me ? 'me' : ''}"><td><b>${x.position <= 3 ? ['🥇', '🥈', '🥉'][x.position - 1] : x.position}</b></td><td><b>${esc(x.nickname)}</b><div class="mu sm">Lv.${x.level}</div></td><td class="hide-m">${esc(x.fishName || '')}<div class="mu sm">${esc(x.spName)}</div></td><td>${rankChip(x.rank)}</td><td class="num"><b>${fmt(x.rating)}</b></td><td class="num hide-m">${x.wins}/${x.losses}</td></tr>`).join('')}</table>`;
    }
    function viewLog() {
      const l = S.logs; if (!l) return '<div class="ld">讀取戰報…</div>';
      return `<table><tr><th>時間</th><th>對戰</th><th>結果</th><th class="num">積分</th><th></th></tr>${l.battles.map((b) => {
        const atk = b.mine === 'attacker', opp = atk ? b.d : b.a, delta = atk ? b.aDelta : b.dDelta;
        return `<tr class="ck" data-act="replay" data-id="${b.id}"><td class="sm mu">${when(b.createdAt)}</td><td>${atk ? '⚔️ 進攻' : '🛡️ 防守'} <b>${esc(opp.nickname || opp.name)}</b><div class="mu sm">${esc(opp.spName)} Lv.${opp.level}${b.npc ? '・練習' : ''}</div></td>
        <td class="${b.won ? 'win' : 'lose'}">${b.won ? '勝' : '敗'}${b.reason === 'timeout' ? '<span class="mu sm">（時間到）</span>' : ''}</td><td class="num ${delta > 0 ? 'win' : delta < 0 ? 'lose' : 'mu'}">${delta > 0 ? '+' : ''}${delta || 0}</td><td><button class="bt sm">▶ 重播</button></td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">還沒有戰報</td></tr>'}</table>`;
    }

    function render() {
      if (!alive) return;
      const sc = el.querySelector('.hx-body'), top = sc ? sc.scrollTop : 0;
      let body;
      if (S.err) body = `<div class="empty">${esc(S.err)}<br><br><button class="bt" data-act="reload">重新載入</button></div>`;
      else if (!S.me || !S.cfg) body = '<div class="ld">載入英雄魚…</div>';
      else if (!S.me.hero || S.picking) body = viewPick();
      else body = ({ hero: viewHero, train: viewTrain, skills: viewSkills, gear: viewGear, battle: viewBattle, rank: viewRank, log: viewLog }[S.tab] || viewHero)();
      const keep = S.replayEl, toasts = [...el.querySelectorAll('.toast')];
      const withHero = S.me && S.me.hero && !S.picking && S.cfg;
      el.innerHTML = `${opts.onClose ? '<button class="hx-x" data-act="close" title="關閉">×</button>' : ''}${withHero ? header() + tabs() : '<div class="hx-top"><div class="hx-id"><div class="hx-nm">⚔️ 英雄魚</div><div class="hx-sub">培養一條英雄魚，和其他會員一較高下</div></div></div>'}<div class="hx-body">${body}</div>`;
      toasts.forEach((t) => el.appendChild(t));
      if (keep) el.appendChild(keep);
      const nb = el.querySelector('.hx-body'); if (nb) nb.scrollTop = top;
      tickTimers();
    }
    function tickTimers() {
      const now = Date.now(); let expired = false; if(S.challengeUntil){const seconds=Math.max(0,Math.ceil((S.challengeUntil-now)/1000));if(!seconds){S.challengeUntil=0;render();return;}el.querySelectorAll('[data-challenge-wait]').forEach(n=>n.textContent=String(seconds));}
      el.querySelectorAll('[data-until]').forEach((n) => { const ms = Number(n.dataset.until) - now; if (ms <= 0 && n.textContent) expired = true; n.textContent = ms > 0 ? dur(ms) : ''; });
      if (expired && !S.busy && !S.replayEl) refreshMe();
    }
    async function refreshMe() { try { applyView(await api('GET', '/me')); render(); } catch (e) { /* 忽略 */ } }
    function loop(now) {
      if (!alive) return; raf = root.requestAnimationFrame(loop);
      if (S.replayEl) return;
      el.querySelectorAll('canvas[data-sp]').forEach((cv) => { if (cv.offsetParent) drawPortrait(book, cv, cv.dataset.sp, cv.dataset.hue === '' ? null : Number(cv.dataset.hue), now / 1000 + (cv.dataset.sp.length % 5)); });
    }

    // ---------------- 戰鬥重播 / 結果 ----------------
    function showReplay(battle, result, o2) {
      o2 = o2 || {};
      closeReplay();
      const ov = document.createElement('div'); ov.className = 'ov';
      ov.innerHTML = `<canvas></canvas><div class="ovb"><button class="bt sm" data-r="speed">1×</button><button class="bt sm" data-r="skip">跳過 ▶▶</button><button class="bt sm" data-r="flash">減少閃光</button><span class="sp mu sm" style="text-align:center">${esc(battle.a.nickname || battle.a.name)} vs ${esc(battle.d.nickname || battle.d.name)}・種子 ${battle.seed}</span><button class="bt sm" data-r="close">關閉</button></div>`;
      el.appendChild(ov); S.replayEl = ov;
      let sp = o2.speed || 1;
      const rp = Replay(ov.querySelector('canvas'), battle, { book, cfg: S.cfg, speed: sp, reduceFlash: o2.reduceFlash, onDone: () => showResult(battle, result) });
      S.replay = rp;
      const flashBtn = ov.querySelector('[data-r="flash"]');
      if (flashBtn && rp.state.reduce) { flashBtn.textContent = '閃光已關'; flashBtn.classList.add('on'); }
      ov.querySelector('.ovb').onclick = (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        if (b.dataset.r === 'speed') { sp = sp === 1 ? 2 : sp === 2 ? 4 : 1; rp.setSpeed(sp); b.textContent = sp + '×'; }
        if (b.dataset.r === 'skip') rp.skip();
        if (b.dataset.r === 'flash') {
          const on = !rp.state.reduce;
          try { localStorage.setItem('ff.reduceFlash', on ? '1' : '0'); } catch (err) { /* 私密模式 */ }
          rp.setReduce(on);
          b.textContent = on ? '閃光已關' : '減少閃光';
          b.classList.toggle('on', on);
        }
        if (b.dataset.r === 'close') { closeReplay(); if (result) openTab('battle'); }
      };
      return rp;
    }
    function showResult(battle, result) {
      const ov = S.replayEl; if (!ov || ov.querySelector('.rs')) return;
      const won = result ? result.win : battle.won != null ? battle.won : battle.winner === 0;
      let mid = '';
      if (result) {
        const d = result.delta;
        mid = battle.npc ? '<div class="mu" style="margin-top:8px">練習對戰・不影響積分</div>' : `<div class="rt">${fmt(result.ratingBefore)} → ${fmt(result.ratingAfter)}<span class="dl ${d > 0 ? 'win' : d < 0 ? 'lose' : 'mu'}">${d > 0 ? '+' : ''}${d}</span></div>
          <div>${rankChip(result.rankAfter)}</div>${result.rankChanged ? `<div class="promo ${result.ratingAfter < result.ratingBefore ? 'down' : ''}">${result.ratingAfter > result.ratingBefore ? '▲ 晉級' : '▼ 降級'}　${esc(result.rankBefore.name)} → ${esc(result.rankAfter.name)}</div>` : ''}`;
        const fl = battle.flags || [];
        mid += `<div class="mu sm" style="margin-top:8px">經驗 +${result.xp}${result.levelUps ? `　<b style="color:var(--gd)">升級！Lv.${result.level}</b>` : ''}${fl.includes('same_ip') ? '<br>⚠️ 同網路對戰不計分' : ''}${fl.includes('repeat_opponent') ? '<br>重複對手：積分收益遞減' : ''}</div>`;
      } else {
        const d = battle.mine === 'defender' ? battle.dDelta : battle.aDelta;
        if (d != null) mid = `<div class="rt"><span class="${d > 0 ? 'win' : d < 0 ? 'lose' : 'mu'}">${d > 0 ? '+' : ''}${d}</span></div>`;
      }
      const box = document.createElement('div'); box.className = 'rs';
      box.innerHTML = `<div class="rsb"><p class="big ${won ? 'w' : 'l'}">${won ? '勝利' : '落敗'}</p><div class="mu sm">${battle.reason === 'timeout' ? '時間到・依剩餘生命比例判定' : '擊倒對手'}・${battle.actions || 0} 次行動</div>${mid}
        <div class="row" style="justify-content:center;margin-top:16px"><button class="bt" data-r2="again">再看一次</button><button class="bt pr" data-r2="back">${result ? '返回對手名單' : '關閉'}</button></div></div>`;
      ov.appendChild(box);
      box.onclick = (e) => {
        const b = e.target.closest('[data-r2]'); if (!b) return;
        if (b.dataset.r2 === 'again') showReplay(battle, result);
        else { closeReplay(); if (result) openTab('battle'); }
      };
    }
    function closeReplay() { if (S.replay) S.replay.destroy(); S.replay = null; if (S.replayEl) S.replayEl.remove(); S.replayEl = null; }

    // ---------------- 事件 ----------------
    el.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-tab]');
      if (tb && !e.target.closest('[data-act]')) { S.skillSel = null; return openTab(tb.dataset.tab); }
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      const a = b.dataset.act, id = b.dataset.id, H = S.me && S.me.hero;
      if (a === 'close') return opts.onClose && opts.onClose();
      if (a === 'reload') return load();
      if (a === 'register') return opts.onNeedRegister ? opts.onNeedRegister('英雄魚對戰只開放給註冊會員') : toast('請先在遊戲中註冊會員', true);
      if (a === 'pickOpen') { S.picking = true; S.cand = null; render(); await loadCand(); return render(); }
      if (a === 'pickCancel') { S.picking = false; return render(); }
      if (a === 'pick') {
        const ch = S.cand && S.cand.change;
        if (H && ch && !ch.free && root.confirm && !root.confirm(`更換英雄魚需要 🪙${ch.coins}，確定嗎？`)) return;
        const r = await spend('/pick', { fishId: id, idempotencyKey: uid() }, '⚔️ 英雄魚就位！');
        if (r) { S.picking = false; S.tab = 'hero'; S.skillSel = null; render(); }
        return;
      }
      if (a === 'train') { const t = S.cfg.training.types[id]; return spend('/train', { type: id }, (r) => `${t.icon} ${t.name}完成！經驗 +${t.xp}${r.gained && r.gained.levelUps ? `・升級到 Lv.${r.hero.level}！` : ''}`); }
      if (a === 'skToggle') {
        const sel = S.skillSel || H.slots.slice(), i = sel.indexOf(id);
        if (i >= 0) sel.splice(i, 1); else if (sel.length < H.slotCount) sel.push(id); else return toast(`技能欄已滿（${H.slotCount} 格），請先移除一個`, true);
        S.skillSel = sel; return render();
      }
      if (a === 'skUp') { const i = Number(b.dataset.i), s = S.skillSel; [s[i - 1], s[i]] = [s[i], s[i - 1]]; return render(); }
      if (a === 'skReset') { S.skillSel = null; return render(); }
      if (a === 'skSave') { const r = await act('/skills/equip', { slots: S.skillSel }, '技能配置已儲存'); if (r) { S.skillSel = null; render(); } return; }
      if (a === 'skRank') return spend('/skills/upgrade', { skillId: id, idempotencyKey: uid() }, `${SKD(id).name} 升級！`);
      if (a === 'buy') {
        const it = S.cfg.gear[id];
        if (it.gems != null && root.confirm && !root.confirm(`確定花費 💎${it.gems} 購買「${it.name}」？`)) return;
        return spend('/gear/buy', { itemId: id, idempotencyKey: uid() }, `${it.icon} 已購買「${it.name}」`);
      }
      if (a === 'equip') return act('/gear/equip', { slot: b.dataset.slot, itemId: id }, '已裝備');
      if (a === 'unequip') return act('/gear/equip', { slot: b.dataset.slot, itemId: null }, '已卸下');
      if (a === 'refresh') { S.busy = true; render(); try { S.opps = await api('GET', '/opponents?refresh=1'); } catch (er) { onErr(er); } S.busy = false; return render(); }
      if (a === 'ticketRefill') {
        if (S.busy) return;
        const price = S.cfg.pvp.ticketRefillGems ?? 20;
        if (!root.confirm || !root.confirm(`花費 💎${price} 恢復 1 次對戰機會？目前 ${H.tickets}/${H.ticketsMax} 次。`)) return;
        const key = S.refillKey || (S.refillKey = uid());
        const r = await spend('/tickets/refill', { idempotencyKey: key }, '⚔️ 已恢復 1 次對戰機會！');
        if (r) { S.refillKey = null; return openTab('battle'); }
        return;
      }
      if (a === 'fight') {
        if(S.busy||(S.challengeUntil||0)>Date.now())return;
        S.busy = true; render();
        try { const r = await api('POST', '/challenge', { opponent: id }); S.me = r.me; S.busy = false; render(); showReplay(r.battle, r.result); }
        catch (er) { S.busy = false; if(er.code==='rate_limited'){S.challengeUntil=Date.now()+er.retryAfter*1000;}onErr(er); if (er.code === 'offer_expired') openTab('battle'); else render(); }
        return;
      }
      if (a === 'replay') { try { const r = await api('GET', '/battles/' + id); showReplay(r.battle, null); } catch (er) { onErr(er); } }
    });
    timer = setInterval(tickTimers, 1000);
    raf = root.requestAnimationFrame(loop);
    render(); load();
    return {
      el, state: S, open: openTab, refresh: load, showReplay,
      destroy() { alive = false; clearInterval(timer); root.cancelAnimationFrame(raf); closeReplay(); el.remove(); },
    };
  }

  const HeroUI = { mount, Replay, SpeciesBook, fx: FX, version: 2 };
  root.HeroUI = HeroUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = HeroUI;
})(typeof window !== 'undefined' ? window : globalThis);
