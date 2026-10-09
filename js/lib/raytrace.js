// Sequential, exact (non-paraxial) 3-D ray tracer for rotationally symmetric systems of
// spherical surfaces, with paraxial first-order analysis, real-ray aiming at the aperture
// stop and optical-path-difference (OPD) evaluation against the exit-pupil reference sphere.
// Units: mm. z is the optical axis, light travels toward +z.

import { index } from './glass.js';

// ── Lens prescriptions ─────────────────────────────────────────────────────────────────
// Each surface: R (radius, Infinity = plane), t (axial distance to next surface),
// glass (medium AFTER the surface), stop: true marks the aperture stop.
export const LENSES = {
  'plano-convex': {
    name: 'Plano-convex singlet f/5 (N-BK7, convex side to object)',
    epd: 20, field: 3,
    surfaces: [
      { R: 51.5, t: 3.6, glass: 'N-BK7', stop: true },
      { R: Infinity, t: 97.6, glass: 'air' },
    ],
  },
  'plano-convex-rev': {
    name: 'Plano-convex singlet f/5, reversed (flat side to object)',
    epd: 20, field: 3,
    surfaces: [
      { R: Infinity, t: 3.6, glass: 'N-BK7', stop: true },
      { R: -51.5, t: 97.6, glass: 'air' },
    ],
  },
  'achromat': {
    name: 'Cemented achromatic doublet f/5 (N-BAK4 / N-SF5, f≈100 mm)',
    epd: 20, field: 3,
    surfaces: [
      { R: 62.75, t: 4.0, glass: 'N-BAK4', stop: true },
      { R: -45.71, t: 2.5, glass: 'N-SF5' },
      { R: -128.23, t: 97.0, glass: 'air' },
    ],
  },
  'cooke': {
    name: 'Cooke triplet f/5, 50 mm (SK16 / F2 / SK16)',
    epd: 10, field: 20,
    surfaces: [
      { R: 22.01359, t: 3.25896, glass: 'SK16' },
      { R: -435.76044, t: 6.00755, glass: 'air' },
      { R: -22.21328, t: 0.99997, glass: 'F2' },
      { R: 20.29192, t: 4.75041, glass: 'air', stop: true },
      { R: 79.6836, t: 2.95208, glass: 'SK16' },
      { R: -18.39533, t: 42.20778, glass: 'air' },
    ],
  },
  'double-gauss': {
    name: 'Double-Gauss f/3, 100 mm (SK2 / SK16 / F5)',
    epd: 33.3, field: 14,
    surfaces: [
      { R: 54.153246, t: 8.746658, glass: 'SK2' },
      { R: 152.52192, t: 0.5, glass: 'air' },
      { R: 35.950619, t: 14.0, glass: 'SK16' },
      { R: Infinity, t: 3.776966, glass: 'F5' },
      { R: 22.269925, t: 14.253059, glass: 'air' },
      { R: Infinity, t: 12.428129, glass: 'air', stop: true },
      { R: -25.685033, t: 3.776966, glass: 'F5' },
      { R: Infinity, t: 10.833929, glass: 'SK16' },
      { R: -36.980221, t: 0.5, glass: 'air' },
      { R: 196.41712, t: 6.858175, glass: 'SK16' },
      { R: -67.147919, t: 57.314642, glass: 'air' },
    ],
  },
};

// ── Geometry helpers ────────────────────────────────────────────────────────────────────
export function vertices(lens) {
  const z = [0];
  for (let i = 0; i < lens.surfaces.length - 1; i++) z.push(z[i] + lens.surfaces[i].t);
  return z;
}
export const stopIndex = (lens) => Math.max(0, lens.surfaces.findIndex((s) => s.stop));
export function sag(R, r) {
  if (!isFinite(R)) return 0;
  const c = 1 / R, k = 1 - c * c * r * r;
  return k <= 0 ? R : (c * r * r) / (1 + Math.sqrt(k));
}
function mediumBefore(lens, i) { return i === 0 ? 'air' : lens.surfaces[i - 1].glass; }

// ── Paraxial (first-order) analysis, y–nu matrix method ─────────────────────────────────
// Returns the 2×2 transfer matrix from just before surface `from` to just before surface
// `to` (exclusive), acting on (y, n·u).
function paraxialMatrix(lens, lambda, from, to) {
  let M = [1, 0, 0, 1];
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  for (let i = from; i < to; i++) {
    const s = lens.surfaces[i];
    const n = index(mediumBefore(lens, i), lambda), n2 = index(s.glass, lambda);
    const phi = (n2 - n) * (isFinite(s.R) ? 1 / s.R : 0);
    M = mul([1, 0, -phi, 1], M);
    if (i < to - 1) M = mul([1, s.t / n2, 0, 1], M);
  }
  return M;
}

