// Stacking: CCD equation vs Monte Carlo, the sky-limited sub length, √T and light pollution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BORTLE, surfaceRate, stackSNR, skyLimitedSub, rng, stackImage } from '../js/lib/stacking.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('stack SNR from the CCD equation matches a Monte-Carlo stack', () => {
  const Fo = 0.09, Fs = 1.07, Fd = 0.01, sr = 3, t = 60, N = 20, g = rng(5), vals = [];
  for (let k = 0; k < 6000; k++) { let s = 0; for (let i = 0; i < N; i++) s += Fo * t + Math.sqrt((Fo + Fs + Fd) * t + sr * sr) * g(); vals.push(s); }
  const m = vals.reduce((a, b) => a + b, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
  near((m / sd) / stackSNR(Fo, Fs, Fd, sr, t, N), 1, 0.03, 'SNR');
  // the stacked image has the predicted per-pixel noise
  const rate = new Float64Array(20000).fill(Fo), img = stackImage(rate, Fs, Fd, sr, t, N, 9), mu = img.reduce((a, b) => a + b, 0) / img.length;
  near(Math.sqrt(img.reduce((a, b) => a + (b - mu) ** 2, 0) / (img.length - 1)), Math.sqrt(((Fo + Fs + Fd) * t + sr * sr) / N), 0.3, 'image noise');
});

test('sky-limited sub-exposure, √T growth and the cost of light pollution', () => {
  const Fs = 1.07, sr = 3, t = skyLimitedSub(Fs, sr);
  near(sr * sr / (Fs * t), 0.1, 1e-12, 'σ_r² = 0.1 F_s t');
  const Fo = 0.05, s1 = stackSNR(Fo, Fs, 0, sr, 300, 10), s4 = stackSNR(Fo, Fs, 0, sr, 300, 40);
  near(s4 / s1, 2, 1e-9, '4× the time → 2× the SNR');
  // faint object: SNR ∝ 1/√F_sky, i.e. 10^(0.2 Δμ)
  const a = surfaceRate(BORTLE[4], 20, 1.5, 0.5), b = surfaceRate(BORTLE[8], 20, 1.5, 0.5);
  near(stackSNR(1e-4, a, 0, 0, 600, 30) / stackSNR(1e-4, b, 0, 0, 600, 30), Math.pow(10, 0.2 * (BORTLE[4] - BORTLE[8])), 0.01, 'Bortle 4 vs 8');
});
