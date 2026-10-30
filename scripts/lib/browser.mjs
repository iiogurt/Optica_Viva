// Minimal real-time Chrome DevTools Protocol client (no dependencies).
// Needs a global WebSocket (Node ≥ 22; the project runs on Node 24).
// Real time (unlike --virtual-time-budget) lets Web Workers run, so worker-backed
// laboratories actually finish rendering.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// flags: extra Chromium switches, e.g. a fake camera for the live-camera tests
export async function launch({ width = 1440, height = 1200, flags = [] } = {}) {
  if (typeof WebSocket !== 'function') throw new Error('global WebSocket missing: use Node 22 or later');
  const exe = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
    .find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore', shell: '/bin/sh' }); return true; } catch { return false; } });
  if (!exe) throw new Error('no Chrome/Chromium on PATH');
  // start the browser; on slow or busy machines (CI) allow 40 s and retry once on a new port
  let proc, profile, target;
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    profile = mkdtempSync(join(tmpdir(), 'optica-cdp-'));
    const port = 9300 + Math.floor(Math.random() * 600);
    // SwiftShader gives headless Chromium WebGL 2 without a GPU (CI runners, the Pi) for the 3-D
    // views; 2-D canvases and compositing stay in software, which is 3× faster than SwiftShader.
    // --password-store=basic: in a desktop session Chromium otherwise waits for the keyring over
    // D-Bus before its first request, and never loads a page if the keyring does not answer
    proc = spawn(exe, ['--headless=new', '--no-sandbox', '--password-store=basic', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-accelerated-2d-canvas', '--disable-gpu-compositing', '--hide-scrollbars', `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, `--window-size=${width},${height}`, ...flags, 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 160 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    }
    if (!target) { proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
  if (!target) throw new Error('browser did not start (2 attempts)');
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
    errors: () => errors.slice(), // console errors since the last goto
    cdp: send, // raw DevTools Protocol call, e.g. cdp('Profiler.start')
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
