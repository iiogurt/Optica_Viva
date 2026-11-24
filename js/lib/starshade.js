import { fft2d } from './fft.js';
import { uniform } from './random.js';
import { simplex } from './lp.js';
import { besselJ1 } from './pupil.js';

// Starshades: Fresnel diffraction behind a circularly symmetric occulter that blocks a fraction
// A(r) ∈ [0, 1] of each circle of radius r (a petalled shade with petal width A(r)·2πr/N, in
// the azimuthally averaged approximation). In the scalar Fresnel approximation the field at
// distance z and radius ρ, relative to the unobstructed plane wave, is
//   E(ρ) = 1 + i (2π/λz) e^{ikρ²} ∫₀^R A(r) e^{ikr²} J₀(2krρ) r dr,   k = π/(λz).
// This azimuthal average is exact on the axis for any number of petals; off the axis the petals
// add terms in J_N, J_2N, … (petalSeriesField), and the real binary outline, with shape errors, is
// computed exactly by petalField below. Lengths in metres.

// Bessel J₀ to about 10⁻¹³: the power series up to |x| = 12 (its largest term is 4 × 10³, so
// cancellation costs four digits), Hankel's asymptotic expansion beyond, summed to its smallest
// term (about e^{−2x}). The shadow needs the field to 10⁻¹⁰ or better, so the classic polynomial
// fits (Abramowitz & Stegun 9.4.1/9.4.3, 5 × 10⁻⁸) are not enough.
// series coefficients (−1/4)^m/(m!)², summed by Horner's rule from the last term that matters
const JA = Array.from({ length: 61 }, (_, m) => (m ? -((2 * m - 1) ** 2) / (8 * m) : 0));
const J0C = (() => { const c = [1]; for (let m = 1; m <= 44; m++) c.push(c[m - 1] * (-0.25 / (m * m))); return c; })();
export function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax <= 12) {
    const y = ax * ax;
    let M = ax < 1 ? 10 : ax < 3 ? 16 : ax < 6 ? 24 : ax < 9 ? 32 : 40, sum = J0C[M];
    while (M > 0) sum = sum * y + J0C[--M];
    return sum;
  }
  // t_m = Π −(2l−1)²/(8l x) goes alternately into Q (odd m) and P (even m), with signs +, +, −, −, …
  const ix = 1 / ax;
  let t = 1, P = 1, Q = 0, prev = Infinity;
  for (let m = 1; m < 60; m++) {
    const nt = t * JA[m] * ix, at = Math.abs(nt);
    if (at >= prev || at < 1e-16) break;
    prev = at; t = nt;
    if (m & 1) Q += (m & 2 ? -t : t); else P -= (m & 2 ? t : -t);
  }
  const chi = ax - Math.PI / 4;
  return Math.sqrt(2 / (Math.PI * ax)) * (P * Math.cos(chi) - Q * Math.sin(chi));
}

// Occulter profiles: A(r) and the radius beyond which A < 10⁻⁸.
// disk: opaque disk of radius R. hyper: Cash's hypergaussian, opaque to a, then exp(−((r−a)/b)ⁿ).
export const OCCULTERS = {
  disk: { A: (r, o) => (r <= o.R ? 1 : 0), Rmax: (o) => o.R },
  hyper: { A: (r, o) => (r <= o.a ? 1 : Math.exp(-(((r - o.a) / o.b) ** o.n))), Rmax: (o) => o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n) },
  // a tabulated profile: A at nodes r0 + i·dr (i = 0 … A.length − 1, the last at R), linear between
  table: { A: (r, o) => tableA(r, o), Rmax: (o) => o.R },
};
function tableA(r, o) {
  if (r <= o.r0) return 1;
  const t = (r - o.r0) / o.dr, i = Math.floor(t), A = o.A;
  if (i >= A.length - 1) return r <= o.R ? A[A.length - 1] : 0;
  return A[i] + (A[i + 1] - A[i]) * (t - i);
}

// Complex fields [re, im] at radii ρs. The integral is taken in u = r², where the Fresnel phase
// e^{iku} is linear; each step integrates it exactly (Filon midpoint rule), so an opaque disk
// is exact and only A·J₀ is sampled. Off axis J₀ shifts the local frequency, which leaves an
// O(Δu²) error; one Richardson step (N and 2N) removes it.
export function shadowField(kind, o, lam, z, rhos, steps = 2000) {
  const a = filonField(kind, o, lam, z, rhos, steps), b = filonField(kind, o, lam, z, rhos, 2 * steps);
  return b.map(([x, y], i) => [(4 * x - a[i][0]) / 3, (4 * y - a[i][1]) / 3]);
}
function filonField(kind, o, lam, z, rhos, steps) {
  const occ = OCCULTERS[kind], Rm = occ.Rmax(o), U = Rm * Rm, du = U / steps, k = Math.PI / (lam * z);
  const wgt = Math.abs(k * du) < 1e-9 ? du : (2 * Math.sin((k * du) / 2)) / k, c = (2 * Math.PI) / (lam * z) / 2; // r dr = du/2
  const As = new Float64Array(steps), rs = new Float64Array(steps), cs = new Float64Array(steps), sn = new Float64Array(steps);
  for (let i = 0; i < steps; i++) { const u = (i + 0.5) * du; rs[i] = Math.sqrt(u); As[i] = occ.A(rs[i], o); cs[i] = Math.cos(k * u); sn[i] = Math.sin(k * u); }
  const out = [];
  for (const rho of rhos) {
    let re = 0, im = 0;
    const q = 2 * k * rho;
    for (let i = 0; i < steps; i++) {
      const a = As[i];
      if (a < 1e-12) continue;
      const g = a * (rho ? besselJ0(q * rs[i]) : 1);
      re += g * cs[i]; im += g * sn[i];
    }
    re *= wgt * c; im *= wgt * c;
    // E = 1 + i e^{ip}(re + i im)
    const p = k * rho * rho, er = Math.cos(p), ei = Math.sin(p), xr = er * re - ei * im, xi = er * im + ei * re;
    out.push([1 - xi, xr]);
  }
  return out;
}
export const intensity = (f) => f.map(([a, b]) => a * a + b * b);
export const fresnelNumber = (R, lam, z) => (R * R) / (lam * z);
// Geometric inner working angle (rad): the shade's tip radius seen from the telescope.
export const iwa = (Rtip, z) => Rtip / z;
// Axial intensity behind an opaque disk is exactly 1 (Poisson–Arago spot); behind a circular hole
// it is 4 sin²(πF/2).
export const holeAxial = (F) => 4 * Math.sin((Math.PI * F) / 2) ** 2;

