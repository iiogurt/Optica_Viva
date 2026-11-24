// Real-ray field maps of reflecting telescopes. Rays are aimed through a grid of points on the
// primary mirror (the aperture stop) for a field point anywhere in the field, traced exactly
// through the conic mirrors (js/lib/raytrace.js) and their optical path compared with the
// reference sphere centred on the chief ray's crossing of the detector. The wavefront is fitted
// with Noll-ordered Zernike polynomials through sixth radial order (28 terms), which hold the
// fifth-order aberrations a three-mirror anastigmat is left with once its third-order sums are
// zero. The wavefront is W = −OPD (the ray's path shorter than the chief ray's counts positive),
// the sign of js/lib/fieldpsf.js, so traced and nodal-theory coefficients can be compared
// directly. Units: mm inside the tracer; wavefronts in nm; field angles in degrees.
import { LENSES, paraxial, referenceSphere, opd } from './raytrace.js';
import { zernike } from './pupil.js';

export const J = 28; // Noll terms 1–28: radial orders 0–6
const LAM = 587.56; // nm: mirrors have no dispersion, so the OPD in nm is the same at every λ

// A traced system with errors. err: dK (primary conic), dz (m, secondary moved towards the
// primary; the detector stays at the nominal focus), dx, dy (m, secondary decentre), tx, ty
// (rad, secondary tilts about the x and y axes through its vertex), as in js/lib/fieldpsf.js.
export function tracedLens(id, err = {}) {
  const L = LENSES[id], s = L.surfaces.map((q) => ({ ...q })), dz = (err.dz || 0) * 1e3;
  s[0].k = (s[0].k || 0) + (err.dK || 0);
  s[0].t += dz; s[1].t -= dz;
  if (err.dx || err.dy) s[1].dec = [(err.dx || 0) * 1e3, (err.dy || 0) * 1e3];
  if (err.tx || err.ty) s[1].tilt = [err.tx || 0, err.ty || 0];
  return { ...L, surfaces: s };
}

// Pupil samples (a square grid of n × n cells, kept inside the unit circle) with the Zernike
// basis at each and the inverse of the normal matrix, so a fit is one matrix product.
export function pupilFit(n = 20) {
  const xs = [], ys = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i + 1) / n, y = -1 + (2 * j + 1) / n;
    if (x * x + y * y <= 1) { xs.push(x); ys.push(y); }
  }
  const m = xs.length, B = new Float64Array(m * J);
  for (let k = 0; k < m; k++) {
    const r = Math.hypot(xs[k], ys[k]), th = Math.atan2(ys[k], xs[k]);
    for (let j = 0; j < J; j++) B[k * J + j] = zernike(j + 1, r, th);
  }
  // normal matrix and its inverse (Gauss–Jordan with partial pivoting)
  const A = Array.from({ length: J }, (_, a) => { const row = new Float64Array(2 * J); for (let c = 0; c < J; c++) { let s = 0; for (let k = 0; k < m; k++) s += B[k * J + a] * B[k * J + c]; row[c] = s; } row[J + a] = 1; return row; });
  for (let a = 0; a < J; a++) {
    let p = a;
    for (let r = a + 1; r < J; r++) if (Math.abs(A[r][a]) > Math.abs(A[p][a])) p = r;
    [A[a], A[p]] = [A[p], A[a]];
    const d = A[a][a];
    for (let c = 0; c < 2 * J; c++) A[a][c] /= d;
    for (let r = 0; r < J; r++) if (r !== a) { const f = A[r][a]; if (f) for (let c = 0; c < 2 * J; c++) A[r][c] -= f * A[a][c]; }
  }
  const inv = new Float64Array(J * J);
  for (let a = 0; a < J; a++) for (let c = 0; c < J; c++) inv[a * J + c] = A[a][J + c];
  return { n, m, xs, ys, B, inv };
}

// The traced system prepared once: its paraxial data and the nominal focus (the detector).
export function prepare(id, err = {}) {
  const nominal = LENSES[id], lens = tracedLens(id, err);
  return { id, lens, par: paraxial(lens, LAM), zImg: paraxial(nominal, LAM).zImage };
}

