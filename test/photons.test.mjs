// Photon by photon: Poisson arrivals give variance = mean, so the signal-to-noise ratio is √N.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photonScene, arrive, patchStats, photonRng, PW, PH } from '../js/lib/photons.js';

test('photon arrivals are Poisson: the flat patch has variance ≈ mean, SNR ≈ √N', () => {
  const b = photonScene(), acc = new Float64Array(PW * PH), rng = photonRng(11);
  for (let i = 0; i < 400; i++) arrive(acc, b, 0.25, rng);
  const s = patchStats(acc);
  assert.ok(Math.abs(s.mean - 100) < 3, `mean ${s.mean} (expected 100)`);
  assert.ok(Math.abs(s.sd ** 2 / s.mean - 1) < 0.2, `variance/mean ${s.sd ** 2 / s.mean}`);
  assert.ok(Math.abs(s.snr / Math.sqrt(s.mean) - 1) < 0.1, `SNR ${s.snr} vs √N ${Math.sqrt(s.mean)}`);
});

test('the scene: dark background, bright patch, a star and a wedge of falling steps', () => {
  const b = photonScene();
  assert.equal(b[5 * PW + 80], 1);
  assert.ok(b[2 * PW + 60] < 0.1, 'background is dark');
  assert.ok(b[55 * PW + 6] > b[55 * PW + 90], 'the wedge falls to the right');
});

test('sub by sub: the stack of N subs reaches the √N signal-to-noise ratio, read noise included', async () => {
  const { subExposure, centreSNR } = await import('../js/lib/photons.js');
  const { stackSNR } = await import('../js/lib/stacking.js');
  const n = 40, rate = new Float64Array(n * n).fill(2), bg = 5, sigma = 6, t = 10, rng = photonRng(9);
  const acc = new Float64Array(n * n), cur = new Float32Array(n * n), expected = rate.map((v) => v * t);
  const N = 64;
  for (let i = 0; i < N; i++) { subExposure(rate, bg, sigma, t, rng, cur); for (let k = 0; k < acc.length; k++) acc[k] += cur[k]; }
  const measured = centreSNR(acc.map((v) => v / N), expected, n, 12), predicted = stackSNR(2, bg, 0, sigma, t, N);
  assert.ok(Math.abs(measured / predicted - 1) < 0.12, `measured ${measured} vs predicted ${predicted}`);
});

test('film grain by grain: the developable share matches the model at every exposure', async () => {
  const { stock, grainField, expose, predictedFraction } = await import('../js/lib/film.js');
  const { makeRng } = await import('../js/lib/random.js');
  const f = stock(400), field = grainField(f, 60, 40, 3), pois = makeRng(5).poisson;
  let H = 0.5, out = expose(field, H, f, pois);
  for (const target of [8, 32, 128]) {
    while (H < target) { const dH = Math.min(H * 0.07, target - H); out = expose(field, dH, f, pois); H += dH; }
    const counted = out.developed / field.N, predicted = predictedFraction(H, f);
    assert.ok(Math.abs(counted - predicted) < 0.03, `H = ${H}: ${counted} vs ${predicted}`);
  }
});

test('photoelectrons up the ramp: Poisson counts, exponential gaps, reads that count every step', async () => {
  const { arrivals, countBefore, readsFromArrivals } = await import('../js/lib/photons.js');
  const { slopeLS } = await import('../js/lib/detectors.js');
  const rng = photonRng(21), f = 0.5, T = 40, counts = [];
  for (let k = 0; k < 4000; k++) counts.push(arrivals(f, T, rng).length);
  // gaps on one long record (inside a short window they are biased short)
  const long = arrivals(f, 1e5, rng), gap = (long[long.length - 1] - long[0]) / (long.length - 1);
  const m = counts.reduce((s, v) => s + v, 0) / counts.length, v = counts.reduce((s, x) => s + (x - m) ** 2, 0) / (counts.length - 1);
  assert.ok(Math.abs(m / (f * T) - 1) < 0.02, `mean count ${m} (expected ${f * T})`);
  assert.ok(Math.abs(v / m - 1) < 0.08, `variance/mean ${v / m}`);
  assert.ok(Math.abs(gap * f - 1) < 0.02, `mean gap ${gap} s (expected ${1 / f})`);
  // without read noise every read is a whole number of electrons and never falls
  const a = arrivals(0.3, 100, rng), S = readsFromArrivals(a, 20, 5, 0, rng);
  for (let i = 0; i < 20; i++) assert.equal(S[i], countBefore(a, (i + 1) * 5));
  assert.ok(S.every((x, i) => i === 0 || x >= S[i - 1]));
  assert.equal(countBefore(a, 1e9), a.length);
  assert.equal(countBefore(a, 0), 0);
  // a straight-line fit to the reads recovers the flux on average
  let s = 0;
  for (let k = 0; k < 400; k++) s += slopeLS(readsFromArrivals(arrivals(2, 200, rng), 20, 10, 3, rng), 10);
  assert.ok(Math.abs(s / 400 / 2 - 1) < 0.03, `mean fitted slope ${s / 400} (expected 2)`);
});
