// Field-dependent PSFs of a two-mirror telescope. Third-order (Seidel) sums are traced through
// the mirrors with Welford's surface formulas (a mirror is a refraction into n' = −n), and the
// wavefront at field point H follows Hopkins' expansion. A misaligned secondary displaces the
// aberration field of each surface (Thompson's nodal aberration theory, NAT):
//   W(H, ρ) = Σ_j W₀₄₀ⱼ(ρ·ρ)² + W₁₃₁ⱼ[(H−σⱼ)·ρ](ρ·ρ) + W₂₂₂ⱼ[(H−σⱼ)·ρ]² + W₂₂₀ⱼ(H−σⱼ)²(ρ·ρ)
// with σⱼ = n c δ_CoC / Ā for the spherical part of a surface and δ_vertex/ȳ for its conic part.
// Tilt (distortion, pointing) is dropped: every PSF is centred. Lengths in metres, angles in
// radians; H is the field angle vector in units of the reference angle θ_ref.
import { rasterAperture, psf } from './pupil.js';

export const THREF = (0.1 * Math.PI) / 180; // reference field angle for the Seidel sums (0.1°)

// Prescription of a Cassegrain-type telescope from first-order data: aperture D, system and
// primary focal ratios N and N1, back focal distance b behind the primary vertex.
export function twoMirror({ D, N, N1, b }) {
  const f1 = N1 * D, m = N / N1, beta = b / f1, k = (1 + beta) / (1 + m), d = f1 * (1 - k);
  return { D, N, N1, b, f1, m, k, beta, d, R1: -2 * f1, R2: (-2 * k * m * f1) / (m - 1) };
}

// Conic constants: Cassegrain (parabolic primary, S_I = 0), Ritchey–Chrétien (S_I = S_II = 0,
// Schroeder, Astronomical Optics, §6.2) and Dall–Kirkham (spherical secondary, S_I = 0; solved
// from the Seidel sums, which are linear in K₁).
export function conics(t, form) {
  const { m, beta } = t, K2cass = -(((m + 1) / (m - 1)) ** 2);
  if (form === 'cassegrain') return { K1: -1, K2: K2cass };
  if (form === 'rc') return { K1: -1 - (2 * (1 + beta)) / (m * m * (m - beta)), K2: K2cass - (2 * m * (m + 1)) / ((m - beta) * (m - 1) ** 3) };
  if (form === 'dk') {
    const SI = (K1) => sum(seidelTwoMirror(t, K1, 0), 'SI'), s0 = SI(0), s1 = SI(-1);
    return { K1: s0 / (s0 - s1) * -1, K2: 0 };
  }
  throw new Error('unknown form ' + form);
}
export const sum = (sd, key) => sd.parts.reduce((acc, p) => acc + p.sph[key] + p.asph[key], 0);

// Seidel sums per surface (spherical and conic parts kept apart for NAT), for a telescope with
// conics K1, K2, a secondary despace dz (m, + moves it towards the primary), the detector fixed
// at the nominal focus. Stop at the primary. Returns per-surface parts and image-space data.
export function seidelTwoMirror(t, K1, K2, dz = 0) {
  const surf = [{ R: t.R1, K: K1, tAfter: -(t.d - dz) }, { R: t.R2, K: K2, tAfter: t.d - dz + t.b }];
  let n = 1, y = t.D / 2, u = 0, yb = 0, ub = Math.tan(THREF);
  const Hl = n * (ub * y - u * yb), parts = [];
  for (const s of surf) {
    const c = 1 / s.R, n2 = -n, A = n * (u + y * c), Ab = n * (ub + yb * c);
    const u2 = (n * u - y * (n2 - n) * c) / n2, ub2 = (n * ub - yb * (n2 - n) * c) / n2, dUn = u2 / n2 - u / n;
    const sph = { SI: -A * A * y * dUn, SII: -A * Ab * y * dUn, SIII: -Ab * Ab * y * dUn, SIV: -Hl * Hl * c * (1 / n2 - 1 / n) };
    const dSI = s.K * c * c * c * (n2 - n) * y ** 4, q = yb / y;
    const asph = { SI: dSI, SII: dSI * q, SIII: dSI * q * q, SIV: 0 };
    parts.push({ sph, asph, c, n, A, Ab, y, yb });
    y += s.tAfter * u2; yb += s.tAfter * ub2; u = u2; ub = ub2; n = n2;
  }
  // y is now the marginal height at the fixed detector: defocus W₀₂₀ = −y·u/2 (sign: wavefront
  // ahead of the reference sphere when the focus falls short of the detector)
  return { parts, W020: (-y * u) / 2, uImage: u, H: Hl };
}
const W = (S) => ({ W040: S.SI / 8, W131: S.SII / 2, W222: S.SIII / 2, W220: S.SIV / 4 });

