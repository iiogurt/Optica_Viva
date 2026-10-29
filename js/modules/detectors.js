import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { rng, ramp, slopeCDS, slopeLS, slopeJump, slopeVarianceLS, slopeVarianceCDS, ipc, ipcVarianceFactor, ctiColumn, persistenceRate } from '../lib/detectors.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A space telescope's camera is more than a grid of light buckets. Infrared detectors can be read again and again during one exposure without being erased, so the charge in each pixel is seen growing step by step. If a cosmic-ray particle hits a pixel, its charge jumps suddenly, and the jump can be cut out instead of ruining the measurement.</p>
<p>Small effects matter too: neighbouring pixels leak a little signal into each other, radiation-damaged CCDs smear charge into trails, and bright stars leave ghost images in the next exposure. Precise measurements depend on modelling every one.</p>`, [
    "With the cosmic ray on, compare the first-and-last-read estimate (CDS) with the fit that detects jumps: one hit ruins the simple estimate.",
    "Increase the <strong>Reads per exposure</strong> from 2 to 100 and watch the slope noise fall.",
    "In the inter-pixel capacitance section below, raise the coupling: a single hot pixel spreads into a cross.",
  ]));

  // ── up the ramp ──
  const ctl = controls({
    N: { type: 'range', label: 'Reads per exposure', min: 2, max: 100, step: 1, value: 20 },
    dt: { type: 'range', label: 'Time between reads', min: 1, max: 60, step: 0.1, value: 10.7, unit: 's' },
    f: { type: 'range', label: 'Source flux', min: 0.01, max: 100, log: true, value: 2, unit: 'e⁻/s' },
    sigma: { type: 'range', label: 'Read noise (per read)', min: 1, max: 30, step: 0.5, value: 15, unit: 'e⁻' },
    cr: { type: 'toggle', label: 'Cosmic-ray hit during the exposure', value: true },
    jump: { type: 'range', label: 'Cosmic-ray charge', min: 20, max: 5000, log: true, value: 400, unit: 'e⁻', when: (st) => st.cr },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const rampView = stage({ aspect: 2.3, label: '', draw: drawRamp, cls: 'plain', minH: 220 });
  const noiseView = stage({ aspect: 2.3, label: '', draw: drawNoise, cls: 'plain', minH: 200 });
  const btn = h('button.btn', { type: 'button' }, t('New exposure'));
  root.append(lab([h('div.card', { style: { padding: '6px' } }, rampView.el), h('div', {}, btn), h('div.card', { style: { padding: '6px' } }, noiseView.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));
  let seed = 3, R = null;
  btn.addEventListener('click', () => { seed++; update(); });
  function update() {
    const st = ctl.state, r = rng(seed), crAt = st.cr ? Math.max(1, Math.floor(st.N * 0.45)) : 0, S = ramp({ N: st.N, dt: st.dt, f: st.f, sigma: st.sigma, crAt, jump: st.jump }, r);
    const cds = slopeCDS(S, st.dt), ls = slopeLS(S, st.dt), jf = slopeJump(S, st.dt, st.sigma);
    const vL = slopeVarianceLS(st.N, st.dt, st.sigma, st.f), vC = slopeVarianceCDS(st.N, st.dt, st.sigma, st.f);
    R = { st, S, cds, ls, jf, crAt };
    ro.replaceChildren(readouts([
      ['True flux', st.f.toFixed(3) + ' e⁻/s'],
      ['CDS (last − first)', cds.toFixed(3) + ' e⁻/s'],
      ['Least-squares fit, all reads', ls.toFixed(3) + ' e⁻/s'],
      ['Fit with jump detection', `${jf.slope.toFixed(3)} e⁻/s (jumps at read ${jf.jumps.join(', ') || '—'})`],
      ['Slope noise: CDS · LS', `${Math.sqrt(vC).toFixed(3)} · ${Math.sqrt(vL).toFixed(3)} e⁻/s`],
    ]));
    calc.say(st.cr
      ? t('The true flux is {f} e⁻/s. The first and last reads alone give <strong>{cds}</strong>, a straight-line fit to all {N} reads <strong>{ls}</strong>, and the fit that detects the cosmic-ray jump <strong>{jf}</strong> e⁻/s.', { f: st.f, cds: cds.toFixed(2), N: st.N, ls: ls.toFixed(2), jf: jf.slope.toFixed(2) })
      : t('The true flux is {f} e⁻/s. The first and last reads alone give <strong>{cds}</strong>, a straight-line fit to all {N} reads <strong>{ls}</strong> e⁻/s.', { f: st.f, cds: cds.toFixed(2), N: st.N, ls: ls.toFixed(2) }));
    calc.set(String.raw`\begin{aligned}
    \sigma^2_\text{LS} &= \tfrac{\sigma_r^2}{\sum(t_i-\bar t)^2} + f\Delta t\textstyle\sum_k W_k^2\\
    &= ${texNum(vL, 3)},\quad W_k = \textstyle\sum_{i\ge k} w_i\\
    \sigma^2_\text{CDS} &= \frac{2\sigma_r^2}{T^2} + \frac{f}{T} = ${texNum(vC, 3)}
    \end{aligned}`);
    [rampView, noiseView].forEach((x) => x.redraw());
  }
  function drawRamp(ctx, w, hh) {
    if (!R) return;
    const { st } = R, S = Array.from(R.S), ts = S.map((_, i) => (i + 1) * st.dt), line = (b, a0) => ts.map((t) => [t, a0 + b * t]);
    const meanT = ts.reduce((a, b) => a + b, 0) / ts.length, meanS = S.reduce((a, b) => a + b, 0) / S.length;
    plot(ctx, w, hh, {
      title: 'Non-destructive reads of one pixel during an exposure', x: { min: 0, max: ts[ts.length - 1] * 1.03, label: 'time (s)' }, y: { min: Math.min(...S) - 30, max: Math.max(...S) + 30, label: 'accumulated charge (e⁻)' },
      series: [
        { data: ts.map((t, i) => [t, S[i]]), color: '#ffffff', width: 0, points: 3, label: 'reads' },
        { data: line(R.ls, meanS - R.ls * meanT), color: '#ff9cc0', width: 1.6, dash: [5, 3], label: 'least squares' },
        { data: [[ts[0], S[0]], [ts[ts.length - 1], S[S.length - 1]]], color: '#6ad7ff', width: 1.4, dash: [2, 3], label: 'CDS' },
        { data: line(st.f, S[0] - st.f * ts[0]), color: 'rgba(107,227,164,0.7)', width: 1.4, label: 'true flux' },
      ],
      legend: true, legendX: 70, legendY: 34,
    });
  }
  function drawNoise(ctx, w, hh) {
    if (!R) return;
    const st = R.st, Ns = Array.from({ length: 99 }, (_, i) => i + 2), T = (st.N - 1) * st.dt;
    const all = Ns.flatMap((n) => [Math.sqrt(slopeVarianceCDS(n, T / (n - 1), st.sigma, st.f)), Math.sqrt(slopeVarianceLS(n, T / (n - 1), st.sigma, st.f))]).concat([Math.sqrt(st.f / T)]);
    plot(ctx, w, hh, {
      title: t('Slope noise for a fixed exposure of {T} s', { T: T.toFixed(0) }), x: { min: 2, max: 100, log: true, label: 'reads per exposure' }, y: { min: Math.min(...all) * 0.7, max: Math.max(...all) * 1.4, log: true, label: 'σ(slope) (e⁻/s)' },
      series: [
        { data: Ns.map((n) => [n, Math.sqrt(slopeVarianceCDS(n, T / (n - 1), st.sigma, st.f))]), color: '#6ad7ff', width: 2, label: 'CDS' },
        { data: Ns.map((n) => [n, Math.sqrt(slopeVarianceLS(n, T / (n - 1), st.sigma, st.f))]), color: '#ff9cc0', width: 2, label: 'least squares' },
        { data: Ns.map((n) => [n, Math.sqrt(st.f / T)]), color: 'rgba(255,255,255,0.35)', width: 1, dash: [4, 3], label: 'photon noise limit' },
      ],
      vlines: [{ x: st.N, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: w - 190, legendY: 34,
    });
  }

  // ── IPC ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Inter-pixel capacitance'));
  const ictl = controls({ alpha: { type: 'range', label: 'Coupling α to each neighbour', min: 0, max: 0.03, step: 0.0005, value: 0.015, fmt: (v) => (v * 100).toFixed(2) + ' %' } }, () => updI());
  const iro = h('div');
  const ipcView = stage({ aspect: 2, label: 'A single hot pixel (left) as recorded with IPC (right), log scale', draw: drawIPC, minH: 180 });
  sec2.append(lab([ipcView.el], [h('div.card', {}, ictl.el), h('div.card', {}, iro)]));
  root.append(sec2);
  function updI() {
    const a = ictl.state.alpha, fct = ipcVarianceFactor(a);
    iro.replaceChildren(readouts([['Charge in the central pixel', ((1 - 4 * a) * 100).toFixed(1) + ' %'], ['Variance of a flat field reduced by', fct.toFixed(4)], ['Photon-transfer gain overestimated by', ((1 / fct - 1) * 100).toFixed(1) + ' %']]));
    ipcView.redraw();
  }
  function drawIPC(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const n = 9, img = new Float64Array(n * n); img[4 * n + 4] = 1;
    const out = ipc(img, n, n, ictl.state.alpha), sz = Math.min(w / 2, hh) - 20;
    [img, out].forEach((a, side) => {
      const ic = imageCanvas(n, n);
      for (let k = 0; k < n * n; k++) { const t = Math.round(255 * Math.max(0, 1 + Math.log10(Math.max(a[k], 1e-4)) / 4)) * 3; ic.data[k * 4] = INF[t]; ic.data[k * 4 + 1] = INF[t + 1]; ic.data[k * 4 + 2] = INF[t + 2]; ic.data[k * 4 + 3] = 255; }
      ic.put();
      const x0 = side * (w / 2) + (w / 2 - sz) / 2; ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, x0, (hh - sz) / 2, sz, sz);
      if (side) { ctx.fillStyle = '#fff'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText((a[3 * n + 4] * 100).toFixed(2) + ' %', x0 + sz / 2, (hh - sz) / 2 + (3.5 / n) * sz + 4); ctx.textAlign = 'left'; }
    });
  }

  // ── CTI ──
  const sec3 = h('section.block', {}, h('h2', {}, 'Charge-transfer inefficiency in a radiation-damaged CCD'));
  const cctl = controls({
    eps: { type: 'range', label: 'Charge lost per transfer (CTI)', min: 1e-6, max: 1e-3, log: true, value: 3e-5, fmt: (v) => v.toExponential(1) },
    tau: { type: 'range', label: 'Trap release time', min: 0.5, max: 20, log: true, value: 3, unit: 'pixels' },
    rows: { type: 'range', label: 'Rows from the readout register', min: 100, max: 4000, log: true, value: 2000 },
  }, () => updC());
  const cro = h('div');
  const ctiView = stage({ aspect: 2.2, label: 'Stars read out towards the bottom (register): charge trails behind each (log stretch)', draw: drawCTI, minH: 200 });
  sec3.append(lab([ctiView.el], [h('div.card', {}, cctl.el), h('div.card', {}, cro)]));
  root.append(sec3);
  let C = null;
  function updC() {
    const st = cctl.state, H = 120, W = 240, img = new Float64Array(W * H), r = rng(5);
    for (let s = 0; s < 40; s++) { const x = Math.floor(r.u() * W), y = Math.floor(r.u() * (H - 10)), f = 200 * Math.pow(10, r.u() * 2); for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = x + i, Y = y + j; if (X >= 0 && X < W && Y >= 0 && Y < H) img[Y * W + X] += f * Math.exp(-(i * i + j * j) / 1.5); } }
    const out = new Float64Array(W * H);
    for (let x = 0; x < W; x++) {
      // readout register at the bottom: reverse the column so that index 0 reaches it first
      const col = new Float64Array(H); for (let y = 0; y < H; y++) col[y] = img[(H - 1 - y) * W + x] + 5;
      const res = ctiColumn(col, Math.round(st.rows), st.eps, st.tau);
      for (let y = 0; y < H; y++) out[(H - 1 - y) * W + x] = res[y];
    }
    C = { W, H, out };
    const loss = 1 - Math.pow(1 - st.eps, st.rows);
    cro.replaceChildren(readouts([['Flux lost from a star’s core', (100 * loss).toFixed(2) + ' %'], ['Equivalent astrometric bias', 'centroid pulled away from the register'], ['Charge transfer efficiency', (1 - st.eps).toFixed(6)]]));
    ctiView.redraw();
  }
  function drawCTI(ctx, w, hh) {
    if (!C) return;
    const ic = imageCanvas(C.W, C.H);
    for (let k = 0; k < C.W * C.H; k++) { const t = Math.round(255 * Math.max(0, Math.min(1, Math.log10(Math.max(C.out[k], 1)) / 4))) * 3; ic.data[k * 4] = INF[t]; ic.data[k * 4 + 1] = INF[t + 1]; ic.data[k * 4 + 2] = INF[t + 2]; ic.data[k * 4 + 3] = 255; }
    ic.put(); ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, 0, 0, w, hh);
  }

  // ── persistence ──
  const sec4 = h('section.block', {}, h('h2', {}, 'Persistence'));
  const pplot = stage({ aspect: 2.6, label: '', draw: (ctx, w, hh) => {
    const ts = logRange(10, 1e4, 80);
    plot(ctx, w, hh, { title: 'Charge released after a bright exposure (power-law decay, illustrative)', x: { min: 10, max: 1e4, log: true, label: 'time after the bright exposure (s)' }, y: { min: 1e-3, max: 10, log: true, label: 'persistence (e⁻/s)' },
      series: [1, 2, 5, 10].map((F, i) => ({ data: ts.map((t) => [t, Math.max(1e-3, persistenceRate(F, t))]), color: ['#6be3a4', '#6ad7ff', '#ffb547', '#ff6b6b'][i], width: 1.8, label: t('{F}× full well', { F }) })), legend: true, legendX: w - 160, legendY: 34 });
  }, cls: 'plain', minH: 200 });
  sec4.append(h('div.card', { style: { padding: '6px' } }, pplot.el));
  root.append(sec4);

  update(); updI(); updC();

  root.append(rule(String.raw`\[\sigma_\text{slope} \approx \sqrt{\frac{12}{N}}\,\frac{\sigma_r}{T}\]
