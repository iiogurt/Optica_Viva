// Sky colours and sunsets: single scattering of sunlight in a spherical atmosphere. Pure functions;
// lengths in metres, wavelengths in nm.
//
// Molecules scatter with the Rayleigh cross-section σ = 24π³(n² − 1)²/(N²λ⁴(n² + 2)²)·F_K ≈
// 8π³(n² − 1)²/(3N²λ⁴)·F_K (King factor F_K = (6 + 3ρ)/(6 − 7ρ), depolarisation ρ = 0.0279), with the
// index of dry air from Peck & Reeder (1972) and N = 2.547·10²⁵ m⁻³ at 15 °C and 1013.25 hPa; their
// number falls with height with a scale height of 8.4 km. Aerosols (haze) follow Ångström's law,
// β ∝ λ^(−α), with a scale height of 1.2 km and a Henyey–Greenstein phase function (g = 0.76).
// Ozone absorbs in the Chappuis band around 600 nm (a Gaussian approximation to the band, a tent
// profile between 10 and 40 km, 300 Dobson units) and keeps the twilight sky blue.
//
// The light reaching the eye along a direction is the sum, along that ray, of sunlight scattered
// towards the eye, each contribution dimmed by the optical depth to the Sun and back to the eye.
// Light scattered more than once is left out.
import { cmf, xyzToLinearRGB } from './color.js';
import { planck } from './colorsci.js';

// HR: the scale height whose column N·HR holds the air that weighs the sea-level pressure, P₀/(m g)
// (2.15·10²⁹ molecules/m²), so the vertical Rayleigh optical depth is right (0.097 at 550 nm).
export const RE = 6.371e6, TOP = 1e5, HR = 8434, HM = 1200;
export const LAMS = [400, 440, 480, 520, 560, 600, 640, 680];
const NAIR = 2.54743e25, RHO = 0.0279, FK = (6 + 3 * RHO) / (6 - 7 * RHO);

// Index of dry air (Peck & Reeder 1972), λ in nm.
export function nAir(lam) {
  const s2 = (1000 / lam) ** 2;
  return 1 + 1e-8 * (8060.51 + 2480990 / (132.274 - s2) + 17455.7 / (39.32957 - s2));
}
// Rayleigh scattering coefficient at sea level (1/m).
export function rayleighBeta(lam) {
  const n = nAir(lam), l = lam * 1e-9;
  return ((8 * Math.PI ** 3 * (n * n - 1) ** 2) / (3 * NAIR * l ** 4)) * FK;
}
// Ozone: Chappuis-band cross-section (m²), a Gaussian fitted to the band's peak (≈ 5·10⁻²⁵ m² near
// 600 nm) and width; 300 DU = 8.07·10²² molecules/m².
export const ozoneSigma = (lam) => 5.0e-25 * Math.exp(-(((lam - 603) / 65) ** 2));
const O3_COLUMN = 300 * 2.687e20;
const ozoneProfile = (h) => (h < 1e4 || h > 4e4 ? 0 : h < 2.5e4 ? (h - 1e4) / 1.5e4 : (4e4 - h) / 1.5e4); // tent, peak 25 km
const O3_PEAK = O3_COLUMN / 1.5e4; // molecules/m³ at the peak (the tent's area is 15 km)

// Densities at height h (m): Rayleigh and aerosol relative to sea level, ozone absolute (1/m³).
export const densities = (h) => [Math.exp(-h / HR), Math.exp(-h / HM), O3_PEAK * ozoneProfile(h)];

// Distance along a ray from height h (radius RE + h) with cosine of zenith angle mu to the top of the
// atmosphere, or -1 if it meets the ground first.
function toTop(h, mu) {
  const r = RE + h, b = r * mu, c = r * r - (RE + TOP) ** 2, cg = r * r - RE * RE;
  if (mu < 0 && b * b - cg >= 0) return -1; // hits the ground
  return -b + Math.sqrt(b * b - c);
}
// Column amounts along a ray (Rayleigh and aerosol in metres of sea-level air, ozone in molecules/m²).
export function column(h, mu, steps = 24) {
  const L = toTop(h, mu);
  if (L < 0) return null;
  const ds = L / steps, r = RE + h;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * ds, hh = Math.sqrt(r * r + s * s + 2 * r * s * mu) - RE, d = densities(hh);
    a += d[0] * ds; b += d[1] * ds; c += d[2] * ds;
  }
  return [a, b, c];
}

// The atmosphere's extinction at each wavelength for a column [rayleigh, aerosol, ozone].
export function opticalDepth(col, lam, { aod = 0.1, alpha = 1.3, ozone = true } = {}) {
  const bm = (aod / HM) * (lam / 550) ** -alpha;
  return rayleighBeta(lam) * col[0] + bm * col[1] + (ozone ? ozoneSigma(lam) * col[2] : 0);
}
// Relative air mass: the Rayleigh column along zenith angle z over the vertical one (spherical air),
// and the formula of Kasten & Young (1989) for comparison.
export function airMass(z) {
  const c = column(0, Math.cos(z), 400), v = column(0, 1, 400);
  return c ? c[0] / v[0] : Infinity;
}
export const kastenYoung = (zDeg) => 1 / (Math.cos((zDeg * Math.PI) / 180) + 0.50572 * (96.07995 - zDeg) ** -1.6364);

