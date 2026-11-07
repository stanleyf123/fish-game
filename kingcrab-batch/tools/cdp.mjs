// Minimal headless-Chrome driver over the DevTools protocol (Node >= 22, no npm packages).
// Used for preview rendering and the browser integration test. Loads local files only.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  for (const c of [process.env.CHROME_BIN, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

export async function openPage({width = 1280, height = 800, scale = 1} = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no chrome binary found (set CHROME_BIN)');
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus', '--hide-scrollbars',
    '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, `--user-data-dir=${profile}`, 'about:blank'],
  {stdio: 'ignore', env: {...process.env, DBUS_SESSION_BUS_ADDRESS: '/dev/null'}});
  let targets;
  for (let i = 0; i < 150; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (!targets) { proc.kill('SIGKILL'); throw new Error('chrome did not start'); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = new Map(); const errors = []; const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: scale, mobile: false});
  await send('Page.enable'); await send('Runtime.enable');
  return {
    errors, logs, send,
    async goto(url, wait = 300) { await send('Page.navigate', {url}); await new Promise(r => setTimeout(r, wait)); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async screenshot(out, clip) {
      const s = await send('Page.captureScreenshot', {format: 'png', ...(clip ? {clip: {...clip, scale: 1}} : {})});
      fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
    },
    async close() { try { ws.close(); } catch {} proc.kill('SIGKILL'); await new Promise(r => setTimeout(r, 300)); try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); } catch {} }
  };
}
