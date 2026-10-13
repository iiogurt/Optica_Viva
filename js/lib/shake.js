// Camera shake and image stabilisation. Hand-held angular motion is modelled per axis as an
// Ornstein–Uhlenbeck angular velocity (drift, RMS σ_ω, correlation time τ) plus physiological
// tremor (a narrow band near 10 Hz). A stabiliser servo follows the motion below its bandwidth
// f_c and adds gyro noise. Angles in rad, times in s.
import { makeRng } from './random.js';

export function rng(seed) { const r = makeRng(seed); return { u: r.u, g: r.g }; }

// Angular trajectory θ(t) for one axis, sampled at dt over duration T.
// o = { sigma (rad/s RMS drift velocity), tau (s), tremor (rad/s RMS), ftrem (Hz) }
export function trajectory(o, T, dt, r) {
  const n = Math.ceil(T / dt) + 1, th = new Float64Array(n), a = Math.exp(-dt / o.tau), b = o.sigma * Math.sqrt(1 - a * a);
  let w = o.sigma * r.g(), ph = 2 * Math.PI * r.u(), f = o.ftrem * (0.9 + 0.2 * r.u()), amp = o.tremor * Math.SQRT2;
  for (let i = 1; i < n; i++) {
    w = a * w + b * r.g();
    if (i % 200 === 0) { f = o.ftrem * (0.9 + 0.2 * r.u()); } // tremor wanders in frequency
    ph += 2 * Math.PI * f * dt;
    th[i] = th[i - 1] + (w + amp * Math.cos(ph)) * dt;
  }
  return th;
}

// Stabiliser: a second-order (type-2) servo with bandwidth f_c and damping ζ = 0.7 moves the
// correcting element to follow the measured angle, x'' = ω_c²(θ − x) + 2ζω_c(θ' − x'). The residual
// θ − x falls as (f/f_c)² below the bandwidth. The angle comes from integrating a rate gyro, so
// its error is an angle random walk (arw, rad/√s): it grows as √t and limits long exposures.
export function stabilise(th, dt, fc, arw, r) {
  const out = new Float64Array(th.length), w = 2 * Math.PI * fc, z = 0.7, sw = arw * Math.sqrt(dt);
  let x = th[0], v = 0, walk = 0;
  const n = th.length;
  for (let i = 0; i < n; i++) {
    const dw = sw * r.g();
    walk += dw;
    // the gyro reports the instantaneous rate (central difference of the true angle) plus its noise
    const meas = th[i] + walk, rate = (th[Math.min(n - 1, i + 1)] - th[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * dt) + dw / dt;
    out[i] = th[i] - x; // residual at this sample, before the servo advances to the next
    // five sub-steps per sample keep the integration error well below the servo residual
    for (let q = 0; q < 5; q++) { v += (w * w * (meas + rate * (q / 5) * dt - x) + 2 * z * w * (rate - v)) * (dt / 5); x += v * (dt / 5); }
  }
  return out;
}

// A long two-axis trajectory (60 s at 0.5 ms), optionally stabilised, reused for every exposure.
export function makeShake(o, st, seed = 1, T = 60, dt = 5e-4) {
  const r = rng(seed);
  let tx = trajectory(o, T, dt, r), ty = trajectory(o, T, dt, r);
  if (st) { tx = stabilise(tx, dt, st.fc, st.arw, r); ty = stabilise(ty, dt, st.fc, st.arw, r); }
  return { tx, ty, dt, settle: Math.ceil(1 / dt) };
}

// Blur of one exposure of n samples from i0: image-plane path f·θ (mm); RMS radius about its
// mean and extent (largest distance between points), from at most ~200 points of the path.
export function blurOf(tx, ty, i0, n, f) {
  const stride = Math.max(1, Math.floor(n / 200));
  let mx = 0, my = 0, c = 0;
  for (let i = 0; i < n; i += stride) { mx += tx[i0 + i]; my += ty[i0 + i]; c++; }
  mx /= c; my /= c;
  let r2 = 0, ext = 0;
  const xs = [], ys = [];
  for (let i = 0; i < n; i += stride) { const dx = tx[i0 + i] - mx, dy = ty[i0 + i] - my; r2 += dx * dx + dy * dy; xs.push(dx); ys.push(dy); }
  for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) { const d = (xs[a] - xs[b]) ** 2 + (ys[a] - ys[b]) ** 2; if (d > ext) ext = d; }
  return { rms: f * Math.sqrt(r2 / c), extent: f * Math.sqrt(ext) };
}

