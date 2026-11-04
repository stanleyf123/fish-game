// v4.1.2 💳 儲值後台（手機優先）：訂單卡片（分頁、向藍新查詢、手動入帳、退款、15 秒自動更新）、新入帳提示＋徽章、儀表板摘要、💰 營收報表
(function () {
  const { h } = A;
  const fmt = (n) => A.fmtNum(n), nt = (n) => 'NT$' + fmt(n);
  const pct = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10) + '%');
  const METHOD = (t) => (!t ? '' : /^Credit|^CREDIT/.test(t) ? '💳 信用卡' : /^ATM|^VACC|^WEBATM/i.test(t) ? '🏧 ATM' : /^CVS|^BARCODE/.test(t) ? '🏪 超商' : h(t));
  const PROV = { newebpay: '藍新', ecpay: '綠界' };
  const grants = (g) => (!g ? '' : g.vipDays ? `👑 月卡 ${g.vipDays} 天＋💎${fmt(g.gems || 0)}` : g.gems ? `💎${fmt(g.gems)}${g.bonusGems ? `＋首儲 ${fmt(g.bonusGems)}` : ''}` : g.coins ? `🪙${fmt(g.coins)}` : '');
  const ST = { pending: ['待付款', 'pend'], paid: ['已入帳', 'paid'], refunded: ['已退款', 'ref'], failed: ['未完成', 'fail'], canceled: ['已取消', 'fail'] };
  const stBadge = (o) => { const ex = o.status === 'pending' && o.expired; const [t, c] = ex ? ['已逾期', 'exp'] : (ST[o.status] || [o.status, 'fail']); return `<span class="p4-st p4-${c}">${t}</span>`; };
  const css = `
  .p4-tabs{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.p4-tabs::-webkit-scrollbar{display:none}
  .p4-tabs button{flex:none;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
  .p4-tabs button.on{background:var(--accent);color:#1b2a36;border-color:var(--accent)}
  .p4-tabs .n{display:inline-block;min-width:18px;padding:0 5px;margin-left:4px;border-radius:9px;background:rgba(0,0,0,.25);font-size:11px;text-align:center}
  .p4-bar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}.p4-bar input[type=search]{flex:1;min-width:150px}
  .p4-live{font-size:11px;color:var(--muted)}.p4-live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:4px;animation:p4b 2s infinite}
  @keyframes p4b{50%{opacity:.3}}
  .p4-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}
  .p4-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:11px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
  .p4-card.new{border-color:var(--ok);box-shadow:0 0 0 2px rgba(94,230,168,.25)}
  .p4-r1{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
  .p4-who{min-width:0}.p4-who a{font-weight:800;color:var(--text);text-decoration:none}.p4-who .e{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .p4-amt{font-size:19px;font-weight:900;color:var(--accent);white-space:nowrap}
  .p4-item{font-weight:700}.p4-item small{color:var(--muted);font-weight:600}
  .p4-meta{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;color:var(--muted)}.p4-meta b{color:var(--text);font-weight:600}
  .p4-st{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:800;white-space:nowrap}
  .p4-pend{background:rgba(255,209,102,.18);color:#ffd166}.p4-paid{background:rgba(94,230,168,.18);color:#5ee6a8}.p4-ref{background:rgba(199,155,255,.18);color:#c79bff}.p4-fail,.p4-exp{background:rgba(143,163,179,.18);color:#a9bccb}
  .p4-tag{display:inline-block;font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px;background:rgba(255,126,182,.18);color:var(--pink);margin-left:4px}
  .p4-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.p4-btns .btn{flex:1;min-width:0;padding:8px 6px;font-size:13px;white-space:nowrap}
  .p4-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
  .p4-sum .kpi a{color:inherit;text-decoration:none}
  .p4-latest{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 12px;margin-bottom:14px;font-size:13px}
  .p4-latest div{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid rgba(255,255,255,.05)}.p4-latest div:first-of-type{border-top:0}
  .p4-latest span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rp-ranges{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:6px}.rp-ranges::-webkit-scrollbar{display:none}
  .rp-ranges button{flex:none;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
  .rp-ranges button.on{background:var(--accent);color:#1b2a36;border-color:var(--accent)}
  .rp-custom{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
  .rp-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:12px}
  .rp-k .kpi .v{font-size:21px}.rp-d{font-size:11px;font-weight:800;margin-left:4px}.rp-up{color:var(--ok)}.rp-dn{color:var(--bad)}
  .rp-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px;margin-bottom:12px}
  .rp-g .card{margin:0;min-width:0}.rp-g h3{margin:0 0 8px;font-size:15px}
  .rp-svg{width:100%;height:auto;display:block}.rp-svg text{fill:var(--muted);font-size:11px}
  .rp-leg{display:flex;gap:12px;font-size:11px;color:var(--muted);margin-top:4px;flex-wrap:wrap}.rp-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
  .rp-hb{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) auto;gap:6px 8px;align-items:center;font-size:13px}
  .rp-hb .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rp-hb .b{height:12px;border-radius:6px;background:rgba(255,255,255,.06);overflow:hidden}.rp-hb .b i{display:block;height:100%;border-radius:6px}
  .rp-hb .v{text-align:right;white-space:nowrap;font-weight:700}
  .rp-fn{display:flex;flex-direction:column;gap:6px}.rp-fn .s{position:relative;border-radius:10px;background:rgba(255,255,255,.05);overflow:hidden;padding:7px 10px;font-size:13px;display:flex;justify-content:space-between;gap:8px}
  .rp-fn .s i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(108,196,255,.35),rgba(108,196,255,.15));z-index:0}.rp-fn .s span{position:relative;z-index:1}
  .rp-fn .drop{font-size:11px;color:var(--bad);padding-left:12px}
  .rp-t{width:100%;border-collapse:collapse;font-size:13px}.rp-t td,.rp-t th{padding:6px 4px;border-top:1px solid rgba(255,255,255,.06);text-align:left}.rp-t .num{text-align:right;white-space:nowrap}
  .rp-empty{color:var(--muted);font-size:13px;padding:14px 4px;text-align:center}
  .rp-note{font-size:12px;color:var(--muted);margin:6px 0 12px}
  @media (max-width:760px){.p4-sum{grid-template-columns:repeat(2,minmax(0,1fr))}.p4-list{grid-template-columns:1fr}.rp-k{grid-template-columns:repeat(2,minmax(0,1fr))}.rp-k .kpi .v{font-size:18px}.rp-t{font-size:12px}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- 新入帳提示（全後台；15 秒） ----------
  const SEEN = 'adm.pay.seen';
  let seen = Number(localStorage.getItem(SEEN)) || 0; if (!seen) { seen = Date.now(); localStorage.setItem(SEEN, String(seen)); }
  let lastSum = null, newCount = 0;
  function setBadge(n) { newCount = n; const b = document.getElementById('payBadge'); if (b) { b.textContent = n ? String(n) : ''; b.classList.toggle('hidden', !n); } }
  function markSeen() { seen = Date.now(); localStorage.setItem(SEEN, String(seen)); setBadge(0); }
  let notified = new Set(), paymentBaselineReady = false;
  async function sumTick() {
    try { const s = await A.get('/pay/summary'); lastSum = s;
      const fresh = s.latest.filter((o) => o.creditedAt > seen); setBadge(fresh.length);
      for (const o of s.latest) if (!notified.has(o.id)) { notified.add(o.id); if (paymentBaselineReady && o.creditedAt > seen && Date.now() - o.creditedAt >= 0 && Date.now() - o.creditedAt < 120000) A.toast(`✅ 付款成功・已入帳：${o.nickname || '#' + o.playerId} ${o.name} ${nt(o.amount)}（可至已入帳訂單查看）`); }
      paymentBaselineReady = true;
      return s; } catch (e) { return null; } }
  setTimeout(sumTick, 1200); setInterval(() => { if (!document.hidden) sumTick(); }, 15000);

  // ---------- 儀表板頂部摘要 ----------
  function sumHtml(s) {
    return `<div id="p4Sum"><div class="p4-sum">
      <div class="kpi"><a href="#pay/report"><div class="l">今日淨營收</div><div class="v">${nt(s.net)}</div><div class="s">${fmt(s.paidOrders)} 筆付款・${h(s.today)}</div></a></div>
      <div class="kpi"><a href="#pay/orders"><div class="l">待付款</div><div class="v">${fmt(s.pending)}</div><div class="s">${nt(s.pendingAmount)}</div></a></div>
      <div class="kpi"><a href="#pay/report"><div class="l">今日跳轉付款</div><div class="v">${fmt(s.redirectToday)} <small>人</small></div><div class="s">前往藍新付款頁</div></a></div>
      <div class="kpi"><a href="#pay/orders/paid"><div class="l">新入帳</div><div class="v">${fmt(newCount)}</div><div class="s">尚未查看</div></a></div></div>
      ${s.latest.length ? `<details class="p4-latest" ${matchMedia('(min-width:761px)').matches?'open':''}><summary>最新入帳 <span class="muted">${s.latest.length} 筆 · 展開明細</span></summary>${s.latest.map((o) => `<div><span>${A.fmtTime(o.creditedAt).slice(5)}・<a href="#player/${o.playerId}">${h(o.nickname || '#' + o.playerId)}</a>・${h(o.name)}</span><b>${nt(o.amount)}</b></div>`).join('')}</details>` : ''}</div>`;
  }
  const origDash = Views.dashboard;
  Views.dashboard = async function (main) {
    await origDash(main);
    const put = (s) => { if (location.hash.replace('#', '').split('/')[0] !== 'dashboard' && location.hash) return; const old = main.querySelector('#p4Sum'); const h1 = main.querySelector('h1'); if (!h1) return; const d = document.createElement('div'); d.innerHTML = sumHtml(s); if (old) old.replaceWith(d.firstChild); else if(main.querySelector('.dashboard-period')) main.querySelector('.dashboard-period').after(d.firstChild); else h1.nextElementSibling ? h1.nextElementSibling.after(d.firstChild) : h1.after(d.firstChild); };
    const s = lastSum || await sumTick(); if (s) put(s);
    const mo = new MutationObserver(() => { if (!main.querySelector('#p4Sum') && lastSum && /^#?(dashboard)?$/.test(location.hash)) put(lastSum); });
    mo.observe(main, { childList: true }); window.addEventListener('hashchange', () => mo.disconnect(), { once: true });
  };

  // ---------- 訂單卡片 ----------
  const origPay = Views.pay;
  const TABS = [['pending', '⏳ 待付款'], ['paid', '✅ 已入帳'], ['refunded', '↩️ 已退款'], ['all', '📋 全部'], ['gems', '💎 寶石消費']];
  Views.pay = async function (main, params) {
    const tab = params[0] || 'orders';
    if (tab === 'report') return report(main, params);
    if (tab !== 'orders') return origPay(main, params);
    return orders(main, params[1] || 'pending');
  };
  Views.payreport = (main) => report(main, []);
  const head = (on) => `<h1>💳 儲值</h1><div class="toolbar">${[['orders', '🧾 訂單'], ['report', '💰 營收報表'], ['stats', '📈 舊版營收'], ['products', '🛠 儲值方案']].map(([k, t]) => `<a class="btn ${on === k ? 'primary' : 'ghost'}" href="#pay/${k}">${t}</a>`).join('')}</div>`;

  async function orders(main, sub) {
    const S = Views.pay.s4 || (Views.pay.s4 = { q: '' });
    let timer = null, busy = false, prevIds = null;
    main.innerHTML = head('orders') + `<div class="p4-tabs" id="p4t">${TABS.map(([k, t]) => `<button data-sub="${k}" class="${k === sub ? 'on' : ''}">${t}<span class="n" data-cnt="${k}"></span></button>`).join('')}</div>
      <div class="p4-bar"><input type="search" id="p4q" placeholder="訂單編號／玩家 ID／信箱" value="${h(S.q)}"><button class="btn" id="p4go">搜尋</button><span class="p4-live"><i></i>每 15 秒自動更新</span></div>
      <div id="p4list"><div class="loading">載入中…</div></div><div id="p4more"></div>`;
    if (sub === 'paid') markSeen();
    const list = main.querySelector('#p4list');
    const card = (o) => {
      const pend = o.status === 'pending', nw = o.provider === 'newebpay';
      return `<div class="p4-card${prevIds && !prevIds.has(o.id) ? ' new' : ''}" data-id="${h(o.id)}">
        <div class="p4-r1"><div class="p4-who"><a href="#player/${o.playerId}">${h(o.nickname || '玩家')} <small>#${o.playerId}</small></a><span class="e">${h(o.email || '')}</span></div><div style="text-align:right"><div class="p4-amt">${nt(o.amount)}</div>${stBadge(o)}</div></div>
        <div class="p4-item">${h(o.productName || '')} <small>${grants(o.grants)}</small>${o.isDemo ? '<span class="p4-tag">示範</span>' : ''}${o.manual ? '<span class="p4-tag">手動入帳</span>' : ''}</div>
        <div class="p4-meta"><span>${METHOD(o.paymentType) || (o.payInfo ? '' : '尚未選擇付款方式')}</span><span>${PROV[o.provider] || h(o.provider)}</span><span>建立 <b>${A.fmtTime(o.createdAt)}</b></span>${o.creditedAt ? `<span>入帳 <b>${A.fmtTime(o.creditedAt)}</b></span>` : ''}${pend && o.expiresAt ? `<span>期限 <b>${A.fmtTime(o.expiresAt)}</b></span>` : ''}${o.refundedAt ? `<span>退款 <b>${A.fmtTime(o.refundedAt)}</b></span>` : ''}</div>
        <div class="p4-meta mono" style="font-size:11px">${h(o.id)}${o.tradeNo ? '・' + h(o.tradeNo) : ''}</div>
        <div class="p4-btns">${nw && !o.creditedAt && o.status !== 'refunded' ? '<button class="btn" data-act="query">🔄 向藍新查詢</button>' : ''}${!o.creditedAt && o.status !== 'refunded' ? '<button class="btn" data-act="credit">✅ 手動入帳</button>' : ''}${o.status === 'paid' ? '<button class="btn danger" data-act="refund">↩️ 退款</button>' : ''}<button class="btn ghost" data-act="detail">詳細</button></div></div>`;
    };
    const gcard = (o) => `<div class="p4-card"><div class="p4-r1"><div class="p4-who"><a href="#player/${o.playerId}">${h(o.nickname || '玩家')} <small>#${o.playerId}</small></a><span class="e">${h(o.email || '')}</span></div><div class="p4-amt" style="color:#9fe8ff">💎${fmt(o.amount)}</div></div>
      <div class="p4-item">${h(o.productName)}${o.isDemo ? '<span class="p4-tag">示範</span>' : ''}</div><div class="p4-meta"><span class="mono">${h(o.sku)}</span><span>${A.fmtTime(o.createdAt)}</span><span class="mono">${h(o.id)}</span></div></div>`;
    async function counts() { try { const [a, b] = await Promise.all([A.get('/pay/orders?status=pending&limit=1'), A.get('/pay/summary')]); const c = main.querySelector('[data-cnt=pending]'); if (c) c.textContent = a.total || ''; const p = main.querySelector('[data-cnt=paid]'); if (p) p.textContent = newCount ? '+' + newCount : ''; void b; } catch (e) { /* 忽略 */ } }
    async function load(quiet) {
      if (busy) return; busy = true;
      try {
        const qs = new URLSearchParams({ limit: 50 }); const q = S.q.trim();
        if (q) { if (/^#?\d+$/.test(q)) qs.set('playerId', q.replace('#', '')); else qs.set('q', q); }
        if (sub === 'gems') { const d = await A.get('/pay/gem-orders?' + qs); list.innerHTML = d.orders.length ? `<div class="p4-list">${d.orders.map(gcard).join('')}</div><p class="rp-note">共 ${fmt(d.total)} 筆寶石消費（遊戲內用 💎 購買，非現金）</p>` : '<div class="rp-empty">沒有寶石消費紀錄</div>'; return; }
        if (sub !== 'all') qs.set('status', sub);
        const d = await A.get('/pay/orders?' + qs);
        const ids = new Set(d.orders.map((o) => o.id));
        list.innerHTML = d.orders.length ? `<div class="p4-list">${d.orders.map(card).join('')}</div><p class="rp-note">共 ${fmt(d.total)} 筆${d.total > 50 ? '（顯示最新 50 筆）' : ''}</p>` : `<div class="rp-empty">${sub === 'pending' ? '目前沒有待付款訂單 🎉' : '沒有訂單'}</div>`;
        prevIds = ids; if (sub === 'paid') markSeen();
      } catch (e) { if (!quiet) list.innerHTML = `<div class="errors">${h(e.message)}</div>`; } finally { busy = false; counts(); }
    }
    main.querySelector('#p4t').onclick = (e) => { const b = e.target.closest('[data-sub]'); if (b) location.hash = 'pay/orders/' + b.dataset.sub; };
    const go = () => { S.q = main.querySelector('#p4q').value; load(); };
    main.querySelector('#p4go').onclick = go; main.querySelector('#p4q').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    list.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const id = b.closest('[data-id]').dataset.id, act = b.dataset.act;
      if (act === 'detail') return detail(id, load);
      if (act === 'query') { b.disabled = true; const t = b.textContent; b.textContent = '⏳ 查詢中…'; try { const r = await A.post(`/pay/orders/${encodeURIComponent(id)}/query`); A.openModal(`<h2>🔄 藍新查詢結果</h2><table><tr><th>訂單</th><td class="mono">${h(id)}</td></tr><tr><th>藍新狀態</th><td><b>${h(r.tradeStatusText || r.message || r.tradeStatus || '—')}</b></td></tr><tr><th>已付款</th><td>${r.paid ? '✅ 是' : '❌ 否'}</td></tr><tr><th>本次入帳</th><td>${r.credit && r.credit.credited ? `✅ 已入帳 ${r.credit.gems ? '💎' + fmt(r.credit.gems) : ''}${r.credit.coins ? '🪙' + fmt(r.credit.coins) : ''}` : r.paid ? '先前已入帳' : '—'}</td></tr></table><div class="btns" style="margin-top:12px"><button class="btn primary" data-close>好</button></div>`); load(true); } catch (er) { A.errToast(er); } finally { b.disabled = false; b.textContent = t; } return; }
      if (act === 'credit') return manualCredit(id, load);
      if (act === 'refund') return refund(id, load);
    };
    await load();
    timer = setInterval(() => { if (!document.hidden && document.getElementById('p4list') === list && document.getElementById('modal').classList.contains('hidden')) load(true); }, 15000);
    window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
  }
  function manualCredit(id, reload) {
    const b = A.openModal(`<h2>✅ 手動入帳</h2><p class="muted">只有在<b>藍新／綠界後台已確認收款</b>、但通知沒進來時使用。每張訂單只會入帳一次，操作者與原因會寫入操作紀錄。</p>
      <label class="f">金流交易編號（TradeNo，可留空）<input id="mcT"></label><label class="f" style="margin-top:8px">原因（必填）<textarea id="mcR" rows="3" placeholder="例：已在藍新後台確認 10/22 ATM 入帳"></textarea></label>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="mcOk">我已在金流後台確認這筆款項已收到</label>
      <div class="btns" style="margin-top:12px"><button class="btn primary" id="mcGo" disabled>確認入帳</button><button class="btn ghost" data-close>取消</button></div>`);
    const ok = b.querySelector('#mcGo'), chk = () => { ok.disabled = !(b.querySelector('#mcOk').checked && b.querySelector('#mcR').value.trim()); };
    b.querySelector('#mcOk').onchange = chk; b.querySelector('#mcR').oninput = chk;
    ok.onclick = async () => { ok.disabled = true; try { const r = await A.post(`/pay/orders/${encodeURIComponent(id)}/credit`, { tradeNo: b.querySelector('#mcT').value.trim(), reason: b.querySelector('#mcR').value.trim() }); A.closeModal(); A.toast(`已入帳 ${r.gems ? '💎' + fmt(r.gems) : ''}${r.coins ? '🪙' + fmt(r.coins) : ''}`); reload && reload(true); } catch (e) { ok.disabled = false; A.errToast(e); } };
  }
  async function refund(id, reload) {
    const reason = await A.promptDlg('↩️ 退款', '退款原因（會扣回寶石／金幣／月卡；信用卡退刷請先在藍新後台操作）', '玩家申請退款', '確認退款', true);
    if (!reason) return;
    try { const r = await A.post(`/pay/orders/${encodeURIComponent(id)}/refund`, { reason }); A.toast('已標記退款' + (r.notes && r.notes.length ? '：' + r.notes.join('；') : '')); reload && reload(true); } catch (e) { A.errToast(e); }
  }
  async function detail(id, reload) {
    const d = await A.get('/pay/orders/' + encodeURIComponent(id)); const o = d.order, i = o.payInfo;
    const b = A.openModal(`<h2>訂單 <span class="mono">${h(o.id)}</span> ${stBadge(o)}</h2><table>
      <tr><th>玩家</th><td><a href="#player/${o.playerId}">#${o.playerId}</a> ${h((d.player && (d.player.nickname || d.player.email || d.player.username)) || '')}</td></tr>
      <tr><th>方案</th><td>${h(o.productName)}・${grants(o.grants)}</td></tr><tr><th>金額</th><td>${nt(o.amount)}（含稅）</td></tr>
      <tr><th>金流</th><td>${PROV[o.provider] || h(o.provider)}・${METHOD(o.paymentType) || '—'}・<span class="mono">${h(o.tradeNo || '—')}</span></td></tr>
      ${i ? `<tr><th>繳費資訊</th><td class="mono mini">${h([i.bankCode && '銀行 ' + i.bankCode, i.vAccount && '帳號 ' + i.vAccount, i.paymentNo && '代碼 ' + i.paymentNo, (i.barcode || []).join(' '), i.expireDate && '期限 ' + i.expireDate].filter(Boolean).join('・'))}</td></tr>` : ''}
      <tr><th>時間（台北）</th><td class="mini">建立 ${A.fmtTime(o.createdAt)}<br>入帳 ${A.fmtTime(o.creditedAt)}<br>退款 ${A.fmtTime(o.refundedAt)}</td></tr>
      <tr><th>備註</th><td class="mini" style="word-break:break-all">${h(o.note || '')}</td></tr></table>
      <h3 style="margin-top:12px">金流通知（藍新）</h3><table>${(d.raw || []).map((r) => `<tr><td class="mini nowrap">${A.fmtTime(r.created_at)}</td><td>${h(r.kind)}</td><td class="mono mini">${h(r.step || '')}</td><td class="mono mini" style="word-break:break-all">${h(r.result || '')}</td></tr>`).join('') || '<tr><td class="muted">尚未收到</td></tr>'}</table>
      <h3 style="margin-top:12px">寶石帳本</h3><table>${d.ledger.map((l) => `<tr><td class="mini nowrap">${A.fmtTime(l.created_at)}</td><td>${h(l.reason)}</td><td class="num">${l.delta > 0 ? '+' : ''}${fmt(l.delta)}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>
      <h3 style="margin-top:12px">操作紀錄</h3><table>${d.audit.map((a) => `<tr><td class="mini nowrap">${A.fmtTime(a.created_at || a.at)}</td><td>${h(a.actor || a.admin || '')}</td><td>${h(a.action)}</td><td class="mono mini" style="word-break:break-all">${h(a.detail || '')}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>
      <div class="btns" style="margin-top:12px"><button class="btn ghost" data-close>關閉</button></div>`);
    void b; void reload;
  }

  // ---------- 💰 營收報表 ----------
  const RANGES = [['today', '今日'], ['yesterday', '昨日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['month', '本月'], ['lastmonth', '上月'], ['custom', '自訂']];
  const delta = (a, b, inv) => { if (b == null) return ''; if (!b && !a) return ''; if (!b) return '<span class="rp-d rp-up">▲ 新</span>'; const v = (a - b) / Math.abs(b); const up = v >= 0; return `<span class="rp-d ${up !== !!inv ? 'rp-up' : 'rp-dn'}">${up ? '▲' : '▼'}${Math.abs(Math.round(v * 1000) / 10)}%</span>`; };
  function barsLine(days) {
    if (!days.length) return '<div class="rp-empty">尚無資料</div>';
    const W = 640, H = 210, pl = 46, pr = 30, pt = 10, pb = 24, n = days.length, iw = W - pl - pr, ih = H - pt - pb;
    const max = Math.max(1, ...days.map((d) => d.gross)), pmax = Math.max(1, ...days.map((d) => d.payers));
    const bw = Math.max(2, Math.min(26, iw / n * 0.38));
    let s = ''; for (let i = 0; i <= 4; i++) { const y = pt + ih * (1 - i / 4); s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.07)"/><text x="${pl - 5}" y="${y + 4}" text-anchor="end">${fmt(max * i / 4)}</text>`; }
    const xs = (i) => pl + iw * ((i + 0.5) / n);
    days.forEach((d, i) => { const x = xs(i), g = ih * d.gross / max, r = ih * d.refunds / max; s += `<rect x="${x - bw - 1}" y="${pt + ih - g}" width="${bw}" height="${g}" rx="2" fill="#5ee6a8"><title>${d.day} 營收 NT$${d.gross}</title></rect><rect x="${x + 1}" y="${pt + ih - r}" width="${bw}" height="${r}" rx="2" fill="#ff7b7b"><title>${d.day} 退款 NT$${d.refunds}</title></rect>`; });
    const step = Math.max(1, Math.ceil(n / 7)); days.forEach((d, i) => { if (i % step && i !== n - 1) return; s += `<text x="${xs(i)}" y="${H - 6}" text-anchor="middle">${d.day.slice(5)}</text>`; });
    const pts = days.map((d, i) => `${xs(i)},${pt + ih * (1 - d.payers / pmax)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="#ffd166" stroke-width="2"/>` + days.map((d, i) => `<circle cx="${xs(i)}" cy="${pt + ih * (1 - d.payers / pmax)}" r="2.5" fill="#ffd166"><title>${d.day} 付費 ${d.payers} 人</title></circle>`).join('');
    s += `<text x="${W - pr + 4}" y="${pt + 8}">${pmax}人</text>`;
    return `<svg class="rp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日營收">${s}</svg><div class="rp-leg"><span><i style="background:#5ee6a8"></i>營收</span><span><i style="background:#ff7b7b"></i>退款</span><span><i style="background:#ffd166"></i>付費人數</span></div>`;
  }
  function hours(hs) {
    if (!hs.some((x) => x.amount)) return '<div class="rp-empty">今天還沒有付款</div>';
    const W = 640, H = 150, pl = 40, pb = 22, pt = 8, iw = W - pl - 8, ih = H - pt - pb, max = Math.max(...hs.map((x) => x.amount)), bw = iw / 24 * 0.7;
    let s = ''; hs.forEach((x, i) => { const hh = ih * x.amount / max, X = pl + iw * i / 24; s += `<rect x="${X}" y="${pt + ih - hh}" width="${bw}" height="${hh}" rx="2" fill="#6cc4ff"><title>${i}:00 NT$${x.amount}（${x.n} 筆）</title></rect>`; if (i % 3 === 0) s += `<text x="${X + bw / 2}" y="${H - 6}" text-anchor="middle">${i}</text>`; });
    s += `<text x="${pl - 5}" y="${pt + 8}" text-anchor="end">${fmt(max)}</text>`;
    return `<svg class="rp-svg" viewBox="0 0 ${W} ${H}">${s}</svg>`;
  }
  const hbars = (rows, val, label, color, sub) => { if (!rows.length) return '<div class="rp-empty">尚無資料</div>'; const max = Math.max(1, ...rows.map(val)); return `<div class="rp-hb">${rows.map((r) => `<span class="t" title="${h(label(r))}">${h(label(r))}</span><span class="b"><i style="width:${Math.max(2, val(r) / max * 100)}%;background:${color}"></i></span><span class="v">${sub(r)}</span>`).join('')}</div>`; };
  function funnelHtml(steps, valKey = 'n', nameKey = 'step') {
    if (!steps.length || !steps[0][valKey]) return '<div class="rp-empty">這段期間沒有資料</div>';
    const top = steps[0][valKey]; let out = '<div class="rp-fn">';
    steps.forEach((s, i) => { const v = s[valKey]; if (i) { const p = steps[i - 1][valKey]; out += v <= p ? `<div class="drop">↓ 流失 ${p ? pct(1 - v / p) : '—'}</div>` : '<div class="drop" style="color:var(--muted)">↓（信用卡不需取號，可能直接付款）</div>'; } out += `<div class="s"><i style="width:${top ? v / top * 100 : 0}%"></i><span>${h(s[nameKey])}</span><span><b>${fmt(v)}</b>${s.extra ? ' ' + s.extra : ''} <small class="muted">${pct(top ? v / top : 0)}</small></span></div>`; });
    return out + '</div>';
  }
  async function report(main) {
    const S = Views.pay.rs || (Views.pay.rs = { range: 'today', from: '', to: '' });
    main.innerHTML = head('report') + `<div class="rp-ranges" id="rpR">${RANGES.map(([k, t]) => `<button data-r="${k}" class="${S.range === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="rp-custom" id="rpC" style="${S.range === 'custom' ? '' : 'display:none'}"><input type="date" id="rpF" value="${h(S.from)}"> ～ <input type="date" id="rpT" value="${h(S.to)}"><button class="btn" id="rpGo">套用</button></div><div id="rpB"><div class="loading">載入中…</div></div>`;
    main.querySelector('#rpR').onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; S.range = b.dataset.r; if (S.range === 'custom' && !S.from) { const t = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); S.from = S.to = t; } report(main); };
    const go = main.querySelector('#rpGo'); if (go) go.onclick = () => { S.from = main.querySelector('#rpF').value; S.to = main.querySelector('#rpT').value; report(main); };
    const qs = new URLSearchParams({ range: S.range }); if (S.range === 'custom') { qs.set('from', S.from); qs.set('to', S.to); }
    let d; try { d = await A.get('/pay/report?' + qs); } catch (e) { main.querySelector('#rpB').innerHTML = `<div class="errors">${h(e.message)}</div>`; return; }
    const K = d.kpi, P = d.prev, R = d.range;
    const k = (l, v, sub, cmp) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}${cmp || ''}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const F = d.funnel, fsteps = F.steps.map((s) => ({ ...s, extra: s.guests ? `<small class="muted">（訪客 ${s.guests}）</small>` : '' }));
    const G = d.gems, issued = [['購買', G.issued.purchased], ['首儲加送', G.issued.firstBonus], ['月卡（購買時）', G.issued.card], ['月卡每日 💎', G.issued.cardDaily], ['後台發放', G.issued.admin], ['其他', G.issued.other]].filter((x) => x[1]);
    main.querySelector('#rpB').innerHTML = `
      <p class="rp-note">${h(R.fromDay)}${R.toDay !== R.fromDay ? ' ～ ' + h(R.toDay) : ''}（台北時間，${R.days} 天）・比較 ${h(R.prev.fromDay)}${R.prev.toDay !== R.prev.fromDay ? ' ～ ' + h(R.prev.toDay) : ''}・<a href="/admin/api/pay/report.csv?${qs}" download>⬇️ 匯出 CSV</a></p>
      <div class="rp-k">
        ${k('營收（總額）', nt(K.gross), '', delta(K.gross, P.gross))}${k('退款', nt(K.refunds), '', delta(K.refunds, P.refunds, true))}${k('淨營收', nt(K.net), '', delta(K.net, P.net))}
        ${k('付費筆數', fmt(K.paidOrders), '', delta(K.paidOrders, P.paidOrders))}${k('付費人數', fmt(K.payers), `新付費 ${fmt(K.newPayers)}・回購 ${fmt(K.repeatPayers)}`, delta(K.payers, P.payers))}
        ${k('付費轉換率', pct(K.conversion), `活躍 ${fmt(K.active)} 人・會員轉換 ${pct(K.memberConversion)}（${fmt(K.members)} 會員）`, delta(K.conversion, P.conversion))}
        ${k('ARPU', nt(Math.round(K.arpu * 10) / 10), '淨營收／活躍玩家', delta(K.arpu, P.arpu))}${k('ARPPU', nt(Math.round(K.arppu)), '淨營收／付費玩家', delta(K.arppu, P.arppu))}
        ${k('平均客單價', nt(Math.round(K.avgOrder)), '', delta(K.avgOrder, P.avgOrder))}${k('待付款', fmt(K.pending), nt(K.pendingAmount) + '（目前）')}${k('過期未付', fmt(K.expiredUnpaid), `期間內建立 ${fmt(K.ordersCreated)} 筆`)}
      </div>
      ${d.excluded.demo.n || d.excluded.manual.n ? `<p class="rp-note">已排除：示範玩家 ${d.excluded.demo.n} 筆 ${nt(d.excluded.demo.amount)}・後台手動入帳 ${d.excluded.manual.n} 筆 ${nt(d.excluded.manual.amount)}（另列，不計入上方數字）</p>` : ''}
      <div class="rp-g"><div class="card"><h3>📊 每日營收與付費人數</h3>${barsLine(d.daily)}</div><div class="card"><h3>🕐 今日各時段（台北）</h3>${hours(d.hourly)}</div></div>
      <div class="rp-g"><div class="card"><h3>🧺 商品類別</h3>${hbars(d.byCategory, (r) => r.amount, (r) => r.name, '#ffd166', (r) => `${nt(r.amount)} <small class="muted">${r.n}筆</small>`)}<h3 style="margin-top:12px">📦 各方案</h3>${hbars(d.byProduct, (r) => r.amount, (r) => r.name, '#5ee6a8', (r) => `${nt(r.amount)} <small class="muted">${r.n}筆</small>`)}</div>
        <div class="card"><h3>💳 付款方式</h3>${hbars(d.byMethod, (r) => r.amount, (r) => r.name, '#6cc4ff', (r) => `${nt(r.amount)} <small class="muted">${r.n}筆</small>`)}<h3 style="margin-top:12px">🧾 訂單漏斗</h3>${funnelHtml(d.orderFunnel)}</div></div>
      <div class="rp-g"><div class="card"><h3>🛒 儲值漏斗（不重複玩家）</h3>${funnelHtml(fsteps, 'users', 'name')}
        <p class="rp-note">訪客被要求先註冊：${fmt(F.extra.registerBlock.u)} 人・💎 不足提示：顯示 ${fmt(F.extra.promptShow.u)} 人、點「前往儲值」${fmt(F.extra.promptClick.u)} 人</p>
        ${F.packs.length ? `<table class="rp-t"><tr><th>方案</th><th class="num">點選</th><th class="num">下單</th><th class="num">跳轉</th><th class="num">付款</th></tr>${F.packs.map((p) => `<tr><td>${h(p.pack)}</td><td class="num">${p.select || 0}</td><td class="num">${p.order || 0}</td><td class="num">${p.redirect || 0}</td><td class="num">${p.paid || 0}</td></tr>`).join('')}</table>` : ''}</div>
        <div class="card"><h3>👑 月卡</h3><div class="rp-k" style="margin:0">${k('有效月卡', fmt(d.card.active), 'MRR ' + nt(d.card.mrr))}${k('新購', fmt(d.card.new))}${k('續購', fmt(d.card.renewed))}${k('到期', fmt(d.card.expired))}${k('每日 💎 領取率', pct(d.card.claimRate), `${fmt(d.card.claims)}／${fmt(d.card.cardDays)} 卡日`)}</div></div></div>
      <div class="rp-g"><div class="card"><h3>💎 寶石發放（${fmt(G.issuedTotal)}）</h3>${hbars(issued, (r) => r[1], (r) => r[0], '#9fe8ff', (r) => '💎' + fmt(r[1]))}</div>
        <div class="card"><h3>💎 寶石消耗（${fmt(G.spentTotal)}）</h3>${hbars(G.sinks, (r) => r.gems, (r) => r.name, '#c79bff', (r) => '💎' + fmt(r.gems))}<p class="rp-note">目前流通 💎${fmt(G.outstanding)}（${fmt(G.holders)} 人持有）${G.clawback ? `・退款扣回 💎${fmt(G.clawback)}` : ''}</p></div></div>
      <div class="rp-g"><div class="card"><h3>🏆 付費前 20 名</h3>${d.top.length ? `<table class="rp-t"><tr><th>#</th><th>玩家</th><th class="num">淨額</th><th class="num">筆數</th></tr>${d.top.map((t, i) => `<tr><td>${i + 1}</td><td><a href="#player/${t.playerId}">${h(t.name || '玩家')} #${t.playerId}</a></td><td class="num">${nt(t.amount)}</td><td class="num">${t.n}</td></tr>`).join('')}</table>` : '<div class="rp-empty">這段期間沒有付費玩家</div>'}</div>
        <div class="card"><h3>🧾 最近訂單</h3>${d.recent.length ? `<table class="rp-t">${d.recent.map((o) => `<tr><td class="mini">${A.fmtTime(o.createdAt).slice(5)}</td><td><a href="#pay/orders/all" data-q="${h(o.id)}">${h(o.name)}</a></td><td class="num">${nt(o.amount)}</td><td>${stBadge(o)}</td></tr>`).join('')}</table>` : '<div class="rp-empty">這段期間沒有訂單</div>'}</div></div>
      <p class="rp-note">只計算真實玩家；示範玩家與後台手動入帳另列。營收以付款時間、退款以退款時間（台北）計算。</p>`;
    main.querySelector('#rpB').addEventListener('click', (e) => { const a = e.target.closest('[data-q]'); if (a) { (Views.pay.s4 || (Views.pay.s4 = { q: '' })).q = a.dataset.q; } });
  }
})();
