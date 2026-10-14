import { gaussianExact } from './macro.js';
// Earth observation from orbit: ground sample distance, push-broom line rate and time-delay
// integration, diffraction against pixels, system MTF, and the photons a pixel collects from a
// sunlit ground. Pure functions; SI units unless stated.

export const GM = 3.986004418e14, RE = 6.371e6, H_PLANCK = 6.626e-34, C = 2.998e8;

// Circular orbit: orbital speed and the speed of the ground track (nadir point).
export function orbitSpeed(H) {
  const v = Math.sqrt(GM / (RE + H));
  return { v, ground: (v * RE) / (RE + H), period: (2 * Math.PI * (RE + H)) / v };
}
// Ground sample distance at nadir: the pixel projected through focal length f from height H.
export const gsd = (H, f, p) => (H * p) / f;
// Optics Q: diffraction blur against the pixel, λN/p (Q = 2 samples the cut-off at Nyquist).
export const qFactor = (lam, f, D, p) => (lam * f) / (D * p);

// MTF of a diffraction-limited circular aperture at normalised frequency s = ν/ν_c.
export function mtfDiff(s) {
  if (s >= 1) return 0;
  return (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s));
}
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
// System MTF at the Nyquist frequency of the detector, along track: optics × pixel aperture × the
// smear of moving one pixel during each TDI line (a box of one pixel).
export function mtfNyquist(lam, f, D, p) {
  const nyq = 1 / (2 * p), nuC = D / (lam * f);
  const optics = mtfDiff(nyq / nuC), pixel = Math.abs(sinc(0.5)), smear = Math.abs(sinc(0.5));
  return { optics, pixel, smear, total: optics * pixel * smear };
}

// Photons per pixel per line: sunlit Lambertian ground of reflectance ρ under the Sun at elevation
// el, in a band of width Δλ around λ (solar spectral irradiance E_λ ≈ 1.5 W m⁻² nm⁻¹ at 550 nm),
// through atmospheric transmission T (sun to ground to satellite), aperture D, pixel solid angle
// (GSD/H)², quantum efficiency × optics throughput q, for the line time t and N TDI stages.
export function signal({ rho = 0.2, el = 45, band = 100, lam = 550e-9, T = 0.75, D, gsdM, H, t, N = 1, q = 0.4 }) {
  const Eph = (1.5 * band) / ((H_PLANCK * C) / lam); // photons s⁻¹ m⁻² at the top of the atmosphere
  const L = (rho * Eph * Math.sin((el * Math.PI) / 180) * T) / Math.PI; // photons s⁻¹ m⁻² sr⁻¹ at the satellite
  const e = L * Math.PI * (D / 2) ** 2 * (gsdM / H) ** 2 * t * N * q;
  return { e, snr: e / Math.sqrt(e + 2 * 2 * N) }; // read noise ≈ 2 e⁻ per stage
}

export function design({ H, D, f, p, N = 1, lam = 550e-9, el = 45, rho = 0.2 }) {
  const o = orbitSpeed(H), g = gsd(H, f, p);
  const lineRate = o.ground / g, t = 1 / lineRate;
  const Q = qFactor(lam, f, D, p), diffGround = (1.22 * lam * H) / D;
  const m = mtfNyquist(lam, f, D, p), s = signal({ rho, el, lam, D, gsdM: g, H, t, N });
  return { ...o, gsd: g, lineRate, t, Q, diffGround, mtf: m, ...s, Fnum: f / D };
}

