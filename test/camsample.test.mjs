// A camera feed on a coarse sensor: pixel aperture, the 4-spot low-pass filter, Bayer mosaic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleSensor, bayerDemosaic } from '../js/lib/camsample.js';

const W = 48, H = 48;
const image = (f) => { const a = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f(x, y), o = (y * W + x) * 4; a[o] = a[o + 1] = a[o + 2] = v; a[o + 3] = 255; } return a; };

test('pixel aperture: a k×k block average; a uniform scene stays uniform with or without OLPF', () => {
  const flat = image(() => 100);
  for (const olpf of [false, true]) { const { S, w, h } = sampleSensor(flat, W, H, 4, olpf); assert.equal(w, 12); assert.equal(h, 12); assert.ok(S.every((v) => Math.abs(v - 100) < 1e-6)); }
});

test('a pattern finer than the pixels aliases into a coarse false pattern; the OLPF weakens it', () => {
  // period 5 px, sampled by 4-px pixels: beat at 1/(1/4 − 1/5) = 20 px, i.e. 5 sensor pixels
  const stripes = image((x) => (Math.sin((2 * Math.PI * x) / 5) > 0 ? 255 : 0));
  const row = (S, w) => Array.from({ length: w }, (_, i) => S[i * 3]);
  const a = row(sampleSensor(stripes, W, H, 4).S, 12), b = row(sampleSensor(stripes, W, H, 4, true).S, 12);
  const sd = (r) => { const m = r.reduce((p, q) => p + q, 0) / r.length; return Math.sqrt(r.reduce((p, q) => p + (q - m) ** 2, 0) / r.length); };
  assert.ok(sd(a) > 25, `aliased beat visible (σ = ${sd(a)})`);
  assert.ok(sd(b) < 0.85 * sd(a), `the low-pass filter lowers its contrast (${sd(b)} vs ${sd(a)})`);
});

test('Bayer + bilinear demosaic: a grey scene stays grey, a fine grey pattern gets false colour', () => {
  const grey = bayerDemosaic(new Float32Array(10 * 10 * 3).fill(80), 10, 10);
  assert.ok(grey.every((v) => Math.abs(v - 80) < 1e-6));
  // one-pixel vertical stripes: red sits only on even columns, blue only on odd ones
  const S = new Float32Array(10 * 10 * 3);
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) S.fill(i % 2 ? 0 : 200, (j * 10 + i) * 3, (j * 10 + i) * 3 + 3);
  const out = bayerDemosaic(S, 10, 10), o = (4 * 10 + 4) * 3;
  assert.ok(Math.abs(out[o] - out[o + 2]) > 50, 'red and blue differ: false colour');
});
