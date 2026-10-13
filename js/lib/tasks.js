// Heavy, pure computations that run inside the compute worker (or on the main thread as a
// fallback). Each task takes plain data and returns { result, transfer } where `transfer`
// lists the ArrayBuffers to hand over without copying.
import { rasterAperture, psf, rescale, zernikeWavefront, rmsWavefront, zernike, segmentMap } from './pupil.js';
import { spectralBasis, wavelengthRGB } from './color.js';
import { fft2d } from './fft.js';
import { paraxial, referenceSphere, opd, aimRay, trace } from './raytrace.js';
import { optimise } from './optimise.js';
import { monteCarlo } from './tolerance.js';
import { ghostSystem, renderGhosts } from './ghosts.js';
import { bokehKernels } from './bokeh.js';
import { renderLake } from './polar.js';
import { renderRuler } from './macro.js';
import { createLoop, pyramidWFS } from './wfs.js';
import { renderPanorama } from './panorama.js';
import { hdrPipeline } from './hdr.js';
import { phaseScreen } from './turbulence.js';

// Polychromatic PSF of an aperture with optional defocus, plus profile, encircled energy and Strehl.
// p = { spec, n, Dpx, lambdas (nm), ref (nm), defocus (waves RMS at ref), falseColor }
function psfLab(p) {
  const { spec, n, Dpx, lambdas: lams, ref } = p, Q = n / Dpx;
  const amp = rasterAperture(spec, n, Dpx, 4);
  const W = p.defocus ? zernikeWavefront(n, Dpx, { 4: (p.defocus * ref) / 1000 }) : null; // µm OPD
  const R = new Float64Array(n * n), G = new Float64Array(n * n), B = new Float64Array(n * n), Lm = new Float64Array(n * n);
  const basis = lams.length === 1 ? [wavelengthRGB(lams[0], false)] : p.falseColor
    ? spectralBasis(lams.map((l) => 420 + ((l - lams[0]) / (lams[lams.length - 1] - lams[0])) * 260)) : spectralBasis(lams);
  let base = null;
  lams.forEach((l, i) => {
    let I;
    // without aberration every wavelength is the reference PSF magnified by λ/λref (exact)
    if (!W) { if (!base) base = psf(amp, null, n, ref / 1000).I; I = rescale(base, n, l / ref); }
    else I = rescale(psf(amp, W, n, l / 1000).I, n, l / ref);
    const [r, g, b] = basis[i];
    for (let k = 0; k < n * n; k++) { const v = I[k]; R[k] += v * r; G[k] += v * g; B[k] += v * b; Lm[k] += v / lams.length; }
  });
  const p0 = psf(amp, null, n, ref / 1000).peak;
  const pk = W ? psf(amp, W, n, ref / 1000).peak : p0;
  // azimuthal profile and encircled energy in λref/D units
  const bins = 240, rmax = 30, prof = new Float64Array(bins), cnt = new Float64Array(bins), c = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const b = Math.floor((Math.hypot(x - c, y - c) / Q / rmax) * bins);
    if (b < bins) { prof[b] += Lm[y * n + x]; cnt[b]++; }
  }
  let cum = 0, tot = 0;
  for (let k = 0; k < n * n; k++) tot += Lm[k];
  const eeCurve = [], profCurve = [];
  const peak = Math.max(...Array.from(prof, (v, i) => (cnt[i] ? v / cnt[i] : 0)));
  for (let i = 0; i < bins; i++) {
    cum += prof[i];
    if (cnt[i]) profCurve.push([((i + 0.5) / bins) * rmax, prof[i] / cnt[i] / peak]);
    eeCurve.push([((i + 1) / bins) * rmax, cum / tot]);
  }
  let area = 0; for (let k = 0; k < n * n; k++) area += amp[k];
  const ampCopy = amp.slice(); // the cached raster must stay in this realm
  return {
    result: { n, Dpx, Q, amp: ampCopy, R, G, B, Lm, profCurve, eeCurve, strehl: pk / p0, fill: area / (Math.PI * (Dpx / 2) ** 2) },
    transfer: [ampCopy.buffer, R.buffer, G.buffer, B.buffer, Lm.buffer],
  };
}

