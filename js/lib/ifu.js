// Integral-field spectroscopy with an image slicer. A rotating disk galaxy (Hα, [N II] and [S II]
// emission, stellar continuum) is built as a data cube on a fine sky grid, blurred by seeing
// wavelength by wavelength, cut into slices that are laid end to end along one long slit,
// dispersed onto a detector and read out with photon and read noise; the cube is then rebuilt
// from the detector frame and the lines measured spaxel by spaxel.
//
// The slice is the slit: a slice w wide gives slit-limited resolving power R(w) = R₀ · 0.25″/w,
// and light lying δ off the slice's centre line lands (δ/w) · λ/R further along the spectrum.
// The extraction assigns every pixel its nominal wavelength, as a pipeline without a slit-effect
// correction does. Omitted: night-sky emission lines (the sky is a flat continuum, subtracted
// exactly), atmospheric dispersion, diffraction and cross-talk in the slicer, calibration errors.
import { makeRng } from './random.js';

export const C_KMS = 299792.458;
// Air wavelengths (nm), SDSS line list; [N II] 6583/6548 = 3 (atomic physics).
export const LINES = [
  { id: 'NII-a', name: '[N II] 654.8', lam: 654.805 },
  { id: 'Ha', name: 'Hα 656.3', lam: 656.2801 },
  { id: 'NII-b', name: '[N II] 658.3', lam: 658.345 },
  { id: 'SII-a', name: '[S II] 671.6', lam: 671.644 },
  { id: 'SII-b', name: '[S II] 673.1', lam: 673.082 },
];
export const RATIOS = { 'NII-a': 0.35 / 3, Ha: 1, 'NII-b': 0.35, 'SII-a': 0.2, 'SII-b': 0.15 };

// Geometry: an 8″ × 8″ field on a 0.125″ grid; slices run along x, stacked in y; along a slice the
// detector samples 0.25″ per pixel; 256 spectral pixels sample a resolution element of the
// narrowest (0.25″) slice twice; slices are separated by 2 dark columns on the detector.
export const FOV = 8, FINE = 0.125, NF = FOV / FINE, ALONG = 0.25, NALONG = FOV / ALONG, NLAM = 256, GAP = 2, W0 = 0.25;
export const slicesFor = (w) => Math.round(FOV / w);
export const resolvingPower = (R0, w) => (R0 * W0) / w;

// Telescope and detector: 8 m aperture (50.3 m²), 20 % end-to-end throughput, 3 e⁻ read noise; dark
// sky continuum 20.8 AB mag arcsec⁻² near 670 nm.
export const AREA = Math.PI * 4 * 4, THROUGHPUT = 0.2, READ_NOISE = 3, SKY_MAG = 20.8;
// Photons s⁻¹ m⁻² nm⁻¹ from an AB magnitude at λ (nm): f_ν = 3631 Jy · 10^(−0.4 m), divided by hc/λ.
export const abPhotons = (mag, lamNm) => (3.631e-23 * 10 ** (-0.4 * mag)) / (6.62607015e-34 * lamNm * 1e-9) * 1e-9;

// Arctangent rotation curve (Courteau 1997).
export const vrot = (R, vmax, rt) => (2 / Math.PI) * vmax * Math.atan(R / rt);

// The sky model on the fine grid: Hα surface brightness (W m⁻² per fine pixel), line-of-sight
// velocity (km/s) and continuum (photons s⁻¹ m⁻² nm⁻¹ per fine pixel).
export function galaxy(p) {
  const { incl = 60, pa = 20, vmax = 200, rt = 0.8, rd = 1.3, fluxHa = 2e-17, contMag = 20.2, z = 0.02, knots = 9, seed = 7 } = p;
  const ci = Math.cos((incl * Math.PI) / 180), si = Math.sin((incl * Math.PI) / 180), cp = Math.cos((pa * Math.PI) / 180), sp = Math.sin((pa * Math.PI) / 180);
  const N = NF * NF, ha = new Float64Array(N), vel = new Float64Array(N), cont = new Float64Array(N);
  const rng = makeRng(seed), clumps = [];
  for (let k = 0; k < knots; k++) clumps.push({ R: rd * (0.6 + 1.6 * rng.u()), ph: 2 * Math.PI * rng.u(), amp: 0.9 + 0.8 * rng.u() });
  const cont0 = abPhotons(contMag, 656.28 * (1 + z)) * FINE * FINE;
  for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
    const x = (i + 0.5) * FINE - FOV / 2, y = (j + 0.5) * FINE - FOV / 2;
    const xm = x * cp + y * sp, ym = (-x * sp + y * cp) / Math.max(ci, 0.05), R = Math.hypot(xm, ym), k = j * NF + i;
    let s = Math.exp(-R / rd);
    for (const c of clumps) { const dx = xm - c.R * Math.cos(c.ph), dy = ym - c.R * Math.sin(c.ph); s += 2.2 * c.amp * Math.exp(-(dx * dx + dy * dy) / (2 * 0.18 * 0.18)) * Math.exp(-c.R / (2 * rd)); }
    ha[k] = s;
    vel[k] = R > 0 ? vrot(R, vmax, rt) * si * (xm / R) : 0;
    cont[k] = cont0 * (0.7 * Math.exp(-R / 1.6) + 0.3 * Math.exp(-Math.hypot(x, y) / 0.35));
  }
  let tot = 0;
  for (let k = 0; k < N; k++) tot += ha[k];
  for (let k = 0; k < N; k++) ha[k] *= fluxHa / tot;
  return { ha, vel, cont, z };
}

