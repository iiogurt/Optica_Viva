// Lenses made of diffraction. A Fresnel zone plate has rings with radii r_n = √(n λ₀ f) (paraxial):
// alternate Fresnel zones of its focus are blocked (amplitude plate) or delayed by half a wave (phase
// plate), so the light from the rest arrives in step. In q = ρ² every zone is an interval of equal
// width λ₀f, the Fresnel integral over a zone is elementary, and the field on the axis is an exact
// sum. A Talbot carpet is the field behind a grating of period d: a Fourier series whose orders
// travel with phases e^{ikz√(1 − (mλ/d)²)}, re-forming the grating at the Talbot distance
// z_T = 2d²/λ in the paraxial limit. Lengths in metres.
import { besselJ0 } from './starshade.js';

// Transmission of zone n (n = 1, 2, …): amplitude plates pass odd zones and block even ones; phase
// plates pass all, the even ones delayed by π.
const zoneT = (n, kind) => (n % 2 ? [1, 0] : kind === 'phase' ? [-1, 0] : [0, 0]);

// The field on the axis at distance z behind the plate (N zones, focal length f at λ₀), lit by a unit
// plane wave of wavelength λ: U = (−iπ/λz) Σ_n t_n ∫_{q_{n−1}}^{q_n} e^{iπq/λz} dq, relative to the
// incident field. Returns [re, im].
export function axialField({ f, lam0, N, kind }, lam, z) {
  const c = Math.PI / (lam * z), w = lam0 * f;
  let re = 0, im = 0;
  for (let n = 1; n <= N; n++) {
    const [tr] = zoneT(n, kind);
    if (!tr) continue;
    // ∫ e^{icq} dq = (e^{icq_b} − e^{icq_a})/(ic)
    const a = c * (n - 1) * w, b = c * n * w, ir = (Math.sin(b) - Math.sin(a)) / c, ii = -(Math.cos(b) - Math.cos(a)) / c;
    re += tr * ir; im += tr * ii;
  }
  // × (−iπ/λz): (re + i im)(−i)·π/λz
  return [(Math.PI / (lam * z)) * im, -(Math.PI / (lam * z)) * re];
}
export const axialI = (zp, lam, z) => { const [a, b] = axialField(zp, lam, z); return a * a + b * b; };
// a perfect lens of the same aperture (radius √(Nλ₀f)) focused at f: (π r²/λf)² on the axis at f
export const lensPeak = ({ f, lam0, N }, lam) => ((Math.PI * N * lam0 * f) / (lam * f)) ** 2;
// focal length of order m at wavelength λ (orders 1, 3, 5 … focus; f scales as 1/λ)
export const orderFocus = ({ f, lam0 }, lam, m = 1) => (f * lam0) / (lam * m);
// diffraction efficiency of order m (Fourier coefficient of the zones in q): amplitude 1/m²π², phase 4/m²π², odd m
export const efficiency = (kind, m = 1) => (m % 2 ? (kind === 'phase' ? 4 : 1) / (m * m * Math.PI * Math.PI) : 0);

// The irradiance across the focal plane at distance z (radii rs), each zone integrated in q with the
// phase exact per step (Filon) and the Bessel factor sampled, relative to the incident irradiance.
export function focalProfile({ f, lam0, N, kind }, lam, z, rs, perZone = 32) {
  const k = Math.PI / (lam * z), w = lam0 * f, dq = w / perZone, wt = (2 * Math.sin((k * dq) / 2)) / k;
  return rs.map((r) => {
    const s = (2 * Math.PI * r) / (lam * z);
    let re = 0, im = 0;
    for (let n = 1; n <= N; n++) {
      const [tr] = zoneT(n, kind);
      if (!tr) continue;
      for (let i = 0; i < perZone; i++) {
        const q = (n - 1) * w + (i + 0.5) * dq, g = tr * (r ? besselJ0(s * Math.sqrt(q)) : 1);
        re += g * Math.cos(k * q); im += g * Math.sin(k * q);
      }
    }
    re *= wt * (Math.PI / (lam * z)); im *= wt * (Math.PI / (lam * z));
    return re * re + im * im;
  });
}

// ---- Talbot self-imaging ------------------------------------------------------------------
// Fourier coefficients of a binary amplitude grating of duty cycle p (open fraction): c₀ = p,
// c_m = sin(πmp)/(πm).
export const gratingC = (m, p) => (m ? Math.sin(Math.PI * m * p) / (Math.PI * m) : p);
export const talbotLength = (d, lam) => (2 * d * d) / lam;
// The irradiance at (x, z): Σ_m c_m e^{i2πmx/d} e^{iφ_m(z)} with φ_m = kz(√(1 − (mλ/d)²) − 1) exact, or
// −πλz m²/d² paraxial; evanescent orders are left out. Returns a function of (x, z) and the orders kept.
export function talbotField({ d, p, lam, exact = true, M = 40 }) {
  const k = (2 * Math.PI) / lam, mmax = Math.min(M, Math.floor(d / lam)), orders = [];
  for (let m = -mmax; m <= mmax; m++) { const s = 1 - (m * lam / d) ** 2; if (s > 0) orders.push({ m, c: gratingC(m, p), kz: exact ? k * (Math.sqrt(s) - 1) : (-Math.PI * lam * m * m) / (d * d) }); }
  const I = (x, z) => {
    let re = 0, im = 0;
    for (const o of orders) { const ph = (2 * Math.PI * o.m * x) / d + o.kz * z; re += o.c * Math.cos(ph); im += o.c * Math.sin(ph); }
    return re * re + im * im;
  };
  return { I, orders: orders.length };
}
// The carpet: nx × nz irradiance over two periods and zmax, row 0 at z = 0.
export function carpet(o, nx, nz, zmax) {
  const F = talbotField(o), a = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) { const z = (zmax * j) / (nz - 1); for (let i = 0; i < nx; i++) a[j * nx + i] = F.I((2 * o.d * (i + 0.5)) / nx, z); }
  return { a, nx, nz, zmax, orders: F.orders };
}
// How closely the pattern at z repeats the grating's (correlation coefficient over a period).
export function selfImage(o, z, n = 400) {
  const F = talbotField(o), a = [], b = [];
  for (let i = 0; i < n; i++) { const x = (o.d * (i + 0.5)) / n; a.push(F.I(x, 0)); b.push(F.I(x, z)); }
  const mean = (v) => v.reduce((s, q) => s + q, 0) / v.length, ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb || 1);
}

// The page's Talbot computation: the carpet over 0…2z_T and how well the grating re-forms along z
// (exact and paraxial). o = { d, p, lam, exact }.
export function talbotLab(o) {
  const zT = talbotLength(o.d, o.lam), C = carpet(o, 128, 360, 2 * zT);
  const zs = Array.from({ length: 121 }, (_, i) => (2 * zT * i) / 120);
  const corr = (exact) => zs.map((z) => selfImage({ ...o, exact }, z, 200));
  return { ...C, zT, zs, exact: corr(true), paraxial: corr(false) };
}
