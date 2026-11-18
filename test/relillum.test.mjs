// Relative illumination traced through real prescriptions (js/lib/relillum.js): the cos⁴ limit,
// agreement with an independent method, pupil aberration in wide-angle designs, and stopping down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, paraxial, trace } from '../js/lib/raytrace.js';
import { relativeIllumination, apertures, tracedVignetting } from '../js/lib/relillum.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('a slow narrow-field lens follows cos⁴θ', () => {
  const lens = LENSES.achromat;
  for (const r of relativeIllumination(lens, { thetas: [0, 1.5, 3] })) near(r.ri, r.cos4, 2e-4, `${r.theta}°`);
});

// Independent check: illuminance from the area that the arriving rays span in image-space
// direction cosines (the projected solid angle of the exit pupil seen from the image point).
test('the energy method agrees with the image-space direction-cosine method', () => {
  for (const [key, trim] of [['cooke', 1], ['double-gauss', 1], ['double-gauss', 0], ['double-gauss', 0.5], ['biogon', 1], ['retrofocus', 1], ['tessar', 1]]) {
    const lens = LENSES[key], par = paraxial(lens, 587.56), sd = apertures(lens, trim, par);
    const ri = relativeIllumination(lens, { thetas: [0, lens.field / 2, lens.field], sd });
    const dc = (r) => {
      const pts = r.outline.map(([dx, dy]) => trace(lens, 587.56, [r.chief.p[0] + dx, r.chief.p[1] + dy, r.chief.p[2]], r.chief.d, { clip: false, zv: par.zv }).d);
      return Math.abs(pts.reduce((A, p, k) => { const q = pts[(k + 1) % pts.length]; return A + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0));
    };
    const A0 = dc(ri[0]);
    for (const r of ri.slice(1)) if (r.ri > 0) near(r.ri, dc(r) / A0, 0.012, `${key} (rims ${trim}) at ${r.theta}°`);
  }
});

test('wide-angle designs beat cos⁴ through pupil growth', () => {
  const [e] = relativeIllumination(LENSES.biogon, { thetas: [45] });
  assert.ok(e.area > 1.1, `the Biogon's pupil grows towards the edge (${e.area.toFixed(3)})`);
  assert.ok(e.ri > 1.4 * e.cos4, `corner ${e.ri.toFixed(3)} against cos⁴ ${e.cos4.toFixed(3)}`);
  near(e.dist, Math.cos(Math.PI / 4) ** 3, 0.02, 'its distortion factor stays close to the thin lens');
  const [r] = relativeIllumination(LENSES.retrofocus, { thetas: [22] });
  assert.ok(r.ri > r.cos4, 'the retrofocus lens too');
});

test('stopping down removes mechanical vignetting but not the natural falloff', () => {
  const open = tracedVignetting({ key: 'double-gauss', trim: 0.4, stop: 0, n: 5 }), shut = tracedVignetting({ key: 'double-gauss', trim: 0.4, stop: 3, n: 5 });
  near(shut.fnum, open.fnum * 2 ** 1.5, 1e-6, 'three stops');
  const a = open.curve.at(-1), b = shut.curve.at(-1);
  assert.ok(a.ri < 0.5 * a.riOpen, 'wide open the rims cut the corner bundle');
  assert.ok(b.ri > 0.97 * b.riOpen, 'three stops down they hardly do');
  near(b.riOpen, a.riOpen, 0.02, 'the natural falloff stays');
  for (const r of tracedVignetting({ key: 'cooke', trim: 1, n: 5 }).curve) near(r.ri, r.riOpen, 1e-9, 'generous rims do not vignette');
});
