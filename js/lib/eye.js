// The human eye as an optical system: Le Grand's full theoretical schematic eye (four spherical
// surfaces), its longitudinal chromatic aberration, and the retinal MTF as a function of pupil
// size with diffraction, typical higher-order aberrations and the Stiles–Crawford effect.
import { paraxialMatrix } from './raytrace.js';
import { index } from './glass.js';
import { rasterAperture, zernikeWavefront, psf, pupilCoords } from './pupil.js';
import { fft2d } from './fft.js';

// Ocular media as model glasses (n_d, V_d): Le Grand indices with water-like dispersion
// (water: V_d ≈ 55.7), the usual assumption of chromatic schematic eyes.
export const MEDIA = { cornea: { nd: 1.3771, vd: 56 }, aqueous: { nd: 1.3374, vd: 55 }, lens: { nd: 1.42, vd: 52 }, vitreous: { nd: 1.336, vd: 55 } };
// Le Grand full theoretical eye, relaxed (Le Grand & El Hage 1980; Atchison & Smith 2000).
export const LE_GRAND = {
  name: 'Le Grand full theoretical eye', epd: 4,
  surfaces: [
    { R: 7.8, t: 0.55, glass: MEDIA.cornea },
    { R: 6.5, t: 3.05, glass: MEDIA.aqueous },
    { R: 10.2, t: 4.0, glass: MEDIA.lens, stop: true },
    { R: -6.0, t: 16.5966, glass: MEDIA.vitreous },
  ],
};

// Power (D), posterior focal distance from the last vertex (mm, in the vitreous) and the
// refractive error (D) at wavelength λ: the vergence, in air, of the object point conjugate to
// the retina (positive = myopic, the eye is focused at 1000/R mm). With S = T(L/n′)·M the
// vertex-to-retina matrix, the object at distance s images on the retina when S₀₀s + S₀₁ = 0.
export function eyeAt(lam, eye = LE_GRAND) {
  const N = eye.surfaces.length, M = paraxialMatrix(eye, lam, 0, N), nV = index(eye.surfaces[N - 1].glass, lam), L = eye.surfaces[N - 1].t;
  const S00 = M[0] + (L / nV) * M[2], S01 = M[1] + (L / nV) * M[3];
  return { power: -1000 * M[2], bfl: (nV * -M[0]) / M[2], error: (-1000 * S00) / S01 };
}
// Chromatic difference of refraction relative to a reference wavelength (D).
export const chromaticDifference = (lam, ref = 555) => eyeAt(lam).error - eyeAt(ref).error;
// Thibos et al. (1992) "chromatic eye" fit to measured data: R(λ) = p − q/(λ − c) (D, λ in nm).
export const thibos = (lam) => 1.68524 - 633.46 / (lam - 214.102);

// Representative higher-order aberrations of young adult eyes for a 6 mm pupil (µm RMS, Noll
// indices; magnitudes after Thibos, Hong, Bradley & Cheng 2002), scaled to other pupils as
// (p/6)^n for radial order n.
export const HOA6 = { 7: 0.07, 8: -0.05, 9: 0.04, 11: 0.13, 12: 0.03, 13: -0.02 };
const ORDER = { 7: 3, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4, 13: 4 };
export function hoaFor(p, scale = 1) {
  const c = {};
  for (const [j, v] of Object.entries(HOA6)) c[j] = v * scale * Math.pow(p / 6, ORDER[j]);
  return c;
}

// Retinal MTF (radial average, monochromatic λ) for a pupil of p mm. Returns frequencies in cycles
// per degree and the MTF, plus the Strehl ratio. o = { p, lam (nm), hoa (scale), sc (Stiles–Crawford) }
export function eyeMTF(o, n = 128, Dpx = 40) {
  const amp = Float64Array.from(rasterAperture({ type: 'circle' }, n, Dpx, 4));
  if (o.sc) { const { rho } = pupilCoords(n, Dpx); for (let k = 0; k < n * n; k++) amp[k] *= Math.pow(10, (-0.05 * (rho[k] * o.p / 2) ** 2) / 2); }
  const W = o.hoa ? zernikeWavefront(n, Dpx, hoaFor(o.p, o.hoa)) : null;
  const lamUm = o.lam / 1000, I = psf(amp, W, n, lamUm).I, I0 = psf(amp, null, n, lamUm).I;
  let pk = 0, pk0 = 0; for (let k = 0; k < n * n; k++) { if (I[k] > pk) pk = I[k]; if (I0[k] > pk0) pk0 = I0[k]; }
  const re = Float64Array.from(I), im = new Float64Array(n * n);
  fft2d(re, im, n);
  const bins = new Float64Array(n / 2), cnt = new Float64Array(n / 2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const kx = x < n / 2 ? x : x - n, ky = y < n / 2 ? y : y - n, r = Math.round(Math.hypot(kx, ky));
    if (r < n / 2) { bins[r] += Math.hypot(re[y * n + x], im[y * n + x]); cnt[r]++; }
  }
  const m0 = bins[0] / cnt[0], cyclesPerRadAt = (k) => (k / Dpx) * (o.p / (o.lam * 1e-6)); // OTF support Dpx ↔ D/λ
  const freq = [], mtf = [];
  for (let k = 0; k < n / 2; k++) { freq.push((cyclesPerRadAt(k) * Math.PI) / 180); mtf.push(bins[k] / cnt[k] / m0); }
  // central crop of the PSF (fft-shifted), pixel = λ Dpx / (n D) rad
  const C = 48, crop = new Float32Array(C * C);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) crop[y * C + x] = I[(y + n / 2 - C / 2) * n + x + n / 2 - C / 2] / pk0;
  const pxArcmin = ((o.lam * 1e-6 * Dpx) / (n * o.p)) * (180 / Math.PI) * 60;
  return { freq, mtf, strehl: pk / pk0, cutoff: (o.p / (o.lam * 1e-6)) * (Math.PI / 180), psf: crop, C, pxArcmin };
}
export const mtfAt = (r, cpd) => { const { freq, mtf } = r; for (let i = 1; i < freq.length; i++) if (freq[i] >= cpd) { const t = (cpd - freq[i - 1]) / (freq[i] - freq[i - 1]); return mtf[i - 1] * (1 - t) + mtf[i] * t; } return 0; };

// Circle of confusion from visual acuity: a print enlarged E× viewed at distance V (mm) by an
// eye resolving α (arcmin) tolerates blur c = V·α/E on the sensor.
export const cocFromAcuity = (V, alphaArcmin, E) => (V * alphaArcmin * Math.PI) / (180 * 60) / E;
