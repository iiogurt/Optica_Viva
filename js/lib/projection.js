// Lens projections (rectilinear, fisheye mappings, panoramic) and the hall scene of the projection
// laboratory, as pure functions so that row bands can be rendered by the compute workers.

// Mapping functions r = R(θ) (radial) or explicit forward/inverse maps (cylindrical families).
export const PROJ = {
  rectilinear: { name: 'Rectilinear (gnomonic)  r = f tan θ', R: (t, f) => f * Math.tan(t), Rinv: (r, f) => Math.atan(r / f), max: Math.PI / 2 - 0.01, color: '#ffffff' },
  stereographic: { name: 'Stereographic (conformal)  r = 2f tan(θ/2)', R: (t, f) => 2 * f * Math.tan(t / 2), Rinv: (r, f) => 2 * Math.atan(r / (2 * f)), max: Math.PI * 0.98, color: '#6ad7ff' },
  equidistant: { name: 'Equidistant  r = f θ', R: (t, f) => f * t, Rinv: (r, f) => r / f, max: Math.PI, color: '#6be3a4' },
  equisolid: { name: 'Equisolid (equal-area)  r = 2f sin(θ/2)', R: (t, f) => 2 * f * Math.sin(t / 2), Rinv: (r, f) => (r <= 2 * f ? 2 * Math.asin(r / (2 * f)) : NaN), max: Math.PI, color: '#ffb547' },
  orthographic: { name: 'Orthographic  r = f sin θ', R: (t, f) => f * Math.sin(t), Rinv: (r, f) => (r <= f ? Math.asin(r / f) : NaN), max: Math.PI / 2, color: '#c18cff' },
  panini: { name: 'Panini (d = 1), panoramic', cyl: true, color: '#ff9cc0' },
  equirect: { name: 'Equirectangular (cylindrical)', cyl: true, color: '#9aa1b5' },
};

// camera-space direction (x right, y up, z forward) ↔ sensor (x, y) in mm
export function inverse(p, x, y, f) {
  if (p === 'panini') {
    const phi = 2 * Math.atan(x / (2 * f)), S = 2 / (1 + Math.cos(phi)), hgt = y / f / S;
    const d = [Math.sin(phi), hgt, Math.cos(phi)], L = Math.hypot(...d);
    return Math.abs(phi) < Math.PI ? [d[0] / L, d[1] / L, d[2] / L] : null;
  }
  if (p === 'equirect') {
    const phi = x / f, lat = y / f;
    if (Math.abs(phi) > Math.PI || Math.abs(lat) > Math.PI / 2) return null;
    return [Math.cos(lat) * Math.sin(phi), Math.sin(lat), Math.cos(lat) * Math.cos(phi)];
  }
  const r = Math.hypot(x, y), P = PROJ[p];
  const t = P.Rinv(r, f);
  if (!(t >= 0) || t > P.max) return null;
  const s = Math.sin(t) / (r || 1);
  return [x * s, y * s, Math.cos(t)];
}
export function forward(p, d, f) {
  if (p === 'panini') {
    const phi = Math.atan2(d[0], d[2]), S = 2 / (1 + Math.cos(phi));
    return [f * S * Math.sin(phi), f * S * d[1] / Math.hypot(d[0], d[2])];
  }
  if (p === 'equirect') return [f * Math.atan2(d[0], d[2]), f * Math.asin(Math.max(-1, Math.min(1, d[1])))];
  const t = Math.acos(Math.max(-1, Math.min(1, d[2]))), P = PROJ[p];
  if (t > P.max) return null;
  const r = P.R(t, f), a = Math.atan2(d[1], d[0]);
  return [r * Math.cos(a), r * Math.sin(a)];
}

