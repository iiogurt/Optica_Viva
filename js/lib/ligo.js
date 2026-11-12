// LIGO as an optical instrument: the quantum noise of a Michelson interferometer with Fabry–Perot
// arms, and the signal of a compact binary. Pure functions, SI units.
//
// Quantum noise (Kimble et al. 2001, conventional interferometer; Buonanno & Chen 2001 show that
// tuned signal recycling gives the same form with a wider bandwidth γ): with Ω = 2πf, arm length L,
// test-mass mass m, laser angular frequency ω₀, circulating arm power P and detector half-bandwidth γ,
//   h_SQL² = 8ħ / (m Ω² L²),        K = 16 ω₀ γ P / (c m L Ω² (γ² + Ω²))  (the optomechanical coupling),
//   S_h = h_SQL²/2 · (1/K + K)      (one-sided strain power spectral density),
// the first term photon shot noise, the second radiation-pressure noise. (K follows from Kimble's
// I₀/I_SQL · 2γ⁴/(Ω²(γ²+Ω²)) with I_SQL = m L² γ⁴/(4ω₀) and the input power I₀ = 2γLP/c.)
// Squeezed vacuum at the dark port, e^{−2r} in power: phase squeezing multiplies the shot term by
// e^{−2r} and the radiation-pressure term by e^{2r}; frequency-dependent squeezing both by e^{−2r}.
// Losses, classical noises (seismic, thermal, Newtonian) and the detuned signal-recycling response
// are left out.
//
// Inspiral (stationary phase, Newtonian order; Cutler & Flanagan 1994), an optimally oriented binary
// overhead at luminosity distance D (no redshift): |h̃(f)| = √(5/24) π^(−2/3) (G𝓜/c³)^(5/6) (c/D) f^(−7/6)
// up to f_ISCO = c³/(6^(3/2) π G M); ρ² = 4 ∫ |h̃|²/S_h df. The horizon is the distance at ρ = 8; the
// sky- and orientation-averaged range is the horizon / 2.264.

import { fft1d } from './fft.js';
import { makeRng } from './random.js';

export const C = 299792458, HBAR = 1.054571817e-34, G = 6.6743e-11, MSUN = 1.98847e30, MPC = 3.0856775814913673e22;

export const DEFAULTS = { L: 3994.5, m: 40, lambda: 1064e-9, P: 400e3, fbw: 450, sqzDb: 0, sqz: 'none' };

export const hSQL2 = (f, o) => (8 * HBAR) / (o.m * (2 * Math.PI * f) ** 2 * o.L ** 2);
export function coupling(f, o) {
  const W = 2 * Math.PI * f, g = 2 * Math.PI * o.fbw, w0 = (2 * Math.PI * C) / o.lambda;
  return (16 * w0 * g * o.P) / (C * o.m * o.L * W * W * (g * g + W * W));
}
// The two quantum noises and their sum, one-sided strain PSD (1/Hz).
export function noise(f, o) {
  const K = coupling(f, o), q = hSQL2(f, o) / 2, e = 10 ** (-(o.sqzDb || 0) / 10);
  const [a, b] = o.sqz === 'phase' ? [e, 1 / e] : o.sqz === 'freq' ? [e, e] : [1, 1];
  const shot = (q / K) * a, rp = q * K * b;
  return { shot, rp, total: shot + rp, sql: 2 * q };
}
// Frequency at which shot and radiation-pressure noise are equal (K = 1, no squeezing): the total
// touches the SQL there. Solved by bisection on log f.
export function crossover(o) {
  let lo = 0.01, hi = 1e5;
  for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); if (coupling(mid, o) > 1) lo = mid; else hi = mid; }
  return Math.sqrt(lo * hi);
}

export const BINARIES = {
  bns: { m1: 1.4, m2: 1.4 },
  nsbh: { m1: 10, m2: 1.4 },
  bbh: { m1: 36, m2: 29 },
};
export const chirpMass = (m1, m2) => ((m1 * m2) ** 0.6) / (m1 + m2) ** 0.2;
export const fISCO = (M) => C ** 3 / (6 ** 1.5 * Math.PI * G * M * MSUN);
// |h̃(f)| (strain per hertz) of an optimally oriented binary at D (Mpc)
export function hTilde(f, m1, m2, D) {
  const Mc = chirpMass(m1, m2) * MSUN, tM = (G * Mc) / C ** 3;
  return Math.sqrt(5 / 24) * Math.PI ** (-2 / 3) * tM ** (5 / 6) * (C / (D * MPC)) * f ** (-7 / 6);
}
// Time to coalescence from frequency f (Newtonian): τ = 5/256 (G𝓜/c³)^(−5/3) (πf)^(−8/3)
export const tauOf = (f, m1, m2) => { const tM = (G * chirpMass(m1, m2) * MSUN) / C ** 3; return (5 / 256) * tM ** (-5 / 3) * (Math.PI * f) ** (-8 / 3); };
// Matched-filter SNR (optimal orientation), integrated on a log grid from fmin to f_ISCO
export function snr(o, m1, m2, D, fmin = 10) {
  const fmax = fISCO(m1 + m2), n = 2000, a = Math.log(fmin), b = Math.log(fmax);
  if (fmax <= fmin) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.exp(a + ((i + 0.5) / n) * (b - a)), ht = hTilde(f, m1, m2, D);
    s += ((ht * ht) / noise(f, o).total) * f;
  }
  return Math.sqrt(4 * s * ((b - a) / n));
}
export const horizon = (o, m1, m2, fmin = 10) => snr(o, m1, m2, 1, fmin) / 8;
export const range = (o, m1, m2, fmin = 10) => horizon(o, m1, m2, fmin) / 2.264;

