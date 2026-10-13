// Virtual production: an LED wall filmed by a camera. Spatially, the wall's pixel grid (pitch p)
// is imaged at frequency ν_w = 1/(m p) on the sensor and sampled by photosites of pitch q; if the
// imaged grid survives the defocus, lens and pixel MTFs it aliases into moiré at |ν_w − k/q|.
// Temporally, the wall's PWM refresh is integrated over each row's exposure window of a rolling
// shutter, which leaves bands unless the exposure spans whole PWM periods. Lengths in mm.
import { besselJ1 } from './pupil.js';

// Magnification of the wall at distance Z (mm) for focal length f, focused at distance s (mm):
// image distance v = 1/(1/f − 1/s); wall imaged with m = v/Z (chief-ray scale).
export const wallMagnification = (f, s, Z) => 1 / (1 / f - 1 / s) / Z;
// Grid frequency on the sensor (cycles/mm): the imaged pitch is m·p.
export const wallFrequency = (f, s, Z, p) => 1 / (wallMagnification(f, s, Z) * p);
// Defocus blur diameter (mm) on the sensor of the wall at Z when focused at s: b = D v |1/s − 1/Z| … (thin lens)
export function blurDiameter(f, N, s, Z) {
  const v = 1 / (1 / f - 1 / s), vZ = 1 / (1 / f - 1 / Z);
  return ((f / N) * Math.abs(v - vZ)) / vZ;
}
// MTF of a uniform defocus disk of diameter b: 2 J1(π b ν)/(π b ν) (can go negative).
export const diskMTF = (b, nu) => { const x = Math.PI * b * nu; return x < 1e-9 ? 1 : (2 * besselJ1(x)) / x; };
// Diffraction MTF of a circular aperture at f-number N, wavelength λ (mm).
export function diffMTF(N, nu, lam = 550e-6) { const s = nu * lam * N; return s >= 1 ? 0 : (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s)); }
// Pixel-aperture MTF (square photosite of width q·fill).
export const pixelMTF = (q, nu, fill = 1) => { const x = Math.PI * q * fill * nu; return x < 1e-9 ? 1 : Math.abs(Math.sin(x) / x); };
// Alias of frequency ν sampled at 1/q: |ν − round(ν q)/q|.
export const aliasFrequency = (nu, q) => Math.abs(nu - Math.round(nu * q) / q);

// Fundamental modulation of an LED grid with emitter fill factor φ (fraction of the pitch):
// a rect of width φp has Fourier coefficient 2 sinc(φ)/φ… relative to the mean, |2 sin(πφ)/(πφ)|.
export const gridModulation = (fill) => Math.abs((2 * Math.sin(Math.PI * fill)) / (Math.PI * fill));

// Moiré contrast of the fundamental: grid modulation × defocus × lens × pixel MTFs at ν_w, if ν_w
// is above the sensor Nyquist frequency (otherwise the grid is simply resolved).
export function moire(o) {
  const nu = wallFrequency(o.f, o.s, o.Z, o.p), b = blurDiameter(o.f, o.N, o.s, o.Z);
  const c = gridModulation(o.fill) * Math.abs(diskMTF(b, nu)) * diffMTF(o.N, nu) * pixelMTF(o.q, nu, o.qfill ?? 1) * (o.olpf ? Math.abs(Math.cos(Math.PI * o.q * nu)) : 1);
  return { nu, b, nyquist: 1 / (2 * o.q), alias: aliasFrequency(nu, o.q), contrast: Math.min(1, c), aliased: nu > 1 / (2 * o.q) };
}

// Rendered camera view (W×H pixels around the image centre): an LED wall rotated by `rot`
// (rad), in front of it an in-focus subject silhouette. The wall radiance is synthesised from its
// Fourier series (harmonics up to `kmax`), each harmonic attenuated by the system MTF at its
// frequency, then point-sampled at the photosite centres (the pixel MTF is already included).
export function renderWall(o, W, H) {
  const out = new Float32Array(W * H), nu = wallFrequency(o.f, o.s, o.Z, o.p), b = blurDiameter(o.f, o.N, o.s, o.Z);
  const harm = [];
  for (let k = 1; k <= (o.kmax || 3); k++) {
    const nk = k * nu, a = (2 * Math.sin(Math.PI * k * o.fill)) / (Math.PI * k);
    const m = diskMTF(b, nk) * diffMTF(o.N, nk) * pixelMTF(o.q, nk, o.qfill ?? 1) * (o.olpf ? Math.cos(Math.PI * o.q * nk) : 1);
    harm.push([nk, (a / o.fill) * m]);
  }
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i - W / 2 + 0.5) * o.q, y = (j - H / 2 + 0.5) * o.q, u = c * x + s * y, v = -s * x + c * y;
    let fx = 1, fy = 1;
    for (const [nk, a] of harm) { fx += a * Math.cos(2 * Math.PI * nk * u); fy += a * Math.cos(2 * Math.PI * nk * v); }
    out[j * W + i] = Math.max(0, fx * fy) * o.fill * o.fill;
  }
  return { img: out, nu, b };
}

// Rolling-shutter banding: wall brightness is a PWM square wave of frequency fp and duty d,
// optionally multiplexed (scan 1/k: each wall row lit for 1/k of each PWM period at its own phase,
// so the light reaching a camera row depends on which wall rows it sees — modelled as an extra
// phase per camera row). Each camera row integrates over [t₀ + r·tline, + texp].
export function bandProfile(o, rows = 200) {
  const out = new Float64Array(rows), T = 1 / o.fp;
  const lit = (t) => { const ph = ((t / T) % 1 + 1) % 1; return ph < o.duty ? 1 : 0; };
  for (let r = 0; r < rows; r++) {
    const t0 = o.phase * T + r * o.tline, n = 400;
    let acc = 0;
    for (let k = 0; k < n; k++) acc += lit(t0 + ((k + 0.5) / n) * o.texp);
    out[r] = acc / n / o.duty;
  }
  return out;
}
// Peak-to-peak banding amplitude (relative) of exposure texp: zero when texp is a multiple of the
// PWM period; for one PWM pulse per period it equals duty·frac(texp/T)… computed exactly here.
export function bandAmplitude(texp, fp, duty) {
  const T = 1 / fp, frac = ((texp / T) % 1 + 1) % 1, n = Math.floor(texp / T);
  // the light collected varies with phase between floor and ceil of the partial period
  const minL = n * duty + Math.max(0, frac - (1 - duty)), maxL = n * duty + Math.min(frac, duty);
  return (maxL - minL) / (texp / T * duty);
}
