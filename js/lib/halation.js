// Halation and diffusion filters: two glows around highlights. Pure functions; lengths in mm on the
// film unless stated.
//
// Halation. Light that is not absorbed by the emulsion enters the film base (thickness t, index n),
// spread over angles by scattering in the emulsion (taken as Lambertian: a fraction 2 sinθ cosθ dθ
// leaves between θ and θ + dθ). At the back of the base it is reflected (Fresnel; totally beyond the
// critical angle θc = asin(1/n)) and comes back to the emulsion at a distance r = 2t tanθ from where
// it entered. So a point of light gets a ring, brightest just outside r_c = 2t tanθc. The bottom,
// red-sensitive layer sits on the base and catches most of it: the red glow of films without an
// anti-halation backing (the remjet of motion-picture stock).
//
// Diffusion filters (Pro-Mist and the like): small particles in front of the lens scatter a fraction
// s of the light into a broad halo; the rest passes undisturbed. Seen on the film the halo has a size
// set by the scattering angle and the focal length; it is modelled as an exponential of scale w.
import { fft2d } from './fft.js';

// Fresnel reflectance, unpolarised, from index n into air, at angle θ inside the base.
export function reflectBack(theta, n) {
  const s = n * Math.sin(theta);
  if (s >= 1) return 1;
  const ci = Math.cos(theta), ct = Math.sqrt(1 - s * s);
  const rs = (n * ci - ct) / (n * ci + ct), rp = (ci - n * ct) / (ci + n * ct);
  return (rs * rs + rp * rp) / 2;
}
export const criticalAngle = (n) => Math.asin(1 / n);
export const ringRadius = (t, n) => 2 * t * Math.tan(criticalAngle(n));

// The share of the light entering the base that comes back to the emulsion (before absorption in
// the emulsion): ∫ R(θ) 2 sinθ cosθ dθ; with an anti-halation layer the back reflection is cut to
// `backing` times its value.
export function returned(n, backing = 1, steps = 4000) {
  let s = 0;
  for (let i = 0; i < steps; i++) { const th = ((i + 0.5) / steps) * (Math.PI / 2); s += reflectBack(th, n) * 2 * Math.sin(th) * Math.cos(th); }
  return (s * (Math.PI / 2) / steps) * backing;
}

// Light per unit area returning at radius r: K(r) = R(θ)·2 sinθ cosθ / (2π r dr/dθ) with r = 2t tanθ,
// dr/dθ = 2t/cos²θ (finite at r = 0: R(0)/(4π t²)).
export function halationDensity(r, t, n, backing = 1) {
  const th = Math.atan(r / (2 * t));
  if (r < 1e-12) return (reflectBack(0, n) * backing) / (4 * Math.PI * t * t);
  return (reflectBack(th, n) * backing * 2 * Math.sin(th) * Math.cos(th)) / (2 * Math.PI * r * ((2 * t) / Math.cos(th) ** 2));
}

// The halation kernel on an N × N grid of pitch p (mm), centred at index 0 with wrap-around (ready
// for an FFT convolution): K(r) averaged over 4 × 4 points in each cell, times the cell's area.
export function halationKernel(N, p, t, n, backing = 1) {
  const K = new Float64Array(N * N), M = 4096, rmax = (N / 2) * p * Math.SQRT2, tab = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) tab[i] = halationDensity((i / M) * rmax, t, n, backing);
  const at = (r) => { const f = (r / rmax) * M, i = Math.min(M - 1, Math.floor(f)), q = f - i; return tab[i] * (1 - q) + tab[i + 1] * q; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = (i < N / 2 ? i : i - N) * p, y0 = (j < N / 2 ? j : j - N) * p;
    let s = 0;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) s += at(Math.hypot(x0 + ((a + 0.5) / 4 - 0.5) * p, y0 + ((b + 0.5) / 4 - 0.5) * p));
    K[j * N + i] = (s / 16) * p * p;
  }
  return K;
}

// The diffusion filter's halo: s spread as e^(−r/w)/(2π w²) on the grid; 1 − s stays in the centre.
export function diffusionKernel(N, p, s, w) {
  const K = new Float64Array(N * N);
  if (s <= 0) { K[0] = 1; return K; }
  let sum = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i < N / 2 ? i : i - N) * p, y = (j < N / 2 ? j : j - N) * p, v = Math.exp(-Math.hypot(x, y) / w);
    K[j * N + i] = v; sum += v;
  }
  for (let k = 0; k < N * N; k++) K[k] *= s / sum;
  K[0] += 1 - s;
  return K;
}

// Convolve the N × N field a with kernel K (both row-major, kernel centred at index 0) by FFT.
export function convolve(a, K, N) {
  const re = Float64Array.from(a), im = new Float64Array(N * N), kr = Float64Array.from(K), ki = new Float64Array(N * N);
  fft2d(re, im, N); fft2d(kr, ki, N);
  for (let k = 0; k < N * N; k++) { const r = re[k] * kr[k] - im[k] * ki[k], i = re[k] * ki[k] + im[k] * kr[k]; re[k] = r; im[k] = i; }
  fft2d(re, im, N, true);
  return re;
}

