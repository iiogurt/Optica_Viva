import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { friedProbability } from '../lib/lucky.js';

const INF = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>The air above a telescope never stops churning, and it blurs stars into fuzzy blobs. But the churning is random, and every so often, for a few thousandths of a second, the air over the telescope happens to be almost calm: a snapshot taken at that moment is nearly as sharp as one from space.</p>
<p><strong>Lucky imaging</strong> records thousands of very short exposures, keeps only the sharpest few per cent, lines them up and adds them together. It works for telescopes a few times wider than the air's calm patches; for larger ones, a perfect moment becomes too rare.</p>`, [
    "Keep <strong>10 %</strong> of the frames and compare the lucky image with the long exposure.",
    "Raise <strong>D/r₀</strong> from 5 to 10: lucky frames become extremely rare.",
    "Change the <strong>Fraction kept</strong> from 1 % to 100 %: keeping every frame turns lucky imaging into plain shift-and-add.",
  ]));

  const ctl = controls({
    Dr0: { type: 'range', label: 'Telescope diameter / Fried parameter D/r₀', min: 2, max: 12, step: 0.1, value: 5 },
    frames: { type: 'range', label: 'Short exposures recorded', min: 40, max: 300, step: 10, value: 120 },
    keep: { type: 'range', label: 'Fraction kept', min: 0.01, max: 1, log: true, value: 0.1, fmt: (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + ' %' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const names = { best: 'Best frame', worst: 'Worst frame', long: 'Long exposure (all frames)', tt: 'Shift-and-add (all frames)', lucky: 'Lucky: best frames, shift-and-add' };
  const views = Object.fromEntries(Object.keys(names).map((k) => [k, stage({ aspect: 1, label: names[k], draw: (c, w, hh) => drawImg(c, w, hh, k), minH: 150 })]));
  const hist = stage({ aspect: 2.2, label: '', draw: drawHist, cls: 'plain', minH: 200 });
  const curve = stage({ aspect: 2.2, label: '', draw: drawCurve, cls: 'plain', minH: 200 });
  const note = h('p.note', {}, 'Simulating frames in the worker…');
  root.append(lab([h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' } }, ...Object.values(views).map((v) => v.el)), note, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, hist.el), h('div.card', { style: { padding: '6px' } }, curve.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('lucky');
  let R = null;
  function update() {
    const st = ctl.state;
    note.textContent = 'Simulating frames in the worker…';
    job('lucky', { Dr0: st.Dr0, frames: Math.round(st.frames), keep: st.keep, Np: 32, N: 64, step: 4, seed: 7 }).then((r) => {
      R = { st: { ...st }, ...r };
      note.textContent = `${Math.round(st.frames)} frames of a ${(32 / st.Dr0).toFixed(1)}-pixel r₀ through a 32-pixel pupil; ${r.nKeep} kept. Images are normalised to the diffraction-limited peak (Strehl).`;
      ro.replaceChildren(readouts([
        ['Strehl: long exposure', r.strehl.long.toFixed(3)],
        ['Strehl: shift-and-add, all frames', r.strehl.tt.toFixed(3)],
        ['Strehl: lucky selection', r.strehl.lucky.toFixed(3)],
        ['Fried probability of a lucky frame', friedProbability(st.Dr0) < 1 ? (100 * friedProbability(st.Dr0)).toFixed(2) + ' %' : '> 100 % (formula valid for D/r₀ ≥ 3.5)'],
      ]));
      calc.say(`Keeping the best ${(st.keep * 100).toFixed(st.keep < 0.1 ? 1 : 0)} % of ${st.frames} short exposures gives a Strehl ratio of <strong>${r.strehl.lucky.toFixed(2)}</strong>, against ${r.strehl.tt.toFixed(2)} for re-centring all frames and ${r.strehl.long.toFixed(3)} for one long exposure.`);
      calc.set(String.raw`\begin{aligned}
      P(\sigma^2_\phi \le 1\,\text{rad}^2) &\approx 5.6\,e^{-0.1557\,(D/r_0)^2}\\
      &= ${texNum(friedProbability(st.Dr0), 3)}\quad(D/r_0 = ${st.Dr0})
      \end{aligned}`);
      [...Object.values(views), hist, curve].forEach((x) => x.redraw());
    });
  }
  function drawImg(ctx, w, hh, key) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const N = R.N, C = 32, a = R[key], ic = imageCanvas(C, C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const v = a[(y + N / 2 - C / 2) * N + x + N / 2 - C / 2], t = Math.round(255 * Math.max(0, Math.min(1, Math.sqrt(v / 0.6)))) * 3, o = (y * C + x) * 4;
      ic.data[o] = INF[t]; ic.data[o + 1] = INF[t + 1]; ic.data[o + 2] = INF[t + 2]; ic.data[o + 3] = 255;
    }
    ic.put();
    const sz = Math.min(w, hh) - 4; ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, (w - sz) / 2, (hh - sz) / 2, sz, sz);
    let pk = 0; for (const v of a) pk = Math.max(pk, v);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillText('S = ' + pk.toFixed(2), 6, hh - 8);
  }
  function drawHist(ctx, w, hh) {
    if (!R) return;
    const bins = 25, mx = Math.max(...R.peaks), cnt = new Array(bins).fill(0);
    for (const p of R.peaks) cnt[Math.min(bins - 1, Math.floor((p / mx) * bins))]++;
    const sorted = [...R.peaks].sort((a, b) => b - a), thr = sorted[R.nKeep - 1];
    const P = plot(ctx, w, hh, { title: 'Distribution of short-exposure Strehl ratios', x: { min: 0, max: mx * 1.02, label: 'peak of the frame (Strehl)' }, y: { min: 0, max: Math.max(...cnt) * 1.1, label: 'frames' }, series: [] });
    cnt.forEach((c, i) => { const x0 = P.X((i / bins) * mx), x1 = P.X(((i + 1) / bins) * mx); ctx.fillStyle = (i + 0.5) / bins * mx >= thr ? '#ffb547' : 'rgba(106,215,255,0.6)'; ctx.fillRect(x0 + 1, P.Y(c), x1 - x0 - 2, P.Y(0) - P.Y(c)); });
  }
  function drawCurve(ctx, w, hh) {
    if (!R) return;
    const ds = Array.from({ length: 60 }, (_, i) => 3 + i * 0.1);
    plot(ctx, w, hh, {
      title: 'Probability of a lucky frame (σ² ≤ 1 rad² after tip-tilt)', x: { min: 3, max: 9, label: 'D / r₀' }, y: { min: 1e-4, max: 1, log: true, label: 'probability' },
      series: [{ data: ds.map((d) => [d, Math.min(1, friedProbability(d))]), color: '#6ad7ff', width: 1.8, dash: [5, 3], label: 'Fried (1978)' }, { data: R.curve.filter((c) => c[1] > 0), color: '#ffb547', width: 0, points: true, r: 4, label: 'simulated (400 frames each)' }],
      vlines: [{ x: R.st.Dr0, color: 'rgba(255,255,255,0.35)' }], legend: true, legendX: w - 230, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[P \approx 5.6\,e^{-0.1557\,(D/r_0)^2}\]
<p>Fried's estimate of the chance that a short exposure has less than 1 rad² of wavefront error, which makes it nearly diffraction-limited. The ratio of the telescope diameter \(D\) to the Fried parameter \(r_0\), the size of the air's calm patches, enters squared in the exponent: at \(D/r_0 = 5\) about 11 % of frames are lucky, at 7 only 0.3 %, and at 10 one in a million. That is why lucky imaging suits 1–2.5 m telescopes in visible light, or larger ones in the infrared, where \(r_0\) is bigger.</p>`,
    String.raw`Fried's formula is an asymptotic fit, valid for \(D/r_0\) above about 3.5 (below that it exceeds 100 %). It counts only the wavefront variance; the sharp region also shrinks to a small patch of sky around the guide star, and recording the frames needs fast cameras with very low read noise.`));
  root.append(theory('Short exposures and luck', String.raw`
<div class="theory-cols"><div>
<h3>Why short exposures help</h3>
<p>A long exposure averages many independent realisations of turbulence, blurring a star to the seeing disk of width \(\approx\lambda/r_0\). An exposure shorter than the coherence time \(\tau_0 = 0.314\,r_0/v\) (a few milliseconds) freezes one realisation. Its image is a speckle pattern whose overall position wanders with the wavefront tilt. Re-centring every frame on its brightest speckle ("shift-and-add") removes that wander. Keeping only the frames whose residual wavefront is nearly flat does much better.</p>
<h3>Fried's probability</h3>
<p>Treating the residual (tip-tilt-removed) wavefront as a sum of random modes, Fried (1978) estimated the probability that its variance is below 1 rad², which gives a nearly diffraction-limited frame, as</p>
\[P \approx 5.6\,\exp\!\left[-0.1557\left(\frac{D}{r_0}\right)^2\right],\qquad D/r_0 \gtrsim 3.5.\]
<p>The probability collapses for large telescopes: about 1 in 10 frames at \(D/r_0 = 5\), and 1 in a million at \(D/r_0 = 10\). Lucky imaging therefore suits 1–2.5 m telescopes in the red and near-infrared, or larger ones behind low-order adaptive optics. The simulation counts lucky frames in Kolmogorov phase screens. It falls slightly below Fried's asymptotic formula at small \(D/r_0\) but follows its exponential slope, which the test suite checks.</p>
</div><div>
<h3>What the page computes</h3>
<p>One large von Kármán phase screen (outer scale effectively infinite) is cut by a 32-pixel pupil at positions displaced by frozen-flow wind between frames. For every frame the tip-tilt-removed variance is measured and the short-exposure PSF is computed by FFT. The peak, normalised to a perfect pupil, is the frame's Strehl ratio and serves as the selection criterion. The selected frames are re-centred on their peaks and averaged. Photon noise, detector read noise and the anisoplanatism of real fields are not modelled; with them, the selection must use a reference star bright enough to measure each frame's quality.</p>
</div></div>`));
  root.append(references([
    'D. L. Fried, “Probability of getting a lucky short-exposure image through turbulence”, <em>J. Opt. Soc. Am.</em> 68, 1651 (1978).',
    'N. M. Law, C. D. Mackay &amp; J. E. Baldwin, “Lucky imaging: high angular resolution imaging in the visible from the ground”, <em>Astron. Astrophys.</em> 446, 739 (2006).',
    'R. N. Tubbs, <em>Lucky Exposures</em>, PhD thesis, University of Cambridge (2003).',
  ]));

  return () => [...Object.values(views), hist, curve].forEach((x) => x.destroy());
}
