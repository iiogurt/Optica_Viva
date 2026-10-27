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
// o = { lambdas, coat, sd (clear semi-diameters), stopR, blades (0 = circular iris), round
//       (blade roundness 0–1), zImg (sensor plane) }
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
  const rot = nb ? Math.PI / 2 - sector / 2 : 0; // the middle of a blade's edge at the top
  // iris radius at azimuth φ: straight blades r = cp/cos φ (circumradius 1), blended toward a
  // circle by the blade roundness
  const rd = o.round || 0;
  const gaugeStop = nb
    ? (x, y) => { let ph = Math.atan2(y, x) - rot; ph = ((ph % sector) + sector) % sector - sector / 2; return Math.sqrt(x * x + y * y) / (o.stopR * ((cp / Math.cos(ph)) * (1 - rd) + rd)); }
    : (x, y) => Math.sqrt(x * x + y * y) / o.stopR;
  return { lens, S, N, zv: vertices(lens), si: stopIndex(lens), sd: o.sd, stopR: o.stopR, zImg: o.zImg, lambdas: o.lambdas, media, tables, gaugeStop, asph: S.map(isAspheric) };
}

// Exact trace of one ray along ghost path (i, j), or the direct path (i = j = −1), at wavelength index li.
// Returns [x, y, gauge, R] on the sensor (a reused array: copy it), or null if the ray misses a surface, suffers TIR on a
// refraction, or strays far outside an aperture (gauge > 2). If `pts` is an array, every surface hit and the sensor
// point are appended to it as x, y, z triples (for drawing the path).
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
    if (i < 0) for (let k = 0; k < N; k++) add(k, before[k], after[k], 0); // the direct path
    else {
    for (let k = 0; k < j; k++) add(k, before[k], after[k], 0);
    add(j, before[j], after[j], 1);
    for (let k = j - 1; k > i; k--) add(k, after[k], before[k], 0);
    add(i, after[i], before[i], 1);
    for (let k = i + 1; k < N; k++) add(k, before[k], after[k], 0);
    }
    q = { ks: Int32Array.from(ks), n1: Float64Array.from(n1), n2: Float64Array.from(n2), rf: Uint8Array.from(rf) };
    seqs.set(i * 4096 + j, q);
    return q;
  };
  // one flat loop over plain locals: closures over mutable numbers would box every update
  const out = new Float64Array(4);
  return function traceGhost(i, j, x0, y0, z0, ux, uy, uz, pts = null) {
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
      if (pts) pts.push(px, py, pz);
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
    if (pts) pts.push(out[0], out[1], sys.zImg);
    return out;
  };
}

