// Wavefront sensing and adaptive optics: a diffraction model of the Shack–Hartmann sensor (one
// FFT per lenslet), centroiding with photon and read noise, a modal least-squares Zernike
// reconstructor, and the ingredients of a closed AO loop. Wavefronts are OPD maps in nm on an
// Np × Np pupil grid; Zernike coefficients are nm RMS (Noll normalisation).
import { fft2d } from './fft.js';
import { noll } from './pupil.js';
import { phaseScreen } from './turbulence.js';

const nextPow2 = (v) => { let p = 1; while (p < v) p <<= 1; return p; };

// Build the sensor and reconstructor. o = { Np, nsub, J (highest Noll index corrected, ≥ 3),
// lam (WFS wavelength, nm), minIllum (fraction of a lenslet inside the pupil to be used) }.
export function makeSH(o) {
  const { Np, nsub } = o, s = Np / nsub, M = nextPow2(Math.ceil(3 * s)), R = Np / 2, lam = o.lam || 600;
  const pupil = new Float64Array(Np * Np);
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) pupil[y * Np + x] = Math.hypot(x + 0.5 - R, y + 0.5 - R) <= R ? 1 : 0;
  const valid = [];
  for (let j = 0; j < nsub; j++) for (let i = 0; i < nsub; i++) {
    let c = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c += pupil[(j * s + y) * Np + i * s + x];
    if (c / (s * s) >= (o.minIllum ?? 0.5)) valid.push({ i, j, x0: i * s, y0: j * s, frac: c / (s * s) });
  }
  // Zernike modes 2 … J (Noll), sampled at pixel centres from tables of ρᵏ, cos mθ and sin mθ
  const modes = [], fact = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
  const inside = [], nmax = noll(o.J).n;
  for (let k = 0; k < Np * Np; k++) if (pupil[k]) inside.push(k);
  const P = inside.length, rp = new Float64Array(P * (nmax + 1)), cs = new Float64Array(P * (nmax + 1)), sn = new Float64Array(P * (nmax + 1));
  inside.forEach((k, i) => {
    const dx = ((k % Np) + 0.5 - R) / R, dy = (((k / Np) | 0) + 0.5 - R) / R, rho = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    for (let e = 0; e <= nmax; e++) { rp[i * (nmax + 1) + e] = rho ** e; cs[i * (nmax + 1) + e] = Math.cos(e * th); sn[i * (nmax + 1) + e] = Math.sin(e * th); }
  });
  for (let jn = 2; jn <= o.J; jn++) {
    const { n, m: mm, even } = noll(jn), coef = [];
    for (let q = 0; q <= (n - mm) / 2; q++) coef.push([((q % 2 ? -1 : 1) * fact(n - q)) / (fact(q) * fact((n + mm) / 2 - q) * fact((n - mm) / 2 - q)), n - 2 * q]);
    const norm = mm === 0 ? Math.sqrt(n + 1) : Math.sqrt(2 * (n + 1)), m = new Float64Array(Np * Np), ang = mm === 0 ? null : even ? cs : sn;
    for (let i = 0; i < P; i++) {
      const b = i * (nmax + 1);
      let rad = 0;
      for (let c = 0; c < coef.length; c++) rad += coef[c][0] * rp[b + coef[c][1]];
      m[inside[i]] = norm * rad * (ang ? ang[b + mm] : 1);
    }
    modes.push(m);
  }
  const sys = { Np, nsub, s, M, R, lam, pupil, valid, modes, J: o.J };
  // interaction matrix: the centroid of a lenslet spot equals the intensity-weighted mean phase
  // gradient over the lenslet (exact for an untruncated spot), here as mean finite differences
  const V = valid.length, K = modes.length, D = new Float64Array(2 * V * K);
  modes.forEach((m, q) => {
    const sl = geometricSlopes(sys, m);
    for (let v = 0; v < 2 * V; v++) D[v * K + q] = sl[v];
  });
  // calibrate each lenslet's centroid gain (truncated centre of gravity) with two small tilts,
  // as a real system does by recording the interaction matrix through the sensor
  const amp = lam / 40, tx = new Float64Array(Np * Np), ty = new Float64Array(Np * Np);
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) { tx[y * Np + x] = (amp * x) / s; ty[y * Np + x] = (amp * y) / s; }
  const mx = shMeasure(sys, tx).slopes, my = shMeasure(sys, ty).slopes, gx = geometricSlopes(sys, tx), gy = geometricSlopes(sys, ty);
  sys.gain = new Float64Array(2 * V);
  for (let v = 0; v < V; v++) { sys.gain[v] = mx[v] / gx[v]; sys.gain[V + v] = my[V + v] / gy[V + v]; }
  for (let v = 0; v < 2 * V; v++) for (let q = 0; q < K; q++) D[v * K + q] *= sys.gain[v];
  sys.D = D;
  sys.Rec = leastSquares(D, 2 * V, K, 1e-6);
  return sys;
}

