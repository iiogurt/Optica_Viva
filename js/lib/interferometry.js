// Interferometry: fringe visibility of extended sources (van Cittert–Zernike), Earth-rotation
// aperture synthesis (u-v coverage of real array layouts), the dirty beam and image, and
// Högbom CLEAN. Angles in radians, baselines in metres, u-v in wavelengths.
import { fft2d } from './fft.js';
import { besselJ1 } from './pupil.js';

const MAS = Math.PI / 180 / 3600 / 1000;
export { MAS };

// Visibility of a uniformly bright disk of angular diameter θ on a baseline B at wavelength λ.
export function diskVisibility(theta, B, lam) {
  const x = (Math.PI * theta * B) / lam;
  return x < 1e-9 ? 1 : Math.abs((2 * besselJ1(x)) / x);
}
// Baseline of the first visibility null for a uniform disk: B₀ = 1.22 λ/θ (J₁ zero 3.8317/π).
export const firstNull = (theta, lam) => (3.8317 / Math.PI) * (lam / theta);

// Fringe pattern of two pinholes separated by B, observed at angle x on the sky, for a disk star
// of diameter θ: the incoherent sum of the fringes of every point of the disk (numerical).
export function fringes(B, lam, theta, xs, nStar = 400) {
  const out = new Float64Array(xs.length);
  let wsum = 0;
  for (let k = 0; k < nStar; k++) {
    // sample the disk uniformly in area: offset along the baseline direction with weight √(1 − s²)
    const s = -1 + (2 * (k + 0.5)) / nStar, w = Math.sqrt(Math.max(0, 1 - s * s)), a = (s * theta) / 2;
    wsum += w;
    for (let i = 0; i < xs.length; i++) out[i] += w * (1 + Math.cos((2 * Math.PI * B * (xs[i] - a)) / lam));
  }
  for (let i = 0; i < xs.length; i++) out[i] /= wsum;
  return out;
}
export function fringeVisibility(I) { let mx = -Infinity, mn = Infinity; for (const v of I) { if (v > mx) mx = v; if (v < mn) mn = v; } return (mx - mn) / (mx + mn); }

// ── Arrays ──────────────────────────────────────────────────────────────────────────────────
// Local east/north offsets (m) at latitude lat, or Earth-centred stations (lat, lon in degrees).
function vlaLike() {
  const st = [], arms = [5, 125, 245];
  for (const az of arms) for (let i = 1; i <= 9; i++) { const r = 1030 * Math.pow(i / 9, 1.716), a = (az * Math.PI) / 180; st.push([r * Math.sin(a), r * Math.cos(a)]); }
  return st;
}
export const ARRAYS = {
  vla: { name: 'VLA-like, D configuration (27 antennas, 1 km Y)', lat: 34.08, enu: vlaLike(), lam: 0.06, dec: 40 },
  vlti: { name: 'VLTI, four 8.2 m Unit Telescopes (approximate stations)', lat: -24.63, enu: [[-9.9, -20.3], [14.9, 30.5], [44.9, 66.2], [103.3, 44.0]], lam: 2.2e-6, dec: -30 },
  eht: { name: 'Event Horizon Telescope 2017 (8 stations, Earth-sized)', geo: [[-23.03, -67.75, 'ALMA'], [-23.01, -67.76, 'APEX'], [19.82, -155.48, 'JCMT'], [19.82, -155.48, 'SMA'], [18.99, -97.31, 'LMT'], [32.70, -109.89, 'SMT'], [37.07, -3.39, 'IRAM 30 m'], [-90, 0, 'SPT']], lam: 1.3e-3, dec: 12.39 },
};
const R_EARTH = 6.371e6;
const toXYZ = (lat, lon) => { const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180; return [R_EARTH * Math.cos(p) * Math.cos(l), R_EARTH * Math.cos(p) * Math.sin(l), R_EARTH * Math.sin(p)]; };

