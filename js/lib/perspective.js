// The perspective laboratory's portrait scene (head, shoulders, pillars, back wall), ray-cast as a
// pure function so that row bands can be rendered by the compute workers.

// ── a portrait scene: head with nose, eyes and ears; shoulders; pillars; back wall ───────
const SPH = [
  { c: [0, 1.6, 0], r: 0.11, col: [228, 182, 150] },          // head
  { c: [0, 1.585, -0.108], r: 0.028, col: [222, 168, 138] },  // nose
  { c: [-0.112, 1.6, 0.01], r: 0.034, col: [214, 160, 130] }, // ears
  { c: [0.112, 1.6, 0.01], r: 0.034, col: [214, 160, 130] },
  { c: [-0.04, 1.63, -0.093], r: 0.013, col: [30, 30, 40] },  // eyes
  { c: [0.04, 1.63, -0.093], r: 0.013, col: [30, 30, 40] },
  { c: [0, 1.73, 0.02], r: 0.095, col: [60, 40, 30] },        // hair
];
export const BOX = [
  { a: [-0.22, 0.9, -0.12], b: [0.22, 1.44, 0.12], col: [70, 90, 140] }, // shoulders
  ...[4, 8, 12, 16].flatMap((z) => [-1.6, 1.6].map((x) => ({ a: [x - 0.25, 0, z - 0.25], b: [x + 0.25, 3.2, z + 0.25], col: [200, 190, 170] }))),
];
export function trace(o, d) {
  let best = Infinity, col = null, nrm = null;
  for (const s of SPH) {
    const ox = o[0] - s.c[0], oy = o[1] - s.c[1], oz = o[2] - s.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - s.r * s.r, disc = b * b - c;
    if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < best) { best = t; col = s.col; nrm = [(ox + t * d[0]) / s.r, (oy + t * d[1]) / s.r, (oz + t * d[2]) / s.r]; } }
  }
  for (const B of BOX) {
    let t0 = -Infinity, t1 = Infinity, ax = -1;
    for (let k = 0; k < 3; k++) {
      const inv = 1 / d[k]; let ta = (B.a[k] - o[k]) * inv, tb = (B.b[k] - o[k]) * inv;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; ax = k; }
      t1 = Math.min(t1, tb);
    }
    if (t0 < t1 && t0 > 0 && t0 < best) { best = t0; col = B.col; nrm = [0, 0, 0]; nrm[ax] = -Math.sign(d[ax]); }
  }
  // back wall z = 30 and ground y = 0
  if (d[2] > 0) { const t = (30 - o[2]) / d[2]; if (t < best) { const p = [o[0] + t * d[0], o[1] + t * d[1]]; const g = (Math.floor(p[0]) + Math.floor(p[1])) & 1; best = t; col = g ? [120, 130, 150] : [105, 115, 135]; nrm = [0, 0, -1]; } }
  if (d[1] < 0) { const t = -o[1] / d[1]; if (t < best) { const x = o[0] + t * d[0], z = o[2] + t * d[2]; const g = (Math.floor(x) + Math.floor(z)) & 1; best = t; col = g ? [150, 140, 120] : [95, 90, 80]; nrm = [0, 1, 0]; } }
  if (!col) return [30, 34, 48];
  const L = [-0.4, 0.7, -0.6], ln = Math.hypot(...L);
  const sh = 0.35 + 0.65 * Math.max(0, (nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]) / ln);
  return col.map((c) => c * sh);
}

// Rows [y0, y1) of a W×H view of a 36 × 24 mm sensor with focal length F (mm) from a camera
// at distance d (m) in front of the face, 2×2 supersampled; RGBA bytes.
export function perspectiveRows({ d: dist, F, W, H }, y0, y1) {
  const out = new Uint8ClampedArray((y1 - y0) * W * 4), o = [0, 1.6, -dist];
  for (let j = y0; j < y1; j++) for (let i = 0; i < W; i++) {
    let c = [0, 0, 0];
    for (let s = 0; s < 4; s++) {
      const x = ((i + (s & 1 ? 0.75 : 0.25)) / W - 0.5) * 36, y = (0.5 - (j + (s & 2 ? 0.75 : 0.25)) / H) * 24;
      const d = [x, y, F], L = Math.hypot(...d);
      const r = trace(o, [d[0] / L, d[1] / L, d[2] / L]);
      c = [c[0] + r[0] / 4, c[1] + r[1] / 4, c[2] + r[2] / 4];
    }
    const k = ((j - y0) * W + i) * 4; out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = 255;
  }
  return out;
}
