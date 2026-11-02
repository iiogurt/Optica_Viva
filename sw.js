// Service worker: Optica Viva works offline and installs as an app. Same-origin files are fetched
// network-first (so the site is always current when online) and fall back to the cache; the whole
// app (precache.json) is cached on install and again whenever the version in package.json changes.
// Google Fonts are served from the cache and refreshed in the background.
// A worker is installed only when the whole app is cached: if any file fails, installation fails,
// the browser keeps the previous worker (or none) and tries again on the next visit. A refresh
// after a version change uses Cache.addAll, which stores all files or none, so a failed refresh
// keeps the previous complete copy and its version; the page is told the outcome.
const CACHE = 'optica-viva', FONTS = 'optica-viva-fonts', TIMEOUT = 4000;

async function precache() {
  const { files } = await (await fetch('precache.json', { cache: 'no-cache' })).json();
  const { version } = await (await fetch('package.json', { cache: 'no-cache' })).json();
  const c = await caches.open(CACHE);
  const done = await c.match('precache-version');
  if (done && (await done.text()) === version) return;
  await c.addAll(files.map((f) => new Request(f, { cache: 'no-cache' })));
  await c.put('precache-version', new Response(version));
}

self.addEventListener('install', (e) => e.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// the page asks for a refresh on every start; it does nothing unless the version changed
self.addEventListener('message', (e) => {
  if (e.data !== 'refresh') return;
  const reply = (msg) => e.source?.postMessage(msg);
  e.waitUntil(precache().then(() => reply({ precache: 'ok' }), (err) => reply({ precache: 'failed', error: String(err?.message || err) })));
});

const timeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then((r) => { clearTimeout(t); res(r); }, (err) => { clearTimeout(t); rej(err); }); });

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await timeout(fetch(req), TIMEOUT);
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

async function fonts(req, e) {
  const c = await caches.open(FONTS);
  const hit = await c.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(fonts(req, e));
});
