// Mission "Photograph the Milky Way": exposure before stars trail, ISO-invariance point, read noise
// against sky noise, and the number of frames to stack for a chosen faint detail. Pure functions.
import { SENSORS, pitchUm, crop } from './sensors.js';
import { BORTLE, surfaceRate, ZP } from './stacking.js';
import { makeRng } from './random.js';

export const SIDEREAL = 7.2921e-5; // rad/s, Earth's rotation relative to the stars
const LAMBDA = 0.55e-3; // mm
const ARCSEC = Math.PI / 648000;
export const SHUTTER = [1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30];
export const ISOS = [400, 800, 1600, 3200, 6400, 12800];

// Two-stage read noise (as in the noise laboratory): pre-amplifier noise plus ADC noise divided by
// the analogue gain, input-referred, in electrons. Base ISO 100.
export const readNoise = (iso, pre = 1.6, post = 12) => Math.hypot(pre, post / (iso / 100));

// Longest exposure before a star trails by more than the blur already present. On the sensor a
// star at declination δ moves at f ω cos δ; the allowed trail is two pixels or the Airy diameter,
// whichever is larger.
export function trailLimit(f, N, pitch, dec) {
  const allowed = Math.max(2 * pitch / 1000, 2.44 * LAMBDA * N); // mm
  const speed = f * SIDEREAL * Math.max(Math.cos((dec * Math.PI) / 180), 1e-3); // mm/s
  return { t: allowed / speed, allowed, speed };
}
// Popular rules for comparison: the 500 rule and the simplified NPF rule (Michaud), both for the
// celestial equator, the worst case.
export const rule500 = (f, k) => 500 / (f * k);
export const ruleNPF = (f, N, pitch) => (35 * N + 30 * pitch) / f;

// The ISO above which read noise stops falling (within 10 % of the pre-amplifier floor).
export function invarianceISO(pre = 1.6, post = 12) {
  const g = post / (pre * Math.sqrt(1.1 ** 2 - 1));
  return 100 * g;
}

export const pick = (list, x, below = true) => (below ? [...list].reverse().find((v) => v <= x) ?? list[0] : list.find((v) => v >= x) ?? list[list.length - 1]);

// Full plan. Inputs: sensor key, focal length f (mm), f-number N, target declination (°), Bortle
// class, faintest detail μ (mag/arcsec²), system throughput × QE q, target SNR of that detail.
export function plan({ sensor = 'ff', f = 20, N = 2.8, dec = -29, bortle = 3, mu = 23, q = 0.3, snr = 5, pre = 1.6, post = 12 }) {
  const S = typeof sensor === 'string' ? SENSORS[sensor] : sensor, pitch = pitchUm(S), k = crop(S);
  const trail = trailLimit(f, N, pitch, dec);
  const t = pick(SHUTTER, trail.t);
  const isoInv = invarianceISO(pre, post);
  const iso = ISOS.reduce((b, v) => (Math.abs(Math.log(v / isoInv)) < Math.abs(Math.log(b / isoInv)) ? v : b)); // nearest in stops
  const sigma = readNoise(iso, pre, post);
  const D = f / N / 10; // cm
  const p = (pitch / 1000 / f) / ARCSEC; // arcsec per pixel
  const Fs = surfaceRate(BORTLE[bortle], D, p, q), Fd = surfaceRate(mu, D, p, q);
  const sky = Fs * t; // sky electrons per pixel per frame
  const readShare = (sigma * sigma) / (sky + sigma * sigma); // fraction of the noise variance from read noise
  const s1 = (Fd * t) / Math.sqrt((Fd + Fs) * t + sigma * sigma); // SNR of the detail in one frame
  const frames = Math.max(1, Math.ceil((snr / s1) ** 2));
  // the same detail under a pristine (Bortle 1) sky
  const Fs1 = surfaceRate(BORTLE[1], D, p, q);
  const frames1 = Math.max(1, Math.ceil((snr / ((Fd * t) / Math.sqrt((Fd + Fs1) * t + sigma * sigma))) ** 2));
  return {
    S, pitch, k, trail, t, t500: rule500(f, k), tNPF: ruleNPF(f, N, pitch), iso, isoInv, sigma, D, p,
    Fs, Fd, sky, readShare, s1, frames, total: frames * t, frames1, trailPx: (trail.speed * t * 1000) / pitch,
  };
}