// Wavefront polynomial at field H = [hx, hy] (units of θ_ref): W = a(ρ·ρ)² + (b·ρ)(ρ·ρ) + ρᵀMρ,
// in metres of OPD. mis = { dx, dy (secondary decentre, m), tx, ty (secondary tilt about its
// vertex, rad) }. curved: the detector follows the medial focal surface of the aligned design,
// which removes the defocus (W₂₂₀ + W₂₂₂/2)H² (a flat detector at the paraxial focus keeps it).
export function fieldPoly(sd, H, mis = {}, curved = false) {
  const med = curved ? -(sum(sd, 'SIV') / 4 + sum(sd, 'SIII') / 4) * (H[0] * H[0] + H[1] * H[1]) : 0;
  let a = 0, bx = 0, by = 0, mxx = sd.W020 + med, myy = sd.W020 + med, mxy = 0;
  sd.parts.forEach((p, j) => {
    // displacement of the vertex and of the centre of curvature (secondary only)
    const dv = j === 1 ? [mis.dx || 0, mis.dy || 0] : [0, 0], R = 1 / p.c;
    const dc = j === 1 ? [dv[0] + R * (mis.ty || 0), dv[1] - R * (mis.tx || 0)] : [0, 0];
    // field displacement in units of θ_ref (the chief ray at θ_ref defines Ā and ȳ)
    const sig = [
      { w: W(p.sph), s: [(p.n * p.c * dc[0]) / p.Ab, (p.n * p.c * dc[1]) / p.Ab] },
      { w: W(p.asph), s: p.yb ? [dv[0] / p.yb, dv[1] / p.yb] : [0, 0] }, // the primary is the stop and is not moved
    ];
    for (const { w, s } of sig) {
      const hx = H[0] - s[0], hy = H[1] - s[1], w131 = w.W131, w222 = w.W222, w220 = w.W220;
      a += w.W040;
      bx += w131 * hx; by += w131 * hy;
      mxx += w222 * hx * hx + w220 * (hx * hx + hy * hy); myy += w222 * hy * hy + w220 * (hx * hx + hy * hy); mxy += w222 * hx * hy;
    }
  });
  return { a, b: [bx, by], M: [mxx, mxy, myy] };
}
export function evalPoly(P, x, y) {
  const r2 = x * x + y * y;
  return P.a * r2 * r2 + (P.b[0] * x + P.b[1] * y) * r2 + P.M[0] * x * x + 2 * P.M[1] * x * y + P.M[2] * y * y;
}

// RMS wavefront (m) over an annular pupil (obscuration eps), with piston and tilt removed and
// defocus kept (the detector is fixed), sampled on a polar grid.
export function rmsPoly(P, eps = 0, nr = 24, nt = 48) {
  let s = 0, s2 = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxw = 0, syw = 0, wsum = 0;
  for (let i = 0; i < nr; i++) {
    const r = Math.sqrt(eps * eps + ((i + 0.5) / nr) * (1 - eps * eps));
    for (let j = 0; j < nt; j++) {
      const th = (2 * Math.PI * (j + 0.5)) / nt, x = r * Math.cos(th), y = r * Math.sin(th), w = evalPoly(P, x, y);
      s += w; s2 += w * w; sx += x; sy += y; sxx += x * x; syy += y * y; sxw += x * w; syw += y * w; wsum++;
    }
  }
  // remove the least-squares tilt (x and y are orthogonal to 1 and to each other on this grid)
  const mean = s / wsum, tx = sxw / sxx, ty = syw / syy;
  return Math.sqrt(Math.max(0, s2 / wsum - mean * mean - tx * tx * (sxx / wsum) - ty * ty * (syy / wsum)));
}

