// Sensor (red-dot) flare. A bright source focused on the sensor is partly reflected by the sensor's
// surface, whose microlenses repeat with the pixel pitch p: a reflective two-dimensional grating.
// Order (m, n) leaves with direction sines s = s_in + (m, n) λ/p, travels to the IR-cut filter a
// distance d above the sensor, is reflected there and lands on the sensor again at
// x = 2d s/√(1 − |s|²). Every ray of the converging cone (direction sines within σ = 1/2N of the
// normal) is shifted by the same order, so each order paints a defocused disc, the image of the
// lens's pupil. The light that comes back has passed the filter once (T) and been reflected by it
// once (R = 1 − T for a lossless interference coating), so T·R peaks at the filter's cut-off edge:
// the dots are red. Order efficiencies are the Fourier coefficients of the reflected field over one
// microlens (thin-element, scalar model). Lengths in metres, wavelengths in metres unless noted.
import { fft2d } from './fft.js';

// Wavelength grid of the spectral sums (nm).
export const LAM = Array.from({ length: 77 }, (_, i) => 400 + 5 * i); // 400 … 780 nm
export const NEFF = 1.7; // effective index of the filter stack: how fast its edge moves with angle

const gauss = (l, mu, s) => Math.exp(-0.5 * ((l - mu) / s) ** 2);
const sig = (l, c, k) => 1 / (1 + Math.exp(-(l - c) / k));
// Bare sensor sensitivities (silicon × colour filter, no IR-cut filter): model curves.
const qe = (l) => (l < 600 ? 1 : 1 - (0.6 * (l - 600)) / 180);
export const SENS = [
  LAM.map((l) => sig(l, 588, 11) * qe(l) + 0.08 * gauss(l, 450, 20)),
  LAM.map((l) => gauss(l, 535, 40)),
  LAM.map((l) => gauss(l, 462, 26)),
];
const planck = (lnm, T) => { const l = lnm * 1e-9; return 1 / (l ** 5 * (Math.exp(1.4388e-2 / (l * T)) - 1)); };
export const SOURCES = {
  sun: LAM.map((l) => planck(l, 5778)),
  lamp: LAM.map((l) => planck(l, 2700)),
  led: LAM.map((l) => gauss(l, 452, 11) + 0.55 * gauss(l, 565, 55)),
};

// The filter: transmission and reflectance at wavelength l (nm) for light meeting it at angle θ
// (sine sθ). An interference (dichroic) short-pass edge at λ_c moves to shorter wavelengths with
// angle, λ_c(θ) = λ_c √(1 − sin²θ/n_eff²); it reflects what it does not pass. An absorptive
// (blue-glass) filter absorbs the red instead and reflects only its residual Rmin.
export function filterTR(l, sth, f) {
  if (f.kind === 'absorptive') { const T = (1 - f.Rmin) / (1 + Math.exp((l - f.edge) / f.width)); return [T, f.Rmin]; }
  const lc = f.edge * Math.sqrt(1 - (sth * sth) / (NEFF * NEFF)), core = 1 / (1 + Math.exp((l - lc) / f.width));
  const R = f.Rmin + (1 - f.Rmin) * (1 - core);
  return [1 - R, R];
}
export const edgeAt = (f, sth) => f.edge * Math.sqrt(1 - (sth * sth) / (NEFF * NEFF));

