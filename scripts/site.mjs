#!/usr/bin/env node
// The deployable site: an explicit list of what the browser needs, copied into a fresh directory,
// then checked against itself (every precache entry, the service worker, the manifest's icons, and
// every local file named in index.html or in a string in js/). Development files (.git, test/,
// scripts/, docs/, Markdown) stay out.
//   node scripts/site.mjs <out>   assemble into <out> (must not exist or be empty) and verify it
// The Pages workflow deploys this directory; the browser smoke test runs against it.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = ['index.html', 'sw.js', 'precache.json', 'package.json', 'manifest.webmanifest', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'css', 'js', 'img', 'icons', 'vendor'];

export function assemble(out) {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  for (const f of SITE) cpSync(join(ROOT, f), join(out, f), { recursive: true });
  writeFileSync(join(out, '.nojekyll'), ''); // serve files as they are, without Jekyll
  return out;
}

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const isFile = (dir, p) => { try { return statSync(join(dir, p)).isFile(); } catch { return false; } };

// Problems with the site in dir, as sentences (empty when it is complete).
export function verify(dir) {
  const problems = [];
  const need = (p, why) => { if (!isFile(dir, p)) problems.push(`${p} missing (${why})`); };
  for (const f of ['index.html', 'sw.js', 'precache.json', 'package.json', 'manifest.webmanifest']) need(f, 'runtime file');
  // the lists come from the source when the site lacks them, so every missing file is named
  const json = (f) => JSON.parse(readFileSync(join(isFile(dir, f) ? dir : ROOT, f), 'utf8'));
  for (const f of json('precache.json').files) need(f === './' ? 'index.html' : f, 'precache.json');
  for (const i of json('manifest.webmanifest').icons || []) need(i.src, 'manifest icon');
  const html = readFileSync(join(isFile(dir, 'index.html') ? dir : ROOT, 'index.html'), 'utf8');
  for (const [, u] of html.matchAll(/(?:href|src)="([^"#?:]+)"/g)) if (!u.startsWith('/')) need(u, 'index.html');
  for (const file of (existsSync(join(dir, 'js')) ? walk(join(dir, 'js')) : []).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(file, 'utf8');
    for (const [, u] of src.matchAll(/['"`]((?:img|icons|css|vendor)\/[\w./-]+\.\w+)['"`]/g)) need(u, relative(dir, file));
  }
  for (const bad of ['.git', 'test', 'scripts', 'docs', 'node_modules', '.github']) if (existsSync(join(dir, bad))) problems.push(`${bad} must not be deployed`);
  if (isFile(dir, 'package.json') && json('package.json').version !== JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version) problems.push('package.json version differs from the source');
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/site.mjs <out>'); process.exit(2); }
  assemble(resolve(out));
  const problems = verify(resolve(out));
  for (const p of problems) console.error(`✗ site: ${p}`);
  if (problems.length) process.exit(1);
  console.log(`site: ${walk(resolve(out)).length} files in ${out}, complete`);
}
