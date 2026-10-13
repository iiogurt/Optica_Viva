// Astrophotography stacking: the CCD equation for a sum of N sub-exposures, sky brightness from
// light pollution, and the sub-exposure length beyond which read noise stops mattering.
import { makeRng } from './random.js';
// Photon zero point: a V = 0 source delivers ≈ 1.0 × 10⁶ photons s⁻¹ cm⁻² in a 100 nm band.
export const ZP = 1.0e6;
// Bortle class → typical zenith sky brightness in V (mag/arcsec²).
export const BORTLE = { 1: 22.0, 2: 21.9, 3: 21.7, 4: 21.3, 5: 20.8, 6: 20.3, 7: 19.5, 8: 18.9, 9: 18.0 };

// Electrons per second per pixel from a surface brightness μ (mag/arcsec²) for aperture D (cm),
// pixel scale p (arcsec), quantum efficiency × throughput q.
export const surfaceRate = (mu, D, p, q) => ZP * Math.pow(10, -0.4 * mu) * Math.PI * (D / 2) ** 2 * p * p * q;

// Signal-to-noise ratio of the stack of N subs of length t: S = F_o N t,
// noise² = N (F_o t + F_s t + F_d t + σ_r²).
export function stackSNR(Fo, Fs, Fd, sigma, t, N) {
  return (Fo * N * t) / Math.sqrt(N * ((Fo + Fs + Fd) * t + sigma * sigma));
}
// Sub-exposure length at which read noise adds a fraction ε to the noise variance of the sky:
// σ_r² = ε F_s t  →  t = σ_r²/(ε F_s)  (ε = 0.1 ↔ ≈ 5 % in noise).
export const skyLimitedSub = (Fs, sigma, eps = 0.1) => (sigma * sigma) / (eps * Fs);

// Gaussian deviates for the image simulation (see js/lib/random.js).
export function rng(seed) { return makeRng(seed).g; }
// A faint galaxy (exponential disk, central μ₀, scale length h arcsec, inclination) plus stars,
// rendered as an object-rate map (e⁻/s/pixel) for the given optics.
export function galaxyRate(W, H, p, D, q, mu0, hArc) {
  const out = new Float64Array(W * H), cx = W / 2, cy = H / 2, inc = 0.45, pa = 0.6, c = Math.cos(pa), s = Math.sin(pa);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) * p, dy = (y - cy) * p, u = dx * c + dy * s, v = (-dx * s + dy * c) / inc;
    const r = Math.hypot(u, v), arm = 1 + 0.35 * Math.cos(2 * Math.atan2(v, u) - 2.2 * Math.log(r / hArc + 0.2));
    out[y * W + x] = surfaceRate(mu0, D, p, q) * Math.exp(-r / hArc) * arm;
  }
  const r = rng(99);
  for (let k = 0; k < 25; k++) { const x = (r() * 0.45 + 0.5) * W % W, y = (r() * 0.45 + 0.5) * H % H, m = 12 + 6 * Math.abs(r()) % 6, F = ZP * Math.pow(10, -0.4 * m) * Math.PI * (D / 2) ** 2 * q; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const X = Math.round(x) + i, Y = Math.round(y) + j; if (X >= 0 && X < W && Y >= 0 && Y < H) out[Y * W + X] += (F * Math.exp(-(i * i + j * j) / 1.8)) / (Math.PI * 1.8); } }
  return out;
}
// Stack of N subs: mean signal and Gaussian noise with the exact variance of the sum (per pixel),
// returned as the sky-subtracted average in e⁻ per sub.
export function stackImage(rate, Fs, Fd, sigma, t, N, seed = 1) {
  const g = rng(seed), out = new Float64Array(rate.length);
  for (let k = 0; k < rate.length; k++) {
    const mean = rate[k] * t, varSub = (rate[k] + Fs + Fd) * t + sigma * sigma;
    out[k] = mean + Math.sqrt(varSub / N) * g();
  }
  return out;
}
