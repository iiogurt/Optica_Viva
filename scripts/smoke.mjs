#!/usr/bin/env node
// Load every page in real-time headless Chrome. Fails on uncaught errors, console errors,
// error panels, or a laboratory that never produced results (empty readouts). Also checks
// that a shared URL restores its controls. Runs against the deployable site (scripts/site.mjs),
// assembled into a temporary directory, so it tests what GitHub Pages serves. Usage: npm run smoke
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './lib/browser.mjs';
import { assemble, verify } from './site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = [...readFileSync(resolve(ROOT, 'js/app.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const REFERENCE = new Set(['home', 'foundations', 'catalogue', 'gallery']); // pages without readouts
const DIST = assemble(mkdtempSync(join(tmpdir(), 'optica-site-')));
const incomplete = verify(DIST);
if (incomplete.length) { console.error(incomplete.map((p) => `✗ site: ${p}`).join('\n')); rmSync(DIST, { recursive: true, force: true }); process.exit(1); }
const site = await serve(DIST);
// a fake camera (a moving test pattern) with permission granted, for the live-camera check
const page = await launch({ flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let failed = 0;
const probe = `(() => ({
  alert: document.querySelectorAll('[role=alert]').length,
  // laboratories show readouts; missions show the answers of their steps
  readouts: document.querySelectorAll('dl.readouts dd').length + [...document.querySelectorAll('.mstep-answer')].filter((d) => d.textContent.trim()).length,
  emptyReadouts: [...document.querySelectorAll('dl.readouts dd')].filter((d) => d.textContent.trim() === '…').length,
  // KaTeX renders unknown commands as a red box instead of throwing (throwOnError: false)
  tex: [...document.querySelectorAll('.katex-error')].map((e) => (e.title || e.textContent).slice(0, 90)),
}))()`;
try {
  for (const id of ids) {
    const errors = await page.goto(site.url + '#/' + (id === 'home' ? '' : id), 2500);
    // poll instead of a fixed wait: worker-backed labs can need several seconds on a cold CI runner
    let s = await page.eval(probe);
    for (let t = 0; t < 45 && !REFERENCE.has(id) && !s.alert && s.readouts === 0; t++) { await sleep(500); s = await page.eval(probe); }
    const problems = [...errors];
    if (s.alert) problems.push('error panel shown');
    if (!REFERENCE.has(id) && s.readouts === 0) problems.push('no results rendered');
    if (s.tex.length) problems.push('TeX errors: ' + s.tex.join(' | '));
    console.log(`${problems.length ? '✗' : '✓'} ${id}${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // 3-D views: WebGL 2 starts (SwiftShader in headless Chromium) and the ray tracer's scene is drawn
  {
    const errors = await page.goto(site.url + '#/raytracer', 6000);
    const r = await page.eval(`!!document.querySelector('figure.v3d canvas') && !document.querySelector('.v3d-none')`);
    console.log(`${r && !errors.length ? '✓' : '✗'} 3-D view (WebGL 2)${errors.length ? '  ' + errors.join(' | ').slice(0, 300) : ''}`);
    if (!r || errors.length) failed++;
  }
  // shareable state: a URL with parameters must restore the controls
  await page.goto(site.url + '#/psf?preset=hubble&band=white', 4000);
  const ok = await page.eval(`document.querySelector('.controls select').value === 'hubble' && [...document.querySelectorAll('.seg button')].some((b) => b.classList.contains('on') && /White/.test(b.textContent))`);
  console.log(`${ok ? '✓' : '✗'} URL state restores controls`);
  if (!ok) failed++;
  // embed mode: no sidebar, results still render, and the page's own settings survive in the link
  {
    const errors = await page.goto(site.url + '#/dof?N=4&embed=1', 3000);
    const r = await page.eval(`(() => getComputedStyle(document.querySelector('.sidebar')).display === 'none' && document.querySelectorAll('dl.readouts dd').length > 0 && /N=4/.test(location.hash) && /embed=1/.test(location.hash))()`);
    console.log(`${r && !errors.length ? '✓' : '✗'} embed mode${errors.length ? '  ' + errors.join(' | ').slice(0, 300) : ''}`);
    if (!r || errors.length) failed++;
  }
  // live camera on the rolling-shutter and sampling pages: starts, feeds the views, stops
  for (const camPage of ['motion', 'sampling']) {
    const errors = await page.goto(site.url + '#/' + camPage, 3000);
    const r = await page.eval(`(async () => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Use my camera');
      if (!b) return 'no camera button';
      b.click();
      await new Promise((res) => setTimeout(res, 2500));
      const ok = b.textContent === 'Stop camera';
      b.click();
      return ok ? '' : 'camera did not start: ' + document.querySelector('[role=status]').textContent;
    })()`);
    const problems = [...errors, ...(r ? [r] : [])];
    console.log(`${problems.length ? '✗' : '✓'} live camera (${camPage})${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // security: a prescription file with HTML in a glass name must show a text error and run nothing (#188)
  {
    const errors = await page.goto(site.url + '#/raytracer', 3000);
    const r = await page.eval(`(async () => {
      const bad = { name: 'audit', epd: 10, field: 5, surfaces: [{ R: 50, t: 5, glass: '<img src=x onerror="window.__xss=1">', stop: true }, { R: -50, t: 40, glass: 'air' }] };
      const input = document.querySelector('input[type=file][accept*="json"]') || document.querySelector('input[type=file]');
      const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(bad)], 'bad.json', { type: 'application/json' }));
      input.files = dt.files; input.dispatchEvent(new Event('change'));
      await new Promise((res) => setTimeout(res, 800));
      const imgs = [...document.querySelectorAll('main img')].filter((i) => i.getAttribute('src') === 'x').length;
      const shown = document.body.textContent.includes('unknown glass');
      return window.__xss ? 'script ran' : imgs ? 'img injected' : shown ? '' : 'no readable error';
    })()`);
    const problems = [...errors, ...(r ? [r] : [])];
    console.log(`${problems.length ? '✗' : '✓'} lens import is safe${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // comparison mode: two embedded copies of the page with its settings; Escape closes them
  {
    const errors = await page.goto(site.url + '#/dof?N=4', 3000);
    const r = await page.eval(`(async () => {
      document.querySelector('.compare-btn').click();
      const f = [...document.querySelectorAll('.compare-overlay iframe')];
      const ok = f.length === 2 && f.every((x) => /embed=1/.test(x.src) && /N=4/.test(x.src));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return ok && !document.querySelector('.compare-overlay');
    })()`);
    console.log(`${r && !errors.length ? '✓' : '✗'} comparison mode${errors.length ? '  ' + errors.join(' | ').slice(0, 300) : ''}`);
    if (!r || errors.length) failed++;
  }
  // guided tours: each one starts from its link and plays to the end; every select it sets must hold the value
  const { TOURS } = await import('../js/lib/tours.js');
  for (const t of TOURS) {
    const errors = await page.goto(site.url + `#/${t.lab}?tour=${t.id}`, 2500);
    for (let k = 0; k < 30 && !(await page.eval(`!!document.querySelector('.tour')`)); k++) await sleep(500); // a slow first load
    const r = await page.eval(`(async () => {
      const bad = [];
      for (let i = 0; i < ${t.steps.length}; i++) {
        if (!document.querySelector('.tour')) return 'tour did not start';
        for (const s of document.querySelectorAll('.controls select')) if (s.value === '') bad.push(s.closest('label').textContent.slice(0, 30));
        document.querySelector('.tour .tour-btn.primary').click();
        await new Promise((res) => setTimeout(res, 250));
      }
      const tex = [...document.querySelectorAll('.katex-error')].map((e) => e.title.slice(0, 90));
      return document.querySelector('.tour') ? 'tour did not finish' : [...bad, ...tex.map((x) => 'TeX error: ' + x)].join(', ');
    })()`);
    const problems = [...errors, ...page.errors().slice(errors.length), ...(r ? [r] : [])];
    console.log(`${problems.length ? '✗' : '✓'} tour ${t.id}${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // exercises: each one's solution shows and "Set it up in the lab" moves real controls
  const { EXERCISES } = await import('../js/lib/exercises.js');
  for (const [lab, list] of Object.entries(EXERCISES)) {
    const errors = await page.goto(site.url + '#/' + lab, 2500);
    const r = await page.eval(`(async () => {
      const cards = document.querySelectorAll('.ex');
      if (cards.length !== ${list.length}) return 'exercises missing';
      for (const e of cards) {
        for (const b of e.querySelectorAll('button')) if (/Show solution|Set it up/.test(b.textContent) && !b.hidden) b.click();
        if (!e.querySelector('.ex-sol').textContent) return 'no solution';
        await new Promise((res) => setTimeout(res, 300));
      }
      return '';
    })()`);
    const problems = [...errors, ...page.errors().slice(errors.length), ...(r ? [r] : [])];
    console.log(`${problems.length ? '✗' : '✓'} exercises ${lab}${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // the deployed files: gallery photographs load, saved settings carry the app's version, the
  // service worker registers
  {
    const errors = await page.goto(site.url + '#/gallery', 2500);
    const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
    for (let t = 0; t < 30 && !(await page.eval(`document.querySelectorAll('figure img').length`)); t++) await sleep(500);
    const r = await page.eval(`(async () => {
      const imgs = [...document.querySelectorAll('figure img')];
      for (const i of imgs) i.loading = 'eager';
      await Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((res) => { i.onload = i.onerror = res; }))));
      const broken = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
      const saved = await (await import('./js/lib/page.js')).settingsJSON({ title: 'x' });
      const sw = !!(await navigator.serviceWorker.getRegistration());
      return { n: imgs.length, broken, version: saved.version, sw };
    })()`);
    const problems = [...errors];
    if (!r.n) problems.push('no gallery images');
    if (r.broken.length) problems.push('broken: ' + r.broken.join(', '));
    if (r.version !== version) problems.push(`saved settings version "${r.version}", expected ${version}`);
    if (!r.sw) problems.push('service worker not registered');
    console.log(`${problems.length ? '✗' : '✓'} deployed files (${r.n} gallery images, version ${r.version})${problems.length ? '  ' + problems.join(' | ').slice(0, 300) : ''}`);
    if (problems.length) failed++;
  }
  // offline: once the service worker has cached the app, a reload with the server stopped still works
  {
    await page.goto(site.url + '#/dof', 1500);
    let cached = false;
    for (let t = 0; t < 60 && !cached; t++) { await sleep(500); cached = await page.eval(`caches.open('optica-viva').then((c) => c.match('precache-version')).then((r) => !!r)`); }
    site.stop();
    const errors = await page.goto(site.url + '?offline#/dof', 4000);
    let s = await page.eval(probe);
    for (let t = 0; t < 30 && !s.alert && s.readouts === 0; t++) { await sleep(500); s = await page.eval(probe); }
    const ok = cached && s.readouts > 0 && !s.alert;
    console.log(`${ok ? '✓' : '✗'} offline after install${cached ? '' : '  (app never cached)'}${errors.length ? '  ' + errors.join(' | ').slice(0, 300) : ''}`);
    if (!ok) failed++;
  }
} finally {
  await page.close(); site.stop(); rmSync(DIST, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
