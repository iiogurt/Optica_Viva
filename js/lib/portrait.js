// Mission "Portrait session": camera distance and perspective, focal length for the framing, depth
// of field across the face, background blur, and the size of the light. Pure functions; lengths in
// metres unless stated.
import { SENSORS, diag } from './sensors.js';
import { blurDiameter, dofLimits } from './optics.js';
import { angularSize, shadowGeometry, falloff, makeLight } from './lighting.js';

// Framings: the height of the scene that fills the frame's long side held vertically.
export const FRAMINGS = { head: ['Head and shoulders', 0.55], half: ['Half body', 1.0], full: ['Full body', 2.0] };
// Nose tip about 11 cm in front of the ears' plane, ears about 1 cm behind the focus plane (as in the
// perspective laboratory): apparent size scales as 1/distance.
export const noseEnlargement = (d) => (d + 0.01) / (d - 0.108) - 1;
// Distance at which the nose is drawn at most `e` larger than in a distant view.
export const naturalDistance = (e = 0.05) => (0.01 + (1 + e) * 0.108) / e;

export function plan({ sensor = 'ff', framing = 'head', d = 2, N = 2, B = 3, light = 0.9, ld = 1.2, az = 40 }) {
  const S = SENSORS[sensor], long = Math.max(S.w, S.h) / 1000, c = diag(S) / 1500 / 1000; // m
  const Hf = FRAMINGS[framing][1];
  const f = (long * d) / (Hf + long); // thin lens: magnification long/Hf = f/(d − f)
  const nose = noseEnlargement(d);
  const { near, far } = dofLimits(f * 1000, N, c * 1000, d * 1000);
  const dof = (far - near) / 1000; // m
  // widest aperture that keeps 6 cm (both eyes in a three-quarter view) sharp: DoF ≈ 2Ncs²/f²
  const nFace = Math.max(1, (0.06 * f * f) / (2 * c * d * d));
  const bg = blurDiameter(f * 1000, N, d * 1000, (d + B) * 1000) / 1000; // m on the sensor
  const bgShare = bg / long; // blur disc as a share of the frame's long side
  const lt = makeLight(ld, az, 25, light);
  const ang = angularSize(light, ld), fo = falloff(lt, B), pen = shadowGeometry(light, ld, B, 0.1).pen;
  return { S, f, nose, natural: naturalDistance(0.05), near: near / 1000, far: far / 1000, dof, nFace, bg, bgShare, ang, fall: fo.stops, pen, c };
}

// ── The photograph the plan gives ──────────────────────────────────────────────────────────
// A small portrait scene (head with nose, eyes, ears and hair, shoulders) seen from the planned
// distance with the planned focal length, in portrait orientation; lit by a round light of the
// planned size and distance, 40° to the side and 25° up; a wall B behind the face with a string of
// small lights. Everything is computed in linear light and mapped to the screen by one tone curve.
//   · Perspective: a pinhole camera at the face's height, d in front of it.
//   · Light: the exact irradiance of a uniform spherical light of angular radius a on a surface whose
//     normal is θ from the light's centre: cos θ where the whole light is visible, 0 where none is,
//     and (cos θ + sin a)² / (4 sin a) across the terminator, so a large light gives a soft edge.
//   · Depth of field: each pixel of the face is averaged over its own blur disc, from the thin-lens
//     blur diameter at its depth; the background lights become discs of the planned size, each
//     carrying the same light whatever its size.
// No cast shadows, no subsurface scattering, no catchlights.
// Ellipsoids: centre c, semi-axes r (m), linear reflectance col. Face towards −z (the camera).
const HEAD = [
  { c: [0, 1.6, 0], r: [0.078, 0.108, 0.098], col: [0.72, 0.44, 0.32] },        // head
  { c: [0, 1.585, -0.096], r: [0.016, 0.022, 0.022], col: [0.7, 0.4, 0.29] },   // nose
  { c: [0, 1.528, -0.07], r: [0.026, 0.008, 0.012], col: [0.45, 0.16, 0.13] },  // lips
  { c: [-0.08, 1.6, 0.008], r: [0.014, 0.03, 0.02], col: [0.66, 0.36, 0.25] },  // ears
  { c: [0.08, 1.6, 0.008], r: [0.014, 0.03, 0.02], col: [0.66, 0.36, 0.25] },
  { c: [-0.032, 1.628, -0.078], r: [0.014, 0.008, 0.008], col: [0.75, 0.73, 0.7] }, // eye whites
  { c: [0.032, 1.628, -0.078], r: [0.014, 0.008, 0.008], col: [0.75, 0.73, 0.7] },
  { c: [-0.032, 1.628, -0.084], r: [0.0062, 0.0062, 0.004], col: [0.03, 0.02, 0.015] }, // irises
  { c: [0.032, 1.628, -0.084], r: [0.0062, 0.0062, 0.004], col: [0.03, 0.02, 0.015] },
  { c: [0, 1.655, 0.016], r: [0.086, 0.098, 0.1], col: [0.045, 0.022, 0.012] }, // hair (behind and above the face)
  { c: [0, 1.47, 0.012], r: [0.045, 0.055, 0.045], col: [0.6, 0.34, 0.24] },     // neck
  { c: [0, 1.25, 0.03], r: [0.23, 0.18, 0.13], col: [0.035, 0.04, 0.05] },        // shoulders and chest, dark clothes
];

