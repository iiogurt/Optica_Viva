// 3-D scene for the gravitational-lensing laboratory (shown by js/lib/gl3d.js): the telescope, the
// lens plane with the lens galaxy and its critical curves, the source plane with the caustics and
// the background galaxy, the light paths of every image and the Einstein ring as a double cone.
// Along the line of sight the planes sit at their comoving distances (Gpc): in a flat universe
// light travels on straight lines in comoving coordinates and comoving distances add up, so the
// drawing is exact away from the thin lens. Across it, angles are exaggerated by ANGLE_SCALE
// (arcseconds over gigaparsecs would be invisible). Pure: no DOM.
import { angularDiameterDistance as DA } from './optics.js';
import { FOV, SFOV } from './lensing.js';
import { sphere, normalsFrom } from './mesh3d.js';

export const ANGLE_SCALE = 4e4;
const ARC = Math.PI / 648000;
const GOLD = [1, 0.71, 0.28], CYAN = [0.42, 0.84, 1], AMBER = [1, 0.62, 0.28], SRC = [0.55, 0.7, 1];
const RAYS = [[1, 0.85, 0.45], [0.55, 0.9, 1], [0.6, 1, 0.7], [1, 0.6, 0.75], [0.8, 0.7, 1]];

// Comoving distance (Gpc) to redshift z in flat ΛCDM: (1 + z) D_A.
export const comoving = (z) => ((1 + z) * DA(0, z)) / 1000;

// Sky angle (arcsec, x right as on the image panel) at comoving distance χ → scene point. The
// scene looks along +z, so sky x maps to −X for a reader standing at the telescope.
export const toScene = (x, y, chi) => [-x * ARC * ANGLE_SCALE * chi, y * ARC * ANGLE_SCALE * chi, chi];

function disc(c, r, n = 64) {
  const P = [c];
  for (let k = 0; k < n; k++) { const a = (k / n) * 2 * Math.PI; P.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]]); }
  const idx = [];
  for (let k = 1; k <= n; k++) idx.push(0, k === n ? 1 : k + 1, k);
  const positions = new Float32Array(P.flat()), indices = new Uint32Array(idx);
  return { positions, normals: new Float32Array(P.flatMap(() => [0, 0, -1])), indices };
}
// A cone from apex a to the circle `ring` (points), as triangles.
function cone(a, ring) {
  const positions = new Float32Array([a, ...ring].flat()), idx = [];
  for (let k = 1; k <= ring.length; k++) idx.push(0, k, k === ring.length ? 1 : k + 1);
  const indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), indices };
}
const circle = (r, chi, n = 96) => Array.from({ length: n }, (_, k) => [r * Math.cos((k / n) * 2 * Math.PI), r * Math.sin((k / n) * 2 * Math.PI), chi]);

