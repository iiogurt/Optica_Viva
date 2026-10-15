// Mission "Plan an exoplanet observation": direct imaging of a planet beside its star. Reflected-
// light contrast, angular separation against the inner working angle, and the integration time
// for a planet buried in residual starlight (speckles). Pure functions.

export const AU_KM = 1.496e8, PC_AU = 206264.8, RJ_KM = 71492, RE_KM = 6371;
// Planets: radius (km), orbit (AU), geometric albedo.
export const PLANETS = {
  earth: { name: 'Earth twin', R: RE_KM, a: 1, Ag: 0.37 },
  jupiter: { name: 'Jupiter twin', R: RJ_KM, a: 5.2, Ag: 0.5 },
  superearth: { name: 'Super-Earth in the habitable zone', R: 1.5 * RE_KM, a: 1, Ag: 0.3 },
};

// Contrast in reflected light at quadrature (phase function 1/π for a Lambert sphere at 90°).
export const reflectedContrast = (Ag, Rkm, aAU, phase = 1 / Math.PI) => Ag * phase * (Rkm / (aAU * AU_KM)) ** 2;
// Angular separation at maximum elongation (mas) for orbit a (AU) at distance d (pc).
export const separationMas = (aAU, dPc) => (aAU / dPc) * 1000;
export const lambdaOverD = (lamUm, D) => ((lamUm * 1e-6) / D) * 206264.8e3; // mas

// Photon rate of a Sun-like star at d pc (V = 4.83 + 5 log₁₀(d/10)) through aperture D in a band of
// width bandNm (100 nm ≈ 20 % at 550 nm) at end-to-end throughput q (mirrors, coronagraph core
// throughput, detector), using 10⁶ photons s⁻¹ cm⁻² per 100 nm at V = 0.
export function starRate(dPc, D, q = 0.2, bandNm = 100) {
  const V = 4.83 + 5 * Math.log10(dPc / 10);
  return 1e6 * Math.pow(10, -0.4 * V) * Math.PI * (D * 50) ** 2 * q * (bandNm / 100);
}
// Integration time for SNR s on the planet: planet rate Fp = C·F★, background from residual
// starlight in the planet's resolution element Fb = floor·F★ (speckle contrast), photon noise only.
export function integrationTime(C, floor, Fstar, snr = 5, Fzodi = 0) {
  const Fp = C * Fstar, Fb = floor * Fstar + Fzodi;
  return (snr * snr * (Fp + Fb)) / (Fp * Fp);
}
// Zodiacal light in the planet's photometric aperture (radius 0.7 λ/D): the Solar System's own dust
// (about 22.5 V mag/arcsec²) plus the target system's exozodiacal dust (about 22 mag/arcsec² per
// "zodi" of dust at 1 AU from a Sun-like star).
export function zodiRate(lamUm, D, q, nExo = 3, bandNm = 100) {
  const r = 0.7 * lambdaOverD(lamUm, D) / 1000, area = Math.PI * r * r; // arcsec²
  const sb = Math.pow(10, -0.4 * 22.5) + nExo * Math.pow(10, -0.4 * 22);
  return 1e6 * sb * area * Math.PI * (D * 50) ** 2 * q * (bandNm / 100);
}

export function plan({ planet = 'earth', d = 10, D = 6, lam = 0.55, iwa = 3, floor = 1e-10, q = 0.05, nExo = 3, snr = 7, R = 70 }) {
  const P = PLANETS[planet];
  const C = reflectedContrast(P.Ag, P.R, P.a);
  const sep = separationMas(P.a, d), lD = lambdaOverD(lam, D), iwaMas = iwa * lD;
  const Fs = starRate(d, D, q);
  const Fz = zodiRate(lam, D, q, nExo);
  const t = integrationTime(C, floor, Fs, snr, Fz);
  // a spectrum at resolving power R splits the 20 % band into 0.2 R channels
  const tSpec = integrationTime(C, floor, Fs / (0.2 * R), snr, Fz / (0.2 * R));
  return { P, C, sep, lD, iwaMas, outside: sep > iwaMas, sepLD: sep / lD, Fs, Fz, t, tSpec, aboveFloor: C > floor, V: 4.83 + 5 * Math.log10(d / 10) };
}
