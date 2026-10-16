// Exercises: answers against known values, tolerant parsing, and controls that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXERCISES, check, parseAnswer } from '../js/lib/exercises.js';
import { uniform } from '../js/lib/random.js';

const find = (lab, id) => EXERCISES[lab].find((e) => e.id === id);

test('answers match textbook values', () => {
  // 24 mm at f/8, c = 28.8 µm: H = 576/0.2307 + 24 mm = 2.52 m
  assert.ok(Math.abs(find('dof', 'hyperfocal').answer({ f: 24, N: 8 }) - 2.52) < 0.01);
  assert.ok(Math.abs(find('mtf', 'cutoff').answer({ N: 8 }) - 227.3) < 0.1);
  assert.ok(Math.abs(find('mtf', 'match').answer({ p: 4.3 }) - 15.64) < 0.01);
  assert.ok(Math.abs(find('psf', 'rayleigh').answer({ D: 6.6 }) - 20.97) < 0.01);
  assert.ok(Math.abs(find('psf', 'airy').answer({ N: 8 }) - 10.74) < 0.01);
  assert.equal(find('flare', 'ghosts').answer({ k: 10 }), 45);
  // 85 mm f/1.8 at 2.2 m on full frame: 6.7 cm (the dof laboratory shows 0.0669 m)
  const d = find('dof', 'dof-total').answer({ f: 85, N: 1.8, s: 2.2 });
  assert.ok(Math.abs(d - 6.69) < 0.02, String(d));
});

test('typed answers: decimal comma, units, tolerance, exact counts', () => {
  assert.equal(parseAnswer(' 2,52 m'), 2.52);
  const hf = find('dof', 'hyperfocal'), v = { f: 24, N: 8 };
  assert.equal(check(hf, v, '2.5'), true);
  assert.equal(check(hf, v, '2,4'), false);
  assert.equal(check(hf, v, 'about'), null);
  const g = find('flare', 'ghosts');
  assert.equal(check(g, { k: 10 }, '45'), true);
  assert.equal(check(g, { k: 10 }, '44.9'), false);
});

for (const [lab, list] of Object.entries(EXERCISES)) {
  const src = readFileSync(new URL(`../js/modules/${lab}.js`, import.meta.url), 'utf8');
  test(`${lab}: every exercise generates valid cases and sets real controls`, () => {
    for (const ex of list) {
      for (let seed = 1; seed < 40; seed++) {
        const v = ex.gen(uniform(seed));
        assert.ok(isFinite(ex.answer(v)) && ex.answer(v) > 0, `${ex.id}: answer`);
        assert.ok(ex.q(v).length > 40 && ex.solution(v).includes(String(+ex.answer(v).toPrecision(3)).slice(0, 3)), `${ex.id}: question and solution`);
        for (const [key, x] of Object.entries(ex.set(v) || {})) {
          const m = src.match(new RegExp(`\\b${key}: \\{ type: '(\\w+)'[^\\n]*`));
          assert.ok(m, `${ex.id}: control ${key}`);
          if (m[1] === 'range') {
            const min = +m[0].match(/min: ([\d.-]+)/)[1], max = +m[0].match(/max: ([\d.-]+)/)[1];
            assert.ok(x >= min && x <= max, `${ex.id}: ${key} = ${x} in ${min}…${max}`);
          }
        }
      }
    }
  });
}
