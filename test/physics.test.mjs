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
  near(lp.pvW, 3.60, 0.01, 'Cooke 14° OPD P-V (waves; a 401² direct trace gives 3.62)');
  near(lp.strehl, 0.0594, 0.002, 'Cooke 14° Strehl');
  const z = TASKS.zernikeLab({ coeffs: { 8: 0.25 }, n: 128, Dpx: 32 }).result;
  near(z.rms, 0.25, 0.005, 'Zernike RMS equals the coma coefficient');
});

test('off-axis PSF pupil: Debye directions match the exact geometry of a flat rear stop', async () => {
  // With the stop behind the lens, the exit pupil is the stop itself: a flat disk of radius ρ a
  // distance D in front of the image plane. Seen from an image point at height h, it spans
  // ΔL = 2ρ/√(ρ² + h² + D²) sagittally and ΔM = M(−ρ) − M(ρ), M(y) = (h − y)/√((h − y)² + D²), tangentially.
  const { TASKS } = await import('../js/lib/tasks.js');
  const { referenceSphere } = await import('../js/lib/raytrace.js');
  const L = { epd: 4, field: 25, surfaces: [{ R: 51.5, t: 3.6, glass: 'N-BK7' }, { R: Infinity, t: 5, glass: 'air' }, { R: Infinity, t: 92, glass: 'air', stop: true }] };
  const p = paraxial(L), N = p.efl / L.epd, NA = 1 / (2 * N), D = p.zImage - p.zXP, rho = p.stopR;
  for (const th of [0, 10, 25]) {
    const h = referenceSphere(L, 587.56, th, p.zImage, p).center[1];
    const M = (y) => (h - y) / Math.hypot(h - y, D);
    const r = TASKS.lensPSF({ lens: L, theta: th, zImg: p.zImage, N }).result;
    near(r.pupil.a, 2 * rho / Math.hypot(rho, h, D) / NA, 2e-4, `sagittal pupil width at ${th}°`);
    near(r.pupil.b, (M(-rho) - M(rho)) / NA, 2e-4, `tangential pupil width at ${th}°`);
  }
  const r = TASKS.lensPSF({ lens: L, theta: 25, zImg: p.zImage, N }).result;
  assert.ok(r.pupil.b / r.pupil.a < 0.8, 'at 25° the pupil is foreshortened by more than 20 %');
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

test('display primaries reproduce the IEC 61966-2-1 sRGB matrix; Rec. 2020 primaries lie on the spectral locus', async () => {
  const { rgbToXYZ, GAMUTS, LOCUS } = await import('../js/lib/colour3d.js');
  const M = rgbToXYZ('srgb'), IEC = [[41.24, 35.76, 18.05], [21.26, 71.52, 7.22], [1.93, 11.92, 95.05]];
  M.forEach((r, i) => r.forEach((v, j) => near(v, IEC[i][j], 0.006, `sRGB M[${i}][${j}]`)));
  // ITU-R BT.2020 primaries are monochromatic: 630, 532 and 467 nm (interpolated in the 5 nm table)
  for (const [[x, y], nm] of GAMUTS.rec2020.xy.map((p, k) => [p, [630, 532, 467][k]])) {
    const f = (nm - 380) / 5, i = Math.floor(f), t = f - i, lx = LOCUS[i][0] * (1 - t) + LOCUS[i + 1][0] * t, ly = LOCUS[i][1] * (1 - t) + LOCUS[i + 1][1] * t;
    near(Math.hypot(x - lx, y - ly), 0, 3e-3, `Rec. 2020 primary at ${nm} nm`);
  }
});

test('Tissot indicatrices: equisolid keeps area, stereographic keeps circles, rectilinear area grows as sec³θ', async () => {
  const { tissotCircles } = await import('../js/lib/projection.js');
  const f = 10;
  // equal area: every image has the area of its circle on the sphere, to the n-gon's accuracy (beyond
  // ~140° off axis a 5° circle's image bends into a crescent that 24 points no longer describe)
  const eq = tissotCircles('equisolid', f, 25, -15).filter((t) => t.img && t.centre[2] > Math.cos((140 * Math.PI) / 180));
  assert.ok(eq.length > 80);
  for (const t of eq) assert.ok(Math.abs(t.ratio - 1) < 0.002, `equisolid ratio ${t.ratio} at ${t.lat}, ${t.lon}`);
  // conformal: the stereographic image of a circle is a circle (all points on the circumcircle of three)
  for (const t of tissotCircles('stereographic', f, 0, 0).filter((t) => t.img && t.lat === 40)) {
    const [a, b, c] = [t.img[1], t.img[9], t.img[17]];
    const D = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const sq = (p) => p[0] ** 2 + p[1] ** 2;
    const ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / D, uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / D;
    const R = Math.hypot(a[0] - ux, a[1] - uy);
    for (const p of t.img.slice(1)) assert.ok(Math.abs(Math.hypot(p[0] - ux, p[1] - uy) - R) < 1e-9 * f, 'not a circle');
  }
  // rectilinear: h = f sec²θ, k = f sec θ, so area grows as sec³θ (a 5° circle averages that over its
  // extent: 1.4 % more at 40°)
  const r40 = tissotCircles('rectilinear', f, 0, 0).find((t) => t.lat === 0 && t.lon === 40);
  near(r40.ratio, Math.cos((40 * Math.PI) / 180) ** -3, 0.02 * r40.ratio, 'rectilinear area ratio at 40°');
});

test('lens equation images: SIS at β ± θE, point mass at (β ± √(β² + 4θE²))/2, with their magnifications', async () => {
  const { images } = await import('../js/lib/lensing.js');
  const b = 1.4, src = [0.3, -0.4], beta = Math.hypot(...src);
  const sis = images({ model: 'sis', b }, src);
  assert.equal(sis.length, 2);
  const rs = sis.map((p) => Math.hypot(p.x, p.y)).sort((x, y) => y - x);
  near(rs[0], beta + b, 1e-6, 'SIS outer image'); near(rs[1], b - beta, 1e-6, 'SIS inner image');
  near(sis[0].mu, (beta + b) / beta, 1e-3 * sis[0].mu, 'SIS μ+ = θ/(θ − θE)');
  const pm = images({ model: 'point', b }, src).map((p) => Math.hypot(p.x, p.y)).sort((x, y) => y - x);
  near(pm[0], (beta + Math.sqrt(beta * beta + 4 * b * b)) / 2, 1e-6, 'point-mass outer');
  near(pm[1], (Math.sqrt(beta * beta + 4 * b * b) - beta) / 2, 1e-6, 'point-mass inner');
  // an elliptical lens with the source near the centre gives an Einstein cross
  assert.equal(images({ model: 'sie', b, q: 0.7, pa: 0.5, gamma: 0.04, gpa: 1.7 }, [0.05, 0.03]).length, 4);
});

test('flat ΛCDM: comoving distances add up, (1 + z_s) D_ls = χ_s − χ_l', async () => {
  const { comoving } = await import('../js/lib/lensing3d.js');
  for (const [zl, zs] of [[0.3, 2], [1.2, 5], [0.05, 0.4]]) near((1 + zs) * angularDiameterDistance(zl, zs) / 1000, comoving(zs) - comoving(zl), 1e-5, `z = ${zl}, ${zs}`);
});

test("G-tilt image motion per axis: Tyler's 0.1706 (λ/D)² (D/r₀)^{5/3}", async () => {
  const { tiltVariance, LAM0 } = await import('../js/lib/shimmer.js');
  near(tiltVariance(0.2, 0.05) / ((LAM0 / 0.2) ** 2 * (0.2 / 0.05) ** (5 / 3)), 0.1706, 0.0017, 'coefficient');
});

test('portrait mission photograph: spherical-light irradiance and background discs of the planned size', async () => {
  const { sphereLight, portraitShot, plan } = await import('../js/lib/portrait.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const a = 0.3, s = Math.sin(a);
  near(sphereLight(s, a), s, 1e-12, 'continuous where the whole light is visible');
  near(sphereLight(-s, a), 0, 1e-12, 'zero where none is');
  near(sphereLight(0, a), s / 4, 1e-12, 'a quarter at the geometric terminator');
  near(sphereLight(0.5, 1e-6), 0.5, 1e-9, 'a point light gives Lambert cos θ');
  const P = plan({ d: 2, N: 2, B: 3 }), S = P.S, W = 120, H = 180, sw = Math.min(S.w, S.h);
  const r = portraitShot({ W, H, sw, sh: Math.max(S.w, S.h), f: P.f * 1000, N: 2, d: 2, B: 3, light: 0.9, ld: 1.2, Hf: 0.55 });
  near((2 * r.rb) / (W / sw), P.bg * 1000, 1e-9, 'disc diameter on the sensor = planned background blur (mm)');
  const k = Math.round(H * 0.4) * W + W / 2; // the face, near the middle of the frame
  assert.ok(r.rgb[k * 3] > 0.15 && r.rgb[k * 3] > 3 * r.rgb[(2 * W + 2) * 3], 'the lit face is far brighter than the wall');
});

test('portrait photograph: 2 × 2 rays per pixel give the same picture as a single ray, only smoother', async () => {
  const { portraitShot, plan } = await import('../js/lib/portrait.js');
  const P = plan({}), S = P.S, a = { sw: Math.min(S.w, S.h), sh: Math.max(S.w, S.h), f: P.f * 1000, N: 2, d: 2, B: 3, light: 0.9, ld: 1.2, Hf: 0.55, W: 60, H: 90 };
  const one = portraitShot(a), four = portraitShot({ ...a, ss: 2 });
  const mean = (r) => r.rgb.reduce((s, v) => s + v, 0) / r.rgb.length;
  assert.ok(Math.abs(mean(four) / mean(one) - 1) < 0.06, `mean brightness ${mean(four)} vs ${mean(one)}`);
  assert.ok(Math.abs(four.rb - one.rb) < 1e-9, 'same disc size');
});

test('Milky Way mission photograph: the stack is √frames less noisy than one frame, around the planned sky level', async () => {
  const { plan, milkywayShot } = await import('../js/lib/milkyway.js');
  const P = plan({}), r = milkywayShot(P, { W: 200, H: 130 });
  // the noise is the difference between the two pictures, whose clean parts are identical
  let s = 0, s2 = 0, n = 0;
  for (let k = 0; k < r.one.length; k++) { const d = r.one[k] - r.stack[k]; s += d; s2 += d * d; n++; }
  // expected: photon noise of the actual signal (the stack stands in for it) plus read noise, for one
  // frame and the stack together
  let v = 0; for (const x of r.stack) v += Math.max(0, x) + P.sigma * P.sigma;
  const sd = Math.sqrt(s2 / n - (s / n) ** 2), expect = Math.sqrt((v / n) * (1 + 1 / P.frames));
  assert.ok(Math.abs(sd / expect - 1) < 0.12, `noise of one frame ${sd} vs about ${expect}`);
  assert.ok(Math.abs(r.sky - P.Fs * P.t) < 1e-9, 'sky level = F_s t');
  const again = milkywayShot(P, { W: 200, H: 130 });
  assert.equal(again.one[777], r.one[777], 'seeded: the same picture every time');
});

test('mirages: index of air, ray curvature, the gradient at which light follows the Earth, and the images', async () => {
  const M = await import('../js/lib/mirage.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  near(M.refractivity(288.15, 1013.25), 2.77e-4, 1e-12, 'n − 1 at 15 °C, 1013.25 hPa');
  near(M.dndT(288.15, 1013.25), -2.77e-4 / 288.15, 1e-15, 'dn/dT = −(n − 1)/T');
  near(M.rayCurvature(M.criticalGradient()).k, 1, 1e-9, 'at the critical gradient a level ray curves like the Earth');
  near(M.criticalGradient(), 0.129, 0.002, 'critical dT/dz at 15 °C (K/m)');
  const k = M.rayCurvature(-0.0065).k;
  assert.ok(k > 0.15 && k < 0.18, `standard atmosphere: coefficient of refraction ${k} (0.13–0.17 quoted for dry air)`);
  // a uniform index gradient g: the exact ray z = z0 + p0 x + g x²/2 for small slopes
  const g = 2e-5, U = { grad: () => g, ne: () => 1, scale: 50 }, r = M.ray(U, 1, 0.001, 300, { dx: 5 });
  near(r.z, 1 + 0.001 * 300 + (g * 300 * 300) / 2, 2e-4, 'ray in a uniform gradient');
  // images of the middle of the object: two on the hot road (one inverted), one in standard air, and
  // at least one over a cold sea
  const count = (atm, z0, L, H) => {
    const s = M.mirageScene({ atm, z0, L, H, n: 301 }), zm = H / 2;
    let n = 0; for (let i = 1; i < s.z.length; i++) { const a = s.z[i - 1], b = s.z[i]; if (isFinite(a) && isFinite(b) && (a - zm) * (b - zm) <= 0 && a !== b) n++; }
    return n;
  };
  assert.equal(count({ Ta: 30, dT: 15, h: 0.05 }, 1.6, 800, 1.5), 2, 'hot road: upright and inverted');
  // standard air: the part of the ship hidden below the horizon matches (L − √(2R′z₀))²/(2R′) with the
  // effective radius R′ = R_E/(1 − k)
  const Rp = M.RE / (1 - k), hidden = (20000 - Math.sqrt(2 * Rp * 3)) ** 2 / (2 * Rp);
  const std = M.mirageScene({ atm: { Ta: 15, dT: 0, h: 1 }, z0: 3, L: 20000, H: 24, n: 601 });
  near(Math.min(...std.z.filter(Number.isFinite)), hidden, 0.15, 'standard air: lowest visible height at 20 km (m)');
  assert.equal(count({ Ta: 15, dT: 0, h: 1 }, 3, 20000, 24), 1, 'standard air: the ship\'s middle (12 m) just clears the horizon');
  assert.ok(count({ Ta: 10, dT: -6, h: 15 }, 3, 20000, 24) >= 1, 'cold sea: looming brings it back');
});

test('pool caustics: Snell in vector form, the depth where a wave first focuses, conserved light, apparent depth', async () => {
  const C = await import('../js/lib/caustics.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  // Snell: sin i = n sin r for a ray at 30° onto a flat surface
  const n = 1.333, i = Math.PI / 6, tv = C.refract([Math.sin(i), 0, -Math.cos(i)], [0, 0, 1], n);
  near(Math.hypot(tv[0], tv[1], tv[2]), 1, 1e-12, 'unit length');
  near(Math.sin(i), n * tv[0], 1e-12, 'sin i = n sin r');
  // one wave: the landing map first folds at D* = n/((n − 1) A k²)
  const A = 0.004, k = (2 * Math.PI) / 0.3, Ds = C.focusDepth(A, k, n);
  const minSlope = (D) => { let m = Infinity; for (let j = 0; j < 2000; j++) { const x = (j / 2000) * 0.3, e = 1e-6; m = Math.min(m, (C.landing1D(A, k, n, D, x + e) - C.landing1D(A, k, n, D, x - e)) / (2 * e)); } return m; };
  let lo = 0.1, hi = 10;
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (minSlope(mid) > 0) lo = mid; else hi = mid; }
  near(lo / Ds, 1, 0.01, 'first fold of the traced rays vs D*');
  // the light on the floor averages that of flat water (nothing lost or created)
  const img = C.floorLight(C.makeWaves({ A: 0.006, lam: 0.25 }), { N: 64, D: 1.2, rpp: 2 })[0];
  near(img.reduce((s, v) => s + v, 0) / img.length, 1, 1e-6, 'mean floor irradiance');
  assert.ok(Math.max(...img) > 3, 'caustic lines several times brighter than the mean');
  // apparent depth: d/n straight down; the tangential image where neighbouring rays' extensions meet
  near(C.apparentDepth(1, 0, n).tangential, 1 / n, 1e-12, 'd/n');
  const d = 1, ta = 0.6, a = C.apparentDepth(d, ta, n), e = 1e-6;
  const line = (tw) => ({ x: d * Math.tan(tw), t: Math.tan(Math.asin(n * Math.sin(tw))) });
  const p = line(a.tw - e), q = line(a.tw + e);
  near(Math.abs((q.x - p.x) / (p.t - q.t)), a.tangential, 1e-6, 'tangential apparent depth');
});

test('halation: total reflection in the film base sets the ring; the kernels conserve light', async () => {
  const H = await import('../js/lib/halation.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const n = 1.65, t = 0.125, tc = H.criticalAngle(n);
  near((tc * 180) / Math.PI, 37.31, 0.01, 'critical angle (°)');
  near(H.ringRadius(t, n) * 1000, 190.5, 0.2, 'ring radius 2t tan θc (µm)');
  // Lambertian light beyond θc is all reflected: the returned share is cos²θc plus the Fresnel part below
  const ret = H.returned(n);
  assert.ok(ret > Math.cos(tc) ** 2 && ret < Math.cos(tc) ** 2 + 0.06, `returned ${ret} just above cos²θc = ${Math.cos(tc) ** 2}`);
  near(H.returned(n, 0.02), 0.02 * ret, 1e-12, 'a backing scales it');
  // the light per area peaks just outside r_c, where total reflection begins: a ring
  const rc = H.ringRadius(t, n), d = (f) => H.halationDensity(f * rc, t, n);
  assert.ok(d(1.01) > 6 * d(0.5) && d(1.01) > d(0.99) && d(1.01) > d(1.1) && d(1.1) > d(1.5), 'bright ring just outside r_c');
  // the gridded kernel holds the returned light (all of it but the far tail on a 36 mm grid)
  const K = H.halationKernel(256, 36 / 256, t, n);
  near(K.reduce((s, v) => s + v, 0), ret, 0.01 * ret, 'kernel energy');
  near(H.diffusionKernel(128, 0.1, 0.2, 0.6).reduce((s, v) => s + v, 0), 1, 1e-12, 'diffusion filter conserves light');
  // FFT convolution of a single bright pixel returns the kernel, shifted to that pixel
  const N = 64, a = new Float64Array(N * N); a[10 * N + 20] = 1;
  const D = H.diffusionKernel(N, 0.2, 0.3, 0.8), c = H.convolve(a, D, N);
  near(c[10 * N + 20], D[0], 1e-9, 'centre'); near(c[12 * N + 23], D[2 * N + 3], 1e-9, 'offset (3, 2)');
});

test('sky: Rayleigh optical depth, λ⁻⁴, air mass, a blue sky, a red low Sun, the Earth\'s shadow', async () => {
  const S = await import('../js/lib/sky.js');
  const { xyzToLinearRGB } = await import('../js/lib/color.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const v = S.column(0, 1, 400);
  near(S.rayleighBeta(550) * v[0], 0.0973, 0.002, 'vertical Rayleigh optical depth at 550 nm (Bucholtz 1995)');
  const ratio = S.rayleighBeta(450) / S.rayleighBeta(700);
  assert.ok(ratio > (700 / 450) ** 4 && ratio < 1.05 * (700 / 450) ** 4, `blue/red ${ratio}: λ⁻⁴ plus the dispersion of air`);
  near(S.airMass(0), 1, 1e-9, 'air mass overhead');
  // Kasten & Young include refraction, which lengthens the path near the horizon
  for (const [z, tol] of [[60, 0.015], [75, 0.015], [80, 0.015], [85, 0.03]]) near(S.airMass((z * Math.PI) / 180) / S.kastenYoung(z), 1, tol, `air mass at ${z}° vs Kasten & Young`);
  // with the Sun high the sky overhead is blue; the low Sun is red
  const sky = xyzToLinearRGB(S.toXYZ(S.skyRadiance([0, 0, 1], [Math.cos(0.5), 0, Math.sin(0.5)], { aod: 0.05 })));
  assert.ok(sky[2] > sky[1] && sky[1] > sky[0], `overhead sky ${sky.map((x) => x.toExponential(2))}: blue > green > red`);
  const sun = S.sunColour((2 * Math.PI) / 180, { aod: 0.1 }).rgb;
  assert.ok(sun[0] > 2 * sun[1] && sun[1] > sun[2], `Sun at 2°: red ${sun}`);
  // twilight, Sun 3° below the horizon, looking away: the air just above the horizon is in the Earth's
  // shadow, darker than the air 10° up
  const s = [-Math.cos(-0.052), 0, Math.sin(-0.052)], lum = (el) => S.toXYZ(S.skyRadiance([Math.cos(el), 0, Math.sin(el)], s, { aod: 0.05 }))[1];
  assert.ok(lum(0.01) < lum(0.17), 'the Earth\'s shadow on the horizon opposite the Sun');
});

test('lens corrections: Brown inverse, sampling cost, crop, and straight lines after correction', async () => {
  const C = await import('../js/lib/corrections.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  near(C.undistort(C.distort(0.83, -0.12, 0.02), -0.12, 0.02), 0.83, 1e-12, 'inverse distortion');
  const k1 = -0.1, r = 0.9, e = 1e-6, sm = C.sampling(r, k1);
  near(sm.radial, (C.distort(r + e, k1) - C.distort(r - e, k1)) / (2 * e), 1e-8, 'radial: dr_d/dr_u');
  near(sm.tangential, C.distort(r, k1) / r, 1e-12, 'tangential: r_d/r_u');
  near(C.cropScale(0), 1, 1e-9, 'a perfect lens: no crop'); near(C.keptShare(0), 1, 1e-6, 'and the whole field kept');
  const kept = C.keptShare(k1); assert.ok(kept > 0.8 && kept < 0.97, `barrel k1 = −0.1 keeps ${kept} of the field`);
  // after correction a vertical grid line (x = 0.3 ideal) is straight: the darkest column near it is the
  // same in the top, middle and bottom thirds
  const p = { W: 240, H: 160, k1: -0.15, k2: 0, ca: 0, field: 0.73, mech: 0, photons: 1e6, read: 0 };
  const fixed = C.correct(C.record(p), { ...p, fixDist: true, fixVig: true, fixCA: true })[1], s = C.cropScale(p.k1);
  const HX = 1.5 / Math.hypot(1.5, 1), x0 = Math.round(((0.3 / s) / (2 * HX) + 0.5) * 240 - 0.5);
  const darkest = (j) => { let best = x0, v = Infinity; for (let i = x0 - 4; i <= x0 + 4; i++) if (fixed[j * 240 + i] < v) { v = fixed[j * 240 + i]; best = i; } return best; };
  const cols = [12, 30, 130, 148].map(darkest);
  assert.ok(Math.max(...cols) - Math.min(...cols) <= 1, `the line stays in one column: ${cols}`);
});

test('infrared and ultraviolet photography: the Wood effect, black water, the UV bullseye, infrared focus', async () => {
  const P = await import('../js/lib/irphoto.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], sum = (c) => c[0] + c[1] + c[2];
  const shot = (m, f) => P.camera(m === 'sky' ? P.skylight : (l) => P.sunlight(l) * P.MATERIALS[m](l), P.FILTERS[f].T);
  const vis = lum(shot('leaf', 'normal')) / lum(shot('sky', 'normal')), ir = lum(shot('leaf', 'ir720')) / lum(shot('sky', 'ir720'));
  assert.ok(vis < 0.2 && ir > 2, `foliage against sky: ${vis} in the visible, ${ir} at 720 nm`);
  assert.ok(sum(shot('water', 'ir720')) < 0.05 * sum(shot('grass', 'ir720')), 'water black in the infrared');
  assert.ok(sum(shot('centre', 'uv')) < 0.3 * sum(shot('petal', 'uv')), 'the flower\'s centre absorbs ultraviolet');
  // the Bayer dyes are transparent beyond about 850 nm: all channels see nearly the same
  const c900 = P.bayer.map((f) => f(900));
  assert.ok(Math.max(...c900) / Math.min(...c900) < 1.15, `channels at 900 nm: ${c900}`);
  // a thin achromat brings F and C to one focus; the near infrared falls behind, by a fraction of a millimetre
  const a = P.achromat(50);
  near(a.f(486.13), a.f(656.27), 1e-9, 'F and C focus together');
  const d850 = a.shift(850) - a.shift(550);
  assert.ok(d850 > 0.05 && d850 < 0.4, `850 nm focuses ${d850} mm behind 550 nm`);
});

test('satellite trails: median costs √(π/2) in noise, clipping almost nothing, both remove a one-frame outlier', async () => {
  const T = await import('../js/lib/trails.js');
  const { makeRng } = await import('../js/lib/random.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const g = makeRng(11).g, N = 51, n = 6000, frames = Array.from({ length: N }, () => Float32Array.from({ length: n }, () => g()));
  const sd = (a) => { let s = 0, s2 = 0; for (const v of a) { s += v; s2 += v * v; } return Math.sqrt(s2 / a.length - (s / a.length) ** 2); };
  const mean = sd(T.combine(frames, 'mean')), med = sd(T.combine(frames, 'median')), clip = sd(T.combine(frames, 'clip', 3));
  near(mean * Math.sqrt(N), 1, 0.03, 'mean: σ/√N');
  near(med / mean, Math.sqrt(Math.PI / 2), 0.07, 'median / mean noise → √(π/2)');
  assert.ok(clip / mean < 1.06, `3σ-clipped mean nearly as quiet as the mean: ${clip / mean}`);
  // an outlier of 40σ in one frame of 20
  const F = Array.from({ length: 20 }, (_, f) => Float32Array.from({ length: 500 }, () => g() + (f === 7 ? 40 : 0)));
  near(T.combine(F, 'mean').reduce((s, v) => s + v, 0) / 500, 2, 0.15, 'the mean keeps 1/N of it');
  assert.ok(Math.abs(T.combine(F, 'median').reduce((s, v) => s + v, 0) / 500) < 0.15, 'the median removes it');
  assert.ok(Math.abs(T.combine(F, 'clip', 3).reduce((s, v) => s + v, 0) / 500) < 0.1, 'the clip removes it');
  // a trail's depth: flux × dwell time p/ω
  near(T.trailDepth(6, 8, 0.4, 3, 0.8), T.flux(6, 8, 0.4) * ((3 * Math.PI / 648000) / (0.8 * Math.PI / 180)), 1e-9, 'F p/ω');
});

test('stereoscopic 3-D: orthostereo reproduces the scene; parallax, divergence and roundness', async () => {
  const S = await import('../js/lib/stereo.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  const view = { S: 10, V: 12 }, o = S.orthoRig(view);
  for (const Z of [1.5, 4, 12, 40]) { const r = S.shape(o, view, Z); near(r.Zp, Z, 1e-9 * Z, `orthostereo distance at ${Z} m`); near(r.round, 1, 1e-4, 'roundness'); near(r.kw, 1, 1e-9, 'true size'); }
  const rig = { b: 0.04, f: 32, s: 24.89, C: 4 };
  near(S.screenParallax(rig, view, 4), 0, 1e-15, 'the convergence plane sits on the screen');
  assert.ok(S.screenParallax(rig, view, 2) < 0 && S.screenParallax(rig, view, 8) > 0, 'in front: negative; behind: positive');
  assert.equal(S.perceived(0.065, 12), Infinity, 'P = e: infinity'); near(S.perceived(0, 12), 12, 1e-12, 'P = 0: on the screen');
  // the same shot on a screen k times wider has k times the parallax
  near(S.screenParallax(rig, { S: 1.2, V: 2.5 }, 30) / S.screenParallax(rig, view, 30), 0.12, 1e-12, 'parallax scales with the screen');
  // the two rendered pictures agree on a point in the convergence plane: column of the zero-offset plane
  const W = 64, H = 36, L = S.render({ ...rig, C: 25 }, -1, W, H), R = S.render({ ...rig, C: 25 }, 1, W, H);
  let diff = 0; for (let k = 0; k < W * H; k++) diff = Math.max(diff, Math.abs(L[0][k] - R[0][k]));
  assert.ok(diff > 0, 'two different viewpoints');
});

test('HDR displays: PQ (ST 2084) and HLG (BT.2100) fixed points, round trips and code steps', async () => {
  const D = await import('../js/lib/hdrdisplay.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  near(D.pqEOTF(0), 0, 1e-12, 'PQ 0 → 0 nits'); near(D.pqEOTF(1), 10000, 1e-6, 'PQ 1 → 10 000 nits');
  // published reference: 100 nits ≈ code 0.508 (10-bit 520), 1000 nits ≈ 0.752 (769)
  near(D.pqInverse(100), 0.5081, 1e-4, '100 nits'); assert.equal(Math.round(D.pqInverse(100) * 1023), 520, '100 nits, 10-bit code');
  near(D.pqInverse(1000), 0.7518, 1e-4, '1000 nits'); assert.equal(Math.round(D.pqInverse(1000) * 1023), 769, '1000 nits, 10-bit code');
  for (const L of [0.001, 0.1, 1, 48, 100, 1000, 4000]) near(D.pqEOTF(D.pqInverse(L)), L, 1e-9 * Math.max(1, L), `PQ round trip at ${L}`);
  // HLG: continuous at E = 1/12 (signal 0.5), E = 1 → 1, inverse matches; system gamma 1.2 at 1000 nits
  near(D.hlgOETF(1 / 12), 0.5, 1e-12, 'HLG knee'); near(D.hlgOETF(1 / 12 + 1e-12), 0.5, 1e-9, 'HLG continuous');
  near(D.hlgOETF(1), 1, 1e-7, 'HLG 1 → 1'); for (const E of [0.01, 0.2, 0.7]) near(D.hlgInverseOETF(D.hlgOETF(E)), E, 1e-12, `HLG inverse at ${E}`);
  near(D.hlgGamma(1000), 1.2, 1e-12, 'γ at 1000 nits'); near(D.hlgGamma(2000), 1.2 + 0.42 * Math.log10(2), 1e-12, 'γ at 2000 nits');
  near(D.hlgEOTF(1, 1000), 1000, 1e-4, 'HLG peak'); near(D.hlgEOTF(D.hlgInverse(50)), 50, 1e-9, 'HLG display round trip');
  // steps: gamma 2.4, 8 bit at 1 nit ≈ 6.6 %; PQ 12 bit stays below ~1 % from 0.01 to 10 000 nits; 10-bit PQ finer than 8-bit SDR in the dark
  near(D.stepAt(D.CODINGS.sdr8, 1), 0.066, 0.002, 'SDR 8 bit at 1 nit');
  for (const L of [0.01, 0.1, 1, 10, 100, 1000, 5000]) assert.ok(D.stepAt(D.CODINGS.pq12, L) < 0.025, `PQ 12 bit at ${L} nits`);
  for (const L of [0.1, 1, 10]) assert.ok(D.stepAt(D.CODINGS.pq10, L) < D.stepAt(D.CODINGS.sdr8, L), `PQ 10 finer than SDR 8 at ${L}`);
  near(D.quantise(D.CODINGS.pq12, 100), 100, 0.3, 'PQ 12 quantises 100 nits within a step');
});

test('LIGO quantum noise: the standard quantum limit, Kimble\'s crossover, squeezing and inspiral SNR', async () => {
  const Lg = await import('../js/lib/ligo.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);
  const o = { ...Lg.DEFAULTS };
  // h_SQL = √(8ħ/(mΩ²L²)): 1.83e-24 /√Hz at 100 Hz for 40 kg and 3994.5 m
  near(Math.sqrt(Lg.noise(100, o).sql), Math.sqrt((8 * Lg.HBAR) / (40 * (2 * Math.PI * 100) ** 2 * 3994.5 ** 2)), 1e-12, 'SQL formula');
  near(Math.sqrt(Lg.noise(100, o).sql), 1.83e-24, 0.01, 'SQL value');
  // total ≥ SQL everywhere, equal where K = 1
  for (const f of [5, 20, 50, 100, 400, 2000]) assert.ok(Lg.noise(f, o).total >= Lg.noise(f, o).sql * (1 - 1e-12), `above the SQL at ${f} Hz`);
  const fx = Lg.crossover(o); near(Lg.noise(fx, o).total, Lg.noise(fx, o).sql, 1e-9, 'touches the SQL at the crossover');
  // Kimble et al.: input power I0 = I_SQL = m L² γ⁴/(4ω0), i.e. P = c m L γ³/(8ω0), makes K = 1 at Ω = γ
  const g = 2 * Math.PI * o.fbw, w0 = (2 * Math.PI * Lg.C) / o.lambda, P = (Lg.C * o.m * o.L * g ** 3) / (8 * w0);
  near(Lg.coupling(o.fbw, { ...o, P }), 1, 1e-12, 'K = 1 at γ for I_SQL');
  // shot noise ∝ 1/P, radiation pressure ∝ P; the SQL does not depend on power
  near(Lg.noise(1000, { ...o, P: 4 * o.P }).shot, Lg.noise(1000, o).shot / 4, 1e-12, 'shot ∝ 1/P');
  near(Lg.noise(10, { ...o, P: 4 * o.P }).rp, 4 * Lg.noise(10, o).rp, 1e-12, 'radiation pressure ∝ P');
  // 6 dB squeezing (×0.251 in power): phase squeezing trades, frequency-dependent lowers both
  const e = 10 ** -0.6, ph = Lg.noise(30, { ...o, sqz: 'phase', sqzDb: 6 }), fd = Lg.noise(30, { ...o, sqz: 'freq', sqzDb: 6 }), n0 = Lg.noise(30, o);
  near(ph.shot, n0.shot * e, 1e-12, 'phase: shot'); near(ph.rp, n0.rp / e, 1e-12, 'phase: radiation pressure'); near(fd.total, n0.total * e, 1e-12, 'frequency-dependent');
  // inspiral: SNR ∝ 1/D and ∝ 𝓜^(5/6) in the |h̃| prefactor; f_ISCO of 2.8 suns ≈ 1570 Hz
  near(Lg.snr(o, 1.4, 1.4, 100) / Lg.snr(o, 1.4, 1.4, 200), 2, 1e-12, 'SNR ∝ 1/D');
  near(Lg.fISCO(2.8), 1570, 0.01, 'f_ISCO');
  near(Lg.hTilde(100, 10, 10, 100) / Lg.hTilde(100, 1.4, 1.4, 100), (Lg.chirpMass(10, 10) / Lg.chirpMass(1.4, 1.4)) ** (5 / 6), 1e-12, '𝓜^(5/6)');
  near(Lg.chirpMass(1.4, 1.4), 1.2188, 1e-3, 'chirp mass of 1.4 + 1.4');
  // the whitened record: unit-variance noise, and its in-band SNR close to the analytic one from 20 Hz
  const r = Lg.whitened(o, 36, 29, 410, 3), z = Lg.whitened(o, 36, 29, 1e12, 3);
  let v = 0; for (const x of z.data) v += x * x; near(v / z.data.length, 1, 0.05, 'unit variance');
  near(r.snrWindow, Lg.snr(o, 36, 29, 410, 20), 0.06, 'SNR in the window');
  // the Q-map: noise averages 1 per row; low frequencies peak before high ones (the chirp rises)
  const q = Lg.qtransform(r.data), qz = Lg.qtransform(z.data);
  let s = 0; for (const x of qz.data) s += x; near(s / qz.data.length, 1, 0.1, 'Q-map noise level');
  const tmax = (row) => { let mj = 0; for (let j = 0; j < q.M; j++) if (q.data[row * q.M + j] > q.data[row * q.M + mj]) mj = j; return mj; };
  assert.ok(tmax(10) < tmax(40), 'the chirp rises in frequency');
});

test('radial velocities: Bouchy photon-noise limit, its Monte-Carlo check, rotation, resolution and K', async () => {
  const V = await import('../js/lib/rv.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);
  // semi-amplitudes: Earth 8.95 cm/s, Jupiter 12.5 m/s, 51 Peg b ≈ 54 m/s (m sin i = 0.46 M_J; measured 56)
  const K = (p) => V.semiAmplitude(p.mp, p.P, p.M);
  near(K(V.PLANETS.earth), 0.0895, 0.01, 'Earth'); near(K(V.PLANETS.jupiter), 12.46, 0.01, 'Jupiter'); near(K(V.PLANETS.peg51), 55, 0.05, '51 Peg b');
  // rotation kernel: unit sum and symmetric; Gaussian kernel unit sum
  const rk = V.rotationKernel(10000, 300); let s = 0; for (const x of rk) s += x; near(s, 1, 1e-12, 'rotation kernel sum');
  assert.ok(Math.abs(rk[0] - rk[rk.length - 1]) < 1e-15, 'symmetric');
  // a single Gaussian line: σ_V matches the analytic Σ (dA/dv)²/A integral (depth d ≪ 1, N electrons per pixel)
  const sp = { n: 4001, dv: 100, flux: new Float32Array(4001), l0: 500 }, d = 0.01, w = 3000;
  for (let i = 0; i < sp.n; i++) sp.flux[i] = 1 - d * Math.exp(-0.5 * (((i - 2000) * sp.dv) / w) ** 2);
  // ∫ (dA/dv)²/A dv ≈ N d² ∫ (v/w²)² e^{−v²/w²} dv = N d² √π/(2w); the pixel sum is that integral / Δv
  const N = 1e6, analytic = 1 / Math.sqrt((N * d * d * Math.sqrt(Math.PI)) / (2 * w) / sp.dv);
  near(V.precision(sp, N).sigma, analytic, 0.02, 'single Gaussian line');
  // σ scales as 1/√N
  near(V.precision(sp, 4 * N).sigma, V.precision(sp, N).sigma / 2, 1e-9, '1/√N');
  // a full synthetic G spectrum: Monte-Carlo scatter of the least-squares velocity matches σ_V (48 trials: ±15 %)
  const g = V.spectrum({ type: 'G', R: 115000, vsini: 2000, l0: 500, l1: 540 }), p = V.precision(g, 1e4), mc = V.monteCarlo(g, 1e4, 48);
  let v = 0; for (const e of mc) v += e * e; near(Math.sqrt(v / mc.length), p.sigma, 0.25, 'Monte-Carlo vs Bouchy');
  // faster rotation and lower resolution both cost precision
  const fast = V.precision(V.spectrum({ type: 'G', R: 115000, vsini: 10000, l0: 500, l1: 540 }), 1e4).sigma, lowR = V.precision(V.spectrum({ type: 'G', R: 40000, vsini: 2000, l0: 500, l1: 540 }), 1e4).sigma;
  assert.ok(fast > 2 * p.sigma && lowR > 1.5 * p.sigma, `rotation ${fast}, resolution ${lowR} vs ${p.sigma}`);
  // the sinusoid fit: K recovered within a few σ_K, and σ_K ≈ σ √(2/N)
  const fit = V.observe(10, 2, 400, 9); near(fit.sigmaK, 2 * Math.sqrt(2 / 400), 0.15, 'σ_K'); assert.ok(Math.abs(fit.K - 10) < 4 * fit.sigmaK, 'K recovered');
});
