// 3-D scene for the spectral optics bench (shown by js/lib/gl3d.js): the glass (prism, lens or
// ball), sample rays of several wavelengths traced through it, and the screen painted with the
// traced caustic. Pure: no DOM.
import { makeShape, traceThrough, screenFrame, SCREEN_H, SCREEN_W } from './bench.js';
import { lensSolid, sphere, merge } from './mesh3d.js';
import { index } from './glass.js';
import { wavelengthRGB, xyzToLinearRGB, oetf } from './color.js';
import { N_ } from './i18n.js';

const add = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

// a flat polygon (convex, vertices in order) as a triangle fan with its normal
function polygon(pts, n) {
  const P = [], N = [], idx = [];
  pts.forEach((p) => { P.push(...p); N.push(...n); });
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
  return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(idx) };
}
// the prism from its three side planes and the two end caps
function prismMesh(shape) {
  const sides = shape.filter((s) => s.n[2] === 0), zc = shape.find((s) => s.n[2] > 0).d;
  const corner = (a, b) => { const det = a.n[0] * b.n[1] - a.n[1] * b.n[0]; return [(a.d * b.n[1] - b.d * a.n[1]) / det, (a.n[0] * b.d - b.n[0] * a.d) / det]; };
  const v = [corner(sides[0], sides[1]), corner(sides[1], sides[2]), corner(sides[2], sides[0])];
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = v[(i + 2) % 3], b = v[i], n = sides[i].n; // side i lies between corners (i−1,i) and (i,i+1)
    parts.push(polygon([[a[0], a[1], -zc], [b[0], b[1], -zc], [b[0], b[1], zc], [a[0], a[1], zc]], n));
  }
  parts.push(polygon(v.map((p) => [p[0], p[1], zc]), [0, 0, 1]), polygon([...v].reverse().map((p) => [p[0], p[1], -zc]), [0, 0, -1]));
  return merge(parts);
}
// cyclic axis swap (x, y, z) → (z, x, y): a mesh built along z now lies along x
function alongX(m) {
  const swap = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i + 2]; o[i + 1] = a[i]; o[i + 2] = a[i + 1]; } return o; };
  return { ...m, positions: swap(m.positions), normals: swap(m.normals) };
}

// The screen (ny × nz cells) as a coloured grid in its frame.
function screenMesh(F, img, ny, nz, gain) {
  const P = [], N = [], C = [], idx = [], nrm = F.n.map((x) => -x);
  for (let i = 0; i <= ny; i++) for (let j = 0; j <= nz; j++) {
    const u = SCREEN_H * (1 - (2 * i) / ny), v = -SCREEN_W + (2 * SCREEN_W * j) / nz;
    P.push(...add(add(F.c, F.u, u), F.v, v)); N.push(...nrm);
    const k = Math.min(ny - 1, i) * nz + Math.min(nz - 1, j);
    const rgb = img ? xyzToLinearRGB([img.X[k] * gain, img.Y[k] * gain, img.Z[k] * gain]) : [0, 0, 0];
    C.push(...rgb.map((c) => oetf(Math.min(1, Math.max(0, c) + 0.06))));
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + nz + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { positions: new Float32Array(P), normals: new Float32Array(N), colors: new Float32Array(C), indices: new Uint32Array(idx) };
}

export function benchScene({ kind, p, glass, dist, img = null, ny = 120, nz = 90, gain = 1, rb = 0.08 }) {
  const shape = makeShape(kind, p), F = screenFrame(kind, p, glass, dist), meshes = [], lines = [], labels = [];
  let solid;
  if (kind === 'prism') solid = prismMesh(shape);
  else if (kind === 'lens') {
    const [s1] = shape, R = s1.r, t = 2 * (s1.c[0] + R), a = shape[2].r, sag = (r) => R - Math.sqrt(R * R - r * r);
    solid = alongX(lensSolid(sag, -t / 2, a, (r) => -sag(r), t / 2, a, 64, 16));
  } else solid = sphere(shape[0].r, [0, 0, 0], 48, 24);
  meshes.push({ mesh: solid, color: [0.78, 0.9, 1.0], opacity: 0.25, glass: true });
  meshes.push({ mesh: screenMesh(F, img, ny, nz, gain), color: [1, 1, 1] });
  // the incoming white beam and sample rays of five wavelengths across it
  for (const lam of [440, 490, 550, 600, 650]) {
    const n = index(glass, lam), rgb = wavelengthRGB(lam);
    for (const y of kind === 'prism' ? [0] : [-0.75, -0.35, 0.35, 0.75].map((f) => f * rb)) {
      const r = traceThrough(shape, [-3, y, 0], [1, 0, 0], n);
      if (!r) continue;
      const dn = r.d[0] * F.n[0] + r.d[1] * F.n[1] + r.d[2] * F.n[2], t = ((F.c[0] - r.o[0]) * F.n[0] + (F.c[1] - r.o[1]) * F.n[1] + (F.c[2] - r.o[2]) * F.n[2]) / dn;
      lines.push({ points: [...r.path.slice(1), add(r.o, r.d, dn > 0 && t > 0 ? t : 1.5)], color: [...rgb, 0.9], width: 1.4 });
    }
  }
  // the white beam up to where its central ray enters the glass
  const c0 = traceThrough(shape, [-3, 0, 0], [1, 0, 0], index(glass, 550));
  lines.push({ points: [[-3, 0, 0], c0 && c0.path[1] ? c0.path[1] : [-0.6, 0, 0]], color: [1, 0.97, 0.9, 0.95], width: 2.2 });
  labels.push({ p: [-2.6, 0.25, 0], text: N_('white light'), color: '#fff2c4' },
    { p: add(F.c, F.u, SCREEN_H * 1.12), text: N_('screen'), color: 'rgba(255,255,255,0.75)' });
  // aim the camera at the whole bench, from the beam's start to the screen
  const lo = [Math.min(-3, F.c[0] - SCREEN_H), Math.min(-1, F.c[1] - SCREEN_H), -SCREEN_W], hi = [Math.max(1, F.c[0] + SCREEN_H), Math.max(1, F.c[1] + SCREEN_H), SCREEN_W];
  const centre = lo.map((v, i) => (v + hi[i]) / 2), size = Math.max(...hi.map((v, i) => v - lo[i]));
  return { meshes, lines, labels, frame: { centre, size }, screen: F };
}
