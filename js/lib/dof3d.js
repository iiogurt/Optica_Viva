// 3-D scene for the depth-of-field laboratory (shown by js/lib/gl3d.js): at true scale, in metres,
// the camera's view frustum (the same sensor, focal length, height and shifted framing as the
// simulated photograph), the plane of focus, the sharp zone between the near and far limits, the
// ground and the distance cards, each coloured by how sharp it is. Pure: no DOM.
import { blurDiameter } from './optics.js';
import { box, quad, normalsFrom } from './mesh3d.js';

// The photograph's layout, shared with js/modules/dof.js: cards at these distances (m) along a
// receding diagonal, a camera 0.45 m above the ground, the horizon 32 % down the frame (the
// sensor is shifted down, so verticals stay vertical).
export const CARDS = [0.7, 1, 1.5, 2.2, 3.3, 5, 8, 12, 20, 35];
export const cardAngle = (i) => (-9 + (i * 14) / (CARDS.length - 1)) * Math.PI / 180;
export const CAM_H = 0.45, HORIZON = 0.32;
const CARD_W = 0.12, CARD_H = 0.3;

const SHARP = [0.42, 0.89, 0.64], SOFT = [0.55, 0.3, 0.3], GOLD = [1, 0.71, 0.28];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// The frustum's cross-section at distance d (m) in front of the camera (scene: x right, y up, z
// forward, camera at the origin): corners [left-top, right-top, right-bottom, left-bottom].
export function section(sen, f, d) {
  const x = (d * sen.w) / (2 * f), yt = (d * HORIZON * sen.h) / f, yb = (-d * (1 - HORIZON) * sen.h) / f;
  return [[-x, yt, d], [x, yt, d], [x, yb, d], [-x, yb, d]];
}

// The part of the frustum between d0 and d1 as a closed solid (six quads).
function slab(sen, f, d0, d1) {
  const a = section(sen, f, d0), b = section(sen, f, d1), P = [...a, ...b];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const positions = new Float32Array(P.flat()), idx = [];
  for (const [p, q, r, s] of faces) idx.push(p, q, r, p, r, s);
  const indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), indices };
}
const outline = (pts) => [...pts, pts[0]];

// How far the scene reaches (m): 2.2 × the far limit (or the focus), at least 3 m, and at most
// 60 m unless the focus itself lies farther.
export const sceneDepth = (s, Df) => Math.max(3, Math.min(2.2 * (isFinite(Df) ? Math.max(Df, s) : s), Math.max(60, 1.3 * s)));

