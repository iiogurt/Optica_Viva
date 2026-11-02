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
  const { glass, warning } = resolveGlass('ACME-LAK1', 1.7725, 49.6); // S-LAH66 is in the catalogue now
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
    if (typeof s.glass === 'string' && s.glass !== 'air' && s.glass !== 'mirror') assert.ok(GLASSES[s.glass], `${L.name}: ${s.glass}`);
  }
});

test('clear semi-diameters: Zemax DIAM import, JSON round trip, and vignetting of the PSF pupil', async () => {
  const { lens } = parseZmx(readFileSync(new URL('./fixtures/cooke.zmx', import.meta.url), 'utf8'));
  assert.equal(lens.surfaces[0].sd, 10, 'DIAM 10 → semi-diameter 10');
  assert.equal(lensFromJSON(lensToJSON(lens)).surfaces[0].sd, 10, 'JSON keeps sd');
  const { TASKS } = await import('../js/lib/tasks.js');
  const { autoSemiDiameters } = await import('../js/lib/raytrace.js');
  const L = { ...LENSES['double-gauss'] }, p = paraxial(L), sd = autoSemiDiameters(L);
  const tight = sd.map((v, i) => (i === 0 || i === 10 ? v * 0.8 : v));
  const run = (s, th) => TASKS.lensPSF({ lens: L, sd: s, theta: th, zImg: p.zImage, N: p.efl / L.epd }).result;
  assert.equal(run(sd, 14).transmitted, 1, 'designed apertures pass the full field');
  assert.equal(run(tight, 0).transmitted, 1, 'tight rims leave the axial beam alone');
  const v = run(tight, 14).transmitted;
  assert.ok(v > 0.5 && v < 0.85, `tight rims vignette the 14° beam (${v})`);
});

// Untrusted prescriptions (#192): files and shared links go through one parser and validator.
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const has = (errs, re, msg) => assert.ok(errs.some((e) => re.test(e)), `${msg}: ${errs.join('; ')}`);

test('validation rejects non-finite, huge and physically impossible values from files and links', () => {
  const evil = { epd: 1e300, field: 1e300, surfaces: [{ R: 50, t: 1e300, glass: { nd: -1, vd: 0 }, stop: true }, { R: -50, t: 1, glass: 'air', a: ['bad'] }] };
  for (const [how, lens] of [['JSON', lensFromJSON(JSON.stringify(evil))], ['link', decodeLens(enc(evil))]]) {
    const errs = validateLens(lens);
    has(errs, /entrance-pupil/, `${how}: pupil`);
    has(errs, /maximum field/, `${how}: field`);
    has(errs, /surface 1: thickness/, `${how}: thickness`);
    has(errs, /surface 1: a model glass needs a name/, `${how}: model-glass name`);
    has(errs, /surface 1: model glass n_d/, `${how}: n_d`);
    has(errs, /surface 1: model glass V_d/, `${how}: V_d`);
    has(errs, /surface 2: aspheric/, `${how}: aspheric terms`);
  }
  const base = () => ({ epd: 10, field: 5, surfaces: [{ R: 50, t: 4, glass: 'N-BK7', stop: true }, { R: -50, t: 90, glass: 'air' }] });
  const bad = (edit, re) => { const L = base(); edit(L); has(validateLens(L), re, String(re)); };
  bad((L) => (L.surfaces[0].R = NaN), /radius/);
  bad((L) => (L.surfaces[0].R = 0), /radius/);
  bad((L) => (L.surfaces[1].t = Infinity), /thickness/);
  bad((L) => (L.surfaces[0].glass = 42), /glass must be a name/);
  bad((L) => (L.surfaces[0].glass = null), /glass must be a name/);
  bad((L) => (L.surfaces[0].sd = -1), /semi-diameter/);
  bad((L) => (L.surfaces[0].k = Infinity), /conic/);
  bad((L) => (L.surfaces[0].a = [0, 0, 0, 0, 1e-9]), /aspheric/);
  bad((L) => (L.surfaces[0].stop = 'yes'), /stop must be/);
  bad((L) => (L.surfaces[0].evil = 1), /unsupported field/);
  bad((L) => (L.surfaces[1] = null), /surface 2: not a surface/);
  bad((L) => (L.epd = -1), /entrance-pupil/);
  assert.deepEqual(validateLens(null), ['not a lens prescription']);
  assert.ok(validateLens(lensFromJSON('{"surfaces":[{"R":"abc","t":"x"},{"R":1,"t":1}]}')).length >= 2, 'strings that are not numbers');
});

