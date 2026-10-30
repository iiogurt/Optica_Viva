// A camera feed sampled by a coarse virtual sensor: each sensor pixel averages a k × k block of
// the (much finer) camera image, i.e. the pixel aperture; an optical low-pass filter (OLPF) adds
// the average of the four copies displaced by one pixel pitch, as a birefringent 4-spot filter
// does. A Bayer RGGB mosaic with bilinear demosaicing shows false colour. Pure functions.

// RGBA (W × H) → sensor RGB (w × h = W/k × H/k, floats 0–255)
export function sampleSensor(rgba, W, H, k, olpf = false) {
  const w = Math.floor(W / k), h = Math.floor(H / k), S = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0;
    for (let y = j * k; y < (j + 1) * k; y++) for (let x = i * k; x < (i + 1) * k; x++) { const o = (y * W + x) * 4; r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; }
    const o = (j * w + i) * 3, n = k * k; S[o] = r / n; S[o + 1] = g / n; S[o + 2] = b / n;
  }
  if (!olpf) return { S, w, h };
  const F = new Float32Array(S.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 3; c++) {
    const at = (ii, jj) => S[(Math.min(h - 1, jj) * w + Math.min(w - 1, ii)) * 3 + c];
    F[(j * w + i) * 3 + c] = (at(i, j) + at(i + 1, j) + at(i, j + 1) + at(i + 1, j + 1)) / 4;
  }
  return { S: F, w, h };
}

// Keep one colour per pixel (RGGB: R at even row/even column, B at odd/odd, G elsewhere) and fill
// the other two by bilinear interpolation of the nearest samples of that colour.
export function bayerDemosaic(S, w, h) {
  const col = (i, j) => (j % 2 === 0 ? (i % 2 === 0 ? 0 : 1) : i % 2 === 0 ? 1 : 2);
  const M = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) M[j * w + i] = S[(j * w + i) * 3 + col(i, j)];
  const out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 3; c++) {
    if (col(i, j) === c) { out[(j * w + i) * 3 + c] = M[j * w + i]; continue; }
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= w || jj >= h || col(ii, jj) !== c) continue;
      s += M[jj * w + ii]; n++;
    }
    out[(j * w + i) * 3 + c] = n ? s / n : 0;
  }
  return out;
}
