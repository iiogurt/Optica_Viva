// Earth observation: orbit speeds, GSD, Q, diffraction MTF and TDI signal scaling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orbitSpeed, gsd, qFactor, mtfDiff, mtfNyquist, signal, design } from '../js/lib/earthobs.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('low Earth orbit: 7.6 km/s, a 94-minute period, ground track about 7.06 km/s', () => {
  const o = orbitSpeed(500e3);
  near(o.v, 7616, 5, 'orbital speed');
  near(o.period / 60, 94.5, 0.2, 'period');
  near(o.ground, 7062, 5, 'ground speed');
});

test('GSD, Q and the diffraction limit of a very-high-resolution design', () => {
  near(gsd(617e3, 13.3, 8e-6), 0.371, 0.001, 'GSD');
  near(qFactor(550e-9, 13.3, 1.1, 8e-6), 0.831, 0.002, 'Q');
  near(design({ H: 617e3, D: 1.1, f: 13.3, p: 8e-6 }).diffGround, 0.377, 0.002, '1.22 λH/D');
});

test('diffraction MTF: 1 at zero, about 0.39 at half the cut-off, 0 at the cut-off', () => {
  near(mtfDiff(0), 1, 1e-12, 'DC');
  near(mtfDiff(0.5), 0.391, 0.001, 'half');
  assert.equal(mtfDiff(1), 0);
  near(mtfNyquist(550e-9, 1, 0.1, 5e-6).pixel, 2 / Math.PI, 1e-12, 'pixel sinc at Nyquist');
});

test('TDI multiplies the signal; SNR grows close to √N when shot noise dominates', () => {
  const base = { D: 1, gsdM: 0.5, H: 6e5, t: 7e-5 };
  const a = signal({ ...base, N: 1 }), b = signal({ ...base, N: 16 });
  near(b.e / a.e, 16, 1e-9, 'signal');
  assert.ok(b.snr / a.snr > 3.5 && b.snr / a.snr <= 4, 'SNR ratio');
});
