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
    const r = renderPaths(sys, { ...src, pairs: [[-1, -1]], basis: o.basis, fit: true, W: o.K, grid: o.grid || 36 });
    kernels.push({ side, field, rgb: r.rgb, mmW: r.mmW, center: r.center, flux: r.stats.flux[0] || 0 });
  }
  return { zs, zInf: par.zImage, efl: par.efl, fnum: par.fnum, kernels };
}
