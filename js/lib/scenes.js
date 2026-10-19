// Ray-cast scenes for the tilt–shift laboratory, as pure functions so that row bands can be rendered
// in parallel by the compute workers (js/lib/tasks.js): a toy town seen from a rooftop and a
// facade for the shift demo.
import { uniform } from './random.js';
import { tiltedLens, tiltedImage } from './optics.js';

// ── toy town: houses (boxes) and trees (spheres) bucketed in a 12 m cell grid ──────────
const CELL = 12, GX0 = -5, GX1 = 5, GZ0 = 0, GZ1 = 14;
const rnd = uniform(5);
const CELLS = new Map();
const cellOf = (gx, gz) => { const k = gx + ',' + gz; if (!CELLS.has(k)) CELLS.set(k, []); return CELLS.get(k); };
for (let gx = GX0; gx <= GX1; gx++) for (let gz = GZ0; gz <= GZ1; gz++) {
  const cx = gx * CELL, cz = gz * CELL, list = cellOf(gx, gz);
  for (let k = 0; k < 2; k++) {
    const w = 2.5 + rnd() * 2.5, d = 2.5 + rnd() * 2.5, x = cx + 1.5 + w / 2 + rnd() * (8 - w), z = cz + 1.5 + d / 2 + rnd() * (8 - d), hgt = 3 + rnd() * 9;
    list.push({ box: true, a: [x - w / 2, 0, z - d / 2], b: [x + w / 2, hgt, z + d / 2], col: [[214, 120, 96], [236, 200, 140], [150, 170, 200], [240, 236, 226], [190, 120, 150]][Math.floor(rnd() * 5)] });
  }
  if (rnd() < 0.85) list.push({ box: false, c: [cx + 10.75, 2.2, cz + 2 + rnd() * 8], r: 1.2 + rnd() * 0.5 });
}
function hitObj(O, o, d) {
  if (!O.box) {
    const ox = o[0] - O.c[0], oy = o[1] - O.c[1], oz = o[2] - O.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - O.r * O.r, disc = b * b - c;
    return disc > 0 ? { t: -b - Math.sqrt(disc), col: [70, 140, 70], n: 3 } : null;
  }
  let t0 = -Infinity, t1 = Infinity, ax = 0;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / d[k]; let ta = (O.a[k] - o[k]) * inv, tb = (O.b[k] - o[k]) * inv;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; ax = k; }
    if (tb < t1) t1 = tb;
  }
  return t0 < t1 && t0 > 0 ? { t: t0, col: ax === 1 ? [O.col[0] * 0.75, O.col[1] * 0.45, O.col[2] * 0.4] : O.col, n: ax } : null;
}
// ray cast with a 2-D DDA over the cell grid (Amanatides & Woo), tested near-to-far
// The town's objects: boxes { box: true, a, b, col } and trees { box: false, c, r } (metres).
export const townObjects = () => [...CELLS.values()].flat();

export function castTown(o, d) {
  const tGround = d[1] < 0 ? -o[1] / d[1] : Infinity;
  let gx = Math.floor(o[0] / CELL), gz = Math.floor(o[2] / CELL);
  const sx = Math.sign(d[0]) || 1, sz = Math.sign(d[2]) || 1;
  let tmx = d[0] ? ((gx + (sx > 0 ? 1 : 0)) * CELL - o[0]) / d[0] : Infinity, tmz = d[2] ? ((gz + (sz > 0 ? 1 : 0)) * CELL - o[2]) / d[2] : Infinity;
  const tdx = d[0] ? (CELL / Math.abs(d[0])) : Infinity, tdz = d[2] ? (CELL / Math.abs(d[2])) : Infinity;
  let best = null, tCellEnd = Math.min(tmx, tmz);
  for (let step = 0; step < 80; step++) {
    const list = CELLS.get(gx + ',' + gz);
    if (list) for (const O of list) { const r = hitObj(O, o, d); if (r && r.t > 0 && (!best || r.t < best.t)) best = r; }
    if (best && best.t <= tCellEnd + 0.5) break; // objects may overhang a cell slightly
    if (tCellEnd > tGround) break;
    if (tmx < tmz) { gx += sx; tmx += tdx; } else { gz += sz; tmz += tdz; }
    tCellEnd = Math.min(tmx, tmz);
  }
  if (best && best.t < tGround) { const shade = best.n === 0 ? 0.8 : best.n === 2 ? 0.65 : 1; return { col: best.col.map((c) => c * shade), t: best.t }; }
  if (isFinite(tGround)) {
    const x = o[0] + tGround * d[0], z = o[2] + tGround * d[2];
    const fx = ((x % CELL) + CELL) % CELL, fz = ((z % CELL) + CELL) % CELL;
    const road = fx > 9.5 || fz < 1.4;
    let col = road ? [70, 70, 76] : [120, 150, 90];
    if (road && Math.abs(fx - 10.75) < 0.08) col = [230, 220, 160];
    return { col, t: tGround };
  }
  return { col: [150, 180, 220], t: 1e5 };
}
// facade for the shift demo
export function castFacade(o, d) {
  if (d[2] <= 0) return [150, 180, 220];
  const t = (30 - o[2]) / d[2], x = o[0] + t * d[0], y = o[1] + t * d[1];
  if (y < 0) return [90, 90, 95];
  if (Math.abs(x) > 12 || y > 48) { const s = Math.min(1, Math.max(0, d[1])); return [150 - 60 * s, 185 - 50 * s, 230 - 20 * s]; }
  const fx = ((x + 12) % 3 + 3) % 3, fy = (y % 4 + 4) % 4;
  const win = fx > 0.7 && fx < 2.3 && fy > 1 && fy < 3.2;
  if (Math.abs(x) > 11.6 || Math.abs(x) < 0.25) return [120, 100, 90];
  return win ? [60 + y * 2, 90 + y * 2, 130 + y] : [214, 196, 170];
}