export function paraxial(lens, lambda = 587.56) {
  const N = lens.surfaces.length;
  const zv = vertices(lens);
  // Marginal ray from infinity: y = 1, nu = 0
  const M = paraxialMatrix(lens, lambda, 0, N);
  const efl = -1 / M[2];
  const yLast = M[0], uLast = M[2];
  const bfl = -yLast / uLast;
  const zImage = zv[N - 1] + bfl;
  // Entrance pupil: matrix from surface 1 up to (just before) the stop, including the
  // final translation onto the stop vertex.
  const si = stopIndex(lens);
  let A = 1, B = 0;
  if (si > 0) {
    const Ms = paraxialMatrix(lens, lambda, 0, si);
    const nS = index(lens.surfaces[si - 1].glass, lambda), t = lens.surfaces[si - 1].t;
    // y_stop = (Ms00 + t/n Ms10) y + (Ms01 + t/n Ms11) u   (n·u with n=1 in object space)
    A = Ms[0] + (t / nS) * Ms[2];
    B = Ms[1] + (t / nS) * Ms[3];
  }
  const zEP = B / A;              // relative to first vertex
  const stopR = A * lens.epd / 2; // stop semi-diameter that yields the specified EPD
  // Exit pupil: image of the stop through the following surfaces.
  let zXP = zv[si];
  {
    // trace a ray from stop centre with nu = 1; find where it (extended) crosses the axis in image space
    let y = 0, nu = 1;
    for (let i = si; i < N; i++) {
      const s = lens.surfaces[i];
      const n = index(mediumBefore(lens, i), lambda), n2 = index(s.glass, lambda);
      if (i > si) { y += lens.surfaces[i - 1].t * nu / n; }
      const phi = (n2 - n) * (isFinite(s.R) ? 1 / s.R : 0);
      nu = nu - y * phi;
    }
    zXP = zv[N - 1] - y / nu; // ray y(z) = y + nu (z − z_last); axis crossing
  }
  // Petzval sum Σ φ_k / (n_k n'_k)
  let petz = 0;
  lens.surfaces.forEach((s, i) => {
    const n = index(mediumBefore(lens, i), lambda), n2 = index(s.glass, lambda);
    petz += (n2 - n) * (isFinite(s.R) ? 1 / s.R : 0) / (n * n2);
  });
  return { efl, bfl, zImage, zEP, stopR, zXP, petzval: petz, fnum: efl / lens.epd, zv };
}

// ── Exact 3-D ray trace ──────────────────────────────────────────────────────────────────
// ray: {p:[x,y,z], d:[l,m,n] unit, opl}. Returns {path, p, d, opl, ok, blocked}.
export function trace(lens, lambda, p0, d0, opts = {}) {
  const zv = opts.zv || vertices(lens);
  const clip = opts.clip !== false;
  const sds = opts.sd || null;
  let p = p0.slice(), d = d0.slice();
  let opl = opts.opl0 ?? 0;
  const path = opts.path ? [p.slice()] : null;
  const N = lens.surfaces.length;
  const stopHit = { x: 0, y: 0 };
  for (let i = 0; i < N; i++) {
    const s = lens.surfaces[i];
    const n1 = index(mediumBefore(lens, i), lambda), n2 = index(s.glass, lambda);
    const z0 = zv[i];
    let t, nrm;
    if (!isFinite(s.R)) {
      t = (z0 - p[2]) / d[2];
      if (!(t > -1e9)) return { ok: false, path };
      p = [p[0] + t * d[0], p[1] + t * d[1], z0];
      nrm = [0, 0, -1];
    } else {
      const R = s.R, cz = z0 + R;
      const q = [p[0], p[1], p[2] - cz];
      const b = q[0] * d[0] + q[1] * d[1] + q[2] * d[2];
      const c = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - R * R;
      const disc = b * b - c;
      if (disc < 0) return { ok: false, path, missed: i };
      const sq = Math.sqrt(disc);
      // choose the intersection on the vertex-side hemisphere
      const t1 = -b - sq, t2 = -b + sq;
      const zA = p[2] + t1 * d[2];
      t = (zA - cz) * R < 0 ? t1 : t2;
      p = [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]];
      nrm = [p[0] / R, p[1] / R, (p[2] - cz) / R]; // points against the propagation (−z side)
    }
    opl += n1 * t;
    if (path) path.push(p.slice());
    const r = Math.hypot(p[0], p[1]);
    if (s.stop) { stopHit.x = p[0]; stopHit.y = p[1]; }
    if (clip && sds && r > sds[i] * 1.0000001) return { ok: false, blocked: i, path, p, d, opl };
    // vector Snell's law
    const mu = n1 / n2;
    const cosi = -(nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2]);
    const k = 1 - mu * mu * (1 - cosi * cosi);
    if (k < 0) return { ok: false, tir: i, path };
    const f = mu * cosi - Math.sqrt(k);
    d = [mu * d[0] + f * nrm[0], mu * d[1] + f * nrm[1], mu * d[2] + f * nrm[2]];
  }
  return { ok: true, p, d, opl, path, stopHit };
}

