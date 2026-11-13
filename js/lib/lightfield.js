// A plenoptic (light-field) camera: a main lens, a microlens array where the sensor would be, and the
// sensor one microlens focal length behind it (Ng et al. 2005). Each microlens is one picture pixel;
// the N × N sensor pixels under it see N × N parts of the main lens's aperture. The 4-D light field
// L(u, v, x, y) is rendered by tracing a ray for every pixel through a thin lens into a scene of flat
// cards; photographs are made afterwards by shifting and adding the sub-aperture views.
// Lengths in mm; x, y on the sensor, u, v on the main lens, y and v up.
import { N_ } from './i18n.js';

// Patterns on the cards, (s, t) ∈ [0, 1]² → display-encoded RGB in [0, 1].
const TEX = {
  flower(s, t) {
    const x = s - 0.5, y = t - 0.5, r = Math.hypot(x, y), a = Math.atan2(y, x);
    if (r < 0.07) return [0.98, 0.82, 0.2];
    const petal = 0.2 + 0.17 * Math.abs(Math.cos(4 * a));
    if (r < petal) return [0.9, 0.25 + 0.3 * (r / petal), 0.55];
    return [0.12 + 0.1 * Math.sin(40 * s) ** 2, 0.42 + 0.12 * Math.sin(31 * t + 3 * s), 0.16];
  },
  star(s, t) {
    const x = s - 0.5, y = t - 0.5, r = Math.hypot(x, y);
    if (r > 0.47) return s < 0.04 || s > 0.96 || t < 0.04 || t > 0.96 ? [0.85, 0.15, 0.12] : [0.9, 0.9, 0.88];
    return Math.sin(18 * Math.atan2(y, x)) > 0 ? [0.06, 0.06, 0.07] : [0.95, 0.95, 0.93];
  },
  tiles(s, t) {
    const i = Math.floor(s * 8), j = Math.floor(t * 6), P = [[0.95, 0.75, 0.2], [0.2, 0.55, 0.85], [0.92, 0.92, 0.9], [0.85, 0.3, 0.25], [0.3, 0.7, 0.45]];
    if ((s * 8) % 1 < 0.06 || (t * 6) % 1 < 0.08) return [0.1, 0.1, 0.12];
    return P[(i * 3 + j * 2) % 5];
  },
  bricks(s, t) {
    const row = Math.floor(t * 18), u = s * 9 + (row % 2) * 0.5;
    if ((t * 18) % 1 < 0.12 || u % 1 < 0.05) return [0.72, 0.7, 0.66];
    const k = Math.sin(row * 12.9898 + Math.floor(u) * 78.233) * 43758.5453, n = k - Math.floor(k);
    return [0.55 + 0.2 * n, 0.25 + 0.1 * n, 0.16 + 0.06 * n];
  },
};
// The scene: cards at depth z (mm), placed in fractions of the field's half-width at their depth.
export const SCENE = [
  { z: 450, x: [-1.02, -0.38], y: [-1.02, -0.1], tex: 'flower', name: N_('flower') },
  { z: 800, x: [0.22, 0.9], y: [-0.8, 0.18], tex: 'star', name: N_('star target') },
  { z: 1400, x: [-0.42, 0.32], y: [-0.25, 0.72], tex: 'tiles', name: N_('tiles') },
  { z: 4000, x: [-2, 2], y: [-2, 2], tex: 'bricks', name: N_('brick wall') },
];

export const PIX = 0.015, SENSOR = [24, 16]; // sensor-pixel pitch and size (mm)
// Camera geometry: N × N pixels under each microlens; the microlens pitch is N pixels, so the picture
// has (sensor pixels)/N microlenses across.
export function camera({ F = 50, fnum = 2, zf = 1400, N = 9 }) {
  const b = 1 / (1 / F - 1 / zf), D = F / fnum, p = N * PIX, M = Math.floor(SENSOR[0] / p), Mh = Math.floor(SENSOR[1] / p);
  return { F, fnum, zf, N, b, D, p, M, Mh };
}
export const imageDist = (F, z) => 1 / (1 / F - 1 / z);
// the pupil position of view (k, l) and whether it lies inside the round aperture
export const pupil = (g, k, l) => [((k + 0.5) / g.N - 0.5) * g.D, -((l + 0.5) / g.N - 0.5) * g.D];
export const inside = (g, k, l) => { const [u, v] = pupil(g, k, l); return u * u + v * v <= (g.D / 2) ** 2 * 1.0001; };

// Trace the ray from pupil point (u, v) towards the object conjugate of sensor point (xs, ys): the
// first card it meets, its colour and depth.
function trace(g, cards, u, v, xs, ys, out) {
  const Px = (-xs * g.zf) / g.b, Py = (-ys * g.zf) / g.b;
  for (const c of cards) {
    const f = c.z / g.zf, X = u + (Px - u) * f, Y = v + (Py - v) * f, hw = c.hw;
    const s = (X / hw - c.x[0]) / (c.x[1] - c.x[0]), t = (Y / hw - c.y[0]) / (c.y[1] - c.y[0]);
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) { const col = TEX[c.tex](s, 1 - t); out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; return c.z; }
  }
  out[0] = out[1] = out[2] = 0; return Infinity;
}
const prepared = (g, scene) => scene.map((c) => ({ ...c, hw: ((SENSOR[0] / 2) * c.z) / g.F })).sort((a, b) => a.z - b.z);

