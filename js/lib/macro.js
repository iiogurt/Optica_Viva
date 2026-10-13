// Close-up and macro optics of a lens focused by extension (unit focusing), with pupil
// magnification m_p = D_exit / D_entrance. Distances in mm, magnifications as positive numbers
// (|m| of the real, inverted image).
//
//   object → entrance pupil      s  = f (1/m + 1/m_p)
//   exit pupil → image           s' = f (m + m_p)
//   working f-number             N_w = s' / D_XP = N (1 + m/m_p)
//   extension from ∞ focus       Δ  = f m
import { diskBlur } from './blur.js';

export function closeUp({ f, N, mp, m }) {
  const sEP = f * (1 / m + 1 / mp), sXP = f * (m + mp), Nw = N * (1 + m / mp);
  return { sEP, sXP, Nw, ext: f * m, evLoss: 2 * Math.log2(1 + m / mp), u: f * (1 + 1 / m) };
}

// Magnification of an object at distance s from the entrance pupil.
export const magAt = (f, mp, s) => 1 / (s / f - 1 / mp);

// Geometric blur diameter on the sensor (mm) of an object at distance s from the entrance pupil,
// for a lens focused at magnification m: the cone from the exit pupil (Ø m_p f/N) to the object's
// image, cut by the sensor plane.
export function blurAt({ f, N, mp, m }, s) {
  const mo = magAt(f, mp, s), dXP = (mp * f) / N;
  return (dXP * Math.abs(f * (m - mo))) / (f * (mo + mp));
}

// Total depth of field (object side) for a circle of confusion c (mm), valid when the subject is
// much closer than the hyperfocal distance: t = 2 N c (1 + m/m_p) / m².
export const macroDoF = ({ N, mp, m }, c) => (2 * N * c * (1 + m / mp)) / (m * m);

// Airy-disk diameter (to the first dark ring) on the sensor, mm; λ in nm.
export const airyDiameter = (Nw, lam = 550) => 2.44 * lam * 1e-6 * Nw;

// Aperture that minimises the RSS of the geometric blur of an object δ/2 from the focal plane
// (b = m² (δ/2)/N_w) and the Airy diameter (2.44 λ N_w): N_w,opt = √(m² δ / (2 · 2.44 λ)).
export const optimalNw = (m, depth, lam = 550) => Math.sqrt((m * m * depth) / (2 * 2.44 * lam * 1e-6));

// Frames needed to cover a depth range with steps of (1 − overlap) × DoF.
export const stackFrames = (range, dof, overlap = 0.2) => Math.max(1, Math.ceil(range / (dof * (1 - overlap))));

// Separable Gaussian with exact taps (radius 3σ, edge-clamped). The three-box approximation in
// blur.js is fine for large σ but has response zeros near a 3-px period when σ < 1 px, exactly
// where diffraction blur of fine bars matters.
export function gaussianExact(plane, w, h, sigma) {
  const R = Math.max(1, Math.ceil(3 * sigma)), k = new Float32Array(2 * R + 1);
  let sum = 0;
  for (let i = -R; i <= R; i++) sum += (k[i + R] = Math.exp((-0.5 * i * i) / (sigma * sigma)));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(plane.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -R; i <= R; i++) a += k[i + R] * plane[y * w + Math.min(w - 1, Math.max(0, x + i))];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -R; i <= R; i++) a += k[i + R] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
    plane[y * w + x] = a;
  }
  return plane;
}

// ── Test object: a steel ruler with a resolution strip ──────────────────────────────────────
// Seven-segment digits (unit cell 1 × 1.8) so that numbers need no canvas text in the worker.
const SEG = { 0: 0x3f, 1: 0x06, 2: 0x5b, 3: 0x4f, 4: 0x66, 5: 0x6d, 6: 0x7d, 7: 0x07, 8: 0x7f, 9: 0x6f };
function digitInk(d, x, y) {
  if (x < 0 || x > 1 || y < 0 || y > 1.8) return 0;
  const m = SEG[d], w = 0.2, inX = (a, b) => x >= a && x <= b, inY = (a, b) => y >= a && y <= b;
  return ((m & 1) && inY(0, w) && inX(0, 1)) || ((m & 2) && inX(1 - w, 1) && inY(0, 0.9)) || ((m & 4) && inX(1 - w, 1) && inY(0.9, 1.8))
    || ((m & 8) && inY(1.8 - w, 1.8) && inX(0, 1)) || ((m & 16) && inX(0, w) && inY(0.9, 1.8)) || ((m & 32) && inX(0, w) && inY(0, 0.9))
    || ((m & 64) && inY(0.9 - w / 2, 0.9 + w / 2) && inX(0, 1)) ? 1 : 0;
}
// Reflectance of the ruler at (u across, v along) in mm; v = 0 at the focus point.
// Across the ruler: graduations (−12 < u < −6), numbers every 10 mm, a strip of bar targets in
// 1-mm groups whose period halves every millimetre along v (0.8 mm … 25 µm at v = 0 … 6 µm),
// then brushed steel.
export function rulerInk(u, v) {
  if (u < -13 || u > 14) return 0.04;
  const INK = 0.06, PAPER = 0.82;
  if (u < -6) {
    const mm = Math.round(v), d = Math.abs(v - mm), len = mm % 10 === 0 ? 5.5 : mm % 5 === 0 ? 4 : 2.6;
    if (u > -12 && d < 0.06 && u < -12 + len) return INK;
    if (u > -12 && Math.abs(v * 2 - Math.round(v * 2)) < 0.1 && u < -12 + 1.5) return INK;
    return PAPER;
  }
  if (u < -2.4) {
    // label of the nearest centimetre: digits 1.1 mm wide on a 1.5 mm pitch, 2.4 mm tall
    const V = Math.round(v / 10), n = Math.abs(V), nd = n >= 10 ? 2 : 1, cw = 1.5, x = v - V * 10 + (nd * cw) / 2, k = Math.floor(x / cw);
    if (u > -5 && k >= 0 && k < nd) {
      const dig = nd === 2 && k === 0 ? Math.floor(n / 10) % 10 : n % 10;
      if (digitInk(dig, (x - k * cw) / 1.1, ((u + 5) / 2.4) * 1.8)) return INK;
    }
    return PAPER;
  }
  if (u < 0) return PAPER;
  if (u < 6) {
    // 1-mm groups centred on integer v: period 25 µm at v = 0, halving per mm towards +v
    const grp = Math.floor(v + 0.5), p = Math.max(0.006, Math.min(0.8, 0.025 * Math.pow(2, -grp)));
    const inGroup = Math.abs(v - grp) < 0.42;
    if (!inGroup) return PAPER;
    const ph = (((v / p) % 1) + 1) % 1;
    return ph < 0.5 ? INK : PAPER;
  }
  if (u < 7) return PAPER;
  // brushed steel: fine streaks along v
  const sv = Math.sin(u * 91.7 + Math.sin(u * 13.1) * 3) * 0.5 + 0.5;
  return 0.5 + 0.28 * sv * sv;
}

