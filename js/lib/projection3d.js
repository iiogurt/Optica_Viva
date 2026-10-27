// 3-D scene for the projection laboratory (shown by js/lib/gl3d.js): the sphere of directions,
// radius f, around the centre of projection, with the Tissot circles of the 2-D overlay on it, and
// the image plane tangent to the sphere at the optical axis (distance f, as for a pinhole), on
// which the same circles land where the chosen projection puts them. A thin line joins each
// circle on the horizon and on the central meridian to its image: for the rectilinear projection these lines are rays through
// the centre, for every other mapping they are not. In millimetres, camera frame (x right, y up,
// z along the optical axis). Pure: no DOM.
import { PROJ, inverse, toCamera, tissotCircles, tissotColour } from './projection.js';
import { sphere, quad, merge, tint } from './mesh3d.js';

const SENSOR = [0.62, 0.66, 0.74], AXIS = [1, 0.71, 0.28];

// A filled polygon (a fan around its first point) with a single normal; pts: [[x, y, z], …],
// the first being the centre.
function fan(pts, n) {
  const positions = new Float32Array(pts.flat()), normals = new Float32Array(pts.length * 3), idx = [];
  for (let i = 0; i < pts.length; i++) normals.set(n(pts[i]), i * 3);
  for (let k = 1; k < pts.length; k++) idx.push(0, k, k === pts.length - 1 ? 1 : k + 1);
  return { positions, normals, indices: new Uint32Array(idx) };
}
const scale = (d, r) => [d[0] * r, d[1] * r, d[2] * r];
const rgb = (c) => c.map((v) => v / 255);

// Does the image point lie on the sensor (with a margin of 6 % of its width)?
export const onSensor = ([x, y], sw, sh) => Math.abs(x) <= sw * 0.56 && Math.abs(y) <= sh / 2 + sw * 0.06;

// The edge of the sensor's field of view on the sphere: the sensor outline mapped back through the
// projection, as polylines of unit directions (split where the outline leaves the image circle).
export function fieldEdge(proj, f, sw, sh, n = 48) {
  const border = [];
  for (let i = 0; i < n; i++) border.push([-sw / 2 + (sw * i) / n, sh / 2]);
  for (let i = 0; i < n; i++) border.push([sw / 2, sh / 2 - (sh * i) / n]);
  for (let i = 0; i < n; i++) border.push([sw / 2 - (sw * i) / n, -sh / 2]);
  for (let i = 0; i <= n; i++) border.push([-sw / 2, -sh / 2 + (sh * i) / n]);
  const runs = [];
  let run = [];
  for (const [x, y] of border) {
    const d = inverse(proj, x, y, f);
    if (d) run.push(d);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

// m = { proj, f (mm), sw, sh (sensor, mm), yaw, pitch (°) }
export function projectionScene({ proj, f, sw, sh, yaw, pitch }) {
  const meshes = [], lines = [], labels = [];
  const cam = toCamera(yaw, pitch), P = PROJ[proj];
  // the sphere of directions, its world graticule (horizon brighter) and the optical axis
  meshes.push({ mesh: sphere(f, [0, 0, 0], 48, 24), color: [0.55, 0.62, 0.8], opacity: 0.1, glass: true });
  const deg = Math.PI / 180;
  for (let lat = -80; lat <= 80; lat += 20) {
    const pts = [];
    for (let lo = 0; lo <= 360; lo += 5) pts.push(scale(cam([Math.cos(lat * deg) * Math.sin(lo * deg), Math.sin(lat * deg), Math.cos(lat * deg) * Math.cos(lo * deg)]), f));
    lines.push({ points: pts, color: lat === 0 ? [1, 1, 1, 0.5] : [1, 1, 1, 0.13], width: lat === 0 ? 1.4 : 1, glow: false });
  }
  for (let lo = 0; lo < 360; lo += 20) {
    const pts = [];
    for (let la = -90; la <= 90; la += 5) pts.push(scale(cam([Math.cos(la * deg) * Math.sin(lo * deg), Math.sin(la * deg), Math.cos(la * deg) * Math.cos(lo * deg)]), f));
    lines.push({ points: pts, color: [1, 1, 1, 0.13], width: 1, glow: false });
  }
  lines.push({ points: [[0, 0, -f * 1.1], [0, 0, f]], color: [...AXIS, 0.7], width: 1.2 });
  labels.push({ p: [0, -f * 0.14, 0], text: 'centre of projection', color: '#ffb547' });
  // the image plane at z = f: the sensor, and for fisheyes the image of the hemisphere
  meshes.push({ mesh: quad([0, 0, f * 0.999], [1, 0, 0], [0, 1, 0], sw / 2, sh / 2), color: [0.1, 0.11, 0.14], opacity: 0.4, glass: true });
  lines.push({ points: [[-sw / 2, sh / 2, f], [sw / 2, sh / 2, f], [sw / 2, -sh / 2, f], [-sw / 2, -sh / 2, f], [-sw / 2, sh / 2, f]], color: [...SENSOR, 0.9], width: 1.5 });
  labels.push({ p: [0, -sh / 2 - sw * 0.05, f], text: `image plane, sensor ${sw} × ${sh} mm`, color: '#c9cfdc' });
  if (!P.cyl && P.max >= Math.PI / 2) {
    const r = P.R(Math.PI / 2, f), pts = [];
    for (let k = 0; k <= 96; k++) pts.push([r * Math.cos((k / 96) * 2 * Math.PI), r * Math.sin((k / 96) * 2 * Math.PI), f]);
    lines.push({ points: pts, color: [...AXIS, 0.55], width: 1.2 });
    labels.push({ p: [r * 0.71, -r * 0.71, f], text: '90° from the axis', color: '#ffb547' });
  }
  // what the sensor sees, outlined on the sphere
  for (const run of fieldEdge(proj, f, sw, sh)) lines.push({ points: run.map((d) => scale(d, f * 1.004)), color: [...SENSOR, 0.85], width: 1.4 });
  // the Tissot circles: on the sphere, and on the image plane where they fall on the sensor (merged
  // into one mesh per opacity, with per-vertex colours)
  const onSphere = [], offSphere = [], onImage = [];
  for (const t of tissotCircles(proj, f, yaw, pitch)) {
    const shown = t.img && t.ratio <= 60 && t.img.every((p) => onSensor(p, sw, sh));
    const col = shown ? rgb(tissotColour(t.ratio)) : [0.5, 0.52, 0.58];
    (shown ? onSphere : offSphere).push(tint(fan([t.centre, ...t.ring].map((d) => scale(d, f * 1.003)), (p) => scale(p, 1 / Math.hypot(...p))), col));
    if (!shown) continue;
    const img = t.img.map(([x, y]) => [x, y, f * 1.002]);
    onImage.push(tint(fan(img, () => [0, 0, 1]), col));
    lines.push({ points: [...img.slice(1), img[1]], color: [1, 1, 1, 0.75], width: 1, glow: false });
    if (t.lat === 0 || t.lon === 0) lines.push({ points: [scale(t.centre, f), img[0]], color: [...col, 0.5], width: 1, glow: false });
  }
  for (const [list, opacity] of [[onSphere, 0.75], [offSphere, 0.3], [onImage, 0.6]]) if (list.length) meshes.push({ mesh: merge(list), color: [1, 1, 1], opacity });
  // aim at the sphere and the sensor together
  const half = Math.max(f, Math.hypot(sw, sh) / 2);
  return { meshes, lines, labels, frame: { centre: [0, 0, f * 0.35], size: Math.hypot(2 * half, f * 2) * 0.95 } };
}
