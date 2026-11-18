// Television Lighting Consistency Index TLCI-2012 (EBU Tech 3355): a light judged by what a standard
// broadcast camera and display make of the 18 coloured ColorChecker patches under it, compared with a
// reference light of the same correlated colour temperature. Everything follows the document: its
// tables (tlcidata.js), 380–760 nm in 5 nm steps, CCT on the tabulated Planckian locus (up to 5000 K)
// or daylight locus (above), the camera chain balance → matrix → 90 % saturation → BT.709 OETF, a
// display with gamma 2.4 and BT.709 primaries, CIEDE2000, a fourth-power mean and Qa = 100/(1 + (ΔE/3.16)^2.4).
import { CMF2, BASIS, PLANCK_LOCUS, DAYLIGHT_LOCUS, CHECKER, CAMERA, CAMERA_MATRIX, NWL, WL0 } from './tlcidata.js';
import { lab, deltaE00 } from './colorsci.js';

export const TLCI_WL = Array.from({ length: NWL }, (_, i) => WL0 + 5 * i);
const dot = (a, b) => { let s = 0; for (let i = 0; i < NWL; i++) s += a[i] * b[i]; return s; };
const mv = (M, x) => M.map((r) => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]);
const uv = (x, y) => { const d = -2 * x + 12 * y + 3; return [(4 * x) / d, (6 * y) / d]; };
const locus = (tab) => tab.map(([T, x, y]) => [T, uv(x, y)]);
const PL = locus(PLANCK_LOCUS), DL = locus(DAYLIGHT_LOCUS);

// Foot of the normal from (u, v) to a tabulated locus, interpolated between neighbouring entries
// (equations [4]–[8]); side < 0 when the point lies above the locus, towards green.
function nearest(L, u, v) {
  let best = null;
  for (let i = 0; i < L.length - 1; i++) {
    const [T0, [u0, v0]] = L[i], [T1, [u1, v1]] = L[i + 1], du = u1 - u0, dv = v1 - v0;
    const s = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv)));
    const pu = u0 + s * du, pv = v0 + s * dv, d = Math.hypot(u - pu, v - pv);
    if (!best || d < best.d) best = { d, T: T0 + s * (T1 - T0), side: Math.sign(du * (v - pv) - dv * (u - pu)) || 1 };
  }
  return best;
}

// CCT the EBU way, and d: the distance from the locus in units of 0.0054 (negative towards green),
// with the 4000–5000 K correction of equations [16]–[17].
export function cctEBU(spd) {
  const X = dot(spd, CMF2[0]), Y = dot(spd, CMF2[1]), Z = dot(spd, CMF2[2]), s = X + Y + Z, [u, v] = uv(X / s, Y / s);
  const p = nearest(PL, u, v);
  if (p.T >= 5000) { const q = nearest(DL, u, v); return { T: q.T, d: (q.side * q.d) / 0.0054, locus: 'daylight' }; }
  let d = (p.side * p.d) / 0.0054;
  if (p.T > 4000) d = d > 0 ? d + (0.9 * (5000 - p.T)) / 1000 : d - (0.9 * (p.T - 4000)) / 1000;
  return { T: p.T, d, locus: 'Planckian' };
}

// Reference spectra, each 100 at 560 nm: Planck with c2 = 1.435e7 nm K [9]; CIE daylight with the
// CIE 15:2004 coefficients and the EBU's 5 nm vectors [10]–[14]; between 3400 and 5000 K a linear
// mix of the Planckian at 3400 K and daylight at 5000 K [15].
const I560 = (560 - WL0) / 5;
export function planckEBU(T) {
  const f = (l) => l ** -5 / (Math.exp(1.435e7 / (l * T)) - 1), n = f(560);
  return TLCI_WL.map((l) => (100 * f(l)) / n);
}
export function daylightEBU(T) {
  const t = 1e3 / T, x = T < 7000 ? -4.607 * t ** 3 + 2.9678 * t ** 2 + 0.09911 * t + 0.244063 : -2.0064 * t ** 3 + 1.9018 * t ** 2 + 0.24748 * t + 0.23704;
  const y = -3 * x * x + 2.87 * x - 0.275, den = 0.25539 * x - 0.73217 * y + 0.02387;
  const M1 = (-1.77861 * x + 5.90757 * y - 1.34674) / den, M2 = (-31.44464 * x + 30.064 * y + 0.03638) / den;
  const s = BASIS[0].map((s0, i) => s0 + M1 * BASIS[1][i] + M2 * BASIS[2][i]), n = s[I560];
  return s.map((q) => (100 * q) / n);
}
export function referenceEBU(T) {
  if (T < 3400) return planckEBU(T);
  if (T > 5000) return daylightEBU(T);
  const D = daylightEBU(5000), P = planckEBU(3400);
  return D.map((d, i) => (d * (T - 3400) + P[i] * (5000 - T)) / 1600);
}

// The notional camera and display.
const SAT = (() => { const a = (1 - 90 / 100) / 3; return [[1 - 2 * a, a, a], [a, 1 - 2 * a, a], [a, a, 1 - 2 * a]]; })();
export const oetf709 = (L) => (L < 0.018 ? 4.5 * L : 1.099 * L ** 0.45 - 0.099);
const DISPLAY = [[0.412391, 0.357584, 0.180481], [0.212639, 0.715169, 0.072192], [0.019331, 0.119195, 0.950532]];
const WHITE = DISPLAY.map((r) => 100 * (r[0] + r[1] + r[2]));
// Each patch under a light: balanced so that a 90 % neutral gives R = G = B = 1, then matrix,
// saturation, OETF (signal V′), display (gamma 2.4) and XYZ (Y = 100 for display white).
export function camera(spd) {
  const g = CAMERA.map((c) => 0.9 * dot(spd, c));
  return CHECKER.map((r) => {
    const L = spd.map((s, i) => s * r[i]), C = CAMERA.map((c, k) => dot(L, c) / g[k]);
    const B = mv(SAT, mv(CAMERA_MATRIX, C)), V = B.map(oetf709);
    const D = V.map((q) => Math.sign(q) * Math.abs(q) ** 2.4), XYZ = mv(DISPLAY, D).map((q) => 100 * q);
    return { V, XYZ, Lab: lab(XYZ, WHITE), clipped: [...C, ...B].some((q) => q < 0) };
  });
}

// TLCI of a spectrum on the 380–780 nm or 380–760 nm grid (5 nm). Qa is null when every coloured
// patch is clipped.
export const fromQa = (dE) => 100 / (1 + (dE / 3.16) ** 2.4);
export function tlci(spdIn) {
  const spd = spdIn.slice(0, NWL), c = cctEBU(spd), ref = referenceEBU(c.T);
  const test = camera(spd), refc = camera(ref);
  const patches = test.map((t, i) => {
    const r = refc[i], used = i < 18 && !t.clipped && !r.clipped;
    return { test: t.V, ref: r.V, dE: deltaE00(r.Lab, t.Lab), used };
  });
  const used = patches.filter((p) => p.used);
  const dEa = used.length ? (used.reduce((s, p) => s + p.dE ** 4, 0) / used.length) ** 0.25 : NaN;
  return { ...c, ref, patches, n: used.length, dEa, Qa: used.length ? fromQa(dEa) : null };
}
