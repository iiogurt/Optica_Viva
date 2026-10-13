// Spectroscopy: dispersion by prisms and gratings, resolving power, blaze efficiency, order
// overlap, and synthetic spectra of the Sun and of laboratory lamps. Wavelengths in nm (air).
import { index } from './glass.js';

// ── Gratings ───────────────────────────────────────────────────────────────────────────────
// Grating equation m λ = d (sin α + sin β), groove spacing d = 10⁶/ρ nm for ρ lines/mm.
export const diffractionAngle = (m, lam, rho, alpha) => {
  const s = (m * lam * rho) / 1e6 - Math.sin(alpha);
  return Math.abs(s) <= 1 ? Math.asin(s) : NaN;
};
export const wavelengthAt = (m, beta, rho, alpha) => (1e6 * (Math.sin(alpha) + Math.sin(beta))) / (m * rho);
// Littrow blaze angle for blaze wavelength λ_B in order m: 2 sin θ_B = m λ_B ρ.
export const blazeAngle = (lamB, rho, m = 1) => Math.asin((m * lamB * rho) / 2e6);
// Angular dispersion dβ/dλ (rad/nm) and resolving power R = m N (N grooves illuminated).
export const angularDispersion = (m, rho, beta) => (m * rho) / (1e6 * Math.cos(beta));
export const gratingR = (m, rho, Wmm) => m * rho * Wmm;
// Scalar blaze efficiency of order m (single-facet diffraction envelope, facets tilted by θ_B):
// η = sinc²[π (d cos θ_B / λ)(sin(α − θ_B) + sin(β − θ_B))], = 1 at the blaze condition.
export function blazeEfficiency(m, lam, rho, alpha, thB) {
  const beta = diffractionAngle(m, lam, rho, alpha);
  if (!Number.isFinite(beta)) return 0;
  const d = 1e6 / rho, u = Math.PI * ((d * Math.cos(thB)) / lam) * (Math.sin(alpha - thB) + Math.sin(beta - thB));
  return Math.abs(u) < 1e-9 ? 1 : (Math.sin(u) / u) ** 2;
}

// ── Prisms ─────────────────────────────────────────────────────────────────────────────────
export const dndl = (glass, lam) => (index(glass, lam + 0.5) - index(glass, lam - 0.5));
// Minimum deviation of a prism of apex angle A: D = 2 asin(n sin(A/2)) − A.
export const prismDeviation = (glass, lam, A) => 2 * Math.asin(index(glass, lam) * Math.sin(A / 2)) - A;
// Diffraction-limited resolving power of a prism filled by the beam: R = b |dn/dλ| (base b).
export const prismR = (glass, lam, baseMm) => baseMm * 1e6 * Math.abs(dndl(glass, lam));

// ── Instrument profile and spectra ──────────────────────────────────────────────────────────
// Diffraction-limited line profile in wavelength for resolving power R: the N-slit / aperture
// pattern ≈ sinc²(π Δλ R / λ) whose first zero lies at Δλ = λ/R (the Rayleigh criterion).
export const profile = (dl, lam, R) => { const u = (Math.PI * dl * R) / lam; return Math.abs(u) < 1e-9 ? 1 : (Math.sin(u) / u) ** 2; };

// Line lists. Sun: absorption [λ, depth, FWHM nm]; lamps: emission [λ, relative intensity].
// Wavelengths are standard air values; depths, widths and intensities are illustrative.
export const SOURCES = {
  sun: {
    name: 'Sun (Fraunhofer lines)', type: 'absorption', T: 5778,
    lines: [[393.366, 0.9, 1.2, 'Ca II K'], [396.847, 0.9, 1.0, 'Ca II H'], [410.174, 0.5, 0.25, 'Hδ'], [422.673, 0.6, 0.12, 'Ca I g'], [430.8, 0.35, 0.8, 'G band'], [434.047, 0.5, 0.25, 'Hγ'],
      [438.355, 0.5, 0.1, 'Fe I'], [486.134, 0.6, 0.3, 'Hβ F'], [516.733, 0.5, 0.1, 'Mg b4'], [517.268, 0.55, 0.1, 'Mg b2'], [518.362, 0.6, 0.12, 'Mg b1'], [527.039, 0.4, 0.08, 'Fe E'],
      [588.995, 0.75, 0.06, 'Na D2'], [589.592, 0.7, 0.06, 'Na D1'], [656.281, 0.75, 0.15, 'Hα C'], [686.7, 0.5, 0.8, 'O₂ B (telluric)'], [759.4, 0.7, 1.4, 'O₂ A (telluric)']],
  },
  hg: { name: 'Mercury lamp', type: 'emission', lines: [[404.656, 0.5], [407.783, 0.1], [435.833, 1], [546.074, 1], [576.96, 0.6], [579.066, 0.6]] },
  ne: { name: 'Neon lamp', type: 'emission', lines: [[585.249, 1], [588.19, 0.5], [594.483, 0.6], [607.434, 0.6], [609.616, 0.7], [614.306, 0.9], [616.359, 0.6], [621.728, 0.5], [626.65, 0.6], [633.443, 0.7], [638.299, 0.8], [640.225, 1], [650.653, 0.8], [659.895, 0.6], [667.828, 0.6], [671.704, 0.5], [692.947, 0.6], [703.241, 0.8], [717.394, 0.3], [724.517, 0.4]] },
  h: { name: 'Hydrogen discharge (Balmer)', type: 'emission', lines: [[656.281, 1], [486.134, 0.4], [434.047, 0.2], [410.174, 0.1], [397.007, 0.06]] },
  na: { name: 'Sodium lamp', type: 'emission', lines: [[588.995, 1], [589.592, 0.5], [568.82, 0.05], [615.42, 0.04], [818.33, 0.1]] },
};

