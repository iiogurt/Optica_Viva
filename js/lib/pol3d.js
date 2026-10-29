// 3-D scenes for the polarisation laboratory (shown by js/lib/gl3d.js): the electric-field vector
// along a beam through polarisers and wave plates, and the Poincaré sphere. Pure: no DOM.
import { ellipse } from './polar.js';
import { sphere, lathe } from './mesh3d.js';
import { N_ } from './i18n.js';

const SEG = 2.6, PERIOD = 0.85; // beam section length and drawn wavelength (scene units)
const COLS = [[0.85, 0.88, 1.0], [0.42, 0.84, 1.0], [0.42, 0.89, 0.64], [1.0, 0.71, 0.28]];

// The tip of the polarised field for Stokes S along z ∈ [z0, z1]: an ellipse of azimuth ψ and
// ellipticity χ swept along the beam (a flat wave for linear light, a helix for circular), with
// amplitude √I_p. E = A·R(ψ)·(cos χ cos φ, sin χ sin φ), φ = 2π z / λ.
export function fieldTip(S, z0, z1, n = 220) {
  const e = ellipse(S), A = Math.sqrt(Math.max(0, e.Ip)), cp = Math.cos(e.psi), sp = Math.sin(e.psi), cc = Math.cos(e.chi), sc = Math.sin(e.chi);
  return Array.from({ length: n + 1 }, (_, i) => {
    const z = z0 + ((z1 - z0) * i) / n, ph = (2 * Math.PI * z) / PERIOD, ex = A * cc * Math.cos(ph), ey = A * sc * Math.sin(ph);
    return [cp * ex - sp * ey, sp * ex + cp * ey, z];
  });
}

// A flat disk (the element) of radius r at z, as a thin lathe.
const disk = (r, z) => lathe([[0, z], [r, z]], 64);

// states: Stokes vectors [input, after element 1, after 2, after 3]; elements: [{ kind:
// 'pol' | 'qwp' | 'hwp' | 'none', angle (rad), name }] for the three positions.
export function beamScene(states, elements) {
  const meshes = [], lines = [], labels = [];
  const R = 1.35; // element radius
  states.forEach((S, k) => {
    const z0 = k * SEG + (k ? 0.12 : 0), z1 = (k + 1) * SEG - 0.12, col = COLS[k];
    const e = ellipse(S);
    if (e.Ip > 1e-6) {
      const tip = fieldTip(S, z0, z1);
      lines.push({ points: tip, color: [...col, 0.95], width: 1.8 });
      // the field vector drawn from the axis at regular steps
      for (let i = 0; i < tip.length; i += 6) lines.push({ points: [[0, 0, tip[i][2]], tip[i]], color: [...col, 0.28], width: 1 });
    }
    const Iu = S[0] - e.Ip;
    if (Iu > 1e-3) { // unpolarised share: a faint ring of radius √I_u
      const r = Math.sqrt(Iu), zm = (z0 + z1) / 2;
      lines.push({ points: Array.from({ length: 65 }, (_, i) => [r * Math.cos((i * Math.PI) / 32), r * Math.sin((i * Math.PI) / 32), zm]), color: [1, 1, 1, 0.35], width: 1 });
      labels.push({ p: [0, -r - 0.25, zm], text: 'unpolarised', color: 'rgba(255,255,255,0.6)' });
    }
    labels.push({ p: [0, 1.6, (z0 + z1) / 2], text: `I = ${S[0].toFixed(2)}`, color: `rgb(${col.map((c) => Math.round(c * 255)).join(',')})` });
  });
  elements.forEach((el, k) => {
    if (el.kind === 'none') return;
    const z = (k + 1) * SEG, wave = el.kind !== 'pol';
    meshes.push({ mesh: disk(R, z), color: wave ? [0.75, 0.55, 1.0] : [0.55, 0.8, 1.0], opacity: 0.16, glass: true });
    // a polariser's transmission axis as parallel lines; a wave plate's fast axis as one arrow
    const c = Math.cos(el.angle), s = Math.sin(el.angle), nx = -s, ny = c;
    if (!wave) for (let q = -4; q <= 4; q++) {
      const o = (q / 4) * R * 0.85, half = Math.sqrt(Math.max(0, R * R - o * o)) * 0.95;
      lines.push({ points: [[o * nx - half * c, o * ny - half * s, z], [o * nx + half * c, o * ny + half * s, z]], color: [0.75, 0.9, 1, 0.55], width: 1 });
    } else lines.push({ points: [[-R * c, -R * s, z], [R * c, R * s, z], [R * 0.82 * c - 0.12 * nx, R * 0.82 * s - 0.12 * ny, z], [R * c, R * s, z], [R * 0.82 * c + 0.12 * nx, R * 0.82 * s + 0.12 * ny, z]], color: [0.85, 0.7, 1, 0.9], width: 1.4 });
    labels.push({ p: [0, -R - 0.3, z], text: el.name, color: wave ? '#c18cff' : '#8fd8ff' });
  });
  lines.push({ points: [[0, 0, -0.4], [0, 0, states.length * SEG + 0.4]], color: [1, 1, 1, 0.15], width: 0.8 });
  return { meshes, lines, labels };
}

