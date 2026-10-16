// Classic lens forms designed for this project: first-order properties that define each form,
// every field traces, and the optimiser's back-focus constraint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, paraxial, aimRay, trace, vertices } from '../js/lib/raytrace.js';
import { optimise } from '../js/lib/optimise.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e} ± ${tol}`);
const track = (L) => vertices(L).at(-1) + L.surfaces.at(-1).t;
const bfd = (L) => L.surfaces.at(-1).t;

test('focal lengths and f-numbers of the classic forms', () => {
  for (const [k, f, N] of [['tessar', 50, 5], ['petzval', 100, 4], ['telephoto', 200, 5.6], ['retrofocus', 35, 6]]) {
    const p = paraxial(LENSES[k]);
    near(p.efl, f, 0.05, `${k} EFL`);
    near(p.efl / LENSES[k].epd, N, 0.02, `${k} f-number`);
  }
});

test('telephoto is shorter than its focal length; retrofocus focuses farther back than its focal length', () => {
  const t = LENSES.telephoto, r = LENSES.retrofocus;
  assert.ok(track(t) / paraxial(t).efl < 0.8, 'telephoto ratio < 0.8');
  assert.ok(bfd(r) > 1.1 * paraxial(r).efl, 'retrofocus back focal distance > 1.1 f');
  assert.ok(LENSES.retrofocus.surfaces[0].R > LENSES.retrofocus.surfaces[1].R && paraxial({ ...r, surfaces: r.surfaces.slice(0, 2).map((s, i) => (i ? { ...s, t: 50 } : s)) }).efl < 0, 'front meniscus is negative');
});

test('every classic form traces across its whole field at full aperture', () => {
  for (const k of ['tessar', 'petzval', 'telephoto', 'retrofocus']) {
    const L = LENSES[k], par = paraxial(L);
    for (const f of [0, 0.5, 1]) for (const [px, py] of [[0, 0], [0, 1], [0, -1], [1, 0]]) {
      const a = aimRay(L, 587.56, f * L.field, px, py, par);
      assert.ok(a && trace(L, 587.56, a.p, a.d, { zv: par.zv }).ok, `${k} field ${f} pupil ${px},${py}`);
    }
  }
});

test('optimiser: minimum back focal distance is respected', () => {
  const r = optimise(LENSES.cooke, { iterations: 8, minBfd: 46, bfdWeight: 5 });
  assert.ok(bfd(r.lens) > 45.5, `back focus ${bfd(r.lens)}`);
  near(r.efl, 50, 0.5, 'focal length held');
});