// Wavefront at field point H = [θx, θy] (degrees): Zernike coefficients (nm) and the RMS (nm)
// left after removing piston and tilt and the focus term df (nm of Z4, the detector's own
// curvature; 0 for a flat detector at the nominal focus). The returned Z4 has df removed.
export function wavefrontAt(sys, H, P, df = 0) {
  const ref = referenceSphere(sys.lens, LAM, H, sys.zImg, sys.par);
  if (!ref) return null;
  const w = new Float64Array(P.m);
  for (let k = 0; k < P.m; k++) {
    const v = opd(sys.lens, LAM, H, P.xs[k], P.ys[k], ref, sys.par);
    if (v == null) return null;
    w[k] = -v * LAM;
  }
  const bt = new Float64Array(J), z = new Float64Array(J);
  for (let k = 0; k < P.m; k++) { const wk = w[k], o = k * J; for (let j = 0; j < J; j++) bt[j] += P.B[o + j] * wk; }
  for (let a = 0; a < J; a++) { let s = 0; for (let c = 0; c < J; c++) s += P.inv[a * J + c] * bt[c]; z[a] = s; }
  let s2 = 0;
  for (let k = 0; k < P.m; k++) {
    const o = k * J, r = w[k] - z[0] * P.B[o] - z[1] * P.B[o + 1] - z[2] * P.B[o + 2] - df * P.B[o + 3];
    s2 += r * r;
  }
  z[3] -= df;
  return { z, rms: Math.sqrt(s2 / P.m) };
}

// The detector that follows the aligned design's focal surface: its Z4 grows with the field
// radius as c₁H² + c₂H⁴ + c₃H⁶, fitted to traces along +x out to hmax (degrees).
export function focalSurface(id, hmax, P) {
  const sys = prepare(id), z0 = wavefrontAt(sys, [0, 0], P).z[3], rows = [];
  for (let k = 1; k <= 6; k++) {
    const h = (hmax * k) / 6, f = wavefrontAt(sys, [h, 0], P);
    if (f) rows.push([h * h, h ** 4, h ** 6, f.z[3] - z0]);
  }
  // least squares for (c₁, c₂, c₃), scaled to keep the normal matrix well conditioned
  const s = hmax * hmax || 1, M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const r of rows) {
    const u = [r[0] / s, r[1] / s ** 2, r[2] / s ** 3];
    for (let a = 0; a < 3; a++) { b[a] += u[a] * r[3]; for (let c = 0; c < 3; c++) M[a][c] += u[a] * u[c]; }
  }
  const c = solve3(M, b);
  return (h2) => c[0] * (h2 / s) + c[1] * (h2 / s) ** 2 + c[2] * (h2 / s) ** 3;
}
function solve3(M, b) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (!D) return [0, 0, 0];
  return [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}

// Astigmatism as a complex number, (Z6 + i Z5): its magnitude is the amplitude and half its
// argument the orientation of the astigmatic line. Coma likewise as (Z8 + i Z7).
export const astigOf = (z, o = 0) => [z[o + 5], z[o + 4]];
export const comaOf = (z, o = 0) => [z[o + 7], z[o + 6]];

// Field point (degrees) of cell (i, j) of a G × G map spanning ±half: cell centres, row 0 at the
// top (+θy), so the map can be painted cell for cell.
export const cellH = (G, half, i, j) => [(-1 + (2 * i + 1) / G) * half, (1 - (2 * j + 1) / G) * half];

