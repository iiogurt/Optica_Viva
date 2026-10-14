// Glossary: short plain definitions, valid laboratory links, terms that occur in the pages, and
// the matcher marking only the first use of each term.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GLOSSARY, markTerms } from '../js/lib/glossary.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const labs = new Set([...app.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]));
const dir = new URL('../js/modules/', import.meta.url);
const pages = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');

test('definitions are short, plain and unique', () => {
  const names = GLOSSARY.map((g) => g.term.toLowerCase());
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const g of GLOSSARY) {
    const words = g.def.split(/\s+/).length;
    assert.ok(words <= 35, `${g.term}: ${words} words`);
    assert.match(g.def, /\.$/, `${g.term} ends with a full stop`);
    assert.doesNotMatch(g.def, /\\\(|\\\[|\$/, `${g.term} has no mathematics`);
    assert.ok(!g.lab || labs.has(g.lab), `${g.term}: unknown laboratory ${g.lab}`);
  }
});

test('every term occurs in some page', () => {
  const missing = GLOSSARY.filter((g) => !g.match.some((m) => new RegExp(`(?<![\\w-])(?:${m})(?![\\w-])`, /[A-Z]/.test(m) ? '' : 'i').test(pages)));
  assert.deepEqual(missing.map((g) => g.term), []);
});

test('the first use of each term is marked, longest match first, abbreviations by case', () => {
  const parts = markTerms('Spherical aberration is an aberration. The PSF and the psf; ISO but not isoplanatic; the f-number and the f-number.');
  const marked = parts.filter((p) => typeof p !== 'string').map((p) => p.text);
  assert.deepEqual(marked, ['Spherical aberration', 'aberration', 'PSF', 'ISO', 'f-number']);
  assert.equal(parts.map((p) => (typeof p === 'string' ? p : p.text)).join(''), 'Spherical aberration is an aberration. The PSF and the psf; ISO but not isoplanatic; the f-number and the f-number.');
});

test('a term already seen on the page is not marked again', () => {
  const seen = new Set();
  markTerms('the depth of field', seen);
  assert.deepEqual(markTerms('more depth of field', seen), ['more depth of field']);
});
