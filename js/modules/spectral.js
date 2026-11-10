import { h, controls, stage, readouts, imageCanvas, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { LENSES, paraxial, autoSemiDiameters, hasMirrors } from '../lib/raytrace.js';
import { wavelengthCSS } from '../lib/color.js';
import { runOn } from '../lib/compute.js';
import { NB, SW, SH, BAND_LAMBDA, sceneMap, bandData, bandImage, compose, bestFocus, CAMERAS } from '../lib/spectral.js';
import { t } from '../lib/i18n.js';

const REF = 540; // reference wavelength: focus and lateral position (nm)
const LENS_KEYS = Object.keys(LENSES).filter((k) => !hasMirrors(LENSES[k]));
const B440 = BAND_LAMBDA.indexOf(440), B540 = BAND_LAMBDA.indexOf(540), B640 = BAND_LAMBDA.indexOf(640);

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>White light is a mixture of every colour of the rainbow, and a lens treats each colour a little differently: blue may come to a sharp point a fraction of a millimetre before red does, or land slightly closer to the middle of the picture. The camera's sensor then judges colour with three filters that are not quite like the three kinds of cone in your eye.</p>
<p>This laboratory follows the light one colour band at a time: through the lens, onto the pixels, through the filters. What comes out is a picture with the colour fringes and colour errors a real camera would show, next to what your eye would have seen.</p>`, [
    'Choose the <strong>plano-convex singlet</strong> and look at the Siemens star: purple and yellow fringes. Then switch to the <strong>Double-Gauss</strong>.',
    'Move the crop to the <strong>edge of the frame</strong> with the Cooke triplet: the fringes now sit on one side of every edge (lateral colour).',
    'Light the scene with the <strong>sodium lamp</strong> (HP1) and choose <strong>Narrow-band filters</strong>: some patches change colour in the camera but not for the eye.',
  ]));

  const ctl = controls({
    lens: { type: 'select', label: 'Lens', value: 'cooke', options: LENS_KEYS.map((k) => [k, LENSES[k].name]) },
    stop: { type: 'range', label: 'Stopped down from the lens\'s f-number', min: 1, max: 4, step: 0.05, value: 1, fmt: (v) => '× ' + v.toFixed(2) },
    field: { type: 'range', label: 'Crop position (fraction of the half-field)', min: 0, max: 1, step: 0.01, value: 0 },
    focus: { type: 'range', label: 'Focus shift from the best 540 nm focus', min: -200, max: 200, step: 1, value: 0, unit: 'µm' },
    pitch: { type: 'range', label: 'Pixel pitch', min: 1.5, max: 8, step: 0.1, value: 4, unit: 'µm' },
    illum: { type: 'select', label: 'Illuminant', value: 'D65', options: [['D65', 'CIE D65 (daylight)'], ['A', 'CIE A (incandescent, 2856 K)'], ['FL11', 'CIE FL11 (tri-band fluorescent)'], ['HP1', 'CIE HP1 (high-pressure sodium)']] },
    camera: { type: 'select', label: 'Camera sensitivities', value: 'cmos', options: Object.entries(CAMERAS).map(([k, c]) => [k, c.name]) },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc('From spectrum to pixel');
  const note = h('p.note', { role: 'status' }, '');
  const ideal = stage({ aspect: SW / SH, label: 'The eye, through a perfect lens', draw: (c, w, hh) => blit(c, w, hh, imgs.ideal), minH: 140 });
  const eye = stage({ aspect: SW / SH, label: 'The eye, through this lens', draw: (c, w, hh) => blit(c, w, hh, imgs.eye), minH: 140 });
  const cam = stage({ aspect: SW / SH, label: 'The camera, through this lens', draw: (c, w, hh) => blit(c, w, hh, imgs.cam), minH: 140 });
  const bandPlot = stage({ aspect: 1.4, label: '', draw: drawBands, cls: 'plain', minH: 200 });
  root.append(lab([h('div.grid-2', {}, ideal.el, eye.el), h('div.grid-2', {}, cam.el, h('div.card', { style: { padding: '6px' } }, bandPlot.el)), note], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const scene = sceneMap(), imgs = { ideal: imageCanvas(SW, SH), eye: imageCanvas(SW, SH), cam: imageCanvas(SW, SH) };
  let gen = 0, bands = null, bandsKey = '', stats = null, optics = null;

  function setup() {
    const st = ctl.state, base = LENSES[st.lens], lens = { ...base, epd: base.epd / st.stop };
    const sd = base._sd || (base._sd = autoSemiDiameters(base).map((v, i) => base.surfaces[i].sd || v));
    const par = paraxial(lens, REF), N = Math.abs(par.efl) / lens.epd, theta = st.field * base.field;
    // focus: the best (smallest RMS spot) 540 nm image plane at the crop's field angle, plus the slider
    const best = (l) => bestFocus(lens, l, theta, l === REF ? par : paraxial(lens, l), sd, par.zImage);
    const zBest = best(REF), loca = (l) => (best(l) - zBest) * 1000; // µm behind the 540 nm best focus
    return { lens, sd, par, N, theta, zImg: zBest + st.focus / 1000, zShift: (zBest - par.zImage) * 1000, loca440: loca(440), loca640: loca(640), name: base.name };
  }
  // the optics depend on lens, stop, field, focus, pitch and the illuminant's band radiances;
  // the camera only changes how the bands are summed
  const run = debounce(() => {
    const st = ctl.state, D = bandData(st.illum, CAMERAS[st.camera].sens), key = JSON.stringify([st.lens, st.stop, st.field, st.focus, st.pitch, st.illum]);
    optics = setup();
    show(D, compose(Array.from({ length: NB }, (_, b) => bandImage(scene, D.L, b)), D), 'ideal');
    if (key === bandsKey && bands) { finish(D); return; }
    const my = ++gen, t0 = performance.now(), o = optics;
    note.textContent = t('Tracing the lens and convolving the scene in {n} wavelength bands…', { n: NB });
    Promise.all(BAND_LAMBDA.map((lam, b) => runOn(b, 'spectralBand', { lens: o.lens, sd: o.sd, theta: o.theta, zImg: o.zImg, N: o.N, lam, lamRef: REF, pitch: st.pitch, L: D.L.map((l) => l[b]) })))
      .then((rs) => {
        if (my !== gen) return;
        if (rs.some((r) => !r)) { note.textContent = t('The lens cannot form an image at this field position.'); return; }
        bands = rs.map((r) => r.out); bandsKey = key;
        stats = rs.map((r) => ({ ee80: r.ee80, shift: r.shift }));
        note.textContent = t('{n} bands traced and convolved in {s} s.', { n: NB, s: ((performance.now() - t0) / 1000).toFixed(1) });
        finish(D);
      }).catch((e) => { console.error(e); note.textContent = String(e.message || e); });
  }, 200);
  function show(D, r, which) {
    if (which === 'ideal') { imgs.ideal.data.set(r.eye); imgs.ideal.put(); ideal.redraw(); return; }
    imgs.eye.data.set(r.eye); imgs.eye.put(); imgs.cam.data.set(r.cam); imgs.cam.put(); eye.redraw(); cam.redraw();
  }
  function finish(D) {
    const r = compose(bands, D), st = ctl.state, o = optics;
    show(D, r, 'lens');
    const lat = stats[B640].shift - stats[B440].shift, g = stats[B540];
    ro.replaceChildren(readouts([
      ['Sensor crop', t('{w} × {h} mm, {a}° off axis', { w: fmt(SW * st.pitch / 1000, 2), h: fmt(SH * st.pitch / 1000, 2), a: fmt(o.theta, 2) })],
      ['Working f-number', 'f/' + fmt(o.N, 2)],
      ['Best 540 nm focus from the paraxial focus', fmt(o.zShift, 3) + ' µm'],
      ['Best focus of 440 nm and 640 nm behind 540 nm', `${fmt(o.loca440, 3)} · ${fmt(o.loca640, 3)} µm`],
      ['Lateral colour, 440 → 640 nm', t('{d} µm = {p} px', { d: fmt(lat, 2), p: fmt(lat / st.pitch, 2) })],
      ['80 % energy radius at 540 nm', fmt(g.ee80, 2) + ' µm'],
      ['Camera colour error on the 24 patches (CIEDE2000)', t('mean {m}, max {x}', { m: fmt(r.mean, 2), x: fmt(r.max, 2) })],
    ]));
    calc.say(t('In the {lens}, 440 nm light focuses best {a} µm and 640 nm light {b} µm behind the best 540 nm focus, and lands {d} µm ({p} px) apart at this field position. The camera\'s colours differ from the eye\'s by ΔE₀₀ = <strong>{m}</strong> on average.', { lens: t(o.name), a: fmt(o.loca440, 3), b: fmt(o.loca640, 3), d: fmt(lat, 2), p: fmt(lat / st.pitch, 2), m: fmt(r.mean, 2) }));
    const M = r.M;
    calc.set(String.raw`\begin{aligned}
    I_b &= \mathrm{PSF}_b * L_b\\
    \text{XYZ} &= \textstyle\sum_b I_b\,(\bar x_b, \bar y_b, \bar z_b)\\
    \text{RGB} &= \textstyle\sum_b I_b\,(S_{R,b}, S_{G,b}, S_{B,b})\\
    \text{XYZ}_\text{cam} &= M\,\mathrm{diag}(g)\,\text{RGB}\\
    M &= \begin{pmatrix}${M.map((row) => row.map((v) => texNum(v / 100, 3)).join('&')).join('\\\\')}\end{pmatrix}
    \end{aligned}`);
    bandPlot.redraw();
  }
  function blit(ctx, w, hh, ic) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, 0, 0, w, hh);
  }
  function drawBands(ctx, w, hh) {
    if (!stats) return;
    const ys = stats.flatMap((s) => [s.ee80, s.shift]);
    plot(ctx, w, hh, {
      title: 'Blur and shift per band', x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: Math.min(0, ...ys) * 1.1, max: Math.max(...ys) * 1.15 + 0.5, label: 'µm' },
      series: [
        { data: stats.map((s, b) => [BAND_LAMBDA[b], s.ee80]), color: '#ffb547', width: 2, points: 3, label: '80 % energy radius' },
        { data: stats.map((s, b) => [BAND_LAMBDA[b], s.shift]), color: '#6ad7ff', width: 2, points: 3, label: 'lateral shift from 540 nm' },
      ],
      vlines: BAND_LAMBDA.map((l) => ({ x: l, color: wavelengthCSS(l, 0.18) })), legend: true,
    });
  }
  function update() { run(); }
  update();

  root.append(rule(String.raw`\[\Delta f \approx \frac{f}{V}\]
<p>A thin singlet focuses blue (486 nm) and red (656 nm) light a distance \(f/V\) apart, where \(V\) is the glass's Abbe number. A 50 mm lens of N-BK7 (\(V = 64\)) spreads them over 0.78 mm, at f/4 a blur of about 0.78/4 = 0.2 mm across, which is 50 pixels of 4 µm.</p>`,
    String.raw`Only for a thin singlet. An achromat makes two wavelengths meet and leaves the secondary spectrum, about \(f/2000\); lateral colour, spherochromatism and the camera's filters need the full calculation.`));
  root.append(theory('Rendering wavelength by wavelength', String.raw`
<div class="theory-cols"><div>
<h3>The scene</h3>
<p>Every pixel of the 192 × 128 crop is a material: a reflectance (the 14 CIE test colour samples, 10 more patches, white, black and an 18 % grey) lit by the illuminant, or a light source with its own spectrum (a sodium line, a 650 nm laser, a blue LED and a phosphor white LED, each 40 times as bright as white so that it blooms). The spectra are tabulated every 5 nm from 380 to 780 nm and summed into 16 bands of 25 nm, \(L_b = \sum_{\lambda\in b} r(\lambda)E(\lambda)\,\Delta\lambda\).</p>
<h3>The lens, band by band</h3>
<p>At each band's centre wavelength the lens is traced exactly: the wavefront on the exit-pupil sphere from 41 × 41 real rays, then the Debye–Fraunhofer integral by FFT, as in the ray tracer's PSF. The sensor sits at the best 540 nm focus for the crop's field angle, the plane where real rays have the smallest RMS spot (plus the focus slider), so longitudinal colour and spherochromatism appear as defocus and aberration that change with wavelength. The PSF is integrated over the sensor pixels and convolved with the band's image. The crop is less than a millimetre wide, small enough that the PSF hardly changes across it. Lateral colour is the chief ray's landing point at that wavelength minus at 540 nm, applied as an exact sub-pixel shift in Fourier space.</p>
</div><div>
<h3>Eye and camera</h3>
<p>The eye integrates the bands with the CIE 1931 colour-matching functions and adapts to the illuminant's white (Bradford), as a viewer would. The camera integrates them with its three spectral sensitivities, each averaged over the band weighted by the illuminant, which makes the band sums exact for reflectances that are flat within a band. White balance scales the channels so that a perfect white is neutral, and a 3 × 3 matrix, fitted by least squares on the 24 patches with white held exact, turns raw RGB into XYZ. A camera reproduces every colour exactly only if its sensitivities are linear combinations of the colour-matching functions (the Luther–Ives condition). Otherwise some colours that match for the eye differ for the camera, and the error grows under spiky light such as fluorescent or sodium lamps.</p>
<h3>What is left out</h3>
<p>The spectrum inside a band shares one PSF. Every pixel records all three channels: there is no Bayer mosaic, noise or clipping before the matrix. Both images are shown in sRGB with white at 85 %, so colours outside the sRGB gamut are clipped.</p>
</div></div>`));
  root.append(references([
    'CIE 15:2018, <i>Colorimetry</i>, 4th ed., Commission Internationale de l’Éclairage (2018).',
    'R. Luther, "Aus dem Gebiet der Farbreizmetrik", <i>Z. techn. Phys.</i> 8, 540 (1927).',
    'J. Jiang, D. Liu, J. Gu &amp; S. Süsstrunk, "What is the space of spectral sensitivity functions for digital color cameras?", IEEE WACV (2013).',
    'W. J. Smith, <i>Modern Optical Engineering</i>, 4th ed., McGraw-Hill (2008), ch. 5 (chromatic aberration).',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 4th ed., W. H. Freeman (2017).',
  ]));
  return () => { gen++; [ideal, eye, cam, bandPlot].forEach((s) => s.destroy()); };
}
