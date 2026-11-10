// Seeing on your own camera: the view through a long lens across one frozen-flow turbulent layer.
// Every image point is displaced by the wavefront tilt averaged over the lens aperture (G-tilt);
// points further apart than the isoplanatic angle move independently. The tilt maps come straight
// from a von Kármán spectrum by FFT (the aperture average is a product in the frequency domain),
// and the remaining short-exposure blur follows Fried's tip-tilt-removed MTF.
import { fft2d } from './fft.js';
import { makeRng } from './random.js';
import { besselJ1 } from './pupil.js';
import { besselJ0 } from './starshade.js';

export const LAM0 = 0.5e-6; // r₀ is quoted at 500 nm
const airy = (x) => (x < 1e-9 ? 1 : (2 * besselJ1(x)) / x); // Fourier transform of the aperture average, x = πDf
const psd = (f, r0, L0) => 0.023 * r0 ** (-5 / 3) * (f * f + 1 / (L0 * L0)) ** (-11 / 6); // phase PSD (rad² m², at 500 nm)

// Periodic N × N maps of the G-tilt along x and y (radians of arrival angle) for an aperture of
// diameter D, grid spacing dx (m). The real part of the inverse FFT of complex Gaussian noise
// shaped by √PSD is one screen with the right statistics (as in turbulence.js phaseScreen); its
// gradient is i·2πf times the spectrum, and the angle is (λ/2π)·∇φ, which no longer depends on λ.
export function tiltMaps({ N, dx, r0, L0 = Infinity, D, seed = 1 }) {
  const g = makeRng(seed).g, df = 1 / (N * dx);
  const xr = new Float64Array(N * N), xi = new Float64Array(N * N), yr = new Float64Array(N * N), yi = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if ((!x && !y) || x === N / 2 || y === N / 2) continue; // no piston; the Nyquist rows have no sign
    const fx = (x < N / 2 ? x : x - N) * df, fy = (y < N / 2 ? y : y - N) * df, f = Math.hypot(fx, fy);
    const s = LAM0 * Math.sqrt(psd(f, r0, L0)) * df * airy(Math.PI * D * f), cr = g() * s, ci = g() * s, k = y * N + x;
    xr[k] = -fx * ci; xi[k] = fx * cr; yr[k] = -fy * ci; yi[k] = fy * cr;
  }
  fft2d(xr, xi, N, true); fft2d(yr, yi, N, true);
  const tx = new Float32Array(N * N), ty = new Float32Array(N * N), n2 = N * N;
  for (let k = 0; k < n2; k++) { tx[k] = xr[k] * n2; ty[k] = yr[k] * n2; }
  return { tx, ty };
}

// The variance per axis that tiltMaps produces (the same frequency grid, summed).
export function tiltVarianceGrid({ N, dx, r0, L0 = Infinity, D }) {
  const df = 1 / (N * dx);
  let s = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if ((!x && !y) || x === N / 2 || y === N / 2) continue;
    const fx = (x < N / 2 ? x : x - N) * df, fy = (y < N / 2 ? y : y - N) * df, f = Math.hypot(fx, fy);
    s += (LAM0 * fx) ** 2 * psd(f, r0, L0) * df * df * airy(Math.PI * D * f) ** 2;
  }
  return s;
}

// The continuum value, λ² π ∫ f³ Φ(f) A(πDf)² df (Simpson's rule in ln f). For L₀ = ∞ this is
// Tyler's G-tilt variance 0.170 (λ/D)² (D/r₀)^{5/3} per axis.
export function tiltVariance(D, r0, L0 = Infinity) {
  const a = Math.log(1e-12 / D), b = Math.log(200 / D), n = 6000, hS = (b - a) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const f = Math.exp(a + i * hS), v = f ** 4 * psd(f, r0, L0) * airy(Math.PI * D * f) ** 2;
    s += v * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return LAM0 * LAM0 * Math.PI * s * hS / 3;
}

