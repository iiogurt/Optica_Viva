// Zone plates and Talbot carpets: exact sums over zones and over diffraction orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axialI, lensPeak, orderFocus, efficiency, focalProfile, gratingC, talbotField, talbotLength, selfImage } from '../js/lib/zoneplate.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const zp = { f: 0.1, lam0: 550e-9, N: 40, kind: 'amplitude' };

test('a zone plate focuses N² on the axis: 1/π² of a perfect lens (amplitude), 4/π² (phase)', () => {
  near(axialI(zp, 550e-9, 0.1), 1600, 1e-6, 'amplitude, N²');
  near(axialI(zp, 550e-9, 0.1) / lensPeak(zp, 550e-9), 1 / Math.PI ** 2, 1e-12, 'amplitude efficiency');
  const ph = { ...zp, kind: 'phase' };
  near(axialI(ph, 550e-9, 0.1) / lensPeak(ph, 550e-9), 4 / Math.PI ** 2, 1e-12, 'phase efficiency');
  near(efficiency('amplitude', 3), 1 / (9 * Math.PI ** 2), 1e-15, 'third order'); assert.equal(efficiency('amplitude', 2), 0, 'no even orders');
  // the third-order focus at f/3 is as bright on the axis (three times smaller, a ninth of the light)
  near(axialI(zp, 550e-9, 0.1 / 3), 1600, 1e-6, 'f/3');
  // the focal-plane profile agrees with the axial sum at r = 0
  near(focalProfile(zp, 550e-9, 0.1, [0])[0], 1600, 0.5, 'profile on the axis');
});

test('the focus moves as 1/λ: red light focuses closer', () => {
  for (const lam of [450e-9, 650e-9]) {
    const f = orderFocus(zp, lam);
    near(f, (0.1 * 550e-9) / lam, 1e-15, 'f λ₀/λ');
    // the axial maximum near the first-order focus is there
    let best = 0, at = 0;
    for (let i = 0; i <= 400; i++) { const z = f * (0.9 + (0.2 * i) / 400), v = axialI(zp, lam, z); if (v > best) { best = v; at = z; } }
    near(at / f, 1, 0.002, `maximum at ${lam}`);
  }
});

test('Talbot: the grating returns at 2d²/λ (paraxial), shifted by half a period halfway, uniform at a quarter', () => {
  const g = { d: 20e-6, p: 0.5, lam: 550e-9, exact: false }, zT = talbotLength(g.d, g.lam);
  near(selfImage(g, zT), 1, 1e-9, 'z_T');
  assert.ok(selfImage(g, zT / 2) < -0.98, 'half-period shift at z_T/2');
  // at z_T/4 even orders keep their phase and odd ones turn by −π/2: I = c₀² + (T − c₀)², T the grating's own series
  const F = talbotField(g), M = Math.floor(g.d / g.lam);
  for (const x of [0.1e-6, 3e-6, 7.7e-6, 12e-6]) {
    let T = 0;
    for (let m = -M; m <= M; m++) if (1 - (m * g.lam / g.d) ** 2 > 0) T += gratingC(m, 0.5) * Math.cos((2 * Math.PI * m * x) / g.d);
    near(F.I(x, zT / 4), 0.25 + (T - 0.5) ** 2, 1e-9, `x = ${x}`);
  }
});

test('Talbot: light is conserved at every distance, and exact propagation spoils fine self-images', () => {
  for (const exact of [false, true]) {
    const g = { d: 5e-6, p: 0.3, lam: 600e-9, exact }, F = talbotField(g), M = Math.floor(g.d / g.lam);
    let parseval = 0;
    for (let m = -M; m <= M; m++) if (1 - (m * g.lam / g.d) ** 2 > 0) parseval += gratingC(m, 0.3) ** 2;
    for (const z of [0, 13e-6, 51e-6]) {
      let mean = 0;
      for (let i = 0; i < 2000; i++) mean += F.I((g.d * (i + 0.5)) / 2000, z) / 2000;
      near(mean, parseval, 1e-9, `mean irradiance, exact ${exact}, z ${z}`);
    }
  }
  const fine = { d: 2e-6, p: 0.5, lam: 550e-9, exact: true };
  assert.ok(selfImage(fine, talbotLength(fine.d, fine.lam)) < 0.8, 'a 2 µm grating does not return at 2d²/λ');
});
