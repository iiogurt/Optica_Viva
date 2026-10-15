// Mission "Film under LED light and on an LED volume": shutter angle against mains flicker and LED
// PWM, rolling-shutter bands, and LED-wall moiré against distance. Pure functions.
import { moire, bandAmplitude } from './virtual.js';

const sinc = (x) => (Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
export const exposureTime = (fps, angle) => angle / 360 / fps;
// Light modulated as 1 + m cos(2π f t), integrated over the exposure t: the rows of a rolling
// shutter start at different phases, so the frame shows bands of peak-to-peak contrast 2 m |sinc(f t)|.
export const sineBands = (m, f, t) => 2 * m * Math.abs(sinc(f * t));
// Shutter angles (≤ 360°) whose exposure spans whole flicker periods: 360 · fps · k / f.
export const safeAngles = (fps, f) => { const out = []; for (let k = 1; ; k++) { const a = (360 * fps * k) / f; if (a > 360.0001) break; out.push(a); } return out; };
// Number of bands across a frame: flicker cycles during the sensor readout.
export const bandCount = (readout, f) => readout * f;

// Smallest camera-to-wall distance (m) beyond which the wall's grid, aliased into moiré or resolved
// as a visible grid, keeps a contrast below `limit`, scanning out to 40 m; null if none in range. o: {f, N, s, p, q, fill} with lengths in mm, s in mm.
export function safeWallDistance(o, limit = 0.01, s0 = null) {
  for (let Z = 0.5; Z <= 40; Z *= 1.02) {
    const m = moire({ ...o, Z: Z * 1000, s: s0 ?? o.s });
    if (m.contrast > limit) continue;
    // the contrast must stay low from here on
    let ok = true;
    for (let Z2 = Z; Z2 <= 40; Z2 *= 1.05) { const m2 = moire({ ...o, Z: Z2 * 1000, s: s0 ?? o.s }); if (m2.contrast > limit) { ok = false; break; } }
    if (ok) return Z;
  }
  return null;
}

export function plan({ fps = 24, angle = 180, mains = 50, depth = 0.3, pwm = 2000, duty = 0.4, readout = 0.015, wallPwm = 3840, wallDuty = 0.5, f = 50, N = 2.8, s = 3, Z = 6, p = 2.6, q = 6, fill = 0.3 }) {
  const t = exposureTime(fps, angle), fl = 2 * mains;
  const mainsBands = sineBands(depth, fl, t), angles = safeAngles(fps, fl);
  const fixtureBands = bandAmplitude(t, pwm, duty), wallBands = bandAmplitude(t, wallPwm, wallDuty);
  const o = { f, N, s: s * 1000, Z: Z * 1000, p, q: q / 1000, fill };
  const m = moire(o), safe = safeWallDistance(o, 0.01);
  return { t, fl, mainsBands, angles, nMains: bandCount(readout, fl), fixtureBands, nFixture: bandCount(readout, pwm), wallBands, moire: m, safe };
}
