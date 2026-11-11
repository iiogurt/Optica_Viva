// Image pipeline: pictures computed on a grid are drawn at the canvas's device pixels, not
// stretched by the browser. Each device pixel samples the field itself (Catmull–Rom or bilinear),
// passes through one tone curve with a soft toe instead of a hard black cut, is encoded to sRGB
// through a table and is dithered before the 8-bit rounding, so smooth gradients show no bands.
// A large picture is drawn first at half resolution and refined when the input has settled.
import { oetf } from './color.js';

// Catmull–Rom sample of a w×h field at (x, y) in pixel-centre coordinates (pixel i spans
// [i − ½, i + ½]); edges are clamped.
export function catmull(a, w, h, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const wx0 = ((-0.5 * fx + 1) * fx - 0.5) * fx, wx1 = (1.5 * fx - 2.5) * fx * fx + 1, wx2 = ((-1.5 * fx + 2) * fx + 0.5) * fx, wx3 = (0.5 * fx - 0.5) * fx * fx;
  const wy0 = ((-0.5 * fy + 1) * fy - 0.5) * fy, wy1 = (1.5 * fy - 2.5) * fy * fy + 1, wy2 = ((-1.5 * fy + 2) * fy + 0.5) * fy, wy3 = (0.5 * fy - 0.5) * fy * fy;
  const W = w - 1, H = h - 1;
  const x0 = xi - 1 < 0 ? 0 : xi - 1 > W ? W : xi - 1, x1 = xi < 0 ? 0 : xi > W ? W : xi, x2 = xi + 1 < 0 ? 0 : xi + 1 > W ? W : xi + 1, x3 = xi + 2 < 0 ? 0 : xi + 2 > W ? W : xi + 2;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    const yy = yi - 1 + k, r = (yy < 0 ? 0 : yy > H ? H : yy) * w, wy = k === 0 ? wy0 : k === 1 ? wy1 : k === 2 ? wy2 : wy3;
    s += wy * (wx0 * a[r + x0] + wx1 * a[r + x1] + wx2 * a[r + x2] + wx3 * a[r + x3]);
  }
  return s;
}

// Bilinear sample, same conventions.
export function bilinear(a, w, h, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, W = w - 1, H = h - 1;
  const x0 = xi < 0 ? 0 : xi > W ? W : xi, x1 = xi + 1 < 0 ? 0 : xi + 1 > W ? W : xi + 1;
  const r0 = (yi < 0 ? 0 : yi > H ? H : yi) * w, r1 = (yi + 1 < 0 ? 0 : yi + 1 > H ? H : yi + 1) * w;
  return (a[r0 + x0] * (1 - fx) + a[r0 + x1] * fx) * (1 - fy) + (a[r1 + x0] * (1 - fx) + a[r1 + x1] * fx) * fy;
}

// The tone curve's toe: t below −k is black, above k unchanged, and in between a parabola that
// meets both with matching slope, so a display floor fades out instead of ending in a hard edge.
export const toe = (t, k = 0.06) => (t >= k ? t : t <= -k ? 0 : ((t + k) * (t + k)) / (4 * k));

// sRGB encoding of a linear value in [0, 1] through a table (8192 steps: under ½ of an 8-bit step).
const ENC = Float32Array.from({ length: 8193 }, (_, i) => oetf(i / 8192));
export const encode = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : ENC[(v * 8192 + 0.5) | 0]);

// Interleaved gradient noise (Jimenez 2014), in [0, 1): a cheap dither pattern without visible
// structure, used to break up 8-bit steps.
export const ign = (x, y) => { const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1); return v - Math.floor(v); };

// Fill rows j0…j1 of an RGBA byte buffer of w×h pixels: shade(u, v, out) writes display-encoded
// [r, g, b] in [0, 1] for the centre (u, v) ∈ [0, 1)² of each pixel (out starts black). Dithered
// by ±½ step.
export function renderInto(d, w, h, shade, j0 = 0, j1 = h) {
  const out = [0, 0, 0];
  for (let j = j0; j < j1; j++) {
    const v = (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      out[0] = out[1] = out[2] = 0;
      shade((i + 0.5) / w, v, out);
      const n = ign(i, j) - 0.5, o = (j * w + i) * 4;
      d[o] = out[0] * 255 + n; d[o + 1] = out[1] * 255 + n; d[o + 2] = out[2] * 255 + n; d[o + 3] = 255;
    }
  }
}

// Draw shade() into the rectangle rect = { x, y, w, h } (CSS pixels) of a stage at its device
// pixels. key names what is drawn: the finished picture is kept and reused while key and size stay
// the same. A picture larger than QUICK device pixels is drawn first at half resolution; REFINE ms
// after the last change the full picture is computed in slices of about SLICE ms, so input stays
// responsive, and shown when complete.
const QUICK = 160000, REFINE = 90, SLICE = 12;
const cache = new WeakMap();
export function paint(st, rect, shade, key) {
  const { ctx, dpr } = st;
  const dx = Math.round(rect.x * dpr), dy = Math.round(rect.y * dpr);
  const dw = Math.max(1, Math.round(rect.w * dpr)), dh = Math.max(1, Math.round(rect.h * dpr));
  const k = `${key}|${dw}x${dh}`;
  let c = cache.get(st);
  if (!c) cache.set(st, (c = { k: null, img: null, timer: 0, job: 0 }));
  if (c.k === k && c.img) { ctx.putImageData(c.img, dx, dy); return; }
  clearTimeout(c.timer);
  const job = ++c.job;
  if (dw * dh <= QUICK) {
    const img = new ImageData(dw, dh);
    renderInto(img.data, dw, dh, shade);
    c.k = k; c.img = img;
    ctx.putImageData(img, dx, dy);
    return;
  }
  const pw = Math.ceil(dw / 2), ph = Math.ceil(dh / 2), off = document.createElement('canvas');
  off.width = pw; off.height = ph;
  const oc = off.getContext('2d'), small = oc.createImageData(pw, ph);
  renderInto(small.data, pw, ph, shade);
  oc.putImageData(small, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
  const img = new ImageData(dw, dh);
  let row = 0;
  const step = () => {
    if (job !== c.job || !st.canvas.isConnected) return;
    const t0 = performance.now();
    while (row < dh && performance.now() - t0 < SLICE) { const j1 = Math.min(dh, row + 8); renderInto(img.data, dw, dh, shade, row, j1); row = j1; }
    if (row < dh) { c.timer = setTimeout(step, 0); return; }
    c.k = k; c.img = img;
    st.redraw();
  };
  c.timer = setTimeout(step, REFINE);
}
