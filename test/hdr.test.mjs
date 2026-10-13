// HDR: dynamic range, optimal merging, filters, tone mapping and exposure fusion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dynamicRange, snr, expose, mergeHDR, gauss, scene, odToStops, ndTransmission, gradTransmission, reinhard, exposureFusion } from '../js/lib/hdr.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const cam = { k: 1000, fwc: 50000, read: 3, bits: 14 };

test('dynamic range: SNR = 1 to full well, extended by (n − 1)Δ by bracketing', () => {
  const s1 = (1 + Math.sqrt(1 + 4 * 9)) / 2;
  near(dynamicRange([1 / 250], cam), Math.log2(50000 / s1), 0.02, 'single frame');
  near(dynamicRange([1, 4, 16, 64, 256].map((t) => t / 1000), cam) - dynamicRange([1 / 1000], cam), 8, 0.1, '5 frames, 2 EV apart');
  const x = 30, ts = [0.001, 0.004, 0.016];
  near(snr(x, ts, cam), Math.hypot(...ts.map((t) => snr(x, [t], cam))), 1e-9, 'inverse-variance SNR adds in quadrature');
});

test('merged radiance is unbiased over 15 stops', () => {
  const W = 96, H = 54, L = scene(W, H), times = [1 / 4000, 1 / 1000, 1 / 250, 1 / 60, 1 / 15, 1 / 4], R = gauss(3);
  const m = mergeHDR(times.map((t) => expose(L, t, cam, R)), times, cam);
  let s = 0, n = 0;
  for (let p = 0; p < L.length; p++) if (L[p] > 0.5 && L[p] < 2e4) { s += m.L[p] / L[p] - 1; n++; }
  near(s / n, 0, 0.01, 'mean relative bias');
});

test('neutral-density and graduated filters', () => {
  near(odToStops(1), 3.3219, 1e-4, 'OD 1 = 3.32 stops');
  near(ndTransmission(10), 2 ** -10, 1e-15, '10-stop ND');
  near(gradTransmission(0, 3, 0.5, 0.2), 1 / 8, 1e-12, 'full strength above the transition');
  near(gradTransmission(1, 3, 0.5, 0.2), 1, 1e-12, 'clear below');
  near(gradTransmission(0.5, 3, 0.5, 0.2), 2 ** -1.5, 1e-12, 'half strength at the centre of a soft edge');
});

test('tone mapping stays in range; fusing identical frames returns the frame', () => {
  const W = 40, H = 24, L = scene(W, H), t = reinhard(L, W, H);
  assert.ok(t.every((v) => v >= 0 && v <= 1), 'Reinhard output in [0, 1]');
  const img = new Float32Array(W * H * 3).map((_, k) => 0.2 + 0.6 * Math.abs(Math.sin(k * 0.37)));
  const f = exposureFusion([img, img], W, H, 4);
  let e = 0; for (let k = 0; k < img.length; k++) e = Math.max(e, Math.abs(f[k] - img[k]));
  near(e, 0, 1e-5, 'Laplacian pyramid blend is exact for identical frames');
});
