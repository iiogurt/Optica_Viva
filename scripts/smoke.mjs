#!/usr/bin/env node
// Load every page in real-time headless Chrome. Fails on uncaught errors, console errors,
// error panels, or a laboratory that never produced results (empty readouts). Also checks
// that a shared URL restores its controls. Usage: npm run smoke
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = [...readFileSync(resolve(ROOT, 'js/app.js'), 'utf8').matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
const REFERENCE = new Set(['home', 'foundations', 'catalogue']); // pages without readouts
const site = await serve(ROOT);
const page = await launch();
let failed = 0;
const probe = `(() => ({
  alert: document.querySelectorAll('[role=alert]').length,
  readouts: document.querySelectorAll('dl.readouts dd').length,
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
  // shareable state: a URL with parameters must restore the controls
  await page.goto(site.url + '#/psf?preset=hubble&band=white', 4000);
  const ok = await page.eval(`document.querySelector('select').value === 'hubble' && [...document.querySelectorAll('.seg button')].some((b) => b.classList.contains('on') && /White/.test(b.textContent))`);
  console.log(`${ok ? '✓' : '✗'} URL state restores controls`);
  if (!ok) failed++;
} finally {
  await page.close(); site.stop();
}
process.exit(failed ? 1 : 0);
