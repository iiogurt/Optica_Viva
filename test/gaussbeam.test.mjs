// Gaussian beams: the q-parameter laws, Self's lens formula, and the Fresnel integral as a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayleigh, divergence, beamOf, qWaist, propagate, lens, focus, selfImage, fieldAfter, radiusE2 } from '../js/lib/gaussbeam.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const lam = 633e-9, w0 = 0.5e-3;

test('a Gaussian beam: √2 wider and most curved (R = 2z_R) one Rayleigh range from its waist; w₀θ = M²λ/π', () => {
  const zR = rayleigh(w0, lam), b = beamOf(propagate(qWaist(w0, lam), zR), lam);
  near(zR, (Math.PI * w0 * w0) / lam, 1e-15, 'z_R'); near(b.w / w0, Math.SQRT2, 1e-12, 'w(z_R)'); near(b.R / zR, 2, 1e-12, 'R(z_R)');
  assert.equal(beamOf(qWaist(w0, lam), lam).R, Infinity, 'flat at the waist');
  near(w0 * divergence(w0, lam, 1.3), (1.3 * lam) / Math.PI, 1e-18, 'beam parameter product');
  // M²: the same laws with z_R = πw₀²/M²λ; the width is M times that of the embedded Gaussian of waist w₀/M
  const M2 = 2.25, M = 1.5, z = 0.7, real = beamOf(propagate(qWaist(w0, lam, M2), z), lam, M2).w, emb = beamOf(propagate(qWaist(w0 / M, lam), z), lam).w;
  near(real / emb, M, 1e-12, 'embedded Gaussian');
});

test("a lens: the matrix route equals Self's formula, the waist lands beyond f, most of all when s − f = z_R", () => {
  const zR = rayleigh(w0, lam), f = 0.1;
  for (const s of [0.05, 0.3, 1, 3]) near(focus(w0, lam, 1, s, f).sp, selfImage(s, f, zR), 1e-12, `s = ${s}`);
  // the waist behind the lens is farthest from f at s = f + z_R (and lies at f + f²/2z_R there)
  const shift = (s) => focus(w0, lam, 1, s, f).sp - f, best = f + zR;
  assert.ok(shift(best) > shift(best * 0.9) && shift(best) > shift(best * 1.1), 'maximum at s − f = z_R');
  near(shift(best), (f * f) / (2 * zR), 1e-12, 'largest shift f²/2z_R');
  // a lens at the waist focuses at s′ = f/(1 + (f/z_R)²), to w₀′ = w₀ f / (z_R √(1 + (f/z_R)²))
  const F = focus(w0, lam, 1, 0, f), r = f / zR;
  near(F.sp, f / (1 + r * r), 1e-15, 's′ for a lens at the waist'); near(F.w0p, (w0 * r) / Math.sqrt(1 + r * r), 1e-15, 'w₀′');
});

test('the Fresnel integral reproduces the q-parameter widths and carries all the light', () => {
  const s = 1, f = 0.1, qL = propagate(qWaist(w0, lam), s), L = beamOf(qL, lam), F = focus(w0, lam, 1, s, f);
  for (const k of [-2, -1, 0, 1, 2]) {
    const z = F.sp + k * F.zRp, wz = beamOf(propagate(lens(qL, f), z), lam).w, rs = Array.from({ length: 160 }, (_, i) => (i / 159) * 2 * wz);
    near(radiusE2(rs, fieldAfter({ w: L.w, R: L.R, f, a: 10 * L.w, z, lam }, rs, 800)) / wz, 1, 2e-4, `w at ${k} z_R`);
  }
  // power at the focus = power of the beam at the lens through the aperture, (πw²/2)(1 − e^{−2a²/w²})
  for (const aRel of [10, 1]) {
    const rs = Array.from({ length: 1500 }, (_, i) => (i / 1499) * 30 * F.w0p), I = fieldAfter({ w: L.w, R: L.R, f, a: aRel * L.w, z: F.sp, lam }, rs, 1200);
    let P = 0;
    for (let i = 1; i < rs.length; i++) P += Math.PI * (rs[i] * I[i] + rs[i - 1] * I[i - 1]) * (rs[i] - rs[i - 1]);
    near(P / ((Math.PI * L.w * L.w) / 2) / (1 - Math.exp(-2 * aRel * aRel)), 1, 0.01, `power, a = ${aRel} w`);
  }
});
