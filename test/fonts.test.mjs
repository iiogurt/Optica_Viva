// The interface typefaces are vendored (vendor/fonts/, from the @fontsource-variable npm packages):
// the files match their recorded checksums, every @font-face points at a precached file, and the
// page asks no other host for anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const css = read('css/fonts.css'), html = read('index.html');

test('vendored font files match their recorded checksums', () => {
  const sums = read('vendor/fonts/SHA256SUMS').trim().split('\n').map((l) => l.split(/\s+/));
  assert.equal(sums.length, 12, '9 fonts and 3 licences');
  for (const [hash, file] of sums) assert.equal(createHash('sha256').update(readFileSync(new URL('vendor/fonts/' + file, root))).digest('hex'), hash, file);
});

test('every @font-face file exists, is precached and is used; every family of the design system is defined', () => {
  const urls = [...css.matchAll(/url\(\.\.\/([^)]+)\)/g)].map((m) => m[1]);
  const { files } = JSON.parse(read('precache.json'));
  assert.equal(urls.length, 9);
  for (const u of urls) { assert.ok(existsSync(new URL(u, root)), u); assert.ok(files.includes(u), `${u} is precached`); }
  for (const f of files.filter((f) => f.startsWith('vendor/fonts/'))) assert.ok(urls.includes(f), `${f} has an @font-face`);
  for (const fam of ['Inter', 'Fraunces', 'JetBrains Mono']) {
    assert.ok(css.includes(`font-family: '${fam}'`), `${fam} is defined`);
    assert.match(read('css/style.css'), new RegExp(`--font-\\w+: '?${fam}'?,`), `${fam} is the first choice of a --font variable`);
  }
  for (const m of html.matchAll(/rel="preload" href="([^"]+)"/g)) assert.ok(urls.includes(m[1]), `preloaded ${m[1]} is a font of fonts.css`);
});

test('the page and its stylesheets load nothing from another host', () => {
  assert.ok(!/(href|src)="(https?:)?\/\//.test(html), 'index.html');
  for (const f of ['css/fonts.css', 'css/style.css']) assert.ok(!/url\(\s*['"]?(https?:)?\/\//.test(read(f)) && !/@import/.test(read(f)), f);
  assert.ok(!/googleapis|gstatic/.test(read('sw.js')), 'sw.js');
});
