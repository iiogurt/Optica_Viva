// The ray tracer's 3-D scene (shown by js/lib/gl3d.js): glass elements as solids of revolution,
// mirrors, the stop and the image plane, and real skew rays through the lens. Pure: no DOM.
import { aimRay, trace, toPlane, surfaceSag, stopIndex } from './raytrace.js';
import { glassData } from './glass.js';
import { lensSolid, mirrorSheet, annulus, quad, bounds } from './mesh3d.js';

const CROWN = [0.45, 0.75, 1.0], FLINT = [0.68, 0.55, 1.0], METAL = [0.78, 0.8, 0.86];
const FIELD_COLOURS = [[0.42, 0.84, 1.0, 0.42], [1.0, 0.71, 0.28, 0.42], [1.0, 0.45, 0.62, 0.42]];

// A circle of radius r in the plane z (a polyline).
const circle = (r, z, n = 72) => Array.from({ length: n + 1 }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z]);

// Pupil samples for one field: the rim (a cone in 3-D) and the tangential and sagittal fans.
function pupilPattern(rim = 16, fan = 4) {
  const pts = [];
  for (let k = 0; k < rim; k++) { const a = (2 * Math.PI * k) / rim; pts.push([Math.cos(a), Math.sin(a)]); }
  for (let k = 1; k < fan; k++) { const v = -1 + (2 * k) / fan; pts.push([0, v], [v, 0]); }
  return pts;
}

// lens: prescription (with epd); sd: clear semi-diameters; par: paraxial data at 587.56 nm;
// zImg: image plane; fields: field angles (degrees) to trace; lambda: wavelength (nm); pupil:
// the rays per field as normalised stop coordinates [[px, py], …] (default: rim and fans); half:
// the image plane's half-width and half-height (default: just large enough for the traced images).
// Returns { meshes, lines, labels } in millimetres, optical axis along z.
export function lensScene(lens, { sd, par, zImg, fields = [0], lambda = 587.56, pupil = pupilPattern(), half = null }) {
  const S = lens.surfaces, zv = par.zv, meshes = [], lines = [], labels = [];
  const name = (g) => (typeof g === 'string' ? g : g.name);
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.glass === 'mirror') {
      meshes.push({ mesh: mirrorSheet((r) => surfaceSag(s, r), zv[i], sd[i]), color: METAL, opacity: 0.85 });
      lines.push({ points: circle(sd[i], zv[i] + surfaceSag(s, sd[i])), color: [0.85, 0.88, 0.95, 0.5], width: 1 });
      continue;
    }
    if (s.glass === 'air' || i + 1 >= S.length) continue;
    // an element runs from this surface to the next; its edge is as wide as the larger aperture
    const r = Math.max(sd[i], sd[i + 1]), s2 = S[i + 1];
    const flint = typeof s.glass === 'string' ? (glassData(s.glass)?.type || '').includes('flint') : s.glass.vd < 50;
    meshes.push({ mesh: lensSolid((q) => surfaceSag(s, Math.min(q, sd[i])), zv[i], r, (q) => surfaceSag(s2, Math.min(q, sd[i + 1])), zv[i + 1], r), color: flint ? FLINT : CROWN, opacity: 0.2, glass: true });
    labels.push({ p: [0, r * 1.12, (zv[i] + zv[i + 1]) / 2], text: name(s.glass), color: 'rgba(200,215,255,0.8)' });
    // crisp rims where the faces meet the edge
    const rimCol = flint ? [0.75, 0.65, 1, 0.45] : [0.6, 0.85, 1, 0.45];
    lines.push({ points: circle(r, zv[i] + surfaceSag(s, Math.min(r, sd[i]))), color: rimCol, width: 1 }, { points: circle(r, zv[i + 1] + surfaceSag(s2, Math.min(r, sd[i + 1]))), color: rimCol, width: 1 });
  }
  // the stop: a dark iris ring around its opening
  const si = stopIndex(lens);
  if (si >= 0 && S[si].glass !== 'mirror') { // a mirror stop is its own aperture
    const rs = par.stopR, outer = Math.max(rs * 1.6, sd[si] * 1.25);
    meshes.push({ mesh: annulus(rs, outer, zv[si] + surfaceSag(S[si], rs)), color: [0.16, 0.15, 0.13] });
    labels.push({ p: [0, outer * 1.08, zv[si]], text: 'stop', color: '#ffb547' });
  }
  // rays: chief-ray image heights fix the size of the image plane
  let hMax = 0;
  const pattern = pupil;
  const allPts = [], rays = [];
  fields.forEach((th, fi) => {
    const col = FIELD_COLOURS[fi % FIELD_COLOURS.length];
    for (const [px, py] of pattern) {
      const a = aimRay(lens, lambda, th, px, py, par);
      if (!a) continue;
      const r = trace(lens, lambda, a.p, a.d, { path: true, sd, zv });
      if (!r.path || r.path.length < 2) continue;
      const pts = r.path.map((q) => [q[0], q[1], q[2]]);
      if (r.ok) { const q = toPlane(r, zImg); pts.push([q[0], q[1], q[2]]); hMax = Math.max(hMax, Math.abs(q[1])); }
      allPts.push(pts);
      rays.push({ points: pts, color: col, width: 1.1 });
    }
  });
  // lead the incoming rays in from well in front of the first surface
  const bb = bounds(meshes.map((m) => m.mesh), allPts), lead = bb.size * 0.25;
  for (const l of rays) {
    const [p0, p1] = l.points, d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d) || 1;
    l.points[0] = [p1[0] - (d[0] / L) * (L + lead), p1[1] - (d[1] / L) * (L + lead), p1[2] - (d[2] / L) * (L + lead)];
  }
  // the image plane as a 3 : 2 sensor just large enough for the traced images
  const hp = half ? half[1] : Math.max(hMax * 1.15, bb.size * 0.015), wp = half ? half[0] : hp * 1.5;
  meshes.push({ mesh: quad([0, 0, zImg], [1, 0, 0], [0, 1, 0], wp, hp), color: [0.75, 0.8, 0.9], opacity: 0.08, glass: true });
  lines.push({ points: [[-wp, -hp, zImg], [wp, -hp, zImg], [wp, hp, zImg], [-wp, hp, zImg], [-wp, -hp, zImg]], color: [0.9, 0.92, 1, 0.55], width: 1 });
  labels.push({ p: [0, hp * 1.15, zImg], text: 'image plane', color: 'rgba(255,255,255,0.75)' });
  // the optical axis, faint, from the start of the rays to just past the image
  lines.push(...rays);
  const zs = Math.min(...rays.map((l) => l.points[0][2]), zv[0]), ze = zImg + (zImg - zv[0]) * 0.08;
  lines.push({ points: [[0, 0, zs], [0, 0, ze]], color: [1, 1, 1, 0.18], width: 0.8 });
  // frame the camera on the optics and the image, not on the long incoming rays
  const frame = bounds([...meshes.map((m) => m.mesh)]);
  return { meshes, lines, labels, frame };
}