// Render light paths into a linear RGB float image of the sensor: the ghosts (pairs i < j) or the
// direct, image-forming path ([-1, -1]: defocused point images, i.e. bokeh kernels).
// o = { theta: [tan θx, tan θy] of a distant source, or point: [x, y, z] of a near one (mm),
//       basis: RGB weight per wavelength, pairs (default: every ghost),
//       mmW, mmH, center: [x, y] (window on the sensor, mm; default 36 × 24 centred on the axis),
//       fit (size the square window to the traced spot instead), W (pixels across),
//       grid (rays per side of the launch window), coarse, cull (skip paths whose estimated
//       peak value is below this) }
// Pixel value = Σ_λ basis_λ · E/E_source for a distant source (E_source on a plane normal to
// its direction), or Σ_λ basis_λ · E/I for a point source of intensity I.
// Returns { rgb, W, H, mmW, mmH, center, stats }.
export function renderPaths(sys, o) {
  const G = o.grid || 40, C = o.coarse || 28, basis = o.basis;
  const P = o.point || null;
  let ux = 0, uy = 0, uz = 1;
  if (!P) { const nrm = Math.hypot(o.theta[0], o.theta[1], 1); ux = o.theta[0] / nrm; uy = o.theta[1] / nrm; uz = 1 / nrm; }
  // launch plane in front of the first surface; grids are centred on the beam that hits its vertex
  const s0 = sys.S[0], sag0 = isFinite(s0.R) ? Math.abs(s0.R) - Math.sqrt(Math.max(0, s0.R * s0.R - sys.sd[0] ** 2)) : 0;
  const zL = -2 - sag0, h0 = sys.sd[0] * 1.05;
  const cx0 = P ? P[0] * (1 - (zL - P[2]) / -P[2]) : (ux / uz) * zL, cy0 = P ? P[1] * (1 - (zL - P[2]) / -P[2]) : (uy / uz) * zL;
  const pairs = o.pairs || ghostPairs(sys.lens);
  const lmid = sys.lambdas.length >> 1, tracers = sys.lambdas.map((_, li) => makeGhostTracer(sys, li));
  // one ray from launch point (x, y): direction and the source weight per unit launch area
  // (cos θ for a collimated beam, cos θ / r² for a point source)
  let wt = uz;
  const shoot = (t, i, j, x, y) => {
    if (P) {
      const dx = x - P[0], dy = y - P[1], dz = zL - P[2], r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
      ux = dx / r; uy = dy / r; uz = dz / r; wt = uz / r2;
    }
    return t(i, j, x, y, zL, ux, uy, uz);
  };
  const stats = { paths: 0, culled: 0, rays: 0, triangles: 0, flux: [] };
  // 1. coarse pass per path: the part of the launch plane that reaches the sensor along it, the
  //    extent of its spot, and an estimate of its peak irradiance (faint paths are skipped)
  const cX = new Float64Array((C + 1) ** 2), cY = new Float64Array(cX.length), cR = new Float64Array(cX.length), cOk = new Uint8Array(cX.length);
  const coarse = pairs.map(([i, j]) => {
    const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, X0: Infinity, X1: -Infinity, Y0: Infinity, Y1: -Infinity, cells: [] };
    const tr = tracers[lmid], dc = (2 * h0) / C;
    for (let b = 0, q = 0; b <= C; b++) for (let a = 0; a <= C; a++, q++) {
      const x = cx0 - h0 + a * dc, y = cy0 - h0 + b * dc, r = shoot(tr, i, j, x, y);
      stats.rays++;
      cOk[q] = r && r[2] < 1 ? 1 : 0;
      if (!cOk[q]) continue;
      cX[q] = r[0]; cY[q] = r[1]; cR[q] = r[3] * wt;
      e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y);
      e.X0 = Math.min(e.X0, r[0]); e.X1 = Math.max(e.X1, r[0]); e.Y0 = Math.min(e.Y0, r[1]); e.Y1 = Math.max(e.Y1, r[1]);
      if (a && b && cOk[q - 1] && cOk[q - C - 1] && cOk[q - C - 2]) {
        const A = Math.abs((cX[q] - cX[q - C - 2]) * (cY[q - 1] - cY[q - C - 1]) - (cY[q] - cY[q - C - 2]) * (cX[q - 1] - cX[q - C - 1])) / 2;
        e.cells.push(cR[q] * dc * dc, A); // flux and image area of a coarse cell
      }
    }
    e.dc = dc;
    return e;
  });
  // 2. fine grid per path and wavelength: trace everything first, so a fitted window can use the
  //    full set of landing points
  const NV = (G + 1) ** 2, nl = sys.lambdas.length;
  const fine = pairs.map(([i, j], pi) => {
    const e = coarse[pi];
    let peak = 0;
    for (let c = 0; c < e.cells.length; c += 2) peak = Math.max(peak, e.cells[c] / Math.max(e.cells[c + 1], o.fit ? 0 : ((o.mmW || 36) / (o.W || 360)) ** 2));
    if (e.x0 > e.x1 || peak < (o.cull ?? 0)) { if (e.x0 <= e.x1) stats.culled++; return null; }
    stats.paths++;
    const x0 = e.x0 - e.dc, y0 = e.y0 - e.dc, gx = (e.x1 - e.x0 + 2 * e.dc) / G, gy = (e.y1 - e.y0 + 2 * e.dc) / G;
    const X = new Float64Array(NV * nl), Y = new Float64Array(X.length), Gg = new Float64Array(X.length), Rr = new Float64Array(X.length), ok = new Uint8Array(X.length);
    sys.lambdas.forEach((_, li) => {
      const t = tracers[li];
      for (let b = 0, q = li * NV; b <= G; b++) for (let a = 0; a <= G; a++, q++) {
        const r = shoot(t, i, j, x0 + a * gx, y0 + b * gy);
        stats.rays++;
        if (!r) continue;
        ok[q] = 1; X[q] = r[0]; Y[q] = r[1]; Gg[q] = r[2]; Rr[q] = r[3] * wt;
      }
    });
    return { i, j, X, Y, Gg, Rr, ok, aSrc: (gx * gy) / 2 };
  });
  // the sensor window
  let mmW = o.mmW || 36, mmH = o.mmH || 24, center = o.center || [0, 0];
  if (o.fit) {
    let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
    for (const f of fine) if (f) for (let q = 0; q < f.ok.length; q++) if (f.ok[q] && f.Gg[q] < 1) {
      X0 = Math.min(X0, f.X[q]); X1 = Math.max(X1, f.X[q]); Y0 = Math.min(Y0, f.Y[q]); Y1 = Math.max(Y1, f.Y[q]);
    }
    if (X0 <= X1) { mmW = mmH = Math.max(X1 - X0, Y1 - Y0, 1e-3) * 1.15 + 0.01; center = [(X0 + X1) / 2, (Y0 + Y1) / 2]; }
  }
  const W = o.W || 360, H = Math.round((W * mmH) / mmW), mmpx = mmW / W, pxA = mmpx * mmpx, rgb = new Float32Array(W * H * 3);
  // 3. rasterise each path's triangles at every wavelength
  for (const f of fine) {
    if (!f) { stats.flux.push(0); continue; }
    let pathFlux = 0;
    const { X, Y, Gg, Rr, ok, aSrc } = f;
    for (let q = 0; q < X.length; q++) if (ok[q]) { X[q] = (X[q] - center[0]) / mmpx + W / 2; Y[q] = H / 2 - (Y[q] - center[1]) / mmpx; }
    for (let li = 0; li < nl; li++) {
      const [cr, cg, cb] = basis[li], off = li * NV;
      for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
        const q = off + b * (G + 1) + a;
        for (let tri = 0; tri < 2; tri++) {
          const p0 = q, p1 = tri ? q + G + 2 : q + 1, p2 = tri ? q + G + 1 : q + G + 2;
          if (!ok[p0] || !ok[p1] || !ok[p2]) continue;
          const g0 = Gg[p0], g1 = Gg[p1], g2 = Gg[p2];
          if (g0 >= 1 && g1 >= 1 && g2 >= 1) continue;
          stats.triangles++;
          const flux = ((Rr[p0] + Rr[p1] + Rr[p2]) / 3) * aSrc;
          const d = splat(rgb, W, H, X[p0], Y[p0], g0, X[p1], Y[p1], g1, X[p2], Y[p2], g2, flux, pxA, cr, cg, cb);
          if (li === lmid) pathFlux += d;
        }
      }
    }
    stats.flux.push(pathFlux);
  }
  return { rgb, W, H, mmW, mmH, center, stats };
}
export const renderGhosts = renderPaths;

// Deposit a triangle carrying `flux` (mm² · E_source): irradiance flux/area on every pixel whose
// centre it covers, weighted by the anti-aliased aperture mask (interpolated gauge < 1).
// Sub-pixel triangles go to their centroid pixel. Returns the flux actually deposited.
function splat(rgb, W, H, x0, y0, g0, x1, y1, g1, x2, y2, g2, flux, pxA, cr, cg, cb) {
  const A2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0), area = Math.abs(A2) / 2; // px²
  if (area < 1) {
    // fraction inside the aperture, from where g = 1 falls within the triangle's gauge range
    const gc = (g0 + g1 + g2) / 3, gs = Math.max(g0, g1, g2) - Math.min(g0, g1, g2);
    const m = Math.min(1, Math.max(0, 0.5 + (1 - gc) / Math.max(gs, 1e-9)));
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
  // sample points are nudged off the pixel centres by an irrational sub-pixel offset, so a centre
  // can never lie exactly on an edge shared by two triangles and be counted twice
  for (let y = ya; y <= yb; y++) {
    const py = y + 0.5 + 1.7e-7;
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5 + 3.1e-7;
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
