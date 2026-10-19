// Damped-least-squares (Levenberg–Marquardt) lens optimiser, the workhorse of lens design.
// Variables: surface curvatures c = 1/R (and the image distance, i.e. the last thickness).
// Merit: real-ray transverse errors at the image plane relative to the chief ray of the
// reference wavelength, over field × wavelength × hexapolar pupil samples, plus a weighted
// effective-focal-length target. Pure functions; runs in the compute worker.
import { paraxial, aimRay, trace, toPlane, vertices } from './raytrace.js';

const clone = (L) => ({ ...L, surfaces: L.surfaces.map((s) => ({ ...s, a: s.a ? s.a.slice() : undefined })) });

function pupilSamples(rings) {
  const out = [[0, 0]];
  for (let r = 1; r <= rings; r++) for (let k = 0; k < 6 * r; k++) { const a = (2 * Math.PI * k) / (6 * r); out.push([(r / rings) * Math.cos(a), (r / rings) * Math.sin(a)]); }
  return out;
}

// residual vector of a lens (mm); null if any ray fails
export function residuals(lens, cfg) {
  const par = paraxial(lens, 587.56);
  if (!isFinite(par.efl) || par.efl <= 0) return null;
  const zImg = vertices(lens)[lens.surfaces.length - 1] + lens.surfaces[lens.surfaces.length - 1].t;
  const out = [cfg.eflWeight * (par.efl - cfg.efl)];
  // one-sided: penalise a back focal distance shorter than minBfd (retrofocus designs, mirror clearance)
  if (cfg.minBfd != null) out.push(cfg.bfdWeight * Math.min(0, lens.surfaces[lens.surfaces.length - 1].t - cfg.minBfd));
  const pts = pupilSamples(cfg.rings);
  for (const f of cfg.fields) {
    const th = f * lens.field;
    const a0 = aimRay(lens, 587.56, th, 0, 0, par);
    if (!a0) return null;
    const c = trace(lens, 587.56, a0.p, a0.d, { clip: false, zv: par.zv });
    if (!c.ok) return null;
    const C = toPlane(c, zImg);
    for (const lam of cfg.wavelengths) {
      const pl = lam === 587.56 ? par : paraxial(lens, lam);
      for (const [px, py] of pts) {
        const a = aimRay(lens, lam, th, px, py, pl);
        if (!a) return null;
        const r = trace(lens, lam, a.p, a.d, { clip: false, zv: par.zv });
        if (!r.ok) return null;
        const P = toPlane(r, zImg);
        out.push(P[0] - C[0], P[1] - C[1]);
      }
    }
  }
  return out;
}
const merit = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length);

// Solve A x = b by Gaussian elimination with partial pivoting (small systems)
export function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-300) return null;
    for (let j = i + 1; j < n; j++) { const f = M[j][i] / M[i][i]; for (let k = i; k <= n; k++) M[j][k] -= f * M[i][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}

// opts: { surfaces: indices whose curvature varies (default: all curved or flat refracting),
//         focus: true to vary the image distance, efl: target (default current), eflWeight,
//         minBfd: shortest allowed back focal distance (mm), bfdWeight,
//         fields: [0, 0.7, 1], wavelengths: [486.13, 587.56, 656.27], rings: 3, iterations: 25 }
export function optimise(lens0, opts = {}) {
  const N = lens0.surfaces.length;
  const cfg = {
    efl: opts.efl ?? paraxial(lens0).efl, eflWeight: opts.eflWeight ?? 0.5, minBfd: opts.minBfd, bfdWeight: opts.bfdWeight ?? 1,
    fields: opts.fields ?? [0, 0.7, 1], wavelengths: opts.wavelengths ?? [486.13, 587.56, 656.27], rings: opts.rings ?? 3,
  };
  const curv = opts.surfaces ?? [...Array(N).keys()];
  const vars = [...curv.map((i) => ({ kind: 'c', i })), ...(opts.focus === false ? [] : [{ kind: 't', i: N - 1 }])];
  const get = (L) => vars.map((v) => (v.kind === 'c' ? (isFinite(L.surfaces[v.i].R) ? 1 / L.surfaces[v.i].R : 0) : L.surfaces[v.i].t));
  const set = (L, x) => { const M = clone(L); vars.forEach((v, k) => { if (v.kind === 'c') M.surfaces[v.i].R = Math.abs(x[k]) < 1e-12 ? Infinity : 1 / x[k]; else M.surfaces[v.i].t = Math.max(0, x[k]); }); return M; };
  let lens = clone(lens0), x = get(lens), r = residuals(lens, cfg);
  if (!r) throw new Error('the starting lens fails to trace');
  const history = [merit(r)];
  let mu = 1e-3;
  for (let it = 0; it < (opts.iterations ?? 25); it++) {
    // finite-difference Jacobian
    const J = vars.map((v, k) => {
      const h = v.kind === 'c' ? 1e-7 : 1e-5, xp = x.slice(); xp[k] += h;
      const rp = residuals(set(lens0, xp), cfg);
      return rp ? rp.map((val, i) => (val - r[i]) / h) : null;
    });
    if (J.some((c) => !c)) break;
    const n = vars.length, A = [...Array(n)].map((_, i) => [...Array(n)].map((__, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
    const g = J.map((col) => -col.reduce((s, v, k) => s + v * r[k], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + mu) + 1e-18 : v)));
      const dx = solve(Ad, g);
      if (!dx) { mu *= 10; continue; }
      const xn = x.map((v, k) => v + dx[k]), rn = residuals(set(lens0, xn), cfg);
      if (rn && merit(rn) < merit(r)) { x = xn; r = rn; mu = Math.max(1e-7, mu / 3); improved = true; }
      else mu *= 6;
    }
    history.push(merit(r));
    if (!improved || history[history.length - 2] - history[history.length - 1] < 1e-9 * history[0]) break;
  }
  return { lens: set(lens0, x), history, efl: paraxial(set(lens0, x)).efl };
}