// ── The photograph the plan gives ──────────────────────────────────────────────────────────
// A crop of W × H pixels at 100 % from the middle of the frame, in electrons per pixel: the sky glow
// F_s t, the Milky Way's faint detail F_d t shaped by a seeded cloud pattern with dark lanes (0 … 2
// times the planned detail), and stars from a power-law count (N(<m) ∝ 10^(0.35 m)) imaged with the
// lens's blur and smeared into trails of the planned length. One frame adds Gaussian approximations
// of photon noise (√signal) and read noise σ; the stack averages `frames` such frames, so its noise
// is √frames times smaller. Returns { one, stack, sky, noise1 } with Float32Arrays of W·H.
export function milkywayShot(P, { W = 200, H = 130, seed = 7, N = 2.8 } = {}) {
  const rng = makeRng(seed), u = rng.u, t = P.t, sky = P.Fs * t, det = P.Fd * t, sigma = P.sigma;
  const clean = new Float32Array(W * H);
  // the detail: smooth value noise on a coarse grid, a band across the crop and two dark lanes
  const G = 24, grid = Float32Array.from({ length: G * G }, () => u());
  const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, a = grid[(j % G) * G + (i % G)], b = grid[(j % G) * G + ((i + 1) % G)], c = grid[((j + 1) % G) * G + (i % G)], d = grid[((j + 1) % G) * G + ((i + 1) % G)], sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i / W, y = j / H, n = 0.55 * vn(x * 5, y * 5) + 0.3 * vn(x * 11 + 3, y * 11 + 7) + 0.15 * vn(x * 23 + 5, y * 23 + 1);
    const band = Math.exp(-(((y - 0.5 - 0.18 * (x - 0.5)) / 0.32) ** 2));
    const lane = 1 - 0.8 * Math.exp(-(((y - 0.47 - 0.12 * (x - 0.5) - 0.05 * Math.sin(x * 9)) / 0.045) ** 2));
    clean[j * W + i] = sky + det * 2 * band * lane * Math.min(1, Math.max(0, (n - 0.25) * 1.6));
  }
  // stars: magnitudes 6 … 14 (fainter ones vanish in the noise), rate F = ZP·10^(−0.4m)·π(D/2)²·q
  // the star image: the diffraction blur (FWHM 1.03 λN) or the pixel, whichever is larger, as in the
  // one-star panel; σ in pixels
  const blur = Math.max(0.45, (1.03 * LAMBDA * N) / 2.355 / (P.pitch / 1000)), L = P.trailPx;
  const per = W * H / 1500; // about this many stars brighter than 14 per 1500 pixels at these scales
  for (let k = 0; k < per * 60; k++) {
    const m = 14 - Math.log10(1 + u() * (10 ** (0.35 * 8) - 1)) / 0.35; // N(<m) ∝ 10^(0.35 m), 6 ≤ m ≤ 14
    if (u() > 0.02) continue; // thin to a realistic density
    const F = ZP * Math.pow(10, -0.4 * m) * Math.PI * (P.D / 2) ** 2 * 0.3 * t, x0 = u() * W, y0 = u() * H;
    const steps = Math.max(1, Math.ceil(L * 2)), s2 = 2 * blur * blur, R = Math.ceil(3 * blur + L / 2 + 1);
    for (let s = 0; s < steps; s++) {
      const cx = x0 + (steps > 1 ? (s / (steps - 1) - 0.5) * L : 0), share = F / steps / (Math.PI * s2);
      for (let j = Math.max(0, Math.floor(y0 - R)); j <= Math.min(H - 1, Math.ceil(y0 + R)); j++) for (let i = Math.max(0, Math.floor(cx - 3 * blur - 1)); i <= Math.min(W - 1, Math.ceil(cx + 3 * blur + 1)); i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - y0; clean[j * W + i] += share * Math.exp(-(dx * dx + dy * dy) / s2);
      }
    }
  }
  const frames = P.frames, one = new Float32Array(W * H), stack = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const v = clean[k], sd = Math.sqrt(Math.max(0, v) + sigma * sigma);
    one[k] = v + sd * rng.g();
    stack[k] = v + (sd / Math.sqrt(frames)) * rng.g();
  }
  return { one, stack, W, H, sky, det, noise1: Math.sqrt(sky + sigma * sigma) };
}
