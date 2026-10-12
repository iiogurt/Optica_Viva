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

test('2-D FFT matches a direct DFT (n = 8 and 64)', () => {
  for (const n of [8, 64]) {
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    for (let i = 0; i < n * n; i++) { re[i] = rnd(); im[i] = rnd(); }
    const R = re.slice(), I = im.slice();
    fft2d(re, im, n);
    for (const [u, v] of [[0, 0], [1, 3], [n - 1, 2], [n / 2, n / 2]]) {
      let sr = 0, si = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const a = (-2 * Math.PI * (u * x + v * y)) / n, c = Math.cos(a), s = Math.sin(a);
        sr += R[y * n + x] * c - I[y * n + x] * s; si += R[y * n + x] * s + I[y * n + x] * c;
      }
      near(re[v * n + u], sr, 1e-9, `Re F(${u},${v}) n=${n}`);
      near(im[v * n + u], si, 1e-9, `Im F(${u},${v}) n=${n}`);
    }
  }
});

test('pupil rasters are cached and shared', () => {
  const a = rasterAperture({ type: 'polygon', blades: 7, curvature: 0.2 }, 64, 32, 2);
  const b = rasterAperture({ type: 'polygon', blades: 7, curvature: 0.2 }, 64, 32, 2);
  assert.equal(a, b, 'same spec returns the cached array');
  assert.notEqual(a, rasterAperture({ type: 'polygon', blades: 8, curvature: 0.2 }, 64, 32, 2), 'different spec → new raster');
});

test('worker tasks reproduce the laboratories\' reference results', async () => {
  const { TASKS } = await import('../js/lib/tasks.js');
  const coro = TASKS.coronagraph({ st: { pupil: 'clear', mask: 4, lyot: 0.8, sep: 12, con: 1e-5, wfe: 2, lam: 1.6 }, n: 256, Dp: 64 }).result;
  near(coro.throughput, 0.409, 0.002, 'Lyot coronagraph planet throughput');
  assert.ok(coro.starAt < coro.directAt / 10, 'coronagraph suppresses starlight at the planet > 10×');
  const seg = TASKS.segPhasing({ st: { stage: 'stack', seed: 3, lam: 2 }, nS: 512, DS: 128 }).result;
  near(seg.rmsP * 1000, 2517, 1, 'stacked-segment piston RMS (nm)');
  near(seg.strehl, 0.217, 0.002, 'stacked-segment Strehl');
  const L = { ...LENSES.cooke }, p = paraxial(L);
  const lp = TASKS.lensPSF({ lens: L, theta: 14, zImg: p.zImage, N: p.efl / L.epd }).result;
  near(lp.pvW, 3.30, 0.01, 'Cooke 14° OPD P-V (waves)');
  near(lp.strehl, 0.061, 0.002, 'Cooke 14° Strehl');
  const z = TASKS.zernikeLab({ coeffs: { 8: 0.25 }, n: 128, Dpx: 32 }).result;
  near(z.rms, 0.25, 0.005, 'Zernike RMS equals the coma coefficient');
});

test('aspheres: hyperbolic surface (k = −n²) removes spherical aberration exactly', async () => {
  const L = LENSES['plano-hyperbolic'], p = paraxial(L);
  near(p.efl, 100, 1e-3, 'plano-hyperbolic EFL');
  for (const py of [0.25, 0.5, 0.75, 1]) {
    const a = aimRay(L, 587.56, 0, 0, py, p);
    const r = trace(L, 587.56, a.p, a.d, { clip: false, zv: p.zv });
    near(toPlane(r, p.zImage)[1] * 1000, 0, 0.01, `transverse error (µm) at pupil ${py}`);
  }
});