// m = { P (lens model, arcsec), zl, zs, src: [x, y] (arcsec), R (source radius, arcsec),
//       images: [{ x, y, mu }], crit, caus: [[[x, y], [x, y]], …] (arcsec) }
export function lensingScene({ P, zl, zs, src, R, images = [], crit = [], caus = [] }) {
  const meshes = [], lines = [], labels = [];
  const cl = comoving(zl), cs = comoving(Math.max(zs, zl + 0.01)), g = (x) => x.toFixed(2) + ' Gpc';
  const k = ARC * ANGLE_SCALE;
  // the telescope and the line of sight
  meshes.push({ mesh: sphere(cs * 0.012, [0, 0, 0], 16, 8), color: [0.85, 0.87, 0.92] });
  labels.push({ p: [0, -cs * 0.04, -cs * 0.02], text: 'telescope', color: '#c9cfdc' });
  lines.push({ points: [[0, 0, 0], [0, 0, cs]], color: [1, 1, 1, 0.18], width: 1, glow: false });
  // lens plane: the field of the image panel, the lens galaxy (its mass ellipse) and the critical curves
  const rl = k * cl * FOV / 2;
  meshes.push({ mesh: disc([0, 0, cl], rl), color: [0.3, 0.34, 0.45], opacity: 0.12, glass: true });
  lines.push({ points: [...circle(rl, cl), circle(rl, cl)[0]], color: [1, 1, 1, 0.25], width: 1, glow: false });
  const gal = sphere(1, [0, 0, 0], 32, 16), q = P.model === 'sie' ? P.q : 1, a0 = 0.55 * k * cl, c = Math.cos(P.pa || 0), s = Math.sin(P.pa || 0);
  for (let i = 0; i < gal.positions.length; i += 3) {
    const u = gal.positions[i] * a0, v = gal.positions[i + 1] * a0 * q, x = c * u - s * v, y = s * u + c * v;
    gal.positions[i] = -x; gal.positions[i + 1] = y; gal.positions[i + 2] = cl + gal.positions[i + 2] * a0 * 0.6;
  }
  meshes.push({ mesh: gal, color: GOLD, opacity: 0.85 });
  labels.push({ p: [0, rl * 1.12, cl], text: 'lens galaxy, z = {z} ({d})', vars: { z: zl.toFixed(2), d: g(cl) }, color: '#ffb547' });
  for (const [a, b] of crit) lines.push({ points: [toScene(...a, cl), toScene(...b, cl)], color: [...CYAN, 0.8], width: 1.2, glow: false });
  // source plane: the source panel's field, the caustics and the background galaxy
  const rs = k * cs * SFOV / 2;
  meshes.push({ mesh: disc([0, 0, cs], rs), color: [0.3, 0.34, 0.45], opacity: 0.12, glass: true });
  lines.push({ points: [...circle(rs, cs), circle(rs, cs)[0]], color: [1, 1, 1, 0.25], width: 1, glow: false });
  for (const [a, b] of caus) if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.3) lines.push({ points: [toScene(...a, cs), toScene(...b, cs)], color: [...AMBER, 0.85], width: 1.2, glow: false });
  meshes.push({ mesh: disc(toScene(src[0], src[1], cs * 0.999), k * cs * R * 0.5), color: SRC, opacity: 0.85 });
  labels.push({ p: [0, rs * 1.08, cs], text: 'source galaxy, z = {z} ({d})', vars: { z: zs.toFixed(2), d: g(cs) }, color: '#9cc3ff' });
  // the Einstein ring: the cone of directions θ_E from the telescope, closing on the axis behind the lens
  const ring = circle(k * cl * P.b, cl, 72);
  meshes.push({ mesh: cone([0, 0, 0], ring), color: GOLD, opacity: 0.08, glass: true });
  meshes.push({ mesh: cone([0, 0, cs], ring), color: GOLD, opacity: 0.06, glass: true });
  lines.push({ points: [...ring, ring[0]], color: [...GOLD, 0.8], width: 1.4 });
  labels.push({ p: [0, -rl * 1.15, cl], text: 'Einstein ring θE = {b}″', vars: { b: P.b.toFixed(2) }, color: '#ffb547' });
  // every image: the light path telescope → lens plane → source, and where the image appears to be
  images.slice(0, RAYS.length).forEach((im, i) => {
    const L = toScene(im.x, im.y, cl), S = toScene(src[0], src[1], cs), col = RAYS[i];
    lines.push({ points: [[0, 0, 0], L, S], color: [...col, 0.95], width: 1 + Math.min(2, Math.log10(1 + Math.abs(im.mu))) });
    lines.push({ points: [L, toScene(im.x, im.y, cs)], color: [...col, 0.3], width: 1, glow: false });
    labels.push({ p: [L[0] * 1.25, L[1] * 1.25 + rl * 0.04, cl], text: `μ = ${im.mu.toFixed(1)}`, color: `rgb(${col.map((v) => Math.round(v * 255)).join(',')})` });
  });
  labels.push({ p: [0, -rs * 0.9, cs * 0.5], text: 'angles × {k}; distances comoving', vars: { k: ANGLE_SCALE.toLocaleString('en') }, color: 'rgba(255,255,255,0.55)' });
  return { meshes, lines, labels, frame: { centre: [0, 0, cs * 0.5], size: Math.hypot(cs, 2 * rs) * 1.2 } };
}

