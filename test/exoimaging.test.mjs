// Mission "Plan an exoplanet observation": contrast, separation, photon-limited integration time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflectedContrast, separationMas, lambdaOverD, integrationTime, plan, RE_KM } from '../js/lib/exoimaging.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('an Earth twin reflects about 2 × 10⁻¹⁰ of its star at quadrature', () => {
  near(reflectedContrast(0.37, RE_KM, 1) * 1e10, 2.14, 0.01, 'contrast');
});

test('1 AU at 10 pc is 100 mas: 5 λ/D for 6 m, 2 λ/D for 2.4 m', () => {
  near(separationMas(1, 10), 100, 1e-12, 'separation');
  near(100 / lambdaOverD(0.55, 6), 5.29, 0.02, '6 m');
  assert.equal(plan({ D: 2.4 }).outside, false);
  assert.equal(plan({ D: 6 }).outside, true);
});

test('integration time: SNR² scaling and the cost of background', () => {
  const t1 = integrationTime(1e-10, 0, 1e9, 5), t2 = integrationTime(1e-10, 0, 1e9, 10);
  near(t2 / t1, 4, 1e-9, 'SNR²');
  assert.ok(integrationTime(1e-10, 1e-9, 1e9, 5) > 5 * t1, 'a floor above the planet costs time');
  assert.ok(plan({ d: 5 }).t < plan({ d: 10 }).t / 4, 'closer stars are much faster');
});
