// ⚓ 漁港：今日／7 天統計（幫忙餵食、借魚繁殖、寶石／金幣）、好友數、熱心玩家、最近繁殖；數值設定在「遊戲設定 → ⚓ 漁港」
(function () {
  const { h } = A;
  Views.social = async function (main) {
    const d = await A.get('/social/stats');
    const T = d.today, W = d.week, C = d.config;
    const card = (t, v, s) => `<div class="card stat"><div class="k">${h(t)}</div><div class="v">${h(v)}</div>${s ? `<div class="sub">${h(s)}</div>` : ''}</div>`;
    main.innerHTML = `<h1>⚓ 漁港</h1><p class="sub">台北日期 ${h(d.day)}・數值（獎勵、次數、價格）在 <a href="#game">遊戲設定 → ⚓ 漁港</a> 調整</p>
      <div class="grid stats">${card('今日幫忙餵食', A.fmtNum(T.helps.n), `發出 🪙${A.fmtNum(T.helps.coins)}`)}${card('今日借魚繁殖', A.fmtNum(T.breeds.n), `💎 限定 ${A.fmtNum(T.breeds.gem || 0)}・加購 ${A.fmtNum(T.breeds.extra || 0)}`)}
        ${card('今日繁殖花費', `💎${A.fmtNum(T.breeds.gems)}`, `🪙${A.fmtNum(T.breeds.coins)}`)}${card('7 天', `餵食 ${A.fmtNum(W.helps.n)}・繁殖 ${A.fmtNum(W.breeds.n)}`, `💎${A.fmtNum(W.breeds.gems)}・🪙${A.fmtNum(W.breeds.coins)}`)}
        ${d.breedUses ? card('今日繁殖（全部）', A.fmtNum(d.breedUses.n || 0), `自家 ${A.fmtNum(d.breedUses.own || 0)}・漁港 ${A.fmtNum(d.breedUses.harbor || 0)}・加購 💎${A.fmtNum(d.breedUses.gems || 0)}`) : ''}${card('好友關係', A.fmtNum(d.friends.accepted || 0), `待回覆邀請 ${A.fmtNum(d.friends.pending || 0)}`)}${card('不開放借魚', A.fmtNum(d.optOut), '位玩家')}${card('不開放漁港拜訪', A.fmtNum(d.hidden || 0), '位玩家（後台或自己設定）')}</div>
      <div class="card"><h3>目前設定</h3><div class="tbl-wrap"><table class="tbl"><tbody>
        <tr><td>幫忙餵食獎勵</td><td>陌生人 🪙${h(C.help.rewardStranger)}／好友 🪙${h(C.help.rewardFriend)} ＋ 每級 🪙${h(C.help.rewardPerLevel)}（上限 🪙${h(C.help.rewardMax)}）・每天最多 ${h(C.help.dailyRewarded)} 次有獎勵・同一人每天 1 次・主人獲得 🪙${h(C.help.ownerBonus)}</td></tr>
        <tr><td>借魚繁殖</td><td>與自家繁殖共用每日次數（「遊戲設定 → 🐣 每日繁殖次數」）・一般魚 🪙${h(C.breed.coinBase)} ＋ 稀有度 × 🪙${h(C.breed.coinPerRarity)}・限定魚 💎 = 限定魚售價 × ${h(C.breed.gemFactor)}（${h(C.breed.gemMin)}–${h(C.breed.gemMax)}）・主人借魚費 🪙${h(C.breed.studFee)}</td></tr>
        <tr><td>好友</td><td>上限 ${h(C.friends.max)} 位・每小時最多 ${h(C.friends.requestsPerHour)} 次邀請</td></tr></tbody></table></div></div>
      <div class="card"><h3>7 天熱心玩家</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>玩家</th><th>餵食次數</th><th>獲得金幣</th></tr></thead><tbody>
        ${d.topHelpers.map((r) => `<tr><td><a href="#player/${+r.id}">#${+r.id} ${h(r.nickname || '')}</a></td><td>${A.fmtNum(r.n)}</td><td>🪙${A.fmtNum(r.coins || 0)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">還沒有資料</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>最近借魚繁殖</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>玩家 → 主人</th><th>寶寶</th><th>花費</th></tr></thead><tbody>
        ${d.recentBreeds.map((b) => `<tr><td>${A.fmtTime(b.created_at)}</td><td><a href="#player/${+b.requester_id}">#${+b.requester_id}</a> → <a href="#player/${+b.owner_id}">#${+b.owner_id}</a></td><td>${h(b.child_sp)} <span class="sub">${h(b.kind || '')}</span></td><td>${b.gems + b.extra_gems ? `💎${A.fmtNum(b.gems + b.extra_gems)}` : ''} ${b.coins ? `🪙${A.fmtNum(b.coins)}` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">還沒有資料</td></tr>'}</tbody></table></div></div>`;
  };
  // 玩家頁面：「不開放漁港拜訪」開關（帳號旗標 players.no_visits，不動遊戲存檔；寫入稽核紀錄）
  const origPlayer = Views.player;
  if (origPlayer) Views.player = async function (main, params) {
    await origPlayer(main, params);
    const id = +(params && params[0]); if (!id) return;
    let d; try { d = await A.get('/social/players/' + id); } catch (e) { return; }
    const box = document.createElement('div'); box.className = 'card'; box.id = 'harborFlag';
    box.innerHTML = `<h3>⚓ 漁港</h3><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="noVisits" ${d.noVisits ? 'checked' : ''}> <b>不開放漁港拜訪</b></label>
      <p class="sub">勾選後：不會出現在推薦／搜尋／好友名單，無法被拜訪、幫忙餵食或借魚繁殖；本人仍可使用漁港。玩家自己的設定：${d.prefs.visitable ? '開放拜訪' : '不開放拜訪'}・${d.prefs.breedOpen ? '開放借魚' : '不開放借魚'}</p><span id="noVisitsMsg" class="sub"></span>`;
    main.appendChild(box);
    box.querySelector('#noVisits').onchange = async (e) => {
      const m = box.querySelector('#noVisitsMsg');
      try { const r = await A.post('/social/players/' + id + '/visits', { hidden: e.target.checked }); m.textContent = r.noVisits ? '✓ 已設為不開放拜訪' : '✓ 已開放拜訪'; }
      catch (err) { m.textContent = '✗ ' + (err.message || '失敗'); e.target.checked = !e.target.checked; }
    };
  };
})();