// Zernike laboratory: wavefront, PSF, through-focus series and Strehl-vs-RMS curve.
// p = { coeffs: {j: waves RMS}, n, Dpx }
function zernikeLab(p) {
  const { coeffs: c, n, Dpx } = p;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  const P0 = psf(amp, null, n, 1).peak;
  const W = zernikeWavefront(n, Dpx, c); // waves (λ = 1)
  const P = psf(amp, W, n, 1);
  const rms = rmsWavefront(amp, W, n);
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < n * n; k++) if (amp[k] > 0.5) { mn = Math.min(mn, W[k]); mx = Math.max(mx, W[k]); }
  // through focus: ±½, ±1 λ peak-to-valley of added defocus (Z4 RMS = PV / 2√3)
  const through = [-1, -0.5, 0, 0.5, 1].map((d) => psf(amp, zernikeWavefront(n, Dpx, { ...c, 4: (c[4] || 0) + d / Math.sqrt(3) / 2 }), n, 1).I);
  const curve = [];
  for (let k = 0; k <= 16; k++) {
    const s = k / 8, Ws = new Float64Array(W.length);
    for (let i = 0; i < W.length; i++) Ws[i] = W[i] * s;
    curve.push([rms * s, psf(amp, Ws, n, 1).peak / P0]);
  }
  const ampCopy = amp.slice();
  return {
    result: { n, Dpx, amp: ampCopy, P0, W, I: P.I, strehl: P.peak / P0, rms, pv: mx - mn, through, curve },
    transfer: [ampCopy.buffer, W.buffer, P.I.buffer, ...through.map((t) => t.buffer)],
  };
}

// Radial optics OTF (signed, real for rotationally symmetric aberrations) for several
// (defocus W020, spherical W040) pairs in waves: pupil → PSF → FFT → OTF.
// p = { pairs: [[def, sa], …], n, Dpx } → curves: [[ν̂, OTF], …] per pair
function otfCurves(p) {
  const { n, Dpx } = p, Q = n / Dpx, hn = n / 2;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  const curves = p.pairs.map(([def, sa]) => {
    const W = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r2 = ((x - hn) ** 2 + (y - hn) ** 2) / (Dpx / 2) ** 2;
      if (r2 <= 1.05) W[y * n + x] = def * r2 + sa * r2 * r2;
    }
    const { I } = psf(amp, W, n, 1);
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[((y + hn) % n) * n + ((x + hn) % n)] = I[y * n + x];
    fft2d(re, im, n);
    const out = [];
    for (let k = 0; k <= n / Q; k++) out.push([k / (n / Q), (re[k] + re[k * n]) / 2 / re[0]]);
    return out;
  });
  return { result: curves, transfer: [] };
}


