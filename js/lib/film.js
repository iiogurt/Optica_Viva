// Photographic film as a stochastic detector. The emulsion is modelled as L independent layers of
// randomly placed (Poisson) circular silver-halide grains of radius r. A grain becomes developable
// when it absorbs at least `hits` photons (Poisson with mean H·πr²·q). Developed grains are
// opaque discs, so each layer transmits the uncovered fraction (Boolean model) and the optical
// density follows Nutting's law D = 0.434 N a at low coverage.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
}
const poissonCDF = (mu, k) => { let t = Math.exp(-mu), s = t; for (let i = 1; i < k; i++) { t *= mu / i; s += t; } return s; };

// Probability that a grain of radius r (µm) is developable at exposure H (photons/µm²).
export const pDevelop = (H, r, q = 0.1, hits = 2) => 1 - poissonCDF(H * Math.PI * r * r * q, hits);

// Grain radii are log-normal (median r, log-standard deviation sig): large grains catch photons
// first, which spreads the sensitivity over a wide exposure range and sets the film's latitude.
// Gauss–Hermite-like quadrature over 24 radius classes.
const ZMAX = 2.5; // the size distribution is truncated at ±2.5σ (sampler and quadrature alike)
const Q = Array.from({ length: 24 }, (_, i) => { const z = -ZMAX + (2 * ZMAX * (i + 0.5)) / 24; return [z, Math.exp(-0.5 * z * z)]; });
const QS = Q.reduce((a, q) => a + q[1], 0);
// Mean density (Boolean model, exact for independent layers): each layer transmits
// exp(−n ⟨p πr²⟩), so D = 0.434 L n ⟨p πr²⟩ + fog (Nutting's law at low coverage).
export function meanDensity(H, f) {
  let s = 0;
  for (const [z, w] of Q) { const r = f.r * Math.exp(f.sig * z); s += (w / QS) * pDevelop(H, r, f.q, f.hits) * Math.PI * r * r; }
  return 0.4343 * f.layers * f.n * s + f.fog;
}
// Mean grain area ⟨πr²⟩ of the (truncated) log-normal distribution.
export const meanArea = (f) => Q.reduce((a, [z, w]) => a + (w / QS) * Math.PI * (f.r * Math.exp(f.sig * z)) ** 2, 0);

// Film stocks: grain size grows with speed (speed ∝ grain area); the number of grains is set so
// that the maximum density is ≈ 2.4 above fog. Values are representative, not of a product.
export function stock(iso, sig = 0.55) {
  const f = { iso, r: 0.12 * Math.sqrt(iso / 100), sig, layers: 6, q: 0.1, hits: 2, fog: 0.15 };
  f.n = 2.4 / (0.4343 * f.layers * meanArea(f));
  return f;
}

// Render a patch of film (W×W pixels of `px` µm) exposed to H(x, y) photons/µm²: grains are
// placed layer by layer and rasterised (anti-aliased by 2×2 subsampling) into the transmittance.
// Returns optical density per pixel.
export function exposeFilm(Hmap, W, px, f, seed = 1) {
  const r = rng(seed), T = new Float32Array(W * W).fill(1), area = (W * px) ** 2;
  const gz = () => { for (;;) { const z = Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r()); if (Math.abs(z) <= ZMAX) return z; } };
  for (let L = 0; L < f.layers; L++) {
    const cover = new Float32Array(W * W), N = Math.round(f.n * area);
    for (let g = 0; g < N; g++) {
      const x = r() * W, y = r() * W, H = Hmap[Math.min(W - 1, y | 0) * W + Math.min(W - 1, x | 0)], rg = f.r * Math.exp(f.sig * gz()), rr = rg / px;
      if (r() >= pDevelop(H, rg, f.q, f.hits)) continue;
      const x0 = Math.max(0, Math.floor(x - rr)), x1 = Math.min(W - 1, Math.ceil(x + rr)), y0 = Math.max(0, Math.floor(y - rr)), y1 = Math.min(W - 1, Math.ceil(y + rr));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        let c = 0;
        for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if ((xx + sx - x) ** 2 + (yy + sy - y) ** 2 <= rr * rr) c += 0.25;
        if (c) cover[yy * W + xx] = Math.min(1, cover[yy * W + xx] + c * (1 - cover[yy * W + xx]));
      }
    }
    for (let k = 0; k < W * W; k++) T[k] *= 1 - cover[k];
  }
  const D = new Float32Array(W * W), fogT = Math.pow(10, -f.fog);
  for (let k = 0; k < W * W; k++) D[k] = -Math.log10(Math.max(1e-6, T[k] * fogT));
  return D;
}

