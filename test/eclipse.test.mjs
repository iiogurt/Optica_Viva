// Mission "Total solar eclipse": Espenak's exposure formula, the ladder's range, framing and drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECTS, exposure, nearestShutter, coronaQ, driftLimit, fFor, SUN_RADIUS } from '../js/lib/eclipse.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('t = N²/(I·2^Q): 1/100 s for the inner corona at f/8, ISO 200', () => {
  near(exposure(8, 200, 5), 0.01, 1e-12, 'Q = 5');
  near(exposure(8, 200, -1) / exposure(8, 200, 0), 2, 1e-12, 'one step in Q is one stop');
  assert.equal(nearestShutter(0.0098), 1 / 100);
});

test('Espenak table values and the 15-stop range of totality', () => {
  const Q = Object.fromEntries(SUBJECTS.map(([n, q]) => [n.split(' ')[0], q]));
  assert.equal(Q.Prominences, 9);
  assert.equal(Q.Chromosphere, 11);
  const total = SUBJECTS.filter((s) => s[2] === 'total').map((s) => s[1]);
  assert.equal(Math.max(...total) - Math.min(...total), 15);
  near(coronaQ(1), 1, 1e-12, 'table point');
  assert.ok(coronaQ(0.3) < 5 && coronaQ(0.3) > 3, 'interpolated between table points');
});

test('framing and drift', () => {
  near(2 * 500 * Math.tan(SUN_RADIUS), 4.65, 0.01, 'Sun image at 500 mm');
  near(fFor(24, 4), 516, 1, 'corona to 4 R☉ on full frame');
  near(driftLimit(500, 4.4), 0.1207, 0.0005, 'one pixel of drift');
});
