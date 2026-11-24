// Real-ray field maps: exact traces through Hubble's mirrors and a three-mirror anastigmat,
// checked against third-order nodal aberration theory and against the scaling laws of the
// fifth-order aberrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, aimRay, paraxial } from '../js/lib/raytrace.js';
import { prepare, pupilFit, wavefrontAt, fieldMap, astigOf, J } from '../js/lib/fieldtrace.js';
import { twoMirror, conics, seidelTwoMirror, fieldPoly, astigNodes, THREF } from '../js/lib/fieldpsf.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const P = pupilFit(20);
const HST = twoMirror({ D: 2.4, N: 24, N1: 2.3, b: 1.5 }), RC = conics(HST, 'rc');
const DEG = (THREF * 180) / Math.PI; // the reference field angle of fieldpsf.js, in degrees
// Zernike coefficients (nm) of the third-order polynomial: Z5 = 2M_xy/(2√6), Z6 = (M_xx − M_yy)/(2√6),
// Z7 = b_y/(3√8), Z8 = b_x/(3√8), Z11 = a/(6√5)
function nat(err, H) {
  const sd = seidelTwoMirror(HST, RC.K1 + (err.dK || 0), RC.K2, err.dz || 0), p = fieldPoly(sd, [H[0] / DEG, H[1] / DEG], err);
  const s6 = 2 * Math.sqrt(6), s8 = 3 * Math.sqrt(8);
  return [(2 * p.M[1]) / s6, (p.M[0] - p.M[2]) / s6, p.b[1] / s8, p.b[0] / s8, p.a / (6 * Math.sqrt(5))].map((v) => v * 1e9);
}

test('aiming at a two-angle field point reduces to the meridional one', () => {
  const L = LENSES.cooke;
  const a = aimRay(L, 587.56, 10, 0.3, -0.5), b = aimRay(L, 587.56, [0, 10], 0.3, -0.5);
  assert.deepEqual(a, b);
  // a field point along +x gives the mirror image of one along +y
  const c = aimRay(L, 587.56, [10, 0], -0.5, 0.3);
  near(c.p[0], b.p[1], 1e-9, 'x launch'); near(c.p[1], b.p[0], 1e-9, 'y launch'); near(c.d[0], b.d[1], 1e-15, 'direction');
});

test("Hubble's traced astigmatism, coma of a moved secondary and the 1990 spherical aberration match third-order theory", () => {
  const cases = [
    [{}, [0.02, 0], 1, 'astigmatism (+x)'], [{}, [0, 0.02], 1, 'astigmatism (+y)'], [{}, [0.0141, 0.0141], 0, 'astigmatism (diagonal)'],
    [{ dx: 100e-6 }, [0, 0], 3, 'coma, decentre'], [{ tx: 30 / 206265 }, [0, 0], 2, 'coma, tilt'], [{ ty: 30 / 206265 }, [0, 0], 3, 'coma, tilt about y'],
    [{ dK: -0.0116 }, [0, 0], 4, 'spherical, Hubble 1990'],
  ];
  for (const [err, H, i, msg] of cases) {
    const f = wavefrontAt(prepare('hubble', err), H, P).z, tr = [f[4], f[5], f[6], f[7], f[10]], th = nat(err, H);
    // the traced prescription and the first-order model differ by about 1 %
    near(tr[i] / th[i], 1, 0.03, msg);
  }
});

test('a decentred secondary splits the astigmatism around the nodes of nodal aberration theory', () => {
  const m = fieldMap({ id: 'hubble', err: { dx: 100e-6 }, field: 4 / 60, G: 9, curved: true });
  assert.ok(m.zeros.r2 > 0.999, `quadratic share ${m.zeros.r2}`);
  const th = astigNodes(seidelTwoMirror(HST, RC.K1, RC.K2), { dx: 100e-6 }).map((n) => n.map((v) => v * DEG)).sort((a, b) => a[1] - b[1]);
  const tr = m.zeros.roots.slice().sort((a, b) => a[1] - b[1]);
  assert.ok(Math.abs(th[0][1]) > 5e-4, 'the nodes are split');
  for (let k = 0; k < 2; k++) { near(tr[k][0], th[k][0], 2e-4, `node ${k} x (deg)`); near(tr[k][1], th[k][1], 2e-4, `node ${k} y (deg)`); }
});

test('astigmatism turns at twice the rate of the field point, and the fit holds the whole wavefront', () => {
  const sys = prepare('hubble'), phi = Math.PI / 6, h = 0.03;
  const a = astigOf(wavefrontAt(sys, [h, 0], P).z), b = astigOf(wavefrontAt(sys, [h * Math.cos(phi), h * Math.sin(phi)], P).z);
  near(Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]), 2 * phi, 1e-3, 'orientation');
  near(Math.hypot(...b) / Math.hypot(...a), 1, 1e-3, 'amplitude');
  // the RMS left after piston and tilt equals the root-sum-square of the other 25 terms
  for (const id of ['hubble', 'tma']) {
    const f = wavefrontAt(prepare(id), [0.1, 0.05], P);
    let s = 0;
    for (let j = 3; j < J; j++) s += f.z[j] ** 2;
    near(Math.sqrt(s) / f.rms, 1, 0.01, `${id}: Zernike sum vs RMS`);
  }
});

test('the three-mirror anastigmat has no third-order field aberrations: coma grows as H³ and astigmatism as H⁴', () => {
  const sys = prepare('tma'), m = (h, a, b) => Math.hypot(...[a, b].map((j) => wavefrontAt(sys, [h, 0], P).z[j]));
  const slope = (a, b) => Math.log(m(0.3, a, b) / m(0.15, a, b)) / Math.log(2);
  near(slope(6, 7), 3, 0.25, 'coma exponent');
  near(slope(4, 5), 4.3, 0.3, 'astigmatism exponent');
  // on the axis the design is perfect to a few nanometres
  assert.ok(wavefrontAt(sys, [0, 0], P).rms < 2, 'on-axis RMS (nm)');
  // the Hubble RC, by contrast: third-order astigmatism, ∝ H²
  const hs = prepare('hubble'), a = (h) => Math.hypot(...astigOf(wavefrontAt(hs, [h, 0], P).z));
  near(Math.log(a(0.04) / a(0.02)) / Math.log(2), 2, 0.02, 'RC astigmatism exponent');
});

test('fifth-order aperture laws in the three-mirror anastigmat: secondary astigmatism ∝ D⁴, secondary coma ∝ D⁵', () => {
  const full = prepare('tma'), half = prepare('tma');
  half.lens = { ...half.lens, epd: half.lens.epd / 2 };
  half.par = paraxial(half.lens, 587.56);
  const a = wavefrontAt(full, [0.2, 0], P).z, b = wavefrontAt(half, [0.2, 0], P).z, m = (z, i, j) => Math.hypot(z[i], z[j]);
  near(m(a, 11, 12) / m(b, 11, 12), 16, 0.5, 'Z12–13 ratio');
  near(m(a, 15, 16) / m(b, 15, 16), 32, 1, 'Z16–17 ratio');
});
