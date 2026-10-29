// 3-D scenes for the tilt–shift laboratory (shown by js/lib/gl3d.js): the Scheimpflug geometry at
// true scale in the camera, and the plane of focus with its depth-of-field wedge over the toy town.
// Camera coordinates: lens centre at the origin, y up, z along the (untilted) camera axis, metres.
import { tiltedLens, tiltedObject } from './optics.js';
import { townObjects, camH, camPitch } from './scenes.js';
import { quad, box, sphere, tint, merge, lathe } from './mesh3d.js';
import { N_ } from './i18n.js';

const C_COC = 0.00003; // circle of confusion on the sensor (m)

// The plane conjugate to the sensor-side plane z = −v + off, as a line in the y–z plane: two
// points far apart (it extends along x). null when the lens images it beyond infinity.
function conjugate(G, off) {
  // sample close to the axis: at strong tilts the sensor edges are conjugate to points beyond infinity
  const a = tiltedObject(G, [0, 0.0001, -G.v + off]), b = tiltedObject(G, [0, -0.0001, -G.v + off]);
  if (!a || !b) return null;
  const d = [b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
  return { p: [a[1], a[2]], d: [d[0] / L, d[1] / L] };
}
// A rectangle along x (half-width hw) between the points of a y–z line at parameters t0, t1.
const strip = (line, t0, t1, hw, xform = (p) => p) => {
  const P = (t, x) => xform([x, line.p[0] + t * line.d[0], line.p[1] + t * line.d[1]]);
  const c = [P(t0, -hw), P(t0, hw), P(t1, hw), P(t1, -hw)];
  const u = c[1].map((v, i) => v - c[0][i]), w = c[3].map((v, i) => v - c[0][i]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(...n) || 1;
  return { positions: new Float32Array(c.flat()), normals: new Float32Array([0, 1, 2, 3].flatMap(() => n.map((v) => v / L))), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
};
// parameter t on a y–z line where z (index 1) reaches a value
const tAtZ = (line, z) => (z - line.p[1]) / line.d[1];

// The plane of focus as a y–z line { p, d } (camera coordinates), for st = { f (mm), alpha (°), s (m), N }.
export const planeOfFocus = (st) => conjugate(tiltedLens(st.f / 1000, st.alpha, st.s, st.N), 0);

// st = { f (mm), alpha (°), s (m), N }
export function scheimpflugScene(st) {
  const G = tiltedLens(st.f / 1000, st.alpha, st.s, st.N), a = G.a, meshes = [], lines = [], labels = [];
  // the region where the planes meet scales with the hinge distance J = f / sin α
  const Jabs = Math.abs(a) > 1e-4 ? G.f / Math.abs(Math.sin(a)) : 0.3;
  const zMax = Math.min(st.s, Math.max(0.35, 1.6 * Jabs)), hw = Math.max(0.05, 0.3 * Jabs);
  // sensor (36 × 24 mm) at z = −v, the lens as a glass disk in its tilted plane
  meshes.push({ mesh: quad([0, 0, -G.v], [1, 0, 0], [0, 1, 0], 0.018, 0.012), color: [0.92, 0.94, 1], opacity: 0.85 });
  labels.push({ p: [0, -0.024, -G.v], text: 'sensor' });
  const lensDisk = lathe([[0, 0], [0.024, 0]], 48), ca = Math.cos(a), sa = Math.sin(a);
  for (let i = 0; i < lensDisk.positions.length; i += 3) { // tilt the disk about x by α
    const y = lensDisk.positions[i + 1], z = lensDisk.positions[i + 2];
    lensDisk.positions[i + 1] = y * ca - z * sa; lensDisk.positions[i + 2] = y * sa + z * ca;
    const ny = lensDisk.normals[i + 1], nz = lensDisk.normals[i + 2];
    lensDisk.normals[i + 1] = ny * ca - nz * sa; lensDisk.normals[i + 2] = ny * sa + nz * ca;
  }
  meshes.push({ mesh: lensDisk, color: [0.45, 0.75, 1], opacity: 0.35, glass: true });
  labels.push({ p: [0, 0.034 * ca, 0.034 * sa], text: 'lens, tilted {a}°', vars: { a: st.alpha }, color: '#6ad7ff' });
  // the plane of focus and the near and far limits of the depth of field
  const pof = conjugate(G, 0), near = conjugate(G, st.N * C_COC), far = conjugate(G, -st.N * C_COC);
  const zMin = -G.v * 1.3;
  for (const [line, col, op] of [[pof, [0.42, 0.89, 0.64], 0.2], [near, [0.42, 0.89, 0.64], 0.06], [far, [0.42, 0.89, 0.64], 0.06]]) {
    if (!line) continue;
    // a plane facing the camera (no tilt) is drawn ±0.6 m high where it stands
    const [t0, t1] = Math.abs(line.d[1]) < 1e-3 ? [-0.6, 0.6] : [tAtZ(line, zMin), tAtZ(line, zMax)];
    meshes.push({ mesh: strip(line, t0, t1, hw), color: col, opacity: op, glass: true });
  }
  if (pof) { const t = Math.abs(pof.d[1]) < 1e-3 ? 0.5 : tAtZ(pof, zMax * 0.8); labels.push({ p: [hw, pof.p[0] + t * pof.d[0], pof.p[1] + t * pof.d[1]], text: 'plane of focus', color: '#6be3a4' }); }
  // extended sensor and lens planes, and the lines where the planes meet
  if (Math.abs(a) > 1e-4) {
    const yS = G.v / Math.tan(a), J = G.f / Math.sin(a); // Scheimpflug line at z = −v; hinge line at z = 0
    const sensorPlane = { p: [0, -G.v], d: [1, 0] }, lensPlane = { p: [0, 0], d: [ca, -sa] };
    meshes.push({ mesh: strip(sensorPlane, -0.02, yS * 1.15, hw), color: [1, 1, 1], opacity: 0.05, glass: true });
    meshes.push({ mesh: strip(lensPlane, -0.03 / ca, (yS * 1.15) / ca, hw), color: [0.45, 0.75, 1], opacity: 0.06, glass: true });
    lines.push({ points: [[-hw, yS, -G.v], [hw, yS, -G.v]], color: [1, 0.71, 0.28, 1], width: 2.2 });
    labels.push({ p: [-hw * 1.45, yS, -G.v], text: 'Scheimpflug line', color: '#ffb547' });
    lines.push({ points: [[-hw, J, 0], [hw, J, 0]], color: [1, 0.61, 0.75, 1], width: 2.2 });
    labels.push({ p: [hw * 1.55, J, 0], text: 'hinge line, J = {J} m', vars: { J: Math.abs(J).toFixed(2) }, color: '#ff9cc0' });
    // the plane through the lens parallel to the sensor, faint
    meshes.push({ mesh: strip({ p: [0, 0], d: [1, 0] }, -0.02, J * 1.15, hw), color: [1, 0.61, 0.75], opacity: 0.035, glass: true });
  }
  lines.push({ points: [[0, 0, zMin], [0, 0, zMax]], color: [1, 1, 1, 0.2], width: 0.8 });
  // aim at the sensor, the lens and the line where the planes meet
  const yTop = Math.abs(a) > 1e-4 ? G.f / Math.sin(a) : 0.1;
  return { meshes, lines, labels, frame: { centre: [0, yTop * 0.55, Math.min(zMax, Jabs) * 0.6], size: Math.max(0.25, 2.3 * Jabs) } };
}

// The town (houses and trees), the camera on its rooftop and the plane of focus with its depth-of-
// field wedge in world coordinates (x east, y up, z north).
let townMesh = null;
export function townScene(st) {
  if (!townMesh) {
    const parts = townObjects().map((O) => (O.box ? box(O.a, O.b, O.col.map((c) => c / 255)) : tint(sphere(O.r, O.c, 12, 6), [0.3, 0.55, 0.3])));
    parts.push(box([-70, -0.3, -10], [80, 0, 180], [0.33, 0.4, 0.3]));
    townMesh = merge(parts);
  }
  const G = tiltedLens(st.f / 1000, st.alpha, st.s, st.N), o = [6, camH, -6];
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  const toWorld = ([x, y, z]) => [o[0] + x, o[1] + y * cp + z * sp, o[2] - y * sp + z * cp];
  const meshes = [{ mesh: townMesh }], lines = [], labels = [];
  meshes.push({ mesh: sphere(1.2, o, 16, 8), color: [1, 1, 1] });
  labels.push({ p: [o[0], o[1] + 3, o[2]], text: 'camera' });
  // the camera's field of view (36 × 24 mm sensor) out to 60 m
  const F = st.f / 1000, R = 60;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const d = [0.018 * sx, 0.012 * sy, F], L = Math.hypot(...d);
    lines.push({ points: [o, toWorld(d.map((v) => (v / L) * R))], color: [1, 1, 1, 0.3], width: 1 });
  }
  // plane of focus and limits, clipped to the stretch above the ground in front of the camera
  const pof = conjugate(G, 0), near = conjugate(G, st.N * C_COC), far = conjugate(G, -st.N * C_COC);
  const clip = (line) => {
    // sample the line and keep the part between the ground and 45 m, within 260 m of the camera
    let t0 = null, t1 = null;
    for (let t = -400; t <= 400; t += 0.5) {
      const w = toWorld([0, line.p[0] + t * line.d[0], line.p[1] + t * line.d[1]]), dz = w[2] - o[2];
      if (w[1] >= 0 && w[1] <= 45 && dz > 2 && dz < 260) { if (t0 === null) t0 = t; t1 = t; }
    }
    return t0 === null ? null : [t0, t1];
  };
  for (const [line, op, name] of [[pof, 0.28, N_('plane of focus')], [near, 0.08, ''], [far, 0.08, '']]) {
    if (!line) continue;
    const r = clip(line);
    if (!r) continue;
    meshes.push({ mesh: strip(line, r[0], r[1], 70, toWorld), color: [0.42, 0.89, 0.64], opacity: op, glass: true });
    if (name) { const tm = (r[0] + r[1]) / 2; labels.push({ p: toWorld([62, line.p[0] + tm * line.d[0], line.p[1] + tm * line.d[1]]), text: name, color: '#6be3a4' }); }
  }
  return { meshes, lines, labels, frame: { centre: [8, 6, 55], size: 150 } };
}
