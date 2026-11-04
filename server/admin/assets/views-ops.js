// 儀表板 / 玩家 / 公告 / 獎勵 / 操作紀錄
(function () {
  const { h } = A;
  const C = { blue: '#6cc4ff', gold: '#ffd166', pink: '#ff7eb6', green: '#5ee6a8', purple: '#c79bff' };

  Views.dashboard = async function (main) {
    let days = 30;
    async function render() {
      const d = await A.get('/dashboard?days=' + days);
      const T = d.totals;
      const labels = d.dau.map((x) => x.day);
      main.innerHTML = `<div class="dashboard-heading"><div><span class="dashboard-eyebrow">FEEDFISHS · 管理中心</span><h1>營運工作台</h1></div><button class="btn small" id="reload" aria-label="重新整理營運資料">↻ 更新</button></div><section id="dashboardOverview" data-overview-empty aria-label="營運總覽"><p class="muted">正在讀取收入與玩家數據…</p></section><nav class="overview-shortcuts" aria-label="營運快捷入口"><a href="#payreport"><b>📈</b>收入報表</a><a href="#paid-products"><b>💎</b>商品統計</a><a href="#support"><b>💬</b>客服訊息</a><a href="#share-task"><b>📣</b>分享審核</a></nav><details id="dashboardActivity" class="dashboard-fold"><summary>通知與訂單待辦 <small data-overview-notices>讀取中</small></summary></details><details class="dashboard-fold"><summary>常用管理功能</summary>
      <section class="task-hub" aria-label="常用工作"><div class="task-heading"><h2>今天要處理什麼？</h2><span class="muted">依工作選入口，避免在多個頁面找功能</span></div><div class="task-grid">
        <a href="#players"><b>👥 找玩家</b><span>查信箱、暱稱、金幣與遊玩紀錄</span></a>
        <a href="#support"><b>💬 處理客服</b><span>查看未讀、回覆問題與結案</span></a>
        <a href="#pay"><b>💳 查儲值訂單</b><span>審核付款、查帳與追蹤入帳</span></a>
        <a href="#payreport"><b>📈 看營收</b><span>依日期分析收入與儲值成效</span></a>
        <a href="#paid-products"><b>📊 付費商品統計</b><span>各商品銷量、購買人數與鑽石消耗</span></a>
        <a href="#species"><b>🐟 管理魚種</b><span>查魚種、價格與能力設定</span></a>
        <a href="#config"><b>⚙️ 調整遊戲</b><span>編輯規則、驗證與管理版本</span></a>
      </div></section></details>
      <details class="dashboard-fold" id="dashboardDetails"><summary>玩家與營運詳細數據</summary><div class="sub dashboard-period"><span>更新 ${A.fmtTime(d.generatedAt)} · 台灣時間</span><select id="days" aria-label="統計期間">${[7, 14, 30, 60, 90].map((n) => `<option value="${n}" ${n === days ? 'selected' : ''}>最近 ${n} 天</option>`).join('')}</select></div>
      ${T.demoPlayers ? `<div class="banner">⚠️ 目前資料庫含 <b>${A.fmtNum(T.demoPlayers)}</b> 位「示範玩家」（假資料，is_demo=1，用於畫面展示）。上線前請執行 <span class="mono">npm run demo:clear</span> 清除。</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="l">總玩家數</div><div class="v">${A.fmtNum(T.totalPlayers)}</div><div class="s">註冊會員 ${A.fmtNum(T.boundPlayers)}・訪客 ${A.fmtNum(T.totalPlayers - T.boundPlayers)}</div></div>
        <div class="kpi"><div class="l">目前在線</div><div class="v">${A.fmtNum(T.onlineNow)}</div><div class="s">90 秒內有心跳</div></div>
        <div class="kpi"><div class="l">今日活躍 DAU</div><div class="v">${A.fmtNum(T.dauToday)}</div><div class="s">${h(d.today)}</div></div>
        <div class="kpi"><div class="l">週活躍 WAU</div><div class="v">${A.fmtNum(T.wau)}</div><div class="s">月活躍 ${A.fmtNum(T.mau)}</div></div>
        <div class="kpi"><div class="l">平均遊玩時長</div><div class="v">${T.avgSessionMin}<small> 分</small></div><div class="s">近 7 天 ${A.fmtNum(T.sessions7d)} 場</div></div>
        <div class="kpi"><div class="l">流通金幣總量</div><div class="v">${A.fmtNum(T.coinsTotal)}</div><div class="s">平均 ${A.fmtNum(T.coinsAvg)}／最高 ${A.fmtNum(T.coinsMax)}</div></div>
        <div class="kpi"><div class="l">可疑 / 停權</div><div class="v">${A.fmtNum(T.flagged)} / ${A.fmtNum(T.banned)}</div><div class="s">防作弊標記 / 停權帳號</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h3>每日活躍玩家（DAU）與新玩家</h3>${Charts.line({ labels, series: [{ name: 'DAU', color: C.blue, values: d.dau.map((x) => x.value), fill: true }, { name: '新玩家', color: C.gold, values: d.newPlayers.map((x) => x.value) }] })}</div>
        <div class="card"><h3>金幣經濟（每日）</h3>${Charts.bars({ labels, stacked: false, series: [{ name: '賺取', color: C.green, values: d.economy.map((x) => x.earned) }, { name: '花費', color: C.pink, values: d.economy.map((x) => x.spent) }, { name: '後台發放', color: C.gold, values: d.economy.map((x) => x.granted) }] })}</div>
        <div class="card"><h3>平均單次遊玩時長（分鐘）</h3>${Charts.line({ labels, series: [{ name: '', color: C.purple, values: d.sessionSeries.map((x) => x.value), fill: true }] })}</div>
        <div class="card"><h3>玩家金幣分布</h3>${Charts.hbars(d.coinBuckets.map((b) => ({ label: b.label, value: b.value })), { valueFmt: (v) => v + ' 人' })}</div>
        <div class="card"><h3>魚種持有量（前 12 名）</h3>${Charts.hbars(d.ownership.slice(0,12).map((o) => ({ label: o.name, value: o.owned, cls: 'r' + o.rarity })), { valueFmt: (v) => A.fmtNum(v) + ' 條' })}</div>
        <div class="card"><h3>圖鑑解鎖率（前 12 名）</h3>${Charts.hbars(d.discovered.slice(0,12).map((o) => ({ label: o.name, value: o.pct, cls: 'r' + o.rarity })), { valueFmt: (v) => v + '%' })}</div>
        <div class="card"><h3>近 7 天事件類型</h3><table>${d.topEvents.map((e) => `<tr><td class="mono">${h(e.type)}</td><td class="num">${A.fmtNum(e.n)}</td></tr>`).join('') || '<tr><td class="muted">尚無事件</td></tr>'}</table></div>
      </div></details>`;
      main.querySelector('#days').onchange = (e) => { days = Number(e.target.value); render(); };
      main.querySelector('#reload').onclick = render;
    }
    await render();
  };

  // ---------- 玩家列表 ----------
  /*V406*/ const pj = (x) => { try { return typeof x === 'string' ? JSON.parse(x) : x || {}; } catch (e) { return {}; } };
  const flagWhy = (p) => { const d = pj(p.flag_last); return (d.reasons || [])[0] || ''; };
  const short = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);
  // ⏱️ 遊玩時間格式 /*V406P*/
  const pt = (ms) => { ms = Number(ms) || 0; if (!ms) return '—'; if (ms < 60000) return '<1 分'; const m = Math.round(ms / 60000); return m < 60 ? m + ' 分' : Math.floor(m / 60) + ' 時 ' + (m % 60) + ' 分'; };
  const EVN = { 'c:buy_fish': '買魚', 'c:buy_premium': '買限定魚', 'c:sell_fish': '賣魚', 'c:breed': '繁殖', 'c:xbreed': '混種繁殖', 'c:evolve': '進化', 'c:fish_died': '魚死亡', 'c:water_change': '換水', 'c:siphon': '吸底', 'c:bacteria': '硝化菌', 'c:use_med': '用藥', 'c:buy_med': '買藥', 'c:plant': '種水草', 'c:upgrade': '升級', 'c:buy_gear': '買設備', 'c:buy_deco': '買裝飾', 'c:buy_item': '寶石商品', 'c:visit': '拜訪漁港', 'c:help_feed': '幫忙餵食', 'social_help': '漁港幫忙', 'social_breed': '漁港借魚繁殖', 'med_cooldown_reject': '草本藥冷卻中', 'gems_spent': '花寶石', 'order_paid': '付款入帳', 'order_created': '建立訂單', 'breed_use': '使用繁殖次數', 'anticheat_reject': '可疑・拒絕', 'anticheat_flag': '可疑・標記', 'breed_limit_reject': '超過繁殖次數', 'client_outdated': '舊版網頁', 'flags_cleared': '清除可疑', 'account_created': '建立帳號', 'account_bound': '註冊會員', 'login': '登入', 'c:login': '登入（遊戲）', 'c:register': '註冊（遊戲）', 'reward_claimed': '領取獎勵', 'hero_battle': '英雄魚對戰', 'hero_pick': '選英雄魚', 'admin_save_edit': '後台改存檔', 'save_reset_by_player': '玩家重置' };
  const evName = (t) => EVN[t] ? `${EVN[t]}（${t}）` : t;
  function playCard(st) {
    if (!st) return '';
    const P = st.play, mx = Math.max(1, ...P.daily14.map((x) => x.ms)), n = (v) => A.fmtNum(v || 0);
    const bars = P.daily14.map((x) => `<div class="pbar" title="${x.day}：${pt(x.ms)}・${x.sessions} 場"><i style="height:${x.ms ? Math.max(4, Math.round(x.ms / mx * 100)) : 0}%"></i><b>${x.ms ? pt(x.ms).replace(' 時 ', 'h').replace(' 分', 'm').replace('<1m', '<1m') : ''}</b><span>${x.day.slice(8)}</span></div>`).join('');
    const bred = Object.entries(st.fish.bred || {}).map(([k, v]) => `${({ parent: '同種', hybrid: '混種', cross: '跨種', harbor: '漁港' })[k] || k} ${v}`).join('・');
    const row = (l, v, s2) => `<div class="prow"><span>${l}</span><b>${v}</b>${s2 ? `<em>${s2}</em>` : ''}</div>`;
    const T = st.tank;
    return `<div class="card playcard"><h3>⏱️ 遊玩時間與紀錄 <span class="muted mini">時間皆為台北時間・遊玩時間＝遊戲畫面開著（前景）的時間</span></h3>
      <div class="kpis"><div class="kpi"><div class="l">累計遊玩</div><div class="v">${pt(P.totalMs)}</div><div class="s">${P.sessions} 場・平均 ${pt(P.avgSessionMs)}</div></div>
        <div class="kpi"><div class="l">今日</div><div class="v">${pt(P.todayMs) === '—' ? '0 分' : pt(P.todayMs)}</div></div><div class="kpi"><div class="l">近 7 天</div><div class="v">${pt(P.d7Ms) === '—' ? '0 分' : pt(P.d7Ms)}</div></div><div class="kpi"><div class="l">近 30 天</div><div class="v">${pt(P.d30Ms) === '—' ? '0 分' : pt(P.d30Ms)}</div></div></div>
      <div class="pchart" aria-label="近 14 天每日遊玩時間">${bars}</div><p class="mini muted" style="margin:2px 0 10px">近 14 天每日遊玩時間（滑過／點一下看數字）</p>
      <div class="pgrid">
        <div>${row('首次遊玩', st.firstPlay ? A.fmtTime(st.firstPlay) : '—')}${row('最後上線', st.lastSeen ? A.fmtTime(st.lastSeen) + '（' + A.ago(st.lastSeen) + '）' : '—')}${row('活躍天數', st.daysActive + ' 天')}${row('裝置', h(st.device || '—'), st.device ? '' : 'v4.0.6 起記錄')}${row('等級', 'Lv' + st.level, '圖鑑 ' + st.found + ' 種')}${row('魚缸', T ? `${T.used != null ? T.used + ' / ' + T.cap : T.fish + ' 條'}` : '—', T ? `容量等級 ${T.capLv}・${T.fish} 條魚` : '')}</div>
        <div>${row('金幣收入', '🪙' + n(st.coins.earned), '存檔增加')}${row('金幣支出', '🪙' + n(st.coins.spent), '存檔減少')}${row(st.coins.shopSpentPartial ? '可核對買魚花費' : '商店花費', '🪙' + n(st.coins.shopSpent), st.coins.shopSpentPartial ? '僅伺服器交易金額；舊購買紀錄不完整，非全部商店支出' : '舊統計尚待更新')}${row('賣魚收入', '🪙' + n(st.coins.soldFor))}${row('後台／獎勵發放', '🪙' + n(st.coins.granted), st.coins.rewardsClaimed + ' 封信件')}${row('寶石花費', '💎' + n(st.gems.spent), '購買 💎' + n(st.gems.bought) + '・贈送 💎' + n(st.gems.granted))}${row('儲值', 'NT$' + n(st.purchases.twd), st.purchases.count + ' 筆已付款（綠界／藍新）')}${st.purchases.gemCount ? row('寶石購買', '💎' + n(st.purchases.gems), st.purchases.gemCount + ' 筆') : ''}</div>
        <div>${row('買魚', n(st.fish.bought + st.fish.boughtPremium), '限定魚 ' + st.fish.boughtPremium)}${row('賣魚', n(st.fish.sold))}${row('繁殖', n(st.fish.bredTotal), bred)}${row('進化', n(st.fish.evolved))}${row('魚死亡', n(st.fish.died), 'v4.0.6 起記錄')}${row('換水', n(st.care.waterChanges), '吸底 ' + st.care.siphon + '・硝化菌 ' + st.care.bacteria)}${row('用藥', n(st.care.medUsed), '買藥 ' + st.care.medBought + '・用藥 v4.0.6 起記錄')}${row('漁港', '幫忙 ' + st.harbor.helps + '・借魚繁殖 ' + st.harbor.breeds, '拜訪 ' + st.harbor.visits + (st.harbor.helpsGot != null ? '・被幫忙 ' + st.harbor.helpsGot : ''))}</div>
      </div>
      <p class="mini muted">遊玩時間與場次從 ${st.dataSince ? A.fmtTime(st.dataSince) : '—'} 起（以既有心跳紀錄回補）；金幣收支（存檔增減）從 ${st.trackedSince ? A.fmtTime(st.trackedSince) : 'v4.0.6'} 起；其餘次數來自事件紀錄（全部歷史）。</p></div>`;
  }
  const playerBadges = (p) => `${p.is_demo ? '<span class="badge b-demo">示範</span>' : ''}${p.banned_at ? '<span class="badge b-ban">停權</span>' : ''}${p.flags ? `<span class="badge b-flag" title="${h(flagWhy(p) || '')}">可疑×${p.flags}</span>` : ''}${p.username ? '<span class="badge b-ok">👤 會員</span>' : '<span class="badge b-off">訪客</span>'}${provBadges(p)}`;
  const provBadges = (p) => String(p.providers || '').split(',').filter(Boolean).map((v) => v === 'google' ? '<span class="badge b-g" title="已綁定 Google">G Google</span>' : v === 'line' ? '<span class="badge b-line" title="已綁定 LINE">LINE</span>' : '').join('') + (p.username && p.has_password ? '<span class="badge b-off" title="可用信箱密碼登入">🔑 密碼</span>' : '');   // v4.2-auth
  Views.players = async function (main) {
    const st = Views.players.state || (Views.players.state = { q: '', filter: '', sort: 'last_seen', dir: 'desc', offset: 0 }); /*V406P*/
    main.innerHTML = `<h1>👥 玩家</h1><p class="sub">搜尋 ID（#123）、會員信箱或暱稱；點選列可查看存檔、事件紀錄與執行停權／重置。</p>
      <div class="toolbar"><input type="search" id="q" placeholder="搜尋 #ID / 信箱 / 暱稱 / Google·LINE 名稱" value="${h(st.q)}">
      <select id="filter">${[['', '全部'], ['real', '真實玩家'], ['demo', '示範玩家'], ['online', '在線中'], ['bound', '註冊會員'], ['google', 'Google 登入'], ['line', 'LINE 登入'], ['password', '信箱密碼'], ['guest', '訪客'], ['vip', '月卡會員'], ['flagged', '可疑（防作弊標記）'], ['banned', '已停權']].map(([v, l]) => `<option value="${v}" ${st.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="sort">${[['last_seen', '最近上線'], ['created', '註冊時間'], ['coins', '金幣最多'], ['gems', '寶石最多'], ['flags', '可疑次數'], ['play_total', '遊玩總計最多'], ['play_7d', '近 7 天遊玩最多']].map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>排序：${l}</option>`).join('')}</select>
      <button class="btn" id="go">搜尋</button></div><div class="player-quick" aria-label="快速篩選">${[['','全部玩家'],['online','🟢 在線中'],['bound','👤 會員'],['flagged','🚩 可疑標記'],['banned','⛔ 已停權']].map(([v,t])=>`<button type="button" class="btn ghost small" data-player-filter="${v}" aria-pressed="${st.filter===v}">${t}</button>`).join('')}<button type="button" class="btn ghost small" data-player-reset>清除搜尋條件</button></div><div id="playerCount" class="muted mini" aria-live="polite"></div><div class="card" id="tbl"><div class="loading">載入中…</div></div>`;
    let loadId=0;
    async function load() {
      const request=++loadId;
      const qs = new URLSearchParams({ q: st.q, filter: st.filter, sort: st.sort, dir: st.dir || 'desc', offset: st.offset, limit: 50 });
      const sth = (k, l, cls) => `<th class="sortable ${cls || ''} ${st.sort === k ? 'on' : ''}" data-sort="${k}" title="點一下排序">${l}${st.sort === k ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</th>`;
      const d = await A.get('/players?' + qs);
      if(request!==loadId||(location.hash.slice(1).split('/')[0]||'dashboard')!=='players')return;
      main.querySelector('#playerCount').textContent=`符合條件 ${A.fmtNum(d.total)} 位・本頁 ${d.players.length} 位`;
      main.querySelectorAll('[data-player-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.playerFilter===st.filter)));
      main.querySelector('#tbl').innerHTML = `<table><tr><th>ID</th><th>會員信箱 / 暱稱</th><th>狀態</th><th class="num">金幣</th><th class="num">寶石</th><th class="num">魚</th><th class="num">圖鑑</th>${sth('play_total', '遊玩總計', 'num')}${sth('play_7d', '近 7 天', 'num')}<th>註冊</th>${sth('last_seen', '最近上線')}<th>漁港</th></tr>
        ${d.players.map((p) => `<tr class="click" data-id="${p.id}"><td>#${p.id}</td><td>${h(p.username || '（訪客）')}<div class="muted mini">${h(p.nickname)}</div></td><td>${playerBadges(p)}${p.flags && flagWhy(p) ? `<div class="mini flagwhy" title="${h(flagWhy(p))}">🚩 ${h(short(flagWhy(p), 34))}</div>` : ''}</td><td class="num">${A.fmtNum(p.coins)}</td><td class="num">${A.fmtNum(p.gems)}</td><td class="num">${p.fish_count ?? '—'}</td><td class="num">${p.found_count ?? '—'}</td><td class="num nowrap">${pt(p.play_total)}</td><td class="num nowrap">${pt(p.play_7d)}</td><td class="nowrap">${A.fmtTime(p.created_at)}</td><td class="nowrap">${A.ago(p.last_seen)}</td><td><a class="btn small harbor-link" href="#harbor/${p.id}" title="唯讀查看這位玩家的漁港">⚓ 漁港</a></td></tr>`).join('') || '<tr><td colspan="12" class="muted">沒有符合的玩家</td></tr>'}</table>
        <div class="pager">共 ${A.fmtNum(d.total)} 位　<button class="btn small" data-pg="-1" ${st.offset ? '' : 'disabled'}>上一頁</button><span>${Math.floor(st.offset / 50) + 1} / ${Math.max(1, Math.ceil(d.total / 50))}</span><button class="btn small" data-pg="1" ${st.offset + 50 < d.total ? '' : 'disabled'}>下一頁</button></div>`;
    }
    const go = () => { st.q = main.querySelector('#q').value.trim(); st.filter = main.querySelector('#filter').value; if (st.sort !== main.querySelector('#sort').value) st.dir = 'desc'; st.sort = main.querySelector('#sort').value; st.offset = 0; load(); };
    main.querySelectorAll('[data-player-filter]').forEach(b=>b.onclick=()=>{main.querySelector('#filter').value=b.dataset.playerFilter;go()});
    main.querySelector('[data-player-reset]').onclick=()=>{main.querySelector('#q').value='';main.querySelector('#filter').value='';main.querySelector('#sort').value='last_seen';st.dir='desc';go()};
    main.querySelector('#go').onclick = go;
    main.querySelector('#q').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    main.querySelector('#filter').onchange = go; main.querySelector('#sort').onchange = go;
    main.querySelector('#tbl').onclick = (e) => { const th = e.target.closest('th[data-sort]'); if (th) { const k = th.dataset.sort; st.dir = st.sort === k && st.dir !== 'asc' ? 'asc' : 'desc'; st.sort = k; st.offset = 0; const sel = main.querySelector('#sort'); if ([...sel.options].some((o) => o.value === k)) sel.value = k; load(); return; } if (e.target.closest('a.harbor-link')) return; const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'player/' + tr.dataset.id; const pg = e.target.closest('[data-pg]'); if (pg) { st.offset = Math.max(0, st.offset + Number(pg.dataset.pg) * 50); load(); } };
    await load();
  };

  // ---------- 玩家詳細 ----------
  Views.player = async function (main, params) {
    const id = Number(params[0]);
    const [d, meta] = await Promise.all([A.get('/players/' + id), A.loadMeta()]);
    const p = d.player, sv = d.save, E = d.entitlements;
    main.innerHTML = `<div class="player-detail">
      <a class="player-back" href="#players">← 玩家列表</a>
      <header class="player-heading"><div class="player-identity"><div class="player-eyebrow">玩家 #${p.id}</div><h1>${h(p.nickname || p.username || '訪客')}</h1><div class="player-email">${h(p.email || p.username || '尚未註冊帳號')}</div><div class="player-badges">${playerBadges(p)}</div></div>
      <div class="player-lastseen"><span>最近上線</span><b>${h(A.ago(p.last_seen))}</b><small>${A.fmtTime(p.last_seen)}</small></div></header>
      <nav class="player-view-actions" aria-label="查看玩家魚缸"></nav>
      ${p.banned_at?`<div class="player-warning">此帳號已停權 · ${h(p.ban_reason || '未填寫原因')}<small>${A.fmtTime(p.banned_at)}</small></div>`:''}
      <section class="player-summary" aria-label="玩家狀態摘要">
        <div class="kpi"><div class="l">金幣</div><div class="v">${A.fmtNum(sv.save && sv.save.coins)}</div><div class="s">魚缸內餘額</div></div>
        <div class="kpi"><div class="l">寶石</div><div class="v">${A.fmtNum(E.gems)}</div><div class="s">伺服器帳本餘額</div></div>
        <div class="kpi"><div class="l">魚隻／圖鑑</div><div class="v">${sv.save ? sv.save.fish.length : '—'}<small> 條魚</small></div><div class="s">已收集 ${sv.save ? Object.keys(sv.save.found || {}).length : '—'} 種</div></div>
        <div class="kpi"><div class="l">月卡</div><div class="v player-vip">${E.vip.active?'有效':'未開通'}</div><div class="s">${E.vip.active?'到期 '+A.fmtTime(E.vip.expiresAt):'目前無有效月卡'}${E.flags.length?' · '+E.flags.map(h).join('、'):''}</div></div>
      </section>
      <p class="player-save-status">雲端存檔 · ${sv.save?'rev '+sv.rev+' · 更新於 '+A.fmtTime(sv.updatedAt):'尚未上傳存檔'}${!p.flags?' · 無可疑標記':''}</p>
      <details class="card player-section player-account"><summary>帳號與登入方式<span>${(p.identities||[]).length} 個綁定帳號</span></summary>
        <dl class="player-fields"><div><dt>帳號 Email</dt><dd>${h(p.email||p.username||'未註冊')} ${p.username?`<span class="badge ${p.email_verified_at?'b-ok':'b-off'}">${p.email_verified_at?'已驗證':'未驗證'}</span>`:''}</dd></div><div><dt>建立時間</dt><dd>${A.fmtTime(p.created_at)}</dd></div><div><dt>註冊時間</dt><dd>${p.username?A.fmtTime(p.bound_at):'尚未註冊'}</dd></div></dl>
        <div class="player-connections">${(p.identities||[]).map(x=>`<div class="player-connection"><b>${x.provider==='line'?'LINE':x.provider==='google'?'Google':h(x.provider)}</b><div><strong>${h(x.name||'未提供名稱')}</strong>${x.email?`<span>${h(x.email)}</span>`:''}<small>綁定於 ${A.fmtTime(x.created_at)}</small></div><button class="btn small danger" data-act="unlinkidentity" data-provider="${h(x.provider)}">解除綁定</button></div>`).join('')||'<p class="muted">尚未綁定 Google／LINE</p>'}</div>
      </details>
      <details class="card player-section player-manage"><summary>管理操作<span>獎勵、寶石與帳號管理</span></summary><div class="player-action-grid">
        <button class="btn" data-act="mail">寄送獎勵</button><button class="btn" data-act="grant">發放商品</button><button class="btn" data-act="gems">增減寶石</button><button class="btn" data-act="gemset">設定寶石</button>
      </div><div class="player-sensitive"><span class="muted mini">帳號與存檔操作</span><div class="btns">${p.banned_at?'<button class="btn" data-act="unban">解除停權</button>':'<button class="btn danger" data-act="ban">停權</button>'}${p.username?'<button class="btn" data-act="pw">重設密碼</button>':''}${p.flags?'<button class="btn" data-act="clearflags">清除可疑標記</button>':''}<button class="btn danger" data-act="reset">重置存檔</button></div></div></details>
      <details class="card player-section"><summary>遊玩紀錄與統計<span>${d.stats?pt(d.stats.play.totalMs):'尚無紀錄'}</span></summary>${playCard(d.stats)}</details>
      ${flagCard(d, p)}
      <div class="grid2">
        <details class="card player-section"><summary>雲端存檔與編輯<span>rev ${sv.rev||0}</span></summary><div class="section-title"><h3>雲端存檔</h3><div class="btns"><label class="chk">金幣 <input type="number" id="coinEdit" value="${sv.save ? Math.floor(sv.save.coins) : ''}" style="width:120px" ${sv.save ? '' : 'disabled'}></label><button class="btn small" data-act="savecoins" ${sv.save ? '' : 'disabled'}>更新金幣</button></div></div>
          ${sv.save ? `<textarea class="code" id="saveJson" style="min-height:300px" spellcheck="false">${h(JSON.stringify(sv.save, null, 2))}</textarea><div class="btns" style="margin-top:8px"><button class="btn primary" data-act="savejson">儲存存檔 JSON</button><span class="muted mini">儲存後 rev +1，玩家下次同步會收到 409 並載入此版本。</span></div><div id="saveErr"></div>` : '<p class="muted">此玩家尚未上傳存檔</p>'}</details>
        <div class="card evcard"><h3>事件紀錄 <span class="muted mini" id="evCount"></span></h3><div class="toolbar"><select id="evType"><option value="">全部類型（${A.fmtNum((d.stats && d.stats.eventTypes || []).reduce((a, x) => a + x.n, 0))}）</option>${(d.stats && d.stats.eventTypes || []).map((x) => `<option value="${h(x.type)}">${h(evName(x.type))}・${A.fmtNum(x.n)}</option>`).join('')}</select><button class="btn small" data-act="evfilter">篩選</button></div><div id="evs" style="max-height:520px;overflow:auto">${evTable(d.events)}</div><div class="pager" id="evPager"></div></div>
        <details class="card player-section"><summary>信箱<span>${d.mailbox.length} 封 · ${d.mailbox.filter(m=>!m.claimed).length} 封未領</span></summary><table><tr><th>#</th><th>標題</th><th>內容</th><th>狀態</th></tr>${d.mailbox.map((m) => `<tr><td>${m.id}</td><td>${h(m.title)}</td><td class="mini">${rewardSummary(m, meta)}</td><td>${m.claimed ? `<span class="badge b-ok">已領 ${A.fmtTime(m.claimedAt)}</span>` : '<span class="badge b-flag">未領取</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有信件</td></tr>'}</table></details>
        <details class="card player-section"><summary>訂單與寶石帳本<span>${d.orders.length} 筆訂單</span></summary><h3>訂單</h3><table><tr><th>訂單</th><th>商品</th><th class="num">金額</th><th>狀態</th><th>時間</th></tr>${d.orders.map((o) => `<tr><td class="mono">${h(o.id)}</td><td>${h(o.productName)}</td><td class="num">${o.currency === 'GEM' ? '💎' : 'NT$'}${A.fmtNum(o.amount)}</td><td>${A.statusBadge(o.status)}<span class="muted mini">${h(o.provider)}</span></td><td class="nowrap">${A.fmtTime(o.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">沒有訂單</td></tr>'}</table>
          <h3 style="margin-top:14px">寶石帳本</h3><table><tr><th>時間</th><th class="num">增減</th><th class="num">餘額</th><th>原因</th><th>參照</th></tr>${d.ledger.map((l) => `<tr><td class="nowrap">${A.fmtTime(l.created_at)}</td><td class="num ${l.delta < 0 ? 'err' : 'ok'}">${l.delta > 0 ? '+' : ''}${l.delta}</td><td class="num">${l.balance_after}</td><td>${h(l.reason)}</td><td class="mono mini">${h(l.ref || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">沒有紀錄</td></tr>'}</table></details>
      </div></div>`;
    main.querySelectorAll('.player-detail table').forEach(table=>{const wrap=document.createElement('div');wrap.className='player-table-scroll';table.before(wrap);wrap.appendChild(table)});
    const reload = () => Views.player(main, params);
    const EV = { type: '', offset: 0, size: 50 };
    async function evLoad() { const qs = new URLSearchParams({ limit: EV.size, offset: EV.offset }); if (EV.type) qs.set('type', EV.type); const r = await A.get(`/players/${id}/events?` + qs);
      main.querySelector('#evs').innerHTML = evTable(r.events); main.querySelector('#evs').scrollTop = 0;
      const pages = Math.max(1, Math.ceil(r.total / EV.size)), cur = Math.floor(EV.offset / EV.size) + 1;
      main.querySelector('#evCount').textContent = `共 ${A.fmtNum(r.total)} 筆${EV.type ? '・' + evName(EV.type) : ''}`;
      main.querySelector('#evPager').innerHTML = `<button class="btn small" data-act="evpg" data-pg="-1" ${EV.offset ? '' : 'disabled'}>上一頁</button><span>${cur} / ${pages}</span><button class="btn small" data-act="evpg" data-pg="1" ${EV.offset + EV.size < r.total ? '' : 'disabled'}>下一頁</button>`; }
    main.querySelector('#evType').onchange = () => { EV.type = main.querySelector('#evType').value; EV.offset = 0; evLoad().catch(A.errToast); };
    evLoad().catch(() => {});
    main.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      try {
        if(act==='unlinkidentity'){const identity=(p.identities||[]).find(x=>x.provider===b.dataset.provider);if(identity)AdminIdentityControls.open(p,identity,reload);}
        else if (act === 'ban') { const r = await A.promptDlg('停權玩家', '停權原因（玩家登入時會看到）', '違反遊戲規範', '停權', true); if (r != null) { await A.post(`/players/${id}/ban`, { reason: r }); A.toast('已停權'); reload(); } }
        else if (act === 'unban') { if (await A.confirmDlg('解除停權', `確定解除 #${id} 的停權？`)) { await A.post(`/players/${id}/unban`); A.toast('已解除停權'); reload(); } }
        else if (act === 'reset') { if (await A.confirmDlg('重置存檔', `會刪除 #${id} 的雲端存檔（魚、金幣、升級、圖鑑），無法復原。寶石與訂單不受影響。`, '重置', true)) { await A.post(`/players/${id}/reset`); A.toast('已重置'); reload(); } }
        else if (act === 'pw') { const v = await A.promptDlg('重設會員密碼', `為 ${p.email || p.username} 設定新密碼（至少 8 字元）。重設後該會員所有裝置都會被登出，請透過客服管道告知新密碼。`, '', '重設密碼', true); if (v) { await A.post(`/players/${id}/password`, { password: v }); A.toast('已重設密碼，該會員需重新登入'); reload(); } }
        else if (act === 'clearflags') { if (await A.confirmDlg('清除可疑標記', `把 #${id} 的可疑次數（${p.flags}）歸零？清除紀錄會保留（時間、操作者、IP）。`, '清除')) { await A.post(`/players/${id}/clear-flags`); A.toast('已清除'); reload(); } }
        else if (act === 'gemset') { const v = await A.promptDlg('設定寶石', `目前 💎${E.gems}。直接設定為：`, String(E.gems)); if (v != null && v !== '') { const reason = await A.promptDlg('調整原因', '原因（會寫入帳本與操作紀錄）', '管理員設定'); if (reason != null) { try { await A.post(`/players/${id}/gems`, { set: Number(v), reason }); A.toast('已設定寶石'); reload(); } catch (err) { A.errToast(err); } } } }
        else if (act === 'gems') { const v = await A.promptDlg('調整寶石', '增減數量（負數為扣除）', '100'); if (v) { const reason = await A.promptDlg('調整原因', '原因（會寫入帳本與操作紀錄）', '客服補償'); if (reason != null) { await A.post(`/players/${id}/gems`, { delta: Number(v), reason }); A.toast('已調整'); reload(); } } }
        else if (act === 'grant') {
          const bd = A.openModal(`<h2>發放商品給 #${id}</h2><p class="muted">不收款，建立一筆 provider=admin、金額 0 的訂單並立即發貨（寶石入帳、月卡生效，金幣/魚/裝飾寄到信箱）。</p><label class="f">商品<select id="gsku">${meta.products.map((p) => `<option value="${h(p.sku)}">${h(p.name)}（${h(p.sku)}）</option>`).join('')}</select></label><label class="f" style="margin-top:8px">備註<input id="gnote" value="客服補償"></label><div class="btns" style="margin-top:12px"><button class="btn primary" id="gok">發放</button><button class="btn ghost" data-close>取消</button></div>`);
          bd.querySelector('#gok').onclick = async () => { try { await A.post(`/players/${id}/grant-product`, { sku: bd.querySelector('#gsku').value, note: bd.querySelector('#gnote').value }); A.closeModal(); A.toast('已發放'); reload(); } catch (err) { A.errToast(err); } };
        }
        else if (act === 'mail') { Views.rewards.prefill = { target: 'player', playerId: id }; location.hash = 'rewards'; }
        else if (act === 'savecoins') { const save = JSON.parse(JSON.stringify(sv.save)); save.coins = Number(main.querySelector('#coinEdit').value); await A.put(`/players/${id}/save`, { save }); A.toast('已更新金幣'); reload(); }
        else if (act === 'savejson') { let save; try { save = JSON.parse(main.querySelector('#saveJson').value); } catch (err) { main.querySelector('#saveErr').innerHTML = `<div class="errors">JSON 語法錯誤：${h(err.message)}</div>`; return; } try { await A.put(`/players/${id}/save`, { save }); A.toast('存檔已更新'); reload(); } catch (err) { main.querySelector('#saveErr').innerHTML = A.errList(err.data && err.data.errors) || `<div class="errors">${h(err.message)}</div>`; } }
        else if (act === 'evfilter') { EV.type = main.querySelector('#evType').value; EV.offset = 0; await evLoad(); }
        else if (act === 'evpg') { EV.offset = Math.max(0, EV.offset + Number(b.dataset.pg) * EV.size); await evLoad(); }
      } catch (err) { A.errToast(err); }
    };
  };
  // 🚩 可疑紀錄：anticheat_reject／anticheat_flag 會加可疑次數；超過繁殖次數、舊版網頁只記錄不加次數
  /*V406M*/ const CAT = { med_cooldown_reject: ['草本藥冷卻中・存檔已拒絕（不算可疑）', 'warn', false], med_cooldown_over: ['草本藥冷卻中（不算可疑）', 'warn', false], anticheat_reject: ['可疑・存檔已拒絕', 'err', true], anticheat_flag: ['可疑・已標記（存檔照存）', 'err', true], breed_limit_reject: ['超過繁殖次數・存檔已拒絕（不算可疑）', 'warn', false], breed_limit_over: ['超過繁殖次數（不算可疑）', 'warn', false], client_outdated: ['舊版網頁・請玩家重新整理（不算可疑）', 'warn', false], flags_cleared: ['清除可疑標記', 'ok', false] };
  const NUMK = [['delta', '金幣變化'], ['allowed', '允許上限'], ['elapsed', '間隔秒'], ['maxRate', '每秒上限'], ['spent', '花費'], ['sold', '賣出'], ['bredSold', '生了又賣'], ['newBred', '新繁殖'], ['freeLeft', '免費剩'], ['freeUsed', '免費已用'], ['freeTotal', '免費共'], ['extraUsed', '加購'], ['build', '版本'], ['min', '最低版本'], ['prev', '清除前次數']];
  function flagCard(d, p) {
    const log = d.flagLog || []; if (!log.length && !p.flags) return '';
    const nums = (o) => NUMK.filter(([k]) => o[k] != null && o[k] !== '').map(([k, l]) => `<span class="fnum">${l} <b>${h(typeof o[k] === 'number' ? A.fmtNum(o[k]) : String(o[k]))}</b></span>`).join('');
    const rows = log.map((e) => { const x = pj(e.data), c = e.type==='anticheat_resolved'?['已核實儲值・同步誤判','ok',false]:CAT[e.type] || [e.type, '', false], info = { ...(x.info || {}), ...(x.build ? { build: x.build } : {}), ...(x.min ? { min: x.min } : {}), ...(e.type === 'flags_cleared' ? { prev: x.prev } : {}) };
      const legacyBreed = e.type === 'anticheat_reject' && (x.reasons || []).length && (x.reasons || []).every((r) => /超過今日繁殖次數/.test(r));
      const rs = e.type === 'anticheat_resolved' ? [x.review?.reason||'已核實合法付款，撤銷同步誤判',x.review?.orderId?'訂單 '+x.review.orderId+' · NT$'+x.review.amount:''].filter(Boolean) : e.type === 'flags_cleared' ? [`${x.by || '後台管理員'}${x.ip ? '（IP ' + x.ip + '）' : ''}`] : [...(x.reasons || []), ...((x.limit || []).map((r) => '（另）' + r))];
      return `<tr><td class="nowrap mini">${A.fmtTime(e.created_at)}</td><td><span class="badge ${c[1] === 'err' ? 'b-flag' : c[1] === 'ok' ? 'b-ok' : 'b-warn'}">${c[0]}</span>${c[2] ? '<div class="mini muted">可疑 +1</div>' : ''}${legacyBreed ? '<div class="mini muted">（v4.0.6 起此類改為不算可疑）</div>' : ''}</td><td class="mini">${rs.map((r) => `<div>${h(r)}</div>`).join('') || '—'}<div class="fnums">${nums(info)}</div></td></tr>`; }).join('');
    const cl = (d.flagClears || [])[0], cd = cl ? pj(cl.detail) : null;
    const n = log.filter((e) => CAT[e.type] && CAT[e.type][2]).length, nb = log.filter((e) => /^breed_limit/.test(e.type)).length;
    return `<div class="card"><h3>🚩 可疑紀錄 <span class="muted mini">目前可疑 ${p.flags} 次・列出最近 ${log.length} 筆（可疑 ${n}、超過繁殖次數 ${nb}）</span></h3>
      ${cl ? `<p class="mini muted">最近清除：${A.fmtTime(cl.at)}・${h((cd && cd.by) || '後台管理員')}${cl.ip ? '・IP ' + h(cl.ip) : ''}${cd && cd.prev != null ? '・清除前 ' + cd.prev + ' 次' : ''}</p>` : ''}
      <div style="max-height:420px;overflow:auto"><table class="flaglog"><tr><th>時間（台北）</th><th>分類</th><th>原因與數字</th></tr>${rows || '<tr><td colspan="3" class="muted">沒有紀錄（舊的可疑次數在記錄原因之前產生）</td></tr>'}</table></div></div>`;
  }
  function evTable(evs) {
    return `<table><tr><th>時間</th><th>類型</th><th>內容</th></tr>${evs.map((e) => `<tr><td class="nowrap mini">${A.fmtTime(e.created_at)}</td><td class="mono ${/anticheat|ban/.test(e.type) ? 'err' : ''}">${h(e.type)}</td><td class="mono mini" style="word-break:break-all">${h((e.data || '').slice(0, 300))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">沒有事件</td></tr>'}</table>`;
  }
  function rewardSummary(r, meta) {
    const sp = (k) => (meta.species.find((s) => s.key === k) || { name: k }).name;
    const dn = (k) => { const d = meta.decorations.find((x) => x.key === k); return d ? d.icon + d.name : k; };
    const parts = [];
    if (r.coins) parts.push(`🪙${A.fmtNum(r.coins)}`);
    if (r.gems) parts.push(`💎${A.fmtNum(r.gems)}`);
    for (const f of r.fish || []) parts.push(`🐟${h(sp(f.species))}×${f.count}`);
    for (const d of (r.decorations || (r.items && r.items.decorations) || [])) parts.push(h(dn(d)));
    return parts.join('、') || '—';
  }
  window.rewardSummary = rewardSummary;

  // ---------- 公告 ----------
  Views.announcements = async function (main) {
    const d = await A.get('/announcements');
    const now = Date.now();
    const state = (a) => !a.active ? '<span class="badge b-off">停用</span>' : a.starts_at && a.starts_at > now ? '<span class="badge b-blue">排程中</span>' : a.ends_at && a.ends_at <= now ? '<span class="badge b-off">已結束</span>' : '<span class="badge b-ok">顯示中</span>';
    main.innerHTML = `<h1>📢 公告</h1><p class="sub">遊戲透過 <span class="mono">GET /api/announcements</span> 取得「啟用中且在時間範圍內」的公告。時間以瀏覽器時區（台灣時間）輸入。</p>
      <div class="row"><div class="grow"><div class="card"><table><tr><th>#</th><th>標題</th><th>狀態</th><th>開始</th><th>結束</th><th></th></tr>
      ${d.announcements.map((a) => `<tr><td>${a.id}</td><td><b>${h(a.title)}</b><div class="muted mini">${h(a.body.slice(0, 80))}</div></td><td>${state(a)}</td><td class="nowrap mini">${A.fmtTime(a.starts_at)}</td><td class="nowrap mini">${A.fmtTime(a.ends_at)}</td><td class="btns"><button class="btn small" data-edit="${a.id}">編輯</button><button class="btn small danger" data-del="${a.id}">刪除</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">尚無公告</td></tr>'}</table></div></div>
      <div style="width:380px"><div class="card" id="annForm"></div></div></div>`;
    function form(a) {
      a = a || { title: '', body: '', active: 1 };
      main.querySelector('#annForm').innerHTML = `<h2>${a.id ? `編輯公告 #${a.id}` : '新增公告'}</h2>
        <label class="f">標題<input id="aTitle" value="${h(a.title)}" maxlength="80"></label>
        <label class="f" style="margin-top:8px">內容<textarea id="aBody" rows="6">${h(a.body)}</textarea></label>
        <div class="fields" style="margin-top:8px"><label class="f">開始時間（空白＝立即）<input type="datetime-local" id="aStart" value="${A.toLocalInput(a.starts_at)}"></label><label class="f">結束時間（空白＝不結束）<input type="datetime-local" id="aEnd" value="${A.toLocalInput(a.ends_at)}"></label></div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="aActive" ${a.active ? 'checked' : ''}>啟用</label>
        <div class="btns" style="margin-top:12px"><button class="btn primary" id="aSave">${a.id ? '儲存' : '發布'}</button>${a.id ? '<button class="btn ghost" id="aNew">改為新增</button>' : ''}</div>`;
      main.querySelector('#aSave').onclick = async () => {
        const body = { title: main.querySelector('#aTitle').value, body: main.querySelector('#aBody').value, startsAt: A.fromLocalInput(main.querySelector('#aStart').value), endsAt: A.fromLocalInput(main.querySelector('#aEnd').value), active: main.querySelector('#aActive').checked };
        try { if (a.id) await A.put('/announcements/' + a.id, body); else await A.post('/announcements', body); A.toast('已儲存'); Views.announcements(main); } catch (e) { A.errToast(e); }
      };
      const nb = main.querySelector('#aNew'); if (nb) nb.onclick = () => form(null);
    }
    form(null);
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) form(d.announcements.find((a) => a.id === Number(b.dataset.edit)));
      if (b.dataset.del && await A.confirmDlg('刪除公告', `確定刪除公告 #${b.dataset.del}？`, '刪除', true)) { await A.del('/announcements/' + b.dataset.del); A.toast('已刪除'); Views.announcements(main); }
    };
  };

  // ---------- 獎勵寄送 ----------
  Views.rewards = async function (main) {
    const [d, meta] = await Promise.all([A.get('/rewards'), A.loadMeta(true)]);
    const pre = Views.rewards.prefill || {}; Views.rewards.prefill = null;
    main.innerHTML = `<h1>🎁 獎勵寄送</h1><p class="sub">獎勵會進入玩家信箱，玩家在遊戲內按「領取」後由伺服器直接寫入雲端存檔（金幣／魚／裝飾）或寶石帳本。</p>
      <div class="row"><div style="width:440px"><div class="card"><h2>寄送新獎勵</h2>
        <label class="f">標題<input id="rTitle" maxlength="60" placeholder="例如：維修補償"></label>
        <label class="f" style="margin-top:8px">內文<textarea id="rBody" rows="3" maxlength="500"></textarea></label>
        <div class="fields" style="margin-top:8px"><label class="f">金幣<input type="number" id="rCoins" min="0" value="0"></label><label class="f">寶石<input type="number" id="rGems" min="0" value="0"></label><label class="f">期限（空白＝永久）<input type="datetime-local" id="rExp"></label></div>
        <h3 style="margin-top:12px">魚</h3><div id="fishRows"></div><button class="btn small" id="addFish">＋ 加一種魚</button>
        <h3 style="margin-top:12px">裝飾</h3><div class="btns">${meta.decorations.map((x) => `<label class="chk"><input type="checkbox" class="rDeco" value="${h(x.key)}">${h(x.icon + x.name)}</label>`).join('')}</div>
        <h3 style="margin-top:12px">寄送對象</h3>
        <div class="btns"><label class="chk"><input type="radio" name="tgt" value="player" ${pre.target === 'player' ? 'checked' : ''}>指定玩家</label><label class="chk"><input type="radio" name="tgt" value="all" ${!pre.target ? 'checked' : ''}>全部玩家</label><label class="chk"><input type="radio" name="tgt" value="filter">依條件篩選</label></div>
        <div id="tgtBox" style="margin-top:8px"></div>
        <div class="btns" style="margin-top:12px"><button class="btn" id="preview">預覽人數</button><span id="pvCount" class="muted"></span><span style="flex:1"></span><button class="btn primary" id="send">寄出</button></div>
      </div></div>
      <div class="grow"><div class="card"><h2>已寄送</h2><table><tr><th>#</th><th>標題</th><th>內容</th><th>對象</th><th class="num">已領 / 人數</th><th>時間</th><th></th></tr>
        ${d.rewards.map((r) => `<tr><td>${r.id}</td><td>${h(r.title)}${r.order_id ? `<div class="mini muted">訂單 ${h(r.order_id)}</div>` : ''}${r.revoked ? ' <span class="badge b-off">已撤回</span>' : ''}</td><td class="mini">${rewardSummary(r, meta)}</td><td class="mini">${r.target === 'all' ? `全部玩家${r.include_new ? '（含之後新玩家）' : ''}` : r.target === 'player' ? '指定玩家' : '條件篩選'}</td><td class="num">${r.claimed} / ${r.target === 'all' && r.include_new ? '∞' : r.recipients}</td><td class="nowrap mini">${A.fmtTime(r.created_at)}${r.expires_at ? `<br>至 ${A.fmtTime(r.expires_at)}` : ''}</td><td>${r.revoked ? '' : `<button class="btn small danger" data-revoke="${r.id}">撤回</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">尚未寄送</td></tr>'}</table></div></div></div>`;
    const fishRows = main.querySelector('#fishRows');
    const addFish = () => { const div = document.createElement('div'); div.className = 'btns'; div.style.marginBottom = '6px'; div.innerHTML = `<select class="fSp">${meta.species.map((s) => `<option value="${h(s.key)}">${h(s.name)}</option>`).join('')}</select><input type="number" class="fCnt" value="1" min="1" max="20" style="width:70px">條 <button class="btn small ghost" data-rm>✕</button>`; fishRows.appendChild(div); };
    main.querySelector('#addFish').onclick = addFish;
    fishRows.onclick = (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.btns').remove(); };
    function tgtBox() {
      const t = main.querySelector('input[name=tgt]:checked').value;
      const box = main.querySelector('#tgtBox');
      if (t === 'player') box.innerHTML = `<label class="f">玩家 ID（多位以逗號分隔）<input id="rPids" value="${h(pre.playerId || '')}" placeholder="例如 12, 34"></label>`;
      else if (t === 'all') box.innerHTML = `<label class="chk"><input type="checkbox" id="rNew">也寄給之後才加入的新玩家</label><p class="muted mini">不勾選時只寄給目前已存在的玩家（不含停權）。</p>`;
      else box.innerHTML = `<div class="fields"><label class="f">最近 N 天有上線<input type="number" id="fDays" placeholder="例如 7"></label><label class="f">金幣 ≥<input type="number" id="fMin"></label><label class="f">金幣 ≤<input type="number" id="fMax"></label>
        <label class="f">會員身分<select id="fBound"><option value="">不限</option><option value="yes">註冊會員</option><option value="no">訪客</option></select></label>
        <label class="f">擁有魚種<select id="fSp"><option value="">不限</option>${meta.species.map((s) => `<option value="${h(s.key)}">${h(s.name)}</option>`).join('')}</select></label>
        <label class="f">月卡會員<select id="fVip"><option value="">不限</option><option value="yes">只限會員</option></select></label></div><label class="chk"><input type="checkbox" id="fDemo">包含示範玩家</label>`;
    }
    main.querySelectorAll('input[name=tgt]').forEach((r) => (r.onchange = tgtBox)); tgtBox();
    const v = (id) => { const el = main.querySelector('#' + id); return el ? el.value : ''; };
    function collect() {
      const target = main.querySelector('input[name=tgt]:checked').value;
      const body = { title: v('rTitle'), body: v('rBody'), coins: Number(v('rCoins')) || 0, gems: Number(v('rGems')) || 0, expiresAt: A.fromLocalInput(v('rExp')), target,
        fish: [...fishRows.querySelectorAll('.btns')].map((r) => ({ species: r.querySelector('.fSp').value, count: Number(r.querySelector('.fCnt').value) || 1 })),
        decorations: [...main.querySelectorAll('.rDeco:checked')].map((c) => c.value) };
      if (target === 'player') body.playerIds = v('rPids').split(/[,，\s]+/).map((s) => Number(s.replace('#', ''))).filter(Boolean);
      if (target === 'all') body.includeNew = main.querySelector('#rNew').checked;
      if (target === 'filter') body.filter = { lastSeenDays: Number(v('fDays')) || undefined, minCoins: v('fMin'), maxCoins: v('fMax'), bound: v('fBound'), ownsSpecies: v('fSp'), vip: v('fVip'), includeDemo: main.querySelector('#fDemo').checked };
      return body;
    }
    main.querySelector('#preview').onclick = async () => { const b = collect(); if (b.target === 'player') { main.querySelector('#pvCount').textContent = `${b.playerIds.length} 位`; return; } const r = await A.post('/rewards/preview', b); main.querySelector('#pvCount').textContent = `符合 ${r.count} 位`; };
    main.querySelector('#send').onclick = async () => {
      const b = collect();
      if (!(await A.confirmDlg('確認寄出', `「${h(b.title)}」：${rewardSummary(b, meta)}<br>對象：${b.target === 'all' ? '全部玩家' : b.target === 'player' ? '玩家 #' + b.playerIds.join(', #') : '條件篩選'}<br>寄出後玩家即可領取。`, '寄出'))) return;
      try { const r = await A.post('/rewards', b); A.toast(`已寄出給 ${r.recipients} 位玩家`); Views.rewards(main); } catch (e) { A.errToast(e); }
    };
    main.querySelector('.grow').onclick = async (e) => { const b = e.target.closest('[data-revoke]'); if (b && await A.confirmDlg('撤回獎勵', '撤回後尚未領取的玩家將看不到這封信（已領取的不受影響）。', '撤回', true)) { await A.post(`/rewards/${b.dataset.revoke}/revoke`); A.toast('已撤回'); Views.rewards(main); } };
  };

  // ---------- 操作紀錄 ----------
  Views.audit = async function (main) {
    const d = await A.get('/audit?limit=300');
    main.innerHTML = `<h1>📜 管理員操作紀錄</h1><p class="sub">所有後台寫入動作與登入嘗試都會記錄（最新 300 筆）。</p><div class="card"><table><tr><th>時間</th><th>動作</th><th>對象</th><th>內容</th><th>IP</th></tr>
      ${d.entries.map((e) => `<tr><td class="nowrap mini">${A.fmtTime(e.at)}</td><td class="mono ${/fail|ban|refund|reset|rollback/.test(e.action) ? 'err' : ''}">${h(e.action)}</td><td class="mono">${h(e.target || '')}</td><td class="mono mini" style="word-break:break-all;max-width:520px">${h((e.detail || '').slice(0, 400))}</td><td class="mono mini">${h(e.ip || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">尚無紀錄</td></tr>'}</table></div>`;
  };
})();
