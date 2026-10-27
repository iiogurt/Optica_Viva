// Frozen-flow turbulence with tip-tilt or adaptive-optics correction, for the seeing laboratory. A
// session holds the phase screen, the servo history and the long-exposure sum; it lives in a
// compute worker (js/lib/tasks.js), which streams display-ready frames to the page.
import { rasterAperture, psf } from './pupil.js';
import { lut } from './color.js';
import { phaseScreen } from './turbulence.js';

export const NS = 512, DP = 64; // screen 8D wide, pupil 64 px
// The band of the screen the pupil sweeps (rows NS/4 − STRIP_PAD … NS/4 + DP + STRIP_PAD), sampled
// every STRIP_STEP pixels for the 3-D view.
export const STRIP_PAD = 16, STRIP_STEP = 4;
const n = 256; // PSF grid (Q = 4)
export const CROP = 192; // displayed PSF crop (px)
const dt = 0.005; // s per animation step
const INF = lut('inferno'), DIV = lut('diverging');

// PSF crop as RGBA bytes on a log stretch of 3.5 decades
function psfImage(data, norm) {
  const off = (n - CROP) / 2, out = new Uint8ClampedArray(CROP * CROP * 4);
  let mx = 0; for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) mx = Math.max(mx, data[(y + off) * n + x + off] / norm);
  for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) {
    const v = Math.max(0, 1 + Math.log10(data[(y + off) * n + x + off] / norm / mx + 1e-9) / 3.5);
    const tt = Math.round(v * 255) * 3, o = (y * CROP + x) * 4;
    out[o] = INF[tt]; out[o + 1] = INF[tt + 1]; out[o + 2] = INF[tt + 2]; out[o + 3] = 255;
  }
  return out;
}

