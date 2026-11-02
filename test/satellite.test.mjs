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

test('TDI stages: the smallest standard count that reaches the SNR, or an explicit unmet requirement (#212)', async () => {
  // feasible: the target is reached, and asking for a little more needs more stages
  const ok = designFor({ gsd: 0.5, H: 500000, p: 5e-6, Q: 1, snrTarget: 100 });
  assert.ok(ok.targetMet && ok.snr >= 100 && ok.N < 256, `N ${ok.N}`);
  const more = designFor({ gsd: 0.5, H: 500000, p: 5e-6, Q: 1, snrTarget: ok.snr * 1.0001 });
  assert.ok(more.N > ok.N || !more.targetMet, 'the smallest count');
  // exactly at the threshold: the same count, met
  const exact = designFor({ gsd: 0.5, H: 500000, p: 5e-6, Q: 1, snrTarget: ok.snr });
  assert.equal(exact.N, ok.N); assert.ok(exact.targetMet);
  // the report's case: 256 stages give SNR 90, the requirement of 200 is not met and says so
  const no = designFor({ gsd: 0.25, H: 500000, p: 5e-6, Q: 2, snrTarget: 200 });
  assert.equal(no.targetMet, false); assert.equal(no.N, 256); assert.equal(no.maxStages, 256);
  assert.ok(Math.abs(no.snr - 90.2) < 0.1, `SNR ${no.snr}`);
});
