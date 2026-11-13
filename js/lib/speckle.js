// Coherent imaging and laser speckle. A diffusely reflecting object (a printed target or an edge) is
// imaged through a round pupil by Fourier optics on an n × n grid whose pixel is λN/4, so the coherent
// cut-off NA/λ lies n/8 frequency samples from the centre for every wavelength and f-number.
// Laser light: the field A·e^{iφ} is low-pass filtered by the pupil and then squared, so random
// surface phases interfere into speckle. Partially coherent light (Abbe): the intensities of tilted
// plane-wave illuminations from S points of the source are added. A rotating diffuser and a second
// polarisation add further independent patterns; camera pixels larger than the speckle average it.
import { fft2d } from './fft.js';
import { makeRng } from './random.js';

export const NGRID = 256;
export const FC = NGRID / 8; // coherent cut-off in frequency samples (pixel = λN/4)
export const WHITE = 0.85, INK = 0.08;

// The object's amplitude reflectance: a printed target (bars of three periods, a disk, a block)
// or a straight edge between ink and paper.
export function object(kind, n = NGRID, hi = WHITE, lo = INK) {
  const A = new Float32Array(n * n).fill(hi), s = n / 256;
  const fill = (f) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (f(x / s, y / s)) A[y * n + x] = lo; };
  if (kind === 'edge') { fill((x) => x >= 128); return A; }
  // bars with periods 6, 10 and 16 px (1.5, 2.5 and 4 λN)
  [[6, 140, 30], [10, 140, 96], [16, 140, 170]].forEach(([p, y0, x0]) => fill((x, y) => y >= y0 && y < y0 + 90 && x >= x0 && x < x0 + 5 * p && (x - x0) % p < p / 2));
  fill((x, y) => (x - 196) ** 2 + (y - 60) ** 2 < 26 ** 2);
  fill((x, y) => x >= 120 && x < 150 && y >= 30 && y < 100 && !(x >= 128 && y < 92));
  return A;
}
// A plain paper area used for the statistics (inside the region every pixel should be equal)
export const REGION = { edge: [20, 20, 100, 236], target: [10, 10, 100, 120] }; // x0, y0, x1, y1 at n = 256

// The looks added for one picture: source points (Abbe) × diffuser positions × polarisations.
// Source points fill a disk of radius σ·FC on a grid of spacing FC/2 (patterns from points that far
// apart are nearly independent).
export function looks({ sigma = 0, frames = 1, pol = false }) {
  const pts = [[0, 0]];
  if (sigma > 0) {
    const R = sigma * FC, h = FC / 2;
    pts.length = 0;
    for (let y = -Math.floor(R / h); y <= Math.floor(R / h); y++) for (let x = -Math.floor(R / h); x <= Math.floor(R / h); x++) if ((x * h) ** 2 + (y * h) ** 2 <= R * R + 1e-9) pts.push([x * h, y * h]);
  }
  const out = [];
  for (const [fx, fy] of pts) for (let m = 0; m < frames; m++) for (let p = 0; p < (pol ? 2 : 1); p++) out.push({ fx, fy, m, p, diffuser: frames > 1 });
  return out;
}

