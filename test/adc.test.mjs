// Atmospheric dispersion: Edlén refractivity, refraction, dispersion and its correction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airRefractivity, airRefractivityPT, refraction, dispersion, adcPrism, adcAngle, residual } from '../js/lib/adc.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const D = Math.PI / 180;

test("Edlén's refractive index of standard air and its pressure scaling", () => {
  near(airRefractivity(633) * 1e8, 27653, 3, '(n − 1)·10⁸ at 633 nm (HeNe)');
  near(airRefractivityPT(550, 101325, 15) / airRefractivity(550), 1, 1e-4, 'standard conditions reproduce the standard formula');
  near(airRefractivityPT(550, 50662.5, 15) / airRefractivity(550), 0.5, 0.005, 'refractivity ∝ pressure');
  assert.ok(airRefractivity(400) > airRefractivity(700), 'normal dispersion of air');
});

test('refraction and dispersion of a star', () => {
  near(refraction(550, 45 * D), 57.3, 0.3, 'refraction at z = 45°, sea level (″)');
  near(refraction(550, 0), 0, 1e-12, 'none at the zenith');
  near(dispersion(400, 700, 60 * D) / dispersion(400, 700, 30 * D), Math.tan(60 * D) / Math.tan(30 * D), 1e-9, '∝ tan z');
});

test('the ADC cancels the dispersion down to a small secondary spectrum', () => {
  const pr = adcPrism('N-BK7', 'F2', 0.2, 550);
  near(pr.delta(550), 0, 1e-12, 'zero deviation at the central wavelength');
  const k = Math.abs(dispersion(400, 700, 70 * D, 61500, 2) / (2 * (pr.delta(400) - pr.delta(700))));
  const z = 50 * D, th = adcAngle(pr, k, 400, 700, z, 74300, 10);
  near(residual(400, 700, pr, k, th, z, 74300, 10), 0, 1e-9, 'end wavelengths brought together');
  let mx = 0; for (let l = 400; l <= 700; l += 5) mx = Math.max(mx, Math.abs(residual(l, 550, pr, k, th, z, 74300, 10)));
  assert.ok(mx < 0.1 * dispersion(400, 700, z, 74300, 10), `residual ${mx}″`);
});
