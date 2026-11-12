// The natural night sky: airglow and zodiacal light, the light that sets the darkest possible sky for
// a camera on the ground (and, for the zodiacal light, in space). Pure functions; brightness in S10
// (the light of one 10th-magnitude star per square degree, V band) unless named.
//
// Zodiacal light: Table 16 of Leinert et al. (1998), measured outside the atmosphere at 500 nm, in S10,
// against the ecliptic longitude from the Sun |λ − λ⊙| and the ecliptic latitude |β|; the ecliptic pole
// (60 ± 3 S10, the paper's text) is added as β = 90°. Bilinear interpolation; no data within about
// 15° of the Sun.
// Airglow: a thin emitting layer at h = 90 km seen through the van Rhijn factor
//   V(z) = 1/√(1 − (R/(R + h))² sin² z),
// near 140 S10 at the zenith at solar minimum (about 65 % of a 21.9 mag arcsec⁻² dark sky), up to
// 0.5 mag brighter at solar maximum (Patat 2003; 2008).
// Atmosphere: both are dimmed by extinction 10^(−0.4 k X), with the airmass of Krisciunas & Schaefer
// (1991), X = (1 − 0.96 sin² z)^(−1/2).
// Magnitudes: μ = 10 − 2.5 log₁₀(S10 / 3600²)  mag arcsec⁻²  (60 S10 = 23.3, 220 S10 = 21.9).

export const RAD = Math.PI / 180, R_EARTH = 6371, H_AIRGLOW = 90, ARCSEC2_PER_DEG2 = 3600 * 3600;
export const AIRGLOW_MIN = 140, CYCLE_MAG = 0.5;

const LON = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
const LAT = [0, 5, 10, 15, 20, 25, 30, 45, 60, 75, 90];
const X = Infinity;
const ZODI = [
  [X, X, X, 2450, 1260, 770, 500, 215, 117, 78, 60],
  [X, X, X, 2300, 1200, 740, 490, 212, 117, 78, 60],
  [X, X, 3700, 1930, 1070, 675, 460, 206, 116, 78, 60],
  [9000, 5300, 2690, 1450, 870, 590, 410, 196, 114, 78, 60],
  [5000, 3500, 1880, 1100, 710, 495, 355, 185, 110, 77, 60],
  [3000, 2210, 1350, 860, 585, 425, 320, 174, 106, 76, 60],
  [1940, 1460, 955, 660, 480, 365, 285, 162, 102, 74, 60],
  [1290, 990, 710, 530, 400, 310, 250, 151, 98, 73, 60],
  [925, 735, 545, 415, 325, 264, 220, 140, 94, 72, 60],
  [710, 570, 435, 345, 278, 228, 195, 130, 91, 70, 60],
  [395, 345, 275, 228, 190, 163, 143, 105, 81, 67, 60],
  [264, 248, 210, 177, 153, 134, 118, 91, 73, 64, 60],
  [202, 196, 176, 151, 130, 115, 103, 81, 67, 62, 60],
  [166, 164, 154, 133, 117, 104, 93, 75, 64, 60, 60],
  [147, 145, 138, 120, 108, 98, 88, 70, 60, 58, 60],
  [140, 139, 130, 115, 105, 95, 86, 70, 60, 57, 60],
  [140, 139, 129, 116, 107, 99, 91, 75, 62, 56, 60],
  [153, 150, 140, 129, 118, 110, 102, 81, 64, 56, 60],
  [180, 166, 152, 139, 127, 116, 105, 82, 65, 56, 60],
];
export const LEINERT = { LON, LAT, ZODI };

const seg = (arr, v) => { let i = 0; while (i < arr.length - 2 && v > arr[i + 1]) i++; return [i, Math.min(1, Math.max(0, (v - arr[i]) / (arr[i + 1] - arr[i])))]; };
// zodiacal light outside the atmosphere (S10); NaN where the table has no data (too near the Sun)
export function zodiacal(dLon, beta) {
  const l = Math.min(180, Math.abs(dLon)), b = Math.min(90, Math.abs(beta)), [i, f] = seg(LON, l), [j, g] = seg(LAT, b);
  const v = (1 - f) * (1 - g) * ZODI[i][j] + f * (1 - g) * ZODI[i + 1][j] + (1 - f) * g * ZODI[i][j + 1] + f * g * ZODI[i + 1][j + 1];
  return Number.isFinite(v) ? v : NaN;
}

