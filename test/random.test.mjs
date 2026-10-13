// Shared random numbers: moments, independence of consecutive deviates, Poisson statistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniform, makeRng } from '../js/lib/random.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('uniform and normal moments', () => {
  const u = uniform(1), n = 200000; let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const v = u(); s += v; s2 += v * v; }
  near(s / n, 0.5, 0.003, 'uniform mean'); near(s2 / n - (s / n) ** 2, 1 / 12, 0.001, 'uniform variance');
  const { g } = makeRng(2); let a = 0, b = 0;
  for (let i = 0; i < n; i++) { const v = g(); a += v; b += v * v; }
  near(a / n, 0, 0.01, 'normal mean'); near(b / n, 1, 0.01, 'normal variance');
});

test('sums of consecutive normal deviates have the right variance (no serial correlation)', () => {
  // the defect of a 32-bit LCG feeding Box–Muller: Var(Σ₂₀ g) came out ≈ 8 % too high
  const { g } = makeRng(3), sums = [];
  for (let k = 0; k < 20000; k++) { let s = 0; for (let i = 0; i < 20; i++) s += g(); sums.push(s); }
  const m = sums.reduce((x, y) => x + y, 0) / sums.length, v = sums.reduce((x, y) => x + (y - m) ** 2, 0) / (sums.length - 1);
  near(v / 20, 1, 0.03, 'Var(Σ g)/n');
  let c = 0, prev = g(); for (let i = 0; i < 100000; i++) { const x = g(); c += x * prev; prev = x; }
  near(c / 100000, 0, 0.01, 'lag-1 autocorrelation');
});

test('Poisson deviates have mean = variance', () => {
  const { poisson } = makeRng(4);
  for (const mu of [0.5, 5, 80]) {
    let s = 0, s2 = 0; const n = 50000;
    for (let i = 0; i < n; i++) { const k = poisson(mu); s += k; s2 += k * k; }
    near(s / n / mu, 1, 0.02, `mean at μ = ${mu}`); near((s2 / n - (s / n) ** 2) / mu, 1, 0.04, `variance at μ = ${mu}`);
  }
});
