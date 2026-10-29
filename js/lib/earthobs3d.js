// 3-D scene for the Earth-observation laboratory (shown by js/lib/gl3d.js), at true scale in
// thousands of kilometres: a 3 200 km patch of the curved Earth, the orbit arc at height H with the
// satellite, the ground track, the strip the push-broom camera has imaged in the last minute, the
// fan of view down to the swath and the detector line's footprint at nadir. Nadir is the origin, y
// points up, the satellite flies along +z. The satellite marker is enlarged; the Earth's rotation
// under the orbit (≤ 0.46 km/s, 28 km in a minute) is left out. Pure: no DOM.
import { RE } from './earthobs.js';
import { heightField, sphere, normalsFrom } from './mesh3d.js';

const R = RE / 1e6, A = 1.6; // Earth radius and the patch's half-width (Mm)
const GOLD = [1, 0.71, 0.28], CYAN = [0.42, 0.84, 1];

// A point at cross-track x and along-track angle φ (from nadir) on the sphere of radius r about
// the Earth's centre (0, −R, 0).
export function onSphere(x, phi, r = R) {
  const q = Math.sqrt(Math.max(0, r * r - x * x));
  return [x, q * Math.cos(phi) - R, q * Math.sin(phi)];
}

const km = (m) => (m >= 1e4 ? (m / 1000).toFixed(0) : (m / 1000).toPrecision(2)) + ' km';

// m = { H (m), gsd (m), v, ground (m/s), pixels (detector line length), T (s of imaging shown) }
export function earthobsScene({ H, gsd, v, ground, pixels = 12000, T = 60 }) {
  const meshes = [], lines = [], labels = [];
  const h = H / 1e6, sw = (gsd * pixels) / 1e6, L = (ground * T) / 1e6, phiS = L / R, lift = 0.0015;
  // the ground: a cap of the sphere, with a 400 km grid
  meshes.push({ mesh: heightField(65, 65, -A, A, -A, A, (x, z) => Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R), color: [0.16, 0.27, 0.24] });
  for (let g = -1.6; g <= 1.6001; g += 0.4) {
    const along = [], across = [];
    for (let t = -A; t <= A + 1e-9; t += 0.05) {
      along.push([g, Math.sqrt(R * R - g * g - t * t) - R + lift, t]);
      across.push([t, Math.sqrt(R * R - g * g - t * t) - R + lift, g]);
    }
    lines.push({ points: along, color: [1, 1, 1, 0.08], width: 1, glow: false }, { points: across, color: [1, 1, 1, 0.08], width: 1, glow: false });
  }
  // orbit arc and ground track
  const arc = (r, d) => Array.from({ length: 121 }, (_, i) => onSphere(0, ((i / 120 - 0.5) * 2 * A * 1.05) / R, r + d));
  lines.push({ points: arc(R + h, 0), color: [...CYAN, 0.8], width: 1.4 });
  lines.push({ points: arc(R, lift), color: [1, 1, 1, 0.35], width: 1, glow: false });
  labels.push({ p: onSphere(0, (0.85 * A) / R, R + h + 0.06), text: 'orbit', color: '#6ad7ff' }, { p: onSphere(0.12, (0.8 * A) / R, R), text: 'ground track', color: 'rgba(255,255,255,0.6)' });
  // the satellite (marker enlarged), its velocity and its height
  meshes.push({ mesh: sphere(0.022, [0, h, 0], 16, 8), color: [0.9, 0.92, 0.96] });
  lines.push({ points: [[0, h, 0], [0, h, 0.3]], color: [...CYAN, 1], width: 2 });
  labels.push({ p: [0, h + 0.07, 0.24], text: `${(v / 1000).toFixed(2)} km/s`, color: '#6ad7ff' });
  lines.push({ points: [[0, h, 0], [0, 0, 0]], color: [1, 1, 1, 0.25], width: 1, glow: false });
  labels.push({ p: [-0.05, h / 2, 0], text: 'height {h}', vars: { h: km(H) }, color: '#c9cfdc' });
  // the strip imaged in the last T seconds: a ribbon on the ground behind nadir, with its edges
  const n = 48, P = [], idx = [];
  for (let i = 0; i <= n; i++) { const phi = -phiS * (1 - i / n); P.push(onSphere(-sw / 2, phi, R + lift), onSphere(sw / 2, phi, R + lift)); }
  for (let i = 0; i < n; i++) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  const pos = new Float32Array(P.flat()), ind = new Uint32Array(idx);
  meshes.push({ mesh: { positions: pos, normals: normalsFrom(pos, ind), indices: ind }, color: GOLD, opacity: 0.55 });
  for (const side of [0, 1]) lines.push({ points: P.filter((_, k) => k % 2 === side), color: [...GOLD, 0.95], width: 1.4 });
  labels.push({ p: onSphere(sw / 2 + 0.3, -phiS, R), text: 'imaged in the last {T} s: {d}', vars: { T, d: km(ground * T) }, color: '#ffb547' });
  // the fan of view to the swath, and the detector line's footprint at nadir
  const l = onSphere(-sw / 2, 0, R + lift), r = onSphere(sw / 2, 0, R + lift);
  const fp = new Float32Array([[0, h, 0], l, r].flat()), fi = new Uint32Array([0, 1, 2]);
  meshes.push({ mesh: { positions: fp, normals: normalsFrom(fp, fi), indices: fi }, color: GOLD, opacity: 0.18, glass: true });
  lines.push({ points: [l, [0, h, 0], r], color: [...GOLD, 0.6], width: 1, glow: false });
  lines.push({ points: [l, r], color: [1, 1, 1, 1], width: 2.4 });
  labels.push({ p: onSphere(-sw / 2 - 0.42, 0.1 / R, R), text: 'swath {w}: {n} pixels × {gsd}', vars: { w: km(gsd * pixels), n: pixels.toLocaleString('en'), gsd: gsd < 1 ? (gsd * 100).toFixed(0) + ' cm' : gsd.toPrecision(3) + ' m' }, color: '#ffffff' });
  labels.push({ p: onSphere(-0.75 * A, (-0.35 * A) / R, R), text: 'true scale (satellite marker enlarged)', color: 'rgba(255,255,255,0.5)' });
  return { meshes, lines, labels, frame: { centre: [0, h * 0.3, -0.15], size: Math.hypot(1.6 * A, h) * 0.75 } };
}
