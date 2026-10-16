// Guided tours: every step names controls that exist on its laboratory, with valid values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOURS, stepSettings } from '../js/lib/tours.js';

const READY = [...readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').match(/READY = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

test('tour ids are unique and every tour has 3–8 plain-language steps', () => {
  assert.equal(new Set(TOURS.map((t) => t.id)).size, TOURS.length);
  for (const t of TOURS) {
    assert.ok(READY.includes(t.lab), `${t.id}: #/${t.lab} is a ready page`);
    assert.ok(t.steps.length >= 3 && t.steps.length <= 8, `${t.id}: ${t.steps.length} steps`);
    for (const s of t.steps) {
      assert.ok(Object.keys(s.set).length, `${t.id}: every step changes something`);
      assert.doesNotMatch(s.say, /\\\(|\\\[|\$/, `${t.id}: no mathematics in the narration`);
      assert.ok(s.say.split(/\s+/).length <= 70, `${t.id}: a step says at most 70 words`);
    }
  }
});

for (const t of TOURS) {
  test(`${t.id}: steps set real controls of #/${t.lab} within range`, () => {
    const src = readFileSync(new URL(`../js/modules/${t.lab}.js`, import.meta.url), 'utf8');
    for (const [key, v] of Object.entries(stepSettings(t, t.steps.length - 1))) {
      const m = src.match(new RegExp(`\\b${key}: \\{ type: '(\\w+)'[^\\n]*`));
      assert.ok(m, `control ${key}`);
      const [line, type] = m;
      if (type === 'range') {
        const min = +line.match(/min: ([\d.-]+)/)[1], max = +line.match(/max: ([\d.-]+)/)[1];
        assert.ok(v >= min && v <= max, `${key} = ${v} within ${min}…${max}`);
      } else if (type === 'toggle') assert.equal(typeof v, 'boolean', key);
      else assert.ok(line.includes(`'${v}'`) || /Object\.(entries|keys)\(|options: [A-Z]/.test(line), `${key}: option '${v}'`);
    }
  });
}

test('Back restores a step exactly: settings accumulate', () => {
  const t = TOURS.find((x) => x.id === 'stop-down');
  assert.equal(stepSettings(t, 0).N, 2);
  assert.equal(stepSettings(t, 3).sa, 0);
  assert.equal(stepSettings(t, 3).p, 4.3);
});
