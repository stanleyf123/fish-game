// 💳 儲值（藍新 NewebPay／綠界 ECPay）：訂單、營收、補入帳／退款標記、儲值方案編輯
(function () {
  const { h } = A;
  const TYPE = (t) => (!t ? '—' : /^Credit|^CREDIT/.test(t) ? '信用卡' : /^ATM|^VACC|^WEBATM/.test(t) ? 'ATM' : /^CVS/.test(t) ? '超商代碼' : /^BARCODE/.test(t) ? '超商條碼' : t);
  const PROV = { newebpay: '藍新', ecpay: '綠界' };
  const grants = (g) => (g.vipDays ? `👑 月卡 ${g.vipDays} 天＋💎${A.fmtNum(g.gems || 0)}` : g.gems ? `💎${A.fmtNum(g.gems)}${g.bonusGems ? `＋${A.fmtNum(g.bonusGems)}` : g.firstDouble ? '（首儲雙倍）' : ''}` : g.coins ? `🪙${A.fmtNum(g.coins)}` : '');
  const day0 = (s) => (s ? new Date(s + 'T00:00:00+08:00').getTime() : 0);
  const tabs = (on) => `<div class="toolbar">${[['orders', '🧾 訂單'], ['stats', '📈 營收'], ['products', '🛠 儲值方案']].map(([k, t]) => `<button class="btn ${on === k ? 'primary' : 'ghost'}" data-ptab="${k}">${t}</button>`).join('')}</div>`;

  Views.pay = async function (main, params) {
    const tab = params[0] || 'orders';
    const head = (sub) => `<h1>💳 儲值</h1><p class="sub">${sub}</p>${tabs(tab)}`;
    main.onclick = (e) => { const b = e.target.closest('[data-ptab]'); if (b) location.hash = 'pay/' + b.dataset.ptab; };
    if (tab === 'stats') return stats(main, head);
    if (tab === 'products') return products(main, head);
    return orders(main, head);
  };

  async function modeBanner() {
    const d = await A.get('/pay/products'), n = d.newebpay || {}, P = d.pay.providers || {};
    const nw = n.ok ? `${n.mode === 'prod' ? '✅ 藍新正式商店' : '🧪 藍新測試商店'} ${h(n.merchant)}${P.newebpay && P.newebpay.enabled ? '' : '（後台已關閉）'}` : `⚠️ 藍新未設定：${h(n.problem || '')}`;
    const ec = d.ecpayOk ? `綠界 ${d.mode === 'prod' ? '正式' : '測試'}特店 ${h(d.merchant)}${P.ecpay && P.ecpay.enabled ? '' : '（後台已關閉）'}` : '綠界未設定';
    return `<div class="banner ${d.providers && d.providers.length ? 'info' : 'warn'}">${nw}・${ec}・玩家目前可用：${(d.providers || []).map((x) => PROV[x] || x).join('、') || '（無）'}</div>`;
  }

  async function orders(main, head) {
    const st = Views.pay.st || (Views.pay.st = { status: '', playerId: '', q: '', from: '', to: '', offset: 0 });
    main.innerHTML = head('儲值訂單（藍新／綠界）。付款結果以金流通知（驗章＋驗金額）自動入帳，每筆只入帳一次。') + (await modeBanner()) + `
      <div class="toolbar"><select id="status"><option value="">全部狀態</option>${Object.entries(A.statusName).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input id="pid" placeholder="玩家 ID" value="${h(st.playerId)}" style="width:90px"><input type="search" id="q" placeholder="訂單編號／綠界交易編號／信箱" value="${h(st.q)}">
      <label class="chk">從<input type="date" id="from" value="${h(st.from)}"></label><label class="chk">到<input type="date" id="to" value="${h(st.to)}"></label><button class="btn" id="go">篩選</button></div>
      <div class="card" id="tbl"><div class="loading">載入中…</div></div>`;
    async function load() {
      const q = { status: st.status, playerId: st.playerId, q: st.q, offset: st.offset, limit: 50 };
      if (st.from) q.from = day0(st.from); if (st.to) q.to = day0(st.to) + 86400000;
      const d = await A.get('/pay/orders?' + new URLSearchParams(q));
      main.querySelector('#tbl').innerHTML = `<table><tr><th>訂單編號</th><th>金流</th><th>玩家</th><th>方案</th><th class="num">金額</th><th>狀態</th><th>付款方式</th><th>建立</th><th>入帳</th></tr>
        ${d.orders.map((o) => `<tr class="click" data-id="${h(o.id)}"><td class="mono">${h(o.id)}</td><td>${h(PROV[o.provider] || o.provider || '')}</td><td>#${o.playerId} ${h(o.email || '')}</td><td>${grants(o.grants)}</td><td class="num">NT$${A.fmtNum(o.amount)}</td><td>${A.statusBadge(o.status)}${o.status === 'pending' && o.payInfo ? ' <span class="badge">已取號</span>' : ''}</td><td>${TYPE(o.paymentType)}</td><td class="nowrap mini">${A.fmtTime(o.createdAt)}</td><td class="nowrap mini">${A.fmtTime(o.creditedAt)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">沒有訂單</td></tr>'}</table>
        <div class="pager">共 ${A.fmtNum(d.total)} 筆　<button class="btn small" data-pg="-1" ${st.offset ? '' : 'disabled'}>上一頁</button><button class="btn small" data-pg="1" ${st.offset + 50 < d.total ? '' : 'disabled'}>下一頁</button></div>`;
    }
    main.querySelector('#go').onclick = () => { st.status = main.querySelector('#status').value; st.playerId = main.querySelector('#pid').value.replace('#', '').trim(); st.q = main.querySelector('#q').value.trim(); st.from = main.querySelector('#from').value; st.to = main.querySelector('#to').value; st.offset = 0; load(); };
    main.querySelector('#tbl').onclick = (e) => {
      const pg = e.target.closest('[data-pg]'); if (pg) { st.offset = Math.max(0, st.offset + Number(pg.dataset.pg) * 50); load(); return; }
      const tr = e.target.closest('tr[data-id]'); if (tr) detail(tr.dataset.id, load);
    };
    await load();
  }

  async function detail(id, reload) {
    const d = await A.get('/pay/orders/' + encodeURIComponent(id)); const o = d.order, i = o.payInfo;
    const b = A.openModal(`<h2>訂單 ${h(o.id)} ${A.statusBadge(o.status)}</h2><table>
      <tr><th>玩家</th><td><a href="#player/${o.playerId}">#${o.playerId}</a> ${h((d.player && (d.player.email || d.player.username)) || '')}</td></tr>
      <tr><th>方案</th><td>${h(o.productName)}（${h(o.sku)}）・${grants(o.grants)}</td></tr><tr><th>金額</th><td>NT$${A.fmtNum(o.amount)}（含稅）</td></tr>
      <tr><th>金流交易編號</th><td class="mono">${h(o.tradeNo || '—')}・${TYPE(o.paymentType)}</td></tr>
      ${i ? `<tr><th>繳費資訊</th><td class="mono mini">${h([i.bankCode && '銀行 ' + i.bankCode, i.vAccount && '帳號 ' + i.vAccount, i.paymentNo && '代碼 ' + i.paymentNo, (i.barcode || []).join(' '), i.expireDate && '期限 ' + i.expireDate].filter(Boolean).join('・'))}</td></tr>` : ''}
      <tr><th>時間</th><td class="mini">建立 ${A.fmtTime(o.createdAt)}・付款 ${A.fmtTime(o.paidAt)}・入帳 ${A.fmtTime(o.creditedAt)}・退款 ${A.fmtTime(o.refundedAt)}</td></tr>
      <tr><th>備註</th><td class="mini" style="word-break:break-all">${h(o.note || '')}</td></tr></table>
      <h3 style="margin-top:12px">綠界通知</h3><table>${d.events.map((ev) => `<tr><td class="mini nowrap">${A.fmtTime(ev.received_at)}</td><td>${h(ev.type)}</td><td class="mono mini" style="word-break:break-all">${h(ev.result || '')}</td></tr>`).join('') || '<tr><td class="muted">尚未收到</td></tr>'}</table>
      <h3 style="margin-top:12px">寶石帳本</h3><table>${d.ledger.map((l) => `<tr><td class="mini nowrap">${A.fmtTime(l.created_at)}</td><td>${h(l.reason)}</td><td class="num">${l.delta > 0 ? '+' : ''}${A.fmtNum(l.delta)}</td><td class="num muted">餘 ${A.fmtNum(l.balance_after)}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>
      <h3 style="margin-top:12px">操作紀錄</h3><table>${d.audit.map((a) => `<tr><td class="mini nowrap">${A.fmtTime(a.created_at || a.at)}</td><td>${h(a.actor || a.admin || '')}</td><td>${h(a.action)}</td><td class="mono mini" style="word-break:break-all">${h(a.detail || '')}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>
      <div class="btns" style="margin-top:12px">${!o.creditedAt && o.status !== 'refunded' ? '<button class="btn" id="credit">補入帳…</button>' : ''}${o.status === 'paid' ? '<button class="btn danger" id="refund">標記退款…</button>' : ''}<button class="btn ghost" data-close>關閉</button></div>
      <p class="muted mini">補入帳：僅在綠界後台確認已收款、但通知沒進來時使用（每筆只會入帳一次）。標記退款：信用卡退刷請先在綠界後台操作，這裡只扣回寶石／金幣並記錄。</p>`);
    const cr = b.querySelector('#credit');
    if (cr) cr.onclick = async () => { const txn = await A.promptDlg('補入帳', '綠界交易編號（TradeNo，請先在綠界後台確認已收款）', o.tradeNo || ''); if (txn == null) return; const reason = await A.promptDlg('補入帳', '原因（寫入操作紀錄）', '綠界已收款但未收到通知'); if (!reason) return; try { const r = await A.post(`/pay/orders/${o.id}/credit`, { tradeNo: txn, reason }); A.toast(`已入帳 ${r.gems ? '💎' + r.gems : ''}${r.coins ? '🪙' + r.coins : ''}`); reload && reload(); } catch (e) { A.errToast(e); } };
    const rf = b.querySelector('#refund');
    if (rf) rf.onclick = async () => { const reason = await A.promptDlg('標記退款', '退款原因（寫入訂單備註與操作紀錄；會扣回寶石與金幣）', '玩家申請退款', '確認退款', true); if (reason == null || !reason) return; try { const r = await A.post(`/pay/orders/${o.id}/refund`, { reason }); A.toast('已標記退款' + (r.notes && r.notes.length ? '：' + r.notes.join('；') : '')); reload && reload(); } catch (e) { A.errToast(e); } };
  }

  async function stats(main, head) {
    const st = Views.pay.ss || (Views.pay.ss = { days: 30 });
    const from = st.days ? Date.now() - st.days * 86400000 : 0;
    const d = await A.get('/pay/stats?from=' + from);
    const T = d.totals;
    main.innerHTML = head(`綠界儲值營收（含稅金額；${d.mode === 'prod' ? '正式' : '測試'}環境・特店 ${h(d.merchant)}）`) + `
      <div class="toolbar"><select id="days">${[[7, '最近 7 天'], [30, '最近 30 天'], [90, '最近 90 天'], [0, '全部']].map(([n, t]) => `<option value="${n}" ${n === st.days ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="kpis"><div class="kpi"><div class="l">淨營收</div><div class="v">NT$${A.fmtNum(T.net)}</div><div class="s">總額 ${A.fmtNum(T.gross)}・退款 ${A.fmtNum(T.refunds)}</div></div>
        <div class="kpi"><div class="l">已付款訂單</div><div class="v">${A.fmtNum(T.paidOrders)}</div><div class="s">共 ${A.fmtNum(T.orders)} 筆</div></div>
        <div class="kpi"><div class="l">付費人數</div><div class="v">${A.fmtNum(T.payers)}</div></div>
        <div class="kpi"><div class="l">待付款</div><div class="v">${A.fmtNum(T.pending)}</div><div class="s">未完成 ${A.fmtNum(T.failed)}</div></div></div>
      <div class="grid2"><div class="card"><h3>每日營收（NT$）</h3>${d.daily.length ? Charts.bars({ labels: d.daily.map((x) => x.day), series: [{ name: '營收', color: '#5ee6a8', values: d.daily.map((x) => x.net) }] }) : '<p class="muted">尚無資料</p>'}</div>
        <div class="card"><h3>方案</h3><table>${d.byProduct.map((p) => `<tr><td>${h(p.name)}</td><td class="num">${p.n} 筆</td><td class="num">NT$${A.fmtNum(p.amount)}</td></tr>`).join('') || '<tr><td class="muted">尚無</td></tr>'}</table>
        <h3 style="margin-top:10px">付款方式</h3><table>${d.byType.map((p) => `<tr><td>${TYPE(p.type)}</td><td class="num">${p.n} 筆</td><td class="num">NT$${A.fmtNum(p.amount)}</td></tr>`).join('') || '<tr><td class="muted">尚無</td></tr>'}</table></div></div>`;
    main.querySelector('#days').onchange = (e) => { st.days = Number(e.target.value); stats(main, head); };
  }

  async function products(main, head) {
    const d = await A.get('/pay/products');
    const pay = JSON.parse(JSON.stringify(d.pay));
    main.innerHTML = head('價格與數量只由伺服器決定（玩家端無法改價）。儲存後會建立新的遊戲設定版本，只修改「儲值」欄位，其他設定不變。') + (await modeBanner()) + `
      <div class="card"><div class="fields">
        <label class="chk"><input type="checkbox" id="en" ${pay.enabled ? 'checked' : ''}>開放儲值</label>
        <label class="chk"><input type="checkbox" id="fd" ${pay.firstPurchaseDouble ? 'checked' : ''}>寶石首儲雙倍（每個方案第一次購買）</label>
        <label class="f">ATM 繳費期限（天，1–60）<input type="number" id="atm" value="${pay.atmExpireDays}"></label>
        <label class="f">超商繳費期限（分鐘）<input type="number" id="cvs" value="${pay.cvsExpireMinutes}"></label></div>
        <div class="fields" style="margin-top:8px">
        <label class="chk"><input type="checkbox" id="pvN" ${pay.providers.newebpay.enabled ? 'checked' : ''}>藍新金流 NewebPay</label>
        <label class="chk"><input type="checkbox" id="pvE" ${pay.providers.ecpay.enabled ? 'checked' : ''}>綠界 ECPay</label>
        ${['CREDIT', 'VACC', 'CVS', 'WEBATM'].map((m) => `<label class="chk"><input type="checkbox" data-nm="${m}" ${pay.providers.newebpay.methods[m] ? 'checked' : ''}>藍新 ${{ CREDIT: '信用卡', VACC: 'ATM 轉帳', CVS: '超商代碼', WEBATM: '網路 ATM' }[m]}</label>`).join('')}</div>
        <p class="muted mini">兩家都開時玩家自己選；藍新付款方式請依商店審核通過的項目勾選。</p>
        <div class="fields" style="margin-top:8px"><label class="chk"><input type="checkbox" id="cdEn" ${pay.card.enabled !== false ? 'checked' : ''}>👑 月卡上架</label>
        <label class="f">月卡價格 NT$<input type="number" id="cdP" value="${pay.card.priceTwd}"></label><label class="f">立即 💎<input type="number" id="cdG" value="${pay.card.gems}"></label>
        <label class="f">每天可領 💎<input type="number" id="cdD" value="${pay.card.dailyGems}"></label><label class="f">天數<input type="number" id="cdN" value="${pay.card.days}"></label>
        <label class="f">每天多幾次繁殖<input type="number" id="cdB" value="${pay.card.extraBreeds}"></label></div>
        <label class="f" style="margin-top:8px">客服聯絡（顯示在購買須知）<input id="sup" maxlength="200" value="${h(pay.support || '')}"></label></div>
      <div class="card"><table id="pt"><tr><th>排序</th><th>ID</th><th>類型</th><th class="num">價格 NT$（含稅）</th><th class="num">數量</th><th>標籤</th><th>上架</th></tr>
        ${pay.products.map((p, i) => `<tr data-i="${i}"><td><input type="number" data-k="sort" value="${p.sort || 0}" style="width:60px"></td><td class="mono">${h(p.id)}</td><td>${p.kind === 'gems' ? '💎 寶石' : '🪙 金幣'}</td><td class="num"><input type="number" data-k="priceTwd" value="${p.priceTwd}" style="width:90px"></td><td class="num"><input type="number" data-k="qty" value="${p.qty}" style="width:100px"></td><td><input data-k="badge" maxlength="12" value="${h(p.badge || '')}" style="width:80px" placeholder="例：熱賣"></td><td><input type="checkbox" data-k="enabled" ${p.enabled !== false ? 'checked' : ''}></td></tr>`).join('')}</table>
        <div class="btns" style="margin-top:12px"><button class="btn primary" id="save">儲存並發布（設定 v${d.version} → 新版本）</button></div>
        <p class="muted mini">${d.stored ? '目前使用遊戲設定裡的儲值方案。' : '目前使用伺服器預設方案（尚未在設定中儲存過）。'}已付款的訂單不受改價影響。</p></div>`;
    main.querySelector('#save').onclick = async () => {
      pay.providers.newebpay.enabled = main.querySelector('#pvN').checked; pay.providers.ecpay.enabled = main.querySelector('#pvE').checked;
      main.querySelectorAll('[data-nm]').forEach((x) => { pay.providers.newebpay.methods[x.dataset.nm] = x.checked; });
      Object.assign(pay.card, { enabled: main.querySelector('#cdEn').checked, priceTwd: Number(main.querySelector('#cdP').value), gems: Number(main.querySelector('#cdG').value), dailyGems: Number(main.querySelector('#cdD').value), days: Number(main.querySelector('#cdN').value), extraBreeds: Number(main.querySelector('#cdB').value) });
      pay.enabled = main.querySelector('#en').checked; pay.firstPurchaseDouble = main.querySelector('#fd').checked;
      pay.atmExpireDays = Number(main.querySelector('#atm').value); pay.cvsExpireMinutes = Number(main.querySelector('#cvs').value); pay.support = main.querySelector('#sup').value.trim();
      main.querySelectorAll('#pt tr[data-i]').forEach((tr) => { const p = pay.products[Number(tr.dataset.i)]; tr.querySelectorAll('[data-k]').forEach((inp) => { const k = inp.dataset.k; p[k] = inp.type === 'checkbox' ? inp.checked : k === 'badge' ? inp.value.trim() : Number(inp.value); }); if (!p.badge) delete p.badge; });
      if (!await A.confirmDlg('發布儲值方案', '確定要發布新的儲值方案？玩家重新整理商店後生效。', '發布')) return;
      try { const r = await A.put('/pay/products', { pay, baseVersion: d.version, note: '後台編輯儲值方案' }); A.toast('已發布設定 v' + r.version); products(main, head); } catch (e) { A.errToast(e); }
    };
  }
})();
