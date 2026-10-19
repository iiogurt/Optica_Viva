#!/usr/bin/env node
// Load every page in real-time headless Chrome. Fails on uncaught errors, console errors,
// error panels, or a laboratory that never produced results (empty readouts). Also checks
// that a shared URL restores its controls. Usage: npm run smoke
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = [...readFileSync(resolve(ROOT, 'js/app.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const REFERENCE = new Set(['home', 'foundations', 'catalogue', 'gallery']); // pages without readouts
const site = await serve(ROOT);
const page = await launch();
let failed = 0;
const probe = `(() => ({
  alert: document.querySelectorAll('[role=alert]').length,
  // laboratories show readouts; missions show the answers of their steps
  readouts: document.querySelectorAll('dl.readouts dd').length + [...document.querySelectorAll('.mstep-answer')].filter((d) => d.textContent.trim()).length,
  emptyReadouts: [...document.querySelectorAll('dl.readouts dd')].filter((d) => d.textContent.trim() === '…').length,
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
  // guided tours: each one starts from its link and plays to the end; every select it sets must hold the value
  const { TOURS } = await import('../js/lib/tours.js');
  for (const t of TOURS) {
    const errors = await page.goto(site.url + `#/${t.lab}?tour=${t.id}`, 2500);
    const r = await page.eval(`(async () => {
      const bad = [];
      for (let i = 0; i < ${t.steps.length}; i++) {
        if (!document.querySelector('.tour')) return 'tour did not start';
        for (const s of document.querySelectorAll('.controls select')) if (s.value === '') bad.push(s.closest('label').textContent.slice(0, 30));
        document.querySelector('.tour .tour-btn.primary').click();
        await new Promise((res) => setTimeout(res, 250));
      }
      return document.querySelector('.tour') ? 'tour did not finish' : bad.join(', ');
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
  // offline: once the service worker has cached the app, a reload with the server stopped still works
  {
    await page.goto(site.url + '#/dof', 1500);
    let cached = false;
    for (let t = 0; t < 60 && !cached; t++) { await sleep(500); cached = await page.eval(`caches.open('optica-viva').then((c) => c.match('precache-version')).then((r) => !!r)`); }
    site.stop();
    const errors = await page.goto(site.url + '?offline#/dof', 4000);
    const s = await page.eval(probe);
    const ok = cached && s.readouts > 0 && !s.alert;
    console.log(`${ok ? '✓' : '✗'} offline after install${cached ? '' : '  (app never cached)'}${errors.length ? '  ' + errors.join(' | ').slice(0, 300) : ''}`);
    if (!ok) failed++;
  }
} finally {
  await page.close(); site.stop();
}
process.exit(failed ? 1 : 0);
