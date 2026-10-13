// The human eye: Le Grand schematic eye, chromatic aberration, pupil size and the CoC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eyeAt, chromaticDifference, thibos, eyeMTF, mtfAt, cocFromAcuity } from '../js/lib/eye.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test("Le Grand's eye: 59.94 D and nearly emmetropic", () => {
  near(eyeAt(587.56).power, 59.94, 0.02, 'power (d line)');
  assert.ok(Math.abs(eyeAt(555).error) < 0.3, `refraction at 555 nm: ${eyeAt(555).error} D`);
});

test('longitudinal chromatic aberration matches the measured chromatic eye within 15 %', () => {
  const ours = chromaticDifference(450) - chromaticDifference(650), meas = thibos(650) - thibos(450);
  near(ours / meas, 1, 0.15, '450–650 nm');
  assert.ok(chromaticDifference(450) > 0, 'myopic in the blue');
});

test('diffraction cut-off and the best pupil', () => {
  const r = eyeMTF({ p: 3, lam: 555, hoa: 0, sc: false });
  near(r.cutoff, (3 / 555e-6) * (Math.PI / 180), 1e-9, 'D/λ in cycles/degree');
  near(r.strehl, 1, 1e-6, 'aberration-free Strehl');
  near(mtfAt(r, r.cutoff / 2), (2 / Math.PI) * (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)), 0.03, 'diffraction MTF at half the cut-off');
  const q = [1.5, 2, 2.5, 3, 3.5, 4, 5, 6].map((p) => [p, mtfAt(eyeMTF({ p, lam: 555, hoa: 1, sc: true }), 30)]);
  const best = q.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  assert.ok(best >= 2.5 && best <= 4, `best pupil for 30 c/deg: ${best} mm (Campbell & Gubisch: 2.5–3.5)`);
});

test('circle of confusion from acuity', () => {
  // full frame viewed from its diagonal at 2.3′ ≈ d/1500
  const d = Math.hypot(36, 24), E = 10, V = d * E;
  near(cocFromAcuity(V, 2.3, E) / (d / 1500), 1, 0.01, 'c = d·α ≈ d/1500 at 2.3′');
});
