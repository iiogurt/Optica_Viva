import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { rasterAperture, psf, zernikeWavefront, mtfDiffraction, airy } from '../lib/pupil.js';
import { fft2d } from '../lib/fft.js';
import { cmf } from '../lib/color.js';
import { plot, range } from '../lib/plot.js';

const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: '"Sharpness" is a cascade of transfer functions. Diffraction, aberrations, defocus, the anti-aliasing filter and the pixel\'s own aperture each multiply the contrast at every spatial frequency. Whatever survives beyond the Nyquist frequency does not vanish: it folds back as moiré.', domains: ['photo', 'video', 'space'] }));

  const ctl = controls({
    N: { type: 'range', label: 'f-number', min: 1.4, max: 32, log: true, value: 5.6, fmt: (v) => 'f/' + v.toPrecision(2) },
    lam: { type: 'seg', label: 'Light', value: 'white', options: [['white', 'White (V(λ))'], ['550', '550 nm'], ['450', '450 nm'], ['650', '650 nm']] },
    defocus: { type: 'range', label: 'Defocus W₀₂₀ (waves P-V)', min: 0, max: 3, step: 0.01, value: 0 },
    sa: { type: 'range', label: 'Spherical W₀₄₀ (waves P-V)', min: -2, max: 2, step: 0.01, value: 0 },
    p: { type: 'range', label: 'Pixel pitch', min: 0.8, max: 9, step: 0.05, value: 4.3, unit: 'µm' },
    ff: { type: 'range', label: 'Pixel fill factor (microlens)', min: 0.3, max: 1, step: 0.01, value: 0.95, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    olpf: { type: 'range', label: 'OLPF split d (×pitch, 0 = none)', min: 0, max: 1.2, step: 0.01, value: 0, fmt: (v) => (v ? v.toFixed(2) + ' p' : 'none') },
    sep: { type: 'range', label: 'Two-point separation (λN)', min: 0.4, max: 2.5, step: 0.01, value: 1.22 },
  }, () => recompute());
  const ro = h('div');
  const calc = liveCalc();
  const chart = stage({ aspect: 2.2, label: '', draw: drawChart, cls: 'plain', minH: 240 });
  const opt = stage({ aspect: 1, label: 'Optical image on the sensor', draw: (c, w, hh) => drawStar(c, w, hh, 'optical') });
  const smp = stage({ aspect: 1, label: 'Sampled by pixels', draw: (c, w, hh) => drawStar(c, w, hh, 'sampled') });
  const two = stage({ aspect: 2.6, label: '', draw: drawTwo, cls: 'plain', minH: 200 });
  root.append(lab([h('div.card', { style: { padding: '6px' } }, chart.el), h('div.grid-2', {}, opt.el, smp.el), h('div.card', { style: { padding: '6px' } }, two.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // Siemens star, 512² simulation grid (4 sim px per sensor pixel), spectrum cached
  const NS = 512, OS = 4;
  const star = (() => {
    const re = new Float64Array(NS * NS), im = new Float64Array(NS * NS), spokes = 72;
    for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
      let v = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const dx = x + (sx + 0.5) / 3 - NS / 2, dy = y + (sy + 0.5) / 3 - NS / 2;
        const r = Math.hypot(dx, dy);
        v += r > 240 ? 0.5 : Math.sin(spokes * Math.atan2(dy, dx) / 2) ** 2 > 0.5 ? 0.92 : 0.06;
      }
      re[y * NS + x] = v / 9;
    }
    fft2d(re, im, NS);
    return { re, im };
  })();

  // Optics OTF (radial) from the pupil: PSF by FFT, then OTF = FFT(PSF), take the x cut.
  const n = 256, Dpx = 64, Q = n / Dpx;
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  function opticsOTF(def, sa) {
    // W in waves: defocus P-V  W020 ρ², spherical W040 ρ⁴ (Seidel form)
    const W = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r2 = ((x - n / 2) ** 2 + (y - n / 2) ** 2) / (Dpx / 2) ** 2;
      if (r2 <= 1.05) W[y * n + x] = def * r2 + sa * r2 * r2;
    }
    const { I } = psf(amp, W, n, 1);
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    // undo fftshift so the PSF peak sits at index 0 (keeps OTF phase linear-free)
    const hn = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[((y + hn) % n) * n + ((x + hn) % n)] = I[y * n + x];
    fft2d(re, im, n);
    const out = []; // ν̂ = k/(n/Q) up to 1
    for (let k = 0; k <= n / Q; k++) {
      const a = re[k], b = im[k], c = re[k * n], d = im[k * n];
      // rotationally symmetric aberrations → symmetric PSF → real (signed) OTF
      out.push([k / (n / Q), (a + c) / 2 / re[0]]);
    }
    return out;
  }
  const interp = (curve, x) => {
    if (x >= 1) return 0;
    const t = x * (curve.length - 1), i = Math.floor(t), f = t - i;
    return curve[i][1] * (1 - f) + (curve[i + 1]?.[1] ?? 0) * f;
  };

  let M = null;
  const recompute = debounce(() => {
    const st = ctl.state;
    const lams = st.lam === 'white' ? range(420, 680, 14) : [+st.lam];
    const wts = lams.map((l) => (st.lam === 'white' ? cmf(l)[1] : 1));
    const wsum = wts.reduce((a, b) => a + b, 0);
    // aberrations specified in waves at 550 nm → scale by 550/λ per wavelength
    const curves = lams.map((l) => ({ l, c: opticsOTF(st.defocus * 550 / l, st.sa * 550 / l) }));
    const N = st.N, p = st.p / 1000; // mm
    const nuC = (l) => 1 / ((l / 1e6) * N); // cycles/mm
    const optics = (nu) => curves.reduce((s, { l, c }, i) => s + wts[i] * interp(c, nu / nuC(l)), 0) / wsum;
    const diffr = (nu) => lams.reduce((s, l, i) => s + wts[i] * mtfDiffraction(nu / nuC(l)), 0) / wsum;
    const a = p * Math.sqrt(st.ff), d = st.olpf * p;
    const pix = (nu) => Math.abs(sinc(a * nu));
    const olpf = (nu) => (d ? Math.abs(Math.cos(Math.PI * d * nu)) : 1);
    const sys = (nu) => optics(nu) * pix(nu) * olpf(nu);
    const nyq = 1 / (2 * p);
    const numax = Math.max(nyq * 2.2, 50);
    const xs = range(0, numax, 300);
    const find = (fn, lvl) => { for (let i = 1; i < xs.length; i++) if (fn(xs[i]) < lvl) return xs[i]; return NaN; };
    const sysAbs = (nu) => Math.abs(sys(nu));
    M = { st: { ...st }, xs, optics, diffr, pix, olpf, sys, nyq, numax, nuC: nuC(550), mtf50: find(sys, 0.5), mtf10: find(sys, 0.1), p, a, d };
    ro.replaceChildren(readouts([
      ['Diffraction cut-off ν_c = 1/(λN)', fmt(nuC(550), 4) + ' cy/mm'],
      ['Nyquist ν_N = 1/(2p)', fmt(nyq, 4) + ' cy/mm'],
      ['System MTF50', fmt(M.mtf50, 3) + ' cy/mm'],
      ['System MTF at Nyquist', (Math.abs(sys(nyq)) * 100).toFixed(1) + ' %'],
      ['Optics MTF at Nyquist', (Math.abs(optics(nyq)) * 100).toFixed(1) + ' %'],
      ['Aliasing risk', sysAbs(nyq) > 0.1 ? 'high: moiré likely' : sysAbs(nyq) > 0.03 ? 'moderate' : 'low'],
      ['Rayleigh distance 1.22λN', (1.22 * 0.55 * N).toFixed(2) + ' µm'],
      ['f-number where ν_c = ν_N', 'f/' + (2 * st.p / 0.55).toFixed(1)],
    ]));
    calc.set(String.raw`\begin{aligned}
    \mathrm{MTF}_\text{sys} &= \mathrm{MTF}_\text{opt}\,\mathrm{MTF}_\text{pix}\,\mathrm{MTF}_\text{OLPF}\\
    \nu_c &= 1/(\lambda N) = ${texNum(nuC(550), 4)}\ \text{cy/mm}\\
    \nu_N &= \frac{1}{2p} = ${texNum(nyq, 4)}\ \text{cy/mm}\\
    \text{at }\nu_N:\ & ${texNum(optics(nyq), 3)}\times${texNum(pix(nyq), 3)}\times${texNum(olpf(nyq), 3)} = ${texNum(sys(nyq), 3)}
    \end{aligned}`);
    filterStar();
    chart.redraw(); two.redraw();
  }, 50);

  let starOpt = null, starSmp = null;
  function filterStar() {
    const { optics, pix, olpf, p } = M;
    const delta = p / OS; // mm per sim px
    const re = star.re.slice(), im = star.im.slice();
    for (let y = 0; y < NS; y++) {
      const fy = (y < NS / 2 ? y : y - NS) / NS / delta;
      for (let x = 0; x < NS; x++) {
        const fx = (x < NS / 2 ? x : x - NS) / NS / delta;
        const H = optics(Math.hypot(fx, fy)) * sinc(M.a * fx) * sinc(M.a * fy) * (M.d ? Math.cos(Math.PI * M.d * fx) * Math.cos(Math.PI * M.d * fy) : 1);
        re[y * NS + x] *= H; im[y * NS + x] *= H;
      }
    }
    fft2d(re, im, NS, true);
    const ic = imageCanvas(NS, NS);
    for (let k = 0; k < NS * NS; k++) { const v = Math.max(0, Math.min(1, re[k])) ** (1 / 2.2) * 255; ic.data[k * 4] = ic.data[k * 4 + 1] = ic.data[k * 4 + 2] = v; ic.data[k * 4 + 3] = 255; }
    ic.put(); starOpt = ic.c;
    // point-sample at pixel centres (pixel aperture already applied as sinc), show as blocks
    const P = NS / OS, is = imageCanvas(P, P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const v = Math.max(0, Math.min(1, re[(j * OS + OS / 2) * NS + i * OS + OS / 2])) ** (1 / 2.2) * 255;
      const k = (j * P + i) * 4; is.data[k] = is.data[k + 1] = is.data[k + 2] = v; is.data[k + 3] = 255;
    }
    is.put(); starSmp = is.c;
    opt.redraw(); smp.redraw();
  }

  function drawStar(ctx, w, hh, kind) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const im = kind === 'optical' ? starOpt : starSmp;
    if (!im) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = kind === 'optical';
    ctx.drawImage(im, (w - side) / 2, (hh - side) / 2, side, side);
    // Nyquist radius: spoke period equals 2 pixels where 2πr/72 = 2·OS sim px
    const rN = (72 * 2 * OS) / (2 * Math.PI) * (side / NS);
    ctx.strokeStyle = '#ff6b6b'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, rN, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect((w - side) / 2 + 6, hh - 24, 190, 18);
    ctx.fillStyle = '#ff9c9c'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('┄ Nyquist radius (moiré inside)', (w - side) / 2 + 10, hh - 11);
  }

  function drawChart(ctx, w, hh) {
    if (!M) return;
    const { xs } = M;
    plot(ctx, w, hh, {
      title: 'Modulation transfer functions', x: { min: 0, max: M.numax, label: 'spatial frequency (cycles/mm on the sensor)' }, y: { min: -0.3, max: 1.02, label: 'MTF / OTF' },
      bands: [{ x: [M.nyq, M.numax], color: 'rgba(255,107,107,0.06)' }],
      series: [
        { data: xs.map((x) => [x, M.diffr(x)]), color: 'rgba(255,255,255,0.4)', dash: [5, 4], width: 1.2, label: 'diffraction limit' },
        { data: xs.map((x) => [x, M.optics(x)]), color: '#6ad7ff', width: 1.6, label: 'optics OTF (signed)' },
        { data: xs.map((x) => [x, M.pix(x)]), color: '#ffd27a', width: 1.2, label: 'pixel aperture |sinc|' },
        ...(M.d ? [{ data: xs.map((x) => [x, M.olpf(x)]), color: '#c18cff', width: 1.2, label: 'OLPF |cos πdν|' }] : []),
        { data: xs.map((x) => [x, M.sys(x)]), color: '#ffb547', width: 2.6, label: 'system' },
      ],
      vlines: [{ x: M.nyq, color: '#ff6b6b', label: 'Nyquist' }, ...(isFinite(M.mtf50) ? [{ x: M.mtf50, color: '#ffb547', label: 'MTF50', dy: 14 }] : [])],
      legend: true, legendX: w - 200,
    });
  }

  function drawTwo(ctx, w, hh) {
    if (!M) return;
    const s = M.st.sep; // in λN; Airy v = π r/(λN)
    const xs = range(-3, 3 + s, 400).map((x) => x - s / 2);
    const I = (x) => airy(Math.PI * (x + s / 2)) + airy(Math.PI * (x - s / 2));
    const peak = Math.max(...xs.map(I));
    const dip = I(0) / peak;
    plot(ctx, w, hh, {
      title: `Two incoherent points ${s.toFixed(2)} λN apart: central dip ${(dip * 100).toFixed(1)} % of peak`,
      x: { min: -3, max: 3, label: 'position (λN)' }, y: { min: 0, max: 1.05, label: 'intensity' },
      series: [
        { data: xs.map((x) => [x, airy(Math.PI * (x + s / 2)) / peak]), color: 'rgba(106,215,255,0.6)', width: 1 },
        { data: xs.map((x) => [x, airy(Math.PI * (x - s / 2)) / peak]), color: 'rgba(193,140,255,0.6)', width: 1 },
        { data: xs.map((x) => [x, I(x) / peak]), color: '#ffb547', width: 2.4, fill: 'rgba(255,181,71,0.08)' },
      ],
      vlines: [{ x: -0.61, color: 'rgba(255,255,255,0.2)' }, { x: 0.61, color: 'rgba(255,255,255,0.2)' }],
      hlines: [{ y: 0.735, color: 'rgba(107,227,164,0.6)', label: 'Rayleigh dip (73.5 %)' }],
    });
  }

  recompute();

  root.append(theory('Linear-systems theory of image sharpness', String.raw`
<div class="theory-cols"><div>
<h3>The transfer-function cascade</h3>
<p>Under incoherent illumination, every stage of the imaging chain acts as a linear, approximately shift-invariant filter. The spectrum of the recorded image is the object spectrum multiplied by every stage's transfer function:</p>
\[\mathrm{MTF}_\text{sys}(\nu) = \mathrm{MTF}_\text{optics}(\nu)\cdot\mathrm{MTF}_\text{OLPF}(\nu)\cdot\mathrm{MTF}_\text{pixel}(\nu)\cdots\]
<p><strong>Optics.</strong> The OTF is the autocorrelation of the pupil function. For a perfect circular pupil it is</p>
\[\mathrm{MTF}(\hat\nu) = \frac{2}{\pi}\left[\arccos\hat\nu - \hat\nu\sqrt{1-\hat\nu^2}\right],\quad\hat\nu = \nu\lambda N,\]
<p>which falls almost linearly to zero at \(\nu_c = 1/(\lambda N)\). With aberrations there is no closed form, so the page computes it numerically: pupil with \(W = W_{020}\rho^2 + W_{040}\rho^4\) → FFT → PSF → FFT → OTF. Defocus beyond about 0.6 waves drives the MTF negative, which is contrast reversal. The chart shows the optics OTF with its sign. Negative lobes appear in the star as bands where black and white spokes swap.</p>
<p><strong>Pixel.</strong> A pixel integrates light over its active area \(a\times a\). Its MTF is \(|\mathrm{sinc}(a\nu)|\), whose first zero \(1/a\) lies at twice Nyquist for a 100 % fill factor. Microlenses push the effective fill factor towards 1.</p>
<p><strong>Optical low-pass filter.</strong> Two birefringent plates split each ray into four copies offset by \(d\) in \(x\) and \(y\). The MTF is \(|\cos(\pi d\nu)|\) per axis, with a zero at \(1/(2d)\). Choosing \(d = p\) places that zero exactly at Nyquist.</p>
</div><div>
<h3>Sampling and aliasing</h3>
<p>The sensor samples the filtered image on a lattice of pitch \(p\), which replicates its spectrum at multiples of \(1/p\). Any content above \(\nu_N = 1/(2p)\) overlaps the baseband and appears as a false low frequency, \(\nu_\text{alias} = |\nu - k/p|\). In the Siemens star, inside the red circle (where spoke spacing falls below two pixels) the sampled image shows spurious curved patterns: moiré. An OLPF or a small enough aperture suppresses them, at the cost of contrast just below Nyquist. Sensors that omit the OLPF are relying on the lens to be the low-pass filter.</p>
<h3>Two-point resolution criteria</h3>
<p>For two equally bright incoherent points, the <strong>Rayleigh</strong> criterion places one peak on the other's first zero, at separation \(1.22\lambda N\). The summed profile dips to 73.5 % of the peaks. <strong>Sparrow</strong> is the separation at which the dip just vanishes, \(0.947\lambda N\), and is the practical limit for detecting a double star. The empirical <strong>Dawes</strong> limit for astronomers, \(116''/D[\text{mm}]\), lies close to Sparrow. These criteria are conventions. With high signal-to-noise and a known PSF, deconvolution can measure separations well below Rayleigh, which is the essence of modern "super-resolution" astrometry.</p>
<h3>Matching optics to pixels</h3>
<p>The f-number at which the diffraction cut-off equals Nyquist is \(N = 2p/\lambda\), which is f/15.6 for a 4.3 µm pixel at 550 nm. Long before that, diffraction lowers contrast near Nyquist: the MTF50 of a perfect lens is about \(0.4/(\lambda N)\). Space telescopes face the same trade-off. JWST's NIRCam short-wavelength channel has 0.031″ pixels, which Nyquist-samples the PSF only at about 2 µm. Shorter wavelengths are undersampled and need dithering with drizzle reconstruction.</p>
</div></div>`));
  root.append(references([
    'G. D. Boreman, <i>Modulation Transfer Function in Optical and Electro-Optical Systems</i>, SPIE Press (2001).',
    'H. H. Hopkins, "The frequency response of a defocused optical system", Proc. R. Soc. A 231, 91 (1955).',
    'J. Greivenkamp, "Color dependent optical prefilter for the suppression of aliasing artifacts", Appl. Opt. 29, 676 (1990).',
    'Lord Rayleigh, "Investigations in optics", Phil. Mag. 8, 261 (1879); C. M. Sparrow, Astrophys. J. 44, 76 (1916).',
    'A. S. Fruchter &amp; R. N. Hook, "Drizzle", PASP 114, 144 (2002).',
  ]));
  return () => [chart, opt, smp, two].forEach((s) => s.destroy());
}
