// Panoramas and parallax: two frames taken by a camera rotated about a pivot are re-projected
// onto a cylinder as a stitcher does (assuming pure rotation), but each frame's rays really
// start at that frame's entrance pupil. If the pivot is not at the entrance pupil, near
// objects land in different places in the two frames and ghost in the overlap.
// World: x right, y forward, z up (metres). Pivot at (0, 0, h).
import { paraxialMatrix, paraxial } from './raytrace.js';

// Front principal (= nodal, in air) point and entrance pupil of a prescription, mm from the
// first vertex: z_H = (D − 1)/C for the vertex-to-vertex matrix [[A, B], [C, D]].
export function cardinalPoints(lens) {
  const M = paraxialMatrix(lens, 587.56, 0, lens.surfaces.length), p = paraxial(lens);
  return { zH: (M[3] - 1) / M[2], zEP: p.zEP, efl: p.efl, zHrear: p.zImage - p.efl };
}

// Angular disparity (rad) of a point straight ahead at distance d between two frames yawed by
// ±Δ/2 when the entrance pupil sits e (m) in front of the pivot, relative to a background at df:
// 2 atan[e sin(Δ/2) / (d − e cos(Δ/2))] ≈ 2 e sin(Δ/2)(1/d − 1/df) for small e.
const halfDisp = (e, delta, d) => (Number.isFinite(d) ? Math.atan2(e * Math.sin(delta / 2), d - e * Math.cos(delta / 2)) : 0);
export const disparity = (e, delta, d, df = Infinity) => 2 * (halfDisp(e, delta, d) - halfDisp(e, delta, df));

