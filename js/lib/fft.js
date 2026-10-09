// Radix-2 Cooley–Tukey FFT (in place, complex split arrays) and 2-D helpers.
// Conventions: forward  X[k] = Σ x[n] e^{-2πi nk/N};  inverse includes 1/N.

const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    const c = new Float64Array(n / 2), s = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { c[k] = Math.cos(2 * Math.PI * k / n); s[k] = Math.sin(2 * Math.PI * k / n); }
    const rev = new Uint32Array(n);
    const bits = Math.log2(n) | 0;
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    t = { c, s, rev };
    twiddleCache.set(n, t);
  }
  return t;
}

export function fft1d(re, im, inverse = false) {
  const n = re.length;
  const { c, s, rev } = twiddles(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = c[k * step], wi = sign * s[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// 2-D FFT of an n×n row-major complex field.
export function fft2d(re, im, n, inverse = false) {
  for (let y = 0; y < n; y++) fft1d(re.subarray(y * n, y * n + n), im.subarray(y * n, y * n + n), inverse);
  const cr = new Float64Array(n), ci = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { cr[y] = re[y * n + x]; ci[y] = im[y * n + x]; }
    fft1d(cr, ci, inverse);
    for (let y = 0; y < n; y++) { re[y * n + x] = cr[y]; im[y * n + x] = ci[y]; }
  }
}

// Swap quadrants so the zero frequency sits at (n/2, n/2).
export function fftshift(a, n) {
  const h = n >> 1, out = new a.constructor(a.length);
  for (let y = 0; y < n; y++) {
    const yy = (y + h) % n;
    for (let x = 0; x < n; x++) out[yy * n + ((x + h) % n)] = a[y * n + x];
  }
  return out;
}
