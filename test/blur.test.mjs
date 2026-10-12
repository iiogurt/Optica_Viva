// The Safari-safe blur must behave like a Gaussian: conserve energy and have variance σ².
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesForGauss, gaussianBlurPlane, gaussianBlurRGBA } from '../js/lib/blur.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: got ${a}, expected ${e} ± ${tol}`);

test('three box widths reproduce the requested Gaussian variance', () => {
  for (const sigma of [0.8, 2, 5.5, 12]) {
    const v = boxesForGauss(sigma).reduce((s, w) => s + (w * w - 1) / 12, 0);
    near(Math.sqrt(v), sigma, 0.35, `σ = ${sigma}`);
  }
});

test('blurring an impulse conserves energy and spreads it with variance ≈ σ²', () => {
  const w = 121, h = 121, sigma = 6, p = new Float32Array(w * h);
  p[60 * w + 60] = 1;
  gaussianBlurPlane(p, w, h, sigma);
  let sum = 0, vx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { sum += p[y * w + x]; vx += p[y * w + x] * (x - 60) ** 2; }
  near(sum, 1, 1e-4, 'energy');
  near(Math.sqrt(vx / sum), sigma, 0.4, 'measured σ (px)');
  near(p[60 * w + 60], 1 / (2 * Math.PI * sigma * sigma), 0.0008, 'peak ≈ Gaussian peak');
});

test('RGBA blur is premultiplied: a transparent surround does not darken colour', () => {
  const w = 41, h = 41, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) { const i = (y * w + x) * 4; d[i] = 255; d[i + 1] = 128; d[i + 3] = 255; }
  const out = gaussianBlurRGBA(d, w, h, 3);
  const edge = (20 * w + 13) * 4; // partially covered pixel outside the square
  assert.ok(out[edge + 3] > 0 && out[edge + 3] < 255, 'edge alpha is partial');
  near(out[edge], 255, 2, 'red stays saturated at the soft edge');
  near(out[edge + 1], 128, 2, 'green keeps its value at the soft edge');
});
