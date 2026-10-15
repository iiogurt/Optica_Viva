// Slanted-edge MTF (ISO 12233 e-SFR, as in sfrmat): per-row edge positions from the centroid of
// the derivative, a straight-line fit, 4× oversampled edge-spread function by projecting every
// pixel onto the edge, Hamming-windowed line-spread function, and its Fourier magnitude. Pure
// functions on linear-light arrays.

// Fit x = a + b·y to the per-row edge centroids of a W×H region (edge roughly vertical). The
// centroid uses the signed derivative, so noise in the flat parts cancels; a second pass repeats it
// inside a Hamming window around the first fit, as sfrmat does.
export function edgeFit(img, W, H) {
  const lineFit = (ys, xs) => {
    const n = ys.length, my = ys.reduce((a, v) => a + v, 0) / n, mx = xs.reduce((a, v) => a + v, 0) / n;
    let sxy = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (ys[i] - my) * (xs[i] - mx); syy += (ys[i] - my) ** 2; }
    const b = syy ? sxy / syy : 0;
    return { a: mx - b * my, b };
  };
  // edge polarity from the mean derivative
  let pol = 0; for (let y = 0; y < H; y++) pol += img[y * W + W - 2] - img[y * W + 1];
  const sgn = pol >= 0 ? 1 : -1;
  const pass = (prev, half) => {
    const ys = [], xs = [];
    for (let y = 0; y < H; y++) {
      const c = prev ? prev.a + prev.b * y : W / 2;
      let s = 0, sx = 0;
      for (let x = 1; x < W - 1; x++) {
        const wgt = prev ? (Math.abs(x - c) < half ? 0.54 + 0.46 * Math.cos((Math.PI * (x - c)) / half) : 0) : 1;
        const d = (sgn * (img[y * W + x + 1] - img[y * W + x - 1])) / 2 * wgt;
        s += d; sx += d * x;
      }
      if (s > 0) { ys.push(y); xs.push(sx / s); }
    }
    return lineFit(ys, xs);
  };
  const first = pass(null);
  return pass(first, Math.max(6, W / 4));
}

// e-SFR of a region with a near-vertical edge (transpose horizontal edges first). Returns
// frequencies (cycles/pixel) and MTF values up to 1 cycle/pixel, and the edge fit.
export function esfr(img, W, H, fit = edgeFit(img, W, H), q = 4) {
  const { a, b } = fit, nb = W * q, sum = new Float64Array(nb + 2 * q), cnt = new Float64Array(nb + 2 * q), off = q;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = x - (a + b * y); // horizontal distance to the edge, pixels
    const k = Math.floor((d + W / 2) * q) + off;
    if (k >= 0 && k < sum.length) { sum[k] += img[y * W + x]; cnt[k]++; }
  }
  // ESF with empty bins filled by their neighbours
  const esf = []; for (let k = 0; k < sum.length; k++) esf.push(cnt[k] ? sum[k] / cnt[k] : NaN);
  for (let k = 0; k < esf.length; k++) if (isNaN(esf[k])) { let l = k - 1, r = k + 1; while (l >= 0 && isNaN(esf[l])) l--; while (r < esf.length && isNaN(esf[r])) r++; esf[k] = l >= 0 && r < esf.length ? (esf[l] + esf[r]) / 2 : l >= 0 ? esf[l] : esf[r]; }
  // trim the sparsely filled ends and differentiate (central difference)
  const s0 = 2 * q, s1 = esf.length - 2 * q, lsf = [];
  for (let k = s0; k < s1; k++) lsf.push((esf[k + 1] - esf[k - 1]) / 2);
  // centre and Hamming window
  let peak = 0, pv = -Infinity; lsf.forEach((v, i) => { if (Math.abs(v) > pv) { pv = Math.abs(v); peak = i; } });
  const N = lsf.length, half = Math.max(peak, N - peak);
  const win = lsf.map((v, i) => v * (0.54 + 0.46 * Math.cos((Math.PI * (i - peak)) / half)));
  // DFT magnitude at frequencies f = k/(N/q) cycles/pixel, up to 1 cycle/pixel
  const freqs = [], mtf = [];
  let dc = 0; for (const v of win) dc += v;
  const kmax = Math.floor(N / q);
  for (let k = 0; k <= kmax; k++) {
    let re = 0, im = 0; for (let i = 0; i < N; i++) { const ph = (-2 * Math.PI * k * i) / N; re += win[i] * Math.cos(ph); im += win[i] * Math.sin(ph); }
    const f = (k * q) / N, x = Math.PI * f / q; // derivative correction for the central difference
    const corr = k ? Math.sin(2 * x) / (2 * x) : 1;
    freqs.push(f); mtf.push(Math.hypot(re, im) / Math.abs(dc) / corr);
  }
  return { freqs, mtf, fit, esf, lsf: win };
}
// Frequency at which the MTF first falls below `level` (linear interpolation).
export function mtfAt(freqs, mtf, level = 0.5) {
  for (let i = 1; i < mtf.length; i++) if (mtf[i] < level) return freqs[i - 1] + ((mtf[i - 1] - level) / (mtf[i - 1] - mtf[i])) * (freqs[i] - freqs[i - 1]);
  return NaN;
}

// A synthetic slanted edge: angle (deg), Gaussian blur σ (pixels) and pixel-aperture integration,
// dark 0.1 / bright 0.8, offset by `shift` pixels, optional Gaussian noise. Known MTF = exp(−2π²σ²f²)·|sinc f|.
export function syntheticEdge(W, H, { angle = 5, sigma = 0.8, shift = 0, noise = 0, rng = null } = {}) {
  const img = new Float32Array(W * H), t = Math.tan((angle * Math.PI) / 180), c = Math.cos((angle * Math.PI) / 180);
  const erf = (x) => { const s = Math.sign(x), z = Math.abs(x), p = 1 / (1 + 0.3275911 * z); return s * (1 - (((((1.061405429 * p - 1.453152027) * p) + 1.421413741) * p - 0.284496736) * p + 0.254829592) * p * Math.exp(-z * z)); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const d = (x + (i + 0.5) / 4 - (W / 2 + shift + t * (y + (j + 0.5) / 4 - H / 2))) * c;
      v += 0.5 * (1 + erf(d / (Math.max(1e-3, sigma) * Math.SQRT2)));
    }
    img[y * W + x] = 0.1 + 0.7 * (v / 16) + (noise && rng ? noise * rng() : 0);
  }
  return img;
}
export const theoreticalMTF = (f, sigma) => Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * f * f) * Math.abs(f ? Math.sin(Math.PI * f) / (Math.PI * f) : 1);