// u-v points (wavelengths) sampled over hour angles H (rad) for an array and declination δ (rad).
// ENU arrays use local equatorial baselines X = −sinφ N, Y = E, Z = cosφ N; geocentric arrays use
// station ECEF positions with the Greenwich hour angle, and both stations must see the source
// above `minEl`. Returns [[u, v], …] including the conjugate points.
export function uvCoverage(arr, dec, hours, steps = 48, minEl = (15 * Math.PI) / 180) {
  const pts = [], sd = Math.sin(dec), cd = Math.cos(dec);
  const uvOf = (X, Y, Z, H) => [(Math.sin(H) * X + Math.cos(H) * Y) / arr.lam, (-sd * Math.cos(H) * X + sd * Math.sin(H) * Y + cd * Z) / arr.lam];
  if (arr.enu) {
    const phi = (arr.lat * Math.PI) / 180, P = arr.enu;
    for (let s = 0; s < steps; s++) {
      const H = (-hours / 2 + (hours * (s + 0.5)) / steps) * (Math.PI / 12);
      const el = Math.asin(Math.sin(phi) * sd + Math.cos(phi) * cd * Math.cos(H));
      if (el < minEl) continue;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const E = P[j][0] - P[i][0], N = P[j][1] - P[i][1];
        const [u, v] = uvOf(-Math.sin(phi) * N, E, Math.cos(phi) * N, H);
        pts.push([u, v], [-u, -v]);
      }
    }
  } else {
    const xyz = arr.geo.map(([la, lo]) => toXYZ(la, lo));
    for (let s = 0; s < steps; s++) {
      const HG = (2 * Math.PI * s) / steps; // a full day of Greenwich hour angle
      const visible = arr.geo.map(([la, lo]) => { const p = (la * Math.PI) / 180, Hl = HG + (lo * Math.PI) / 180; return Math.asin(Math.sin(p) * sd + Math.cos(p) * cd * Math.cos(Hl)) > minEl; });
      for (let i = 0; i < xyz.length; i++) for (let j = i + 1; j < xyz.length; j++) {
        if (!visible[i] || !visible[j]) continue;
        const X = xyz[j][0] - xyz[i][0], Y = xyz[j][1] - xyz[i][1], Z = xyz[j][2] - xyz[i][2];
        if (Math.hypot(X, Y, Z) < 1000) continue; // co-located stations (ALMA–APEX, JCMT–SMA) add only short spacings
        const [u, v] = uvOf(X, Y, Z, -HG);
        pts.push([u, v], [-u, -v]);
      }
    }
  }
  return pts;
}

// ── Sky models (N×N, pixel Δ rad) ───────────────────────────────────────────────────────────
export function skyModel(kind, N, delta, scale) {
  const I = new Float64Array(N * N), c = N / 2;
  const put = (x, y, f) => { const i = Math.round(c + x / delta), j = Math.round(c - y / delta); if (i >= 0 && i < N && j >= 0 && j < N) I[j * N + i] += f; };
  if (kind === 'binary') { put(-0.6 * scale, 0.2 * scale, 1); put(0.5 * scale, -0.3 * scale, 0.6); }
  else if (kind === 'ring') {
    // crescent: ring of diameter `scale` brighter on one side (an M87*-like shadow)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i - c) * delta, y = (c - j) * delta, r = Math.hypot(x, y), w = scale * 0.12;
      const ring = Math.exp(-0.5 * ((r - scale / 2) / (w / 2.35)) ** 2) * (1 + 0.8 * Math.cos(Math.atan2(y, x) + Math.PI / 2));
      I[j * N + i] += ring;
    }
  } else if (kind === 'jet') {
    put(0, 0, 1);
    for (let k = 1; k <= 30; k++) put(0.04 * k * scale, 0.02 * k * scale, 0.25 * Math.exp(-k / 12));
  } else { // 'disk': uniform stellar disk of diameter `scale`
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (Math.hypot(i - c, j - c) * delta <= scale / 2) I[j * N + i] = 1;
  }
  let s = 0; for (const v of I) s += v; for (let k = 0; k < I.length; k++) I[k] /= s;
  return I;
}