// Mean phase gradient (rad per pupil pixel at the WFS wavelength) of an OPD map (nm) in each
// valid lenslet: [gx(0) … gx(V−1), gy(0) … gy(V−1)].
export function geometricSlopes(sys, opd) {
  const { Np, s, pupil, valid } = sys, V = valid.length, out = new Float64Array(2 * V), k = (2 * Math.PI) / sys.lam;
  valid.forEach((v, n) => {
    let gx = 0, cx = 0, gy = 0, cy = 0;
    for (let y = v.y0; y < v.y0 + s; y++) for (let x = v.x0; x < v.x0 + s; x++) {
      const p = y * Np + x;
      if (!pupil[p]) continue;
      if (x + 1 < v.x0 + s && pupil[p + 1]) { gx += opd[p + 1] - opd[p]; cx++; }
      if (y + 1 < v.y0 + s && pupil[p + Np]) { gy += opd[p + Np] - opd[p]; cy++; }
    }
    out[n] = cx ? (k * gx) / cx : 0;
    out[V + n] = cy ? (k * gy) / cy : 0;
  });
  return out;
}

// Regularised least-squares reconstructor R = (DᵀD + εI)⁻¹Dᵀ for D (rows × K), by Cholesky.
function leastSquares(D, rows, K, eps) {
  const A = new Float64Array(K * K);
  let tr = 0;
  for (let a = 0; a < K; a++) for (let b = a; b < K; b++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) sum += D[r * K + a] * D[r * K + b];
    A[a * K + b] = A[b * K + a] = sum;
    if (a === b) tr += sum;
  }
  for (let a = 0; a < K; a++) A[a * K + a] += (eps * tr) / K;
  // Cholesky A = L Lᵀ
  const L = new Float64Array(K * K);
  for (let i = 0; i < K; i++) for (let j = 0; j <= i; j++) {
    let sum = A[i * K + j];
    for (let k = 0; k < j; k++) sum -= L[i * K + k] * L[j * K + k];
    L[i * K + j] = i === j ? Math.sqrt(Math.max(sum, 1e-300)) : sum / L[j * K + j];
  }
  // R = A⁻¹ Dᵀ, one column (sensor reading) at a time
  const Rec = new Float64Array(K * rows), z = new Float64Array(K);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < K; i++) { let sum = D[r * K + i]; for (let k = 0; k < i; k++) sum -= L[i * K + k] * z[k]; z[i] = sum / L[i * K + i]; }
    for (let i = K - 1; i >= 0; i--) { let sum = z[i]; for (let k = i + 1; k < K; k++) sum -= L[k * K + i] * z[k]; z[i] = sum / L[i * K + i]; }
    for (let i = 0; i < K; i++) Rec[i * rows + r] = z[i];
  }
  return Rec;
}

// Poisson deviate (Knuth for small means, normal approximation above 30).
function poisson(mu, rand) {
  if (mu <= 0) return 0;
  if (mu > 30) { const g = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand()); return Math.max(0, Math.round(mu + Math.sqrt(mu) * g)); }
  const L = Math.exp(-mu);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

