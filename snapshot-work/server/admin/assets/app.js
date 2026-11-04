// 後台核心：API 呼叫、路由、共用元件
window.Views = {};
window.A = (function () {
  let csrf = null;
  const meta = { data: null };
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tf = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtTime = (ms) => (ms ? tf.format(new Date(ms)) : '—');
  const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString('zh-TW'));
  const fmtDur = (ms) => { if (!ms || ms < 0) return '—'; const m = Math.round(ms / 60000); return m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 時 ${m % 60} 分`; };
  const ago = (ms) => { if (!ms) return '—'; const s = (Date.now() - ms) / 1000; if (s < 60) return '剛剛'; if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`; if (s < 86400) return `${Math.floor(s / 3600)} 小時前`; return `${Math.floor(s / 86400)} 天前`; };
  // datetime-local（以瀏覽器時區解讀；營運人員在台灣即為台灣時間）
  const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocalInput = (s) => (s ? new Date(s).getTime() : null);

  async function api(method, url, body) {
    const opt = { method, headers: {} , credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (method !== 'GET') opt.headers['X-CSRF-Token'] = csrf || '';
    const r = await fetch('/admin/api' + url, opt);
    if (r.status === 401) { location.href = '/admin/login'; throw new Error('未登入'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || `錯誤 ${r.status}`); e.data = j; e.status = r.status; throw e; }
    return j;
  }
  const get = (u) => api('GET', u);
  const post = (u, b) => api('POST', u, b || {});
  const put = (u, b) => api('PUT', u, b || {});
  const del = (u) => api('DELETE', u);

  function toast(msg, bad) {
    const el = document.createElement('div'); el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg;
    document.getElementById('toasts').appendChild(el); setTimeout(() => el.remove(), bad ? 6000 : 3000);
  }
  function errToast(e) { toast(e.message + (e.data && e.data.errors ? `（${e.data.errors.length} 項錯誤）` : ''), true); }

  const modal = document.getElementById('modal');
  let modalOrigin=null;
  function openModal(html) { if(modal.classList.contains('hidden')&&!modalOrigin)modalOrigin=document.activeElement;const body=document.getElementById('modalBody');body.innerHTML=html;const box=modal.querySelector('.modal-box'),heading=body.querySelector('h2,h3');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');if(heading){heading.id='adminModalTitle';box.setAttribute('aria-labelledby',heading.id);box.removeAttribute('aria-label')}else{box.removeAttribute('aria-labelledby');box.setAttribute('aria-label','管理操作視窗')}modal.classList.remove('hidden');requestAnimationFrame(()=>{if(!modal.classList.contains('hidden')&&!box.contains(document.activeElement))box.querySelector('[data-close]').focus({preventScroll:true})}); return body; }
  function closeModal() { modal.classList.add('hidden'); document.getElementById('modalBody').innerHTML = '';const target=modalOrigin;modalOrigin=null;if(target&&target.isConnected&&typeof target.focus==='function')target.focus({preventScroll:true}); if (modal._onclose) { const f = modal._onclose; modal._onclose = null; f(); } }
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown',e=>{if(modal.classList.contains('hidden')||e.isComposing||e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeModal()}else if(e.key==='Tab'){const controls=[...modal.querySelectorAll('button,a[href],input,textarea,select,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
  function confirmDlg(title, msg, okText = '確定', danger) {
    return new Promise((res) => {
      const b = openModal(`<h2>${h(title)}</h2><p>${msg}</p><div class="btns"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${h(okText)}</button><button class="btn ghost" data-close>取消</button></div>`);
      modal._onclose = () => res(false);
      b.querySelector('[data-ok]').onclick = () => { modal._onclose = null; closeModal(); res(true); };
    });
  }
  function promptDlg(title, label, def = '', okText = '確定', danger) {
    return new Promise((res) => {
      const b = openModal(`<h2>${h(title)}</h2><label class="f">${h(label)}<input id="pdlg" value="${h(def)}"></label><div class="btns" style="margin-top:12px"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${h(okText)}</button><button class="btn ghost" data-close>取消</button></div>`);
      modal._onclose = () => res(null);
      const inp = b.querySelector('#pdlg'); inp.focus();
      b.querySelector('[data-ok]').onclick = () => { const v = inp.value; modal._onclose = null; closeModal(); res(v); };
    });
  }
  const errList = (errors) => (errors && errors.length ? `<div class="errors"><b>共 ${errors.length} 項錯誤：</b><ul>${errors.map((e) => `<li>${h(e)}</li>`).join('')}</ul></div>` : '');

  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; }
  function on(el, ev, sel, fn) { el.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && el.contains(t)) fn(e, t); }); }

  async function loadMeta(force) { if (!meta.data || force) meta.data = await get('/meta'); return meta.data; }
  const rarBadge = (r, names) => `<span class="badge r${r}">${h((names && names[r] && (names[r].name || names[r])) || ['普通', '稀有', '傳說'][r] || r)}</span>`;
  const statusName = { pending: '待付款', paid: '已付款', failed: '失敗', refunded: '已退款', canceled: '已取消' };
  const statusBadge = (s) => `<span class="badge st-${s}">${statusName[s] || s}</span>`;

  // ---------- 路由 ----------
  let current = null, leaveGuard = null, leavePending = false;
  const setLeaveGuard = fn => { leaveGuard = typeof fn === 'function' ? fn : null; };
  window.addEventListener('beforeunload', e => { if(leaveGuard && leaveGuard()){e.preventDefault();e.returnValue='';} });
  async function route() {
    const requested = location.hash.replace(/^#/, '') || 'dashboard';
    if (requested === current) return;
    if (leavePending) return;
    if (current && leaveGuard && leaveGuard()) {
      const origin = current;
      leavePending = true;
      let approved = false;
      try { approved = await confirmDlg('尚未儲存的修改', '離開會放棄目前尚未發布的修改，要繼續嗎？', '放棄並離開'); }
      finally { leavePending = false; }
      if (!approved) {
        history.replaceState(history.state, '', location.pathname + location.search + '#' + origin);
        window.dispatchEvent(new Event('hashchange'));
        return;
      }
      if ((location.hash.replace(/^#/, '') || 'dashboard') === origin) return;
      leaveGuard = null;
      return route();
    }
    leaveGuard = null;
    if (!modal.classList.contains('hidden')) closeModal();
    const hash = location.hash.replace(/^#/, '') || 'dashboard';
    const [name, ...params] = hash.split('/');
    document.querySelectorAll('#side a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (name === 'player' ? 'players' : name)));
    const main = document.getElementById('main');
    main.onclick = main.oninput = main.onchange = main.onkeydown = null;
    const view = window.Views[name];
    current = hash;
    if (!view) { main.innerHTML = '<p>找不到頁面</p>'; return; }
    main.innerHTML = '<div class="loading">載入中…</div>';
    try { await view(main, params); } catch (e) { if (current === hash) main.innerHTML = `<div class="errors">載入失敗：${h(e.message)}</div>`; }
  }

  async function start() {
    const s = await get('/session'); csrf = s.csrf;
    window.addEventListener('hashchange', route);
    document.getElementById('logoutBtn').onclick = async () => { if(leaveGuard && leaveGuard() && !await confirmDlg('尚未儲存的修改','登出會放棄尚未發布的修改，要繼續嗎？','放棄並登出'))return; await post('/logout'); leaveGuard=null; location.href = '/admin/login'; };
    route();
  }
  return { h, fmtTime, fmtNum, fmtDur, ago, toLocalInput, fromLocalInput, api, get, post, put, del, toast, errToast, openModal, closeModal, confirmDlg, promptDlg, errList, getPath, setPath, on, loadMeta, rarBadge, statusBadge, statusName, setLeaveGuard, route, start };
})();
