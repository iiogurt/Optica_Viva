import { h, controls, stage, readouts, imageCanvas, texNum, reducedMotion } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { run } from '../lib/compute.js';
import { nollResidual } from '../lib/wfs.js';

const NP = 120, D = 8, DX = D / NP, NPSF = 256; // 8 m telescope, 120 px pupil, WFS at 600 nm (see js/lib/wfs.js)
const DIV = lut('diverging'), INF = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Adaptive optics measures the atmosphere\'s distortion of a star\'s wavefront hundreds of times a second and cancels it with a deformable mirror. This lab simulates the whole loop: a Shack–Hartmann sensor that forms one diffraction spot per lenslet, centroids with photon and read noise, a least-squares reconstructor, and an integrator driving the mirror against turbulence blowing across an 8 m telescope.', domains: ['space'] }));

  const ctl = controls({
    loop: { type: 'seg', label: 'Loop', value: 'closed', options: [['open', 'Open (no correction)'], ['closed', 'Closed']] },
    nsub: { type: 'seg', label: 'Lenslets across the pupil', value: '12', options: ['8', '10', '12', '15', '20'] },
    J: { type: 'range', label: 'Corrected Zernike modes (up to Noll j)', min: 3, max: 150, step: 1, value: 66 },
    r0: { type: 'range', label: 'Fried parameter r₀ at 500 nm', min: 0.05, max: 0.3, step: 0.005, value: 0.15, unit: 'm' },
    wind: { type: 'range', label: 'Wind speed', min: 0, max: 40, step: 0.5, value: 10, unit: 'm/s' },
    fs: { type: 'range', label: 'Loop frequency', min: 50, max: 3000, log: true, value: 500, unit: 'Hz' },
    gain: { type: 'range', label: 'Integrator gain', min: 0.05, max: 1, step: 0.01, value: 0.4 },
    nph: { type: 'range', label: 'Photons per lenslet per frame', min: 5, max: 1e5, log: true, value: 500 },
    ron: { type: 'range', label: 'Read noise', min: 0, max: 8, step: 0.1, value: 1, unit: 'e⁻' },
    lsci: { type: 'seg', label: 'Science band', value: '1650', options: [['650', 'R 0.65 µm'], ['1250', 'J 1.25 µm'], ['1650', 'H 1.65 µm'], ['2200', 'K 2.2 µm']] },
  }, () => configure());
  const ro = h('div');
  const calc = liveCalc();
  const shView = stage({ aspect: 1, label: 'Shack–Hartmann detector: one diffraction spot per lenslet', draw: drawSH, minH: 220 });
  const psfView = stage({ aspect: 1, label: 'Science PSF, short (left) and long exposure (right), log', draw: drawPSF, minH: 220 });
  const phView = stage({ aspect: 3, label: 'Turbulence · deformable mirror · residual (OPD, common scale)', draw: drawPhase, minH: 150 });
  const series = stage({ aspect: 2.6, label: '', draw: drawSeries, cls: 'plain', minH: 200 });
  const modal = stage({ aspect: 2.6, label: '', draw: drawModal, cls: 'plain', minH: 200 });
  const runBtn = h('button.btn', { type: 'button' }, 'Pause');
  const note = h('p.note', {}, '');
  root.append(lab([h('div.grid-2', {}, shView.el, psfView.el), phView.el, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, runBtn, note), h('div.card', { style: { padding: '6px' } }, series.el), h('div.card', { style: { padding: '6px' } }, modal.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // The loop runs in the compute worker (a persistent simulator): each request advances it for
  // ~120 ms of computing and returns the last frame. Controls reconfigure it in place.
  let S = null, info = null, busy = false, alive = true, running = !reducedMotion(), pendingCfg = null, raf = 0;
  runBtn.textContent = running ? 'Pause' : 'Run';
  runBtn.addEventListener('click', () => { running = !running; runBtn.textContent = running ? 'Pause' : 'Run'; if (running) pump(); });
  const cfg = (reset) => { const st = ctl.state; return { nsub: +st.nsub, J: Math.round(st.J), r0: st.r0, wind: st.wind, fs: st.fs, gain: st.gain, nph: st.nph, ron: st.ron, loop: st.loop, lsci: +st.lsci, reset }; };
  let first = true;
  function configure() { pendingCfg = cfg(first); first = false; if (!busy) pump(); }
  function pump() {
    if (!alive || busy) return;
    const config = pendingCfg;
    pendingCfg = null;
    if (!config && !running && S) return;
    busy = true;
    if (config && !info) note.textContent = 'Building the sensor and reconstructor…';
    run('aoLoop', { config, run: 120 }).then((r) => {
      busy = false;
      if (!alive) return;
      if (r.info) info = r.info;
      S = { st: { ...ctl.state }, ...r.frame };
      budget();
      [shView, psfView, phView, series, modal].forEach((x) => x.redraw());
      readout();
      if (pendingCfg || running) raf = requestAnimationFrame(pump);
    }, (e) => { busy = false; note.textContent = 'Simulation failed: ' + e.message; });
  }

  let B = null;
  function budget() {
    const st = S.st, lam = +st.lsci, Dr0 = D / st.r0, toNm = 500 / (2 * Math.PI);
    const fit = nollResidual(info.modes + 1) * Dr0 ** (5 / 3) * toNm ** 2; // nm²
    const fG = (0.427 * st.wind) / st.r0, f3 = (st.gain * st.fs) / (2 * Math.PI);
    const temp = st.loop === 'closed' ? Math.pow(fG / f3, 5 / 3) * toNm ** 2 : 0;
    const noise = st.loop === 'closed' ? info.prop * info.noiseVar * (st.gain / (2 - st.gain)) : 0;
    const open = 1.0299 * Dr0 ** (5 / 3) * toNm ** 2;
    const total = st.loop === 'closed' ? fit + temp + noise : open;
    B = { fit, temp, noise, open, total, fG, f3, lam, Dr0, tau0: (0.314 * st.r0) / Math.max(st.wind, 1e-6), r0sci: st.r0 * Math.pow(lam / 500, 1.2) };
    calc.set(String.raw`\begin{aligned}
    \sigma^2_\text{fit} &= \Delta_{J}\left(\tfrac{D}{r_0}\right)^{5/3} \Rightarrow ${texNum(Math.sqrt(fit), 3)}\ \text{nm}\\
    \sigma^2_\text{temp} &= (f_G/f_{3\,\text{dB}})^{5/3} \Rightarrow ${texNum(Math.sqrt(temp), 3)}\ \text{nm}\\
    f_G &= 0.427\,v/r_0 = ${texNum(fG, 3)}\ \text{Hz}\\
    \sigma^2_\text{noise} &= \sigma^2_s\,\textstyle\sum R^2\,\tfrac{g}{2-g} \Rightarrow ${texNum(Math.sqrt(noise), 3)}\ \text{nm}\\
    S_{${lam}\,\text{nm}} &\approx e^{-(2\pi\sigma/\lambda)^2} = ${texNum(Math.exp(-(((2 * Math.PI * Math.sqrt(total)) / lam) ** 2)), 3)}
    \end{aligned}`);
  }
  function readout() {
    if (!info || !S) return;
    const hs = S.hist.slice(-Math.min(S.hist.length, 100)), avg = (i) => hs.reduce((a, r) => a + r[i], 0) / hs.length;
    const rmsR = Math.sqrt(hs.reduce((a, r) => a + r[2] * r[2], 0) / hs.length), lam = +S.st.lsci;
    let pk = 0; for (let q = 0; q < S.long.length; q++) if (S.long[q] > pk) pk = S.long[q];
    ro.replaceChildren(readouts([
      ['D / r₀ (500 nm) · r₀ at λ_sci', `${B.Dr0.toFixed(0)} · ${(B.r0sci * 100).toFixed(0)} cm`],
      ['Coherence time τ₀ (500 nm)', (B.tau0 * 1000).toFixed(1) + ' ms'],
      ['Lenslets used · modes · slopes', `${info.valid} · ${info.modes} · ${2 * info.valid}`],
      ['Turbulence RMS (open loop)', avg(1).toFixed(0) + ' nm'],
      ['Residual RMS (last 100 frames)', rmsR.toFixed(0) + ' nm'],
      ['Error budget (fit ⊕ temporal ⊕ noise)', Math.sqrt(B.total).toFixed(0) + ' nm'],
      ['Strehl at λ_sci: Maréchal · long-exposure peak', `${Math.exp(-(((2 * Math.PI * rmsR) / lam) ** 2)).toFixed(2)} · ${pk.toFixed(2)}`],
    ]));
    note.textContent = `t = ${(S.t * 1000).toFixed(0)} ms simulated, ${S.steps} loop frames (${S.batch} in the last batch, in the worker). Wind moves the screen ${(S.st.wind / (S.st.fs * DX)).toFixed(2)} pupil pixels per frame.`;
  }

  function drawSH(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!S || !S.img) return;
    const { img, W } = S, ic = imageCanvas(W, W);
    let mx = 1e-9; for (let q = 0; q < img.length; q++) if (img[q] > mx) mx = img[q];
    for (let q = 0; q < img.length; q++) { const v = Math.round(255 * Math.sqrt(Math.max(0, img[q]) / mx)), o = q * 4; ic.data[o] = INF[v * 3]; ic.data[o + 1] = INF[v * 3 + 1]; ic.data[o + 2] = INF[v * 3 + 2]; ic.data[o + 3] = 255; }
    ic.put();
    const sz = Math.min(w, hh) - 8, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, x0, y0, sz, sz);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    const n = info.nsub, c = sz / n;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * c, y0); ctx.lineTo(x0 + i * c, y0 + sz); ctx.moveTo(x0, y0 + i * c); ctx.lineTo(x0 + sz, y0 + i * c); ctx.stroke(); }
  }
  function drawPSF(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!S || !S.I) return;
    const C = 96, half = Math.min(w / 2, hh) - 6;
    [S.I, S.long].forEach((I, side) => {
      const ic = imageCanvas(C, C), norm = 1;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const v = I[(((y - C / 2) + NPSF) % NPSF) * NPSF + (((x - C / 2) + NPSF) % NPSF)] / norm;
        const t = Math.round(255 * Math.max(0, Math.min(1, 1 + Math.log10(Math.max(v, 1e-6)) / 5))), o = (y * C + x) * 4;
        ic.data[o] = INF[t * 3]; ic.data[o + 1] = INF[t * 3 + 1]; ic.data[o + 2] = INF[t * 3 + 2]; ic.data[o + 3] = 255;
      }
      ic.put();
      ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, side * (w / 2) + (w / 2 - half) / 2, (hh - half) / 2, half, half);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${(C / (NPSF / NP)).toFixed(0)} λ/D across · 5 decades`, 8, hh - 8);
  }
  function drawPhase(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!S || !S.turb) return;
    const maps = [S.turb, S.dm, S.res], pupil = S.pupil, rms = (m) => { let a = 0, b = 0, n = 0; for (let p = 0; p < m.length; p++) if (pupil[p]) { a += m[p]; b += m[p] * m[p]; n++; } return Math.sqrt(Math.max(0, b / n - (a / n) ** 2)); };
    let mx = 1e-9;
    for (let p = 0; p < NP * NP; p++) if (pupil[p]) mx = Math.max(mx, Math.abs(maps[0][p]));
    const sz = Math.min(hh - 26, w / 3 - 12);
    maps.forEach((m, i) => {
      let mean = 0, n = 0; for (let p = 0; p < NP * NP; p++) if (pupil[p]) { mean += m[p]; n++; } mean /= n;
      const ic = imageCanvas(NP, NP);
      for (let p = 0; p < NP * NP; p++) {
        const o = p * 4; if (!pupil[p]) { ic.data[o + 3] = 0; continue; }
        const t = Math.round((Math.max(-1, Math.min(1, (m[p] - mean) / mx)) * 0.5 + 0.5) * 255) * 3;
        ic.data[o] = DIV[t]; ic.data[o + 1] = DIV[t + 1]; ic.data[o + 2] = DIV[t + 2]; ic.data[o + 3] = 255;
      }
      ic.put();
      const x = (w / 3) * i + (w / 3 - sz) / 2;
      ctx.drawImage(ic.c, x, 4, sz, sz);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(['turbulence', 'mirror', 'residual'][i] + ` · ${rms(m).toFixed(0)} nm RMS`, x + sz / 2, hh - 6);
    });
  }
  function drawSeries(ctx, w, hh) {
    if (!S || !B || S.hist.length < 2) return;
    const H = S.hist, t0 = H[0][0] * 1000, t1 = Math.max(t0 + 1, H[H.length - 1][0] * 1000);
    plot(ctx, w, hh, {
      title: 'Wavefront error vs time', x: { min: t0, max: t1, label: 'simulated time (ms)' }, y: { min: 10, max: 5000, log: true, label: 'RMS (nm)' },
      series: [
        { data: H.map((r) => [r[0] * 1000, r[1]]), color: 'rgba(255,255,255,0.6)', width: 1.4, label: 'turbulence (open loop)' },
        { data: H.map((r) => [r[0] * 1000, Math.max(10, r[2])]), color: '#ffb547', width: 2, label: 'residual' },
        { data: [[t0, Math.sqrt(B.total)], [t1, Math.sqrt(B.total)]], color: '#6be3a4', width: 1.2, dash: [5, 4], label: 'error budget' },
      ],
      legend: true, legendX: w - 200, legendY: 34,
    });
  }
  function drawModal(ctx, w, hh) {
    if (!S || !S.coefT) return;
    const K = S.coefT.length;
    const P = plot(ctx, w, hh, { title: 'Zernike coefficients of the turbulence and of the residual (|a_j|, nm)', x: { min: 1.5, max: K + 1.5, label: 'Noll index j' }, y: { min: 0.5, max: 3000, log: true, label: '|a_j| (nm)' }, series: [] });
    const bw = Math.max(1, (P.X(3) - P.X(2)) * 0.42);
    for (let i = 0; i < K; i++) {
      const x = P.X(i + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; const yt = P.Y(Math.max(0.5, Math.abs(S.coefT[i]))); ctx.fillRect(x - bw, yt, bw, P.Y(0.5) - yt);
      ctx.fillStyle = '#ffb547'; const yr = P.Y(Math.max(0.5, Math.abs(S.coefR[i]))); ctx.fillRect(x, yr, bw, P.Y(0.5) - yr);
    }
  }

  configure();

  root.append(theory('Sensing and correcting the wavefront', String.raw`
