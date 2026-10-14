// Explanation ladder: a page that opens with the plain idea must also give a rule of thumb with
// its limits and say the live result in words. The idea itself stays short and free of symbols.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../js/modules/', import.meta.url);
const pages = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ id: f.slice(0, -3), src: readFileSync(new URL(f, dir), 'utf8') }));
const laddered = pages.filter((p) => /\bidea\(String\.raw`/.test(p.src));
// every page in the sidebar except the home page and the catalogue
const READY = [...readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').match(/READY = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
const LABS = READY.filter((id) => id !== 'home' && id !== 'catalogue');

test('every laboratory has a ladder', () => {
  assert.ok(LABS.length >= 39);
  assert.deepEqual(LABS.filter((id) => !laddered.some((p) => p.id === id)), []);
});

for (const { id, src } of laddered) {
  test(`${id}: idea, things to try, rule of thumb with limits, result in words`, () => {
    const [, text, tries] = src.match(/\bidea\(String\.raw`([\s\S]*?)`,\s*\[([\s\S]*?)\]\)\);/) || [];
    assert.ok(text, 'idea(html, tries) not found');
    assert.doesNotMatch(text, /\\\(|\\\[/, 'the idea uses no mathematical symbols');
    const words = text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 120, `the idea has ${words} words (at most 120)`);
    const n = (tries.match(/^\s*['"`]/gm) || []).length;
    assert.ok(n >= 1 && n <= 3, `${n} things to try (1–3)`);
    assert.match(src, /\brule\(String\.raw`[\s\S]*?`,\s*String\.raw`/, 'rule(html, limits) with a "where it stops working" note');
    if (/\bliveCalc\(/.test(src)) assert.match(src, /\bcalc\.say\(/, 'the live calculation says the result in words');
  });
}