// Render microlens rows [j0, j1): the views (N × N, view-major) as 8-bit RGB, and the centre view's depth.
export function render(g, j0 = 0, j1 = g.Mh, scene = SCENE) {
  const cards = prepared(g, scene), rows = j1 - j0, out = new Uint8Array(g.N * g.N * rows * g.M * 3), depth = new Float32Array(rows * g.M), col = [0, 0, 0], c0 = (g.N - 1) / 2;
  for (let l = 0; l < g.N; l++) for (let k = 0; k < g.N; k++) {
    if (!inside(g, k, l)) continue;
    const [u, v] = pupil(g, k, l), base = (l * g.N + k) * rows * g.M;
    for (let j = j0; j < j1; j++) {
      const ys = -(j + 0.5 - g.Mh / 2) * g.p;
      for (let i = 0; i < g.M; i++) {
        const xs = (i + 0.5 - g.M / 2) * g.p, z = trace(g, cards, u, v, xs, ys, col), o = (base + (j - j0) * g.M + i) * 3;
        // the patterns are display-encoded colours (as an 8-bit raw file would store them)
        out[o] = 255 * col[0] + 0.5; out[o + 1] = 255 * col[1] + 0.5; out[o + 2] = 255 * col[2] + 0.5;
        if (k === c0 && l === c0) depth[(j - j0) * g.M + i] = z;
      }
    }
  }
  return { lf: out, depth };
}

// The light field in linear light, for adding views (Float32, same layout).
export function linearise(lf) {
  const lin = new Float32Array(256), out = new Float32Array(lf.length);
  for (let i = 0; i < 256; i++) lin[i] = (i / 255) ** 2.2;
  for (let i = 0; i < lf.length; i++) out[i] = lin[lf[i]];
  return out;
}
// The views that a synthetic aperture of radius ap × D/2 centred on (u0, v0) uses (at least one).
export function apertureViews(g, ap = 1, u0 = 0, v0 = 0) {
  const R = (ap * g.D) / 2, views = [];
  for (let l = 0; l < g.N; l++) for (let k = 0; k < g.N; k++) {
    if (!inside(g, k, l)) continue;
    const [u, v] = pupil(g, k, l);
    views.push({ k, l, u, v, d: Math.hypot(u - u0, v - v0) });
  }
  const use = views.filter((w) => w.d <= R + 1e-9);
  return use.length ? use : [views.reduce((a, w) => (w.d < a.d ? w : a))];
}
// Shift-and-add refocusing (Ng et al. 2005): the photograph focused at object distance zr through the
// views in use. View (u, v) is shifted by u(1 − b/b_r) on the sensor, which brings every point at zr
// into register; the small magnification change between the planes is left out. lin is the
// linearised light field; returns linear RGB (Float32, M × Mh × 3).
export function refocus(g, lin, zr, use) {
  const k1 = 1 - g.b / imageDist(g.F, zr), out = new Float32Array(g.M * g.Mh * 3), plane = g.M * g.Mh;
  for (const w of use) {
    const sx = (w.u * k1) / g.p, sy = -(w.v * k1) / g.p, base = (w.l * g.N + w.k) * plane;
    for (let j = 0; j < g.Mh; j++) {
      const y = Math.min(g.Mh - 1.001, Math.max(0, j + sy)), j0 = Math.floor(y), fy = y - j0, gy = 1 - fy;
      for (let i = 0; i < g.M; i++) {
        const x = Math.min(g.M - 1.001, Math.max(0, i + sx)), i0 = Math.floor(x), fx = x - i0, gx = 1 - fx, o = (j * g.M + i) * 3;
        const a = (base + j0 * g.M + i0) * 3, c = a + g.M * 3, wa = gy * gx, wb = gy * fx, wc = fy * gx, wd = fy * fx;
        out[o] += wa * lin[a] + wb * lin[a + 3] + wc * lin[c] + wd * lin[c + 3];
        out[o + 1] += wa * lin[a + 1] + wb * lin[a + 4] + wc * lin[c + 1] + wd * lin[c + 4];
        out[o + 2] += wa * lin[a + 2] + wb * lin[a + 5] + wc * lin[c + 2] + wd * lin[c + 5];
      }
    }
  }
  const n = use.length;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

// ── Geometry of sharpness (on the sensor, mm) ──
// A point at distance z is imaged at b_z; on the plane b its blur is D|b − b_z|/b_z.
export const blurAt = (g, apD, bPlane, z) => { const bz = imageDist(g.F, z); return (apD * Math.abs(bPlane - bz)) / bz; };
// the shift between neighbouring views for a point at z, in microlenses: (D/N)(1 − b/b_z)/p
export const disparity = (g, z) => ((g.D / g.N) * (1 - g.b / imageDist(g.F, z))) / g.p;
// a conventional camera with the same lens and sensor, focused at zf: full aperture, pixel PIX
export const blurConventional = (g, z) => Math.hypot(blurAt(g, g.D, g.b, z), PIX);
// the light-field photograph refocused to zr with aperture fraction ap: the views' own blur (each
// sees D/N of the lens, focused at b), their misregistration at z, and one microlens
export const blurRefocused = (g, z, zr, ap = 1) => Math.hypot(g.p, blurAt(g, g.D / g.N, g.b, z), blurAt(g, ap * g.D, imageDist(g.F, zr), z));
// … and refocused to each distance in turn: the extended depth of field
export const blurBest = (g, z) => Math.hypot(g.p, blurAt(g, g.D / g.N, g.b, z));
// the range of image distances over which refocusing stays within one microlens: |b − b_z| ≲ N·f#·p
export const refocusRange = (g) => g.N * g.fnum * g.p;
