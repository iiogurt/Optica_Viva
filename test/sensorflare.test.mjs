// Sensor (red-dot) flare: grating orders of the microlens surface, the round trip to the filter,
// and the picture drawn from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAM, SOURCES, cellOrders, microlensOrders, filterTR, edgeAt, NEFF, landing, criticalN, returnOrders, orderRGB, flareImage, flareSummary, airy, blurDisc } from '../js/lib/sensorflare.js';
import { fft1d } from '../js/lib/fft.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const base = { p: 4e-6, h: 0.5e-6, d: 1e-3, N: 11, Rs: 0.05, filter: { kind: 'interference', edge: 650, width: 8, Rmin: 0.01 }, src: SOURCES.lamp };
// a source with all its light at 650 nm
const mono = LAM.map((l) => (l === 650 ? 1 : 0));
const besselJ = (m, x) => { let s = 0, t = (x / 2) ** m; for (let k = 1; k <= m; k++) t /= k; for (let k = 0; k < 60; k++) { s += t; t *= -(x * x) / 4 / ((k + 1) * (k + 1 + m)); } return s; };

test('grating orders of a reflecting cell: flat, square-wave and sinusoidal phase', () => {
  const flat = cellOrders(() => 0, 32).eta;
  near(flat(0, 0), 1, 1e-12, 'flat: all in the zero order'); near(flat(1, 0) + flat(0, 1) + flat(1, 1), 0, 1e-12, 'flat: nothing else');
  // binary phase φ over half the cell: η₀ = cos²(φ/2), η±1 = (2/π)² sin²(φ/2)
  for (const ph of [Math.PI / 2, Math.PI]) {
    const e = cellOrders((u) => (u < 0.5 ? ph : 0), 128).eta;
    near(e(0, 0), Math.cos(ph / 2) ** 2, 1e-12, `square wave ${ph}: zero order`);
    near(e(1, 0), (4 / Math.PI ** 2) * Math.sin(ph / 2) ** 2, 1e-4, `square wave ${ph}: first order`);
    near(e(2, 0), 0, 1e-12, 'no even orders');
  }
  // sinusoidal phase a sin 2πu: η_m = J_m(a)²
  for (const m of [0, 1, 2, 3]) near(cellOrders((u) => 2.4 * Math.sin(2 * Math.PI * u), 64).eta(m, 0), besselJ(m, 2.4) ** 2, 1e-10, `J_${m}²`);
  // a microlens: everything goes somewhere (Parseval)
  const { eta } = cellOrders((u, v) => (4 * Math.PI * 0.6e-6 / 650e-9) * (1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.5), 64);
  let s = 0;
  for (let k = -32; k < 32; k++) for (let m = -32; m < 32; m++) s += eta(m, k);
  near(s, 1, 1e-10, 'Parseval');
  // taller microlenses spread more light out of the zero order
  assert.ok(microlensOrders(0.6e-6, 650e-9, 0)[0].eta < microlensOrders(0.2e-6, 650e-9, 0)[0].eta);
});

test('a finite patch of pixels sends its light where the orders say: sin θ = mλ/p', () => {
  // 16 microlens periods of 64 samples, sampled 1-D: the far field peaks at 16 cycles across the
  // patch, i.e. at the spatial frequency 1/p
  const P = 16, S = 64, n = P * S, re = new Float64Array(n), im = new Float64Array(n), phase = (u) => 6 * (1 - 4 * (u - 0.5) ** 2);
  for (let i = 0; i < n; i++) { const ph = phase(((i % S) + 0.5) / S); re[i] = Math.cos(ph); im[i] = Math.sin(ph); }
  fft1d(re, im);
  const pow = Array.from(re, (r, i) => (r * r + im[i] * im[i]) / (n * n));
  near(pow[P], cellOrders((u) => phase(u), S).eta(1, 0), 1e-12, 'order 1 from the patch');
  for (let i = 1; i < P; i++) near(pow[i], 0, 1e-20, `nothing between orders (${i})`);
  // and the direction: frequency 1/p → sin θ = λ/p; it lands 2d tan θ away
  const s = 650e-9 / 4e-6;
  near(landing(s, 1e-3), 2e-3 * Math.tan(Math.asin(s)), 1e-15, 'landing');
});

