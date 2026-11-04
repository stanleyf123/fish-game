// 付費 / 會員：營收、商品、訂單、月卡會員
(function () {
  const { h } = A;
  const typeName = { gems: '寶石包', vip: '月卡／VIP', item: '道具', bundle: '禮包' };
  const ENT = { no_ads: '去廣告', starter: '新手禮包標記' };

  Views.revenue = async function (main) {
    const st = Views.revenue.st || (Views.revenue.st = { days: 30, excludeDemo: false });
    const d = await A.get(`/revenue?days=${st.days}&excludeDemo=${st.excludeDemo ? 1 : 0}`);
    const T = d.totals;
    main.innerHTML = `<h1>💰 營收</h1><p class="sub">只計算新台幣訂單（不含後台手動發放、寶石購買）。<select id="days">${[7, 30, 90, 180, 365].map((n) => `<option value="${n}" ${n === st.days ? 'selected' : ''}>最近 ${n} 天</option>`).join('')}</select>
      <label class="chk" style="display:inline-flex"><input type="checkbox" id="exd" ${st.excludeDemo ? 'checked' : ''}>排除示範資料</label></p>
      <div class="banner info">💡 目前尚未串接真實金流：資料來自「模擬金流」與示範資料。正式上線需完成綠界／Stripe 特店申請與金鑰設定（見 README）。</div>
      <div class="kpis">
        <div class="kpi"><div class="l">淨營收</div><div class="v">NT$${A.fmtNum(T.net)}</div><div class="s">總額 ${A.fmtNum(T.gross)}・退款 ${A.fmtNum(T.refunds)}</div></div>
        <div class="kpi"><div class="l">付費人數</div><div class="v">${A.fmtNum(T.payingUsers)}</div><div class="s">${A.fmtNum(T.orders)} 筆訂單</div></div>
        <div class="kpi"><div class="l">ARPPU</div><div class="v">NT$${A.fmtNum(T.arppu)}</div><div class="s">每付費用戶平均</div></div>
        <div class="kpi"><div class="l">ARPU</div><div class="v">NT$${T.arpu}</div><div class="s">活躍 ${A.fmtNum(T.activeUsers)} 人</div></div>
        <div class="kpi"><div class="l">付費轉換率</div><div class="v">${T.conversion}%</div><div class="s">付費 ÷ 期間活躍</div></div>
        <div class="kpi"><div class="l">月卡會員（有效）</div><div class="v">${A.fmtNum(T.vipActive)}</div></div>
        <div class="kpi"><div class="l">流通寶石</div><div class="v">${A.fmtNum(T.gemsOutstanding)}</div><div class="s">未消耗的預付價值</div></div>
      </div>
      <div class="grid2"><div class="card"><h3>每日營收（NT$）</h3>${Charts.bars({ labels: d.daily.map((x) => x.day), series: [{ name: '淨營收', color: '#5ee6a8', values: d.daily.map((x) => x.net) }, { name: '退款', color: '#ff7eb6', values: d.daily.map((x) => x.refunds) }] })}</div>
        <div class="card"><h3>每日訂單數</h3>${Charts.line({ labels: d.daily.map((x) => x.day), series: [{ name: '', color: '#6cc4ff', values: d.daily.map((x) => x.orders), fill: true }] })}</div>
        <div class="card"><h3>熱銷商品</h3>${Charts.hbars(d.topProducts.map((p) => ({ label: p.name, value: p.amount })), { valueFmt: (v) => 'NT$' + A.fmtNum(v) })}</div>
        <div class="card"><h3>訂單狀態</h3><table>${d.statusCounts.map((s) => `<tr><td>${A.statusBadge(s.status)}</td><td class="num">${A.fmtNum(s.n)}</td></tr>`).join('') || '<tr><td class="muted">尚無訂單</td></tr>'}</table></div></div>`;
    main.querySelector('#days').onchange = (e) => { st.days = Number(e.target.value); Views.revenue(main); };
    main.querySelector('#exd').onchange = (e) => { st.excludeDemo = e.target.checked; Views.revenue(main); };
  };

  function grantsSummary(g, meta) {
    const p = [];
    if (g.gems) p.push(`💎${g.gems}${g.bonusGems ? `+${g.bonusGems}` : ''}`); else if (g.bonusGems) p.push(`💎+${g.bonusGems}`);
    if (g.vipDays) p.push(`👑 ${g.vipDays} 天（收益+${Math.round((g.vipPerks?.coinBonus || 0) * 100)}%、每日💎${g.vipPerks?.dailyGems || 0}）`);
    if (g.coins) p.push(`🪙${A.fmtNum(g.coins)}`);
    for (const f of g.fish || []) p.push(`🐟${h((meta.species.find((s) => s.key === f.species) || { name: f.species }).name)}×${f.count}`);
    for (const d of g.decorations || []) { const x = meta.decorations.find((y) => y.key === d); p.push(x ? x.icon + h(x.name) : h(d)); }
    for (const e of g.entitlements || []) p.push(ENT[e] || e);
    return p.join('、');
  }

  Views.products = async function (main) {
    const [d, meta] = await Promise.all([A.get('/products'), A.loadMeta(true)]);
    main.innerHTML = `<h1>🛒 商品與價格</h1><p class="sub">寶石包、月卡、道具、禮包。可同時設定新台幣價（走金流）或寶石價（扣伺服器寶石帳本）。遊戲透過 <span class="mono">GET /api/shop/products</span> 取得上架商品。</p>
      <div class="row"><div class="grow"><div class="card"><table><tr><th>排序</th><th>SKU / 名稱</th><th>類型</th><th class="num">價格</th><th>內容</th><th>限購</th><th>狀態</th><th></th></tr>
      ${d.products.map((p) => `<tr><td>${p.sort}</td><td><b>${h(p.name)}</b><div class="mono muted mini">${h(p.sku)}</div></td><td>${typeName[p.type]}</td><td class="num nowrap">${p.priceTwd != null ? 'NT$' + p.priceTwd : ''}${p.priceTwd != null && p.priceGems != null ? '<br>' : ''}${p.priceGems != null ? '💎' + p.priceGems : ''}</td><td class="mini">${grantsSummary(p.grants, meta)}</td><td>${p.limitPerPlayer || '—'}</td><td>${p.active ? '<span class="badge b-ok">上架</span>' : '<span class="badge b-off">下架</span>'}</td><td><button class="btn small" data-edit="${p.id}">編輯</button></td></tr>`).join('')}</table></div></div>
      <div style="width:420px"><div class="card" id="pf"></div></div></div>`;
    function form(p) {
      p = p || { sku: '', type: 'gems', name: '', description: '', priceTwd: '', priceGems: '', limitPerPlayer: '', sort: 0, active: true, grants: {} };
      const g = p.grants || {}; const pk = g.vipPerks || {};
      const box = main.querySelector('#pf');
      box.innerHTML = `<h2>${p.id ? '編輯商品' : '新增商品'}</h2><div class="fields">
        <label class="f">SKU<input id="sku" value="${h(p.sku)}" placeholder="gems_60"></label>
        <label class="f">類型<select id="type">${Object.entries(typeName).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">名稱<input id="name" value="${h(p.name)}"></label>
        <label class="f">新台幣價格<input type="number" id="priceTwd" value="${p.priceTwd ?? ''}"></label>
        <label class="f">寶石價格<input type="number" id="priceGems" value="${p.priceGems ?? ''}"></label>
        <label class="f">每人限購<input type="number" id="limit" value="${p.limitPerPlayer ?? ''}" placeholder="空白＝不限"></label>
        <label class="f">排序<input type="number" id="sort" value="${p.sort}"></label></div>
        <label class="f" style="margin-top:8px">說明<input id="desc" value="${h(p.description)}"></label>
        <h3 style="margin-top:12px">購買後獲得</h3><div class="fields">
        <label class="f">寶石<input type="number" id="gGems" value="${g.gems || ''}"></label><label class="f">加贈寶石<input type="number" id="gBonus" value="${g.bonusGems || ''}"></label>
        <label class="f">金幣（信箱）<input type="number" id="gCoins" value="${g.coins || ''}"></label><label class="f">月卡天數<input type="number" id="gVip" value="${g.vipDays || ''}"></label>
        <label class="f">月卡：金幣收益加成<input type="number" step="0.01" id="pkCoin" value="${pk.coinBonus ?? ''}" placeholder="0.1 = +10%"></label><label class="f">月卡：每日寶石<input type="number" id="pkDaily" value="${pk.dailyGems ?? ''}"></label>
        <label class="f">月卡：離線上限 +秒<input type="number" id="pkOff" value="${pk.offlineCapBonusSec ?? ''}"></label></div>
        <label class="f" style="margin-top:8px">魚（信箱，格式 koi:1, angel:2）<input id="gFish" value="${h((g.fish || []).map((f) => f.species + ':' + f.count).join(', '))}"></label>
        <div class="btns" style="margin-top:8px">${meta.decorations.map((x) => `<label class="chk"><input type="checkbox" class="gDeco" value="${h(x.key)}" ${(g.decorations || []).includes(x.key) ? 'checked' : ''}>${h(x.icon + x.name)}</label>`).join('')}</div>
        <div class="btns" style="margin-top:8px">${Object.entries(ENT).map(([k, v]) => `<label class="chk"><input type="checkbox" class="gEnt" value="${k}" ${(g.entitlements || []).includes(k) ? 'checked' : ''}>${v}</label>`).join('')}</div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="active" ${p.active ? 'checked' : ''}>上架</label>
        <div class="btns" style="margin-top:12px"><button class="btn primary" id="psave">${p.id ? '儲存' : '建立'}</button>${p.id ? '<button class="btn ghost" id="pnew">改為新增</button>' : ''}</div><p class="muted mini">金幣／魚／裝飾會寄到玩家信箱，由玩家領取時寫入存檔；寶石與月卡立即生效。</p>`;
      const v = (id) => box.querySelector('#' + id).value;
      box.querySelector('#psave').onclick = async () => {
        const body = { sku: v('sku').trim(), type: v('type'), name: v('name'), description: v('desc'), priceTwd: v('priceTwd'), priceGems: v('priceGems'), limitPerPlayer: v('limit'), sort: v('sort'), active: box.querySelector('#active').checked,
          grants: { gems: v('gGems'), bonusGems: v('gBonus'), coins: v('gCoins'), vipDays: v('gVip'), vipPerks: { coinBonus: v('pkCoin'), dailyGems: v('pkDaily'), offlineCapBonusSec: v('pkOff') },
            fish: v('gFish').split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => { const [species, c] = s.split(':'); return { species: species.trim(), count: Number(c) || 1 }; }),
            decorations: [...box.querySelectorAll('.gDeco:checked')].map((c) => c.value), entitlements: [...box.querySelectorAll('.gEnt:checked')].map((c) => c.value) } };
        try { if (p.id) await A.put('/products/' + p.id, body); else await A.post('/products', body); A.toast('已儲存'); Views.products(main); } catch (e) { A.errToast(e); }
      };
      const nb = box.querySelector('#pnew'); if (nb) nb.onclick = () => form(null);
    }
    form(null);
    main.querySelector('.grow').onclick = (e) => { const b = e.target.closest('[data-edit]'); if (b) form(d.products.find((p) => p.id === Number(b.dataset.edit))); };
  };

  Views.orders = async function (main) {
    const st = Views.orders.st || (Views.orders.st = { status: '', provider: '', playerId: '', q: '', offset: 0, excludeDemo: false });
    const meta = await A.loadMeta(true);
    main.innerHTML = `<h1>🧾 訂單</h1><p class="sub">所有現金、寶石與後台發放的訂單。退款會扣回寶石（可能變負數）、撤銷月卡／權益、撤回尚未領取的信箱內容；真實金流的退刷需另外在金流後台操作。</p>
      <div class="toolbar"><select id="status"><option value="">全部狀態</option>${Object.entries(A.statusName).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="provider"><option value="">全部金流</option>${['mock', 'ecpay', 'stripe', 'gems', 'admin'].map((p) => `<option ${st.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <input id="pid" placeholder="玩家 ID" value="${h(st.playerId)}" style="width:100px"><input type="search" id="q" placeholder="訂單編號 / 金流交易編號" value="${h(st.q)}">
      <label class="chk"><input type="checkbox" id="exd" ${st.excludeDemo ? 'checked' : ''}>排除示範</label><button class="btn" id="go">篩選</button><span style="flex:1"></span><button class="btn primary" id="grant">手動發放…</button></div>
      <div class="card" id="tbl"><div class="loading">載入中…</div></div>`;
    async function load() {
      const d = await A.get('/orders?' + new URLSearchParams({ status: st.status, provider: st.provider, playerId: st.playerId, q: st.q, offset: st.offset, limit: 50, excludeDemo: st.excludeDemo ? 1 : 0 }));
      main.querySelector('#tbl').innerHTML = `<table><tr><th>訂單編號</th><th>玩家</th><th>商品</th><th class="num">金額</th><th>狀態</th><th>金流</th><th>建立</th><th>付款</th></tr>
        ${d.orders.map((o) => `<tr class="click" data-id="${h(o.id)}"><td class="mono">${h(o.id)}</td><td>#${o.playerId} ${h(o.username || '')} ${o.isDemo ? '<span class="badge b-demo">示範</span>' : ''}</td><td>${h(o.productName)}</td><td class="num nowrap">${o.currency === 'GEM' ? '💎' : 'NT$'}${A.fmtNum(o.amount)}</td><td>${A.statusBadge(o.status)}</td><td>${h(o.provider)}</td><td class="nowrap mini">${A.fmtTime(o.createdAt)}</td><td class="nowrap mini">${A.fmtTime(o.paidAt)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">沒有訂單</td></tr>'}</table>
        <div class="pager">共 ${A.fmtNum(d.total)} 筆　<button class="btn small" data-pg="-1" ${st.offset ? '' : 'disabled'}>上一頁</button><button class="btn small" data-pg="1" ${st.offset + 50 < d.total ? '' : 'disabled'}>下一頁</button></div>`;
    }
    const go = () => { st.status = main.querySelector('#status').value; st.provider = main.querySelector('#provider').value; st.playerId = main.querySelector('#pid').value.replace('#', '').trim(); st.q = main.querySelector('#q').value.trim(); st.excludeDemo = main.querySelector('#exd').checked; st.offset = 0; load(); };
    main.querySelector('#go').onclick = go;
    main.querySelector('#grant').onclick = () => {
      const b = A.openModal(`<h2>手動發放商品</h2><p class="muted">建立 provider=admin、金額 0 的已付款訂單並立即發貨（例如客服補償、活動獎品）。</p><div class="fields"><label class="f">玩家 ID<input id="gp"></label><label class="f">商品<select id="gs">${meta.products.map((p) => `<option value="${h(p.sku)}">${h(p.name)}</option>`).join('')}</select></label></div><label class="f" style="margin-top:8px">備註<input id="gn" value="客服補償"></label><div class="btns" style="margin-top:12px"><button class="btn primary" id="gok">發放</button><button class="btn ghost" data-close>取消</button></div>`);
      b.querySelector('#gok').onclick = async () => { try { await A.post(`/players/${Number(b.querySelector('#gp').value.replace('#', ''))}/grant-product`, { sku: b.querySelector('#gs').value, note: b.querySelector('#gn').value }); A.closeModal(); A.toast('已發放'); load(); } catch (e) { A.errToast(e); } };
    };
    main.querySelector('#tbl').onclick = async (e) => {
      const pg = e.target.closest('[data-pg]'); if (pg) { st.offset = Math.max(0, st.offset + Number(pg.dataset.pg) * 50); load(); return; }
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const d = await A.get('/orders/' + tr.dataset.id); const o = d.order;
      const b = A.openModal(`<h2>訂單 ${h(o.id)} ${A.statusBadge(o.status)}</h2><table>
        <tr><th>玩家</th><td><a href="#player/${o.playerId}">#${o.playerId}</a></td></tr><tr><th>商品</th><td>${h(o.productName)}（${h(o.sku)}）</td></tr>
        <tr><th>金額</th><td>${o.currency === 'GEM' ? '💎' : 'NT$'}${A.fmtNum(o.amount)} ${h(o.currency)}</td></tr><tr><th>金流 / 交易編號</th><td>${h(o.provider)} / <span class="mono">${h(o.providerTxnId || '—')}</span></td></tr>
        <tr><th>內容</th><td>${grantsSummary(o.grants, meta)}</td></tr><tr><th>時間</th><td>建立 ${A.fmtTime(o.createdAt)}・付款 ${A.fmtTime(o.paidAt)}・退款 ${A.fmtTime(o.refundedAt)}</td></tr><tr><th>備註</th><td class="mini mono" style="word-break:break-all">${h(o.note || '')}</td></tr></table>
        <h3 style="margin-top:12px">金流通知（webhook）</h3><table>${d.paymentEvents.map((ev) => `<tr><td class="mini">${A.fmtTime(ev.received_at)}</td><td class="mono mini">${h(ev.event_id)}</td><td>${h(ev.type)}</td><td class="mono mini">${h(ev.result || '')}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>
        <div class="btns" style="margin-top:12px">${o.status === 'paid' ? '<button class="btn danger" id="refund">退款…</button>' : ''}${o.status === 'pending' ? '<button class="btn" id="markpaid">人工確認已付款…</button>' : ''}</div>`);
      const rf = b.querySelector('#refund');
      if (rf) rf.onclick = async () => { const reason = await A.promptDlg('退款', '退款原因（寫入訂單備註與操作紀錄）', '玩家申請退款', '確認退款', true); if (reason == null) return; try { const r = await A.post(`/orders/${o.id}/refund`, { reason }); A.toast('已退款' + (r.notes.length ? '：' + r.notes.join('；') : '')); load(); } catch (err) { A.errToast(err); } };
      const mp = b.querySelector('#markpaid');
      if (mp) mp.onclick = async () => { const txn = await A.promptDlg('人工確認付款', '請先在金流後台確認已收款，再輸入金流交易編號', ''); if (txn == null) return; try { await A.post(`/orders/${o.id}/mark-paid`, { providerTxnId: txn }); A.toast('已標記付款並發貨'); load(); } catch (err) { A.errToast(err); } };
    };
    await load();
  };

  Views.members = async function (main) {
    const all = Views.members.all || false;
    const d = await A.get('/memberships' + (all ? '?all=1' : ''));
    main.innerHTML = `<h1>👑 月卡會員</h1><p class="sub">月卡可疊加：續購時從目前到期日往後延長。</p><div class="toolbar"><label class="chk"><input type="checkbox" id="all" ${all ? 'checked' : ''}>包含已過期</label></div>
      <div class="card"><table><tr><th>玩家</th><th>狀態</th><th>首次開通</th><th>到期</th><th class="num">購買張數</th></tr>
      ${d.memberships.map((m) => `<tr class="click" data-id="${m.playerId}"><td>#${m.playerId} ${h(m.username || m.nickname || '')} ${m.isDemo ? '<span class="badge b-demo">示範</span>' : ''}</td><td>${m.active ? '<span class="badge b-vip">有效</span>' : '<span class="badge b-off">已過期</span>'}</td><td class="nowrap">${A.fmtTime(m.since)}</td><td class="nowrap">${A.fmtTime(m.expiresAt)}（${m.active ? '剩 ' + Math.ceil((m.expiresAt - Date.now()) / 86400000) + ' 天' : A.ago(m.expiresAt)}）</td><td class="num">${m.cards}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">目前沒有會員</td></tr>'}</table></div>`;
    main.querySelector('#all').onchange = (e) => { Views.members.all = e.target.checked; Views.members(main); };
    main.querySelector('.card').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'player/' + tr.dataset.id; };
  };
})();