// Probability that the blur extent stays below `limit` (mm) for exposure t, from N exposures
// starting at random times along the trajectory sh.
export function sharpProbability(sh, f, t, limit, N = 200, seed = 1) {
  const r = rng(seed), n = Math.max(2, Math.round(t / sh.dt)), span = sh.tx.length - n - sh.settle - 1;
  if (span <= 0) return 0;
  let ok = 0;
  for (let k = 0; k < N; k++) { const i0 = sh.settle + Math.floor(r.u() * span); if (blurOf(sh.tx, sh.ty, i0, n, f).extent <= limit) ok++; }
  return ok / N;
}

// Longest exposure with ≥ p probability of a sharp frame (bisection on log t).
export function safeShutter(sh, f, limit, p = 0.5, N = 160) {
  let lo = Math.log(1e-5), hi = Math.log(30);
  for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; sharpProbability(sh, f, Math.exp(mid), limit, N, 7) >= p ? (lo = mid) : (hi = mid); }
  return Math.exp((lo + hi) / 2);
}

// Point-spread function of a blur path, rasterised into a K×K grid of pixel pitch px (mm).
export function pathPSF(tx, ty, i0, nExp, f, K, px) {
  const P = new Float32Array(K * K);
  let mx = 0, my = 0;
  for (let i = 0; i < nExp; i++) { mx += tx[i0 + i]; my += ty[i0 + i]; }
  mx /= nExp; my /= nExp;
  for (let i = 0; i < nExp; i++) {
    const x = (f * (tx[i0 + i] - mx)) / px + K / 2, y = (f * (ty[i0 + i] - my)) / px + K / 2, x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const X = x0 + dx, Y = y0 + dy;
      if (X >= 0 && X < K && Y >= 0 && Y < K) P[Y * K + X] += w / nExp;
    }
  }
  return P;
}

// Test chart (W×W, values 0–1): a Siemens star with 36 spokes and a few bars of text-like detail.
export function chart(W) {
  const a = new Float32Array(W * W), c = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
    let v = 0.85;
    if (r < W * 0.36) v = Math.sin(18 * Math.atan2(dy, dx)) > 0 ? 0.08 : 0.85;
    if (r < 3) v = 0.5;
    if (y > W * 0.86 && y < W * 0.94) v = (Math.floor(x / 3) % 2 === 0 && (x % 37) < 26) ? 0.08 : 0.85;
    a[y * W + x] = v;
  }
  return a;
}

// Everything the lab shows for one setting (runs in the worker). o = { shake, st | null, f (mm),
// limit (mm), t (s), px (mm, sensor pixel), seed }.
const cache = new Map();
export function shakeLab(o) {
  const key = (st) => JSON.stringify([o.shake, st]);
  const get = (st) => { const k = key(st); if (!cache.has(k)) { if (cache.size > 6) cache.clear(); cache.set(k, makeShake(o.shake, st, 1)); } return cache.get(k); };
  const raw = get(null), stab = o.st ? get(o.st) : null, cur = stab || raw;
  const ts = Array.from({ length: 16 }, (_, i) => 1e-4 * Math.pow(10, (i / 15) * 5)); // 1/10000 s … 10 s
  const curve = (sh) => ts.map((t) => [t, sharpProbability(sh, o.f, t, o.limit, 80, 3)]);
  const res = { raw: curve(raw), stab: stab ? curve(stab) : null, safeRaw: safeShutter(raw, o.f, o.limit, 0.5, 100), safeStab: stab ? safeShutter(stab, o.f, o.limit, 0.5, 100) : null };
  // one exposure for the picture: a path starting at a seeded random time
  const r = rng(o.seed || 1), n = Math.max(2, Math.round(o.t / cur.dt)), i0 = cur.settle + Math.floor(r.u() * (cur.tx.length - n - cur.settle - 1));
  const b = blurOf(cur.tx, cur.ty, i0, n, o.f), K = 63, P = pathPSF(cur.tx, cur.ty, i0, n, o.f, K, o.px);
  const stride = Math.max(1, Math.floor(n / 400)), path = [];
  for (let i = 0; i < n; i += stride) path.push([o.f * cur.tx[i0 + i] * 1000, o.f * cur.ty[i0 + i] * 1000]); // µm
  // blur the chart with the PSF (direct convolution over the PSF's non-zero taps)
  const W = 192, img = chart(W), out = new Float32Array(W * W), taps = [];
  for (let k = 0; k < K * K; k++) if (P[k] > 1e-4) taps.push([(k % K) - (K >> 1), ((k / K) | 0) - (K >> 1), P[k]]);
  const tw = taps.reduce((a2, q) => a2 + q[2], 0);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (const [dx, dy, w] of taps) { const xx = Math.min(W - 1, Math.max(0, x - dx)), yy = Math.min(W - 1, Math.max(0, y - dy)); v += w * img[yy * W + xx]; }
    out[y * W + x] = v / tw;
  }
  return { ...res, blur: b, path, img: out, W, psf: P, K };
}