// The two zeros of the astigmatism field (the "binodes" of NAT): astigmatism at H is the
// complex quadratic Σ W₂₂₂ⱼ (H − σⱼ)²; its roots in H.
export function astigNodes(sd, mis = {}) {
  // sample the complex astigmatism (M_xx − M_yy)/2 + i M_xy, a quadratic in H, at three points
  const f = (hx, hy) => { const P = fieldPoly(sd, [hx, hy], mis); return [(P.M[0] - P.M[2]) / 2, P.M[1]]; };
  const f0 = f(0, 0), f1 = f(1, 0), fm = f(-1, 0);
  // f(H) = A H² + B H + C with complex coefficients (H complex): from H = 0, ±1
  const C = f0, A = [(f1[0] + fm[0]) / 2 - C[0], (f1[1] + fm[1]) / 2 - C[1]], B = [(f1[0] - fm[0]) / 2, (f1[1] - fm[1]) / 2];
  const cm = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]], cd = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
  if (Math.hypot(...A) < 1e-30) return [];
  const disc = [cm(B, B)[0] - 4 * cm(A, C)[0], cm(B, B)[1] - 4 * cm(A, C)[1]], r = Math.hypot(...disc), sq = [Math.sqrt((r + disc[0]) / 2), Math.sign(disc[1] || 1) * Math.sqrt(Math.max(0, (r - disc[0]) / 2))];
  const den = [2 * A[0], 2 * A[1]];
  return [cd([-B[0] + sq[0], -B[1] + sq[1]], den), cd([-B[0] - sq[0], -B[1] - sq[1]], den)];
}

// PSFs on a grid of field points. o = { tel, K1, K2, dz, mis, field (rad, half-width), grid,
// lam (m), eps, spiders, n, Dpx, crop, curved }. Stamps are normalised to the unaberrated peak
// (values are Strehl). Where the wavefront changes by more than half a wave between pupil pixels
// the pupil is resampled twice as finely (same λ/D per image pixel), so the FFT does not alias.
export function fieldPSFs(o) {
  const sd = seidelTwoMirror(o.tel, o.K1, o.K2, o.dz), g = o.grid, lamUm = o.lam * 1e6, pts = [];
  const pupil = (n, Dpx) => {
    const amp = rasterAperture({ type: 'circle', obstruction: o.eps, spiders: o.spiders, spiderWidth: 0.012, rotation: 45 }, n, Dpx, 3);
    return { n, Dpx, amp, ref: psf(amp, null, n, 1).peak };
  };
  const levels = [pupil(o.n, o.Dpx)];
  const wave = (L, P) => {
    const { n, Dpx, amp } = L, Wm = new Float64Array(n * n), c = n / 2;
    for (let q = 0; q < n; q++) for (let p = 0; p < n; p++) {
      const k = q * n + p;
      if (amp[k]) Wm[k] = evalPoly(P, (p - c) / (Dpx / 2), -(q - c) / (Dpx / 2)) * 1e6; // µm
    }
    // phase sampling: the steepest wavefront step between pupil pixels, in waves
    let grad = 0;
    for (let k = n + 1; k < n * n; k++) if (amp[k] && amp[k - 1] && amp[k - n]) grad = Math.max(grad, Math.abs(Wm[k] - Wm[k - 1]), Math.abs(Wm[k] - Wm[k - n]));
    return { Wm, grad: grad / lamUm };
  };
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    const hx = g > 1 ? ((-1 + (2 * i) / (g - 1)) * o.field) / THREF : 0, hy = g > 1 ? ((1 - (2 * j) / (g - 1)) * o.field) / THREF : 0;
    const P = fieldPoly(sd, [hx, hy], o.mis, o.curved);
    let L = levels[0], w = wave(L, P);
    if (w.grad > 0.5) { levels[1] = levels[1] || pupil(2 * o.n, 2 * o.Dpx); L = levels[1]; w = wave(L, P); }
    const n = L.n, r = psf(L.amp, w.Wm, n, lamUm), C = o.crop || o.n, I = new Float32Array(C * C), off = (n - C) / 2;
    for (let q = 0; q < C; q++) for (let p = 0; p < C; p++) I[q * C + p] = r.I[(q + off) * n + p + off] / L.ref;
    pts.push({ hx, hy, I, C, strehl: r.peak / L.ref, rms: rmsPoly(P, o.eps), grad: w.grad });
  }
  return { pts, sd };
}
