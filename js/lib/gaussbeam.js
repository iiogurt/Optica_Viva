// Gaussian laser beams. A beam of waist w₀ at wavelength λ has the complex beam parameter
// q = z + i z_R, z_R = π w₀²/(M² λ), and keeps its Gaussian profile, with
//   w(z) = w₀ √(1 + (z/z_R)²),   R(z) = z (1 + (z_R/z)²),   Gouy phase ψ(z) = atan(z/z_R).
// Thin lenses and gaps transform q by the ray-transfer matrix, q′ = (Aq + B)/(Cq + D) (Kogelnik & Li
// 1966); a real beam of quality M² follows the same laws with the waist M times the embedded
// Gaussian's (Siegman). Independently, the field of an M² = 1 beam is propagated numerically through a
// lens of clear radius a by the Fresnel integral, which also shows what a hard aperture does.
// Lengths in metres.
import { besselJ0 } from './starshade.js';

// complex arithmetic on [re, im]
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
export const rayleigh = (w0, lam, M2 = 1) => (Math.PI * w0 * w0) / (M2 * lam);
export const divergence = (w0, lam, M2 = 1) => (M2 * lam) / (Math.PI * w0);
// width and curvature radius from q: 1/q = 1/R − i M²λ/(πw²)
export function beamOf(q, lam, M2 = 1) {
  const iq = cdiv([1, 0], q);
  return { w: Math.sqrt((M2 * lam) / (Math.PI * -iq[1])), R: iq[0] === 0 ? Infinity : 1 / iq[0] };
}
export const qWaist = (w0, lam, M2 = 1, z = 0) => [z, rayleigh(w0, lam, M2)];
export const propagate = (q, d) => [q[0] + d, q[1]];
export const lens = (q, f) => cdiv(q, [1 - q[0] / f, -q[1] / f]); // q′ = q / (1 − q/f)
// The waist after a thin lens: its size and its distance behind the lens, for a beam whose own waist
// lies s before the lens (Self 1983: 1/(s + z_R²/(s − f)) + 1/s′ = 1/f).
export function focus(w0, lam, M2, s, f) {
  const q = lens(propagate(qWaist(w0, lam, M2), s), f), zr = q[1], d = -q[0];
  return { w0p: Math.sqrt((M2 * lam * zr) / Math.PI), sp: d, zRp: zr };
}
// Self's lens formula, solved for s′ (a check on the matrix route)
export const selfImage = (s, f, zR) => 1 / (1 / f - 1 / (s + (zR * zR) / (s - f)));

// The field behind the lens, numerically: the beam arrives at the lens with width w and wavefront
// radius R (both from q), passes a clear radius a and a thin lens f, and travels a distance z. With
// q = ρ² the Fresnel integral
//   U(r) = (k/iz) e^{ikr²/2z} ∫₀^a e^{−ρ²/w²} e^{i(k/2)ρ²(1/z + 1/R − 1/f)} J₀(krρ/z) ρ dρ
// has a phase linear in q, integrated exactly over each step (Filon); the amplitude and the Bessel
// factor are sampled, with one Richardson step. Returns the irradiance at radii rs, relative to the
// axial irradiance of the beam at the lens.
export function fieldAfter({ w, R, f, a, z, lam }, rs, steps = 1500) {
  const one = (n) => fresnel(w, R, f, a, z, lam, rs, n), A = one(steps), B = one(2 * steps);
  return A.map((v, i) => { const re = (4 * B[i][0] - v[0]) / 3, im = (4 * B[i][1] - v[1]) / 3; return re * re + im * im; });
}
function fresnel(w, R, f, a, z, lam, rs, steps) {
  const k = (2 * Math.PI) / lam, Q = Math.min(a * a, 25 * w * w), dq = Q / steps;
  // a diverging wavefront carries +kρ²/2R, the lens −kρ²/2f, the Fresnel kernel +kρ²/2z (convention e^{+ikz})
  const c = (k / 2) * (1 / z + (isFinite(R) ? 1 / R : 0) - 1 / f); // phase per unit q
  const wgt = Math.abs(c * dq) < 1e-12 ? dq : (2 * Math.sin((c * dq) / 2)) / c, pre = k / (2 * z); // ρ dρ = dq/2
  return rs.map((r) => {
    let re = 0, im = 0;
    for (let i = 0; i < steps; i++) {
      const q = (i + 0.5) * dq, g = Math.exp(-q / (w * w)) * (r ? besselJ0((k * r * Math.sqrt(q)) / z) : 1);
      re += g * Math.cos(c * q); im += g * Math.sin(c * q);
    }
    return [pre * wgt * re, pre * wgt * im];
  });
}
// The 1/e² radius of a profile I(r) (relative to its axial value), by interpolation; NaN if it never falls that far.
export function radiusE2(rs, I) {
  const t = I[0] * Math.exp(-2);
  for (let i = 1; i < rs.length; i++) if (I[i] <= t) return rs[i - 1] + ((I[i - 1] - t) / (I[i - 1] - I[i])) * (rs[i] - rs[i - 1]);
  return NaN;
}
// The page's computation: the profile at the screen and the numerically found 1/e² radius at a few
// distances behind the lens. o = { w0, lam, s, f, aRel (clear radius in units of the beam radius at
// the lens), zs (distances), zScreen, nr }.
export function beamLab(o) {
  const qL = propagate(qWaist(o.w0, o.lam), o.s), atLens = beamOf(qL, o.lam), a = o.aRel * atLens.w;
  const F = focus(o.w0, o.lam, 1, o.s, o.f), reach = (z) => 3 * Math.max(beamOf(propagate(lens(qL, o.f), z), o.lam).w, (1.22 * o.lam * z) / (2 * a));
  const geo = { w: atLens.w, R: atLens.R, f: o.f, a, lam: o.lam };
  const rsS = Array.from({ length: o.nr || 200 }, (_, i) => (i / ((o.nr || 200) - 1)) * reach(o.zScreen));
  const screen = fieldAfter({ ...geo, z: o.zScreen }, rsS);
  const widths = o.zs.map((z) => { const rs = Array.from({ length: 140 }, (_, i) => (i / 139) * reach(z)); return radiusE2(rs, fieldAfter({ ...geo, z }, rs, 800)); });
  return { rs: rsS, I: screen, widths, a, atLens, focus: F };
}
