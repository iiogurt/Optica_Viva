// Fourier-optics core: aperture (pupil) synthesis, Zernike polynomials, monochromatic and
// polychromatic PSFs via the Fraunhofer integral  I(u) ∝ |𝔽{P(x) e^{i2πW(x)/λ}}|².

import { fft2d } from './fft.js';
import { spectralBasis } from './color.js';

// ── Special functions ───────────────────────────────────────────────────────────────────
// Bessel J1 (Numerical Recipes rational/asymptotic approximation, |ε| < 1e-8)
export function besselJ1(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
    const b = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a / b;
  }
  const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
  const a = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
  const b = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b);
  return x < 0 ? -ans : ans;
}
// Airy pattern for an annular aperture of obscuration ε, normalised to the unobscured peak.
export function airy(v, eps = 0) {
  if (Math.abs(v) < 1e-9) return (1 - eps * eps) ** 2;
  const a = 2 * besselJ1(v) / v;
  const b = eps > 0 ? eps * eps * 2 * besselJ1(eps * v) / (eps * v) : 0;
  return (a - b) ** 2;
}
// Diffraction-limited MTF of a clear circular pupil, ν̂ = ν/ν_c
export function mtfDiffraction(nu) {
  if (nu >= 1) return 0;
  return (2 / Math.PI) * (Math.acos(nu) - nu * Math.sqrt(1 - nu * nu));
}

// ── Zernike polynomials (Noll ordering and normalisation: ⟨Z_j²⟩ = 1 over the unit disk) ──
export function noll(j) {
  let n = 0;
  while (((n + 1) * (n + 2)) / 2 < j) n++;
  const k = j - (n * (n + 1)) / 2 - 1;
  const m = n % 2 === 0 ? 2 * Math.floor((k + 1) / 2) : 2 * Math.floor(k / 2) + 1;
  return { n, m, even: j % 2 === 0 };
}
const fact = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
export function zernikeRadial(n, m, rho) {
  let s = 0;
  for (let k = 0; k <= (n - m) / 2; k++) {
    s += ((k % 2 ? -1 : 1) * fact(n - k)) / (fact(k) * fact((n + m) / 2 - k) * fact((n - m) / 2 - k)) * Math.pow(rho, n - 2 * k);
  }
  return s;
}
export function zernike(j, rho, theta) {
  const { n, m, even } = noll(j);
  if (m === 0) return Math.sqrt(n + 1) * zernikeRadial(n, 0, rho);
  const ang = even ? Math.cos(m * theta) : Math.sin(m * theta);
  return Math.sqrt(2 * (n + 1)) * zernikeRadial(n, m, rho) * ang;
}
export const ZERNIKE_NAMES = {
  1: 'Piston', 2: 'Tilt X', 3: 'Tilt Y', 4: 'Defocus', 5: 'Oblique astigmatism', 6: 'Vertical astigmatism',
  7: 'Vertical coma', 8: 'Horizontal coma', 9: 'Vertical trefoil', 10: 'Oblique trefoil', 11: 'Primary spherical',
  12: 'Secondary astigmatism (V)', 13: 'Secondary astigmatism (O)', 14: 'Vertical quadrafoil', 15: 'Oblique quadrafoil',
  16: 'Secondary coma (H)', 17: 'Secondary coma (V)', 22: 'Secondary spherical',
};

// ── Aperture synthesis ──────────────────────────────────────────────────────────────────
// Telescope pupils in metres; `inside(x, y)` in physical units, `R` = circumscribed radius.
function hexInside(x, y, a) { // flat-topped hexagon of inradius a
  const c = 0.8660254037844386;
  return Math.abs(y) <= a && Math.abs(c * x + 0.5 * y) <= a && Math.abs(c * x - 0.5 * y) <= a;
}
function hexCenters(spacing, rings, keep = () => true) {
  const out = [];
  for (let i = -rings; i <= rings; i++) for (let j = -rings; j <= rings; j++) {
    const d = (Math.abs(i) + Math.abs(j) + Math.abs(i + j)) / 2;
    if (d > rings) continue;
    const x = i * spacing * 0.8660254037844386, y = i * spacing * 0.5 + j * spacing;
    if (keep(x, y, d)) out.push([x, y]);
  }
  return out;
}
function onStrut(x, y, angleDeg, halfWidth, from = 0) {
  const a = angleDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  const along = x * ux + y * uy, across = -x * uy + y * ux;
  return along > from && Math.abs(across) < halfWidth;
}

