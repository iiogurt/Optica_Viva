// Spectral optics bench: photons of single wavelengths traced forward from a white beam through a
// glass prism, lens or ball (Sellmeier dispersion of the chosen glass, Fresnel reflection by
// Russian roulette, total internal reflection) onto a white screen, where they paint the caustic in
// colour. Shapes are convex intersections of half-spaces, solid spheres and a cylinder, so one
// routine finds where a ray enters or leaves them. Pure: no DOM; the heavy part runs in workers.
import { index } from './glass.js';
import { cmf } from './color.js';
import { uniform } from './random.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const D2R = Math.PI / 180;

// ── shapes ── each primitive gives the interval [t0, t1] of a ray inside it with the normals there
const prims = {
  // half-space n·p ≤ d
  plane: (P, o, d) => {
    const dn = dot(P.n, d), s = P.d - dot(P.n, o);
    if (Math.abs(dn) < 1e-12) return s >= 0 ? [-Infinity, Infinity, null, null] : null;
    const t = s / dn;
    return dn > 0 ? [-Infinity, t, null, P.n] : [t, Infinity, P.n, null];
  },
  // solid sphere |p − c| ≤ r
  sphere: (P, o, d) => {
    const oc = add(o, P.c, -1), b = dot(oc, d), c = dot(oc, oc) - P.r * P.r, disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s;
    const nAt = (t) => { const p = add(o, d, t); return add(p, P.c, -1).map((x) => x / P.r); };
    return [t0, t1, nAt(t0), nAt(t1)];
  },
  // solid infinite cylinder of radius r about the x axis
  cylX: (P, o, d) => {
    const a = d[1] * d[1] + d[2] * d[2], b = o[1] * d[1] + o[2] * d[2], c = o[1] * o[1] + o[2] * o[2] - P.r * P.r;
    if (a < 1e-12) return c <= 0 ? [-Infinity, Infinity, null, null] : null;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc), t0 = (-b - s) / a, t1 = (-b + s) / a;
    const nAt = (t) => { const p = add(o, d, t), l = Math.hypot(p[1], p[2]); return [0, p[1] / l, p[2] / l]; };
    return [t0, t1, nAt(t0), nAt(t1)];
  },
};
// the interval inside a convex shape (intersection of primitives)
function inside(shape, o, d) {
  let t0 = -Infinity, t1 = Infinity, n0 = null, n1 = null;
  for (const P of shape) {
    const r = prims[P.type](P, o, d);
    if (!r) return null;
    if (r[0] > t0) { t0 = r[0]; n0 = r[2]; }
    if (r[1] < t1) { t1 = r[1]; n1 = r[3]; }
    if (t0 > t1) return null;
  }
  return [t0, t1, n0, n1];
}

// The scenes (scene units; the beam comes from −x along the x axis).
export function makeShape(kind, p = {}) {
  if (kind === 'prism') {
    // equilateral prism, edges along z, side s, turned by `rot` about z; apex up, base down
    const s = 1.1, h = (s * Math.sqrt(3)) / 2, rot = (p.rot || 0) * D2R, shape = [];
    // outward normals of the three faces at 30°, 150° and 270° (before rotation)
    const normals = [30, 150, 270].map((a) => [Math.cos(a * D2R), Math.sin(a * D2R), 0]);
    const inr = h / 3; // inradius: distance from the centroid to each face
    const c = Math.cos(rot), sn = Math.sin(rot), turn = (n) => [c * n[0] - sn * n[1], sn * n[0] + c * n[1], 0];
    // shift the prism vertically so the beam (along y = 0) meets the middle of the entry face
    const shift = [0, -inr * turn(normals[1])[1], 0];
    for (const n of normals) { const m = turn(n); shape.push({ type: 'plane', n: m, d: inr + dot(m, shift) }); }
    shape.push({ type: 'plane', n: [0, 0, 1], d: 0.6 }, { type: 'plane', n: [0, 0, -1], d: 0.6 });
    return shape;
  }
  if (kind === 'lens') {
    // symmetric biconvex lens: radius R, centre thickness t, rim radius a, axis along x
    const R = p.R || 1.6, t = 0.36, a = 0.7;
    return [{ type: 'sphere', c: [t / 2 - R, 0, 0], r: R }, { type: 'sphere', c: [R - t / 2, 0, 0], r: R }, { type: 'cylX', r: a }];
  }
  return [{ type: 'sphere', c: [0, 0, 0], r: p.r || 0.6 }];
}