// Lyot coronagraph: star and planet propagated pupil → occulting mask → Lyot stop → image.
// p = { st: {pupil, mask, lyot, sep, con, wfe, lam}, n, Dp }
function coronagraph(p) {
  const { st, n, Dp } = p, Q = n / Dp;
  const amp = rasterAperture(st.pupil === 'clear' ? { type: 'circle' } : { type: 'circle', obstruction: 0.25, spiders: 4, spiderWidth: 0.02, rotation: 45 }, n, Dp, 4);
  // fixed random low-order aberration pattern, scaled to the requested RMS
  let sd = 12345; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647 - 0.5; };
  const coeffs = []; for (let j = 4; j <= 22; j++) coeffs.push([j, rnd() / Math.pow(j, 0.6)]);
  const norm = Math.sqrt(coeffs.reduce((a, [, c]) => a + c * c, 0));
  const W = new Float64Array(n * n); // waves
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x; if (!amp[k]) continue;
    const xn = (x - n / 2) / (Dp / 2), yn = -(y - n / 2) / (Dp / 2), r = Math.hypot(xn, yn), t = Math.atan2(yn, xn);
    let v = 0; for (const [j, c] of coeffs) v += c * zernike(j, Math.min(1, r), t);
    W[k] = (v / norm) * (st.wfe / 1000) / st.lam;
  }
  const lyot = rasterAperture({ type: 'circle', obstruction: st.pupil === 'clear' ? 0 : 0.25 / st.lyot * 1.15, spiders: st.pupil === 'clear' ? 0 : 4, spiderWidth: 0.04, rotation: 45 }, n, Dp * st.lyot, 4);
  const maskR = st.mask * Q; // px
  const propagate = (tilt, withCoro) => {
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) if (amp[k]) { const x = (k % n) - n / 2; const ph = 2 * Math.PI * (W[k] + (tilt * x) / Dp); re[k] = amp[k] * Math.cos(ph); im[k] = amp[k] * Math.sin(ph); }
    fft2d(re, im, n); // focal plane (unshifted: DC at 0)
    if (withCoro) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = x < n / 2 ? x : x - n, fy = y < n / 2 ? y : y - n;
        if (Math.hypot(fx, fy) < maskR) { re[y * n + x] = 0; im[y * n + x] = 0; }
      }
      fft2d(re, im, n, true); // Lyot plane
      var lyotPlane = new Float64Array(n * n); for (let k = 0; k < n * n; k++) lyotPlane[k] = Math.hypot(re[k], im[k]);
      for (let k = 0; k < n * n; k++) { re[k] *= lyot[k]; im[k] *= lyot[k]; }
      fft2d(re, im, n);
    }
    const I = new Float64Array(n * n), hn = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) I[((y + hn) % n) * n + ((x + hn) % n)] = re[y * n + x] ** 2 + im[y * n + x] ** 2;
    return { I, lyotPlane };
  };
  const star = propagate(0, false), starC = propagate(0, true), pl = propagate(st.sep, false), plC = propagate(st.sep, true);
  let peak = 0; for (let k = 0; k < n * n; k++) peak = Math.max(peak, star.I[k]);
  const dI = new Float64Array(n * n), cI = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) { dI[k] = (star.I[k] + st.con * pl.I[k]) / peak; cI[k] = (starC.I[k] + st.con * plC.I[k]) / peak; }
  // radial contrast profiles (azimuthal mean of the star alone)
  const bins = 120, rmax = 30, pd = new Float64Array(bins), pc = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.hypot(x - n / 2, y - n / 2) / Q, b = Math.floor((r / rmax) * bins); if (b < bins) { pd[b] += star.I[y * n + x] / peak; pc[b] += starC.I[y * n + x] / peak; cnt[b]++; } }
  let plPeak = 0, plPeakC = 0; for (let k = 0; k < n * n; k++) { plPeak = Math.max(plPeak, pl.I[k]); plPeakC = Math.max(plPeakC, plC.I[k]); }
  const throughput = plPeakC / plPeak;
  const px = Math.round(n / 2 + st.sep * Q), py = n / 2;
  let starAt = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) starAt = Math.max(starAt, starC.I[(py + dy) * n + px + dx] / peak);
  let lyotIn = 0, lyotTot = 0; for (let k = 0; k < n * n; k++) { lyotTot += amp[k]; lyotIn += amp[k] * lyot[k]; }
  const prof = Array.from({ length: bins }, (_, i) => [((i + 0.5) / bins) * rmax, cnt[i] ? pd[i] / cnt[i] : NaN, cnt[i] ? pc[i] / cnt[i] : NaN]);
  const bi = Math.floor((st.sep / rmax) * bins), directAt = pd[bi] / cnt[bi];
  const snrRatio = (st.con * throughput * plPeak / peak) / Math.max(starAt, 1e-14);
  const ampC = amp.slice(), lyotC = lyot.slice(), lp = starC.lyotPlane;
  return {
  result: { dI, cI, lyotPlane: lp, amp: ampC, lyot: lyotC, maskR, prof, throughput, starAt, directAt, snrRatio },
  transfer: [dI.buffer, cI.buffer, lp.buffer, ampC.buffer, lyotC.buffer],
  };
}

