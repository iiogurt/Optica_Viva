// Physics validation suite: every number in the README "Validation" table is asserted here.
// Run with `npm test` (node --test, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { index, abbe } from '../js/lib/glass.js';
import { LENSES, paraxial, aimRay, trace, toPlane } from '../js/lib/raytrace.js';
import { fresnel, stackReflectance, COATINGS } from '../js/lib/thinfilm.js';
import { airy, besselJ1, zernike, rasterAperture, psf, mtfDiffraction } from '../js/lib/pupil.js';
import { fft2d, fft1d } from '../js/lib/fft.js';
import { spectralBasis, linspace } from '../js/lib/color.js';
import { hyperfocal, dofLimits, blurDiameter, tiltedLens, tiltedObject, angularDiameterDistance } from '../js/lib/optics.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('Sellmeier indices and Abbe numbers match the Schott/Malitson catalogue', () => {
  near(index('N-BK7', 587.56), 1.5168, 5e-5, 'N-BK7 n_d');
  near(abbe('N-BK7'), 64.17, 0.02, 'N-BK7 V_d');
  near(index('F2', 587.56), 1.62004, 5e-5, 'F2 n_d');
  near(abbe('F2'), 36.37, 0.02, 'F2 V_d');
  near(index('CaF2', 587.56), 1.43385, 1e-4, 'CaF2 n_d');
  near(abbe('CaF2'), 94.99, 0.1, 'CaF2 V_d');
  assert.ok(index('N-BK7', 450) > index('N-BK7', 650), 'normal dispersion');
});

test('lens prescriptions have their design focal lengths', () => {
  near(paraxial(LENSES.cooke).efl, 50.02, 0.01, 'Cooke triplet EFL');
  near(paraxial(LENSES['double-gauss']).efl, 99.5, 0.05, 'Double-Gauss EFL');
  near(paraxial(LENSES['plano-convex']).efl, 99.65, 0.02, 'plano-convex EFL');
});

test('near-axis real rays converge on the paraxial focus', () => {
  const L = LENSES['plano-convex'], p = paraxial(L);
  const a = aimRay(L, 587.56, 0, 0, 0.01, p);
  const r = trace(L, 587.56, a.p, a.d, { clip: false, zv: p.zv });
  near(toPlane(r, p.zImage)[1], 0, 1e-6, 'paraxial ray height at focus (mm)');
});

test('spherical aberration: marginal rays of a positive singlet focus short (under-corrected)', () => {
  const L = LENSES['plano-convex'], p = paraxial(L);
  const a = aimRay(L, 587.56, 0, 0, 1, p);
  const r = trace(L, 587.56, a.p, a.d, { clip: false, zv: p.zv });
  const zCross = r.p[2] - r.p[1] * (r.d[2] / r.d[1]);
  assert.ok(zCross < p.zImage, `marginal focus ${zCross} should lie before paraxial ${p.zImage}`);
});

test('Fresnel reflection, Brewster angle and quarter-wave MgF₂ coating', () => {
  near(fresnel(1, 1.52, 0).R, 0.04258, 5e-5, 'uncoated normal-incidence R');
  assert.ok(fresnel(1, 1.52, Math.atan(1.52)).Rp < 1e-12, 'R_p vanishes at Brewster');
  near(stackReflectance(COATINGS.mgf2.layers(), 1, 1.52, 550, 0).R, 0.0126, 1e-4, 'MgF₂ λ/4 at 550 nm');
  assert.ok(stackReflectance(COATINGS.qhq.layers(), 1, 1.52, 550, 0).R < 0.003, 'QHQ broadband < 0.3 %');
  near(stackReflectance([], 1, 1.52, 550, 0).R, fresnel(1, 1.52, 0).R, 1e-12, 'empty stack = bare interface');
});

test('Airy pattern: first zero, encircled energy and Rayleigh dip', () => {
  near(besselJ1(3.8317), 0, 1e-4, 'J1 first zero');
  near(airy(3.8317), 0, 1e-8, 'Airy first dark ring at v = 3.8317');
  // EE(v0) = ∫₀^v0 [2J1(v)/v]² v dv / 2  (the total integral is 2)
  let ee = 0; const n = 20000, v0 = 3.8317;
  for (let i = 0; i < n; i++) { const v = ((i + 0.5) / n) * v0; ee += airy(v) * v * (v0 / n); }
  near(ee / 2, 0.838, 0.001, 'encircled energy inside the first dark ring');
  const dip = (2 * airy(Math.PI * 0.61)) / (airy(0) + airy(Math.PI * 1.22));
  near(dip, 0.735, 0.002, 'Rayleigh two-point dip');
  near(mtfDiffraction(0.5), 0.3910, 1e-3, 'diffraction MTF at half cut-off');
});