// Scene: ground checkerboard, a striped pole at distance dn straight ahead, a distant skyline
// at df and a sky. Returns linear RGB for a ray (o, d).
function trace(o, d, sc, out) {
  let tBest = Infinity, col = null;
  // pole: vertical cylinder of radius 0.04 m at (0, dn), height 0 … 2.6 m
  const px = 0, py = sc.dn, r = 0.04, ox = o[0] - px, oy = o[1] - py;
  const a = d[0] * d[0] + d[1] * d[1], b = 2 * (ox * d[0] + oy * d[1]), c = ox * ox + oy * oy - r * r, disc = b * b - 4 * a * c;
  if (disc > 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(disc)) / (2 * a), z = o[2] + t * d[2];
    if (t > 0 && z > 0 && z < 2.6) { tBest = t; const band = Math.floor(z / 0.2) % 2; col = band ? [0.75, 0.75, 0.72] : [0.62, 0.08, 0.06]; }
  }
  // second, thinner pole at 1.6 dn, slightly to the side (shows depth-dependent parallax)
  {
    const qx = o[0] - 0.6, qy = o[1] - sc.dn * 1.6, b2 = 2 * (qx * d[0] + qy * d[1]), c2 = qx * qx + qy * qy - 0.03 * 0.03, disc2 = b2 * b2 - 4 * a * c2;
    if (disc2 > 0 && a > 1e-12) {
      const t = (-b2 - Math.sqrt(disc2)) / (2 * a), z = o[2] + t * d[2];
      if (t > 0 && t < tBest && z > 0 && z < 2.2) { tBest = t; col = [0.1, 0.25, 0.55]; }
    }
  }
  // skyline: a vertical "wall" of buildings at distance df (cylinder about the pivot)
  const A = d[0] * d[0] + d[1] * d[1], B = 2 * (o[0] * d[0] + o[1] * d[1]), C = o[0] * o[0] + o[1] * o[1] - sc.df * sc.df, D2 = B * B - 4 * A * C;
  if (D2 > 0) {
    const t = (-B + Math.sqrt(D2)) / (2 * A);
    if (t > 0 && t < tBest) {
      const x = o[0] + t * d[0], y = o[1] + t * d[1], z = o[2] + t * d[2], az = Math.atan2(x, y) * sc.df; // arc length along the skyline (m)
      const k = Math.floor(az / 6), hgt = 8 + 22 * (((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1);
      if (z > 0 && z < hgt) {
        tBest = t;
        const win = (Math.floor(z / 2.5) + Math.floor(az / 1.5)) % 2 === 0 && (az % 6 + 6) % 6 > 0.6 && z % 2.5 > 0.7;
        const shade = 0.35 + 0.25 * ((((k * 7.31) % 1) + 1) % 1);
        col = win ? [0.85, 0.78, 0.5] : [shade, shade * 0.95, shade * 1.05];
      }
    }
  }
  // ground plane z = 0: 0.5 m checkerboard
  if (d[2] < 0) {
    const t = -o[2] / d[2];
    if (t < tBest) {
      tBest = t;
      const x = o[0] + t * d[0], y = o[1] + t * d[1], ch = (Math.floor(x / 0.5) + Math.floor(y / 0.5)) & 1, fade = Math.exp(-t / 60);
      const g = ch ? 0.42 : 0.28;
      col = [g * fade + 0.45 * (1 - fade), g * 1.05 * fade + 0.5 * (1 - fade), g * 0.9 * fade + 0.6 * (1 - fade)];
    }
  }
  if (!col) { const s = Math.max(0, d[2]); col = [0.45 + 0.2 * (1 - s), 0.6 + 0.15 * (1 - s), 0.85]; }
  out[0] = col[0]; out[1] = col[1]; out[2] = col[2];
  return tBest;
}

// Render the stitched cylindrical panorama of two frames. o = { W, H, f (mm), sensor [w, h] mm,
// delta (rad, yaw between frames), e (m, entrance pupil ahead of the pivot), lat (m, lateral
// offset), height (m), dn, df (m), mode: 'blend' | 'diff' }.
// Returns { rgb: Float32Array, W, H, phiMax, psiMax, overlap }.
export function renderPanorama(o) {
  const { W, H } = o, tx = o.sensor[0] / 2 / o.f, ty = o.sensor[1] / 2 / o.f, hf = Math.atan(tx);
  const phiMax = o.delta / 2 + hf, vMax = ty, yaw = [-o.delta / 2, o.delta / 2];
  const sc = { dn: o.dn, df: o.df }, rgb = new Float32Array(W * H * 3), c = [0, 0, 0];
  const origins = yaw.map((th) => [o.e * Math.sin(th) + o.lat * Math.cos(th), o.e * Math.cos(th) - o.lat * Math.sin(th), o.height]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W * 2 - 1) * phiMax, v = (1 - (j + 0.5) / H * 2) * vMax;
    const n = Math.hypot(1, v), d = [Math.sin(phi) / n, Math.cos(phi) / n, v / n];
    let r = 0, g = 0, b = 0, ws = 0;
    const cols = [];
    for (let k = 0; k < 2; k++) {
      // direction in the frame's camera coordinates; inside the frame?
      const th = yaw[k], cx = d[0] * Math.cos(th) - d[1] * Math.sin(th), cy = d[0] * Math.sin(th) + d[1] * Math.cos(th);
      if (cy <= 0) continue;
      const u = cx / cy, w2 = d[2] / cy;
      if (Math.abs(u) > tx || Math.abs(w2) > ty) continue;
      trace(origins[k], d, sc, c);
      const wgt = Math.max(1e-3, Math.min(1, (tx - Math.abs(u)) / (0.25 * tx))); // feathered seam
      r += wgt * c[0]; g += wgt * c[1]; b += wgt * c[2]; ws += wgt;
      cols.push([c[0], c[1], c[2]]);
    }
    const p = (j * W + i) * 3;
    if (o.mode === 'diff') {
      if (cols.length === 2) { const dd = Math.abs(cols[0][0] - cols[1][0]) + Math.abs(cols[0][1] - cols[1][1]) + Math.abs(cols[0][2] - cols[1][2]); rgb[p] = dd; rgb[p + 1] = 0.25 * dd; rgb[p + 2] = 0.1 * dd; }
      else if (cols.length === 1) { rgb[p] = rgb[p + 1] = rgb[p + 2] = 0.12 * (cols[0][0] + cols[0][1] + cols[0][2]) / 3; }
    } else if (ws > 0) { rgb[p] = r / ws; rgb[p + 1] = g / ws; rgb[p + 2] = b / ws; }
  }
  return { rgb, W, H, phiMax, vMax, overlap: 2 * hf - o.delta, origins };
}

// Measured disparity of the near pole: azimuth of its axis seen from each frame's entrance pupil.
export function poleDisparity(o) {
  const yaw = [-o.delta / 2, o.delta / 2];
  const az = yaw.map((th) => { const ox = o.e * Math.sin(th) + o.lat * Math.cos(th), oy = o.e * Math.cos(th) - o.lat * Math.sin(th); return Math.atan2(0 - ox, o.dn - oy); });
  return az[0] - az[1];
}
