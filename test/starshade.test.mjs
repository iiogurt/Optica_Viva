// Starshades: exact Fresnel results for round screens and the deep shadow of a hypergaussian.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besselJ0, shadowField, intensity, fresnelNumber, holeAxial } from '../js/lib/starshade.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('Bessel J₀ matches tabulated values', () => {
  near(besselJ0(0), 1, 1e-12, 'J₀(0)');
  near(besselJ0(1), 0.7651976866, 1e-7, 'J₀(1)');
  near(besselJ0(10), -0.2459357645, 1e-7, 'J₀(10)');
  near(besselJ0(2.404825558), 0, 1e-7, 'first zero');
});

test('the Poisson–Arago spot: the axial intensity behind an opaque disk is exactly 1', () => {
  for (const z of [10, 300, 5000]) near(intensity(shadowField('disk', { R: 1 }, 550e-9, z, [0]))[0], 1, 1e-8, `z = ${z} m`);
});

test("the spot has the J₀² profile of Lommel's solution", () => {
  const lam = 550e-9, z = 1000;
  for (const rho of [1e-4, 2e-4, 4e-4]) near(intensity(shadowField('disk', { R: 1 }, lam, z, [rho], 8000))[0], besselJ0((2 * Math.PI * rho) / (lam * z)) ** 2, 2e-3, `ρ = ${rho} m`);
});

test("Babinet: a circular hole's axis follows 4 sin²(πF/2)", () => {
  const lam = 550e-9;
  for (const z of [400, 500, 650]) {
    const [[re, im]] = shadowField('disk', { R: 1 }, lam, z, [0]);
    near((1 - re) ** 2 + im ** 2, holeAxial(fresnelNumber(1, lam, z)), 1e-6, `z = ${z} m`);
  }
});

test('a hypergaussian starshade suppresses visible starlight to about 10⁻¹⁰', () => {
  const o = { a: 12.5, b: 12.5, n: 6 }, z = 8e7;
  for (const lam of [400e-9, 550e-9, 700e-9]) {
    const I = intensity(shadowField('hyper', o, lam, z, [0, 1, 2]));
    assert.ok(Math.max(...I) < 1e-9, `λ = ${lam * 1e9} nm: ${I.map((v) => v.toExponential(1))}`);
  }
  // fewer Fresnel zones in the near-infrared: the shadow fills in
  assert.ok(intensity(shadowField('hyper', o, 1000e-9, z, [0]))[0] > 1e-8);
});

test('the shadow integral has converged', () => {
  const o = { a: 12.5, b: 12.5, n: 6 }, f = (s) => intensity(shadowField('hyper', o, 550e-9, 4e7, [1, 2], s));
  const [a, b] = [f(2000), f(8000)];
  a.forEach((v, i) => near(v, b[i], 1e-15, `ρ = ${i + 1} m`));
});
