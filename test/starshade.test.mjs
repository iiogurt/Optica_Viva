// Starshades: exact Fresnel results for round screens and the deep shadow of a hypergaussian.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besselJ0, besselJn, shadowField, intensity, fresnelNumber, holeAxial, petalOutline, petalField, petalFieldGrid, petalSeriesField, apertureGrid, petalImage, petalEdges, petalMinLam, petalNodes } from '../js/lib/starshade.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('Bessel J₀ matches tabulated values to 10⁻¹²', () => {
  near(besselJ0(0), 1, 1e-15, 'J₀(0)');
  near(besselJ0(1), 0.765197686557966551, 1e-14, 'J₀(1)');
  near(besselJ0(10), -0.245935764451348335, 1e-13, 'J₀(10)');
  near(besselJ0(12.5), 0.146884054700421, 1e-12, 'J₀(12.5), just past the switch to the asymptotic series');
  near(besselJ0(100), 0.019985850304223122, 1e-14, 'J₀(100)');
  near(besselJ0(2.404825557695773), 0, 1e-15, 'first zero');
  // against Miller's recurrence over the whole range the shadow uses
  for (let x = 0; x <= 60; x += 0.37) near(besselJ0(x), besselJn(0, x), 2e-12, `J₀(${x.toFixed(2)})`);
});

test('Bessel J_n by backward recurrence matches tabulated values', () => {
  near(besselJn(1, 1), 0.440050585744933516, 1e-14, 'J₁(1)');
  near(besselJn(5, 10), -0.234061528186793736, 1e-14, 'J₅(10)');
  near(besselJn(16, 10), 0.00156675619170018, 1e-15, 'J₁₆(10)');
  // far below its order, against the defining power series Σ (−1)^m (x/2)^{2m+n} / (m! (m+n)!)
  const series = (n, x) => { let t = (x / 2) ** n, s = 0; for (let k = 1; k <= n; k++) t /= k; for (let m = 0; m < 40; m++) { s += t; t *= -((x / 2) ** 2) / ((m + 1) * (m + 1 + n)); } return s; };
  for (const [n, x] of [[32, 5], [16, 3], [24, 10]]) near(besselJn(n, x), series(n, x), 1e-12 * Math.abs(series(n, x)), `J_${n}(${x})`);
});

test('the Poisson–Arago spot: the axial intensity behind an opaque disk is exactly 1', () => {
  for (const z of [10, 300, 5000]) near(intensity(shadowField('disk', { R: 1 }, 550e-9, z, [0]))[0], 1, 1e-8, `z = ${z} m`);
});

test("the spot has the J₀² profile of Lommel's solution", () => {
  const lam = 550e-9, z = 1000;
  for (const rho of [1e-4, 2e-4, 4e-4]) near(intensity(shadowField('disk', { R: 1 }, lam, z, [rho], 8000))[0], besselJ0((2 * Math.PI * rho) / (lam * z)) ** 2, 2e-3, `ρ = ${rho} m`);
});

test("Babinet: a circular hole's axis follows 4 sin²(πF/2)", () => {
  const lam = 550e-9;
  for (const z of [400, 500, 650]) {
    const [[re, im]] = shadowField('disk', { R: 1 }, lam, z, [0]);
    near((1 - re) ** 2 + im ** 2, holeAxial(fresnelNumber(1, lam, z)), 1e-6, `z = ${z} m`);
  }
});

test('a hypergaussian starshade suppresses visible starlight to about 10⁻¹⁰', () => {
  const o = { a: 12.5, b: 12.5, n: 6 }, z = 8e7;
  for (const lam of [400e-9, 550e-9, 700e-9]) {
    const I = intensity(shadowField('hyper', o, lam, z, [0, 1, 2]));
    assert.ok(Math.max(...I) < 1e-9, `λ = ${lam * 1e9} nm: ${I.map((v) => v.toExponential(1))}`);
  }
  // fewer Fresnel zones in the near-infrared: the shadow fills in
  assert.ok(intensity(shadowField('hyper', o, 1000e-9, z, [0]))[0] > 1e-8);
});

