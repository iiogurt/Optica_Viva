// The Safari-safe blurs: the Gaussian must conserve energy and have variance σ²; the disk
// (pillbox, the geometric defocus kernel) must conserve energy, be flat inside and have
// <r²> = r²/2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesForGauss, gaussianBlurPlane, gaussianBlurRGBA, diskBlur, diskBlurRGBA } from '../js/lib/blur.js';

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

test('disk blur: unit sum, flat top of height 1/(πr²), RMS radius r/√2 (exact and downsampled paths)', () => {
  const w = 241, h = 241, c = 120;
  for (const r of [3, 7.5, 12, 24, 40]) {
    const p = new Float32Array(w * h);
    p[c * w + c] = 1;
    diskBlur(p, w, h, r);
    let s = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = p[y * w + x]; s += v; sx += v * x; sy += v * y; }
    const mx = sx / s, my = sy / s;
    let s2 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s2 += p[y * w + x] * ((x - mx) ** 2 + (y - my) ** 2);
    near(s, 1, 1e-5, `r = ${r}: energy`);
    near(Math.sqrt((2 * s2) / s) / r, 1, 0.025, `r = ${r}: RMS radius / r`);
    near(p[Math.round(my) * w + Math.round(mx)] * Math.PI * r * r, 1, 0.08, `r = ${r}: plateau × πr²`);
  }
});

test('disk-blurred RGBA keeps a uniform image unchanged and stays premultiplied', () => {
  const w = 60, h = 40, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = 200; d[i * 4 + 1] = 100; d[i * 4 + 2] = 50; d[i * 4 + 3] = 255; }
  for (const r of [2.5, 9]) {
    const o = diskBlurRGBA(d, w, h, r);
    for (const i of [0, 777, w * h - 1]) assert.deepEqual([...o.slice(i * 4, i * 4 + 4)], [200, 100, 50, 255]);
  }
});
