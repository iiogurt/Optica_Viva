// Integral-field spectroscopy: a rotating galaxy through seeing and an image slicer, the detector
// frame of side-by-side slice spectra, and the data cube rebuilt from it with Hα maps and spectra.
import { h, controls, stage, readouts, fmt, texNum, setControl } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, paintMap, keyOf, bilinear, encode } from '../lib/pixels.js';
import { lut } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { FOV, NALONG, NLAM, GAP, LINES, C_KMS, resolvingPower } from '../lib/ifu.js';
import { t, N_ } from '../lib/i18n.js';

const INF = lut('inferno'), VIR = lut('viridis'), DIV = lut('diverging');
const Z = 0.02, MASK = 5;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>An ordinary spectrograph looks through a narrow slit, so it records the spectrum of only one thin line across the sky. An <em>integral-field unit</em> records a spectrum for every point of a picture. An <em>image slicer</em> does it with small mirrors: it cuts the picture into thin strips and lays them end to end along one long slit, like cutting a page into strips and taping them into one ribbon. Unlike paper, the strips' light is then spread into colours.</p>
<p>From the detector a computer rebuilds a <em>data cube</em>: a picture at every wavelength. The glow of hydrogen gas shifts in colour where the gas moves towards or away from us, so the cube shows how a galaxy turns.</p>`, [
    'Make the <strong>seeing</strong> worse: will the measured rotation near the centre look faster or slower? Then check the velocity map.',
    'Widen the <strong>slices</strong> to 1″: predict what happens to the resolving power, then look at the spectrum.',
    'Shorten the <strong>exposure</strong> until the outer parts of the galaxy turn grey on the maps.',
  ]));

  const ctl = controls({
    incl: { type: 'range', label: 'Inclination of the disk', min: 0, max: 75, step: 1, value: 60, unit: '°', hint: 'up to 75°: a thinner disk would be narrower than the 0.125″ sky grid' },
    vmax: { type: 'range', label: 'Rotation speed', min: 50, max: 350, step: 5, value: 200, unit: 'km/s' },
    seeing: { type: 'range', label: 'Seeing (FWHM)', min: 0.3, max: 2, step: 0.05, value: 0.8, unit: '″' },
    w: { type: 'seg', label: 'Slice width', value: '0.25', options: [['0.25', '0.25″'], ['0.5', '0.5″'], ['1', '1″']] },
    R0: { type: 'seg', label: 'Spectrograph (R with 0.25″ slices)', value: '5000', options: [['2500', 'R 2500'], ['5000', 'R 5000'], ['10000', 'R 10 000']] },
    t: { type: 'range', label: 'Exposure time', min: 60, max: 14400, log: true, value: 1800, fmt: (v) => (v < 600 ? `${Math.round(v)} s` : `${fmt(v / 60, 3)} min`) },
    flux: { type: 'range', label: 'Hα flux of the galaxy', min: -15.5, max: -13, step: 0.05, value: -13.7, fmt: (v) => `${fmt(10 ** (v - Math.floor(v)), 2)} × 10${sup(Math.floor(v))} erg s⁻¹ cm⁻²` },
    x: { type: 'range', label: 'Spectrum at x', min: -FOV / 2 + 0.125, max: FOV / 2 - 0.125, step: 0.125, value: 1, unit: '″' },
    y: { type: 'range', label: 'Spectrum at y', min: -FOV / 2 + 0.125, max: FOV / 2 - 0.125, step: 0.125, value: 0.5, unit: '″' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const sky = stage({ aspect: 1, label: 'The galaxy through the seeing (Hα red, stars white) and the slices', draw: drawSky, minH: 220 });
  const det = stage({ aspect: 3.2, label: 'The detector: each slice\'s spectrum side by side (wavelength downwards)', draw: drawDetector, minH: 200 });
  const mFlux = stage({ aspect: 1, label: 'Rebuilt: Hα flux', draw: (c, w, hh) => drawMap(mFlux, c, w, hh, 'flux'), minH: 160 });
  const mVel = stage({ aspect: 1, label: 'Rebuilt: velocity', draw: (c, w, hh) => drawMap(mVel, c, w, hh, 'v'), minH: 160 });
  const mSig = stage({ aspect: 1, label: 'Rebuilt: velocity dispersion', draw: (c, w, hh) => drawMap(mSig, c, w, hh, 'sigma'), minH: 160 });
  const specSt = stage({ aspect: 2.6, label: '', name: N_('Spectrum of the chosen spaxel'), draw: drawSpectrum, cls: 'plain', minH: 200 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([det.el, h('div.grid-2', {}, sky.el, mVel.el), h('div.grid-2', {}, mFlux.el, mSig.el), card(specSt)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // clicking a picture or map chooses the spaxel whose spectrum is shown
  const pick = (st) => st.canvas.addEventListener('click', (e) => {
    const r = st.canvas.getBoundingClientRect(), box = st.box;
    if (!box) return;
    const u = (e.clientX - r.left - box.x) / box.w, v = (e.clientY - r.top - box.y) / box.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    setControl('x', Math.round(((u - 0.5) * FOV) / 0.125) * 0.125);
    setControl('y', Math.round(((0.5 - v) * FOV) / 0.125) * 0.125);
  });
  [sky, mFlux, mVel, mSig].forEach(pick);

  const job = latest('ifu');
  let D = null, lastKey = '', timer = 0;
  function update() {
    const st = ctl.state, key = JSON.stringify([st.R0, st.w, st.seeing, st.incl, st.vmax, st.flux, st.t]);
    // choosing another spaxel only redraws
    if (D && key === lastKey) { show(); return; }
    lastKey = key;
    // while a slider is dragged, compute only where it pauses (each job takes a second or two)
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = ctl.state;
      job('ifu', { R0: +q.R0, w: +q.w, seeing: q.seeing, incl: q.incl, vmax: q.vmax, fluxHa: 10 ** q.flux * 1e-3, t: q.t, z: Z }).then((r) => { D = { ...r, st: { ...q } }; show(); }, (e) => console.error(e));
    }, D ? 150 : 0);
    if (D) show(); else { calc.say(t('Tracing the light through the slicer…')); [sky, det, mFlux, mVel, mSig, specSt].forEach((s) => s.redraw()); }
  }
  const spaxelOf = (st, d) => {
    const w = +d.st.w, s = Math.min(d.ns - 1, Math.max(0, Math.floor((st.y + FOV / 2) / w))), a = Math.min(NALONG - 1, Math.max(0, Math.floor((st.x + FOV / 2) / 0.25)));
    return { s, a, sp: s * NALONG + a };
  };
  function show() {
    const d = D, st = ctl.state, ns = d.ns, w = +d.st.w, n = ns * NALONG;
    let good = 0, e2 = 0, peak = 0;
    const speeds = [];
    for (let i = 0; i < n; i++) { peak = Math.max(peak, d.snr[i] || 0); if (d.snr[i] >= MASK && isFinite(d.v[i])) { good++; e2 += (d.v[i] - d.truthV[i]) ** 2; speeds.push(Math.abs(d.v[i])); } }
    speeds.sort((p, q) => p - q);
    const vmaxObs = speeds.length ? speeds[Math.floor(0.95 * (speeds.length - 1))] : 0;
    const rms = good ? Math.sqrt(e2 / good) : NaN, dv = C_KMS / d.R, sigKms = (C_KMS * d.sigInst) / d.lc, vproj = d.st.vmax * Math.sin((d.st.incl * Math.PI) / 180);
    const { sp } = spaxelOf(st, d);
    ro.replaceChildren(readouts([
      ['Spaxels', t('{n} = {s} slices × {a}, each {w}″ × 0.25″', { n: n, s: ns, a: NALONG, w })],
      ['Resolving power R', fmt(d.R, 4)],
      ['Velocity resolution c/R', `${fmt(dv, 3)} km/s`],
      ['Instrumental σ (calibrated)', `${fmt(sigKms, 3)} km/s`],
      ['Hα and [N II]', d.blended ? t('blended') : t('resolved')],
      ['Detector pixels used', `${d.cols} × ${NLAM} = ${fmt(d.cols * NLAM, 3)}`],
      ['Peak Hα S/N per spaxel', fmt(peak, 3)],
      ['Spaxels with S/N ≥ 5', `${good} / ${n}`],
      ['Velocity error (rms, S/N ≥ 5)', isFinite(rms) ? `${fmt(rms, 3)} km/s` : '—'],
      ['Measured speed (95th percentile) vs v sin i', `${fmt(vmaxObs, 3)} / ${fmt(vproj, 3)} km/s`],
    ]));
    const m = { snr: d.snr[sp], v: d.v[sp], N: d.flux[sp] };
    calc.say(d.blended
      ? t('With {w}″ slices the spectrograph reaches only R = {R}: Hα overlaps the [N II] lines beside it. Velocities are still measured, in a window kept clear of [N II], but less accurately, and the line widths are not reliable. Narrow the slices or choose a higher R.', { w, R: fmt(d.R, 3) })
      : t('The slicer turns the 8″ field into <strong>{n} spectra</strong> at R = {R}; {good} of them show Hα at S/N ≥ 5, and their velocities are good to <strong>{rms} km/s</strong> (rms against the seeing-blurred velocity of the gas, so noise and the slit effect both count as error).', { n, R: fmt(d.R, 3), good, rms: isFinite(rms) ? fmt(rms, 2) : '—' }));
    calc.set(String.raw`\begin{aligned}
    R &= R_0\,(0.25''/w) = ${texNum(d.R, 4)}\\
    \Delta v &= c/R = ${texNum(dv, 3)}\ \text{km/s}\\
    N_\text{pix} &= N_s(N_a + ${GAP})\,N_\lambda = ${texNum(d.cols * NLAM, 4)}\\
    \sigma_v &\approx c\,\sigma_\lambda/(\lambda\sqrt{N})\\
    N &= ${isFinite(m.N) ? texNum(Math.max(0, m.N), 3) : '—'}\ \text{photons (chosen spaxel)}
    \end{aligned}`);
    [sky, det, mFlux, mVel, mSig, specSt].forEach((s) => s.redraw());
  }

  function waiting(ctx, w, hh) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(t('Tracing the light through the slicer…'), w / 2, hh / 2); }
  const square = (st, w, hh, top = 26, bottom = 8) => { const S = Math.min(w - 16, hh - top - bottom); const box = { x: (w - S) / 2, y: top, w: S, h: S }; st.box = box; return box; };
  function marker(ctx, box) {
    const st = ctl.state, w = +D.st.w, { s, a } = spaxelOf(st, D);
    const x0 = box.x + ((a * 0.25) / FOV) * box.w, y0 = box.y + box.h - (((s + 1) * w) / FOV) * box.h;
    ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 2; ctx.strokeRect(x0 - 1, y0 - 1, (0.25 / FOV) * box.w + 2, (w / FOV) * box.h + 2);
  }
  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!D) return waiting(ctx, w, hh);
    const box = square(sky, w, hh, 26, 18), n = Math.round(Math.sqrt(D.skyHa.length));
    let hm = 0, cm = 0; for (let k = 0; k < D.skyHa.length; k++) { hm = Math.max(hm, D.skyHa[k]); cm = Math.max(cm, D.skyCont[k]); }
    // Hα in red, the stars' continuum in white; fine-grid rows run upwards in y
    const st = (q, k) => Math.asinh(k * Math.max(0, q)) / Math.asinh(k);
    paint(sky, box, (u, v, out) => {
      const x = u * n - 0.5, y = (1 - v) * n - 0.5, hv = 0.85 * st(bilinear(D.skyHa, n, n, x, y) / hm, 12), cv = 0.3 * st(bilinear(D.skyCont, n, n, x, y) / cm, 6);
      out[0] = encode(Math.min(1, hv + cv)); out[1] = encode(Math.min(1, 0.12 * hv + cv)); out[2] = encode(Math.min(1, 0.18 * hv + cv));
    }, `${keyOf(D)}|sky`);
    // the slices
    ctx.strokeStyle = `rgba(255,255,255,${D.ns > 16 ? 0.1 : 0.22})`; ctx.lineWidth = 1;
    for (let s = 1; s < D.ns; s++) { const y = box.y + (s / D.ns) * box.h; ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.strokeRect(box.x, box.y, box.w, box.h);
    marker(ctx, box);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(t('{n} slices × {w}″', { n: D.ns, w: D.st.w }), box.x, box.y + box.h + 13);
  }
  function drawDetector(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!D) return waiting(ctx, w, hh);
    const top = 26, box = { x: 8, y: top, w: w - 16, h: hh - top - 8 }, sky0 = D.skyCounts;
    let hi = 0; for (let k = 0; k < D.counts.length; k += 7) hi = Math.max(hi, D.counts[k]);
    const a = Math.asinh, s0 = Math.max(4, Math.sqrt(sky0 + 9));
    paintMap(det, box, { a: D.counts, w: D.cols, h: NLAM, lut: INF, linear: true, value: (v) => a((v - sky0) / s0 + 1.5) / a(hi / s0) }, `${keyOf(D)}|det`);
    // mark the chosen spaxel's column
    const { s, a: al } = spaxelOf(ctl.state, D), col = s * (NALONG + GAP) + al, x = box.x + ((col + 0.5) / D.cols) * box.w;
    ctx.strokeStyle = 'rgba(106,215,255,0.8)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h); ctx.stroke(); ctx.setLineDash([]);
  }
  function drawMap(st, ctx, w, hh, kind) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!D) return waiting(ctx, w, hh);
    // each spaxel drawn as a block: the map is expanded to a 128 × 128 grid before sampling
    const box = square(st, w, hh), ns = D.ns, G = 128, bx = G / NALONG, by = G / ns, a = new Float32Array(G * G), mask = new Float32Array(G * G), need = kind === 'sigma' ? 2 * MASK : MASK;
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s < ns; s++) for (let al = 0; al < NALONG; al++) {
      const src = s * NALONG + al, ok = D.snr[src] >= need && isFinite(D[kind][src]);
      const v = kind === 'flux' ? Math.log10(Math.max(D.flux[src], 1)) : D[kind][src];
      for (let y = Math.round((ns - 1 - s) * by); y < Math.round((ns - s) * by); y++) for (let x = Math.round(al * bx); x < Math.round((al + 1) * bx); x++) { a[y * G + x] = ok ? v : 0; mask[y * G + x] = ok ? 1 : 0; }
      if (ok) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!(hi > lo)) { lo = 0; hi = 1; }
    if (kind === 'sigma') { const q = Array.from(a).filter((x, i) => mask[i]).sort((p, r) => p - r); hi = Math.max(80, q.length ? q[Math.floor(0.95 * (q.length - 1))] : 80); }
    const vlim = Math.max(30, D.st.vmax * Math.sin((D.st.incl * Math.PI) / 180) * 1.05);
    const o = kind === 'v' ? { lut: DIV, value: (v) => 0.5 + v / (2 * vlim) } : kind === 'sigma' ? { lut: VIR, value: (v) => v / hi } : { lut: INF, value: (v) => (v - lo) / (hi - lo) };
    paintMap(st, box, { a, w: G, h: G, mask, bg: [26, 28, 36], linear: true, ...o }, `${keyOf(D)}|${kind}`);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(box.x, box.y, box.w, box.h);
    marker(ctx, box);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    const lab2 = kind === 'v' ? `±${Math.round(vlim)} km/s` : kind === 'sigma' ? `0–${Math.round(hi)} km/s` : t('log scale');
    ctx.fillText(lab2, box.x + box.w, box.y - 4);
  }
  function drawSpectrum(ctx, w, hh) {
    if (!D) return waiting(ctx, w, hh);
    const { sp, s, a } = spaxelOf(ctl.state, D), lam = Array.from({ length: NLAM }, (_, q) => D.l0 + (q + 0.5) * D.dl);
    const obs = D.cube.subarray(sp * NLAM, (sp + 1) * NLAM), mod = D.model.subarray(sp * NLAM, (sp + 1) * NLAM);
    let hi = 0, lo = 0; for (let q = 0; q < NLAM; q++) { hi = Math.max(hi, obs[q], mod[q]); lo = Math.min(lo, obs[q]); }
    const P = plot(ctx, w, hh, {
      title: t('Spectrum of spaxel {s}/{a} (S/N {snr})', { s: s + 1, a: a + 1, snr: fmt(Math.max(0, D.snr[sp]), 2) }),
      x: { min: lam[0], max: lam[NLAM - 1], label: 'observed wavelength (nm)' }, y: { min: Math.min(lo, -0.05 * hi), max: hi * 1.1 || 1, label: 'photons per pixel (sky subtracted)' },
      series: [
        { data: lam.map((l, q) => [l, mod[q]]), color: '#ffb547', width: 2.4, label: 'expected (no noise)' },
        { data: lam.map((l, q) => [l, obs[q]]), color: 'rgba(255,255,255,0.85)', width: 1, label: 'measured' },
      ],
      legend: true,
    });
    ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    LINES.forEach((L, k) => {
      const l = L.lam * (1 + Z); if (l < lam[0] || l > lam[NLAM - 1]) return;
      ctx.strokeStyle = 'rgba(106,215,255,0.35)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(P.X(l), P.Y(hi * 1.1)); ctx.lineTo(P.X(l), P.Y(Math.min(lo, -0.05 * hi))); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(106,215,255,0.8)'; ctx.fillText(w < 520 ? L.name.split(' ')[0] + (L.name.startsWith('[') ? ' ' + L.name.split(' ')[1] : '') : L.name, P.X(l), P.Y(hi * 1.05) + (k % 3) * 11);
    });
  }

  update();

  root.append(rule(String.raw`\[N_\text{spaxels}\times N_\lambda \le N_\text{detector pixels}\]