export function seeingSession() {
  const amp = rasterAperture({ type: 'circle', obstruction: 0.12 }, n, DP, 3);
  const ideal = psf(amp, null, n, 1);
  let base = null, baseKey = '', screen = null, P = null, t = 0, acc = null, accN = 0, hist = [], last = null;

// sample the periodic screen with bilinear interpolation at an offset (frozen flow along x)
function pupilPhase(shift) {
  const ph = new Float64Array(n * n);
  const off = (n - DP) / 2;
  const s0 = Math.floor(shift), f = shift - s0;
  for (let y = 0; y < DP + 2; y++) for (let x = 0; x < DP + 2; x++) {
    const sx = ((x + s0) % NS + NS) % NS, sx1 = (sx + 1) % NS, sy = (y + NS / 4) % NS;
    const v = screen[sy * NS + sx] * (1 - f) + screen[sy * NS + sx1] * f;
    if (y < DP + 2 && x < DP + 2 && off + y - 1 >= 0 && off + x - 1 >= 0) ph[(off + y - 1) * n + off + x - 1] = v;
  }
  return ph;
}

// deformable mirror: actuators on an (nact+1)² grid, bilinear influence functions
function dmFit(ph, nact) {
  const off = (n - DP) / 2, pitch = DP / nact;
  const A = [];
  for (let j = 0; j <= nact; j++) { A.push([]); for (let i = 0; i <= nact; i++) { const x = Math.min(DP - 1, Math.round(i * pitch)), y = Math.min(DP - 1, Math.round(j * pitch)); A[j].push(ph[(off + y) * n + off + x]); } }
  const dm = new Float64Array(n * n);
  for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) {
    const u = x / pitch, v = y / pitch, i = Math.min(nact - 1, Math.floor(u)), j = Math.min(nact - 1, Math.floor(v)), fu = u - i, fv = v - j;
    dm[(off + y) * n + off + x] = (A[j][i] * (1 - fu) + A[j][i + 1] * fu) * (1 - fv) + (A[j + 1][i] * (1 - fu) + A[j + 1][i + 1] * fu) * fv;
  }
  return dm;
}
function tiltFit(ph) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, s = 0, w = 0;
  const c = n / 2;
  for (let k = 0; k < n * n; k++) if (amp[k] > 0.5) { const x = (k % n) - c, y = Math.floor(k / n) - c; s += ph[k]; sx += ph[k] * x; sy += ph[k] * y; sxx += x * x; syy += y * y; w++; }
  const out = new Float64Array(n * n), a = sx / sxx, b = sy / syy, m = s / w;
  for (let k = 0; k < n * n; k++) if (amp[k] > 0) out[k] = m + a * ((k % n) - c) + b * (Math.floor(k / n) - c);
  return out;
}


  // p = { D (m), r0 (cm at 500 nm), lam (µm), v (m/s), ao: 'off' | 'tt' | 'ao', nact, lag (ms) }.
  // Returns the colour-mapped screen (NS×NS RGBA) and the diffraction-limited PSF crop.
  function reset(p, seed) {
    const dx = p.D / DP;
    // the screen depends only on D (pixel scale) and the seed; r₀ rescales it as r₀^(−5/6)
    const key = p.D + ':' + seed;
    if (key !== baseKey) { base = phaseScreen(NS, dx, 0.1, 25, seed); baseKey = key; }
    const k = Math.pow(0.1 / (p.r0 / 100), 5 / 6);
    screen = new Float64Array(base.length); for (let i = 0; i < base.length; i++) screen[i] = base[i] * k;
    t = 0; acc = new Float64Array(n * n); accN = 0; hist = []; P = { ...p, dx };
    const img = new Uint8ClampedArray(NS * NS * 4);
    let mx = 1e-9; for (let i = 0; i < NS * NS; i++) mx = Math.max(mx, Math.abs(screen[i]));
    for (let i = 0; i < NS * NS; i++) { const tt = Math.round((screen[i] / mx * 0.5 + 0.5) * 255) * 3; img[i * 4] = DIV[tt]; img[i * 4 + 1] = DIV[tt + 1]; img[i * 4 + 2] = DIV[tt + 2]; img[i * 4 + 3] = 255; }
    // the band the pupil sweeps, in waves at λ (the screen is in radians at 500 nm), for the 3-D view
    const toWaves = 0.5 / p.lam / (2 * Math.PI), cols = NS / STRIP_STEP, rows = (DP + 2 * STRIP_PAD) / STRIP_STEP + 1;
    const strip = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) strip[j * cols + i] = screen[(NS / 4 - STRIP_PAD + j * STRIP_STEP) * NS + i * STRIP_STEP] * toWaves;
    return { screen: img, ideal: psfImage(ideal.I, 1), strip, cols, rows };
  }

  // Advance `steps` time steps of dt and return the display frame: short- and long-exposure PSF
  // crops, the residual pupil phase (DP×DP RGBA) with its RMS in waves, the screen shift (px), the
  // measured long-exposure Strehl ratio and the number of frames summed.
  function step(steps) {
    const st = P, lam = st.lam, toWaves = 0.5 / lam / (2 * Math.PI); // radians@500 → waves at λ (OPD achromatic)
    for (let s = 0; s < steps; s++) {
      const shift = (st.v * t) / st.dx;
      const raw = pupilPhase(shift); // radians at 500 nm
      let corr = null;
      if (st.ao === 'tt') corr = tiltFit(raw);
      if (st.ao === 'ao') corr = dmFit(raw, st.nact);
      hist.push(corr);
      const lagFrames = Math.round(st.lag / 1000 / dt);
      while (hist.length > lagFrames + 1) hist.shift();
      const applied = corr ? hist[0] : null;
      const W = new Float64Array(n * n);
      for (let k = 0; k < n * n; k++) if (amp[k] > 0) W[k] = (raw[k] - (applied ? applied[k] : 0)) * toWaves;
      const { I } = psf(amp, W, n, 1);
      for (let k = 0; k < n * n; k++) acc[k] += I[k];
      accN++;
      last = { I, W, shift };
      t += dt;
    }
    let pk = 0; for (let k = 0; k < n * n; k++) pk = Math.max(pk, acc[k] / accN);
    const off = (n - DP) / 2, pupil = new Uint8ClampedArray(DP * DP * 4);
    let rm = 1e-9; for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) rm = Math.max(rm, Math.abs(last.W[(off + y) * n + off + x]));
    let s2 = 0, s1 = 0, c = 0;
    for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) {
      const k = (off + y) * n + off + x, o = (y * DP + x) * 4;
      if (amp[k] < 0.5) continue;
      const v = last.W[k]; s1 += v; s2 += v * v; c++;
      const tt = Math.round((v / Math.max(rm, 0.5) * 0.5 + 0.5) * 255) * 3;
      pupil[o] = DIV[tt]; pupil[o + 1] = DIV[tt + 1]; pupil[o + 2] = DIV[tt + 2]; pupil[o + 3] = 255;
    }
    // the residual wavefront in the pupil (waves, mean removed, 0 outside) for the 3-D view
    const wave = new Float32Array(DP * DP), mean = c ? s1 / c : 0;
    for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) { const k = (off + y) * n + off + x; if (amp[k] >= 0.5) wave[y * DP + x] = last.W[k] - mean; }
    return { wave, short: psfImage(last.I, 1), long: psfImage(acc, accN), pupil, rms: Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)), shift: last.shift, strehl: pk / ideal.peak, accN };
  }
  return { reset, step };
}
