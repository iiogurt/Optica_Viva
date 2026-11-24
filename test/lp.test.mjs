// The dense simplex solver: textbook answers, a degenerate problem and duality certificates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplex } from '../js/lib/lp.js';
import { uniform } from '../js/lib/random.js';

test('simplex: a textbook program and a degenerate one', () => {
  // maximise 3x + 5y with x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18: 36 at (2, 6), duals (0, 3/2, 1)
  const r = simplex([[1, 0], [0, 2], [3, 2]], [4, 12, 18], [-3, -5]);
  assert.ok(Math.abs(r.value + 36) < 1e-12 && Math.abs(r.x[0] - 2) < 1e-12 && Math.abs(r.x[1] - 6) < 1e-12);
  assert.deepEqual(Array.from(r.y, (v) => Math.round(v * 1e9) / 1e9), [0, 1.5, 1]);
  const d = simplex([[1, 1], [1, -1], [1, 0], [0, 1]], [1, 0, 1, 1], [-1, -1]);
  assert.ok(Math.abs(d.value + 1) < 1e-12);
  assert.throws(() => simplex([[1, -1]], [1], [-1, 0]), /unbounded/);
});

test('simplex: minimax programs with an infeasible origin meet the duality certificates', () => {
  const u = uniform(5);
  for (let t = 0; t < 100; t++) {
    const m = 30, n = 12, G = [], h = [];
    for (let i = 0; i < m; i++) { G.push([...Array.from({ length: n }, () => u() - 0.5), -1]); h.push(u() - 0.7); }
    G.push([...Array(n).fill(1), 0]); h.push(1);
    const c = [...Array(n).fill(0), 1], s = simplex(G, h, c, { enter: n });
    // primal feasible, dual feasible (y ≥ 0, Gᵀy + c ≥ 0) and equal objectives
    for (let i = 0; i < G.length; i++) assert.ok(G[i].reduce((a, g, j) => a + g * s.x[j], 0) <= h[i] + 1e-12);
    for (let j = 0; j <= n; j++) assert.ok(c[j] + G.reduce((a, row, i) => a + row[j] * s.y[i], 0) >= -1e-12);
    assert.ok(Math.min(...s.y) >= -1e-12);
    assert.ok(Math.abs(s.value + h.reduce((a, v, i) => a + v * s.y[i], 0)) < 1e-12);
  }
});
