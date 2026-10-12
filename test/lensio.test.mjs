// Lens import/export: Zemax subset, JSON round trip, model glasses, URL encoding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseZmx, lensToJSON, lensFromJSON, validateLens, encodeLens, decodeLens, resolveGlass } from '../js/lib/lensio.js';
import { LENSES, paraxial, aimRay, trace, toPlane } from '../js/lib/raytrace.js';
import { abbe, index } from '../js/lib/glass.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: got ${a}, expected ${e} ± ${tol}`);
const fixture = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

test('Zemax .zmx import reproduces the Cooke triplet', () => {
  const { lens, warnings } = parseZmx(fixture('cooke.zmx'));
  assert.equal(lens.surfaces.length, 6);
  assert.equal(lens.epd, 10);
  assert.equal(lens.field, 20);
  assert.ok(lens.surfaces[3].stop, 'surface 4 is the stop');
  assert.deepEqual(warnings, []);
  near(paraxial(lens).efl, paraxial(LENSES.cooke).efl, 1e-3, 'EFL matches the built-in prescription');
});

test('EVENASPH + CONI import gives an SA-free hyperbolic singlet', () => {
  const { lens } = parseZmx(fixture('hyperbolic.zmx'));
  assert.equal(lens.surfaces[0].glass, 'N-BK7', 'BK7 alias resolved');
  assert.equal(lens.surfaces[1].k, -2.30068);
  const p = paraxial(lens);
  for (const py of [0.5, 1]) {
    const a = aimRay(lens, 587.56, 0, 0, py, p), r = trace(lens, 587.56, a.p, a.d, { clip: false, zv: p.zv });
    near(toPlane(r, p.zImage)[1] * 1000, 0, 0.01, `transverse error (µm) at pupil ${py}`);
  }
});

test('JSON and URL encodings round-trip every built-in lens', () => {
  for (const L of Object.values(LENSES)) {
    const back = lensFromJSON(lensToJSON(L));
    near(paraxial(back).efl, paraxial(L).efl, 1e-6, `${L.name} via JSON`);
    near(paraxial(decodeLens(encodeLens(L))).efl, paraxial(L).efl, 1e-6, `${L.name} via URL`);
    assert.deepEqual(validateLens(back), [], `${L.name} is valid`);
  }
});

test('unknown glasses become (n_d, V_d) model glasses that keep both numbers', () => {
  const { glass, warning } = resolveGlass('S-LAH66', 1.7725, 49.6);
  assert.ok(warning);
  near(index(glass, 587.56), 1.7725, 1e-9, 'model n_d');
  near(abbe(glass), 49.6, 1e-9, 'model V_d');
});

test('validation catches broken prescriptions', () => {
  const errs = validateLens({ epd: 10, surfaces: [{ R: 0, t: -1, glass: 'Unobtainium' }, { R: 50, t: 10, glass: 'air' }] });
  assert.ok(errs.length >= 4, errs.join('; '));
});

test('every glass used by a built-in lens exists in the catalogue (editor menus must offer it)', async () => {
  const { GLASSES } = await import('../js/lib/glass.js');
  for (const L of Object.values(LENSES)) for (const s of L.surfaces) {
    if (typeof s.glass === 'string' && s.glass !== 'air') assert.ok(GLASSES[s.glass], `${L.name}: ${s.glass}`);
  }
});