// Shack–Hartmann measurement of an OPD map (nm). Each lenslet's field A e^{iφ} is zero-padded
// to M × M and Fourier transformed, so a pixel of its spot image subtends λ/(M·dx). The spot
// receives nph · frac photons; photon noise, Gaussian read noise ron (e⁻) and a threshold of
// max(3 ron, 2 % of the peak) precede the centre-of-gravity estimate. o = { nph, ron, rand,
// image: true to return the detector mosaic }. Slopes are rad of phase per pupil pixel.
export function shMeasure(sys, opd, o = {}) {
  const { Np, s, M, pupil, valid, lam } = sys, V = valid.length, slopes = new Float64Array(2 * V);
  const re = new Float64Array(M * M), im = new Float64Array(M * M), k = (2 * Math.PI) / lam;
  const img = o.image ? new Float32Array(sys.nsub * M * sys.nsub * M) : null, W = sys.nsub * M;
  const noisy = o.nph > 0 && o.rand;
  valid.forEach((v, n) => {
    re.fill(0); im.fill(0);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const p = (v.y0 + y) * Np + v.x0 + x;
      if (!pupil[p]) continue;
      const ph = k * opd[p];
      re[y * M + x] = Math.cos(ph); im[y * M + x] = Math.sin(ph);
    }
    fft2d(re, im, M, false);
    let tot = 0;
    for (let q = 0; q < M * M; q++) { re[q] = re[q] * re[q] + im[q] * im[q]; tot += re[q]; }
    // fftshift into im[] (reused as the spot image), scaled to photons
    const scale = noisy ? (o.nph * v.frac) / tot : 1 / tot;
    let pk = 0;
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      const val = re[((y + M / 2) % M) * M + ((x + M / 2) % M)] * scale;
      im[y * M + x] = val;
      if (val > im[pk]) pk = y * M + x;
    }
    // thresholded centre of gravity in a window of ±M/4 around the spot's peak (periodic
    // coordinates), so that the far sidelobes of the square-lenslet spot cannot bias it. Photon
    // and read noise are drawn for the window pixels (and for the whole spot image when it is
    // displayed); the window is placed on the noise-free peak.
    const px = pk % M, py = (pk / M) | 0, hw = M >> 2;
    const noise = (val) => poisson(val, o.rand) + (o.ron ? o.ron * Math.sqrt(-2 * Math.log(o.rand())) * Math.cos(2 * Math.PI * o.rand()) : 0);
    if (noisy) {
      if (img) for (let q = 0; q < M * M; q++) im[q] = noise(im[q]);
      else for (let dy = -hw; dy <= hw; dy++) for (let dx = -hw; dx <= hw; dx++) { const q = ((py + dy + M) % M) * M + ((px + dx + M) % M); im[q] = noise(im[q]); }
    }
    let peak = 0;
    for (let dy = -hw; dy <= hw; dy++) for (let dx = -hw; dx <= hw; dx++) peak = Math.max(peak, im[((py + dy + M) % M) * M + ((px + dx + M) % M)]);
    const thr = noisy ? Math.max(3 * (o.ron || 0), 0.02 * peak) : 0;
    let sw = 0, sx = 0, sy = 0;
    for (let dy = -hw; dy <= hw; dy++) for (let dx = -hw; dx <= hw; dx++) {
      const w = im[((py + dy + M) % M) * M + ((px + dx + M) % M)] - thr;
      if (w <= 0) continue;
      sw += w; sx += w * (px + dx); sy += w * (py + dy);
    }
    const cx = sw > 0 ? sx / sw - M / 2 : 0, cy = sw > 0 ? sy / sw - M / 2 : 0;
    slopes[n] = (2 * Math.PI * cx) / M; slopes[V + n] = (2 * Math.PI * cy) / M;
    if (img) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) img[(v.j * M + y) * W + v.i * M + x] = im[y * M + x];
  });
  return { slopes, img, W };
}

// Modal coefficients (nm RMS) from slopes, and the OPD map they describe.
export function reconstruct(sys, slopes) {
  const K = sys.modes.length, rows = slopes.length, a = new Float64Array(K);
  for (let i = 0; i < K; i++) { let sum = 0; for (let r = 0; r < rows; r++) sum += sys.Rec[i * rows + r] * slopes[r]; a[i] = sum; }
  return a;
}
export function modalMap(sys, a, out) {
  const N = sys.Np * sys.Np, m = out || new Float64Array(N);
  if (!out) m.fill(0);
  for (let i = 0; i < a.length; i++) { const z = sys.modes[i], c = a[i]; if (c) for (let p = 0; p < N; p++) m[p] += c * z[p]; }
  return m;
}