<p>A data cube has three dimensions but a detector only two, so every spatial element costs a whole spectrum of pixels. MUSE on the Very Large Telescope samples a 1′ × 1′ field at 0.2″, about 90 000 spaxels, each with about 3700 wavelengths: 3.3 × 10⁸ pixels, spread over 24 detectors of 4096 × 4096 (4 × 10⁸ pixels).</p>`,
    String.raw`Real formats need more: gaps between slices against cross-talk, guard pixels and spectrograph distortion take 10–20 % of the detector. Sampling the seeing finer or the spectrum wider costs pixels one for one.`));
  root.append(theory('Slicing the sky', String.raw`
<div class="theory-cols"><div>
<h3>Three ways to cut up an image</h3>
<p>An integral-field unit rearranges a two-dimensional field so that a spectrograph built for a long slit can take every point's spectrum at once. A <em>lenslet array</em> in the focal plane makes a grid of tiny pupil images and disperses each one (TIGER, OSIRIS); the spectra are tilted so they do not overlap. A <em>fibre bundle</em> picks up the field with optical fibres and re-arranges them along a slit (the SAMI and MaNGA surveys); fibres are flexible but lose light to focal-ratio degradation and gaps. An <em>image slicer</em> uses a stack of tilted mirrors to cut the field into strips and a second set of mirrors to lay them end to end; it keeps nearly all the light and the spatial information along each strip (Bowen 1938 for stellar slits; Content 1997 for integral fields; MUSE, KMOS, the JWST NIRSpec IFU). This page simulates a slicer.</p>
<h3>The model</h3>
<p>The galaxy is a thin rotating disk at redshift \(z = 0.02\) with an arctangent rotation curve \(v(R) = \tfrac{2}{\pi}v_\text{max}\arctan(R/r_t)\) (Courteau 1997, \(r_t = 0.8''\)), seen at inclination \(i\) with its major axis 20° from the slices, so that the line-of-sight velocity is \(v(R)\sin i\cos\varphi\). The gas has a velocity dispersion of 25 km/s, the Hα disk a scale length of 1.3″; the galaxy is cut off at the edge of the 8″ field. Hα and [N II] (fixed at 3 : 1 for the doublet) come from an exponential disk with star-forming knots, [S II] alongside; the stars give a continuum. Every 0.125″ sky pixel gets its own spectrum, each line integrated exactly over the spectral pixels with its gas velocity dispersion and the spectrograph optics. The seeing (a Gaussian) blurs this cube <em>wavelength by wavelength</em>: blurring a velocity map instead would miss beam smearing, because light from fast and slow gas mixes inside the line profile.</p>
<h3>The slice is the slit</h3>
<p>A slice of width \(w\) is the spectrograph's entrance slit, so the slit-limited resolving power is \(R(w) = R_0\,(0.25''/w)\), and light that enters a slice a distance \(\delta\) off its centre line lands \((\delta/w)\,\lambda/R\) further along the spectrum. The pipeline here, like a simple real one, assigns each pixel its nominal wavelength, so a slice lit unevenly (a compact knot, good seeing, wide slices) gets a false velocity: the <em>slit effect</em>. The page traces it sub-strip by sub-strip.</p>
</div><div>
<h3>Detector and rebuilt cube</h3>
<p>The slices sit side by side on the detector, two dark columns apart; each column is one spaxel's spectrum. The counts are Poisson in source plus sky (a 20.8 mag arcsec⁻² continuum) with 3 e⁻ read noise, for an 8 m telescope with 20 % throughput. Rebuilding the cube is the inverse map from detector columns to (slice, position); the known sky level is subtracted.</p>
<h3>Measuring the lines</h3>
<p>In each spaxel the continuum comes from line-free pixels, and Hα is measured by moments in a window re-centred on the line: flux \(F = \sum d_k\), velocity \(v = c\,(\bar\lambda/\lambda_\text{Hα}(1+z) - 1)\) and width \(\sigma^2 = \sum (\lambda_k - \bar\lambda)^2 d_k / F\). The instrument's own width is calibrated, as with an arc lamp, by sending a line of no intrinsic width through the same slicing and binning, and removed in quadrature: \(\sigma_\text{gas}^2 = \sigma^2 - \sigma_\text{inst}^2\). That calibration assumes an evenly lit slice; where a compact knot lights one edge, the true profile is narrower. The S/N counts the line's own photon noise as well as the sky's and the detector's. Spaxels below S/N 5 are greyed out on the flux and velocity maps, and below S/N 10 on the dispersion map, because a first moment drifts towards its window's centre in noise and a second moment needs more light still.</p>
<p>With photon noise alone the velocity is good to \(\sigma_v = c\,\sigma_\lambda/(\lambda\sqrt N)\) for \(N\) line photons; sky and read noise make it worse. When the instrumental profile is wider than about a fifth of the 1.5 nm between Hα and [N II] 6548, the lines blend and the page says so.</p>
<h3>What is left out</h3>
<p>Night-sky emission lines (OH), atmospheric dispersion and refraction, diffraction and cross-talk inside the slicer, detector cosmetics and calibration errors, and dust. The seeing is Gaussian and the same at every wavelength.</p>
</div></div>`));
  root.append(references([
    'I. S. Bowen, "The image-slicer, a device for reducing loss of light at slit of stellar spectrograph", <i>ApJ</i> 88, 113 (1938).',
    'R. Content, "A new design for integral field spectroscopy with 8-m telescopes", <i>Proc. SPIE</i> 2871, 1295 (1997).',
    'J. Allington-Smith, "Basic principles of integral field spectroscopy", <i>New Astron. Rev.</i> 50, 244 (2006).',
    'R. Bacon et al., "The MUSE second-generation VLT instrument", <i>Proc. SPIE</i> 7735, 773508 (2010).',
    'S. Courteau, "Optical rotation curves and linewidths for Tully–Fisher applications", <i>AJ</i> 114, 2402 (1997).',
    'Emission-line wavelengths (air) from the SDSS line list; [N II] 6583/6548 = 3 from atomic transition probabilities.',
  ]));
  return () => { clearTimeout(timer); [sky, det, mFlux, mVel, mSig, specSt].forEach((s) => s.destroy()); };
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sup(n) { return String(n).split('').map((c) => SUP[c] ?? c).join(''); }
