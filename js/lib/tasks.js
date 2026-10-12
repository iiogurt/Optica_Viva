// Heavy, pure computations that run inside the compute worker (or on the main thread as a
// fallback). Each task takes plain data and returns { result, transfer } where `transfer`
// lists the ArrayBuffers to hand over without copying.
import { rasterAperture, psf, rescale, zernikeWavefront, rmsWavefront } from './pupil.js';
import { spectralBasis, wavelengthRGB } from './color.js';
import { fft2d } from './fft.js';

// Polychromatic PSF of an aperture with optional defocus, plus profile, encircled energy and Strehl.
// p = { spec, n, Dpx, lambdas (nm), ref (nm), defocus (waves RMS at ref), falseColor }
function psfLab(p) {
  const { spec, n, Dpx, lambdas: lams, ref } = p, Q = n / Dpx;
  const amp = rasterAperture(spec, n, Dpx, 4);
  const W = p.defocus ? zernikeWavefront(n, Dpx, { 4: (p.defocus * ref) / 1000 }) : null; // µm OPD
  const R = new Float64Array(n * n), G = new Float64Array(n * n), B = new Float64Array(n * n), Lm = new Float64Array(n * n);
  const basis = lams.length === 1 ? [wavelengthRGB(lams[0], false)] : p.falseColor
    ? spectralBasis(lams.map((l) => 420 + ((l - lams[0]) / (lams[lams.length - 1] - lams[0])) * 260)) : spectralBasis(lams);
  let base = null;
  lams.forEach((l, i) => {
    let I;
    // without aberration every wavelength is the reference PSF magnified by λ/λref (exact)
    if (!W) { if (!base) base = psf(amp, null, n, ref / 1000).I; I = rescale(base, n, l / ref); }
    else I = rescale(psf(amp, W, n, l / 1000).I, n, l / ref);
    const [r, g, b] = basis[i];
    for (let k = 0; k < n * n; k++) { const v = I[k]; R[k] += v * r; G[k] += v * g; B[k] += v * b; Lm[k] += v / lams.length; }
  });
  const p0 = psf(amp, null, n, ref / 1000).peak;
  const pk = W ? psf(amp, W, n, ref / 1000).peak : p0;
  // azimuthal profile and encircled energy in λref/D units
  const bins = 240, rmax = 30, prof = new Float64Array(bins), cnt = new Float64Array(bins), c = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const b = Math.floor((Math.hypot(x - c, y - c) / Q / rmax) * bins);
    if (b < bins) { prof[b] += Lm[y * n + x]; cnt[b]++; }
  }
  let cum = 0, tot = 0;
  for (let k = 0; k < n * n; k++) tot += Lm[k];
  const eeCurve = [], profCurve = [];
  const peak = Math.max(...Array.from(prof, (v, i) => (cnt[i] ? v / cnt[i] : 0)));
  for (let i = 0; i < bins; i++) {
    cum += prof[i];
    if (cnt[i]) profCurve.push([((i + 0.5) / bins) * rmax, prof[i] / cnt[i] / peak]);
    eeCurve.push([((i + 1) / bins) * rmax, cum / tot]);
  }
  let area = 0; for (let k = 0; k < n * n; k++) area += amp[k];
  const ampCopy = amp.slice(); // the cached raster must stay in this realm
  return {
    result: { n, Dpx, Q, amp: ampCopy, R, G, B, Lm, profCurve, eeCurve, strehl: pk / p0, fill: area / (Math.PI * (Dpx / 2) ** 2) },
    transfer: [ampCopy.buffer, R.buffer, G.buffer, B.buffer, Lm.buffer],
  };
}

// Zernike laboratory: wavefront, PSF, through-focus series and Strehl-vs-RMS curve.
// p = { coeffs: {j: waves RMS}, n, Dpx }
function zernikeLab(p) {
  const { coeffs: c, n, Dpx } = p;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  const P0 = psf(amp, null, n, 1).peak;
  const W = zernikeWavefront(n, Dpx, c); // waves (λ = 1)
  const P = psf(amp, W, n, 1);
  const rms = rmsWavefront(amp, W, n);
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < n * n; k++) if (amp[k] > 0.5) { mn = Math.min(mn, W[k]); mx = Math.max(mx, W[k]); }
  // through focus: ±½, ±1 λ peak-to-valley of added defocus (Z4 RMS = PV / 2√3)
  const through = [-1, -0.5, 0, 0.5, 1].map((d) => psf(amp, zernikeWavefront(n, Dpx, { ...c, 4: (c[4] || 0) + d / Math.sqrt(3) / 2 }), n, 1).I);
  const curve = [];
  for (let k = 0; k <= 16; k++) {
    const s = k / 8, Ws = new Float64Array(W.length);
    for (let i = 0; i < W.length; i++) Ws[i] = W[i] * s;
    curve.push([rms * s, psf(amp, Ws, n, 1).peak / P0]);
  }
  const ampCopy = amp.slice();
  return {
    result: { n, Dpx, amp: ampCopy, P0, W, I: P.I, strehl: P.peak / P0, rms, pv: mx - mn, through, curve },
    transfer: [ampCopy.buffer, W.buffer, P.I.buffer, ...through.map((t) => t.buffer)],
  };
}

// Radial optics OTF (signed, real for rotationally symmetric aberrations) for several
// (defocus W020, spherical W040) pairs in waves: pupil → PSF → FFT → OTF.
// p = { pairs: [[def, sa], …], n, Dpx } → curves: [[ν̂, OTF], …] per pair
function otfCurves(p) {
  const { n, Dpx } = p, Q = n / Dpx, hn = n / 2;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  const curves = p.pairs.map(([def, sa]) => {
    const W = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r2 = ((x - hn) ** 2 + (y - hn) ** 2) / (Dpx / 2) ** 2;
      if (r2 <= 1.05) W[y * n + x] = def * r2 + sa * r2 * r2;
    }
    const { I } = psf(amp, W, n, 1);
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[((y + hn) % n) * n + ((x + hn) % n)] = I[y * n + x];
    fft2d(re, im, n);
    const out = [];
    for (let k = 0; k <= n / Q; k++) out.push([k / (n / Q), (re[k] + re[k * n]) / 2 / re[0]]);
    return out;
  });
  return { result: curves, transfer: [] };
}

export const TASKS = { psfLab, zernikeLab, otfCurves };
