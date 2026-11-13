// Gravitational microlensing: a star (and its planet) passing in front of a background star.
// Angles are in units of the Einstein radius θ_E of the total lens mass; the centre of mass is at
// the origin and the two lenses lie on the x axis. Single lens: Paczyński's light curve and the exact
// finite-source integral. Binary lens: the image positions from Witt & Mao's fifth-degree polynomial,
// polished on the lens equation; caustics from the critical-curve quartic; finite sources from Gould's
// hexadecapole away from caustics and a direct average over the stellar disk near them.
import { makeRng } from './random.js';

export const KAPPA = 8.144;        // mas per solar mass: θ_E² = κ M π_rel
export const M_EARTH = 3.003e-6;   // Earth mass in solar masses
export const R_SUN_AU = 1 / 215.032;
export const CADENCE = 15 / 1440;  // Roman's Galactic Bulge Time Domain Survey: one W149 exposure about every 15 min
export const SEASON = 72;          // days per season (six seasons; Penny et al. 2019)
export const DCHI2 = 160;          // detection threshold used in Roman yield predictions (Penny et al. 2019)

// Einstein radius (mas), its size at the lens (AU), the Einstein time (days) and the source radius ρ.
export function einstein({ M, DL, DS, mu, Rstar = 1 }) {
  const prel = 1 / DL - 1 / DS, thetaE = Math.sqrt(KAPPA * M * prel), thetaS = (Rstar * R_SUN_AU) / DS;
  return { prel, thetaE, rE: thetaE * DL, tE: (thetaE / mu) * 365.25, thetaS, rho: thetaS / thetaE };
}

// ── Single lens ──
const GL16 = gaussLegendre(16), GL48 = gaussLegendre(48);
export const pacz = (u) => (u * u + 2) / (u * Math.sqrt(u * u + 4));

// Linear limb darkening I(x) = 1 − c(1 − √(1 − x²)); the magnification of a uniform disk of radius ρ
// at distance u from a point lens, by a 1-D integral over circles about the lens:
// A = (1/πρ²) ∫ 2φ(r) (r² + 2)/√(r² + 4) dr, φ(r) the half-angle of the circle of radius r inside the disk.

export function diskUniform(u, rho) {
  let s = 0;
  const lo = Math.abs(u - rho), hi = u + rho;
  if (u < rho) { const R = rho - u; s += Math.PI * R * Math.sqrt(R * R + 4); }
  // r = lo + (hi − lo)(1 − cos τ)/2 clusters points at both ends, where φ has square-root edges
  for (const [x, w] of GL48) {
    const tau = ((x + 1) * Math.PI) / 2, r = lo + ((hi - lo) * (1 - Math.cos(tau))) / 2, dr = ((hi - lo) * Math.sin(tau)) / 2 * (Math.PI / 2);
    if (r <= 0) continue;
    const c = Math.max(-1, Math.min(1, (r * r + u * u - rho * rho) / (2 * r * u || 1e-300)));
    s += w * dr * 2 * Math.acos(c) * (r * r + 2) / Math.sqrt(r * r + 4);
  }
  return s / (Math.PI * rho * rho);
}
// A limb-darkened disk as a sum of uniform disks: flux = I(1)G(1) + ∫ (−I′(y)) G(y) dy, G(y) = A_U(yρ) y².
export function diskSingle(u, rho, c = 0) {
  if (rho <= 0) return pacz(u);
  let num = (1 - c) * diskUniform(u, rho), den = 1 - c;
  if (c) for (const [x, w] of GL16) {
    const tau = ((x + 1) * Math.PI) / 4, y = Math.sin(tau), wt = w * (Math.PI / 4) * c * y; // −I′ dy = c sin τ dτ
    num += wt * diskUniform(u, y * rho) * y * y; den += wt * y * y;
  }
  return num / den;
}

// ── Binary lens ──
export function lenses(s, q) { const m1 = 1 / (1 + q), m2 = q / (1 + q); return { s, q, m1, m2, x1: -s * m2, x2: s * m1 }; }

