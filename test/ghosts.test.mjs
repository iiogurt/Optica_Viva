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

test('Fresnel integrals and the knife edge: C(1), S(1), ¼ on the edge, the 1.37 first fringe', async () => {
  const { fresnelCS, knifeEdge, knifeEdgePixel } = await import('../js/lib/ghosts.js');
  const [C, S] = fresnelCS(1);
  assert.ok(Math.abs(C - 0.77989) < 2e-3 && Math.abs(S - 0.43826) < 2e-3, `C ${C}, S ${S}`);
  assert.ok(Math.abs(knifeEdge(0) - 0.25) < 2e-3);
  let mx = 0, at = 0;
  for (let u = 0; u < 3; u += 0.001) if (knifeEdge(u) > mx) { mx = knifeEdge(u); at = u; }
  assert.ok(Math.abs(mx - 1.3704) < 5e-3 && Math.abs(at - 1.217) < 0.02, `first fringe ${mx} at ${at}`);
  assert.ok(knifeEdge(-4) < 0.02 && Math.abs(knifeEdge(30) - 1) < 0.02);
  // the pixel average: the point value for tiny pixels, the mean 1 over many rings
  assert.ok(Math.abs(knifeEdgePixel(1.217, 0.01) - mx) < 5e-3);
  assert.ok(Math.abs(knifeEdgePixel(15, 6) - 1) < 0.02);
});

test('each ghost knows its defocus: W₀₂₀ from the rays matches the paraxial A·C·y²/2', () => {
  const sys = ghostSystem(lens, { lambdas: [lam], coat: 'none', sd, stopR: par.stopR, blades: 0, zImg: par.zImage });
  const pg = paraxialGhosts(lens, lam, par.zImage);
  for (const [i, j] of [[1, 2], [6, 8], [8, 10]]) {
    const g = pg.find((q) => q.i === i && q.j === j), ym = par.stopR / g.stopM[0], Wp = Math.abs((g.M[0] * g.M[2] * ym * ym) / 2) / (lam * 1e-6);
    const r = renderGhosts(sys, { theta: [0, 0.01], basis: [[1, 1, 1]], mmW: 40, mmH: 40, W: 200, grid: 40, pairs: [[i, j]] });
    assert.ok(Math.abs(r.stats.defocus[0] / Wp - 1) < 0.02, `${i}-${j}: ${r.stats.defocus[0]} vs ${Wp} waves`);
  }
});

test('Fresnel rings at the ghost edge keep its flux; vertex averaging smooths the cells', () => {
  const sys = ghostSystem(lens, { lambdas: [lam], coat: 'none', sd, stopR: par.stopR, blades: 0, zImg: par.zImage });
  // find the ghost, then zoom in on it so the first fringe spans several pixels
  const W = 600, wide = renderGhosts(sys, { theta: [0, 0.01], basis: [[1, 1, 1]], mmW: 40, mmH: 40, W, grid: 40, pairs: [[8, 10]], ringing: false });
  let my = 0, ms = 0; for (let k = 0; k < W * wide.H; k++) { const v = wide.rgb[k * 3]; ms += v; my += v * (wide.H / 2 - Math.floor(k / W) - 0.5) * (40 / W); }
  const mm = 8, opt = { theta: [0, 0.01], basis: [[1, 1, 1]], mmW: mm, mmH: mm, center: [0, my / ms], W, grid: 40, pairs: [[8, 10]] };
  const flat = renderGhosts(sys, { ...opt, ringing: false, smooth: false }), smooth = renderGhosts(sys, { ...opt, ringing: false }), ring = renderGhosts(sys, opt);
  const sum = (r) => r.rgb.reduce((a, v, k) => (k % 3 ? a : a + v), 0);
  assert.ok(Math.abs(sum(ring) / sum(flat) - 1) < 0.01 && Math.abs(sum(smooth) / sum(flat) - 1) < 0.005, `flux ${sum(ring) / sum(flat)}, ${sum(smooth) / sum(flat)}`);
  // along the row through the centroid: rings near the edge, no steps between cells inside
  let cy = 0, s = 0; for (let k = 0; k < W * flat.H; k++) { const v = flat.rgb[k * 3]; s += v; cy += v * Math.floor(k / W); }
  const y = Math.round(cy / s), row = (r) => Array.from({ length: W }, (_, x) => r.rgb[(y * W + x) * 3]);
  const f = row(flat), sm = row(smooth), rg = row(ring), lit = f.map((v, x) => (v > 0 ? x : -1)).filter((x) => x >= 0);
  const x0 = lit[0], x1 = lit[lit.length - 1], inner = [x0 + Math.round((x1 - x0) * 0.2), x1 - Math.round((x1 - x0) * 0.2)];
  const mean = f.slice(inner[0], inner[1]).reduce((a, b) => a + b, 0) / (inner[1] - inner[0]);
  // the same pixels with and without rings: the first fringe lifts them by up to the knife edge's 1.37
  const lift = Math.max(...rg.map((v, x) => (sm[x] > 0.3 * mean ? v / sm[x] : 0)));
  assert.ok(lift > 1.2 && lift < 1.45, `first-fringe lift ${lift}`);
  // steps between cells show up in the second difference; a smooth gradient hardly does
  const steps = (r) => { let j = 0; for (let x = inner[0]; x < inner[1]; x++) j += Math.abs(r[x + 1] - 2 * r[x] + r[x - 1]); return j; };
  assert.ok(steps(sm) < 0.5 * steps(f), `interior steps ${steps(sm)} vs ${steps(f)}`);
});