test('the shadow integral has converged', () => {
  const o = { a: 12.5, b: 12.5, n: 6 }, f = (s) => intensity(shadowField('hyper', o, 550e-9, 4e7, [1, 2], s));
  const [a, b] = [f(2000), f(8000)];
  a.forEach((v, i) => near(v, b[i], 1e-15, `ρ = ${i + 1} m`));
});

// ── Real petals: the exact two-dimensional field behind the binary outline ──────────────────
const SH = { a: 12.5, b: 12.5, n: 6 }, Z = 8e7, L550 = 550e-9;
const I2 = (f, m = 0) => f[2 * m] ** 2 + f[2 * m + 1] ** 2;

test('edge integral: an opaque disk gives e^{iπF} on the axis and the radial integral off it', () => {
  const R = 10, L = petalOutline({ a: R, b: 1, n: 6 }, 0, null, { hub: 2048 }), F = fresnelNumber(R, L550, Z);
  const f = petalField(L, L550, Z, [0, 0.5, 2, 9], [0, 0, 0, 0]);
  near(f[0], Math.cos(Math.PI * F), 1e-13, 'Re E(0)'); near(f[1], Math.sin(Math.PI * F), 1e-13, 'Im E(0)');
  const r = shadowField('disk', { R }, L550, Z, [0.5, 2, 9], 8000);
  r.forEach(([re, im], i) => { near(f[2 * i + 2], re, 1e-12, `Re E, ρ = ${[0.5, 2, 9][i]} m`); near(f[2 * i + 3], im, 1e-12, `Im E, ρ = ${[0.5, 2, 9][i]} m`); });
});

test('real petals: on the axis the field equals the azimuthally averaged one for any number of petals', () => {
  const r = shadowField('hyper', SH, L550, Z, [0])[0];
  for (const N of [8, 16, 24]) {
    const f = petalField(petalOutline(SH, N, null, { lam: L550, z: Z, rhoMax: 1 }), L550, Z, [0], [0]);
    near(f[0], r[0], 1e-12, `Re, N = ${N}`); near(f[1], r[1], 1e-12, `Im, N = ${N}`);
  }
});

test('real petals: the edge integral agrees with the Bessel series of the petal terms (J_N, J_2N, …)', () => {
  const N = 8, L = petalOutline(SH, N, null, { lam: L550, z: Z, rhoMax: 6 });
  for (const [rho, phi] of [[2, 0], [2, 0.2], [4, Math.PI / 8], [6, 0.1]]) {
    const f = petalField(L, L550, Z, [rho * Math.cos(phi)], [rho * Math.sin(phi)]), g = petalSeriesField(SH, N, L550, Z, rho, phi, 6);
    near(f[0], g[0], 1e-12, `Re E(${rho} m, ${phi.toFixed(2)})`); near(f[1], g[1], 1e-12, `Im E(${rho} m, ${phi.toFixed(2)})`);
  }
  // with 8 petals the petal terms matter: off the axis the shadow is not the azimuthal average
  const avg = intensity(shadowField('hyper', SH, L550, Z, [2]))[0], at = I2(petalField(L, L550, Z, [2], [0]));
  assert.ok(Math.abs(at / avg - 1) > 0.5, `8 petals at 2 m: ${at.toExponential(2)} vs average ${avg.toExponential(2)}`);
});

test('real petals: N-fold and mirror symmetry, and the azimuthal mean is the radial model', () => {
  const N = 16, L = petalOutline(SH, N, null, { lam: L550, z: Z, rhoMax: 4 }), rho = 3.5, na = 64;
  const ph = Array.from({ length: na }, (_, i) => (2 * Math.PI * i) / na);
  const f = petalField(L, L550, Z, ph.map((p) => rho * Math.cos(p)), ph.map((p) => rho * Math.sin(p)));
  // 64 directions are 4 per petal period: compare every point with its turned and mirrored copies
  for (let i = 0; i < na; i++) {
    const j = (i + 4) % na, m = (na - i) % na;
    near(f[2 * i], f[2 * j], 1e-12, 'turned by 2π/N'); near(f[2 * i + 1], f[2 * m + 1], 1e-12, 'mirrored');
  }
  let re = 0, im = 0;
  for (let i = 0; i < na; i++) { re += f[2 * i] / na; im += f[2 * i + 1] / na; }
  const [r] = shadowField('hyper', SH, L550, Z, [rho], 32000);
  near(re, r[0], 1e-12, 'mean Re'); near(im, r[1], 1e-12, 'mean Im');
});

