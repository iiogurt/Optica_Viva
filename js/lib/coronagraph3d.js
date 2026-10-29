// 3-D scene for the Lyot coronagraph of the space-telescope laboratory (shown by js/lib/gl3d.js):
// the instrument laid out as a 4f relay along the beam (z), with the computed fields on its planes:
// the entrance pupil, the focal plane with the star's image (log relief) and the occulting mask,
// the Lyot plane (|E|, log), where the light the mask diffracts gathers at the pupil's edges, with
// the Lyot stop, and the final coronagraphic image (log relief). Schematic rays: the star's stop at
// the mask; an off-axis planet's pass it and come to a focus at its place in the final image. The
// fields come from the same Fourier model as the 2-D figures. Pure: no DOM.
import { colormap } from './color.js';
import { sphere, normalsFrom } from './mesh3d.js';

const F = 1.1, H = 0.5; // focal length between planes, half-size of each plane (scene units)
const STAR = [1, 0.35, 0.35], PLANET = [1, 0.71, 0.28];

// A res × res grid over a plane at z, half-size H, sampling crop × crop pixels of the n × n field
// centred at n/2: colour col(v) and relief (towards −z, the incoming light) of depth h(v).
function plane(field, n, crop, z, res, col, h = () => 0) {
  const positions = new Float32Array(res * res * 3), colors = new Float32Array(res * res * 3), idx = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const px = Math.round(n / 2 - crop / 2 + ((i + 0.5) * crop) / res), py = Math.round(n / 2 - crop / 2 + ((j + 0.5) * crop) / res);
    const v = field[Math.max(0, Math.min(n - 1, py)) * n + Math.max(0, Math.min(n - 1, px))], q = j * res + i;
    // image rows run downwards; scene y runs up
    positions.set([-H + ((i + 0.5) * 2 * H) / res, H - ((j + 0.5) * 2 * H) / res, z - h(v)], q * 3);
    colors.set(col(v), q * 3);
  }
  for (let j = 0; j < res - 1; j++) for (let i = 0; i < res - 1; i++) { const a = j * res + i, b = a + res; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), indices, colors };
}
const disc = (r, z, c = [0, 0], k = 64) => {
  const P = [[c[0], c[1], z]], idx = [];
  for (let q = 0; q < k; q++) P.push([c[0] + r * Math.cos((q / k) * 2 * Math.PI), c[1] + r * Math.sin((q / k) * 2 * Math.PI), z]);
  for (let q = 1; q <= k; q++) idx.push(0, q, q === k ? 1 : q + 1);
  const positions = new Float32Array(P.flat()), indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), indices };
};
const circle = (r, z, c = [0, 0], k = 72) => Array.from({ length: k + 1 }, (_, q) => [c[0] + r * Math.cos((q / k) * 2 * Math.PI), c[1] + r * Math.sin((q / k) * 2 * Math.PI), z]);
// A thin lens as a flattened glass sphere at z.
function lens(z, r = H * 0.95) {
  const m = sphere(1, [0, 0, 0], 40, 16);
  for (let q = 0; q < m.positions.length; q += 3) { m.positions[q] *= r; m.positions[q + 1] *= r; m.positions[q + 2] = z + m.positions[q + 2] * 0.06; }
  return { mesh: m, color: [0.55, 0.78, 1], opacity: 0.22, glass: true };
}

// The planes' positions along the beam.
export const Z = { pupil: 0, L1: F, focal: 2 * F, L2: 3 * F, lyot: 4 * F, L3: 5 * F, image: 6 * F };

