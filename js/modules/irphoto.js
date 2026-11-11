// Infrared and ultraviolet photography: what a camera sees beyond the visible.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { MATERIALS, FILTERS, lams, sunlight, skylight, silicon, bayer, camera, achromat, sceneAt } from '../lib/irphoto.js';
import { aces } from '../lib/flarescene.js';
import { t, N_ } from '../lib/i18n.js';

const IW = 480, IH = 320; // the picture's grid; 36 × 24 mm on the sensor

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A camera's sensor can see more than we can: from deep violet into the infrared, beyond 1000 nm. Normally a filter inside the camera blocks the invisible parts. Take it out, put a filter in front of the lens that passes only infrared, and the world changes: leaves and grass shine white, a blue sky turns nearly black, and water looks like ink.</p>
<p>Leaves are green because they use red and blue light, but they reflect about half of the infrared, which they cannot use. In ultraviolet, flowers show patterns that bees see and we never do.</p>`, [
    'Choose the <strong>720 nm infrared filter</strong>: which things turn white, and which turn dark?',
    'Switch to <strong>ultraviolet</strong> and look at the flower: why does its centre go dark?',
    'Keep the focus at the <strong>visible mark</strong> with the infrared filter at f/2: the picture softens. How far does the lens have to move?',
  ]));

  const ctl = controls({
    filter: { type: 'select', label: 'Filter', value: 'ir720', options: Object.entries(FILTERS).map(([k, f]) => [k, f.label]) },
    wb: { type: 'seg', label: 'White balance on', value: 'leaf', options: [['cloud', 'A cloud'], ['leaf', 'Foliage']] },
    swap: { type: 'toggle', label: 'Swap red and blue (the classic infrared look)', value: true },
    focus: { type: 'seg', label: 'Focused at', value: 'ir', options: [['vis', 'The visible mark'], ['ir', 'The infrared mark']] },
    N: { type: 'range', label: 'Aperture', min: 1.4, max: 16, log: true, value: 2.8, fmt: (v) => 'f/' + v.toPrecision(2) },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const shot = stage({ aspect: 1.5, label: 'The photograph', draw: drawShot, minH: 260 });
  const spec = stage({ aspect: 1.8, label: '', draw: drawSpectra, cls: 'plain', minH: 220 });
  const foc = stage({ aspect: 1.4, label: '', draw: drawFocus, cls: 'plain', minH: 220 });
  root.append(lab([shot.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, spec.el), h('div.card', { style: { padding: '6px' } }, foc.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const lens = achromat(50);
  const radiance = (m) => (m === 'sky' ? skylight : (l) => sunlight(l) * MATERIALS[m](l));
  // the light-weighted mean wavelength through the filter (for the focus)
  function meanLam(T) { let s = 0, sl = 0; for (const l of lams) { const w = sunlight(l) * 0.4 * T(l) * silicon(l); s += w; sl += w * l; } return s ? sl / s : 550; }
  let R = null;
  function update() {
    const st = ctl.state, T = FILTERS[st.filter].T;
    const cams = {}; for (const m of ['sky', ...Object.keys(MATERIALS)]) cams[m] = camera(radiance(m), T);
    // white balance: gains that make the chosen reference neutral; exposure so the brightest thing sits near white
    // where a channel sees almost nothing through the filter (ultraviolet, 850 nm) the picture is shown
    // in black and white: the sum of the channels, as such photographs are
    const ref = cams[st.wb], mono = Math.min(...ref) < 0.02 * Math.max(...ref);
    const gain = mono ? [1, 1, 1] : ref.map((v) => 1 / v);
    const lam = meanLam(T), shift = st.focus === 'ir' ? 0 : lens.shift(lam) - lens.shift(550), blurMm = Math.abs(shift) / st.N; // focus error at the sensor
    // the picture: a material map, coloured, blurred by the focus error (a disc approximated by a Gaussian)
    const img = [0, 1, 2].map(() => new Float32Array(IW * IH));
    let peak = 0;
    for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
      const { m, shade } = sceneAt((i + 0.5) / IW, (j + 0.5) / IH), c = cams[m], k = j * IW + i;
      if (mono) { const v = (c[0] + c[1] + c[2]) * shade; img[0][k] = img[1][k] = img[2][k] = v; }
      else for (let ch = 0; ch < 3; ch++) img[ch][k] = c[ch] * gain[ch] * shade;
      peak = Math.max(peak, 0.2126 * img[0][k] + 0.7152 * img[1][k] + 0.0722 * img[2][k]);
    }
    const sigma = (blurMm / 2.355) * (IW / 36) * 1.2; // disc of diameter c ≈ Gaussian FWHM c, in pixels
    if (sigma > 0.3) for (const a of img) blur(a, IW, IH, sigma);
    R = { img, peak, st: { ...st }, lam, shift, blurMm, cams };
    words(); shot.redraw(); spec.redraw(); foc.redraw();
  }
  function blur(a, w, hh, s) {
    const r = Math.ceil(3 * s), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * s * s))), ks = k.reduce((p, q) => p + q, 0), tmp = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * w + x] = v / ks; }
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += tmp[Math.min(hh - 1, Math.max(0, y + i)) * w + x] * k[i + r]; a[y * w + x] = v / ks; }
  }
  function words() {
    const { cams, st, lam, shift, blurMm } = R, lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const leafVsSky = lum(cams.leaf) / Math.max(1e-9, lum(cams.sky));
    ro.replaceChildren(readouts([
      ['Mean wavelength reaching the sensor', fmt(lam, 3) + ' nm'],
      ['Foliage against blue sky (brightness ratio)', fmt(leafVsSky, 3) + ' ×'],
      ['Focus shift of a 50 mm achromat from the visible', fmt((lens.shift(lam) - lens.shift(550)) * 1000, 3) + ' µm'],
      ['Blur from focusing at the visible mark', st.focus === 'vis' ? fmt(blurMm * 1000, 3) + ' µm' : '0 µm'],
    ]));
    calc.say(t('Through this filter the light reaching the sensor averages <strong>{lam} nm</strong>. Foliage comes out <strong>{r} times</strong> as bright as the blue sky (in a normal photograph about {n} times). A 50 mm lens corrected for visible light focuses this light {s} µm {dir} the visible focus.', {
      lam: fmt(lam, 3), r: fmt(leafVsSky, 2), n: fmt(lum(camera(radiance('leaf'), FILTERS.normal.T)) / lum(camera(skylight, FILTERS.normal.T)), 2),
      s: fmt(Math.abs((lens.shift(lam) - lens.shift(550)) * 1000), 3), dir: lens.shift(lam) > lens.shift(550) ? t('behind') : t('in front of'),
    }));
    calc.set(String.raw`\begin{aligned}
    S_c &= \int E(\lambda)\,\rho(\lambda)\,T(\lambda)\,Q(\lambda)\,\bar c(\lambda)\,d\lambda\\
    \varphi(\lambda) &= \varphi_1\frac{n_1(\lambda)-1}{n_{1d}-1} + \varphi_2\frac{n_2(\lambda)-1}{n_{2d}-1},\quad \varphi_1 = \frac{\varphi V_1}{V_1-V_2}\\
    \Delta f(${texNum(lam, 3)}\,\text{nm}) &= ${texNum((lens.shift(lam) - lens.shift(550)) * 1000, 3)}\ \mu\text{m}
    \end{aligned}`);
  }
  function drawShot(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { img, peak, st } = R, g = 0.85 / Math.max(1e-9, peak), order = st.swap ? [2, 1, 0] : [0, 1, 2];
    const pw = Math.min(w, hh * 1.5), ph = pw / 1.5;
    paint(shot, { x: (w - pw) / 2, y: (hh - ph) / 2, w: pw, h: ph }, (u, v, o) => {
      for (let c = 0; c < 3; c++) o[c] = encode(aces(bilinear(img[order[c]], IW, IH, u * IW - 0.5, v * IH - 0.5) * g * 1.6));
    }, keyOf(R));
  }
  function drawSpectra(ctx, w, hh) {
    if (!R) return;
    const T = FILTERS[R.st.filter].T, xs = lams.filter((l) => l <= 1050);
    plot(ctx, w, hh, {
      title: N_('What reflects, what passes, what the sensor sees'), x: { min: 300, max: 1050, label: N_('wavelength (nm)') }, y: { min: 0, max: 1, label: N_('share') },
      series: [
        { data: xs.map((l) => [l, MATERIALS.leaf(l)]), color: '#6be3a4', width: 2, label: N_('leaf reflectance') },
        { data: xs.map((l) => [l, MATERIALS.water(l) * 10]), color: '#6ad7ff', width: 1.5, dash: [4, 3], label: N_('water reflectance × 10') },
        { data: xs.map((l) => [l, Math.min(1, skylight(l) / skylight(450))]), color: '#8fb3ff', width: 1.5, dash: [2, 3], label: N_('blue sky (relative)') },
        { data: xs.map((l) => [l, silicon(l)]), color: 'rgba(255,255,255,0.6)', width: 1.5, label: N_('silicon sensor') },
        { data: xs.map((l) => [l, T(l)]), color: '#ffb547', width: 2.5, label: N_('filter') },
      ],
      legend: true,
    });
  }
  function drawFocus(ctx, w, hh) {
    const pts = []; for (let l = 360; l <= 1050; l += 10) pts.push([l, (lens.shift(l) - lens.shift(550)) * 1000]);
    plot(ctx, w, hh, {
      title: N_('Focus of a 50 mm achromat against wavelength'), x: { min: 350, max: 1050, label: N_('wavelength (nm)') }, y: { min: -50, max: Math.max(200, ...pts.map((p) => p[1])), label: N_('focus behind the visible (µm)') },
      series: [{ data: pts, color: '#ff7a5a', width: 2 }],
      vlines: R ? [{ x: R.lam, color: 'rgba(255,181,71,0.6)', label: N_('this filter') }] : [],
    });
  }
  update();

  root.append(rule(String.raw`\[\frac{\text{leaf}}{\text{sky}}\Big|_{\lambda > 720} \gg \frac{\text{leaf}}{\text{sky}}\Big|_\text{visible}\]
