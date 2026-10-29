// Mission "Security camera or drone survey": pixels on target against the DORI levels of
// IEC 62676-4, motion blur and rolling shutter for a security camera; ground sample distance,
// shutter limit and photo interval for a mapping drone. Pure functions; SI units.
import { N_ } from './i18n.js';

// Pixel densities on the target (pixels per metre) for detection, observation, recognition and
// identification of a person (IEC 62676-4:2015).
export const DORI = [[N_('Detection'), 25], [N_('Observation'), 62.5], [N_('Recognition'), 125], [N_('Identification'), 250]];

// Security camera: horizontal pixels nx, sensor width w and focal length f (m), distance d (m).
export function security({ nx, w, f, d, v = 1.5, t = 1 / 100, readout = 0.02 }) {
  const width = (d * w) / f, ppm = nx / width;
  const level = [...DORI].reverse().find(([, q]) => ppm >= q)?.[0] ?? N_('below detection');
  const maxDist = DORI.map(([name, q]) => [name, (nx * f) / (w * q)]);
  return { width, ppm, level, maxDist, blur: v * t * ppm, skew: v * readout * ppm, hfov: 2 * Math.atan(w / (2 * f)) };
}
// Drone: altitude A, pixel pitch p, focal length f, sensor size (sw across, sh along track), speed v.
export function drone({ A, p, f, sw, sh, v, overlap = 0.75, t = 1 / 1000, readout = 0.03 }) {
  const gsd = (A * p) / f, across = (A * sw) / f, along = (A * sh) / f;
  return { gsd, across, along, tMax: (0.5 * gsd) / v, blur: (v * t) / gsd, interval: (along * (1 - overlap)) / v, skew: (v * readout) / gsd };
}