// irradiance factor of a spherical light of angular radius a at angle θ (cos θ = mu) from its centre
export const sphereLight = (mu, a) => { const s = Math.sin(a); return mu >= s ? mu : mu <= -s ? 0 : ((mu + s) * (mu + s)) / (4 * s); };

function hitFace(o, d) {
  let best = Infinity, col = null, n = null;
  for (const e of HEAD) {
    const [rx, ry, rz] = e.r, ox = (o[0] - e.c[0]) / rx, oy = (o[1] - e.c[1]) / ry, oz = (o[2] - e.c[2]) / rz, dx = d[0] / rx, dy = d[1] / ry, dz = d[2] / rz;
    const A = dx * dx + dy * dy + dz * dz, Bq = ox * dx + oy * dy + oz * dz, C = ox * ox + oy * oy + oz * oz - 1, disc = Bq * Bq - A * C;
    if (disc <= 0) continue;
    const t = (-Bq - Math.sqrt(disc)) / A;
    if (t > 0 && t < best) {
      best = t; col = e.col;
      const px = ox + t * dx, py = oy + t * dy, pz = oz + t * dz, nx = px / rx, ny = py / ry, nz = pz / rz, L = Math.hypot(nx, ny, nz);
      n = [nx / L, ny / L, nz / L];
    }
  }
  return col ? { t: best, col, n } : null;
}

// Fairy lights on the wall: positions in metres (x, y) on the wall plane, seeded and fixed.
const BULBS = [0, 1].flatMap((row) => Array.from({ length: 30 }, (_, i) => { const u = i / 29; return [(u - 0.5) * 3.4 + row * 0.06, 1.9 - row * 0.5 - 0.3 * Math.sin(Math.PI * u) + 0.05 * Math.sin(i * 2.7 + row)]; }));

