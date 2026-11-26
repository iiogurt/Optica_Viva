// The pinhole camera: Fresnel diffraction behind a round hole of diameter d, with the film at f
// and the object at distance u (Infinity for a star). In the Fresnel approximation a point source
// gives on the film, at distance r from its geometric image,
//   U(r) = (2π/λf) ∫₀^a e^{iπρ²/λz_e} J₀(2πrρ/λf) ρ dρ,   1/z_e = 1/u + 1/f,
// relative to the irradiance at the hole (a = d/2). The Fresnel number N = a²/λz_e counts the
// zones the hole spans: N ≫ 1 gives the geometric shadow of the hole, d(1 + f/u) wide; N ≪ 1 the
// Airy pattern of the hole, 2.44 λf/d to its first dark ring. In between lies the sharpest picture.
// The same hole is a circular pupil with the quadratic phase πρ²/λz_e, so its transfer function
// is the overlap of two shifted copies, weighted by the linear phase their difference leaves:
//   OTF(ν) = (1/πa²) ∫∫_overlap e^{i2π x s/λz_e} dx dy,   s = λfν,
// a one-dimensional integral over the lens-shaped overlap. Lengths in metres.
import { besselJ0 } from './starshade.js';
import { fft2d } from './fft.js';

const ze = (f, u) => (isFinite(u) ? (u * f) / (u + f) : f);
export const fresnelN = (d, f, u, lam) => (d * d) / (4 * lam * ze(f, u));
export const geomBlur = (d, f, u) => d * (1 + (isFinite(u) ? f / u : 0));
export const airyBlur = (d, f, lam) => (2.44 * lam * f) / d;
// Rayleigh (1891): f/d = 505 k d with d in mm and k = 1 + f/u, i.e. d ≈ 1.9 √(λ z_e) for
// yellow-green light (1.9 √(fλ) for a distant subject)
export const rayleighD = (f, lam, u = Infinity) => 1.9 * Math.sqrt(ze(f, u) * lam);

// Irradiance I(r) (relative to that at the hole) at film radii rs. The integral runs in q = ρ²,
// where the Fresnel phase is linear and is integrated exactly over each step (Filon), with one
// Richardson step for the sampled Bessel factor.
export function profile(d, f, u, lam, rs, steps = 2000) {
  const a = (steps0) => filon(d, f, u, lam, rs, steps0);
  const A = a(steps), B = a(2 * steps);
  return A.map((v, i) => { const re = (4 * B[i][0] - v[0]) / 3, im = (4 * B[i][1] - v[1]) / 3; return re * re + im * im; });
}
function filon(d, f, u, lam, rs, steps) {
  const Q = (d * d) / 4, dq = Q / steps, k = Math.PI / (lam * ze(f, u)), w = Math.abs(k * dq) < 1e-12 ? dq : (2 * Math.sin((k * dq) / 2)) / k, pre = Math.PI / (lam * f);
  const out = [];
  for (const r of rs) {
    const s = (2 * Math.PI * r) / (lam * f);
    let re = 0, im = 0;
    for (let i = 0; i < steps; i++) { const q = (i + 0.5) * dq, g = r ? besselJ0(s * Math.sqrt(q)) : 1; re += g * Math.cos(k * q); im += g * Math.sin(k * q); }
    out.push([pre * w * re, pre * w * im]);
  }
  return out;
}
// on the axis exactly: I(0) = (z_e/f)² · 4 sin²(πN/2)
export const axial = (d, f, u, lam) => (ze(f, u) / f) ** 2 * 4 * Math.sin((Math.PI * fresnelN(d, f, u, lam)) / 2) ** 2;

// Encircled energy: the share of the light through the hole that falls within radius r of the image
// (the total is known exactly, πa² (z_e/f)⁰: every photon through the hole reaches the film).
export function encircled(d, f, u, lam, rs, I) {
  const P = (Math.PI * d * d) / 4, out = new Float64Array(rs.length);
  let acc = 0;
  for (let i = 1; i < rs.length; i++) { acc += Math.PI * (rs[i] * I[i] + rs[i - 1] * I[i - 1]) * (rs[i] - rs[i - 1]); out[i] = acc / P; }
  return out;
}

// The transfer function at spatial frequency ν (cycles per metre on the film). Real, and negative
// where the contrast of a pattern is reversed.
export function otf(d, f, u, lam, nu, n = 400) {
  const a = d / 2, s = lam * f * nu;
  if (s >= 2 * a) return 0;
  const c = (2 * Math.PI * s) / (lam * ze(f, u)), xm = a - s / 2;
  let acc = 0;
  // Gauss-free midpoint sum in x, with the chord 2√(a² − (|x| + s/2)²); symmetric in x
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * xm, hgt = Math.sqrt(Math.max(0, a * a - (x + s / 2) ** 2));
    acc += 2 * hgt * Math.cos(c * x) * (xm / n);
  }
  return (2 * acc) / (Math.PI * a * a);
}
export const geomMTF = (D, nu) => { const v = Math.PI * D * nu; return v < 1e-9 ? 1 : (2 * besselJ1s(v)) / v; };
function besselJ1s(x) {
  // J₁ by its power series to x = 12, asymptotic beyond (enough for a chart)
  if (Math.abs(x) < 12) { let t = x / 2, s = t, m = 0; for (let k = 1; k < 60; k++) { t *= -(x * x) / (4 * k * (k + 1)); s += t; if (Math.abs(t) < 1e-16 * Math.abs(s)) break; m = k; } return s; }
  return Math.sqrt(2 / (Math.PI * x)) * Math.cos(x - (3 * Math.PI) / 4);
}

