// Lucky imaging: many short exposures through frozen-flow turbulence; keep the sharpest and
// shift-and-add them. A frame is "lucky" when its tip-tilt-removed wavefront variance is below
// 1 rad²; Fried (1978) estimated that probability as P ≈ 5.6 exp(−0.1557 (D/r₀)²) for D/r₀ ≥ 3.5.
import { phaseScreen } from './turbulence.js';
import { fft2d } from './fft.js';

export const friedProbability = (Dr0) => 5.6 * Math.exp(-0.1557 * Dr0 * Dr0);

// Pupil phase (rad) for a frame: a Np-pixel circular pupil cut from the screen at an offset.
function pupilPhase(scr, NS, Np, ox, oy) {
  const ph = new Float64Array(Np * Np), R = Np / 2;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
    if (Math.hypot(x + 0.5 - R, y + 0.5 - R) > R) continue;
    ph[y * Np + x] = scr[((y + oy) % NS) * NS + ((x + ox) % NS)];
  }
  return ph;
}
// Remove piston and tip-tilt by least squares over the pupil; returns the residual variance.
export function removeTipTilt(ph, Np) {
  const R = Np / 2; let n = 0, s = 0, sx = 0, sy = 0, xx = 0, yy = 0;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) { const X = x + 0.5 - R, Y = y + 0.5 - R; if (Math.hypot(X, Y) > R) continue; const v = ph[y * Np + x]; n++; s += v; sx += v * X; sy += v * Y; xx += X * X; yy += Y * Y; }
  const m = s / n, a = sx / xx, b = sy / yy;
  let v2 = 0;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) { const X = x + 0.5 - R, Y = y + 0.5 - R; if (Math.hypot(X, Y) > R) continue; const r = ph[y * Np + x] - m - a * X - b * Y; v2 += r * r; }
  return v2 / n;
}
// Short-exposure PSF (N×N, fft-shifted, normalised so that a perfect pupil peaks at 1).
function framePSF(ph, Np, N) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N), o = (N - Np) / 2, R = Np / 2;
  let n = 0;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) { if (Math.hypot(x + 0.5 - R, y + 0.5 - R) > R) continue; n++; const q = (y + o) * N + x + o; re[q] = Math.cos(ph[y * Np + x]); im[q] = Math.sin(ph[y * Np + x]); }
  fft2d(re, im, N);
  const I = new Float64Array(N * N), h = N / 2, n2 = n * n;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const s = y * N + x; I[((y + h) % N) * N + ((x + h) % N)] = (re[s] ** 2 + im[s] ** 2) / n2; }
  return I;
}

// Simulate `frames` short exposures for D/r₀ at the imaging wavelength; frames are spaced by
// `step` pupil pixels of frozen-flow wind (decorrelated when step ≳ r₀). Returns per-frame
// residual variance and peak, plus long-exposure, tip-tilt-corrected and lucky-selected images.
export function luckySim({ Dr0, frames = 200, keep = 0.1, Np = 48, N = 128, step = 6, seed = 7, withImages = true }) {
  const NS = 256, r0px = Np / Dr0, scr = phaseScreen(NS, 1, r0px, 1e4, seed); // r0 in pixels, phase in rad at the imaging wavelength
  const stats = [], imgs = [];
  for (let f = 0; f < frames; f++) {
    const ox = (f * step) % NS, oy = Math.floor((f * step) / NS) * Np % NS, ph = pupilPhase(scr, NS, Np, ox, oy);
    const v = removeTipTilt(ph, Np);
    let I = null, pk = 0, px = 0;
    if (withImages) { I = framePSF(ph, Np, N); for (let k = 0; k < N * N; k++) if (I[k] > pk) { pk = I[k]; px = k; } }
    stats.push({ v, pk, px }); if (withImages) imgs.push(I);
  }
  if (!withImages) return { stats };
  const order = stats.map((s, i) => [s.pk, i]).sort((a, b) => b[0] - a[0]);
  const long = new Float64Array(N * N), tt = new Float64Array(N * N), lucky = new Float64Array(N * N), nKeep = Math.max(1, Math.round(keep * frames));
  const addShifted = (dst, I, peak, w) => { const dx = (peak % N) - N / 2, dy = Math.floor(peak / N) - N / 2; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const sx = x + dx, sy = y + dy; if (sx >= 0 && sx < N && sy >= 0 && sy < N) dst[y * N + x] += w * I[sy * N + sx]; } };
  imgs.forEach((I, i) => { for (let k = 0; k < N * N; k++) long[k] += I[k] / frames; addShifted(tt, I, stats[i].px, 1 / frames); });
  for (let j = 0; j < nKeep; j++) { const i = order[j][1]; addShifted(lucky, imgs[i], stats[i].px, 1 / nKeep); }
  const peak = (a) => { let m = 0; for (const v of a) m = Math.max(m, v); return m; };
  return { stats, N, long, tt, lucky, strehl: { long: peak(long), tt: peak(tt), lucky: peak(lucky) }, nKeep, ex: imgs[order[0][1]], worst: imgs[order[order.length - 1][1]] };
}
