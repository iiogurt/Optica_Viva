// Atmospheric dispersion and its correction. Refractive index of air by Edlén (1966) for standard
// dry air (15 °C, 101 325 Pa), scaled to pressure and temperature (Edlén's P–T correction). The
// refraction of a star at true zenith angle z is R ≈ (n − 1) tan z (plane-parallel atmosphere,
// valid to ≈ 1 % for z < 70°). An atmospheric dispersion corrector (ADC) of two identical
// zero-deviation prism doublets rotated by ±θ gives a dispersion 2 δ(λ) cos θ along one axis.
import { index } from './glass.js';

// (n − 1) of standard dry air, λ in nm.
export function airRefractivity(lam) {
  const s2 = (1000 / lam) ** 2;
  return (8342.54 + 2406147 / (130 - s2) + 15998 / (38.9 - s2)) * 1e-8;
}
// Pressure P (Pa) and temperature T (°C) correction (Edlén 1966, dry air).
export function airRefractivityPT(lam, P = 101325, T = 15) {
  const ns = airRefractivity(lam);
  return (ns * P * (1 + P * (0.601 - 0.00972 * T) * 1e-8)) / (96095.43 * (1 + 0.003661 * T));
}
const ARCSEC = Math.PI / 648000;
// Refraction (arcsec) at zenith angle z (rad).
export const refraction = (lam, z, P, T) => (airRefractivityPT(lam, P, T) * Math.tan(z)) / ARCSEC;
// Dispersion (arcsec) between two wavelengths.
export const dispersion = (l1, l2, z, P, T) => refraction(l1, z, P, T) - refraction(l2, z, P, T);

// Thin zero-deviation prism doublet: glasses g1 (apex A1) and g2 (apex A2, opposed) with
// A1(n1 − 1) = A2(n2 − 1) at λc. Angular dispersion (rad) δ(λ) = A1(n1(λ) − 1) − A2(n2(λ) − 1),
// zero at λc. `scale` converts it to sky arcsec (divide by the telescope-to-ADC beam ratio).
export function adcPrism(g1, g2, A1, lamC) {
  const A2 = (A1 * (index(g1, lamC) - 1)) / (index(g2, lamC) - 1);
  return { A1, A2, delta: (lam) => A1 * (index(g1, lam) - 1) - A2 * (index(g2, lam) - 1) };
}
// Rotation angle θ of each doublet that cancels the atmospheric dispersion between λa and λb at
// zenith angle z: 2 δ cos θ · k = ΔR_air (k = arcsec per rad of prism dispersion on the sky).
export function adcAngle(prism, k, la, lb, z, P, T) {
  const need = dispersion(la, lb, z, P, T), have = 2 * k * (prism.delta(la) - prism.delta(lb));
  const c = need / have;
  return Math.abs(c) <= 1 ? Math.acos(c) : 0; // beyond the ADC's range: maximum correction
}
// Residual dispersion (arcsec, relative to λ0) with the ADC set to angle θ.
export function residual(lam, lam0, prism, k, theta, z, P, T) {
  return (refraction(lam, z, P, T) - refraction(lam0, z, P, T)) - 2 * k * Math.cos(theta) * (prism.delta(lam) - prism.delta(lam0));
}
