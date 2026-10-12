// Gaussian blur without CanvasRenderingContext2D.filter (disabled in Safari).
// Three successive box blurs approximate a Gaussian of standard deviation σ
// (central limit theorem; box widths from Kovesi 2010), each pass O(1) per pixel
// via a running sum. Alpha is handled by premultiplication so edges stay clean.

// Box widths whose three-fold convolution has variance σ².
export function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

// one horizontal and one vertical running-sum box pass of radius r (edge-clamped)
function boxPass(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += dst[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * k;
      acc += dst[Math.min(h - 1, y + r + 1) * w + x] - dst[Math.max(0, y - r) * w + x];
    }
  }
}

// Blur a single Float32Array plane in place.
export function gaussianBlurPlane(plane, w, h, sigma) {
  if (sigma < 0.3) return plane;
  const tmp = new Float32Array(plane.length);
  for (const b of boxesForGauss(sigma)) boxPass(plane, tmp, w, h, (b - 1) >> 1);
  return plane;
}

// Blur RGBA bytes (ImageData.data); returns a new Uint8ClampedArray.
export function gaussianBlurRGBA(data, w, h, sigma) {
  const n = w * h, out = new Uint8ClampedArray(data.length);
  if (sigma < 0.3) { out.set(data); return out; }
  const A = new Float32Array(n), C = [0, 1, 2].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255; A[i] = a;
    for (let c = 0; c < 3; c++) C[c][i] = data[i * 4 + c] * a; // premultiply
  }
  gaussianBlurPlane(A, w, h, sigma);
  C.forEach((p) => gaussianBlurPlane(p, w, h, sigma));
  for (let i = 0; i < n; i++) {
    const a = A[i];
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a > 1e-6 ? C[c][i] / a : 0;
    out[i * 4 + 3] = a * 255;
  }
  return out;
}

// ── Uniform-disk (pillbox) blur: the exact geometric defocus kernel ─────────────────────
// Each output pixel sums, for every row dy of the disk, a horizontal span read from that row's
// prefix sums. Pixel coverage of the span is clamp(a + ½ − |dx|, 0, 1) with a = √(r² − dy²),
// so the disk edge is anti-aliased and the kernel is normalised by its discrete weight.
// Cost O(2r + 1) per pixel and plane; edges are clamped like the box passes above.
export function diskBlurPlane(plane, w, h, r) {
  if (r < 0.5) return plane;
  const R = Math.ceil(r), rows = [];
  let wsum = 0;
  for (let dy = -R; dy <= R; dy++) {
    const A = Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.5, n = Math.floor(A) - 1, f = A - Math.floor(A);
    if (A <= 0.5 && dy) continue;
    rows.push([dy, n, f]);
    wsum += n >= 0 ? 2 * n + 1 + 2 * f : A;
  }
  // prefix sums of every clamped row, computed once: P[y][i + 1] = Σ row[clamp(x' − R − 1)], x' ≤ i
  const L = w + 2 * R + 3, P = new Float64Array(h * L), out = new Float32Array(w * h), pw = 1 / wsum;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let i = 0; i < L - 1; i++) { acc += plane[y * w + Math.min(w - 1, Math.max(0, i - R - 1))]; P[y * L + i + 1] = acc; }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (const [dy, n, f] of rows) {
      const sy = Math.min(h - 1, Math.max(0, y + dy)), src = sy * w, pr = sy * L + R + 1; // pr + x: column x
      if (n < 0) { for (let x = 0; x < w; x++) out[o + x] += f * plane[src + x]; continue; }
      for (let x = 0; x < w; x++) {
        let v = P[pr + x + n + 1] - P[pr + x - n];
        if (f) v += f * (plane[src + Math.min(w - 1, x + n + 1)] + plane[src + Math.max(0, x - n - 1)]);
        out[o + x] += v;
      }
    }
  }
  for (let i = 0; i < w * h; i++) plane[i] = out[i] * pw;
  return plane;
}

// Disk-blur RGBA bytes with premultiplied alpha; returns a new Uint8ClampedArray.
export function diskBlurRGBA(data, w, h, r) {
  const n = w * h, out = new Uint8ClampedArray(data.length);
  if (r < 0.5) { out.set(data); return out; }
  const A = new Float32Array(n), C = [0, 1, 2].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255; A[i] = a;
    for (let c = 0; c < 3; c++) C[c][i] = data[i * 4 + c] * a;
  }
  [A, ...C].forEach((p) => diskBlur(p, w, h, r));
  for (let i = 0; i < n; i++) {
    const a = A[i];
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a > 1e-6 ? C[c][i] / a : 0;
    out[i * 4 + 3] = a * 255;
  }
  return out;
}

// Disk blur of a float plane in place. Large radii: blur a k×-downsampled copy (box average) with radius r/k and upsample bilinearly,
// k = ⌊r/4⌋. This keeps the cost near that of r ≈ 4 and adds a blur of about k px, ≤ r/4, to
// the disk edge (≈ 3 % in RMS radius).
export function diskBlur(plane, w, h, r) {
  const k = Math.floor(r / 4);
  if (k < 2) return diskBlurPlane(plane, w, h, r);
  const sw = Math.ceil(w / k), sh = Math.ceil(h / k), small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let acc = 0, cnt = 0;
    for (let yy = y * k; yy < Math.min(h, y * k + k); yy++) for (let xx = x * k; xx < Math.min(w, x * k + k); xx++) { acc += plane[yy * w + xx]; cnt++; }
    small[y * sw + x] = acc / cnt;
  }
  diskBlurPlane(small, sw, sh, r / k);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      plane[y * w + x] = (small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx) * (1 - ty) + (small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx) * ty;
    }
  }
  return plane;
}

// Blur a canvas/image into a new canvas padded by ~3σ so the blur is not clipped.
export function blurredCanvas(src, sigma) {
  const pad = Math.ceil(3 * sigma);
  const c = document.createElement('canvas');
  c.width = src.width + 2 * pad; c.height = src.height + 2 * pad;
  const g = c.getContext('2d');
  g.drawImage(src, pad, pad);
  if (sigma >= 0.3) {
    const im = g.getImageData(0, 0, c.width, c.height);
    im.data.set(gaussianBlurRGBA(im.data, c.width, c.height, sigma));
    g.putImageData(im, 0, 0);
  }
  return { canvas: c, pad };
}

// Disk-blur a canvas/image into a new canvas padded by r + 2 px so the blur is not clipped.
export function diskBlurredCanvas(src, r) {
  const pad = Math.ceil(r) + 2;
  const c = document.createElement('canvas');
  c.width = src.width + 2 * pad; c.height = src.height + 2 * pad;
  const g = c.getContext('2d');
  g.drawImage(src, pad, pad);
  if (r >= 0.5) {
    const im = g.getImageData(0, 0, c.width, c.height);
    im.data.set(diskBlurRGBA(im.data, c.width, c.height, r));
    g.putImageData(im, 0, 0);
  }
  return { canvas: c, pad };
}
