// Thermal focus shift: how a lens or a telescope goes out of focus when its temperature changes, and
// how glasses and mount materials are chosen to cancel it (athermalisation).
// Glass index against temperature from SCHOTT's TIE-19 formula (absolute index, Δn_abs with the six
// constants D0, D1, D2, E0, E1, λ_TK of each glass), the air index from Edlén's formula as given in
// TIE-19, so a lens can be taken from air into vacuum; thin lenses whose curvatures shrink or grow
// with the glass; a barrel that grows with its material; a Cassegrain telescope traced paraxially.
import { index, abbe } from './glass.js';
import { N_ } from './i18n.js';

export const T0 = 20, P0 = 101325, LAMBDA = 0.5876; // °C, Pa, µm (d line)

// Thermal constants: SCHOTT glasses (D0, D1, D2, E0, E1, λ_TK; expansion −30…+70 °C), from the
// SCHOTT Zemax catalogue 2017-01-20b as compiled by refractiveindex.info (CC0); crystals with a single
// dn/dT (taken as absolute) and expansion from the Crystran handbook (2023), same compilation.
export const THERMO = {
  'N-BK7': { D: [1.86e-6, 1.31e-8, -1.37e-11, 4.34e-7, 6.27e-10, 0.17], cte: 7.1e-6 },
  'N-BAK4': { D: [3.06e-6, 1.44e-8, -2.23e-11, 5.46e-7, 6.05e-10, 0.189], cte: 6.99e-6 },
  'N-SK16': { D: [-2.37e-8, 1.32e-8, -1.29e-11, 4.09e-7, 5.17e-10, 0.17], cte: 6.3e-6 },
  'P-SK57': { D: [2.6e-6, 9.4e-9, -2.3e-11, 4.9e-7, 5.96e-10, 0.178], cte: 7.23e-6 },
  'N-LAK22': { D: [1.36e-6, 1.49e-8, -1.29e-11, 3.41e-7, 2.09e-10, 0.262], cte: 6.6e-6 },
  'N-FK51A': { D: [-1.83e-5, -7.89e-9, -1.63e-12, 3.74e-7, 3.46e-10, 0.15], cte: 12.74e-6 },
  'N-PK52A': { D: [-1.97e-5, -5.5e-9, 5.28e-12, 3.6e-7, 2.45e-10, 0.172], cte: 13.01e-6 },
  'N-BAF10': { D: [3.79e-6, 1.28e-8, -1.42e-11, 5.84e-7, 7.6e-10, 0.22], cte: 6.18e-6 },
  'N-KZFS4': { D: [1.81e-6, 1.16e-8, -7.99e-12, 6.2e-7, 7.94e-10, 0.205], cte: 7.3e-6 },
  'F2': { D: [1.51e-6, 1.56e-8, -2.78e-11, 9.34e-7, 1.04e-9, 0.25], cte: 8.2e-6 },
  'N-SF5': { D: [-2.51e-7, 1.07e-8, -2.4e-11, 7.85e-7, 1.15e-9, 0.278], cte: 7.94e-6 },
  'N-SF11': { D: [-3.56e-6, 9.2e-9, -2.1e-11, 9.65e-7, 1.44e-9, 0.294], cte: 8.52e-6 },
  'N-SF6': { D: [-4.93e-6, 7.02e-9, -2.4e-11, 9.84e-7, 1.54e-9, 0.29], cte: 9.03e-6 },
  'N-LASF9': { D: [1.05e-6, 1.02e-8, -2.38e-11, 9.19e-7, 1.18e-9, 0.257], cte: 7.37e-6 },
  'CaF2': { dndt: -10.6e-6, cte: 18.85e-6 },
  'Fused silica': { dndt: 12.9e-6, cte: 0.55e-6 },
};
export const THERMO_GLASSES = Object.keys(THERMO);

// Expansion coefficients (1/K) of mount and structure materials near room temperature: typical values.
export const MATERIALS = {
  aluminium: { name: N_('Aluminium'), cte: 23.1e-6 },
  steel: { name: N_('Stainless steel'), cte: 17.3e-6 },
  titanium: { name: N_('Titanium alloy'), cte: 8.6e-6 },
  invar: { name: N_('Invar'), cte: 1.2e-6 },
  cfrp: { name: N_('Carbon-fibre composite'), cte: 0.5e-6 },
  plastic: { name: N_('Polycarbonate'), cte: 65e-6 },
  borosilicate: { name: N_('Borosilicate glass'), cte: 3.25e-6 },
  silica: { name: N_('Fused silica'), cte: 0.55e-6 },
  ule: { name: N_('Ultra-low-expansion glass'), cte: 0.02e-6 },
};

// The index of air (Edlén 1953, in TIE-19): at 15 °C and P0, then scaled to T and P.
export function nAir(lam = LAMBDA, T = T0, P = P0) {
  const l2 = lam * lam, n15 = 1e-8 * (6432.8 + (2949810 * l2) / (146 * l2 - 1) + (25540 * l2) / (41 * l2 - 1));
  return 1 + (n15 / (1 + 3.4785e-3 * (T - 15))) * (P / P0);
}

