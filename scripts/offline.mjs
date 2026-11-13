#!/usr/bin/env node
// Offline installation under failure, in real-time headless Chrome against the deployable site
// (scripts/site.mjs) served by a Node server that can fail single files with HTTP 503:
//   1. a first visit with one file failing installs no service worker and caches nothing usable;
//   2. once the file is back, the next visit installs it and the app works with the server stopped;
//   3. a version update with one file failing keeps the previous complete copy (offline still works),
//      both when only the version changes and when sw.js changes too;
//   4. once the file is back, the update completes.
// Usage: node scripts/offline.mjs   (part of npm run smoke)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, serveStatic, sleep } from './lib/browser.mjs';
import { assemble, verify } from './site.mjs';

const DIST = assemble(mkdtempSync(join(tmpdir(), 'optica-site-')));
if (verify(DIST).length) { console.error('✗ site incomplete: run node scripts/site.mjs'); process.exit(1); }
const V = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8')).version, NEXT = V + '-next';
const FAULT = 'js/modules/dof.js';
const site = await serveStatic(DIST);
const page = await launch();
let failed = 0;
// every visit is a real page load (the same URL with only a hash would not reload the app)
let nav = 0;
const visit = (hash, wait) => page.goto(`${site.url}?visit=${++nav}${hash}`, wait);
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) failed++; };
const state = () => page.eval(`(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  const c = await caches.open('optica-viva'), m = await c.match('precache-version');
  return { controller: !!navigator.serviceWorker.controller, active: !!r?.active, installing: !!r?.installing, waiting: !!r?.waiting,
    version: m ? await m.text() : null, entries: (await c.keys()).length };
})()`);
// wait until no worker is installing, and `done` holds (or the time is up)
const settle = async (done = () => true, s = 40) => {
  let st;
  for (let i = 0; i < s * 2; i++) { st = await state(); if (!st.installing && done(st)) break; await sleep(500); }
  return st;
};
const offlineWorks = async () => {
  await site.stop();
  await visit('&offline#/dof', 3000);
  let n = 0;
  for (let i = 0; i < 40 && !n; i++) { n = await page.eval(`document.querySelectorAll('dl.readouts dd').length`).catch(() => 0); if (!n) await sleep(500); }
  await site.start();
  return n > 0;
};

try {
  // 1. fresh visit, one file failing
  site.fail.add(FAULT);
  await visit('#/', 3000);
  let st = await settle(() => false, 15);
  check(!st.active && !st.controller && st.version === null, 'first visit with a failing file installs no worker', JSON.stringify(st));
  // 2. the file is back: the next visit installs, offline works
  site.fail.clear();
  await visit('#/', 3000);
  st = await settle((s) => s.active && s.version === V);
  check(st.active && st.version === V, `next visit caches the app (${st.entries} files, version ${st.version})`, JSON.stringify(st));
  await visit('#/', 2000); // now controlled
  const before = (await state()).entries;
  check(await offlineWorks(), 'offline after install');
  // 3a. a new version (package.json only) with one file failing: the old copy stays
  site.replace.set('package.json', JSON.stringify({ version: NEXT }));
  site.fail.add(FAULT);
  await visit('#/', 6000);
  st = await state();
  check(st.version === V && st.entries >= before, 'failed refresh keeps the previous complete copy', JSON.stringify(st));
  // the warning comes once the worker has tried to re-cache every file: give slow machines time
  for (let i = 0; i < 60 && !page.warnings().some((w) => /not updated/.test(w)); i++) await sleep(500);
  check(page.warnings().some((w) => /not updated/.test(w)), 'the failed update is reported to the page', page.warnings().join(' | '));
  check(await offlineWorks(), 'offline after a failed refresh');
  // 3b. a new sw.js as well: its installation fails and the old worker stays in charge
  site.replace.set('sw.js', readFileSync(join(DIST, 'sw.js'), 'utf8') + '\n// next\n');
  await visit('#/', 3000);
  st = await settle(() => false, 10);
  check(st.active && !st.waiting && st.version === V, 'failed upgrade of the worker keeps the old one', JSON.stringify(st));
  check(await offlineWorks(), 'offline after a failed upgrade');
  // 4. the file is back: the update completes on the next visit, or the one after (the page's
  // refresh and the browser's own update of the changed sw.js can overlap)
  site.fail.clear();
  let tries = 0;
  for (; tries < 2 && st.version !== NEXT; tries++) { await visit('#/', 3000); st = await settle((s) => s.version === NEXT, 30); }
  check(st.version === NEXT, `update completes once the file is back (visit ${tries})`, JSON.stringify(st) + '  warnings: ' + page.warnings().join(' | ').slice(0, 400));
} finally {
  await page.close(); await site.stop(); rmSync(DIST, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
