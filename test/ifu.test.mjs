// Integral-field spectroscopy (js/lib/ifu.js): photometry, flux through slicing and dispersion,
// recovery of the beam-smeared and slit-shifted velocity field, line widths in quadrature, photon-
// limited velocity precision and the bias of the first moment at the S/N threshold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../js/lib/random.js';
import { expose, observe, extract, READ_NOISE, measure, lsfSigma, expectedInst, abPhotons, resolvingPower, blended, LINES, RATIOS, AREA, THROUGHPUT, NLAM, NALONG, GAP, C_KMS } from '../js/lib/ifu.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const spec = (cube, sp) => cube.subarray(sp * NLAM, sp * NLAM + NLAM);
const noiseFree = (E) => extract({ ...E, skyRate: 0 }, E.frame, 1);
// One spaxel's sky-subtracted spectrum from t seconds, with the same per-pixel noise as observe()
// (Poisson in source + sky, Gaussian read noise); pixels are independent, so one column suffices.
function noisySpaxel(E, sp, t, seed, { sky = true, readNoise = READ_NOISE } = {}) {
  const rng = makeRng(seed), s = Math.floor(sp / NALONG), col = s * (NALONG + GAP) + (sp % NALONG), bg = sky ? E.skyRate : 0, out = new Float32Array(NLAM);
  for (let q = 0; q < NLAM; q++) out[q] = rng.poisson((E.frame[q * E.cols + col] + bg) * t) + (readNoise ? rng.g() * readNoise : 0) - bg * t;
  return out;
}

test('AB photometry matches the photon zero point used elsewhere', () => {
  // stacking.js: V = 0 gives about 1.0 × 10⁶ photons s⁻¹ cm⁻² per 100 nm, i.e. 10⁸ s⁻¹ m⁻² nm⁻¹
  near(abPhotons(0, 550) / 1e8, 1, 0.03, 'AB 0 at 550 nm');
  near(abPhotons(2.5, 656) / abPhotons(0, 656), 0.1, 1e-12, '2.5 magnitudes is a factor of 10');
});

test('a full noisy exposure has the expected mean and variance per pixel', () => {
  const E = expose({ R0: 5000, w: 0.5, seeing: 0.8 }), t = 600, obs = observe(E, t, 9), sky = E.skyRate * t;
  let n = 0, d = 0, z = 0;
  for (let q = 0; q < NLAM; q++) for (let c = 0; c < E.cols; c++) {
    if (c % (NALONG + GAP) >= NALONG) continue;
    const mu = (E.frame[q * E.cols + c] + E.skyRate) * t; d += obs[q * E.cols + c] - mu; z += (obs[q * E.cols + c] - mu) ** 2 / (mu + READ_NOISE ** 2); n++;
  }
  near(d / n, 0, 3 * Math.sqrt((sky + READ_NOISE ** 2) / n) + 0.05, 'mean residual');
  near(z / n, 1, 0.02, 'normalised variance');
});

test('slicer geometry: the slice is the slit', () => {
  near(resolvingPower(5000, 0.25), 5000, 1e-9, 'design slice');
  near(resolvingPower(5000, 1), 1250, 1e-9, 'four times wider, four times lower R');
  const E = expose({ R0: 5000, w: 0.5, seeing: 0.8 });
  assert.equal(E.ns, 16); assert.equal(E.cols, 16 * (NALONG + GAP) - GAP); assert.equal(E.frame.length, E.cols * NLAM);
});

test('every photon of the lines reaches the detector', () => {
  // no seeing (nothing leaves the field), no continuum, Hα and [N II] well inside the window
  const fluxHa = 3e-17, z = 0.02, E = expose({ R0: 5000, w: 0.5, seeing: 0, contMag: 99, fluxHa, z });
  const perW = (lam) => (lam * 1e-9) / (6.62607015e-34 * 2.99792458e8);
  const expected = ['NII-a', 'Ha', 'NII-b'].reduce((s, id) => s + fluxHa * RATIOS[id] * perW(LINES.find((L) => L.id === id).lam * (1 + z)), 0) * AREA * THROUGHPUT;
  const got = E.frame.reduce((s, v) => s + v, 0);
  near(got / expected, 1, 1e-4, 'detected / emitted');
});

test('the rebuilt cube recovers the beam-smeared, slit-shifted velocity field', () => {
  for (const [R0, w, seeing] of [[2500, 0.25, 0.8], [5000, 0.5, 0.8], [10000, 1, 0.8], [10000, 0.25, 1.6]]) {
    const E = expose({ R0, w, seeing, incl: 60, vmax: 200 }), cube = noiseFree(E), inst = expectedInst(E), fmax = Math.max(...E.truthF);
    let n = 0, e2 = 0;
    for (let sp = 0; sp < E.ns * NALONG; sp++) {
      if (E.truthF[sp] < 0.08 * fmax) continue;
      const m = measure(spec(cube, sp), E.grid, 0.02, { vmax: 200, inst }); n++; e2 += (m.v - E.truthV[sp]) ** 2;
    }
    assert.ok(n > 60, 'enough spaxels');
    assert.ok(Math.sqrt(e2 / n) < 0.2, `R₀ ${R0}, slices ${w}″: rms ${Math.sqrt(e2 / n).toFixed(3)} km/s`);
  }
});

