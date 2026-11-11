// In-camera lens corrections and what they cost. Pure functions; positions in units of the half
// diagonal of the sensor (r = 1 in the corners), aspect 3:2.
//
// A lens maps an ideal image point at radius r_u to r_d = r_u (1 + k1 r_u² + k2 r_u⁴) (Brown's radial
// distortion: k1 < 0 barrel, > 0 pincushion), dims it by the vignetting V(r) (natural cos⁴ fall-off of
// the field angle plus the lens's mechanical vignetting), and images red and blue at slightly
// different scales (lateral chromatic aberration). The camera undoes all three in software:
//   · distortion: each output pixel is fetched from where the lens put it, r_d(r_u). Barrel
//     correction pulls the corners outwards, so the corners of the corrected picture are made from
//     fewer sensor pixels than its centre: radially by dr_d/dr_u, tangentially by r_d/r_u. The
//     picture must also be cropped to stay rectangular.
//   · vignetting: multiplied by 1/V. Signal and noise grow alike; in the shot-noise limit the
//     signal-to-noise ratio of a corner stays √V times that of the centre, and the read noise is
//     amplified by 1/V.
//   · lateral colour: red and blue fetched at their own scales.
import { makeRng } from './random.js';

export const ASPECT = 1.5;
const HX = ASPECT / Math.hypot(ASPECT, 1), HY = 1 / Math.hypot(ASPECT, 1); // half width and height

export const distort = (r, k1, k2 = 0) => r * (1 + k1 * r * r + k2 * r ** 4);
export function undistort(rd, k1, k2 = 0) {
  let r = rd;
  for (let i = 0; i < 30; i++) { const f = distort(r, k1, k2) - rd, d = 1 + 3 * k1 * r * r + 5 * k2 * r ** 4; const s = f / d; r -= s; if (Math.abs(s) < 1e-14) break; }
  return r;
}
// Vignetting at sensor radius r: cos⁴ of the field angle (corner field angle `field`, rad) times a
// mechanical fall-off that takes `mech` stops off at the corner.
export const vignette = (r, field, mech) => Math.cos(Math.atan(r * Math.tan(field))) ** 4 * 2 ** (-mech * r ** 4);
// How many sensor pixels the corrected picture spends per pixel of its own at radius r_u (in ideal
// coordinates): radial dr_d/dr_u and tangential r_d/r_u. Below 1, detail is stretched over more output
// pixels than it was recorded with.
export function sampling(ru, k1, k2 = 0) {
  return { radial: 1 + 3 * k1 * ru * ru + 5 * k2 * ru ** 4, tangential: 1 + k1 * ru * ru + k2 * ru ** 4 };
}
// The scale of the corrected picture: the largest s for which every point of its border, in ideal
// coordinates scaled by s, falls on the sensor (s > 1 for barrel distortion: the sensor records a
// wider, pincushion-shaped field than its own rectangle).
export function cropScale(k1, k2 = 0) {
  const inside = (s) => {
    for (let i = 0; i <= 200; i++) {
      const u = i / 200, pts = [[HX * (2 * u - 1), HY], [HX, HY * (2 * u - 1)]];
      for (const [x, y] of pts) {
        const ru = Math.hypot(x, y) * s, rd = distort(ru, k1, k2), f = ru > 0 ? rd / ru : 1;
        if (Math.abs(x * s * f) > HX + 1e-12 || Math.abs(y * s * f) > HY + 1e-12) return false;
      }
    }
    return true;
  };
  let lo = 0.3, hi = 2;
  for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
  return lo;
}

// The share of the field the sensor recorded that the corrected picture keeps: the corrected
// rectangle's area over the area of the sensor's outline mapped to ideal coordinates.
export function keptShare(k1, k2 = 0) {
  const s = cropScale(k1, k2), pts = [], n = 400;
  const border = (t) => { const q = (t * 4) % 4, u = q % 1, side = Math.floor(q); return side === 0 ? [HX * (2 * u - 1), HY] : side === 1 ? [HX, HY * (1 - 2 * u)] : side === 2 ? [HX * (1 - 2 * u), -HY] : [-HX, HY * (2 * u - 1)]; };
  for (let i = 0; i < n; i++) { const [x, y] = border(i / n), rd = Math.hypot(x, y), f = undistort(rd, k1, k2) / rd; pts.push([x * f, y * f]); }
  let area = 0; for (let i = 0; i < n; i++) { const [a, b] = pts[i], [c, d] = pts[(i + 1) % n]; area += a * d - b * c; }
  return (4 * HX * HY * s * s) / Math.abs(area / 2);
}

