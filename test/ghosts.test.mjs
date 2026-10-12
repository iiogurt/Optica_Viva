// Real-ray lens-flare ghosts (js/lib/ghosts.js) against the paraxial ghost matrices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, paraxial, autoSemiDiameters } from '../js/lib/raytrace.js';
import { index } from '../js/lib/glass.js';
import { ghostPairs, paraxialGhosts, ghostSystem, renderGhosts } from '../js/lib/ghosts.js';

const lam = 587.56, base = LENSES['double-gauss'], lens = { ...base, epd: base.epd / 6 };
const par = paraxial(lens, lam), sd = autoSemiDiameters(base);

test('a lens with k reflecting surfaces has k(k−1)/2 two-reflection ghost paths', () => {
  assert.equal(ghostPairs(LENSES['double-gauss']).length, 45); // 10 index steps (the stop is in air)
  assert.equal(ghostPairs(LENSES.cooke).length, 15);
});

test('real-ray ghosts match the paraxial ghost in position, size and flux (stopped down, 0.57°)', () => {
  const th = 0.01, S = lens.surfaces;
  const n = (k) => (k < 0 ? 1 : index(S[k].glass, lam)), Rn = (k) => ((n(k) - n(k - 1)) / (n(k) + n(k - 1))) ** 2;
  const sys = ghostSystem(lens, { lambdas: [lam], coat: 'none', sd, stopR: par.stopR, blades: 0, zImg: par.zImage });
  const pg = paraxialGhosts(lens, lam, par.zImage);
  for (const [i, j] of [[1, 2], [1, 4], [6, 8], [8, 10]]) {
    const g = pg.find((q) => q.i === i && q.j === j), [A, B] = g.M, [C, D] = g.stopM;
    const y = (B - (A * D) / C) * th, rho = Math.abs(A / C) * par.stopR, W = 600, mm = 40, mmpx = mm / W;
    const r = renderGhosts(sys, { theta: [0, th], basis: [[1, 1, 1]], mmW: mm, mmH: mm, W, grid: 40, pairs: [[i, j]] });
    let s = 0, sy = 0, sr = 0;
    for (let py = 0; py < r.H; py++) for (let px = 0; px < W; px++) {
      const v = r.rgb[(py * W + px) * 3], yy = (r.H / 2 - py - 0.5) * mmpx;
      s += v; sy += v * yy; sr += v * (((px + 0.5 - W / 2) * mmpx) ** 2 + yy * yy);
    }
    const cy = sy / s, rhoRay = Math.sqrt(2 * (sr / s - cy * cy)); // uniform disk: <r²> = ρ²/2
    const flux = s * mmpx * mmpx, fluxPar = Rn(i) * Rn(j) * Math.PI * (par.stopR / C) ** 2 * Math.cos(th);
    assert.ok(Math.abs(cy - y) < 0.03 * Math.abs(y) + 0.01, `${i}-${j} centroid ${cy} vs ${y}`);
    assert.ok(Math.abs(rhoRay / rho - 1) < 0.02, `${i}-${j} radius ${rhoRay} vs ${rho}`);
    assert.ok(Math.abs(flux / fluxPar - 1) < 0.03, `${i}-${j} flux ${flux} vs ${fluxPar}`);
  }
});

// QHQ is designed for n = 1.52; on these n ≈ 1.6 glasses it leaves ~0.5 % per surface vs 0.7 % for MgF₂
test('anti-reflection coatings cut the total ghost flux: uncoated > MgF₂ > QHQ', () => {
  const total = (coat) => {
    const sys = ghostSystem(lens, { lambdas: [450, 550, 650], coat, sd, stopR: par.stopR, blades: 6, zImg: par.zImage });
    return renderGhosts(sys, { theta: [0.05, 0], basis: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], W: 120, grid: 12 }).stats.flux.reduce((a, b) => a + b, 0);
  };
  const [none, mgf2, qhq] = ['none', 'mgf2', 'qhq'].map(total);
  assert.ok(none > 30 * mgf2 && mgf2 > 1.3 * qhq, `${none} ${mgf2} ${qhq}`);
});