// The summed intensity of a list of looks (same object and roughness): each look is
// |IFFT[P(f − f_s) · FFT(A e^{iφ_p} e^{iψ_m})]|². The object's spectrum depends only on the diffuser
// position and polarisation, so it is transformed once for each and filtered for every source point.
// Returns Float32 n × n.
export function image(kind, rough, list, n = NGRID, hi = WHITE, lo = INK) {
  const A = object(kind, n, hi, lo), sp = 4 * Math.PI * rough, out = new Float32Array(n * n), fc = (FC * n) / NGRID;
  const phase = (seed) => { const r = makeRng(seed), a = new Float64Array(n * n); for (let i = 0; i < n * n; i++) a[i] = r.g(); return a; };
  const surf = {}, groups = new Map();
  for (const L of list) { const k = `${L.diffuser ? L.m : -1}|${L.p}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(L); }
  const Sr = new Float64Array(n * n), Si = new Float64Array(n * n), re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (const [, G] of groups) {
    const L0 = G[0], dif = L0.diffuser ? makeRng(1000 + L0.m) : null, ph = surf[L0.p] || (surf[L0.p] = phase(11 + L0.p));
    for (let i = 0; i < n * n; i++) { const a = sp * ph[i] + (dif ? 2 * Math.PI * dif.u() : 0); Sr[i] = A[i] * Math.cos(a); Si[i] = A[i] * Math.sin(a); }
    fft2d(Sr, Si, n);
    for (const L of G) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = x < n / 2 ? x : x - n, fy = y < n / 2 ? y : y - n, i = y * n + x, inP = (fx - L.fx) ** 2 + (fy - L.fy) ** 2 <= fc * fc;
        re[i] = inP ? Sr[i] : 0; im[i] = inP ? Si[i] : 0;
      }
      fft2d(re, im, n, true);
      for (let i = 0; i < n * n; i++) out[i] += re[i] * re[i] + im[i] * im[i];
    }
  }
  return out;
}
// Split looks over k workers, keeping each diffuser position and polarisation together where possible.
export function split(list, k) {
  const parts = Array.from({ length: k }, () => []);
  list.forEach((L, i) => parts[Math.floor((i * k) / list.length)].push(L));
  return parts.filter((p) => p.length);
}
// Incoherent imaging of the same object: |A|² filtered by the OTF (the autocorrelation of the pupil).
export function incoherent(kind, n = NGRID, hi = WHITE, lo = INK) {
  const A = object(kind, n, hi, lo), fc = (FC * n) / NGRID, pr = new Float64Array(n * n), pi = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const fx = x < n / 2 ? x : x - n, fy = y < n / 2 ? y : y - n; if (fx * fx + fy * fy <= fc * fc) pr[y * n + x] = 1; }
  fft2d(pr, pi, n, true); // amplitude PSF
  const hr = new Float64Array(n * n), hi2 = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) hr[i] = pr[i] * pr[i] + pi[i] * pi[i];
  fft2d(hr, hi2, n); // OTF (unnormalised)
  const o0 = hr[0], re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = A[i] * A[i];
  fft2d(re, im, n);
  for (let i = 0; i < n * n; i++) { const a = re[i], b = im[i], c = hr[i] / o0, d = hi2[i] / o0; re[i] = a * c - b * d; im[i] = a * d + b * c; }
  fft2d(re, im, n, true);
  return Float32Array.from(re);
}

// Camera pixels k grid pixels wide: the mean over each k × k block (n/k × n/k picture).
export function bin(I, n, k) {
  const m = Math.floor(n / k), out = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let s = 0;
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) s += I[(j * k + y) * n + i * k + x];
    out[j * m + i] = s / (k * k);
  }
  return { a: out, m };
}
// Mean, contrast σ/⟨I⟩ and the normalised values inside a rectangle of a picture m wide (region at n = 256).
export function stats(I, m, [x0, y0, x1, y1]) {
  const s = m / NGRID, v = [];
  for (let y = Math.ceil(y0 * s); y < Math.floor(y1 * s); y++) for (let x = Math.ceil(x0 * s); x < Math.floor(x1 * s); x++) v.push(I[y * m + x]);
  const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, contrast: sd / mean, values: v.map((x) => x / mean) };
}
// The intensity autocovariance along x inside a region, normalised to 1 at zero lag.
export function autocov(I, n, [x0, y0, x1, y1], maxLag = 12) {
  const v = [], mean = (() => { let s = 0, c = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += I[y * n + x]; c++; } return s / c; })();
  for (let d = 0; d <= maxLag; d++) {
    let s = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1 - d; x++) { s += (I[y * n + x] - mean) * (I[y * n + x + d] - mean); c++; }
    v.push(s / c);
  }
  return v.map((x) => x / v[0]);
}
// Theory. Gamma density of the sum of L independent speckle patterns, normalised to mean 1
// (L = 1: the exponential law of fully developed speckle).
export function gammaPdf(I, L) { let lg = 0; for (let k = 1; k < L; k++) lg += Math.log(k); return Math.exp(L * Math.log(L) + (L - 1) * Math.log(Math.max(I, 1e-300)) - L * I - lg); }
// Speckle size: the intensity autocorrelation of fully developed speckle is |2J1(v)/v|², v = 2π NA Δx/λ,
// first zero at Δx = 0.61 λ/NA = 1.22 λN.
export const speckleSize = (lambdaUm, N) => 1.22 * lambdaUm * N;
// Coherent transfer function (the pupil) and incoherent OTF of a round pupil, f in units of NA/λ.
export const ctf = (f) => (Math.abs(f) <= 1 ? 1 : 0);
export function otf(f) { const v = Math.min(1, Math.abs(f) / 2); return (2 / Math.PI) * (Math.acos(v) - v * Math.sqrt(1 - v * v)); }
// The amplitude overshoot of a coherently imaged edge with a sharp cut-off: 1/2 + Si(π)/π.
export function gibbs() { let s = 0; const m = 20000; for (let i = 0; i < m; i++) { const x = ((i + 0.5) / m) * Math.PI; s += Math.sin(x) / x; } return 0.5 + (s * Math.PI) / m / Math.PI; }
