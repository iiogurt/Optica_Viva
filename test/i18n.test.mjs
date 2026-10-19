// Interface translation: every string passed to t() or marked with N_(), every laboratory title,
// group and blurb, the guided tours' titles and blurbs and the Start-here path must have a
// translation in every locale, with the same {placeholders}; locales hold no unused strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, t, loadLocale } from '../js/lib/i18n.js';
import { TOURS } from '../js/lib/tours.js';
import { PATH } from '../js/lib/path.js';

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const decode = (lit) => new Function('return ' + lit)();
const STR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60(?:[^\x60\\$]|\\.)*\x60`;

export function interfaceStrings() {
  const keys = new Set();
  for (const f of walk('js').filter((f) => !f.startsWith(join('js', 'locales')))) {
    for (const m of readFileSync(f, 'utf8').matchAll(new RegExp(String.raw`(?<![\w.$])(?:t|N_)\(\s*(${STR})`, 'g'))) keys.add(decode(m[1]));
  }
  const app = readFileSync('js/app.js', 'utf8');
  const reg = app.slice(app.indexOf('export const MODULES'), app.indexOf('];', app.indexOf('export const MODULES')));
  for (const m of reg.matchAll(new RegExp(String.raw`\b(?:title|group|blurb): (${STR})`, 'g'))) keys.add(decode(m[1]));
  for (const tour of TOURS) { keys.add(tour.title); keys.add(tour.blurb); }
  for (const st of PATH) { keys.add(st.stage); keys.add(st.note); for (const [, q] of st.steps) keys.add(q); }
  return keys;
}
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every interface string is translated in every locale, with the same placeholders', async () => {
  const keys = interfaceStrings();
  assert.ok(keys.size > 150, `${keys.size} interface strings found`);
  for (const l of Object.keys(LANGS).filter((l) => l !== 'en')) {
    const dict = (await import(`../js/locales/${l}.js`)).default;
    const missing = [...keys].filter((k) => !dict[k]);
    assert.deepEqual(missing, [], `${l}: ${missing.length} untranslated`);
    const unused = Object.keys(dict).filter((k) => !keys.has(k));
    assert.deepEqual(unused, [], `${l}: strings no longer used`);
    for (const k of keys) assert.equal(holes(dict[k]), holes(k), `${l}: placeholders of "${k.slice(0, 40)}"`);
  }
});

test('t() falls back to English and fills placeholders', async () => {
  await loadLocale('en');
  assert.equal(t('Start ({n} steps)', { n: 5 }), 'Start (5 steps)');
  await loadLocale('de');
  assert.notEqual(t('Copy link'), 'Copy link');
  assert.equal(t('a string nobody translated'), 'a string nobody translated');
  assert.match(t('Start ({n} steps)', { n: 5 }), /5/);
  await loadLocale('en');
});