// Poincaré sphere: S₁ along x, S₂ along z (into the screen), S₃ up; a state sits at (S₁, S₃, S₂)/S₀,
// on the sphere when fully polarised, inside it in proportion to its degree of polarisation.
const toP = (S) => (S[0] > 0 ? [S[1] / S[0], S[3] / S[0], S[2] / S[0]] : [0, 0, 0]);
export function poincareScene(states) {
  const meshes = [{ mesh: sphere(1, [0, 0, 0], 48, 24), color: [0.55, 0.65, 0.9], opacity: 0.08, glass: true }], lines = [], labels = [];
  const circle = (f) => Array.from({ length: 97 }, (_, i) => f((i * Math.PI) / 48));
  lines.push({ points: circle((t) => [Math.cos(t), 0, Math.sin(t)]), color: [1, 1, 1, 0.3], width: 1 }); // equator: linear states
  lines.push({ points: circle((t) => [Math.cos(t), Math.sin(t), 0]), color: [1, 1, 1, 0.14], width: 1 });
  lines.push({ points: circle((t) => [0, Math.sin(t), Math.cos(t)]), color: [1, 1, 1, 0.14], width: 1 });
  for (const [a, b, name, pos] of [[[-1.25, 0, 0], [1.25, 0, 0], 'S₁: H ↔ V', [1.45, 0, 0]], [[0, 0, -1.25], [0, 0, 1.25], 'S₂: ±45°', [0, 0, 1.45]], [[0, -1.25, 0], [0, 1.25, 0], 'S₃: circular', [0, 1.42, 0]]]) {
    lines.push({ points: [a, b], color: [1, 1, 1, 0.3], width: 1 });
    labels.push({ p: pos, text: name, color: 'rgba(255,255,255,0.7)' });
  }
  const P = states.map(toP);
  P.forEach((p, k) => {
    meshes.push({ mesh: sphere(0.065, p, 16, 8), color: COLS[k] });
    labels.push({ p: [p[0], p[1] + 0.16, p[2]], text: k ? N_('after {k}') : N_('input'), vars: { k }, color: `rgb(${COLS[k].map((c) => Math.round(c * 255)).join(',')})` });
    if (k) { // the path from the previous state, along the great circle when both are polarised
      const a = P[k - 1], la = Math.hypot(...a), lb = Math.hypot(...p);
      const pts = Array.from({ length: 41 }, (_, i) => {
        const t = i / 40, v = a.map((x, j) => x * (1 - t) + p[j] * t), L = Math.hypot(...v);
        const r = la * (1 - t) + lb * t; // radius = degree of polarisation, interpolated
        return L > 1e-9 && la > 1e-6 && lb > 1e-6 ? v.map((x) => (x / L) * r) : v;
      });
      lines.push({ points: pts, color: [...COLS[k], 0.85], width: 1.6 });
    }
  });
  return { meshes, lines, labels };
}
