// Exoplanet transits: the dip in starlight when a planet crosses its star. Light curve of a
// limb-darkened star occulted by an opaque disc (numerical integration over the planet's disc),
// orbit geometry from Kepler's third law, and the photometric noise of a telescope. Pure functions.
// Lengths in units of the stellar radius unless stated.

export const G = 6.674e-11, MSUN = 1.989e30, RSUN = 6.957e8, REARTH = 6.371e6, RJUP = 7.1492e7, AU = 1.496e11, DAY = 86400;

// Quadratic limb darkening I(μ)/I(1) = 1 − u₁(1 − μ) − u₂(1 − μ)², and the star's total flux
// ∫ I 2πr dr = π (1 − u₁/3 − u₂/6).
export const intensity = (r, u1, u2) => { if (r >= 1) return 0; const m = 1 - Math.sqrt(1 - r * r); return 1 - u1 * m - u2 * m * m; };
export const totalFlux = (u1, u2) => Math.PI * (1 - u1 / 3 - u2 / 6);

// Relative flux when the planet (radius k) is at projected distance z from the star's centre.
// Polar quadrature over the planet's disc, exact in the limit of many points.
export function fluxAt(z, k, u1, u2, nr = 24, nt = 48) {
  if (z >= 1 + k) return 1;
  let blocked = 0;
  for (let i = 0; i < nr; i++) {
    const rr = ((i + 0.5) / nr) * k, dA = (k / nr) * rr * ((2 * Math.PI) / nt);
    for (let j = 0; j < nt; j++) {
      const t = ((j + 0.5) / nt) * 2 * Math.PI, x = z + rr * Math.cos(t), y = rr * Math.sin(t);
      blocked += intensity(Math.hypot(x, y), u1, u2) * dA;
    }
  }
  return 1 - blocked / totalFlux(u1, u2);
}

// Orbit: semi-major axis from Kepler's third law (circular orbit), impact parameter, total
// duration T₁₄ (Seager & Mallén-Ornelas 2003) and the transit probability R★/a.
export function orbit({ P, Mstar, Rstar, Rp, b }) {
  const a = Math.cbrt((G * Mstar * MSUN * (P * DAY) ** 2) / (4 * Math.PI * Math.PI)); // m
  const aR = a / (Rstar * RSUN), k = Rp / (Rstar * RSUN);
  const inc = Math.acos(Math.min(1, b / aR));
  const arg = Math.sqrt(Math.max(0, (1 + k) ** 2 - b * b)) / (aR * Math.sin(inc));
  const T14 = b >= 1 + k || arg >= 1 ? NaN : ((P * DAY) / Math.PI) * Math.asin(arg); // s
  return { a, aR, k, inc, T14, prob: 1 / aR, depth: k * k };
}
// Projected separation z(t) at time t (s) from mid-transit.
export const zAt = (t, P, aR, inc) => { const ph = (2 * Math.PI * t) / (P * DAY); return aR * Math.hypot(Math.sin(ph), Math.cos(inc) * Math.cos(ph)); };

// Photometric precision per exposure: photon noise of a star of magnitude V through aperture D (m)
// with throughput q in a 100 nm-wide V band (10⁶ photons s⁻¹ cm⁻² at V = 0), added in quadrature to
// a systematic floor (ppm). Returns ppm per exposure of length t (s).
export function precision({ V, D, q = 0.5, t, floor }) {
  const photons = 1e6 * Math.pow(10, -0.4 * V) * Math.PI * (D * 50) ** 2 * q * t;
  return Math.hypot(1e6 / Math.sqrt(photons), floor);
}
// Signal-to-noise ratio of the transit depth from n in-transit exposures with precision σ (ppm).
export const transitSNR = (depthPPM, sigmaPPM, n) => (depthPPM / sigmaPPM) * Math.sqrt(n);
