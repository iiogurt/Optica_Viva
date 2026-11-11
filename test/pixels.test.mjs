import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catmull, bilinear, toe, encode, ign, renderInto, edge, keyOf } from '../js/lib/pixels.js';
import { oetf } from '../js/lib/color.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('samplers: exact at pixel centres, linear ramps reproduced, edges clamped', () => {
  const w = 7, h = 5, a = Float32Array.from({ length: w * h }, (_, k) => 2 * (k % w) + 3 * Math.floor(k / w));
  for (const f of [catmull, bilinear]) {
    near(f(a, w, h, 3, 2), a[2 * w + 3], 1e-6, `${f.name} at a centre`);
    near(f(a, w, h, 2.25, 1.5), 2 * 2.25 + 3 * 1.5, 1e-5, `${f.name} on a ramp`);
    near(f(a, w, h, -4, -4), a[0], 1e-6, `${f.name} clamped`);
  }
  // between samples of a curve Catmull–Rom is closer than bilinear
  const q = Float32Array.from({ length: 16 }, (_, k) => (k - 7.3) ** 2);
  const at = 6.5, exact = (at - 7.3) ** 2;
  assert.ok(Math.abs(catmull(q, 16, 1, at, 0) - exact) < Math.abs(bilinear(q, 16, 1, at, 0) - exact));
});

test('tone toe: continuous with matching slope, black below −k, identity above k', () => {
  const k = 0.06;
  assert.equal(toe(-0.2), 0); assert.equal(toe(0.5), 0.5);
  near(toe(k), k, 1e-12, 'value at k'); near(toe(-k), 0, 1e-12, 'value at −k');
  near((toe(k) - toe(k - 1e-6)) / 1e-6, 1, 1e-4, 'slope 1 at k');
  near((toe(-k + 1e-6) - toe(-k)) / 1e-6, 0, 1e-4, 'slope 0 at −k');
});

test('sRGB table within half an 8-bit step, dither noise in [0, 1) with mean ½', () => {
  for (let v = 0; v <= 1; v += 0.0007) near(encode(v), oetf(v), 0.5 / 255, `encode(${v})`);
  let s = 0, n = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const r = ign(x, y); assert.ok(r >= 0 && r < 1); s += r; n++; }
  near(s / n, 0.5, 0.02, 'mean');
});

test('dithering keeps the mean level of a flat grey that falls between two 8-bit codes', () => {
  const w = 64, h = 64, d = new Uint8ClampedArray(w * h * 4), level = 100.3 / 255;
  renderInto(d, w, h, (u, v, o) => { o[0] = o[1] = o[2] = level; });
  let s = 0, codes = new Set();
  for (let k = 0; k < w * h; k++) { s += d[k * 4]; codes.add(d[k * 4]); assert.equal(d[k * 4 + 3], 255); }
  near(s / (w * h), 100.3, 0.05, 'mean code');
  assert.deepEqual([...codes].sort(), [100, 101], 'only the two neighbouring codes');
});

test('black hole: 2×2 rays per pixel equal the average of the image traced at twice the size', async () => {
  const { diskImage, orbitTable } = await import('../js/lib/blackhole.js');
  const table = orbitTable(), N = 24, base = { fov: 22, incl: 0.5, table };
  const ss = diskImage({ ...base, N, ss: 2 }), fine = diskImage({ ...base, N: 2 * N });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const m = (fine[2 * j * 2 * N + 2 * i] + fine[2 * j * 2 * N + 2 * i + 1] + fine[(2 * j + 1) * 2 * N + 2 * i] + fine[(2 * j + 1) * 2 * N + 2 * i + 1]) / 4;
    near(ss[j * N + i], m, 1e-6 * (1 + m), `pixel ${i},${j}`);
  }
});

test('mask edge: sharp outside, partial coverage inside kept; keys stable per object', () => {
  assert.equal(edge(0.5, 4), 0.5); assert.equal(edge(0.8, 4), 0.8, 'a segment gap keeps its value');
  assert.equal(edge(0.3, 4), 0, 'outside the edge: black within a device pixel');
  near(edge(0.45, 4), 0.3, 1e-12, 'the ramp spans ¼ of a field pixel at 4 device pixels per field pixel');
  assert.equal(edge(0.3, 1), 0.3, 'no sharpening when the picture is not enlarged');
  assert.equal(edge(1.2, 4), 1); assert.equal(edge(-0.1, 1), 0);
  const a = {}, b = {};
  assert.equal(keyOf(a), keyOf(a)); assert.notEqual(keyOf(a), keyOf(b)); assert.equal(keyOf(null), 0);
});