const phaseR = (c) => (3 / (16 * Math.PI)) * (1 + c * c);
const phaseHG = (c, g = 0.76) => (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * c) ** 1.5);

// Radiance (relative, per unit solar irradiance at each λ) along the view direction v (unit vector,
// z up) from height h, with the Sun in direction s.
export function skyRadiance(v, s, atm = {}, h = 1, steps = 16) {
  const { aod = 0.1, alpha = 1.3, ozone = true } = atm, out = new Float64Array(LAMS.length);
  const L = toTop(h, v[2]);
  const len = L < 0 ? (() => { const r = RE + h, b = r * v[2]; return -b - Math.sqrt(b * b - (r * r - RE * RE)); })() : L;
  const ds = len / steps, r0 = RE + h, cosT = v[0] * s[0] + v[1] * s[1] + v[2] * s[2], pR = phaseR(cosT), pM = phaseHG(cosT);
  const bR = LAMS.map(rayleighBeta), bM = LAMS.map((l) => (aod / HM) * (l / 550) ** -alpha), sO = LAMS.map((l) => (ozone ? ozoneSigma(l) : 0));
  const acc = [0, 0, 0]; // columns from the eye to the current point
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds, px = v[0] * t, py = v[1] * t, pz = r0 + v[2] * t, rr = Math.hypot(px, py, pz), hh = rr - RE, d = densities(hh);
    acc[0] += d[0] * ds; acc[1] += d[1] * ds; acc[2] += d[2] * ds;
    const mu = (px * s[0] + py * s[1] + pz * s[2]) / rr, sc = column(hh, mu, 8);
    if (!sc) continue; // the Sun is below this point's horizon
    for (let k = 0; k < LAMS.length; k++) {
      const tau = bR[k] * (acc[0] + sc[0]) + bM[k] * (acc[1] + sc[1]) + sO[k] * (acc[2] + sc[2]);
      out[k] += Math.exp(-tau) * (bR[k] * d[0] * pR + bM[k] * d[1] * pM) * ds;
    }
  }
  return out;
}

// Spectrum (per wavelength in LAMS) → XYZ, weighted by the Sun's spectrum (a 5778 K blackbody).
const SUN = LAMS.map((l) => planck(l, 5778) / planck(560, 5778));
const CMFS = LAMS.map(cmf);
export function toXYZ(spec) {
  const xyz = [0, 0, 0], dl = LAMS[1] - LAMS[0];
  for (let k = 0; k < LAMS.length; k++) for (let c = 0; c < 3; c++) xyz[c] += spec[k] * SUN[k] * CMFS[k][c] * dl;
  return xyz;
}

// The panorama facing the Sun: W × H directions spanning azimuths ±az (rad) around the Sun and
// elevations lo…hi (rad), with the Sun at elevation sunEl. Linear sRGB per pixel (Float32Array 3·W·H).
export function skyPanorama({ W = 128, H = 64, az = 1.75, lo = -0.07, hi = 0.9, sunEl = 0.1, aod = 0.1, alpha = 1.3, ozone = true, back = false }) {
  // back: facing away from the Sun (the Earth's shadow and the Belt of Venus at twilight)
  const out = new Float32Array(W * H * 3), s = [back ? -Math.cos(sunEl) : Math.cos(sunEl), 0, Math.sin(sunEl)], atm = { aod, alpha, ozone };
  for (let j = 0; j < H; j++) {
    const el = hi - ((j + 0.5) / H) * (hi - lo);
    for (let i = 0; i < W; i++) {
      const a = ((i + 0.5) / W - 0.5) * 2 * az, v = [Math.cos(el) * Math.cos(a), Math.cos(el) * Math.sin(a), Math.sin(el)];
      const k = (j * W + i) * 3;
      if (el < 0) { // the ground: dark, lit a little by the sky
        const g = 0.03 * Math.max(0, Math.sin(sunEl + 0.05));
        out[k] = g; out[k + 1] = g * 0.95; out[k + 2] = g * 0.9;
        continue;
      }
      const rgb = xyzToLinearRGB(toXYZ(skyRadiance(v, s, atm)));
      out[k] = rgb[0]; out[k + 1] = rgb[1]; out[k + 2] = rgb[2];
    }
  }
  return out;
}

// The Sun's disc: the transmitted solar spectrum along the line of sight (linear sRGB, relative to
// the Sun above the atmosphere), and the transmission at each wavelength.
export function sunColour(sunEl, atm = {}) {
  const col = column(1, Math.sin(sunEl), 200);
  if (!col) return { rgb: [0, 0, 0], T: LAMS.map(() => 0) };
  const T = LAMS.map((l) => Math.exp(-opticalDepth(col, l, atm))), top = xyzToLinearRGB(toXYZ(LAMS.map(() => 1)));
  const rgb = xyzToLinearRGB(toXYZ(T));
  return { rgb: rgb.map((v, c) => v / top[1]), T };
}
