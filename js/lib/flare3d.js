// 3-D scene for the flare laboratory (shown by js/lib/gl3d.js): the lens, a full-frame sensor at
// the image of infinity, the sun's parallel light, and the exact paths of the brightest ghosts,
// each reflected once back towards the front at surface j and once forward again at surface i < j,
// with where they land on the sensor; the image-forming light is drawn faintly for comparison.
// Paths come from the same tracer as the ghost render (js/lib/ghosts.js). Millimetres, optical
// axis along z. Pure: no DOM.
import { paraxial } from './raytrace.js';
import { ghostSystem, ghostPairs, makeGhostTracer } from './ghosts.js';
import { lensScene } from './lens3d.js';
import { hull } from './bokeh3d.js';
import { normalsFrom } from './mesh3d.js';

const COLOURS = [[1, 0.45, 0.62], [0.6, 1, 0.7], [0.8, 0.7, 1]];
// At most `k` of the rays, evenly spread through the list.
const some = (rays, k) => (rays.length <= k ? rays : Array.from({ length: k }, (_, q) => rays[Math.floor((q * rays.length) / k)]));
const area = (h) => { let a = 0; for (let k = 0; k < h.length; k++) { const p = h[k], q = h[(k + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

// Trace an n × n grid of parallel rays at slope [tan θx, tan θy] over the first surface's clear
// aperture along path (i, j) (−1, −1: the direct path). Returns the rays that reach the sensor
// inside every aperture: { land: [x, y], R (product of the two reflectances), pts (if paths) }.
export function traceGrid(sys, tracer, i, j, theta, n, paths = false) {
  const r0 = sys.sd[0], z0 = sys.zv[0] - 10, L = Math.hypot(theta[0], theta[1], 1), d = [theta[0] / L, theta[1] / L, 1 / L], out = [];
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    const x = r0 * (-1 + (2 * (a + 0.5)) / n), y = r0 * (-1 + (2 * (b + 0.5)) / n);
    if (Math.hypot(x, y) > r0) continue;
    const pts = paths ? [] : null;
    const q = tracer(i, j, x - theta[0] * 10, y - theta[1] * 10, z0, d[0], d[1], d[2], pts);
    if (!q || q[2] >= 1) continue;
    out.push({ land: [q[0], q[1]], R: i < 0 ? 1 : q[3], pts });
  }
  return { rays: out, cell: ((2 * r0) / n) ** 2 };
}

// Every ghost's flux (in mm² of the incoming beam, times the reflectances), spot area on the
// sensor and mean irradiance relative to the sun's light, brightest first.
export function rankGhosts(sys, theta, n = 13) {
  const tracer = makeGhostTracer(sys, 0), out = [];
  for (const [i, j] of ghostPairs(sys.lens)) {
    const g = traceGrid(sys, tracer, i, j, theta, n);
    if (g.rays.length < 3) continue;
    const h = hull(g.rays.map((r) => r.land)), A = Math.max(area(h), 1e-4);
    const flux = g.rays.reduce((s, r) => s + r.R, 0) * g.cell;
    out.push({ i, j, flux, area: A, E: flux / A, hull: h });
  }
  return out.sort((a, b) => b.E - a.E);
}

// m = { lens, sd, coat, blades, theta: [tan θx, tan θy], show (number of ghosts) }
export function flareScene({ lens, sd, coat, blades, theta, show = 3 }) {
  const par = paraxial(lens, 587.56), zImg = par.zImage;
  const sys = ghostSystem(lens, { lambdas: [587.56], coat, sd, stopR: par.stopR, blades, zImg });
  const base = lensScene(lens, { sd, par, zImg, fields: [], half: [18, 12] });
  const { meshes, lines, labels } = base, tracer = makeGhostTracer(sys, 0);
  const tri = (pts) => { const n = pts.length / 3, P = []; for (let k = 0; k < n; k++) P.push([pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]]); return P; };
  const lead = (P, d) => [[P[0][0] - d[0] * 40, P[0][1] - d[1] * 40, P[0][2] - d[2] * 40], ...P];
  const L = Math.hypot(theta[0], theta[1], 1), dir = [theta[0] / L, theta[1] / L, 1 / L];
  // the image-forming light, faint, and the sun's image
  const direct = traceGrid(sys, tracer, -1, -1, theta, 17, true);
  for (const r of some(direct.rays, 16)) lines.push({ points: lead(tri(r.pts), dir), color: [1, 0.95, 0.75, 0.12], width: 1, glow: false });
  if (direct.rays.length) labels.push({ p: [0, 14, zImg + 2], text: "image-forming light (faint white)", color: '#fff2c4' });
  // the brightest ghosts: their paths (14 rays from a 17 × 17 grid) and their spots on the sensor
  const ranked = rankGhosts(sys, theta).slice(0, show);
  ranked.forEach((g, n) => {
    const col = COLOURS[n % COLOURS.length];
    for (const r of some(traceGrid(sys, tracer, g.i, g.j, theta, 17, true).rays, 14)) lines.push({ points: lead(tri(r.pts), dir), color: [...col, 0.7], width: 1.1, glow: false });
    const c = g.hull.reduce((a, q) => [a[0] + q[0] / g.hull.length, a[1] + q[1] / g.hull.length], [0, 0]), z = zImg - 0.05;
    const P = [c, ...g.hull].map(([x, y]) => [x, y, z]), idx = [];
    for (let k = 1; k <= g.hull.length; k++) idx.push(0, k, k === g.hull.length ? 1 : k + 1);
    const positions = new Float32Array(P.flat()), indices = new Uint32Array(idx);
    meshes.push({ mesh: { positions, normals: normalsFrom(positions, indices), indices }, color: col, opacity: 0.55 });
    labels.push({ p: [0, 14 + (show - n) * 4.5, zImg + 2], text: `ghost ${n + 1}: surfaces ${g.j + 1} → ${g.i + 1}, ${g.E.toExponential(0)} of the sun`, color: `rgb(${col.map((v) => Math.round(v * 255)).join(',')})` });
  });
  labels.push({ p: [-dir[0] * 40, -dir[1] * 40 + Math.max(...sd) * 1.3, sys.zv[0] - dir[2] * 40], text: 'sunlight', color: '#fff2c4' });
  return { meshes, lines, labels, frame: base.frame, ranked };
}
