// Radial-velocity precision: how well a spectrograph measures the Doppler shift of a star, and
// which planets that reveals. Pure functions; velocities in m/s unless named km.
//
// Spectrum: a synthetic line list (seeded) on a grid uniform in velocity, Δv = c/(R·s) per pixel
// with s = 3 pixels per resolution element. Each line is a Gaussian in optical depth with the star's
// intrinsic (thermal + micro-turbulent) width; the flux exp(−Στ) is convolved with the rotation
// profile of Gray (2005), linear limb darkening ε = 0.6,
//   G(x) = [2(1−ε)√(1−x²) + (πε/2)(1−x²)] / [π v sin i (1 − ε/3)],   x = Δv / v sin i,
// and with the spectrograph's Gaussian line-spread function (FWHM c/R).
// Photon-noise limit (Connes 1985; Bouchy, Pepe & Queloz 2001): with A(i) photo-electrons in pixel i,
//   σ_V = 1 / √( Σ (dA/dv)² / A ),
// i.e. each pixel weighs by the square of the spectrum's slope; flat continuum carries nothing.
// Planet (circular orbit): K = (2πG/P)^(1/3) m_p sin i / (M⋆ + m_p)^(2/3).
import { makeRng } from './random.js';

export const C = 299792458, G = 6.6743e-11, MSUN = 1.98847e30, MEARTH = 5.9722e24, MJUP = 1.89813e27, DAY = 86400, YEAR = 365.25 * DAY;
export const SAMPLING = 3;

// Spectral types: lines per 100 nm, the deepest line depth, intrinsic Gaussian σ (km/s)
export const TYPES = {
  F: { lines: 800, depth: 0.75, sigma: 2.4, teff: 6500 },
  G: { lines: 1300, depth: 0.85, sigma: 2.0, teff: 5800 },
  K: { lines: 1900, depth: 0.9, sigma: 1.7, teff: 4800 },
  M: { lines: 2800, depth: 0.92, sigma: 1.5, teff: 3300 },
};

export const pixelVelocity = (R) => C / (R * SAMPLING);
// Rotation kernel sampled on a grid of step dv (m/s), normalised to unit sum
export function rotationKernel(vsini, dv, eps = 0.6) {
  const n = Math.max(0, Math.floor(vsini / dv)), k = new Float64Array(2 * n + 1);
  if (n === 0) { k[0] = 1; return k; }
  let s = 0;
  for (let i = -n; i <= n; i++) { const x = (i * dv) / vsini, q = Math.max(0, 1 - x * x); k[i + n] = 2 * (1 - eps) * Math.sqrt(q) + ((Math.PI * eps) / 2) * q; s += k[i + n]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}
export function gaussKernel(sigma, dv) {
  const n = Math.max(1, Math.ceil((4 * sigma) / dv)), k = new Float64Array(2 * n + 1);
  let s = 0;
  for (let i = -n; i <= n; i++) { k[i + n] = Math.exp(-0.5 * ((i * dv) / sigma) ** 2); s += k[i + n]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}
function convolve(a, k) {
  const n = a.length, m = k.length, h = m >> 1, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) { const q = Math.min(n - 1, Math.max(0, i + j - h)); s += a[q] * k[j]; }
    out[i] = s;
  }
  return out;
}

// The normalised spectrum (continuum 1) from l0 to l1 nm: { flux, l0, dv, n, lines }
export function spectrum({ type = 'G', R = 115000, vsini = 2000, l0 = 380, l1 = 690, seed = 7 } = {}) {
  const T = TYPES[type], dv = pixelVelocity(R), n = Math.ceil((Math.log(l1 / l0) * C) / dv), rng = makeRng(seed);
  // the intrinsic spectrum is built on a grid three times finer, so narrow lines are resolved
  const sub = 3, dvf = dv / sub, nf = n * sub, tau = new Float64Array(nf), sig = T.sigma * 1000;
  const count = Math.round((T.lines * (l1 - l0)) / 100), w = Math.ceil((4 * sig) / dvf), prof = new Float64Array(2 * w + 1);
  for (let j = -w; j <= w; j++) prof[j + w] = Math.exp(-0.5 * ((j * dvf) / sig) ** 2);
  for (let k = 0; k < count; k++) {
    const c = rng.u() * nf, d = T.depth * rng.u() ** 2.2, t0 = -Math.log(1 - d), i0 = Math.round(c);
    for (let j = -w; j <= w; j++) { const i = i0 + j; if (i >= 0 && i < nf) tau[i] += t0 * Math.exp(-0.5 * (((i - c) * dvf) / sig) ** 2); }
  }
  let f = new Float64Array(nf);
  for (let i = 0; i < nf; i++) f[i] = Math.exp(-tau[i]);
  if (vsini > dvf) f = convolve(f, rotationKernel(vsini, dvf));
  f = convolve(f, gaussKernel(C / R / 2.3548, dvf));
  const flux = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < sub; j++) s += f[i * sub + j]; flux[i] = s / sub; }
  return { flux, l0, l1, dv, n, lines: count };
}
export const lambdaAt = (sp, i) => sp.l0 * Math.exp((i * sp.dv) / C);

