// Bokeh on your own camera: the whole frame thrown out of focus by one lens. Every point of the
// scene spreads into the image of the pupil (the defocus kernel from js/lib/bokeh.js, with iris
// blades, roundness, spherical aberration and a central obstruction), so the frame is convolved
// with that kernel, in linear light and by FFT. A camera clips its highlights, which in reality
// are much brighter than white: pixels near clipping are given back a gain, so that bright points
// bloom into discs as they do through a real lens. One kernel for the whole frame: no field-
// dependent cat's eye, and no depth (every point is equally out of focus).
import { fft2d } from './fft.js';
import { pupilKernel } from './bokeh.js';

export const BN = 256; // FFT size: a 192 × 144 frame with at least 32 px of edge padding
export const RMAX = 22; // largest aberration-free disk radius (px): with SA the disk grows to 1.45 R ≤ 32

const TOLIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSRGB = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// Spectrum of the kernel for a disk of radius R px, normalised to unit sum and centred on (0, 0).
export function kernelSpectrum(P, side, R, N = BN) {
  const K = 2 * Math.ceil(R * 1.5 + 3), k = pupilKernel(P, side, [0, 0], K, R), re = new Float64Array(N * N), im = new Float64Array(N * N);
  let s = 0; for (let i = 0; i < K * K; i++) s += k.data[i];
  for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) {
    const v = k.data[y * K + x]; if (!v) continue;
    re[(((y - K / 2) % N + N) % N) * N + (((x - K / 2) % N + N) % N)] = v / s;
  }
  fft2d(re, im, N);
  return { re, im, N, K };
}

// Linear light with the highlights given back: the factor rises smoothly from 1 at 80 % of full
// scale to `gain` at clipping, applied to all three channels (the hue is kept).
export function highlight(r, g, b, gain) {
  const m = Math.max(r, g, b), t = Math.min(1, Math.max(0, (m - 0.8) / 0.2)), sm = t * t * (3 - 2 * t);
  return 1 + (gain - 1) * sm;
}

// Convolve an RGBA frame (w × h, centred in the N × N grid with its edges extended) with the
// kernel; R and G travel together as one complex field, B alone. Returns RGBA bytes (clipped).
export function bokehFrame(src, w, h, H, gain = 1, out = new Uint8ClampedArray(w * h * 4)) {
  const N = H.N, ox = (N - w) >> 1, oy = (N - h) >> 1;
  const ar = new Float64Array(N * N), ai = new Float64Array(N * N), br = new Float64Array(N * N), bi = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - oy));
    for (let x = 0; x < N; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - ox)), p = (sy * w + sx) * 4, k = y * N + x;
      const r = TOLIN[src[p]], g = TOLIN[src[p + 1]], b = TOLIN[src[p + 2]], f = gain > 1 ? highlight(r, g, b, gain) : 1;
      ar[k] = r * f; ai[k] = g * f; br[k] = b * f;
    }
  }
  fft2d(ar, ai, N); fft2d(br, bi, N);
  for (let k = 0; k < N * N; k++) {
    const hr = H.re[k], hi = H.im[k];
    let a = ar[k], c = ai[k]; ar[k] = a * hr - c * hi; ai[k] = a * hi + c * hr;
    a = br[k]; c = bi[k]; br[k] = a * hr - c * hi; bi[k] = a * hi + c * hr;
  }
  fft2d(ar, ai, N, true); fft2d(br, bi, N, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y + oy) * N + x + ox, o = (y * w + x) * 4;
    out[o] = toSRGB(Math.min(1, Math.max(0, ar[k]))); out[o + 1] = toSRGB(Math.min(1, Math.max(0, ai[k]))); out[o + 2] = toSRGB(Math.min(1, Math.max(0, br[k]))); out[o + 3] = 255;
  }
  return out;
}

// Linear-light value of an sRGB byte (for tests and readouts).
export const linear = (byte) => TOLIN[byte];
