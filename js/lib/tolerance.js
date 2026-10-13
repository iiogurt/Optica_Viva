// Monte-Carlo tolerance analysis: random manufacturing errors in radii, thicknesses and
// refractive indices; every trial is refocused (image distance as compensator) and scored by
// the RMS real-ray error over fields and wavelengths (same merit as the optimiser).
import { residuals } from './optimise.js';
import { uniform } from './random.js';

const rms = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length);
function gaussian(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// best focus by golden-section search on the image distance (±range mm)
export function refocus(lens, cfg, range = 0.5) {
  const N = lens.surfaces.length, t0 = lens.surfaces[N - 1].t;
  const score = (dt) => { const L = { ...lens, surfaces: lens.surfaces.map((s, i) => (i === N - 1 ? { ...s, t: t0 + dt } : s)) }; const r = residuals(L, cfg); return r ? rms(r.slice(1)) : Infinity; };
  let a = -range, b = range;
  for (let k = 0; k < 16; k++) { const m1 = a + 0.382 * (b - a), m2 = a + 0.618 * (b - a); if (score(m1) < score(m2)) b = m2; else a = m1; }
  return score((a + b) / 2);
}

// tol = { radiusPct, thicknessUm, indexDelta } (1σ, Gaussian); trials; seed
export function monteCarlo(lens, tol, trials = 60, seed = 1) {
  const rnd = uniform(seed >>> 0 || 1);
  const cfg = { efl: 0, eflWeight: 0, fields: [0, 0.7, 1], wavelengths: [486.13, 587.56, 656.27], rings: 2 };
  const nominal = refocus(lens, cfg);
  const scores = [];
  for (let t = 0; t < trials; t++) {
    const N = lens.surfaces.length;
    const surfaces = lens.surfaces.map((sf, i) => {
      const o = { ...sf };
      if (isFinite(sf.R)) o.R = sf.R * (1 + (tol.radiusPct / 100) * gaussian(rnd));
      if (i < N - 1) o.t = Math.max(0, sf.t + (tol.thicknessUm / 1000) * gaussian(rnd));
      if (sf.glass !== 'air' && tol.indexDelta) o.glass = { base: sf.glass, dn: tol.indexDelta * gaussian(rnd) };
      return o;
    });
    const v = refocus({ ...lens, surfaces }, cfg);
    if (isFinite(v)) scores.push(v);
  }
  scores.sort((a, b) => a - b);
  const pct = (q) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
  return { nominal, scores, median: pct(0.5), p90: pct(0.9), failed: trials - scores.length };
}
