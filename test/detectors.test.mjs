// Detector physics: up-the-ramp slope noise, jump detection, IPC, CTI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng, ramp, slopeLS, slopeCDS, slopeJump, slopeVarianceLS, slopeVarianceCDS, ipc, ipcVarianceFactor, ctiColumn } from '../js/lib/detectors.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const variance = (x) => { const m = x.reduce((a, b) => a + b, 0) / x.length; return x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1); };

test('up-the-ramp: Monte-Carlo slope variance matches the exact LS and CDS formulas', () => {
  const r = rng(11), o = { N: 16, dt: 10, f: 3, sigma: 12 }, ls = [], cds = [];
  for (let k = 0; k < 5000; k++) { const S = ramp(o, r); ls.push(slopeLS(S, o.dt)); cds.push(slopeCDS(S, o.dt)); }
  near(variance(ls) / slopeVarianceLS(o.N, o.dt, o.sigma, o.f), 1, 0.06, 'least squares');
  near(variance(cds) / slopeVarianceCDS(o.N, o.dt, o.sigma, o.f), 1, 0.06, 'CDS');
  // read-noise only: σ² = 12σ_r²/(N(N²−1)Δt²)
  near(slopeVarianceLS(o.N, o.dt, o.sigma, 0), (12 * o.sigma ** 2) / (o.N * (o.N ** 2 - 1) * o.dt ** 2), 1e-12, 'read-noise term');
});

test('jump detection removes a cosmic ray', () => {
  const r = rng(4), o = { N: 30, dt: 10, f: 2, sigma: 10, crAt: 12, jump: 300 };
  let bias = 0; const n = 300;
  for (let k = 0; k < n; k++) { const S = ramp(o, r), j = slopeJump(S, o.dt, o.sigma); bias += j.slope - o.f; }
  near(bias / n, 0, 0.05, 'mean slope error after jump detection');
  assert.ok(slopeLS(ramp(o, rng(4)), o.dt) > o.f + 0.5, 'a fit through the jump is biased');
});

test('IPC conserves charge and lowers the flat-field variance by (1 − 4α)² + 4α²', () => {
  const r = rng(2), W = 96, img = Float64Array.from({ length: W * W }, () => 1000 + Math.sqrt(1000) * r.g()), out = ipc(img, W, W, 0.02);
  near(out.reduce((a, b) => a + b, 0), img.reduce((a, b) => a + b, 0), 1e-6, 'charge');
  near(variance(Array.from(out)) / variance(Array.from(img)), ipcVarianceFactor(0.02), 0.02, 'variance factor');
});

test('CTI: the core keeps (1 − ε)ⁿ and the lost charge reappears in the trail', () => {
  const col = new Float64Array(300); col[40] = 1e4;
  const out = ctiColumn(col, 1500, 2e-5, 4);
  near(out[40], 1e4 * Math.pow(1 - 2e-5, 1500), 0.5, 'core');
  const trail = out.slice(41).reduce((a, b) => a + b, 0);
  near(trail + out[40], 1e4, 1, 'charge conserved in the column');
});
