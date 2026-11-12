// Star trackers: how a small camera tells a spacecraft which way it points. Pure functions.
//
// Stars: the mean number of stars brighter than visual magnitude m over the whole sky is taken as
//   N(<m) ≈ 4800 · 10^(0.46 (m − 6))   (a fit to the Hipparcos/Tycho counts for 4 ≲ m ≲ 9),
// scaled by a factor for galactic latitude (about ×0.5 near the poles, ×2.5 in the Milky Way).
// Signal: photo-electrons from a star of magnitude m, S = Φ₀ · 10^(−0.4 m) · A · t, with
// Φ₀ = 2 × 10¹⁰ e⁻ s⁻¹ m⁻² (a V-band zero point of 1000 photons s⁻¹ cm⁻² Å⁻¹ over 400–900 nm,
// quantum efficiency × optics 0.4).
// Centroid: the star is deliberately defocused to a Gaussian of σ pixels; its pixel-integrated image
// plus Poisson and read noise is measured by the centre of mass in a window. Small spots give a
// systematic "S-curve" error that depends on where the star sits within the pixel.
// Motion: a spacecraft turning at ω smears each star into a trail L = ω t / IFOV pixels long, which
// spreads the light over more pixels (the noise area grows from 4πσ² to 2√π σ (2√π σ + L)).
// Saturation: no pixel holds more than its full well.
// Attitude (Liebe 2002): with N stars measured to σ_c pixels each, n pixels across a field of view
// FOV, the pointing error across the boresight is σ_c · FOV/n / √N, and the roll about it
//   σ_roll = atan(σ_c / (0.3825 n)) / √N,
// 0.3825 being the mean distance of a random point in a unit square from its centre.
import { makeRng } from './random.js';

export const PHI0 = 2e10, SKY_DEG2 = 41252.96, ARCSEC = Math.PI / 648000;
export const LATITUDE = { pole: 0.5, mean: 1, plane: 2.5 };

export const starsBrighter = (m, lat = 1) => 4800 * 10 ** (0.46 * (m - 6)) * lat;
export const electrons = (m, D, t) => PHI0 * 10 ** (-0.4 * m) * (Math.PI * D * D / 4) * t;
export const MEAN_R = (Math.SQRT2 + Math.log(1 + Math.SQRT2)) / 6; // 0.38260…

// the brightest magnitude seen as `snr` above the noise of the pixels under a spot of σ px
export const smear = (p) => ((p.rate || 0) * p.t * 3600) / ((p.fov * 3600) / p.n);
export const noiseArea = (sigma, L) => 2 * Math.sqrt(Math.PI) * sigma * (2 * Math.sqrt(Math.PI) * sigma + L) + 1;
export function limitingMag(p, snr = 5) {
  const npx = noiseArea(p.sigma, smear(p)), varPx = p.read * p.read + p.dark * p.t;
  // S² = snr² (S + npx·var)  →  S = (snr² + √(snr⁴ + 4 snr² npx var)) / 2
  const S = (snr * snr + Math.sqrt(snr ** 4 + 4 * snr * snr * npx * varPx)) / 2;
  return -2.5 * Math.log10(S / (PHI0 * (Math.PI * p.D * p.D / 4) * p.t));
}

// p: { fov (deg, square field), n (pixels across), D (m), t (s), sigma (px), read (e⁻), dark (e⁻/s), lat }
export function attitude(p, sc) {
  const mlim = limitingMag(p), N = starsBrighter(mlim, p.lat) * (p.fov * p.fov) / SKY_DEG2, ifov = (p.fov * 3600) / p.n;
  const n = Math.max(1, N);
  return { mlim, N, ifov, cross: (sc * ifov) / Math.sqrt(n), roll: (Math.atan(sc / (MEAN_R * p.n)) / Math.sqrt(n)) / ARCSEC, pAtLeast3: 1 - Math.exp(-N) * (1 + N + N * N / 2) };
}