// Diffraction efficiencies of a reflecting periodic cell: phase(u, v) for u, v in [0, 1) (cell
// units), sampled n × n; returns eta(m, k), the share of the reflected light in order (m, k)
// (Σ over all orders = 1, Parseval).
export function cellOrders(phase, n = 64) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const ph = phase((i + 0.5) / n, (j + 0.5) / n); re[j * n + i] = Math.cos(ph); im[j * n + i] = Math.sin(ph); }
  fft2d(re, im, n);
  const N2 = n * n, eta = new Float64Array(N2);
  for (let k = 0; k < N2; k++) eta[k] = (re[k] * re[k] + im[k] * im[k]) / (N2 * N2);
  const at = (m, k) => eta[((k % n) + n) % n * n + ((m % n) + n) % n];
  return { n, eta: at };
}
// A microlens filling its square cell, a paraboloid of sag h from the corners to the centre;
// reflected from its top surface, the phase is 2k h(u, v).
export const microlensPhase = (h, lam) => (u, v) => (4 * Math.PI * h / lam) * (1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.5);
export function microlensOrders(h, lam, M, n = 64) {
  const { eta } = cellOrders(microlensPhase(h, lam), n), out = [];
  for (let k = -M; k <= M; k++) for (let m = -M; m <= M; m++) out.push({ m, n: k, eta: eta(m, k) });
  return out;
}

// The Airy pattern (2J₁(v)/v)², exact up to v = 12 (power series) and beyond it the mean of its
// rings, 4/πv³, which keeps the total energy.
export function airy(v) {
  if (v >= 12) return 4 / (Math.PI * v * v * v);
  if (v < 1e-8) return 1;
  let t = 1, sum = 1;
  const q = -(v * v) / 4;
  for (let k = 1; k < 40; k++) { t *= q / (k * (k + 1)); sum += t; }
  return sum * sum; // 2J₁(v)/v = Σ (−v²/4)^k / (k!(k+1)!)
}

// Where light leaving the sensor with direction sines s returns after reflection at height d.
export const landing = (s, d) => (2 * d * s) / Math.sqrt(1 - s * s);
// The adjacent orders' discs (direction-sine radius σ = 1/2N, spacing λ/p) just touch at N = p/λ:
// above it the dots are separate.
export const criticalN = (p, lam) => p / lam;

// All returning orders: for each order (m, n) and wavelength, the direction sines of its centre and
// its energy as a fraction of the source's light in that wavelength, with the filter's passage on
// the way in (normal incidence) and reflection on the way back (at the order's angle).
// o = { p, h, d, N, Rs, filter, src }
export function returnOrders(o, M = 12) {
  const out = new Map();
  for (let li = 0; li < LAM.length; li++) {
    const l = LAM[li], lam = l * 1e-9, g = lam / o.p, Mw = Math.min(M, Math.floor(1 / g));
    const T0 = filterTR(l, 0, o.filter)[0], orders = microlensOrders(o.h, lam, Mw);
    for (const q of orders) {
      const sx = q.m * g, sy = q.n * g, s = Math.hypot(sx, sy);
      if (s + 1 / (2 * o.N) >= 0.98) continue; // evanescent or grazing
      const R = filterTR(l, s, o.filter)[1], key = `${q.m},${q.n}`;
      let e = out.get(key);
      if (!e) out.set(key, (e = { m: q.m, n: q.n, w: new Float64Array(LAM.length) }));
      e.w[li] = T0 * o.Rs * q.eta * R;
    }
  }
  return [...out.values()];
}

// Channel totals of the direct image (source × filter passage × sensitivity), used to express
// every signal as a fraction of the source's light in the same channel (a white-balanced picture).
export function channelTotals(o) {
  return SENS.map((sc) => { let a = 0; for (let i = 0; i < LAM.length; i++) a += o.src[i] * filterTR(LAM[i], 0, o.filter)[0] * sc[i]; return a; });
}
// The colour of one order's light as recorded: [r, g, b] fractions of the source's channel totals.
export function orderRGB(e, o, tot = channelTotals(o)) {
  return SENS.map((sc, c) => { let a = 0; for (let i = 0; i < LAM.length; i++) a += o.src[i] * e.w[i] * sc[i]; return a / tot[c]; });
}