test('real petals: the grid evaluator equals the direct one', () => {
  const L = petalOutline(SH, 16, { kind: 'clock', d: 1e-3 }, { lam: L550, z: Z, rhoMax: 3 }), g = apertureGrid(4, 12);
  const grid = petalFieldGrid(L, L550, Z, g.x0, g.dx, 12, g.ys), px = [], py = [];
  for (const y of g.ys) for (let i = 0; i < 12; i++) { px.push(g.x0 + i * g.dx); py.push(y); }
  const f = petalField(L, L550, Z, px, py);
  for (let i = 0; i < f.length; i++) near(grid[i], f[i], 1e-13, `component ${i}`);
});

// mean intensity over a 4 m aperture on a 12 × 12 grid
function apMean(err, N = 16, opts = {}) {
  const g = apertureGrid(4, 12), L = petalOutline(SH, N, err, { lam: L550, z: Z, rhoMax: 3, ...opts });
  const f = petalFieldGrid(L, L550, Z, g.x0, g.dx, 12, g.ys);
  return { mean: g.idx.reduce((s, q) => s + I2(f, q) / g.idx.length, 0), f, g };
}

test('petal errors: converged, vanishing with the error, symmetric as the shape, linear in a slide', () => {
  const ideal = apMean(null);
  for (const kind of ['clock', 'width', 'shift']) near(apMean({ kind, d: 0 }).mean, ideal.mean, 1e-20, `${kind}, d = 0`);
  // a turn is not linear in its size: the petal pushes into its neighbour along the valley, over a
  // length that grows with the turn. Turning the other way mirrors the shadow about the petal's axis.
  const p = apMean({ kind: 'clock', d: 3e-4 }), m = apMean({ kind: 'clock', d: -3e-4 }), G = 12;
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const a = 2 * (i * G + j), b = 2 * ((G - 1 - i) * G + j);
    near(p.f[a], m.f[b], 1e-13, 'Re, mirrored'); near(p.f[a + 1], m.f[b + 1], 1e-13, 'Im, mirrored');
  }
  // wider petals keep the N-fold symmetry
  const Lw = petalOutline(SH, 16, { kind: 'width', d: 2e-4 }, { lam: L550, z: Z, rhoMax: 3 }), ph = Array.from({ length: 32 }, (_, i) => (2 * Math.PI * i) / 32);
  const fw = petalField(Lw, L550, Z, ph.map((q) => 2.5 * Math.cos(q)), ph.map((q) => 2.5 * Math.sin(q)));
  for (let i = 0; i < 32; i++) { near(fw[2 * i], fw[2 * ((i + 2) % 32)], 1e-13, 'width: Re turned by 2π/N'); near(fw[2 * i + 1], fw[2 * ((i + 2) % 32) + 1], 1e-13, 'width: Im turned by 2π/N'); }
  // sliding one petal along its axis moves its smooth edges without touching a neighbour: linear
  const a = apMean({ kind: 'shift', d: 5e-4 }).f, b = apMean({ kind: 'shift', d: 1e-3 }).f;
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { const da = a[i] - ideal.f[i], db = b[i] - ideal.f[i]; num += (db - 2 * da) ** 2; den += db ** 2; }
  assert.ok(den > 0 && Math.sqrt(num / den) < 0.02, `shift: field change not linear (${Math.sqrt(num / den)})`);
  for (const kind of ['clock', 'width']) {
    const c = apMean({ kind, d: 1e-3 }).mean, f = apMean({ kind, d: 1e-3 }, 16, { panels: 64, order: 16, hub: 2048 }).mean;
    near(c, f, 1e-6 * f, `${kind}: doubling the edge points`);
  }
});

