// Interface translation: every string passed to t() or marked with N_(), every control label, hint
// and option, readout name and figure caption, every laboratory title, group and blurb, the guided
// tours' titles and blurbs and the Start-here path must have a translation in every locale, with
// the same {placeholders}; locales hold no unused strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interfaceStrings } from './lib/strings.mjs';
import { LANGS, t, loadLocale, localNum, fmtInt } from '../js/lib/i18n.js';
import { fmt, texNum } from '../js/lib/ui.js';
import { TOURS } from '../js/lib/tours.js';
import { PATH } from '../js/lib/path.js';

const STR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60(?:[^\x60\\$]|\\.)*\x60`;
const decode = (lit) => new Function('return ' + lit)();

// Source strings (test/lib/strings.mjs), plus the registry's titles, groups and blurbs, the tours'
// titles and blurbs and the Start-here path.
function allStrings() {
  const keys = interfaceStrings();
  const app = readFileSync('js/app.js', 'utf8');
  const reg = app.slice(app.indexOf('export const MODULES'), app.indexOf('];', app.indexOf('export const MODULES')));
  for (const m of reg.matchAll(new RegExp(String.raw`\b(?:title|group|blurb): (${STR})`, 'g'))) keys.add(decode(m[1]));
  for (const tour of TOURS) { keys.add(tour.title); keys.add(tour.blurb); }
  for (const st of PATH) { keys.add(st.stage); keys.add(st.note); for (const [, q] of st.steps) keys.add(q); }
  return keys;
}
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every interface string is translated in every locale, with the same placeholders', async () => {
  const keys = allStrings();
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

test('German, French and Spanish get decimal commas and grouped thousands; English is unchanged', async () => {
  await loadLocale('de');
  assert.equal(t('{d} km', { d: '2.17' }), '2,17 km');
  assert.equal(t('{d} km', { d: 37000 }), '37\u202f000 km', 'whole numbers from 10 000 up are grouped');
  assert.equal(localNum(localNum('f/1.8 and 2.170')), 'f/1,8 and 2,170', 'applying it twice changes nothing');
  assert.equal(fmt(1234.5, 5), '1\u202f234,5');
  assert.equal(texNum(2.17), '2{,}17');
  assert.equal(fmtInt(1800000), '1\u202f800\u202f000');
  await loadLocale('en');
  assert.equal(t('{d} km', { d: '2.17' }), '2.17 km');
  assert.equal(fmt(1234.5, 5), '1,234.5');
  assert.equal(fmtInt(1800000), '1,800,000');
  assert.equal(texNum(2.17), '2.17');
});
