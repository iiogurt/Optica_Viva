// Mirrors in the sequential ray tracer (negative-index convention), checked against the Hubble
// Space Telescope's published design and the 1990 primary-mirror flaw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, paraxial, seidel, surfaceSag, aimRay, trace, toPlane, mediaIndices } from '../js/lib/raytrace.js';
import { parseZmx, validateLens } from '../js/lib/lensio.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e} ± ${tol}`);
const withK = (L, k1, k2) => ({ ...L, surfaces: [{ ...L.surfaces[0], k: k1 }, { ...L.surfaces[1], k: k2 }] });

test('Hubble first-order data: f = 57.6 m (f/24), focus 1.5 m behind the primary', () => {
  const p = paraxial(LENSES.hubble);
  near(p.efl / 1000, 57.6, 0.01, 'EFL (m)');
  near(p.efl / LENSES.hubble.epd, 24, 0.01, 'f-number');
  near(p.zImage, 1500, 0.5, 'image 1500 mm behind the primary vertex');
  assert.deepEqual(mediaIndices(LENSES.hubble, 550), [-1, 1], 'index changes sign at each mirror');
});

test('Seidel: solving for zero spherical aberration and coma gives Hubble\'s conic constants', () => {
  const H = LENSES.hubble, S = (k1, k2) => seidel(withK(H, k1, k2)).total;
  const s0 = S(0, 0), s1 = S(1, 0), s2 = S(0, 1);
  const a = [[s1.SI - s0.SI, s2.SI - s0.SI], [s1.SII - s0.SII, s2.SII - s0.SII]], det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
  const k1 = (-s0.SI * a[1][1] + s0.SII * a[0][1]) / det, k2 = (-s0.SII * a[0][0] + s0.SI * a[1][0]) / det;
  near(k1, -1.0022985, 1e-6, 'primary conic');
  near(k2, -1.4963, 0.001, 'secondary conic');
  // the classical Cassegrain keeps zero spherical aberration but has coma
  const c = seidel(LENSES.cassegrain).total, rc = seidel(H).total;
  near(c.SI / s0.SI, 0, 1e-4, 'Cassegrain SI');
  assert.ok(Math.abs(c.SII) > 20 * Math.abs(rc.SII), 'Cassegrain coma ≫ Ritchey–Chrétien coma (residual from the rounded published conic)');
});

test('the 1990 flaw: edge 2.2 µm too low, and an on-axis image ruined by spherical aberration', () => {
  const dz = surfaceSag({ R: -11040, k: -1.0139 }, 1200) - surfaceSag({ R: -11040, k: -1.0022985 }, 1200);
  near(dz * 1000, 2.2, 0.1, 'edge sag difference (µm)');
  // where the marginal ray crosses the axis, relative to the paraxial focus (longitudinal aberration)
  const marginal = (L) => {
    const p = paraxial(L), a = aimRay(L, 550, 0, 0, 1, p), r = trace(L, 550, a.p, a.d, { zv: p.zv });
    return -toPlane(r, p.zImage)[1] / (r.d[1] / r.d[2]);
  };
  assert.ok(Math.abs(marginal(LENSES.hubble)) < 0.5, 'as designed: marginal focus within 0.5 mm of the paraxial focus');
  assert.ok(Math.abs(marginal(LENSES['hubble-1990'])) > 30, 'flawed: edge and centre foci tens of millimetres apart');
});

test('mirrors: exact reflection agrees with the paraxial focus of a spherical mirror', () => {
  // concave sphere R = −200: paraxial focus at z = −100; a small-aperture ray lands there
  const L = { epd: 2, field: 0, surfaces: [{ R: -200, t: -100, glass: 'mirror', stop: true }] }, p = paraxial(L);
  near(p.efl, 100, 1e-9, 'f = R/2');
  near(p.zImage, -100, 1e-9, 'image in front of the mirror');
  const a = aimRay(L, 550, 0, 0, 1, p), r = trace(L, 550, a.p, a.d, { zv: p.zv });
  assert.ok(r.d[2] < 0, 'reflected ray travels toward −z');
  near(toPlane(r, -100)[1], 0, 1e-4, 'lands on the axis at the focus (residual: the sphere\'s tiny spherical aberration)');
});

test('Zemax MIRROR surfaces import as mirrors, and validation accepts negative distances after them', () => {
  const zmx = 'ENPD 100\nSURF 0\nDISZ INFINITY\nSURF 1\nSTOP\nCURV -0.001\nDISZ -400\nGLAS MIRROR\nSURF 2\nCURV -0.002\nDISZ 600\nGLAS MIRROR\nSURF 3\n';
  const { lens } = parseZmx(zmx);
  assert.equal(lens.surfaces[0].glass, 'mirror');
  assert.deepEqual(validateLens(lens), []);
  assert.ok(validateLens({ ...lens, surfaces: [{ ...lens.surfaces[0], t: 400 }, lens.surfaces[1]] }).length, 'positive distance after one mirror is rejected');
});
