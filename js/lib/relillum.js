// Relative illumination traced through a real lens. For a distant scene of uniform radiance, the
// flux from a small cone of directions around field angle θ is the radiance times the area A⊥(θ)
// of the bundle that passes every aperture, measured across the beam, times the solid angle. By
// rotational symmetry it lands on the annulus between image heights h(θ) and h(θ + dθ), so
//   E(θ) ∝ A⊥(θ) · sin θ / (h · dh/dθ),   RI(θ) = E(θ)/E(0),   E(0) ∝ A⊥(0)/f².
// With a fixed round pupil (A⊥ = A cos θ) and no distortion (h = f tan θ) this is exactly cos⁴θ;
// a real lens departs from it through pupil aberration (A⊥ changes), mechanical vignetting (rims
// cut the bundle) and distortion (h ≠ f tan θ). Fresnel losses and blur are ignored: all of a
// bundle's flux is placed at its chief ray's image height.
import { LENSES, paraxial, aimRay, trace, toPlane, stopIndex, autoSemiDiameters } from './raytrace.js';

const LAMBDA = 587.56;

// Clear semi-diameters: the stop at its true radius; every other surface between the radius the
// on-axis beam needs (trim = 0, strong mechanical vignetting off axis) and the radius the
// full-field beam needs (trim = 1, essentially none).
export function apertures(lens, trim = 1, par = paraxial(lens, LAMBDA)) {
  const full = autoSemiDiameters(lens, [LAMBDA]), N = lens.surfaces.length, axis = new Array(N).fill(0);
  for (let k = 0; k <= 16; k++) {
    const a = aimRay(lens, LAMBDA, 0, Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2), par);
    if (!a) continue;
    const r = trace(lens, LAMBDA, a.p, a.d, { clip: false, path: true, zv: par.zv });
    if (!r.path) continue;
    for (let i = 0; i < N && i + 1 < r.path.length; i++) axis[i] = Math.max(axis[i], Math.hypot(r.path[i + 1][0], r.path[i + 1][1]));
  }
  const sd = full.map((f, i) => { const a0 = axis[i] * 1.01; return a0 + trim * Math.max(0, f - a0); });
  sd[stopIndex(lens)] = par.stopR;
  return sd;
}

// Area (in the launch plane z = z0) of the transmitted bundle at field angle θ, found along `rays`
// directions from the chief ray by bisection on the pass/block boundary; the bundle is assumed
// star-shaped about the chief ray, which holds for the intersection of a stop with rim shadows.
function bundle(lens, par, sd, thetaDeg, rays = 64, iters = 22) {
  const chief = aimRay(lens, LAMBDA, thetaDeg, 0, 0, par);
  if (!chief) return null;
  const d = chief.d, z0 = chief.p[2];
  const passes = (x, y) => trace(lens, LAMBDA, [x, y, z0], d, { sd, zv: par.zv }).ok;
  if (!passes(chief.p[0], chief.p[1])) return { area: 0, outline: [], chief };
  const rMax = (2 * lens.epd) / Math.max(0.2, d[2]) + 1;
  const outline = [];
  for (let k = 0; k < rays; k++) {
    const ph = (2 * Math.PI * k) / rays, ux = Math.cos(ph), uy = Math.sin(ph);
    let lo = 0, hi = rMax;
    for (let it = 0; it < iters; it++) { const m = (lo + hi) / 2; if (passes(chief.p[0] + m * ux, chief.p[1] + m * uy)) lo = m; else hi = m; }
    outline.push([lo * ux, lo * uy]);
  }
  let area = 0;
  for (let k = 0; k < rays; k++) { const [x1, y1] = outline[k], [x2, y2] = outline[(k + 1) % rays]; area += (x1 * y2 - x2 * y1) / 2; }
  return { area, outline, chief };
}

// Chief-ray height on the paraxial image plane.
function height(lens, par, thetaDeg) {
  const a = aimRay(lens, LAMBDA, thetaDeg, 0, 0, par);
  if (!a) return NaN;
  const r = trace(lens, LAMBDA, a.p, a.d, { clip: false, zv: par.zv });
  return r.ok ? toPlane(r, par.zImage)[1] : NaN;
}

// Relative illumination at the given field angles (degrees). Returns, per angle, RI and its parts:
// the pupil-area ratio A⊥(θ)/A⊥(0) (pupil aberration and vignetting together), the area ratio for
// generous rims (pupil aberration alone), the distortion factor f² sin θ/(h h′), the image height
// and the transmitted pupil outline (launch-plane coordinates about the chief ray, in mm).
export function relativeIllumination(lens, { thetas, trim = 1, sd = null, rays = 64, iters = 22 } = {}) {
  const par = paraxial(lens, LAMBDA), clear = sd || apertures(lens, trim, par), open = apertures(lens, 1, par);
  const B = (s, th) => bundle(lens, par, s, th, rays, iters);
  const f = par.efl, b0 = B(clear, 0), o0 = B(open, 0);
  const A0 = b0.area, O0 = o0.area;
  return thetas.map((th) => {
    const b = th === 0 ? b0 : B(clear, th), o = th === 0 ? o0 : B(open, th);
    const c = Math.cos((th * Math.PI) / 180), area = b ? (b.area * c) / A0 : 0, natural = o ? (o.area * c) / O0 : 0;
    let dist = 1, hgt = 0;
    if (th > 0) {
      const dt = Math.min(0.05, th / 4), hp = height(lens, par, th + dt), hm = height(lens, par, th - dt);
      hgt = height(lens, par, th);
      const dh = (hp - hm) / ((2 * dt * Math.PI) / 180);
      dist = (f * f * Math.sin((th * Math.PI) / 180)) / (hgt * dh);
    }
    const cos4 = c ** 4;
    return { theta: th, h: hgt, area, natural, dist, ri: area * dist, riOpen: natural * dist, cos4, outline: b ? b.outline : [], chief: b ? b.chief : null };
  });
}

// The page's curve for a stored prescription: rims sized for the lens wide open (trim between the
// on-axis and the full-field beam) and kept when the iris closes by `stop` EV; `n` field angles
// from the axis to the lens's full field.
export function tracedVignetting({ key, trim = 1, stop = 0, n = 11, rays = 40, iters = 16 }) {
  const open = LENSES[key], N0 = paraxial(open, LAMBDA).fnum;
  const sd = apertures(open, trim);
  const lens = stop > 0 ? { ...open, epd: open.epd / 2 ** (stop / 2) } : open;
  const par = paraxial(lens, LAMBDA);
  sd[stopIndex(lens)] = par.stopR;
  const thetas = Array.from({ length: n }, (_, i) => (lens.field * i) / (n - 1));
  const curve = relativeIllumination(lens, { thetas, sd, rays, iters }).map(({ chief, ...r }) => r);
  return { curve, efl: par.efl, fnum: par.fnum, N0, field: lens.field };
}
