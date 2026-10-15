// Mission "Total solar eclipse": filters for the partial phases, framing, the exposure ladder of
// F. Espenak's NASA exposure guide, t = N²/(I·2^Q), and the drift limit on a fixed tripod.
import { SIDEREAL } from './milkyway.js';

// Brightness exponents Q (Espenak, NASA/TP-2004-212762, table 23). Corona heights are in solar
// radii above the limb. The 0.2 R☉ setting is also recommended for the diamond ring.
export const SUBJECTS = [
  ['Partial phases, ND 5.0 filter', 8, 'partial'],
  ['Baily\'s beads', 12, 'total'],
  ['Chromosphere', 11, 'total'],
  ['Prominences', 9, 'total'],
  ['Corona at 0.1 R☉ (inner)', 7, 'total'],
  ['Corona at 0.2 R☉ and the diamond ring', 5, 'total'],
  ['Corona at 0.5 R☉', 3, 'total'],
  ['Corona at 1 R☉', 1, 'total'],
  ['Corona at 2 R☉', 0, 'total'],
  ['Corona at 4 R☉', -1, 'total'],
  ['Corona at 8 R☉ (outer)', -3, 'total'],
];
export const CORONA = [[0.1, 7], [0.2, 5], [0.5, 3], [1, 1], [2, 0], [4, -1], [8, -3]];
export const SUN_RADIUS = 0.2666 * Math.PI / 180; // rad, mean apparent radius
export const SHUTTER = [1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8];

export const exposure = (N, iso, Q) => (N * N) / (iso * 2 ** Q);
export const nearestShutter = (t) => SHUTTER.reduce((b, v) => (Math.abs(Math.log(v / t)) < Math.abs(Math.log(b / t)) ? v : b));
// Brightness exponent of the corona at height h (R☉ above the limb), interpolated in log h.
export function coronaQ(h) {
  if (h <= CORONA[0][0]) return CORONA[0][1];
  for (let i = 1; i < CORONA.length; i++) if (h <= CORONA[i][0]) {
    const [h0, q0] = CORONA[i - 1], [h1, q1] = CORONA[i], u = Math.log(h / h0) / Math.log(h1 / h0);
    return q0 + u * (q1 - q0);
  }
  return CORONA[CORONA.length - 1][1] - 2 * Math.log2(h / 8);
}
// Longest exposure before the Sun drifts by `px` pixels on a fixed tripod (the Sun moves at close
// to the sidereal rate times the cosine of its declination; the equator is the worst case).
export const driftLimit = (fmm, pitchUm, px = 1) => (px * pitchUm * 1e-3) / (fmm * SIDEREAL);
// Focal length at which the corona out to `h` R☉ above the limb just fills the sensor's short side.
export const fFor = (shortMm, h) => shortMm / (2 * Math.tan((1 + h) * SUN_RADIUS));