test('FFT: inverse round-trip and Parseval', () => {
  const n = 64, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.3);
  const orig = re.slice();
  const e0 = orig.reduce((s, v) => s + v * v, 0);
  fft1d(re, im);
  const e1 = re.reduce((s, v, i) => s + v * v + im[i] * im[i], 0) / n;
  near(e1, e0, 1e-9, 'Parseval');
  fft1d(re, im, true);
  re.forEach((v, i) => near(v, orig[i], 1e-12, 'round-trip sample ' + i));
  const N = 32, R = new Float64Array(N * N).fill(1), I = new Float64Array(N * N);
  fft2d(R, I, N);
  near(R[0], N * N, 1e-9, '2-D DC term');
});

test('FFT PSF of a circular pupil has its first minimum at 1.22 λ/D', () => {
  const n = 256, D = 64, Q = n / D;
  const { I } = psf(rasterAperture({ type: 'circle' }, n, D, 4), null, n, 1);
  const c = n / 2, at = (r) => I[c * n + Math.round(c + r)];
  const peak = I[c * n + c];
  assert.ok(at(1.22 * Q) / peak < 2e-3, 'near-zero intensity at the first dark ring');
  assert.ok(at(1.635 * Q) / peak > 0.01, 'first bright ring near 1.635 λ/D');
});

test('Zernike polynomials are orthonormal over the unit disk (Noll)', () => {
  const G = 400, modes = [4, 6, 8, 11];
  const dot = (j, k) => {
    let s = 0, cnt = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const u = ((x + 0.5) / G) * 2 - 1, v = ((y + 0.5) / G) * 2 - 1, r = Math.hypot(u, v);
      if (r > 1) continue;
      const t = Math.atan2(v, u); s += zernike(j, r, t) * zernike(k, r, t); cnt++;
    }
    return s / cnt;
  };
  for (const j of modes) near(dot(j, j), 1, 0.01, `⟨Z${j}²⟩`);
  near(dot(4, 11), 0, 0.01, '⟨Z4·Z11⟩');
  near(dot(6, 8), 0, 0.01, '⟨Z6·Z8⟩');
});

test('spectral basis integrates a flat spectrum to neutral white', () => {
  const basis = spectralBasis(linspace(400, 700, 31));
  for (let ch = 0; ch < 3; ch++) near(basis.reduce((s, b) => s + b[ch], 0), 1, 1e-9, 'channel ' + ch);
});

test('depth of field: hyperfocal distance and limits', () => {
  near(hyperfocal(50, 2.8, 0.0288) / 1000, 31.05, 0.05, 'H for 50 mm f/2.8 (m)');
  const { near: dn, far } = dofLimits(50, 2.8, 0.0288, 3000);
  near(dn / 1000, 2.739, 0.003, 'near limit (m)');
  near(far / 1000, 3.316, 0.003, 'far limit (m)');
  near(blurDiameter(50, 2.8, 3000, dn), 0.0288, 1e-6, 'blur at the near limit equals c');
  assert.equal(dofLimits(50, 2.8, 0.0288, 40000).far, Infinity, 'beyond H the far limit is infinite');
});

test('Scheimpflug hinge rule: the traced plane of focus crosses the lens plane at f/sin α', () => {
  const G = tiltedLens(0.065, 8, 52, 2.8);
  const p1 = tiltedObject(G, [0, 3e-4, -G.v]), p2 = tiltedObject(G, [0, -3e-4, -G.v]);
  const t = -p1[2] / (p2[2] - p1[2]);
  near(p1[1] + t * (p2[1] - p1[1]), 0.065 / Math.sin((8 * Math.PI) / 180), 1e-6, 'hinge height (m)');
});

test('flat ΛCDM angular-diameter distances', () => {
  near(angularDiameterDistance(0, 0.3), 919, 2, 'D_A(z = 0.3) in Mpc');
  near(angularDiameterDistance(0, 2), 1727, 3, 'D_A(z = 2) in Mpc');
});

test('natural vignetting: cos⁴ at the corner of a 28 mm full-frame lens', () => {
  const th = Math.atan(Math.hypot(18, 12) / 28);
  near((th * 180) / Math.PI, 37.69, 0.01, 'corner field angle (°)');
  near(Math.log2(Math.cos(th) ** 4), -1.3506, 0.0005, 'falloff in EV');
});
