// The pinhole camera: the exact Fresnel pattern, its transfer function, and the sharpest pinhole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profile, axial, encircled, otf, sweep, fresnelN, rayleighD, photograph, chart } from '../js/lib/pinhole.js';
import { besselJ0 } from '../js/lib/starshade.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const f = 0.1, lam = 550e-9;

test('on the axis the pattern is (z_e/f)² 4 sin²(πN/2): brightest with one Fresnel zone, dark with two', () => {
  for (const [d, u] of [[0.2e-3, Infinity], [0.47e-3, Infinity], [1e-3, Infinity], [0.5e-3, 0.4]]) near(profile(d, f, u, lam, [0])[0], axial(d, f, u, lam), 1e-9, `d = ${d}, u = ${u}`);
  const d1 = 2 * Math.sqrt(lam * f), d2 = 2 * Math.sqrt(2 * lam * f);
  near(fresnelN(d1, f, Infinity, lam), 1, 1e-12, 'N = 1'); near(axial(d1, f, Infinity, lam), 4, 1e-12, 'four times the open irradiance');
  near(axial(d2, f, Infinity, lam), 0, 1e-12, 'two zones cancel');
});

test('every photon through the hole reaches the film; a tiny hole gives the Airy pattern, a large one its shadow', () => {
  const d = 0.47e-3, rs = Array.from({ length: 2000 }, (_, i) => (i / 1999) * 8e-3), E = encircled(d, f, Infinity, lam, rs, profile(d, f, Infinity, lam, rs, 600));
  assert.ok(E[1999] > 0.995 && E[1999] < 1.0001, `encircled energy ${E[1999]}`);
  // N ≪ 1: Airy, first zero at 1.22 λf/a·(1/2)... at r = 1.22 λf/d
  const ds = 0.05e-3, r0 = (1.22 * lam * f) / ds, I = profile(ds, f, Infinity, lam, [0, r0, r0 / 2]);
  assert.ok(I[1] / I[0] < 2e-3, `first dark ring ${I[1] / I[0]}`);
  const v = (Math.PI * ds * (r0 / 2)) / (lam * f), airy = ((2 * besselJ1(v)) / v) ** 2;
  near(I[2] / I[0], airy, 0.01, 'Airy profile');
  // N ≫ 1: a uniform disk of the hole's size; half the light within a circle of d/√2
  const dl = 3e-3, rr = Array.from({ length: 500 }, (_, i) => (i / 499) * 2.5e-3), EL = encircled(dl, f, Infinity, lam, rr, profile(dl, f, Infinity, lam, rr, 2500));
  const k = rr.findIndex((r, i) => EL[i] >= 0.5);
  near(2 * rr[k], dl / Math.SQRT2, 0.03 * dl, 'half-light diameter of the shadow');
});
function besselJ1(x) { let t = x / 2, s = t; for (let k = 1; k < 60; k++) { t *= -(x * x) / (4 * k * (k + 1)); s += t; } return s; }

test('the transfer function equals the Hankel transform of the pattern, and turns negative for a large hole', () => {
  const d = 0.47e-3, rs = Array.from({ length: 3000 }, (_, i) => (i / 2999) * 8e-3), I = profile(d, f, Infinity, lam, rs, 800), P = (Math.PI * d * d) / 4;
  for (const nu of [500, 1500, 3000]) {
    let num = 0;
    for (let i = 1; i < rs.length; i++) num += Math.PI * (rs[i] * I[i] * besselJ0(2 * Math.PI * nu * rs[i]) + rs[i - 1] * I[i - 1] * besselJ0(2 * Math.PI * nu * rs[i - 1])) * (rs[i] - rs[i - 1]);
    near(otf(d, f, Infinity, lam, nu), num / P, 2e-3, `ν = ${nu}/m`);
  }
  near(otf(d, f, Infinity, lam, 0), 1, 1e-4, 'OTF(0)');
  // a 2 mm hole at 100 mm: the shadow's first zero is at 1.22/d = 610 cycles/m; beyond it the contrast is reversed
  assert.ok(otf(2e-3, f, Infinity, lam, 800) < -0.05, 'contrast reversal');
});

test('the sharpest pinhole depends on the measure: 1.72, 1.50 and 1.38 √(fλ); Rayleigh used 1.9', () => {
  const s = sweep({ f, u: Infinity, lam, dmin: 0.05e-3, dmax: 2e-3, n: 30 }), c = (k) => s.best[k].d / Math.sqrt(f * lam);
  // the centre per unit light ∝ sin²(πN/2)/N peaks where tan x = 2x, x = πN/2: N = 0.7421
  near(s.best.conc.N, 0.7421, 0.004, 'N of the brightest centre');
  near(c('conc'), 1.723, 0.01, 'centre'); near(c('ee50'), 1.50, 0.03, 'half-light circle'); near(c('mtf50'), 1.38, 0.03, 'MTF50');
  near(rayleighD(f, lam) / Math.sqrt(f * lam), 1.9, 1e-12, 'Rayleigh');
  // a near subject: the same rules with z_e = uf/(u + f)
  near(rayleighD(f, lam, 0.3), 1.9 * Math.sqrt(lam * ((0.3 * f) / 0.4)), 1e-15, 'Rayleigh near');
});

test('the photograph keeps the light of the chart', () => {
  const W = 0.02, n = 128, src = chart(n, W), ph = photograph({ d: 0.4e-3, f, u: Infinity, W, n });
  const mean = (a, step, off) => { let s = 0, k = 0; for (let i = off; i < a.length; i += step) { s += a[i]; k++; } return s / k; };
  for (let c = 0; c < 3; c++) near(mean(ph.img, 3, c), mean(src, 1, 0), 2e-3, `channel ${c}`);
});
