// 3-D scene for the bokeh laboratory (shown by js/lib/gl3d.js): the traced lens with the sensor
// set for the focus distance, and the cones of light from two background points at infinity (on
// axis and in the corner of the frame), traced as real rays round the edge of the iris. The rays
// cross in front of the sensor and spread again, so each point lands as a disc: round on axis, a
// cat's eye in the corner, where the barrel's clear apertures cut the beam. The footprints are
// traced from a dense grid over the iris. Millimetres, optical axis along z. Pure: no DOM.
import { paraxial, aimRay, trace, toPlane } from './raytrace.js';
import { imagePlane } from './bokeh.js';
import { lensScene } from './lens3d.js';
import { normalsFrom } from './mesh3d.js';

const LAM = 587.56, COLOURS = [[0.42, 0.84, 1], [1, 0.71, 0.28]];

// The iris radius at azimuth φ for `blades` straight blades (0: circular) blended towards a
// circle by `round`, as a fraction of the stop radius (the circumradius is 1), with the middle
// of a blade's edge at the top: the same shape as the ghost and bokeh tracer.
export function irisRadius(phi, blades, round) {
  if (!blades) return 1;
  const sector = (2 * Math.PI) / blades, rot = Math.PI / 2 - sector / 2;
  let ph = phi - rot;
  ph = ((ph % sector) + sector) % sector - sector / 2;
  return (Math.cos(Math.PI / blades) / Math.cos(ph)) * (1 - round) + round;
}

// A round 1, 2 or 5 × 10ⁿ close to x.
const enlargement = (x) => { const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((m) => m * p).reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a)); };

// Convex hull (Andrew's monotone chain) of 2-D points, counter-clockwise.
export function hull(P) {
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Where the light from a point at infinity at field angle th (degrees) lands on the sensor at zs:
// a grid of n × n rays over the iris, traced with the clear apertures sd. Returns the landing
// points and the numbers of rays that pass and that enter the iris.
export function footprint(lens, sd, par, zs, th, blades, round, n = 24) {
  const pts = [];
  let total = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const px = -1 + (2 * (i + 0.5)) / n, py = -1 + (2 * (j + 0.5)) / n;
    if (Math.hypot(px, py) > irisRadius(Math.atan2(py, px), blades, round)) continue;
    total++;
    const a = aimRay(lens, LAM, th, px, py, par);
    if (!a) continue;
    const r = trace(lens, LAM, a.p, a.d, { sd, zv: par.zv });
    if (!r.ok) continue;
    const q = toPlane(r, zs);
    pts.push([q[0], q[1]]);
  }
  return { pts, passed: pts.length, total };
}

// m = { lens (prescription), sd (clear semi-diameters, barrel already applied), focus (mm),
//       stop (EV below wide open), blades, round, corner (image height of the corner, mm) }
export function bokehScene({ lens: L0, sd, focus, stop, blades, round, corner = Math.hypot(16, 10.7) }) {
  const lens = { ...L0, epd: L0.epd * Math.pow(2, -stop / 2) }, par = paraxial(lens, LAM), zs = imagePlane(lens, focus);
  const thc = (Math.atan(corner / par.efl) * 180) / Math.PI;
  // rays round the iris (and its centre) for the two fields
  const rim = Array.from({ length: 32 }, (_, k) => { const a = (k / 32) * 2 * Math.PI, r = 0.999 * irisRadius(a, blades, round); return [r * Math.cos(a), r * Math.sin(a)]; });
  const sc = lensScene(lens, { sd, par, zImg: zs, fields: [0, thc], pupil: [...rim, [0, 0]] });
  const { meshes, lines, labels } = sc;
  // the footprints on the sensor, just in front of it, and enlarged copies beside the sensor (they
  // are a few millimetres wide in a lens a hundred millimetres long)
  const fps = [0, thc].map((th) => footprint(lens, sd, par, zs, th, blades, round));
  const hulls = fps.map((f) => (f.pts.length >= 3 ? hull(f.pts) : null));
  const centre = (h) => h.reduce((a, q) => [a[0] + q[0] / h.length, a[1] + q[1] / h.length], [0, 0]);
  const hp = Math.max(...hulls.filter(Boolean).map((h) => Math.max(...h.map((q) => Math.abs(q[1]))))) * 1.15, wp = hp * 1.5;
  const size = hulls[0] ? Math.max(...hulls[0].map((q) => q[0])) - Math.min(...hulls[0].map((q) => q[0])) : 1;
  const g = enlargement((0.7 * hp) / size);
  const disc = (h, c, k, off, i, z) => {
    const P = [[off[0], off[1]], ...h.map(([x, y]) => [off[0] + k * (x - c[0]), off[1] + k * (y - c[1])])].map(([x, y]) => [x, y, z]), idx = [];
    for (let q = 1; q <= h.length; q++) idx.push(0, q, q === h.length ? 1 : q + 1);
    const positions = new Float32Array(P.flat()), indices = new Uint32Array(idx);
    meshes.push({ mesh: { positions, normals: normalsFrom(positions, indices), indices }, color: COLOURS[i], opacity: 0.8 });
    lines.push({ points: [...P.slice(1), P[1]], color: [...COLOURS[i], 1], width: 1.6 });
  };
  hulls.forEach((h, i) => {
    if (!h) return;
    const c = centre(h), f = fps[i];
    disc(h, c, 1, c, i, zs - 0.02);
    const off = [wp + hp * 0.9, hp * (0.45 - 1.05 * i)];
    disc(h, c, g, off, i, zs);
    lines.push({ points: [[c[0], c[1], zs], [off[0], off[1], zs]], color: [...COLOURS[i], 0.3], width: 1, glow: false });
    labels.push({ p: [off[0], off[1] + 0.42 * hp, zs], text: i ? `corner: cat's eye, ${((f.passed / f.total) * 100).toFixed(0)} % of the light` : 'on axis: the iris shape', color: i ? '#ffb547' : '#6ad7ff' });
  });
  labels.push({ p: [wp + hp * 0.9, -hp * 1.25, zs], text: `footprints enlarged × ${g}`, color: 'rgba(255,255,255,0.6)' });
  labels.push({ p: [0, hp * 1.3, zs], text: `sensor focused at ${(focus / 1000).toFixed(2)} m; points at infinity`, color: 'rgba(255,255,255,0.7)' });
  return { meshes, lines, labels, frame: sc.frame, zs, fps };
}