// A table of the inverse distortion r_d → r_u on 0 … rmax (radial and monotonic), for speed.
function inverseTable(k1, k2, rmax = 1.2, n = 4096) {
  const t = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) t[i] = undistort((i / n) * rmax, k1, k2);
  return (r) => { const f = (r / rmax) * n, i = Math.min(n - 1, Math.floor(f)), q = f - i; return t[i] + (t[i + 1] - t[i]) * q; };
}

// The test chart, reflectance per channel at ideal position (x, y) (units of the half diagonal): a
// grid, Siemens stars at the centre and near the corners, and red/blue bars to show colour fringes.
export function chart(x, y) {
  const star = (cx, cy, R) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r > R) return -1; return r < R * 0.04 ? 0.5 : Math.sin(36 * Math.atan2(dy, dx)) > 0 ? 0.9 : 0.06; };
  for (const [cx, cy] of [[0, 0], [-0.62, -0.36], [0.62, -0.36], [-0.62, 0.36], [0.62, 0.36]]) { const s = star(cx, cy, 0.13); if (s >= 0) return [s, s, s]; }
  const gx = Math.abs(((x / 0.1) % 1 + 1) % 1 - 0.5) > 0.47, gy = Math.abs(((y / 0.1) % 1 + 1) % 1 - 0.5) > 0.47;
  if (gx || gy) return [0.08, 0.08, 0.08];
  if (Math.abs(y + 0.47) < 0.02 && Math.abs(x) < 0.5) return [0.85, 0.85, 0.85];
  return [0.55, 0.55, 0.55];
}

// The picture as recorded: W × H pixels, mean photoelectrons `photons` per pixel for reflectance 1 at
// the centre, read noise `read` (electrons), lateral colour `ca` (relative scale of red; blue the
// opposite), corner field angle `field`, mechanical vignetting `mech` stops. 2 × 2 samples per pixel.
// Returns Float32Array planes of electrons.
export function record({ W = 300, H = 200, k1 = -0.1, k2 = 0, ca = 0.002, field = 0.73, mech = 0.6, photons = 400, read = 3, seed = 4 }) {
  const rng = makeRng(seed), out = [0, 1, 2].map(() => new Float32Array(W * H)), scale = [1 + ca, 1, 1 - ca], inv = inverseTable(k1, k2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const acc = [0, 0, 0];
    let V = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const xd = ((i + 0.25 + 0.5 * a) / W - 0.5) * 2 * HX, yd = (0.5 - (j + 0.25 + 0.5 * b) / H) * 2 * HY, rd = Math.hypot(xd, yd);
      V += vignette(rd, field, mech) / 4;
      for (let c = 0; c < 3; c++) {
        const rdc = rd / scale[c], ru = rd > 0 ? inv(rdc) : 0, f = rd > 0 ? ru / rd : 1 / scale[c];
        acc[c] += chart(xd * f, yd * f)[c] / 4;
      }
    }
    for (let c = 0; c < 3; c++) { const e = photons * V * acc[c]; out[c][j * W + i] = e + Math.sqrt(e + read * read) * rng.g(); }
  }
  return out;
}

// The camera's correction of `raw` (planes of W × H): an output picture of W × H in ideal
// coordinates scaled by `s` (cropScale), each channel fetched bilinearly from its own distorted
// position and divided by the vignetting when asked. Returns planes in units of photons.
export function correct(raw, { W = 300, H = 200, k1 = -0.1, k2 = 0, ca = 0.002, field = 0.73, mech = 0.6, photons = 400, fixDist = true, fixVig = true, fixCA = true }) {
  const s = fixDist ? cropScale(k1, k2) : 1, scale = fixCA ? [1 + ca, 1, 1 - ca] : [1, 1, 1], out = [0, 1, 2].map(() => new Float32Array(W * H));
  const sample = (a, x, y) => { x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y)); const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j; return (a[j * W + i] * (1 - fx) + a[j * W + i + 1] * fx) * (1 - fy) + (a[(j + 1) * W + i] * (1 - fx) + a[(j + 1) * W + i + 1] * fx) * fy; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const xu = ((i + 0.5) / W - 0.5) * 2 * HX * s, yu = (0.5 - (j + 0.5) / H) * 2 * HY * s, ru = Math.hypot(xu, yu);
    for (let c = 0; c < 3; c++) {
      const f = fixDist ? (ru > 0 ? distort(ru, k1, k2) / ru : 1) * scale[c] : 1 / s, xd = xu * f, yd = yu * f;
      let v = sample(raw[c], (xd / (2 * HX) + 0.5) * W - 0.5, (0.5 - yd / (2 * HY)) * H - 0.5);
      if (fixVig) v /= vignette(Math.hypot(xd, yd), field, mech);
      out[c][j * W + i] = v / photons;
    }
  }
  return out;
}
