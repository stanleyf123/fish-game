// v4.5 後台唯讀報表：⚓ 玩家漁港（#harbor/ID）、👥 邀請報表（#invites）。只呼叫 GET /admin/api/reports/*，不改任何資料、不登入玩家帳號
(function () {
  const { h } = A;
  const tw = (t) => A.fmtTime(t);
  const pl = (id, name) => `<a href="#player/${+id}">#${+id}</a> ${h(name || '')}`;
  // FRIENDTANK-ADMIN-BEGIN 🐠 開啟魚缸畫面（唯讀）：用遊戲本身的唯讀檢視 /?viewTank=ID&ftadmin=1 畫出玩家真正的魚缸（同一套畫法）。
  // 檢視頁不寫存檔、不建帳號、不送 GA；資料走 GET /admin/api/social/tank/:id（後台登入才能讀）。前端還沒更新前按鈕會顯示「尚未上線」。
  let ftOk = null;
  const ftProbe = () => ftOk || (ftOk = fetch('/?ftprobe=1', { cache: 'no-cache', credentials: 'omit' }).then((r) => r.text()).then((t) => t.includes('FRIENDTANK-VIEW-SHIM')).catch(() => false));
  const ftUrl = (id) => '/?viewTank=' + (+id) + '&ftadmin=1';
  const ftBtn = (id, label) => { const a = document.createElement('a'); a.className = 'btn small ft-open'; a.href = ftUrl(id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = label || '🐠 開啟魚缸畫面（唯讀）'; a.style.marginLeft = '10px'; a.style.verticalAlign = 'middle';
    ftProbe().then((ok) => { if (!ok) { a.removeAttribute('href'); a.style.opacity = '.5'; a.style.cursor = 'not-allowed'; a.title = '遊戲前端尚未更新（唯讀魚缸檢視還沒上線）'; a.textContent += '・尚未上線'; } }); return a; };
  // FRIENDTANK-ADMIN-END
  // ---------- ⚓ 玩家漁港 ----------
  Views.harbor = async function (main, params) {
    const id = +(params && params[0]);
    const [d, meta, tanks] = await Promise.all([A.get('/reports/harbor/' + id), A.get('/config').catch(() => null),A.get('/social/tank/'+id)]);
    const P = d.player, T = d.tank || { fish: [], total: 0 }, cfg = meta && meta.config;
    const spName = (sp) => (window.AdminFishThumbs ? AdminFishThumbs.label(sp, cfg) : ((cfg && cfg.species && cfg.species[sp] && cfg.species[sp].name) || sp)); /*ADMINART-V1 混種 hx: 代號解碼成名稱*/
    main.innerHTML = `<p><a href="#player/${id}">← 返回玩家 #${id}</a>　<a href="#players">玩家列表</a></p>
      <h1>⚓ 玩家 #${id} ${h(P.nickname || '')} 的漁港 <span class="badge">唯讀</span></h1>
      <p class="sub">這是其他玩家在漁港拜訪時看到的魚缸（同一套挑選規則），以及這位玩家的漁港紀錄。後台只讀取，不會登入玩家帳號、不會改存檔。</p>
      <div class="kpis">
        <div class="kpi"><div class="l">漁港公開狀態</div><div class="v">${d.visitable ? '✅ 開放' : '🚫 不公開'}</div><div class="s">${h(d.hiddenWhy.join('・') || '會出現在推薦／搜尋')}</div></div>
        <div class="kpi"><div class="l">玩家等級</div><div class="v">Lv${d.level}</div><div class="s">${P.member ? '會員' : '訪客'}・最近上線 ${A.ago(P.last_seen)}</div></div>
        <div class="kpi"><div class="l">魚（訪客看到／全部）</div><div class="v">${T.fish.length} / ${T.total}</div><div class="s">餓肚子 ${T.hungry || 0} 條・借魚繁殖 ${T.breedOpen === false || (d.prefs && d.prefs.breedOpen === false) ? '不開放' : '開放'}</div></div>
        <div class="kpi"><div class="l">好友</div><div class="v">${d.friends ? d.friends.accepted.length : '—'}</div><div class="s">${d.friends ? `上限 ${d.friends.max}・待回覆 ${d.friends.incoming.length}・已送出 ${d.friends.outgoing.length}` : ''}</div></div>
        <div class="kpi"><div class="l">30 天幫忙餵食</div><div class="v">${d.helps ? d.helps.given30.n : '—'} / ${d.helps ? d.helps.got30.n : '—'}</div><div class="s">${d.helps ? `幫別人（🪙${A.fmtNum(d.helps.given30.coins)}）／被幫忙` : ''}</div></div></div>
      <div class="card"><h3>🐠 訪客看到的魚缸</h3><div id="hbFish" style="display:flex;flex-wrap:wrap;gap:10px">${T.fish.map((f, i) => `<div style="width:120px;text-align:center;background:rgba(0,0,0,.18);border-radius:10px;padding:6px"><canvas data-i="${i}" width="216" height="140" style="width:108px;height:70px"></canvas><div class="mini"><b>${h(f.name || spName(f.sp))}</b></div><div class="mini muted"><span data-spn="${i}">${h(spName(f.sp))}</span>${f.hungry ? '・🍽 餓了' : ''}</div></div>`).join('') || '<p class="muted">沒有魚</p>'}</div>
        ${T.deco && T.deco.length ? `<p class="mini muted">裝飾：${T.deco.map(h).join('、')}</p>` : ''}</div>
      ${d.friends ? `<div class="card"><h3>👫 好友</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>玩家</th><th>狀態</th><th>更新</th><th></th></tr></thead><tbody>${[...d.friends.accepted.map((r) => [r, '好友']), ...d.friends.incoming.map((r) => [r, '待回覆（對方邀請）']), ...d.friends.outgoing.map((r) => [r, '已送出邀請'])].map(([r, s]) => `<tr><td>${pl(r.id, r.nickname)}</td><td>${s}</td><td>${tw(r.updated_at)}</td><td><a class="btn small" href="#harbor/${+r.id}">⚓ 漁港</a></td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有好友</td></tr>'}</tbody></table></div></div>` : ''}
      ${d.helps ? `<div class="card"><h3>🍤 幫忙餵食（最近 30 筆）</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>誰 → 誰的魚缸</th><th>獎勵</th></tr></thead><tbody>${d.helps.recent.map((r) => `<tr><td>${tw(r.created_at)}</td><td>${pl(r.helper_id, r.helper_name)} → ${pl(r.owner_id, r.owner_name)}${r.friend ? ' <span class="badge">好友</span>' : ''}</td><td>${r.reward ? '🪙' + A.fmtNum(r.reward) : '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">沒有紀錄</td></tr>'}</tbody></table></div></div>` : ''}
      ${d.breeds ? `<div class="card"><h3>🐣 借魚繁殖（最近 30 筆）</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>借魚的人 → 主人</th><th>寶寶</th><th>花費</th></tr></thead><tbody>${d.breeds.map((b) => `<tr><td>${tw(b.created_at)}</td><td>${pl(b.requester_id)} → ${pl(b.owner_id)}</td><td>${h(spName(b.child_sp))}</td><td>${b.gems + b.extra_gems ? '💎' + (b.gems + b.extra_gems) : ''}${b.coins ? ' 🪙' + A.fmtNum(b.coins) : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有紀錄</td></tr>'}</tbody></table></div></div>` : ''}`;
    {const card=document.createElement('section');card.className='card';card.innerHTML=`<h3>🐠 多魚缸 · 已解鎖 ${tanks.tanks.length} 缸</h3><div class="btns">${tanks.tanks.map(t=>`<a class="btn" href="${ftUrl(id)}&tankSlot=${t.slot}" target="_blank" rel="noopener">${h(t.name)} · 🐟${t.fishCount} · 🌿${t.plantCount}${t.active?'（玩家使用中）':''} ↗</a>`).join('')}</div><p class="muted">點選任一魚缸可唯讀查看，不會替玩家切缸。</p>`;main.querySelector('h1').after(card)}
    { const h1 = main.querySelector('h1'); if (h1) h1.appendChild(ftBtn(id)); /*FRIENDTANK-ADMIN*/
      const fc = main.querySelector('#hbFish'); if (fc) ftProbe().then((ok) => { if (!ok || !fc.isConnected) return; const card = document.createElement('div'); card.className = 'card'; card.innerHTML = '<h3>🐠 魚缸畫面（唯讀，和玩家看到的一樣）</h3><div style="position:relative;width:100%;max-width:980px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0a3550"><iframe src="' + ftUrl(id) + '&ftembed=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" loading="lazy" title="魚缸畫面"></iframe></div>'; fc.closest('.card').before(card); }); }
    if (window.FishRender && cfg) main.querySelectorAll('#hbFish canvas').forEach((c) => { const f = T.fish[+c.dataset.i]; const sp = cfg.species[f.sp]; if (!sp) return; try { FishRender.drawPreview(c, FishRender.resolve(sp, f.sp), { t: 1.2, hue: f.hue }); } catch (e) { /* 預覽失敗不影響頁面 */ } });
    /*ADMINART-V1 先用上面程式畫的當備用，再換成遊戲本身的美術（同一套 preview：GIANTART／GEMART／ARTUP／混種圖）；唯讀*/
    if (window.AdminFishThumbs) { const fc = main.querySelector('#hbFish'); if (fc) ftProbe().then((ok) => { if (!ok || !fc.isConnected) return; AdminFishThumbs.apply(id, [...fc.querySelectorAll('canvas[data-i]')].map((c) => { const f = T.fish[+c.dataset.i] || {}; return { canvas: c, sp: f.sp, hue: f.hue, nameEl: fc.querySelector('[data-spn="' + c.dataset.i + '"]') }; })).catch(() => {}); }); }
  };
  // 玩家詳細頁：標題下方加「⚓ 查看漁港」
  const origPlayer = Views.player;
  if (origPlayer) Views.player = async function (main, params) {
    await origPlayer(main, params);
    const id = +(params && params[0]); if (!id) return;
    const h1 = main.querySelector('h1'); if (!h1 || main.querySelector('#harborLink')) return;
    const a = document.createElement('a'); a.id = 'harborLink'; a.className = 'btn small'; a.href = '#harbor/' + id; a.textContent = '⚓ 查看漁港（唯讀）'; a.style.marginLeft = '10px'; a.style.verticalAlign = 'middle';
    const links=main.querySelector('.player-view-actions')||h1;links.appendChild(a);links.appendChild(ftBtn(id)); /*FRIENDTANK-ADMIN*/
    const card = main.querySelector('#harborFlag h3'); if (card) { const b = a.cloneNode(true); b.id = 'harborLink2'; card.appendChild(b); }
  };
  // ---------- 👥 邀請報表 ----------
  Views.invites = async function (main) {
    const st = Views.invites.state || (Views.invites.state = { from: '', to: '', inviter: '' });
    const qs = () => new URLSearchParams({ from: st.from, to: st.to, inviter: st.inviter }).toString();
    main.innerHTML = `<h1>👥 邀請報表 <span class="badge">唯讀</span></h1><p class="sub">邀請連結 → 註冊 → 符合資格（玩滿時間、有魚）→ 雙方各得獎勵。日期以台北時間計算。</p>
      <div class="toolbar"><label>從 <input type="date" id="ivFrom" value="${h(st.from)}"></label><label>到 <input type="date" id="ivTo" value="${h(st.to)}"></label>
        <input type="search" id="ivInv" placeholder="邀請人 #ID／暱稱／邀請碼" value="${h(st.inviter)}"><button class="btn" id="ivGo">篩選</button><button class="btn ghost" id="ivClr">清除</button><a class="btn" id="ivCsv" href="#">⬇️ 匯出 CSV</a></div><div id="ivBody"><div class="loading">載入中…</div></div>`;
    const body = main.querySelector('#ivBody');
    async function load() {
      main.querySelector('#ivCsv').href = '/admin/api/reports/invites.csv?' + qs();
      const d = await A.get('/reports/invites?' + qs()), S = d.summary, C = d.config;
      const pay = (x) => (x ? `${x.kind === 'gems' ? '💎' : '🪙'}${A.fmtNum(x.qty)}<div class="mini muted">${tw(x.at)}・${x.claimed_at ? '已領' : '未領'}</div>` : '—');
      const card = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
      body.innerHTML = `<div class="kpis">${card('連結點擊', '未追蹤', '只記錄用連結建立的新訪客')}${card('連結帶入', A.fmtNum(S.attached), `擋下 ${A.fmtNum(S.rejected)}`)}${card('註冊', A.fmtNum(S.signups))}${card('符合資格', A.fmtNum(S.qualified))}
          ${card('已發金幣', '🪙' + A.fmtNum(S.coinsTotal), `邀請人 🪙${A.fmtNum(S.coinsInviter)}（${S.inviterRewarded} 筆）・被邀請者 🪙${A.fmtNum(S.coinsInvitee)}（${S.inviteeRewarded} 筆）${S.gemsInviter ? '・💎' + S.gemsInviter : ''}`)}${card('目前設定', `${C.rewardKind === 'gems' ? '💎' : '🪙'}${A.fmtNum(C.rewardQty)} + 🪙${A.fmtNum(C.inviteeCoins)}`, `每月上限 ${d.cap}・需玩 ${C.minPlayMin} 分鐘・${C.minFish} 條魚`)}</div>
        <div class="card"><h3>邀請明細（${d.rows.length} 筆）</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>邀請人</th><th>被邀請者</th><th>邀請碼</th><th>邀請時間</th><th>綁定</th><th>等級</th><th>符合資格</th><th>邀請人獎勵</th><th>被邀請者獎勵</th><th>阻擋／濫用</th></tr></thead><tbody>
          ${d.rows.map((r) => `<tr><td>${pl(r.inviter_id, r.inviter_name)}</td><td>${pl(r.invitee_id, r.invitee_name)}</td><td><code>${h(r.code)}</code></td><td class="nowrap">${tw(r.invited_at)}</td><td>${h(r.bind)}</td><td>Lv${r.invitee_level}<div class="mini muted">${r.invitee_fish} 條魚</div></td>
            <td>${r.qualified ? '✅ 是' : '— 否'}<div class="mini muted">${r.qualified_at ? tw(r.qualified_at) : h(r.qualified_note)}</div></td><td>${pay(r.inviter_paid)}</td><td>${pay(r.invitee_paid)}</td><td>${r.blocked ? `<span class="badge" style="color:#ff9b8a">${h(r.blocked)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">沒有資料</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3>每位邀請人・本月（${h(d.month)}）已發獎 vs 上限 ${d.cap}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>邀請人</th><th>本月</th><th>累計發獎</th><th>累計邀請</th><th>擋下</th><th>因上限未發</th></tr></thead><tbody>
          ${d.perInviter.map((r) => `<tr><td>${pl(r.id, r.name)}</td><td><b style="color:${r.atCap ? '#ff9b8a' : 'inherit'}">${r.month} / ${d.cap}</b>${r.atCap ? ' <span class="badge">已達上限</span>' : ''}</td><td>${r.rewarded}</td><td>${r.total}</td><td>${r.rejected}</td><td>${r.capped}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">沒有資料</td></tr>'}</tbody></table></div></div>`;
    }
    const go = () => { st.from = main.querySelector('#ivFrom').value; st.to = main.querySelector('#ivTo').value; st.inviter = main.querySelector('#ivInv').value.trim(); load().catch((e) => { body.innerHTML = `<div class="errors">載入失敗：${h(e.message)}</div>`; }); };
    main.querySelector('#ivGo').onclick = go; main.querySelector('#ivInv').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    main.querySelector('#ivClr').onclick = () => { st.from = st.to = st.inviter = ''; Views.invites(main); };
    await load();
  };
})();
