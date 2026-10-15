// Autofocus: defocus geometry, half-pupil disparity, and both methods finding focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defocus, disparityOf, scene, halfImage, correlate, runAF } from '../js/lib/autofocus.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('blur and disparity: 217 µm and 92 µm for 50 mm f/2 focused at 2 m, subject at 3 m', () => {
  const d = defocus(50, 2, 3000, 2000);
  near(d.blur * 1000, 217.3, 0.2, 'blur');
  near(disparityOf(d.dv, 2) * 1000, -92.2, 0.2, 'disparity');
});

test('the correlated half-images reproduce the predicted shift', () => {
  const src = scene(8192, 3), b = 217, sign = -1;
  const s = correlate(halfImage(src, b, -1, sign, 4, 1e9, null), halfImage(src, b, 1, sign, 4, 1e9, null), 40);
  near(s, (0.4244 * -b) / 4, 1.0, 'pixels');
});

test('phase detection and contrast detection both reach focus; phase detection in fewer frames', () => {
  const r = runAF({ f: 50, N: 2, u: 3000, focus: 2000, trials: 4 });
  near(r.pdU, 3000, 30, 'phase detection');
  near(r.cdU, 3000, 30, 'contrast detection');
  assert.ok(r.pdFrames < r.frames, 'fewer frames');
});