// Roots of the complex polynomial Σ (cr[k] + i ci[k]) z^k (degree n) by the Aberth–Ehrlich method,
// starting from R (re, im interleaved) when warm, else from a circle; R is updated in place.
const AR = new Float64Array(8), AI = new Float64Array(8);
export function aberth(cr, ci, n, R, warm = false) {
  const lr = cr[n], li = ci[n], ld = lr * lr + li * li;
  const ar = AR, ai = AI;
  for (let k = 0; k <= n; k++) { ar[k] = (cr[k] * lr + ci[k] * li) / ld; ai[k] = (ci[k] * lr - cr[k] * li) / ld; }
  if (!warm) {
    let rad = 0;
    for (let k = 0; k < n; k++) rad = Math.max(rad, Math.pow(Math.hypot(ar[k], ai[k]), 1 / (n - k)));
    const c0 = -ar[n - 1] / n, c1 = -ai[n - 1] / n;
    for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n + 0.4; R[2 * k] = c0 + rad * Math.cos(a); R[2 * k + 1] = c1 + rad * Math.sin(a); }
  }
  let last = Infinity;
  for (let it = 0; it < 80; it++) {
    let moved = 0;
    for (let k = 0; k < n; k++) {
      const zr = R[2 * k], zi = R[2 * k + 1];
      let pr = 1, pi = 0, dr = 0, di = 0;
      for (let j = n - 1; j >= 0; j--) {
        const tr = dr * zr - di * zi + pr, ti = dr * zi + di * zr + pi; dr = tr; di = ti;
        const ur = pr * zr - pi * zi + ar[j], ui = pr * zi + pi * zr + ai[j]; pr = ur; pi = ui;
      }
      const dd = dr * dr + di * di;
      if (pr === 0 && pi === 0) continue;
      const qr = dd ? (pr * dr + pi * di) / dd : 1e-3, qi = dd ? (pi * dr - pr * di) / dd : 0; // p/p′
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) if (j !== k) {
        const er = zr - R[2 * j], ei = zi - R[2 * j + 1], e = er * er + ei * ei || 1e-300;
        sr += er / e; si -= ei / e;
      }
      const br = 1 - (qr * sr - qi * si), bi = -(qr * si + qi * sr), bd = br * br + bi * bi || 1e-300;
      const wr = (qr * br + qi * bi) / bd, wi = (qi * br - qr * bi) / bd;
      R[2 * k] = zr - wr; R[2 * k + 1] = zi - wi;
      moved = Math.max(moved, Math.hypot(wr, wi) / (1 + Math.hypot(zr, zi)));
    }
    // converged, or stalled at the precision the coefficients allow (the lens equation polishes after)
    if (moved < 1e-11 || (it > 6 && moved < 1e-7 && moved > 0.5 * last)) return it;
    last = moved;
  }
  return -1;
}

// Witt & Mao's quintic: with ζ the source, N = ζ̄(z − x1)(z − x2) + m1(z − x2) + m2(z − x1) and
// D = (z − x1)(z − x2), the images solve (z − ζ)(N − x1D)(N − x2D) − m1 D (N − x2D) − m2 D (N − x1D) = 0.
// All factors are quadratics in z (D real), so the coefficients are built in place without allocation.
const QR = new Float64Array(6), QI = new Float64Array(6), PR = new Float64Array(5), PI = new Float64Array(5);
function sq(ar, ai, br, bi, outR, outI) { // product of two complex quadratics → quartic
  for (let k = 0; k < 5; k++) { outR[k] = 0; outI[k] = 0; }
  for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { outR[j + k] += ar[j] * br[k] - ai[j] * bi[k]; outI[j + k] += ar[j] * bi[k] + ai[j] * br[k]; }
}
const E1r = new Float64Array(3), E1i = new Float64Array(3), E2r = new Float64Array(3), E2i = new Float64Array(3), Dr = new Float64Array(3), Z3 = new Float64Array(3);
const T1r = new Float64Array(5), T1i = new Float64Array(5), T2r = new Float64Array(5), T2i = new Float64Array(5);
export function quintic(L, zr, zi, outR = QR, outI = QI) {
  const { m1, m2, x1, x2 } = L, S = x1 + x2, P = x1 * x2;
  Dr[0] = P; Dr[1] = -S; Dr[2] = 1;
  // N = ζ̄D + m1(z − x2) + m2(z − x1)
  const n0r = zr * P - m1 * x2 - m2 * x1, n0i = -zi * P, n1r = -zr * S + m1 + m2, n1i = zi * S, n2r = zr, n2i = -zi;
  E1r[0] = n0r - x1 * P; E1i[0] = n0i; E1r[1] = n1r + x1 * S; E1i[1] = n1i; E1r[2] = n2r - x1; E1i[2] = n2i;
  E2r[0] = n0r - x2 * P; E2i[0] = n0i; E2r[1] = n1r + x2 * S; E2i[1] = n1i; E2r[2] = n2r - x2; E2i[2] = n2i;
  sq(E1r, E1i, E2r, E2i, PR, PI);          // E1·E2
  sq(Dr, Z3, E2r, E2i, T1r, T1i);          // D·E2
  sq(Dr, Z3, E1r, E1i, T2r, T2i);          // D·E1
  for (let k = 0; k < 6; k++) { outR[k] = 0; outI[k] = 0; }
  for (let k = 0; k < 5; k++) {
    // (z − ζ)·E1E2
    outR[k + 1] += PR[k]; outI[k + 1] += PI[k];
    outR[k] += -zr * PR[k] + zi * PI[k]; outI[k] += -zr * PI[k] - zi * PR[k];
    outR[k] -= m1 * T1r[k] + m2 * T2r[k]; outI[k] -= m1 * T1i[k] + m2 * T2i[k];
  }
  return [outR, outI];
}

