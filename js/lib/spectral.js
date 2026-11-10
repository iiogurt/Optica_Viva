// The spectral camera: a scene rendered wavelength by wavelength. Each pixel holds a material: a
// reflectance lit by the illuminant, or a light source with its own spectrum. Sixteen 25 nm bands
// cover 380–780 nm; in every band the scene is convolved with the lens's PSF at that wavelength
// (traced, in js/lib/tasks.js) and shifted by its lateral colour. The bands are then summed with
// the eye's colour-matching functions and with the camera's spectral sensitivities, followed by
// white balance and a fitted colour matrix, to give what an observer and what a camera would see.
import { LAMBDA, daylight, adapt, xyzToSRGB, lab, deltaE00, fitMatrix, CAMERAS, EXTRA_PATCHES, D65_XYZ } from './colorsci.js';
import { CMF, TCS, ILLUMINANTS, NWL } from './colordata.js';
import { fft2d } from './fft.js';
import { oetf } from './color.js';
import { aimRay, trace } from './raytrace.js';

const oetfClip = (v) => oetf(Math.min(1, Math.max(0, v)));

export const NB = 16, PER = 5; // 16 bands of five 5 nm samples
export const BAND_LAMBDA = Array.from({ length: NB }, (_, b) => LAMBDA[b * PER] + 10); // 390 … 765 nm
export const SW = 192, SH = 128, FN = 256; // the sensor crop (px) and the FFT grid around it

export const ILLUM = { D65: daylight(6504), A: ILLUMINANTS.A.spd, FL11: ILLUMINANTS.FL11.spd, HP1: ILLUMINANTS.HP1.spd };
const gauss = (mu, s) => LAMBDA.map((l) => Math.exp(-0.5 * ((l - mu) / s) ** 2));
// light sources in the scene (relative spectral radiance), each about 40 times a white patch
export const EMITTERS = [
  { name: 'Sodium lamp', spd: gauss(589, 2.5) },
  { name: 'Red laser, 650 nm', spd: gauss(650, 1.2) },
  { name: 'Blue LED', spd: gauss(455, 10) },
  { name: 'White LED', spd: gauss(450, 10).map((v, i) => v + 0.8 * gauss(565, 50)[i]) },
];
const PATCHES = [...TCS, ...EXTRA_PATCHES.map((p) => p.r)]; // 24 reflectances
const GREY = 0, WHITE = 1, BLACK = 2, P0 = 3, E0 = P0 + PATCHES.length;

// Material map: 24 patches (the 14 CIE test samples and 10 more), a bar target and a slanted
// edge below them, a 24-spoke Siemens star on the right and four point sources under it.
export function sceneMap() {
  const mat = new Uint8Array(SW * SH).fill(GREY), set = (x, y, m) => { if (x >= 0 && y >= 0 && x < SW && y < SH) mat[y * SW + x] = m; };
  for (let k = 0; k < PATCHES.length; k++) {
    const cx = 6 + (k % 6) * 18, cy = 8 + Math.floor(k / 6) * 18;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(cx + x, cy + y, P0 + k);
  }
  for (let y = 88; y < 122; y++) for (let x = 6; x < 56; x++) set(x, y, Math.floor((x - 6) / 4) % 2 ? BLACK : WHITE);
  for (let y = 88; y < 122; y++) for (let x = 60; x < 110; x++) set(x, y, (y - 105) < (x - 85) * Math.tan(0.09) ? WHITE : BLACK);
  for (let y = 0; y < SH; y++) for (let x = 116; x < SW; x++) {
    const dx = x + 0.5 - 154, dy = y + 0.5 - 46, r = Math.hypot(dx, dy);
    if (r < 36) set(x, y, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 48) % 2 ? BLACK : WHITE);
  }
  EMITTERS.forEach((_, k) => set(128 + k * 18, 106, E0 + k));
  return { mat, nMat: E0 + EMITTERS.length, patch: (k) => ({ x: 6 + (k % 6) * 18 + 8, y: 8 + Math.floor(k / 6) * 18 + 8 }) };
}
export const N_PATCHES = PATCHES.length;

