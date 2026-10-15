// Mission "Design an Earth-observation satellite": focal length, mirror, TDI and data rate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designFor } from '../js/lib/satellite.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('50 cm pixels from 600 km with 7 µm pixels at Q = 1', () => {
  const r = designFor({ gsd: 0.5, H: 600e3, p: 7e-6 });
  near(r.f, 8.4, 1e-9, 'focal length');
  near(r.D, 0.66, 1e-9, 'mirror λH/GSD');
  assert.ok(r.snr >= 100, 'SNR target reached');
});

test('halving the GSD doubles the mirror; a wider swath raises the data rate in proportion', () => {
  const a = designFor({ gsd: 1, H: 500e3, p: 5.5e-6 }), b = designFor({ gsd: 0.5, H: 500e3, p: 5.5e-6 });
  near(b.D / a.D, 2, 1e-9, 'mirror');
  near(designFor({ gsd: 1, H: 500e3, p: 5.5e-6, swathKm: 30 }).dataRate / a.dataRate, 2, 1e-9, 'data rate');
});
