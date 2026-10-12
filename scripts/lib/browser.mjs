// Minimal real-time Chrome DevTools Protocol client (no dependencies).
// Needs a global WebSocket: Node ≥ 22, or Node 20 with --experimental-websocket.
// Real time (unlike --virtual-time-budget) lets Web Workers run, so worker-backed
// laboratories actually finish rendering.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 1200 } = {}) {
  if (typeof WebSocket !== 'function') throw new Error('global WebSocket missing: use Node ≥ 22 or node --experimental-websocket');
  const exe = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
    .find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore', shell: '/bin/sh' }); return true; } catch { return false; } });
  if (!exe) throw new Error('no Chrome/Chromium on PATH');
  const profile = mkdtempSync(join(tmpdir(), 'optica-cdp-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) { proc.kill(); throw new Error('browser did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const waiting = new Map(); let errors = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails; errors.push(d.exception?.description || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  const page = {
    async size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async goto(url, waitMs = 4000) { errors = []; await send('Page.navigate', { url }); await sleep(waitMs); return errors.slice(); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async screenshot({ clip, format = 'webp', quality = 86 } = {}) {
      const r = await send('Page.captureScreenshot', { format, quality, captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      return Buffer.from(r.result.data, 'base64');
    },
    async close() { try { ws.close(); } catch {} proc.kill(); await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch {} },
  };
  await page.size(width, height);
  return page;
}

// Serve the repository on a free local port (python3 http.server), returns {url, stop}.
export async function serve(root, port = 8790 + Math.floor(Math.random() * 100)) {
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(150); } }
  return { url: `http://127.0.0.1:${port}/`, stop: () => proc.kill() };
}
