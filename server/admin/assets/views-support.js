// 💬 客服訊息：收件匣（未讀優先、狀態／分類篩選、信箱或玩家編號搜尋）＋對話（玩家資料、回覆、結案／重新開啟）
// 所有玩家文字一律經 A.h() 跳脫；換行用 CSS white-space:pre-wrap 顯示，不轉成 HTML
(function () {
  const { h } = A;
  let badgeTimer = null;
  async function updBadge(n) {
    try { if (n == null) n = (await A.get('/support/unread')).threads; } catch (e) { return; }
    const b = document.getElementById('supBadge'); if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !(n > 0));
  }
  function startBadge() { if (badgeTimer) return; updBadge(); badgeTimer = setInterval(() => { if (!document.hidden) updBadge(); }, 60000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updBadge(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startBadge); else startBadge();
  const st = { status: '', category: '', q: '' };
  // 📷 SUP-IMG-420：圖片縮圖＋點開大圖、回覆可附圖（共用 /sdk/support-photos.js）
  let pxP = null, comp = null;
  const px = () => { if (window.FFSupPhotos) return Promise.resolve(window.FFSupPhotos); if (pxP) return pxP;
    pxP = new Promise((res) => { const s = document.createElement('script'); s.src = '/sdk/support-photos.js?v=420-sp1'; s.onload = () => res(window.FFSupPhotos || null); s.onerror = () => { pxP = null; res(null); }; document.head.appendChild(s); }); return pxP; };
  const imgSrc = (tok) => '/admin/api/support/images/' + encodeURIComponent(tok);
  const imgs = (m) => (m.images && m.images.length ? `<div class="sp-imgs" data-sp-group>${m.images.map((i) => `<button type="button" class="sp-th" data-sp-img="${h(i.id)}" aria-label="查看圖片"></button>`).join('')}</div>` : '');
  const catBadge = (c) => `<span class="badge sup-cat">${h(c)}</span>`;
  const stBadge = (s) => `<span class="badge ${s === 'open' ? 'b-ok' : 'b-off'}">${s === 'open' ? '處理中' : '已結案'}</span>`;

  Views.support = async function (main, params) {
    if (params && params[0]) return thread(main, +params[0]);
    const qs = new URLSearchParams(); for (const k of ['status', 'category', 'q']) if (st[k]) qs.set(k, st[k]);
    const d = await A.get('/support/threads' + (qs.toString() ? '?' + qs : ''));
    updBadge(d.unread.threads);
    main.innerHTML = `<h1>💬 客服訊息</h1><p class="sub">未讀 <b>${A.fmtNum(d.unread.threads)}</b> 個對話（${A.fmtNum(d.unread.messages)} 則訊息）・未讀優先排序</p>
      <div class="toolbar sup-tools"><select id="supSt"><option value="">全部狀態</option><option value="open" ${st.status === 'open' ? 'selected' : ''}>處理中</option><option value="closed" ${st.status === 'closed' ? 'selected' : ''}>已結案</option></select>
        <select id="supCat"><option value="">全部分類</option>${d.categories.map((c) => `<option ${st.category === c ? 'selected' : ''}>${h(c)}</option>`).join('')}</select>
        <input type="search" id="supQ" placeholder="信箱、暱稱或玩家編號" value="${h(st.q)}"><button class="btn small" id="supGo">搜尋</button></div>
      <div class="sup-list">${d.threads.map((t) => `<a class="sup-item${t.adminUnread ? ' unread' : ''}" href="#support/${t.id}">
          <div class="sup-top"><b>${h(t.nickname || '玩家')}</b> <span class="muted">#${t.playerId}・${h(t.account || '（無信箱）')}</span>${t.adminUnread ? `<span class="sup-n">${t.adminUnread}</span>` : ''}</div>
          <div class="sup-mid">${catBadge(t.category)} ${stBadge(t.status)} <span class="muted">${t.lastFrom === 'admin' ? '↩ 已回覆' : '玩家'}・${A.ago(t.lastMsgAt)}・${t.count} 則</span></div>
          <div class="sup-prev">${h(t.preview)}</div></a>`).join('') || '<div class="card muted">沒有符合的對話</div>'}</div>`;
    const go = () => { st.status = main.querySelector('#supSt').value; st.category = main.querySelector('#supCat').value; st.q = main.querySelector('#supQ').value.trim(); Views.support(main, []); };
    main.querySelector('#supSt').onchange = go; main.querySelector('#supCat').onchange = go; main.querySelector('#supGo').onclick = go;
    main.querySelector('#supQ').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  };

  // Mobile uses page scrolling; desktop keeps a bounded chat pane.
  function showLatest(chat) {
    let stopped = false, observer;
    const events = ['touchstart', 'wheel', 'keydown', 'pointerdown'];
    const stop = () => {
      stopped = true;
      if (observer) observer.disconnect();
      chat.removeEventListener('load', position, true);
      events.forEach(name => window.removeEventListener(name, stop, true));
    };
    const position = () => {
      if (stopped || !chat.isConnected) return stop();
      chat.scrollTop = chat.scrollHeight;
      const latest = chat.lastElementChild;
      if (latest) latest.scrollIntoView({ block: 'end', behavior: 'instant' });
    };
    chat.addEventListener('load', position, true);
    events.forEach(name => window.addEventListener(name, stop, { capture: true, passive: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      position();
      if (!stopped && window.ResizeObserver) {
        observer = new ResizeObserver(position);
        observer.observe(chat);
        if (chat.lastElementChild) observer.observe(chat.lastElementChild);
      }
    }));
    setTimeout(stop, 8000);
  }

  async function thread(main, id) {
    const d = await A.get('/support/threads/' + id);
    render(main, d);
  }
  function render(main, d) {
    updBadge(d.unread.threads);
    const t = d.thread, p = d.player;
    main.innerHTML = `<p><a href="#support">← 回收件匣</a></p>
      <h1>💬 ${h(p.nickname || '玩家')} <small class="muted">#${p.id}</small></h1>
      <div class="card sup-info"><div class="sup-kv"><span>帳號</span><b>${h(p.account || '—')}</b></div><div class="sup-kv"><span>等級</span><b>Lv${p.level}（圖鑑 ${p.found} 種）</b></div>
        <div class="sup-kv"><span>金幣</span><b>${A.fmtNum(p.coins)}</b></div><div class="sup-kv"><span>寶石</span><b>💎${A.fmtNum(p.gems)}</b></div><div class="sup-kv"><span>魚</span><b>${A.fmtNum(p.fish)} 條</b></div>
        <div class="sup-kv"><span>註冊</span><b>${A.fmtTime(p.createdAt)}</b></div><div class="sup-kv"><span>最後上線</span><b>${A.ago(p.lastSeen)}</b></div>${p.banned ? '<div class="sup-kv"><span>狀態</span><b class="err">已停權</b></div>' : ''}
        <div class="btns" style="margin-top:8px"><a class="btn small" href="#player/${p.id}">👤 玩家頁面</a>${catBadge(t.category)} ${stBadge(t.status)}
          <button class="btn small ${t.status === 'open' ? '' : 'primary'}" id="supStatus">${t.status === 'open' ? '✅ 結案' : '↺ 重新開啟'}</button></div>
        ${d.orders.length ? `<details style="margin-top:8px"><summary class="muted">最近訂單（${d.orders.length}）</summary><table>${d.orders.map((o) => `<tr><td class="mono">${h(o.id)}</td><td>${h(o.name)}</td><td class="num">${o.currency === 'GEM' ? '💎' : 'NT$'}${A.fmtNum(o.amount)}</td><td>${A.statusBadge(o.status)}</td><td class="muted">${A.fmtTime(o.at)}</td></tr>`).join('')}</table></details>` : ''}</div>
      <div class="sup-chat" id="supChat">${d.messages.map((m) => `<div class="sup-msg ${m.from === 'admin' ? 'me' : 'them'}"><div class="sup-meta">${m.from === 'admin' ? '🛠 管理員' : '🙂 玩家'}${m.category ? ' ・' + h(m.category) : ''}・${A.fmtTime(m.at)}</div>${m.body ? `<div class="sup-body">${h(m.body)}</div>` : ''}${imgs(m)}</div>`).join('')}</div>
      <div class="card sup-reply"><textarea id="supTxt" maxlength="2000" rows="3" placeholder="回覆玩家…（玩家會在遊戲內看到紅點與通知）"></textarea><div id="supAttBar" class="sp-bar"></div><div id="supAtt"></div>
        <div class="btns"><button class="btn primary" id="supSend">送出回覆</button><span class="muted" id="supLen">0 / 2000</span></div></div>`;
    const chat = main.querySelector('#supChat'); showLatest(chat);
    if (comp) comp.destroy(); comp = null;
    const bar = main.querySelector('#supAttBar'), lst = main.querySelector('#supAtt');
    px().then((P) => { if (!P || !bar.isConnected) return; P.hydrate(chat, { src: imgSrc });
      comp = new P.Composer({ bar, list: lst, max: 3, uploadUrl: '/admin/api/support/uploads/' + t.id, headers: async () => ({ 'X-CSRF-Token': (await A.get('/session')).csrf }),
        del: (tok) => A.del('/support/images/' + encodeURIComponent(tok)).catch(() => {}), toast: (m, bad) => A.toast(m, bad) }); });
    const txt = main.querySelector('#supTxt');
    txt.oninput = () => { main.querySelector('#supLen').textContent = `${txt.value.length} / 2000`; };
    main.querySelector('#supSend').onclick = async (e) => {
      const v = txt.value.trim(), c = comp && bar.isConnected ? comp : null;
      if (c && c.busy()) return A.toast('📷 圖片還在上傳，請稍候', true);
      if (c && c.failed()) return A.toast('📷 有圖片上傳失敗，請重試或移除', true);
      const im = c ? c.tokens() : [];
      if (!v && !im.length) return A.toast('請輸入回覆內容或附加圖片', true);
      e.target.disabled = true;
      try { const d = await A.post(`/support/threads/${t.id}/reply`, im.length ? { body: v, images: im } : { body: v }); if (c) c.clear(); comp = null; render(main, d); A.toast('已回覆'); } catch (err) { A.errToast(err); e.target.disabled = false; }
    };
    main.querySelector('#supStatus').onclick = async () => {
      try { render(main, await A.post(`/support/threads/${t.id}/status`, { status: t.status === 'open' ? 'closed' : 'open' })); } catch (err) { A.errToast(err); }
    };
  }
})();
