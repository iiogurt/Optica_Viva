// Mission "Photograph the Milky Way": exposure before stars trail, ISO-invariance point, read noise
// against sky noise, and the number of frames to stack for a chosen faint detail. Pure functions.
import { SENSORS, pitchUm, crop } from './sensors.js';
import { BORTLE, surfaceRate } from './stacking.js';

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
  const S = SENSORS[sensor], pitch = pitchUm(S), k = crop(S);
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
