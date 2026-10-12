// Lens-flare ghosts: every path with exactly two internal reflections, i < j.
//
// paraxialGhosts: 2×2 y–nu matrices per path (instant; Hullin et al. 2011, §4.1).
// renderGhosts:   exact 3-D ray tracing of a pupil grid through each path, rasterised as
//   triangles whose irradiance is flux / image area (Hullin et al. 2011, the full method).
//   The iris and every clear aperture are evaluated per pixel from the interpolated
//   "aperture gauge" g = max over surfaces of (radius / limit), so ghost edges stay sharp on
//   a coarse ray grid. Reflectances follow the coating's thin-film R(θ, λ) at each ray's
//   actual angle of incidence, and become 1 beyond the critical angle (total internal reflection).
import { index } from './glass.js';
import { vertices, stopIndex, isAspheric, intersectAsphere } from './raytrace.js';
import { fresnel, stackReflectance, COATINGS } from './thinfilm.js';

// Surfaces with an index step at λ (glass–air or cemented glass–glass).
export function reflectingSurfaces(lens, lam = 587.56) {
  const S = lens.surfaces, out = [];
  S.forEach((s, k) => { if (Math.abs(index(s.glass, lam) - (k ? index(S[k - 1].glass, lam) : 1)) > 1e-6) out.push(k); });
  return out;
}
export function ghostPairs(lens, lam = 587.56) {
  const r = reflectingSurfaces(lens, lam), out = [];
  for (let b = 1; b < r.length; b++) for (let a = 0; a < b; a++) out.push([r[a], r[b]]);
  return out;
}

// Paraxial ghost matrices. State (y, w = n·u); media are signed (negative after an odd number
// of reflections). M maps (y, θ) at the first vertex to the sensor plane, stopM to the first
// pass through the stop.
export function paraxialGhosts(lens, lam, zImg) {
  const S = lens.surfaces, N = S.length;
  const m = (k) => (k < 0 ? 1 : index(S[k].glass, lam)); // medium after surface k
  const c = (k) => (isFinite(S[k].R) ? 1 / S[k].R : 0);
  const zv = vertices(lens), si = stopIndex(lens);
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  const T = (t, n) => [1, t / n, 0, 1];
  const Rf = (p) => [1, 0, -p, 1];
  const out = [];
  for (const [i, j] of ghostPairs(lens, lam)) {
    let M = [1, 0, 0, 1], stopM = null;
    const atStop = (k) => { if (k === si && !stopM) stopM = M.slice(); };
    // forward to surface j
    for (let k = 0; k < j; k++) { atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); M = mul(T(S[k].t, m(k)), M); }
    atStop(j);
    M = mul(Rf(-2 * m(j - 1) * c(j)), M); // reflect at j, travelling in medium m(j−1)
    // backward to surface i
    for (let k = j - 1; k > i; k--) { M = mul(T(S[k].t, m(k)), M); atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); }
    M = mul(T(S[i].t, m(i)), M);
    atStop(i);
    M = mul(Rf(2 * m(i) * c(i)), M); // reflect at i, travelling backward in medium m(i)
    // forward to the image plane
    for (let k = i + 1; k < N; k++) { M = mul(T(S[k - 1].t, m(k - 1)), M); atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); }
    M = mul(T(zImg - zv[N - 1], 1), M);
    if (!stopM) continue;
    out.push({ i, j, M, stopM });
  }
  return out;
}

// Optical system prepared for ghost tracing at a set of wavelengths.
// o = { lambdas, coat, sd (clear semi-diameters), stopR, blades (0 = circular iris), zImg }
export function ghostSystem(lens, o) {
  const S = lens.surfaces, N = S.length;
  const media = o.lambdas.map((l) => {
    const after = S.map((s) => index(s.glass, l));
    return { after, before: after.map((_, k) => (k ? after[k - 1] : 1)) };
  });
  // coated glass–air surfaces: R(θ_air) in 1° steps; R is the same from either side of a
  // lossless stack, so internal reflections look up the angle refracted out into air
  const coat = COATINGS[o.coat || 'none'];
  const tables = S.map((s, k) => o.lambdas.map((l, li) => {
    const n1 = media[li].before[k], n2 = media[li].after[k];
    if (Math.abs(n1 - n2) < 1e-6 || (n1 !== 1 && n2 !== 1)) return null;
    const ng = Math.max(n1, n2), layers = coat.layers(ng), t = new Float64Array(92);
    for (let a = 0; a < 90; a++) t[a] = stackReflectance(layers, 1, ng, l, (a * Math.PI) / 180).R;
    t[90] = t[91] = 1;
    return t;
  }));
  const nb = o.blades || 0, sector = nb ? (2 * Math.PI) / nb : 0, cp = nb ? Math.cos(Math.PI / nb) : 1;
  const rot = nb ? Math.PI / 2 - sector / 2 : 0; // a blade vertex at the top
  const gaugeStop = nb
    ? (x, y) => { let ph = Math.atan2(y, x) - rot; ph = ((ph % sector) + sector) % sector - sector / 2; return (Math.sqrt(x * x + y * y) * Math.cos(ph)) / (cp * o.stopR); }
    : (x, y) => Math.sqrt(x * x + y * y) / o.stopR;
  return { lens, S, N, zv: vertices(lens), si: stopIndex(lens), sd: o.sd, stopR: o.stopR, zImg: o.zImg, lambdas: o.lambdas, media, tables, gaugeStop, asph: S.map(isAspheric) };
}

