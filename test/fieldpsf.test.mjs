// Field-dependent PSF: Seidel sums of two-mirror telescopes, nodal aberrations, Hubble's flaw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoMirror, conics, seidelTwoMirror, sum, fieldPoly, rmsPoly, astigNodes, fieldPSFs, THREF } from '../js/lib/fieldpsf.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const HST = twoMirror({ D: 2.4, N: 24, N1: 2.3, b: 1.5 });

test("Schroeder's Ritchey–Chrétien conics cancel S_I and S_II and reproduce Hubble's design", () => {
  const c = conics(HST, 'rc'), sd = seidelTwoMirror(HST, c.K1, c.K2);
  near(sum(sd, 'SI') / sum(seidelTwoMirror(HST, -1, 0), 'SI'), 0, 1e-9, 'S_I relative');
  near(sum(sd, 'SII') / sum(seidelTwoMirror(HST, ...Object.values(conics(HST, 'cassegrain'))), 'SII'), 0, 1e-9, 'S_II relative');
  near(c.K1, -1.0023, 0.0002, 'K₁'); near(c.K2, -1.496, 0.003, 'K₂');
  near(-HST.D / 2 / sd.uImage, 57.6, 1e-9, 'focal length (m)');
});

test('a classical Cassegrain has the coma of a paraboloid of the same focal length', () => {
  const c = conics(HST, 'cassegrain'), sd = seidelTwoMirror(HST, c.K1, c.K2), y = 1.2, ub = Math.tan(THREF);
  near(sum(sd, 'SI'), 0, 1e-15, 'S_I');
  near(sum(sd, 'SII') / (-(y ** 3) * ub / (2 * 57.6 ** 2)), 1, 1e-9, 'S_II / paraboloid');
});

test('Petzval sum of two mirrors and the despace focus sensitivity m² + 1', () => {
  const c = conics(HST, 'rc'), sd = seidelTwoMirror(HST, c.K1, c.K2);
  near(sum(sd, 'SIV') / (2 * sd.H ** 2 * (1 / HST.R1 - 1 / HST.R2)), 1, 1e-12, 'S_IV');
  const dz = 1e-5, W = seidelTwoMirror(HST, c.K1, c.K2, dz).W020;
  near(W / (((HST.m ** 2 + 1) * dz) / (8 * 24 * 24)), 1, 2e-3, 'W₀₂₀ vs (m² + 1)Δz/8N²');
});

test("Hubble's primary: K = −1.0139 is 2.2 µm too flat at the edge, W₀₄₀ = twice that", () => {
  const dK = -1.0139 + 1.0023, R = 2 * HST.f1, sag = (Math.abs(dK) * 1.2 ** 4) / (8 * R ** 3);
  near(sag * 1e6, 2.2, 0.1, 'edge sag error (µm)');
  const c = conics(HST, 'rc'), W040 = (sum(seidelTwoMirror(HST, c.K1 + dK, c.K2), 'SI') - sum(seidelTwoMirror(HST, c.K1, c.K2), 'SI')) / 8;
  near(Math.abs(W040) / (2 * sag), 1, 1e-6, 'W₀₄₀ / 2 × sag');
  // RMS of ρ⁴ balanced by defocus over an unobstructed pupil: W₀₄₀ / (6√5)
  const P = { a: W040, b: [0, 0], M: [-W040, 0, -W040] };
  near(rmsPoly(P, 0, 200, 8) / (Math.abs(W040) / (6 * Math.sqrt(5))), 1, 2e-3, 'balanced RMS');
});

test('nodal aberrations: a decentred RC secondary gives constant coma and two astigmatic nodes', () => {
  const c = conics(HST, 'rc'), sd = seidelTwoMirror(HST, c.K1, c.K2), mis = { dx: 50e-6 };
  const b0 = fieldPoly(sd, [0, 0], mis).b, b1 = fieldPoly(sd, [0.7, -0.4], mis).b;
  assert.ok(Math.hypot(...b0) > 1e-9, 'decentre produces coma');
  near(Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) / Math.hypot(...b0), 0, 1e-9, 'coma is field-constant');
  for (const n of astigNodes(sd)) near(Math.hypot(...n), 0, 1e-9, 'aligned: both nodes on axis');
  const [n1, n2] = astigNodes(sd, mis);
  assert.ok(Math.hypot(n1[0] - n2[0], n1[1] - n2[1]) > 1e-3, 'binodal');
  near(n1[0], n2[0], 1e-9, 'nodes mirror-symmetric about the decentre direction'); near(n1[1], -n2[1], 1e-9, 'symmetric in y');
});

test('FFT Strehl matches the Maréchal approximation for a small field-dependent aberration', () => {
  const c = conics(HST, 'rc');
  const r = fieldPSFs({ tel: HST, K1: c.K1, K2: c.K2, dz: 0, mis: {}, field: (2 / 60) * (Math.PI / 180), grid: 3, lam: 0.6e-6, eps: 0.33, spiders: 4, n: 128, Dpx: 48, crop: 64, curved: false });
  near(r.pts[4].strehl, 1, 1e-6, 'on axis');
  const p = r.pts[5], phi = (2 * Math.PI * p.rms) / 0.6e-6, mar = Math.exp(-phi * phi);
  assert.ok(mar > 0.7 && mar < 0.95, `test point in the Maréchal range (${mar})`);
  near(p.strehl / mar, 1, 0.03, 'Strehl / Maréchal');
});
