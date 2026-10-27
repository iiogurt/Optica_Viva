// Interferometry: van Cittert–Zernike visibility, Michelson's Betelgeuse, u-v geometry, CLEAN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAS, diskVisibility, firstNull, fringes, fringeVisibility, uvCoverage, skyModel, synthesize, clean, aperturePipeline, ARRAYS } from '../js/lib/interferometry.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test("visibility of a stellar disk; Michelson & Pease's Betelgeuse", () => {
  near((1.22 * 575e-9) / 3.07 / MAS, 47, 0.5, 'null at 3.07 m, 575 nm → 47 mas');
  near(firstNull(47 * MAS, 575e-9), 3.07, 0.02, 'first null of a 47 mas disk');
  near(diskVisibility(47 * MAS, firstNull(47 * MAS, 575e-9), 575e-9), 0, 1e-4, 'zero at the null');
  const lam = 550e-9, th = 20 * MAS;
  for (const B of [1, 3, 5]) {
    const xs = Array.from({ length: 400 }, (_, i) => ((i / 400) - 0.5) * 20 * lam / B);
    near(fringeVisibility(fringes(B, lam, th, xs)), diskVisibility(th, B, lam), 2e-3, `summed fringes at ${B} m`);
  }
});

test('Earth rotation: an east–west baseline seen from the pole traces a circle of radius B/λ', () => {
  const pts = uvCoverage({ lat: 0, enu: [[0, 0], [100, 0]], lam: 0.5 }, Math.PI / 2, 24, 24, -2);
  for (const [u, v] of pts) near(Math.hypot(u, v), 200, 1e-9, 'radius');
  const eht = aperturePipeline({ array: 'eht', dec: 12.39, hours: 24, sky: 'ring', scale: 8, N: 64, niter: 0 });
  assert.ok(eht.res / MAS > 0.02 && eht.res / MAS < 0.035, `EHT resolution ${(eht.res / MAS * 1000).toFixed(1)} µas (≈ 25)`);
  // EHT 2017 on M87 (Paper II, 2019): longest projected baseline ≈ 10 700 km, λ/B ≈ 25 µas
  near(eht.bmax * ARRAYS.eht.lam / 1e6, 10.7, 0.3, 'EHT longest projected baseline (1000 km)');
});

test('dirty beam normalised; CLEAN recovers point sources', () => {
  const N = 64, delta = 1, pts = [];
  for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) if (i * i + j * j <= 400 && (i || j)) pts.push([i / (N * delta), j / (N * delta)]);
  const sky = skyModel('binary', N, delta, 20), syn = synthesize(sky, pts, N, delta);
  near(syn.beam[(N / 2) * N + N / 2], 1, 1e-12, 'beam peak');
  const cl = clean(syn.dirty, syn.beam, N, { gain: 0.1, niter: 400, threshold: 1e-4 });
  const flux = (x0, y0) => cl.comps.filter(([x, y]) => Math.abs(x - x0) <= 1 && Math.abs(y - y0) <= 1).reduce((a, c) => a + c[2], 0);
  // the two components of the binary (1 : 0.6, normalised to unit total flux)
  const f1 = flux(Math.round(32 - 12), Math.round(32 - 4)), f2 = flux(Math.round(32 + 10), Math.round(32 + 6));
  near(f2 / f1, 0.6, 0.06, 'flux ratio of the recovered components');
});

test('Earth-sized arrays: each u-v point is a baseline projected at the same moment both stations see the source', () => {
  // independent of the u-v formula: the source direction s at Greenwich hour angle H, the u-v plane
  // perpendicular to it (v towards the pole, u = v × s, east), and each station's elevation from its
  // local vertical, all in Earth-fixed coordinates
  const arr = ARRAYS.eht, R = 6.371e6, minEl = (15 * Math.PI) / 180, steps = 48;
  const st = arr.geo.map(([la, lo]) => { const p = (la * Math.PI) / 180, l = (lo * Math.PI) / 180; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const decDeg of [12.39, -30, 60]) {
    const dec = (decDeg * Math.PI) / 180, expect = [];
    for (let k = 0; k < steps; k++) {
      const H = (2 * Math.PI * k) / steps, s = [Math.cos(dec) * Math.cos(H), -Math.cos(dec) * Math.sin(H), Math.sin(dec)];
      const v = [-Math.sin(dec) * s[0] / Math.cos(dec), -Math.sin(dec) * s[1] / Math.cos(dec), Math.cos(dec)], u = cross(v, s);
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
        if (Math.asin(dot(st[i], s)) <= minEl || Math.asin(dot(st[j], s)) <= minEl) continue;
        const b = [0, 1, 2].map((q) => R * (st[j][q] - st[i][q]));
        if (Math.hypot(...b) < 1000) continue;
        expect.push([dot(b, u) / arr.lam, dot(b, v) / arr.lam]);
      }
    }
    const got = uvCoverage(arr, dec, 24, steps).filter((_, i) => i % 2 === 0);
    assert.equal(got.length, expect.length, `δ = ${decDeg}°: number of u-v points`);
    got.forEach(([a, b], i) => assert.ok(Math.hypot(a - expect[i][0], b - expect[i][1]) < 1e-6 * Math.hypot(...expect[i]), `δ = ${decDeg}°: point ${i}`));
  }
});
