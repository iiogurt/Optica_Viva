// Stereoscopic 3-D: two cameras, a screen and two eyes. Pure functions; lengths in metres unless
// stated (focal length and sensor in millimetres).
//
// Two parallel cameras b apart (the interaxial), lens focal length f, converged on the distance C by
// shifting their sensors, film a point at distance Z with a horizontal offset between the two
// pictures of d = f·b·(1/C − 1/Z) on the sensor. Shown on a screen M times wider than the sensor, the
// offset becomes the screen parallax P = M·d: zero at the convergence distance (on the screen),
// positive behind it, negative in front. A viewer at distance V with eyes e apart fuses the two
// images where the lines of sight cross: Z_p = V·e/(e − P). As P approaches e the point recedes to
// infinity; beyond it the eyes would have to diverge.
//
// The shape of what is seen: a small object at distance Z appears with its width scaled by
// k_w = M·f·Z_p/(Z·V) (its image on the screen, seen at Z_p) and its depth by k_d = dZ_p/dZ. Their
// ratio, the roundness, is 1 for a natural look; below 1 objects look like flat cut-outs
// ("cardboarding"), and when the whole scene is shrunk (k_w small) it looks like a model
// ("puppet theatre").

export const E = 0.065; // m, eye separation
// rig = { b (m), f (mm), s (sensor width, mm), C (m) }; view = { S (screen width, m), V (m) }.
// The offset on the sensor (mm) and on the screen (m), M = S/s being the magnification.
export const sensorParallax = (rig, Z) => rig.f * rig.b * (1 / rig.C - 1 / Z);
export const screenParallax = (rig, view, Z) => (sensorParallax(rig, Z) * view.S) / rig.s;
// Perceived distance (m) of a point with screen parallax P for a viewer at V (Infinity at or beyond divergence).
export const perceived = (P, V, e = E) => (P >= e ? Infinity : (V * e) / (e - P));
// Width scale, depth scale and roundness at distance Z.
export function shape(rig, view, Z) {
  const P = screenParallax(rig, view, Z), Zp = perceived(P, view.V);
  const kw = ((view.S / rig.s) * rig.f * Zp) / (Z * view.V);
  const dZ = Z * 1e-4, kd = (perceived(screenParallax(rig, view, Z + dZ), view.V) - perceived(screenParallax(rig, view, Z - dZ), view.V)) / (2 * dZ);
  return { P, Zp, kw, kd, round: kd / kw };
}
// The orthostereoscopic rig for a viewer: interaxial e, a field of view equal to the screen's from the
// seat (f/s = V/S) and convergence at the screen distance. Every point then appears where it was.
export const orthoRig = (view, s = 24.89) => ({ b: E, f: (s * view.V) / view.S, s, C: view.V });

// A small scene for the two cameras: spheres along a checkered ground and a wall far behind.
export const SPHERES = [
  { c: [-0.55, 0.45, 2.2], r: 0.45, col: [0.85, 0.3, 0.2] },
  { c: [0.9, 0.5, 4], r: 0.5, col: [0.25, 0.65, 0.9] },
  { c: [-1.4, 0.6, 7], r: 0.6, col: [0.95, 0.8, 0.25] },
  { c: [1.9, 0.7, 12], r: 0.7, col: [0.4, 0.85, 0.45] },
  { c: [-2.8, 1, 25], r: 1, col: [0.8, 0.45, 0.85] },
];
function trace(o, d) {
  let best = Infinity, col = null, n = null;
  for (const s of SPHERES) {
    const ox = o[0] - s.c[0], oy = o[1] - s.c[1], oz = o[2] - s.c[2], b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - s.r * s.r, D = b * b - c;
    if (D > 0) { const t = -b - Math.sqrt(D); if (t > 0 && t < best) { best = t; col = s.col; n = [(ox + t * d[0]) / s.r, (oy + t * d[1]) / s.r, (oz + t * d[2]) / s.r]; } }
  }
  if (d[1] < 0) { const t = -o[1] / d[1]; if (t < best) { const x = o[0] + t * d[0], z = o[2] + t * d[2]; if (z < 60) { const g = (Math.floor(x) + Math.floor(z)) & 1; best = t; col = g ? [0.75, 0.75, 0.72] : [0.35, 0.35, 0.34]; n = [0, 1, 0]; } } }
  if (d[2] > 0) { const t = (60 - o[2]) / d[2]; if (t < best) { best = t; col = [0.55, 0.6, 0.7]; n = [0, 0, -1]; } }
  if (!col) return [0.6, 0.72, 0.9];
  const L = [0.4, 0.8, -0.45], ln = Math.hypot(...L), sh = 0.3 + 0.7 * Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / ln);
  return col.map((c) => c * sh);
}
// One eye's picture (W × H, linear RGB planes): a camera at x = side·b/2 (side = −1 left, +1 right),
// 1.4 m up, looking along +z, its sensor shifted by side·f·(b/2)/C so that the plane at C falls on the
// same place in both pictures (horizontal image translation).
export function render(rig, side, W, H) {
  const out = [0, 1, 2].map(() => new Float32Array(W * H)), hs = rig.s * (H / W), ox = (side * rig.b) / 2, shift = (rig.f * ox) / rig.C;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) / W - 0.5) * rig.s - shift, y = (0.5 - (j + 0.5) / H) * hs;
    const L = Math.hypot(x, y, rig.f), c = trace([ox, 1.4, 0], [x / L, y / L, rig.f / L]), k = j * W + i;
    out[0][k] = c[0]; out[1][k] = c[1]; out[2][k] = c[2];
  }
  return out;
}