// Intrinsic spectrum on a wavelength grid: emission lines are narrow Gaussians (FWHM 0.002 nm,
// far below any resolution here); absorption lines are Gaussian dips on a black-body continuum.
export function intrinsic(src, lams) {
  const S = SOURCES[src], out = new Float64Array(lams.length);
  if (S.type === 'absorption') {
    const pl = (l) => { const x = l * 1e-9; return 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * S.T)) - 1)); }, p0 = pl(500);
    lams.forEach((l, i) => {
      let tau = 1;
      for (const [c, depth, fw] of S.lines) { const s = fw / 2.3548; tau *= 1 - depth * Math.exp(-0.5 * ((l - c) / s) ** 2); }
      out[i] = (pl(l) / p0) * tau;
    });
  }
  return out;
}

// Observed spectrum at resolving power R on the grid lams (uniform step): the intrinsic spectrum
// convolved with the instrument profile; emission lines are added analytically (exact for δ lines).
export function observe(src, lams, R) {
  const S = SOURCES[src], n = lams.length, dl = lams[1] - lams[0], out = new Float64Array(n);
  if (S.type === 'emission') {
    lams.forEach((l, i) => { let v = 0; for (const [c, a] of S.lines) v += a * profile(l - c, c, R); out[i] = v; });
    return out;
  }
  // absorption: convolve on a fine grid (5 samples per output step, kernel to ±8 resolution elements)
  const sub = 5, fine = Array.from({ length: n * sub }, (_, i) => lams[0] + (i - (sub - 1) / 2) * (dl / sub));
  const I = intrinsic(src, fine), lc = (lams[0] + lams[n - 1]) / 2, hw = Math.ceil((8 * lc) / R / (dl / sub));
  const ker = [];

  for (let k = -hw; k <= hw; k++) { const v = profile(k * (dl / sub), lc, R); ker.push(v); }
  for (let i = 0; i < n; i++) {
    let acc = 0, w = 0;
    for (let s2 = 0; s2 < sub; s2++) {
      const c = i * sub + s2;
      for (let k = -hw; k <= hw; k++) { const j = c + k; if (j < 0 || j >= fine.length) continue; const kv = ker[k + hw]; acc += kv * I[j]; w += kv; }
    }
    out[i] = w ? acc / w : 0;
  }
  return out;
}

// ── Astronomical spectrographs ──────────────────────────────────────────────────────────────
const ARCSEC = Math.PI / 648000;
// Slit-limited resolving power of a Littrow spectrograph: the slit (width φ on the sky) imaged
// through a telescope of diameter D onto a collimated beam of diameter D_col,
// R = 2 tan θ_B · D_col / (φ D). (Schroeder 2000, eq. 13.2.6)
export const slitR = (thB, DcolMm, slitArcsec, Dm) => (2 * Math.tan(thB) * DcolMm * 1e-3) / (slitArcsec * ARCSEC * Dm);
// Combined resolving power when slit width and diffraction both broaden the line (quadrature).
export const combinedR = (Rs, Rd) => 1 / Math.sqrt(1 / Rs ** 2 + 1 / Rd ** 2);
// Fraction of a Gaussian seeing disk (FWHM) passing a long slit of width φ, centred.
export function slitThroughput(slit, fwhm) {
  const x = (slit / fwhm) * Math.sqrt(Math.log(2));
  // erf by Abramowitz & Stegun 7.1.26 (|ε| < 1.5 × 10⁻⁷)
  const t = 1 / (1 + 0.3275911 * x), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return y;
}

// Solar spectrum at resolving power R in closed form: each Gaussian line broadened in
// quadrature by λ/R with its equivalent width conserved (used for the echellogram).
export function sunAt(lam, R) {
  const S = SOURCES.sun, x = lam * 1e-9, p = 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * S.T)) - 1)), p0 = 1 / ((500e-9) ** 5 * (Math.exp(1.4388e-2 / (500e-9 * S.T)) - 1));
  let tau = 1;
  for (const [c, depth, fw] of S.lines) {
    const inst = (c / R) * 0.886, fe = Math.hypot(fw, inst), d = Math.min(0.99, (depth * fw) / fe), s = fe / 2.3548;
    if (Math.abs(lam - c) < 6 * s) tau *= 1 - d * Math.exp(-0.5 * ((lam - c) / s) ** 2);
  }
  return (p / p0) * tau;
}

// Echelle + prism cross-disperser: positions (mm on the detector) of wavelength λ in order m.
// x along the order from the Littrow direction, y across orders from the prism deviation.
// o = { rho (lines/mm), thB (rad), fcam (mm), glass, apex (rad), lamRef (nm) }
export function echellePosition(o, m, lam) {
  const beta = diffractionAngle(m, lam, o.rho, o.thB);
  if (!Number.isFinite(beta)) return null;
  return [o.fcam * Math.tan(beta - o.thB), o.fcam * (prismDeviation(o.glass, lam, o.apex) - prismDeviation(o.glass, o.lamRef, o.apex))];
}
// Orders whose blaze wavelength 2 d sin θ_B / m lies within [l0, l1].
export function echelleOrders(rho, thB, l0, l1) {
  const k = (2e6 * Math.sin(thB)) / rho;
  return { mMin: Math.ceil(k / l1), mMax: Math.floor(k / l0), lamB: (m) => k / m };
}
