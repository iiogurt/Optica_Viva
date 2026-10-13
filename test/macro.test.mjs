// Macro optics: effective f-number, exact defocus blur, depth of field, optimum aperture, render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeUp, magAt, blurAt, macroDoF, airyDiameter, optimalNw, stackFrames, renderRuler, gaussianExact } from '../js/lib/macro.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('close-up first-order optics with pupil magnification', () => {
  const g = closeUp({ f: 50, N: 8, mp: 1, m: 1 });
  near(g.Nw, 16, 1e-12, 'symmetric lens at 1:1: f/8 → f/16');
  near(g.evLoss, 2, 1e-12, 'two stops lost');
  near(g.ext, 50, 1e-12, 'extension = f at 1:1');
  near(g.sEP + g.sXP, 4 * 50, 1e-9, 'object–image distance 4f at 1:1 (m_p = 1, thin lens)');
  near(closeUp({ f: 35, N: 2, mp: 0.5, m: 1 }).Nw, 6, 1e-12, 'reversed retrofocus (m_p = ½): N(1 + 2)');
  near(magAt(50, 1, g.sEP), 1, 1e-12, 'magnification of the focused object');
});

test('exact defocus blur: zero at focus, m²δ/N_w for small depth, DoF = 2N_w c/m²', () => {
  const o = { f: 100, N: 8, mp: 0.8, m: 1 }, g = closeUp(o);
  near(blurAt(o, g.sEP), 0, 1e-12, 'in focus');
  const d = 0.01;
  near(blurAt(o, g.sEP + d) / ((o.m * o.m * d) / g.Nw), 1, 0.01, 'small-defocus blur');
  // numeric DoF: object distances where the blur reaches c
  const c = 0.03, find = (sg) => { let lo = 0, hi = 20; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; blurAt(o, g.sEP + sg * mid) < c ? (lo = mid) : (hi = mid); } return lo; };
  near((find(1) + find(-1)) / macroDoF(o, c), 1, 0.01, 'total depth of field');
});

test('diffraction trade-off: Airy diameter and the RSS optimum', () => {
  near(airyDiameter(16, 550) * 1000, 21.47, 0.01, 'Airy Ø at N_w = 16, 550 nm (µm)');
  const m = 1, depth = 5, rss = (Nw) => Math.hypot((m * m * depth) / 2 / Nw, airyDiameter(Nw));
  const opt = optimalNw(m, depth);
  assert.ok(rss(opt) < rss(opt * 1.05) && rss(opt) < rss(opt / 1.05), 'minimum of the combined blur');
  assert.equal(stackFrames(5, 1.08), 6, 'frames for 5 mm at 1.08 mm DoF with 20 % overlap');
});

test('exact Gaussian keeps a 3-px period that a box approximation would erase', () => {
  const W = 60, H = 4, p = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) p[k] = Math.cos((2 * Math.PI * (k % W)) / 3);
  gaussianExact(p, W, H, 0.7);
  const amp = Math.max(...Array.from(p.slice(2 * W + 20, 2 * W + 40)));
  near(amp, Math.exp(-2 * Math.PI ** 2 * 0.7 ** 2 / 9), 0.03, 'MTF of a Gaussian at 1/3 cycle per pixel');
});

test('ruler render: depth of the tilted ruler, focus stacking reduces the worst blur', () => {
  const base = { f: 100, N: 8, mp: 0.8, m: 1, tilt: Math.PI / 4, W: 120, H: 80, mmPerPx: 0.3, cx: 0, cy: 0, lam: 550 };
  const one = renderRuler({ ...base, frames: 1 }), six = renderRuler({ ...base, frames: 6 });
  near(one.stats.depth, 24 * Math.SQRT2 * Math.SQRT1_2, 1.5, 'visible depth ≈ 24 mm for a 45° ruler at 1:1');
  assert.ok(six.stats.rMax < one.stats.rMax / 4, `stacking: ${six.stats.rMax} vs ${one.stats.rMax} px`);
  for (const v of one.img) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1.0001, 'reflectance in [0, 1]');
});