// Four seconds of whitened detector output (fs = 4096 Hz), band-passed 20–1024 Hz: unit-variance
// quantum noise plus the inspiral, merging 3.5 s in. The inspiral is made in the frequency domain by
// the stationary-phase approximation, h̃ = |h̃| e^{−iΨ}, Ψ = 2πf t_c − π/4 + (3/128)(πG𝓜f/c³)^(−5/3),
// and whitened by √(2/(Δt S_h)); only frequencies whose time to merger fits in the window are kept.
export const FS = 4096, N = 16384, TC = 3.5, BAND = [20, 1024];
export function whitened(o, m1, m2, D, seed = 1) {
  const dt = 1 / FS, rng = makeRng(seed), nr = new Float64Array(N), ni = new Float64Array(N);
  for (let i = 0; i < N; i++) nr[i] = rng.g();
  fft1d(nr, ni);
  const sr = new Float64Array(N), si = new Float64Array(N), tM = (G * chirpMass(m1, m2) * MSUN) / C ** 3, fmax = Math.min(fISCO(m1 + m2), BAND[1]);
  const fstart = Math.max(BAND[0], (tauOf(1, m1, m2) / (TC - 0.3)) ** (3 / 8));
  let rho2 = 0;
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * FS) / N, inBand = f >= BAND[0] && f <= BAND[1];
    if (!inBand) { nr[k] = ni[k] = 0; if (k) { nr[N - k] = ni[N - k] = 0; } continue; }
    if (f < fstart || f > fmax) continue;
    const S = noise(f, o).total, amp = hTilde(f, m1, m2, D) * Math.sqrt(2 / (dt * S));
    const taper = Math.min(1, (f - fstart) / (0.15 * fstart + 1e-9)) * Math.min(1, (fmax - f) / (0.05 * fmax));
    const psi = 2 * Math.PI * f * TC - Math.PI / 4 + (3 / 128) * (Math.PI * tM * f) ** (-5 / 3);
    sr[k] = amp * taper * Math.cos(psi); si[k] = -amp * taper * Math.sin(psi);
    if (k && k < N / 2) { sr[N - k] = sr[k]; si[N - k] = -si[k]; }
    rho2 += (4 * hTilde(f, m1, m2, D) ** 2 * taper * taper * FS) / (N * S);
  }
  fft1d(sr, si, true); fft1d(nr, ni, true);
  // the band-pass keeps (1024 − 20)/2048 of white noise's variance: rescale the noise to unit variance
  const g = 1 / Math.sqrt((BAND[1] - BAND[0]) / (FS / 2));
  const data = new Float32Array(N), clean = new Float32Array(N);
  for (let i = 0; i < N; i++) { clean[i] = sr[i] * g; data[i] = (nr[i] + sr[i]) * g; }
  return { data, clean, fstart, fmax, snrWindow: Math.sqrt(rho2) };
}
// Constant-Q map (as in gravitational-wave searches): for NF frequencies spaced evenly in log f from
// 20 to 1024 Hz, the data's spectrum times a Gaussian of width σ_f = f/Q around f, brought to zero
// frequency and transformed back on M samples over the whole record; |z|² is the energy in that band
// at each time, divided by its median / ln 2 so that noise averages 1 in every row (the median is
// barely moved by a short signal). Rows run from the lowest frequency up.
export function qtransform(x, { NF = 96, M = 1024, Q = 6, f0 = BAND[0], f1 = BAND[1] } = {}) {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
  fft1d(re, im);
  const out = new Float32Array(NF * M), zr = new Float64Array(M), zi = new Float64Array(M), df = FS / n, row = new Float64Array(M);
  for (let r = 0; r < NF; r++) {
    const f = f0 * (f1 / f0) ** (r / (NF - 1)), sig = f / Q, kc = Math.round(f / df), kw = Math.min(M / 2 - 1, Math.ceil((3 * sig) / df));
    zr.fill(0); zi.fill(0);
    for (let d = -kw; d <= kw; d++) {
      const k = kc + d; if (k <= 0 || k >= n / 2) continue;
      const g = Math.exp(-0.5 * ((d * df) / sig) ** 2), j = (d + M) % M;
      zr[j] = re[k] * g; zi[j] = im[k] * g;
    }
    fft1d(zr, zi, true);
    for (let j = 0; j < M; j++) row[j] = zr[j] * zr[j] + zi[j] * zi[j];
    const med = Float64Array.from(row).sort()[M >> 1] / Math.LN2 || 1;
    for (let j = 0; j < M; j++) out[r * M + j] = row[j] / med;
  }
  return { NF, M, data: out, f0, f1, T: n / FS };
}