<p>Fitting a straight line to \(N\) reads spread over the exposure time \(T\) beats the read noise \(\sigma_r\) down as \(1/\sqrt N\). With 15 e⁻ of read noise, 100 reads over 1000 s give \(\sqrt{12/100} \times 15/1000 = 0.005\) e⁻/s, against \(\sqrt2 \times 15/1000 = 0.021\) e⁻/s from the first and last reads alone: four times better.</p>`,
    String.raw`This is the read-noise limit. For bright sources photon noise dominates and makes the reads correlated, so the best weights change (the full model computes them), and every detected cosmic ray costs the reads around it.`));
  root.append(theory('Detectors in space', String.raw`
<div class="theory-cols"><div>
<h3>Up-the-ramp sampling</h3>
<p>Infrared arrays such as JWST's HgCdTe detectors are read without resetting, so each exposure is a ramp of \(N\) reads. Correlated double sampling uses only the first and last read: variance \(2\sigma_r^2/T^2 + f/T\). A least-squares fit uses all reads and beats CDS when read noise dominates. Because the accumulated charge is a running sum, the photon noise in successive reads is correlated. The exact variance of the fitted slope is</p>
\[\sigma^2 = \frac{\sigma_r^2}{\sum_i(t_i-\bar t)^2} + f\,\Delta t\sum_k\Big(\sum_{i\ge k}w_i\Big)^2,\qquad w_i=\frac{t_i-\bar t}{\sum(t-\bar t)^2},\]
<p>which the test suite checks against Monte-Carlo ramps. A cosmic ray adds a step. A fit through it is badly biased, but the step stands out in the differences between consecutive reads. Fitting the segments on either side and combining them recovers the flux. This is the principle of the JWST and Roman jump-detection pipelines.</p>
<h3>Inter-pixel capacitance</h3>
<p>Charge in one pixel induces a small voltage in its neighbours: α ≈ 1–2 % each in HgCdTe arrays. The signal is conserved, but the noise is correlated between pixels, so a flat field's variance shrinks by \((1-4\alpha)^2+4\alpha^2\). The photon-transfer method then overestimates the conversion gain by several per cent, and point sources and cosmic rays look slightly blurred.</p>
</div><div>
<h3>Charge-transfer inefficiency</h3>
<p>A CCD reads out by clocking every charge packet across all the rows between it and the register. Radiation in space creates lattice defects that trap electrons and release them later, behind the packet. After \(n\) transfers the core of a star keeps \((1-\varepsilon)^n\) of its charge; the rest appears as a trail. Faint sources lose proportionally more in real devices, because a few electrons fill few traps. That flux and centroid bias must be corrected before weak-lensing shear can be measured (Hubble's ACS, Gaia, Euclid). This page uses a single trap species with exponential release.</p>
<h3>Persistence</h3>
<p>Charge trapped during a heavily saturated exposure leaks out over minutes to hours, leaving ghost images in subsequent exposures. Its decay is close to a power law of time. The curves here are illustrative, not calibrated to a specific detector.</p>
</div></div>`));
  root.append(references([
    'B. J. Rauscher et al., “Detectors for the James Webb Space Telescope Near-Infrared Spectrograph. I. Readout mode, noise model, and calibration considerations”, <em>PASP</em> 119, 768 (2007).',
    'A. C. Moore, Z. Ninkov &amp; W. J. Forrest, “Quantum efficiency overestimation and deterministic cross talk resulting from interpixel capacitance”, <em>Opt. Eng.</em> 45, 076402 (2006).',
    'R. Massey et al., “Pixel-based correction for charge transfer inefficiency in the Hubble Space Telescope Advanced Camera for Surveys”, <em>MNRAS</em> 401, 371 (2010).',
    'R. M. Smith et al., “A theory for image persistence in HgCdTe photodiodes”, <em>Proc. SPIE</em> 7021 (2008).',
  ]));

  return () => [rampView, noiseView, ipcView, ctiView, pplot].forEach((x) => x.destroy());
}