// JWST segment phasing: random per-segment piston and tip/tilt for a commissioning stage.
// p = { st: {stage, seed, lam}, nS, DS }. The raster and segment map are cached per size.
const SEG_CACHE = new Map();
function segPhasing(p) {
  const { st, nS, DS } = p, key = nS + '|' + DS;
  if (!SEG_CACHE.has(key)) SEG_CACHE.set(key, { amp: rasterAperture({ type: 'jwst' }, nS, DS, 3), SM: segmentMap('jwst', nS, DS) });
  const { amp, SM } = SEG_CACHE.get(key);
  let seed = st.seed * 9301 + 49297;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5; };
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s * Math.SQRT2; };
  // per-segment piston (µm OPD) and tip/tilt (µm across segment radius). Deployed tilts were
  // arcminutes; they are compressed to ±1.2 λ per segment radius so the 18 spots stay inside
  // the FFT field (wavefront slope < 0.5 cycle/pixel, no wrap-around).
  const P = { raw: [0.5, 1.2 * st.lam], stack: [2.0, 0.05], coarse: [0.12, 0.02], fine: [0.012, 0.004] }[st.stage];
  const seg = SM.centers.map(() => ({ p: gauss() * P[0], tx: gauss() * P[1], ty: gauss() * P[1] }));
  const W = new Float64Array(nS * nS), c = nS / 2;
  for (let j = 0; j < nS; j++) for (let i = 0; i < nS; i++) {
    const k = j * nS + i, s = SM.idx[k];
    if (s < 0 || !amp[k]) continue;
    const x = (i - c) / (DS / 2), y = -(j - c) / (DS / 2);
    const dx = (x - SM.centers[s][0]) / SM.segRadius, dy = (y - SM.centers[s][1]) / SM.segRadius;
    W[k] = seg[s].p + seg[s].tx * dx + seg[s].ty * dy;
  }
  const I = psf(amp, W, nS, st.lam).I;
  const I0 = psf(amp, null, nS, st.lam).peak;
  let mx = 0; for (let k = 0; k < nS * nS; k++) mx = Math.max(mx, I[k]);
  const rmsP = Math.sqrt(seg.reduce((a, s) => a + s.p * s.p, 0) / seg.length);
  const ampC = amp.slice();
  return { result: { W, I, mx, strehl: mx / I0, rmsP, amp: ampC }, transfer: [W.buffer, I.buffer, ampC.buffer] };
}

// Diffraction PSF of a traced lens: OPD against the exit-pupil reference sphere on a 41×41
// pupil grid, interpolated onto a 256² pupil and Fourier-transformed.
// p = { lens, theta (deg), zImg (mm), N }
function lensPSF(p) {
  const f = lensPupil(p, 256, 128);
  if (!f) return { result: null, transfer: [] };
  const { amp, W, n, lam, rmsW, pvW, maxStep, transmitted } = f;
  const P = psf(amp, W, n, lam / 1000), P0 = psf(amp, null, n, lam / 1000);
  const ampC = amp.slice();
  return {
    result: { I: P.I, n, Wmap: W, amp: ampC, rmsW, pvW, strehl: P.peak / P0.peak, aliased: maxStep > 0.5, N: p.N, lam, transmitted },
    transfer: [P.I.buffer, W.buffer, ampC.buffer],
  };
}

