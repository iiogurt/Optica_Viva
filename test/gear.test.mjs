// Test your own gear: slanted-edge MTF against theory, lateral colour, flat field, distortion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esfr, edgeFit, mtfAt, syntheticEdge, theoreticalMTF } from '../js/lib/esfr.js';
import { vignetting, fitDistortion, distortPoint } from '../js/lib/gear.js';
import { makeRng } from '../js/lib/random.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const mtf50Theory = (s) => { let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (theoreticalMTF(m, s) > 0.5) lo = m; else hi = m; } return lo; };

test('e-SFR recovers the MTF50 of known Gaussian blurs within 1 %', () => {
  for (const s of [0.5, 0.8, 1.2]) {
    const W = 60, H = 100, r = esfr(syntheticEdge(W, H, { sigma: s }), W, H);
    near(mtfAt(r.freqs, r.mtf) / mtf50Theory(s), 1, 0.01, `σ = ${s}`);
  }
});

test('e-SFR tolerates noise and measures the edge angle and offset', () => {
  const W = 80, H = 160, rng = makeRng(1).g;
  const r = esfr(syntheticEdge(W, H, { sigma: 1, noise: 0.01, rng }), W, H);
  near(mtfAt(r.freqs, r.mtf), mtf50Theory(1), 0.01, 'noisy edge');
  near(Math.atan(r.fit.b) * 180 / Math.PI, 5, 0.05, 'angle');
  near(edgeFit(syntheticEdge(W, H, { sigma: 1, shift: 0.6 }), W, H).a - edgeFit(syntheticEdge(W, H, { sigma: 1 }), W, H).a, 0.6, 0.01, 'lateral shift');
});

test('flat field: cos⁴ falloff to 42° gives 1.7 stops at the corners', () => {
  const W = 300, H = 200, Y = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) / Math.hypot(W / 2, H / 2); Y[y * W + x] = Math.cos(Math.atan(r * Math.tan((42 * Math.PI) / 180))) ** 4; }
  const v = vignetting(Y, W, H);
  v.cornerStops.forEach((s) => near(s, -1.6, 0.15, 'corner cell (its centre lies just inside the corner)'));
});

test('distortion: k recovered from points on a straight line; barrel is negative', () => {
  const W = 600, H = 400, pts = [];
  for (let x = 40; x <= 560; x += 65) pts.push(distortPoint(x, 40, -0.06, W, H));
  const d = fitDistortion(pts, W, H);
  near(d.k, -0.06, 1e-4, 'k');
  near(d.corner, -6, 0.01, 'per cent at the corner');
  assert.ok(d.after < d.before / 100, 'straightened');
});
