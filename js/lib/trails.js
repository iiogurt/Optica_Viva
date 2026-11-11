// Satellite trails and how stacking removes them. Pure functions.
//
// A satellite crossing the field during a sub-exposure leaves a line. It moves across the sky at ω
// (about 0.8°/s for a satellite 550 km up near the zenith), so it lingers on each pixel of angular
// size p for p/ω and puts F·p/ω photoelectrons there, F being its flux: a magnitude-6 satellite is
// as bright as a magnitude-6 star, but spread along a line it deposits only a few milliseconds' worth
// of light per pixel. That is still far above a faint galaxy.
//
// Combining N sub-exposures pixel by pixel:
//   · mean: a trail present in one frame survives at 1/N of its brightness;
//   · median: a trail in a minority of frames disappears; for Gaussian noise the median is noisier
//     than the mean by √(π/2) ≈ 1.25 when N is large (it uses the data less efficiently);
//   · κσ-clipping: values further than κσ from the median (σ from the median absolute deviation,
//     1.4826·MAD) are dropped and the rest averaged: trails go, and the noise stays close to the
//     mean's.
import { ZP, BORTLE, surfaceRate, galaxyRate } from './stacking.js';
import { makeRng } from './random.js';

const ARCSEC = Math.PI / 648000;

// The flux of a source of magnitude m in photoelectrons per second (aperture D cm, throughput q).
export const flux = (m, D, q) => ZP * Math.pow(10, -0.4 * m) * Math.PI * (D / 2) ** 2 * q;
// Photoelectrons a trail leaves per pixel along its track: flux × dwell time p/ω.
export const trailDepth = (m, D, q, pArcsec, omegaDegS) => flux(m, D, q) * ((pArcsec * ARCSEC) / ((omegaDegS * Math.PI) / 180));

// p = { W, H, N, t (s), D (cm), pArc (arcsec/pixel), q, mu0, hArc, bortle, read (e⁻), rate (mean
// trails per frame), mSat, omega (°/s), seed } → { frames (N planes of W·H, e⁻), clean (the true
// object signal per frame, e⁻), sky (e⁻ per frame), trails: [[frame, x0, y0, angle], …] }
export function makeFrames(p) {
  const { W, H, N, t, D, pArc, q, mu0, hArc, bortle, read, rate, mSat, omega, seed } = p;
  const rng = makeRng(seed), obj = galaxyRate(W, H, pArc, D, q, mu0, hArc), sky = surfaceRate(BORTLE[bortle], D, pArc, q) * t;
  const depth = trailDepth(mSat, D, q, pArc, omega), frames = [], trails = [];
  for (let f = 0; f < N; f++) {
    const a = new Float32Array(W * H), lines = [];
    for (let n = rng.poisson(rate); n > 0; n--) { const L = [rng.u() * W, rng.u() * H, rng.u() * Math.PI]; lines.push(L); trails.push([f, ...L]); }
    for (let k = 0; k < W * H; k++) {
      const x = (k % W) + 0.5, y = Math.floor(k / W) + 0.5;
      let e = obj[k] * t + sky;
      for (const [x0, y0, ang] of lines) { const d = Math.abs((x - x0) * Math.sin(ang) - (y - y0) * Math.cos(ang)); if (d < 3) e += depth * Math.exp(-(d * d) / 2) / Math.sqrt(2 * Math.PI); }
      a[k] = e + Math.sqrt(e + read * read) * rng.g();
    }
    frames.push(a);
  }
  return { frames, clean: Float32Array.from(obj, (v) => v * t), sky, depth, trails };
}

// Combine N frames pixel by pixel: 'mean', 'median' or 'clip' (κσ around the median, σ = 1.4826 MAD,
// then the mean of what is left).
export function combine(frames, method, kappa = 3) {
  const N = frames.length, n = frames[0].length, out = new Float32Array(n), col = new Float64Array(N), dev = new Float64Array(N);
  for (let k = 0; k < n; k++) {
    if (method === 'mean') { let s = 0; for (let f = 0; f < N; f++) s += frames[f][k]; out[k] = s / N; continue; }
    for (let f = 0; f < N; f++) col[f] = frames[f][k];
    col.sort();
    const med = N % 2 ? col[(N - 1) / 2] : (col[N / 2 - 1] + col[N / 2]) / 2;
    if (method === 'median') { out[k] = med; continue; }
    for (let f = 0; f < N; f++) dev[f] = Math.abs(col[f] - med);
    dev.sort();
    const mad = N % 2 ? dev[(N - 1) / 2] : (dev[N / 2 - 1] + dev[N / 2]) / 2, sig = 1.4826 * mad || 1e-9;
    let s = 0, m = 0;
    for (let f = 0; f < N; f++) if (Math.abs(col[f] - med) <= kappa * sig) { s += col[f]; m++; }
    out[k] = m ? s / m : med;
  }
  return out;
}