// Traced, vignetted exit-pupil field: OPD on a 41×41 grid (rays blocked by clear apertures
// carry no light), interpolated onto an n×n grid with a Dpx-pixel pupil. µm of OPD.
function lensPupil(p, n, Dpx) {
  const { lens, theta, zImg, N, sd } = p, lam = 587.56;
  const par = paraxial(lens, lam);
  const ref = referenceSphere(lens, lam, theta, zImg, par);
  if (!ref) return null;
  // OPD on a 41×41 pupil grid; `lit` marks rays that pass every clear aperture (vignetting)
  const G = 41, grid = new Float64Array(G * G).fill(NaN), lit = new Float64Array(G * G);
  let inPupil = 0, passed = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const px = -1 + (2 * i) / (G - 1), py = 1 - (2 * j) / (G - 1);
    if (px * px + py * py > 1.0001) continue;
    inPupil++;
    if (sd) { const a = aimRay(lens, lam, theta, px, py, par); if (!a || !trace(lens, lam, a.p, a.d, { sd, zv: par.zv }).ok) continue; }
    const v = opd(lens, lam, theta, px, py, ref, par);
    if (v != null) { grid[j * G + i] = v; lit[j * G + i] = 1; passed++; }
  }
  if (!passed) return null;
  // remove piston; RMS
  let s = 0, s2 = 0, c = 0, maxStep = 0;
  for (let k = 0; k < G * G; k++) if (!isNaN(grid[k])) { s += grid[k]; s2 += grid[k] ** 2; c++; }
  const mean = s / c, rmsW = Math.sqrt(s2 / c - mean * mean);
  for (let k = 0; k < G * G; k++) if (!isNaN(grid[k])) grid[k] -= mean;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 3).slice(); // copy: the cached raster is shared
  const W = new Float64Array(n * n);
  let pv = [Infinity, -Infinity];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x; if (!amp[k]) continue;
    const u = ((x - n / 2) / (Dpx / 2) + 1) / 2 * (G - 1), v = ((y - n / 2) / (Dpx / 2) + 1) / 2 * (G - 1);
    const i0 = Math.max(0, Math.min(G - 2, Math.floor(u))), j0 = Math.max(0, Math.min(G - 2, Math.floor(v)));
    const fx = Math.min(1, Math.max(0, u - i0)), fy = Math.min(1, Math.max(0, v - j0));
    const q = [grid[j0 * G + i0], grid[j0 * G + i0 + 1], grid[(j0 + 1) * G + i0], grid[(j0 + 1) * G + i0 + 1]];
    const ok = q.map((t) => !isNaN(t));
    // vignetting: amplitude = bilinear coverage of lit samples (anti-aliased pupil edge)
    const cover = (lit[j0 * G + i0] * (1 - fx) + lit[j0 * G + i0 + 1] * fx) * (1 - fy) + (lit[(j0 + 1) * G + i0] * (1 - fx) + lit[(j0 + 1) * G + i0 + 1] * fx) * fy;
    amp[k] *= Math.min(1, Math.max(0, (cover - 0.25) / 0.5));
    if (!amp[k] || !ok.some(Boolean)) { amp[k] = 0; continue; }
    let val;
    if (ok.every(Boolean)) val = (q[0] * (1 - fx) + q[1] * fx) * (1 - fy) + (q[2] * (1 - fx) + q[3] * fx) * fy;
    else { const v2 = q.filter((t, i) => ok[i]); val = v2.length ? v2.reduce((a, b) => a + b) / v2.length : 0; }
    W[k] = val * lam / 1000; // µm of OPD
    pv = [Math.min(pv[0], W[k]), Math.max(pv[1], W[k])];
    if (x > 0 && amp[k - 1]) maxStep = Math.max(maxStep, Math.abs(W[k] - W[k - 1]) / (lam / 1000));
  }
  return { amp, W, n, lam, rmsW, pvW: (pv[1] - pv[0]) / (lam / 1000), maxStep, transmitted: passed / inPupil };
}

// MTF across the field of a traced lens: for each field angle, OTF = FFT(PSF of the traced,
// vignetted pupil); sagittal (x) and tangential (y) cuts read at the requested lp/mm.
// p = { lens, sd, zImg, N, freqs: [lp/mm], fields: n }
function lensMTF(p) {
  const n = 256, Dpx = 64, Q = n / Dpx, hn = n / 2, rows = [];
  const fmax = p.lens.field, nf = p.fields || 7;
  for (let k = 0; k < nf; k++) {
    const theta = (fmax * k) / (nf - 1);
    const f = lensPupil({ ...p, theta }, n, Dpx);
    if (!f) continue;
    const { I } = psf(f.amp, f.W, n, f.lam / 1000);
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[((y + hn) % n) * n + ((x + hn) % n)] = I[y * n + x];
    fft2d(re, im, n);
    const du = (f.lam * 1e-6 * p.N) / Q;   // PSF sample (mm)
    const dnu = 1 / (n * du);               // OTF sample (cycles/mm)
    const at = (axis, nu) => {               // |OTF| along x (sagittal) or y (tangential), linear interp
      const t = nu / dnu, i0 = Math.floor(t), fr = t - i0;
      const g = (i) => (axis === 'x' ? Math.hypot(re[i], im[i]) : Math.hypot(re[i * n], im[i * n])) / re[0];
      return i0 + 1 < hn ? g(i0) * (1 - fr) + g(i0 + 1) * fr : 0;
    };
    rows.push({ theta, h: p.efl * Math.tan((theta * Math.PI) / 180), S: p.freqs.map((nu) => at('x', nu)), T: p.freqs.map((nu) => at('y', nu)), transmitted: f.transmitted });
  }
  return { result: { rows, freqs: p.freqs }, transfer: [] };
}

// Damped-least-squares optimisation of a prescription (see js/lib/optimise.js).
function optimiseLens(p) { return { result: optimise(p.lens, p.opts || {}), transfer: [] }; }

