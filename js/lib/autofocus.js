// Autofocus: phase detection with split pixels and contrast detection by hill climbing, on a 1-D
// strip of the image. Lengths in mm on the sensor unless stated.
import { makeRng } from './random.js';
import { fft1d } from './fft.js';

// Thin lens: image distance for an object at u (mm).
export const imageDistance = (f, u) => 1 / (1 / f - 1 / u);
// Defocus at the sensor: the sensor sits at the image distance for `focus`, the object at `u`.
export function defocus(f, N, u, focus) {
  const dv = imageDistance(f, u) - imageDistance(f, focus); // + means the image lies behind the sensor
  return { dv, blur: Math.abs(dv) / N };
}
// Centroid separation of the two half-pupil images: each half of a disc of diameter b has its
// centroid 4(b/2)/(3π) from the centre, so the halves sit 4b/(3π) ≈ 0.424 b apart (signed with dv).
export const disparityOf = (dv, N) => ((4 / (3 * Math.PI)) * dv) / N;

// A 1-D scene (radiance per sample at pitch dx): bars of random width and brightness plus an edge.
export function scene(n, seed = 3) {
  const r = makeRng(seed).u, s = new Float64Array(n);
  let x = 0;
  while (x < n) { const w = 2 + Math.floor(r() * 14), v = 0.2 + 0.8 * r(); for (let k = 0; k < w && x < n; k++, x++) s[x] = v; }
  return s;
}
// Image through a half (side −1 left, +1 right, 0 full) of a defocused pupil: the 1-D projection of
// a disc of diameter b (in samples) is a semi-ellipse; a half pupil keeps one side of it, shifted
// by the sign of the defocus. Sampled by pixels of width `pix` samples, with Poisson noise.
export function halfImage(src, bSamples, side, dvSign, pix, photons, rng) {
  const n = src.length, R = Math.max(0.5, bSamples / 2), K = Math.min(Math.floor(n / 2) - 1, Math.ceil(R));
  // kernel on a periodic grid of length n (a power of two), convolved by FFT
  const kr = new Float64Array(n), ki = new Float64Array(n);
  let sum = 0;
  for (let k = -K; k <= K; k++) {
    let wgt = Math.sqrt(Math.max(0, R * R - k * k)) || (k === 0 ? 1 : 0);
    if (side && Math.sign(k) * side * dvSign < 0) wgt = 0; // keep the half that this side sees
    kr[(k + n) % n] = wgt; sum += wgt;
  }
  const sr = Float64Array.from(src), si = new Float64Array(n);
  fft1d(sr, si); fft1d(kr, ki);
  for (let i = 0; i < n; i++) { const a = sr[i] * kr[i] - si[i] * ki[i], b = sr[i] * ki[i] + si[i] * kr[i]; sr[i] = a; si[i] = b; }
  fft1d(sr, si, true);
  const m = Math.floor(n / pix), px = new Float64Array(m);
  for (let i = 0; i < m; i++) { let a = 0; for (let k = 0; k < pix; k++) a += sr[i * pix + k] / (sum || 1); const mean = (a / pix) * photons; px[i] = rng ? rng.poisson(mean) / photons : mean / photons; }
  return px;
}
// Shift between two signals by cross-correlation with a parabolic sub-pixel peak (pixels).
export function correlate(a, b, maxShift) {
  let best = 0, bestV = -Infinity; const v = [];
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  for (let s = -maxShift; s <= maxShift; s++) {
    let c = 0;
    for (let i = maxShift; i < a.length - maxShift; i++) c += (a[i] - ma) * (b[i + s] - mb);
    v.push(c); if (c > bestV) { bestV = c; best = s; }
  }
  const i = best + maxShift;
  if (i > 0 && i < v.length - 1) { const d = v[i - 1] - 2 * v[i] + v[i + 1]; if (d < 0) return best + (0.5 * (v[i - 1] - v[i + 1])) / d; }
  return best;
}
// Sharpness metric for contrast detection: mean squared difference of neighbouring pixels.
export const sharpness = (px) => { let s = 0; for (let i = 1; i < px.length; i++) s += (px[i] - px[i - 1]) ** 2; return s / (px.length - 1); };

// One autofocus attempt on a scene strip. Phase detection: one frame, disparity → lens move.
// Contrast detection: hill climbing on the sharpness of full-pupil frames (noise-free), reversing and halving
// the step after each drop, until the step is below `minStep` (mm of image distance).
export function runAF({ f, N, u, focus, pitchUm = 4, photons = 2000, seed = 5, trials = 16 }) {
  const dx = 0.001, pix = Math.max(1, Math.round(pitchUm)), src = scene(8192, 3), rng = makeRng(seed);
  const vTrue = imageDistance(f, u), v0 = imageDistance(f, focus);
  const imgAt = (v, side, noisy = true) => {
    const dv = vTrue - v;
    return halfImage(src, Math.abs(dv) / N / dx, side, Math.sign(dv) || 1, pix, photons, noisy ? rng : null);
  };
  // phase detection: measure, move, and measure again until the move is within the depth of focus
  // (at most four frames); repeated to measure its scatter
  const k = 4 / (3 * Math.PI), dof = (2 * N * 2 * pitchUm) / 1000, est = [];
  let pdFrames = 0;
  for (let t = 0; t < trials; t++) {
    let v = v0, n = 0;
    for (; n < 4; n++) {
      const maxS = Math.min(400, Math.ceil(Math.abs(disparityOf(vTrue - v, N)) / dx / pix) + 12);
      const sft = correlate(imgAt(v, -1), imgAt(v, 1), maxS);
      const dvEst = (sft * pix * dx * N) / k; // the measured shift has the sign of the defocus
      v += dvEst;
      if (Math.abs(dvEst) < dof) { n++; break; }
    }
    est.push(v); pdFrames = Math.max(pdFrames, n);
  }
  const mean = est.reduce((a, x) => a + x, 0) / est.length, sd = Math.sqrt(est.reduce((a, x) => a + (x - mean) ** 2, 0) / est.length);
  const toU = (v) => 1 / (1 / f - 1 / v);
  // contrast detection
  const path = [];
  let v = v0, step = Math.max(0.01, Math.abs(vTrue - v0) / 6, (2 * N * pitchUm) / 1000), dir = 1;
  // the contrast search is shown without noise: it averages over the whole focus area
  let best = sharpness(imgAt(v, 0, false)); path.push([v, best]);
  const minStep = (N * pitchUm) / 4000;
  for (let i = 0; i < 80 && step > minStep; i++) {
    const vn = v + dir * step, sn = sharpness(imgAt(vn, 0, false));
    path.push([vn, sn]);
    if (sn > best) { v = vn; best = sn; } else { dir = -dir; step /= 2; }
  }
  return { vTrue, v0, pdV: mean, pdSd: sd, pdFrames, pdU: toU(mean), pdUsd: Math.abs(toU(mean + sd) - toU(mean)), cdV: v, cdU: toU(v), frames: path.length, path, disparityPx: disparityOf(vTrue - v0, N) / dx / pix, left: imgAt(v0, -1, false), right: imgAt(v0, 1, false) };
}