// Mean suppression over a telescope aperture of diameter D (area-weighted shadow intensity),
// and the radial profile, for each wavelength. o = { kind, ...shape, z, D, lams (m), rhoMax, nr }.
export function shadowLab(o) {
  const nr = o.nr || 96, rhos = Array.from({ length: nr }, (_, i) => (i / (nr - 1)) * o.rhoMax);
  const prof = o.lams.map((l) => intensity(shadowField(o.kind, o, l, o.z, rhos, o.steps)));
  const na = 8, ar = Array.from({ length: na }, (_, i) => ((i + 0.5) / na) * (o.D / 2));
  const supp = o.lams.map((l) => { const I = intensity(shadowField(o.kind, o, l, o.z, ar, o.steps)); return I.reduce((s, v, i) => s + v * ar[i], 0) / ar.reduce((s, r) => s + r, 0); });
  return { rhos, prof, supp };
}

// ---------------------------------------------------------------------------------------------
// Real petals: the exact Fresnel field behind the binary outline, in two dimensions.
// In the Fresnel approximation the integral over the opaque region Ω collapses onto its edge:
// with s = x − p the vector from the field point p to a point x of the edge and α its direction,
// div[(e^{iks²} − 1)/(2ik s²) · s] = e^{iks²}, so
//   E(p) = 1 + (i/λz) ∬_Ω e^{iks²} dA = 1 + (1/2π) ∮_{∂Ω} (e^{iks²} − 1) dα,   dα = (s × dl)/s²,
// k = π/λz, each piece of Ω traversed anticlockwise. The integrand stays finite on the edge, so no
// inside/outside test is needed. Ω is the hub (r ≤ a) plus N petals; petal j covers, at radius r,
// the angles c_j ± ψ_j(r), ψ = πA(r)/N, which meet their neighbours at the hub. Errors:
//   shift  one petal slid rigidly outwards along its axis by d: its edges also turn by −d sin ψ/r,
//          so along the valleys, where it touched its neighbours, thin slits open (its base stays
//          sealed to the hub, as on a real shade whose petals overlap the hub's edge),
//   clock  one petal turned about the centre so that its tip moves sideways by d,
//   width  every edge moved outwards along its normal by d (negative: thinner petals).
// They are applied to first order in d (the outline is then right to under 0.1 µm for millimetre errors).
// Where a petal would overlap its neighbour the two edges are clipped to their mid-line, so Ω
// is their union and nothing is counted twice.

// Gauss–Legendre nodes and weights on [−1, 1] (Newton on P_n).
const GL = new Map();
export function gaussLegendre(n) {
  if (GL.has(n)) return GL.get(n);
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let t = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), d = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = t;
      for (let m = 2; m <= n; m++) { const p2 = ((2 * m - 1) * t * p1 - (m - 1) * p0) / m; p0 = p1; p1 = p2; }
      d = (n * (t * p1 - p0)) / (t * t - 1);
      const dt = p1 / d; t -= dt;
      if (Math.abs(dt) < 1e-15) break;
    }
    x[i] = t; w[i] = 2 / ((1 - t * t) * d * d);
  }
  const r = { x, w }; GL.set(n, r); return r;
}

// The petal profile of a shade o: the hypergaussian { a, b, n } or a tabulated profile
// { kind: 'table', R, r0, dr, A } (linear between its nodes, so its edges have kinks there: the
// outline puts panel boundaries at the nodes). A and its first two derivatives in r; where the
// petals start (base) and end (tip).
const isTable = (o) => o.kind === 'table';
const baseR = (o) => (isTable(o) ? o.r0 : o.a);
const tipR = (o) => (isTable(o) ? o.R : o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n));
const hyperA = (r, o) => (isTable(o) ? tableA(r, o) : r <= o.a ? 1 : Math.exp(-(((r - o.a) / o.b) ** o.n)));
function hyperA012(r, o) {
  if (isTable(o)) {
    if (r <= o.r0) return [1, 0, 0];
    if (r >= o.R) return [r > o.R ? 0 : o.A[o.A.length - 1], 0, 0];
    const t = (r - o.r0) / o.dr, i = Math.min(o.A.length - 2, Math.floor(t)), s = (o.A[i + 1] - o.A[i]) / o.dr;
    return [o.A[i] + s * (r - o.r0 - i * o.dr), s, 0];
  }
  if (r <= o.a) return [1, 0, 0];
  const t = (r - o.a) / o.b, n = o.n, A = Math.exp(-(t ** n)), A1 = (-A * n * t ** (n - 1)) / o.b;
  return [A, A1, (-n / o.b) * (A1 * t ** (n - 1) + (A * (n - 1) * t ** (n - 2)) / o.b)];
}

// Random ripple along every edge, the error that starshade error budgets describe by its spatial
// spectrum. Each of the 2N edges is moved along its normal by its own
//   δ(r) = σ Σₘ cₘ sin(2πr/ℓₘ + φₘ),
// with M periods ℓₘ spaced evenly in log between lmin and lmax, amplitudes from a power-law
// spectrum S(f) ∝ f^−β (so cₘ² ∝ f^(1−β) on the log-spaced frequencies), scaled to RMS σ, and
// phases from the seeded generator. err = { kind: 'random', d: σ (m), seed, lmin, lmax, beta, M }.
export const RIPPLE = { lmin: 0.25, lmax: 8, beta: 2, M: 24 };
// The periods ℓₘ (m) and amplitudes cₘ (Σ cₘ²/2 = 1) of the ripple's spectrum.
export function rippleSpectrum(err = {}) {
  const { lmin, lmax, beta, M } = { ...RIPPLE, ...err }, periods = new Float64Array(M), c = new Float64Array(M);
  let p = 0;
  for (let m = 0; m < M; m++) {
    periods[m] = lmin * (lmax / lmin) ** (M > 1 ? m / (M - 1) : 0);
    c[m] = (1 / periods[m]) ** ((1 - beta) / 2); p += (c[m] * c[m]) / 2;
  }
  for (let m = 0; m < M; m++) c[m] /= Math.sqrt(p);
  return { periods, c };
}
const ripples = new WeakMap();
function rippleTable(err, N) {
  let T = ripples.get(err);
  if (T && T.N === N) return T;
  const { periods, c } = rippleSpectrum(err), M = periods.length, u = uniform(err.seed || 1);
  const k = periods.map((l) => (2 * Math.PI) / l), ph = new Float64Array(2 * N * M);
  for (let i = 0; i < ph.length; i++) ph[i] = 2 * Math.PI * u();
  T = { N, M, k, c, ph };
  ripples.set(err, T);
  return T;
}
// Where the edge is free to ripple, w(r) and dw/dr: the ripple fades out in the valleys, where
// neighbouring petals meet (factor 1 − A⁸: 0.08 where A = 0.99, 0.57 at 0.9, 0.94 at 0.7), and at
// the tip, where the petal is narrower than a real one can be made (factor 1 − exp(−(h/h₀)²) of the
// half-width h = πrA/N, h₀ = 1 mm). Edges then never cross, and the field stays linear in σ.
export const TIP_H0 = 1e-3;
function rippleWeight(r, o, N) {
  const [A, A1] = hyperA012(r, o), a = 1 - A ** 8, a1 = -8 * A ** 7 * A1;
  const u = (Math.PI * r * A) / (N * TIP_H0), u1 = (Math.PI * (A + r * A1)) / (N * TIP_H0), e = Math.exp(-u * u), b = 1 - e, b1 = 2 * u * u1 * e;
  return [a * b, a1 * b + a * b1];
}
// δ and dδ/dr (m) of edge `side` (0: the lower angle, 1: the upper) of petal j at radius r;
// positive δ moves the edge outwards, widening the petal.
export function edgeRipple(err, N, j, side, r) {
  const T = rippleTable(err, N), o = (2 * j + side) * T.M;
  let v = 0, v1 = 0;
  for (let m = 0; m < T.M; m++) { const a = T.k[m] * r + T.ph[o + m]; v += T.c[m] * Math.sin(a); v1 += T.c[m] * T.k[m] * Math.cos(a); }
  return [err.d * v, err.d * v1];
}