// RMS (nm) of an OPD map over the pupil with piston removed.
export function rmsOPD(sys, opd) {
  let s = 0, s2 = 0, n = 0;
  for (let p = 0; p < opd.length; p++) if (sys.pupil[p]) { s += opd[p]; s2 += opd[p] * opd[p]; n++; }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
}

// Least-squares projection of an OPD map on the sensor's modes (the best a modal DM can do).
// The inverse Gram matrix of the sampled modes is computed once per sensor and cached.
export function projectModes(sys, opd) {
  const K = sys.modes.length, N = opd.length;
  if (!sys.Ginv) {
    const A = Array.from({ length: K }, () => new Float64Array(2 * K));
    for (let a = 0; a < K; a++) {
      const za = sys.modes[a];
      for (let b = a; b < K; b++) { let t = 0; const zb = sys.modes[b]; for (let p = 0; p < N; p++) t += za[p] * zb[p]; A[a][b] = A[b][a] = t; }
      A[a][K + a] = 1;
    }
    for (let c = 0; c < K; c++) {
      let piv = c; for (let r = c + 1; r < K; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c][c]; for (let q = 0; q < 2 * K; q++) A[c][q] /= d;
      for (let r = 0; r < K; r++) if (r !== c) { const f = A[r][c]; if (f) for (let q = 0; q < 2 * K; q++) A[r][q] -= f * A[c][q]; }
    }
    sys.Ginv = A.map((row) => row.slice(K));
  }
  const b = new Float64Array(K);
  for (let i = 0; i < K; i++) { const z = sys.modes[i]; let t = 0; for (let p = 0; p < N; p++) if (sys.pupil[p]) t += z[p] * opd[p]; b[i] = t; }
  return Float64Array.from(sys.Ginv, (row) => row.reduce((acc, g, k) => acc + g * b[k], 0));
}

// Noise propagation: variance of the reconstructed wavefront (nm²) per unit slope variance, =
// Σ over modes of the squared reconstructor rows (modes are orthonormal over the pupil).
export function noisePropagation(sys) {
  let s = 0;
  for (let i = 0; i < sys.Rec.length; i++) s += sys.Rec[i] ** 2;
  return s;
}

// Noll (1976) residual variance after removing the first J Zernike modes, in units of (D/r0)^(5/3).
const NOLL = [1.0299, 0.582, 0.134, 0.111, 0.088, 0.0648, 0.0587, 0.0525, 0.0463, 0.0401, 0.0377, 0.0352, 0.0328, 0.0304, 0.0279, 0.0267, 0.0255, 0.0243, 0.0232, 0.022, 0.0208];
export const nollResidual = (J) => (J <= 21 ? NOLL[J - 1] : 0.2944 * Math.pow(J, -Math.sqrt(3) / 2));

// ── A closed AO loop on frozen-flow turbulence ──────────────────────────────────────────────
// Persistent simulator: configure() keeps the sensor (rebuilt only when the lenslet count or the
// number of modes changes) and the mirror state; run() advances the loop for a time budget and
// returns the last frame for display. All maps are OPD in nm on the Np² pupil grid.

