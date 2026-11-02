// Exoplanet transits: the dip in starlight when a planet crosses its star. Light curve of a
// limb-darkened star occulted by an opaque disc (numerical integration over the overlap),
// orbit geometry from Kepler's third law, and the photometric noise of a telescope. Pure functions.
// Lengths in units of the stellar radius unless stated.

export const G = 6.674e-11, MSUN = 1.989e30, RSUN = 6.957e8, REARTH = 6.371e6, RJUP = 7.1492e7, AU = 1.496e11, DAY = 86400;

// Quadratic limb darkening I(μ)/I(1) = 1 − u₁(1 − μ) − u₂(1 − μ)², and the star's total flux
// ∫ I 2πr dr = π (1 − u₁/3 − u₂/6).
export const intensity = (r, u1, u2) => { if (r >= 1) return 0; const m = 1 - Math.sqrt(1 - r * r); return 1 - u1 * m - u2 * m * m; };
export const totalFlux = (u1, u2) => Math.PI * (1 - u1 / 3 - u2 / 6);

// Gauss–Legendre nodes and weights on [−1, 1] (Newton on P_n), computed once.
function gaussLegendre(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), dp = 1;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let j = 2; j <= n; j++) { const p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j; p0 = p1; p1 = p2; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp; z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}
const GL = { 32: gaussLegendre(32) };

// Relative flux when the planet (radius k) is at projected distance z from the star's centre.
// The blocked light is ∫ I(r) θ(r) r dr over the star, θ(r) being the angle of the circle of
// radius r that the planet covers: 2 arccos((r² + z² − k²)/(2rz)), or 2π where the planet covers the
// whole circle. The integral is split where θ or I stops being smooth (|z − k| and the limb) and
// each piece is mapped by r = a + (b − a) sin²(πs/2), which removes the square-root endpoints, then
// integrated by n-point Gauss–Legendre (n = 32: relative error below 10⁻⁹). No overlap gives
// exactly 1, a planet covering the whole star exactly 0.
export function fluxAt(z, k, u1, u2, n = 32) {
  const g = GL[n] || (GL[n] = gaussLegendre(n));
  z = Math.abs(z);
  if (!(k > 0) || z >= 1 + k) return 1;
  if (z + 1 <= k) return 0;
  const theta = (r) => {
    if (r <= k - z) return 2 * Math.PI;
    if (r >= z + k || r <= z - k || z === 0) return 0;
    return 2 * Math.acos(Math.max(-1, Math.min(1, (r * r + z * z - k * k) / (2 * r * z))));
  };
  const lo = Math.max(0, z - k), hi = Math.min(1, z + k), cuts = [lo];
  if (k - z > lo && k - z < hi) cuts.push(k - z);
  cuts.push(hi);
  let blocked = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = cuts[c], b = cuts[c + 1];
    for (let i = 0; i < n; i++) {
      const s = (g.x[i] + 1) / 2, sn = Math.sin((Math.PI * s) / 2), r = a + (b - a) * sn * sn;
      const dr = (b - a) * (Math.PI / 2) * Math.sin(Math.PI * s); // dr/ds
      blocked += (g.w[i] / 2) * intensity(r, u1, u2) * theta(r) * r * dr;
    }
  }
  return Math.max(0, 1 - blocked / totalFlux(u1, u2));
}
// Area of overlap of the unit disc and a disc of radius k at distance z (for tests and the
// uniform-star check).
export function overlapArea(z, k) {
  z = Math.abs(z);
  if (z >= 1 + k) return 0;
  if (z <= k - 1) return Math.PI;
  if (z <= 1 - k) return Math.PI * k * k;
  const a1 = Math.acos((z * z + k * k - 1) / (2 * z * k)), a2 = Math.acos((z * z + 1 - k * k) / (2 * z));
  return k * k * a1 + a2 - 0.5 * Math.sqrt(Math.max(0, (-z + k + 1) * (z + k - 1) * (z - k + 1) * (z + k + 1)));
}