// Edge angles of petal j at radius r before clipping, with their derivatives: [lo, hi, lo′, hi′].
function rawEdges(j, r, o, N, err) {
  const { kind = 'none', d = 0, petal = 0 } = err || {}, me = j === petal;
  let c = (2 * Math.PI * j) / N;
  if (kind === 'clock' && me) c += d / tipR(o);
  if (kind === 'shift' && me) {
    // a rigid slide by d along the axis takes the edge point at (r, ψ) to radius r + d cos ψ and
    // half-angle ψ − d sin ψ / r; to first order in d the new edge at radius r is
    //   ψ(r) = πA(r − d cos ψ₀)/N − d sin ψ₀ / r,   ψ₀ = πA(r)/N
    const [B, B1] = hyperA012(r, o), p0 = (Math.PI * B) / N, p0d = (Math.PI * B1) / N, cs = Math.cos(p0), sn = Math.sin(p0);
    const [A, A1] = hyperA012(r - d * cs, o);
    const psi = (Math.PI * A) / N - (d * sn) / r;
    const dpsi = ((Math.PI * A1) / N) * (1 + d * sn * p0d) - (d * cs * p0d) / r + (d * sn) / (r * r);
    return [c - psi, c + psi, -dpsi, dpsi];
  }
  const [A, A1, A2] = hyperA012(r, o);
  let psi = (Math.PI * A) / N, dpsi = (Math.PI * A1) / N;
  if (kind === 'random') {
    // each edge moved along its own normal by δ(r): its angle changes by δ√(1+g²)/r, as for 'width'
    const g = (r * Math.PI * A1) / N, g1 = (Math.PI * (A1 + r * A2)) / N, q = Math.sqrt(1 + g * g), dq = (g * g1) / (q * r) - q / (r * r);
    const [w, w1] = rippleWeight(r, o, N);
    let [dl, dl1] = edgeRipple(err, N, j, 0, r), [dh, dh1] = edgeRipple(err, N, j, 1, r);
    [dl, dl1, dh, dh1] = [w * dl, w * dl1 + w1 * dl, w * dh, w * dh1 + w1 * dh];
    const al = (dl * q) / r, ah = (dh * q) / r, al1 = (dl1 * q) / r + dl * dq, ah1 = (dh1 * q) / r + dh * dq;
    return [c - psi - al, c + psi + ah, -dpsi - al1, dpsi + ah1];
  }
  if (kind === 'width') {
    // a normal offset d of an edge whose slope is g = r dψ/dr turns it by d√(1+g²)/r
    const g = (r * Math.PI * A1) / N, g1 = (Math.PI * (A1 + r * A2)) / N, q = Math.sqrt(1 + g * g);
    psi += (d * q) / r; dpsi += d * ((g * g1) / (q * r) - q / (r * r));
  }
  return [c - psi, c + psi, -dpsi, dpsi];
}
// Clipped edges of petal j at radius r: overlaps with either neighbour are cut at the mid-line,
// and a petal narrower than nothing has zero width. Returns [lo, hi, lo′, hi′, clipped-lo, clipped-hi, closed].
function edges(j, r, o, N, err) {
  let [lo, hi, dlo, dhi] = rawEdges(j, r, o, N, err), cl = false, ch = false, z = false;
  const P = 2 * Math.PI, nx = rawEdges((j + 1) % N, r, o, N, err), pv = rawEdges((j + N - 1) % N, r, o, N, err);
  const l = nx[0] + (j === N - 1 ? P : 0), hp = pv[1] - (j === 0 ? P : 0);
  if (N > 1 && hi > l) { hi = (hi + l) / 2; dhi = (dhi + nx[2]) / 2; ch = true; }
  if (N > 1 && lo < hp) { lo = (lo + hp) / 2; dlo = (dlo + pv[3]) / 2; cl = true; }
  if (hi < lo) { lo = hi = (lo + hi) / 2; dlo = dhi = (dlo + dhi) / 2; z = true; }
  return [lo, hi, dlo, dhi, cl, ch, z];
}

// The edges of petal j at radius r as drawn: [lo, hi] angles (rad) after clipping.
export const petalEdges = (j, r, o, N, err = null) => edges(j, r, o, N, err).slice(0, 2);

