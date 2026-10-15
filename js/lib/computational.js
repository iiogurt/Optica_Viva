// Computational photography: a burst of short frames merged for low noise (night mode) and for
// resolution beyond the pixel grid (burst super-resolution from hand-shake), against one long
// shaken exposure; and synthetic background blur from a depth map. Pure functions.
import { makeRng } from './random.js';
import { gaussianExact } from './macro.js';

// A high-resolution test target (reflectance 0.05–0.95), n × n: a Siemens star and fine bars.
export function target(n = 256) {
  const t = new Float32Array(n * n), c = n * 0.32;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0.5;
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy);
    if (r < n * 0.28) v = Math.sin(18 * Math.atan2(dy, dx)) > 0 ? 0.92 : 0.06;
    if (x > n * 0.66 && y > n * 0.1 && y < n * 0.9) { const p = 2 + Math.floor(((y - n * 0.1) / (n * 0.8)) * 6); v = Math.floor((x - n * 0.66) / p) % 2 ? 0.9 : 0.08; }
    t[y * n + x] = v;
  }
  return t;
}
// Sample the target with pixels s target-pixels wide, offset by (ox, oy) target pixels, with
// Poisson photon noise for `photons` electrons at reflectance 1 and Gaussian read noise σ.
function sample(t, n, s, ox, oy, photons, sigma, rng) {
  const m = Math.floor(n / s) - 1, out = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let a = 0;
    for (let b = 0; b < s; b++) for (let c = 0; c < s; c++) {
      const x = Math.min(n - 1, Math.max(0, Math.round(i * s + c + ox))), y = Math.min(n - 1, Math.max(0, Math.round(j * s + b + oy)));
      a += t[y * n + x];
    }
    const e = (a / (s * s)) * photons;
    out[j * m + i] = (rng.poisson(e) + sigma * rng.g()) / photons;
  }
  return { img: out, m };
}
// One long exposure of the same total light, smeared by hand shake of `shake` target pixels.
function shaken(t, n, shake) {
  if (shake < 1) return t;
  const out = new Float32Array(n * n), L = Math.round(shake);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let a = 0;
    for (let k = 0; k <= L; k++) a += t[y * n + Math.min(n - 1, x + k)];
    out[y * n + x] = a / (L + 1);
  }
  return out;
}

// Burst: N frames of `photons` each with random sub-pixel shifts; merged by aligning (shifts known)
// and averaging on the sensor grid, or splatting onto a grid `up` times finer (super-resolution).
export function burst({ n = 256, s = 4, N = 8, photons = 20, sigma = 2, shake = 6, up = 2, seed = 7 }) {
  const t = target(n), rng = makeRng(seed), frames = [];
  for (let k = 0; k < N; k++) {
    const ox = (k === 0 ? 0 : rng.u()) * s, oy = (k === 0 ? 0 : rng.u()) * s;
    frames.push({ ...sample(t, n, s, ox, oy, photons, sigma, rng), ox, oy });
  }
  const m = frames[0].m;
  // aligned average on the sensor grid (shifts rounded to whole pixels, as a simple merge would)
  const avg = new Float32Array(m * m), cnt = new Float32Array(m * m);
  // super-resolution splat onto an up× grid
  const M = m * up, sr = new Float32Array(M * M), sc = new Float32Array(M * M);
  for (const fr of frames) {
    const dxp = Math.round(fr.ox / s), dyp = Math.round(fr.oy / s);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const v = fr.img[j * m + i];
      const ai = i + dxp, aj = j + dyp;
      if (ai < m && aj < m) { avg[aj * m + ai] += v; cnt[aj * m + ai]++; }
      const X = Math.round(((i * s + fr.ox + s / 2) / s) * up - 0.5), Y = Math.round(((j * s + fr.oy + s / 2) / s) * up - 0.5);
      if (X >= 0 && Y >= 0 && X < M && Y < M) { sr[Y * M + X] += v; sc[Y * M + X]++; }
    }
  }
  for (let k = 0; k < avg.length; k++) avg[k] = cnt[k] ? avg[k] / cnt[k] : 0;
  // fill empty super-resolution cells from their neighbours, then normalise
  for (let k = 0; k < sr.length; k++) if (sc[k]) sr[k] /= sc[k];
  for (let pass = 0; pass < 3; pass++) for (let Y = 0; Y < M; Y++) for (let X = 0; X < M; X++) {
    const k = Y * M + X; if (sc[k]) continue;
    let a = 0, c = 0; for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (Y + v) * M + X + u; if (X + u >= 0 && X + u < M && Y + v >= 0 && Y + v < M && sc[q]) { a += sr[q]; c++; } }
    if (c) { sr[k] = a / c; sc[k] = 0.5; }
  }
  const long = sample(shaken(t, n, shake), n, s, 0, 0, photons * N, sigma, rng);
  const snr = (img) => { // noise from the flat grey area at the top-left of the frame
    const vals = []; for (let j = 1; j < 6; j++) for (let i = Math.floor(m * 0.62); i < Math.floor(m * 0.64) + 3; i++) vals.push(img[j * m + i]);
    const mu = vals.reduce((a, x) => a + x, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, x) => a + (x - mu) ** 2, 0) / vals.length);
    return mu / sd;
  };
  return { t, n, m, M, single: frames[0].img, avg, sr, long: long.img, snrSingle: snr(frames[0].img), snrAvg: snr(avg), predicted: { single: (0.5 * photons) / Math.sqrt(0.5 * photons + sigma * sigma), burst: (0.5 * photons * N) / Math.sqrt(N * (0.5 * photons + sigma * sigma)), long: (0.5 * photons * N) / Math.sqrt(0.5 * photons * N + sigma * sigma) } };
}

