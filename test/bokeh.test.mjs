// Bokeh kernels traced through real prescriptions (js/lib/bokeh.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, autoSemiDiameters } from '../js/lib/raytrace.js';
import { bokehKernels } from '../js/lib/bokeh.js';

const K = 128;
const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: got ${a}, expected ${e} ± ${tol}`);
const kernels = (name, lambdas, basis, stop) => bokehKernels({ lens: LENSES[name], sd: autoSemiDiameters(LENSES[name]), lambdas, basis, focus: 1000, near: 500, stop, blades: 0, round: 0, fields: [[0, 0]], K, grid: 48 });
// radius of a uniform disk with the same second moment, in mm, for one colour channel
function radius(k, c) {
  let s = 0, sx = 0, sy = 0, sr = 0;
  for (let i = 0; i < K * K; i++) { const v = k.rgb[i * 3 + c]; s += v; sx += v * (i % K); sy += v * Math.floor(i / K); }
  const cx = sx / s, cy = sy / s;
  for (let i = 0; i < K * K; i++) sr += k.rgb[i * 3 + c] * ((i % K - cx) ** 2 + (Math.floor(i / K) - cy) ** 2);
  return (Math.sqrt((2 * sr) / s) * k.mmW) / K;
}
// mean value in the centre (r < 0.4 R) and on the rim (0.8–0.98 R) of a kernel
function rimToCentre(k) {
  let s = 0, sx = 0, sy = 0;
  for (let i = 0; i < K * K; i++) { const v = k.rgb[i * 3 + 1]; s += v; sx += v * (i % K); sy += v * Math.floor(i / K); }
  const cx = sx / s, cy = sy / s, R = (radius(k, 1) * K) / k.mmW, m = [0, 0], n = [0, 0];
  for (let i = 0; i < K * K; i++) {
    const r = Math.hypot(i % K - cx, Math.floor(i / K) - cy) / R, b = r < 0.4 ? 0 : r >= 0.8 && r < 0.98 ? 1 : -1;
    if (b >= 0) { m[b] += k.rgb[i * 3 + 1]; n[b]++; }
  }
  return m[1] / n[1] / (m[0] / n[0]);
}

test('a stopped-down traced bokeh disk has the paraxial size and conserves the pupil flux', () => {
  for (const name of ['plano-hyperbolic', 'achromat', 'double-gauss']) {
    const r = kernels(name, [587.56], [[1, 1, 1]], 4), k = r.kernels[0], rEP = LENSES[name].epd / 8;
    const D = 2 * radius(k, 1), Dpar = (2 * rEP * (r.zs - r.zInf)) / r.efl; // marginal slope r_EP/f
    assert.ok(Math.abs(D / Dpar - 1) < 0.01, `${name} D ${D} vs ${Dpar}`);
    assert.ok(Math.abs(k.flux / (Math.PI * rEP * rEP) - 1) < 0.005, `${name} flux ${k.flux}`);
  }
});

test('under-corrected spherical aberration: soft-edged background, bright-rimmed foreground', () => {
  const [bg, fg] = kernels('plano-convex', [587.56], [[1, 1, 1]], 0).kernels;
  assert.ok(rimToCentre(bg) < 0.85, `background rim/centre ${rimToCentre(bg)}`);
  assert.ok(rimToCentre(fg) > 1.15, `foreground rim/centre ${rimToCentre(fg)}`);
});

test('longitudinal colour: singlet violet behind focus; achromat green behind, magenta in front', () => {
  const L = [486.13, 587.56, 656.27], B = [[0, 0, 1], [0, 1, 0], [1, 0, 0]]; // F → blue, d → green, C → red
  const rad = (k) => [0, 1, 2].map((c) => radius(k, c)); // [C, d, F]
  const [sb, sf] = kernels('plano-convex', L, B, 0).kernels.map(rad);
  assert.ok(sb[2] > sb[1] && sb[1] > sb[0], `singlet background ${sb}`);
  assert.ok(sf[0] > sf[1] && sf[1] > sf[2], `singlet foreground ${sf}`);
  const [ab, af] = kernels('achromat', L, B, 0).kernels.map(rad);
  assert.ok(ab[1] > Math.max(ab[0], ab[2]), `achromat background ${ab}`); // secondary spectrum: green focus shortest
  assert.ok(af[1] < Math.min(af[0], af[2]), `achromat foreground ${af}`);
});

test('diffraction of a small defocused disk: on-axis intensity follows sinc²(W020/λ) (Born & Wolf §8.8)', async () => {
  const { TASKS } = await import('../js/lib/tasks.js');
  const lens = { ...LENSES['double-gauss'], epd: LENSES['double-gauss'].epd / 4 }, sd = autoSemiDiameters(LENSES['double-gauss']);
  const at = (w020) => TASKS.defocusPSF({ lens, sd, w020, lambdas: [550], ref: 550 }).result;
  const sinc2 = (w) => (Math.sin(Math.PI * w) / (Math.PI * w)) ** 2;
  for (const w of [0.25, 0.5, 1.5]) near(at(w).centre, sinc2(w), 0.03, `W020 = ${w}`);
  for (const w of [1, 2]) assert.ok(at(w).centre < 0.005, `W020 = ${w}: dark centre`);
  // large defocus approaches the geometric disk: RMS radius → R/√2
  const r = at(6);
  let s = 0, s2 = 0;
  r.prof.forEach((v, b) => { const a = 2 * Math.PI * Math.max(b, 0.25); s += v * a; s2 += v * a * b * b; });
  near(Math.sqrt((2 * s2) / s) / r.Rgeo, 1, 0.06, 'W020 = 6: RMS radius / geometric');
});
