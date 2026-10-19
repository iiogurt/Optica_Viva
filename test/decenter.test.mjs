// Decentered and tilted surfaces in the exact tracer, checked against closed-form geometry, and the
// decenter/tilt terms of the tolerance analysis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, paraxial, aimRay, trace, toPlane, vertices } from '../js/lib/raytrace.js';
import { index } from '../js/lib/glass.js';
import { groups, perturbGroup, sensitivity, monteCarlo } from '../js/lib/tolerance.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e} ± ${tol}`);
const shift = (L, dec, tilt) => ({ ...L, surfaces: L.surfaces.map((s) => ({ ...s, dec, tilt })) });

test('zero decenter and tilt change nothing', () => {
  const L = LENSES.cooke, p = paraxial(L), a = aimRay(L, 587.56, 14, 0.3, 0.8, p);
  const r0 = trace(L, 587.56, a.p, a.d, { zv: p.zv }), r1 = trace(shift(L, [0, 0], [0, 0]), 587.56, a.p, a.d, { zv: p.zv });
  for (let k = 0; k < 3; k++) { near(r1.p[k], r0.p[k], 1e-12, 'position'); near(r1.d[k], r0.d[k], 1e-12, 'direction'); }
  near(r1.opl, r0.opl, 1e-12, 'optical path');
});

test('a whole lens moved sideways moves its image of a star by the same amount', () => {
  const L = LENSES.cooke, p = paraxial(L), M = shift(L, [0.3, -0.5], [0, 0]);
  for (const [px, py] of [[0, 0], [0, 0.7], [0.5, -0.5]]) {
    const a = aimRay(L, 587.56, 0, px, py, p), d = [0, 0, 1];
    const q0 = toPlane(trace(L, 587.56, a.p, d, { zv: p.zv }), p.zImage);
    const q1 = toPlane(trace(M, 587.56, [a.p[0] + 0.3, a.p[1] - 0.5, a.p[2]], d, { zv: p.zv }), p.zImage);
    near(q1[0] - q0[0], 0.3, 1e-9, 'x shift'); near(q1[1] - q0[1], -0.5, 1e-9, 'y shift');
  }
});

test('a tilted plate displaces a ray by t sin θ (1 − cos θ / √(n² − sin² θ))', () => {
  const n = index('N-BK7', 587.56), t = 10, th = 0.2; // rad
  const L = { epd: 1, field: 0, surfaces: [{ R: Infinity, t, glass: 'N-BK7', stop: true, tilt: [th, 0] }, { R: Infinity, t: 20, glass: 'air', dec: [0, -Math.sin(th) * t], tilt: [th, 0] }] };
  const r = trace(L, 587.56, [0, 0, -5], [0, 0, 1], { zv: vertices(L) });
  assert.ok(r.ok);
  near(r.d[1], 0, 1e-12, 'emerges parallel');
  // both faces are tilted about x by θ; the rear vertex sits at (0, −t sin θ, t), so the faces are
  // T = t (sin² θ + cos θ) apart along their normal (0, −sin θ, cos θ)
  const T = t * (Math.sin(th) ** 2 + Math.cos(th));
  const want = T * Math.sin(th) * (1 - Math.cos(th) / Math.sqrt(n * n - Math.sin(th) ** 2));
  near(Math.abs(r.p[1] - r.d[1] / r.d[2] * (r.p[2] - 30)), want, 1e-6, 'lateral displacement (mm)');
});

test('a mirror tilted by α turns the reflected beam by 2α', () => {
  for (const a of [0.01, 0.1]) {
    const L = { epd: 1, field: 0, surfaces: [{ R: Infinity, t: -50, glass: 'mirror', stop: true, tilt: [a, 0] }] };
    const r = trace(L, 550, [0, 0, -10], [0, 0, 1], { zv: [0] });
    near(Math.atan2(r.d[1], -r.d[2]), 2 * a, 1e-12, `deviation at α = ${a}`);
  }
});

test('groups: singlets, cemented groups and mirrors move as one', () => {
  assert.deepEqual(groups(LENSES.cooke), [{ first: 0, last: 1 }, { first: 2, last: 3 }, { first: 4, last: 5 }]);
  assert.deepEqual(groups(LENSES.achromat), [{ first: 0, last: 2 }], 'cemented doublet is one group');
  assert.deepEqual(groups(LENSES.hubble), [{ first: 0, last: 0 }, { first: 1, last: 1 }]);
  // tilting a group about its first vertex swings the second vertex sideways by −sin(a)·Δz
  const S = LENSES.achromat.surfaces.slice(), zv = vertices(LENSES.achromat);
  perturbGroup(S, zv, { first: 0, last: 2 }, 0, 0, 0.01, 0);
  near(S[2].dec[1], -Math.sin(0.01) * (zv[2] - zv[0]), 1e-12, 'vertex swing');
});

test('tolerancing: the decentered Cooke loses sharpness; its middle element is the most sensitive', () => {
  const s = sensitivity(LENSES.cooke, { decenterUm: 20, tiltArcmin: 2 });
  assert.equal(s.rows.length, 3);
  for (const r of s.rows) assert.ok(r.decenter > 0 && r.tilt > 0, 'every perturbation degrades the image');
  const worst = s.rows.reduce((a, b) => (b.decenter > a.decenter ? b : a));
  assert.equal(worst.first, 2, 'the negative middle element of a Cooke triplet is the most decenter-sensitive');
  const mc = monteCarlo(LENSES.cooke, { radiusPct: 0, thicknessUm: 0, indexDelta: 0, decenterUm: 20, tiltArcmin: 2 }, 12, 3);
  assert.equal(mc.failed, 0);
  assert.ok(mc.median > mc.nominal, 'random decenter and tilt raise the median RMS error');
});