// The picture on the sensor around the source: n × n samples over ±half (m), RGB per sample as the
// fraction of the source's light (per channel) that falls on one sensor pixel (area p²) there.
// Each order and wavelength is drawn exactly: a sample at x looks back along s = x/√(|x|² + D²)
// (D = 2d), the ray came from the pupil at s − (m, n)λ/p, and if that is inside the disc of radius
// σ the irradiance is P/(πσ²) · D²/(|x|² + D²)² (the Jacobian of s(x)); the disc's edge is
// anti-aliased over one sample. The direct image is the Airy pattern at every
// wavelength.
export function flareImage(o, { n = 320, half = 2e-3, core = true, step = 1 } = {}, orders = returnOrders(o)) {
  const img = new Float32Array(3 * n * n), tot = channelTotals(o), D = 2 * o.d, sg = 1 / (2 * o.N), pix = (2 * half) / n, A = o.p * o.p;
  const wc = [0, 1, 2].map((c) => LAM.map((_, i) => (o.src[i] * SENS[c][i]) / tot[c]));
  // per sample: the direction it looks back along, and the Jacobian D²/ρ⁴
  const SX = new Float64Array(n * n), SY = new Float64Array(n * n), J = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) * pix, y = -half + (j + 0.5) * pix, r2 = x * x + y * y + D * D, ir = 1 / Math.sqrt(r2), k = j * n + i;
    SX[k] = x * ir; SY[k] = y * ir; J[k] = (D * D) / (r2 * r2);
  }
  const dS = pix / D; // one sample in direction sines (near the axis; finer farther out)
  for (const e of orders) {
    for (let li = 0; li < LAM.length; li += step) {
      const P = e.w[li] * step;
      if (P <= 0) continue;
      const c0 = P * wc[0][li], c1 = P * wc[1][li], c2 = P * wc[2][li];
      const g = (LAM[li] * 1e-9) / o.p, gx = e.m * g, gy = e.n * g, s2 = gx * gx + gy * gy;
      // bounding box: radially from the landing of s − σ to that of s + σ, across ±σ·L(s+σ)/(s+σ)
      const gs = Math.sqrt(s2), ex = gs ? gx / gs : 1, ey = gs ? gy / gs : 0, a = Math.max(0, gs - sg), b = Math.min(0.995, gs + sg);
      const ra = gs > sg ? landing(a, o.d) : -landing(sg - gs, o.d), rbb = landing(b, o.d), tw = (rbb / b) * sg + 2 * pix;
      if (ra - 2 * pix > half * Math.SQRT2) continue;
      const xs = [ra * ex - tw * ey, ra * ex + tw * ey, rbb * ex - tw * ey, rbb * ex + tw * ey], ys = [ra * ey + tw * ex, ra * ey - tw * ex, rbb * ey + tw * ex, rbb * ey - tw * ex];
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - 2 * pix + half) / pix)), i1 = Math.min(n - 1, Math.ceil((Math.max(...xs) + 2 * pix + half) / pix));
      const j0 = Math.max(0, Math.floor((Math.min(...ys) - 2 * pix + half) / pix)), j1 = Math.min(n - 1, Math.ceil((Math.max(...ys) + 2 * pix + half) / pix));
      if (i0 > i1 || j0 > j1) continue;
      const kk = A / (Math.PI * sg * sg), lo = (sg - dS / 2) ** 2, hi = (sg + dS / 2) ** 2;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * n + i, ux = SX[k] - gx, uy = SY[k] - gy, u2 = ux * ux + uy * uy;
        if (u2 >= hi) continue;
        const cov = u2 <= lo ? 1 : (sg + dS / 2 - Math.sqrt(u2)) / dS, v = kk * J[k] * cov, q = 3 * k;
        img[q] += c0 * v; img[q + 1] += c1 * v; img[q + 2] += c2 * v;
      }
    }
  }
  if (core) {
    // the direct image: a radial profile per channel (every wavelength's Airy pattern), tabulated
    const NR = 4096, rmax = half * Math.SQRT2 * 1.01, dr = rmax / (NR - 1), prof = [new Float64Array(NR), new Float64Array(NR), new Float64Array(NR)];
    for (let li = 0; li < LAM.length; li++) {
      const lam = LAM[li] * 1e-9, I0 = (Math.PI * A) / (4 * lam * lam * o.N * o.N), sc = (Math.PI * dr) / (lam * o.N), T0 = filterTR(LAM[li], 0, o.filter)[0];
      const w0 = wc[0][li] * T0 * I0, w1 = wc[1][li] * T0 * I0, w2 = wc[2][li] * T0 * I0;
      for (let k = 0; k < NR; k++) { const f = airy(sc * k); prof[0][k] += w0 * f; prof[1][k] += w1 * f; prof[2][k] += w2 * f; }
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * pix, y = -half + (j + 0.5) * pix, u = Math.hypot(x, y) / dr, k = Math.min(NR - 2, u | 0), f = u - k, q = 3 * (j * n + i);
      for (let c = 0; c < 3; c++) img[q + c] += prof[c][k] + (prof[c][k + 1] - prof[c][k]) * f;
    }
  }
  return { img, n, half, orders: orders.length };
}

