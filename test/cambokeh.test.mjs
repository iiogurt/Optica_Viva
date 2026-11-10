// Bokeh on the camera feed (js/lib/cambokeh.js): FFT convolution with the pupil kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelSpectrum, bokehFrame, highlight, linear, RMAX, BN } from '../js/lib/cambokeh.js';

const W = 192, H = 144;
const P = { blades: 0, round: 0, rot: 0, stop: 0, obs: 0, vig: 0, sa: 0, ripple: 0, apod: false };
const frame = (fill) => { const f = new Uint8ClampedArray(W * H * 4); for (let k = 0; k < W * H; k++) { f.fill(fill, k * 4, k * 4 + 3); f[k * 4 + 3] = 255; } return f; };

test('a flat grey frame stays flat: the kernel sums to one and the edges are extended', () => {
  const out = bokehFrame(frame(118), W, H, kernelSpectrum(P, 1, RMAX));
  for (let k = 0; k < W * H; k += 37) assert.ok(Math.abs(out[k * 4] - 118) <= 1, `pixel ${k}: ${out[k * 4]}`);
});

test('one point spreads into a disk of the set radius, holding the same light', () => {
  const R = 12, f = frame(0); f.fill(255, (72 * W + 96) * 4, (72 * W + 96) * 4 + 3);
  const out = bokehFrame(f, W, H, kernelSpectrum(P, 1, R), 1);
  // the point carried 1.0 in linear light; spread over the disk, about 1/(πR²) per pixel
  let s = 0; for (let k = 0; k < W * H; k++) s += linear(out[k * 4]);
  assert.ok(Math.abs(s - 1) < 0.08, `total ${s}`);
  const lvl = 0.3 / (Math.PI * R * R), row = Array.from({ length: W }, (_, x) => linear(out[(72 * W + x) * 4])), lit = row.filter((v) => v > lvl).length;
  assert.ok(Math.abs(lit - 2 * R) <= 3, `lit width ${lit} px vs ${2 * R}`);
  // a six-bladed iris makes a hexagon: narrower across the flats than across the corners
  const hex = bokehFrame(f, W, H, kernelSpectrum({ ...P, blades: 6, rot: 0 }, 1, R), 1);
  const across = (dx, dy) => { let n = 0; for (let i = -30; i <= 30; i++) if (linear(hex[((72 + i * dy) * W + 96 + i * dx) * 4]) > lvl) n++; return n; };
  assert.ok(across(1, 0) !== across(0, 1), `hexagon widths ${across(1, 0)} and ${across(0, 1)}`);
  assert.ok(BN - W >= 2 * 1.45 * RMAX, 'padding holds the largest disk');
});

test('highlights: untouched below 80 % of full scale, the full gain at clipping', () => {
  assert.equal(highlight(0.5, 0.79, 0.2, 10), 1);
  assert.equal(highlight(1, 0.3, 0.3, 10), 10);
  const mid = highlight(0.9, 0, 0, 10);
  assert.ok(mid > 1 && mid < 10);
});
