// Phase angle and sun glint: how bright a lit body looks from different directions. Pure functions.
//
// Surfaces (reflectance factor r = π L / (E cos θs), θs, θv the angles of the Sun and the viewer from
// the local normal):
//   Lambert:          r = A                              (a perfectly matt, bright cloud deck)
//   Lommel–Seeliger:  r = 2A/(cos θs + cos θv), i.e. L ∝ cos θs/(cos θs + cos θv)
//                     (single scattering in a dark, porous regolith; the full Moon's limb is not darkened)
//   Ocean:            a dark diffuse body (reflectance 0.02) plus the specular glint of a sea of tilted
//                     facets with the Cox & Munk (1954) isotropic slope distribution,
//                     σ² = 0.003 + 0.00512 U  (U the wind speed at 12.5 m, m/s),
//                     p(β) = exp(−tan²β/σ²)/(π σ²),   r_glint = π R(ω) p(β) / (4 cos θs cos θv cos⁴β),
//                     β the tilt of the facet that mirrors the Sun into the viewer, ω the angle of
//                     incidence on it and R the Fresnel reflectance of water (n = 1.34).
// Disk-integrated phase curves are summed over the visible disk; the Lambert and Lommel–Seeliger ones
// have closed forms (Russell 1916; e.g. Hapke 2012):
//   Φ_L(α) = [sin α + (π − α) cos α]/π,     Φ_LS(α) = 1 − sin(α/2) tan(α/2) ln cot(α/4).
// The measured Moon (Allen 1976): V(α) = −12.73 + 0.026 |α| + 4 × 10⁻⁹ α⁴ (α in degrees).

export const N_WATER = 1.34, WATER_DIFFUSE = 0.02, RAD = Math.PI / 180;

export const slopeVar = (U) => 0.003 + 0.00512 * U;
export const lambertPhase = (a) => (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
export const lsPhase = (a) => (a < 1e-9 ? 1 : a >= Math.PI ? 0 : 1 - Math.sin(a / 2) * Math.tan(a / 2) * Math.log(1 / Math.tan(a / 4)));
export const moonMag = (aDeg) => -12.73 + 0.026 * Math.abs(aDeg) + 4e-9 * aDeg ** 4;
export const moonPhase = (aDeg) => 10 ** (-0.4 * (moonMag(aDeg) - moonMag(0)));

// unpolarised Fresnel reflectance at incidence angle with cosine ci, from air into n
export function fresnel(ci, n = N_WATER) {
  ci = Math.min(1, Math.max(0, ci));
  const st = Math.sqrt(1 - ci * ci) / n, ct = Math.sqrt(Math.max(0, 1 - st * st));
  const rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct);
  return (rs * rs + rp * rp) / 2;
}

// glint reflectance factor for unit vectors (normal nz, Sun s, view v), all as [x, y, z]
export function glint(nrm, s, v, s2) {
  const cs = dot(nrm, s), cv = dot(nrm, v);
  if (cs <= 0 || cv <= 0) return 0;
  let hx = s[0] + v[0], hy = s[1] + v[1], hz = s[2] + v[2];
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const cb = nrm[0] * hx + nrm[1] * hy + nrm[2] * hz, cw = s[0] * hx + s[1] * hy + s[2] * hz;
  if (cb <= 0) return 0;
  const t2 = (1 - cb * cb) / (cb * cb), p = Math.exp(-t2 / s2) / (Math.PI * s2);
  return (Math.PI * fresnel(cw) * p) / (4 * cs * cv * cb ** 4);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// reflectance factor of each surface; Lommel–Seeliger scaled so that it equals 1 at normal Sun and view
export function reflectance(kind, nrm, s, v, s2) {
  const cs = dot(nrm, s), cv = dot(nrm, v);
  if (cs <= 0 || cv <= 0) return 0;
  if (kind === 'lambert') return 1;
  if (kind === 'moon') return 2 / (cs + cv);
  return WATER_DIFFUSE + glint(nrm, s, v, s2);
}

// Disk-integrated brightness of a sphere at phase angle α (rad): the observer looks along −z,
// the Sun is at angle α from the observer in the x–z plane. Returns Σ r cos θs over the disk / (π·r̄₀),
// i.e. the flux relative to a white Lambert sphere at full phase (each projected pixel weighs r cos θs).
export function diskFlux(kind, a, s2, n = 120) {
  const s = [Math.sin(a), 0, Math.cos(a)], v = [0, 0, 1];
  let sum = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 2 - 1, y = ((j + 0.5) / n) * 2 - 1, r2 = x * x + y * y;
    if (r2 >= 1) continue;
    const nrm = [x, y, Math.sqrt(1 - r2)], cs = dot(nrm, s);
    if (cs > 0) sum += reflectance(kind, nrm, s, v, s2) * cs;
  }
  // each projected pixel has area (2/n)²; the Lambert sphere at full phase gives ∫ cos θ dA = 2π/3
  return (sum * (2 / n) ** 2) / ((2 * Math.PI) / 3);
}

// phase curves from 0 to 180° in steps of `step` degrees, for every surface
export function phaseCurves(U, step = 3, n = 90) {
  const s2 = slopeVar(U), out = { lambert: [], moon: [], ocean: [] };
  for (let d = 0; d <= 180; d += step) {
    const a = d * RAD;
    for (const k of Object.keys(out)) out[k].push([d, diskFlux(k, a, s2, n)]);
  }
  return out;
}

// glint reflectance in the principal plane against the view zenith angle (degrees; positive on the side
// opposite the Sun, where the mirror image of the Sun lies)
export function principalPlane(thetaS, U, from = -70, to = 70, step = 0.5) {
  const s2 = slopeVar(U), ts = thetaS * RAD, s = [Math.sin(ts), 0, Math.cos(ts)], nrm = [0, 0, 1], out = [];
  for (let d = from; d <= to + 1e-9; d += step) { const tv = d * RAD; out.push([d, glint(nrm, s, [-Math.sin(tv), 0, Math.cos(tv)], s2)]); }
  return out;
}