// Quadrature nodes along the whole outline: position (x, y) and weighted tangent (tx, ty) = w·dx/dt,
// anticlockwise around each piece. opts: { panels (per petal edge), order, hub (points on the hub) }.
// Without explicit counts they follow the number of Fresnel zones the edge crosses as seen from the
// farthest field point (opts.lam: the shortest wavelength, opts.z, opts.rhoMax).
const autoPanels = (o, lz, rho) => { const Rt = tipR(o); return Math.max(12, Math.ceil(((Rt + rho) ** 2 - Math.max(0, baseR(o) - rho) ** 2) / lz / 2.5)); };
const autoHub = (o, lz, rho) => 64 * Math.ceil((256 + (16 * baseR(o) * (baseR(o) + rho)) / lz) / 64);
// A rippled edge also needs a panel per 1.7 shortest ripple periods, on top of those for the
// Fresnel zones, because the two phases add (12-point Gauss–Legendre then integrates the ripple's
// effect to 10⁻⁶).
const ripplePanels = (o, err) => (err && err.kind === 'random' ? Math.ceil((0.6 * (tipR(o) - baseR(o))) / ({ ...RIPPLE, ...err }).lmin) : 0);
// About how many edge points petalOutline uses (12 per panel, 2N edges, hub, tips and bases).
export const petalNodes = (o, N, lam, z, rho, err = null) => 24 * N * (autoPanels(o, lam * z, rho) + ripplePanels(o, err)) + autoHub(o, lam * z, rho) + 24 * N;
// The shortest wavelength whose outline stays within maxNodes edge points (the work grows as 1/λ).
export function petalMinLam(o, N, z, rho, maxNodes, err = null) {
  let lo = 1e-8, hi = 1e-3;
  if (petalNodes(o, N, hi, z, rho, err) > maxNodes) return Infinity;
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (petalNodes(o, N, m, z, rho, err) > maxNodes) lo = m; else hi = m; }
  return hi;
}
export function petalOutline(o, N, err = null, opts = {}) {
  const lz = (opts.lam || 300e-9) * (opts.z || 8e7), rho = opts.rhoMax || 0;
  const { kind = 'none', d = 0 } = err || {};
  const Rend = tipR(o) + (kind === 'shift' ? Math.max(0, d) : 0), a0 = baseR(o);
  const P = opts.panels || autoPanels(o, lz, rho) + ripplePanels(o, err), q = gaussLegendre(opts.order || 12), nh = opts.hub || autoHub(o, lz, rho);
  const X = [], Y = [], TX = [], TY = [];
  const push = (x, y, tx, ty) => { X.push(x); Y.push(y); TX.push(tx); TY.push(ty); };
  // the hub, anticlockwise (trapezoid rule: exact for a periodic integrand to spectral accuracy)
  for (let i = 0; i < nh; i++) { const t = (2 * Math.PI * i) / nh, w = (2 * Math.PI) / nh; push(a0 * Math.cos(t), a0 * Math.sin(t), -a0 * Math.sin(t) * w, a0 * Math.cos(t) * w); }
  for (let j = 0; j < N; j++) {
    const E = (r) => edges(j, r, o, N, err), rb = a0;
    // where an edge starts or stops being clipped it has a kink: put a panel boundary there, so that
    // every panel integrates a smooth curve and keeps Gauss–Legendre's accuracy
    const sig = (r) => E(r).slice(4).join();
    const cuts = [rb], ns = 400;
    for (let i = 1; i <= ns; i++) {
      const r0 = rb + ((Rend - rb) * (i - 1)) / ns, r1 = rb + ((Rend - rb) * i) / ns;
      if (sig(r0) !== sig(r1)) { let lo = r0, hi = r1; for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (sig(m) === sig(r0)) lo = m; else hi = m; } cuts.push((lo + hi) / 2); }
    }
    // a tabulated profile bends at its nodes
    if (isTable(o)) for (let i = 1; i < o.A.length - 1; i++) cuts.push(o.r0 + i * o.dr);
    cuts.push(Rend);
    cuts.sort((x, y) => x - y);
    for (const side of [0, 1]) {
      for (let c = 0; c + 1 < cuts.length; c++) {
        const s0 = cuts[c], s1 = cuts[c + 1], np = Math.max(1, Math.round((P * (s1 - s0)) / (Rend - rb)));
        if (s1 - s0 < 1e-12) continue;
        for (let p = 0; p < np; p++) {
          const r0 = s0 + ((s1 - s0) * p) / np, r1 = s0 + ((s1 - s0) * (p + 1)) / np, hr = (r1 - r0) / 2;
          for (let i = 0; i < q.x.length; i++) {
            const r = r0 + hr * (1 + q.x[i]), e = E(r), th = e[side], d1 = e[2 + side];
            const sgn = side === 0 ? 1 : -1, w = hr * q.w[i] * sgn, cs = Math.cos(th), sn = Math.sin(th);
            push(r * cs, r * sn, (cs - r * sn * d1) * w, (sn + r * cs * d1) * w);
          }
        }
      }
    }
    // the tip (lo → hi) and the base on the hub's circle (hi → lo) as arcs
    for (const [r, a0, a1] of [[Rend, E(Rend)[0], E(Rend)[1]], [rb, E(rb)[1], E(rb)[0]]]) {
      const ha = (a1 - a0) / 2;
      if (!ha) continue;
      for (let i = 0; i < q.x.length; i++) { const t = a0 + ha * (1 + q.x[i]), w = ha * q.w[i]; push(r * Math.cos(t), r * Math.sin(t), -r * Math.sin(t) * w, r * Math.cos(t) * w); }
    }
  }
  return { x: Float64Array.from(X), y: Float64Array.from(Y), tx: Float64Array.from(TX), ty: Float64Array.from(TY) };
}

