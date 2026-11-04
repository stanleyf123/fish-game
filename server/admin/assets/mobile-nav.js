// v4.0.6 手機版導覽（寬度 ≤ 760px）：固定頂部列（Logo＋可橫向捲動的分頁＋☰ 全螢幕選單）、⬆ 回到頂端、切換頁面自動捲到最上面。
// 桌面版側欄不變；分頁由 #side 內容自動產生，未讀徽章同步。
(function () {
  const side = document.getElementById('side'); if (!side) return;
  const MQ = window.matchMedia('(max-width: 760px)');
  const brand = side.querySelector('.brand');
  const links = [...side.querySelectorAll('a')];
  // 依側欄的分組整理
  const groups = []; let g = { name: '', items: [] }; groups.push(g);
  for (const el of side.children) {
    if (el.classList.contains('navgroup')) { g = { name: el.textContent.trim(), items: [] }; groups.push(g); }
    else if (el.tagName === 'A') g.items.push(el);
  }
  const clone = (a, cls) => { const c = document.createElement('a'); c.href = a.getAttribute('href'); if (a.dataset.nav) c.dataset.nav = a.dataset.nav; c.className = cls; c.innerHTML = a.innerHTML; c.querySelectorAll('[id]').forEach((x) => { x.dataset.mirror = x.id; x.removeAttribute('id'); }); c._src = a; return c; };

  const bar = document.createElement('div'); bar.id = 'mbar'; bar.setAttribute('role', 'navigation');
  bar.innerHTML = `<a class="mb-brand" href="${links[0] ? links[0].getAttribute('href') : '#'}" title="${(brand && brand.textContent.trim()) || ''}">🐠<span>後台</span></a><div class="mb-tabs"></div><button class="mb-menu" type="button" aria-label="所有功能" aria-expanded="false">☰</button>`;
  const menuButton=bar.querySelector('.mb-menu'); menuButton.innerHTML='<span class="mb-icon">☰</span><span>全部</span>'; const tabs = bar.querySelector('.mb-tabs');
  const quickNav = new Set(links.some(a=>a.dataset.nav==='dashboard')?['dashboard','players','support','pay']:['hero','hero-rank','hero-heroes','hero-battles']);
  const tabEls = links.filter(a=>quickNav.has(a.dataset.nav)).map((a) => { const c = clone(a, 'mb-tab'); const short={dashboard:'工作台',players:'玩家',support:'客服',pay:'訂單',hero:'總覽','hero-rank':'排名','hero-heroes':'英雄','hero-battles':'對戰'}; const icon=document.createElement('span'),label=document.createElement('span'); icon.className='mb-icon'; icon.textContent={dashboard:'▦',players:'♙',support:'☏',pay:'▤',hero:'◈','hero-rank':'♛','hero-heroes':'♙','hero-battles':'⚔'}[a.dataset.nav]||'•'; label.textContent=short[a.dataset.nav]||a.textContent; const badges=[...c.querySelectorAll('[data-mirror]')]; c.replaceChildren(icon,label,...badges); c.setAttribute('aria-label',a.textContent.trim()); tabs.appendChild(c); return c; });

  const menu = document.createElement('div'); menu.id = 'mmenu'; menu.className = 'hidden'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '所有功能');
  menu.innerHTML = `<div class="mm-head"><b>${(brand && brand.innerHTML) || '管理後台'}</b><button class="mm-x" type="button" aria-label="關閉">✕</button></div><div class="mm-body"></div>`;
  const body = menu.querySelector('.mm-body'); const menuEls = [];
  for (const gr of groups) { if (!gr.items.length) continue;
    const sec = document.createElement('div'); sec.className = 'mm-group';
    if (gr.name) { const t = document.createElement('div'); t.className = 'mm-title'; t.textContent = gr.name; sec.appendChild(t); }
    const grid = document.createElement('div'); grid.className = 'mm-grid';
    for (const a of gr.items) { const c = clone(a, 'mm-item'); grid.appendChild(c); menuEls.push(c); }
    sec.appendChild(grid); body.appendChild(sec); }
  const lo = side.querySelector('#logoutBtn');
  if (lo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost mm-logout'; b.textContent = '🚪 登出'; b.onclick = () => lo.click(); body.appendChild(b); }

  const top = document.createElement('button'); top.id = 'toTop'; top.type = 'button'; top.className = 'hidden'; top.setAttribute('aria-label', '回到頂端'); top.textContent = '⬆';
  top.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const layout = document.getElementById('layout') || document.body;
  layout.parentNode.insertBefore(bar, layout); document.body.appendChild(menu); document.body.appendChild(top);

  const openMenu = (on) => { menu.classList.toggle('hidden', !on); bar.querySelector('.mb-menu').setAttribute('aria-expanded', on ? 'true' : 'false'); document.body.classList.toggle('mm-open', on); };
  bar.querySelector('.mb-menu').onclick = () => openMenu(menu.classList.contains('hidden'));
  menu.querySelector('.mm-x').onclick = () => openMenu(false);
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) openMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.classList.contains('hidden')) openMenu(false); });

  // 目前頁面：跟著側欄的 .on；分頁捲到看得到的位置
  function sync(scroll) {
    let act = null;
    for (const c of [...tabEls, ...menuEls]) { const on = c._src.classList.contains('on'); c.classList.toggle('on', on); if(on)c.setAttribute('aria-current','page');else c.removeAttribute('aria-current'); if (on && c.classList.contains('mb-tab')) act = c; }
    if (act && scroll && MQ.matches) { const L = act.offsetLeft - (tabs.clientWidth - act.offsetWidth) / 2; tabs.scrollTo({ left: Math.max(0, L), behavior: scroll === 'smooth' ? 'smooth' : 'auto' }); }
  }
  for (const a of links) new MutationObserver(() => sync('smooth')).observe(a, { attributes: true, attributeFilter: ['class'] });
  // 未讀徽章（例如客服 #supBadge）同步到複本
  for (const src of side.querySelectorAll('[id]')) { if (src.id === 'logoutBtn') continue;
    const mirror = () => document.querySelectorAll(`[data-mirror="${src.id}"]`).forEach((m) => { m.textContent = src.textContent; m.className = src.className; });
    new MutationObserver(mirror).observe(src, { attributes: true, childList: true, characterData: true, subtree: true }); mirror(); }
  // 切換頁面 → 捲到最上面
  window.addEventListener('hashchange', () => { openMenu(false); window.scrollTo(0, 0); });
  const onScroll = () => top.classList.toggle('hidden', !(MQ.matches && window.scrollY > 400));
  window.addEventListener('scroll', onScroll, { passive: true });
  (MQ.addEventListener ? MQ.addEventListener('change', () => { onScroll(); sync(); if (!MQ.matches) openMenu(false); }) : MQ.addListener(() => { onScroll(); sync(); }));
  requestAnimationFrame(() => sync(true)); setTimeout(() => sync(true), 400);
})();