// Exact trace of one ray along ghost path (i, j) at wavelength index li.
// Returns [x, y, gauge, R] on the sensor (a reused array: copy it), or null if the ray misses a surface, suffers TIR on a
// refraction, or strays far outside an aperture (gauge > 2).
export function makeGhostTracer(sys, li) {
  const { S, N, zv, sd, si, gaugeStop, asph } = sys, { before, after } = sys.media[li];
  const tab = sys.tables.map((t) => t[li]), Rad = S.map((s) => s.R), flat = S.map((s) => !isFinite(s.R));
  // per path, the surface sequence with incident/outgoing indices and the two reflections
  const seqs = new Map();
  const sequence = (i, j) => {
    let q = seqs.get(i * 4096 + j);
    if (q) return q;
    const ks = [], n1 = [], n2 = [], rf = [];
    const add = (k, a, b, r) => { ks.push(k); n1.push(a); n2.push(b); rf.push(r); };
    for (let k = 0; k < j; k++) add(k, before[k], after[k], 0);
    add(j, before[j], after[j], 1);
    for (let k = j - 1; k > i; k--) add(k, after[k], before[k], 0);
    add(i, after[i], before[i], 1);
    for (let k = i + 1; k < N; k++) add(k, before[k], after[k], 0);
    q = { ks: Int32Array.from(ks), n1: Float64Array.from(n1), n2: Float64Array.from(n2), rf: Uint8Array.from(rf) };
    seqs.set(i * 4096 + j, q);
    return q;
  };
  // one flat loop over plain locals: closures over mutable numbers would box every update
  const out = new Float64Array(4);
  return function traceGhost(i, j, x0, y0, z0, ux, uy, uz) {
    const { ks, n1, n2, rf } = sequence(i, j);
    let px = x0, py = y0, pz = z0, dx = ux, dy = uy, dz = uz, nx = 0, ny = 0, nz = -1, g = 0, R = 1;
    for (let m = 0; m < ks.length; m++) {
      const k = ks[m], zk = zv[k];
      if (asph[k]) {
        const h = intersectAsphere(S[k], zk, [px, py, pz], [dx, dy, dz]);
        if (!h || h.t < -1e-9) return null;
        px = h.p[0]; py = h.p[1]; pz = h.p[2]; nx = h.nrm[0]; ny = h.nrm[1]; nz = h.nrm[2];
      } else if (flat[k]) {
        const t = (zk - pz) / dz;
        if (!(t > -1e-9)) return null;
        px += t * dx; py += t * dy; pz = zk; nx = 0; ny = 0; nz = -1;
      } else {
        const Rr = Rad[k], cz = zk + Rr, qz = pz - cz;
        const b = px * dx + py * dy + qz * dz, c = px * px + py * py + qz * qz - Rr * Rr, disc = b * b - c;
        if (disc < 0) return null;
        const sq = Math.sqrt(disc), t1 = -b - sq;
        const t = (pz + t1 * dz - cz) * Rr < 0 ? t1 : -b + sq; // the vertex-side hemisphere
        if (t < -1e-9) return null;
        px += t * dx; py += t * dy; pz += t * dz;
        nx = px / Rr; ny = py / Rr; nz = (pz - cz) / Rr;
      }
      const gk = k === si ? gaugeStop(px, py) : Math.sqrt(px * px + py * py) / sd[k];
      if (gk > g) { g = gk; if (g > 2) return null; }
      let cosi = -(nx * dx + ny * dy + nz * dz);
      if (cosi < 0) { nx = -nx; ny = -ny; nz = -nz; cosi = -cosi; }
      if (rf[m]) {
        const tb = tab[k];
        let Rk;
        if (tb) {
          const sa = n1[m] * Math.sqrt(Math.max(0, 1 - cosi * cosi)); // sine of the angle in air
          if (sa >= 1) Rk = 1;
          else { const a = (Math.asin(sa) * 180) / Math.PI, a0 = a | 0, f = a - a0; Rk = tb[a0] * (1 - f) + tb[a0 + 1] * f; }
        } else Rk = fresnel(n1[m], n2[m], Math.acos(Math.min(1, cosi))).R;
        R *= Rk;
        dx += 2 * cosi * nx; dy += 2 * cosi * ny; dz += 2 * cosi * nz;
      } else {
        const mu = n1[m] / n2[m], kk = 1 - mu * mu * (1 - cosi * cosi);
        if (kk < 0) return null;
        const f = mu * cosi - Math.sqrt(kk);
        dx = mu * dx + f * nx; dy = mu * dy + f * ny; dz = mu * dz + f * nz;
      }
    }
    if (dz <= 0) return null;
    const t = (sys.zImg - pz) / dz;
    out[0] = px + t * dx; out[1] = py + t * dy; out[2] = g; out[3] = R;
    return out;
  };
}

