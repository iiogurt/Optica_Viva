// Mission "Portrait session": camera distance and perspective, focal length for the framing, depth
// of field across the face, background blur, and the size of the light. Pure functions; lengths in
// metres unless stated.
import { SENSORS, diag } from './sensors.js';
import { blurDiameter, dofLimits } from './optics.js';
import { angularSize, shadowGeometry, falloff, makeLight } from './lighting.js';

// Framings: the height of the scene that fills the frame's long side held vertically.
export const FRAMINGS = { head: ['Head and shoulders', 0.55], half: ['Half body', 1.0], full: ['Full body', 2.0] };
// Nose tip about 11 cm in front of the ears' plane, ears about 1 cm behind the focus plane (as in the
// perspective laboratory): apparent size scales as 1/distance.
export const noseEnlargement = (d) => (d + 0.01) / (d - 0.108) - 1;
// Distance at which the nose is drawn at most `e` larger than in a distant view.
export const naturalDistance = (e = 0.05) => (0.01 + (1 + e) * 0.108) / e;

export function plan({ sensor = 'ff', framing = 'head', d = 2, N = 2, B = 3, light = 0.9, ld = 1.2, az = 40 }) {
  const S = SENSORS[sensor], long = Math.max(S.w, S.h) / 1000, c = diag(S) / 1500 / 1000; // m
  const Hf = FRAMINGS[framing][1];
  const f = (long * d) / (Hf + long); // thin lens: magnification long/Hf = f/(d − f)
  const nose = noseEnlargement(d);
  const { near, far } = dofLimits(f * 1000, N, c * 1000, d * 1000);
  const dof = (far - near) / 1000; // m
  // widest aperture that keeps 6 cm (both eyes in a three-quarter view) sharp: DoF ≈ 2Ncs²/f²
  const nFace = Math.max(1, (0.06 * f * f) / (2 * c * d * d));
  const bg = blurDiameter(f * 1000, N, d * 1000, (d + B) * 1000) / 1000; // m on the sensor
  const bgShare = bg / long; // blur disc as a share of the frame's long side
  const lt = makeLight(ld, az, 25, light);
  const ang = angularSize(light, ld), fo = falloff(lt, B), pen = shadowGeometry(light, ld, B, 0.1).pen;
  return { S, f, nose, natural: naturalDistance(0.05), near: near / 1000, far: far / 1000, dof, nFace, bg, bgShare, ang, fall: fo.stops, pen, c };
}