// Grid the u-v points into an N×N sampling function (cell size 1/(N Δ) wavelengths), uniform or
// natural weighting; returns the weights (in FFT order) and the fraction of points on the grid.
function gridUV(pts, N, delta, natural) {
  const W = new Float64Array(N * N), du = 1 / (N * delta);
  let n = 0;
  for (const [u, v] of pts) {
    const iu = Math.round(u / du), iv = Math.round(v / du);
    if (Math.abs(iu) >= N / 2 || Math.abs(iv) >= N / 2) continue;
    const k = ((iv + N) % N) * N + ((iu + N) % N);
    W[k] = natural ? W[k] + 1 : 1; n++;
  }
  return { W, onGrid: n / Math.max(1, pts.length) };
}
const shift = (a, N) => { const o = new Float64Array(N * N), h = N / 2; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) o[((y + h) % N) * N + ((x + h) % N)] = a[y * N + x]; return o; };

// Dirty beam and dirty image: inverse FFT of the weighted sampled visibilities.
export function synthesize(sky, pts, N, delta, natural = false) {
  const { W, onGrid } = gridUV(pts, N, delta, natural);
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) re[k] = sky[k];
  // sky is centred: shift to FFT origin, transform, sample, transform back, shift
  const sre = shift(re, N), sim = new Float64Array(N * N);
  fft2d(sre, sim, N);
  let wsum = 0; for (const w of W) wsum += w;
  const dre = new Float64Array(N * N), dim = new Float64Array(N * N), bre = Float64Array.from(W), bim = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) { dre[k] = sre[k] * W[k]; dim[k] = sim[k] * W[k]; }
  fft2d(dre, dim, N, true); fft2d(bre, bim, N, true);
  const dirty = shift(dre, N), beam = shift(bre, N), b0 = beam[(N / 2) * N + N / 2] || 1;
  for (let k = 0; k < N * N; k++) { beam[k] /= b0; dirty[k] /= b0; }
  return { dirty, beam, onGrid, wsum };
}

// Högbom CLEAN: repeatedly subtract a scaled, shifted dirty beam at the residual peak.
// Restore with a circular Gaussian of FWHM `fwhm` pixels. Returns components, residual, restored.
export function clean(dirty, beam, N, { gain = 0.1, niter = 500, threshold = 0, fwhm = 3, box = null } = {}) {
  const res = Float64Array.from(dirty), comps = [], c = N / 2;
  for (let it = 0; it < niter; it++) {
    let pk = -Infinity, pi = 0;
    for (let k = 0; k < N * N; k++) { if (box && !box[k]) continue; if (res[k] > pk) { pk = res[k]; pi = k; } }
    if (pk <= threshold) break;
    const px = pi % N, py = (pi / N) | 0, a = gain * pk;
    comps.push([px, py, a]);
    for (let y = 0; y < N; y++) { const by = y - py + c; if (by < 0 || by >= N) continue; for (let x = 0; x < N; x++) { const bx = x - px + c; if (bx < 0 || bx >= N) continue; res[y * N + x] -= a * beam[by * N + bx]; } }
  }
  const restored = Float64Array.from(res), s2 = (fwhm / 2.3548) ** 2, R = Math.ceil(3 * fwhm);
  for (const [px, py, a] of comps) for (let y = Math.max(0, py - R); y <= Math.min(N - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(N - 1, px + R); x++) restored[y * N + x] += a * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * s2));
  return { comps, residual: res, restored };
}

// Lab pipeline (worker): coverage, synthesis and CLEAN for one array/source.
export function aperturePipeline(o) {
  const arr = ARRAYS[o.array], dec = (o.dec * Math.PI) / 180, pts = uvCoverage(arr, dec, o.hours, o.steps || 48);
  let bmax = 0; for (const [u, v] of pts) bmax = Math.max(bmax, Math.hypot(u, v));
  const N = o.N || 128, res = 1 / Math.max(bmax, 1), delta = res / 3; // 3 pixels per λ/B_max
  const sky = skyModel(o.sky, N, delta, o.scale * res);
  const syn = synthesize(sky, pts, N, delta, o.natural);
  const cl = clean(syn.dirty, syn.beam, N, { gain: 0.1, niter: o.niter ?? 300, threshold: 0.002 * Math.max(...syn.dirty), fwhm: 3 });
  return { N, delta, res, bmax, uv: pts.slice(0, 20000), sky: Float32Array.from(sky), dirty: Float32Array.from(syn.dirty), beam: Float32Array.from(syn.beam), restored: Float32Array.from(cl.restored), ncomp: cl.comps.length, onGrid: syn.onGrid };
}