test('malformed structure and oversized prescriptions throw before any tracing', () => {
  assert.throws(() => lensFromJSON('{"surfaces":[null,{"R":1,"t":1}]}'), /surface 1 is not an object/);
  assert.throws(() => lensFromJSON('{"surfaces":{}}'), /at least two surfaces/);
  assert.throws(() => lensFromJSON('[1,2]'), /at least two surfaces/);
  const many = { surfaces: Array.from({ length: 65 }, () => ({ R: 'inf', t: 1, glass: 'air' })) };
  assert.throws(() => lensFromJSON(JSON.stringify(many)), /more than 64 surfaces/);
  assert.throws(() => decodeLens(enc(many)), /more than 64 surfaces/);
  assert.throws(() => lensFromJSON(' '.repeat(300 * 1024)), /longer than/);
  assert.throws(() => decodeLens('A'.repeat(400 * 1024)), /too long/);
  assert.throws(() => parseZmx('SURF 0\n'.repeat(70) + ' '.repeat(300 * 1024)), /longer than/);
  assert.throws(() => parseZmx('SURF 0\nDISZ 1\n'.repeat(70)), /more than 64 surfaces/);
});

test('legitimate prescriptions keep working: mirrors, aspheres, model glasses, every built-in lens', () => {
  const asph = { epd: 20, field: 3, surfaces: [{ R: 40, k: -0.6, a: [1.2e-6, -3.4e-9, 2e-12, 0], t: 6, glass: { name: '583594', nd: 1.5831, vd: 59.4 }, stop: true }, { R: 'inf', t: 60, glass: 'air' }] };
  assert.deepEqual(validateLens(lensFromJSON(JSON.stringify(asph))), []);
  assert.deepEqual(validateLens(decodeLens(enc(asph))), []);
  for (const L of Object.values(LENSES)) {
    assert.deepEqual(validateLens(L), [], L.name);
    assert.deepEqual(validateLens(decodeLens(encodeLens(L))), [], `${L.name} via link`);
  }
  assert.ok(Object.values(LENSES).some((L) => L.surfaces.some((s) => s.glass === 'mirror')), 'a mirror system is among them');
});

test('a shared link keeps names exactly: spaces, tabs, newlines, Unicode and quotes (#196)', () => {
  const names = ['My test lens', 'tab\there', 'line\nbreak', 'Ölinse λ 𝛌 中文', 'say "f/2"\\'];
  for (const name of names) {
    const L = { name, epd: 12.5, field: 7.25, surfaces: [{ R: 40.125, k: -0.5, a: [1.5e-6, -2e-9], t: 6, glass: { name: name.slice(0, 40), nd: 1.5831, vd: 59.4 }, stop: true }, { R: Infinity, t: 60.0625, glass: 'air', sd: 9.5 }] };
    for (const back of [decodeLens(encodeLens(L)), lensFromJSON(lensToJSON(L))]) {
      assert.equal(back.name, name);
      assert.equal(back.surfaces[0].glass.name, name.slice(0, 40));
      assert.deepEqual([back.epd, back.field, back.surfaces[0].R, back.surfaces[0].k, back.surfaces[0].a, back.surfaces[1].R, back.surfaces[1].t, back.surfaces[1].sd],
        [12.5, 7.25, 40.125, -0.5, [1.5e-6, -2e-9], Infinity, 60.0625, 9.5]);
    }
  }
  assert.ok(!/\n/.test(lensToJSON(LENSES.cooke, 0)), 'compact JSON for links');
});
