// Laser guide stars and the cone effect. A laser spot at height H lights the turbulence in a cone,
// not in the cylinder a star's light fills: a layer at height h is seen through a footprint shrunk by
// α = 1 − h/H, so the wavefront the laser measures, φ(αx), is not the one the star's light carries,
// φ(x). The adaptive optics corrects the difference wrongly. With the Kolmogorov structure function
// D(r) = 6.88 (r/r₀)^{5/3} the error e(x) = φ(x) − φ(αx), averaged over a telescope of diameter D
// with piston and tilt removed (a laser cannot sense tilt: a natural star measures it), has the
// variance
//   σ² = (1/2A²) ∬ D_e(x, y) dx dy + (1/A) Σ_k ½ ∬ Z_k(x) Z_k(y) D_e(x, y) dx dy / ∫ Z_k²,
// D_e(x, y) = E[(e(x) − e(y))²] = −½ Σ_ij c_i c_j D(P_i − P_j) over the four points x, αx, y, αy
// with weights (1, −1, −1, 1), Z_k the tilts. For one layer σ² = 6.88 (D/r₀)^{5/3} F(α): F is
// computed here by Monte Carlo over pairs of points in the aperture, and the whole is checked
// against random phase screens. Lengths in metres; phases in radians.
import { uniform } from './random.js';
import { phaseScreen } from './turbulence.js';

// F(α) for a unit-diameter aperture, Kolmogorov turbulence of r₀ = 1: σ² = 6.88 F(α) (D/r₀)^{5/3}.
const FCACHE = new Map();
export function coneF(alpha, { n = 60000, seed = 7, tilt = true } = {}) {
  const key = `${alpha}|${n}|${seed}|${tilt}`;
  if (FCACHE.has(key)) return FCACHE.get(key);
  const u = uniform(seed), R = 0.5, A = Math.PI * R * R, D = (dx, dy) => Math.pow(dx * dx + dy * dy, 5 / 6); // r^{5/3}, the 6.88 outside
  const pt = () => { for (;;) { const x = (2 * u() - 1) * R, y = (2 * u() - 1) * R; if (x * x + y * y <= R * R) return [x, y]; } };
  let s0 = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pt(), [x2, y2] = pt(), a = alpha;
    // the four points: x (+1), αx (−1), y (−1), αy (+1)
    const P = [[x1, y1, 1], [a * x1, a * y1, -1], [x2, y2, -1], [a * x2, a * y2, 1]];
    let De = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) De -= P[p][2] * P[q][2] * D(P[p][0] - P[q][0], P[p][1] - P[q][1]);
    s0 += De; sx += x1 * x2 * De; sy += y1 * y2 * De;
  }
  // the sample means estimate ∬ (…) dx dy / A²
  const m0 = s0 / n, mx = sx / n, my = sy / n, Iz = (Math.PI * R ** 4) / 4; // ∫ x² over the disk
  // ½∬ZZ D_e /(A ∫Z²) with ∬ … = A² × the sample mean
  const F = m0 / 2 + (tilt ? ((mx + my) * A) / (2 * Iz) : 0);
  FCACHE.set(key, F);
  return F;
}

// The page's turbulence: a ground layer and one high layer holding the share wHigh of the
// turbulence at height hHigh; r₀ (500 nm, zenith) of the whole. The zenith angle ζ stretches every
// height by 1/cos ζ (α is unchanged) and shrinks r₀ to r₀ cos^{3/5} ζ.
// o = { D, H (laser height), r0, wHigh, hHigh, zeta (rad), lam (m), tilt }. Returns σ² (rad² at λ),
// the equivalent d₀ (σ² = (D/d₀)^{5/3}), the error in nm, and the Strehl ratio exp(−σ²).
export function coneError(o) {
  const r0z = o.r0 * Math.pow(Math.cos(o.zeta || 0), 3 / 5) * Math.pow(o.lam / 500e-9, 6 / 5);
  const rHigh = r0z * Math.pow(o.wHigh, -3 / 5), alpha = Math.max(0, 1 - o.hHigh / o.H);
  const s2 = o.wHigh > 0 && isFinite(o.H) ? 6.88 * coneF(alpha, { tilt: o.tilt !== false, n: o.n || 60000 }) * Math.pow(o.D / rHigh, 5 / 3) : 0;
  return { s2, d0: s2 > 0 ? o.D / Math.pow(s2, 3 / 5) : Infinity, nm: (Math.sqrt(s2) * o.lam * 1e9) / (2 * Math.PI), strehl: Math.exp(-s2), alpha };
}

// Monte Carlo with phase screens: one layer of r₀ (at the wavelength of the phases), aperture D on
// an m × m grid; the star sees φ(x), the laser φ(αx) (bilinear interpolation of the screen). Returns
// the mean residual variance (piston and, optionally, tilt removed) and the last realisation's maps.
export function coneMC({ D, r0, alpha, screens = 20, m = 48, tilt = true, seed = 11, N = 256, span = 2.2 }) {
  const dx = (span * D) / N, L0 = 1e4, c = N / 2;
  const at = (scr, x, y) => {
    const fx = x / dx + c, fy = y / dx + c, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * N + i;
    return scr[k] * (1 - tx) * (1 - ty) + scr[k + 1] * tx * (1 - ty) + scr[k + N] * (1 - tx) * ty + scr[k + N + 1] * tx * ty;
  };
  const pts = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { const x = ((i + 0.5) / m - 0.5) * D, y = ((j + 0.5) / m - 0.5) * D; if (x * x + y * y <= (D / 2) ** 2) pts.push([x, y, i, j]); }
  let acc = 0, maps = null;
  for (let s = 0; s < screens; s++) {
    const scr = phaseScreen(N, dx, r0, L0, seed + s);
    const star = pts.map(([x, y]) => at(scr, x, y)), las = pts.map(([x, y]) => at(scr, alpha * x, alpha * y)), e = star.map((v, i) => v - las[i]);
    // remove piston and tilt by least squares (x, y and 1 are orthogonal on the symmetric grid)
    let mean = 0, ax = 0, ay = 0, xx = 0, yy = 0;
    pts.forEach(([x, y], i) => { mean += e[i]; ax += e[i] * x; ay += e[i] * y; xx += x * x; yy += y * y; });
    mean /= pts.length; ax /= xx; ay /= yy;
    let v = 0;
    const res = e.map((ei, i) => { const [x, y] = pts[i]; const r = ei - mean - (tilt ? ax * x + ay * y : 0); v += r * r; return r; });
    acc += v / pts.length;
    if (s === screens - 1) maps = { m, pts: pts.map((p) => [p[2], p[3]]), star, las, res };
  }
  return { s2: acc / screens, maps };
}

// The page's computation: σ² against the laser's height for the current telescope (the factor F for
// each footprint α, which carries all of the physics), and one phase-screen realisation of the high
// layer for the maps. o = { D, H, r0, wHigh, hHigh, zeta, lam, Hs (heights) }.
export function lgsLab(o) {
  const curve = o.Hs.map((H) => ({ H, ...coneError({ ...o, H, n: 30000 }) }));
  const r0z = o.r0 * Math.pow(Math.cos(o.zeta || 0), 3 / 5), rHigh = r0z * Math.pow(Math.max(o.wHigh, 1e-6), -3 / 5);
  const mc = coneMC({ D: o.D, r0: rHigh, alpha: Math.max(0, 1 - o.hHigh / o.H), screens: 1, m: 64, seed: o.seed || 3 });
  return { curve, maps: mc.maps };
}