// The absolute index at T: the catalogue (relative to air at 20 °C and P0) times the air index, plus
// Δn_abs = (n² − 1)/(2n) [D0ΔT + D1ΔT² + D2ΔT³ + (E0ΔT + E1ΔT²)/(λ² − λ_TK²)].
export function nAbs(glass, lam = LAMBDA, T = T0) {
  const n = index(glass, lam * 1000), G = THERMO[glass], dT = T - T0;
  let dn;
  if (G.D) {
    const [D0, D1, D2, E0, E1, lTK] = G.D;
    dn = ((n * n - 1) / (2 * n)) * (D0 * dT + D1 * dT * dT + D2 * dT ** 3 + (E0 * dT + E1 * dT * dT) / (lam * lam - Math.sign(lTK) * lTK * lTK));
  } else dn = G.dndt * dT;
  return n * nAir(lam, T0, P0) + dn;
}
// The index relative to the surrounding medium: air at T and P (P = 0: vacuum).
export const nRel = (glass, lam = LAMBDA, T = T0, P = P0) => nAbs(glass, lam, T) / nAir(lam, T, P);
// Average dn/dT over [T1, T2] (the form of SCHOTT's catalogue values).
export const dndt = (glass, lam, T1, T2, P = P0) => (nRel(glass, lam, T2, P) - nRel(glass, lam, T1, P)) / (T2 - T1);
// The thermal power coefficient of a thin lens, (1/φ) dφ/dT = (dn/dT)/(n − 1) − α (Jamieson 1981).
export function gamma(glass, lam = LAMBDA, T = T0, P = P0) {
  const h = 0.5, d = (nRel(glass, lam, T + h, P) - nRel(glass, lam, T - h, P)) / (2 * h);
  return d / (nRel(glass, lam, T, P) - 1) - THERMO[glass].cte;
}

// ── A thin lens or a cemented achromat in a barrel ──
// Powers are set at 20 °C in air: an achromat splits φ as φ1 = φV1/(V1 − V2), φ2 = −φV2/(V1 − V2).
// At T each element's curvature scales by 1/(1 + αΔT) and its index is the relative index then; the
// sensor sits at the 20 °C focus on a barrel that grows by α_h.
export function lensDesign(g1, g2, f) {
  const phi = 1 / f, els = [];
  if (!g2) els.push({ g: g1, phi });
  else { const V1 = abbe(g1), V2 = abbe(g2); els.push({ g: g1, phi: (phi * V1) / (V1 - V2) }, { g: g2, phi: (-phi * V2) / (V1 - V2) }); }
  for (const e of els) e.c = e.phi / (nRel(e.g) - 1); // curvature sum 1/R1 − 1/R2 at 20 °C
  return els;
}
export function lensFocus(els, T, P = P0, lam = LAMBDA) {
  let phi = 0;
  for (const e of els) phi += ((nRel(e.g, lam, T, P) - 1) * e.c) / (1 + THERMO[e.g].cte * (T - T0));
  return 1 / phi;
}
// Defocus at the sensor (mm; + = focus behind the sensor) and its two parts.
export function lensDefocus(els, f, alphaH, T, P = P0, lam = LAMBDA) {
  const f0 = lensFocus(els, T0, P0, lam), fT = lensFocus(els, T, P, lam), L = f0 * (1 + alphaH * (T - T0));
  return { focus: fT, sensor: L, lensPart: fT - f0, housingPart: L - f0, defocus: fT - L };
}
// The athermal-chart intercept (Tamagawa et al. 1994): for an achromat, the line through the two
// glasses in the (ω = 1/V, γ) plane meets ω = 0 at γ = −α_h of the barrel that keeps it in focus.
export const intercept = (g1, g2, P = P0) => {
  const w1 = 1 / abbe(g1), w2 = 1 / abbe(g2), y1 = gamma(g1, LAMBDA, T0, P), y2 = gamma(g2, LAMBDA, T0, P);
  return (y1 * w2 - y2 * w1) / (w2 - w1);
};

// ── A Cassegrain telescope ──
// Primary of focal length f1 = F1·D, a convex secondary magnifying m times, final focus b behind the
// primary's vertex. Mirrors expand with α_m, the spacing and the instrument's distance with α_t.
export function cassegrain({ D, F1, m, b }) {
  const f1 = F1 * D, d = (m * f1 - b) / (m + 1), s = f1 - d, f2 = (m * s) / (m - 1);
  return { D, F1, m, b, f1, d, f2, N: m * F1 };
}
export function cassDefocus(c, alphaM, alphaT, T) {
  const dT = T - T0, f1 = c.f1 * (1 + alphaM * dT), f2 = c.f2 * (1 + alphaM * dT), d = c.d * (1 + alphaT * dT), b = c.b * (1 + alphaT * dT);
  const s = f1 - d, sp = 1 / (1 / s - 1 / f2), img = sp - d;
  return { defocus: img - b, image: img, detector: b, dd: d - c.d };
}

// Depth of focus ±2λN² (quarter-wave of defocus) and the blur-circle diameter |Δ|/N.
export const depthOfFocus = (N, lamUm = LAMBDA) => 2 * lamUm * 1e-3 * N * N; // mm
export const blur = (defocusMm, N) => Math.abs(defocusMm) / N;