// The zeros of the astigmatism field: fit A H² + B H + C (H = θx + iθy) to the traced
// astigmatism by least squares and return its two roots (degrees) and the fraction of the
// astigmatism's variance the quadratic explains (r2). These are the binodes of nodal aberration
// theory, found from real rays, with the higher orders averaged into the fit.
export function astigZeros(G, half, zz) {
  // unknowns: Re/Im of A, B, C. Complex model f = A H² + B H + C.
  const rows = [], rhs = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const [hx, hy] = cellH(G, half, i, j), [ar, ai] = astigOf(zz, (j * G + i) * J), h2 = [hx * hx - hy * hy, 2 * hx * hy];
    // Re: Ar h2r − Ai h2i + Br hx − Bi hy + Cr ; Im: Ar h2i + Ai h2r + Br hy + Bi hx + Ci
    rows.push([h2[0], -h2[1], hx, -hy, 1, 0]); rhs.push(ar);
    rows.push([h2[1], h2[0], hy, hx, 0, 1]); rhs.push(ai);
  }
  const N = Array.from({ length: 6 }, () => new Float64Array(7));
  rows.forEach((r, k) => { for (let a = 0; a < 6; a++) { N[a][6] += r[a] * rhs[k]; for (let c = 0; c < 6; c++) N[a][c] += r[a] * r[c]; } });
  for (let a = 0; a < 6; a++) {
    let p = a;
    for (let r = a + 1; r < 6; r++) if (Math.abs(N[r][a]) > Math.abs(N[p][a])) p = r;
    [N[a], N[p]] = [N[p], N[a]];
    if (!N[a][a]) return { roots: [], r2: 0 };
    for (let r = 0; r < 6; r++) if (r !== a) { const f = N[r][a] / N[a][a]; for (let c = a; c < 7; c++) N[r][c] -= f * N[a][c]; }
  }
  const x = N.map((row, a) => row[6] / row[a]), A = [x[0], x[1]], B = [x[2], x[3]], C = [x[4], x[5]];
  let ss = 0, sr = 0, mean = [0, 0];
  for (let k = 0; k < rhs.length; k++) mean[k % 2] += rhs[k] / (rhs.length / 2);
  rows.forEach((r, k) => { let f = 0; for (let a = 0; a < 6; a++) f += r[a] * x[a]; sr += (rhs[k] - f) ** 2; ss += (rhs[k] - mean[k % 2]) ** 2; });
  const r2 = ss ? 1 - sr / ss : 0;
  if (Math.hypot(...A) < 1e-12 * (Math.hypot(...B) + Math.hypot(...C) + 1e-30)) return { roots: [], r2 };
  const cm = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]], cd = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
  const BB = cm(B, B), AC = cm(A, C), disc = [BB[0] - 4 * AC[0], BB[1] - 4 * AC[1]], r = Math.hypot(...disc);
  const sq = [Math.sqrt((r + disc[0]) / 2), Math.sign(disc[1] || 1) * Math.sqrt(Math.max(0, (r - disc[0]) / 2))], den = [2 * A[0], 2 * A[1]];
  return { roots: [cd([-B[0] + sq[0], -B[1] + sq[1]], den), cd([-B[0] - sq[0], -B[1] - sq[1]], den)], r2 };
}

// The map: o = { id, err, field (degrees, half-width), G (grid), nc (points along +x),
// curved (detector on the aligned focal surface), n (pupil grid) }. Returns per cell (cellH) the
// 28 coefficients (nm) and the RMS (nm), the same along +x out to 1.5 × field, and the zeros of
// the astigmatism field (with the share of it a quadratic explains).
export function fieldMap(o) {
  const P = pupilFit(o.n || 20), sys = prepare(o.id, o.err), G = o.G, half = o.field, nc = o.nc || 0;
  const xmax = half * 1.5;
  const focus = o.curved ? focalSurface(o.id, xmax, P) : () => 0;
  const at = (hx, hy) => wavefrontAt(sys, [hx, hy], P, focus(hx * hx + hy * hy)) || { z: new Float64Array(J).fill(NaN), rms: NaN };
  const z = new Float64Array(G * G * J), rms = new Float64Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const f = at(...cellH(G, half, i, j)), k = j * G + i;
    z.set(f.z, k * J); rms[k] = f.rms;
  }
  const cx = new Float64Array(nc), cz = new Float64Array(nc * J), crms = new Float64Array(nc);
  for (let k = 0; k < nc; k++) {
    const hx = (1.5 * half * (k + 0.5)) / nc, f = at(hx, 0);
    cx[k] = hx; cz.set(f.z, k * J); crms[k] = f.rms;
  }
  return { G, half, z, rms, curve: { x: cx, z: cz, rms: crms }, zeros: astigZeros(G, half, z), rays: P.m };
}
