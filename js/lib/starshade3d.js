// 3-D scene for the starshade laboratory (shown by js/lib/gl3d.js): the telescope and the
// starshade tens of thousands of kilometres apart, the starlight passing beside the starshade, the
// geometric shadow, the line of sight to a planet at the inner working angle, and the computed
// shadow on the telescope's plane (log intensity) with the pupil in it. Along the line of sight the
// scene is to scale in thousands of kilometres; across it everything is enlarged by one factor E
// (a 50 m starshade 80 000 km away would otherwise be invisible), so angles are enlarged by E too.
// The telescope sits at the origin looking along +z. Pure: no DOM.
import { OCCULTERS } from './starshade.js';
import { colormap } from './color.js';
import { normalsFrom } from './mesh3d.js';

const CYAN = [0.42, 0.84, 1];

// The enlargement across the line of sight: a round 1, 2 or 5 × 10ⁿ that makes the starshade's
// radius about 12 % of its distance.
export function enlargement(Rt, z) {
  const want = (0.12 * z) / Rt, p = 10 ** Math.floor(Math.log10(want));
  return [1, 2, 5, 10].map((m) => m * p).reduce((a, b) => (Math.abs(Math.log(b / want)) < Math.abs(Math.log(a / want)) ? b : a));
}

// The starshade's outline (metres, in its plane) for N petals of the profile A(r): each petal is
// π A(r)/N wide either side of its axis; the outline is star-shaped about the centre.
export function outline(o, N, steps = 40) {
  const occ = OCCULTERS.hyper, Rm = occ.Rmax(o), pts = [];
  for (let k = 0; k < N; k++) {
    const ax = (2 * Math.PI * k) / N;
    for (let i = 0; i <= steps; i++) { const r = o.a + ((Rm - o.a) * i) / steps, hf = (Math.PI * occ.A(r, o)) / N; pts.push([r * Math.cos(ax - hf), r * Math.sin(ax - hf)]); }
    for (let i = steps; i >= 0; i--) { const r = o.a + ((Rm - o.a) * i) / steps, hf = (Math.PI * occ.A(r, o)) / N; pts.push([r * Math.cos(ax + hf), r * Math.sin(ax + hf)]); }
  }
  return pts;
}

function fan(c, ring, z, colors = null) {
  const P = [c, ...ring].map(([x, y]) => [x, y, z]), idx = [];
  for (let k = 1; k <= ring.length; k++) idx.push(0, k, k === ring.length ? 1 : k + 1);
  const positions = new Float32Array(P.flat()), indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), indices, ...(colors ? { colors } : {}) };
}
const circle = (r, z, n = 96) => Array.from({ length: n + 1 }, (_, k) => [r * Math.cos((k / n) * 2 * Math.PI), r * Math.sin((k / n) * 2 * Math.PI), z]);

// m = { a, b, n (profile), N (petals), z (m), D (m), lamNm, rhos (m), prof (intensity at rhos) }
export function starshadeScene({ a, b, n, N, z, D, lamNm, rhos = [], prof = [] }) {
  const meshes = [], lines = [], labels = [];
  const Rt = a + b, Rm = OCCULTERS.hyper.Rmax({ a, b, n }), E = enlargement(Rt, z), s = E / 1e6, Z = z / 1e6;
  // the starshade at z, enlarged across
  meshes.push({ mesh: fan([0, 0], outline({ a, b, n }, N).map(([x, y]) => [x * s, y * s]), Z), color: [0.82, 0.86, 0.94] });
  labels.push({ p: [0, Rm * s * 1.25, Z], text: `starshade, ${(2 * Rm).toFixed(0)} m tip to tip`, color: '#dfe6f2' });
  // starlight from beyond the starshade, parallel to the axis: grazing past it, and its geometric shadow
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * 2 * Math.PI, r = Rm * s * 1.12;
    lines.push({ points: [[r * Math.cos(t), r * Math.sin(t), Z * 1.3], [r * Math.cos(t), r * Math.sin(t), 0]], color: [1, 0.95, 0.75, 0.35], width: 1, glow: false });
  }
  labels.push({ p: [0, Rm * s * 1.3, Z * 1.3], text: 'starlight', color: '#fff2c4' });
  const tube = circle(Rt * s, 0, 64), tubeIdx = [], tubePos = [];
  for (const [x, y] of tube) tubePos.push([x, y, 0], [x, y, Z]);
  for (let k = 0; k < 64; k++) tubeIdx.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
  const tp = new Float32Array(tubePos.flat()), ti = new Uint32Array(tubeIdx);
  meshes.push({ mesh: { positions: tp, normals: normalsFrom(tp, ti), indices: ti }, color: [0.3, 0.34, 0.45], opacity: 0.08, glass: true });
  // the line of sight to a planet at the inner working angle, just past the tips
  lines.push({ points: [[0, 0, 0], [Rt * s * 1.3, 0, Z * 1.3]], color: [...CYAN, 0.85], width: 1.5 });
  labels.push({ p: [Rt * s * 1.25, -Rt * s * 0.25, Z * 1.1], text: `planet at the inner working angle, ${((Rt / z) * 206264806).toFixed(0)} mas`, color: '#6ad7ff' });
  lines.push({ points: [[0, 0, 0], [0, 0, Z]], color: [1, 1, 1, 0.3], width: 1, glow: false });
  labels.push({ p: [-Rm * s * 1.5, 0, Z / 2], text: `${(z / 1e3).toLocaleString('en')} km`, color: '#c9cfdc' });
  // the shadow on the telescope's plane: log intensity on rings out to rhos' end, and the pupil
  if (rhos.length > 1) {
    const seg = 72, P = [], C = [], idx = [];
    const col = (v) => colormap('inferno', Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-16)) + 14) / 14)));
    rhos.forEach((r, i) => {
      for (let j = 0; j <= seg; j++) { const t = (j / seg) * 2 * Math.PI; P.push(r * s * Math.cos(t), r * s * Math.sin(t), 0); C.push(...col(prof[i])); }
    });
    for (let i = 0; i < rhos.length - 1; i++) for (let j = 0; j < seg; j++) { const p = i * (seg + 1) + j, q = p + seg + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
    const pos = new Float32Array(P), ind = new Uint32Array(idx);
    meshes.push({ mesh: { positions: pos, normals: new Float32Array(P.length).map((_, k) => (k % 3 === 2 ? -1 : 0)), indices: ind, colors: new Float32Array(C) }, color: [1, 1, 1] });
    labels.push({ p: [0, -rhos[rhos.length - 1] * s * 1.4, 0], text: `shadow at ${lamNm} nm (log intensity, 10⁻¹⁴ … 1)`, color: '#ffb547' });
  }
  lines.push({ points: circle((D / 2) * s, -Z * 0.002), color: [1, 1, 1, 0.95], width: 1.6 });
  labels.push({ p: [(D / 2) * s * 1.6, (D / 2) * s * 1.6, 0], text: `telescope, ${D} m`, color: '#ffffff' });
  labels.push({ p: [0, Rm * s * 1.6, Z / 2], text: `across the line of sight × ${E.toLocaleString('en')}`, color: 'rgba(255,255,255,0.55)' });
  return { meshes, lines, labels, frame: { centre: [0, 0, Z * 0.6], size: Z * 1.35 }, E };
}
