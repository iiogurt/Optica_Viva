// Satellite trails and stacking: mean, median and sigma-clipping compared on the same frames.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { trailDepth } from '../lib/trails.js';
import { t, N_ } from '../lib/i18n.js';

const W = 200, H = 134, D = 8, PARC = 3, Q = 0.4, READ = 3; // an 80 mm refractor, 3″ pixels
const PANELS = [['one', N_('One frame')], ['mean', N_('Mean of all frames')], ['median', N_('Median')], ['clip', N_('κσ-clipped mean')]];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>Thousands of satellites now circle the Earth, and around dusk and dawn they catch the sunlight: a long exposure of the sky often has a bright line straight across it. Astrophotographers take many shorter exposures and combine them, so a line in one frame can be thrown away.</p>
<p>How you combine them decides what is left. A plain average keeps a faint ghost of every line. Taking, for each pixel, the middle value removes the lines but leaves the picture a little grainier. Throwing out only the values that are clearly too bright removes the lines and keeps the picture smooth.</p>`, [
    'With the <strong>mean</strong>, add frames: does the ghost of the trails ever disappear completely?',
    'Compare the grain of the <strong>median</strong> with the <strong>clipped mean</strong> in the empty sky.',
    'Make the satellites <strong>fainter</strong> (a larger magnitude): when does a trail get through the clipping?',
  ]));

  const ctl = controls({
    N: { type: 'range', label: 'Frames in the stack', min: 4, max: 60, step: 1, value: 20 },
    rate: { type: 'range', label: 'Satellite trails per frame (on average)', min: 0, max: 2, step: 0.05, value: 0.5 },
    mSat: { type: 'range', label: 'Brightness of the satellites (magnitude)', min: 3, max: 10, step: 0.1, value: 6 },
    t: { type: 'range', label: 'Length of each frame', min: 10, max: 300, log: true, value: 60, unit: 's' },
    bortle: { type: 'range', label: 'Sky darkness (Bortle class)', min: 1, max: 9, step: 1, value: 4 },
    kappa: { type: 'range', label: 'Clipping threshold κ', min: 1.5, max: 6, step: 0.1, value: 3, unit: 'σ' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const views = PANELS.map(([k, label]) => stage({ aspect: 1.5, label, draw: (c, w, hh) => drawPanel(c, w, hh, k), minH: 160 }));
  const [vOne, vMean, vMedian, vClip] = views;
  const chart = stage({ aspect: 2.4, label: '', draw: drawChart, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Making the frames in the worker…'));
  root.append(lab([h('div.grid-2', {}, ...views.map((v) => v.el)), note, h('div.card', { style: { padding: '6px' } }, chart.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('trails');
  let R = null;
  function update() {
    const st = ctl.state;
    note.textContent = t('Making the frames in the worker…');
    job('trails', { W, H, N: Math.round(st.N), t: st.t, D, pArc: PARC, q: Q, mu0: 21.5, hArc: 70, bortle: Math.round(st.bortle), read: READ, rate: st.rate, mSat: st.mSat, omega: 0.8, seed: 5, kappa: st.kappa }).then((r) => {
      R = { ...r, st: { ...st } };
      note.textContent = t('{n} frames, {k} satellite trails among them.', { n: Math.round(st.N), k: r.trails });
      words(); views.forEach((v) => v.redraw()); chart.redraw();
    }, () => {});
  }
  function words() {
    const { stats, depth, sky, st } = R, sigma1 = Math.sqrt(sky + READ * READ), N = Math.round(st.N), s = stats.mean.noise || 1;
    ro.replaceChildren(readouts([
      ['A trail per pixel, against the noise of one frame', `${fmt(depth, 3)} e⁻ = ${fmt(depth / sigma1, 3)} σ`],
      ['Light a trail leaves in the mean', `${fmt(depth / N, 3)} e⁻ = ${fmt(depth / N / (sigma1 / Math.sqrt(N)), 3)} σ_stack`],
      ['Noise of the median against the mean', fmt(stats.median.noise / s, 3) + ' ×'],
      ['Noise of the clipped mean against the mean', fmt(stats.clip.noise / s, 3) + ' ×'],
      ['Light left along the trails: mean / median / clipped', `${fmt(stats.mean.trail, 2)} / ${fmt(stats.median.trail, 2)} / ${fmt(stats.clip.trail, 2)} e⁻`],
    ]));
    calc.say(t('A magnitude-{m} satellite deposits <strong>{d} e⁻</strong> per pixel along its trail, {s} times the noise of one frame. Averaged over {N} frames it still leaves {r} e⁻, <strong>{rs} times the noise of the stack</strong>; the median and the clipped mean remove it, the median at the price of {mn} times the noise.', {
      m: fmt(st.mSat, 2), d: fmt(depth, 3), s: fmt(depth / sigma1, 2), N, r: fmt(depth / N, 2), rs: fmt(depth / N / (sigma1 / Math.sqrt(N)), 2), mn: fmt(stats.median.noise / s, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    e_\text{trail} &= F\,\frac{p}{\omega} = ${texNum(depth, 3)}\ e^-\\
    \frac{e_\text{trail}/N}{\sigma/\sqrt N} &= \frac{e_\text{trail}}{\sigma\sqrt N} = ${texNum(depth / (sigma1 * Math.sqrt(N)), 3)}\\
    \sigma_\text{median} &\approx \sqrt{\pi/2}\;\sigma_\text{mean} = 1.25\,\sigma_\text{mean}
    \end{aligned}`);
  }
  // one stretch for all panels: the sky's level black, a few noise widths of one frame white-ish
  function drawPanel(ctx, w, hh, key) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const a = R[key], sky = R.sky, s1 = Math.sqrt(sky + READ * READ), k = 1 / (1.5 * s1);
    const pw = Math.min(w, hh * 1.5), ph = pw / 1.5, st = views[PANELS.findIndex((p) => p[0] === key)];
    paint(st, { x: (w - pw) / 2, y: (hh - ph) / 2, w: pw, h: ph }, (u, v, o) => {
      const x = Math.max(0, bilinear(a, W, H, u * W - 0.5, v * H - 0.5) - sky + 0.3 * s1) * k, g = encode(Math.asinh(x * 3) / Math.asinh(12));
      o[0] = g; o[1] = g; o[2] = Math.min(1, g * 1.05);
    }, keyOf(R));
  }
  function drawChart(ctx, w, hh) {
    if (!R) return;
    const { depth, sky } = R, s1 = Math.sqrt(sky + READ * READ), pts = [], med = [];
    for (let N = 2; N <= 100; N++) { pts.push([N, depth / (s1 * Math.sqrt(N))]); med.push([N, 0]); }
    plot(ctx, w, hh, {
      title: N_('A trail in one frame: what is left in the stack, in units of the stack\'s noise'), x: { min: 2, max: 100, log: true, label: N_('frames in the stack') }, y: { min: 0, max: Math.max(5, pts[0][1] * 1.05), label: N_('trail / noise of the stack') },
      series: [{ data: pts, color: '#ffb547', width: 2, label: N_('mean') }, { data: med, color: '#6be3a4', width: 2, dash: [5, 3], label: N_('median and clipped mean') }],
      hlines: [{ y: 1, color: 'rgba(255,255,255,0.35)', label: N_('as faint as the noise') }], vlines: [{ x: Math.round(R.st.N), color: 'rgba(255,255,255,0.35)', label: '' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[\frac{e_\text{trail}/N}{\sigma/\sqrt N} = \frac{e_\text{trail}}{\sigma\sqrt N}\]
<p>Averaging \(N\) frames divides a trail that is in one of them by \(N\), but the noise only by \(\sqrt N\): the trail sinks below the noise only once \(N > (e_\text{trail}/\sigma)^2\). A trail 10 times the noise of one frame needs more than 100 frames. Rejecting outliers (the median, or better a κσ clip) removes it with almost no loss: the median costs \(\sqrt{\pi/2} = 1.25\) times the noise for many frames, a 3σ clip only a few per cent.</p>`,
    String.raw`For trails present in a small share of the frames at each pixel, and Gaussian noise. With many satellites crossing the same pixels in many frames, or very faint trails close to the noise, clipping removes less; real stacking also aligns frames, which spreads a trail's position.`));
  root.append(theory('Rejecting outliers', String.raw`
<div class="theory-cols"><div>
<h3>A trail's brightness</h3>
<p>A satellite of magnitude \(m\) delivers the same flux \(F\) as a star of that magnitude, \(F = Z\,10^{-0.4m}\,\pi(D/2)^2 q\). Moving at angular speed \(\omega\) (about 0.8°/s for a satellite 550 km up near the zenith), it crosses a pixel of angular size \(p\) in \(p/\omega\) and deposits \(F\,p/\omega\) there: for 3″ pixels, 18 ms of its light. A star of the same magnitude collects \(F\,t\) during the whole exposure, so trails are much fainter per pixel than the star would be, but still far brighter than faint nebulae.</p>
<h3>Mean and median</h3>
<p>The mean of \(N\) values has noise \(\sigma/\sqrt N\) and keeps a fraction \(1/N\) of a one-frame outlier. The median ignores a minority of outliers entirely; for normally distributed values its variance is \(\pi\sigma^2/(2N)\) for large \(N\), so it is \(\sqrt{\pi/2}\) times noisier (it uses only the order of the values, not their size).</p>
</div><div>
<h3>κσ clipping</h3>
<p>For each pixel the laboratory finds the median and a robust spread \(\sigma = 1.4826\,\mathrm{MAD}\) (the median absolute deviation, which equals σ for normal noise and is not inflated by the outliers), drops values more than \(\kappa\sigma\) from the median and averages the rest. For normal noise and \(\kappa = 3\) only 0.3 % of good values are lost, so the noise stays within a few per cent of the mean's; trails a few σ above the sky are removed.</p>
<h3>What the laboratory does</h3>
<p>It makes the frames of a faint galaxy and stars through an 80 mm refractor with 3″ pixels (the stacking laboratory's photometry), adds sky and read noise, drops satellite trails into frames at random (a Poisson number per frame, random position and direction, Gaussian profile), and combines them three ways. The noise is measured in empty sky, the residual along the trails.</p>
</div></div>`));
  root.append(references([
    'C. Walker et al., "Impact of satellite constellations on optical astronomy and recommendations toward mitigations", NOIRLab / AAS report (2020).',
    'J. A. Tyson et al., "Mitigation of LEO satellite brightness and trail effects on the Rubin Observatory LSST", Astron. J. 160, 226 (2020).',
    'P. J. Rousseeuw &amp; C. Croux, "Alternatives to the median absolute deviation", J. Am. Stat. Assoc. 88, 1273 (1993).',
    'A. M. Mood, F. A. Graybill &amp; D. C. Boes, <i>Introduction to the Theory of Statistics</i>, 3rd ed., McGraw-Hill (1974): the variance of the sample median.',
  ]));
  return () => [vOne, vMean, vMedian, vClip, chart].forEach((s) => s.destroy());
}
