// Monte-Carlo tolerance analysis: random manufacturing errors in radii, thicknesses and
// refractive indices, and assembly errors (decenter and tilt of each element or cemented group);
// every trial is refocused (image distance as compensator) and scored by the RMS real-ray error
// over fields and wavelengths (same merit as the optimiser).
import { residuals } from './optimise.js';
import { vertices } from './raytrace.js';
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

// Elements that move as one: a run of surfaces from air into glass and back to air (a singlet or a
// cemented group), and each mirror. [{ first, last }] surface indices.
export function groups(lens) {
  const S = lens.surfaces, out = [];
  for (let i = 0; i < S.length; i++) {
    if (S[i].glass === 'mirror') { out.push({ first: i, last: i }); continue; }
    if (S[i].glass === 'air' || (i > 0 && S[i - 1].glass !== 'air' && S[i - 1].glass !== 'mirror')) continue;
    let j = i;
    while (j < S.length - 1 && S[j].glass !== 'air') j++;
    out.push({ first: i, last: j });
  }
  return out;
}

// Decenter a group by (dx, dy) mm and tilt it by (ax, ay) rad about its first vertex: each surface
// is tilted by the same angles and its vertex swung round the pivot (to first order in the angle).
export function perturbGroup(surfaces, zv, g, dx, dy, ax, ay) {
  for (let j = g.first; j <= g.last; j++) {
    const dz = zv[j] - zv[g.first], s = surfaces[j], [ox, oy] = s.dec || [0, 0], [tx, ty] = s.tilt || [0, 0];
    surfaces[j] = { ...s, dec: [ox + dx + Math.sin(ay) * dz, oy + dy - Math.sin(ax) * dz], tilt: [tx + ax, ty + ay] };
  }
}

const fieldsFor = (tol) => (tol.decenterUm || tol.tiltArcmin ? [-1, -0.7, 0, 0.7, 1] : [0, 0.7, 1]);
const ARCMIN = Math.PI / (180 * 60);

// Change in refocused RMS ray error when each group alone is decentered by decenterUm (in y) or
// tilted by tiltArcmin (about x): which element the assembly must hold most tightly.
export function sensitivity(lens, tol) {
  const cfg = { efl: 0, eflWeight: 0, fields: [-1, -0.7, 0, 0.7, 1], wavelengths: [486.13, 587.56, 656.27], rings: 2 };
  const nominal = refocus(lens, cfg), zv = vertices(lens);
  return { nominal, rows: groups(lens).map((g) => {
    const run = (dy, ax) => { const S = lens.surfaces.slice(); perturbGroup(S, zv, g, 0, dy, ax, 0); return refocus({ ...lens, surfaces: S }, cfg) - nominal; };
    return { ...g, decenter: run((tol.decenterUm || 10) / 1000, 0), tilt: run(0, (tol.tiltArcmin || 1) * ARCMIN) };
  }) };
}

// tol = { radiusPct, thicknessUm, indexDelta, decenterUm, tiltArcmin } (1σ, Gaussian); trials; seed
export function monteCarlo(lens, tol, trials = 60, seed = 1) {
  const rnd = uniform(seed >>> 0 || 1);
  const cfg = { efl: 0, eflWeight: 0, fields: fieldsFor(tol), wavelengths: [486.13, 587.56, 656.27], rings: 2 };
  const nominal = refocus(lens, cfg), zv = vertices(lens), G = groups(lens);
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
    if (tol.decenterUm || tol.tiltArcmin) for (const g of G) {
      const de = (tol.decenterUm || 0) / 1000, ti = (tol.tiltArcmin || 0) * ARCMIN;
      perturbGroup(surfaces, zv, g, de * gaussian(rnd), de * gaussian(rnd), ti * gaussian(rnd), ti * gaussian(rnd));
    }
    const v = refocus({ ...lens, surfaces }, cfg);
    if (isFinite(v)) scores.push(v);
  }
  scores.sort((a, b) => a - b);
  const pct = (q) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
  return { nominal, scores, median: pct(0.5), p90: pct(0.9), failed: trials - scores.length };
}
