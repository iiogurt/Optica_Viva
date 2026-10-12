#!/usr/bin/env node
// Repository checks with no dependencies:
//  1. every JavaScript module parses (node --check)
//  2. every relative link, image and #anchor in the Markdown files resolves
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir, ext) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (['node_modules', '.git', 'vendor'].includes(f)) return [];
  return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
});
let failures = 0;
const fail = (msg) => { failures++; console.error('✗ ' + msg); };

// 1. syntax
const js = [...walk(join(ROOT, 'js'), '.js'), ...walk(join(ROOT, 'scripts'), '.mjs'), ...walk(join(ROOT, 'test'), '.mjs')];
for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax: ${relative(ROOT, f)}\n${r.stderr}`);
}
console.log(`syntax: ${js.length} files checked`);

// 2. Markdown links (GitHub heading-slug rules)
const slug = (t) => t.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
const anchorsOf = (file) => {
  const seen = new Map(), out = new Set();
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/^#{1,6} (.+)$/gm)) {
    const s = slug(m[1]), k = seen.get(s) || 0;
    out.add(k ? `${s}-${k}` : s); seen.set(s, k + 1);
  }
  return out;
};
const md = readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => join(ROOT, f));
let links = 0;
for (const file of md) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  for (const t of targets) {
    if (/^(https?:|mailto:)/.test(t)) continue;
    links++;
    const [path, anchor] = t.split('#');
    const target = path ? resolve(dirname(file), path) : file;
    if (path && !existsSync(target)) { fail(`${relative(ROOT, file)}: missing file ${t}`); continue; }
    if (anchor && target.endsWith('.md') && !anchorsOf(target).has(anchor)) fail(`${relative(ROOT, file)}: missing anchor ${t}`);
  }
}
console.log(`links: ${links} relative links checked in ${md.length} Markdown files`);
if (failures) { console.error(`${failures} problem(s) found`); process.exit(1); }
console.log('all checks passed');