// Tilt render, in three steps so that each slider redoes only what it changes:
//   tiltScene(f, y0, y1): the town's colour (RGB bytes) and the ray distance per pixel, rows
//     [y0, y1) of a W×H frame; depends only on the focal length (f, mm);
//   blurStack: the frame disk-blurred at fixed radii (BLUR_LEVELS), also only per focal length;
//   tiltBlend(st, depth, stack): the defocus radius of every pixel through the tilted lens
//     (st = { f, alpha, s, N }) and a per-pixel blend of the two stack levels that bracket it.
export const TILT = { W: 640, H: 427 };
export const BLUR_LEVELS = [0, 0.7, 1.5, 2.5, 3.8, 5.5, 8, 11, 15, 19, 24];
const SW = 0.036, SH = 0.024;
export const camH = 30, camPitch = (-30 * Math.PI) / 180; // a rooftop 30 m up, looking 30° down
// unit ray direction in camera coordinates (y up, z forward) through pixel (i, j)
function tiltRay(F, i, j) {
  const { W, H } = TILT, xs = ((i + 0.5) / W - 0.5) * SW, ys = (0.5 - (j + 0.5) / H) * SH, L = Math.hypot(xs, ys, F);
  return [xs / L, ys / L, F / L];
}
export function tiltScene(f, y0, y1) {
  const { W } = TILT, F = f / 1000, n = (y1 - y0) * W, rgb = new Uint8ClampedArray(n * 3), depth = new Float32Array(n);
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch), o = [6, camH, -6];
  for (let j = y0; j < y1; j++) for (let i = 0; i < W; i++) {
    const dc = tiltRay(F, i, j), dw = [dc[0], dc[1] * cp + dc[2] * sp, -dc[1] * sp + dc[2] * cp];
    const r = castTown(o, dw), k = (j - y0) * W + i;
    rgb[k * 3] = r.col[0]; rgb[k * 3 + 1] = r.col[1]; rgb[k * 3 + 2] = r.col[2];
    depth[k] = r.t;
  }
  return { rgb, depth };
}
export function tiltBlend(st, depth, stack) {
  const { W, H } = TILT, F = st.f / 1000, G = tiltedLens(F, st.alpha, st.s, st.N), L = BLUR_LEVELS;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, dc = tiltRay(F, i, j), t = depth[k];
    // the hit point in camera coordinates is t·dc; its image's blur diameter on the sensor (m)
    const q = tiltedImage(G, [dc[0] * t, dc[1] * t, dc[2] * t]);
    const c = q ? (G.A * Math.abs(q[2] + G.v)) / Math.abs(q[2]) : 0.01;
    const b = Math.min(24, (c / SW) * W / 2);
    let li = 0; while (li < L.length - 2 && L[li + 1] < b) li++;
    const u = Math.min(1, Math.max(0, (b - L[li]) / (L[li + 1] - L[li]))), s0 = stack[li], s1 = stack[li + 1];
    for (let ch = 0; ch < 3; ch++) out[k * 4 + ch] = s0[k * 4 + ch] * (1 - u) + s1[k * 4 + ch] * u;
    out[k * 4 + 3] = 255;
  }
  return out;
}

// Shift render, rows [y0, y1) of a W×H frame as RGBA bytes. st = { pitch (°), shift (mm) }.
export const SHIFT = { W: 300, H: 200 };
export function shiftRows(st, y0, y1) {
  const { W, H } = SHIFT, sw = 36, sh = 24, F = 24, out = new Uint8ClampedArray((y1 - y0) * W * 4);
  const p = (st.pitch * Math.PI) / 180, cp = Math.cos(p), sp = Math.sin(p), o = [0, 1.6, 0];
  for (let j = y0; j < y1; j++) for (let i = 0; i < W; i++) {
    // portrait-orientation sensor; shift moves the sensor window up within the image circle
    const xs = ((i + 0.5) / W - 0.5) * sh * 1.5, ys = (0.5 - (j + 0.5) / H) * sw * (2 / 3) + st.shift;
    const d = [xs, ys, F], L = Math.hypot(...d);
    const dc = [d[0] / L, d[1] / L, d[2] / L];
    const dw = [dc[0], dc[1] * cp + dc[2] * sp, -dc[1] * sp + dc[2] * cp];
    const c = castFacade(o, dw), k = ((j - y0) * W + i) * 4;
    out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = 255;
  }
  return out;
}
