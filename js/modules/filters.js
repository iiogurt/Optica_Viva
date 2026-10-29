// Interference filters on fast optics: the passband moves bluewards in a converging beam.
import { h, controls, stage, readouts, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range, logRange } from '../lib/plot.js';
import { LINES, shifted, passband, coneTransmission, bestPreshift } from '../lib/ifilter.js';
import { t } from '../lib/i18n.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>Narrowband filters let through only the light of a single glowing gas, such as the deep red of hydrogen, and block almost everything else, including light pollution. They work by interference in dozens of thin layers, and the colour they pass depends on the angle at which light crosses them: the more slanted the light, the bluer the colour that gets through.</p>
<p>A fast lens sends light through the filter in a wide cone. Its slanted rays see a passband shifted towards blue, and with a very narrow filter the hydrogen line can slip off the edge, so the filter that should pass it starts to block it.</p>`, [
    'With a 3 nm Hα filter, change the lens from f/8 to <strong>f/2</strong>: watch the line transmission drop.',
    'At f/2, turn on the <strong>pre-shifted</strong> filter: a passband moved slightly redwards wins most of it back.',
    'Raise the <strong>field angle</strong>: off-axis light crosses the filter more slantwise, so the corners lose more.',
  ]));

  const ctl = controls({
    line: { type: 'seg', label: 'Emission line', value: 'ha', options: Object.entries(LINES).map(([k, l]) => [k, l[0]]) },
    fwhm: { type: 'range', label: 'Filter bandwidth (FWHM)', min: 1, max: 15, step: 0.5, value: 3, unit: 'nm' },
    n: { type: 'range', label: 'Effective index of the coating', min: 1.45, max: 2.3, step: 0.01, value: 2.05 },
    N: { type: 'range', label: 'Focal ratio of the optics', min: 1.4, max: 10, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    chief: { type: 'range', label: 'Field angle on the filter (chief ray)', min: 0, max: 12, step: 0.5, value: 0, unit: '°' },
    pre: { type: 'toggle', label: 'Pre-shifted filter for this focal ratio', value: false },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const specSt = stage({ aspect: 2.4, label: '', draw: drawSpectrum, cls: 'plain', minH: 230 });
  const nSt = stage({ aspect: 2.4, label: '', draw: drawVsN, cls: 'plain', minH: 230 });
  root.append(lab([h('div.card', { style: { padding: '8px' } }, specSt.el), h('div.card', { style: { padding: '8px' } }, nSt.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  function update() {
    const st = ctl.state, line = LINES[st.line][1], chief = (st.chief * Math.PI) / 180;
    const best = bestPreshift(line, { fwhm: st.fwhm, n: st.n, N: st.N, chief });
    const centre = line + (st.pre ? best.shift : 0);
    const o = { centre, fwhm: st.fwhm, n: st.n, N: st.N, chief };
    const T = coneTransmission(line, o), T0 = coneTransmission(line, { ...o, centre: line, N: 1e6, chief: 0 });
    const edge = line - shifted(line, Math.atan(1 / (2 * st.N)) + chief, st.n);
    M = { st, line, o, T, best, edge };
    ro.replaceChildren(readouts([
      ['Steepest ray in the cone', ((Math.atan(1 / (2 * st.N)) + chief) * 180 / Math.PI).toFixed(1) + '°'],
      ['Passband shift for that ray', '−' + edge.toFixed(2) + ' nm'],
      ['Line transmission (collimated)', (T0 * 100).toFixed(0) + ' %'],
      ['Line transmission in this beam', (T * 100).toFixed(0) + ' %'],
      ['Best pre-shift of the filter', '+' + best.shift.toFixed(2) + ' nm → ' + (best.T * 100).toFixed(0) + ' %'],
      ['Exposure cost', T > 0.01 ? t('{s} stops', { s: (Math.log2(T0 / T)).toFixed(2) }) : t('line blocked')],
    ]));
    calc.say(st.pre
      ? t('At f/{N}, rays cross the filter at up to {a}°, shifting its passband up to {edge} nm bluewards. The {line} line keeps <strong>{T} %</strong> of its light with the pre-shifted filter.', { N: st.N.toPrecision(2), a: ((Math.atan(1 / (2 * st.N)) + chief) * 180 / Math.PI).toFixed(0), edge: edge.toFixed(1), line: LINES[st.line][0], T: (T * 100).toFixed(0) })
      : t('At f/{N}, rays cross the filter at up to {a}°, shifting its passband up to {edge} nm bluewards. The {line} line keeps <strong>{T} %</strong> of its light; a filter pre-shifted by {shift} nm would keep {best} %.', { N: st.N.toPrecision(2), a: ((Math.atan(1 / (2 * st.N)) + chief) * 180 / Math.PI).toFixed(0), edge: edge.toFixed(1), line: LINES[st.line][0], T: (T * 100).toFixed(0), shift: best.shift.toFixed(1), best: (best.T * 100).toFixed(0) }));
    calc.set(String.raw`\begin{aligned}
    \lambda(\theta) &= \lambda_0\sqrt{1 - \left(\frac{\sin\theta}{n^*}\right)^2}\\
    \theta_\text{max} &= \arctan\frac{1}{2N} = ${texNum(Math.atan(1 / (2 * st.N)) * 180 / Math.PI, 3)}^\circ \Rightarrow \Delta\lambda = ${texNum(-edge, 3)}\ \text{nm}
    \end{aligned}`);
    specSt.redraw(); nSt.redraw();
  }

  function drawSpectrum(ctx, w, hh) {
    if (!M) return;
    const { st, line, o } = M, span = Math.max(3 * st.fwhm, 1.5 * M.edge + 2 * st.fwhm), ls = range(line - span, line + span * 0.6, 220);
    plot(ctx, w, hh, {
      title: 'Filter transmission: parallel light and this beam', x: { min: ls[0], max: ls[ls.length - 1], label: 'wavelength (nm)' }, y: { min: 0, max: 1.05, label: 'transmission' },
      series: [
        { data: ls.map((l) => [l, passband(l, o.centre, st.fwhm)]), color: '#9aa1b5', dash: [4, 4], label: 'parallel light' },
        { data: ls.map((l) => [l, coneTransmission(l, { ...o, nr: 12, nt: 16 })]), color: '#ff6b6b', label: t('f/{N} beam', { N: st.N.toPrecision(2) }) },
      ],
      vlines: [{ x: line, color: '#ffb547', label: LINES[st.line][0] }], legend: true, legendX: 70, legendY: 36,
    });
  }

  function drawVsN(ctx, w, hh) {
    if (!M) return;
    const { st, line } = M, Ns = logRange(1.4, 10, 40), chief = (st.chief * Math.PI) / 180;
    plot(ctx, w, hh, {
      title: 'Line transmission against focal ratio (filters centred on the line)', x: { min: 1.4, max: 10, log: true, label: 'focal ratio N' }, y: { min: 0, max: 1.05, label: 'line transmission' },
      series: [[3, '#ff6b6b'], [5, '#ffb547'], [7, '#6be3a4'], [12, '#6ad7ff']].map(([fw, color]) => ({ data: Ns.map((N) => [N, coneTransmission(line, { centre: line, fwhm: fw, n: st.n, N, chief, nr: 12, nt: 16 })]), color, label: `${fw} nm` })),
      vlines: [{ x: st.N, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: w - 110, legendY: hh - 110,
    });
  }

  update();

  root.append(rule(String.raw`\[\Delta\lambda \approx -\frac{\lambda_0\,\theta^2}{2\,n^{*2}},\qquad \theta_\text{max} = \arctan\frac{1}{2N}\]