// Render all ghosts into a linear RGB float image of the sensor.
// o = { theta: [tan θx, tan θy] of the source, basis: RGB weight per wavelength,
//       mmW, mmH (sensor size), W (pixels across), grid (rays per pupil side), coarse, pairs,
//       cull (skip paths whose estimated peak value is below this) }
// Pixel value = Σ_λ basis_λ · E_ghost/E_source, where E_source is the source irradiance on a
// plane normal to its direction. Returns { rgb, W, H, stats }.
export function renderGhosts(sys, o) {
  const mmW = o.mmW || 36, mmH = o.mmH || 24, W = o.W || 360, H = Math.round((W * mmH) / mmW);
  const mmpx = mmW / W, pxA = mmpx * mmpx, rgb = new Float32Array(W * H * 3);
  const G = o.grid || 40, C = o.coarse || 28, basis = o.basis;
  const nrm = Math.hypot(o.theta[0], o.theta[1], 1), ux = o.theta[0] / nrm, uy = o.theta[1] / nrm, uz = 1 / nrm;
  // launch plane in front of the first surface; grids are centred on the beam that hits its vertex
  const s0 = sys.S[0], sag0 = isFinite(s0.R) ? Math.abs(s0.R) - Math.sqrt(Math.max(0, s0.R * s0.R - sys.sd[0] ** 2)) : 0;
  const zL = -2 - sag0, cx0 = (ux / uz) * zL, cy0 = (uy / uz) * zL, h0 = sys.sd[0] * 1.05;
  const pairs = o.pairs || ghostPairs(sys.lens);
  const lmid = sys.lambdas.length >> 1, tracers = sys.lambdas.map((_, li) => makeGhostTracer(sys, li));
  const stats = { paths: 0, culled: 0, rays: 0, triangles: 0, flux: [] };
  const cull = o.cull ?? 0, cX = new Float64Array((C + 1) ** 2), cY = new Float64Array(cX.length), cR = new Float64Array(cX.length), cOk = new Uint8Array(cX.length);
  const X = new Float64Array((G + 1) ** 2), Y = new Float64Array(X.length), Gg = new Float64Array(X.length), Rr = new Float64Array(X.length), ok = new Uint8Array(X.length);
  for (const [i, j] of pairs) {
    // 1. coarse search for the part of the launch plane that reaches the sensor along this
    //    path, and an estimate of its peak irradiance: paths too faint to see are skipped
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, peak = 0;
    const tr = tracers[lmid], dc = (2 * h0) / C;
    for (let b = 0, q = 0; b <= C; b++) for (let a = 0; a <= C; a++, q++) {
      const x = cx0 - h0 + a * dc, y = cy0 - h0 + b * dc, r = tr(i, j, x, y, zL, ux, uy, uz);
      stats.rays++;
      cOk[q] = r && r[2] < 1 ? 1 : 0;
      if (!cOk[q]) continue;
      cX[q] = r[0]; cY[q] = r[1]; cR[q] = r[3];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (a && b && cOk[q - 1] && cOk[q - C - 1] && cOk[q - C - 2]) {
        const A = Math.abs((cX[q] - cX[q - C - 2]) * (cY[q - 1] - cY[q - C - 1]) - (cY[q] - cY[q - C - 2]) * (cX[q - 1] - cX[q - C - 1])) / 2;
        peak = Math.max(peak, (cR[q] * dc * dc * uz) / Math.max(A, pxA));
      }
    }
    let pathFlux = 0;
    if (x0 > x1 || peak < cull) { stats.flux.push(0); if (x0 <= x1) stats.culled++; continue; }
    stats.paths++;
    x0 -= dc; x1 += dc; y0 -= dc; y1 += dc;
    const gx = (x1 - x0) / G, gy = (y1 - y0) / G, aSrc = (gx * gy * uz) / 2; // projected area per triangle
    // 2. fine grid per wavelength, rasterised as triangles
    sys.lambdas.forEach((_, li) => {
      const t = tracers[li], [cr, cg, cb] = basis[li];
      for (let b = 0, q = 0; b <= G; b++) for (let a = 0; a <= G; a++, q++) {
        const r = t(i, j, x0 + a * gx, y0 + b * gy, zL, ux, uy, uz);
        stats.rays++;
        if (!r) { ok[q] = 0; continue; }
        ok[q] = 1; X[q] = r[0] / mmpx + W / 2; Y[q] = H / 2 - r[1] / mmpx; Gg[q] = r[2]; Rr[q] = r[3];
      }
      for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
        const q = b * (G + 1) + a;
        for (const [p0, p1, p2] of [[q, q + 1, q + G + 2], [q, q + G + 2, q + G + 1]]) {
          if (!ok[p0] || !ok[p1] || !ok[p2]) continue;
          const g0 = Gg[p0], g1 = Gg[p1], g2 = Gg[p2];
          if (g0 >= 1 && g1 >= 1 && g2 >= 1) continue;
          stats.triangles++;
          const flux = ((Rr[p0] + Rr[p1] + Rr[p2]) / 3) * aSrc;
          pathFlux += splat(rgb, W, H, X[p0], Y[p0], g0, X[p1], Y[p1], g1, X[p2], Y[p2], g2, flux, pxA, cr, cg, cb) * (li === lmid ? 1 : 0);
        }
      }
    });
    stats.flux.push(pathFlux);
  }
  return { rgb, W, H, stats };
}