// Per material and band: the radiance Σ r E Δλ (reflectors) or Σ L Δλ (sources), with E scaled so
// that a perfect white reflector has luminance Y = 1. Per channel and band, the illuminant-weighted
// mean sensitivity, which makes the band sums exact for reflectances that are flat within a band.
export function bandData(illumKey, sens) {
  const E = ILLUM[illumKey], Yw = E.reduce((a, e, i) => a + e * CMF[1][i], 0), k = 1 / Yw;
  const refl = [LAMBDA.map(() => 0.18), LAMBDA.map(() => 0.9), LAMBDA.map(() => 0.03), ...PATCHES];
  const L = [], sum = (f, b) => { let s = 0; for (let i = b * PER; i < (b + 1) * PER; i++) s += f(i); return s; };
  for (const r of refl) L.push(Float64Array.from({ length: NB }, (_, b) => k * sum((i) => r[i] * E[i], b)));
  for (const em of EMITTERS) {
    const Y = em.spd.reduce((a, v, i) => a + v * CMF[1][i], 0), ke = 40 / Y;
    L.push(Float64Array.from({ length: NB }, (_, b) => ke * sum((i) => em.spd[i], b)));
  }
  const weights = (s) => Float64Array.from({ length: NB }, (_, b) => { const e = sum((i) => E[i], b); return e > 0 ? sum((i) => E[i] * s[i], b) / e : sum((i) => s[i], b) / PER; });
  return { L, eye: CMF.map(weights), cam: sens.map(weights), white: Float64Array.from({ length: NB }, (_, b) => k * sum((i) => E[i], b)) };
}

// One band of the scene as an image.
export function bandImage(scene, L, b, out = new Float32Array(SW * SH)) {
  for (let p = 0; p < SW * SH; p++) out[p] = L[scene.mat[p]][b];
  return out;
}

// Convolve a band image with a kernel (ks × ks, odd, centred, sum 1) shifted by (sx, sy) px, by FFT
// on the FN × FN grid with the image's edges extended. The shift is a phase ramp: exact, sub-pixel.
export function convolveBand(img, kernel, ks, sx = 0, sy = 0) {
  const N = FN, ox = (N - SW) >> 1, oy = (N - SH) >> 1, ar = new Float64Array(N * N), ai = new Float64Array(N * N), kr = new Float64Array(N * N), ki = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const yy = Math.min(SH - 1, Math.max(0, y - oy));
    for (let x = 0; x < N; x++) ar[y * N + x] = img[yy * SW + Math.min(SW - 1, Math.max(0, x - ox))];
  }
  const h = ks >> 1;
  for (let y = 0; y < ks; y++) for (let x = 0; x < ks; x++) kr[((y - h + N) % N) * N + ((x - h + N) % N)] = kernel[y * ks + x];
  fft2d(ar, ai, N); fft2d(kr, ki, N);
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const k = v * N + u, fu = (u < N / 2 ? u : u - N) / N, fv = (v < N / 2 ? v : v - N) / N, ph = -2 * Math.PI * (fu * sx + fv * sy);
    const c = Math.cos(ph), s = Math.sin(ph), hr = kr[k] * c - ki[k] * s, hi = kr[k] * s + ki[k] * c, a = ar[k], bb = ai[k];
    ar[k] = a * hr - bb * hi; ai[k] = a * hi + bb * hr;
  }
  fft2d(ar, ai, N, true);
  const out = new Float32Array(SW * SH);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) out[y * SW + x] = ar[(y + oy) * N + x + ox];
  return out;
}

// Resample a centred n × n PSF (sample spacing s µm, sum 1) onto sensor pixels of pitch p µm,
// moved by (ox, oy) µm (the lateral colour; done here because a Fourier shift of a one-pixel light
// source rings across the whole frame): each pixel integrates the PSF over its area (4 × 4
// sub-samples, bilinear). Returns a ks × ks
// kernel (sum 1) and the radius about the centroid holding 80 % of the PSF's energy (µm; a
// diffraction PSF's RMS radius grows without limit with the window, through the Airy wings).
export function psfKernel(I, n, s, p, ks = 65, ox = 0, oy = 0) {
  const h = ks >> 1, K = new Float64Array(ks * ks), c = n / 2;
  const at = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    if (x0 < 0 || y0 < 0 || x0 >= n - 1 || y0 >= n - 1) return 0;
    const q = y0 * n + x0;
    return (I[q] * (1 - fx) + I[q + 1] * fx) * (1 - fy) + (I[q + n] * (1 - fx) + I[q + n + 1] * fx) * fy;
  };
  let tot = 0;
  for (let j = 0; j < ks; j++) for (let i = 0; i < ks; i++) {
    let v = 0;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) v += at(c + ((i - h + (a + 0.5) / 4 - 0.5) * p - ox) / s, c + ((j - h + (b + 0.5) / 4 - 0.5) * p - oy) / s);
    K[j * ks + i] = v; tot += v;
  }
  for (let k = 0; k < K.length; k++) K[k] /= tot || 1;
  let m = 0, mx = 0, my = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = I[y * n + x]; m += v; mx += v * x; my += v * y; }
  mx /= m; my /= m;
  const NR = n, hist = new Float64Array(NR); // energy in rings of one sample
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.min(NR - 1, Math.floor(Math.hypot(x - mx, y - my))); hist[r] += I[y * n + x]; }
  let acc = 0, ee80 = NR * s;
  for (let r = 0; r < NR; r++) { if (acc + hist[r] >= 0.8 * m) { ee80 = (r + (0.8 * m - acc) / hist[r]) * s; break; } acc += hist[r]; }
  return { K, ks, ee80 };
}

