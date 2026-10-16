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
  // shareable state: a URL with parameters must restore the controls
  await page.goto(site.url + '#/psf?preset=hubble&band=white', 4000);
  const ok = await page.eval(`document.querySelector('select').value === 'hubble' && [...document.querySelectorAll('.seg button')].some((b) => b.classList.contains('on') && /White/.test(b.textContent))`);
  console.log(`${ok ? '✓' : '✗'} URL state restores controls`);
  if (!ok) failed++;
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
} finally {
  await page.close(); site.stop();
}
process.exit(failed ? 1 : 0);