// Summary for the page: the strongest dots, their colours and how many stops below the source.
export function flareSummary(o, orders = returnOrders(o)) {
  const tot = channelTotals(o), D = 2 * o.d, list = orders.map((e) => {
    const rgb = orderRGB(e, o, tot), lp = 650e-9 / o.p, s = Math.hypot(e.m, e.n) * lp;
    const area = Math.PI * (D / (2 * o.N)) ** 2; // disc area near the axis
    return { m: e.m, n: e.n, rgb, total: Math.max(...rgb), perPixel: (Math.max(...rgb) * o.p * o.p) / area, at: s < 1 ? landing(s, o.d) : NaN };
  });
  list.sort((a, b) => b.total - a.total);
  return list;
}

// An extended source (the Sun) paints the whole pattern once for every point of its disc: the
// picture convolved with a uniform disc of radius r samples (anti-aliased), by FFT with zero
// padding. Keeps the total.
export function blurDisc(img, n, r) {
  if (r < 0.5) return img;
  let F = 1;
  while (F < n + 2 * Math.ceil(r) + 2) F *= 2;
  const kr = new Float64Array(F * F), ki = new Float64Array(F * F);
  let ks = 0;
  for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) {
    const x = i < F / 2 ? i : i - F, y = j < F / 2 ? j : j - F, w = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x, y)));
    kr[j * F + i] = w; ks += w;
  }
  fft2d(kr, ki, F);
  const out = new Float32Array(3 * n * n), run = (ca, cb) => {
    const re = new Float64Array(F * F), im = new Float64Array(F * F);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = 3 * (j * n + i); re[j * F + i] = img[q + ca]; if (cb >= 0) im[j * F + i] = img[q + cb]; }
    fft2d(re, im, F);
    for (let k = 0; k < F * F; k++) { const a = re[k], b = im[k]; re[k] = a * kr[k] - b * ki[k]; im[k] = a * ki[k] + b * kr[k]; }
    fft2d(re, im, F, true);
    // the kernel is real, so the two channels packed as re + i·im come back separately
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = 3 * (j * n + i); out[q + ca] = re[j * F + i] / ks; if (cb >= 0) out[q + cb] = im[j * F + i] / ks; }
  };
  run(0, 1); run(2, -1);
  return out;
}

// Everything the page shows, for the worker. o.src may name one of SOURCES; view.sunR is the
// radius of the Sun's image (m), 0 for a point source.
export function sensorFlareLab(o, view) {
  const oo = typeof o.src === 'string' ? { ...o, src: SOURCES[o.src] } : o, orders = returnOrders(oo), r = flareImage(oo, view, orders);
  const n = r.n, pix = (2 * r.half) / n, img = view.sunR ? blurDisc(r.img, n, view.sunR / pix) : r.img;
  return { ...r, img, dots: flareSummary(oo, orders).slice(0, 40) };
}