<p>For small angles the passband moves bluewards in proportion to the square of the angle. At f/2 the marginal rays cross the filter at 14°; with an effective index of 2.05 the passband of an Hα filter moves by 4.6 nm for them, more than a 3 nm filter's width, while at f/8 the shift is only 0.3 nm. Halving the focal ratio quadruples the shift.</p>`,
    String.raw`The small-angle form holds to a few per cent up to about 20°. The effective index depends on the coating design and slightly on polarisation, so real filters are specified by the manufacturer; temperature also shifts the passband by roughly 0.002–0.03 nm per °C.`));

  root.append(theory('Thin-film filters in converging light', String.raw`
<div class="theory-cols"><div>
<h3>The angle shift</h3>
<p>A multilayer interference filter passes the wavelength at which its cavity layers are an integer number of half waves thick. At incidence angle \(\theta\) in air the optical path across each layer shortens by \(\cos\theta_\text{layer}\), and averaging over the stack gives \(\lambda(\theta) = \lambda_0\sqrt{1 - (\sin\theta/n^*)^2}\) with an effective index \(n^*\) between the low and high indices of the coating (typically 1.5–2.2).</p>
<h3>The cone</h3>
<p>In an f/\(N\) beam the rays fill a cone of half-angle \(\arctan(1/2N)\) around the chief ray, which is tilted by the field angle away from the axis. The page averages the passband over a uniformly illuminated circular pupil (equal-area rings) to get the effective transmission, modelling the passband as a steep-edged super-Gaussian of order 6.</p>
</div><div>
<h3>Pre-shifted filters</h3>
<p>Filters for fast optics are made with their collimated passband slightly redwards of the line, so that the shifted cone is centred on it again. The page searches the shift that maximises the line's transmission for the current focal ratio and field angle.</p>
<h3>Consequences</h3>
<p>Narrow filters (3 nm or less) need slow beams or pre-shifted designs; in wide fields the corners lose more because of the chief-ray angle, which telecentric optics avoid. Placing the filter where the beam is collimated, as in many spectrographs and solar telescopes, removes the problem.</p>
</div></div>`));
  root.append(references([
    'H. A. Macleod, <i>Thin-Film Optical Filters</i>, 4th ed., CRC Press (2010): band-pass filters and their angle shift.',
    'P. W. Baumeister, <i>Optical Coating Technology</i>, SPIE Press (2004).',
  ]));
  return () => [specSt, nSt].forEach((s) => s.destroy());
}
