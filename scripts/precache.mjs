#!/usr/bin/env node
// The files the service worker caches for offline use (precache.json). `npm run check` fails when
// the list is out of date; `node scripts/precache.mjs --write` regenerates it.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir, ok) => readdirSync(join(ROOT, dir)).sort().flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p, ok) : ok(f) ? [p] : [];
});
export function precacheList() {
  const files = ['./', 'index.html', 'manifest.webmanifest', 'package.json',
    ...walk('css', (f) => f.endsWith('.css')), ...walk('js', (f) => f.endsWith('.js')), ...walk('img', () => true), ...walk('icons', (f) => f.endsWith('.png')),
    'vendor/katex/katex.min.css', 'vendor/katex/katex.min.js', 'vendor/katex/contrib/auto-render.min.js', ...walk('vendor/katex/fonts', (f) => f.endsWith('.woff2'))];
  return { files: files.map((f) => f.split('\\').join('/')) };
}
export const precacheText = () => JSON.stringify(precacheList(), null, 2) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = join(ROOT, 'precache.json');
  if (process.argv.includes('--write')) { writeFileSync(file, precacheText()); console.log(`precache.json: ${precacheList().files.length} files`); }
  else {
    let cur = '';
    try { cur = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (cur !== precacheText()) { console.error(`✗ ${relative(process.cwd(), file)} is out of date: run node scripts/precache.mjs --write`); process.exit(1); }
    console.log(`precache: ${precacheList().files.length} files listed`);
  }
}
