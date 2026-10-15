// Computational photography: burst SNR, super-resolution detail and depth-map errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burst, portrait } from '../js/lib/computational.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('burst SNR grows as √N and trails one long exposure by the read noise of each frame', () => {
  const a = burst({ N: 1, photons: 20, sigma: 2 }).predicted, b = burst({ N: 16, photons: 20, sigma: 2 }).predicted;
  near(b.burst / a.single, 4, 1e-9, '√16');
  near(burst({ N: 8, photons: 20, sigma: 2 }).predicted.burst / burst({ N: 8, photons: 20, sigma: 2 }).predicted.long, 0.866, 0.002, '87 %');
});

test('measured noise falls in the merged burst', () => {
  const r = burst({ N: 16, photons: 20, sigma: 2 });
  assert.ok(r.snrAvg > 2.5 * r.snrSingle, 'average of 16 is much cleaner');
});

test('the super-resolution merge keeps more fine detail than the plain average', () => {
  const r = burst({ N: 16, photons: 400, sigma: 1 });
  // contrast of the finest bars (right edge of the target): standard deviation along a row
  const rowStd = (img, w, y, x0, x1) => { const v = []; for (let x = x0; x < x1; x++) v.push(img[y * w + x]); const m = v.reduce((a, q) => a + q, 0) / v.length; return Math.sqrt(v.reduce((a, q) => a + (q - m) ** 2, 0) / v.length); };
  const yA = Math.floor(r.m * 0.15), yS = yA * 2;
  const avg = rowStd(r.avg, r.m, yA, Math.floor(r.m * 0.7), r.m - 2), sr = rowStd(r.sr, r.M, yS, Math.floor(r.M * 0.7), r.M - 4);
  assert.ok(sr > avg, `super-resolution ${sr} vs average ${avg}`);
});

test('a coarser depth map gets more of the portrait wrong', () => {
  assert.ok(portrait({ coarse: 16 }).wrongPct > portrait({ coarse: 2 }).wrongPct);
  near(portrait({ coarse: 1 }).wrongPct, 0, 1e-9, 'full-resolution map');
});
