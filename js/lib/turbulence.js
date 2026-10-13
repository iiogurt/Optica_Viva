// Atmospheric turbulence: seeded Gaussian random numbers and von Kármán phase screens.
import { fft2d } from './fft.js';
import { makeRng } from './random.js';

// Gaussian random numbers from a seeded stream (see js/lib/random.js)
export function rng(seed) { return makeRng(seed).g; }

// von Kármán phase screen (radians at 500 nm), FFT method + 3 levels of subharmonics
// (Lane, Glindemann & Dainty 1992; Schmidt 2010, ft_sh_phase_screen).
export function phaseScreen(N, dx, r0, L0, seed) {
  const g = rng(seed);
  const df = 1 / (N * dx);
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  const PSD = (f) => 0.023 * Math.pow(r0, -5 / 3) * Math.pow(f * f + 1 / (L0 * L0), -11 / 6);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x < N / 2 ? x : x - N) * df, fy = (y < N / 2 ? y : y - N) * df;
    const f = Math.hypot(fx, fy);
    if (f === 0) continue;
    const a = Math.sqrt(PSD(f)) * df;
    re[y * N + x] = g() * a; im[y * N + x] = g() * a;
  }
  fft2d(re, im, N, true);
  const scr = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) scr[i] = re[i] * N * N; // undo the 1/N² of the inverse transform
  // subharmonics for the low frequencies the FFT grid cannot represent
  const D = N * dx;
  for (let p = 1; p <= 3; p++) {
    const dfp = 1 / (Math.pow(3, p) * D);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      const fx = a * dfp, fy = b * dfp, amp = Math.sqrt(PSD(Math.hypot(fx, fy))) * dfp;
      const cr = g() * amp, ci = g() * amp;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const ph = 2 * Math.PI * (fx * x * dx + fy * y * dx);
        scr[y * N + x] += cr * Math.cos(ph) - ci * Math.sin(ph);
      }
    }
  }
  let m = 0; for (let i = 0; i < N * N; i++) m += scr[i]; m /= N * N;
  for (let i = 0; i < N * N; i++) scr[i] -= m;
  return scr;
}
