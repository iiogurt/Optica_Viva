import { fft2d } from './fft.js';

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
};

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
  const na = 12, ar = Array.from({ length: na }, (_, i) => ((i + 0.5) / na) * (o.D / 2));
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

const hyperA = (r, o) => (r <= o.a ? 1 : Math.exp(-(((r - o.a) / o.b) ** o.n)));
// A and its first two derivatives in r
function hyperA012(r, o) {
  if (r <= o.a) return [1, 0, 0];
  const t = (r - o.a) / o.b, n = o.n, A = Math.exp(-(t ** n)), A1 = (-A * n * t ** (n - 1)) / o.b;
  return [A, A1, (-n / o.b) * (A1 * t ** (n - 1) + (A * (n - 1) * t ** (n - 2)) / o.b)];
}

// Edge angles of petal j at radius r before clipping, with their derivatives: [lo, hi, lo′, hi′].
function rawEdges(j, r, o, N, err) {
  const { kind = 'none', d = 0, petal = 0 } = err || {}, me = j === petal;
  let c = (2 * Math.PI * j) / N;
  if (kind === 'clock' && me) c += d / (o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n));
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
const autoPanels = (o, lz, rho) => { const Rt = o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n); return Math.max(12, Math.ceil(((Rt + rho) ** 2 - Math.max(0, o.a - rho) ** 2) / lz / 2.5)); };
const autoHub = (o, lz, rho) => 64 * Math.ceil((256 + (16 * o.a * (o.a + rho)) / lz) / 64);
// About how many edge points petalOutline uses (12 per panel, 2N edges, hub, tips and bases).
export const petalNodes = (o, N, lam, z, rho) => 24 * N * autoPanels(o, lam * z, rho) + autoHub(o, lam * z, rho) + 24 * N;
// The shortest wavelength whose outline stays within maxNodes edge points (the work grows as 1/λ).
export function petalMinLam(o, N, z, rho, maxNodes) {
  let lo = 1e-8, hi = 1e-3;
  if (petalNodes(o, N, hi, z, rho) > maxNodes) return Infinity;
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (petalNodes(o, N, m, z, rho) > maxNodes) lo = m; else hi = m; }
  return hi;
}
export function petalOutline(o, N, err = null, opts = {}) {
  const lz = (opts.lam || 300e-9) * (opts.z || 8e7), rho = opts.rhoMax || 0;
  const P = opts.panels || autoPanels(o, lz, rho), q = gaussLegendre(opts.order || 12), nh = opts.hub || autoHub(o, lz, rho);
  const X = [], Y = [], TX = [], TY = [];
  const push = (x, y, tx, ty) => { X.push(x); Y.push(y); TX.push(tx); TY.push(ty); };
  // the hub, anticlockwise (trapezoid rule: exact for a periodic integrand to spectral accuracy)
  for (let i = 0; i < nh; i++) { const t = (2 * Math.PI * i) / nh, w = (2 * Math.PI) / nh; push(o.a * Math.cos(t), o.a * Math.sin(t), -o.a * Math.sin(t) * w, o.a * Math.cos(t) * w); }
  const { kind = 'none', d = 0 } = err || {};
  const Rend = o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n) + (kind === 'shift' ? Math.max(0, d) : 0);
  for (let j = 0; j < N; j++) {
    const E = (r) => edges(j, r, o, N, err), rb = o.a;
    // where an edge starts or stops being clipped it has a kink: put a panel boundary there, so that
    // every panel integrates a smooth curve and keeps Gauss–Legendre's accuracy
    const sig = (r) => E(r).slice(4).join();
    const cuts = [rb], ns = 400;
    for (let i = 1; i <= ns; i++) {
      const r0 = rb + ((Rend - rb) * (i - 1)) / ns, r1 = rb + ((Rend - rb) * i) / ns;
      if (sig(r0) !== sig(r1)) { let lo = r0, hi = r1; for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (sig(m) === sig(r0)) lo = m; else hi = m; } cuts.push((lo + hi) / 2); }
    }
    cuts.push(Rend);
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
  const k = Math.PI / (lam * z), Rm = OCCULTERS.hyper.Rmax(o), U = Rm * Rm, du = U / steps, q = 2 * k * rho;
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