// First-order perturbation theory for edge ripple. Moving an edge outwards by δ along its normal
// adds the strip δ ds to the shade, so the field changes by
//   δE(p) = −(1/iλz) ∫ e^{ik|p − x(s)|²} δ(s) ds = (i/λz) ∫ e^{iks²} δ(r) √(1 + g²) dr
// along each of the 2N edges (k = π/λz, g = r dψ/dr). For a ripple δ = σ√2 w(r) sin(Kr + φ) with a
// random phase, the expected |δE|² over φ is (σ²/2(λz)²)(|I₊|² + |I₋|²), I± = ∫ e^{iks²} q w e^{±iKr} dr,
// summed over the edges, whose phases are independent. Returns, for each period ℓ (K = 2π/ℓ), the
// added intensity per unit σ² (m⁻²), averaged over the points.
function rippleIntegrals(o, N, lam, z, px, py, Ks) {
  const k = Math.PI / (lam * z), Rend = tipR(o), a0 = baseR(o);
  const kmax = Math.max(...Ks), rho = Math.max(0, ...px.map((x, i) => Math.hypot(x, py[i])));
  // panels: the Fresnel zones crossed and 1.7 ripple periods per 12-point panel, doubled for the
  // steep rise of the weight near the tip (then converged to 10⁻⁶)
  const P = 2 * Math.max(autoPanels(o, lam * z, rho), Math.ceil(((Rend - a0) * kmax) / (2 * Math.PI) / 1.7)), q = gaussLegendre(12);
  const rs = [], ws = [];
  for (let p = 0; p < P; p++) {
    const r0 = a0 + ((Rend - a0) * p) / P, hr = (Rend - a0) / P / 2;
    for (let i = 0; i < q.x.length; i++) {
      const r = r0 + hr * (1 + q.x[i]), [A, A1] = hyperA012(r, o), g = (r * Math.PI * A1) / N;
      rs.push(r); ws.push(hr * q.w[i] * Math.sqrt(1 + g * g) * rippleWeight(r, o, N)[0]);
    }
  }
  const n = rs.length, psi = rs.map((r) => (Math.PI * hyperA(r, o)) / N);
  // out[p][e][m] = [I₊ re, im, I₋ re, im]
  return { n, rs, ws, psi, k, P, Ks, at(pxi, pyi, e) {
    const c = (2 * Math.PI * (e >> 1)) / N, sgn = e & 1 ? 1 : -1, out = new Float64Array(4 * Ks.length);
    for (let i = 0; i < n; i++) {
      const th = c + sgn * psi[i], x = rs[i] * Math.cos(th), y = rs[i] * Math.sin(th), ph = k * ((pxi - x) ** 2 + (pyi - y) ** 2);
      for (let m = 0; m < Ks.length; m++) {
        const a = ph + Ks[m] * rs[i], b = ph - Ks[m] * rs[i];
        out[4 * m] += ws[i] * Math.cos(a); out[4 * m + 1] += ws[i] * Math.sin(a);
        out[4 * m + 2] += ws[i] * Math.cos(b); out[4 * m + 3] += ws[i] * Math.sin(b);
      }
    }
    return out;
  } };
}
export function rippleSensitivity(o, N, lam, z, px, py, periods) {
  const Ks = periods.map((l) => (2 * Math.PI) / l), R = rippleIntegrals(o, N, lam, z, px, py, Ks), out = new Float64Array(periods.length);
  for (let p = 0; p < px.length; p++) for (let e = 0; e < 2 * N; e++) {
    const I = R.at(px[p], py[p], e);
    for (let m = 0; m < Ks.length; m++) out[m] += (I[4 * m] ** 2 + I[4 * m + 1] ** 2 + I[4 * m + 2] ** 2 + I[4 * m + 3] ** 2) / 2;
  }
  const f = 1 / ((lam * z) ** 2 * px.length);
  return out.map((v) => v * f);
}
// The first-order field change [re, im] at the points for one particular ripple err (its own phases).
export function rippleField(o, N, err, lam, z, px, py) {
  const T = rippleTable(err, N), R = rippleIntegrals(o, N, lam, z, px, py, Array.from(T.k)), out = new Float64Array(2 * px.length), lz = lam * z;
  for (let p = 0; p < px.length; p++) for (let e = 0; e < 2 * N; e++) {
    const I = R.at(px[p], py[p], e);
    // δ = σ Σ cₘ sin(Kr + φ) = σ Σ cₘ (e^{iφ}e^{iKr} − e^{−iφ}e^{−iKr})/2i; δE = (i/λz)∫e^{iks²} q w δ dr
    for (let m = 0; m < T.M; m++) {
      const phi = T.ph[e * T.M + m], cp = Math.cos(phi), sp = Math.sin(phi), A = (err.d * T.c[m]) / (2 * lz);
      // (i/2i)(e^{iφ}I₊ − e^{−iφ}I₋) = ½(e^{iφ}I₊ − e^{−iφ}I₋)
      out[2 * p] += A * (cp * I[4 * m] - sp * I[4 * m + 1] - (cp * I[4 * m + 2] + sp * I[4 * m + 3]));
      out[2 * p + 1] += A * (cp * I[4 * m + 1] + sp * I[4 * m] - (cp * I[4 * m + 3] - sp * I[4 * m + 2]));
    }
  }
  return out;
}

// The field [re, im] at points (px, py) behind the outline, at wavelength lam and distance z.
export function petalField(L, lam, z, px, py) {
  const k = Math.PI / (lam * z), n = L.x.length, out = new Float64Array(2 * px.length);
  for (let m = 0; m < px.length; m++) {
    const p = px[m], qy = py[m];
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const sx = L.x[i] - p, sy = L.y[i] - qy, s2 = sx * sx + sy * sy, da = (sx * L.ty[i] - sy * L.tx[i]) / s2, ph = k * s2;
      re += (Math.cos(ph) - 1) * da; im += Math.sin(ph) * da;
    }
    out[2 * m] = 1 + re / (2 * Math.PI); out[2 * m + 1] = im / (2 * Math.PI);
  }
  return out;
}

// Bessel J_n(x) for integer n ≥ 0 by Miller's backward recurrence, normalised with
// J₀ + 2ΣJ_{2k} = 1 (forward recurrence is unstable for x < n).
export function besselJn(n, x) {
  if (x === 0) return n === 0 ? 1 : 0;
  const ax = Math.abs(x), m = 2 * Math.ceil((Math.max(n, ax) + 30 + Math.sqrt(40 * Math.max(n, ax))) / 2);
  let jp = 0, j = 1e-300, sum = 0, out = 0;
  for (let k = m; k > 0; k--) {
    const jm = ((2 * k) / ax) * j - jp; jp = j; j = jm;
    if (Math.abs(j) > 1e250) { j *= 1e-250; jp *= 1e-250; sum *= 1e-250; out *= 1e-250; }
    if (k - 1 === n) out = j;
    if ((k - 1) % 2 === 0 && k - 1 > 0) sum += 2 * j;
  }
  const v = out / (sum + j);
  return x < 0 && n % 2 ? -v : v;
}

// The same field from the angular Fourier series of N identical petals: the opaque fraction at
// radius r is A + Σ_j (2 sin(jπA)/jπ) cos(jNθ), and each term integrates over angle to a Bessel
// function, so
//   E(ρ,φ) = 1 + i(2π/λz) e^{ikρ²} ∫ e^{ikr²} [A J₀(q) + Σ_j (2 sin(jπA)/jπ) (−i)^{jN} cos(jNφ) J_{jN}(q)] r dr,
// q = 2krρ. Petal j = 0 lies along φ = 0. An independent check of petalField; jmax terms.
export function petalSeriesField(o, N, lam, z, rho, phi, jmax = 4, steps = 20000) {
  // one Richardson step removes the O(Δu²) error of the sampled Bessel factors
  const a = seriesFilon(o, N, lam, z, rho, phi, jmax, steps), b = seriesFilon(o, N, lam, z, rho, phi, jmax, 2 * steps);
  return [(4 * b[0] - a[0]) / 3, (4 * b[1] - a[1]) / 3];
}
function seriesFilon(o, N, lam, z, rho, phi, jmax, steps) {
  const k = Math.PI / (lam * z), Rm = tipR(o), U = Rm * Rm, du = U / steps, q = 2 * k * rho;
  // coefficients c_j = 2 sin(jπA)/jπ · (−i)^{jN} cos(jNφ); (−i)^m cycles 1, −i, −1, i
  const ph = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  let re = 0, im = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) * du, r = Math.sqrt(u), A = hyperA(r, o);
    if (A < 1e-12) continue;
    let gr = A * besselJ0(q * r), gi = 0;
    for (let j = 1; j <= jmax; j++) {
      const c = ((2 * Math.sin(j * Math.PI * A)) / (j * Math.PI)) * Math.cos(j * N * phi) * besselJn(j * N, q * r), [pr, pi] = ph[(j * N) % 4];
      gr += c * pr; gi += c * pi;
    }
    const cr = Math.cos(k * u), ci = Math.sin(k * u);
    re += gr * cr - gi * ci; im += gr * ci + gi * cr;
  }
  // Filon weight for the linear phase across each step, r dr = du/2
  const wgt = (2 * Math.sin((k * du) / 2)) / k / 2, c = (2 * Math.PI) / (lam * z);
  re *= wgt * c; im *= wgt * c;
  const p = k * rho * rho, er = Math.cos(p), ei = Math.sin(p), xr = er * re - ei * im, xi = er * im + ei * re;
  return [1 - xi, xr];
}