export const TELESCOPES = {
  hubble: (() => {
    const R = 1.2, eps = 0.33, sw = 0.0132; // 2.4 m, 33 % linear obscuration, 2.64 cm spiders
    const pads = [0, 120, 240].map((a) => [0.9 * R * Math.cos((a + 75) * Math.PI / 180), 0.9 * R * Math.sin((a + 75) * Math.PI / 180)]);
    return {
      name: 'Hubble (2.4 m, 4 spiders, 3 mirror pads)', R,
      inside: (x, y) => {
        const r = Math.hypot(x, y);
        if (r > R || r < eps * R) return false;
        if (Math.abs(x) < sw || Math.abs(y) < sw) return false;
        for (const p of pads) if (Math.hypot(x - p[0], y - p[1]) < 0.065 * R) return false;
        return true;
      },
    };
  })(),
  jwst: (() => {
    const flat = 1.32, gap = 0.007, a = flat / 2, s = flat + gap;
    const centers = hexCenters(s, 2, (x, y, d) => d > 0);
    const sw = 0.05;
    return {
      name: 'JWST (6.5 m, 18 hexagonal segments, 3 struts)', R: 3.35,
      inside: (x, y) => {
        if (Math.hypot(x, y) < 0.37) return false;
        if (onStrut(x, y, 90, sw) || onStrut(x, y, 240, sw, 0.6) || onStrut(x, y, 300, sw, 0.6)) return false;
        for (const c of centers) if (hexInside(x - c[0], y - c[1], a)) return true;
        return false;
      },
    };
  })(),
  keck: (() => {
    const flat = 1.8, gap = 0.003, a = flat / 2, s = flat + gap;
    const centers = hexCenters(s, 3, (x, y, d) => d > 0);
    return {
      name: 'Keck (10 m, 36 segments)', R: 5.6,
      inside: (x, y) => {
        if (Math.hypot(x, y) < 1.3) return false;
        if (onStrut(x, y, 90, 0.04) || onStrut(x, y, 210, 0.04) || onStrut(x, y, 330, 0.04)) return false;
        for (const c of centers) if (hexInside(x - c[0], y - c[1], a)) return true;
        return false;
      },
    };
  })(),
  elt: (() => {
    const flat = 1.42, gap = 0.004, a = flat / 2, s = flat + gap;
    const centers = hexCenters(s, 16, (x, y) => { const r = Math.hypot(x, y); return r < 19.0 && r > 4.6; });
    const lut = new Map();
    centers.forEach((c) => { const k = Math.round(c[0] / s) + ',' + Math.round(c[1] / s); lut.set(k, (lut.get(k) || []).concat([c])); });
    return {
      name: `ELT (39 m, ${centers.length} segments, 6 spiders)`, R: 19.7,
      inside: (x, y) => {
        for (let k = 0; k < 6; k++) if (onStrut(x, y, k * 60 + 30, 0.25)) return false;
        const i = Math.round(x / s), j = Math.round(y / s);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const arr = lut.get((i + di) + ',' + (j + dj));
          if (arr) for (const c of arr) if (hexInside(x - c[0], y - c[1], a)) return true;
        }
        return false;
      },
    };
  })(),
};

// Segment membership map for segmented telescopes: per-pixel segment index (−1 = none)
// plus per-segment centres in normalised pupil units (circumradius = 1).
export function segmentMap(type, n, Dpx) {
  const geo = { jwst: { flat: 1.32, gap: 0.007, rings: 2, R: 3.35 }, keck: { flat: 1.8, gap: 0.003, rings: 3, R: 5.6 } }[type];
  const s = geo.flat + geo.gap;
  const centers = hexCenters(s, geo.rings, (x, y, d) => d > 0);
  const idx = new Int16Array(n * n).fill(-1);
  const c = n / 2, scale = (2 * geo.R) / Dpx;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - c) * scale, y = -(j - c) * scale;
    for (let k = 0; k < centers.length; k++) if (hexInside(x - centers[k][0], y - centers[k][1], geo.flat / 2 + 0.01)) { idx[j * n + i] = k; break; }
  }
  return { idx, centers: centers.map(([x, y]) => [x / geo.R, y / geo.R]), segRadius: geo.flat / 2 / geo.R };
}