// Orbit: semi-major axis from Kepler's third law (circular orbit), impact parameter, total
// duration T₁₄ (Seager & Mallén-Ornelas 2003) and the probability (R★ + R_p)/a that a random
// orientation shows any transit. The model is a detached circular orbit: a ≤ R★ + R_p (the planet
// inside its star) or b > a/R★ (no inclination gives it) is not a system; valid = false and reason
// 'inside' or 'b' say why. A valid orbit with b ≥ 1 + k is a real miss (T14 = NaN).
export function orbit({ P, Mstar, Rstar, Rp, b }) {
  const a = Math.cbrt((G * Mstar * MSUN * (P * DAY) ** 2) / (4 * Math.PI * Math.PI)); // m
  const aR = a / (Rstar * RSUN), k = Rp / (Rstar * RSUN), base = { a, aR, k, depth: k * k, prob: Math.min(1, (1 + k) / aR) };
  if (aR <= 1 + k) return { ...base, valid: false, reason: 'inside', inc: NaN, T14: NaN };
  if (b > aR) return { ...base, valid: false, reason: 'b', inc: NaN, T14: NaN };
  const inc = Math.acos(b / aR);
  const arg = Math.sqrt(Math.max(0, (1 + k) ** 2 - b * b)) / (aR * Math.sin(inc));
  const T14 = b >= 1 + k ? NaN : ((P * DAY) / Math.PI) * Math.asin(Math.min(1, arg)); // s
  return { ...base, valid: true, inc, T14 };
}
// Projected separation z(t) at time t (s) from mid-transit.
export const zAt = (t, P, aR, inc) => { const ph = (2 * Math.PI * t) / (P * DAY); return aR * Math.hypot(Math.sin(ph), Math.cos(inc) * Math.cos(ph)); };

// Mean relative flux over an exposure of length texp (s) centred on tc (s from mid-transit). An
// exposure that does not overlap the transit, |tc| ≥ (T14 + texp)/2, sees exactly 1; otherwise
// the light curve is averaged over m equal sub-intervals at their midpoints, m chosen so that each
// lasts at most T14/200 (supersampling, Kipping 2010), unless m is given.
export function exposureFlux(tc, texp, sys, m) {
  const { P, aR, inc, k, u1, u2, T14 } = sys;
  if (!(T14 > 0) || Math.abs(tc) >= (T14 + texp) / 2) return 1;
  m = m || Math.min(2000, Math.max(1, Math.ceil(texp / (T14 / 200))));
  let s = 0;
  for (let i = 0; i < m; i++) s += fluxAt(zAt(tc - texp / 2 + ((i + 0.5) * texp) / m, P, aR, inc), k, u1, u2);
  return s / m;
}
// The exposures of one transit: back to back (100 % duty cycle), one centred on mid-transit,
// covering ±span. Returns [time, mean flux] pairs.
export function sampleTransit(sys, texp, span, max = 4000) {
  const out = [], n = Math.min(max >> 1, Math.floor(span / texp));
  for (let i = -n; i <= n; i++) out.push([i * texp, exposureFlux(i * texp, texp, sys)]);
  return out;
}

// Photon noise per exposure: a star of magnitude V through an aperture of diameter D (m) with
// throughput q in a 100 nm-wide V band (10⁶ photons s⁻¹ cm⁻² at V = 0, so the collecting area is
// 10⁴ π (D/2)² cm²). Returns ppm per exposure of length t (s). The same V-band model is used for every
// telescope: bandpasses and stellar spectra are not modelled.
export function precision({ V, D, q = 0.5, t }) {
  const photons = 1e6 * Math.pow(10, -0.4 * V) * 1e4 * Math.PI * (D / 2) ** 2 * q * t;
  return 1e6 / Math.sqrt(photons);
}
// Signal-to-noise ratio of one transit, from its exposure-averaged deficits d_i = 1 − F_i, with
// white noise σ_w per exposure (independent) and a correlated floor σ_r shared by every in-transit
// exposure (pointing, detector and atmospheric drifts slower than the transit; Pont, Zucker &
// Queloz 2006), against a known baseline. SNR² = dᵀC⁻¹d with C = σ_w² I + σ_r² 11ᵀ over the n
// in-transit exposures:
//   SNR² = (Σd² − σ_r² (Σd)² / (σ_w² + n σ_r²)) / σ_w²,
// which for a box of depth δ is δ² / (σ_w²/n + σ_r²): more exposures cannot beat the floor.
// Transits are independent of each other, so N of them give √N times this. Same units for all.
export function transitSNR(d, sigmaW, sigmaR = 0) {
  let s1 = 0, s2 = 0, n = 0;
  for (const x of d) if (x > 0) { s1 += x; s2 += x * x; n++; }
  if (!n || !(sigmaW > 0)) return 0;
  const w2 = sigmaW * sigmaW, r2 = sigmaR * sigmaR;
  return Math.sqrt(Math.max(0, (s2 - (r2 * s1 * s1) / (w2 + n * r2)) / w2));
}
