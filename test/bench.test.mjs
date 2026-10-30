// Spectral optics bench: exact single rays against analytic optics, and the photon tracer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShape, traceThrough, prismDeviation, benchPhotons } from '../js/lib/bench.js';
import { benchScene } from '../js/lib/bench3d.js';
import { index } from '../js/lib/glass.js';

const D = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('prism: the traced deviation matches D = i + arcsin(n sin(A − r₁)) − A at every wavelength', () => {
  for (const lam of [450, 550, 650]) {
    const n = index('N-SF11', lam), r = traceThrough(makeShape('prism', { rot: -30 }), [-3, 0, 0], [1, 0, 0], n);
    near(Math.atan2(-r.d[1], r.d[0]) / D, prismDeviation(60 * D, n, 60 * D) / D, 1e-6, `${lam} nm`);
  }
  // at 30° incidence a dense flint reflects totally at the second face
  assert.ok(Number.isNaN(prismDeviation(60 * D, index('N-SF11', 550), 30 * D)));
});

test('ball lens: paraxial focus at f = nR / (2(n − 1)) from the centre', () => {
  const n = index('N-BK7', 587.56), R = 0.6, r = traceThrough(makeShape('ball', { r: R }), [-3, 0.01, 0], [1, 0, 0], n);
  near(r.o[0] - (r.o[1] * r.d[0]) / r.d[1], (n * R) / (2 * (n - 1)), 2e-3, 'focus');
});

test('photons reach the screen, blue and red apart, and the 3-D scene builds', () => {
  const P = benchPhotons({ kind: 'prism', p: { rot: -30 }, glass: 'N-SF11', rays: 40000, seed: 3, dist: 2 });
  let sum = 0, yRed = 0, wRed = 0, yBlue = 0, wBlue = 0;
  for (let k = 0; k < P.Y.length; k++) { sum += P.Y[k]; const row = Math.floor(k / 90); yRed += row * P.X[k]; wRed += P.X[k]; yBlue += row * P.Z[k]; wBlue += P.Z[k]; }
  assert.ok(sum > 1000, 'light on the screen');
  assert.notEqual(Math.round(yRed / wRed), Math.round(yBlue / wBlue), 'the colours are separated');
  const s = benchScene({ kind: 'lens', p: {}, glass: 'N-BK7', dist: 1.3 });
  assert.ok(s.meshes.length === 2 && s.lines.length > 5);
});
