// Interference filters in converging light: the passband of a thin-film filter shifts to shorter
// wavelengths with the angle of incidence, λ(θ) = λ₀√(1 − (sin θ/n*)²) with effective index n*. In
// an f/N cone the filter sees every angle up to arctan(1/2N) (plus the chief-ray angle off axis),
// so the passband blurs and moves bluewards, and a narrow emission line can fall off its edge.

export const LINES = { ha: ['Hα', 656.28], oiii: ['[O III]', 500.7], sii: ['[S II]', 671.6], hb: ['Hβ', 486.13] };
export const shifted = (lam0, theta, n) => lam0 * Math.sqrt(1 - (Math.sin(theta) / n) ** 2);
// Steep-edged passband: a super-Gaussian of order 6 with the given FWHM, peak 1.
export const passband = (lam, centre, fwhm) => Math.exp(-Math.LN2 * Math.abs((2 * (lam - centre)) / fwhm) ** 6);

// Transmission at wavelength λ averaged over the cone of an f/N beam whose axis is tilted by the
// chief-ray angle θc (uniformly illuminated circular pupil, sampled in polar coordinates).
export function coneTransmission(lam, { centre, fwhm, n, N, chief = 0, nr = 24, nt = 24 }) {
  const a = Math.atan(1 / (2 * N));
  let s = 0, wsum = 0;
  for (let i = 0; i < nr; i++) {
    const r = Math.sqrt((i + 0.5) / nr) * Math.tan(a); // equal-area rings in the pupil (tan of the ray angle)
    for (let j = 0; j < nt; j++) {
      const t = ((j + 0.5) / nt) * 2 * Math.PI;
      const ux = r * Math.cos(t) + Math.tan(chief), uy = r * Math.sin(t);
      const theta = Math.atan(Math.hypot(ux, uy));
      s += passband(lam, shifted(centre, theta, n), fwhm); wsum++;
    }
  }
  return s / wsum;
}
// The shift of the passband centre that best restores a line (scanned in 0.05 nm steps).
export function bestPreshift(lineNm, o) {
  let best = [0, coneTransmission(lineNm, { ...o, centre: lineNm })];
  for (let d = 0; d <= 3 * o.fwhm; d += 0.05) { const T = coneTransmission(lineNm, { ...o, centre: lineNm + d }); if (T > best[1]) best = [d, T]; }
  return { shift: best[0], T: best[1] };
}
