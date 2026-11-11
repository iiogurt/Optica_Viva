// Caustics on a pool floor and the apparent depth of things under water. Pure functions.
//
// Caustics: sunlight refracted by a wavy water surface (Snell's law in vector form at the local
// normal, the index of water at each wavelength) is traced to a flat floor at depth D and counted
// there. The surface is a sum of a few travelling waves whose wavelengths divide the patch size,
// so the patch, and the pattern on its floor, repeat seamlessly. Where neighbouring rays cross the
// light piles up: the bright lines are the envelope (caustic) of the refracted rays.
//
// Apparent depth: a point at depth d seen from air at angle θ_a from the vertical (θ_w in water,
// sin θ_a = n sin θ_w) appears, along the line of sight, at the depth where neighbouring rays meet:
// d·cos³θ_a/(n·cos³θ_w) for rays in the plane of incidence (tangential) and d·tanθ_w/tanθ_a for
// rays around it (sagittal). Straight down both are d/n; off-axis they differ (astigmatism).
import { nWater } from './underwater.js';
import { uniform } from './random.js';

// Waves: `count` components with wavelengths near lam (m), directions spread around the x axis,
// amplitudes adding to an RMS slope-consistent height A (m, the largest single amplitude), seeded.
// The patch is size × size metres; each wave vector is a multiple of 2π/size.
export function makeWaves({ A = 0.005, lam = 0.3, size = 1.2, count = 5, seed = 3, spread = 1 }) {
  const r = uniform(seed), base = (2 * Math.PI) / size, waves = [];
  for (let i = 0; i < count; i++) {
    const ang = (r() - 0.5) * spread * 2, len = lam * (0.75 + 0.6 * r());
    const k = (2 * Math.PI) / len, mx = Math.round((k * Math.cos(ang)) / base), my = Math.round((k * Math.sin(ang)) / base);
    if (!mx && !my) continue;
    const kx = mx * base, ky = my * base, kk = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: A * (i === 0 ? 1 : 0.35 + 0.45 * r()) * Math.min(1, (2 * Math.PI) / lam / kk), ph: r() * 2 * Math.PI, w: Math.sqrt(9.81 * kk) });
  }
  return { waves, size };
}
// Height and slopes of the surface at (x, y) and time t (s); deep-water waves, ω = √(g k).
export function surface(W, x, y, t = 0) {
  let h = 0, hx = 0, hy = 0;
  for (const w of W.waves) {
    const p = w.kx * x + w.ky * y - w.w * t + w.ph, c = Math.cos(p), s = Math.sin(p);
    h += w.a * s; hx += w.a * w.kx * c; hy += w.a * w.ky * c;
  }
  return [h, hx, hy];
}

// Refraction of the unit direction d at a surface with unit normal m (pointing up, into the air) from
// index 1 into index n: t = d/n + (cos i/n − cos t)·m … in the usual vector form.
export function refract(d, m, n) {
  const ci = -(d[0] * m[0] + d[1] * m[1] + d[2] * m[2]), eta = 1 / n, k = 1 - eta * eta * (1 - ci * ci);
  const f = eta * ci - Math.sqrt(Math.max(0, k));
  return [eta * d[0] + f * m[0], eta * d[1] + f * m[1], eta * d[2] + f * m[2]];
}

// The light on the floor: an N × N image of the patch (relative irradiance, 1 = the flat-water
// value, so the mean is 1 by conservation), one channel per wavelength in lams (nm). Each floor pixel
// receives about rpp² rays, dropped with bilinear weights. Sun at elevation el and azimuth az (rad).
export function floorLight(W, { N = 192, D = 1, el = Math.PI / 2, az = 0, lams = [550], rpp = 3, t = 0 }) {
  const size = W.size, R = N * rpp, step = size / R, cell = size / N;
  const d = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), -Math.sin(el)];
  const out = lams.map(() => new Float32Array(N * N));
  const hs = new Float32Array(R * R), nx = new Float32Array(R * R), ny = new Float32Array(R * R), nz = new Float32Array(R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const [h, hx, hy] = surface(W, (i + 0.5) * step, (j + 0.5) * step, t), L = Math.hypot(hx, hy, 1), q = j * R + i;
    hs[q] = h; nx[q] = -hx / L; ny[q] = -hy / L; nz[q] = 1 / L;
  }
  lams.forEach((lam, c) => {
    const n = nWater(lam), img = out[c];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const q = j * R + i, tv = refract(d, [nx[q], ny[q], nz[q]], n);
      const s = (D + hs[q]) / -tv[2];
      let X = ((i + 0.5) * step + s * tv[0]) / cell - 0.5, Y = ((j + 0.5) * step + s * tv[1]) / cell - 0.5;
      X = ((X % N) + N) % N; Y = ((Y % N) + N) % N;
      const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
      img[y0 * N + x0] += (1 - fx) * (1 - fy); img[y0 * N + x1] += fx * (1 - fy); img[y1 * N + x0] += (1 - fx) * fy; img[y1 * N + x1] += fx * fy;
    }
    const norm = 1 / (rpp * rpp);
    for (let k = 0; k < N * N; k++) img[k] *= norm;
  });
  return out;
}

// Depth below a single sinusoidal wave h = A sin(kx) (sun overhead, small slopes) at which its
// refracted rays first cross: each crest is a weak lens of radius 1/(A k²) and focal length n/(n − 1)
// times that radius.
export const focusDepth = (A, k, n) => n / ((n - 1) * A * k * k);

// Where the vertical sunlight through x lands on a floor at depth D below h = A sin(kx) (exact Snell
// in the plane, used for the side view and to check focusDepth).
export function landing1D(A, k, n, D, x) {
  const h = A * Math.sin(k * x), s = A * k * Math.cos(k * x), L = Math.hypot(s, 1);
  const tv = refract([0, 0, -1], [-s / L, 0, 1 / L], n);
  return x + ((D + h) / -tv[2]) * tv[0];
}

// Apparent depth of a point at depth d seen at angle ta (rad, from the vertical, in air).
export function apparentDepth(d, ta, n) {
  const tw = Math.asin(Math.sin(ta) / n);
  if (ta < 1e-9) return { tangential: d / n, sagittal: d / n, tw };
  return { tangential: (d * Math.cos(ta) ** 3) / (n * Math.cos(tw) ** 3), sagittal: (d * Math.tan(tw)) / Math.tan(ta), tw };
}
