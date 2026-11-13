// Haze and aerial perspective. Along a horizontal path through uniform air, an object's radiance is
// attenuated and replaced by airlight (Koschmieder 1924):
//   L(z) = L0 e^{−βz} + L_air (1 − e^{−βz}),   L_air = E [β_R P_R(θ) + ω0 β_a P_a(θ)] / β,
// so a black object's contrast against the horizon falls as e^{−βz} and vanishes below the 2 %
// threshold at the visual range V = ln 50 / β = 3.912/β. β = β_R + β_a: Rayleigh scattering by
// the molecules (from the refractive index of air) and aerosol extinction with Ångström's λ^−α.
import { nAir } from './thermal.js';
import { LAMBDA, xyz, xyzToSRGB, daylight } from './colorsci.js';

export const KOSCHMIEDER = Math.log(50); // 3.912
const KB = 1.380649e-23, T_STD = 288.15, P_STD = 101325, RHO = 0.0279; // depolarisation of air
export const N_AIR = P_STD / (KB * T_STD); // molecules per m³ at 15 °C, 1 atm

// Rayleigh cross-section and scattering coefficient: σ = 24π³(n² − 1)²/(λ⁴N²(n² + 2)²) · (6 + 3ρ)/(6 − 7ρ).
export function rayleighSigma(lamNm) {
  const n = nAir(lamNm / 1000, 15), l = lamNm * 1e-9;
  return ((24 * Math.PI ** 3 * (n * n - 1) ** 2) / (l ** 4 * N_AIR ** 2 * (n * n + 2) ** 2)) * ((6 + 3 * RHO) / (6 - 7 * RHO));
}
export const betaR = (lamNm) => rayleighSigma(lamNm) * N_AIR; // 1/m
export const pureAirRange = () => KOSCHMIEDER / betaR(550); // m
// The aerosol extinction that gives visual range V (m) at 550 nm, and its value at λ (Ångström α).
export const betaA550 = (V) => Math.max(0, KOSCHMIEDER / V - betaR(550));
export const betaA = (lamNm, V, alpha) => betaA550(V) * (lamNm / 550) ** -alpha;
export const beta = (lamNm, V, alpha) => betaR(lamNm) + betaA(lamNm, V, alpha);

// Phase functions (per steradian) at scattering angle θ (0 = forward), and the polarisation of
// Rayleigh light, sin²θ/(1 + cos²θ) (ignoring the depolarisation of air).
export const phaseR = (th) => (3 / (16 * Math.PI)) * (1 + Math.cos(th) ** 2);
export const phaseHG = (th, g = 0.7) => (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * Math.cos(th)) ** 1.5);
export const polR = (th) => Math.sin(th) ** 2 / (1 + Math.cos(th) ** 2);
export const OMEGA = 0.9, G = 0.7; // aerosol single-scattering albedo and asymmetry (typical continental)

// Reflectances: green vegetation (chlorophyll bands and the red edge near 700 nm) and grey rock.
export function reflectance(kind, lamNm) {
  if (kind === 'rock') return 0.22 + 0.06 * (lamNm - 400) / 500;
  const edge = 1 / (1 + Math.exp(-(lamNm - 715) / 12)), green = 0.06 * Math.exp(-(((lamNm - 550) / 35) ** 2));
  return 0.04 + green + 0.42 * edge;
}

// Spectral radiances of an object at distance z (m) seen through the haze, split into the
// attenuated object and the airlight in front of it. pol: 0 none, 1 polariser at its best
// (crossed with the Rayleigh polarisation), 2 at its worst; a polariser passes half of the
// unpolarised light. Sunlight is CIE D55; E = 1 at every wavelength times its spectrum.
const SUN = daylight(5500);
export function radiance(lamNm, s, { V, alpha, theta, pol = 0 }, kind, z, shade) {
  const bR = betaR(lamNm), bA = betaA(lamNm, V, alpha), b = bR + bA, T = Math.exp(-b * z);
  const airR = (bR * phaseR(theta)) / b, airA = (OMEGA * bA * phaseHG(theta, G)) / b, p = polR(theta);
  const fR = pol === 1 ? 0.5 * (1 - p) : pol === 2 ? 0.5 * (1 + p) : 1, fU = pol ? 0.5 : 1;
  const obj = kind ? (reflectance(kind, lamNm) * shade) / Math.PI : 0;
  return { obj: s * obj * T * fU, air: s * (airR * fR + airA * fU) * (1 - T), T };
}
// sRGB (linear) of the object part and the airlight part at distance z, white-balanced to sunlight.
const WHITE = xyzToSRGB(xyz(SUN.map((s) => s / Math.PI)));
export function colours(opts, kind, z, shade) {
  const o = [], a = [];
  LAMBDA.forEach((l, i) => { const r = radiance(l, SUN[i], opts, kind, z, shade); o.push(r.obj); a.push(r.air); });
  const wb = (c) => c.map((v, k) => v / WHITE[k]);
  return { obj: wb(xyzToSRGB(xyz(o))), air: wb(xyzToSRGB(xyz(a))) };
}
// The same in the near infrared (850 nm, a camera with a visible-blocking filter): grey levels.
export function infrared(opts, kind, z, shade) {
  const r = radiance(850, 1, opts, kind, z, shade), white = 1 / Math.PI;
  return { obj: r.obj / white, air: r.air / white };
}
// The sky at elevation e above the horizon (illustrative): single scattering along a slant path through
// layers of scale height 8 km (molecules) and 1.5 km (haze), L = E Σ(τ_i P_i ω_i)/τ · (1 − e^{−τ}) with
// τ_i = β_i H_i / (sin e + H_i/300 km); it saturates to the horizon airlight near e = 0 and turns blue higher up.
export const H_R = 8000, H_A = 1500;
function skySpectral(lamNm, s, { V, alpha, theta, pol = 0 }, elev) {
  // effective path in each layer: H/sin e, capped at L0 so that at the horizon both layers weigh by β (as the airlight in front of distant ridges)
  const se = Math.sin(Math.max(0, elev)), L0 = 3e5, tR = betaR(lamNm) * (H_R / (se + H_R / L0)), tA = betaA(lamNm, V, alpha) * (H_A / (se + H_A / L0)), tau = tR + tA, p = polR(theta);
  const fR = pol === 1 ? 0.5 * (1 - p) : pol === 2 ? 0.5 * (1 + p) : 1, fU = pol ? 0.5 : 1;
  return (s * ((tR * phaseR(theta) * fR + OMEGA * tA * phaseHG(theta, G) * fU) / tau) * (1 - Math.exp(-tau)));
}
export function skyColour(opts, elev, ir = false) {
  if (ir) return skySpectral(850, 1, opts, elev) * Math.PI;
  const a = LAMBDA.map((l, i) => skySpectral(l, SUN[i], opts, elev));
  return xyzToSRGB(xyz(a)).map((v, k) => v / WHITE[k]);
}
// Apparent contrast of a black object against the horizon sky: −e^{−βz}.
export const contrast = (lamNm, z, V, alpha) => -Math.exp(-beta(lamNm, V, alpha) * z);
