/* ADMINART-V1 後台魚卡縮圖改用遊戲本身的美術（GIANTART／GEMART／ARTUP 第1–4批／混種圖），沒有圖才用程式畫的舊外觀。
 * 做法：開一個隱藏的唯讀魚缸檢視 /?viewTank=ID&ftadmin=1&ftthumb=1（遊戲的 FRIENDTANK-VIEW-SHIM：不寫存檔、不建帳號、非 GET 一律擋），
 * 呼叫遊戲的 FTV.thumb(sp, hue) 取得和遊戲商店／圖鑑完全相同的 preview 圖。只讀，不改任何資料。
 * 混種代號 hx:A+B（A、B 可能再被 URL 編碼）先在本地解析成「A×B」，遊戲端回來後換成遊戲正式名稱。 */
(function () {
  'use strict';
  const dec = (x) => { try { return decodeURIComponent(x); } catch (e) { return x; } };
  function hxParts(sp) { if (typeof sp !== 'string' || !sp.startsWith('hx:')) return null; const p = sp.slice(3).split('+'); return p.length === 2 ? p.map(dec) : null; }
  function name(sp, cfg, depth) {
    depth = depth || 0; const S = (cfg && cfg.species) || {};
    if (S[sp] && S[sp].name) return S[sp].name;
    const p = depth < 6 && hxParts(sp); if (p) return p.map((x) => name(x, cfg, depth + 1)).join('×');
    if (typeof sp === 'string' && sp.startsWith('fs_') && S[sp.slice(3)]) return '🎣 ' + (S[sp.slice(3)].name || sp);
    return String(sp || '');
  }
  const label = (sp, cfg) => (hxParts(sp) ? '🧬 混種 ' : '') + name(sp, cfg);
  let frame = null, ready = null, owner = 0;
  function bridge(playerId) {
    if (ready && owner === +playerId && frame && frame.isConnected) return ready;
    if (frame) frame.remove();
    owner = +playerId; frame = document.createElement('iframe');
    frame.title = '魚卡縮圖（隱藏）'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:700px;border:0;opacity:0;pointer-events:none';
    frame.src = '/?viewTank=' + (+playerId || 1) + '&ftadmin=1&ftthumb=1&fcap=1&ga=off';
    const f = frame;
    ready = new Promise((res) => {
      const t0 = Date.now();
      const poll = () => {
        if (!f.isConnected) return res(null);
        let V = null; try { V = f.contentWindow && f.contentWindow.FTV; } catch (e) { return res(null); }
        if (V && typeof V.thumb === 'function' && V.thumbReady && V.thumbReady()) return res(V);
        if (Date.now() - t0 > 25000) return res(null);
        setTimeout(poll, 400);
      };
      setTimeout(poll, 600);
    });
    document.body.appendChild(frame);
    return ready;
  }
  function paint(canvas, url) {
    return new Promise((res) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => {
        const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3fb0dc'); g.addColorStop(1, '#0f4f75'); c.fillStyle = g; c.fillRect(0, 0, W, H);
        const k = Math.min(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
        c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); canvas.dataset.art = '1'; res(true);
      };
      im.onerror = () => res(false); im.src = url;
    });
  }
  // items: [{ canvas, sp, hue, nameEl }]；先用遊戲美術重畫，美術圖較晚載入的再補畫兩次
  async function apply(playerId, items) {
    items = (items || []).filter((it) => it && it.canvas && it.sp);
    if (!items.length) return 0;
    const V = await bridge(playerId); if (!V) return 0;
    let n = 0;
    for (const pass of [0, 2500, 6000]) {
      if (pass) await new Promise((r) => setTimeout(r, pass));
      for (const it of items) {
        if (!it.canvas.isConnected) continue;
        let o = null; try { o = V.thumb(it.sp, it.hue); } catch (e) { o = null; }
        if (!o || !o.url) continue;
        if (it.nameEl && o.name && hxParts(it.sp)) it.nameEl.textContent = '🧬 混種 ' + o.name;
        if (it._last === o.url) continue; it._last = o.url;
        if (await paint(it.canvas, o.url) && !pass) n++;
      }
    }
    return n;
  }
  window.AdminFishThumbs = { apply, name, label, hxParts, _bridge: bridge };
})();