// Photon-noise limit for a continuum of N photo-electrons per pixel: σ_V (m/s), and the quality
// factor Q of Bouchy et al., defined by σ_V = c / (Q √N_e) with N_e the electrons in the spectrum.
// σ_V scales as 1/√N, so σ at N = 1 serves for every signal-to-noise ratio.
export function precision(sp, N) {
  let w = 0, tot = 0;
  for (let i = 1; i < sp.n - 1; i++) {
    const A = N * sp.flux[i], dA = (N * (sp.flux[i + 1] - sp.flux[i - 1])) / (2 * sp.dv);
    w += (dA * dA) / A; tot += A;
  }
  const sigma = 1 / Math.sqrt(w);
  return { sigma, Q: C / (sigma * Math.sqrt(tot)), electrons: tot };
}
// Monte-Carlo: the optimal (least-squares) velocity from `trials` noisy spectra; returns the errors
export function monteCarlo(sp, N, trials = 48, seed = 3) {
  const rng = makeRng(seed), n = sp.n, d = new Float64Array(n);
  let norm = 0;
  for (let i = 1; i < n - 1; i++) { const A = N * sp.flux[i]; d[i] = (N * (sp.flux[i + 1] - sp.flux[i - 1])) / (2 * sp.dv); norm += (d[i] * d[i]) / A; }
  const out = new Float64Array(trials);
  for (let t = 0; t < trials; t++) {
    let s = 0;
    for (let i = 1; i < n - 1; i++) { const A = N * sp.flux[i]; s += (rng.g() * Math.sqrt(A) * d[i]) / A; }
    // data − template = −v·dA/dv + noise, so v̂ = −Σ(r·A'/A)/Σ(A'²/A); its error is that sum
    out[t] = -s / norm;
  }
  return out;
}

// Semi-amplitude of the star's reflex motion (circular orbit, sin i = 1 unless given)
export const semiAmplitude = (mp, P, Mstar, sini = 1) => Math.cbrt((2 * Math.PI * G) / P) * ((mp * sini) / (Mstar + mp) ** (2 / 3));
export const PLANETS = {
  peg51: { mp: 0.46 * MJUP, P: 4.2308 * DAY, M: 1.11 * MSUN },
  jupiter: { mp: MJUP, P: 11.862 * YEAR, M: MSUN },
  proxb: { mp: 1.07 * MEARTH, P: 11.186 * DAY, M: 0.122 * MSUN },
  hotNeptune: { mp: 17 * MEARTH, P: 10 * DAY, M: MSUN },
  earth: { mp: MEARTH, P: YEAR, M: MSUN },
};
// N observations at random phases, each with error σ (m/s); the fitted K and its uncertainty
// (least squares for a sin + b cos at the known period)
export function observe(K, sigma, N, seed = 5) {
  const rng = makeRng(seed), pts = [];
  let ss = 0, cc = 0, sc = 0, ys = 0, yc = 0;
  for (let k = 0; k < N; k++) {
    const ph = rng.u(), v = K * Math.sin(2 * Math.PI * ph) + sigma * rng.g(), s = Math.sin(2 * Math.PI * ph), c = Math.cos(2 * Math.PI * ph);
    pts.push([ph, v]); ss += s * s; cc += c * c; sc += s * c; ys += v * s; yc += v * c;
  }
  const det = ss * cc - sc * sc, a = (ys * cc - yc * sc) / det, b = (yc * ss - ys * sc) / det;
  // uncertainty of the amplitude √(a² + b²) when a dominates: σ √(cc/det)
  return { pts, K: Math.hypot(a, b), sigmaK: sigma * Math.sqrt(cc / det) };
}
