// Panoramas: parallax geometry, a parallax-free stitch about the entrance pupil, cardinal points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disparity, poleDisparity, renderPanorama, cardinalPoints } from '../js/lib/panorama.js';
import { LENSES } from '../js/lib/raytrace.js';
import { index } from '../js/lib/glass.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const D = Math.PI / 180;

test('parallax of a near object between two frames', () => {
  for (const [e, dl, d] of [[0.06, 40, 1], [-0.03, 25, 0.5], [0.1, 60, 3]]) near(poleDisparity({ e, lat: 0, delta: dl * D, dn: d }), disparity(e, dl * D, d), 1e-12, `exact formula e=${e}`);
  near(disparity(0.001, 40 * D, 2) / ((2 * 0.001 * Math.sin(20 * D)) / 2), 1, 1e-3, 'small-offset limit 2e sin(Δ/2)/d');
  near(disparity(0, 40 * D, 0.5), 0, 0, 'no offset, no parallax');
});

test('rotating about the entrance pupil gives a seamless stitch; a 60 mm offset does not', () => {
  const base = { W: 240, H: 92, f: 24, sensor: [36, 24], delta: 40 * D, lat: 0, height: 1.5, dn: 1, df: 60, mode: 'diff' };
  // in 'diff' mode overlap pixels are (Δ, Δ/4, Δ/10) and single-frame pixels are grey
  const maxDiff = (r) => { let m = 0; for (let k = 0; k < r.W * r.H; k++) m = Math.max(m, (r.rgb[k * 3] - r.rgb[k * 3 + 1]) / 0.75); return m; };
  near(maxDiff(renderPanorama({ ...base, e: 0 })), 0, 1e-9, 'frames agree everywhere in the overlap');
  assert.ok(maxDiff(renderPanorama({ ...base, e: 0.06 })) > 0.3, 'near pole doubled with the pivot 60 mm behind the pupil');
});

test('cardinal points: nodal (principal) point vs entrance pupil', () => {
  near(cardinalPoints(LENSES['plano-convex']).zH, 0, 1e-9, 'plano-convex, curved side first: H at the curved vertex');
  const rev = LENSES['plano-convex-rev'], t = rev.surfaces[0].t, n = index(rev.surfaces[0].glass, 587.56);
  near(cardinalPoints(rev).zH, t / n, 1e-9, 'flat side first: H at t/n inside the glass');
  const dg = cardinalPoints(LENSES['double-gauss']);
  assert.ok(Math.abs(dg.zH - dg.zEP) > 5, `Double-Gauss: pupil ${dg.zEP} vs nodal point ${dg.zH}`);
});
