// Testing your own gear: decoding photographs to linear light, vignetting from a flat field, and
// radial distortion from points that should lie on a straight line. Pure functions.
import { eotf } from './color.js';

// RGBA bytes (sRGB-encoded, as in a JPEG) → linear R, G, B and luminance planes.
export function linearPlanes(data, W, H) {
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = eotf(i / 255);
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H), Y = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) { R[k] = lut[data[4 * k]]; G[k] = lut[data[4 * k + 1]]; B[k] = lut[data[4 * k + 2]]; Y[k] = 0.2126 * R[k] + 0.7152 * G[k] + 0.0722 * B[k]; }
  return { R, G, B, Y };
}

// Flat field: luminance averaged in cells, normalised to the centre; corner falloff in stops and
// the radial profile (r = 0 at the centre, 1 at the corner).
export function vignetting(Y, W, H, cells = 32) {
  const cw = W / cells, ch = H / cells, map = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    let s = 0, n = 0;
    for (let y = Math.floor(j * ch); y < Math.floor((j + 1) * ch); y++) for (let x = Math.floor(i * cw); x < Math.floor((i + 1) * cw); x++) { s += Y[y * W + x]; n++; }
    map[j * cells + i] = n ? s / n : 0;
  }
  const c0 = cells / 2 - 1, centre = (map[c0 * cells + c0] + map[c0 * cells + c0 + 1] + map[(c0 + 1) * cells + c0] + map[(c0 + 1) * cells + c0 + 1]) / 4;
  for (let k = 0; k < map.length; k++) map[k] /= centre;
  const corners = [map[0], map[cells - 1], map[(cells - 1) * cells], map[cells * cells - 1]];
  const profile = new Array(20).fill(0).map(() => [0, 0]);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const r = Math.hypot((i + 0.5 - cells / 2) * cw, (j + 0.5 - cells / 2) * ch) / Math.hypot(W / 2, H / 2), b = Math.min(19, Math.floor(r * 20));
    profile[b][0] += map[j * cells + i]; profile[b][1]++;
  }
  return { map, cells, corners, cornerStops: corners.map((v) => Math.log2(v)), profile: profile.map(([s, n], b) => [(b + 0.5) / 20, n ? s / n : NaN]).filter((p) => !isNaN(p[1])) };
}

// Radial distortion (one-parameter division model): an undistorted point is x_u = c + (x_d − c)/(1 + k r_d²)
// with r normalised to the half-diagonal. The k that makes the clicked points most nearly collinear
// is found by golden-section search; distortion at the corner is reported in per cent.
const residual = (pts) => {
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det)); // smallest eigenvalue = squared distance to the best line
  return l2 / n;
};
export function undistort(pts, k, W, H) {
  const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
  return pts.map(([x, y]) => { const u = (x - cx) / R, v = (y - cy) / R, d = 1 + k * (u * u + v * v); return [cx + (u / d) * R, cy + (v / d) * R]; });
}
export function fitDistortion(pts, W, H) {
  let lo = -0.5, hi = 0.5;
  const g = (Math.sqrt(5) - 1) / 2, f = (k) => residual(undistort(pts, k, W, H));
  for (let i = 0; i < 80; i++) { const a = hi - g * (hi - lo), b = lo + g * (hi - lo); if (f(a) < f(b)) hi = b; else lo = a; }
  const k = (lo + hi) / 2;
  // distortion at the corner, (r_d − r_u)/r_u: negative for barrel, positive for pincushion
  return { k, corner: k * 100, before: Math.sqrt(residual(pts)), after: Math.sqrt(f(k)) };
}
// Apply the division model's inverse to make demo images: distorted position of an undistorted point.
export function distortPoint(x, y, k, W, H) {
  const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy), u = (x - cx) / R, v = (y - cy) / R, ru = Math.hypot(u, v);
  if (!k || ru === 0) return [x, y];
  // solve r_u = r_d/(1 + k r_d²) for r_d
  const rd = (1 - Math.sqrt(Math.max(0, 1 - 4 * k * ru * ru))) / (2 * k * ru);
  return [cx + (u / ru) * rd * R, cy + (v / ru) * rd * R];
}
