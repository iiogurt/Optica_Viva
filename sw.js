// Service worker: Optica Viva works offline and installs as an app. Same-origin files are fetched
// network-first (so the site is always current when online) and fall back to the cache; the whole
// app (precache.json) is cached on install and again whenever the version in package.json changes.
// The typefaces are same-origin files (vendor/fonts/) and cached with the rest.
// A worker is installed only when the whole app is cached: if any file fails, installation fails,
// the browser keeps the previous worker (or none) and tries again on the next visit. On every page
// load the active worker checks the version itself (one check at a time) and caches a new version
// with Cache.addAll, which stores all files or none, so a failed update keeps the previous complete
// copy and its version. Failures are reported to the open pages; offline, nothing is attempted.
const CACHE = 'optica-viva', TIMEOUT = 4000;

async function precache() {
  const list = await fetch('precache.json', { cache: 'no-cache' }); // throws when offline
  const { files } = await list.json();
  const { version } = await (await fetch('package.json', { cache: 'no-cache' })).json();
  const c = await caches.open(CACHE);
  const done = await c.match('precache-version');
  if (done && (await done.text()) === version) return;
  await c.addAll(files.map((f) => new Request(f, { cache: 'no-cache' })));
  await c.put('precache-version', new Response(version));
}

// failures are reported to every open page (they would otherwise go unnoticed)
const tell = async (msg) => { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg); };
const why = (err) => String(err?.message || err);
self.addEventListener('install', (e) => e.waitUntil(precache().then(() => self.skipWaiting(), async (err) => {
  await tell({ precache: 'failed', phase: 'install', error: why(err) });
  throw err;
})));
// 'optica-viva-fonts' held Google Fonts responses before the typefaces were vendored
self.addEventListener('activate', (e) => e.waitUntil(Promise.all([self.clients.claim(), caches.delete('optica-viva-fonts')])));
// the version check on page loads: one at a time; a server that cannot be reached is not a failure
let checking = null;
function checkVersion() {
  checking ??= fetch('package.json', { cache: 'no-cache', method: 'HEAD' })
    .then(() => precache().catch((err) => tell({ precache: 'failed', phase: 'update', error: why(err) })), () => {})
    .finally(() => { checking = null; });
  return checking;
}

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

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    if (req.mode === 'navigate') e.waitUntil(checkVersion());
  }
});