// Portrait mode: a subject (head with fine hair strands) at 2 m before a background of lights at
// 10 m. Optical blur uses the true depth of every pixel; synthetic blur uses a depth map estimated
// at `coarse`× lower resolution, which loses the hair and leaves halos.
export function portrait({ n = 200, blur = 8, coarse = 8, seed = 4 }) {
  const rng = makeRng(seed), bg = new Float32Array(n * n), fg = new Float32Array(n * n), mask = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) bg[y * n + x] = 0.15 + 0.1 * Math.sin(x / 9) * Math.cos(y / 13);
  for (let k = 0; k < 40; k++) { const cx = rng.u() * n, cy = rng.u() * n * 0.6; for (let y = Math.max(0, Math.floor(cy - 2)); y < Math.min(n, cy + 2); y++) for (let x = Math.max(0, Math.floor(cx - 2)); x < Math.min(n, cx + 2); x++) bg[y * n + x] = 1; }
  const hx = n / 2, hy = n * 0.55, rx = n * 0.2, ry = n * 0.27;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inside = ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2 < 1 || (y > n * 0.78 && Math.abs(x - hx) < n * 0.33);
    if (inside) { mask[y * n + x] = 1; fg[y * n + x] = 0.55 + 0.1 * Math.sin(y / 5); }
  }
  // hair: thin dark strands sticking out of the head
  for (let k = 0; k < 60; k++) {
    const a = -Math.PI * (0.15 + 0.7 * rng.u()), len = n * (0.05 + 0.08 * rng.u());
    for (let s = 0; s < len; s += 0.5) {
      const x = Math.round(hx + (rx + s) * Math.cos(a) + 3 * Math.sin(s / 4 + k)), y = Math.round(hy + (ry + s) * Math.sin(a));
      if (x >= 0 && y >= 0 && x < n && y < n) { mask[y * n + x] = 1; fg[y * n + x] = 0.25; }
    }
  }
  const bgBlur = gaussianExact(Float64Array.from(bg), n, n, blur);
  // optical: every pixel blurred according to its own depth (sharp subject over blurred background)
  const optical = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) optical[k] = mask[k] ? fg[k] : bgBlur[k];
  // the sharp photo the phone records (everything in focus) and its coarse depth map
  const sharp = new Float32Array(n * n); for (let k = 0; k < n * n; k++) sharp[k] = mask[k] ? fg[k] : bg[k];
  const c = Math.max(1, coarse), m = Math.ceil(n / c), low = new Float32Array(m * m);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) low[Math.floor(y / c) * m + Math.floor(x / c)] += mask[y * n + x] / (c * c);
  const est = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) est[y * n + x] = low[Math.floor(y / c) * m + Math.floor(x / c)] > 0.5 ? 1 : 0;
  const sharpBlur = gaussianExact(Float64Array.from(sharp), n, n, blur);
  const synthetic = new Float32Array(n * n);
  let wrong = 0;
  for (let k = 0; k < n * n; k++) { synthetic[k] = est[k] ? sharp[k] : sharpBlur[k]; if (est[k] !== mask[k]) wrong++; }
  return { n, optical, synthetic, sharp, wrongPct: (100 * wrong) / (n * n) };
}
