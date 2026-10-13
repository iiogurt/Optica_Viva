// Detector physics for space astronomy: up-the-ramp sampling of infrared arrays with cosmic-ray
// jump detection, inter-pixel capacitance (IPC), charge-transfer inefficiency (CTI) in radiation-
// damaged CCDs, and image persistence. Charges in electrons, times in seconds.
import { makeRng } from './random.js';

export function rng(seed) { return makeRng(seed); }

// ── Up the ramp ─────────────────────────────────────────────────────────────────────────────
// N non-destructive reads at t_i = i·dt (i = 1…N) of a pixel collecting f e⁻/s, read noise σ,
// optionally a cosmic ray depositing `jump` electrons between reads k−1 and k.
export function ramp(o, r) {
  const S = new Float64Array(o.N);
  let q = 0;
  for (let i = 0; i < o.N; i++) {
    q += r.poisson(o.f * o.dt);
    if (o.crAt && i === o.crAt) q += o.jump;
    S[i] = q + o.sigma * r.g();
  }
  return S;
}
// Slope estimators: CDS (last − first), ordinary least squares over all reads, and least squares
// on the segments between detected jumps (two-point differences more than k·σ_diff from the median).
export function slopeCDS(S, dt) { return (S[S.length - 1] - S[0]) / ((S.length - 1) * dt); }
export function slopeLS(S, dt, from = 0, to = S.length) {
  const n = to - from; if (n < 2) return NaN;
  let st = 0, ss = 0; for (let i = from; i < to; i++) { st += i; ss += S[i]; }
  const tb = st / n, sb = ss / n; let num = 0, den = 0;
  for (let i = from; i < to; i++) { num += (i - tb) * (S[i] - sb); den += (i - tb) ** 2; }
  return num / den / dt;
}
export function slopeJump(S, dt, sigma, k = 5) {
  const d = []; for (let i = 1; i < S.length; i++) d.push(S[i] - S[i - 1]);
  const med = [...d].sort((a, b) => a - b)[d.length >> 1], sd = Math.sqrt(2 * sigma * sigma + Math.max(med, 0));
  const jumps = []; d.forEach((x, i) => { if (x - med > k * sd) jumps.push(i + 1); });
  // fit each segment, combine by inverse variance (weights ∝ n(n²−1))
  const edges = [0, ...jumps, S.length]; let num = 0, den = 0;
  for (let e = 0; e < edges.length - 1; e++) { const n = edges[e + 1] - edges[e]; if (n < 2) continue; const w = n * (n * n - 1); num += w * slopeLS(S, dt, edges[e], edges[e + 1]); den += w; }
  return { slope: den ? num / den : NaN, jumps };
}
// Exact variance of the least-squares slope for N reads dt apart: read noise σ² / Σ(t − t̄)² plus
// the correlated shot noise f·dt·Σ_k (Σ_{i≥k} w_i)², w_i = (t_i − t̄)/Σ(t − t̄)².
export function slopeVarianceLS(N, dt, sigma, f) {
  const tb = (N - 1) / 2; let den = 0; for (let i = 0; i < N; i++) den += (i - tb) ** 2;
  const w = Array.from({ length: N }, (_, i) => (i - tb) / den / dt);
  let shot = 0; for (let k = 1; k < N; k++) { let c = 0; for (let i = k; i < N; i++) c += w[i]; shot += c * c; }
  return (sigma * sigma) / (den * dt * dt) + f * dt * shot;
}
// CDS variance: 2σ²/T² + f/T with T = (N − 1)dt.
export const slopeVarianceCDS = (N, dt, sigma, f) => { const T = (N - 1) * dt; return (2 * sigma * sigma) / (T * T) + f / T; };

// ── Inter-pixel capacitance ─────────────────────────────────────────────────────────────────
// Charge in a pixel induces voltage in its four neighbours with coupling α: kernel
// [[0, α, 0], [α, 1 − 4α, α], [0, α, 0]]. It conserves the signal but smooths the noise, so the
// photon-transfer variance falls by (1 − 4α)² + 4α² and the inferred gain is biased.
export function ipc(img, W, H, alpha) {
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = img[y * W + x], k = y * W + x;
    out[k] += (1 - 4 * alpha) * c;
    if (x > 0) out[k - 1] += alpha * c; else out[k] += alpha * c;
    if (x < W - 1) out[k + 1] += alpha * c; else out[k] += alpha * c;
    if (y > 0) out[k - W] += alpha * c; else out[k] += alpha * c;
    if (y < H - 1) out[k + W] += alpha * c; else out[k] += alpha * c;
  }
  return out;
}
export const ipcVarianceFactor = (alpha) => (1 - 4 * alpha) ** 2 + 4 * alpha * alpha;

// ── Charge-transfer inefficiency ────────────────────────────────────────────────────────────
// A column is clocked through `transfers` trap sites. At each transfer a packet loses a fraction
// ε of its charge (above a fill threshold) to traps, which release it with an exponential delay
// of τ pixels into the packets that follow (a simple single-species trap model). Returns the
// read-out column.
export function ctiColumn(col, transfers, eps, tau) {
  let c = Float64Array.from(col);
  const rel = 1 - Math.exp(-1 / tau);
  // trap occupancy per row is approximated by a single trap reservoir moving with the readout
  for (let t = 0; t < transfers; t++) {
    const out = new Float64Array(c.length);
    let trapped = 0;
    for (let i = 0; i < c.length; i++) {
      const released = trapped * rel; trapped -= released;
      const captured = eps * c[i];
      trapped += captured;
      out[i] = c[i] - captured + released;
    }
    // charge still in the traps after the last pixel is released into the overscan (lost here)
    c = out;
  }
  return c;
}

// ── Persistence ─────────────────────────────────────────────────────────────────────────────
// After a fluence F (in units of full well) a pixel releases trapped charge at a rate that decays
// as a power law in time: P(t) = A · max(0, F − F₀) · (t/1000 s)^(−γ) e⁻/s (Smith et al. 2008-like).
export const persistenceRate = (F, t, A = 0.05, F0 = 0.5, gamma = 1) => A * Math.max(0, F - F0) * Math.pow(t / 1000, -gamma);