// r = the coronagraph task's result { dI, cI, lyotPlane, amp, lyot, maskR (px) }, st = its
// controls { mask (λ/D), lyot (fraction of D), sep (λ/D), pupil }, n, Dp (grid, pupil px)
export function coronagraphScene(r, st, n, Dp) {
  const meshes = [], lines = [], labels = [];
  const Q = n / Dp, cropF = Math.min(n, 2 * Math.ceil((Math.max(st.sep, st.mask) + 5) * Q)), cropP = Math.round(Dp * 1.25);
  const sF = H / (cropF / 2), sP = H / (cropP / 2); // scene units per pixel
  const log = (v, dec) => Math.max(0, Math.min(1, 1 + Math.log10(Math.max(v, 1e-30)) / dec));
  const inferno = (dec) => (v) => colormap('inferno', log(v, dec));
  const relief = (dec) => (v) => 0.35 * log(v, dec);
  // the entrance pupil
  meshes.push({ mesh: plane(r.amp, n, cropP, Z.pupil, 80, (v) => (v > 0.5 ? [0.85, 0.88, 0.95] : [0.06, 0.07, 0.1])), color: [1, 1, 1] });
  labels.push({ p: [0, -H - 0.14, Z.pupil], text: 'entrance pupil', color: '#c9cfdc' });
  // the focal plane: the star (and planet) image, with the occulting mask over its core
  meshes.push({ mesh: plane(r.dI, n, cropF, Z.focal, 96, inferno(10), relief(10)), color: [1, 1, 1] });
  if (st.mask > 0) meshes.push({ mesh: disc(st.mask * Q * sF, Z.focal - 0.37), color: [0.05, 0.05, 0.07] });
  labels.push({ p: [0, H + 0.12, Z.focal], text: 'focal plane: occulting mask, {m} λ/D', vars: { m: st.mask }, color: '#c9cfdc' });
  // the Lyot plane: |E| after the mask, and the stop
  let lm = 0; for (const v of r.lyotPlane) lm = Math.max(lm, v);
  meshes.push({ mesh: plane(r.lyotPlane.map((v) => v / lm), n, cropP, Z.lyot, 80, inferno(3)), color: [1, 1, 1] });
  const rs = ((Dp * st.lyot) / 2) * sP, stop = [];
  lines.push({ points: circle(rs, Z.lyot - 0.01), color: [0.42, 0.84, 1, 1], width: 1.8 });
  // the stop's opaque ring, from its opening to the plane's edge
  const k = 72;
  for (let q = 0; q <= k; q++) { const a = (q / k) * 2 * Math.PI; stop.push([rs * Math.cos(a), rs * Math.sin(a), Z.lyot - 0.02], [H * 1.15 * Math.cos(a), H * 1.15 * Math.sin(a), Z.lyot - 0.02]); }
  const sidx = []; for (let q = 0; q < k; q++) sidx.push(2 * q, 2 * q + 1, 2 * q + 2, 2 * q + 1, 2 * q + 3, 2 * q + 2);
  const sp = new Float32Array(stop.flat()), si = new Uint32Array(sidx);
  meshes.push({ mesh: { positions: sp, normals: normalsFrom(sp, si), indices: si }, color: [0.12, 0.13, 0.17], opacity: 0.8 });
  labels.push({ p: [0, H + 0.12, Z.lyot], text: 'Lyot plane: stop at {p} % D', vars: { p: (st.lyot * 100).toFixed(0) }, color: '#6ad7ff' });
  // the final image
  meshes.push({ mesh: plane(r.cI, n, cropF, Z.image, 96, inferno(10), relief(10)), color: [1, 1, 1] });
  labels.push({ p: [0, H + 0.12, Z.image], text: 'coronagraphic image', color: '#c9cfdc' });
  for (const z of [Z.L1, Z.L2, Z.L3]) meshes.push(lens(z));
  // schematic rays: straight between the lenses, through each focus, the pupil re-imaged
  // (inverted) in the Lyot plane; the star's end at the mask, the planet's reach its image
  const xp = st.sep * Q * sF;
  const path = (p0, f) => {
    const L1 = [p0[0], p0[1], Z.L1], L2 = [2 * f[0] - L1[0], 2 * f[1] - L1[1], Z.L2], ly = [-p0[0], -p0[1], Z.lyot], L3 = [2 * ly[0] - L2[0], 2 * ly[1] - L2[1], Z.L3];
    return [[p0[0], p0[1], Z.pupil - 0.6], [p0[0], p0[1], Z.pupil], L1, [f[0], f[1], Z.focal], L2, ly, L3, [f[0], f[1], Z.image]];
  };
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * 2 * Math.PI, p0 = [0.32 * Math.cos(a), 0.32 * Math.sin(a)];
    lines.push({ points: path(p0, [0, 0]).slice(0, 4), color: [...STAR, 0.5], width: 1.1 });
    if (q % 2 === 0) lines.push({ points: path(p0, [xp, 0]), color: [...PLANET, 0.7], width: 1.2 });
  }
  labels.push({ p: [0, -H - 0.3, Z.focal], text: 'starlight stops at the mask', color: '#ff8a8a' });
  labels.push({ p: [xp, -H - 0.12, Z.image], text: 'planet at {s} λ/D', vars: { s: st.sep }, color: '#ffb547' });
  return { meshes, lines, labels, frame: { centre: [0, 0, Z.image / 2], size: Z.image * 0.95 } };
}