// Separable Gaussian blur (σ in fine pixels) of `planes` interleaved planes: a[k·planes + l].
function blur(a, planes, sigma) {
  if (!(sigma > 0.05)) return a;
  const r = Math.ceil(3.5 * sigma), ker = new Float64Array(2 * r + 1);
  let s = 0;
  for (let d = -r; d <= r; d++) s += (ker[d + r] = Math.exp(-(d * d) / (2 * sigma * sigma)));
  for (let d = 0; d <= 2 * r; d++) ker[d] /= s;
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
    const o = (j * NF + i) * planes;
    for (let d = -r; d <= r; d++) { const ii = i + d; if (ii < 0 || ii >= NF) continue; const w = ker[d + r], q = (j * NF + ii) * planes; for (let l = 0; l < planes; l++) tmp[o + l] += w * a[q + l]; }
  }
  for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
    const o = (j * NF + i) * planes;
    for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= NF) continue; const w = ker[d + r], q = (jj * NF + i) * planes; for (let l = 0; l < planes; l++) out[o + l] += w * tmp[q + l]; }
  }
  return out;
}

// Spectral grid: detector pixel dl = λc/(2R₀) around redshifted Hα, NLAM pixels; the cube is built
// on the same grid, each line integrated exactly over every pixel.
const OS = 1;
// erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5 × 10⁻⁷)
export function erf(x) {
  const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
export function grid(R0, z) {
  const lc = LINES[1].lam * (1 + z), dl = lc / (2 * R0), l0 = lc - (NLAM * dl) / 2;
  return { lc, dl, l0, lam: Float64Array.from({ length: NLAM }, (_, k) => l0 + (k + 0.5) * dl) };
}

// Move a spectrum (n bins, piecewise constant) by `shift` bins and spread it uniformly over `b`
// bins, exactly, through the cumulative sums S₁ = ∫s and S₂ = ∫S₁; the result is added to out.
function boxShift(src, n, shift, b, out, S1, S2) {
  S1[0] = 0; for (let l = 0; l < n; l++) S1[l + 1] = S1[l] + src[l];
  S2[0] = 0; for (let l = 0; l <= n; l++) S2[l + 1] = S2[l] + 0.5 * (S1[l] + (l < n ? S1[l + 1] : S1[l]));
  const at = (x) => { if (x <= 0) return 0; if (x >= n) return S2[n] + (x - n) * S1[n]; const k = Math.floor(x), f = x - k; return S2[k] + f * S1[k] + 0.5 * f * f * (S1[k + 1] - S1[k]); };
  for (let l = 0; l < n; l++) { const lo = l - shift; out[l] += (at(lo + 1 + b / 2) - at(lo + b / 2) - at(lo + 1 - b / 2) + at(lo - b / 2)) / b; }
}

// Noise-free detector frame (photons per second per pixel, sky excluded) and what is needed to
// measure it. p: galaxy parameters plus { R0, w (slice width, ″), seeing (FWHM ″), sigma (km/s) }.
export function expose(p) {
  const { R0 = 5000, w = 0.25, seeing = 0.8, sigma = 25, z = 0.02 } = p;
  const G = galaxy({ ...p, z }), g = grid(R0, z), dlo = g.dl / OS, NO = NLAM * OS;
  const sigOpt = 0.5 * g.dl, photonsPerW = (lam) => (lam * 1e-9) / (6.62607015e-34 * 2.99792458e8);
  // the fine cube (photons s⁻¹ per oversampled bin, telescope and throughput included). Blurring
  // is linear, so the continuum (flat in wavelength here) is blurred once as a map, and of the line
  // light only the spectral planes that hold any are blurred.
  const AT = AREA * THROUGHPUT, line = new Float32Array(NF * NF * NO), active = new Uint8Array(NO);
  const lines = LINES.map((L) => ({ ...L, f: RATIOS[L.id] * photonsPerW(L.lam * (1 + z)) }));
  for (let k = 0; k < NF * NF; k++) {
    if (G.ha[k] <= 0) continue;
    const o = k * NO, beta = 1 + G.vel[k] / C_KMS;
    for (const L of lines) {
      const mu = L.lam * (1 + z) * beta, sg = Math.hypot((mu * sigma) / C_KMS, sigOpt), amp = 0.5 * G.ha[k] * L.f * AT, k2 = 1 / (Math.SQRT2 * sg);
      const lo = Math.max(0, Math.floor((mu - 6 * sg - g.l0) / dlo)), hi = Math.min(NO - 1, Math.ceil((mu + 6 * sg - g.l0) / dlo));
      let e0 = erf((g.l0 + lo * dlo - mu) * k2);
      for (let l = lo; l <= hi; l++) { const e1 = erf((g.l0 + (l + 1) * dlo - mu) * k2); line[o + l] += amp * (e1 - e0); e0 = e1; active[l] = 1; }
    }
  }
  const idx = []; for (let l = 0; l < NO; l++) if (active[l]) idx.push(l);
  const P = idx.length, packed = new Float32Array(NF * NF * P);
  for (let k = 0; k < NF * NF; k++) for (let q = 0; q < P; q++) packed[k * P + q] = line[k * NO + idx[q]];
  const sig = seeing / 2.3548 / FINE, sPacked = blur(packed, P, sig);
  // Hα-only maps after seeing (for the true, beam-smeared velocity and the pictures) and the continuum
  const two = new Float32Array(NF * NF * 3);
  for (let k = 0; k < NF * NF; k++) { two[k * 3] = G.ha[k]; two[k * 3 + 1] = G.ha[k] * G.vel[k]; two[k * 3 + 2] = G.cont[k]; }
  const sTwo = blur(two, 3, sig);
  const sCube = new Float32Array(NF * NF * NO);
  for (let k = 0; k < NF * NF; k++) {
    const o = k * NO, c = sTwo[k * 3 + 2] * dlo * AT;
    for (let l = 0; l < NO; l++) sCube[o + l] = c;
    for (let q = 0; q < P; q++) sCube[o + idx[q]] += sPacked[k * P + q];
  }
  // slicing and dispersion: each fine row within a slice is shifted by 8 px per arcsec of offset
  // from the slice centre and spread over its own width (exact box-shift on the cumulative sums)
  const ns = slicesFor(w), m = Math.round(w / FINE), cols = ns * (NALONG + GAP) - GAP, frame = new Float32Array(NLAM * cols);
  const pxPerArcsec = 2 / W0; // a 0.25″ slice spans 2 spectral pixels: 8 px per arcsec
  const S1 = new Float64Array(NO + 1), S2 = new Float64Array(NO + 2), tmp = new Float64Array(NO), src = new Float64Array(NO);
  const b = OS * FINE * pxPerArcsec; // box width of one fine row, in bins
  const truthV = new Float64Array(ns * NALONG), truthF = new Float64Array(ns * NALONG), white = new Float64Array(ns * NALONG);
  for (let s = 0; s < ns; s++) for (let r = 0; r < m; r++) {
    const j = s * m + r, delta = (r + 0.5) * FINE - w / 2, shift = OS * pxPerArcsec * delta;
    for (let i = 0; i < NF; i++) {
      const k = j * NF + i, o = k * NO, a = Math.floor((i * FINE) / ALONG), col = s * (NALONG + GAP) + a;
      for (let l = 0; l < NO; l++) { src[l] = sCube[o + l]; tmp[l] = 0; }
      boxShift(src, NO, shift, b, tmp, S1, S2);
      for (let q = 0; q < NLAM; q++) frame[q * cols + col] += tmp[q];
      const f = sTwo[k * 3], sp = s * NALONG + a;
      truthF[sp] += f; truthV[sp] += sTwo[k * 3 + 1] + f * ((C_KMS * pxPerArcsec * delta * g.dl) / g.lc); white[sp] += sTwo[k * 3 + 2];
    }
  }
  for (let sp = 0; sp < truthV.length; sp++) truthV[sp] = truthF[sp] > 0 ? truthV[sp] / truthF[sp] : 0;
  const skyRate = abPhotons(SKY_MAG, g.lc) * w * ALONG * g.dl * AT;
  return { frame, cols, ns, m, z, grid: g, skyRate, truthV, truthF, white, R: resolvingPower(R0, w), sigOpt, slitDl: (g.lc / resolvingPower(R0, w)), w, sky: { ha: sTwo, n: NF } };
}

// A noisy exposure of t seconds (counts per pixel, sky included), from a seeded stream. For tests
// the sky and the read noise can be switched off.
export function observe(E, t, seed = 1, { sky = true, readNoise = READ_NOISE } = {}) {
  const rng = makeRng(seed), out = new Float32Array(E.frame.length), bg = sky ? E.skyRate : 0;
  for (let q = 0; q < NLAM; q++) for (let c = 0; c < E.cols; c++) {
    const k = q * E.cols + c, gap = c % (NALONG + GAP) >= NALONG;
    out[k] = (gap ? 0 : rng.poisson((E.frame[k] + bg) * t)) + (readNoise ? rng.g() * readNoise : 0);
  }
  return out;
}
// Hα and [N II] 6548 blend when the instrumental profile is wider than a fifth of their separation.
export const blended = (E, sigInstNm) => 5 * sigInstNm > (LINES[1].lam - LINES[0].lam) * (1 + E.z);

// The data cube rebuilt from a frame: spaxel (slice s, position a) ← detector column; sky
// subtracted with its known level. Returns [ns·NALONG][NLAM] in counts.
export function extract(E, counts, t) {
  const n = E.ns * NALONG, cube = new Float32Array(n * NLAM), sky = E.skyRate * t;
  for (let s = 0; s < E.ns; s++) for (let a = 0; a < NALONG; a++) {
    const col = s * (NALONG + GAP) + a, sp = s * NALONG + a;
    for (let q = 0; q < NLAM; q++) cube[sp * NLAM + q] = counts[q * E.cols + col] - sky;
  }
  return cube;
}

// Measure Hα in one spectrum: continuum from line-free pixels, then flux, centroid and width
// (moments) in a window re-centred twice on the line. vmax bounds the search (km/s); inst is the
// expected instrumental σ (nm), which widens the first window and the line mask; sigInst is the
// calibrated one removed in quadrature.
export function measure(spec, g, z, { vmax = 300, sigInst = 0, inst = 0 } = {}) {
  const lam = g.lam, ha = LINES[1].lam * (1 + z), dv = (x) => (ha * x) / C_KMS;
  const free = [];
  for (let q = 0; q < NLAM; q++) if (LINES.every((L) => Math.abs(lam[q] - L.lam * (1 + z)) > dv(vmax + 250) + 4 * inst)) free.push(q);
  let c = 0;
  for (const q of free) c += spec[q];
  c /= Math.max(1, free.length);
  let v2 = 0;
  for (const q of free) v2 += (spec[q] - c) ** 2;
  const noise = Math.sqrt(v2 / Math.max(1, free.length - 1));
  // never reach past half-way to [N II] 6548, the nearer neighbour of Hα
  const cap = 0.5 * (LINES[1].lam - LINES[0].lam) * (1 + z);
  let mu = ha, half = Math.min(cap, dv(vmax + 120) + 4 * inst), F = 0, sig = 0, n = 0;
  for (let it = 0; it < 3; it++) {
    let s0 = 0, s1 = 0, s2 = 0; n = 0;
    for (let q = 0; q < NLAM; q++) { if (Math.abs(lam[q] - mu) > half) continue; const d = spec[q] - c; s0 += d; s1 += d * lam[q]; s2 += d * lam[q] * lam[q]; n++; }
    if (!(s0 > 0)) return { flux: s0, snr: 0, v: NaN, sigma: NaN };
    F = s0; mu = s1 / s0; sig = Math.sqrt(Math.max(0, s2 / s0 - mu * mu));
    half = Math.min(cap, Math.max(3.5 * sig, 3 * g.dl, 3 * inst));
  }
  const snr = F / (noise * Math.sqrt(n) || 1e-30);
  const sigma = (C_KMS * Math.sqrt(Math.max(0, sig * sig - sigInst * sigInst))) / mu;
  return { flux: F, snr, v: C_KMS * (mu / ha - 1), sigma, sigObs: sig, cont: c, noise };
}

// Instrumental width (nm), calibrated as a pipeline does with an arc line: a line of no intrinsic
// width, uniformly filling a slice, sent through the same slicing and binning and measured with the
// same moments. (Analytically ≈ optics² + (λ/R)²/12 + pixel terms.)
export function lsfSigma(E) {
  const g = E.grid, n = NLAM, src = new Float64Array(n), out = new Float64Array(n), S1 = new Float64Array(n + 1), S2 = new Float64Array(n + 2);
  const mu = g.lc, k2 = 1 / (Math.SQRT2 * E.sigOpt);
  for (let l = 0; l < n; l++) src[l] = 0.5 * (erf((g.l0 + (l + 1) * g.dl - mu) * k2) - erf((g.l0 + l * g.dl - mu) * k2));
  const px = 2 / W0, b = FINE * px;
  for (let r = 0; r < E.m; r++) boxShift(src, n, px * ((r + 0.5) * FINE - E.w / 2), b, out, S1, S2);
  return measure(out, g, E.z, { vmax: 0, inst: expectedInst(E) }).sigObs;
}
export const expectedInst = (E) => Math.sqrt(E.sigOpt ** 2 + E.slitDl ** 2 / 12 + E.grid.dl ** 2 / 6);
