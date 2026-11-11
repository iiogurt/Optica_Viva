// HDR displays: how brightness is coded for a screen. Pure functions; luminance in cd/m² (nits),
// signals ("code values") normalised to 0 … 1.
//
// SDR (ITU-R BT.1886): L = L_w · V^2.4 (black level 0 here), with L_w = 100 nits for the reference
// display.
// PQ (SMPTE ST 2084, ITU-R BT.2100): an absolute curve from 0 to 10 000 nits, designed by Miller,
// Nezamabadi & Daly (2013) so that each step of a 12-bit code stays just below the contrast the eye
// can see (Barten's model) at every luminance:
//   L = 10000 · (max(E^(1/m2) − c1, 0) / (c2 − c3 E^(1/m2)))^(1/m1),
//   m1 = 2610/16384, m2 = 2523/4096·128, c1 = 3424/4096, c2 = 2413/4096·32, c3 = 2392/4096·32.
// HLG (ARIB STD-B67, BT.2100): relative, compatible with SDR screens. The camera's OETF is
// E' = √(3E) for E ≤ 1/12 and a·ln(12E − b) + c above (a = 0.17883277, b = 1 − 4a, c = 0.5 − a·ln 4a);
// the display applies the inverse and a system gamma γ = 1.2 + 0.42·log10(L_w/1000) to the luminance.

import { N_ } from './i18n.js';

export const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 };
export function pqEOTF(E) {
  const { m1, m2, c1, c2, c3 } = PQ, p = Math.pow(Math.max(0, E), 1 / m2);
  return 10000 * Math.pow(Math.max(p - c1, 0) / (c2 - c3 * p), 1 / m1);
}
export function pqInverse(L) {
  const { m1, m2, c1, c2, c3 } = PQ, y = Math.pow(Math.max(0, L) / 10000, m1);
  return Math.pow((c1 + c2 * y) / (1 + c3 * y), m2);
}

export const HLG = (() => { const a = 0.17883277, b = 1 - 4 * a, c = 0.5 - a * Math.log(4 * a); return { a, b, c }; })();
export const hlgOETF = (E) => (E <= 1 / 12 ? Math.sqrt(3 * E) : HLG.a * Math.log(12 * E - HLG.b) + HLG.c);
export const hlgInverseOETF = (V) => (V <= 0.5 ? (V * V) / 3 : (Math.exp((V - HLG.c) / HLG.a) + HLG.b) / 12);
export const hlgGamma = (Lw) => 1.2 + 0.42 * Math.log10(Lw / 1000);
// Displayed luminance of an HLG signal on a display of peak Lw (grey scale: the OOTF on luminance).
export const hlgEOTF = (V, Lw = 1000) => { const E = hlgInverseOETF(V); return Lw * Math.pow(E, hlgGamma(Lw)); };
export function hlgInverse(L, Lw = 1000) { const E = Math.pow(Math.max(0, L) / Lw, 1 / hlgGamma(Lw)); return hlgOETF(Math.min(1, E)); }

export const sdrEOTF = (V, Lw = 100) => Lw * Math.pow(Math.max(0, V), 2.4);
export const sdrInverse = (L, Lw = 100) => Math.pow(Math.min(1, Math.max(0, L) / Lw), 1 / 2.4);

// The encodings compared, with their full-scale luminance.
export const CODINGS = {
  sdr8: { label: N_('SDR, gamma 2.4, 8 bit (100 nits)'), bits: 8, eotf: (v) => sdrEOTF(v), inv: (L) => sdrInverse(L), peak: 100 },
  sdr10: { label: N_('SDR, gamma 2.4, 10 bit (100 nits)'), bits: 10, eotf: (v) => sdrEOTF(v), inv: (L) => sdrInverse(L), peak: 100 },
  hlg10: { label: N_('HLG, 10 bit (1000-nit display)'), bits: 10, eotf: (v) => hlgEOTF(v, 1000), inv: (L) => hlgInverse(L, 1000), peak: 1000 },
  pq10: { label: N_('PQ, 10 bit'), bits: 10, eotf: pqEOTF, inv: pqInverse, peak: 10000 },
  pq12: { label: N_('PQ, 12 bit'), bits: 12, eotf: pqEOTF, inv: pqInverse, peak: 10000 },
};

// The relative luminance step between neighbouring code values at luminance L: ΔL/L.
export function stepAt(code, L) {
  const n = 2 ** code.bits - 1, v = code.inv(L), k = Math.round(v * n);
  if (k < 1 || k >= n) return NaN;
  const a = code.eotf(k / n), b = code.eotf((k + 1) / n);
  return (b - a) / a;
}
// L quantised by an encoding (to the nearest code value).
export function quantise(code, L) { const n = 2 ** code.bits - 1; return code.eotf(Math.round(code.inv(L) * n) / n); }

// Some light levels (nits) for comparison. Sunlit white paper: 100 000 lux × 0.8 / π.
export const LEVELS = [
  [N_('Moonlit landscape'), 0.01], [N_('DCI cinema (screen white)'), 48], [N_('SDR television (reference white)'), 100], [N_('Dolby Cinema (screen white)'), 108],
  [N_('HDR television (peak, typical)'), 1000], [N_('Phone (HDR peak)'), 1600], [N_('PQ ceiling'), 10000], [N_('Sunlit white paper'), 25000],
];