export function createLoop({ Np = 120, NS = 512, D = 8, lamWFS = 600, Npsf = 256, seed = 11 } = {}) {
  const dx = D / Np, base = phaseScreen(NS, dx, 0.1, 25, seed);
  let sys = null, sysKey = '', noiseKey = '', noiseVar = 0, st = null, kScr = 1;
  let shift = 0, t = 0, steps = 0, cmd = null, dm = new Float64Array(Np * Np), long = null, longN = 0, hist = [];
  let s = 987654321;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  const turbulence = () => {
    const out = new Float64Array(Np * Np), s0 = Math.floor(shift), f = shift - s0;
    for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
      const sx = (((x + s0) % NS) + NS) % NS, sx1 = (sx + 1) % NS, sy = y + NS / 4;
      out[y * Np + x] = (base[sy * NS + sx] * (1 - f) + base[sy * NS + sx1] * f) * kScr;
    }
    return out;
  };
  function configure(p) {
    st = p;
    const key = p.nsub + '|' + p.J;
    if (key !== sysKey) { sys = makeSH({ Np, nsub: p.nsub, J: p.J, lam: lamWFS }); sysKey = key; cmd = new Float64Array(sys.modes.length); dm.fill(0); }
    const nKey = key + '|' + p.nph + '|' + p.ron;
    if (nKey !== noiseKey) {
      let v = 0, n = 0;
      for (let k = 0; k < 4; k++) shMeasure(sys, new Float64Array(Np * Np), { nph: p.nph, ron: p.ron, rand }).slopes.forEach((q) => { v += q * q; n++; });
      noiseVar = v / n; noiseKey = nKey;
    }
    // turbulence screen generated at r₀ = 0.1 m (rad at 500 nm): rescale to r₀ and convert to nm
    kScr = Math.pow(p.r0 / 0.1, -5 / 6) * (500 / (2 * Math.PI));
    if (p.loop === 'open') { cmd.fill(0); dm.fill(0); }
    long = null; longN = 0;
    if (p.reset) { hist = []; t = 0; steps = 0; cmd.fill(0); dm.fill(0); }
    return { valid: sys.valid.length, modes: sys.modes.length, nsub: sys.nsub, noiseVar, prop: noisePropagation(sys) };
  }
  function step(display) {
    const turb = turbulence(), res = new Float64Array(Np * Np);
    for (let q = 0; q < res.length; q++) res[q] = turb[q] - dm[q];
    const meas = shMeasure(sys, res, { nph: st.nph, ron: st.ron, rand, image: display });
    if (st.loop === 'closed') {
      const a = reconstruct(sys, meas.slopes);
      for (let i = 0; i < a.length; i++) cmd[i] += st.gain * a[i];
      dm.fill(0); modalMap(sys, cmd, dm); // applied from the next frame on (one frame of delay)
    }
    const rmsT = rmsOPD(sys, turb), rmsR = rmsOPD(sys, res);
    hist.push([t, rmsT, rmsR]);
    if (hist.length > 600) hist.shift();
    t += 1 / st.fs; shift += st.wind / (st.fs * dx); steps++;
    return { turb, res, meas };
  }
  // science PSF of a residual at λ (pupil in an Npsf² grid), normalised to the perfect peak
  function psfOf(res, lam) {
    const re = new Float64Array(Npsf * Npsf), im = new Float64Array(Npsf * Npsf), o = (Npsf - Np) / 2, k = (2 * Math.PI) / lam;
    let n = 0;
    for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) { const q = y * Np + x; if (!sys.pupil[q]) continue; n++; const r = (y + o) * Npsf + x + o; re[r] = Math.cos(k * res[q]); im[r] = Math.sin(k * res[q]); }
    fft2d(re, im, Npsf, false);
    const I = new Float64Array(Npsf * Npsf), n2 = n * n;
    for (let q = 0; q < I.length; q++) I[q] = (re[q] * re[q] + im[q] * im[q]) / n2;
    return I;
  }
  function run(ms) {
    const t0 = Date.now();
    let f = null, k = 0;
    do {
      const disp = Date.now() - t0 > ms * 0.75 || k > 400;
      f = step(disp);
      // a few PSFs per batch build the long exposure from decorrelated frames
      if (disp || k % 5 === 0) {
        const I = psfOf(f.res, st.lsci);
        if (!long) long = new Float64Array(I.length);
        for (let q = 0; q < I.length; q++) long[q] += I[q];
        longN++;
        f.I = I;
      }
      k++;
      if (disp) break;
    } while (true);
    return {
      turb: Float32Array.from(f.turb), res: Float32Array.from(f.res), dm: Float32Array.from(dm), img: f.meas.img, W: f.meas.W, I: Float32Array.from(f.I),
      long: Float32Array.from(long, (v) => v / longN), longN, hist: hist.slice(), steps, t, batch: k,
      coefT: projectModes(sys, f.turb), coefR: projectModes(sys, f.res), pupil: sys.pupil,
    };
  }
  return { configure, run };
}

