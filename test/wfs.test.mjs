// Wavefront sensing: Shack–Hartmann linearity, modal reconstruction, Noll fitting error, noise
// scaling and a converging AO loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSH, shMeasure, geometricSlopes, reconstruct, modalMap, rmsOPD, projectModes, nollResidual, createLoop } from '../js/lib/wfs.js';
import { phaseScreen } from '../js/lib/turbulence.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const sys = makeSH({ Np: 120, nsub: 12, J: 36, lam: 600 });

test('Shack–Hartmann: a small tilt moves every spot by the mean gradient', () => {
  const opd = new Float64Array(120 * 120);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) opd[y * 120 + x] = 1.5 * x + 0.5 * y; // nm per pupil pixel (linear regime)
  const m = shMeasure(sys, opd).slopes, g = geometricSlopes(sys, opd), V = sys.valid.length;
  // raw centroids carry a few per cent of truncation bias; the calibrated lenslet gains remove it
  near(m[3] / (g[3] * sys.gain[3]), 1, 0.02, 'x slope of a full lenslet');
  near(m[V + 3] / (g[V + 3] * sys.gain[V + 3]), 1, 0.02, 'y slope');
  for (const k of [3, V + 3]) assert.ok(Math.abs(sys.gain[k] - 1) < 0.08, `centroid gain ${sys.gain[k]}`);
  near(g[3], (2 * Math.PI * 1.5) / 600, 1e-12, 'geometric gradient 2π·1.5/600 rad per pixel');
});

test('modal reconstruction recovers single Zernike modes', () => {
  for (const [j, amp] of [[4, 80], [7, 60], [11, 40], [22, 30]]) {
    const opd = sys.modes[j - 2].map((v) => v * amp), a = reconstruct(sys, shMeasure(sys, opd).slopes);
    near(a[j - 2] / amp, 1, 0.04, `Z${j}`);
    a.forEach((v, i) => { if (i !== j - 2) assert.ok(Math.abs(v) < 0.06 * amp, `cross-talk Z${j} → Z${i + 2}: ${v}`); });
    // reconstructed map ≈ input
    const rec = modalMap(sys, a), d = opd.map((v, p) => v - rec[p]);
    assert.ok(rmsOPD(sys, d) < 0.1 * amp, `map residual for Z${j}`);
  }
});

test('Noll fitting error after 21 modes on Kolmogorov phase screens', () => {
  const s21 = makeSH({ Np: 120, nsub: 12, J: 21, lam: 600 }), NS = 256, toRad = (nm) => (2 * Math.PI * nm) / 500;
  let acc = 0;
  const n = 24;
  for (let k = 0; k < n; k++) {
    const scr = phaseScreen(NS, 8 / 120, 0.8, 1e5, 100 + k); // D/r0 = 10, L0 → ∞
    const opd = new Float64Array(120 * 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) opd[y * 120 + x] = (scr[(y + 60) * NS + x + 60] * 500) / (2 * Math.PI);
    const fit = modalMap(s21, projectModes(s21, opd)), res = opd.map((v, p) => v - fit[p]);
    acc += toRad(rmsOPD(s21, res)) ** 2;
  }
  near(acc / n / (nollResidual(21) * 10 ** (5 / 3)), 1, 0.15, 'Δ21 (D/r0)^(5/3)');
  near(nollResidual(100), 0.2944 * 100 ** (-Math.sqrt(3) / 2), 1e-12, 'large-J formula');
});

test('centroid noise falls as 1/N_ph', () => {
  let s = 4242;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  const varAt = (nph) => { let v = 0, c = 0; for (let k = 0; k < 12; k++) shMeasure(sys, new Float64Array(14400), { nph, ron: 0, rand }).slopes.forEach((q) => { v += q * q; c++; }); return v / c; };
  const r = varAt(300) / varAt(30000);
  assert.ok(r > 60 && r < 160, `variance ratio for 100× more photons: ${r}`);
});

test('closed AO loop converges to near its error budget', () => {
  const L = createLoop({ seed: 3 });
  L.configure({ nsub: 10, J: 36, r0: 0.15, wind: 5, fs: 1000, gain: 0.5, nph: 1e5, ron: 0, loop: 'closed', lsci: 1650, reset: true });
  let f = null;
  for (let i = 0; i < 12; i++) f = L.run(40);
  const h = f.hist.slice(-15), res = Math.sqrt(h.reduce((a, r) => a + r[2] ** 2, 0) / h.length), turb = h.reduce((a, r) => a + r[1], 0) / h.length;
  const fit = Math.sqrt(nollResidual(37) * (8 / 0.15) ** (5 / 3)) * (500 / (2 * Math.PI));
  assert.ok(res < 0.6 * turb, `residual ${res} vs turbulence ${turb}`);
  assert.ok(res > 0.8 * fit && res < 1.6 * fit, `residual ${res} vs fitting error ${fit}`);
});