// Short-exposure (tip-tilt-removed) PSF: diffraction MTF × Fried's near-field short-exposure
// atmospheric MTF exp{−3.44 (λf/r₀)^{5/3} [1 − (λf/D)^{1/3}]}, r₀ scaled to λ as λ^{6/5}. Returns
// its full width at half maximum (rad), from a Hankel transform, and the long-exposure 0.98 λ/r₀.
export function shortExposureFWHM(D, r0, lam = 0.55e-6) {
  const r = r0 * (lam / LAM0) ** 1.2, fc = D / lam, M = 600;
  const mtf = (f) => {
    const v = f / fc;
    if (v >= 1) return 0;
    return (2 / Math.PI) * (Math.acos(v) - v * Math.sqrt(1 - v * v)) * Math.exp(-3.44 * ((lam * f) / r) ** (5 / 3) * (1 - v ** (1 / 3)));
  };
  const fs = Array.from({ length: M + 1 }, (_, i) => (i / M) * fc), ms = fs.map(mtf);
  const P = (th) => { let s = 0; for (let i = 0; i <= M; i++) s += ms[i] * besselJ0(2 * Math.PI * fs[i] * th) * fs[i] * (i === 0 || i === M ? 1 : i % 2 ? 4 : 2); return s; };
  const p0 = P(0);
  let lo = 0, hi = 2 * Math.max(lam / D, lam / r);
  while (P(hi) > p0 / 2) hi *= 1.5;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (P(m) > p0 / 2) lo = m; else hi = m; }
  return { short: lo + hi, long: (0.98 * lam) / r, diffraction: (1.03 * lam) / D };
}

// Bilinear sample of a periodic N × N map at (x, y) in grid pixels.
export function samplePeriodic(m, N, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = ((x0 % N) + N) % N, b = ((y0 % N) + N) % N, a1 = (a + 1) % N, b1 = (b + 1) % N;
  return (m[b * N + a] * (1 - fx) + m[b * N + a1] * fx) * (1 - fy) + (m[b1 * N + a] * (1 - fx) + m[b1 * N + a1] * fx) * fy;
}

// Displacement (image pixels) on a gw × gh grid of nodes spanning a w × h image. The field angle of
// image pixel x is (x − w/2)·scale; the layer at distance z sees it at θ·z, and the wind has
// carried the screen `shift` metres along x.
export function displacementGrid({ tx, ty, N, dx }, { w, h, gw, gh, scale, z, shift }) {
  const ox = new Float32Array(gw * gh), oy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const px = (i / (gw - 1)) * w, py = (j / (gh - 1)) * h;
    const sx = (((px - w / 2) * scale * z) + shift) / dx, sy = ((py - h / 2) * scale * z) / dx;
    ox[j * gw + i] = samplePeriodic(tx, N, sx, sy) / scale; oy[j * gw + i] = samplePeriodic(ty, N, sx, sy) / scale;
  }
  return { ox, oy };
}

// Warp an RGBA frame: the output at x shows the input at x − d(x), with d interpolated bilinearly
// from the node grid and the input sampled bilinearly (edges clamped).
export function warpRGBA(src, w, h, { ox, oy }, gw, gh, out = new Uint8ClampedArray(w * h * 4)) {
  const gx = (gw - 1) / w, gy = (gh - 1) / h;
  for (let y = 0; y < h; y++) {
    const v = Math.min(gh - 1.000001, y * gy), j = Math.floor(v), fv = v - j;
    for (let x = 0; x < w; x++) {
      const u = Math.min(gw - 1.000001, x * gx), i = Math.floor(u), fu = u - i, k = j * gw + i;
      const dX = (ox[k] * (1 - fu) + ox[k + 1] * fu) * (1 - fv) + (ox[k + gw] * (1 - fu) + ox[k + gw + 1] * fu) * fv;
      const dY = (oy[k] * (1 - fu) + oy[k + 1] * fu) * (1 - fv) + (oy[k + gw] * (1 - fu) + oy[k + gw + 1] * fu) * fv;
      const sx = Math.max(0, Math.min(w - 1.001, x - dX)), sy = Math.max(0, Math.min(h - 1.001, y - dY));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), a = sx - x0, b = sy - y0, p = (y0 * w + x0) * 4, o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = (src[p + c] * (1 - a) + src[p + 4 + c] * a) * (1 - b) + (src[p + w * 4 + c] * (1 - a) + src[p + w * 4 + 4 + c] * a) * b;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Isoplanatic angle of a single layer at distance z (Fried): θ₀ = 0.314 r₀ / z.
export const isoplanatic = (r0, z) => (0.314 * r0) / z;
