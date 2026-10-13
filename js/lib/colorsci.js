// Colour science on tabulated spectra (380–780 nm, 5 nm): tristimulus values, chromaticity,
// Planckian and CIE daylight illuminants, correlated colour temperature and Duv, the CIE 13.3
// colour rendering index, chromatic adaptation, CIELAB and CIEDE2000.
import { CMF, DBASIS, TCS, NWL, WL0, DWL } from './colordata.js';

export const LAMBDA = Array.from({ length: NWL }, (_, i) => WL0 + i * DWL);

// Tristimulus values of a spectrum (radiance, or reflectance × illuminant), unnormalised.
export function xyz(spd) {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < NWL; i++) { X += spd[i] * CMF[0][i]; Y += spd[i] * CMF[1][i]; Z += spd[i] * CMF[2][i]; }
  return [X, Y, Z];
}
export const chromaticity = ([X, Y, Z]) => { const s = X + Y + Z; return [X / s, Y / s]; };
// CIE 1960 UCS (u, v); CIE 1976 u′ = u, v′ = 1.5 v.
export const uv1960 = ([X, Y, Z]) => { const d = X + 15 * Y + 3 * Z; return [(4 * X) / d, (6 * Y) / d]; };

// Planck's law, relative spectral radiance at λ (nm) for temperature T (K), c2 = 1.4388 × 10⁻² m K.
export const planck = (lam, T) => { const l = lam * 1e-9; return 1 / (l ** 5 * (Math.exp(1.4388e-2 / (l * T)) - 1)); };
export const blackbody = (T) => { const s = LAMBDA.map((l) => planck(l, T)), n = s[34]; return s.map((v) => (100 * v) / n); }; // 1 at 550 nm → 100

// CIE daylight of correlated colour temperature T (4000–25000 K), CIE 15:2018 §3.1.
export function daylight(T) {
  const x = T <= 7000
    ? -4.607e9 / T ** 3 + 2.9678e6 / T ** 2 + 0.09911e3 / T + 0.244063
    : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 0.24748e3 / T + 0.23704;
  const y = -3 * x * x + 2.87 * x - 0.275, M = 0.0241 + 0.2562 * x - 0.7341 * y;
  const M1 = (-1.3515 - 1.7703 * x + 5.9114 * y) / M, M2 = (0.03 - 31.4424 * x + 30.0717 * y) / M;
  return DBASIS.S0.map((s0, i) => s0 + M1 * DBASIS.S1[i] + M2 * DBASIS.S2[i]);
}

// Correlated colour temperature: the Planckian temperature nearest in CIE 1960 (u, v), by golden-
// section search on 1/T, and Duv (signed distance, + above the locus).
const planckUV = (T) => uv1960(xyz(LAMBDA.map((l) => planck(l, T))));
export function cct(XYZ) {
  const [u, v] = uv1960(XYZ), d2 = (T) => { const [a, b] = planckUV(T); return (a - u) ** 2 + (b - v) ** 2; };
  let lo = 1 / 30000, hi = 1 / 1000; // search in mired-like space
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo), b = lo + g * (hi - lo), fa = d2(1 / a), fb = d2(1 / b);
  for (let k = 0; k < 80; k++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = d2(1 / a); }
    else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = d2(1 / b); }
  }
  const T = 2 / (lo + hi), [up, vp] = planckUV(T), [u2, v2] = planckUV(T * 1.001);
  // sign: + when the point lies above the locus (to the left of the direction of decreasing T)
  const cross = (u2 - up) * (v - vp) - (v2 - vp) * (u - up);
  return { T, duv: Math.sign(-cross || 1) * Math.sqrt(d2(T)) };
}

// CIE 13.3-1995 colour rendering index. Returns { Ra, R: [R1 … R14], cct, duv, ref }.
export function cri(spd) {
  const { T, duv } = cct(xyz(spd));
  const ref = T < 5000 ? blackbody(T) : daylight(T);
  const prep = (S) => {
    const W = xyz(S), k = 100 / W[1];
    const [u, v] = uv1960(W), c = (4 - u - 10 * v) / v, d = (1.708 * v + 0.404 - 1.481 * u) / v;
    const samples = TCS.map((r) => { const X = xyz(S.map((s, i) => s * r[i])).map((q) => q * k); return { Y: X[1], uv: uv1960(X) }; });
    return { u, v, c, d, samples };
  };
  const t = prep(spd), r = prep(ref);
  const R = t.samples.map((st, i) => {
    const sr = r.samples[i];
    // von Kries-type adaptation of the test sample to the reference white
    const [ui, vi] = st.uv, ci = (4 - ui - 10 * vi) / vi, di = (1.708 * vi + 0.404 - 1.481 * ui) / vi;
    const cc = (r.c / t.c) * ci, dd = (r.d / t.d) * di, den = 16.518 + 1.481 * cc - dd;
    const ua = (10.872 + 0.404 * cc - 4 * dd) / den, va = 5.52 / den;
    const uvw = (Y, uu, vv) => { const W = 25 * Math.cbrt(Y) - 17; return [13 * W * (uu - r.u), 13 * W * (vv - r.v), W]; };
    const a = uvw(st.Y, ua, va), b = uvw(sr.Y, sr.uv[0], sr.uv[1]);
    return 100 - 4.6 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
  return { Ra: R.slice(0, 8).reduce((s, x) => s + x, 0) / 8, R, cct: T, duv, ref };
}

// ── adaptation, display and colour differences ─────────────────────────────────────────────
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADFORD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
const mv = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
// Bradford chromatic adaptation of XYZ from white Ws to white Wd.
export function adapt(XYZ, Ws, Wd) {
  const a = mv(BRADFORD, XYZ), s = mv(BRADFORD, Ws), d = mv(BRADFORD, Wd);
  return mv(BRADFORD_INV, [a[0] * d[0] / s[0], a[1] * d[1] / s[1], a[2] * d[2] / s[2]]);
}
export const D65_XYZ = [95.047, 100, 108.883];
// XYZ (Y = 100 for white) → linear sRGB (D65)
export const xyzToSRGB = ([X, Y, Z]) => [
  (3.2406 * X - 1.5372 * Y - 0.4986 * Z) / 100,
  (-0.9689 * X + 1.8758 * Y + 0.0415 * Z) / 100,
  (0.0557 * X - 0.204 * Y + 1.057 * Z) / 100,
];

export function lab([X, Y, Z], W = D65_XYZ) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X / W[0]), fy = f(Y / W[1]), fz = f(Z / W[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), kL = kC = kH = 1.
export function deltaE00(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { hb = Math.abs(hp1 - hp2) <= 180 ? hb / 2 : hp1 + hp2 < 360 ? (hb + 360) / 2 : (hb - 360) / 2; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T, Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// Colour of a reflectance under an illuminant, as seen by an observer adapted to that
// illuminant, shown on an sRGB display (Bradford to D65). Returns linear sRGB.
export function sampleSRGB(refl, spd) {
  const W = xyz(spd), k = 100 / W[1];
  const X = xyz(spd.map((s, i) => s * refl[i])).map((q) => q * k);
  return xyzToSRGB(adapt(X, W.map((q) => q * k), D65_XYZ));
}
