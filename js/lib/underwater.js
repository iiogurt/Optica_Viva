// Underwater photography: spectral absorption on the way down and back (colour loss with depth
// and distance), white balance, flat and dome ports, and strobe placement against backscatter.
// Pure functions; lengths in metres, wavelengths in nm.
import { LAMBDA, xyz, daylight, adapt, xyzToSRGB, D65_XYZ, planck } from './colorsci.js';
import { TCS } from './colordata.js';
import { waterAbsorption, cdomAbsorption } from './polar.js';
import { N_ } from './i18n.js';

// Water types: dissolved organic matter absorption at 440 nm (m⁻¹).
export const WATERS = { ocean: [N_('Clear ocean'), 0], coastal: [N_('Coastal water'), 0.3], lake: [N_('Green lake'), 1.2] };
export const absorption = (lam, ag) => waterAbsorption(Math.min(700, Math.max(400, lam))) + cdomAbsorption(lam, ag) + (lam > 700 ? 2 : 0);
// Refractive index of water (Cauchy fit to the F, D and C lines: 1.3373, 1.3331, 1.3314).
export const nWater = (lam) => 1.3242 + 3090 / (lam * lam);

const D65 = daylight(6504), FLASH = LAMBDA.map((l) => planck(l, 5500));
// Colour (linear sRGB, white-balanced on a grey card or not) of a reflectance seen at depth z and
// distance r: sunlight travels z down and r to the camera; strobe light travels 2r.
export function patchColours({ z, r, ag = 0, strobe = false, wb = true }) {
  const T = LAMBDA.map((l) => Math.exp(-absorption(l, ag) * ((strobe ? 0 : z) + (strobe ? 2 * r : r))));
  const light = strobe ? FLASH : D65;
  const spd = (refl) => light.map((s, i) => s * T[i] * refl(i));
  const grey = xyz(spd(() => 0.5)), white = xyz(D65.map((s) => s * 0.5));
  const k = 50 / white[1]; // a grey card at the surface → Y = 50
  return [...TCS.slice(0, 14).map((t) => (i) => t[i]), () => 0.5].map((refl) => {
    let X = xyz(spd(refl)).map((q) => q * k);
    if (wb) X = adapt(X, grey.map((q) => (q * k * 100) / 50), D65_XYZ); // the grey card becomes neutral
    return xyzToSRGB(X);
  });
}
// Fraction of red (600–700 nm), green (500–600 nm) and blue (400–500 nm) light left after a path ℓ.
export function bandsLeft(l, ag = 0) {
  const band = (a, b) => { let s = 0, n = 0; for (let lam = a; lam <= b; lam += 5) { s += Math.exp(-absorption(lam, ag) * l); n++; } return s / n; };
  return { red: band(600, 700), green: band(500, 600), blue: band(400, 500) };
}

// Flat port: an air angle θa corresponds to a water angle asin(sin θa / n); the field narrows, and
// the edge of the frame shows lateral colour from the dispersion of water.
export function flatPort(hfovAirDeg, fmm) {
  const ta = (hfovAirDeg / 2) * Math.PI / 180, tw = Math.asin(Math.sin(ta) / nWater(589));
  const lateral = fmm * 1000 * (Math.tan(Math.asin(nWater(486) * Math.sin(tw))) - Math.tan(Math.asin(nWater(656) * Math.sin(tw)))); // µm
  return { hfovWater: (2 * tw * 180) / Math.PI, magnification: Math.tan(ta) / Math.tan(tw), lateral };
}
// Dome port of radius R centred on the entrance pupil: refraction at the surface (water → air)
// forms a virtual image of an object at distance u (from the surface) at distance v in front of it.
export function domeImage(u, R, n = nWater(589)) {
  const inv = (1 - n) / R - n / u; // 1/v from n/u + 1/v = (1 − n)/R
  const v = -1 / inv; // distance of the virtual image in front of the dome surface
  return { v, fromPupil: v + R, atInfinity: R / (n - 1) + R };
}
// Strobes at lateral offset s from the lens axis, aimed straight ahead with beam half-angle β: their
// light enters the camera's field (half-angle θ) at distance s/(tan β + tan θ) in front of the port.
export const backscatterStart = (s, betaDeg, thetaDeg) => s / (Math.tan((betaDeg * Math.PI) / 180) + Math.tan((thetaDeg * Math.PI) / 180));
