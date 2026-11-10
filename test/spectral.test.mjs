// The spectral camera (js/lib/spectral.js): band sums, white balance, colour matrix, convolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NB, SW, SH, BAND_LAMBDA, ILLUM, sceneMap, bandData, bandImage, convolveBand, psfKernel, compose, CAMERAS, N_PATCHES } from '../js/lib/spectral.js';
import { CMF } from '../js/lib/colordata.js';

const scene = sceneMap(), sharp = (D) => Array.from({ length: NB }, (_, b) => bandImage(scene, D.L, b));

test('sixteen 25 nm bands; band sums are exact for a flat reflectance and close for the patches', () => {
  assert.equal(BAND_LAMBDA[0], 390); assert.equal(BAND_LAMBDA[NB - 1], 765);
  for (const il of Object.keys(ILLUM)) {
    const D = bandData(il, CAMERAS.cmos.sens), E = ILLUM[il];
    // Y of the perfect white is 1 by construction; the band sum gives the same
    const Yw = D.white.reduce((a, v, b) => a + v * D.eye[1][b], 0);
    assert.ok(Math.abs(Yw - 1) < 1e-5, `${il}: white Y ${Yw}`); // the 780 nm sample lies outside the bands
    // a patch: band sum against the full 5 nm sum
    const Yw5 = E.reduce((a, e, i) => a + e * CMF[1][i], 0), r = D.L[5];
    const Yb = r.reduce((a, v, b) => a + v * D.eye[1][b], 0);
    assert.ok(Yb > 0.02 && Yb < 1, `${il}: patch Y ${Yb} (white ${Yw5 > 0})`);
  }
});

test('the eye sees white as white under every illuminant; a Luther camera has no colour error', () => {
  for (const il of Object.keys(ILLUM)) {
    const D = bandData(il, CAMERAS.luther.sens), r = compose(sharp(D), D);
    // a white bar (perfect white × 0.9) of the bar target
    const p = (100 * SW + 8) * 4;
    for (const img of [r.eye, r.cam]) assert.ok(Math.abs(img[p] - img[p + 1]) <= 2 && Math.abs(img[p + 2] - img[p + 1]) <= 2, `${il}: ${img[p]}, ${img[p + 1]}, ${img[p + 2]}`);
    assert.ok(r.max < 0.3, `${il}: Luther camera ΔE₀₀ max ${r.max}`);
  }
  // a real sensor is not colorimetric: its error grows under a spiky tri-band lamp
  const cm = (il) => { const D = bandData(il, CAMERAS.cmos.sens); return compose(sharp(D), D).mean; };
  assert.ok(cm('D65') > 0.3 && cm('FL11') > cm('D65'), `CMOS ΔE₀₀ D65 ${cm('D65')}, FL11 ${cm('FL11')}`);
  const nb = bandData('FL11', CAMERAS.narrow.sens);
  assert.ok(compose(sharp(nb), nb).mean > cm('FL11'), 'narrow filters are worse still');
  assert.equal(N_PATCHES, 24);
});

test('convolution keeps a flat field flat, shifts exactly and spreads a point into the kernel', () => {
  const flat = new Float32Array(SW * SH).fill(0.4), ks = 9, K = new Float64Array(ks * ks).fill(1 / (ks * ks));
  const f = convolveBand(flat, K, ks);
  for (let p = 0; p < SW * SH; p += 97) assert.ok(Math.abs(f[p] - 0.4) < 1e-6);
  const pt = new Float32Array(SW * SH); pt[60 * SW + 90] = 1;
  const d = new Float64Array(1); d[0] = 1;
  const s = convolveBand(pt, d, 1, 3, -2);
  assert.ok(Math.abs(s[58 * SW + 93] - 1) < 1e-6, 'shift by (+3, −2) px');
  const b = convolveBand(pt, K, ks);
  assert.ok(Math.abs(b[64 * SW + 94] - 1 / 81) < 1e-6 && Math.abs(b[65 * SW + 95]) < 1e-6);
});

test('PSF resampling: a Gaussian PSF keeps its unit sum, its width and its 80 % energy radius', () => {
  const n = 128, s = 0.5, sig = 3, I = new Float64Array(n * n);
  let t = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = Math.exp(-(((x - n / 2) * s) ** 2 + ((y - n / 2) * s) ** 2) / (2 * sig * sig)); I[y * n + x] = v; t += v; }
  for (let k = 0; k < n * n; k++) I[k] /= t;
  const r = psfKernel(I, n, s, 2, 15);
  // 80 % of a 2-D Gaussian lies within σ√(2 ln 5)
  assert.ok(Math.abs(r.ee80 / (sig * Math.sqrt(2 * Math.log(5))) - 1) < 0.03, `ee80 ${r.ee80}`);
  assert.ok(Math.abs(r.K.reduce((a, v) => a + v, 0) - 1) < 1e-9);
  let r2 = 0; for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) r2 += r.K[y * 15 + x] * ((x - 7) ** 2 + (y - 7) ** 2) * 4;
  assert.ok(Math.abs(Math.sqrt(r2) / (sig * Math.SQRT2) - 1) < 0.05, `kernel rms ${Math.sqrt(r2)} µm (pixel adds p²/6)`);
});

test('through a real lens: a singlet blurs violet more than green, and the crop keeps its light', async () => {
  const { TASKS } = await import('../js/lib/tasks.js');
  const { LENSES, paraxial, autoSemiDiameters } = await import('../js/lib/raytrace.js');
  const base = LENSES['plano-convex'], lens = { ...base, epd: base.epd / 2 }, par = paraxial(lens, 540), N = par.efl / lens.epd;
  const D = bandData('D65', CAMERAS.cmos.sens), sd = autoSemiDiameters(base);
  const run = (b) => TASKS.spectralBand({ lens, sd, theta: 0, zImg: par.zImage, N, lam: BAND_LAMBDA[b], lamRef: 540, pitch: 4, L: D.L.map((l) => l[b]) }).result;
  const g = run(6), v = run(2); // 540 and 440 nm
  assert.ok(v.ee80 > 2 * g.ee80, `80 % energy radius 440 nm ${v.ee80} µm vs 540 nm ${g.ee80} µm`);
  assert.ok(Math.abs(v.shift) < 0.05 && Math.abs(g.shift) < 1e-6, 'no lateral colour on axis');
  const sharp = bandImage(sceneMap(), D.L, 6), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(mean(g.out) / mean(sharp) - 1) < 0.02, `light kept: ${mean(g.out) / mean(sharp)}`);
});
