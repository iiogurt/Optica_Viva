// Autofocus: phase detection with split pixels and contrast detection by hill climbing, on a 1-D
// strip of the image. Lengths in mm on the sensor unless stated.
import { makeRng } from './random.js';
import { fft1d } from './fft.js';

// Thin lens: image distance for an object at u (mm).
export const imageDistance = (f, u) => 1 / (1 / f - 1 / u);
// Defocus at the sensor, by similar triangles (finite conjugates): the cone from the aperture of
// diameter A = f/N converges to the image at v_t = v(u); the sensor sits at v_s = v(focus) and cuts
// it in a disc of diameter b = A |v_t − v_s| / v_t (the shared blurDiameter of optics.js). At low
// magnification v_t ≈ f, and b → |Δv|/N.
export function defocus(f, N, u, focus) {
  const vt = imageDistance(f, u), vs = imageDistance(f, focus), dv = vt - vs; // + means the image lies behind the sensor
  return { dv, vt, vs, blur: ((f / N) * Math.abs(dv)) / vt };
}
// Centroid separation of the two half-pupil images: each half of the aperture has its centroid
// 4(A/2)/(3π) from the axis, and a point at height h in the aperture reaches the sensor at
// h (v_t − v_s)/v_t, so the halves land k A Δv / v_t apart, k = 4/(3π) ≈ 0.424 (k b, signed with Δv).
export const PD_K = 4 / (3 * Math.PI);
export const disparityOf = (f, N, vt, vs) => (PD_K * (f / N) * (vt - vs)) / vt;
// Inverse, for the camera, which knows where its sensor is (v_s) but not v_t = v_s + Δv:
// δ = k A Δv / (v_s + Δv)  ⇒  Δv = δ v_s / (k A − δ). |δ| ≥ k A has no finite solution.
export function defocusFromDisparity(f, N, vs, d) {
  const kA = PD_K * (f / N);
  return Math.abs(d) < kA ? (d * vs) / (kA - d) : NaN;
}

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

// The simulated strip and correlation: 8192 samples of 1 µm, shifts searched up to ±400 pixels.
export const AF_STRIP = { samples: 8192, dx: 0.001, maxShift: 400 };

// One autofocus attempt on a scene strip. Phase detection: one frame, disparity → lens move.
// Contrast detection: hill climbing on the sharpness of full-pupil frames (noise-free), reversing and halving
// the step after each drop, until the step is below `minStep` (mm of image distance).
// A shift beyond the correlation window, or a blur wider than a quarter of the strip, cannot be
// measured: phase detection then reports pdOk = false instead of a focus.
export function runAF({ f, N, u, focus, pitchUm = 4, photons = 2000, seed = 5, trials = 16, minFocus = 600 }) {
  const { samples, dx, maxShift } = AF_STRIP, pix = Math.max(1, Math.round(pitchUm)), src = scene(samples, 3), rng = makeRng(seed);
  const A = f / N, vTrue = imageDistance(f, u), v0 = imageDistance(f, focus);
  // the lens moves only between infinity (v = f) and its closest focus
  const clampV = (v) => Math.min(imageDistance(f, minFocus), Math.max(f, v));
  const blurAt = (v) => (A * Math.abs(vTrue - v)) / vTrue;
  const imgAt = (v, side, noisy = true) => halfImage(src, blurAt(v) / dx, side, Math.sign(vTrue - v) || 1, pix, photons, noisy ? rng : null);
  const shiftPx = (v) => Math.abs(disparityOf(f, N, vTrue, v)) / dx / pix;
  const measurable = (v) => shiftPx(v) + 12 <= maxShift && blurAt(v) / dx <= samples / 4;
  // depth of focus 2 N_w c (±N_w c) at the working f-number N_w = v/A, with c = two pixels
  const dofAt = (v) => (2 * (v / A) * 2 * pitchUm) / 1000;
  // phase detection: measure, move, and measure again until the move is within the depth of focus
  // (at most four frames); repeated to measure its scatter
  const est = [];
  let pdFrames = 0, pdOk = true;
  for (let t = 0; t < trials && pdOk; t++) {
    let v = v0, n = 0;
    for (; n < 4; n++) {
      if (!measurable(v)) { pdOk = false; break; }
      const sft = correlate(imgAt(v, -1), imgAt(v, 1), Math.ceil(shiftPx(v)) + 12);
      const dvEst = defocusFromDisparity(f, N, v, sft * pix * dx); // the measured shift has the sign of the defocus
      if (!Number.isFinite(dvEst)) { pdOk = false; break; }
      v = clampV(v + dvEst);
      if (Math.abs(dvEst) < dofAt(v)) { n++; break; }
    }
    est.push(v); pdFrames = Math.max(pdFrames, n);
  }
  const mean = est.reduce((a, x) => a + x, 0) / est.length, sd = Math.sqrt(est.reduce((a, x) => a + (x - mean) ** 2, 0) / est.length);
  const toU = (v) => 1 / (1 / f - 1 / v);
  // contrast detection
  const path = [];
  let v = v0, step = Math.max(0.01, Math.abs(vTrue - v0) / 6, dofAt(v0) / 2), dir = 1;
  // the contrast search is shown without noise: it averages over the whole focus area
  let best = sharpness(imgAt(v, 0, false)); path.push([v, best]);
  const minStep = dofAt(v0) / 16;
  for (let i = 0; i < 80 && step > minStep; i++) {
    const vn = clampV(v + dir * step), sn = sharpness(imgAt(vn, 0, false));
    path.push([vn, sn]);
    if (sn > best) { v = vn; best = sn; } else { dir = -dir; step /= 2; }
  }
  return { vTrue, v0, pdOk, pdV: pdOk ? mean : NaN, pdSd: pdOk ? sd : NaN, pdFrames, pdU: pdOk ? toU(mean) : NaN, pdUsd: pdOk ? Math.abs(toU(mean + sd) - toU(mean)) : NaN,
    cdV: v, cdU: toU(v), cdOk: Math.abs(v - vTrue) <= dofAt(vTrue) / 2, frames: path.length, path, disparityPx: disparityOf(f, N, vTrue, v0) / dx / pix, left: imgAt(v0, -1, false), right: imgAt(v0, 1, false) };
}
