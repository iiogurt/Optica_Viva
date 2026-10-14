import { h, controls, stage, readouts, texNum, fmt } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { wavelengthCSS } from '../lib/color.js';
import { vertices } from '../lib/raytrace.js';
import { index } from '../lib/glass.js';
import { LE_GRAND, eyeAt, chromaticDifference, thibos, cocFromAcuity } from '../lib/eye.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Your eye is a camera: the cornea and the lens focus light onto the retina, the iris is the aperture, and the light-sensitive cells of the retina are the pixels. Its optics are surprisingly imperfect. Blue light comes to focus noticeably in front of red, and the image is sharpest with a medium-sized pupil, not the widest one.</p>
<p>The eye also decides what counts as sharp in a photograph. At reading distance it cannot see details smaller than about 0.1–0.2 mm on a print, so any blur below that, scaled back to the sensor, looks perfectly sharp. That is where photography's well-known 0.03 mm "circle of confusion" comes from.</p>`, [
    "Move the wavelength of the marked rays from <strong>450</strong> to <strong>650 nm</strong>: blue focuses in front of the retina, red slightly behind it.",
    "Under <em>Pupil size, aberrations and the retinal image</em>, change the <strong>pupil</strong> from 1 to 8 mm. Guess which size gives the sharpest image, then read \"Best pupil for 30 c/deg\".",
    "Under <em>From visual acuity to the circle of confusion</em>, double the <strong>viewing distance</strong>: the allowed circle of confusion doubles too.",
  ]));

  // ── schematic eye ──
  const ctl = controls({ lam: { type: 'range', label: 'Wavelength of the marked rays', min: 420, max: 680, step: 5, value: 450, unit: 'nm' } }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const diagram = stage({ aspect: 2.2, label: "Le Grand's schematic eye: rays from a distant point at 555 nm (white) and at the chosen wavelength (colour); axial scale 1:1", draw: drawEye, minH: 220 });
  const loca = stage({ aspect: 2.2, label: '', draw: drawLoca, cls: 'plain', minH: 200 });
  root.append(lab([diagram.el, h('div.card', { style: { padding: '6px' } }, loca.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));
  function update() {
    const st = ctl.state, e = eyeAt(587.56), z = vertices(LE_GRAND), axial = z[3] + LE_GRAND.surfaces[3].t;
    const nV = index(LE_GRAND.surfaces[3].glass, 587.56);
    ro.replaceChildren(readouts([
      ['Power of the eye (d line)', e.power.toFixed(2) + ' D'],
      ['Anterior / posterior focal length', `${(1000 / e.power).toFixed(2)} / ${((1000 * nV) / e.power).toFixed(2)} mm`],
      ['Axial length (cornea to retina)', axial.toFixed(2) + ' mm'],
      ['Refraction at 555 nm', eyeAt(555).error.toFixed(2) + ' D'],
      ['Chromatic difference 450 → 650 nm', (chromaticDifference(450) - chromaticDifference(650)).toFixed(2) + ' D (measured: ' + (thibos(650) - thibos(450)).toFixed(2) + ' D)'],
      [`Refraction at ${st.lam} nm relative to 555`, (-chromaticDifference(st.lam)).toFixed(2) + ' D' + (st.lam < 555 ? ' (eye myopic in blue)' : '')],
    ]));
    calc.say(`The eye focuses with <strong>${e.power.toFixed(1)} dioptres</strong>, like a lens of ${(1000 / e.power).toFixed(1)} mm focal length in air. `
      + (Math.abs(chromaticDifference(st.lam)) < 0.02 ? `Light of ${st.lam} nm is in focus on the retina.` : `Light of ${st.lam} nm comes to focus ${st.lam < 555 ? 'in front of' : 'behind'} the retina, an error of ${Math.abs(chromaticDifference(st.lam)).toFixed(2)} dioptres.`));
    calc.set(String.raw`\begin{aligned}
    P &= -C = ${texNum(e.power, 4)}\ \text{D}\\
    R(\lambda) &= -\frac{S_{00}}{S_{01}},\quad \Delta R_{450\to650} = ${texNum(chromaticDifference(450) - chromaticDifference(650), 3)}\ \text{D}
    \end{aligned}`);
    [diagram, loca].forEach((x) => x.redraw());
  }
  // paraxial ray heights through the eye (reduced-angle form) for drawing
  function rays(lam, y0) {
    const z = vertices(LE_GRAND), pts = [[-6, y0]];
    let y = y0, nu = 0;
    LE_GRAND.surfaces.forEach((s, i) => {
      if (i > 0) y += (LE_GRAND.surfaces[i - 1].t / index(LE_GRAND.surfaces[i - 1].glass, lam)) * nu;
      pts.push([z[i], y]);
      const n = i ? index(LE_GRAND.surfaces[i - 1].glass, lam) : 1, n2 = index(s.glass, lam);
      nu -= y * ((n2 - n) / s.R);
    });
    const nV = index(LE_GRAND.surfaces[3].glass, lam), zl = z[3], L = LE_GRAND.surfaces[3].t;
    const zf = zl - (y * nV) / nu; // axis crossing
    pts.push([Math.min(zf, zl + L + 2), y + (nu / nV) * (Math.min(zf, zl + L + 2) - zl)]);
    return { pts, zf };
  }
  function drawEye(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const z = vertices(LE_GRAND), zR = z[3] + LE_GRAND.surfaces[3].t, sc = (w - 40) / (zR + 10), X = (q) => 20 + (q + 6) * sc, cy = hh / 2, Y = (q) => cy - q * sc;
    // globe outline and media
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(X(zR - 12), cy, 12 * sc, 11.5 * sc, 0, 0, 7); ctx.stroke();
    const arc = (zv, R, hgt, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); for (let t = -hgt; t <= hgt; t += 0.1) { const sag = R - Math.sign(R) * Math.sqrt(R * R - t * t); const xx = X(zv + sag), yy = Y(t); t === -hgt ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy); } ctx.stroke(); };
    arc(z[0], 7.8, 5.5, '#6ad7ff'); arc(z[1], 6.5, 5.3, 'rgba(106,215,255,0.5)'); arc(z[2], 10.2, 4.2, '#ffd27a'); arc(z[3], -6, 4.2, '#ffd27a');
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(X(z[2]) - 1, Y(6), 2, (6 - 2) * sc); ctx.fillRect(X(z[2]) - 1, Y(-2), 2, (6 - 2) * sc); // iris (4 mm pupil)
    ctx.strokeStyle = '#ff9cc0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(zR), Y(4)); ctx.lineTo(X(zR), Y(-4)); ctx.stroke();
    const st = ctl.state;
    for (const [lam, col] of [[555, 'rgba(255,255,255,0.8)'], [st.lam, wavelengthCSS(st.lam, 0.95)]]) {
      for (const y0 of [-1.8, -1, 1, 1.8]) {
        const { pts } = rays(lam, y0);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); pts.forEach(([zz, yy], i) => (i ? ctx.lineTo(X(zz), Y(yy)) : ctx.moveTo(X(zz), Y(yy)))); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif';
    ctx.fillText('cornea', X(-1), Y(6.2)); ctx.fillText('lens', X(z[2]), Y(4.8)); ctx.fillText('retina', X(zR) - 10, Y(4.8));
    const zf = rays(st.lam, 1).zf, z5 = rays(555, 1).zf;
    ctx.fillText(`focus shift ${((zf - z5) * 1000).toFixed(0)} µm`, X(zR) - 120, hh - 8);
  }
  function drawLoca(ctx, w, hh) {
    const ls = Array.from({ length: 53 }, (_, i) => 420 + i * 5);
    plot(ctx, w, hh, {
      title: 'Chromatic difference of refraction (relative to 555 nm)', x: { min: 420, max: 680, label: 'wavelength (nm)' }, y: { min: -1.5, max: 0.6, label: 'refraction (D)' },
      series: [{ data: ls.map((l) => [l, -chromaticDifference(l)]), color: '#ffb547', width: 2.2, label: 'Le Grand eye, water-like media (this model)' }, { data: ls.map((l) => [l, thibos(l) - thibos(555)]), color: '#6ad7ff', width: 1.6, dash: [5, 3], label: 'measured (Thibos et al. 1992 fit)' }],
      vlines: [{ x: ctl.state.lam, color: 'rgba(255,255,255,0.35)' }], legend: true, legendX: w - 330, legendY: hh - 80,
    });
  }

  // ── pupil size and image quality ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Pupil size, aberrations and the retinal image'));
  const pctl = controls({
    p: { type: 'range', label: 'Pupil diameter', min: 1, max: 8, step: 0.1, value: 3, unit: 'mm' },
    hoa: { type: 'range', label: 'Higher-order aberrations (× typical)', min: 0, max: 2, step: 0.05, value: 1 },
    sc: { type: 'toggle', label: 'Stiles–Crawford apodisation', value: true },
  }, () => updP());
  const pro = h('div');
  const psfView = stage({ aspect: 1, label: 'Retinal point-spread function at 555 nm', draw: drawPSF, minH: 220 });
  const mtfPlot = stage({ aspect: 1.3, label: '', draw: drawMTF, cls: 'plain', minH: 220 });
  const sweepPlot = stage({ aspect: 2.4, label: '', draw: drawSweep, cls: 'plain', minH: 200 });
  sec2.append(lab([h('div.grid-2', {}, psfView.el, h('div.card', { style: { padding: '6px' } }, mtfPlot.el)), h('div.card', { style: { padding: '6px' } }, sweepPlot.el)], [h('div.card', {}, pctl.el), h('div.card', {}, pro)]));
  root.append(sec2);
  const job = latest('eye'), PUPILS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8];
  let E = null;
  function updP() {
    const st = pctl.state;
    job('eye', { cur: { p: st.p, lam: 555, hoa: st.hoa, sc: st.sc }, pupils: PUPILS }).then((r) => {
      E = { st: { ...st }, ...r };
      const best = r.sweep.reduce((a, b) => (b[2] > a[2] ? b : a));
      const at = (c) => { const { freq, mtf } = r.one; for (let i = 1; i < freq.length; i++) if (freq[i] >= c) return mtf[i - 1] + ((c - freq[i - 1]) / (freq[i] - freq[i - 1])) * (mtf[i] - mtf[i - 1]); return 0; };
      pro.replaceChildren(readouts([
        ['Diffraction cut-off D/λ', r.one.cutoff.toFixed(0) + ' cycles/degree'],
        ['Strehl ratio', r.one.strehl.toFixed(3)],
        ['MTF at 30 / 60 cycles/degree', `${at(30).toFixed(2)} / ${at(60).toFixed(2)}`],
        ['Best pupil for 30 c/deg', best[0] + ' mm'],
        ['Foveal cone Nyquist (2.5 µm spacing)', '≈ 60 cycles/degree'],
      ]));
      [psfView, mtfPlot, sweepPlot].forEach((x) => x.redraw());
    });
  }
  function drawPSF(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!E) return;
    const { psf, C, pxArcmin } = E.one, sz = Math.min(w, hh) - 8, img = ctx.createImageData(C, C);
    for (let k = 0; k < C * C; k++) { const t = Math.max(0, 1 + Math.log10(Math.max(psf[k], 1e-5)) / 4), o = k * 4; img.data[o] = 255 * t; img.data[o + 1] = 225 * t * t; img.data[o + 2] = 170 * t ** 3; img.data[o + 3] = 255; }
    const c2 = document.createElement('canvas'); c2.width = C; c2.height = C; c2.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(c2, (w - sz) / 2, (hh - sz) / 2, sz, sz);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(`${(C * pxArcmin).toFixed(1)}′ across · log, 4 decades · peak ${(Math.max(...psf)).toFixed(2)} of diffraction-limited`, 8, hh - 8);
  }
  function drawMTF(ctx, w, hh) {
    if (!E) return;
    const { freq, mtf, cutoff } = E.one, dl = (f) => { const s = Math.min(1, f / cutoff); return (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s)); };
    plot(ctx, w, hh, {
      title: `Retinal MTF, ${E.st.p} mm pupil, 555 nm`, x: { min: 0, max: 90, label: 'cycles per degree' }, y: { min: 0, max: 1, label: 'MTF' },
      series: [{ data: freq.map((f) => [f, dl(f)]).filter((q) => q[0] <= 90), color: 'rgba(255,255,255,0.4)', width: 1.2, dash: [4, 3], label: 'diffraction limit' }, { data: freq.map((f, i) => [f, mtf[i]]).filter((q) => q[0] <= 90), color: '#ffb547', width: 2.2, label: 'eye' }],
      vlines: [{ x: 60, color: 'rgba(107,227,164,0.6)', label: 'cone Nyquist' }], legend: true, legendX: w - 170, legendY: 34,
    });
  }
  function drawSweep(ctx, w, hh) {
    if (!E) return;
    plot(ctx, w, hh, {
      title: 'Image quality vs pupil diameter', x: { min: 1, max: 8, label: 'pupil diameter (mm)' }, y: { min: 0, max: 1, label: 'value' },
      series: [{ data: E.sweep.map((q) => [q[0], q[1]]), color: '#6ad7ff', width: 1.6, label: 'Strehl ratio' }, { data: E.sweep.map((q) => [q[0], q[2]]), color: '#ffb547', width: 2.2, label: 'MTF at 30 c/deg' }, { data: E.sweep.map((q) => [q[0], q[3]]), color: '#6be3a4', width: 1.6, label: 'MTF at 60 c/deg' }],
      vlines: [{ x: E.st.p, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: w - 180, legendY: 34,
    });
  }

  // ── circle of confusion ──
  const sec3 = h('section.block', {}, h('h2', {}, 'From visual acuity to the circle of confusion'));
  const cctl = controls({
    pw: { type: 'range', label: 'Print width', min: 100, max: 1500, log: true, value: 254, unit: 'mm' },
    V: { type: 'range', label: 'Viewing distance', min: 150, max: 3000, log: true, value: 250, unit: 'mm' },
    acu: { type: 'range', label: 'Visual acuity (resolved detail)', min: 0.5, max: 4, step: 0.1, value: 2.3, unit: '′' },
    sw: { type: 'range', label: 'Sensor width', min: 6, max: 54, step: 0.1, value: 36, unit: 'mm' },
  }, () => updC());
  const cro = h('div');
  const ccalc = liveCalc();
  sec3.append(lab([h('div.card', { style: { padding: '14px' } }, h('p', {}, 'The depth-of-field scales on lenses assume that a blur smaller than the circle of confusion looks sharp. That limit is not optical: it is the blur that a viewer cannot see in the final print. A 1′ acuity is the eye at its best; the traditional value corresponds to about 2.3′, a relaxed criterion for a print viewed from a distance equal to its diagonal.'))], [h('div.card', {}, cctl.el), h('div.card', {}, cro), ccalc.el]));
  root.append(sec3);
  function updC() {
    const st = cctl.state, E2 = st.pw / st.sw, c = cocFromAcuity(st.V, st.acu, E2), diag = Math.hypot(st.sw, st.sw / 1.5);
    cro.replaceChildren(readouts([['Enlargement', E2.toFixed(1) + '×'], ['Smallest visible blur on the print', (st.V * st.acu * Math.PI / 10800).toFixed(3) + ' mm'], ['Circle of confusion on the sensor', (c * 1000).toFixed(1) + ' µm'], ['Traditional d/1500', ((diag / 1500) * 1000).toFixed(1) + ' µm']]));
    ccalc.set(String.raw`c = \frac{V\,\alpha}{E} = \frac{${texNum(st.V, 3)}\times${texNum(st.acu, 3)}'\,}{${texNum(E2, 3)}} = ${texNum(c * 1000, 3)}\ \mu\text{m}`);
  }

  update(); updP(); updC();

  root.append(rule(String.raw`\[c = \frac{V\,\alpha}{E}\]
<p>The circle of confusion \(c\) on the sensor is the smallest blur the eye can see on the print (viewing distance \(V\) times the eye's resolution angle \(\alpha\)) divided by the enlargement \(E\) from sensor to print. A 25 cm-wide print from a 36 mm-wide full-frame sensor is enlarged 7 times. Viewed from 25 cm by an eye that resolves 2.3′, blur down to 0.17 mm is visible on the print, which is 0.024 mm on the sensor. The classic 0.03 mm comes from the same reasoning with slightly coarser assumptions.</p>`,
    String.raw`Visual acuity depends on contrast, brightness and age, and people look at large prints from close up. When pictures are inspected pixel by pixel on a screen, the limit becomes the pixel pitch, a few micrometres, far below 0.03 mm.`));
  root.append(theory('The eye as an optical instrument', String.raw`
<div class="theory-cols"><div>
<h3>A 60-dioptre camera</h3>
<p>Le Grand's full theoretical eye has a cornea (n = 1.3771) and a crystalline lens (n = 1.42) between aqueous and vitreous humours. It totals 59.94 D, an image-side focal length of 22.3 mm in the vitreous, so one arc minute spans 4.9 µm on the retina. The ocular media disperse almost like water. The eye therefore has about 1–1.2 D of longitudinal chromatic aberration across the visible, far more than any camera lens is allowed. The model reproduces the measured "chromatic eye" of Thibos et al. within 10 % without fitting. We do not see colour fringes, because the visual system weights the middle of the spectrum, the macular pigment absorbs blue, and blue cones are absent from the central fovea.</p>
<h3>The best pupil</h3>
<p>A small pupil is diffraction-limited: its cut-off frequency \(D/\lambda\) is 31 cycles/degree at 1 mm. A large pupil lets in the aberrations, dominated by spherical aberration, which grows as the fourth power of the diameter. The retinal image is best at a pupil of 2.5–3.5 mm (Campbell &amp; Gubisch 1966), where the MTF at 60 cycles/degree just reaches the Nyquist frequency of the foveal cone mosaic (≈ 2.5 µm spacing). Optics and sampling are matched. The Stiles–Crawford effect, the lower efficiency of cones for light entering near the pupil margin, acts as a Gaussian apodisation \(10^{-0.05 r^2}\) that softens the effect of a large pupil.</p>
</div><div>
<h3>From acuity to the circle of confusion</h3>
<p>If the eye resolves an angle \(\alpha\) at viewing distance \(V\), a print enlarged \(E\) times can hide blur up to</p>
\[c = \frac{V\alpha}{E}\]
<p>on the sensor. Viewing a print from a distance equal to its diagonal makes the result independent of the print size, giving \(c = d\,\alpha\) with \(d\) the sensor diagonal. The classic value \(c = d/1500\) (0.029 mm for full frame) corresponds to \(\alpha \approx 2.3'\), a relaxed criterion; a critical viewer with 1′ acuity needs about \(d/3400\).</p>
<p>Modelled here: a paraxial schematic eye with homogeneous media (real lenses have a gradient index); population-typical higher-order aberrations (individual eyes differ widely); monochromatic MTFs at 555 nm.</p>
</div></div>`));
  root.append(references([
    'D. A. Atchison &amp; G. Smith, <em>Optics of the Human Eye</em>, Butterworth-Heinemann (2000): Le Grand full theoretical eye, Stiles–Crawford effect.',
    'L. N. Thibos, M. Ye, X. Zhang &amp; A. Bradley, “The chromatic eye: a new reduced-eye model of ocular chromatic aberration in humans”, <em>Appl. Opt.</em> 31, 3594 (1992).',
    'F. W. Campbell &amp; R. W. Gubisch, “Optical quality of the human eye”, <em>J. Physiol.</em> 186, 558 (1966).',
    'L. N. Thibos, X. Hong, A. Bradley &amp; X. Cheng, “Statistical variation of aberration structure and image quality in a normal population of healthy eyes”, <em>J. Opt. Soc. Am. A</em> 19, 2329 (2002).',
  ]));

  return () => [diagram, loca, psfView, mtfPlot, sweepPlot].forEach((x) => x.destroy());
}
