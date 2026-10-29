// 3-D scene for the transit laboratory (shown by js/lib/gl3d.js), at true scale in stellar radii:
// the star, the planet's circular orbit tilted by the inclination, the cylinder of sight lines that
// pass through the star on their way to the telescope, the part of the orbit where the planet
// crosses it (the transit chord), and the impact parameter b at mid-transit. The telescope lies far
// away along −z. Pure: no DOM.
import { lathe, sphere } from './mesh3d.js';
import { N_ } from './i18n.js';

const STAR = [1, 0.86, 0.6], CYAN = [0.42, 0.84, 1], GOLD = [1, 0.71, 0.28];

// The planet at orbital phase φ (rad, 0 = mid-transit) for a/R★ = aR and inclination inc: its
// projection on the sky is (x, y), z its depth (negative: in front of the star).
export const planetAt = (phi, aR, inc) => [aR * Math.sin(phi), aR * Math.cos(inc) * Math.cos(phi), -aR * Math.sin(inc) * Math.cos(phi)];

// m = { aR, inc (rad), k (Rp/R★), b, name }
export function transitScene({ aR, inc, k, b, name = '' }) {
  const meshes = [], lines = [], labels = [];
  // the star, and the cylinder of sight lines through it towards the telescope (−z)
  meshes.push({ mesh: sphere(1, [0, 0, 0], 48, 24), color: STAR });
  labels.push({ p: [0, 1.25, 0], text: name ? N_('star ({name})') : N_('star'), vars: { name }, color: '#ffd28a' });
  const L = aR * 1.35;
  meshes.push({ mesh: lathe([[1, 0], [1, -L]], 64), color: [0.9, 0.85, 0.7], opacity: 0.07, glass: true });
  lines.push({ points: [[0, 0, 0], [0, 0, -L * 1.1]], color: [1, 1, 1, 0.35], width: 1, glow: false });
  labels.push({ p: [0, -0.4, -L * 1.1], text: 'to the telescope', color: '#c9cfdc' });
  // the orbit: the half behind the star dimmer, the transit chord (projected distance < 1 + k, in
  // front of the star) in gold
  const n = 720, back = [], front = [], chord = [];
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * 2 * Math.PI - Math.PI / 2, p = planetAt(phi, aR, inc); // front half first, then back
    (i <= n / 2 ? front : back).push(p);
    if (p[2] < 0 && Math.hypot(p[0], p[1]) < 1 + k) chord.push(p);
  }
  lines.push({ points: back, color: [...CYAN, 0.3], width: 1, glow: false });
  lines.push({ points: front, color: [...CYAN, 0.75], width: 1.3 });
  if (chord.length > 1) lines.push({ points: chord, color: [...GOLD, 1], width: 2.4 });
  labels.push({ p: planetAt(Math.PI / 2, aR, inc).map((x, i) => (i === 1 ? x + aR * 0.06 : x)), text: 'orbit, a = {a} R★, i = {i}°', vars: { a: aR < 20 ? aR.toFixed(1) : aR.toFixed(0), i: ((inc * 180) / Math.PI).toFixed(1) }, color: '#6ad7ff' });
  // the planet at mid-transit and the impact parameter: its distance from the star's centre on the sky
  const P0 = planetAt(0, aR, inc);
  meshes.push({ mesh: sphere(Math.max(k, 1e-3), P0, 24, 12), color: [0.55, 0.62, 0.75] });
  lines.push({ points: [[0, 0, P0[2]], P0], color: [1, 1, 1, 0.9], width: 1.5 });
  labels.push({ p: [aR * 0.04 + k, P0[1] / 2, P0[2]], text: `b = ${b.toFixed(2)} R★`, color: '#ffffff' });
  labels.push({ p: [0, -1.3 - k, P0[2]], text: chord.length > 1 ? N_('transit: the planet crosses the star') : N_('no transit: the planet misses the star'), color: chord.length > 1 ? '#ffb547' : '#ff8a8a' });
  return { meshes, lines, labels, frame: { centre: [0, 0, -aR * 0.3], size: aR * 2.4 + 3 } };
}
