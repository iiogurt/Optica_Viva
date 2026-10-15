// Misconception checks: one well-formed question per listed laboratory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHECKS } from '../js/lib/misconceptions.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const ready = new Set([...app.match(/READY = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));

test('every check belongs to a laboratory and is well formed', () => {
  assert.ok(Object.keys(CHECKS).length >= 8);
  for (const [id, c] of Object.entries(CHECKS)) {
    assert.ok(ready.has(id), `${id} is a laboratory`);
    assert.match(c.q, /\?$/, `${id}: a question`);
    assert.ok(c.options.length >= 3 && c.options.length <= 4, `${id}: 3–4 options`);
    assert.ok(Number.isInteger(c.answer) && c.answer >= 0 && c.answer < c.options.length, `${id}: answer index`);
    assert.equal(new Set(c.options).size, c.options.length, `${id}: distinct options`);
    const words = c.why.split(/\s+/).length;
    assert.ok(words <= 70 && /\.\)?$/.test(c.why), `${id}: explanation of ${words} words ending with a full stop`);
  }
});