// RMS density fluctuation measured with square apertures of side s pixels (Selwyn: σ_D √A const).
export function granularity(D, W, s) {
  const vals = [];
  for (let y = 0; y + s <= W; y += s) for (let x = 0; x + s <= W; x += s) {
    let t = 0; for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) t += Math.pow(10, -D[(y + j) * W + x + i]);
    vals.push(-Math.log10(t / (s * s)));
  }
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
}

// Schwarzschild reciprocity failure: effective exposure I·t^p for t beyond t0 (p < 1). Corrected
// exposure time that gives the same density as a metered time t.
export const reciprocityCorrection = (t, p = 0.8, t0 = 1) => (t <= t0 ? t : t0 * Math.pow(t / t0, 1 / p));

// Selwyn granularity G = σ_D √A (µm), exact for the Boolean model and apertures much larger than
// the grains. For one layer of developed grains (intensity n p(r)), the covariance of the
// transmittance is T²(e^{K(h)} − 1) with K(h) the expected overlap area of two grains a
// distance h apart, so σ_T² A = T² ∫(e^{K(h)} − 1) d²h and σ_D = σ_T/(T ln 10). Layers add.
export function selwyn(H, f) {
  const cls = Q.map(([z, w]) => { const r = f.r * Math.exp(f.sig * z); return [r, (w / QS) * f.n * pDevelop(H, r, f.q, f.hits)]; });
  const rmax = Math.max(...cls.map((c) => c[0])), steps = 400;
  let integ = 0;
  for (let i = 0; i < steps; i++) {
    const h = ((i + 0.5) / steps) * 2 * rmax;
    let K = 0;
    for (const [r, nr] of cls) if (h < 2 * r) K += nr * (2 * r * r * Math.acos(h / (2 * r)) - (h / 2) * Math.sqrt(4 * r * r - h * h));
    integ += (Math.exp(K) - 1) * 2 * Math.PI * h * ((2 * rmax) / steps);
  }
  return Math.sqrt(f.layers * integ) / Math.LN10;
}

// Detective quantum efficiency at exposure H (photons/µm²) from the film's gradient and its
// granularity σ_D measured with aperture area A (µm²): DQE = (γ log₁₀e)² / (H A σ_D²),
// γ = dD/dlog₁₀H (Dainty & Shaw 1974).
export function dqe(H, f, sigmaD, A) {
  const g = (meanDensity(H * 1.05, f) - meanDensity(H / 1.05, f)) / (2 * Math.log10(1.05));
  return (g * Math.LOG10E) ** 2 / (H * A * sigmaD * sigmaD);
}

// Speed point: exposure giving D = 0.1 above fog (ISO speed is inversely proportional to it).
export function speedPoint(f) {
  let lo = -4, hi = 6;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; meanDensity(10 ** mid, f) - f.fog < 0.1 ? (lo = mid) : (hi = mid); }
  return 10 ** ((lo + hi) / 2);
}

// Lab pipeline (worker): a step wedge of 8 exposures 0.3 log units apart around H0·2^ev, and the
// granularity (Selwyn, analytic) and DQE at H0·2^ev for a circular aperture of diameter ap (µm).
export function filmLab(o) {
  const f = stock(o.iso, o.sig), W = o.W, px = 0.25, H0 = o.H0 * Math.pow(2, o.ev);
  const Hw = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) Hw[y * W + x] = H0 * Math.pow(10, 0.3 * (Math.floor((x / W) * 8) - 3.5));
  const wedge = exposeFilm(Hw, W, px, f, o.seed || 1);
  const G = selwyn(H0, f), A = Math.PI * (o.ap / 2) ** 2, sigma = G / Math.sqrt(A);
  return { wedge, W, f, sigma, G, A, dqe: dqe(H0, f, sigma, A), Dmid: meanDensity(H0, f), H0, px };
}
