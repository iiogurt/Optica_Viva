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
