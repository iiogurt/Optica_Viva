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