// The lens equation's residual f = z − Σ m_i/(z̄ − x_i) − ζ and the Jacobian term κ = Σ m_i/(z̄ − x_i)²
// at z, written into F = [fr, fi, kr, ki].
const F = new Float64Array(4);
function lensAt(L, zr, zi, sr, si, out = F) {
  const d1r = zr - L.x1, d2r = zr - L.x2, n1 = d1r * d1r + zi * zi, n2 = d2r * d2r + zi * zi, a1 = L.m1 / n1, a2 = L.m2 / n2;
  out[0] = zr - a1 * d1r - a2 * d2r - sr; out[1] = zi - a1 * zi - a2 * zi - si;
  out[2] = (a1 * (d1r * d1r - zi * zi)) / n1 + (a2 * (d2r * d2r - zi * zi)) / n2;
  out[3] = (a1 * 2 * d1r * zi) / n1 + (a2 * 2 * d2r * zi) / n2;
  return out;
}

// The images of a point source at ζ = (sr, si): positions, signed magnifications and the total.
// R (10 numbers) keeps the polynomial roots between calls so neighbouring sources start warm.
// The quintic has five roots; outside the caustics two are not images. Every root is polished by
// Newton's method on the lens equation itself (the polynomial loses precision for small mass ratios),
// and kept if it then solves the lens equation and is not a copy of an image already found.
const PX = new Float64Array(5), PY = new Float64Array(5), PD = new Float64Array(5), PE = new Float64Array(5), G = new Float64Array(4);
export function images(L, sr, si, R = new Float64Array(10), warm = false, list = true) {
  const [cr, ci] = quintic(L, sr, si);
  if (aberth(cr, ci, 5, R, warm) < 0 && warm) aberth(cr, ci, 5, R, false);
  const scale = 1 + Math.hypot(sr, si);
  let m = 0;
  const tryRoot = (x, y, loose = false) => {
    lensAt(L, x, y, sr, si);
    // δ + κ δ̄ = −f  ⇒  δ = (−f + κ f̄)/(1 − |κ|²)
    for (let it = 0; it < 30 && Math.hypot(F[0], F[1]) > 1e-14 * scale; it++) {
      const det = 1 - (F[2] * F[2] + F[3] * F[3]);
      if (Math.abs(det) < 1e-14) break;
      const dr = (-F[0] + F[2] * F[0] + F[3] * F[1]) / det, di = (-F[1] + F[3] * F[0] - F[2] * F[1]) / det;
      lensAt(L, x + dr, y + di, sr, si, G);
      if (!(Math.hypot(G[0], G[1]) < Math.hypot(F[0], F[1]))) break;
      x += dr; y += di; F.set(G);
    }
    const res = Math.hypot(F[0], F[1]);
    // next to a lens the lens equation itself is only good to about ε|z||κ| (κ ≈ m/δ² there)
    if (!(res < 1e-9 * scale + (loose ? 1e-13 * (1 + Math.hypot(x, y)) * Math.hypot(F[2], F[3]) : 0))) return;
    for (let j = 0; j < m; j++) if (Math.hypot(PX[j] - x, PY[j] - y) < 1e-7 * (1 + Math.hypot(x, y))) { if (res < PE[j]) { PX[j] = x; PY[j] = y; PE[j] = res; PD[j] = 1 - (F[2] * F[2] + F[3] * F[3]); } return; }
    if (m < 5) { PX[m] = x; PY[m] = y; PE[m] = res; PD[m] = 1 - (F[2] * F[2] + F[3] * F[3]); m++; }
  };
  for (let k = 0; k < 5; k++) tryRoot(R[2 * k], R[2 * k + 1]);
  // a binary lens has three or five images; for a tiny mass far from the source the polynomial can lose
  // the faint image right next to that lens, so find it by the fixed point z = x_i + m_i/w̄,
  // w = z − ζ − m_j/(z̄ − x_j), which contracts fast there
  if (m % 2 === 0) for (const [xi, mi, xj, mj] of [[L.x2, L.m2, L.x1, L.m1], [L.x1, L.m1, L.x2, L.m2]]) {
    let x = xi, y = 0;
    for (let it = 0; it < 6; it++) {
      const dx = x - xj, n = dx * dx + y * y, wr = x - sr - (mj * dx) / n, wi = y - si - (mj * y) / n, d = wr * wr + wi * wi;
      x = xi + (mi * wr) / d; y = (mi * wi) / d;
    }
    tryRoot(x, y, true);
    if (m % 2) break;
  }
  const out = list ? [] : null;
  let A = 0;
  for (let k = 0; k < m; k++) { A += 1 / Math.abs(PD[k]); if (list) out.push({ x: PX[k], y: PY[k], mu: 1 / PD[k] }); }
  return { n: m, A, list: out };
}
export const magPoint = (L, sr, si, R, warm) => images(L, sr, si, R, warm, false).A;

