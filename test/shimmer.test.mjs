// Seeing on the camera feed (js/lib/shimmer.js): G-tilt maps, their variance, the short-exposure
// blur and the warp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAM0, tiltMaps, tiltVarianceGrid, tiltVariance, shortExposureFWHM, displacementGrid, warpRGBA, isoplanatic } from '../js/lib/shimmer.js';

const rel = (a, b) => Math.abs(a / b - 1);

test("G-tilt per axis is Tyler's 0.170 (λ/D)² (D/r₀)^{5/3} for Kolmogorov turbulence", () => {
  // exact coefficient 0.023·π·4·∫u^{-8/3}J₁²(u)du / π^{1/3} = 0.1706 (Weber–Schafheitlin)
  for (const [D, r0] of [[0.1, 0.02], [0.05, 0.1], [1, 0.15]]) {
    const ref = 0.1706 * (LAM0 / D) ** 2 * (D / r0) ** (5 / 3);
    assert.ok(rel(tiltVariance(D, r0), ref) < 0.01, `D = ${D}, r0 = ${r0}: ${tiltVariance(D, r0) / ref}`);
  }
  // an outer scale removes the largest eddies, which carry most of the tilt
  assert.ok(tiltVariance(0.1, 0.02, 2) < 0.8 * tiltVariance(0.1, 0.02));
});

test('the tilt maps have the variance their frequency grid predicts, scaling as r₀^{-5/3}', () => {
  const P = { N: 128, dx: 0.025, r0: 0.02, L0: 2, D: 0.1 };
  let s = 0, n = 0;
  for (let seed = 1; seed <= 12; seed++) { const m = tiltMaps({ ...P, seed }); for (let k = 0; k < m.tx.length; k += 3) { s += m.tx[k] ** 2 + m.ty[k] ** 2; n += 2; } }
  const g = tiltVarianceGrid(P);
  assert.ok(rel(s / n, g) < 0.06, `measured ${s / n} vs grid ${g}`);
  assert.ok(rel(tiltVarianceGrid(P) / tiltVarianceGrid({ ...P, r0: 0.04 }), 2 ** (5 / 3)) < 1e-9);
  // a grid four times wider than the outer scale holds most of the continuum variance
  assert.ok(g / tiltVariance(0.1, 0.02, 2) > 0.8, `grid/continuum ${g / tiltVariance(0.1, 0.02, 2)}`);
});

test('short-exposure blur: diffraction when D ≪ r₀, near the long exposure when D ≫ r₀', () => {
  const small = shortExposureFWHM(0.01, 0.2, 0.55e-6);
  assert.ok(rel(small.short, small.diffraction) < 0.02, `${small.short} vs ${small.diffraction}`);
  const big = shortExposureFWHM(2, 0.02, 0.55e-6);
  assert.ok(big.short > 0.7 * big.long && big.short < big.long, `short/long ${big.short / big.long}`);
  const mid = shortExposureFWHM(0.1, 0.02, 0.55e-6);
  assert.ok(mid.short > mid.diffraction && mid.short < mid.long);
});

test('the warp: zero displacement is the identity, a uniform one shifts the frame', () => {
  const w = 16, h = 12, src = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) { src[k * 4] = (k % w) * 10; src[k * 4 + 1] = Math.floor(k / w) * 10; src[k * 4 + 3] = 255; }
  const gw = 5, gh = 4, zero = { ox: new Float32Array(gw * gh), oy: new Float32Array(gw * gh) };
  assert.deepEqual(Array.from(warpRGBA(src, w, h, zero, gw, gh)), Array.from(src));
  const two = { ox: new Float32Array(gw * gh).fill(2), oy: new Float32Array(gw * gh).fill(1) }, out = warpRGBA(src, w, h, two, gw, gh);
  assert.equal(out[(5 * w + 8) * 4], 60); // x − 2
  assert.equal(out[(5 * w + 8) * 4 + 1], 40); // y − 1
  // displacement nodes: angle / pixel scale, sampled where the layer sees each field point
  const N = 8, tx = new Float32Array(N * N).fill(3e-6), ty = new Float32Array(N * N).fill(-1e-6);
  const d = displacementGrid({ tx, ty, N, dx: 0.1 }, { w, h, gw, gh, scale: 1e-6, z: 100, shift: 0.3 });
  assert.ok(Math.abs(d.ox[7] - 3) < 1e-5 && Math.abs(d.oy[7] + 1) < 1e-5);
  assert.ok(rel(isoplanatic(0.02, 100), 6.28e-5) < 1e-9);
});