// Generic camera-lens / laboratory apertures in normalised units (circumradius 1).
export function apertureFn(spec) {
  const t = spec.type;
  if (TELESCOPES[t]) { const T = TELESCOPES[t]; return { R: T.R, inside: T.inside }; }
  if (t === 'circle') {
    const eps = spec.obstruction || 0, nsp = spec.spiders || 0, sw = (spec.spiderWidth || 0.01);
    return {
      R: 1, inside: (x, y) => {
        const r = Math.hypot(x, y);
        if (r > 1 || r < eps) return false;
        for (let k = 0; k < nsp; k++) if (onStrut(x, y, (k * 360) / nsp + (spec.rotation || 0), sw)) return false;
        return true;
      },
    };
  }
  if (t === 'polygon') {
    const n = spec.blades, rot = ((spec.rotation || 0) * Math.PI) / 180, curv = spec.curvature || 0;
    const sector = (2 * Math.PI) / n, cp = Math.cos(Math.PI / n);
    return {
      R: 1, inside: (x, y) => {
        const r = Math.hypot(x, y);
        if (r > 1) return false;
        let ph = Math.atan2(y, x) - rot;
        ph = ((ph % sector) + sector) % sector - sector / 2;
        const rp = cp / Math.cos(ph);
        return r <= (1 - curv) * rp + curv;
      },
    };
  }
  if (t === 'square') return { R: 1, inside: (x, y) => Math.abs(x) < 0.7071 && Math.abs(y) < 0.7071 };
  if (t === 'slits') {
    const w = spec.slitWidth || 0.12, sep = spec.slitSep || 0.5;
    return { R: 1, inside: (x, y) => Math.abs(y) < 0.8 && (Math.abs(x - sep / 2) < w / 2 || Math.abs(x + sep / 2) < w / 2) };
  }
  if (t === 'catEye') { // circular pupil clipped by an off-axis vignetting circle
    const sh = spec.shift || 0.5, rr = spec.vigRadius || 1.1;
    return { R: 1, inside: (x, y) => Math.hypot(x, y) <= 1 && Math.hypot(x - sh, y) <= rr };
  }
  throw new Error('unknown aperture ' + t);
}

// Rasterise an aperture onto an n×n grid whose pupil diameter spans `Dpx` pixels,
// with ss×ss supersampling for anti-aliased (band-limited) edges.
export function rasterAperture(spec, n, Dpx, ss = 4) {
  const { R, inside } = apertureFn(spec);
  const amp = new Float64Array(n * n);
  const c = n / 2, scale = (2 * R) / Dpx;
  const rpx = Dpx / 2 + 1;
  for (let j = 0; j < n; j++) {
    const yp = j - c;
    if (Math.abs(yp) > rpx) continue;
    for (let i = 0; i < n; i++) {
      const xp = i - c;
      if (Math.abs(xp) > rpx) continue;
      let cnt = 0;
      for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
        const x = (xp + (si + 0.5) / ss - 0.5) * scale, y = -(yp + (sj + 0.5) / ss - 0.5) * scale;
        if (inside(x, y)) cnt++;
      }
      amp[j * n + i] = cnt / (ss * ss);
    }
  }
  return amp;
}

// Normalised pupil coordinates (ρ, θ) for each grid pixel (ρ = 1 at radius Dpx/2).
export function pupilCoords(n, Dpx) {
  const rho = new Float64Array(n * n), th = new Float64Array(n * n), c = n / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - c) / (Dpx / 2), y = -(j - c) / (Dpx / 2);
    rho[j * n + i] = Math.hypot(x, y); th[j * n + i] = Math.atan2(y, x);
  }
  return { rho, th };
}

