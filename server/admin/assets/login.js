document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  msg.textContent = '';
  try {
    const r = await fetch('/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pw').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg.textContent = j.message || '登入失敗'; return; }
    location.href = '/admin/';
  } catch (err) { msg.textContent = '無法連線到伺服器'; }
});
