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
  'plano-hyperbolic': {
    name: 'Plano-aspheric singlet f/5 (N-BK7, hyperbolic k = −n², no spherical aberration)',
    epd: 20, field: 3,
    surfaces: [
      { R: Infinity, t: 5, glass: 'N-BK7', stop: true },
      { R: -51.68, k: -2.30068, t: 100, glass: 'air' },
    ],
  },
  'achromat': {
    // designed for this project: N-BK7/F2 cemented doublet, f = 100 mm, spherical aberration
    // corrected and F, C brought to a common paraxial focus (solved numerically)
    name: 'Cemented achromat f/5, 100 mm (N-BK7 / F2)',
    epd: 20, field: 3,
    surfaces: [
      { R: 44.444, t: 5, glass: 'N-BK7', stop: true },
      { R: -42.447, t: 2.5, glass: 'F2' },
      { R: -826.165, t: 95, glass: 'air' },
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

// ── Aspheric surfaces ───────────────────────────────────────────────────────────────────
// Even asphere: z(r) = c r² / (1 + √(1 − (1+k) c² r²)) + a₄r⁴ + a₆r⁶ + a₈r⁸ + a₁₀r¹⁰,
// with c = 1/R (0 for R = ∞), conic constant k (0 sphere, −1 paraboloid, < −1 hyperboloid)
// and s.a = [a₄, a₆, a₈, a₁₀]. Returns NaN outside the conic's domain.
export const isAspheric = (s) => !!(s.k || (s.a && s.a.some((v) => v)));
export function surfaceSag(s, r) {
  const c = isFinite(s.R) ? 1 / s.R : 0, k = s.k || 0, r2 = r * r;
  const q = 1 - (1 + k) * c * c * r2;
  if (q < 0) return NaN;
  let z = (c * r2) / (1 + Math.sqrt(q)), rp = r2 * r2;
  for (const ai of s.a || []) { z += ai * rp; rp *= r2; }
  return z;
}
// dz/dr (analytic)
function surfaceSlope(s, r) {
  const c = isFinite(s.R) ? 1 / s.R : 0, k = s.k || 0;
  const q = 1 - (1 + k) * c * c * r * r;
  if (q <= 0) return NaN;
  let d = (c * r) / Math.sqrt(q), pw = 4, rp = r * r * r;
  for (const ai of s.a || []) { d += pw * ai * rp; pw += 2; rp *= r * r; }
  return d;
}
// Intersection by Newton iteration on f(t) = z(t) − z₀ − sag(r(t)), starting at the vertex plane.
export function intersectAsphere(s, z0, p, d) {
  let t = (z0 - p[2]) / d[2];
  for (let it = 0; it < 40; it++) {
    const x = p[0] + t * d[0], y = p[1] + t * d[1], z = p[2] + t * d[2], r = Math.hypot(x, y);
    const zs = surfaceSag(s, r);
    if (!isFinite(zs)) return null;
    const f = z - z0 - zs;
    const dr = r > 1e-12 ? (x * d[0] + y * d[1]) / r : 0;
    const df = d[2] - surfaceSlope(s, r) * dr;
    const dt = f / df;
    t -= dt;
    if (Math.abs(dt) < 1e-12) {
      const P = [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]], rr = Math.hypot(P[0], P[1]);
      const m = surfaceSlope(s, rr), ux = rr > 1e-12 ? P[0] / rr : 0, uy = rr > 1e-12 ? P[1] / rr : 0;
      const L = Math.hypot(m, 1);
      return { t, p: P, nrm: [(m * ux) / L, (m * uy) / L, -1 / L] }; // normal points against propagation
    }
  }
  return null;
}
function mediumBefore(lens, i) { return i === 0 ? 'air' : lens.surfaces[i - 1].glass; }

// ── Paraxial (first-order) analysis, y–nu matrix method ─────────────────────────────────
// Returns the 2×2 transfer matrix from just before surface `from` to just before surface
// `to` (exclusive), acting on (y, n·u).
export function paraxialMatrix(lens, lambda, from, to) {
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
    if (isAspheric(s)) {
      const hit = intersectAsphere(s, z0, p, d);
      if (!hit) return { ok: false, path, missed: i };
      ({ t, p, nrm } = hit);
    } else if (!isFinite(s.R)) {
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

// ── Seidel (third-order) aberration sums, Welford's formulation ──────────────────────────
// A paraxial marginal ray (y, u) from an axial object at infinity filling the pupil, and a
// chief ray (ȳ, ū) at the maximum field through the pupil centre, give per surface
//   S_I = −A² y Δ(u/n)     S_II = −A Ā y Δ(u/n)     S_III = −Ā² y Δ(u/n)
//   S_IV = −H² c Δ(1/n)    S_V = (Ā/A)(S_III + S_IV)
//   C_I = A y Δ(δn/n)      C_II = Ā y Δ(δn/n)
// with A = n(u + yc), Ā = n(ū + ȳc), H = n(ūy − uȳ) and δn = n_F − n_C.
// Aspheric surfaces add ΔS_I = 8G(n'−n)y⁴ with G = k c³/8 + a₄, and the stop-shift partners
// ΔS_II = ΔS_I(ȳ/y), ΔS_III = ΔS_I(ȳ/y)², ΔS_V = ΔS_I(ȳ/y)³.
// Wavefront coefficients at full field and aperture: W₀₄₀ = S_I/8, W₁₃₁ = S_II/2,
// W₂₂₂ = S_III/2, W₂₂₀ = (S_III + S_IV)/4 (medial), W₃₁₁ = S_V/2 (all in lens units).
export function seidel(lens, lambda = 587.56) {
  const S = lens.surfaces, N = S.length, par = paraxial(lens, lambda);
  const mb = (i) => (i === 0 ? 'air' : S[i - 1].glass);
  let y = lens.epd / 2, u = 0;
  const ub0 = Math.tan((lens.field * Math.PI) / 180);
  let yb = -ub0 * par.zEP, ub = ub0;
  const H = ub * y - u * yb; // object space, n = 1
  const rows = [];
  for (let i = 0; i < N; i++) {
    const s = S[i], c = isFinite(s.R) ? 1 / s.R : 0;
    const n = index(mb(i), lambda), n2 = index(s.glass, lambda);
    const dn1 = index(mb(i), 486.13) - index(mb(i), 656.27), dn2 = index(s.glass, 486.13) - index(s.glass, 656.27);
    const A = n * (u + y * c), Ab = n * (ub + yb * c);
    const u2 = (n * u - y * (n2 - n) * c) / n2, ub2 = (n * ub - yb * (n2 - n) * c) / n2;
    const dUn = u2 / n2 - u / n;
    const SI = -A * A * y * dUn, SII = -A * Ab * y * dUn, SIII = -Ab * Ab * y * dUn;
    const SIV = -H * H * c * (1 / n2 - 1 / n);
    let SV = A !== 0 ? (Ab / A) * (SIII + SIV) : 0;
    const CI = A * y * (dn2 / n2 - dn1 / n), CII = Ab * y * (dn2 / n2 - dn1 / n);
    const row = { i, SI, SII, SIII, SIV, SV, CI, CII };
    const G = ((s.k || 0) * c * c * c) / 8 + ((s.a && s.a[0]) || 0);
    if (G) {
      const dSI = 8 * G * (n2 - n) * y ** 4, q = yb / y;
      row.SI += dSI; row.SII += dSI * q; row.SIII += dSI * q * q; row.SV += dSI * q * q * q;
    }
    rows.push(row);
    if (i < N - 1) { y += S[i].t * u2; yb += S[i].t * ub2; }
    u = u2; ub = ub2;
  }
  const total = {};
  for (const k of ['SI', 'SII', 'SIII', 'SIV', 'SV', 'CI', 'CII']) total[k] = rows.reduce((a, r) => a + r[k], 0);
  return { rows, total, H, uImage: u, nImage: index(S[N - 1].glass, lambda) };
}

// ── Through-field analysis ──────────────────────────────────────────────────────────────
// Tangential and sagittal foci from differential real rays about the chief ray (the
// Coddington foci, found by exact tracing), and real-ray distortion, versus field angle.
// Returns rows { theta, zt, zs, dist } with zt, zs relative to the paraxial image plane (mm,
// measured along z) and dist in % relative to f·tanθ.
export function fieldCurves(lens, lambda = 587.56, n = 13, delta = 0.02) {
  const par = paraxial(lens, lambda), zv = par.zv, out = [];
  const go = (th, px, py) => { const a = aimRay(lens, lambda, th, px, py, par); if (!a) return null; const r = trace(lens, lambda, a.p, a.d, { clip: false, zv }); return r.ok ? r : null; };
  for (let k = 0; k < n; k++) {
    const th = (lens.field * k) / (n - 1);
    const c = go(th, 0, 0), t1 = go(th, 0, delta), t2 = go(th, 0, -delta), s1 = go(th, delta, 0);
    if (!c || !t1 || !t2 || !s1) continue;
    // tangential: where the ±δ meridional rays cross each other (y–z plane)
    const ty1 = t1.d[1] / t1.d[2], ty2 = t2.d[1] / t2.d[2];
    const zt = (t2.p[1] - ty2 * t2.p[2] - t1.p[1] + ty1 * t1.p[2]) / (ty1 - ty2);
    // sagittal: where the +δ sagittal ray returns to the meridional plane (x = 0)
    const zs = s1.p[2] - s1.p[0] * (s1.d[2] / s1.d[0]);
    const yImg = toPlane(c, par.zImage)[1], ideal = par.efl * Math.tan((th * Math.PI) / 180);
    out.push({ theta: th, zt: zt - par.zImage, zs: zs - par.zImage, dist: th > 0 ? ((yImg - ideal) / ideal) * 100 : 0 });
  }
  return out;
}