// ── Scene: a 12 × 12 m hall with windows, chequered floor and globes ───────────────────
const BOX = { x: 6, yl: -1.6, yh: 3.4, z: 6 };
const GLOBES = [[-1.6, -0.6, 3.2, 0.9], [1.9, -0.9, 2.4, 0.7], [0, 0.2, 5.0, 0.7], [-3.6, -0.8, 0.8, 0.75], [3.7, -0.7, -1.5, 0.85]];
function shade(o, d) {
  // globes
  let best = Infinity, gi = -1;
  for (let i = 0; i < GLOBES.length; i++) {
    const [cx, cy, cz, r] = GLOBES[i];
    const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < best) { best = t; gi = i; } }
  }
  // box
  let tb = Infinity, face = '';
  const test = (t, fc) => { if (t > 0 && t < tb) { tb = t; face = fc; } };
  if (d[0] > 0) test((BOX.x - o[0]) / d[0], 'E'); else if (d[0] < 0) test((-BOX.x - o[0]) / d[0], 'W');
  if (d[1] > 0) test((BOX.yh - o[1]) / d[1], 'C'); else if (d[1] < 0) test((BOX.yl - o[1]) / d[1], 'F');
  if (d[2] > 0) test((BOX.z - o[2]) / d[2], 'N'); else if (d[2] < 0) test((-BOX.z - o[2]) / d[2], 'S');
  if (best < tb) {
    const [cx, cy, cz, r] = GLOBES[gi];
    const p = [o[0] + best * d[0] - cx, o[1] + best * d[1] - cy, o[2] + best * d[2] - cz].map((v) => v / r);
    const lat = Math.asin(p[1]), lon = Math.atan2(p[0], p[2]);
    const gl = Math.abs(((lat / (Math.PI / 12)) % 1 + 1) % 1 - 0.5) > 0.44 || Math.abs(((lon / (Math.PI / 12)) % 1 + 1) % 1 - 0.5) > 0.44;
    const light = 0.35 + 0.65 * Math.max(0, p[0] * -0.3 + p[1] * 0.8 + p[2] * -0.5);
    const base = [[230, 120, 90], [90, 170, 230], [240, 200, 90], [150, 220, 140], [200, 140, 230]][gi];
    return gl ? [25, 25, 30] : base.map((c) => c * light);
  }
  const P = [o[0] + tb * d[0], o[1] + tb * d[1], o[2] + tb * d[2]];
  const frac = (v) => v - Math.floor(v);
  const line = (v, w) => { const q = frac(v); return q < w || q > 1 - w; };
  if (face === 'F') {
    const ch = (Math.floor(P[0]) + Math.floor(P[2])) & 1;
    return ch ? [196, 188, 172] : [60, 56, 54];
  }
  if (face === 'C') return line(P[0] / 1.5, 0.04) || line(P[2] / 1.5, 0.04) ? [70, 64, 60] : [215, 212, 205];
  // walls: horizontal along-wall coordinate u, height v
  const u = face === 'E' || face === 'W' ? P[2] : P[0], v = P[1];
  const wall = { N: [200, 190, 170], S: [175, 190, 200], E: [205, 185, 175], W: [185, 200, 180] }[face];
  // pilasters every 2 m, windows between
  if (line(u / 2, 0.06)) return [90, 80, 75];
  if (Math.abs(v - 1.2) < 0.03 || Math.abs(v + 1.55) < 0.05) return [90, 80, 75];
  const wu = frac(u / 2), win = wu > 0.25 && wu < 0.75 && v > 0 && v < 2.6;
  if (win) {
    if (line(u / 0.5, 0.04) || line((v - 0) / 0.65, 0.04)) return [40, 40, 46];
    const t = (v - 0) / 2.6;
    return [110 + 80 * t, 150 + 70 * t, 210 + 35 * t];
  }
  return wall;
}

// Rows [y0, y1) of a W×H render of the hall through projection `proj` on a sensor sw × sh mm
// (focal length f mm), camera pitched and yawed (degrees); ss: 2×2 supersampling. RGBA bytes.
export function projectionRows(p, y0, y1) {
  const { proj, f, sw, sh, W, H, ss } = p, out = new Uint8ClampedArray((y1 - y0) * W * 4);
  const cy = Math.cos((p.yaw * Math.PI) / 180), sy = Math.sin((p.yaw * Math.PI) / 180);
  const cp = Math.cos((p.pitch * Math.PI) / 180), sp = Math.sin((p.pitch * Math.PI) / 180);
  const rot = (d) => { // pitch about x, then yaw about y
    const y1r = d[1] * cp + d[2] * sp, z1 = -d[1] * sp + d[2] * cp;
    return [d[0] * cy + z1 * sy, y1r, -d[0] * sy + z1 * cy];
  };
  const o = [0, 0, 0], n = ss ? 2 : 1;
  for (let j = y0; j < y1; j++) for (let i = 0; i < W; i++) {
    let r = 0, g = 0, b = 0, cnt = 0;
    for (let sj = 0; sj < n; sj++) for (let si = 0; si < n; si++) {
      const x = ((i + (si + 0.5) / n) / W - 0.5) * sw, y = (0.5 - (j + (sj + 0.5) / n) / H) * sh;
      const d = inverse(proj, x, y, f);
      cnt++;
      if (!d) continue;
      const c = shade(o, rot(d));
      r += c[0]; g += c[1]; b += c[2];
    }
    const k = ((j - y0) * W + i) * 4;
    out[k] = r / cnt; out[k + 1] = g / cnt; out[k + 2] = b / cnt; out[k + 3] = 255;
  }
  return out;
}