// Monte-Carlo tolerance analysis (see js/lib/tolerance.js).
function tolerance(p) { return { result: monteCarlo(p.lens, p.tol, p.trials, p.seed), transfer: [] }; }

// Real-ray lens-flare ghosts (see js/lib/ghosts.js). The prepared system (coating tables)
// is cached between calls, so dragging the source only re-traces.
// p = { lens, sd, coat, blades, lambdas, theta: [tan θx, tan θy], W, grid, cull }
let ghostCache = { key: '', sys: null };
function flareGhosts(p) {
  const key = JSON.stringify([p.lens, p.sd, p.coat, p.blades, p.lambdas]);
  if (ghostCache.key !== key) {
    const par = paraxial(p.lens, 587.56);
    ghostCache = { key, sys: ghostSystem(p.lens, { lambdas: p.lambdas, coat: p.coat, sd: p.sd, stopR: par.stopR, blades: p.blades, zImg: par.zImage }) };
  }
  const r = renderGhosts(ghostCache.sys, { theta: p.theta, basis: spectralBasis(p.lambdas), W: p.W, grid: p.grid, cull: p.cull });
  return { result: r, transfer: [r.rgb.buffer] };
}

// Diffraction of a small bokeh disk: the traced on-axis pupil of a lens with its sensor moved by
// Δz so that the defocus is W020 waves at λref, W020 = Δz (1 − cos U′) with tan U′ = 1/(2N).
// One FFT per wavelength with the same OPD in µm (dispersion of the OPD neglected), resampled to
// a common angular grid. p = { lens, sd, w020 (waves), lambdas (nm), ref (nm) }
// Returns the RGB PSF, the reference-λ PSF, both radial profiles and the geometric disk radius,
// in pixels of du = λref N / Q.
function defocusPSF(p) {
  const n = 256, Dpx = 128, Q = n / Dpx, par = paraxial(p.lens, 587.56), N = par.fnum;
  const U = Math.atan(1 / (2 * N)), dz = (p.w020 * p.ref * 1e-6) / (1 - Math.cos(U));
  const f = lensPupil({ lens: p.lens, sd: p.sd, theta: 0, zImg: par.zImage + dz, N }, n, Dpx);
  if (!f) return { result: null, transfer: [] };
  const basis = spectralBasis(p.lambdas), rgb = new Float32Array(n * n * 3);
  p.lambdas.forEach((l, li) => {
    const I = rescale(psf(f.amp, f.W, n, l / 1000).I, n, l / p.ref), [r, g, b] = basis[li];
    for (let k = 0; k < n * n; k++) { rgb[k * 3] += I[k] * r; rgb[k * 3 + 1] += I[k] * g; rgb[k * 3 + 2] += I[k] * b; }
  });
  const mono = psf(f.amp, f.W, n, p.ref / 1000).I, focused = psf(f.amp, null, n, p.ref / 1000).I;
  // the same defocus on an aberration-free, unvignetted circular pupil: W = W020 ρ²
  const circ = rasterAperture({ type: 'circle' }, n, Dpx, 3), Wd = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r2 = ((x - n / 2) ** 2 + (y - n / 2) ** 2) / (Dpx / 2) ** 2; Wd[y * n + x] = (p.w020 * p.ref * 1e-3) * r2; }
  const ideal = psf(circ, Wd, n, p.ref / 1000).I;
  // azimuthal averages in 1 px bins
  const bins = n / 2, prof = new Float64Array(bins), poly = new Float64Array(bins), pure = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const b = Math.floor(Math.hypot(x - n / 2, y - n / 2) + 0.5), k = y * n + x;
    if (b < bins) { prof[b] += mono[k]; pure[b] += ideal[k]; poly[b] += 0.2126 * rgb[k * 3] + 0.7152 * rgb[k * 3 + 1] + 0.0722 * rgb[k * 3 + 2]; cnt[b]++; }
  }
  for (let b = 0; b < bins; b++) if (cnt[b]) { prof[b] /= cnt[b]; poly[b] /= cnt[b]; pure[b] /= cnt[b]; }
  const du = (p.ref * 1e-6 * N) / Q; // mm per PSF pixel
  return {
    result: { n, rgb, prof, poly, pure, binPx: 1, du, dz, N, Rgeo: dz * Math.tan(U) / du, centre: mono[(n / 2) * n + n / 2] / focused[(n / 2) * n + n / 2], rmsW: f.rmsW },
    transfer: [rgb.buffer, prof.buffer, poly.buffer, pure.buffer],
  };
}

