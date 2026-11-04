// 英雄魚 PvP 後台（/admin/hero）：總覽、排行榜、英雄／禁賽、戰報（重播＋重新模擬驗證）、可疑配對、賽季結算、設定編輯、平衡模擬
(function () {
  const { h } = A;
  if (!location.hash) history.replaceState(null, '', '#hero');
  const rk = (name, color) => `<span class="badge" style="color:${h(color || '#9fd3ff')}">${h(name)}</span>`;
  let cfgCache = null;
  async function heroCfg() { if (!cfgCache) cfgCache = (await A.get('/hero/config')).config; return cfgCache; }
  const flagBadges = (f) => (f || []).map((x) => `<span class="badge b-flag">${h({ same_ip: '同 IP', pair_frequent: '頻繁互打', repeat_opponent: '重複對手' }[x] || x)}</span>`).join('');

  Views.hero = async function (main) {
    const d = await A.get('/hero/overview');
    const w = d.warmup;
    const warm = !w ? '未啟動（記憶體資料庫或 HERO_WARMUP=0）' : w.error ? '失敗：' + h(w.error) : w.finished ? `完成（${A.fmtNum(w.total)} 組，${Math.round((w.ms || 0) / 1000)} 秒）` : `計算中 ${A.fmtNum(w.done)} / ${A.fmtNum(w.total)}`;
    const ranks = (await heroCfg()).ranks;
    main.innerHTML = `<h1>⚔️ 英雄魚 PvP 總覽</h1><p class="sub">${d.season ? `目前賽季：<b>${h(d.season.name)}</b>（${A.fmtTime(d.season.startedAt)} 開始）` : '沒有進行中的賽季'}　公平係數預先計算：${warm}</p>
      <div class="kpis">
        <div class="kpi"><div class="l">英雄魚</div><div class="v">${A.fmtNum(d.heroes)}</div><div class="s">有效 ${A.fmtNum(d.active)}</div></div>
        <div class="kpi"><div class="l">24 小時對戰</div><div class="v">${A.fmtNum(d.battles24h)}</div><div class="s">會員 PvP ${A.fmtNum(d.pvp24h)}</div></div>
        <div class="kpi"><div class="l">7 天可疑標記</div><div class="v">${A.fmtNum(d.flagged7d)}</div><div class="s">同 IP／頻繁互打</div></div>
        <div class="kpi"><div class="l">禁賽中</div><div class="v">${A.fmtNum(d.banned)}</div><div class="s">僅停 PvP，不影響遊戲</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h3>段位分布（會員）</h3>${Charts.hbars(ranks.map((r) => ({ label: r.name, value: d.rankDist[r.name] || 0 })), { valueFmt: (v) => v + ' 人' })}</div>
        <div class="card"><h3>最常被選為英雄的魚種</h3>${Charts.hbars(d.species.map((s) => ({ label: s.name, value: s.n })), { valueFmt: (v) => v + ' 隻' })}</div>
      </div>`;
  };

  Views['hero-rank'] = async function (main) {
    const d = await A.get('/hero/leaderboard?limit=200');
    main.innerHTML = `<h1>🏆 排行榜</h1><p class="sub">${h(d.season ? d.season.name : '')}・只列出註冊會員且未禁賽者</p><div class="card"><table><tr><th>#</th><th>玩家</th><th>英雄</th><th>段位</th><th class="num">積分</th><th class="num">勝/敗</th><th></th></tr>
      ${d.leaderboard.map((x) => `<tr><td>${x.position}</td><td>${h(x.nickname)} <span class="muted mini">#${x.playerId}</span></td><td>${h(x.fishName || '')} <span class="muted">${h(x.spName)} Lv.${x.level}</span></td><td>${rk(x.rank.name, x.rank.color)}</td><td class="num"><b>${x.rating}</b></td><td class="num">${x.wins}/${x.losses}</td><td><a href="#hero-heroes/${x.playerId}">管理</a></td></tr>`).join('') || '<tr><td colspan="7" class="muted">尚無資料</td></tr>'}</table></div>`;
  };

  async function heroDetail(pid) {
    const d = await A.get('/hero/heroes/' + pid), hero = d.hero || {};
    const b = A.openModal(`<h2>🐟 ${h(d.player.nickname)} <span class="muted">#${d.player.id} ${h(d.player.username || '訪客')}</span></h2>
      <div class="grid2"><div><p>${h(hero.fishName)}（${h(hero.spName)}）Lv.${hero.level}・戰力 <b>${hero.power}</b>・${rk(hero.rank && hero.rank.name, hero.rank && hero.rank.color)} ${hero.rating} 分</p>
      <p class="muted">生命 ${hero.stats && hero.stats.hp}／攻擊 ${hero.stats && hero.stats.atk}／防禦 ${hero.stats && hero.stats.def}／速度 ${hero.stats && hero.stats.spd}／暴擊 ${hero.stats && hero.stats.crit / 10}%</p>
      <p>進攻 ${hero.wins} 勝 ${hero.losses} 敗・防守 ${hero.defWins} 勝 ${hero.defLosses} 敗・挑戰次數 ${hero.tickets}/${hero.ticketsMax}</p>
      ${hero.pvpBanned ? `<p class="err">⛔ 禁賽中：${h(hero.pvpBanReason || '')}</p>` : ''}
      <div class="btns">${hero.pvpBanned ? '<button class="btn" data-x="unban">解除禁賽</button>' : '<button class="btn danger" data-x="ban">禁止 PvP</button>'}<button class="btn" data-x="rating">調整積分</button></div></div>
      <div><h3>購買紀錄</h3><table>${d.purchases.slice(0, 12).map((p) => `<tr><td class="nowrap">${A.fmtTime(p.created_at)}</td><td>${h(p.kind)}・${h(p.item)}</td><td class="num">${p.currency === 'gems' ? '💎' : '🪙'}${p.amount}</td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table></div></div>
      <h3>最近戰報</h3><table>${d.battles.slice(0, 15).map((x) => `<tr><td class="nowrap">${A.fmtTime(x.createdAt)}</td><td>${x.mine === 'attacker' ? '進攻' : '防守'} ${h((x.mine === 'attacker' ? x.d : x.a).nickname || '')}</td><td>${x.won ? '<span class="ok">勝</span>' : '<span class="err">敗</span>'}</td><td class="num">${x.mine === 'attacker' ? x.aDelta : x.dDelta}</td><td>${flagBadges(x.flags)}</td><td><a href="#hero-battles/${x.id}">查看</a></td></tr>`).join('') || '<tr><td class="muted">無</td></tr>'}</table>`);
    b.onclick = async (e) => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      try {
        if (x.dataset.x === 'ban') { const r = await A.promptDlg('禁止 PvP', '原因（會顯示給玩家）', '疑似洗分／分身互打', '禁賽', true); if (r == null) return; await A.post(`/hero/heroes/${pid}/pvp-ban`, { reason: r }); A.toast('已禁賽'); }
        if (x.dataset.x === 'unban') { await A.post(`/hero/heroes/${pid}/pvp-unban`); A.toast('已解除禁賽'); }
        if (x.dataset.x === 'rating') { const r = await A.promptDlg('調整積分', '新積分（0–5000）', String(hero.rating)); if (r == null) return; await A.post(`/hero/heroes/${pid}/rating`, { rating: Number(r), note: '後台調整' }); A.toast('已調整'); }
        heroDetail(pid);
      } catch (er) { A.errToast(er); }
    };
  }
  Views['hero-heroes'] = async function (main, params) {
    const st = Views['hero-heroes'].st || (Views['hero-heroes'].st = { q: '', banned: false });
    main.innerHTML = `<h1>🐟 英雄 / 禁賽</h1><p class="sub">搜尋玩家 ID、暱稱、信箱或魚種；禁賽只停止 PvP（名單、挑戰、排行榜），不影響遊戲本身。</p>
      <div class="toolbar"><input type="search" id="q" placeholder="#ID / 暱稱 / 信箱 / 魚種" value="${h(st.q)}"><label class="chk"><input type="checkbox" id="bn" ${st.banned ? 'checked' : ''}> 只看禁賽</label><button class="btn" id="go">搜尋</button></div><div class="card" id="tbl"><div class="loading">載入中…</div></div>`;
    async function load() {
      const d = await A.get('/hero/heroes?' + new URLSearchParams({ q: st.q, banned: st.banned ? '1' : '' }));
      main.querySelector('#tbl').innerHTML = `<table><tr><th>玩家</th><th>英雄</th><th>段位</th><th class="num">積分</th><th class="num">進攻</th><th class="num">防守</th><th>狀態</th><th>更新</th></tr>
        ${d.heroes.map((x) => `<tr class="click" data-id="${x.playerId}"><td>#${x.playerId} ${h(x.nickname)}<div class="muted mini">${h(x.username || '訪客')}</div></td><td>${h(x.fishName)} <span class="muted">${h(x.spName)} Lv.${x.level}</span></td><td>${h(x.rank)}</td><td class="num">${x.rating}</td><td class="num">${x.wins}/${x.losses}</td><td class="num">${x.defWins}/${x.defLosses}</td><td>${x.pvpBannedAt ? '<span class="badge b-ban">禁賽</span>' : ''}${x.active ? '' : '<span class="badge b-off">魚不在</span>'}${x.username ? '' : '<span class="badge b-off">訪客</span>'}</td><td class="nowrap">${A.ago(x.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">沒有資料</td></tr>'}</table>`;
    }
    const go = () => { st.q = main.querySelector('#q').value.trim(); st.banned = main.querySelector('#bn').checked; load(); };
    main.querySelector('#go').onclick = go; main.querySelector('#q').onkeydown = (e) => { if (e.key === 'Enter') go(); }; main.querySelector('#bn').onchange = go;
    main.querySelector('#tbl').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) heroDetail(Number(tr.dataset.id)).catch(A.errToast); };
    await load();
    if (params[0]) heroDetail(Number(params[0])).catch(A.errToast);
  };

  let replay = null;
  async function battleDetail(id) {
    const d = await A.get('/hero/battles/' + id), b = d.battle, cfg = await heroCfg();
    const box = A.openModal(`<h2>⚔️ 戰報 #${b.id} <span class="muted">${A.fmtTime(b.createdAt)}</span></h2>
      <p>${h(b.a.nickname)}（${h(b.a.spName)} Lv.${b.a.level}，${b.aRating}）vs ${h(b.d.nickname || '練習對手')}（${h(b.d.spName)} Lv.${b.d.level}${b.dRating != null ? '，' + b.dRating : ''}）
      → <b>${b.winner === 0 ? '進攻方勝' : '防守方勝'}</b>（${b.reason === 'ko' ? '擊倒' : '時間到'}，${b.actions} 次行動）積分 ${b.aDelta}/${b.dDelta == null ? '—' : b.dDelta} ${flagBadges(b.flags)}</p>
      <p>重新模擬驗證：${d.verify.match ? '<span class="ok">✔ 與紀錄完全一致</span>' : '<span class="err">✖ 不一致（設定或模擬器版本已變更？）</span>'}・種子 <span class="mono">${b.seed}</span>・模擬器 v${b.simVersion}</p>
      <div style="position:relative;height:340px;border-radius:10px;overflow:hidden;background:#000"><canvas id="rp" style="width:100%;height:100%;display:block"></canvas></div>
      <div class="btns" style="margin-top:8px"><button class="btn small" data-x="again">重播</button><button class="btn small" data-x="skip">跳到結尾</button></div>`);
    const book = window.HeroUI ? HeroUI.SpeciesBook({ baseUrl: '' }) : null;
    const start = () => { if (replay) replay.destroy(); if (window.HeroUI) replay = HeroUI.Replay(box.querySelector('#rp'), b, { book, cfg }); };
    if (book) await book.load();
    start();
    const modal = document.getElementById('modal');
    modal._onclose = () => { if (replay) replay.destroy(); replay = null; };
    box.onclick = (e) => { const x = e.target.closest('[data-x]'); if (!x) return; if (x.dataset.x === 'again') start(); if (x.dataset.x === 'skip' && replay) replay.skip(); };
  }
  Views['hero-battles'] = async function (main, params) {
    const st = Views['hero-battles'].st || (Views['hero-battles'].st = { pvp: true, flagged: false, playerId: '' });
    main.innerHTML = `<h1>⚔️ 戰報 / 可疑配對</h1><p class="sub">所有戰鬥由伺服器以「快照＋種子」模擬，可隨時重新模擬驗證。</p>
      <div class="card"><h3>可疑配對（7 天）</h3><div id="sus" class="loading">載入中…</div></div>
      <div class="toolbar"><label class="chk"><input type="checkbox" id="pvp" ${st.pvp ? 'checked' : ''}> 只看會員 PvP</label><label class="chk"><input type="checkbox" id="fl" ${st.flagged ? 'checked' : ''}> 只看有標記</label><input id="pid" placeholder="玩家 ID" size="8" value="${h(st.playerId)}"><button class="btn" id="go">篩選</button></div>
      <div class="card" id="tbl"><div class="loading">載入中…</div></div>`;
    A.get('/hero/suspicious').then((d) => {
      main.querySelector('#sus').outerHTML = `<table><tr><th>玩家 A</th><th>玩家 B</th><th class="num">次數</th><th class="num">同 IP</th><th class="num">A 累計積分</th><th></th></tr>${d.pairs.map((p) => `<tr><td>#${p.a} ${h(p.aNick)}</td><td>#${p.b} ${h(p.bNick)}</td><td class="num">${p.n}</td><td class="num">${p.sameIp}</td><td class="num">${p.delta}</td><td><a href="#hero-heroes/${p.a}">A</a> · <a href="#hero-heroes/${p.b}">B</a></td></tr>`).join('') || '<tr><td colspan="6" class="muted">目前沒有可疑配對 👍</td></tr>'}</table>`;
    }).catch(A.errToast);
    async function load() {
      const d = await A.get('/hero/battles?' + new URLSearchParams({ pvp: st.pvp ? '1' : '', flagged: st.flagged ? '1' : '', playerId: st.playerId, limit: 200 }));
      main.querySelector('#tbl').innerHTML = `<table><tr><th>#</th><th>時間</th><th>進攻</th><th>防守</th><th>結果</th><th class="num">積分</th><th>標記</th></tr>
        ${d.battles.map((b) => `<tr class="click" data-id="${b.id}"><td>${b.id}</td><td class="nowrap">${A.fmtTime(b.createdAt)}</td><td>#${b.attackerId} ${h(b.attackerNick || '')}<div class="muted mini">${h(b.a.spName)} Lv.${b.a.level}</div></td><td>${b.defenderId ? '#' + b.defenderId + ' ' + h(b.defenderNick || '') : '<span class="muted">練習</span>'}<div class="muted mini">${h(b.d.spName)} Lv.${b.d.level}</div></td><td>${b.winner === 0 ? '進攻勝' : '防守勝'}<div class="muted mini">${b.reason === 'ko' ? '擊倒' : '時間到'}・${b.actions} 動</div></td><td class="num">${b.aDelta}${b.dDelta != null ? ' / ' + b.dDelta : ''}</td><td>${flagBadges(b.flags)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">沒有資料</td></tr>'}</table>`;
    }
    main.querySelector('#go').onclick = () => { st.pvp = main.querySelector('#pvp').checked; st.flagged = main.querySelector('#fl').checked; st.playerId = main.querySelector('#pid').value.trim(); load(); };
    main.querySelector('#tbl').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) battleDetail(Number(tr.dataset.id)).catch(A.errToast); };
    await load();
    if (params[0]) battleDetail(Number(params[0])).catch(A.errToast);
  };

  Views['hero-seasons'] = async function (main) {
    const d = await A.get('/hero/seasons'), cfg = await heroCfg(), SS = cfg.season;
    main.innerHTML = `<h1>🗓 賽季</h1><p class="sub">結算時：依最終段位（＋前 N 名加碼）把獎勵寄到玩家信箱（需至少 ${SS.minBattles} 場本季對戰），所有分數向 ${cfg.pvp.startRating} 軟重置 ${Math.round(SS.softReset * 100)}%，並開新賽季。</p>
      <div class="card"><h3>段位獎勵</h3><table><tr>${cfg.ranks.map((r) => `<th>${rk(r.name, r.color)} ${r.min}+</th>`).join('')}</tr><tr>${cfg.ranks.map((r) => { const x = (SS.rewards || {})[r.key] || {}; return `<td>🪙${x.coins || 0}${x.gems ? ' 💎' + x.gems : ''}</td>`; }).join('')}</tr></table>
      <p class="muted">前 N 名加碼：${(SS.topBonus || []).map((t) => `前 ${t.top} 名 🪙${t.coins || 0}${t.gems ? ' 💎' + t.gems : ''}`).join('・')}（在「英雄設定」的 season 區段修改）</p></div>
      <div class="card"><h3>賽季列表</h3><table><tr><th>#</th><th>名稱</th><th>開始</th><th>結束</th><th>參與 / 發獎</th></tr>${d.seasons.map((s) => `<tr><td>${s.id}</td><td>${h(s.name)}${s.closed_at ? '' : ' <span class="badge b-ok">進行中</span>'}</td><td>${A.fmtTime(s.started_at)}</td><td>${A.fmtTime(s.closed_at)}</td><td>${s.summary ? `${s.summary.participants} / ${s.summary.rewarded}` : '—'}</td></tr>`).join('')}</table>
      <div class="btns" style="margin-top:10px"><input id="nn" placeholder="新賽季名稱（選填）"><button class="btn danger" id="close">結算目前賽季</button></div></div>`;
    main.querySelector('#close').onclick = async () => {
      const c = await A.promptDlg('結算賽季', '這會寄出獎勵並重置分數，無法復原。請輸入 CLOSE 確認', '', '結算', true);
      if (c == null) return;
      try { const r = await A.post('/hero/seasons/close', { confirm: c, nextName: main.querySelector('#nn').value.trim() || undefined }); A.toast(`已結算：${r.participants} 人參與、${r.rewarded} 份獎勵寄出`); Views['hero-seasons'](main); } catch (e) { A.errToast(e); }
    };
  };

  Views['hero-config'] = async function (main) {
    const d = await A.get('/hero/config');
    let base = d.version;
    main.innerHTML = `<h1>⚙️ 英雄設定 <span class="muted">v${d.version}</span></h1><p class="sub">所有數值（能力、技能、訓練、裝備價格、配對、積分、段位、賽季獎勵）都在這份 JSON。儲存前會完整驗證；每次儲存都是新版本，可隨時回滾。儲存後背景會重新計算各魚種的公平係數。</p>
      <div class="row"><div class="grow"><div class="btns" style="margin-bottom:8px"><button class="btn" id="val">驗證</button><button class="btn primary" id="save">儲存為新版本</button><button class="btn ghost" id="def">載入預設值</button><input id="note" placeholder="版本說明" size="24"></div>
      <div id="errs"></div><textarea class="code" id="ed" spellcheck="false"></textarea></div>
      <div class="card" style="width:300px"><h3>版本</h3><div id="vers" class="loading">載入中…</div></div></div>`;
    const ed = main.querySelector('#ed'); ed.value = JSON.stringify(d.config, null, 2);
    const parse = () => { try { return JSON.parse(ed.value); } catch (e) { main.querySelector('#errs').innerHTML = A.errList(['JSON 格式錯誤：' + e.message]); return null; } };
    async function vers() {
      const v = await A.get('/hero/config/versions');
      main.querySelector('#vers').outerHTML = `<table id="vers">${v.versions.map((x) => `<tr><td>v${x.version}${x.version === v.active ? ' <span class="badge b-ok">使用中</span>' : ''}<div class="muted mini">${A.fmtTime(x.created_at || x.createdAt)}・${h(x.note || '')}</div></td><td>${x.version === v.active ? '' : `<button class="btn small" data-rb="${x.version}">回滾</button>`}</td></tr>`).join('')}</table>`;
    }
    main.querySelector('#val').onclick = async () => { const c = parse(); if (!c) return; const r = await A.post('/hero/config/validate', { config: c }); main.querySelector('#errs').innerHTML = r.errors.length ? A.errList(r.errors) : '<div class="banner info">✔ 驗證通過</div>'; };
    main.querySelector('#def').onclick = () => { ed.value = JSON.stringify(d.defaults, null, 2); A.toast('已載入預設值（尚未儲存）'); };
    main.querySelector('#save').onclick = async () => {
      const c = parse(); if (!c) return;
      try { const r = await A.put('/hero/config', { config: c, note: main.querySelector('#note').value.trim() || '後台編輯', baseVersion: base }); base = r.version; cfgCache = null; A.toast('已儲存為 v' + r.version); main.querySelector('#errs').innerHTML = ''; vers(); }
      catch (e) { main.querySelector('#errs').innerHTML = A.errList((e.data && e.data.errors) || [e.message]); }
    };
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rb]'); if (!b) return;
      if (!(await A.confirmDlg('回滾設定', `確定回滾到 v${b.dataset.rb}？（會建立新版本）`))) return;
      try { await A.post('/hero/config/rollback/' + b.dataset.rb); cfgCache = null; Views['hero-config'](main); } catch (er) { A.errToast(er); }
    });
    vers();
  };

  Views['hero-balance'] = async function (main) {
    main.innerHTML = `<h1>⚖️ 平衡模擬</h1><p class="sub">以「目前設定」（或編輯器中尚未儲存的設定）取樣模擬：每個魚種在同等級、無訓練／裝備下對隨機對手打 N 組。完整報表請跑 <span class="mono">npm test -- test/hero-balance.test.js</span>（hero/BALANCE.md）。目標：任何魚種勝率 ≤ 65%。</p>
      <div class="toolbar"><label class="f">等級<input id="lv" type="number" value="10" min="1" max="50"></label><label class="f">每魚種對手數<input id="op" type="number" value="12" min="4" max="40"></label><button class="btn primary" id="run">開始模擬</button><span class="muted">第一次需要校正公平係數，可能要數十秒</span></div><div id="out"></div>`;
    main.querySelector('#run').onclick = async (e) => {
      e.target.disabled = true; main.querySelector('#out').innerHTML = '<div class="loading">模擬中…</div>';
      try {
        const r = await A.post('/hero/balance', { level: Number(main.querySelector('#lv').value), opponents: Number(main.querySelector('#op').value) });
        const rows = r.rows.slice().sort((a, b) => b.winrate - a.winrate), max = rows[0], min = rows[rows.length - 1];
        const fam = r.families.slice().sort((a, b) => b.winrate - a.winrate);
        const tr = (x) => `<tr><td>${h(x.name)} <span class="muted mini">${h(x.id)}</span></td><td>${h(x.family)}</td><td class="num ${x.winrate > 0.65 ? 'err' : ''}">${(x.winrate * 100).toFixed(1)}%</td><td class="num">${x.fair}</td><td class="num">${x.hp}/${x.atk}/${x.def}/${x.spd}</td><td class="mini">${h((x.skills || []).join(', '))}</td></tr>`;
        main.querySelector('#out').innerHTML = `<div class="kpis"><div class="kpi"><div class="l">場數</div><div class="v">${A.fmtNum(r.battles)}</div><div class="s">${r.ms} ms</div></div><div class="kpi"><div class="l">最高勝率</div><div class="v ${max.winrate > 0.65 ? 'err' : ''}">${(max.winrate * 100).toFixed(1)}%</div><div class="s">${h(max.name)}</div></div><div class="kpi"><div class="l">最低勝率</div><div class="v">${(min.winrate * 100).toFixed(1)}%</div><div class="s">${h(min.name)}</div></div><div class="kpi"><div class="l">時間到比例</div><div class="v">${((r.timeouts / r.battles) * 100).toFixed(1)}%</div><div class="s">平均 ${Math.round(r.avgActions * 10) / 10} 動</div></div></div>
          <div class="grid2"><div class="card"><h3>科別勝率</h3>${Charts.hbars(fam.map((f) => ({ label: f.family, value: Math.round(f.winrate * 1000) / 10 })), { valueFmt: (v) => v + '%' })}</div>
          <div class="card"><h3>最強 / 最弱 15 種</h3><table><tr><th>魚種</th><th>科</th><th class="num">勝率</th><th class="num">公平係數</th><th class="num">生/攻/防/速</th><th>技能</th></tr>${rows.slice(0, 15).map(tr).join('')}<tr><td colspan="6" class="muted">…</td></tr>${rows.slice(-15).map(tr).join('')}</table></div></div>`;
      } catch (er) { main.querySelector('#out').innerHTML = A.errList((er.data && er.data.errors) || [er.message]); }
      e.target.disabled = false;
    };
  };
})();
