// Photon by photon: an image built from individual photon arrivals. Each pixel receives a Poisson
// number of photons per frame with mean μ·b(x, y), where b is the scene's relative brightness, so
// the picture emerges from noise as counts grow and the signal-to-noise ratio climbs as √N. Pure
// functions on typed arrays with a seeded generator (js/lib/random.js).
import { makeRng } from './random.js';

export const PW = 96, PH = 64;
// the flat, fully lit patch used to measure the signal-to-noise ratio (top right)
export const PATCH = { x0: 74, x1: 92, y0: 4, y1: 22 };

// Relative brightness 0…1: a 36-sector star on the left, a step wedge of ½-stop patches along the
// bottom, a dark background and the flat patch.
export function photonScene(w = PW, h = PH) {
  const b = new Float32Array(w * h), cx = 26, cy = 26, R = 22;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0.04;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r < R) v = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 36) % 2 ? 0.85 : 0.08;
    if (y >= 50 && y < 62 && x >= 4 && x < 92) v = 2 ** (-Math.floor((x - 4) / 11) / 2);
    if (x >= PATCH.x0 && x < PATCH.x1 && y >= PATCH.y0 && y < PATCH.y1) v = 1;
    b[y * w + x] = v;
  }
  return b;
}

// Add one frame of arrivals with mean mu photons on a fully lit pixel. Returns the frame's photon
// count; `fresh` (optional) receives this frame's counts for drawing new arrivals.
export function arrive(acc, b, mu, rng, fresh = null) {
  let total = 0;
  for (let k = 0; k < b.length; k++) {
    const n = rng.poisson(mu * b[k]);
    acc[k] += n; total += n;
    if (fresh) fresh[k] = n;
  }
  return total;
}

// Mean and standard deviation of the counts in the flat patch.
export function patchStats(acc, w = PW) {
  let s = 0, s2 = 0, n = 0;
  for (let y = PATCH.y0; y < PATCH.y1; y++) for (let x = PATCH.x0; x < PATCH.x1; x++) { const v = acc[y * w + x]; s += v; s2 += v * v; n++; }
  const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean) * (n / (n - 1)));
  return { mean, sd, snr: sd > 0 ? mean / sd : Infinity };
}

export const photonRng = (seed) => makeRng(seed);

// One sub-exposure of an astronomical frame: Poisson electrons from the object (rate[k] e⁻/s per
// pixel), the sky and dark current (bg e⁻/s per pixel) over t seconds, plus Gaussian read noise
// σ_r; the expected background is subtracted, as in calibration. Writes into `out` and returns it.
export function subExposure(rate, bg, sigma, t, rng, out = new Float32Array(rate.length)) {
  for (let k = 0; k < rate.length; k++) out[k] = rng.poisson((rate[k] + bg) * t) + sigma * rng.g() - bg * t;
  return out;
}

// Signal-to-noise ratio over the central square (half-width r) of an n × n image, measured against
// the known expected image: signal = mean of the expectation, noise = spread of (image − expected).
export function centreSNR(img, expected, n, r = 4) {
  let s = 0, d = 0, d2 = 0, c = 0;
  for (let y = n / 2 - r; y < n / 2 + r; y++) for (let x = n / 2 - r; x < n / 2 + r; x++) { const k = y * n + x, e = img[k] - expected[k]; s += expected[k]; d += e; d2 += e * e; c++; }
  const sd = Math.sqrt(Math.max(0, d2 / c - (d / c) ** 2) * (c / (c - 1)));
  return sd > 0 ? s / c / sd : Infinity;
}
