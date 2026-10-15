// Mission "Choose a camera or telescope": compare two options for the same job. Cameras through
// the equivalence laws, telescopes through aperture, resolution and light grasp. Pure functions.
import { SENSORS, crop, diag, pitchUm } from './sensors.js';

const LAMBDA = 0.55e-3; // mm

// A camera option for a given shot (full-frame-equivalent focal length Feq in mm, subject at s m):
// focal length, entrance pupil, depth of field at the widest aperture, the light it collects
// relative to a 25 mm pupil, and the f-number at which diffraction spreads over two pixels.
export function camera({ sensor, N, mp }, { Feq, s }) {
  const S = typeof sensor === 'string' ? SENSORS[sensor] : sensor, k = crop(S), f = Feq / k, D = f / N;
  const c = diag(S) / 1500, sm = s * 1000;
  const pitch = mp ? Math.sqrt((S.w * S.h) / (mp * 1e6)) * 1000 : pitchUm(S); // µm
  const dof = (2 * N * c * sm * sm) / (f * f) / 1000; // m, valid well inside the hyperfocal distance
  return { S, k, f, D, dof, pitch, mp: mp || S.mp, light: (D / 25) ** 2, nDiff: (2 * pitch / 1000) / (2.44 * LAMBDA) };
}
// A telescope option: aperture D and focal length f in mm.
export function telescope({ D, f }, seeing = 2) {
  const dawes = 116 / D; // arcsec (Dawes limit, D in mm)
  const rayleigh = (1.22 * LAMBDA / D) * 206265;
  return { D, f, N: f / D, dawes, rayleigh, grasp: (D / 7) ** 2, mlim: 7.5 + 5 * Math.log10(D / 10), maxMag: 2 * D, minMag: D / 7, seeingLimited: rayleigh < seeing };
}
// Difference in stops between two amounts of light.
export const stops = (a, b) => Math.log2(a / b);
