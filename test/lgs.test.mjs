// Laser guide stars: the cone effect from the structure function, checked against Noll and phase screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coneF, coneError, coneMC } from '../js/lib/lgs.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

test("a laser at the layer's own height leaves the layer's whole phase: Noll's 1.0299 and 0.134 (D/r₀)^{5/3}", () => {
  near(6.88 * coneF(0, { tilt: false, n: 300000 }), 1.0299, 0.01, 'piston removed');
  near(6.88 * coneF(0, { tilt: true, n: 300000 }), 0.134, 0.003, 'piston and tilt removed');
  // no error for a star at infinity, and growing as the footprint shrinks
  near(coneF(1), 0, 1e-12, 'α = 1');
  assert.ok(coneF(0.9) < coneF(0.7) && coneF(0.7) < coneF(0.3), 'monotone in α');
});

test('random phase screens give the same tilt-removed error as the structure-function integral', () => {
  const D = 4, r0 = 0.2, alpha = 0.7, sf = 6.88 * coneF(alpha, { n: 200000 }) * (D / r0) ** (5 / 3);
  const mc = coneMC({ D, r0, alpha, screens: 24, m: 40, N: 256, span: 3 }).s2;
  near(mc / sf, 1, 0.1, 'Monte Carlo / integral');
});

test('σ² grows as D^{5/3}, a sodium laser beats a Rayleigh laser, ground turbulence costs nothing', () => {
  const base = { D: 8, H: 90e3, r0: 0.15, wHigh: 0.4, hHigh: 10e3, zeta: 0, lam: 1.65e-6 };
  const a = coneError(base), b = coneError({ ...base, D: 16 });
  near(b.s2 / a.s2, 2 ** (5 / 3), 1e-9, 'D^{5/3}');
  near(a.d0, 8 / a.s2 ** 0.6, 1e-9, 'd₀ definition');
  assert.ok(coneError({ ...base, H: 15e3 }).s2 > 3 * a.s2, 'Rayleigh laser');
  near(coneError({ ...base, wHigh: 0 }).s2, 0, 0, 'all turbulence at the ground');
  // λ: σ² ∝ λ^{−2}; the error in nm does not depend on λ
  const c = coneError({ ...base, lam: 0.5e-6 });
  near(c.s2 / a.s2, (1.65 / 0.5) ** 2, 1e-9, 'σ² ∝ λ⁻²'); near(c.nm, a.nm, 1e-9, 'nm');
});