<div class="theory-cols"><div>
<h3>The Shack–Hartmann sensor</h3>
<p>A lenslet array in a pupil image cuts the wavefront into \(n\times n\) subapertures of size \(d\). Each lenslet focuses its patch to a spot, and the spot's displacement measures the mean tilt of the wavefront over the patch:</p>
\[\Delta x = \frac{f_\ell}{k}\,\langle\partial_x\phi\rangle_\text{sub},\qquad \text{centroid} = \frac{\sum_i I_i x_i}{\sum_i I_i}.\]
<p>For an untruncated spot the centre of gravity equals the intensity-weighted mean phase gradient exactly. Here every spot is computed by FFT of the lenslet's complex field, so diffraction, speckle at large \(d/r_0\), and the sinc² sidelobes of square lenslets are all present. A real centroid is computed in a window and above a threshold, so its gain depends on the spot. The interaction matrix is therefore calibrated through the sensor with two small tilts, as on a real bench.</p>
<h3>Noise</h3>
<p>With \(N_\text{ph}\) photons and a diffraction-limited spot, photon noise gives a phase-difference variance across a subaperture of \(\sigma^2 = \pi^2/(2N_\text{ph})\) rad² (Rousset 1999). Read noise adds a term that grows with the number of pixels in the window and with \(1/N_\text{ph}^2\). Thresholded centroids of sinc² spots are noisier still, so the error budget uses the slope noise measured on noise-only frames of this model. It propagates through the reconstructor as \(\sigma_s^2\sum R^2\) and is filtered by the loop by \(g/(2-g)\).</p>
<h3>Modal reconstruction</h3>
<p>The slopes \(\mathbf s\) depend linearly on the Zernike coefficients, \(\mathbf s = \mathbf D\mathbf a\). The least-squares estimate \(\hat{\mathbf a} = (\mathbf D^\mathsf T\mathbf D)^{-1}\mathbf D^\mathsf T\mathbf s\) (with a tiny regularisation) is the reconstructor. A modal mirror with \(J\) modes cannot remove the rest of the turbulence. Noll (1976) tabulated that <em>fitting error</em>, \(\Delta_J(D/r_0)^{5/3}\) rad², with \(\Delta_J\approx0.2944\,J^{-\sqrt3/2}\) for large \(J\). The test suite reproduces his \(\Delta_{21}\) on this page's phase screens.</p>
</div><div>
<h3>Closing the loop</h3>
<p>The mirror cannot move instantly, and the sensor sees only what is left after the mirror: the residual. A discrete integrator</p>
\[\mathbf c_{k+1} = \mathbf c_k + g\,\mathbf R\,\mathbf s_k\]
<p>drives the residual towards zero. A low gain averages noise but follows the turbulence slowly. A high gain follows fast turbulence but passes noise and becomes unstable near \(g = 2\) (less with extra delay). The rejection bandwidth is roughly \(f_{3\,\text{dB}}\approx g f_s/2\pi\). Turbulence evolves at the Greenwood frequency \(f_G = 0.427\,v/r_0\), so the temporal error is \((f_G/f_{3\,\text{dB}})^{5/3}\) rad². The modal plot shows the result: low orders, which carry most of the turbulence, are suppressed by orders of magnitude, while modes beyond \(J\) are untouched.</p>
<h3>Why AO works in the infrared</h3>
<p>The residual is an optical path difference in nanometres, almost the same at every wavelength, but the Strehl ratio \(e^{-(2\pi\sigma/\lambda)^2}\) depends on it relative to \(\lambda\). The same 150 nm residual gives a Strehl of 0.6 in K band and almost nothing in R band. Also \(r_0\propto\lambda^{6/5}\). Large telescopes therefore do their adaptive-optics science at 1–2.5 µm and sense the wavefront in visible light.</p>
<p>The turbulence is one von Kármán layer with a 25 m outer scale, which removes much of the tip-tilt power of pure Kolmogorov turbulence (\(1.03(D/r_0)^{5/3}\)) on an 8 m pupil, hence the modest open-loop RMS. Not modelled here: aliasing filters (the error from unseen high orders folding into the slopes is present in the simulation but not in the budget), mirror influence functions (the mirror is modal), detector pixels per lenslet (each spot is sampled at λ/(3d)), multiple turbulent layers and anisoplanatism.</p>
</div></div>`));
  root.append(references([
    'J. W. Hardy, <em>Adaptive Optics for Astronomical Telescopes</em>, Oxford University Press (1998).',
    'F. Roddier (ed.), <em>Adaptive Optics in Astronomy</em>, Cambridge University Press (1999), ch. 5 (G. Rousset, wavefront sensors) and ch. 4 (control).',
    'R. J. Noll, “Zernike polynomials and atmospheric turbulence”, <em>J. Opt. Soc. Am.</em> 66, 207 (1976).',
    'D. P. Greenwood, “Bandwidth specification for adaptive optics systems”, <em>J. Opt. Soc. Am.</em> 67, 390 (1977).',
    'W. H. Southwell, “Wave-front estimation from wave-front slope measurements”, <em>J. Opt. Soc. Am.</em> 70, 998 (1980).',
  ]));

  return () => { alive = false; cancelAnimationFrame(raf); [shView, psfView, phView, series, modal].forEach((x) => x.destroy()); };
}