// A panchromatic ground scene (reflectance) at 10 cm resolution, W × H metres: a crossroads with
// lane markings, parked cars, roofs, trees and lawn. Seeded so it is the same every time.
export function groundScene(Wm = 80, Hm = 56, res = 0.1, rnd = Math.random) {
  const W = Math.round(Wm / res), H = Math.round(Hm / res), g = new Float32Array(W * H).fill(0.12);
  const rect = (x0, y0, w, h, v) => { for (let y = Math.max(0, Math.round(y0 / res)); y < Math.min(H, Math.round((y0 + h) / res)); y++) for (let x = Math.max(0, Math.round(x0 / res)); x < Math.min(W, Math.round((x0 + w) / res)); x++) g[y * W + x] = v; };
  const disc = (cx, cy, r, v) => { for (let y = Math.max(0, Math.floor((cy - r) / res)); y < Math.min(H, Math.ceil((cy + r) / res)); y++) for (let x = Math.max(0, Math.floor((cx - r) / res)); x < Math.min(W, Math.ceil((cx + r) / res)); x++) if (Math.hypot(x * res - cx, y * res - cy) < r) g[y * W + x] = v; };
  // roads: a 14 m avenue along x and a 10 m street along y, with 15 cm lane markings
  rect(0, 20, Wm, 14, 0.08); rect(46, 0, 10, Hm, 0.08);
  for (let x = 0; x < Wm; x += 6) if (x + 3 < 45 || x > 57) rect(x, 26.9, 3, 0.15, 0.55);
  for (let y = 0; y < Hm; y += 6) if (y + 3 < 19 || y > 35) rect(50.9, y, 0.15, 3, 0.55);
  // zebra crossing
  for (let k = 0; k < 7; k++) rect(42.2, 20.5 + k * 1.9, 3, 0.5, 0.6);
  // buildings with lighter roofs and roof equipment
  rect(2, 2, 20, 15, 0.3); rect(5, 5, 3, 3, 0.45); rect(24, 3, 18, 14, 0.22); rect(60, 2, 18, 15, 0.34); rect(62, 38, 16, 16, 0.27); rect(2, 38, 14, 16, 0.32);
  // lawn and trees
  rect(20, 38, 24, 16, 0.07);
  for (let k = 0; k < 9; k++) disc(23 + (k % 3) * 8 + rnd() * 2, 41 + Math.floor(k / 3) * 5 + rnd(), 1.6 + rnd(), 0.04);
  // parked cars (4.5 × 1.8 m) along the avenue, with darker windscreens
  for (let k = 0; k < 9; k++) {
    const x = 1 + k * 5, v = [0.05, 0.4, 0.6, 0.18, 0.3][Math.floor(rnd() * 5)];
    rect(x, 20.3, 4.5, 1.8, v); rect(x + 1.2, 20.4, 0.9, 1.6, 0.05);
    if (k % 2) { rect(60 + k * 1.9, 31.9, 1.8, 4.5, v); }
  }
  return { g, W, H, res };
}

// The scene as recorded from orbit: blurred by the optics (Airy core as a Gaussian, σ = 0.42 λ/D
// projected to the ground), integrated over the pixel and over one pixel of motion along track,
// sampled at the GSD, with photon and read noise. Returns reflectance-like values per pixel.
export function imageFromOrbit(scene, r, { H, D, lam = 550e-9, N = 1 }, rng, gauss = gaussianExact) {
  let { g: src, W, H: Hp, res } = scene;
  // a wide blur hides detail finer than a third of its width: average the scene down first
  const k = Math.floor((0.42 * lam * H) / D / res / 3);
  if (k >= 2) {
    const w2 = Math.floor(W / k), h2 = Math.floor(Hp / k), d = new Float32Array(w2 * h2);
    for (let y = 0; y < h2 * k; y++) for (let x = 0; x < w2 * k; x++) d[Math.floor(y / k) * w2 + Math.floor(x / k)] += src[y * W + x] / (k * k);
    src = d; W = w2; Hp = h2; res *= k;
  }
  const sigma = (0.42 * lam * H) / D / res;
  const blurred = gauss(Float64Array.from(src), W, Hp, Math.max(0.3, sigma));
  const step = r.gsd / res, ow = Math.max(1, Math.floor(W / step)), oh = Math.max(1, Math.floor(Hp / step));
  const out = new Float32Array(ow * oh), ePerRho = r.e / 0.2;
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    // pixel aperture (one GSD) convolved with one GSD of smear along track (y): a triangle 2 GSD long
    let s = 0, wsum = 0;
    const x0 = Math.floor(i * step), x1 = Math.max(x0 + 1, Math.floor((i + 1) * step));
    const yc = (j + 0.5) * step, y0 = Math.max(0, Math.floor(yc - step)), y1 = Math.min(Hp, Math.ceil(yc + step));
    for (let y = y0; y < y1; y++) {
      const wy = Math.max(0, 1 - Math.abs(y + 0.5 - yc) / step);
      for (let x = x0; x < Math.min(W, x1); x++) { s += blurred[y * W + x] * wy; wsum += wy; }
    }
    const rho = wsum ? s / wsum : 0, e = rho * ePerRho;
    out[j * ow + i] = (e + Math.sqrt(e + 4 * N) * rng()) / ePerRho;
  }
  return { img: out, w: ow, h: oh };
}