test('aspheres: Newton intersection agrees with the closed-form sphere; k = −1 is a paraboloid', async () => {
  const { surfaceSag } = await import('../js/lib/raytrace.js');
  const sphere = { surfaces: [{ R: 40, t: 5, glass: 'N-BK7' }, { R: Infinity, t: 50, glass: 'air' }] };
  const asph = { surfaces: [{ R: 40, a: [1e-30], t: 5, glass: 'N-BK7' }, { R: Infinity, t: 50, glass: 'air' }] };
  const p0 = [0, 6, -10], d0 = [0, 0.05, Math.sqrt(1 - 0.0025)];
  const a = trace(sphere, 550, p0, d0, { clip: false }), b = trace(asph, 550, p0, d0, { clip: false });
  for (let i = 0; i < 3; i++) { near(b.p[i], a.p[i], 1e-9, 'exit point ' + i); near(b.d[i], a.d[i], 1e-12, 'exit direction ' + i); }
  near(surfaceSag({ R: 50, k: -1 }, 7), (7 * 7) / (2 * 50), 1e-12, 'paraboloid sag r²/2R');
});

test('Seidel sums agree with exact ray tracing (small aperture) and with the Petzval sum', async () => {
  const { seidel } = await import('../js/lib/raytrace.js');
  const tsa = (L) => { const p = paraxial(L), a = aimRay(L, 587.56, 0, 0, 1, p); return toPlane(trace(L, 587.56, a.p, a.d, { clip: false, zv: p.zv }), p.zImage)[1]; };
  for (const key of ['plano-convex', 'plano-convex-rev', 'cooke']) {
    const L = { ...LENSES[key], epd: key === 'cooke' ? 2 : 4 }, sd = seidel(L);
    const pred = sd.total.SI / (2 * sd.nImage * sd.uImage), real = tsa(L);
    assert.ok(Math.abs(pred - real) < 0.02 * Math.abs(real), `${key}: Seidel TSA ${pred} vs real ${real}`);
    near(sd.total.SIV / sd.H ** 2, paraxial(L).petzval, 1e-12, `${key}: S_IV / H² = Petzval sum`);
  }
  // bending: reversing the plano-convex lens multiplies spherical aberration by ≈ 4
  const r = seidel({ ...LENSES['plano-convex-rev'], epd: 4 }).total.SI / seidel({ ...LENSES['plano-convex'], epd: 4 }).total.SI;
  near(r, 3.95, 0.05, 'S_I ratio reversed / correct orientation');
  // the conic term cancels S_I of the hyperbolic singlet
  const hyp = seidel(LENSES['plano-hyperbolic']).total.SI, sph = seidel(LENSES['plano-convex-rev']).total.SI;
  assert.ok(Math.abs(hyp) < 1e-5 * Math.abs(sph), `hyperbolic S_I ${hyp}`);
});

test('chromatic Seidel sum C_I predicts the F–C focus shift', async () => {
  const { seidel } = await import('../js/lib/raytrace.js');
  const shift = (L) => paraxial(L, 486.13).zImage - paraxial(L, 656.27).zImage;
  const pred = (L) => { const s = seidel(L); return -s.total.CI / (s.nImage * s.uImage ** 2); };
  const single = LENSES['plano-convex'];
  assert.ok(Math.abs(pred(single) - shift(single)) < 0.01 * Math.abs(shift(single)), 'singlet within 1 %');
  assert.ok(Math.abs(pred(LENSES.achromat)) < 1e-3 * Math.abs(shift(single)), 'achromat ≈ 0');
});

test('exact Coddington field foci match third-order (Seidel) predictions at small field', async () => {
  const { seidel, fieldCurves } = await import('../js/lib/raytrace.js');
  for (const key of ['cooke', 'double-gauss', 'plano-convex']) {
    const L = { ...LENSES[key], field: 2, epd: LENSES[key].epd / 4 }, fc = fieldCurves(L, 587.56, 3), r = fc[fc.length - 1], s = seidel(L);
    const k = -1 / (2 * s.nImage * s.uImage ** 2);
    near(r.zs, (s.total.SIII + s.total.SIV) * k, 0.05 * Math.abs(r.zs) + 1e-5, `${key} sagittal focus`);
    near(r.zt, (3 * s.total.SIII + s.total.SIV) * k, 0.06 * Math.abs(r.zt) + 5e-5, `${key} tangential focus`);
  }
});

