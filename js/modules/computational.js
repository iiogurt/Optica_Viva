// Computational photography: night mode, burst super-resolution and synthetic portrait blur.
import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { burst, portrait } from '../lib/computational.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A phone's tiny sensor collects little light, yet its night photos look clean and sharp. The trick is to take many short photos instead of one long one: each is sharp because there is no time for the hand to shake, and averaging them lowers the noise almost as much as one long exposure would.</p>
<p>The hand's tiny movements even help: each frame lands on the pixel grid at a slightly different place, so together they record detail finer than one pixel. The blurry background of "portrait mode" is also computed: the phone estimates how far away every part of the picture is and blurs the far parts, which fails where the depth guess is coarse, around hair.</p>`, [
    'Set <strong>Frames</strong> to 1, then 16: the burst average becomes as clean as the long exposure, without its shake.',
    'Compare the burst average with the <strong>super-resolution</strong> merge on the finest bars.',
    'Make the <strong>depth map</strong> coarser: the hair around the head gets blurred away and a halo appears.',
  ]));

  const ctl = controls({
    h1: { type: 'heading', label: 'Night mode and super-resolution' },
    N: { type: 'range', label: 'Frames in the burst', min: 1, max: 32, step: 1, value: 8 },
    photons: { type: 'range', label: 'Light per frame (photons per pixel, white)', min: 2, max: 200, log: true, value: 20, fmt: (v) => Math.round(v) },
    sigma: { type: 'range', label: 'Read noise', min: 0.5, max: 5, step: 0.1, value: 2, unit: 'e⁻' },
    shake: { type: 'range', label: 'Hand shake during the long exposure', min: 0, max: 4, step: 0.25, value: 1.5, unit: 'px' },
    h2: { type: 'heading', label: 'Portrait mode' },
    blur: { type: 'range', label: 'Background blur', min: 2, max: 14, step: 0.5, value: 7, unit: 'px' },
    coarse: { type: 'range', label: 'Depth map coarseness', min: 1, max: 16, step: 1, value: 8, fmt: (v) => (v === 1 ? 'full resolution' : '1/' + v) },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const night = stage({ aspect: 4, label: 'Night mode and burst super-resolution', draw: drawNight, minH: 220 });
  const port = stage({ aspect: 3, label: 'Portrait mode', draw: drawPortrait, minH: 220 });
  root.append(lab([night.el, port.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let B = null, P = null;
  function update() {
    const st = ctl.state, s = 4;
    B = burst({ N: st.N, photons: st.photons, sigma: st.sigma, shake: st.shake * s });
    P = portrait({ blur: st.blur, coarse: st.coarse });
    const pr = B.predicted;
    ro.replaceChildren(readouts([
      ['SNR of mid grey: one short frame', pr.single.toFixed(1)],
      [`SNR: burst of ${st.N}`, pr.burst.toFixed(1)],
      ['SNR: one long exposure (same light)', pr.long.toFixed(1)],
      ['Burst penalty (read noise per frame)', ((1 - pr.burst / pr.long) * 100).toFixed(0) + ' %'],
      ['Long exposure smeared by', st.shake.toFixed(2) + ' px'],
      ['Depth map wrong on', P.wrongPct.toFixed(1) + ' % of the pixels'],
    ]));
    calc.say(`Merging ${st.N} short frames raises the signal-to-noise ratio from <strong>${pr.single.toFixed(1)}</strong> to <strong>${pr.burst.toFixed(1)}</strong>, ${((pr.burst / pr.long) * 100).toFixed(0)} % of what one long exposure would give, but without its ${st.shake.toFixed(1)} px of shake. With a 1/${st.coarse} depth map, ${P.wrongPct.toFixed(1)} % of the portrait is blurred or kept sharp by mistake.`);
    calc.set(String.raw`\begin{aligned}
    \mathrm{SNR}_N &= \frac{N S}{\sqrt{N\,(S + \sigma_r^2)}} = \sqrt{N}\,\mathrm{SNR}_1\\
    \mathrm{SNR}_\text{long} &= \frac{N S}{\sqrt{N S + \sigma_r^2}}
    \end{aligned}`);
    night.redraw(); port.redraw();
  }

  const show = (ctx, img, iw, ih, x, y, side, range = [0, 1]) => {
    const ic = imageCanvas(iw, ih);
    for (let k = 0; k < iw * ih; k++) { const v = Math.max(0, Math.min(1, (img[k] - range[0]) / (range[1] - range[0]))) ** (1 / 2.2) * 255; ic.data[4 * k] = v; ic.data[4 * k + 1] = v; ic.data[4 * k + 2] = v; ic.data[4 * k + 3] = 255; }
    ic.put();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ic.c, x, y, side, side);
  };
  function drawNight(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!B) return;
    const gap = 10, side = Math.min((w - 5 * gap) / 4, hh - 50), y = 44;
    [[B.single, B.m], [B.long, B.m], [B.avg, B.m], [B.sr, B.M]].forEach(([img, m], k) => show(ctx, img, m, m, gap + k * (side + gap), y, side));
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ['1 short frame', '1 long, shaken', `average of ${ctl.state.N}`, `super-resolution of ${ctl.state.N}`].forEach((t, k) => ctx.fillText(t, gap + k * (side + gap), 38));
  }
  function drawPortrait(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!P) return;
    const gap = 10, side = Math.min((w - 4 * gap) / 3, hh - 50), y = 44;
    [P.optical, P.synthetic, P.sharp].forEach((img, k) => show(ctx, img, P.n, P.n, gap + k * (side + gap), y, side));
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ['real optics (true depth)', `computed (depth map 1/${ctl.state.coarse})`, 'the photo before blurring'].forEach((t, k) => ctx.fillText(t, gap + k * (side + gap), 38));
  }

  update();

  root.append(rule(String.raw`\[\mathrm{SNR}_N = \sqrt{N}\;\mathrm{SNR}_1\]
<p>Averaging \(N\) aligned frames improves the signal-to-noise ratio by \(\sqrt N\) as long as photon noise dominates: 16 frames are 4 times cleaner, as good as one exposure 16 times longer but free of its shake. Each frame adds its own read noise, so in very dim light a burst falls a little behind a single long exposure: with 20 photons per white pixel and 2 e⁻ of read noise, 8 frames reach 87 % of its signal-to-noise ratio.</p>`,
    String.raw`It assumes perfect alignment and a still scene; real merges reject moving parts, which costs some of the gain there, and alignment errors blur fine detail. Super-resolution also needs the shifts to be spread over the pixel and the lens to resolve detail finer than a pixel.`));

  root.append(theory('How the images are made', String.raw`
<div class="theory-cols"><div>
<h3>Bursts</h3>
<p>A high-resolution test target (a Siemens star and bars down to 2 target pixels) is sampled by pixels four target pixels wide, each frame offset by a random sub-pixel shift as hand tremor would produce. Every pixel collects Poisson photons (\(S\) per white pixel) plus Gaussian read noise \(\sigma_r\). The average aligns the frames to whole pixels and averages; the super-resolution merge places every sample at its true sub-pixel position on a grid twice as fine and averages what lands in each cell, as burst methods do with their estimated motion. The long exposure collects the same total light in one frame, smeared by the hand's motion.</p>
</div><div>
<h3>Portrait mode</h3>
<p>A head with fine hair strands stands at 2 m before a background of lights. Real optics blur only the background, pixel by pixel. The computed version starts from the sharp photo and a depth map at reduced resolution (as from stereo pixels or a neural network), thresholds it into subject and background, and blurs everything marked as background, including the sharp hair strands it misses, which turns into halos and smeared edges.</p>
<div class="callout">Phones refine their depth maps with image-guided filters and segmentation, which reduces but does not remove these errors; the simulation shows the raw effect of a coarse map.</div>
</div></div>`));
  root.append(references([
    'S. W. Hasinoff et al., "Burst photography for high dynamic range and low-light imaging on mobile cameras", ACM Trans. Graph. 35(6), 192 (2016).',
    'B. Wronski et al., "Handheld multi-frame super-resolution", ACM Trans. Graph. 38(4), 28 (2019).',
    'N. Wadhwa et al., "Synthetic depth-of-field with a single-camera mobile phone", ACM Trans. Graph. 37(4), 64 (2018).',
  ]));
}