<p>A leaf reflects about 5 % of red light but about 50 % of near-infrared light, ten times more; the blue sky's light falls as \(\lambda^{-4}\), so at 850 nm it is five times weaker than at 550 nm. In infrared, foliage therefore outshines the sky by a large factor, the reverse of a normal photograph. A lens corrected for visible light focuses 850 nm a little further back (about 0.15 mm for a 50 mm achromat), which matters at wide apertures: hence the red infrared mark on old lenses.</p>`,
    String.raw`The spectra here are representative smooth curves, not measurements: real leaves, skies, sensors and colour filters vary, and the infrared colours a converted camera gives depend strongly on its colour filters and on processing. The focus shift is for a thin achromat; real lenses differ, and apochromats and many modern lenses behave better or worse.`));
  root.append(theory('Seeing beyond the visible', String.raw`
<div class="theory-cols"><div>
<h3>Why leaves shine in infrared</h3>
<p>Chlorophyll absorbs strongly in the blue and the red, leaving the green peak. Beyond about 700 nm it is transparent, and the many air–cell-wall interfaces inside the leaf (the spongy mesophyll) scatter the light back out: reflectance jumps from about 5 % to about 50 % across the "red edge". R. W. Wood photographed this in 1910, and it is the basis of vegetation indices in satellite imaging (NDVI uses exactly this contrast).</p>
<h3>Why the sky goes dark</h3>
<p>The blue sky is sunlight scattered by molecules, \(\propto\lambda^{-4}\) (see the sky-colours laboratory). At 850 nm it is \((850/550)^4 \approx 5.7\) times weaker than at 550 nm, while clouds, which scatter all wavelengths alike, stay bright: infrared photographs show dark skies with brilliant clouds. Water absorbs the near infrared within centimetres and looks black.</p>
</div><div>
<h3>The camera</h3>
<p>The signal of each channel is \(S_c = \int E\rho T Q \bar c\,d\lambda\): illuminant, reflectance, filter, silicon's quantum efficiency and the colour filter's transmission. The Bayer dyes become transparent beyond about 800 nm, so behind an 850 nm filter all three channels see the same light and the picture is black and white; at 720 nm the red channel still sees more, which gives the false colours that infrared photographers then swap and balance on foliage.</p>
<h3>Focus</h3>
<p>A thin achromat with powers \(\varphi_1 = \varphi V_1/(V_1 - V_2)\), \(\varphi_2 = -\varphi V_2/(V_1 - V_2)\) brings the F and C lines to one focus; other wavelengths miss it (the secondary spectrum), the near infrared and the ultraviolet both falling behind. The blur from focusing at the visible mark is the focus error divided by the f-number.</p>
</div></div>`));
  root.append(references([
    'R. W. Wood, "Photography by invisible rays", The Photographic Journal 50, 329 (1910).',
    'D. M. Gates, H. J. Keegan, J. C. Schleter &amp; V. R. Weidner, "Spectral properties of plants", Appl. Opt. 4, 11 (1965).',
    'A. Davies, <i>Digital Ultraviolet and Infrared Photography</i>, Routledge (2017).',
    'S. F. Ray, <i>Applied Photographic Optics</i>, 3rd ed., Focal Press (2002): infrared focus and secondary spectrum.',
  ]));
  return () => [shot, spec, foc].forEach((s) => s.destroy());
}
