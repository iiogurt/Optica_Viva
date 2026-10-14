// Lighting: area-light quadrature, umbra and penumbra, inverse-square falloff, catchlights, flash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLight, lightSamples, irradiance, discOnAxis, shadowGeometry, falloff, catchlight, flashAperture, fresnel0, angularSize } from '../js/lib/lighting.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const E0 = (S, d) => { const l = makeLight(d, 0, 0, S); return irradiance([0, 0, 0], [0, 0, 1], l, lightSamples(l, 6), null); };

test('disc quadrature matches the exact on-axis irradiance', () => {
  for (const [S, d] of [[0.05, 1], [0.6, 1], [1.2, 1], [2, 1]]) near(E0(S, d) / discOnAxis(S / 2, d), 1, 0.01, `${S} m at ${d} m`);
});

test('a small light obeys the inverse-square law', () => {
  near(E0(0.02, 2) / E0(0.02, 1), 0.25, 1e-4, 'twice as far, a quarter of the light');
});

test('penumbra width S b / d and the umbra vanishing for large lights', () => {
  const g = shadowGeometry(0.6, 1, 1, 0.1);
  near(g.pen, 0.6, 1e-12, '60 cm softbox');
  assert.equal(g.umbra, 0);
  near(shadowGeometry(0.05, 1, 1, 0.1).umbra, 0.2 + 0.15, 1e-12, 'small flash keeps a hard core');
  const h = shadowGeometry(0.05, 1, 1, 0.1);
  near((h.outer - h.umbra) / 2, h.pen, 1e-12, 'outer edge = umbra + two penumbrae');
});

test('shadow ray: a bare flash leaves the shadow core dark, a large softbox does not', () => {
  const occ = { c: [0, 0, 0], R: 0.1 }, wall = [0, 0, -0.6];
  const at = (S) => { const l = makeLight(1, 0, 0, S); return irradiance(wall, [0, 0, 1], l, lightSamples(l, 6), occ) / irradiance(wall, [0, 0, 1], l, lightSamples(l, 6), null); };
  near(at(0.05), 0, 1e-12, 'umbra');
  assert.ok(at(1.2) > 0.3, 'large light reaches behind the head');
});

test('falloff, catchlight, flash and Fresnel', () => {
  near(falloff(makeLight(1, 0, 0, 0.1), 1).stops, 2, 1e-9, 'wall 1 m behind, light 1 m in front');
  near(catchlight(0.6, 1), 0.6 * 0.0039, 1e-12, 'cornea as a convex mirror');
  near(flashAperture(36, 4.5, 100), 8, 1e-12, 'GN 36 at 4.5 m');
  near(flashAperture(36, 4.5, 400), 16, 1e-12, 'two stops more ISO');
  near(fresnel0(1.5), 0.04, 1e-12, 'glass');
  near(angularSize(0.6, 1) * 180 / Math.PI, 33.4, 0.05, 'angular size');
});