// The same field on a regular grid: points (x0 + i·dx, ys[j]) for i < nx and every row ys[j], as
// [re, im] interleaved, row by row. Writing s² = |x|² + |p|² − 2x·p, the phase factor of each edge
// point steps along a row by the constant e^{−2ik x dx}, so the inner loop needs no sine or cosine
// (about five times faster than petalField; the recurrence loses under 10⁻¹³ over a row).
export function petalFieldGrid(L, lam, z, x0, dx, nx, ys) {
  const k = Math.PI / (lam * z), n = L.x.length, out = new Float64Array(2 * nx * ys.length);
  const ar = new Float64Array(nx), ai = new Float64Array(nx), ad = new Float64Array(nx);
  for (let j = 0; j < ys.length; j++) {
    const py = ys[j];
    ar.fill(0); ai.fill(0); ad.fill(0);
    for (let q = 0; q < n; q++) {
      const x = L.x[q], y = L.y[q], tx = L.tx[q], ty = L.ty[q];
      // e^{ik(|x|² − 2x·p)} at the first point of the row, and its step
      const ph = k * (x * x + y * y - 2 * (x * x0 + y * py)), st = -2 * k * x * dx, sr = Math.cos(st), si = Math.sin(st);
      let zr = Math.cos(ph), zi = Math.sin(ph);
      const sy = y - py, c0 = sy * tx;
      for (let i = 0; i < nx; i++) {
        const sx = x - (x0 + i * dx), da = (sx * ty - c0) / (sx * sx + sy * sy);
        ar[i] += zr * da; ai[i] += zi * da; ad[i] += da;
        const nr = zr * sr - zi * si; zi = zr * si + zi * sr; zr = nr;
      }
    }
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * dx, pp = k * (px * px + py * py), cr = Math.cos(pp), ci = Math.sin(pp);
      // E = 1 + (1/2π)[e^{ik|p|²} Σ e^{ik(|x|² − 2x·p)} dα − Σ dα]
      out[2 * (j * nx + i)] = 1 + (cr * ar[i] - ci * ai[i] - ad[i]) / (2 * Math.PI);
      out[2 * (j * nx + i) + 1] = (cr * ai[i] + ci * ar[i]) / (2 * Math.PI);
    }
  }
  return out;
}

// A G×G grid across a telescope of diameter D (cell centres; rows run along +y, which every picture
// on the page draws downwards): the first column x0, the step dx, the rows ys, and the indices of
// the cells whose centres lie inside the circle.
export function apertureGrid(D, G) {
  const dx = D / G, x0 = (0.5 - G / 2) * dx, ys = Array.from({ length: G }, (_, i) => x0 + i * dx), idx = [];
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) if ((x0 + j * dx) ** 2 + ys[i] ** 2 <= (D / 2) ** 2) idx.push(i * G + j);
  return { G, dx, x0, ys, idx };
}

// The telescope's image of the light that leaks past the starshade: the Fraunhofer transform of the
// field over the aperture, in units of the peak of the unobstructed star's image (the contrast a
// planet must beat). p = { field (re, im interleaved over the G×G grid), idx (the cells inside the
// aperture), G, D, lam, n (FFT size) }.
// Returns I (n×n, row-major, in the orientation of the drawing of the shade, so a leak appears
// beside the petal that causes it) and the pixel size in radians.
export function petalImage(p) {
  const n = p.n || 512, { G } = p, re = new Float64Array(n * n), im = new Float64Array(n * n), o = (n - G) >> 1;
  let cnt = 0;
  for (const q of p.idx) { const i = Math.floor(q / G), j = q % G, k = (i + o) * n + j + o; re[k] = p.field[2 * q]; im[k] = p.field[2 * q + 1]; cnt++; }
  fft2d(re, im, n);
  // the leak from an edge point at (X, Y) reaches the pupil as a wave tilted by −(X, Y)/z, i.e. at
  // spatial frequency −(X, Y)/λz: the sky direction is −λ times the frequency
  const I = new Float64Array(n * n), h = n >> 1, norm = 1 / (cnt * cnt);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = (2 * n - (x - h)) % n, fy = (2 * n - (y - h)) % n, k = fy * n + fx;
    I[y * n + x] = (re[k] * re[k] + im[k] * im[k]) * norm;
  }
  return { I, n, pix: p.lam / (n * (p.D / G)) };
}

