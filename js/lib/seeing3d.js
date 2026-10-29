// 3-D scene for the seeing laboratory (shown by js/lib/gl3d.js): the band of the frozen-flow phase
// screen that the wind carries across the telescope, as a relief in waves, the telescope's pupil
// on it, and above the pupil the wavefront the telescope is left with after correction, at the
// same height scale, so that tip–tilt or adaptive optics visibly flatten it. Lengths in pupil
// diameters (the screen is 8 D long); the pupil moves along +x over the screen, which is the
// screen moving along −x past the telescope. Pure: no DOM.
import { NS, DP, STRIP_PAD, STRIP_STEP } from './seeing.js';
import { diverging } from './color.js';
import { heightField } from './mesh3d.js';
import { wavefrontMesh, ring } from './surf3d.js';
import { N_ } from './i18n.js';

const UP = 1.15; // the residual relief floats this far above the screen

// The screen's x (pupil diameters, the strip centred on the origin) of screen column c.
export const colX = (c) => c / DP - NS / DP / 2;

// m = { strip (waves at λ, rows × cols), cols, rows, shift (screen px), wave (DP × DP, waves),
//       rms (waves), D (m), v (m/s), ao ('off' | 'tt' | 'ao') }
export function seeingScene({ strip, cols, rows, shift = 0, wave = null, rms = NaN, D = 8, v = 10, ao = 'off' }) {
  const meshes = [], lines = [], labels = [];
  let smax = 1e-9;
  for (const x of strip) smax = Math.max(smax, Math.abs(x));
  const k = 0.55 / smax; // height per wave, shared by the screen and the residual
  // the screen: a height field over the band the pupil sweeps, coloured like the 2-D view
  const x0 = colX(0), x1 = colX((cols - 1) * STRIP_STEP), z0 = (-STRIP_PAD - DP / 2) / DP, z1 = z0 + ((rows - 1) * STRIP_STEP) / DP;
  const at = (x, z) => {
    const i = Math.round(((x - x0) / (x1 - x0)) * (cols - 1)), j = Math.round(((z - z0) / (z1 - z0)) * (rows - 1));
    return strip[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))];
  };
  const hf = heightField(cols, rows, x0, x1, z0, z1, (x, z) => at(x, z) * k);
  const colors = new Float32Array(cols * rows * 3);
  for (let q = 0; q < cols * rows; q++) colors.set(diverging(Math.max(-1, Math.min(1, strip[q] / smax))), q * 3);
  meshes.push({ mesh: { ...hf, colors }, color: [1, 1, 1] });
  labels.push({ p: [0, -0.2, z1 + 0.45], text: 'phase screen: the turbulence, frozen and blown past at {v} m/s', vars: { v }, color: '#c9cfdc' });
  lines.push({ points: [[x1 - 0.2, 0.05, z1 + 0.18], [x1 - 1.4, 0.05, z1 + 0.18]], color: [1, 1, 1, 0.6], width: 1.6 });
  labels.push({ p: [x1 - 0.8, 0.15, z1 + 0.3], text: 'wind', color: '#c9cfdc' });
  // the pupil over the screen, where the wind has brought the screen by now
  const cx = colX((((shift % NS) + NS) % NS) + DP / 2);
  lines.push({ points: ring(0.5, cx, smax * k + 0.02), color: [1, 1, 1, 0.95], width: 1.8 });
  labels.push({ p: [cx, -0.25, -0.75], text: 'telescope pupil, {D} m', vars: { D }, color: '#ffffff' });
  // the residual wavefront in the pupil, above it, at the same scale
  if (wave) {
    let wmax = 0.25;
    for (const x of wave) wmax = Math.max(wmax, Math.abs(x));
    const r = wavefrontMesh(wave, DP, DP, { s: 0.5, cx, height: wmax * k });
    for (let q = 1; q < r.mesh.positions.length; q += 3) r.mesh.positions[q] += UP;
    meshes.push({ mesh: r.mesh, color: [1, 1, 1] });
    lines.push({ points: ring(0.5, cx, UP), color: [1, 1, 1, 0.5], width: 1, glow: false });
    for (const a of [0, Math.PI]) lines.push({ points: [[cx + 0.5 * Math.cos(a), smax * k + 0.02, 0.5 * Math.sin(a)], [cx + 0.5 * Math.cos(a), UP, 0.5 * Math.sin(a)]], color: [1, 1, 1, 0.25], width: 1, glow: false });
    const what = { off: N_('in the pupil, no correction: {rms} λ RMS'), tt: N_('in the pupil, after tip–tilt correction: {rms} λ RMS'), ao: N_('in the pupil, after adaptive optics: {rms} λ RMS') }[ao] || N_('in the pupil: {rms} λ RMS');
    labels.push({ p: [cx, UP + 0.45, 0], text: what, vars: { rms: rms.toFixed(2) }, color: '#ffb547' });
  }
  return { meshes, lines, labels, frame: { centre: [-0.3, 0.45, 0], size: (x1 - x0) * 0.95 }, k };
}