// Sum the bands into what the eye and the camera see. Eye: XYZ with the colour-matching functions,
// adapted to D65 (Bradford). Camera: raw RGB with its sensitivities, white-balanced on a perfect
// white, then a 3 × 3 matrix fitted on the 24 patches (sharp, by least squares with white exact).
// Both are shown in sRGB with white at 85 %. Also returns the camera's CIEDE2000 error per patch.
export function compose(bands, D, exposure = 0.85) {
  const n = SW * SH, X = [new Float64Array(n), new Float64Array(n), new Float64Array(n)], R = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let b = 0; b < NB; b++) {
    const img = bands[b];
    for (let c = 0; c < 3; c++) { const we = D.eye[c][b], wc = D.cam[c][b]; for (let p = 0; p < n; p++) { X[c][p] += img[p] * we; R[c][p] += img[p] * wc; } }
  }
  const sumB = (L, w) => L.reduce((a, v, b) => a + v * w[b], 0);
  const Wx = D.eye.map((w) => sumB(D.white, w)), k = 100 / Wx[1], Wn = Wx.map((v) => v * k);
  const Wr = D.cam.map((w) => sumB(D.white, w)), gain = Wr.map((v) => 1 / v); // white → (1, 1, 1)
  // the matrix, fitted on the sharp patches
  const truth = [], raw = [];
  for (let m = P0; m < E0; m++) { truth.push(adapt(D.eye.map((w) => sumB(D.L[m], w) * k), Wn, D65_XYZ)); raw.push(D.cam.map((w, c) => sumB(D.L[m], w) * gain[c])); }
  const M = fitMatrix(raw, truth, [1, 1, 1], D65_XYZ);
  const camXYZ = raw.map((v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]));
  const dE = truth.map((t, i) => deltaE00(lab(t), lab(camXYZ[i])));
  const eye = new Uint8ClampedArray(n * 4), cam = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const e = xyzToSRGB(adapt([X[0][p] * k, X[1][p] * k, X[2][p] * k], Wn, D65_XYZ));
    const r = [R[0][p] * gain[0], R[1][p] * gain[1], R[2][p] * gain[2]];
    const c = xyzToSRGB(M.map((row) => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]));
    for (let q = 0; q < 3; q++) { eye[p * 4 + q] = 255 * oetfClip(e[q] * exposure); cam[p * 4 + q] = 255 * oetfClip(c[q] * exposure); }
    eye[p * 4 + 3] = cam[p * 4 + 3] = 255;
  }
  return { eye, cam, dE, M, mean: dE.reduce((a, v) => a + v, 0) / dE.length, max: Math.max(...dE) };
}

// Best focus at one wavelength and field: the image plane where the real rays through a 15 × 15
// pupil grid have the smallest RMS spot. With x + Δz·(dx/dz) for every ray the RMS is quadratic
// in Δz, so Δz = −Σ x̃·t̃ / Σ t̃² (x̃, t̃ about their means). Returns z in lens units (mm).
export function bestFocus(lens, lam, theta, par, sd, z0) {
  const xs = [], ys = [], tx = [], ty = [];
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) {
    const px = -1 + i / 7, py = -1 + j / 7;
    if (px * px + py * py > 1) continue;
    const a = aimRay(lens, lam, theta, px, py, par);
    if (!a) continue;
    const r = trace(lens, lam, a.p, a.d, { sd, zv: par.zv });
    if (!r.ok || r.d[2] <= 0) continue;
    const u = (z0 - r.p[2]) / r.d[2];
    xs.push(r.p[0] + u * r.d[0]); ys.push(r.p[1] + u * r.d[1]); tx.push(r.d[0] / r.d[2]); ty.push(r.d[1] / r.d[2]);
  }
  if (xs.length < 8) return z0;
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length, mx = m(xs), my = m(ys), mtx = m(tx), mty = m(ty);
  let num = 0, den = 0;
  for (let k = 0; k < xs.length; k++) { num += (xs[k] - mx) * (tx[k] - mtx) + (ys[k] - my) * (ty[k] - mty); den += (tx[k] - mtx) ** 2 + (ty[k] - mty) ** 2; }
  return den > 0 ? z0 - num / den : z0;
}
export { CAMERAS };