test('petal errors: the slide is a rigid translation of the petal, to first order', () => {
  // translate points of petal 0's upper edge by d along its axis and compare their angle with the
  // modelled edge at their new radius; the difference must be of second order (d²/r)
  const N = 16, miss = (d, r) => {
    const psi = petalEdges(0, r, SH, N)[1], x = r * Math.cos(psi) + d, y = r * Math.sin(psi);
    return petalEdges(0, Math.hypot(x, y), SH, N, { kind: 'shift', d, petal: 0 })[1] - Math.atan2(y, x);
  };
  for (const r of [16, 20, 25, 30]) {
    const m1 = miss(1e-3, r), m2 = miss(2e-3, r);
    // under 0.1 µm at the edge for a 1 mm slide, and growing as d² (the first-order terms are exact)
    assert.ok(Math.abs(m1) * r < 1e-7, `r = ${r} m: ${m1 * r} m`);
    if (Math.abs(m1) > 1e-11) near(m2 / m1, 4, 0.2, `r = ${r} m: second order`);
  }
});

test('petal errors: how much each kind leaks over a 4 m telescope', () => {
  const ideal = apMean(null).mean;
  assert.ok(ideal > 3e-12 && ideal < 1e-11, `ideal ${ideal}`);
  const clock = apMean({ kind: 'clock', d: 1e-3 }).mean, width = apMean({ kind: 'width', d: 1e-4 }).mean, shift = apMean({ kind: 'shift', d: 1e-3 }).mean;
  assert.ok(clock > 5 * ideal, `1 mm sideways: ${clock}`);
  assert.ok(width > 20 * ideal, `edges 0.1 mm out: ${width}`);
  // a slide keeps the smooth profile but opens slits along the valleys: it leaks, but less than a turn
  assert.ok(shift > 2 * ideal && shift < clock, `1 mm along the axis: ${shift} (ideal ${ideal}, turned ${clock})`);
});

test('petal work budget: the number of edge points grows as 1/λ and is capped', () => {
  const r = 4 / Math.SQRT2;
  assert.ok(petalNodes(SH, 16, 300e-9, Z, r) < 30000, 'the default shade fits at 300 nm');
  const l = petalMinLam(SH, 16, 1e7, r, 30000);
  assert.ok(l > 300e-9 && l < 1100e-9 && petalNodes(SH, 16, l, 1e7, r) <= 30000 && petalNodes(SH, 16, 0.99 * l, 1e7, r) > 30000, `10 000 km: from ${l * 1e9} nm`);
});

test("the telescope's image: an open aperture peaks at contrast 1, and a turned petal's leak sits beside it", () => {
  const G = 48, g = apertureGrid(4, G), n = 256;
  const open = petalImage({ field: new Float64Array(2 * G * G).map((_, i) => (i % 2 ? 0 : 1)), idx: g.idx, G, D: 4, lam: L550, n });
  near(open.I[(n / 2) * n + n / 2], 1, 1e-12, 'peak of the unobstructed star');
  near(open.pix, L550 / (n * (4 / G)), 1e-20, 'pixel size');
  const L = petalOutline(SH, 16, { kind: 'clock', d: 1e-3, petal: 0 }, { lam: L550, z: Z, rhoMax: 3 });
  const im = petalImage({ field: petalFieldGrid(L, L550, Z, g.x0, g.dx, G, g.ys), idx: g.idx, G, D: 4, lam: L550, n });
  // the brightest pixel outside the inner working angle lies towards petal 0 (+x), near its tip
  const iwa = (SH.a + SH.b) / Z;
  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const th = Math.hypot(x - n / 2, y - n / 2) * im.pix;
    if (th > iwa && th < 3 * iwa && im.I[y * n + x] > best) { best = im.I[y * n + x]; bx = x - n / 2; by = y - n / 2; }
  }
  assert.ok(bx > 0 && Math.abs(by) < bx / 2, `brightest leak at (${bx}, ${by}) px`);
});