// pixel-integrated Gaussian of a star at (x0, y0) in a w × w window, S electrons
const erf = (x) => { const s = Math.sign(x), z = Math.abs(x), q = 1 / (1 + 0.3275911 * z); return s * (1 - (((((1.061405429 * q - 1.453152027) * q) + 1.421413741) * q - 0.284496736) * q + 0.254829592) * q * Math.exp(-z * z)); };
export function spot(x0, y0, sigma, w, S, L = 0, wx = w) {
  const a = new Float64Array(wx * w), k = 1 / (Math.SQRT2 * sigma), fy = new Float64Array(w), fx = new Float64Array(wx);
  for (let j = 0; j < w; j++) fy[j] = 0.5 * (erf((j + 1 - y0) * k) - erf((j - y0) * k));
  // a trail of length L along x, centred on x0: the average of K spots along it
  const K = L > 0 ? Math.max(2, Math.ceil(4 * L)) : 1;
  for (let q = 0; q < K; q++) {
    const xc = K > 1 ? x0 - L / 2 + (L * q) / (K - 1) : x0;
    for (let i = 0; i < wx; i++) fx[i] = 0.5 * (erf((i + 1 - xc) * k) - erf((i - xc) * k));
    for (let j = 0; j < w; j++) for (let i = 0; i < wx; i++) a[j * wx + i] += (S / K) * fx[i] * fy[j];
  }
  return a;
}
// centre of mass of a wx × w window (pixel centres at i + ½)
export function centroid(img, w, wx = w) {
  let s = 0, sx = 0, sy = 0;
  for (let j = 0; j < w; j++) for (let i = 0; i < wx; i++) { const v = img[j * wx + i]; s += v; sx += v * (i + 0.5); sy += v * (j + 0.5); }
  return [sx / s, sy / s];
}
// systematic error of the centre of mass against the sub-pixel position, noiseless (the S-curve)
export function sCurve(sigma, w, n = 41) {
  const out = [], c = Math.floor(w / 2);
  for (let k = 0; k < n; k++) { const f = k / (n - 1) - 0.5, x0 = c + 0.5 + f; out.push([f, centroid(spot(x0, w / 2, sigma, w, 1), w)[0] - x0]); }
  return out;
}
// one noisy exposure: electrons (clipped at the full well), Poisson and read noise
export function exposure(rng, x0, y0, sigma, w, S, read, well = Infinity, L = 0, wx = w) {
  const a = spot(x0, y0, sigma, w, S, L, wx);
  for (let i = 0; i < a.length; i++) a[i] = Math.min(well, rng.poisson(a[i])) + read * rng.g();
  return a;
}
// the window for a spot of σ px and a trail of L px: ±3σ around it, at least 3 pixels
export const windowFor = (sigma, L = 0) => [Math.max(3, 2 * Math.ceil(3 * sigma) + 1), Math.max(3, 2 * Math.ceil(3 * sigma + L / 2) + 1)];
// RMS centroid error (px) from `trials` exposures at random sub-pixel positions: across the trail (y) and along it (x)
export function centroidError(sigma, S, read, { trials = 300, seed = 1, well = Infinity, L = 0 } = {}) {
  const rng = makeRng(seed), [w, wx] = windowFor(sigma, L), c = Math.floor(w / 2), cx = Math.floor(wx / 2);
  let sx = 0, sy = 0;
  for (let t = 0; t < trials; t++) {
    const x0 = cx + rng.u(), y0 = c + rng.u(), [x, y] = centroid(exposure(rng, x0, y0, sigma, w, S, read, well, L, wx), w, wx);
    sx += (x - x0) ** 2; sy += (y - y0) ** 2;
  }
  return Math.sqrt((sx + sy) / (2 * trials));
}

// centroid error against magnitude: [m, Monte Carlo (px), photon-noise floor σ/√S]
export function errorCurve(p, m0 = 0, m1 = 9, n = 19, trials = 240) {
  const out = [], L = smear(p), read = Math.hypot(p.read, Math.sqrt(p.dark * p.t));
  for (let i = 0; i < n; i++) {
    const m = m0 + ((m1 - m0) * i) / (n - 1), S = electrons(m, p.D, p.t);
    out.push([m, centroidError(p.sigma, S, read, { trials, seed: 17 + i, well: p.well, L }), p.sigma / Math.sqrt(S)]);
  }
  return out;
}

// Attitude from all the stars in the field, each weighted by its own centroid error:
// information I = ∫ (dN/dm) σ_c(m)⁻² dm up to the limiting magnitude (N stars of equal σ_c give N/σ_c²),
// then σ_cross = IFOV/√I and σ_roll = atan(1/(0.3825 n √I)) (Liebe's formulas with σ_c/√N → 1/√I).
export function attitudeFrom(curve, p) {
  const a = attitude(p, 1), field = (p.fov * p.fov) / SKY_DEG2;
  let I = 0;
  for (let i = 1; i < curve.length; i++) {
    const [m0, e0] = curve[i - 1], [m1, e1] = curve[i];
    if (m0 >= a.mlim) break;
    const hi = Math.min(m1, a.mlim), dN = (starsBrighter(hi, p.lat) - starsBrighter(m0, p.lat)) * field;
    I += dN / Math.sqrt(e0 * e0 * e1 * e1); // geometric mean of the squared errors across the bin
  }
  return { ...a, I, cross: a.ifov / Math.sqrt(I), roll: Math.atan(1 / (MEAN_R * p.n * Math.sqrt(I))) / ARCSEC };
}

// a field of stars: positions in [0,1)², magnitudes from the counts above, brightest first
export function starField(p, seed, mMax = 9.5) {
  const rng = makeRng(seed), mean = starsBrighter(mMax, p.lat) * (p.fov * p.fov) / SKY_DEG2, N = rng.poisson(Math.min(mean, 4000));
  const stars = [];
  // inverse of N(<m) ∝ 10^(0.46 m) for a uniform deviate
  for (let i = 0; i < N; i++) stars.push({ x: rng.u(), y: rng.u(), m: mMax + Math.log10(rng.u()) / 0.46 });
  return stars.sort((a, b) => a.m - b.m);
}
