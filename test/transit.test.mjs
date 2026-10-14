// Exoplanet transits: occulted flux, limb darkening, orbit geometry, duration and noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fluxAt, totalFlux, intensity, orbit, precision, transitSNR, REARTH, RJUP, AU } from '../js/lib/transit.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('uniform star: the depth is the area ratio, and nothing is blocked outside the disc', () => {
  near(1 - fluxAt(0, 0.1, 0, 0), 0.01, 1e-6, 'k = 0.1');
  assert.equal(fluxAt(1.2, 0.1, 0, 0), 1);
  near(1 - fluxAt(1, 0.1, 0, 0), 0.005, 2e-4, 'half the planet on the limb');
});

test('limb darkening: total flux and a deeper centre', () => {
  // ∫ I 2πr dr numerically
  let F = 0; const n = 20000;
  for (let i = 0; i < n; i++) { const r = (i + 0.5) / n; F += intensity(r, 0.4, 0.26) * 2 * Math.PI * r / n; }
  near(F, totalFlux(0.4, 0.26), 1e-5, 'π(1 − u₁/3 − u₂/6)');
  near(1 - fluxAt(0, 0.05, 0.4, 0.26), 0.0025 / (1 - 0.4 / 3 - 0.26 / 6), 2e-6, 'small planet at the centre');
});

test('Kepler and the transit duration: the Earth and HD 209458 b', () => {
  const e = orbit({ P: 365.25, Mstar: 1, Rstar: 1, Rp: REARTH, b: 0 });
  near(e.a / AU, 1, 0.002, 'one astronomical unit');
  near(e.T14 / 3600, 13.1, 0.1, 'Earth: 13 h');
  near(e.depth * 1e6, 84, 0.5, '84 ppm');
  const h = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 1.359 * RJUP, b: 0.51 });
  near(h.T14 / 3600, 3.07, 0.1, 'HD 209458 b: about 3.1 h');
  assert.ok(Number.isNaN(orbit({ P: 3, Mstar: 1, Rstar: 1, Rp: REARTH, b: 1.2 }).T14), 'no transit beyond the limb');
});

test('photon noise falls as 1/√(photons) above the floor', () => {
  const a = precision({ V: 12, D: 0.1, t: 100, floor: 0 }), b = precision({ V: 12, D: 0.2, t: 100, floor: 0 });
  near(a / b, 2, 1e-9, 'twice the aperture, half the noise');
  near(precision({ V: 2, D: 6.5, t: 100, floor: 20 }), 20, 0.5, 'floor dominates bright stars');
  near(transitSNR(100, 50, 16), 8, 1e-12, 'SNR');
});