// p = { W, H, sw, sh (sensor width, height in mm, height the long side), f (mm), N, d, B, light, ld,
// framing height Hf (m), ss (rays per pixel along each axis, default 1) } → { rgb: Float32Array
// W·H·3 (linear), rb (background disc radius in pixels of the W × H picture), W, H }
export function portraitShot(p) {
  const ss = p.ss || 1;
  if (ss > 1) {
    // computed at ss times the size and averaged down, so edges are anti-aliased
    const big = portraitShot({ ...p, W: p.W * ss, H: p.H * ss, ss: 1, scale: ss }), { W, H } = p, out = new Float32Array(W * H * 3), BW = W * ss;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) v += big.rgb[((j * ss + b) * BW + i * ss + a) * 3 + c];
      out[(j * W + i) * 3 + c] = v / (ss * ss);
    }
    return { rgb: out, rb: big.rb / ss, W, H };
  }
  const { W, H, sw, sh, f, N, d, B, light, ld, Hf } = p;
  const yc = Math.min(1.6, 1.83 - Hf / 2 + 0.02), o = [0, yc, -d];
  const az = (40 * Math.PI) / 180, el = (25 * Math.PI) / 180;
  const Lc = [Math.sin(az) * Math.cos(el) * ld, 1.6 + Math.sin(el) * ld, -Math.cos(az) * Math.cos(el) * ld]; // light centre
  const pxmm = W / sw;
  const face = new Float32Array(W * H * 3), mask = new Uint8Array(W * H), rad = new Float32Array(W * H), out = new Float32Array(W * H * 3);
  // the wall: a dark teal, lit by the same light from farther away
  const wallE = (ld / Math.hypot(Lc[0], Lc[1] - 1.6, B - Lc[2])) ** 2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) / W - 0.5) * sw, y = (0.5 - (j + 0.5) / H) * sh, L = Math.hypot(x, y, f), dir = [x / L, y / L, f / L];
    const k = j * W + i, hit = hitFace(o, dir);
    const tw = (B - o[2]) / dir[2], wy = o[1] + tw * dir[1], vign = 0.75 + 0.25 * Math.exp(-((wy - 1.5) ** 2) / 0.8);
    out[k * 3] = 0.03 * wallE * vign; out[k * 3 + 1] = 0.07 * wallE * vign; out[k * 3 + 2] = 0.075 * wallE * vign;
    if (!hit) continue;
    const P = [o[0] + hit.t * dir[0], o[1] + hit.t * dir[1], o[2] + hit.t * dir[2]];
    const toL = [Lc[0] - P[0], Lc[1] - P[1], Lc[2] - P[2]], dist = Math.hypot(...toL);
    const mu = (hit.n[0] * toL[0] + hit.n[1] * toL[1] + hit.n[2] * toL[2]) / dist, a = Math.asin(Math.min(1, light / 2 / dist));
    const E = sphereLight(mu, a) * (ld / dist) ** 2 + 0.06; // plus a little fill from the room
    for (let c = 0; c < 3; c++) face[k * 3 + c] = hit.col[c] * E;
    mask[k] = 1;
    rad[k] = Math.min(16, (blurDiameter(f, N, d * 1000, (d + P[2]) * 1000) * pxmm) / 2); // blur radius (px)
  }
  // background lights: discs of the planned blur diameter, each carrying the same light
  const rb = Math.max(0.7, (blurDiameter(f, N, d * 1000, (d + B) * 1000) * pxmm) / 2), sc = p.scale || 1, area = Math.PI * (rb / sc) ** 2, gain = 14 / Math.max(area, 3); // area in pixels of the final picture
  for (const [bx, by] of BULBS) {
    const cx = W / 2 + ((f * bx) / (d + B)) * pxmm, cy = H / 2 - ((f * (by - yc)) / (d + B)) * pxmm;
    for (let j = Math.max(0, Math.floor(cy - rb - 1)); j <= Math.min(H - 1, Math.ceil(cy + rb + 1)); j++) for (let i = Math.max(0, Math.floor(cx - rb - 1)); i <= Math.min(W - 1, Math.ceil(cx + rb + 1)); i++) {
      const cover = Math.min(1, Math.max(0, rb + 0.5 - Math.hypot(i + 0.5 - cx, j + 0.5 - cy))), k = j * W + i;
      out[k * 3] += cover * gain * 1.0; out[k * 3 + 1] += cover * gain * 0.72; out[k * 3 + 2] += cover * gain * 0.4;
    }
  }
  // the face over the background, each face pixel averaged over its own blur disc (face pixels only)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!mask[k]) continue;
    const r = rad[k], R = Math.ceil(r);
    let s0 = 0, s1 = 0, s2 = 0, n = 0;
    for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
      if (u * u + v * v > r * r + 0.25) continue;
      const ii = i + u, jj = j + v;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii;
      if (!mask[q]) continue;
      s0 += face[q * 3]; s1 += face[q * 3 + 1]; s2 += face[q * 3 + 2]; n++;
    }
    out[k * 3] = s0 / n; out[k * 3 + 1] = s1 / n; out[k * 3 + 2] = s2 / n;
  }
  return { rgb: out, rb, W, H };
}