function refract(d, m, eta) {
  const ci = -dot(d, m), k = 1 - eta * eta * (1 - ci * ci);
  if (k < 0) return null;
  return add(d.map((x) => eta * x), m, eta * ci - Math.sqrt(k));
}
const reflect = (d, m) => add(d, m, -2 * dot(d, m));
function fresnel(ci, n1, n2) {
  const s = (n1 / n2) ** 2 * (1 - ci * ci);
  if (s >= 1) return 1;
  const ct = Math.sqrt(1 - s), rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return (rs * rs + rp * rp) / 2;
}

// Trace one photon (origin o, unit direction d, index n inside the glass). With `rng` the Fresnel
// choice is random; without it the ray always transmits (for the deterministic tests and the drawn
// sample rays). Returns { o, d, path } after leaving the glass, or null if lost.
export function traceThrough(shape, o, d, n, rng = null) {
  const path = [o];
  let pos = o, dir = d, inGlass = false;
  for (let bounce = 0; bounce < 12; bounce++) {
    const I = inside(shape, pos, dir);
    if (!inGlass) {
      if (!I || I[0] <= 1e-7) return { o: pos, d: dir, path };
      const p = add(pos, dir, I[0]), m = I[2];
      path.push(p);
      if (rng && rng() < fresnel(-dot(dir, m), 1, n)) { pos = p; dir = reflect(dir, m); continue; }
      dir = refract(dir, m, 1 / n); pos = p; inGlass = true;
    } else {
      if (!I) return null;
      const p = add(pos, dir, I[1]), m = I[3];
      path.push(p);
      const ci = dot(dir, m), R = fresnel(ci, n, 1);
      if (R >= 1 || (rng && rng() < R)) { pos = p; dir = reflect(dir, m); continue; }
      dir = refract(dir, m.map((x) => -x), n); pos = p; inGlass = false;
    }
  }
  return null;
}

// Photons from a white beam (radius rb, centred at height y0, travelling +x from x = −3) onto the
// screen: XYZ binned on an ny × nz grid over u ∈ [−H, H], v ∈ [−W, W] across it.
export const SCREEN_H = 1.2, SCREEN_W = 0.9;
// The screen faces the central ray at 550 nm, `dist` beyond the point where it leaves the glass:
// centre c, normal n (along the ray), u (in the x–y plane) and v = z across it.
export function screenFrame(kind, p, glass, dist) {
  const r = traceThrough(makeShape(kind, p), [-3, 0, 0], [1, 0, 0], index(glass, 550));
  const o = r ? r.o : [0, 0, 0], d = r ? r.d : [1, 0, 0];
  return { c: add(o, d, dist), n: d, u: [-d[1], d[0], 0], v: [0, 0, 1], exit: o };
}
export function benchPhotons({ kind, p, glass, rays, seed, dist = 2, ny = 120, nz = 90, rb = 0.08, y0 = 0 }) {
  const shape = makeShape(kind, p), rng = uniform(seed), X = new Float32Array(ny * nz), Y = new Float32Array(ny * nz), Z = new Float32Array(ny * nz);
  const F = screenFrame(kind, p, glass, dist);
  for (let i = 0; i < rays; i++) {
    const lam = 400 + rng() * 300, n = index(glass, lam);
    let ry, rz;
    do { ry = rng() * 2 - 1; rz = rng() * 2 - 1; } while (ry * ry + rz * rz > 1);
    const r = traceThrough(shape, [-3, y0 + ry * rb, rz * rb], [1, 0, 0], n, rng);
    if (!r) continue;
    const dn = dot(r.d, F.n);
    if (dn <= 1e-6) continue;
    const t = dot(add(F.c, r.o, -1), F.n) / dn;
    if (t <= 0) continue;
    const q = add(add(r.o, r.d, t), F.c, -1), py = dot(q, F.u), pz = dot(q, F.v);
    const iy = Math.floor(((SCREEN_H - py) / (2 * SCREEN_H)) * ny), iz = Math.floor(((pz + SCREEN_W) / (2 * SCREEN_W)) * nz);
    if (iy < 0 || iz < 0 || iy >= ny || iz >= nz) continue;
    const c = cmf(lam), k = iy * nz + iz;
    X[k] += c[0]; Y[k] += c[1]; Z[k] += c[2];
  }
  return { X, Y, Z };
}

// Analytic deviation of a ray through a prism of apex angle A at incidence angle i (rad).
export function prismDeviation(A, n, i) {
  const r1 = Math.asin(Math.sin(i) / n), r2 = A - r1, s = n * Math.sin(r2);
  return s >= 1 ? NaN : i + Math.asin(s) - A;
}