// A night street, linear RGB (1 = a well-exposed mid-grey wall), on an N × N grid covering a
// window of the 36 × 24 mm frame centred at (cx, cy) mm and `width` mm wide: dark sky, buildings with
// lit windows, street lamps (very bright small discs), a neon sign and headlights.
export function nightStreet(N, width, cx = 0, cy = 0) {
  const R = new Float64Array(N * N), G = new Float64Array(N * N), B = new Float64Array(N * N), p = width / N;
  const add = (x, y, rgb) => { const k = y * N + x; R[k] += rgb[0]; G[k] += rgb[1]; B[k] += rgb[2]; };
  const lamps = [[-11, 4.5, 0.04], [-3, 5.5, 0.035], [5.5, 4.2, 0.04], [12, 5.2, 0.035], [1.2, 2.2, 0.03]];
  const heads = [[-1.6, -4.2, 0.06], [1.0, -4.2, 0.06]];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = cx + (i + 0.5 - N / 2) * p, y = cy - (j + 0.5 - N / 2) * p; // mm, y up
    let c;
    if (Math.abs(x) > 18 || Math.abs(y) > 12) c = [0, 0, 0];
    else if (y > 2 - 0.4 * Math.abs(Math.sin(x * 0.7)) + (Math.abs(x) > 8 ? 3 : 0)) c = [0.004, 0.006, 0.018 + 0.01 * (y / 12)]; // night sky
    else if (y > -3) { // buildings with windows
      const wx = Math.abs(((x + 40) % 1.4) - 0.7) < 0.35, wy = Math.abs(((y + 40) % 1.6) - 0.8) < 0.45, lit = ((Math.floor((x + 40) / 1.4) * 7 + Math.floor((y + 40) / 1.6) * 3) % 5) < 2;
      c = wx && wy && lit ? [0.9, 0.62, 0.3] : [0.02, 0.018, 0.02];
    } else c = [0.03, 0.03, 0.035]; // street
    add(i, j, c);
    // neon sign: a red tube and a blue one
    if (x > -8 && x < -4 && Math.abs(y + 1.6) < 0.09) add(i, j, [6, 0.4, 0.5]);
    if (x > -8 && x < -4 && Math.abs(y + 2.2) < 0.07) add(i, j, [0.4, 1.2, 6]);
    for (const [lx, ly, lr] of lamps) if (Math.hypot(x - lx, y - ly) < Math.max(lr, 0.6 * p)) add(i, j, [3000, 2200, 1300].map((v) => v * Math.min(1, (lr / (0.6 * p)) ** 2))); // tiny, very bright; the same light on a coarse grid
    for (const [hx, hy, hr] of heads) if (Math.hypot(x - hx, y - hy) < Math.max(hr, 0.6 * p)) add(i, j, [600, 600, 640].map((v) => v * Math.min(1, (hr / (0.6 * p)) ** 2)));
  }
  return [R, G, B];
}

// The film's three layers catch different shares of the returning light: the red-sensitive layer
// lies on the base and catches most; light reaching the base is mostly red (blue and green are
// absorbed higher up). Relative strengths of halation per channel.
export const LAYER = [1, 0.28, 0.05];

// The picture, in the worker: the scene's spectra are kept while only the film or the filter
// changes. Each colour channel c is filtered by D̂ · (1 + a_c K̂_h): the diffusion filter acts on
// all the light, halation adds a_c = base · LAYER[c] times the returned light.
// p = { N, width, cx, cy, t (mm), n, backing, base, s, w (mm) } → [R, G, B] Float64Arrays
const cache = { key: '', spec: null };
export function halationRender(p) {
  const { N, width, cx = 0, cy = 0 } = p, pitch = width / N, key = `${N}|${width}|${cx}|${cy}`;
  if (cache.key !== key) {
    cache.spec = nightStreet(N, width, cx, cy).map((a) => { const re = Float64Array.from(a), im = new Float64Array(N * N); fft2d(re, im, N); return [re, im]; });
    cache.key = key;
  }
  const spectrum = (K) => { const re = Float64Array.from(K), im = new Float64Array(N * N); fft2d(re, im, N); return [re, im]; };
  const [hr, hi] = spectrum(halationKernel(N, pitch, p.t, p.n, p.backing)), [dr, di] = spectrum(diffusionKernel(N, pitch, p.s, p.w));
  return cache.spec.map(([sr, si], c) => {
    const a = p.base * LAYER[c], re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) {
      const fr = 1 + a * hr[k], fi = a * hi[k], gr = dr[k] * fr - di[k] * fi, gi = dr[k] * fi + di[k] * fr; // D̂·(1 + aK̂)
      re[k] = sr[k] * gr - si[k] * gi; im[k] = sr[k] * gi + si[k] * gr;
    }
    fft2d(re, im, N, true);
    return re;
  });
}