// Bokeh kernels traced through a lens prescription (see js/lib/bokeh.js).
function bokehTraced(p) {
  const r = bokehKernels({ ...p, basis: spectralBasis(p.lambdas) });
  return { result: r, transfer: r.kernels.map((k) => k.rgb.buffer) };
}

// Polarised render of a lake through a rotating polariser (see js/lib/polar.js).
function polarLake(p) {
  const r = renderLake(p);
  return { result: r, transfer: [r.rgb.buffer] };
}

// Macro lab: the tilted ruler in a full-frame view and (optionally) a 1:1 pixel crop.
function macroRuler(p) {
  const full = renderRuler(p.full), crop = p.crop ? renderRuler(p.crop) : null;
  return { result: { full, crop }, transfer: [full.img.buffer, ...(crop ? [crop.img.buffer] : [])] };
}

// Adaptive-optics loop: a persistent simulator living in the worker (or the main thread when
// workers are unavailable). p = { config } reconfigures; p = { run: ms } advances the loop.
let aoSim = null;
function aoLoop(p) {
  if (!aoSim) aoSim = createLoop();
  const info = p.config ? aoSim.configure(p.config) : null;
  const r = p.run ? aoSim.run(p.run) : null;
  return { result: { info, frame: r }, transfer: [] };
}

// Pyramid wavefront sensor: detector image and slope maps for an aberration, plus the response to
// a pure tilt (linearity curve, when p.curve) at the same modulation. p = { mode: 'tilt'|Noll
// j|'turb', amp (rad RMS, or λ/D for tilt), rmod (λ/D), curve (bool) }.
let pyrScreen = null;
function pyramid(p) {
  const Np = 32, ph = new Float64Array(Np * Np), R = Np / 2;
  if (p.mode === 'turb' && !pyrScreen) pyrScreen = phaseScreen(128, 1 / Np, 1, 30, 5);
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
    const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R;
    ph[y * Np + x] = p.mode === 'tilt' ? (2 * Math.PI * p.amp * (x - R)) / Np
      : p.mode === 'turb' ? (pyrScreen[(y + 40) * 128 + x + 40] * p.amp) / 2.2
        : p.amp * zernike(+p.mode, Math.hypot(dx, dy), Math.atan2(dy, dx));
  }
  const r = p.curve ? null : pyramidWFS(ph, { Np, rmod: p.rmod });
  let curve = null;
  if (p.curve) {
    curve = [];
    for (const a of [0, 0.15, 0.4, 0.8, 1.3, 2, 3, 4.5]) {
      const t = new Float64Array(Np * Np);
      for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) t[y * Np + x] = (2 * Math.PI * a * (x - R)) / Np;
      curve.push([a, a ? pyramidWFS(t, { Np, rmod: p.rmod }).mx : 0]);
    }
  }
  if (curve) return { result: { curve }, transfer: [] };
  const img = Float32Array.from(r.img), Sx = Float32Array.from(r.Sx), Sy = Float32Array.from(r.Sy);
  return { result: { img, Sx, Sy, inside: r.inside, mx: r.mx, my: r.my, steps: r.steps, phase: Float32Array.from(ph) }, transfer: [img.buffer, Sx.buffer, Sy.buffer] };
}

// Stitched two-frame panorama with parallax (see js/lib/panorama.js).
function panorama(p) {
  const r = renderPanorama(p);
  return { result: r, transfer: [r.rgb.buffer] };
}

// HDR lab pipeline: bracket, merge, tone map and exposure fusion (see js/lib/hdr.js).
function hdr(p) {
  const r = hdrPipeline(p);
  return { result: r, transfer: [r.shot.buffer, r.merged.buffer, ...(r.fused ? [r.fused.buffer] : [])] };
}

export const TASKS = { psfLab, zernikeLab, otfCurves, coronagraph, segPhasing, lensPSF, lensMTF, optimiseLens, tolerance, flareGhosts, bokehTraced, defocusPSF, polarLake, macroRuler, aoLoop, pyramid, panorama, hdr };
