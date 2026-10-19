// Surfaces for the 3-D views of wavefronts and point-spread functions: a wavefront W over the
// circular pupil (height ∝ W, diverging colours) and a PSF as a log-intensity relief (inferno),
// as meshes with per-vertex colours for js/lib/gl3d.js. Pure: no DOM.
import { lut } from './color.js';

const DIV = lut('diverging'), INF = lut('inferno');
const colourOf = (L, t) => { const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3; return [L[i] / 255, L[i + 1] / 255, L[i + 2] / 255]; };

// Bilinear sample of an n×n grid at fractional pixel (x, y).
function sample(G, n, x, y) {
  const x0 = Math.max(0, Math.min(n - 2, Math.floor(x))), y0 = Math.max(0, Math.min(n - 2, Math.floor(y))), fx = x - x0, fy = y - y0;
  return (G[y0 * n + x0] * (1 - fx) + G[y0 * n + x0 + 1] * fx) * (1 - fy) + (G[(y0 + 1) * n + x0] * (1 - fx) + G[(y0 + 1) * n + x0 + 1] * fx) * fy;
}

// A res×res grid of vertices over [−s, s]² in the x–z plane centred at (cx, 0, 0), with height y =
// h(u, v) and colour col(u, v) for u, v ∈ [−1, 1]; cells are kept where keep(u, v) holds at all
// four corners. Normals from central differences of the heights.
function grid(res, s, cx, h, col, keep = () => true) {
  const N = res + 1, positions = new Float32Array(N * N * 3), normals = new Float32Array(N * N * 3), colors = new Float32Array(N * N * 3), H = new Float32Array(N * N), idx = [];
  const U = (i) => -1 + (2 * i) / res;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = h(U(i), U(j));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, hh = (a, b) => H[Math.min(N - 1, Math.max(0, b)) * N + Math.min(N - 1, Math.max(0, a))];
    const dx = (hh(i + 1, j) - hh(i - 1, j)) / ((4 * s) / res), dz = (hh(i, j + 1) - hh(i, j - 1)) / ((4 * s) / res), L = Math.hypot(dx, 1, dz);
    positions.set([cx + U(i) * s, H[k], U(j) * s], k * 3);
    normals.set([-dx / L, 1 / L, -dz / L], k * 3);
    colors.set(col(U(i), U(j)), k * 3);
  }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    if (!(keep(U(i), U(j)) && keep(U(i + 1), U(j)) && keep(U(i), U(j + 1)) && keep(U(i + 1), U(j + 1)))) continue;
    const a = j * N + i, b = a + N;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, normals, colors, indices: new Uint32Array(idx) };
}

// Wavefront W (waves, n×n grid, pupil Dpx px across) over the unit pupil as a surface of half-size
// s, centred at x = cx; the largest |W| (at least ¼ wave) is drawn `height` high. A polar grid
// (rings × spokes) gives the pupil a smooth round rim.
export function wavefrontMesh(W, n, Dpx, { s = 1, cx = 0, height = 0.45, rings = 36, spokes = 120 } = {}) {
  // sample 1.5 px inside the rim, so the zeros outside the pupil do not leak into the edge
  const c = n / 2, r = Dpx / 2, k = 1 - 1.5 / r, at = (u, v) => sample(W, n, c + u * k * r - 0.5, c + v * k * r - 0.5);
  const N = (rings + 1) * spokes, positions = new Float32Array(N * 3), normals = new Float32Array(N * 3), colors = new Float32Array(N * 3), H = new Float32Array(N), idx = [];
  const uv = (i, j) => { const rho = i / rings, th = (2 * Math.PI * j) / spokes; return [rho * Math.cos(th), rho * Math.sin(th)]; };
  let wmax = 0.25;
  for (let i = 0; i <= rings; i++) for (let j = 0; j < spokes; j++) { const [u, v] = uv(i, j), w = at(u, v); H[i * spokes + j] = w; wmax = Math.max(wmax, Math.abs(w)); }
  // normals from the heights along the radius and around the ring
  for (let i = 0; i <= rings; i++) for (let j = 0; j < spokes; j++) {
    const q = i * spokes + j, [u, v] = uv(i, j), y = (H[q] / wmax) * height;
    const d = 1e-3, gu = (at(u + d, v) - at(u - d, v)) / (2 * d) / wmax * height / s, gv = (at(u, v + d) - at(u, v - d)) / (2 * d) / wmax * height / s;
    const L = Math.hypot(gu, 1, gv), t = H[q] / wmax;
    positions.set([cx + u * s, y, v * s], q * 3);
    normals.set([-gu / L, 1 / L, -gv / L], q * 3);
    colors.set(colourOf(DIV, 0.5 + 0.5 * Math.sign(t) * Math.sqrt(Math.abs(t))), q * 3);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < spokes; j++) {
    const a0 = i * spokes + j, a1 = i * spokes + ((j + 1) % spokes), b0 = a0 + spokes, b1 = a1 + spokes;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  return { mesh: { positions, normals, colors, indices: new Uint32Array(idx) }, wmax };
}

// PSF I (n×n, peak at the centre) as a relief of the central crop×crop pixels: height ∝ log₁₀ I
// over `decades` decades below the peak, half-size s, centred at x = cx. Coloured with inferno, or,
// given rgb = [R, G, B] (n×n each), with the image's own colour at that brightness.
export function psfMesh(I, n, { crop = 64, s = 1, cx = 0, height = 0.9, decades = 3.5, res = 96, rgb = null } = {}) {
  let mx = 0; for (let k = 0; k < I.length; k++) mx = Math.max(mx, I[k]);
  const c = n / 2, px = (u, v) => [c + (u * crop) / 2 - 0.5, c + (v * crop) / 2 - 0.5];
  const at = (u, v) => Math.max(0, 1 + Math.log10(sample(I, n, ...px(u, v)) / mx + 1e-12) / decades);
  const tint = rgb ? (u, v) => {
    // the hue fades into a dark floor where the light is faint (its ratio is noise there)
    const q = px(u, v), a = at(u, v), cc = rgb.map((G) => Math.max(0, sample(G, n, ...q))), m = Math.max(...cc, 1e-30), b = 0.2 + 1.1 * a, f = Math.min(1, a / 0.25);
    return cc.map((x) => Math.min(1, ((x / m) * f + 0.35 * (1 - f)) * b));
  } : (u, v) => colourOf(INF, 0.08 + 0.92 * at(u, v));
  return grid(res, s, cx, (u, v) => at(u, v) * height, tint);
}

// A circle of radius r in the x–z plane at height y, centred at x = cx (a polyline).
export const ring = (r, cx = 0, y = 0, k = 96) => Array.from({ length: k + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / k), y, r * Math.sin((2 * Math.PI * i) / k)]);
