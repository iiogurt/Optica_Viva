// Polarisation: Mueller algebra, Fresnel/Brewster, Rayleigh sky and the polarised lake renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polariser, retarder, rotator, mmul, mapply, ellipse, fresnelAmp, brewster, reflectionMueller, rayleighTau, rayleighDoP, slabFactor, renderLake, diskStress, principal, retardation, michelLevy, CRYSTALS, walkOff, maxWalkOff } from '../js/lib/polar.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const D = Math.PI / 180, UNPOL = [1, 0, 0, 0];

test('Malus\'s law and the three-polariser paradox', () => {
  for (const a of [0, 20, 45, 70, 90]) {
    const S = mapply(polariser(a * D), mapply(polariser(0), UNPOL));
    near(S[0], 0.5 * Math.cos(a * D) ** 2, 1e-12, `Malus at ${a}°`);
  }
  const crossed = mapply(polariser(90 * D), mapply(polariser(0), UNPOL));
  near(crossed[0], 0, 1e-12, 'crossed polarisers');
  const three = mapply(polariser(90 * D), mapply(polariser(45 * D), mapply(polariser(0), UNPOL)));
  near(three[0], 1 / 8, 1e-12, 'three polarisers 0/45/90');
});

test('wave plates: λ/4 at 45° makes circular light, λ/2 rotates linear light by 2θ', () => {
  const H = [1, 1, 0, 0];
  const c = ellipse(mapply(retarder(Math.PI / 2, 45 * D), H));
  near(Math.abs(c.chi), Math.PI / 4, 1e-12, 'circular ellipticity');
  near(c.dop, 1, 1e-12, 'still fully polarised');
  const r = ellipse(mapply(retarder(Math.PI, 30 * D), H));
  near(r.psi, 60 * D, 1e-12, 'half-wave plate rotation');
  // frame rotation is orthogonal and composes
  const M = mmul(rotator(0.3), rotator(-0.3));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) near(M[i][j], i === j ? 1 : 0, 1e-12, 'R(ψ)R(−ψ) = 1');
});

test('Fresnel reflectance and Brewster\'s angle', () => {
  near(brewster(1, 1.333) / D, 53.12, 0.01, 'water');
  near(brewster(1, 1.5168) / D, 56.60, 0.01, 'N-BK7');
  near(fresnelAmp(1, 1.333, brewster(1, 1.333)).Rp, 0, 1e-15, 'Rp(θB) = 0');
  near(fresnelAmp(1, 1.333, 1e-9).Rs, ((1.333 - 1) / 2.333) ** 2, 1e-12, 'normal incidence 2.04 %');
  near(fresnelAmp(1, 1.5168, 45 * D).Rs, 0.0960, 2e-4, 'BK7 Rs at 45°');
  // reflection of unpolarised light at Brewster's angle is completely s-polarised
  const S = mapply(reflectionMueller(1, 1.5168, brewster(1, 1.5168)), UNPOL);
  near(ellipse(S).dop, 1, 1e-12, 'DoP of the Brewster reflection');
});

test('Rayleigh sky: optical depth, polarisation, single-scattering slab', () => {
  near(rayleighTau(550), 0.097, 0.001, 'τ(550 nm) of the sea-level standard atmosphere');
  near(rayleighTau(400) / rayleighTau(700), 9.86, 0.02, 'τ(400)/τ(700): λ⁻⁴ (9.38) steepened by the dispersion of air');
  near(rayleighDoP(1), 0, 1e-15, 'forward scattering (cos γ = 1) unpolarised');
  near(rayleighDoP(Math.cos(Math.PI / 2), 0.94), 0.94, 1e-12, 'peak at 90°');
  // optically thin limit: L = τ / (4π μv) per unit phase function
  near(slabFactor(1e-4, 0.6, 0.3) * 4 * Math.PI, 1e-4 / 0.3, 1e-7, 'thin-slab limit');
  near(slabFactor(0.1, 0.5, 0.5 + 1e-7), slabFactor(0.1, 0.5, 0.5), 1e-6, 'μv = μs limit is continuous');
});

test('lake renderer: the centre pixel matches an independent Mueller chain', () => {
  const o = { W: 41, H: 41, hfov: 40 * D, pitch: -30 * D, height: 1.7, sunEl: 30 * D, sunAz: 130 * D, pmax: 0.75, n: 1.333, depth: 1, ripple: 0, pol: true, polAngle: 70 * D };
  const r = renderLake(o);
  // centre ray, its mirror direction and the frames, built with explicit vectors
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => a.map((x) => x / Math.hypot(...a)), neg = (a) => a.map((x) => -x);
  const v = [0, Math.cos(o.pitch), Math.sin(o.pitch)], rr = [v[0], v[1], -v[2]], nrm = [0, 0, 1];
  const s = [Math.cos(o.sunEl) * Math.sin(o.sunAz), Math.cos(o.sunEl) * Math.cos(o.sunAz), Math.sin(o.sunEl)];
  const kIn = neg(rr), kOut = neg(v);
  const ePerp = unit(cross(s, rr)), e2Sky = cross(kIn, ePerp), sh = unit(cross(kIn, nrm));
  const P = rayleighDoP(dot(rr, s), o.pmax);
  // rotate sky frame → plane-of-incidence frame, reflect, rotate → polariser frame
  const psi1 = Math.atan2(dot(sh, e2Sky), dot(sh, ePerp));
  const up = cross([1, 0, 0], v), ax = [Math.cos(o.polAngle), Math.sin(o.polAngle) * up[1], Math.sin(o.polAngle) * up[2]];
  const e2Out = cross(kOut, sh), alpha = Math.atan2(dot(ax, e2Out), dot(ax, sh));
  const th = Math.acos(-v[2]);
  const k1 = 0.8, k2 = 0.002;
  const M = mmul(polariser(alpha, k1, k2), mmul(reflectionMueller(1, 1.333, th), rotator(psi1)));
  const Sref = mapply(mmul(reflectionMueller(1, 1.333, th), rotator(psi1)), [1, P, 0, 0]);
  const expect = mapply(M, [1, P, 0, 0])[0] / (Sref[0] * (k1 + k2) / 2);
  near(r.stats.centreGlare, expect, 1e-6, 'filtered / neutral-filtered reflected skylight');
  for (const x of r.rgb) assert.ok(Number.isFinite(x) && x >= 0, 'finite, non-negative radiance');
});