test('the interference filter reflects what it does not pass, and its edge moves blue with angle', () => {
  const f = base.filter;
  for (const l of [500, 640, 650, 700]) for (const s of [0, 0.3]) { const [T, R] = filterTR(l, s, f); near(T + R, 1, 1e-15, 'T + R = 1'); }
  near(edgeAt(f, 0.5), 650 * Math.sqrt(1 - 0.25 / NEFF ** 2), 1e-12, 'λ_c(θ)');
  near(filterTR(650, 0, f)[0], 0.495, 1e-12, 'half-way at the edge (less the residual reflection)');
  // the round trip T(λ, 0)·R(λ, θ) is largest between the two edges
  const s = 0.4, tr = LAM.map((l) => filterTR(l, 0, f)[0] * filterTR(l, s, f)[1]), at = LAM[tr.indexOf(Math.max(...tr))];
  assert.ok(at > edgeAt(f, s) - 5 && at < 655, `peak at ${at}`);
  const [Ta, Ra] = filterTR(500, 0.4, { kind: 'absorptive', edge: 650, width: 20, Rmin: 0.005 });
  near(Ra, 0.005, 0, 'absorbing glass: only its residual reflection'); assert.ok(Ta > 0.99 * 0.995);
});

test('each order lands as a disc that carries its energy, centred where the grating sends it', () => {
  const o = { ...base, src: mono }, one = returnOrders(o).filter((e) => e.m === 1 && e.n === 0), half = 0.8e-3, n = 640;
  const r = flareImage(o, { n, half, core: false }, one), pix = (2 * half) / n, sc = (pix * pix) / (o.p * o.p);
  let E = 0, cx = 0;
  for (let k = 0; k < n * n; k++) { E += r.img[3 * k] * sc; cx += (-half + ((k % n) + 0.5) * pix) * r.img[3 * k] * sc; }
  const want = orderRGB(one[0], o)[0];
  near(E / want, 1, 2e-3, 'energy');
  near(cx / E / landing(650e-9 / o.p, o.d), 1, 0.01, 'centroid at 2d tan θ');
  // its width is about 2d/N
  let a = Infinity, b = -Infinity;
  for (let i = 0; i < n; i++) if (r.img[3 * ((n / 2) * n + i)] > 0) { const x = -half + (i + 0.5) * pix; a = Math.min(a, x); b = Math.max(b, x); }
  near((b - a) / ((2 * o.d) / o.N), 1, 0.05, 'diameter');
});

test('neighbouring dots separate exactly above N = p/λ', () => {
  const nc = criticalN(4e-6, 650e-9), half = 0.5e-3, n = 800, pix = (2 * half) / n;
  const gap = (N) => {
    const o = { ...base, N, src: mono }, two = returnOrders(o).filter((e) => e.n === 0 && (e.m === 0 || e.m === 1)), r = flareImage(o, { n, half, core: false }, two);
    const x1 = landing(650e-9 / o.p, o.d), i0 = Math.round((0 + half) / pix), i1 = Math.round((x1 + half) / pix);
    let lo = Infinity;
    for (let i = i0; i <= i1; i++) lo = Math.min(lo, r.img[3 * ((n / 2) * n + i)]);
    return lo;
  };
  near(nc, 6.1538, 1e-4, 'f/6.2 for 4 µm pixels at 650 nm');
  assert.equal(gap(nc * 1.06), 0, 'a dark gap when stopped down past N_c');
  assert.ok(gap(nc * 0.94) > 0, 'overlap when opened up');
});

test('the direct image holds the source light; the blur of the Sun keeps it', () => {
  near(airy(0), 1, 0, 'Airy peak'); near(airy(3.831706), 0, 1e-10, 'first dark ring');
  const half = 0.6e-3, n = 600, r = flareImage(base, { n, half, core: true }, []), sc = ((2 * half) / n) ** 2 / (base.p * base.p);
  for (let c = 0; c < 3; c++) { let E = 0; for (let k = 0; k < n * n; k++) E += r.img[3 * k + c] * sc; near(E, 1, 0.01, `channel ${c}`); }
  const b = blurDisc(r.img, n, 12);
  let A = 0, B = 0;
  for (let k = 0; k < n * n; k++) { A += r.img[3 * k]; B += b[3 * k]; }
  near(B / A, 1, 1e-3, 'blur keeps the total');
});

test('reflecting filters make red dots; absorbing glass makes them faint and grey', () => {
  const dots = flareSummary(base), top = dots.find((q) => q.m || q.n);
  assert.ok(top.rgb[0] > 10 * top.rgb[1], `red: ${top.rgb}`);
  const abs = flareSummary({ ...base, filter: { kind: 'absorptive', edge: 650, width: 20, Rmin: 0.005 } }).find((q) => q.m || q.n);
  assert.ok(Math.log2(top.total / abs.total) > 3, 'at least three stops fainter');
  assert.ok(abs.rgb[0] < 3 * abs.rgb[1], `less red: ${abs.rgb}`);
  // a flat sensor surface has only the zero order: one halo around the source, no dots
  assert.ok(returnOrders({ ...base, h: 0 }).every((e) => (e.m === 0 && e.n === 0) || e.w.every((v) => v < 1e-20)));
});