export const vanRhijn = (zDeg, h = H_AIRGLOW) => 1 / Math.sqrt(1 - (R_EARTH / (R_EARTH + h)) ** 2 * Math.sin(zDeg * RAD) ** 2);
export const airmass = (zDeg) => 1 / Math.sqrt(1 - 0.96 * Math.sin(Math.min(90, zDeg) * RAD) ** 2);
export const extinction = (zDeg, k) => 10 ** (-0.4 * k * airmass(zDeg));
export const airglowZenith = (activity) => AIRGLOW_MIN * 10 ** (0.4 * CYCLE_MAG * activity);
export const airglow = (zDeg, activity, k) => airglowZenith(activity) * vanRhijn(zDeg) * extinction(zDeg, k) / extinction(0, k);
export const toMag = (s10) => 10 - 2.5 * Math.log10(s10 / ARCSEC2_PER_DEG2);
export const fromMag = (mu) => ARCSEC2_PER_DEG2 * 10 ** (-0.4 * (mu - 10));

// ── Sky geometry ──────────────────────────────────────────────────────────────────────────────
// Horizon frame: x east, y north, z up; azimuth from north through east. The ecliptic is a great
// circle through the west point, tilted by ι to the horizon and rising towards the south; the Sun
// lies on it, d degrees below the horizon (evening). Returns unit vectors for the Sun and the
// ecliptic's north pole.
export const vec = (altDeg, azDeg) => { const a = altDeg * RAD, z = azDeg * RAD; return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function geometry(iota, depth) {
  const i = Math.max(depth + 0.5, iota) * RAD, W = [-1, 0, 0];
  // the ecliptic through W, rising to the south: its direction at W, then the pole
  const up = [0, -Math.cos(i), Math.sin(i)], pole = cross(W, up); // pole of the circle spanned by W and up
  // the Sun: below W on the circle, at altitude −depth: sin(alt) = −sin ι sin s
  const s = Math.asin(Math.min(1, Math.sin(depth * RAD) / Math.sin(i))), sun = [W[0] * Math.cos(s) - up[0] * Math.sin(s), W[1] * Math.cos(s) - up[1] * Math.sin(s), W[2] * Math.cos(s) - up[2] * Math.sin(s)];
  return { sun, pole, iota: i / RAD };
}
// ecliptic latitude and longitude from the Sun (degrees) of a direction
export function eclipticOf(d, geo) {
  const beta = Math.asin(Math.max(-1, Math.min(1, dot(d, geo.pole)))) / RAD;
  const pd = [d[0] - geo.pole[0] * dot(d, geo.pole), d[1] - geo.pole[1] * dot(d, geo.pole), d[2] - geo.pole[2] * dot(d, geo.pole)], n = Math.hypot(...pd);
  const dLon = n < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, dot(pd, geo.sun) / n))) / RAD;
  return { beta, dLon };
}
// the sky at altitude/azimuth: components and total (S10) as seen from the ground
export function skyAt(alt, az, geo, activity, k) {
  const z = 90 - alt, e = eclipticOf(vec(alt, az), geo), ext = extinction(z, k);
  const zl = zodiacal(e.dLon, e.beta) * ext, ag = airglow(z, activity, k);
  return { zl, ag, total: zl + ag, ...e };
}

// The whole sky on an n × n grid of a zenithal equidistant (fisheye) projection: north up, east left,
// as seen looking up; the horizon is the circle of radius 1. NaN outside the horizon or too near the Sun.
export function skyGrid(p, n = 160) {
  const geo = geometry(p.iota, p.depth), zl = new Float32Array(n * n), ag = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 2 - 1, y = ((j + 0.5) / n) * 2 - 1, r = Math.hypot(x, y), k = j * n + i;
    if (r > 1) { zl[k] = ag[k] = NaN; continue; }
    const alt = 90 - r * 90, az = (Math.atan2(-x, -y) / RAD + 360) % 360, q = skyAt(alt, az, geo, p.activity, p.k);
    zl[k] = q.zl; ag[k] = q.ag;
  }
  return { n, zl, ag };
}
// fisheye position (x, y in [−1, 1]) of altitude/azimuth
export const fisheye = (alt, az) => { const r = (90 - alt) / 90; return [-r * Math.sin(az * RAD), -r * Math.cos(az * RAD)]; };