test('a vertical polariser removes horizontally polarised glare near Brewster\'s angle', () => {
  const base = { W: 41, H: 41, hfov: 20 * D, pitch: -(90 - 53.1) * D, height: 1.7, sunEl: 40 * D, sunAz: 180 * D, pmax: 0.3, n: 1.333, depth: 1, ripple: 0, pol: true };
  const vert = renderLake({ ...base, polAngle: 90 * D }).stats.centreGlare, hor = renderLake({ ...base, polAngle: 0 }).stats.centreGlare;
  assert.ok(vert < 0.01, `vertical axis at Brewster: ${vert}`);
  near(hor, 2 * 0.8 / 0.802, 0.02, 'horizontal axis passes the s-polarised reflection');
});

test('photoelasticity: Hertz disk in diametral compression', () => {
  const P = 300, Dd = 0.05, t = 0.006, R = Dd / 2, k = P / (Math.PI * Dd * t);
  const c = diskStress(0, 0, P, Dd, t);
  near(c.sx / k, 2, 1e-9, 'centre σx = +2P/(πDt) (tension)');
  near(c.sy / k, -6, 1e-9, 'centre σy = −6P/(πDt)');
  near(principal(c).ds / k, 8, 1e-9, 'centre σ1 − σ2 = 8P/(πDt)');
  // vertical equilibrium of the upper half: ∫ σy t dx across the horizontal diameter = −P
  let F = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) F += diskStress(-R + ((i + 0.5) * Dd) / n, 0, P, Dd, t).sy * (Dd / n) * t;
  near(F, -P, 1e-3 * P, 'force balance');
  // the boundary is traction-free (and here entirely unstressed) away from the load points
  for (const a of [0, 30, 60]) assert.ok(principal(diskStress(0.99999 * R * Math.cos(a * D), 0.99999 * R * Math.sin(a * D), P, Dd, t)).ds < 1e-3 * 8 * k, `free boundary at ${a}°`);
  // stress-optic law: polycarbonate (82 Br), centre fringe order N = 8P/(πD f_σ) with f_σ = λ/C
  near(retardation(82, t, principal(c).ds) / 589e-9, (8 * P) / (Math.PI * Dd * (589e-9 / 82e-12)), 1e-9, 'disk calibration formula');
});

test('Michel-Lévy colours: black at zero, first-order white, first-order red is magenta', () => {
  const L = michelLevy(2000, 2001), at = (G) => [0, 1, 2].map((c) => L.T[Math.round(G) * 3 + c]);
  assert.ok(Math.max(...at(0)) < 1e-12, 'zero retardation is dark between crossed polarisers');
  assert.ok(Math.min(...at(250)) > 0.55, `first-order white at 250 nm: ${at(250)}`);
  const red = at(551);
  assert.ok(red[1] < 0.5 * red[0] && red[1] < 0.5 * red[2], `sensitive tint is magenta: ${red}`);
});

test('birefringent walk-off: maximum at tan θ = nₑ/nₒ; quartz and calcite values', () => {
  for (const c of Object.values(CRYSTALS)) {
    let best = 0, arg = 0;
    for (let th = 0; th < Math.PI / 2; th += 1e-5) { const w = Math.abs(walkOff(c.no, c.ne, th)); if (w > best) { best = w; arg = th; } }
    near(arg, Math.atan(c.ne / c.no), 2e-5, `${c.name} angle of maximum walk-off`);
    near(best, Math.abs(maxWalkOff(c.no, c.ne)), 1e-9, `${c.name} maximum walk-off`);
  }
  near(1000 * Math.abs(Math.tan(walkOff(CRYSTALS.quartz.no, CRYSTALS.quartz.ne, 45 * D))), 5.875, 0.005, 'quartz µm per mm at 45°');
  near(Math.abs(maxWalkOff(CRYSTALS.calcite.no, CRYSTALS.calcite.ne)) / D, 6.26, 0.01, 'calcite maximum walk-off (°)');
  assert.ok(walkOff(CRYSTALS.quartz.no, CRYSTALS.quartz.ne, 0.5) < 0 && walkOff(CRYSTALS.calcite.no, CRYSTALS.calcite.ne, 0.5) > 0, 'positive crystals pull the ray towards the axis, negative ones push it away');
});
