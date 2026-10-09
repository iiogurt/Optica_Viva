import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';

const NPX = 150; // sensor pixels across

// Achromatic test scenes in pixel units (x, y ∈ [0, NPX)), scale k multiplies spatial frequency.
const SCENES = {
  zone: { name: 'Zone plate (chirp)', f: (x, y, k) => { const r2 = (x - NPX / 2) ** 2 + (y - NPX / 2) ** 2; return 0.5 + 0.5 * Math.cos((Math.PI * k * r2) / (NPX * 0.9)); } },
  fabric: { name: 'Woven fabric', f: (x, y, k) => { const a = 0.5 + 0.5 * Math.cos(2 * Math.PI * k * 0.42 * (x * 0.97 + y * 0.24)), b = 0.5 + 0.5 * Math.cos(2 * Math.PI * k * 0.44 * (y * 0.97 - x * 0.24)); return ((Math.floor(x * k * 0.1) + Math.floor(y * k * 0.1)) & 1 ? a : b) * 0.85 + 0.08; } },
  stripes: { name: 'Fine stripes, 7° tilt', f: (x, y, k) => 0.5 + 0.5 * Math.sign(Math.cos(2 * Math.PI * k * 0.45 * (x * Math.cos(0.12) + y * Math.sin(0.12)))) },
  bricks: { name: 'Distant brick façade', f: (x, y, k) => { const s = 3.2 / k, row = Math.floor(y / s), off = row & 1 ? s : 0; const mortar = (y % s) < 0.22 * s || ((x + off) % (2 * s)) < 0.22 * s; return mortar ? 0.85 : 0.25; } },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'A sensor is a grid of point samples taken through square apertures. Detail finer than two pixels per cycle cannot be recorded, but it does not simply vanish: it reappears at the wrong frequency and the wrong angle, as moiré. A Bayer colour filter samples red and blue at half the rate, so fine grey detail can also come back in false colour.', domains: ['photo', 'video'] }));

  const ctl = controls({
    scene: { type: 'select', label: 'Test scene', value: 'zone', options: Object.entries(SCENES).map(([k, s]) => [k, s.name]) },
    k: { type: 'range', label: 'Scene detail (frequency multiplier)', min: 0.3, max: 2.5, step: 0.01, value: 1 },
    olpf: { type: 'range', label: 'OLPF split d (pixels)', min: 0, max: 1.2, step: 0.05, value: 0, fmt: (v) => (v ? v.toFixed(2) : 'none') },
    fill: { type: 'range', label: 'Pixel fill factor', min: 0.1, max: 1, step: 0.05, value: 1, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    demosaic: { type: 'seg', label: 'Demosaicing', value: 'mhc', options: [['bilinear', 'Bilinear'], ['mhc', 'Malvar–He–Cutler']] },
    f: { type: 'range', label: '1-D folding demo: input frequency', min: 0, max: 1.5, step: 0.005, value: 0.62, unit: 'cy/px' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const ref = stage({ aspect: 1, label: 'Scene (continuous)', draw: (c, w, hh) => blit(c, w, hh, R.ref, true) });
  const mono = stage({ aspect: 1, label: 'Monochrome sensor', draw: (c, w, hh) => blit(c, w, hh, R.mono, false) });
  const bay = stage({ aspect: 1, label: 'Bayer + demosaic', draw: (c, w, hh) => blit(c, w, hh, R.bayer, false) });
  const fold = stage({ aspect: 2.6, label: '', draw: drawFold, cls: 'plain', minH: 220 });
  root.append(lab([h('div.grid-3', {}, ref.el, mono.el, bay.el), h('div.card', { style: { padding: '6px' } }, fold.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const R = {};
  function blit(ctx, w, hh, c, smooth) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!c) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, (w - side) / 2, (hh - side) / 2, side, side);
  }

  function update() {
    const st = ctl.state, f = SCENES[st.scene].f, k = st.k;
    // reference at 4× oversampling with box anti-aliasing
    // reference: 2× oversampled with a 4×4 box filter per output pixel (alias-free at display size)
    const OS = 2, RW = NPX * OS, ri = imageCanvas(RW, RW);
    for (let y = 0; y < RW; y++) for (let x = 0; x < RW; x++) {
      let v = 0;
      for (let sj = 0; sj < 4; sj++) for (let si = 0; si < 4; si++) v += f((x + (si + 0.5) / 4) / OS, (y + (sj + 0.5) / 4) / OS, k);
      const g = Math.round(255 * Math.pow(Math.max(0, Math.min(1, v / 16)), 1 / 2.2)), o = (y * RW + x) * 4;
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = g; ri.data[o + 3] = 255;
    }
    ri.put(); R.ref = ri.c;
    // sensor: integrate over the active aperture (fill factor) of the OLPF-blurred scene
    const a = Math.sqrt(st.fill), d = st.olpf, S = 4;
    const taps = d ? [[-d / 2, -d / 2], [d / 2, -d / 2], [-d / 2, d / 2], [d / 2, d / 2]] : [[0, 0]];
    const raw = new Float64Array(NPX * NPX);
    for (let y = 0; y < NPX; y++) for (let x = 0; x < NPX; x++) {
      let v = 0;
      for (const [tx, ty] of taps) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        v += f(x + 0.5 + ((i + 0.5) / S - 0.5) * a + tx, y + 0.5 + ((j + 0.5) / S - 0.5) * a + ty, k);
      }
      raw[y * NPX + x] = v / (S * S * taps.length);
    }
    const mi = imageCanvas(NPX, NPX);
    for (let i = 0; i < NPX * NPX; i++) { const g = Math.round(255 * Math.pow(Math.max(0, Math.min(1, raw[i])), 1 / 2.2)); mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = g; mi.data[i * 4 + 3] = 255; }
    mi.put(); R.mono = mi.c;
    // Bayer RGGB mosaic of the (grey) scene, then demosaic
    const ch = (x, y) => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2)); // 0 R, 1 G, 2 B
    const M = (x, y) => raw[Math.min(NPX - 1, Math.max(0, y)) * NPX + Math.min(NPX - 1, Math.max(0, x))];
    const out = new Float64Array(NPX * NPX * 3);
    for (let y = 0; y < NPX; y++) for (let x = 0; x < NPX; x++) {
      const c = ch(x, y), o = (y * NPX + x) * 3;
      const avg = (pts) => pts.reduce((s, [dx, dy]) => s + M(x + dx, y + dy), 0) / pts.length;
      const cross = [[1, 0], [-1, 0], [0, 1], [0, -1]], diag = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
      let r, g, b;
      if (st.demosaic === 'bilinear') {
        if (c === 1) {
          const rowR = (y & 1) === 0;
          const h2 = avg([[1, 0], [-1, 0]]), v2 = avg([[0, 1], [0, -1]]);
          r = rowR ? h2 : v2; b = rowR ? v2 : h2; g = M(x, y);
        } else { g = avg(cross); const other = avg(diag); if (c === 0) { r = M(x, y); b = other; } else { b = M(x, y); r = other; } }
      } else {
        // Malvar, He & Cutler (2004) gradient-corrected linear interpolation (5×5 kernels)
        const P = (dx, dy) => M(x + dx, y + dy);
        const c0 = P(0, 0);
        const Gat = (4 * c0 + 2 * (P(1, 0) + P(-1, 0) + P(0, 1) + P(0, -1)) - (P(2, 0) + P(-2, 0) + P(0, 2) + P(0, -2))) / 8;
        const rowH = (5 * c0 + 4 * (P(1, 0) + P(-1, 0)) - (P(1, 1) + P(-1, 1) + P(1, -1) + P(-1, -1)) - (P(2, 0) + P(-2, 0)) + 0.5 * (P(0, 2) + P(0, -2))) / 8;
        const colV = (5 * c0 + 4 * (P(0, 1) + P(0, -1)) - (P(1, 1) + P(-1, 1) + P(1, -1) + P(-1, -1)) - (P(0, 2) + P(0, -2)) + 0.5 * (P(2, 0) + P(-2, 0))) / 8;
        const diagK = (6 * c0 + 2 * (P(1, 1) + P(-1, 1) + P(1, -1) + P(-1, -1)) - 1.5 * (P(2, 0) + P(-2, 0) + P(0, 2) + P(0, -2))) / 8;
        if (c === 0) { r = c0; g = Gat; b = diagK; }
        else if (c === 2) { b = c0; g = Gat; r = diagK; }
        else { g = c0; const rowR = (y & 1) === 0; r = rowR ? rowH : colV; b = rowR ? colV : rowH; }
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
    const bi = imageCanvas(NPX, NPX);
    let chroma = 0;
    for (let i = 0; i < NPX * NPX; i++) {
      const [r, g, b] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      bi.data[i * 4] = 255 * Math.pow(Math.max(0, Math.min(1, r)), 1 / 2.2); bi.data[i * 4 + 1] = 255 * Math.pow(Math.max(0, Math.min(1, g)), 1 / 2.2); bi.data[i * 4 + 2] = 255 * Math.pow(Math.max(0, Math.min(1, b)), 1 / 2.2); bi.data[i * 4 + 3] = 255;
    }
    bi.put(); R.bayer = bi.c;
    const fa = Math.abs(st.f - Math.round(st.f));
    ro.replaceChildren(readouts([
      ['Luma Nyquist (mono)', '0.5 cy/px'],
      ['Bayer G Nyquist (quincunx)', '0.5 cy/px (h/v)'],
      ['Bayer R & B Nyquist', '0.25 cy/px'],
      ['OLPF first zero 1/(2d)', st.olpf ? (1 / (2 * st.olpf)).toFixed(2) + ' cy/px' : '—'],
      ['Pixel-aperture first zero 1/a', (1 / a).toFixed(2) + ' cy/px'],
      ['Mean false-colour (chroma) error', (chroma / (NPX * NPX) * 100).toFixed(2) + ' %'],
      ['Demo: ' + st.f.toFixed(3) + ' cy/px appears at', fa.toFixed(3) + ' cy/px'],
    ]));
    const H = (nu) => Math.abs((Math.sin(Math.PI * a * nu) / (Math.PI * a * nu + 1e-12)) * (st.olpf ? Math.cos(Math.PI * st.olpf * nu) : 1)) || (nu === 0 ? 1 : 0);
    calc.set(String.raw`\begin{aligned}
    f_\text{alias} &= |f - k f_s|,\ k = \mathrm{round}(f/f_s)\\
    &= |${texNum(st.f, 3)} - ${Math.round(st.f)}| = ${texNum(fa, 3)}\ \text{cy/px}\\
    \text{MTF}(f) &= |\mathrm{sinc}(af)\cos(\pi d f)| = ${texNum(H(st.f), 3)}
    \end{aligned}`);
    R.H = H; R.st = { ...st };
    [ref, mono, bay, fold].forEach((s) => s.redraw());
  }

  function drawFold(ctx, w, hh) {
    if (!R.st) return;
    const xs = range(0, 1.5, 600), st = R.st;
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Spectral folding: recorded frequency vs true frequency (sampling rate f_s = 1 cy/px)',
      x: { min: 0, max: 1.5, label: 'true spatial frequency (cycles/pixel)' }, y: { min: 0, max: 1, label: 'recorded frequency / response' },
      bands: [{ x: [0.5, 1.5], color: 'rgba(255,107,107,0.06)' }],
      series: [
        { data: xs.map((f) => [f, Math.abs(f - Math.round(f))]), color: '#6ad7ff', width: 2, label: 'apparent frequency' },
        { data: xs.map((f) => [f, R.H(f)]), color: '#ffb547', width: 1.6, dash: [5, 3], label: 'pre-filter MTF (pixel × OLPF)' },
      ],
      vlines: [{ x: 0.5, color: '#ff6b6b', label: 'Nyquist' }, { x: 0.25, color: 'rgba(193,140,255,0.7)', label: 'R/B Nyquist' }],
      legend: true, legendX: w - 240,
    });
    const fa = Math.abs(st.f - Math.round(st.f));
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(st.f), Y(fa), 5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(st.f), Y(fa)); ctx.lineTo(X(fa), Y(fa)); ctx.stroke(); ctx.setLineDash([]);
  }

  update();

  root.append(theory('Sampling theory for image sensors', String.raw`
<div class="theory-cols"><div>
<h3>Shannon–Nyquist on a pixel lattice</h3>
<p>Image formation on a sensor is three operations: convolution with the optics PSF, convolution with the pixel aperture \(\mathrm{rect}(x/a)\), and multiplication by a lattice of delta functions \(\mathrm{comb}(x/p)\). In the frequency domain the last step convolves the spectrum with a comb of spacing \(1/p\):</p>
\[\tilde I_s(\nu) = \sum_k \tilde I(\nu - k/p)\cdot\mathrm{MTF}_\text{opt}\,\mathrm{sinc}(a\nu)\big|_{\nu - k/p}.\]
<p>Any energy above \(\nu_N = 1/(2p)\) overlaps a neighbouring replica and is recorded as \(\nu_\text{alias} = |\nu - k/p|\). In two dimensions the alias also has a different <em>orientation</em>. That is why the zone plate's outer rings reappear as phantom ring systems centred elsewhere, and why fabric turns into swirling moiré.</p>
<h3>Anti-aliasing (OLPF)</h3>
<p>Two crossed birefringent plates (quartz or lithium niobate) displace the ordinary and extraordinary rays by \(d\), turning every point into four. The MTF is \(|\cos\pi d\nu|\) per axis, with its first zero at \(1/(2d)\). Choosing \(d \approx p\) puts that zero at Nyquist. The price is roughly 10–15 % lower MTF50, which is why high-resolution cameras increasingly omit the filter and rely on lens softness or diffraction.</p>
</div><div>
<h3>Colour filter arrays</h3>
<p>The Bayer RGGB pattern samples green on a quincunx lattice (Nyquist \(0.5\) cy/px horizontally and vertically) and red and blue on square lattices of pitch \(2p\) (Nyquist \(0.25\) cy/px). Luminance detail between 0.25 and 0.5 cy/px is therefore aliased <em>differently</em> in the three channels. A neutral grey pattern becomes coloured fringes: false colour. Demosaicing algorithms reduce this by exploiting inter-channel correlation. Malvar–He–Cutler (2004) adds a scaled Laplacian of the known channel to the bilinear estimate, using five 5×5 kernels. Production pipelines use adaptive, edge-directed and now neural demosaicing.</p>
<h3>Escapes from the Bayer limit</h3>
<ul>
<li><strong>Pixel-shift</strong> captures four exposures offset by one pixel, so every site sees R, G and B: full-colour sampling without interpolation.</li>
<li><strong>Foveon</strong> stacks three photodiodes vertically, using silicon's wavelength-dependent absorption depth.</li>
<li><strong>X-Trans</strong> uses a 6×6 aperiodic pattern that pushes colour aliasing to less objectionable frequencies.</li>
<li><strong>Astronomy</strong> uses monochrome sensors with filter wheels, and <em>dithering</em> with drizzle to beat undersampling.</li>
</ul>
<h3>Video</h3>
<p>Line-skipping and pixel-binning modes in video cameras sample with gaps (fill factor ≪ 1), which aliases severely. Full-readout oversampled 6K→4K modes are visibly cleaner for exactly this reason.</p>
</div></div>`));
  root.append(references([
    'B. E. Bayer, "Color imaging array", US Patent 3,971,065 (1976).',
    'H. S. Malvar, L.-W. He &amp; R. Cutler, "High-quality linear interpolation for demosaicing of Bayer-patterned color images", ICASSP (2004).',
    'C. E. Shannon, "Communication in the presence of noise", Proc. IRE 37, 10 (1949).',
    'J. E. Greivenkamp, "Color dependent optical prefilter for the suppression of aliasing artifacts", Appl. Opt. 29, 676 (1990).',
  ]));
  return () => [ref, mono, bay, fold].forEach((s) => s.destroy());
}
