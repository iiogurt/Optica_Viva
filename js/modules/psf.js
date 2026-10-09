import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { rasterAperture, psf, rescale, airy, zernikeWavefront, besselJ1 as besselJ1x } from '../lib/pupil.js';
import { spectralBasis, oetf, linspace, wavelengthRGB } from '../lib/color.js';
import { plot } from '../lib/plot.js';

const PRESETS = {
  circle: { label: 'Circular (ideal lens)', spec: { type: 'circle' } },
  hex: { label: '6-blade iris (straight)', spec: { type: 'polygon', blades: 6, curvature: 0 } },
  five: { label: '5-blade iris → 10 spikes', spec: { type: 'polygon', blades: 5, curvature: 0 } },
  seven: { label: '7-blade iris → 14 spikes', spec: { type: 'polygon', blades: 7, curvature: 0 } },
  nine: { label: '9 rounded blades', spec: { type: 'polygon', blades: 9, curvature: 0.6 } },
  newt: { label: 'Newtonian (25 % obstruction, 4 vanes)', spec: { type: 'circle', obstruction: 0.25, spiders: 4, spiderWidth: 0.012 } },
  cat: { label: 'Mirror lens (40 % obstruction)', spec: { type: 'circle', obstruction: 0.4 } },
  hubble: { label: 'Hubble Space Telescope', spec: { type: 'hubble' }, tel: true, D: 2.4 },
  jwst: { label: 'James Webb Space Telescope', spec: { type: 'jwst' }, tel: true, D: 6.6 },
  keck: { label: 'Keck (10 m, segmented)', spec: { type: 'keck' }, tel: true, D: 10.95 },
  elt: { label: 'ELT (39 m, 798 segments)', spec: { type: 'elt' }, tel: true, D: 39.3 },
  slits: { label: "Young's double slit", spec: { type: 'slits', slitWidth: 0.12, slitSep: 0.6 } },
  square: { label: 'Square aperture', spec: { type: 'square' } },
};
const BANDS = {
  mono: { label: 'Monochromatic 550 nm', lambdas: [550], ref: 550 },
  white: { label: 'White light 400–700 nm', lambdas: linspace(400, 700, 13), ref: 550 },
  nir: { label: 'Near-IR 1.7–2.3 µm (false colour)', lambdas: linspace(1700, 2300, 9), ref: 2000, falseColor: true },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'The image of a point is never a point. A lens forms the Fourier transform of its own aperture, so every iris blade, secondary mirror, support strut and segment gap is written into each star and highlight as rings, spikes and halos. These patterns are computed by FFT from the true pupil geometry.', domains: ['photo', 'video', 'space'] }));

  const ctl = controls({
    preset: { type: 'select', label: 'Aperture', value: 'jwst', options: Object.entries(PRESETS).map(([k, p]) => [k, p.label]) },
    blades: { type: 'range', label: 'Blades (iris presets)', min: 3, max: 16, step: 1, value: 6 },
    curvature: { type: 'range', label: 'Blade roundness', min: 0, max: 1, step: 0.01, value: 0, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    band: { type: 'seg', label: 'Spectrum', value: 'nir', options: [['mono', 'Mono'], ['white', 'White'], ['nir', 'NIR']] },
    defocus: { type: 'range', label: 'Defocus Z₄ (waves RMS at λref)', min: -2, max: 2, step: 0.01, value: 0 },
    decades: { type: 'range', label: 'Display range (log decades)', min: 1, max: 7, step: 0.1, value: 5 },
    zoom: { type: 'range', label: 'Zoom', min: 1, max: 6, step: 0.05, value: 1.6, fmt: (v) => v.toFixed(1) + '×' },
    N: { type: 'range', label: 'Camera f-number (for µm scale)', min: 1, max: 32, log: true, value: 8, fmt: (v) => 'f/' + v.toPrecision(2) },
  }, (s) => { if (s.preset !== lastPreset && PRESETS[s.preset].spec.blades) { ctl.set.blades(PRESETS[s.preset].spec.blades); ctl.set.curvature(PRESETS[s.preset].spec.curvature); } lastPreset = s.preset; recompute(); });
  let lastPreset = 'jwst';
  const ro = h('div');
  const calc = liveCalc();

  const n = 512, Q = 4, Dpx = n / Q;
  let data = null;

  const main = stage({ aspect: 1.25, label: 'Point-spread function (log intensity)', draw: drawPSF, minH: 300 });
  const pup = stage({ aspect: 1, label: 'Pupil P(x,y)', draw: drawPupil });
  const prof = stage({ aspect: 1, label: '', draw: drawProfile, cls: 'plain' });
  const ee = stage({ aspect: 1, label: '', draw: drawEE, cls: 'plain' });
  root.append(lab([main.el, h('div.grid-3', {}, pup.el, prof.el, ee.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const recompute = debounce(() => {
    const st = ctl.state, P = PRESETS[st.preset];
    const spec = { ...P.spec };
    if (spec.type === 'polygon') { spec.blades = st.blades; spec.curvature = st.curvature; }
    const amp = rasterAperture(spec, n, Dpx, 4);
    const band = BANDS[st.band];
    const W = st.defocus ? zernikeWavefront(n, Dpx, { 4: st.defocus * band.ref / 1000 }) : null; // µm OPD
    const R = new Float64Array(n * n), G = new Float64Array(n * n), B = new Float64Array(n * n), Lm = new Float64Array(n * n);
    const lams = band.lambdas;
    const basis = lams.length === 1 ? [wavelengthRGB(lams[0], false)] : band.falseColor ? spectralBasis(lams.map((l) => 420 + ((l - lams[0]) / (lams[lams.length - 1] - lams[0])) * 260)) : spectralBasis(lams);
    let base = null;
    lams.forEach((l, i) => {
      let I;
      if (!W) { if (!base) base = psf(amp, null, n, band.ref / 1000).I; I = rescale(base, n, l / band.ref); }
      else I = rescale(psf(amp, W, n, l / 1000).I, n, l / band.ref);
      const [r, g, b] = basis[i];
      for (let k = 0; k < n * n; k++) { const v = I[k]; R[k] += v * r; G[k] += v * g; B[k] += v * b; Lm[k] += v / lams.length; }
    });
    // perfect-PSF peak for Strehl (same pupil, no aberration, reference λ)
    const p0 = psf(amp, null, n, band.ref / 1000).peak;
    const pk = W ? psf(amp, W, n, band.ref / 1000).peak : p0;
    // radial profile & encircled energy (in units of λref/D, D = circumscribed diameter)
    const bins = 240, rmax = 30, prof = new Float64Array(bins), cnt = new Float64Array(bins);
    const c = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - c, y - c) / Q; // λ/D units
      const b = Math.floor((r / rmax) * bins);
      if (b < bins) { prof[b] += Lm[y * n + x]; cnt[b]++; }
    }
    let cum = 0, tot = 0;
    for (let k = 0; k < n * n; k++) tot += Lm[k];
    const eeCurve = [], profCurve = [];
    const peak = Math.max(...Array.from(prof, (v, i) => (cnt[i] ? v / cnt[i] : 0)));
    for (let i = 0; i < bins; i++) {
      cum += prof[i];
      const r = ((i + 0.5) / bins) * rmax;
      if (cnt[i]) profCurve.push([r, prof[i] / cnt[i] / peak]);
      eeCurve.push([((i + 1) / bins) * rmax, cum / tot]);
    }
    let area = 0; for (let k = 0; k < n * n; k++) area += amp[k];
    const fill = area / (Math.PI * (Dpx / 2) ** 2);
    data = { amp, R, G, B, Lm, profCurve, eeCurve, strehl: pk / p0, P, spec, band, fill };
    update();
  }, 40);

  function update() {
    if (!data) return;
    const st = ctl.state, P = data.P, band = data.band;
    const lam = band.ref * 1e-9;
    const rows = [['Open area / circumscribed disk', (data.fill * 100).toFixed(1) + ' %'], ['Strehl ratio', data.strehl.toFixed(3)]];
    const ee1 = data.eeCurve.find((p) => p[0] >= 1.22)?.[1] ?? 0;
    rows.push(['Energy within r = 1.22 λ/D', (ee1 * 100).toFixed(1) + ' %']);
    if (P.tel) {
      const th = (1.22 * lam) / P.D * 206265;
      rows.push(['Diameter D', P.D + ' m'], ['Rayleigh 1.22 λ/D', fmt(th * 1000, 4) + ' mas'], ['λ/D', fmt((lam / P.D) * 206265 * 1000, 4) + ' mas']);
    } else {
      rows.push(['Airy radius 1.22 λN', fmt(1.22 * band.ref / 1000 * st.N, 3) + ' µm'], ['Airy diameter / 4.3 µm pixel', fmt((2.44 * band.ref / 1000 * st.N) / 4.3, 3) + ' px']);
    }
    if (data.spec.type === 'polygon') rows.push(['Diffraction spikes', `${st.blades % 2 ? 2 * st.blades : st.blades} (${st.blades} blades, ${st.blades % 2 ? 'odd → 2n' : 'even → n'})`]);
    ro.replaceChildren(readouts(rows));
    const D = P.tel ? P.D : null;
    calc.set(P.tel
      ? String.raw`\begin{aligned}\theta_R &= 1.22\,\lambda/D\\ &= 1.22\times\frac{${texNum(band.ref / 1000, 3)}\,\mu\text{m}}{${D}\ \text{m}}\\ &= ${texNum((1.22 * lam / D) * 206265 * 1000, 4)}\ \text{mas}\\ \text{PSF}(\boldsymbol\theta) &= \Big|\mathcal F\{P\,e^{i2\pi W/\lambda}\}\Big|^2_{\,\mathbf f=\boldsymbol\theta/\lambda}\end{aligned}`
      : String.raw`\begin{aligned}I(v) &= \left[\frac{2J_1(v)}{v}\right]^2,\quad v = \frac{\pi r}{\lambda N}\\ r_\text{Airy} &= 1.22\,\lambda N = 1.22\times${texNum(band.ref / 1000, 3)}\times${texNum(st.N, 3)}\\ &= ${texNum(1.22 * band.ref / 1000 * st.N, 3)}\ \mu\text{m}\end{aligned}`);
    main.redraw(); pup.redraw(); prof.redraw(); ee.redraw();
  }

  function drawPSF(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!data) return;
    const st = ctl.state;
    const crop = Math.round(n / st.zoom), off = Math.round((n - crop) / 2);
    const ic = imageCanvas(crop, crop);
    let mx = 0; for (let k = 0; k < n * n; k++) mx = Math.max(mx, data.Lm[k]);
    const dec = st.decades;
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const k = (y + off) * n + x + off, o = (y * crop + x) * 4;
      const L = data.Lm[k] / mx;
      const t = Math.max(0, 1 + Math.log10(L + 1e-14) / dec);
      // hue-preserving tone map: scale linear RGB so luminance follows the log stretch
      const lum = 0.2126 * data.R[k] + 0.7152 * data.G[k] + 0.0722 * data.B[k] + 1e-30;
      const s = t / lum;
      let r = data.R[k] * s, g = data.G[k] * s, b = data.B[k] * s;
      const m = Math.max(r, g, b);
      if (m > 1) { r /= m; g /= m; b /= m; }
      ic.data[o] = oetf(Math.max(0, r)) * 255; ic.data[o + 1] = oetf(Math.max(0, g)) * 255; ic.data[o + 2] = oetf(Math.max(0, b)) * 255; ic.data[o + 3] = 255;
    }
    ic.put();
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ic.c, (w - side) / 2, (hh - side) / 2, side, side);
    // scale bar in λ/D
    const pxPerLD = (side / crop) * Q;
    const nice = [1, 2, 5, 10, 20].find((v) => v * pxPerLD > side * 0.12) || 20;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect((w - side) / 2 + 14, hh - 18, nice * pxPerLD, 2);
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    const P = data.P;
    const unit = P.tel ? `${nice} λ/D = ${fmt((nice * data.band.ref * 1e-9) / P.D * 206265 * 1000, 3)} mas` : `${nice} λN = ${fmt((nice * data.band.ref) / 1000 * st.N, 3)} µm`;
    ctx.fillText(unit, (w - side) / 2 + 14, hh - 24);
    ctx.textAlign = 'right';
    ctx.fillText(`${data.band.label}${st.defocus ? `  ·  defocus ${st.defocus} λ` : ''}`, (w + side) / 2 - 12, hh - 12);
  }

  function drawPupil(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!data) return;
    const crop = Dpx + 8, off = (n - crop) / 2;
    const ic = imageCanvas(crop, crop);
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const v = data.amp[(y + off) * n + x + off], o = (y * crop + x) * 4;
      ic.data[o] = 255 * v; ic.data[o + 1] = 205 * v; ic.data[o + 2] = 130 * v; ic.data[o + 3] = 255;
    }
    ic.put();
    ctx.imageSmoothingEnabled = false;
    const side = Math.min(w, hh) - 16;
    ctx.drawImage(ic.c, (w - side) / 2, (hh - side) / 2, side, side);
  }

  function drawProfile(ctx, w, hh) {
    if (!data) return;
    const eps = data.spec.type === 'circle' ? data.spec.obstruction || 0 : 0;
    const showAiry = data.spec.type === 'circle' && !data.spec.spiders;
    const an = [];
    for (let r = 0.01; r <= 12; r += 0.02) an.push([r, airy(Math.PI * r, eps) / airy(0, eps)]);
    plot(ctx, w, hh, {
      title: 'Azimuthal profile', x: { min: 0, max: 12, label: 'radius (λ/D)' }, y: { min: 1e-6, max: 1.2, log: true, label: 'normalised intensity' },
      series: [
        ...(showAiry ? [{ data: an, color: 'rgba(255,255,255,0.45)', width: 1, dash: [4, 3], label: 'analytic Airy (annular)' }] : []),
        { data: data.profCurve.filter((p) => p[0] <= 12), color: '#ffb547', width: 1.8, label: 'FFT (azimuthal mean)' },
      ],
      legend: true, legendX: w - 150,
      vlines: [{ x: 1.22, color: 'rgba(106,215,255,0.6)', label: '1.22' }],
    });
  }

  function drawEE(ctx, w, hh) {
    if (!data) return;
    const ideal = [];
    for (let r = 0.02; r <= 12; r += 0.04) { const v = Math.PI * r; const j0 = besselJ0(v), j1 = besselJ1x(v); ideal.push([r, 1 - j0 * j0 - j1 * j1]); }
    plot(ctx, w, hh, {
      title: 'Encircled energy', x: { min: 0, max: 12, label: 'radius (λ/D)' }, y: { min: 0, max: 1, label: 'fraction' },
      series: [{ data: ideal, color: 'rgba(255,255,255,0.45)', width: 1, dash: [4, 3], label: 'clear circle: 1 − J₀² − J₁²' }, { data: data.eeCurve.filter((p) => p[0] <= 12), color: '#6ad7ff', width: 2, label: 'this pupil' }],
      legend: true, legendX: Math.max(60, w - 175), legendY: hh - 75,
      hlines: [{ y: 0.838, color: 'rgba(255,255,255,0.25)', label: '83.8 %' }],
    });
  }

  recompute();

  root.append(theory('Fraunhofer diffraction by apertures', String.raw`
<div class="theory-cols"><div>
<h3>The PSF is the squared Fourier transform of the pupil</h3>
<p>With a lens of focal length \(f\), the field in the focal plane is the Fourier transform of the pupil function \(P(\mathbf x)\,e^{i2\pi W(\mathbf x)/\lambda}\) evaluated at spatial frequency \(\mathbf f = \mathbf u/(\lambda f)\), or equivalently at angle \(\boldsymbol\theta/\lambda\). For a clear circular pupil of diameter \(D\) this is the <strong>Airy pattern</strong>:</p>
\[I(\theta) = I_0\left[\frac{2J_1(v)}{v}\right]^2,\qquad v = \frac{\pi D\sin\theta}{\lambda}.\]
<p>The first dark ring lies at \(v = 3.8317\), so \(\theta = 1.22\,\lambda/D\), or \(r = 1.22\,\lambda N\) on the sensor. The encircled energy has the closed form \(\mathrm{EE}(v) = 1 - J_0^2(v) - J_1^2(v)\): 83.8 % falls inside the first dark ring and 91 % inside the second.</p>
<h3>Central obstruction</h3>
<p>For an annulus of obscuration ratio \(\varepsilon\), linearity of the transform gives</p>
\[I(v) = \frac{I_0}{(1-\varepsilon^2)^2}\left[\frac{2J_1(v)}{v} - \varepsilon^2\frac{2J_1(\varepsilon v)}{\varepsilon v}\right]^2.\]
<p>The core narrows slightly, which improves the Rayleigh limit, but energy moves into the rings: about 48 % of it sits outside the core at \(\varepsilon = 0.5\). This is why mirror lenses and Schmidt–Cassegrains render low-contrast images and "donut" bokeh.</p>
<h3>Polygonal irises and spikes</h3>
<p>The transform of a straight edge is a line perpendicular to that edge, with intensity falling as \(u^{-2}\). Compare this with the \(u^{-3}\) envelope of the Airy rings, which is why spikes outrun the halo. An iris with \(n\) blades has \(n\) edges. When \(n\) is even, opposite edges are parallel and their streaks overlap, giving \(n\) spikes. When \(n\) is odd, each streak points both ways, giving \(2n\) spikes. Curved blades smear each streak into a fan, which is the purpose of "rounded aperture" designs.</p>
</div><div>
<h3>Segmented telescopes: the array theorem</h3>
<p>A mirror made of identical segments at positions \(\mathbf r_j\) has pupil \(P = p * \sum_j\delta(\mathbf x - \mathbf r_j)\). By the convolution theorem, its PSF is the single-segment pattern multiplied by an <em>array factor</em>:</p>
\[\mathrm{PSF}(\mathbf f) = |\tilde p(\mathbf f)|^2\cdot\Big|\sum_j e^{-i2\pi\,\mathbf f\cdot\mathbf r_j}\Big|^2.\]
<p>The hexagonal segment envelope produces JWST's six bright spikes. The three secondary-mirror struts add two more, and the lower struts were placed so their spikes coincide with the hexagon spikes. The hexagonal lattice of the array factor imprints the faint six-fold "snowflake" of secondary peaks.</p>
<h3>Babinet's principle</h3>
<p>An opaque obstacle and the complementary aperture produce the same diffraction pattern away from the forward beam. A 5 cm strut therefore diffracts exactly as a 5 cm slit would. Spider vanes always make spikes perpendicular to themselves, and four vanes at 90° make the familiar "+".</p>
<h3>How this is computed</h3>
<p>The pupil is rasterised on a 512² grid with 4×4 supersampling per pixel. The anti-aliasing matters: an unfiltered hard edge has an unbounded spectrum and aliases into false spikes. Zero-padding by \(Q = 4\) gives PSF samples at \(\lambda/(4D)\). For white light, each wavelength's PSF is the reference PSF magnified by \(\lambda/\lambda_\text{ref}\) (exact when \(W = 0\)). When defocus is present, every wavelength gets its own FFT, because \(W/\lambda\) changes. Each wavelength is then weighted by the CIE 1931 colour-matching functions, so the outer rings take on their natural chromatic smear. Near-IR bands are mapped linearly onto visible hues, the same way JWST images are colour-coded.</p>
</div></div>`));
  root.append(references([
    'G. B. Airy, "On the diffraction of an object-glass with circular aperture", Trans. Camb. Phil. Soc. 5, 283 (1835).',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 4th ed. (2017), ch. 4–6.',
    'V. N. Mahajan, "Uniform versus Gaussian beams: a comparison of the effects of diffraction, obscuration, and aberrations", JOSA A 3, 470 (1986).',
    'M. D. Perrin et al., "Updated point spread function simulations for JWST with WebbPSF", Proc. SPIE 9143 (2014).',
    'J. E. Krist, R. N. Hook &amp; F. Stoehr, "20 years of Hubble Space Telescope optical modeling using Tiny Tim", Proc. SPIE 8127 (2011).',
  ]));
  return () => [main, pup, prof, ee].forEach((s) => s.destroy());
}

// Bessel J0 and J1 (polynomial approximations, Abramowitz & Stegun 9.4) for the EE curve.
function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const b = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
    return a / b;
  }
  const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
  const a = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const b = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b);
}
