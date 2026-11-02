// Autofocus: defocus geometry, half-pupil disparity, and both methods finding focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defocus, disparityOf, defocusFromDisparity, imageDistance, scene, halfImage, correlate, runAF, AF_STRIP } from '../js/lib/autofocus.js';
import { blurDiameter } from '../js/lib/optics.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Independent reference: rays from points of the aperture (radius A/2, at the lens) to the image
// point on the axis at v_t, cut by the sensor plane at v_s. Blur = spread of the edge rays; the
// half-pupil disparity = difference of the mean sensor heights of rays through each half.
function rayReference(f, N, u, s) {
  const A = f / N, vt = 1 / (1 / f - 1 / u), vs = 1 / (1 / f - 1 / s), at = (h) => h * (1 - vs / vt);
  let sum = { l: 0, r: 0 }, cnt = { l: 0, r: 0 };
  const n = 400;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = ((i + 0.5) / n - 0.5) * A, y = ((j + 0.5) / n - 0.5) * A;
    if (x * x + y * y > (A * A) / 4) continue;
    const side = x < 0 ? 'l' : 'r'; sum[side] += at(x); cnt[side] += 1;
  }
  return { blur: Math.abs(at(A / 2) - at(-A / 2)), disparity: sum.l / cnt.l - sum.r / cnt.r };
}

test('blur and disparity follow the finite-conjugate ray geometry (#198)', () => {
  // the report's cases: f, N, subject, focus (mm) and the similar-triangles blur
  for (const [f, N, u, s, b] of [[50, 2, 3000, 2000, 0.213675214], [200, 2, 600, 10000, 31.972789116], [200, 2, 10000, 600, 47.0]]) {
    const d = defocus(f, N, u, s), ref = rayReference(f, N, u, s);
    near(d.blur, b, 1e-8, `blur ${f} mm, ${u} → ${s}`);
    near(d.blur, ref.blur, 1e-9, 'edge rays');
    near(d.blur, blurDiameter(f, N, s, u), 1e-9, 'shared depth-of-field model');
    // the left half lands on the far side when the image lies behind the sensor (Δv > 0)
    near(-disparityOf(f, N, d.vt, d.vs), ref.disparity, 2e-3 * Math.abs(ref.disparity), 'half-pupil centroids');
  }
  // both focus directions have opposite signs; zero defocus gives zero
  const a = defocus(50, 2, 3000, 2000), b = defocus(50, 2, 2000, 3000);
  assert.ok(disparityOf(50, 2, a.vt, a.vs) < 0 && disparityOf(50, 2, b.vt, b.vs) > 0, 'signs');
  const z = defocus(85, 1.8, 2500, 2500);
  assert.equal(z.blur, 0); assert.equal(disparityOf(85, 1.8, z.vt, z.vs), 0);
  // low magnification: b → |Δv|/N
  const far = defocus(50, 2, 2e6, 1e6);
  near(far.blur / (Math.abs(far.dv) / 2), 1, 1e-4, 'low-magnification limit');
  // the camera's inversion recovers Δv from the disparity and its own sensor position
  for (const [f, N, u, s] of [[50, 2, 3000, 2000], [200, 2, 600, 10000], [24, 8, 10000, 600]]) {
    const d = defocus(f, N, u, s);
    near(defocusFromDisparity(f, N, d.vs, disparityOf(f, N, d.vt, d.vs)), d.dv, 1e-9 * Math.max(1, Math.abs(d.dv)), `inverse ${f} mm`);
  }
  assert.ok(Number.isNaN(defocusFromDisparity(50, 2, 52, 100)), 'no finite solution');
});

test('the correlated half-images reproduce the predicted shift', () => {
  const src = scene(8192, 3), b = 217, sign = -1;
  const s = correlate(halfImage(src, b, -1, sign, 4, 1e9, null), halfImage(src, b, 1, sign, 4, 1e9, null), 40);
  near(s, (0.4244 * -b) / 4, 1.0, 'pixels');
});

test('phase detection and contrast detection both reach focus; phase detection in fewer frames', () => {
  const r = runAF({ f: 50, N: 2, u: 3000, focus: 2000, trials: 4 });
  assert.ok(r.pdOk && r.cdOk);
  near(r.pdU, 3000, 30, 'phase detection');
  near(r.cdU, 3000, 30, 'contrast detection');
  assert.ok(r.pdFrames < r.frames, 'fewer frames');
});

test('across the supported settings phase detection either lands within the depth of focus or reports that it cannot measure', () => {
  let ok = 0, refused = 0;
  for (const f of [24, 85, 200]) for (const N of [1.4, 8]) for (const [u, s] of [[600, 10000], [10000, 600], [1000, 3000], [3000, 2000]]) {
    const r = runAF({ f, N, u, focus: s, trials: 1 });
    const halfDof = (2 * ((r.vTrue * N) / f) * 2 * 4) / 1000 / 2; // ±N_w c, c = two 4 µm pixels
    if (r.pdOk) { ok++; near(r.pdV, r.vTrue, halfDof, `PD ${f} mm f/${N}, ${u} → ${s}`); } else refused++;
    if (r.cdOk) near(r.cdV, r.vTrue, halfDof, `CD ${f} mm f/${N}, ${u} → ${s}`);
  }
  assert.ok(ok >= 12 && refused >= 4, `${ok} measured, ${refused} out of range`);
  // 200 mm f/2, subject at 0.6 m, lens at 10 m: a 32 mm blur cannot be represented by the 8 mm strip
  const big = runAF({ f: 200, N: 2, u: 600, focus: 10000, trials: 1 });
  assert.equal(big.pdOk, false); assert.ok(Number.isNaN(big.pdU));
  assert.ok(big.cdU >= 600 - 1e-6, `the contrast search stays within the focus range: ${big.cdU}`);
  assert.ok(AF_STRIP.maxShift === 400);
});
