// Exoplanet transits: occulted flux, limb darkening, orbit geometry, duration and noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fluxAt, totalFlux, intensity, orbit, precision, transitSNR, overlapArea, exposureFlux, sampleTransit, zAt, REARTH, RJUP, AU } from '../js/lib/transit.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('uniform star: the depth is the area ratio, and nothing is blocked outside the disc', () => {
  near(1 - fluxAt(0, 0.1, 0, 0), 0.01, 1e-6, 'k = 0.1');
  assert.equal(fluxAt(1.2, 0.1, 0, 0), 1);
  near(1 - fluxAt(1, 0.1, 0, 0), 0.005, 2e-4, 'half the planet on the limb');
});

test('limb darkening: total flux and a deeper centre', () => {
  // ∫ I 2πr dr numerically
  let F = 0; const n = 20000;
  for (let i = 0; i < n; i++) { const r = (i + 0.5) / n; F += intensity(r, 0.4, 0.26) * 2 * Math.PI * r / n; }
  near(F, totalFlux(0.4, 0.26), 1e-5, 'π(1 − u₁/3 − u₂/6)');
  near(1 - fluxAt(0, 0.05, 0.4, 0.26), 0.0025 / (1 - 0.4 / 3 - 0.26 / 6), 2e-6, 'small planet at the centre');
});

test('Kepler and the transit duration: the Earth and HD 209458 b', () => {
  const e = orbit({ P: 365.25, Mstar: 1, Rstar: 1, Rp: REARTH, b: 0 });
  near(e.a / AU, 1, 0.002, 'one astronomical unit');
  near(e.T14 / 3600, 13.1, 0.1, 'Earth: 13 h');
  near(e.depth * 1e6, 84, 0.5, '84 ppm');
  const h = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 1.359 * RJUP, b: 0.51 });
  near(h.T14 / 3600, 3.07, 0.1, 'HD 209458 b: about 3.1 h');
  assert.ok(Number.isNaN(orbit({ P: 3, Mstar: 1, Rstar: 1, Rp: REARTH, b: 1.2 }).T14), 'no transit beyond the limb');
});

test('photon noise falls as 1/√(photons); the aperture is in metres (10⁴ π (D/2)² cm²)', () => {
  const a = precision({ V: 12, D: 0.1, t: 100 }), b = precision({ V: 12, D: 0.2, t: 100 });
  near(a / b, 2, 1e-9, 'twice the aperture, half the noise');
  // V = 0, 1 m, all light, 1 s: 10⁶ · 10⁴ π/4 photons
  near(precision({ V: 0, D: 1, q: 1, t: 1 }), 1e6 / Math.sqrt(1e10 * Math.PI / 4), 1e-9, 'dimensions');
});

// #193: overlap-aware integration, exact at no overlap and full coverage, impossible systems.
test('occulted flux: analytic circle overlap for a uniform star at every z and k, including k ≥ 1', () => {
  for (const k of [0.01, 0.1, 0.5, 0.99, 1, 1.1, 1.83]) for (const z of [0, 0.05, 0.3, 0.8, 0.95, 1, 1.05, Math.abs(1 - k) + 1e-7, 1 + k - 1e-6, 1 + k + 0.1]) {
    near(1 - fluxAt(z, k, 0, 0), overlapArea(z, k) / Math.PI, 1e-8, `z = ${z}, k = ${k}`);
  }
  // the report's cases: a planet that covers the whole star leaves nothing, with or without limb darkening
  for (const [z, k] of [[0, 1.1], [0, 1.83], [0.5, 1.83], [0.1, 1.1]]) assert.equal(fluxAt(z, k, 0.4, 0.26), 0, `z = ${z}, k = ${k}`);
  assert.equal(fluxAt(1.2, 0.2, 0.4, 0.26), 1); assert.equal(fluxAt(1.2, 0.2, 0, 0), 1, 'external contact');
  // limb darkening: converged (32 against 128 nodes) at the centre, on the limb and grazing
  for (const [z, k] of [[0.3, 0.1], [0.98, 0.1], [0.5, 0.6], [0.2, 1.05], [1.05, 0.12]]) near(fluxAt(z, k, 0.4, 0.26), fluxAt(z, k, 0.4, 0.26, 128), 1e-12, `converged z = ${z}, k = ${k}`);
});

