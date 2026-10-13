// Lucky imaging: tip-tilt removal, Fried's probability slope, and the gain from frame selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luckySim, removeTipTilt, friedProbability } from '../js/lib/lucky.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('tip-tilt removal leaves zero variance for a pure tilt', () => {
  const Np = 32, ph = new Float64Array(Np * Np);
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) ph[y * Np + x] = 0.3 * x - 0.2 * y + 1.5;
  near(removeTipTilt(ph, Np), 0, 1e-20, 'residual variance');
});

test("the probability of a lucky frame falls with Fried's exponential slope", () => {
  const P = (d) => { let n = 0, c = 0; for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) { const s = luckySim({ Dr0: d, frames: 300, Np: 32, withImages: false, step: 6, seed }).stats; c += s.length; n += s.filter((q) => q.v <= 1).length; } return n / c; };
  const p4 = P(4), p6 = P(6), slope = Math.log(p6 / p4) / (36 - 16);
  near(slope / -0.1557, 1, 0.3, `slope of ln P vs (D/r₀)² (${slope.toFixed(3)})`);
  assert.ok(p6 / friedProbability(6) > 0.3 && p6 / friedProbability(6) < 3, `P(6) = ${p6} vs Fried ${friedProbability(6)}`);
});

test('selection beats shift-and-add, which beats the long exposure', () => {
  const r = luckySim({ Dr0: 5, frames: 120, keep: 0.1, Np: 32, N: 64, step: 4, seed: 7 });
  assert.ok(r.strehl.lucky > 1.4 * r.strehl.tt && r.strehl.tt > 2 * r.strehl.long, JSON.stringify(r.strehl));
});
