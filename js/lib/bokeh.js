// Bokeh from a traced lens: defocused images of point sources, rendered by exact ray tracing of
// the direct path through the prescription (the triangle rasteriser of js/lib/ghosts.js). Each
// kernel therefore carries the lens's own spherical aberration (rim or soft edge), longitudinal
// colour (magenta/green fringes), iris polygon and mechanical vignetting (cat's eyes).
import { paraxial, trace } from './raytrace.js';
import { ghostSystem, renderPaths } from './ghosts.js';

// Axial position of the image of an on-axis point at distance s (mm) in front of the first
// vertex, from a near-axis real ray aimed at the entrance pupil (Infinity → paraxial focus).
export function imagePlane(lens, s, lam = 587.56) {
  const par = paraxial(lens, lam);
  if (!isFinite(s)) return par.zImage;
  const y = 1e-3 * lens.epd, d = [0, y / (s + par.zEP), 1], n = Math.hypot(d[1], 1);
  const r = trace(lens, lam, [0, 0, -s], [0, d[1] / n, 1 / n], { clip: false });
  return r.p[2] - (r.p[1] * r.d[2]) / r.d[1];
}

// o = { lens, sd, lambdas, basis, focus (mm), near (mm, foreground distance), stop (EV below
//       wide open), blades, round, fields: [[hx, hy] image heights in mm], K (pixels), grid }
// Returns { zs, efl, fnum, kernels: [{ side: 'bg' | 'fg', field, rgb, mmW, center, flux }] }.
// Background sources are at infinity; foreground sources at `near`. Both are aimed so that their
// chief ray passes the centre of the entrance pupil at the field angle atan(h / f).
export function bokehKernels(o) {
  const lens = { ...o.lens, epd: o.lens.epd * Math.pow(2, -o.stop / 2) };
  const par = paraxial(lens), zs = imagePlane(lens, o.focus);
  const sys = ghostSystem(lens, { lambdas: o.lambdas, coat: 'none', sd: o.sd, stopR: par.stopR, blades: o.blades, round: o.round, zImg: zs });
  const kernels = [];
  for (const side of ['bg', 'fg']) for (const field of o.fields) {
    const t = [field[0] / par.efl, field[1] / par.efl];
    const src = side === 'bg' ? { theta: t } : { point: [-t[0] * (o.near + par.zEP), -t[1] * (o.near + par.zEP), -o.near] };
    const r = renderPaths(sys, { ...src, pairs: [[-1, -1]], basis: o.basis, fit: true, W: o.K, grid: o.grid || 36, ringing: false }); // geometric: the page's FFT panel shows the diffraction
    kernels.push({ side, field, rgb: r.rgb, mmW: r.mmW, center: r.center, flux: r.stats.flux[0] || 0 });
  }
  return { zs, zInf: par.zImage, efl: par.efl, fnum: par.fnum, kernels };
}

// Build a defocus kernel by forward-splatting a dense pupil grid.
// side = +1 behind the focal plane (background), −1 in front (foreground).
// field = [fx, fy] normalised image position (corner ≈ 1.2). K = kernel grid (px); R = radius of
// the aberration-free disk (px), by default as large as fits the grid.
export function pupilKernel(P, side, field, K, R = null) {
  const img = new Float32Array(K * K);
  const G = Math.max(150, Math.ceil(4 * (R || 0)));
  const sector = (2 * Math.PI) / Math.max(3, P.blades);
  const cp = Math.cos(Math.PI / Math.max(3, P.blades));
  const iris = Math.pow(2, -P.stop / 2); // iris circumradius relative to the full pupil
  const fr = Math.hypot(field[0], field[1]);
  const ux = fr ? field[0] / fr : 1, uy = fr ? field[1] / fr : 0;
  const vshift = P.vig * fr * 1.1; // offset of the vignetting (barrel) circle, pupil units
  // radial transverse-aberration polynomial: r(ρ) = ρ + s ρ³ (+ ripple). Sign convention: P.sa < 0 is
  // under-corrected (marginal focus nearer the lens). Behind focus the cone has already crossed, so the
  // marginal rays spread further (s > 0, soft edge); in front of focus they bunch up (s < 0, bright rim).
  const s = -P.sa * side;
  const orient = side > 0 ? -1 : 1; // background disks are inverted images of the pupil
  const scale = R != null ? R / K : 1 / (1 + Math.max(0, s) + P.ripple * 0.05) * 0.46; // by default keep the kernel inside the grid
  let total = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = ((i + 0.5) / G) * 2 - 1, y = ((j + 0.5) / G) * 2 - 1;
    const rho = Math.hypot(x, y);
    if (rho > 1) continue;
    // aperture: polygon iris (with blade curvature) ∩ circular full aperture
    if (P.blades >= 3) {
      let ph = Math.atan2(y, x) - P.rot;
      ph = ((ph % sector) + sector) % sector - sector / 2;
      const rp = (cp / Math.cos(ph)) * (1 - P.round) + P.round;
      if (rho > Math.min(1, iris * rp)) continue;
    } else if (rho > Math.min(1, iris)) continue;
    if (rho < P.obs * Math.min(1, iris)) continue;
    // mechanical vignetting: the barrel window seen off-axis (cat's eye)
    if (Math.hypot(x - ux * vshift, y - uy * vshift) > 1.0) continue;
    let w = 1;
    if (P.apod) w = Math.exp(-((rho / Math.min(1, iris)) ** 2) * 2.2);
    const rn = rho / Math.min(1, iris);
    let r = rn + s * rn * rn * rn + P.ripple * 0.012 * Math.sin(2 * Math.PI * 9 * rn * rn);
    const ang = Math.atan2(y, x);
    const X = K / 2 + orient * Math.cos(ang) * r * scale * K;
    const Y = K / 2 - orient * Math.sin(ang) * r * scale * K;
    const xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
    if (xi < 0 || yi < 0 || xi >= K - 1 || yi >= K - 1) continue;
    img[yi * K + xi] += w * (1 - fx) * (1 - fy); img[yi * K + xi + 1] += w * fx * (1 - fy);
    img[(yi + 1) * K + xi] += w * (1 - fx) * fy; img[(yi + 1) * K + xi + 1] += w * fx * fy;
    total += w;
  }
  // light 3×3 smoothing (finite sampling), normalise peak
  const out = new Float32Array(K * K);
  let mx = 0;
  for (let y = 1; y < K - 1; y++) for (let x = 1; x < K - 1; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += img[(y + dy) * K + x + dx] * (dx || dy ? (dx && dy ? 0.06 : 0.12) : 0.28);
    out[y * K + x] = v; if (v > mx) mx = v;
  }
  return { data: out, mx, total };
}