test('impossible systems are reported as such, valid misses as misses, and the transit chance stays below 1', () => {
  const inside = orbit({ P: 0.5, Mstar: 0.08, Rstar: 3, Rp: 20 * REARTH, b: 0 });
  assert.equal(inside.valid, false); assert.equal(inside.reason, 'inside');
  // a/R★ = 1.14 > 1 + k, but b = 1.2 needs a wider orbit: no inclination gives it
  const tooWide = orbit({ P: 0.5, Mstar: 0.08, Rstar: 1, Rp: 0.5 * REARTH, b: 1.2 });
  assert.equal(tooWide.reason, 'b'); near(tooWide.aR, 1.142, 1e-3, 'a/R★');
  assert.ok(orbit({ P: 0.5, Mstar: 0.08, Rstar: 1, Rp: 0.5 * REARTH, b: 1.1 }).valid, 'b = 1.1 is possible there');
  const miss = orbit({ P: 3, Mstar: 1, Rstar: 1, Rp: REARTH, b: 1.2 });
  assert.ok(miss.valid && Number.isNaN(miss.T14), 'a real miss');
  // slider extremes: every valid system has a probability in [0, 1] and a duration exactly when b < 1 + k
  for (const P of [0.5, 5000]) for (const M of [0.08, 3]) for (const R of [0.1, 3]) for (const Rp of [0.5, 20]) for (const b of [0, 1.2]) {
    const o = orbit({ P, Mstar: M, Rstar: R, Rp: Rp * REARTH, b });
    if (!o.valid) { assert.ok(['inside', 'b'].includes(o.reason)); continue; }
    assert.ok(o.prob > 0 && o.prob <= 1, `prob ${o.prob}`);
    near(o.prob, (1 + o.k) / o.aR, 1e-12, '(R★ + R_p)/a');
    assert.equal(Number.isFinite(o.T14), b < 1 + o.k, `T14 for P = ${P}, b = ${b}`);
  }
});

// #194: exposures average the light curve; the SNR comes from the sampled deficits.
const HJ = (() => { const o = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 15.2 * REARTH, b: 0.51 }); return { P: 3.5247, aR: o.aR, inc: o.inc, k: o.k, u1: 0.4, u2: 0.26, T14: o.T14 }; })();
const fine = (tc, texp, sys) => exposureFlux(tc, texp, sys, 20000);

test('exposure-averaged flux: short exposures see the light curve, long ones its mean, ingress is smeared', () => {
  const { P, aR, inc, k, u1, u2, T14 } = HJ;
  for (const tc of [0, 0.3 * T14, 0.49 * T14]) near(exposureFlux(tc, 1, HJ), fluxAt(zAt(tc, P, aR, inc), k, u1, u2), 1e-8, `1 s exposure at ${tc}`);
  // an exposure five times the transit centred on it: the mean deficit is the transit's integral / texp
  const long = 5 * T14;
  near(1 - exposureFlux(0, long, HJ), 1 - fine(0, long, HJ), 2e-6, 'long exposure');
  assert.ok(1 - exposureFlux(0, long, HJ) < 0.25 * (1 - fluxAt(zAt(0, P, aR, inc), k, u1, u2)), 'much shallower than the centre');
  // an exposure straddling first contact, against fine integration
  const depth = 1 - fluxAt(0, k, u1, u2);
  for (const texp of [600, 1800]) near(exposureFlux(-T14 / 2, texp, HJ), fine(-T14 / 2, texp, HJ), 1e-3 * depth, `ingress, ${texp} s`);
  assert.equal(exposureFlux(T14 / 2 + 901, 1800, HJ), 1, 'entirely outside: exactly 1');
});

test('transit SNR from the sampled template: white noise adds up, the correlated floor does not', () => {
  // white noise only: √Σd² / σ
  near(transitSNR([1e-3, 2e-3, 0, 1e-3], 1e-3, 0), Math.sqrt(6), 1e-12, 'white');
  // box of depth δ: δ / √(σ_w²/n + σ_r²) (Pont et al. 2006)
  const box = (n) => Array(n).fill(1e-3);
  near(transitSNR(box(50), 2e-3, 1e-4), 1e-3 / Math.sqrt(4e-6 / 50 + 1e-8), 1e-9, 'box');
  // more exposures cannot beat the floor: the SNR approaches δ/σ_r
  assert.ok(transitSNR(box(1e6), 2e-3, 1e-4) < 10 && transitSNR(box(1e6), 2e-3, 1e-4) > 9.9);
  // a grazing (V-shaped) transit counts with its real deficits: less than centre depth × √n
  const g = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 15.2 * REARTH, b: 1.0 }), sys = { P: 3.5247, aR: g.aR, inc: g.inc, k: g.k, u1: 0.4, u2: 0.26, T14: g.T14 };
  const d = sampleTransit(sys, 120, g.T14).map(([, f]) => 1 - f), nIn = d.filter((x) => x > 0).length, centre = 1 - fluxAt(1.0, g.k, 0.4, 0.26);
  assert.ok(transitSNR(d, 1e-3, 0) < 0.8 * (centre / 1e-3) * Math.sqrt(nIn), 'V shape');
  // a transit shorter than one exposure: one or two partial exposures, not a full-depth point
  const e = sampleTransit(HJ, 4 * HJ.T14, 10 * HJ.T14).map(([, f]) => 1 - f);
  assert.ok(e.filter((x) => x > 0).length <= 2 && Math.max(...e) < 0.3 * (1 - fluxAt(0.51, HJ.k, 0.4, 0.26)));
});