// ---------------------------------------------------------------------------------------------
// An optimised occulter, as a linear program in the spirit of Vanderbei, Cady & Kasdin (2007). The
// field is linear in the profile, so with A = 1 − Σ dᵢ rampᵢ(r) (ramps of width dr starting at
// rᵢ = r0 + i·dr, dᵢ ≥ 0, Σdᵢ ≤ 1) the profile is monotone, between 0 and 1 and continuous, and
//   E(ρ, λ) = E_disk(R) + Σ dᵢ Cᵢ(ρ, λ).
// The program minimises the bound c on |Re E| and |Im E| over sample radii ρ ≤ rhoMax and
// wavelengths in [lamMin, lamMax], with the curvature |A″| ≤ K (|dᵢ₊₁ − dᵢ| ≤ K dr²). Samples are
// added where a dense check finds the field largest (constraint generation), until the dense
// maximum of |E|² is within `slack` of 2c² (the bound on |E|² the box gives) or `rounds` run out.
// o = { R, r0, nr, K, z, lamMin, lamMax, rhoMax, steps, rounds, slack }.
// The columns with one Richardson step (steps and 2·steps), as in shadowField: the midpoint rule's
// O(Δu²) error off the axis would otherwise reach 10⁻⁵ in field, which the program would exploit.
export function occulterColumns(o, lam, rho) {
  const st = o.steps || 4000, a = columnsAt(o, lam, rho, st), b = columnsAt(o, lam, rho, 2 * st), R = (x, y) => (4 * y - x) / 3;
  return { D: [R(a.D[0], b.D[0]), R(a.D[1], b.D[1])], C: b.C.map((v, i) => R(a.C[i], v)) };
}
function columnsAt(o, lam, rho, steps) {
  const { R, r0, nr, z } = o, dr = (R - r0) / (nr - 1), du = (R * R) / steps;
  const k = Math.PI / (lam * z), wgt = (2 * Math.sin((k * du) / 2)) / k, q = 2 * k * rho;
  // g(u) per Filon step, and its suffix sums
  const gr = new Float64Array(steps + 1), gi = new Float64Array(steps + 1), rs = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    const u = (s + 0.5) * du, r = Math.sqrt(u), g = (rho ? besselJ0(q * r) : 1) * wgt;
    rs[s] = r; gr[s] = Math.cos(k * u) * g; gi[s] = Math.sin(k * u) * g;
  }
  const Dr = gr.reduce((a, v) => a + v, 0), Di = gi.reduce((a, v) => a + v, 0);
  for (let s = steps - 1; s >= 0; s--) { gr[s] += gr[s + 1]; gi[s] += gi[s + 1]; }
  const idx = (r) => Math.min(steps, Math.max(0, Math.ceil((r * r) / du - 0.5)));
  const C = new Float64Array(2 * nr);
  for (let i = 0; i < nr; i++) {
    const ri = r0 + i * dr, s0 = idx(ri), s1 = idx(ri + dr);
    let cr = gr[s1], ci = gi[s1];
    for (let s = s0; s < s1; s++) { const w = (rs[s] - ri) / dr, g0r = gr[s] - gr[s + 1], g0i = gi[s] - gi[s + 1]; cr += w * g0r; ci += w * g0i; }
    C[2 * i] = -cr; C[2 * i + 1] = -ci;
  }
  // E = 1 + i(π/λz) e^{ikρ²} ∫ A e^{iku} J₀ du
  const pre = Math.PI / (lam * z), ph = k * rho * rho, er = Math.cos(ph), ei = Math.sin(ph);
  const f = (xr, xi) => [-pre * (er * xi + ei * xr), pre * (er * xr - ei * xi)];
  const d = f(Dr, Di);
  for (let i = 0; i < nr; i++) { const c = f(C[2 * i], C[2 * i + 1]); C[2 * i] = c[0]; C[2 * i + 1] = c[1]; }
  return { D: [1 + d[0], d[1]], C };
}
export function optimiseOcculter(o) {
  const { nr, K, rhoMax, lamMin, lamMax } = o, dr = (o.R - o.r0) / (nr - 1), kap = K * dr * dr, n = nr + 1;
  const base = [], bh = [];
  const row = (pairs) => { const a = new Float64Array(n); for (const [i, v] of pairs) a[i] = v; return a; };
  for (let i = 0; i + 1 < nr; i++) { base.push(row([[i + 1, 1], [i, -1]]), row([[i + 1, -1], [i, 1]])); bh.push(kap, kap); }
  // the slope starts and ends within the curvature limit too, and the profile reaches no lower than 0
  base.push(row([[0, 1]]), row([[nr - 1, 1]]), row(Array.from({ length: nr }, (_, i) => [i, 1]))); bh.push(kap, kap, 1);
  const rows = [], rh = [], seen = new Set();
  const add = (lam, rho) => {
    const key = `${lam}|${rho}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const s = occulterColumns(o, lam, rho);
    for (const part of [0, 1]) for (const sg of [1, -1]) {
      const a = new Float64Array(n);
      for (let i = 0; i < nr; i++) a[i] = sg * s.C[2 * i + part];
      a[nr] = -1; rows.push(a); rh.push(-sg * s.D[part]);
    }
    return true;
  };
  // wavelengths spaced evenly in 1/λ, i.e. in Fresnel number: the field varies fastest at short λ
  const lams = (m) => Array.from({ length: m }, (_, i) => 1 / (1 / lamMax + ((1 / lamMin - 1 / lamMax) * i) / (m - 1)));
  for (const l of lams(o.nl0 || 11)) for (const p of [0, rhoMax / 2, rhoMax]) add(l, p);
  const dense = (o.dense || []).length ? o.dense : lams(81).flatMap((l) => [0, 0.25, 0.5, 0.75, 1].map((f) => [l, f * rhoMax]));
  const cols = dense.map(([l, p]) => occulterColumns(o, l, p));
  const cost = new Float64Array(n); cost[nr] = 1;
  let res = null, worst = 0, rounds = 0, pivots = 0;
  for (; rounds < (o.rounds || 12); rounds++) {
    res = simplex([...rows, ...base], [...rh, ...bh], cost, { enter: nr });
    pivots += res.pivots;
    const I = cols.map((s) => { let er = s.D[0], ei = s.D[1]; for (let i = 0; i < nr; i++) { er += res.x[i] * s.C[2 * i]; ei += res.x[i] * s.C[2 * i + 1]; } return er * er + ei * ei; });
    worst = Math.max(...I);
    if (worst <= (o.slack || 1.5) * 2 * res.value ** 2) { rounds++; break; }
    // the worst few dense samples join the program
    const order = I.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    let added = 0;
    for (const [v, i] of order) { if (added >= 4 || v <= 2 * res.value ** 2) break; if (add(...dense[i])) added++; }
    if (!added) { rounds++; break; }
  }
  // A at node i = 1 − Σ_{j<i} dⱼ: every earlier ramp is complete there (the last node is R itself)
  const A = [];
  let s = 0;
  for (let i = 0; i < nr; i++) { A.push(Math.min(1, Math.max(0, 1 - s))); s += res.x[i]; }
  return { R: o.R, r0: o.r0, dr, A, c: res.value, worst, rounds, pivots, samples: rows.length / 4 };
}

// The page's optimised shade: the program above for a tip radius `frac` × the hypergaussian's, over
// the telescope (ρ ≤ D/2) and 400–1000 nm, then checked independently with shadowField (finer steps,
// a dense grid in ρ and in 1/λ): the aperture-averaged suppression across the spectrum, the profile
// of the shadow at lamC, and the worst |E|² over the band for both shades.
// p = { a, b, n, z, D, frac, K, nr, rounds, specLams, lamC, rhos }.
export const OPT_BAND = [400e-9, 1000e-9];
export function optimisedLab(p) {
  const hy = { a: p.a, b: p.b, n: p.n }, R = p.frac * OCCULTERS.hyper.Rmax(hy), st = 8000;
  const t = optimiseOcculter({ R, r0: 0.2 * R, nr: p.nr || 60, K: p.K, z: p.z, lamMin: OPT_BAND[0], lamMax: OPT_BAND[1], rhoMax: p.D / 2, rounds: p.rounds || 3 });
  const na = 8, ar = Array.from({ length: na }, (_, i) => ((i + 0.5) / na) * (p.D / 2)), wsum = ar.reduce((a, r) => a + r, 0);
  const spec = p.specLams.map((l) => intensity(shadowField('table', t, l, p.z, ar, st)).reduce((a, v, i) => a + v * ar[i], 0) / wsum);
  const prof = intensity(shadowField('table', t, p.lamC, p.z, p.rhos, st));
  const rs = [0, 0.25, 0.5, 0.75, 1].map((f) => (f * p.D) / 2), worst = { opt: 0, hyper: 0 };
  for (let i = 0; i < 41; i++) {
    const l = 1 / (1 / OPT_BAND[1] + ((1 / OPT_BAND[0] - 1 / OPT_BAND[1]) * i) / 40);
    worst.opt = Math.max(worst.opt, ...intensity(shadowField('table', t, l, p.z, rs, st)));
    worst.hyper = Math.max(worst.hyper, ...intensity(shadowField('hyper', hy, l, p.z, rs, 4000)));
  }
  return { tbl: t, spec, prof, worst };
}

// ---------------------------------------------------------------------------------------------
// Sunlight glinting off the petal edges. Each edge is modelled as a reflecting tube of radius a (the
// edge's rounding, a ≫ λ) along the outline. With the Sun behind the shade at angle β from the line
// of sight, the scattering angle is β, and the light reaches the telescope only from points whose
// outward normal in the shade's plane points to the Sun's azimuth φ_s. There the surface's Gaussian
// curvature is cos(β/2)/(a R_c) (a torus, R_c the outline's radius of curvature), so a point Sun
// gives the radiant intensity J = R S a R_c / (4 cos(β/2)) (geometrical optics: J = R S/4K).
// The Sun's disc (angular radius α☉) spreads the matching normals over ±α☉/sin β, so R_c becomes
// ⟨R_c⟩ = ∫ W(φ(s) − φ_s) ds with W the disc's chord weighting; this stays finite where the
// outline's curvature passes through zero. Relative to a solar twin at d parsecs (the shade is 1 AU
// from the Sun, so the solar constant cancels) one glint spot has the flux ratio
//   C = R a ⟨R_c⟩ (d / 1 AU)² / (4 cos(β/2) z²).
// Edges closer to a neighbour, or petals narrower, than 4a are not free and do not glint; nor do the
// tips of tabulated profiles (their truncation arcs). Light from different spots adds incoherently.
export const SUN_ALPHA = 6.957e8 / 1.495978707e11; // the Sun's angular radius from 1 AU (rad)
export const PARSEC_AU = 206264.806;
const wrap = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
// p = { beta, phiS (rad), a (m), refl, z (m), dpc, M (samples per edge) }. Returns the spots
// { x, y (m in the shade's plane), Rc (⟨R_c⟩, m), C } and the total flux ratio.
export function glintSpots(o, N, p) {
  const w = SUN_ALPHA / Math.sin(p.beta), M = p.M || 3000, r0 = baseR(o), r1 = tipR(o), spots = [];
  const W = (x) => (Math.abs(x) < w ? (2 / (Math.PI * w * w)) * Math.sqrt(w * w - x * x) : 0);
  const k = (p.refl * p.a * (p.dpc * PARSEC_AU) ** 2) / (4 * Math.cos(p.beta / 2) * p.z * p.z);
  // sample radii, with the nodes of a tabulated profile among them (its edges bend there)
  const rs = Array.from({ length: M + 1 }, (_, i) => r0 + ((r1 - r0) * i) / M);
  if (isTable(o)) for (let i = 1; i < o.A.length - 1; i++) rs.push(o.r0 + i * o.dr);
  rs.sort((x, y) => x - y);
  for (let j = 0; j < N; j++) for (const side of [0, 1]) {
    const c = (2 * Math.PI * j) / N, sg = side ? 1 : -1;
    // position and outward normal angle at r, using the profile's slope on the side of r given by e
    const at = (r, e) => {
      const [A, A1] = hyperA012(r + e, o), psi = (Math.PI * A) / N, th = c + sg * psi, t1 = (sg * Math.PI * A1) / N;
      const tx = Math.cos(th) - r * t1 * Math.sin(th), ty = Math.sin(th) + r * t1 * Math.cos(th);
      // the petal lies clockwise of its upper edge and anticlockwise of its lower one
      const nx = side ? -ty : ty, ny = side ? tx : -tx;
      return { x: r * Math.cos(th), y: r * Math.sin(th), phi: Math.atan2(ny, nx), free: r * (2 * Math.PI / N - 2 * psi) > 4 * p.a && 2 * r * psi > 4 * p.a };
    };
    let cur = null;
    for (let i = 0; i + 1 < rs.length; i++) {
      const ra = rs[i], rb = rs[i + 1];
      if (rb - ra < 1e-12) continue;
      const eps = (rb - ra) * 1e-6, A0 = at(ra, eps), B0 = at(rb, -eps);
      const da = wrap(A0.phi - p.phiS), db = wrap(B0.phi - p.phiS);
      let got = 0, gx = 0, gy = 0;
      if (A0.free && B0.free && !(Math.min(da, db) > w || Math.max(da, db) < -w) && Math.abs(da - db) < Math.PI) {
        // integrate W along the segment, finely enough to resolve the window
        const K = Math.max(4, Math.ceil((Math.abs(db - da) / w) * 40)), L = Math.hypot(B0.x - A0.x, B0.y - A0.y) / K;
        for (let q = 0; q < K; q++) {
          const f = (q + 0.5) / K, r = ra + (rb - ra) * f, P = at(r, 0), wt = W(wrap(P.phi - p.phiS)) * L;
          got += wt; gx += wt * P.x; gy += wt * P.y;
        }
      }
      if (got > 0) { if (!cur) cur = { Rc: 0, sx: 0, sy: 0 }; cur.Rc += got; cur.sx += gx; cur.sy += gy; }
      else if (cur) { spots.push(cur); cur = null; }
    }
    if (cur) spots.push(cur);
  }
  const out = spots.map((q) => ({ x: q.sx / q.Rc, y: q.sy / q.Rc, Rc: q.Rc, C: k * q.Rc }));
  return { spots: out, total: out.reduce((acc, q) => acc + q.C, 0), k };
}
// The glint as the telescope images it (unobscured circular aperture D, wavelength lam): each spot's
// Airy pattern, peak = its flux ratio, on an n × n grid spanning ±half (rad), oriented like the
// drawing of the shade (row y at angle +y: the drawing puts +y downwards). Returns { I, n, pix, peak }.
export function glintImage(spots, p) {
  const n = p.n || 128, pix = (2 * p.half) / n, I = new Float32Array(n * n), s = (Math.PI * p.D) / p.lam;
  let peak = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tx = (x + 0.5 - n / 2) * pix, ty = (y + 0.5 - n / 2) * pix;
    let v = 0;
    for (const q of spots) {
      const u = s * Math.hypot(tx - q.x / p.z, ty - q.y / p.z);
      v += q.C * (u < 1e-9 ? 1 : (2 * besselJ1(u) / u) ** 2);
    }
    I[y * n + x] = v; if (v > peak) peak = v;
  }
  // the peak can fall between pixels: evaluate it at the spots too
  for (const q of spots) {
    let v = 0;
    for (const r of spots) { const u = s * Math.hypot((q.x - r.x) / p.z, (q.y - r.y) / p.z); v += r.C * (u < 1e-9 ? 1 : (2 * besselJ1(u) / u) ** 2); }
    if (v > peak) peak = v;
  }
  return { I, n, pix, peak };
}