// The sharpest pinhole for each of three criteria, found by scanning d: the brightest centre per
// unit of light (I(0)/πa², best at N ≈ 0.74), the smallest circle holding half the light, and the
// highest frequency still at half contrast (MTF50). o = { f, u, lam, dmin, dmax, n }.
export function sweep(o) {
  const ds = Array.from({ length: o.n || 40 }, (_, i) => o.dmin * (o.dmax / o.dmin) ** (i / ((o.n || 40) - 1)));
  const rows = ds.map((d) => measure(d, o));
  // each optimum: the best scanned row, then a golden-section search between its neighbours
  const opt = (key, sign) => {
    let i = 0;
    rows.forEach((r, j) => { if (isFinite(r[key]) && sign * r[key] > sign * rows[i][key]) i = j; });
    let lo = Math.log(rows[Math.max(0, i - 1)].d), hi = Math.log(rows[Math.min(rows.length - 1, i + 1)].d);
    const g = (Math.sqrt(5) - 1) / 2, val = (x) => sign * measure(Math.exp(x), o, key)[key];
    let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = val(x1), f2 = val(x2);
    for (let it = 0; it < 14; it++) {
      if (f1 > f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = val(x1); } else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = val(x2); }
    }
    return measure(Math.exp((lo + hi) / 2), o);
  };
  return { rows, best: { conc: opt('conc', 1), ee50: opt('ee50', -1), mtf50: opt('mtf50', 1) } };
}
// The three sharpness measures of one pinhole (only the one asked for, if `only` is given).
function measure(d, o, only) {
  const r = { d, N: fresnelN(d, o.f, o.u, o.lam), geo: geomBlur(d, o.f, o.u), airy: airyBlur(d, o.f, o.lam) };
  if (!only || only === 'conc') r.conc = axial(d, o.f, o.u, o.lam) / ((Math.PI * d * d) / 4);
  if (!only || only === 'ee50') {
    const scale = Math.max(r.geo, r.airy), rs = Array.from({ length: 160 }, (_, i) => (i / 159) * 1.5 * scale);
    const I = profile(d, o.f, o.u, o.lam, rs, 500), E = encircled(d, o.f, o.u, o.lam, rs, I);
    r.ee50 = NaN;
    for (let i = 1; i < rs.length; i++) if (E[i] >= 0.5) { r.ee50 = 2 * (rs[i - 1] + ((0.5 - E[i - 1]) / (E[i] - E[i - 1])) * (rs[i] - rs[i - 1])); break; }
  }
  if (!only || only === 'mtf50') {
    // MTF50: the first frequency where the transfer function falls to one half (it falls steadily
    // to there: bisection on [0, the cut-off d/λf])
    let lo = 0, hi = d / (o.lam * o.f);
    for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (otf(d, o.f, o.u, o.lam, m) > 0.5) lo = m; else hi = m; }
    r.mtf50 = lo;
  }
  return r;
}

// A test chart on the film (W wide, n × n pixels, linear light): a Siemens star of 48 spokes.
export function chart(n, W) {
  const a = new Float32Array(n * n), R = 0.46 * W;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = ((x + 0.5) / n - 0.5) * W, py = ((y + 0.5) / n - 0.5) * W, r = Math.hypot(px, py), th = Math.atan2(py, px);
    a[y * n + x] = r > R ? 0.5 : Math.sin(24 * th) > 0 ? 0.9 : 0.04;
  }
  return a;
}
// The chart photographed through the pinhole: each colour convolved with the exact PSF at its
// wavelength (FFT, the kernel normalised to the light it holds within its reach). Returns linear
// RGB (n·n·3) and the radial profiles used.
export function photograph({ d, f, u, W, n = 256, lams = [610e-9, 550e-9, 465e-9] }) {
  const src = chart(n, W), px = W / n, img = new Float32Array(n * n * 3), profiles = [];
  lams.forEach((lam, c) => {
    const reach = Math.min(W / 2, 4 * Math.max(geomBlur(d, f, u), airyBlur(d, f, lam))), nr = 400, rs = Array.from({ length: nr }, (_, i) => (i / (nr - 1)) * reach);
    const I = profile(d, f, u, lam, rs, 1200);
    profiles.push({ lam, rs, I });
    const kr = new Float64Array(n * n), ki = new Float64Array(n * n);
    let sum = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x < n / 2 ? x : x - n) * px, dy = (y < n / 2 ? y : y - n) * px, r = Math.hypot(dx, dy);
      if (r > reach) continue;
      const t = (r / reach) * (nr - 1), i = Math.min(nr - 2, Math.floor(t)), v = I[i] + (I[i + 1] - I[i]) * (t - i);
      kr[y * n + x] = v; sum += v;
    }
    for (let k = 0; k < n * n; k++) kr[k] /= sum;
    const ar = Float64Array.from(src), ai = new Float64Array(n * n);
    fft2d(kr, ki, n); fft2d(ar, ai, n);
    for (let k = 0; k < n * n; k++) { const a = ar[k], b = ai[k]; ar[k] = a * kr[k] - b * ki[k]; ai[k] = a * ki[k] + b * kr[k]; }
    fft2d(ar, ai, n, true);
    for (let k = 0; k < n * n; k++) img[3 * k + c] = Math.max(0, ar[k]);
  });
  return { img, n, W, profiles };
}