// Critical curves and caustics: points z with |Σ m_i/(z̄ − x_i)²| = 1. With w = z̄ and the phase φ,
// m1(w − x2)² + m2(w − x1)² = e^{iφ}(w − x1)²(w − x2)², a quartic tracked over φ.
// Returns the four tracks (critical and caustic points per φ) and the number of closed curves.
export function caustics(L, n = 720) {
  const { m1, m2, x1, x2 } = L, S = x1 + x2, P = x1 * x2;
  const Q = [P * P, -2 * S * P, S * S + 2 * P, -2 * S, 1]; // (w − x1)²(w − x2)²
  const R = new Float64Array(8), crit = [[], [], [], []], caus = [[], [], [], []], cr = new Float64Array(5), ci = new Float64Array(5);
  let first = null;
  for (let j = 0; j <= n; j++) {
    const ph = (2 * Math.PI * j) / n, c = Math.cos(ph), s = Math.sin(ph);
    for (let k = 0; k < 5; k++) { cr[k] = -c * Q[k]; ci[k] = -s * Q[k]; }
    cr[0] += m1 * x2 * x2 + m2 * x1 * x1; cr[1] += -2 * (m1 * x2 + m2 * x1); cr[2] += m1 + m2;
    aberth(cr, ci, 4, R, j > 0);
    if (j === 0) first = Float64Array.from(R);
    if (j === n) break;
    for (let k = 0; k < 4; k++) {
      const zr = R[2 * k], zi = -R[2 * k + 1]; // z = conj(w)
      lensAt(L, zr, zi, 0, 0);
      crit[k].push([zr, zi]); caus[k].push([F[0], F[1]]);
    }
  }
  // after a full turn the roots come back permuted; each cycle of the permutation is one closed curve
  const perm = [0, 1, 2, 3].map((k) => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < 4; j++) { const d = Math.hypot(R[2 * k] - first[2 * j], R[2 * k + 1] - first[2 * j + 1]); if (d < bd) { bd = d; best = j; } }
    return best;
  });
  const seen = new Set();
  let curves = 0;
  for (let k = 0; k < 4; k++) if (!seen.has(k)) { curves++; for (let j = k; !seen.has(j); j = perm[j]) seen.add(j); }
  return { crit, caus, curves };
}
// Erdl & Schneider (1993): the close/intermediate and intermediate/wide separations for mass fractions m1, m2.
export function topology(q) {
  const { m1, m2 } = lenses(1, q);
  let lo = 0.1, hi = 1; // (1 − d⁴)³ = 27 m1 m2 d⁸ on 0 < d < 1
  for (let i = 0; i < 80; i++) { const d = (lo + hi) / 2, f = (1 - d ** 4) ** 3 - 27 * m1 * m2 * d ** 8; if (f > 0) lo = d; else hi = d; }
  return { close: (lo + hi) / 2, wide: (Math.cbrt(m1) + Math.cbrt(m2)) ** 1.5 };
}

