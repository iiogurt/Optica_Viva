// FDTD wave simulation: wavelength in vacuum and in glass, fringes against the Huygens–Fresnel
// integral, stability and the absorbing boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, step, column, huygens } from '../js/lib/fdtd.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// mean spacing of upward zero crossings of Ez along the centre row between x0 and x1
function period(sim, x0, x1) {
  const row = Math.floor(sim.ny / 2) * sim.nx, z = [];
  for (let x = x0; x < x1; x++) { const a = sim.Ez[row + x], b = sim.Ez[row + x + 1]; if (a <= 0 && b > 0) z.push(x + a / (a - b)); }
  return (z[z.length - 1] - z[0]) / (z.length - 1);
}

test('the wavelength is λ in vacuum and λ/n in glass (numerical dispersion below 1.5 %)', () => {
  for (const n of [1, 1.5]) {
    const sim = makeSim({ nx: 400, ny: 120, lam: 16, scene: 'film', p: { w: 400, n }, x0: 120 });
    step(sim, 1400);
    near(period(sim, 140, 330), 16 / n, 0.015 * 16 / n, `n = ${n}`);
  }
});

test('two slits: FDTD fringes match the Huygens–Fresnel integral', () => {
  const nx = 300, ny = 220, lam = 8, x0 = 60, w = 12, d = 32;
  const sim = makeSim({ nx, ny, lam, scene: 'double', p: { w, d }, x0 });
  step(sim, 2300);
  assert.ok(sim.nI > 100, 'intensity averaged over many periods');
  const xs = 262, a = column(sim, xs), b = huygens({ nx, ny, lam, x0, holes: [[-d / 2, w], [d / 2, w]], x: xs });
  let err = 0;
  for (let y = 50; y < 170; y++) err += (a[y] - b[y]) ** 2;
  assert.ok(Math.sqrt(err / 120) < 0.12, `RMS difference ${Math.sqrt(err / 120)}`);
  // the central maximum sits on the axis in both
  const peak = (p) => { let m = 90; for (let y = 90; y < 130; y++) if (p[y] > p[m]) m = y; return m; };
  near(peak(a), peak(b), 3, 'central fringe');
});

test('stable at S = 0.5: with the absorbing edges the field does not grow', () => {
  const sim = makeSim({ nx: 160, ny: 160, lam: 10, scene: 'film', p: { w: 0, n: 1 }, source: 'point', x0: 120 });
  step(sim, 300);
  const max1 = Math.max(...sim.Ez.map(Math.abs));
  step(sim, 3000);
  const max2 = Math.max(...sim.Ez.map(Math.abs));
  assert.ok(isFinite(max2) && max2 < 3 * max1, `no growth: ${max1} → ${max2}`);
});
