// "Start here" path: existing, distinct laboratories, each with the question it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATH } from '../js/lib/path.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const ready = new Set([...app.match(/READY = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));

test('the path visits existing laboratories once each, with a question per step', () => {
  const ids = PATH.flatMap((s) => s.steps.map(([id]) => id));
  assert.deepEqual(ids.filter((id) => !ready.has(id) || id === 'home' || id === 'catalogue'), []);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  assert.equal(PATH.length, 3);
  for (const s of PATH) for (const [id, q] of s.steps) assert.match(q, /^[A-Z].*\?$/, id);
});
