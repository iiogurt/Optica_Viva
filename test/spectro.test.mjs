// Spectroscopy: grating equation, blaze, resolving power, Rayleigh criterion, prism dispersion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffractionAngle, wavelengthAt, blazeAngle, blazeEfficiency, gratingR, prismR, profile, observe, dndl } from '../js/lib/spectro.js';
import { index, LINES } from '../js/lib/glass.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('grating equation, Littrow blaze and order overlap', () => {
  const rho = 600, thB = blazeAngle(500, rho);
  near(Math.sin(thB), (500 * 600) / 2e6, 1e-12, '2 sin θB = λB ρ');
  near(diffractionAngle(1, 500, rho, thB), thB, 1e-12, 'Littrow: β = α at the blaze wavelength');
  near(blazeEfficiency(1, 500, rho, thB, thB), 1, 1e-12, 'peak efficiency in order 1');
  near(blazeEfficiency(2, 250, rho, thB, thB), 1, 1e-12, 'λB/2 blazed in order 2');
  assert.ok(blazeEfficiency(1, 900, rho, thB, thB) < 0.6, 'efficiency falls away from the blaze');
  const b = diffractionAngle(1, 650, rho, 0.2);
  near(wavelengthAt(1, b, rho, 0.2), 650, 1e-9, 'round trip');
  near(wavelengthAt(2, b, rho, 0.2), 325, 1e-9, 'order 2 at the same angle carries λ/2');
  assert.ok(Number.isNaN(diffractionAngle(3, 900, 1200, 0)), 'evanescent order');
});

test('resolving power: R = mN, the Rayleigh dip 8/π² and the sodium doublet', () => {
  near(gratingR(2, 600, 10), 12000, 1e-9, 'R = m ρ W');
  const c = 589, R = 1000, sep = c / R, I = (x) => profile(x - c, c, R) + profile(x - c - sep, c, R);
  near(I(c + sep / 2) / I(c), 8 / Math.PI ** 2, 1e-4, 'two equal lines at the Rayleigh separation');
  // Na D (589.0 / 589.6 nm) through a real instrument profile
  const lams = Array.from({ length: 801 }, (_, i) => 588.5 + i * 0.002), dip = (Rp) => {
    const o = observe('na', lams, Rp), at = (l) => o[Math.round((l - 588.5) / 0.002)];
    return at(589.29) / Math.min(at(588.995), at(589.592));
  };
  assert.ok(dip(3000) < 0.2, 'resolved at R = 3000');
  assert.ok(dip(400) > 0.95, 'blended at R = 400');
});

test('prism resolving power R = b |dn/dλ| with Sellmeier dispersion', () => {
  const avg = (index('N-SF11', LINES.F) - index('N-SF11', LINES.C)) / (LINES.C - LINES.F);
  near(prismR('N-SF11', 571, 50) / (50e6 * avg), 1, 0.15, 'N-SF11, 50 mm, vs the F–C mean dispersion');
  assert.ok(prismR('N-SF11', 589, 50) > 3 * prismR('N-BK7', 589, 50), 'dense flint disperses > 3× crown');
  assert.ok(Math.abs(dndl('N-BK7', 420)) > 2.5 * Math.abs(dndl('N-BK7', 700)), 'blue spread more than red');
});

test('solar lines keep their depth at high R and wash out at low R', () => {
  const lams = Array.from({ length: 301 }, (_, i) => 588 + i * 0.01), depth = (R) => { const o = observe('sun', lams, R); return 1 - o[100] / Math.max(...o); };
  assert.ok(depth(50000) > 0.6, `D2 depth at R = 50000: ${depth(50000)}`);
  assert.ok(depth(500) < 0.2, `D2 depth at R = 500: ${depth(500)}`);
});

test('slit-limited échelle spectrograph: UVES-like R, slit losses, order stacking', async () => {
  const { slitR, slitThroughput, echelleOrders, echellePosition, sunAt, combinedR } = await import('../js/lib/spectro.js');
  const thB = Math.atan(4);
  near(slitR(thB, 200, 1, 8.2) / 40000, 1, 0.02, 'R4 échelle, 200 mm beam, 1″ slit on 8.2 m (UVES ≈ 40 000)');
  near(slitR(thB, 200, 0.5, 8.2) / slitR(thB, 200, 1, 8.2), 2, 1e-12, 'R ∝ 1/φ');
  near(slitThroughput(1, 1), 0.761, 1e-3, 'slit = FWHM passes erf(√ln2)');
  near(slitThroughput(10, 1), 1, 1e-6, 'wide slit passes everything');
  near(combinedR(1e4, 1e9), 1e4, 1e-3, 'diffraction negligible');
  const o = echelleOrders(31.6, thB, 380, 700), opt = { rho: 31.6, thB, fcam: 750, glass: 'N-SF11', apex: Math.PI / 3, lamRef: 520 };
  near(o.lamB(o.mMin) * o.mMin, (2e6 * Math.sin(thB)) / 31.6, 1e-9, 'm λB = 2 d sin θB');
  const gap = (m) => echellePosition(opt, m, o.lamB(m))[1] - echellePosition(opt, m + 1, o.lamB(m + 1))[1];
  assert.ok(gap(100) < 0 && Math.abs(gap(150)) > Math.abs(gap(100)), 'orders separate, more widely in the blue (prism)');
  // broadening conserves the equivalent width of a line
  const ew = (R) => { let a = 0; for (let l = 586; l <= 592; l += 0.0005) a += (1 - sunAt(l, R) / sunAt(586, R)) * 0.0005; return a; };
  near(ew(2000) / ew(1e6), 1, 0.05, 'equivalent width of Na D conserved');
});