// m = { sen: { w, h } (mm), f (mm), N, s (mm), c (mm), Dn, Df (mm) }
export function dofScene({ sen, f, N, s, c, Dn, Df }) {
  const meshes = [], lines = [], labels = [];
  const S = s / 1000, Dnm = Dn / 1000, Dfm = Df / 1000, D = sceneDepth(S, Dfm), fm = f / 1000;
  const m = (x) => (x < 10 ? x.toFixed(2) : x.toFixed(1)) + ' m';
  // ground: a dark plane under the frustum, with a tick across it every metre (every 5 m far out)
  const W = section(sen, f, D)[1][0] * 1.15, y0 = -CAM_H;
  meshes.push({ mesh: quad([0, y0 - 0.002, D / 2], [1, 0, 0], [0, 0, 1], W, D / 2), color: [0.16, 0.2, 0.17], opacity: 0.85 });
  const step = D > 25 ? 5 : D > 8 ? 2 : 1;
  for (let z = step; z < D; z += step) {
    const half = (z * W) / D;
    lines.push({ points: [[-half, y0, z], [half, y0, z]], color: [1, 1, 1, 0.12], width: 1 });
    labels.push({ p: [half + 0.04 * D, y0, z], text: `${z} m`, color: 'rgba(255,255,255,0.45)' });
  }
  // camera: a small body with its lens towards +z (not to scale: a 35 mm body is ~0.14 m wide)
  meshes.push({ mesh: box([-0.07, -0.05, -0.08], [0.07, 0.05, -0.01], [0.22, 0.23, 0.26]), color: [0.22, 0.23, 0.26] });
  meshes.push({ mesh: box([-0.03, -0.03, -0.01], [0.03, 0.03, Math.max(0.02, Math.min(0.2, fm))], [0.12, 0.12, 0.14]), color: [0.12, 0.12, 0.14] });
  // frustum edges to the scene depth
  const far = section(sen, f, D);
  for (const p of far) lines.push({ points: [[0, 0, 0], p], color: [1, 1, 1, 0.28], width: 1 });
  lines.push({ points: outline(far), color: [1, 1, 1, 0.18], width: 1 });
  // sharp zone, near and far limits, and the plane of focus
  const zFar = Math.min(isFinite(Dfm) ? Dfm : Infinity, D);
  meshes.push({ mesh: slab(sen, f, Dnm, zFar), color: SHARP, opacity: 0.16, glass: true });
  lines.push({ points: outline(section(sen, f, Dnm)), color: [...SHARP, 0.9], width: 1.5 });
  if (isFinite(Dfm) && Dfm <= D) lines.push({ points: outline(section(sen, f, Dfm)), color: [...SHARP, 0.9], width: 1.5 });
  // a thin zone gets one label under its bottom edge; a deep one a label at each limit
  const below = (d) => { const q = section(sen, f, d); return [0, q[3][1] - 0.05 * d, d]; };
  if (zFar - Dnm < 0.15 * D) labels.push({ p: below((Dnm + zFar) / 2), text: `sharp ${m(Dnm)} – ${isFinite(Dfm) ? m(Dfm) : '∞'}`, color: '#6be3a4' });
  else {
    labels.push({ p: below(Dnm), text: `near limit ${m(Dnm)}`, color: '#6be3a4' });
    labels.push({ p: below(zFar), text: isFinite(Dfm) && Dfm <= D ? `far limit ${m(Dfm)}` : 'sharp to ∞', color: '#6be3a4' });
  }
  const fp = section(sen, f, S);
  meshes.push({ mesh: quad([0, (fp[0][1] + fp[3][1]) / 2, S], [1, 0, 0], [0, 1, 0], fp[1][0], (fp[0][1] - fp[3][1]) / 2), color: GOLD, opacity: 0.2, glass: true });
  lines.push({ points: outline(fp), color: [...GOLD, 0.95], width: 1.8 });
  labels.push({ p: [0, fp[0][1] + 0.04 * S, S], text: `focus ${m(S)}`, color: '#ffb547' });
  // cards (and the subject at the focus): green while the blur stays within c, then fading to a
  // dull red over three stops of blur
  const cards = CARDS.map((d, i) => ({ d, x: d * Math.tan(cardAngle(i)) }));
  cards.push({ d: S, x: S * Math.tan((2 * Math.PI) / 180), subject: true });
  for (const k of cards) {
    if (k.d > D || k.d * 1000 <= f * 1.2) continue;
    const b = blurDiameter(f, N, s, k.d * 1000), t = Math.min(1, Math.max(0, Math.log2(b / c) / 3));
    const col = k.subject ? GOLD : b <= c ? SHARP : mix(SHARP, SOFT, 0.35 + 0.65 * t);
    meshes.push({ mesh: box([k.x - CARD_W / 2, y0, k.d - 0.01], [k.x + CARD_W / 2, y0 + CARD_H, k.d + 0.01], col), color: col });
  }
  // aim at the frustum: wide lenses make it wider than deep
  const size = Math.hypot(2 * far[1][0], far[0][1] - far[3][1], D);
  return { meshes, lines, labels, frame: { centre: [0, (far[0][1] + far[3][1]) * 0.2, D * 0.45], size: size * 0.9 } };
}