// Propagate a traced ray to the plane z = zp.
export function toPlane(res, zp) {
  const t = (zp - res.p[2]) / res.d[2];
  return [res.p[0] + t * res.d[0], res.p[1] + t * res.d[1], zp];
}

// Trace up to (and including) the stop surface only — used for ray aiming.
function stopCoords(lens, lambda, p0, d0, zv) {
  const si = stopIndex(lens);
  const sub = { surfaces: lens.surfaces.slice(0, si + 1) };
  const r = trace(sub, lambda, p0, d0, { zv, clip: false });
  return r.ok ? [r.p[0], r.p[1]] : null;
}

// Real-ray aiming: find the launch point (on plane z0, direction set by field angle θ)
// whose ray passes the stop at normalised pupil coordinates (px, py).
export function aimRay(lens, lambda, thetaDeg, px, py, par) {
  par = par || paraxial(lens, lambda);
  const zv = par.zv;
  const th = thetaDeg * Math.PI / 180;
  const d = [0, Math.sin(th), Math.cos(th)];
  const z0 = -20;
  const rEP = lens.epd / 2;
  // paraxial initial guess through the entrance pupil
  let x = px * rEP, y = py * rEP + (z0 - par.zEP) * Math.tan(th);
  const tx = px * par.stopR, ty = py * par.stopR;
  if (stopIndex(lens) === 0 && zv.length) {
    // the stop is the first surface: aim directly
  }
  for (let it = 0; it < 6; it++) {
    const s = stopCoords(lens, lambda, [x, y, z0], d, zv);
    if (!s) return null;
    const ex = s[0] - tx, ey = s[1] - ty;
    if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) break;
    const h = 1e-4;
    const sx = stopCoords(lens, lambda, [x + h, y, z0], d, zv);
    const sy = stopCoords(lens, lambda, [x, y + h, z0], d, zv);
    if (!sx || !sy) return null;
    const a = (sx[0] - s[0]) / h, b = (sy[0] - s[0]) / h, c = (sx[1] - s[1]) / h, e = (sy[1] - s[1]) / h;
    const det = a * e - b * c;
    if (Math.abs(det) < 1e-12) return null;
    x -= (e * ex - b * ey) / det;
    y -= (-c * ex + a * ey) / det;
  }
  // OPL measured from the incident plane wavefront through the origin
  return { p: [x, y, z0], d, opl0: x * d[0] + y * d[1] + z0 * d[2] };
}

// Automatic clear semi-diameters: trace marginal rays at full field, take the maxima.
export function autoSemiDiameters(lens, lambdas = [486.13, 587.56, 656.27]) {
  const N = lens.surfaces.length, sd = new Array(N).fill(0);
  for (const lam of lambdas) {
    const par = paraxial(lens, lam);
    for (const f of [0, 0.7, 1]) for (const [px, py] of [[0, 1], [0, -1], [1, 0], [0, 0]]) {
      const a = aimRay(lens, lam, f * lens.field, px, py, par);
      if (!a) continue;
      const r = trace(lens, lam, a.p, a.d, { clip: false, path: true, zv: par.zv });
      if (!r.path) continue;
      for (let i = 0; i < N && i + 1 < r.path.length; i++) sd[i] = Math.max(sd[i], Math.hypot(r.path[i + 1][0], r.path[i + 1][1]));
    }
  }
  return sd.map((v) => v * 1.04 + 0.2);
}

// Chief-ray image point and the exit-pupil reference sphere.
export function referenceSphere(lens, lambda, thetaDeg, zImg, par) {
  par = par || paraxial(lens, lambda);
  const a = aimRay(lens, lambda, thetaDeg, 0, 0, par);
  if (!a) return null;
  const r = trace(lens, lambda, a.p, a.d, { clip: false, opl0: a.opl0, zv: par.zv });
  if (!r.ok) return null;
  const P = toPlane(r, zImg);
  const E = toPlane(r, par.zXP);
  const R = Math.hypot(P[0] - E[0], P[1] - E[1], P[2] - E[2]);
  // OPL of the chief ray up to the reference sphere (point E)
  const tE = (par.zXP - r.p[2]) / r.d[2];
  return { center: P, R, oplChief: r.opl + tE, chief: r };
}

// OPD (in waves) of a ray w.r.t. the reference sphere; positive = ray path longer.
export function opd(lens, lambda, thetaDeg, px, py, ref, par) {
  const a = aimRay(lens, lambda, thetaDeg, px, py, par);
  if (!a) return null;
  const r = trace(lens, lambda, a.p, a.d, { clip: false, opl0: a.opl0, zv: par.zv });
  if (!r.ok) return null;
  const C = ref.center;
  const q = [r.p[0] - C[0], r.p[1] - C[1], r.p[2] - C[2]];
  const b = q[0] * r.d[0] + q[1] * r.d[1] + q[2] * r.d[2];
  const c = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - ref.R * ref.R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); // intersection on the exit-pupil side of the sphere
  return (r.opl + t - ref.oplChief) / (lambda * 1e-6);
}