test('MTF across the field: diffraction-limited on axis, S = T on axis, astigmatism splits them off axis', async () => {
  const { TASKS } = await import('../js/lib/tasks.js');
  const { autoSemiDiameters } = await import('../js/lib/raytrace.js');
  const L = { ...LENSES['plano-hyperbolic'], epd: 5, field: 0.5 }, p = paraxial(L), N = p.efl / L.epd, nuc = 1 / (587.56e-6 * N);
  const r = TASKS.lensMTF({ lens: L, sd: autoSemiDiameters(L), zImg: p.zImage, N, efl: p.efl, freqs: [0.25 * nuc, 0.5 * nuc], fields: 2 }).result.rows[0];
  near(r.S[0], mtfDiffraction(0.25), 0.015, 'MTF at ¼ cut-off'); near(r.S[1], mtfDiffraction(0.5), 0.015, 'MTF at ½ cut-off');
  const C = { ...LENSES.cooke }, pc = paraxial(C);
  const rows = TASKS.lensMTF({ lens: C, sd: autoSemiDiameters(C), zImg: pc.zImage, N: pc.efl / C.epd, efl: pc.efl, freqs: [30], fields: 5 }).result.rows;
  near(rows[0].S[0], rows[0].T[0], 1e-6, 'on axis S = T');
  assert.ok(rows[2].T[0] - rows[2].S[0] > 0.3, 'Cooke at 10°: tangential ≫ sagittal (sagittal focus is far from the image plane)');
});

test('optimiser rediscovers Coddington\'s best-form singlet and improves the Cooke triplet', async () => {
  const { optimise } = await import('../js/lib/optimise.js');
  const L = { name: 's', epd: 10, field: 1, surfaces: [{ R: 103.4, t: 4, glass: 'N-BK7', stop: true }, { R: -103.4, t: 98, glass: 'air' }] };
  const r = optimise(L, { efl: 100, eflWeight: 1, fields: [0], wavelengths: [587.56], rings: 4, iterations: 40 });
  const [R1, R2] = [r.lens.surfaces[0].R, r.lens.surfaces[1].R];
  near((R2 + R1) / (R2 - R1), 0.74, 0.03, 'shape factor q (third-order Coddington optimum 0.740 for n = 1.517)');
  near(r.efl, 100, 0.01, 'focal length held');
  assert.ok(r.history.at(-1) < r.history[0] / 10, 'merit reduced > 10×');
  const c = optimise(LENSES.cooke, { iterations: 6 });
  assert.ok(c.history.at(-1) < c.history[0], 'Cooke merit does not get worse');
  near(c.efl, paraxial(LENSES.cooke).efl, 0.5, 'Cooke focal length roughly held');
});

test('Monte-Carlo tolerancing: zero errors reproduce nominal; fast lenses are more sensitive', async () => {
  const { monteCarlo } = await import('../js/lib/tolerance.js');
  const zero = monteCarlo(LENSES.cooke, { radiusPct: 0, thicknessUm: 0, indexDelta: 0 }, 4, 1);
  zero.scores.forEach((v) => near(v, zero.nominal, 1e-12, 'zero-tolerance trial'));
  const tol = { radiusPct: 0.1, thicknessUm: 25, indexDelta: 3e-4 };
  const c = monteCarlo(LENSES.cooke, tol, 12, 3), d = monteCarlo(LENSES['double-gauss'], tol, 12, 3);
  assert.ok(c.p90 >= c.nominal && d.p90 >= d.nominal, 'errors never improve the 90th percentile below nominal');
  assert.ok(d.p90 / d.nominal > c.p90 / c.nominal, `f/3 Double-Gauss (${(d.p90 / d.nominal).toFixed(2)}×) more sensitive than f/5 Cooke (${(c.p90 / c.nominal).toFixed(2)}×)`);
});