// ── Finite sources ──
// Gould (2008): A ≈ A0 + (A2ρ²/2)(1 − Γ/5) + (A4ρ⁴/3)(1 − 11Γ/35) from 13 point magnifications, with
// A2ρ², A4ρ⁴ the ring-average coefficients; Γ = 2c/(3 − c) converts the linear limb-darkening law.
export function hexadecapole(L, sr, si, rho, c, R) {
  const A0 = magPoint(L, sr, si, R, true), G = (2 * c) / (3 - c);
  const ring = (r, off) => { let s = 0, n = []; for (let j = 0; j < 4; j++) { const a = off + (j * Math.PI) / 2, im = images(L, sr + r * Math.cos(a), si + r * Math.sin(a), R, true); s += im.A; n.push(im.n); } return { A: s / 4 - A0, n }; };
  const p = ring(rho, 0), h = ring(rho / 2, 0), x = ring(rho, Math.PI / 4);
  const A2 = (16 * h.A - p.A) / 3, A4 = (p.A + x.A) / 2 - A2;
  const counts = new Set([...p.n, ...h.n, ...x.n]);
  return { A: A0 + (A2 / 2) * (1 - G / 5) + (A4 / 3) * (1 - (11 * G) / 35), A0, A2, A4, mixed: counts.size > 1 };
}
// The area of the images of a uniform disk of radius r, by Green's theorem (Gould & Gaucherel 1997):
// the images of N points on the disk's edge are linked to images of the same parity at
// the next point (closest pairs first), and parity × ½(x dy − y dx) is summed along these tracks.
// Images created or destroyed at a critical curve come in pairs of opposite parity, joined by a closing
// segment. N doubles until the magnification changes by less than tol.
const cross = (p, q) => 0.5 * (p.x * q.y - q.x * p.y);
function close(set, used, sign) { // pair left-over images of opposite parity, nearest first
  const pos = set.filter((p, k) => !(used >> k & 1) && p.mu > 0), neg = set.filter((p, k) => !(used >> k & 1) && p.mu < 0);
  let s = 0;
  for (const p of pos) {
    let best = -1, bd = Infinity;
    neg.forEach((n, k) => { if (n && Math.hypot(n.x - p.x, n.y - p.y) < bd) { bd = Math.hypot(n.x - p.x, n.y - p.y); best = k; } });
    if (best < 0) continue;
    s += sign > 0 ? cross(p, neg[best]) : cross(neg[best], p);
    neg[best] = null;
  }
  return s;
}
export function diskUniformBinary(L, sr, si, r, R, tol = 1e-3) {
  let prev = NaN, A = NaN, pts = null;
  for (let N = 32; N <= 2048; N *= 2) {
    // reuse the previous level's points (every other point at this level)
    const next = new Array(N + 1);
    for (let j = 0; j < N; j++) {
      if (pts && j % 2 === 0) { next[j] = pts[j / 2]; continue; }
      const a = (2 * Math.PI * j) / N;
      next[j] = images(L, sr + r * Math.cos(a), si + r * Math.sin(a), R, true).list;
    }
    next[N] = next[0]; pts = next;
    let area = 0;
    for (let j = 0; j < N; j++) {
      const P = pts[j], Q = pts[j + 1], np = P.length, nq = Q.length;
      // closest same-parity pairs first (at most 5 × 5 candidates, so a simple repeated scan)
      let uP = 0, uQ = 0;
      for (let m = Math.min(np, nq); m > 0; m--) {
        let bd = Infinity, bi = -1, bk = -1;
        for (let i = 0; i < np; i++) if (!(uP >> i & 1)) for (let k = 0; k < nq; k++) if (!(uQ >> k & 1) && (P[i].mu > 0) === (Q[k].mu > 0)) {
          const d = (P[i].x - Q[k].x) ** 2 + (P[i].y - Q[k].y) ** 2;
          if (d < bd) { bd = d; bi = i; bk = k; }
        }
        if (bi < 0) break;
        uP |= 1 << bi; uQ |= 1 << bk;
        area += Math.sign(P[bi].mu) * cross(P[bi], Q[bk]);
      }
      if (np > nq) area += close(P, uP, 1);
      if (nq > np) area += close(Q, uQ, -1);
    }
    A = area / (Math.PI * r * r);
    if (Math.abs(A - prev) < tol * A) return A;
    prev = A;
  }
  return A;
}
// A limb-darkened disk as uniform disks: flux = I(1)G(1) + ∫ (−I′(y)) G(y) dy, G(y) = A_U(yρ) y², with
// −I′ dy = c sin τ dτ for y = sin τ (5-point Gauss).
const GL5 = gaussLegendre(5);
export function diskBinary(L, sr, si, rho, c, R) {
  let num = (1 - c) * diskUniformBinary(L, sr, si, rho, R), den = 1 - c;
  if (c) for (const [x, w] of GL5) {
    const tau = ((x + 1) * Math.PI) / 4, y = Math.sin(tau), wt = w * (Math.PI / 4) * c * y;
    num += wt * diskUniformBinary(L, sr, si, y * rho, R) * y * y; den += wt * y * y;
  }
  return num / den;
}
// The finite-source magnification: the hexadecapole unless a caustic is near (the 13 points see
// different numbers of images, or the series' fourth-order term is not small), then the contours.
export function magFinite(L, sr, si, rho, c, R) {
  if (rho <= 0) return magPoint(L, sr, si, R, true);
  const hx = hexadecapole(L, sr, si, rho, c, R);
  if (!hx.mixed && Math.abs(hx.A4) < 3e-4 * hx.A0) return hx.A;
  return diskBinary(L, sr, si, rho, c, R);
}