// ── Pyramid wavefront sensor ────────────────────────────────────────────────────────────────
// The pupil field (Np px across, in an N × N grid) is focused by an FFT onto the tip of a
// four-sided glass pyramid, whose phase 2π·sh·(|k_x| + |k_y|)/N deflects each quadrant of the
// focal plane by ±sh pixels, and re-imaged by an inverse FFT into four pupil images. Circular
// modulation of radius rmod (λ/D) averages K tilted copies. phase: Float64Array(Np²) in rad.
// Returns the detector image, the slope maps Sx, Sy over the pupil, and their pupil means.
export function pyramidWFS(phase, { Np = 32, N = 128, sh = 24, rmod = 0, K = 0 } = {}) {
  const R = Np / 2, c = N / 2, steps = rmod > 0 ? Math.max(8, K || 4 * Math.ceil((2 * Math.PI * rmod) / 4)) : 1; // multiple of 4: symmetric ring
  const img = new Float64Array(N * N), re = new Float64Array(N * N), im = new Float64Array(N * N);
  const mask = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const kx = x < N / 2 ? x : x - N, ky = y < N / 2 ? y : y - N;
    mask[y * N + x] = (2 * Math.PI * sh * (Math.abs(kx) + Math.abs(ky))) / N;
  }
  const inside = new Uint8Array(Np * Np);
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) inside[y * Np + x] = Math.hypot(x + 0.5 - R, y + 0.5 - R) <= R ? 1 : 0;
  for (let k = 0; k < steps; k++) {
    const t = (2 * Math.PI * k) / steps, ax = rmod * Math.cos(t), ay = rmod * Math.sin(t);
    re.fill(0); im.fill(0);
    for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
      if (!inside[y * Np + x]) continue;
      const ph = phase[y * Np + x] + (2 * Math.PI * (ax * (x - R) + ay * (y - R))) / Np, q = (y + c - R) * N + x + c - R;
      re[q] = Math.cos(ph); im[q] = Math.sin(ph);
    }
    fft2d(re, im, N, false);
    for (let q = 0; q < N * N; q++) { const cm = Math.cos(mask[q]), sm = Math.sin(mask[q]), a = re[q], b = im[q]; re[q] = a * cm - b * sm; im[q] = a * sm + b * cm; }
    fft2d(re, im, N, true);
    for (let q = 0; q < N * N; q++) img[q] += (re[q] * re[q] + im[q] * im[q]) / steps;
  }
  // four pupil images centred at (c ± sh, c ± sh), periodic
  const quad = (qx, qy, x, y) => img[(((c + qy * sh + y - R) % N + N) % N) * N + (((c + qx * sh + x - R) % N + N) % N)];
  const Sx = new Float64Array(Np * Np), Sy = new Float64Array(Np * Np);
  let tot = 0, n = 0;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) if (inside[y * Np + x]) { tot += quad(1, 1, x, y) + quad(-1, 1, x, y) + quad(1, -1, x, y) + quad(-1, -1, x, y); n++; }
  const mean = tot / n;
  let mx = 0, my = 0;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
    if (!inside[y * Np + x]) continue;
    const a = quad(1, 1, x, y), b = quad(-1, 1, x, y), cc = quad(1, -1, x, y), d = quad(-1, -1, x, y), p = y * Np + x;
    // signs chosen so that a positive tilt along x (y) gives a positive Sx (Sy)
    Sx[p] = (b + d - a - cc) / mean; Sy[p] = (cc + d - a - b) / mean;
    mx += Sx[p]; my += Sy[p];
  }
  return { img, Sx, Sy, mx: mx / n, my: my / n, inside, steps };
}

// Geometric-optics response of a modulated pyramid to a tilt θ (λ/D) with modulation radius R:
// S = (2/π) asin(θ/R) inside the modulation circle, ±1 outside.
export const pyramidGeometric = (theta, R) => (Math.abs(theta) >= R ? Math.sign(theta) : (2 / Math.PI) * Math.asin(theta / R));
