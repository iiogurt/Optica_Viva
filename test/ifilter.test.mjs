// Interference filters in converging beams: angle shift, cone averaging and pre-shift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shifted, passband, coneTransmission, bestPreshift } from '../js/lib/ifilter.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('angle shift: exact formula and its small-angle limit', () => {
  near(656.28 - shifted(656.28, Math.atan(1 / 4), 2.05), 4.61, 0.02, 'f/2 marginal ray');
  const th = 0.05;
  near(656.28 - shifted(656.28, th, 2.0), (656.28 * th * th) / (2 * 4), 0.01, 'λθ²/(2n²)');
  near(passband(656.28 + 1.5, 656.28, 3), 0.5, 1e-12, 'half maximum at FWHM/2');
});

test('a slow beam passes the line; a fast beam and a narrow filter lose it; pre-shifting helps', () => {
  const o = { centre: 656.28, fwhm: 3, n: 2.05 };
  assert.ok(coneTransmission(656.28, { ...o, N: 10 }) > 0.99, 'f/10');
  const fast = coneTransmission(656.28, { ...o, N: 2 });
  assert.ok(fast < 0.5, 'f/2 with 3 nm');
  const b = bestPreshift(656.28, { fwhm: 3, n: 2.05, N: 2 });
  assert.ok(b.shift > 1 && b.T > 2 * fast, 'pre-shifted filter');
  assert.ok(coneTransmission(656.28, { ...o, N: 4, chief: 0.15 }) < coneTransmission(656.28, { ...o, N: 4 }), 'off-axis corners lose more');
});