// ── Light curves ──
// The source moves on a straight line at angle α (rad) to the lens axis, passing the centre of mass at
// u0 at τ = 0 (τ in Einstein times).
export const path = (tau, u0, alpha) => [tau * Math.cos(alpha) - u0 * Math.sin(alpha), tau * Math.sin(alpha) + u0 * Math.cos(alpha)];

// Times sampled densely (spacing ρ/2) wherever the path comes near a caustic, coarsely elsewhere.
// The work is split into plan → evaluate (in parallel, any subset of times) → refine (midpoints where
// the magnification still changes by more than 1 %), repeated a few times.
export function plan(p) {
  const { s, q, u0, alpha, rho, T } = p;
  const L = lenses(s, q), C = caustics(L, 720), ca = Math.cos(alpha), sa = Math.sin(alpha);
  const near = 6 * rho + 2 * Math.sqrt(q), fine = Math.max(rho / 2, 2e-5), taus = new Set();
  for (let i = 0; i <= 600; i++) taus.add(-T + (2 * T * i) / 600);
  const wins = [];
  for (const tr of C.caus) for (const [x, y] of tr) {
    const tau = x * ca + y * sa, d = Math.abs(-x * sa + y * ca - u0);
    if (d < near && Math.abs(tau) < T + near) wins.push([tau - near, tau + near]);
  }
  wins.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const w of wins) { const m = merged[merged.length - 1]; if (m && w[0] <= m[1]) m[1] = Math.max(m[1], w[1]); else merged.push([...w]); }
  let budget = 2000;
  for (const [a, b] of merged) {
    const lo = Math.max(-T, a), hi = Math.min(T, b), n = Math.min(budget, Math.ceil((hi - lo) / fine));
    for (let i = 0; i <= n && hi > lo; i++) taus.add(lo + ((hi - lo) * i) / Math.max(1, n));
    budget -= n;
    if (budget <= 0) break;
  }
  return { tau: [...taus].sort((a, b) => a - b), caustics: C, fine };
}
// Finite-source, point-source and single-lens magnifications at the given times (p.quick: the
// hexadecapole everywhere, a fast first look that is wrong only where the disk touches a caustic).
export function evaluate(p, taus) {
  const { s, q, u0, alpha, rho, ld = 0 } = p, L = lenses(s, q), R = new Float64Array(10), n = taus.length;
  const A = new Float64Array(n), point = new Float64Array(n), single = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = path(taus[i], u0, alpha);
    A[i] = p.quick ? hexadecapole(L, x, y, rho, ld, R).A : magFinite(L, x, y, rho, ld, R); point[i] = magPoint(L, x, y, R, true);
    single[i] = diskSingle(Math.hypot(x - L.x1, y), rho, ld);
  }
  return { A, point, single };
}
export function refine(tau, A, fine, max = 4000) {
  const out = [];
  for (let i = 0; i + 1 < tau.length && tau.length + out.length < max; i++)
    if (tau[i + 1] - tau[i] > fine / 4 && Math.abs(A[i + 1] - A[i]) > 0.01 * Math.min(A[i], A[i + 1])) out.push((tau[i] + tau[i + 1]) / 2);
  return out;
}
// Merge newly evaluated times into a curve (all arrays sorted by τ).
export function merge(curve, taus, ev) {
  const rows = [];
  for (let i = 0; i < curve.tau.length; i++) rows.push([curve.tau[i], curve.A[i], curve.point[i], curve.single[i]]);
  for (let i = 0; i < taus.length; i++) rows.push([taus[i], ev.A[i], ev.point[i], ev.single[i]]);
  rows.sort((a, b) => a[0] - b[0]);
  return { tau: Float64Array.from(rows, (r) => r[0]), A: Float64Array.from(rows, (r) => r[1]), point: Float64Array.from(rows, (r) => r[2]), single: Float64Array.from(rows, (r) => r[3]) };
}
// The whole light curve in one thread (tests, and the fallback without workers).
export function lightCurve(p) {
  const P = plan(p);
  let curve = { tau: [], A: [], point: [], single: [] }, taus = P.tau;
  for (let pass = 0; pass < 6 && taus.length; pass++) { curve = merge(curve, taus, evaluate(p, taus)); taus = refine(curve.tau, curve.A, P.fine); }
  return { ...curve, caustics: P.caustics };
}
// Linear interpolation in a sorted table.
export function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}
// Simulated survey photometry: one point per CADENCE over [−W, W] days, photon noise scaled from σ0 at
// baseline (σ_A = σ0 √A, no blending), and Δχ² between the planetary and the single-lens model.
export function survey(curve, tE, W, sigma0, seed = 7) {
  const rng = makeRng(seed), t = [], obs = [], sig = [];
  let dchi2 = 0;
  for (let d = -W; d <= W; d += CADENCE) {
    const tau = d / tE, A = interp(curve.tau, curve.A, tau), A1 = interp(curve.tau, curve.single, tau), sd = sigma0 * Math.sqrt(A);
    t.push(d); obs.push(A + sd * rng.g()); sig.push(sd);
    dchi2 += ((A - A1) / sd) ** 2;
  }
  return { t: Float64Array.from(t), obs: Float64Array.from(obs), sig: Float64Array.from(sig), dchi2 };
}
// The point-source magnification over a window of the source plane (for the caustic map).
export function magMap(L, x0, y0, w, h, nx, ny) {
  const out = new Float32Array(nx * ny), R = new Float64Array(10);
  let warm = false;
  for (let j = 0; j < ny; j++) for (let k = 0; k < nx; k++) {
    const i = j % 2 ? nx - 1 - k : k; // serpentine, so each pixel starts from its neighbour's roots
    out[j * nx + i] = magPoint(L, x0 + ((i + 0.5) / nx) * w, y0 + ((j + 0.5) / ny) * h, R, warm); warm = true;
  }
  return out;
}

function gaussLegendre(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp; x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    out.push([x, 2 / ((1 - x * x) * dp * dp)]);
  }
  return out;
}
