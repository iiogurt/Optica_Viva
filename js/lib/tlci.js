// Television Lighting Consistency Index TLCI-2012 (EBU Tech 3355): a light judged by what a standard
// broadcast camera and display make of the 18 coloured ColorChecker patches under it, compared with a
// reference light of the same correlated colour temperature. Everything follows the document: its
// tables (tlcidata.js), 380–760 nm in 5 nm steps, CCT on the tabulated Planckian locus (up to 5000 K)
// or daylight locus (above), the camera chain balance → matrix → 90 % saturation → BT.709 OETF, a
// display with gamma 2.4 and BT.709 primaries, CIEDE2000, a fourth-power mean and Qa = 100/(1 + (ΔE/3.16)^2.4).
import { CMF2, BASIS, PLANCK_LOCUS, DAYLIGHT_LOCUS, CHECKER, CAMERA, CAMERA_MATRIX, NWL, WL0 } from './tlcidata.js';
import { lab, deltaE00Parts } from './colorsci.js';

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

// CCT the EBU way, and d: the distance from that locus in units of 0.0054 (negative towards green).
// The document's adjustment of d between 4000 and 5000 K ([16]–[17]) is left out: as printed it
// moves a black body at 4500 K off its own locus and makes daylight jump at 5000 K. d is a readout
// only and does not enter Qa.
export function cctEBU(spd) {
  const X = dot(spd, CMF2[0]), Y = dot(spd, CMF2[1]), Z = dot(spd, CMF2[2]), s = X + Y + Z, [u, v] = uv(X / s, Y / s);
  const p = nearest(PL, u, v);
  if (p.T >= 5000) { const q = nearest(DL, u, v); return { T: q.T, d: (q.side * q.d) / 0.0054, locus: 'daylight' }; }
  return { T: p.T, d: (p.side * p.d) / 0.0054, locus: 'Planckian' };
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
// Each patch under a light, then matrix, saturation, OETF (signal V′), display (gamma 2.4) and XYZ
// (Y = 100 for display white). The camera is balanced on `balanceTo` so that a 90 % neutral gives
// R = G = B = 1: on the light itself for TLCI, on the reference luminaire for TLMF, where the test
// light is then only scaled so that the 90 % neutral's luma (BT.709 weights) is 1.
export function camera(spd, { balanceTo = spd, normaliseLuma = false } = {}) {
  const g = CAMERA.map((c) => 0.9 * dot(balanceTo, c));
  let k = 1;
  if (normaliseLuma) { const n = CAMERA.map((c, j) => (0.9 * dot(spd, c)) / g[j]); k = 1 / (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]); }
  return CHECKER.map((r) => {
    const L = spd.map((s, i) => s * r[i]), C = CAMERA.map((c, j) => (k * dot(L, c)) / g[j]);
    const B = mv(SAT, mv(CAMERA_MATRIX, C)), V = B.map(oetf709);
    const D = V.map((q) => Math.sign(q) * Math.abs(q) ** 2.4), XYZ = mv(DISPLAY, D).map((q) => 100 * q);
    return { V, XYZ, Lab: lab(XYZ, WHITE), clipped: [...C, ...B].some((q) => q < 0) };
  });
}

// Compare the patches seen under a test and a reference light; `count` patches take part (18 for
// TLCI, all 24 for TLMF), less any that clip. Qa is null when none is left.
export const fromQa = (dE) => 100 / (1 + (dE / 3.16) ** 2.4);
function compare(test, refc, count) {
  const patches = test.map((t, i) => {
    const r = refc[i], parts = deltaE00Parts(r.Lab, t.Lab);
    return { test: t.V, ref: r.V, dE: parts.dE, parts, used: i < count && !t.clipped && !r.clipped };
  });
  const used = patches.filter((p) => p.used);
  const dEa = used.length ? (used.reduce((s, p) => s + p.dE ** 4, 0) / used.length) ** 0.25 : NaN;
  return { patches, n: used.length, dEa, Qa: used.length ? fromQa(dEa) : null, advice: advice(patches) };
}

// The colourist's advice table (Tech 3355 §2.1): each used patch goes to one of 12 hue sectors of
// 30°, centred on the primaries, secondaries and the colours between, by the hue of its BT.709
// colour-difference signals under the test light; per sector the mean ΔL, ΔC and ΔH (CIEDE2000
// terms, test − reference) give a correction of round(6Δ/3.16) steps in the opposite direction.
// Sectors without a patch take the mean of their nearest filled neighbours on either side.
export const SECTORS = ['R', 'R/Y', 'Y', 'Y/G', 'G', 'G/C', 'C', 'C/B', 'B', 'B/M', 'M', 'M/R'];
export function hueEBU([R, G, B]) {
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, CR = 0.635 * (R - Y), CB = 0.5389 * (B - Y);
  const h = (Math.atan2(CR, CB) * 180) / Math.PI;
  return (h + 360) % 360;
}
const RED = hueEBU([1, 0, 0]);
export function advice(patches) {
  const acc = SECTORS.map(() => ({ n: 0, L: 0, C: 0, H: 0 }));
  for (const p of patches) {
    if (!p.used) continue;
    const s = acc[Math.floor((((hueEBU(p.test) - RED + 15) % 360) + 360) % 360 / 30) % 12];
    s.n++; s.L += p.parts.dL; s.C += p.parts.dC; s.H += p.parts.dH;
  }
  const mean = acc.map((a) => (a.n ? { L: a.L / a.n, C: a.C / a.n, H: a.H / a.n } : null));
  return mean.map((m, j) => {
    let filled = m, interpolated = false;
    if (!m) {
      const find = (dir) => { for (let k = 1; k < 12; k++) { const q = mean[(j + dir * k + 12) % 12]; if (q) return q; } return null; };
      const a = find(-1), b = find(1);
      if (a && b) filled = { L: (a.L + b.L) / 2, C: (a.C + b.C) / 2, H: (a.H + b.H) / 2 };
      interpolated = true;
    }
    const steps = (d) => -Math.round((6 * d) / 3.16) || 0;
    return { sector: SECTORS[j], n: acc[j].n, interpolated, L: filled && steps(filled.L), C: filled && steps(filled.C), H: filled && steps(filled.H) };
  });
}

// TLCI of a spectrum on the 380–780 nm or 380–760 nm grid (5 nm).
export function tlci(spdIn) {
  const spd = spdIn.slice(0, NWL), c = cctEBU(spd), ref = referenceEBU(c.T);
  return { ...c, ref, ...compare(camera(spd), camera(ref), 18) };
}

// TLMF-2013: how well a test luminaire matches a real reference luminaire in the same shot. The
// camera is balanced to the reference; all 24 patches count, since a colour cast shows on greys.
export function tlmf(testIn, refIn) {
  const spd = testIn.slice(0, NWL), ref = refIn.slice(0, NWL);
  return compare(camera(spd, { balanceTo: ref, normaliseLuma: true }), camera(ref), 24);
}
