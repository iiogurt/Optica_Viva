// Cinema optics: anamorphic squeeze and oval bokeh, coating-coloured streak flare, focus
// breathing of different focusing schemes, and T-stops from surface transmission.
import { stackReflectance, COATINGS } from './thinfilm.js';
import { cmf, linspace } from './color.js';

// Anamorphic front attachment: a cylindrical afocal of angular magnification 1/s horizontally.
// Its entrance pupil is s times narrower horizontally than vertically, so out-of-focus points
// are ovals of height/width = s once the image is desqueezed.
export const ovalRatio = (s) => s;
// Output aspect ratio of a sensor area w × h with squeeze s, and its crop to a target ratio.
export const anamorphicAspect = (w, h, s) => (w * s) / h;

// Defocus blur diameter on the sensor (mm) of an object at uo when focused at uf (thin lens,
// distances in mm from the lens): b = f² |uo − uf| / (N uo (uf − f)).
export const blurDiameter = (f, N, uf, uo) => (f * f * Math.abs(uo - uf)) / (N * uo * (uf - f));

// Focus breathing: the object-side angle of view of a sensor of width w as the lens focuses
// from infinity to distance u (mm from the stop). Paraxial thin-lens models with the stop at the
// first element:
//  'unit'   one lens of focal length f moved bodily away from the sensor (f fixed);
//  'rear'   internal focusing: a fixed positive front group f1 and a negative rear group f2
//           that moves towards the stop while the sensor stays put (telephoto-type IF design);
//  'ideal'  a breathing-compensated cinema design (angle of view constant by definition).
export const IF_DESIGN = { f1: 30, f2: -50, d: 10 }; // f = f1 f2 / (f1 + f2 − d) = 50 mm at infinity
export function angleOfView(scheme, f, u, w) {
  if (scheme === 'ideal' || !Number.isFinite(u)) return scheme === 'rear' ? ifAngle(Infinity, w) : 2 * Math.atan(w / (2 * f));
  if (scheme === 'unit') { const v = 1 / (1 / f - 1 / u); return 2 * Math.atan(w / (2 * v)); }
  return ifAngle(u, w);
}
// rear-group focus: find the group spacing d that images an object at u onto the fixed sensor,
// then trace the chief ray (height 0 at the stop) to the sensor edge
function ifAngle(u, w) {
  const { f1, f2, d: d0 } = IF_DESIGN, img = (d, uu) => {
    // object at uu in front of lens 1 → image distance after lens 2 (thin lenses, paraxial)
    const v1 = Number.isFinite(uu) ? 1 / (1 / f1 - 1 / uu) : f1, o2 = v1 - d;
    return 1 / (1 / f2 + 1 / o2) + d; // sensor position from lens 1 (o2 < 0: virtual object)
  };
  const zs = img(d0, Infinity);
  let lo = 0.01, hi = f1 - 0.01;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; (img(mid, u) - zs) * (img(lo, u) - zs) <= 0 ? (hi = mid) : (lo = mid); }
  const d = (lo + hi) / 2;
  // chief ray from the stop centre at angle θ: y2 = θ d, θ' = θ − y2/f2, h = y2 + θ'(zs − d)
  const theta = w / 2 / (d + (1 - d / f2) * (zs - d));
  return 2 * Math.atan(theta);
}
export const breathing = (scheme, f, uMin, w) => angleOfView(scheme, f, uMin, w) / angleOfView(scheme, f, Infinity, w) - 1;

// Photopic transmission of k air–glass surfaces with a given coating, and the T-stop.
const LAMS = linspace(420, 680, 27), YBAR = LAMS.map((l) => cmf(l)[1]), YS = YBAR.reduce((a, b) => a + b, 0);
export function surfaceReflectance(coat, ns = 1.6) {
  return LAMS.reduce((a, l, i) => a + YBAR[i] * stackReflectance(COATINGS[coat].layers(ns), 1, ns, l, 0).R, 0) / YS;
}
export function transmission(coat, k, ns = 1.6, internal = 0.99) {
  const R = surfaceReflectance(coat, ns);
  return Math.pow(1 - R, k) * internal;
}
export const tStop = (N, tau) => N / Math.sqrt(tau);

// Colour of a two-reflection streak: the light reflected twice by coated cylinder surfaces has
// spectrum R(λ)², rendered as linear sRGB normalised to its brightest channel, plus its
// photopic strength relative to the source.
export function streakColour(coat, ns = 1.6) {
  let X = 0, Y = 0, Z = 0, S = 0;
  LAMS.forEach((l, i) => { const R = stackReflectance(COATINGS[coat].layers(ns), 1, ns, l, 0).R, c = cmf(l), r2 = R * R; X += r2 * c[0]; Y += r2 * c[1]; Z += r2 * c[2]; S += c[1]; });
  const rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((v) => Math.max(0, v));
  const m = Math.max(...rgb, 1e-12);
  return { rgb: rgb.map((v) => v / m), strength: Y / S };
}