// Render the ruler, tilted by α about the horizontal line through the focus point, as seen by
// the sensor, with per-pixel geometric blur and diffraction. o = { f, N, mp, m, tilt (rad),
// W, H, mmPerPx (sensor), cx, cy (sensor centre of the view, mm), frames (focus stack),
// lam (nm) }. Each sensor pixel's chief ray (through the entrance pupil) is intersected with the
// ruler plane, so perspective is exact. Returns { img: Float32Array (W·H, reflectance), stats }.
export function renderRuler(o) {
  const { W, H, mmPerPx } = o, g = closeUp(o), SS = 2;
  const ta = Math.tan(o.tilt), ca = Math.cos(o.tilt);
  const src = new Float32Array(W * H), sDist = new Float32Array(W * H);
  let sMin = Infinity, sMax = -Infinity;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let acc = 0, sAcc = 0;
    for (let q = 0; q < SS * SS; q++) {
      const xs = o.cx + (i + (0.5 + (q % SS)) / SS - W / 2) * mmPerPx, ys = o.cy - (j + (0.5 + Math.floor(q / SS)) / SS - H / 2) * mmPerPx;
      // chief ray from the entrance pupil through the focal-plane point (−xs/m, −ys/m): the image is inverted
      const X = -xs / o.m, Y = -ys / o.m;
      // plane: z − s = Y_obj tan α (top of the ruler recedes); ray point t (X, Y, s)
      const den = g.sEP - Y * ta, t = den > 1e-6 ? g.sEP / den : 1e6;
      const xo = t * X, yo = t * Y, s = t * g.sEP;
      acc += rulerInk(xo, yo / ca);
      sAcc += s;
    }
    const k = j * W + i;
    src[k] = acc / (SS * SS);
    sDist[k] = sAcc / (SS * SS);
    if (sDist[k] < sMin) sMin = sDist[k];
    if (sDist[k] > sMax) sMax = sDist[k];
  }
  // focus stack: frames focused at evenly spaced distances across the visible depth; each pixel
  // keeps the frame in which it is sharpest (what stacking software selects)
  const nF = Math.max(1, o.frames | 0), foci = [];
  if (nF === 1) foci.push(o.m);
  else for (let q = 0; q < nF; q++) foci.push(magAt(o.f, o.mp, sMin + ((q + 0.5) / nF) * (sMax - sMin)));
  const rad = new Float32Array(W * H);
  let rMax = 0;
  for (let k = 0; k < W * H; k++) {
    let best = Infinity;
    for (const mf of foci) {
      // blur in a frame focused at mf, rescaled to the reference magnification (frames are aligned)
      const b = blurAt({ ...o, m: mf }, sDist[k]) * (o.m / mf);
      if (b < best) best = b;
    }
    rad[k] = best / (2 * mmPerPx);
    if (rad[k] > rMax) rMax = rad[k];
  }
  // blur stack of exact disk kernels, blended per pixel between neighbouring radii
  const levels = [0, 0.5, 1, 1.5, 2.2, 3.2, 4.5, 6.5, 9, 13, 18, 25, 36];
  const used = levels.filter((r, i) => i === 0 || levels[i - 1] < rMax);
  const stack = used.map((r) => {
    if (r === 0) return src;
    return diskBlur(Float32Array.from(src), W, H, r);
  });
  const out = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const r = Math.min(rad[k], used[used.length - 1]);
    let li = 0;
    while (li < used.length - 2 && used[li + 1] < r) li++;
    const a = used[li], b = used[Math.min(li + 1, used.length - 1)], t = b > a ? Math.min(1, Math.max(0, (r - a) / (b - a))) : 0;
    out[k] = stack[li][k] * (1 - t) + stack[Math.min(li + 1, used.length - 1)][k] * t;
  }
  // diffraction: Airy core approximated by a Gaussian of σ = 0.42 λ N_w (same FWHM)
  const sig = (0.42 * (o.lam || 550) * 1e-6 * g.Nw) / mmPerPx;
  if (sig > 0.15) gaussianExact(out, W, H, sig);
  return { img: out, W, H, stats: { sMin, sMax, depth: sMax - sMin, rMax, sigma: sig, foci: foci.length } };
}
