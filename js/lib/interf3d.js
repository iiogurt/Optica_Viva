// 3-D scene for the aperture-synthesis part of the interferometry laboratory (shown by
// js/lib/gl3d.js): the Earth turning under a fixed sky, the array's stations on it, the direction
// to the source, and the u-v plane facing the source, on which each baseline, projected as the
// source sees it, traces its ellipse while the Earth turns. Pure: no DOM.
//
// Frames: Earth-fixed coordinates (X towards longitude 0 on the equator, Y towards 90° E, Z to the
// north pole; Thompson, Moran & Swenson's baseline frame) turned by the hour angle H about Z into a
// sky-fixed frame where the source lies at s = (cos δ, 0, sin δ), u (east) = (0, 1, 0) and
// v (north) = (−sin δ, 0, cos δ). The scene shows that frame with y up: scene = (Y, Z, X).
// Lengths in Earth radii; local arrays (VLA, VLTI) are enlarged, the Earth-sized EHT is not.
import { ARRAYS } from './interferometry.js';
import { sphere, normalsFrom, merge, tint } from './mesh3d.js';

const R_E = 6.371e6, MIN_EL = (15 * Math.PI) / 180, DEG = Math.PI / 180;
const turn = (p, H) => [p[0] * Math.cos(H) - p[1] * Math.sin(H), p[0] * Math.sin(H) + p[1] * Math.cos(H), p[2]];
const scene = (p) => [p[1], p[2], p[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Station positions (Earth-fixed, Earth radii) and local verticals; `k` is the enlargement of a
// local array (1 for geocentric arrays), chosen so that it spans about 0.6 Earth radii.
export function stations(arr) {
  if (arr.geo) {
    const P = arr.geo.map(([la, lo]) => [Math.cos(la * DEG) * Math.cos(lo * DEG), Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG)]);
    return { pos: P, up: P, names: arr.geo.map((g) => g[2]), k: 1 };
  }
  const phi = arr.lat * DEG, c = [Math.cos(phi), 0, Math.sin(phi)];
  const span = Math.max(...arr.enu.flatMap((a) => arr.enu.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  const k = (0.6 * R_E) / span;
  // local east E and north N at longitude 0 in the Earth-fixed frame: (−sin φ N, E, cos φ N)
  const pos = arr.enu.map(([E, N]) => [c[0] - (k * Math.sin(phi) * N) / R_E, c[1] + (k * E) / R_E, c[2] + (k * Math.cos(phi) * N) / R_E]);
  return { pos, up: arr.enu.map(() => c), names: [], k };
}

// The source direction and the u-v plane's axes in the sky-fixed frame.
export const skyAxes = (dec) => ({ s: [Math.cos(dec), 0, Math.sin(dec)], u: [0, 1, 0], v: [-Math.sin(dec), 0, Math.cos(dec)] });

// Every station pair at hour angle H (rad; Greenwich hour angle for geocentric arrays, local for
// local ones): the baseline projected onto the u-v plane, in wavelengths of the true (not enlarged)
// array, and whether both stations see the source above 15°. Co-located stations of geocentric
// arrays (ALMA–APEX, JCMT–SMA) are skipped, as in the 2-D coverage.
export function uvAt(arr, dec, H, st = stations(arr)) {
  const { s, u, v } = skyAxes(dec), out = [];
  const seen = st.up.map((n) => Math.asin(Math.max(-1, Math.min(1, dot(turn(n, H), s)))) > MIN_EL);
  for (let i = 0; i < st.pos.length; i++) for (let j = i + 1; j < st.pos.length; j++) {
    const b = turn(st.pos[j].map((x, q) => ((x - st.pos[i][q]) * R_E) / st.k), H);
    if (arr.geo && Math.hypot(...b) < 1000) continue;
    out.push({ i, j, u: dot(b, u) / arr.lam, v: dot(b, v) / arr.lam, visible: seen[i] && seen[j] });
  }
  return out;
}

// The hour angles an observation covers, as the 2-D coverage samples them: a whole day for
// geocentric arrays, `hours` centred on transit for local ones.
export const hourAngles = (arr, hours, steps) => Array.from({ length: steps }, (_, s) => (arr.geo ? (2 * Math.PI * s) / steps : (-hours / 2 + (hours * (s + 0.5)) / steps) * (Math.PI / 12)));

// Each baseline's u-v track over the observation, split where a station loses the source, and the
// longest projected baseline: they depend only on the array, δ and the observing time, so the last
// result is kept while the hour angle shown changes.
let memo = { key: '' };
function tracks(arr, array, dec, hours, np, st) {
  const key = [array, dec, arr.geo ? 24 : hours].join();
  if (memo.key === key) return memo;
  const pairs = new Map();
  let bmax = 0;
  for (const h of hourAngles(arr, hours, np > 60 ? 72 : 240)) for (const p of uvAt(arr, dec, h, st)) {
    const k = p.i + '-' + p.j;
    if (!pairs.has(k)) pairs.set(k, [[]]);
    const r = pairs.get(k);
    if (p.visible) { r[r.length - 1].push(p); bmax = Math.max(bmax, Math.hypot(p.u, p.v)); } else if (r[r.length - 1].length) r.push([]);
  }
  memo = { key, runs: [...pairs.values()], bmax };
  return memo;
}

const TRACK = [[1, 0.71, 0.28], [0.42, 0.84, 1], [0.6, 1, 0.7], [1, 0.6, 0.75], [0.8, 0.7, 1], [1, 0.9, 0.5], [0.5, 0.95, 0.95]];

// m = { array (key of ARRAYS), dec (°), hours, H (h, the moment shown) }
export function interfScene({ array, dec: decDeg, hours, H: Hh }) {
  const arr = ARRAYS[array], dec = decDeg * DEG, H = Hh * (Math.PI / 12), st = stations(arr);
  const { s, u, v } = skyAxes(dec), S = scene(s), U = scene(u), V = scene(v);
  const meshes = [], lines = [], labels = [];
  const sc = (lam) => (lam * arr.lam * st.k) / R_E; // wavelengths → scene units (enlarged)
  // the Earth, its graticule turned by H, the axis and the direction to the source
  meshes.push({ mesh: sphere(1, [0, 0, 0], 48, 24), color: [0.16, 0.3, 0.52] });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lo = 0; lo <= 360; lo += 6) pts.push(scene(turn([Math.cos(lat * DEG) * Math.cos(lo * DEG) * 1.003, Math.cos(lat * DEG) * Math.sin(lo * DEG) * 1.003, Math.sin(lat * DEG) * 1.003], H)));
    lines.push({ points: pts, color: [1, 1, 1, lat ? 0.18 : 0.4], width: 1, glow: false });
  }
  for (let lo = 0; lo < 360; lo += 30) {
    const pts = [];
    for (let la = -90; la <= 90; la += 6) pts.push(scene(turn([Math.cos(la * DEG) * Math.cos(lo * DEG) * 1.003, Math.cos(la * DEG) * Math.sin(lo * DEG) * 1.003, Math.sin(la * DEG) * 1.003], H)));
    lines.push({ points: pts, color: lo === 0 ? [1, 0.71, 0.28, 0.55] : [1, 1, 1, 0.18], width: 1, glow: false });
  }
  lines.push({ points: [[0, -1.35, 0], [0, 1.35, 0]], color: [1, 1, 1, 0.35], width: 1, glow: false });
  labels.push({ p: [0, 1.48, 0], text: 'north pole', color: '#c9cfdc' });
  // the u-v plane, facing the source: Earth's disc as the source sees it, the axes and the tracks
  const np = (st.pos.length * (st.pos.length - 1)) / 2, { runs, bmax } = tracks(arr, array, dec, hours, np, st);
  const reach = Math.max(1.05, sc(bmax) * 1.08), d = 1.6 + reach * 0.35, C = S.map((x) => x * d);
  const at = (a, b) => [C[0] + a * U[0] + b * V[0], C[1] + a * U[1] + b * V[1], C[2] + a * U[2] + b * V[2]];
  const ring = (r, n = 96) => Array.from({ length: n + 1 }, (_, i) => at(r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)));
  const plate = ring(reach);
  const pos = new Float32Array([C, ...plate].flat()), idx = [];
  for (let i = 1; i < plate.length; i++) idx.push(0, i, i + 1 < plate.length ? i + 1 : 1);
  const ind = new Uint32Array(idx);
  meshes.push({ mesh: { positions: pos, normals: normalsFrom(pos, ind), indices: ind }, color: [0.3, 0.34, 0.45], opacity: 0.14, glass: true });
  lines.push({ points: plate, color: [1, 1, 1, 0.3], width: 1, glow: false });
  if (st.k === 1) lines.push({ points: ring(1), color: [0.45, 0.65, 1, 0.45], width: 1, glow: false });
  lines.push({ points: [at(-reach, 0), at(reach, 0)], color: [1, 1, 1, 0.25], width: 1, glow: false }, { points: [at(0, -reach), at(0, reach)], color: [1, 1, 1, 0.25], width: 1, glow: false });
  labels.push({ p: at(reach * 1.08, 0), text: 'u (east)', color: '#c9cfdc' }, { p: at(0, reach * 1.08), text: 'v (north)', color: '#c9cfdc' });
  labels.push({ p: at(0, -reach * 1.12), text: 'u-v plane, as the source sees the array', color: '#c9cfdc' });
  lines.push({ points: [[0, 0, 0].map((_, q) => S[q] * 1.02), C], color: [1, 1, 1, 0.3], width: 1, glow: false });
  lines.push({ points: [at(0, 0), C.map((x, q) => x + S[q] * 0.9)], color: [1, 0.71, 0.28, 0.9], width: 1.6 });
  labels.push({ p: C.map((x, q) => x + S[q] * 1.0), text: `to the source, δ = ${decDeg}°`, color: '#ffb547' });
  // tracks: each baseline (and its mirror image) while both stations see the source
  let n = 0;
  for (const pair of runs) {
    const col = TRACK[n++ % TRACK.length];
    for (const r of pair) if (r.length > 1) for (const sgn of [1, -1]) lines.push({ points: r.map((p) => at(sgn * sc(p.u), sgn * sc(p.v))), color: [...col, 0.6], width: 1.2, glow: false });
  }
  // the moment shown: stations, the baselines that see the source, and their u-v points
  const now = uvAt(arr, dec, H, st), up = st.up.map((nv) => Math.asin(Math.max(-1, Math.min(1, dot(turn(nv, H), s)))) > MIN_EL);
  const dots = [];
  st.pos.forEach((p, i) => {
    const P = scene(turn(p, H));
    dots.push(tint(sphere(st.k === 1 ? 0.035 : 0.02, P, 10, 5), up[i] ? [1, 0.71, 0.28] : [0.45, 0.47, 0.52]));
    if (st.names[i] && !(i > 0 && Math.hypot(...st.pos[i].map((x, q) => x - st.pos[i - 1][q])) < 1e-3)) labels.push({ p: P.map((x) => x * 1.12), text: st.names[i], color: up[i] ? '#ffcf8a' : 'rgba(200,205,215,0.6)' });
    // the station's shadow on the plane, along the line of sight
    if (up[i]) {
      const q = turn(p, H), sh = at(dot(q, u), dot(q, v));
      lines.push({ points: [P, sh], color: [1, 1, 1, 0.12], width: 1, glow: false });
    }
  });
  for (const p of now) {
    if (!p.visible) continue;
    if (np <= 60) lines.push({ points: [scene(turn(st.pos[p.i], H)), scene(turn(st.pos[p.j], H))], color: [1, 0.85, 0.5, 0.5], width: 1, glow: false });
    for (const sgn of [1, -1]) dots.push(tint(sphere(np > 60 ? 0.012 : 0.028, at(sgn * sc(p.u), sgn * sc(p.v)), 6, 3), [1, 1, 1]));
  }
  meshes.push({ mesh: merge(dots), color: [1, 1, 1] });
  if (st.k !== 1) labels.push({ p: scene(turn(st.up[0], H)).map((x) => x * 1.35), text: `array enlarged × ${Math.round(st.k).toLocaleString('en')}`, color: '#ffcf8a' });
  return { meshes, lines, labels, frame: { centre: C.map((x) => x * 0.5), size: (d + reach + 1) * 1.4 } };
}