// Wavefront (in µm of OPD) from a Zernike coefficient map {j: coeff_µm}.
export function zernikeWavefront(n, Dpx, coeffs) {
  const { rho, th } = pupilCoords(n, Dpx);
  const W = new Float64Array(n * n);
  const terms = Object.entries(coeffs).filter(([, v]) => v !== 0).map(([j, v]) => [+j, v]);
  for (let k = 0; k < n * n; k++) {
    if (rho[k] > 1.02) continue;
    let w = 0;
    for (const [j, v] of terms) w += v * zernike(j, Math.min(rho[k], 1), th[k]);
    W[k] = w;
  }
  return W;
}

// Monochromatic PSF: |FFT(P e^{i 2π W/λ})|², fft-shifted, normalised to unit energy.
// W in µm, lambda in µm. Returns {I, peak}.
export function psf(amp, W, n, lambdaUm = 0.55) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  const k = (2 * Math.PI) / lambdaUm;
  for (let i = 0; i < n * n; i++) {
    const a = amp[i];
    if (a === 0) continue;
    if (W) { const ph = k * W[i]; re[i] = a * Math.cos(ph); im[i] = a * Math.sin(ph); } else re[i] = a;
  }
  fft2d(re, im, n);
  const I = new Float64Array(n * n), h = n >> 1;
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = y * n + x, d = ((y + h) % n) * n + ((x + h) % n);
    const v = re[s] * re[s] + im[s] * im[s];
    I[d] = v; sum += v;
  }
  let peak = 0;
  for (let i = 0; i < n * n; i++) { I[i] /= sum; if (I[i] > peak) peak = I[i]; }
  return { I, peak };
}

// Bilinear resample of a centred n×n image with magnification s (out(u) = in(u / s)).
export function rescale(I, n, s) {
  const out = new Float64Array(n * n), c = n / 2;
  for (let y = 0; y < n; y++) {
    const sy = (y - c) / s + c, y0 = Math.floor(sy), fy = sy - y0;
    if (y0 < 0 || y0 >= n - 1) continue;
    for (let x = 0; x < n; x++) {
      const sx = (x - c) / s + c, x0 = Math.floor(sx), fx = sx - x0;
      if (x0 < 0 || x0 >= n - 1) continue;
      const i = y0 * n + x0;
      out[y * n + x] = (I[i] * (1 - fx) + I[i + 1] * fx) * (1 - fy) + (I[i + n] * (1 - fx) + I[i + n + 1] * fx) * fy;
    }
  }
  // energy conservation: area scales as s²
  const k = 1 / (s * s);
  for (let i = 0; i < n * n; i++) out[i] *= k;
  return out;
}

// Polychromatic PSF on a common angular grid referenced to λref. Each wavelength gets its
// own FFT (aberrations in waves scale as 1/λ) and is resampled by λ/λref (diffraction scale).
// Returns linear-RGB float planes plus a luminance map.
export function polyPSF(amp, W, n, lambdasNm, lambdaRefNm, weights) {
  const basis = spectralBasis(lambdasNm);
  const R = new Float64Array(n * n), G = new Float64Array(n * n), B = new Float64Array(n * n);
  lambdasNm.forEach((l, idx) => {
    const { I } = psf(amp, W, n, l / 1000);
    const Is = rescale(I, n, l / lambdaRefNm);
    const w = weights ? weights[idx] : 1;
    const [r, g, b] = basis[idx];
    for (let i = 0; i < n * n; i++) { const v = Is[i] * w; R[i] += v * r; G[i] += v * g; B[i] += v * b; }
  });
  return { R, G, B };
}

// Strehl ratio from the PSF peak relative to the aberration-free PSF of the same pupil.
export function strehl(amp, W, n, lambdaUm) {
  return psf(amp, W, n, lambdaUm).peak / psf(amp, null, n, lambdaUm).peak;
}

// RMS wavefront error over the pupil (amplitude-weighted, piston removed), same units as W.
export function rmsWavefront(amp, W, n) {
  let s = 0, s2 = 0, w = 0;
  for (let i = 0; i < n * n; i++) if (amp[i] > 0) { s += amp[i] * W[i]; s2 += amp[i] * W[i] * W[i]; w += amp[i]; }
  const m = s / w;
  return Math.sqrt(Math.max(0, s2 / w - m * m));
}
