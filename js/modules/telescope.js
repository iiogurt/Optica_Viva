import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { rasterAperture, zernike } from '../lib/pupil.js';
import { fft2d } from '../lib/fft.js';
import { lut } from '../lib/color.js';
import { plot, logRange } from '../lib/plot.js';

const SCOPES = [
  { name: 'Hubble', D: 2.4, color: '#6ad7ff', band: [0.115, 2.5], space: true },
  { name: 'JWST', D: 6.5, color: '#ffb547', band: [0.6, 28.5], space: true },
  { name: 'Roman', D: 2.4, color: '#6be3a4', band: [0.48, 2.3], space: true },
  { name: 'Euclid', D: 1.2, color: '#ff9cc0', band: [0.55, 2.0], space: true },
  { name: 'Spitzer', D: 0.85, color: '#c18cff', band: [3.6, 160], space: true },
  { name: 'Keck + AO', D: 10, color: '#ffffff', band: [0.9, 5], space: false },
  { name: 'ELT + AO', D: 39, color: '#ff6b6b', band: [0.8, 13], space: false },
];
const CAMERAS = [
  { name: 'HST WFC3/UVIS', p: 0.04, D: 2.4 }, { name: 'HST ACS/WFC', p: 0.05, D: 2.4 }, { name: 'HST WFC3/IR', p: 0.13, D: 2.4 },
  { name: 'NIRCam SW', p: 0.031, D: 6.5 }, { name: 'NIRCam LW', p: 0.063, D: 6.5 }, { name: 'MIRI', p: 0.11, D: 6.5 },
  { name: 'Roman WFI', p: 0.11, D: 2.4 }, { name: 'Euclid VIS', p: 0.1, D: 1.2 },
];
const planck = (lamUm, T) => { const l = lamUm * 1e-6, hc = 6.62607e-34 * 2.99792e8, k = 1.380649e-23; return (2 * hc * 2.99792e8 / l ** 5) / (Math.exp(hc / (l * k * T)) - 1); };

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Above the atmosphere a telescope finally reaches its physical limits: diffraction set by its aperture, sampling set by its pixels, sensitivity set by its collecting area and its own thermal glow, and contrast set by how perfectly it controls scattered starlight. The last of these decides whether we can photograph an Earth beside a Sun.', domains: ['space'] }));

  // ── resolution & sampling chart ──
  const resChart = stage({ aspect: 2.3, label: '', draw: drawRes, cls: 'plain', minH: 260 });
  const thermal = stage({ aspect: 1.6, label: '', draw: drawThermal, cls: 'plain' });
  const area = stage({ aspect: 1.6, label: '', draw: drawArea, cls: 'plain' });
  root.append(h('section.block', {}, h('h2', {}, 'Resolution, sampling and sensitivity'),
    h('div.card', { style: { padding: '6px' } }, resChart.el),
    h('div.grid-2', { style: { marginTop: '16px' } }, h('div.card', { style: { padding: '6px' } }, thermal.el), h('div.card', { style: { padding: '6px' } }, area.el))));

  function drawRes(ctx, w, hh) {
    const L = logRange(0.1, 30, 200);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Angular resolution 1.22 λ/D vs wavelength; markers: wavelength above which each camera is Nyquist-sampled (λ ≥ 2pD)',
      x: { min: 0.1, max: 30, log: true, label: 'wavelength (µm)' }, y: { min: 0.003, max: 3, log: true, label: 'angle (arcsec)' },
      series: [
        { data: L.map((l) => [l, 0.7 * Math.pow(l / 0.5, -0.2)]), color: 'rgba(255,255,255,0.35)', dash: [6, 4], width: 1.4, label: 'ground seeing (r₀ = 15 cm @ 0.5 µm)' },
        ...SCOPES.map((s) => ({ data: L.filter((l) => l >= s.band[0] && l <= s.band[1]).map((l) => [l, (1.22 * l * 1e-6 / s.D) * 206265]), color: s.color, width: 2, label: `${s.name} (${s.D} m)` })),
      ],
      legend: true, legendX: w - 250, legendY: hh - 175,
    });
    ctx.font = '10px Inter, sans-serif';
    for (const c of CAMERAS) {
      const lam = (2 * c.p / 206265) * c.D * 1e6; // µm
      const y = c.p;
      ctx.fillStyle = c.D === 6.5 ? '#ffb547' : c.D === 2.4 ? '#6ad7ff' : '#ff9cc0';
      ctx.beginPath(); ctx.moveTo(X(lam), Y(y) - 5); ctx.lineTo(X(lam) + 5, Y(y)); ctx.lineTo(X(lam), Y(y) + 5); ctx.lineTo(X(lam) - 5, Y(y)); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'left'; ctx.fillText(`${c.name} ${c.p}″`, X(lam) + 7, Y(y) + 3);
    }
  }
  function drawThermal(ctx, w, hh) {
    const L = logRange(0.5, 300, 240);
    const Ts = [[5772, '#ffd27a', 'Sun-like surface (×10⁻⁶)'], [290, '#ff6b6b', 'telescope at 290 K'], [40, '#6ad7ff', 'JWST optics ≈ 40 K'], [7, '#c18cff', 'MIRI detector ≈ 7 K']];
    plot(ctx, w, hh, {
      title: 'Why infrared telescopes must be cold: Planck radiance', x: { min: 0.5, max: 300, log: true, label: 'wavelength (µm)' }, y: { min: 1e-10, max: 1e9, log: true, label: 'B_λ (W m⁻² sr⁻¹ µm⁻¹)' },
      series: Ts.map(([T, c, lab], i) => ({ data: L.map((l) => [l, planck(l, T) * 1e-6 * (i === 0 ? 1e-6 : 1)]), color: c, width: 2, label: lab })),
      legend: true, legendX: w - 220, legendY: 40,
    });
  }
  function drawArea(ctx, w, hh) {
    const items = [['Spitzer', 0.57], ['Euclid', 1.0], ['Hubble', 4.5], ['Roman', 4.5], ['JWST', 25.4], ['Keck', 76], ['ELT', 978]];
    plot(ctx, w, hh, { title: 'Collecting area (m², log)', x: { min: 0, max: items.length, label: '', fmt: () => '' }, y: { min: 0.3, max: 2000, log: true, label: 'm²' }, padB: 30 });
    const pad = { l: 52, r: 14, t: 26, b: 30 }, bw = (w - pad.l - pad.r) / items.length;
    items.forEach(([n, a], i) => {
      const y = hh - pad.b - (Math.log(a / 0.3) / Math.log(2000 / 0.3)) * (hh - pad.t - pad.b);
      const g = ctx.createLinearGradient(0, y, 0, hh - pad.b); g.addColorStop(0, '#ffb547'); g.addColorStop(1, 'rgba(255,181,71,0.15)');
      ctx.fillStyle = g; ctx.fillRect(pad.l + i * bw + bw * 0.18, y, bw * 0.64, hh - pad.b - y);
      ctx.fillStyle = '#e9ebf3'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(n, pad.l + (i + 0.5) * bw, hh - pad.b + 14); ctx.fillText(a + '', pad.l + (i + 0.5) * bw, y - 4);
    });
  }

  // ── Lyot coronagraph ──
  const sec = h('section.block', {}, h('h2', {}, 'Imaging an exoplanet: the Lyot coronagraph'));
  const ctl = controls({
    pupil: { type: 'seg', label: 'Pupil', value: 'clear', options: [['clear', 'Clear circle'], ['obs', 'Obstructed + spiders']] },
    mask: { type: 'range', label: 'Occulting mask radius', min: 0, max: 8, step: 0.1, value: 4, unit: 'λ/D' },
    lyot: { type: 'range', label: 'Lyot stop diameter', min: 0.5, max: 1, step: 0.01, value: 0.8, fmt: (v) => (v * 100).toFixed(0) + ' % D' },
    sep: { type: 'range', label: 'Planet separation', min: 2, max: 25, step: 0.1, value: 12, unit: 'λ/D' },
    con: { type: 'range', label: 'Planet / star contrast', min: 1e-10, max: 1e-3, log: true, value: 1e-5, fmt: (v) => v.toExponential(0) },
    wfe: { type: 'range', label: 'Residual wavefront error (Z₄–Z₂₂)', min: 0, max: 30, step: 0.1, value: 2, unit: 'nm RMS' },
    lam: { type: 'range', label: 'Wavelength', min: 0.5, max: 4.5, step: 0.05, value: 1.6, unit: 'µm' },
  }, () => runCoro());
  const ro = h('div');
  const calc = liveCalc();
  const direct = stage({ aspect: 1, label: 'Direct image (log, 10 decades)', draw: (c, w, hh) => drawImg(c, w, hh, 'direct') });
  const coro = stage({ aspect: 1, label: 'Coronagraphic image (same stretch)', draw: (c, w, hh) => drawImg(c, w, hh, 'coro') });
  const planes = stage({ aspect: 3, label: 'Pupil · focal-plane mask · Lyot plane (|E|, log)', draw: drawPlanes, minH: 160 });
  const prof = stage({ aspect: 2.4, label: '', draw: drawProf, cls: 'plain', minH: 220 });
  sec.append(lab([h('div.grid-2', {}, direct.el, coro.el), planes.el, h('div.card', { style: { padding: '6px' } }, prof.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));
  root.append(sec);

  const n = 256, Dp = 64, Q = n / Dp;
  let C = null;
  const runCoro = debounce(() => {
    const st = ctl.state;
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
      const focal = withCoro ? null : null;
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
      return { I, lyotPlane, focal };
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
    C = { dI, cI, lyotPlane: starC.lyotPlane, amp, lyot, maskR, st: { ...st }, prof: Array.from({ length: bins }, (_, i) => [((i + 0.5) / bins) * rmax, cnt[i] ? pd[i] / cnt[i] : NaN, cnt[i] ? pc[i] / cnt[i] : NaN]), throughput, starAt };
    const snrRatio = (st.con * throughput * plPeak / peak) / Math.max(starAt, 1e-14);
    ro.replaceChildren(readouts([
      ['Inner working angle ≈ mask radius', st.mask.toFixed(1) + ' λ/D = ' + fmt((st.mask * st.lam * 1e-6 / 6.5) * 206265 * 1000, 3) + ' mas (JWST)'],
      ['Planet throughput (peak)', (throughput * 100).toFixed(1) + ' %'],
      ['Starlight at planet, direct', (pd[Math.floor((st.sep / rmax) * bins)] / cnt[Math.floor((st.sep / rmax) * bins)]).toExponential(1)],
      ['Starlight at planet, coronagraph', starAt.toExponential(1)],
      ['Planet / residual starlight', snrRatio.toExponential(1)],
      ['Planet detectable?', snrRatio > 1 ? 'yes, above the speckle floor' : 'no, buried in speckles'],
    ]));
    const h0 = Math.sqrt(1e-10) * st.lam * 1000 / Math.PI;
    calc.set(String.raw`\begin{aligned}
    E_1 &= \mathcal F\{P\,e^{i\phi}\}\\
    E_2 &= \mathcal F^{-1}\{(1-M)E_1\}\\
    E_3 &= \mathcal F\{L\cdot E_2\}\\
    C_\text{sp} &\approx (\pi h/\lambda)^2\\
    C = 10^{-10} &\Rightarrow h \approx ${texNum(h0 * 1000, 3)}\ \text{pm}
    \end{aligned}`);
    [direct, coro, planes, prof].forEach((s) => s.redraw());
  }, 50);

  const INF = lut('inferno');
  function toImg(data, crop, dec, floor = 0) {
    const off = (n - crop) / 2, ic = imageCanvas(crop, crop);
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const v = Math.max(0, 1 + Math.log10(data[(y + off) * n + x + off] + 1e-30) / dec);
      const t = Math.round(Math.min(1, v) * 255) * 3, o = (y * crop + x) * 4;
      ic.data[o] = INF[t]; ic.data[o + 1] = INF[t + 1]; ic.data[o + 2] = INF[t + 2]; ic.data[o + 3] = 255;
    }
    ic.put(); return ic.c;
  }
  function drawImg(ctx, w, hh, kind) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!C) return;
    const crop = 224, side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(toImg(kind === 'direct' ? C.dI : C.cI, crop, 10), (w - side) / 2, (hh - side) / 2, side, side);
    const sc = side / crop;
    const px = w / 2 + C.st.sep * Q * sc;
    ctx.strokeStyle = '#6be3a4'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, hh / 2, 3 * Q * sc, 0, 7); ctx.stroke();
    ctx.fillStyle = '#6be3a4'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText('planet', px, hh / 2 - 3 * Q * sc - 5);
    if (kind === 'coro' && C.st.mask) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, C.maskR * sc, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
  function drawPlanes(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!C) return;
    const side = Math.min(hh - 16, w / 3 - 16), crop = 96, off = (n - crop) / 2;
    // pupil
    const p = imageCanvas(crop, crop), m = imageCanvas(crop, crop), l = imageCanvas(crop, crop);
    let lm = 0; for (let k = 0; k < n * n; k++) lm = Math.max(lm, C.lyotPlane[k]);
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const k = (y + off) * n + x + off, o = (y * crop + x) * 4;
      p.data[o] = 255 * C.amp[k]; p.data[o + 1] = 205 * C.amp[k]; p.data[o + 2] = 130 * C.amp[k]; p.data[o + 3] = 255;
      const inMask = Math.hypot(x - crop / 2, y - crop / 2) < C.maskR;
      m.data[o] = inMask ? 20 : 200; m.data[o + 1] = inMask ? 20 : 200; m.data[o + 2] = inMask ? 25 : 210; m.data[o + 3] = 255;
      const v = Math.max(0, 1 + Math.log10(C.lyotPlane[k] / lm + 1e-9) / 3), t = Math.round(v * 255) * 3;
      const inL = C.lyot[k] > 0.5;
      l.data[o] = INF[t]; l.data[o + 1] = INF[t + 1]; l.data[o + 2] = INF[t + 2]; l.data[o + 3] = 255;
      if (!inL && (x + y) % 6 === 0) { l.data[o] = 80; l.data[o + 1] = 80; l.data[o + 2] = 100; }
    }
    [p, m, l].forEach((c, i) => { c.put(); ctx.imageSmoothingEnabled = i !== 1; ctx.drawImage(c.c, (w / 3) * i + (w / 3 - side) / 2, 8, side, side); });
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('hatched = blocked by the Lyot stop', (5 * w) / 6, hh - 4);
  }
  function drawProf(ctx, w, hh) {
    if (!C) return;
    plot(ctx, w, hh, {
      title: 'Azimuthally averaged starlight (normalised to the direct peak)', x: { min: 0, max: 30, label: 'separation (λ/D)' }, y: { min: 1e-11, max: 1.5, log: true, label: 'contrast' },
      series: [{ data: C.prof.map((p) => [p[0], p[1]]), color: 'rgba(255,255,255,0.6)', width: 1.6, label: 'no coronagraph' }, { data: C.prof.map((p) => [p[0], p[2]]), color: '#ffb547', width: 2.2, label: 'Lyot coronagraph' }],
      hlines: [{ y: C.st.con, color: '#6be3a4', label: 'planet contrast' }], vlines: [{ x: C.st.sep, color: '#6be3a4', label: 'planet' }, { x: C.st.mask, color: 'rgba(255,255,255,0.35)', label: 'IWA' }],
      legend: true, legendX: w - 200,
    });
  }
  runCoro();

  root.append(theory('Physics of space telescopes', String.raw`
<div class="theory-cols"><div>
<h3>Resolution and sampling</h3>
<p>A diffraction-limited telescope resolves \(\theta_R = 1.22\,\lambda/D\). To record that resolution, pixels must Nyquist-sample the optical cut-off \(D/\lambda\), giving a pixel scale \(p \le \lambda/(2D)\). JWST's NIRCam is therefore split at 2.4 µm into a short-wavelength channel (0.031″, Nyquist at 2 µm) and a long-wavelength one (0.063″, Nyquist at 4 µm). Undersampled cameras such as Hubble's WFC3/IR recover resolution by <em>dithering</em> sub-pixel offsets and combining exposures with drizzle.</p>
<h3>Sensitivity</h3>
<p>For a point source against a sky background, signal grows with collecting area \(\propto D^2\). The diffraction-limited PSF area shrinks as \(D^{-2}\), so the background in it falls by the same factor. The time to reach a given SNR therefore scales as \(D^{-4}\). This is the deepest reason JWST is 6.5 m and not 2.4 m.</p>
<h3>Thermal emission</h3>
<p>Every surface glows with Planck radiance \(B_\lambda(T) = \frac{2hc^2}{\lambda^5}\big/\left(e^{hc/\lambda kT}-1\right)\). A room-temperature telescope peaks near 10 µm (Wien: \(\lambda_\text{max} = 2898\,\mu\text{m K}/T\)) and would outshine the faint galaxies JWST studies by many orders of magnitude. The five-layer sunshield passively cools the optics to about 40 K. MIRI's detectors need a cryocooler to reach about 7 K.</p>
</div><div>
<h3>The coronagraph</h3>
<p>An Earth-like planet in reflected light is \(\sim10^{-10}\) times as bright as its star, at a separation of about 0.1″ from a star 10 pc away. A Lyot coronagraph removes starlight in three Fourier steps:</p>
\[E_\text{focal} = \mathcal F\{P\},\quad E_\text{Lyot} = \mathcal F^{-1}\{(1-M)\,E_\text{focal}\},\quad E_\text{final} = \mathcal F\{L\cdot E_\text{Lyot}\}.\]
<p>The occulting mask \(M\) blocks the core of the star's PSF. The light it misses has lost its low frequencies, so in the re-imaged pupil (Lyot plane) it concentrates in bright rings at the pupil edges. An undersized Lyot stop \(L\) blocks those rings. An off-axis planet's light misses the mask and passes through mostly intact. The <em>inner working angle</em> is roughly the mask radius.</p>
<h3>The speckle floor</h3>
<p>Wavefront errors scatter starlight into speckles that look exactly like planets. A sinusoidal surface ripple of height \(h\) creates a pair of speckles with contrast \((\pi h/\lambda)^2\). Reaching \(10^{-10}\) in the visible requires wavefront stability at the <strong>picometre</strong> level. That is why the Roman Coronagraph and the planned Habitable Worlds Observatory pair coronagraphs with deformable mirrors running "dark hole" control loops. Raise the wavefront-error slider to watch the planet disappear into the speckles.</p>
</div></div>`));
  root.append(references([
    'B. Lyot, "The study of the solar corona and prominences without eclipses", MNRAS 99, 580 (1939).',
    'A. Sivaramakrishnan et al., "Ground-based coronagraphy with high-order adaptive optics", ApJ 552, 397 (2001).',
    'O. Guyon et al., "Theoretical limits on extrasolar terrestrial planet detection with coronagraphs", ApJS 167, 81 (2006).',
    'J. P. Gardner et al., "The James Webb Space Telescope Mission", PASP 135, 068001 (2023).',
    'J. Rigby et al., "The science performance of JWST as characterized in commissioning", PASP 135, 048001 (2023).',
  ]));
  return () => [resChart, thermal, area, direct, coro, planes, prof].forEach((s) => s.destroy());
}