// Deposit a triangle carrying `flux` (mm² · E_source): irradiance flux/area on every pixel whose
// centre it covers, weighted by the anti-aliased aperture mask (interpolated gauge < 1).
// Sub-pixel triangles go to their centroid pixel. Returns the flux actually deposited.
function splat(rgb, W, H, x0, y0, g0, x1, y1, g1, x2, y2, g2, flux, pxA, cr, cg, cb) {
  const A2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0), area = Math.abs(A2) / 2; // px²
  if (area < 1) {
    const gc = (g0 + g1 + g2) / 3, m = Math.min(1, Math.max(0, 0.5 + (1 - gc) * 4));
    const x = Math.floor((x0 + x1 + x2) / 3), y = Math.floor((y0 + y1 + y2) / 3);
    if (!m || x < 0 || y < 0 || x >= W || y >= H) return 0;
    const v = (flux * m) / pxA, q = (y * W + x) * 3;
    rgb[q] += v * cr; rgb[q + 1] += v * cg; rgb[q + 2] += v * cb;
    return flux * m;
  }
  // gauge as a plane over the triangle; its pixel-space gradient sets the edge width
  const inv = 1 / A2;
  const gxp = ((g1 - g0) * (y2 - y0) - (g2 - g0) * (y1 - y0)) * inv, gyp = ((g2 - g0) * (x1 - x0) - (g1 - g0) * (x2 - x0)) * inv;
  const aa = 1 / Math.max(1e-9, Math.hypot(gxp, gyp));
  const E = flux / (area * pxA);
  const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  let dep = 0;
  for (let y = ya; y <= yb; y++) {
    const py = y + 0.5;
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const gp = w0 * g0 + w1 * g1 + w2 * g2;
      const m = Math.min(1, Math.max(0, 0.5 + (1 - gp) * aa));
      if (!m) continue;
      const v = E * m, q = (y * W + x) * 3;
      rgb[q] += v * cr; rgb[q + 1] += v * cg; rgb[q + 2] += v * cb;
      dep += m;
    }
  }
  return dep * E * pxA;
}
