// Mission "Image Jupiter from your garden": focal ratio for the pixel size, exposure that freezes
// the seeing, capture length before Jupiter's rotation blurs detail, lucky-frame selection, and
// atmospheric dispersion at the planet's altitude. Pure functions.
import { friedProbability } from './lucky.js';
import { dispersion } from './adc.js';

export const JUPITER_ROTATION = 35740.6; // s, System II (9 h 55 m 40.6 s)
export const JUPITER_FLATTENING = 0.0649;
const RAD = 206264.806; // arcsec per radian

// Nyquist sampling of the diffraction cut-off D/λ: pixel p ≤ λN/2, so N = 2p/λ.
export const criticalRatio = (pitchUm, lamUm = 0.5) => (2 * pitchUm) / lamUm;
// Fried parameter at wavelength λ from the seeing FWHM at 500 nm (FWHM = 0.98 λ/r₀).
export const r0From = (fwhm, lamUm = 0.5) => ((0.98 * 0.5e-6) / (fwhm / RAD)) * Math.pow(lamUm / 0.5, 1.2);
// Coherence time τ₀ = 0.314 r₀ / v.
export const tau0 = (r0, v) => (0.314 * r0) / v;
// Longest capture before a feature at the disc centre moves by one resolution element λ/D.
export function rotationLimit(D, lamUm, diamArcsec) {
  const res = ((lamUm * 1e-6) / D) * RAD; // arcsec
  const rate = ((2 * Math.PI) / JUPITER_ROTATION) * (diamArcsec / 2); // arcsec/s at the centre
  return { t: res / rate, res, rate };
}

export function plan({ D = 0.2, N0 = 10, pitch = 2.9, fwhm = 2, wind = 10, alt = 35, diam = 45, fps = 150, lam = 0.5, P = 101325, T = 10 }) {
  const N = criticalRatio(pitch, lam), barlow = N / N0;
  const scale = ((pitch * 1e-6) / (D * N)) * RAD; // arcsec per pixel
  const discPx = diam / scale;
  const r0 = r0From(fwhm, 0.55), Dr0 = D / r0;
  const tau = tau0(r0, wind);
  const t = Math.min(0.02, Math.max(0.002, tau)); // s, freeze the seeing but stay within 2–20 ms
  const rate = Math.min(fps, 1 / t);
  const rot = rotationLimit(D, 0.55, diam);
  const frames = Math.round(rate * rot.t);
  const pLucky = friedProbability(Dr0);
  const keep = Dr0 < 3.5 ? 0.5 : Math.min(0.5, Math.max(0.01, pLucky));
  const z = ((90 - alt) * Math.PI) / 180;
  const disp = Math.abs(dispersion(400, 700, z, P, T)); // arcsec, 400–700 nm
  const res = rot.res;
  return { N, barlow, scale, discPx, r0, Dr0, tau, t, rate, rot, frames, pLucky, keep, kept: Math.max(1, Math.round(frames * keep)), disp, res, adc: disp > res / 2, seeingRes: fwhm };
}
