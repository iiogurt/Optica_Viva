// Virtual production: LED-wall frequency, aliasing, defocus MTF and PWM banding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallFrequency, aliasFrequency, diskMTF, moire, bandAmplitude, bandProfile, gridModulation } from '../js/lib/virtual.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('LED grid frequency on the sensor and its alias', () => {
  const nu = wallFrequency(50, 1e12, 10000, 2.5); // focused at infinity: m = f/Z
  near(nu, 10000 / (50 * 2.5), 1e-6, 'ν = Z/(f p)');
  near(aliasFrequency(150, 0.006), Math.abs(150 - 1 / 0.006), 1e-9, 'alias about the sampling frequency');
  near(aliasFrequency(30, 0.006), 30, 1e-12, 'below Nyquist: no fold');
  near(gridModulation(0.5), 4 / Math.PI, 1e-12, 'square-wave fundamental 4/π');
});

test('defocus disk MTF: first zero at πbν = 3.8317', () => {
  near(diskMTF(0.1, 3.8317 / (Math.PI * 0.1)), 0, 1e-4, 'first zero');
  assert.ok(diskMTF(0.1, 5 / (Math.PI * 0.1)) < 0, 'contrast reversal beyond it');
  // focusing on the wall maximises the grid contrast
  const o = { p: 2.6, fill: 0.3, Z: 6000, f: 50, N: 2.8, q: 0.006 };
  assert.ok(moire({ ...o, s: 6000 }).contrast > 10 * moire({ ...o, s: 3000 }).contrast, 'wall in focus vs actor in focus');
});

test('rolling-shutter PWM banding vanishes for whole periods', () => {
  near(bandAmplitude(3 / 3840, 3840, 0.3), 0, 1e-12, 'three whole periods');
  assert.ok(bandAmplitude(3.5 / 3840, 3840, 0.3) > 0.1, 'half a period extra leaves bands');
  const prof = bandProfile({ fp: 3840, duty: 0.3, texp: 3.5 / 3840, tline: 15e-3 / 270, phase: 0 }, 270);
  const amp = (Math.max(...prof) - Math.min(...prof)) / (prof.reduce((a, b) => a + b, 0) / prof.length);
  near(amp, bandAmplitude(3.5 / 3840, 3840, 0.3), 0.03, 'simulated rows match the formula');
});