test('beam smearing flattens the inner rotation; wide slices shift compact light', () => {
  const sharp = expose({ R0: 10000, w: 0.25, seeing: 0.3, incl: 60, vmax: 200 }), soft = expose({ R0: 10000, w: 0.25, seeing: 1.6, incl: 60, vmax: 200 });
  // the steepest velocity step between neighbouring spaxels along a slice near the centre
  const steep = (E) => { let g = 0; const s = E.ns / 2; for (let a = 8; a < NALONG - 9; a++) g = Math.max(g, Math.abs(E.truthV[s * NALONG + a + 1] - E.truthV[s * NALONG + a])); return g; };
  assert.ok(steep(soft) < 0.6 * steep(sharp), `gradient ${steep(soft).toFixed(1)} against ${steep(sharp).toFixed(1)} km/s per spaxel`);
  // with 1″ slices and good seeing, light off the slice centre lands at other wavelengths: the
  // measured field departs from the light-weighted rotation by far more than the slit-aware truth
  const E = expose({ R0: 10000, w: 1, seeing: 0.3, incl: 60, vmax: 200, contMag: 99 }), cube = noiseFree(E), inst = expectedInst(E);
  const plain = expose({ R0: 10000, w: 0.25, seeing: 0.3, incl: 60, vmax: 200, contMag: 99 });
  let dev = 0;
  for (let s = 0; s < E.ns; s++) for (let a = 0; a < NALONG; a++) {
    const sp = s * NALONG + a; if (E.truthF[sp] < 0.1 * Math.max(...E.truthF)) continue;
    const m = measure(spec(cube, sp), E.grid, 0.02, { vmax: 200, inst });
    near(m.v, E.truthV[sp], 0.3, `slit-aware truth at ${s},${a}`);
    // the same sky region seen through four 0.25″ slices, light-weighted, without the slit shift
    let f = 0, fv = 0; for (let q = 0; q < 4; q++) { const k = (4 * s + q) * NALONG + a; f += plain.truthF[k]; fv += plain.truthF[k] * plain.truthV[k]; }
    dev = Math.max(dev, Math.abs(m.v - fv / f));
  }
  assert.ok(dev > 5, `slit effect ${dev.toFixed(1)} km/s`);
});

test('line widths add in quadrature with the calibrated instrumental profile', () => {
  for (const [R0, w, sg] of [[5000, 0.25, 25], [5000, 0.25, 60], [10000, 0.5, 40], [2500, 0.25, 80], [10000, 1, 20]]) {
    const E = expose({ R0, w, seeing: 1.6, incl: 0, sigma: sg }), si = lsfSigma(E), cube = noiseFree(E);
    assert.ok(!blended(E, si), 'Hα resolved from [N II]');
    const m = measure(spec(cube, (E.ns / 2) * NALONG + NALONG / 2), E.grid, 0.02, { vmax: 100, sigInst: si, inst: expectedInst(E) });
    near(m.sigma, sg, 0.6, `R₀ ${R0}, ${w}″ slices, σ ${sg} km/s`);
  }
  const low = expose({ R0: 2500, w: 1, seeing: 1.6, incl: 0 });
  assert.ok(blended(low, lsfSigma(low)), 'R = 625 blends Hα with [N II]');
});

test('photon-limited velocity precision is σ/√N', () => {
  const E = expose({ R0: 5000, w: 0.25, seeing: 0.8, incl: 60, vmax: 200, contMag: 99 }), inst = expectedInst(E);
  const sp = (E.ns / 2) * NALONG + NALONG / 2 + 4, vs = [], Ns = [], sg = [];
  for (let k = 0; k < 200; k++) {
    const m = measure(noisySpaxel(E, sp, 200, 100 + k, { sky: false, readNoise: 0 }), E.grid, 0.02, { vmax: 200, inst }); vs.push(m.v); Ns.push(m.flux); sg.push(m.sigObs);
  }
  const mean = vs.reduce((a, b) => a + b) / vs.length, sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (vs.length - 1));
  const pred = (C_KMS * (sg.reduce((a, b) => a + b) / sg.length)) / E.grid.lc / Math.sqrt(Ns.reduce((a, b) => a + b) / Ns.length);
  near(sd / pred, 1, 0.12, 'scatter / prediction');
  near(mean, E.truthV[sp], 3 * sd / Math.sqrt(vs.length), 'unbiased');
});

test('at the S/N = 5 mask the first moment is not noticeably biased', () => {
  const E = expose({ R0: 5000, w: 0.25, seeing: 0.8, incl: 60, vmax: 200 }), inst = expectedInst(E);
  const sp = (E.ns / 2) * NALONG + NALONG / 2 + 9, vs = [];
  for (let k = 0; k < 300; k++) { const m = measure(noisySpaxel(E, sp, 80, 500 + k), E.grid, 0.02, { vmax: 200, inst }); if (m.snr >= 5) vs.push(m.v); }
  const mean = vs.reduce((a, b) => a + b) / vs.length, sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (vs.length - 1));
  assert.ok(vs.length > 150, 'most spectra pass the mask');
  assert.ok(Math.abs(mean - E.truthV[sp]) < 0.3 * sd, `bias ${(mean - E.truthV[sp]).toFixed(1)} against scatter ${sd.toFixed(1)} km/s`);
});
