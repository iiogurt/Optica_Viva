import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { BORTLE, surfaceRate, stackSNR, skyLimitedSub, galaxyRate, stackImage } from '../lib/stacking.js';

const fmtT = (t) => (t >= 3600 ? (t / 3600).toFixed(1) + ' h' : t >= 60 ? (t / 60).toFixed(t < 600 ? 1 : 0) + ' min' : t.toFixed(t < 10 ? 1 : 0) + ' s');

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'A faint galaxy may be a hundred times fainter than the sky it sits in. Deep astrophotographs are therefore built from many sub-exposures that are calibrated, aligned and averaged. How long each sub should be, how much total time is needed, and what light pollution costs all follow from one equation for signal and noise.', domains: ['space', 'photo'] }));

  const ctl = controls({
    D: { type: 'range', label: 'Telescope aperture', min: 5, max: 40, log: true, value: 20, unit: 'cm' },
    p: { type: 'range', label: 'Pixel scale', min: 0.5, max: 6, log: true, value: 1.5, unit: '″/px' },
    bortle: { type: 'range', label: 'Sky (Bortle class)', min: 1, max: 9, step: 1, value: 4, fmt: (v) => `${v} · ${BORTLE[v].toFixed(1)} mag/″²` },
    mu: { type: 'range', label: 'Galaxy surface brightness (centre)', min: 18, max: 26, step: 0.1, value: 22, unit: 'mag/″²' },
    t: { type: 'range', label: 'Sub-exposure length', min: 1, max: 900, log: true, value: 120, fmt: fmtT },
    T: { type: 'range', label: 'Total integration', min: 300, max: 72000, log: true, value: 3 * 3600, fmt: fmtT },
    sigma: { type: 'range', label: 'Read noise', min: 0.8, max: 12, step: 0.1, value: 3, unit: 'e⁻' },
    dark: { type: 'range', label: 'Dark current', min: 0.0005, max: 0.2, log: true, value: 0.005, unit: 'e⁻/s' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const single = stage({ aspect: 1, label: 'One sub-exposure (sky subtracted, same stretch)', draw: (c, w, hh) => drawImg(c, w, hh, 'one'), minH: 220 });
  const stack = stage({ aspect: 1, label: 'Stack of all sub-exposures', draw: (c, w, hh) => drawImg(c, w, hh, 'stack'), minH: 220 });
  const subPlot = stage({ aspect: 2.2, label: '', draw: drawSub, cls: 'plain', minH: 210 });
  const totPlot = stage({ aspect: 2.2, label: '', draw: drawTot, cls: 'plain', minH: 210 });
  root.append(lab([h('div.grid-2', {}, single.el, stack.el), h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, subPlot.el), h('div.card', { style: { padding: '6px' } }, totPlot.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  const QE = 0.5, W = 160;
  function update() {
    const st = ctl.state, Fs = surfaceRate(BORTLE[st.bortle], st.D, st.p, QE), Fo = surfaceRate(st.mu + 2.5 * Math.LOG10E, st.D, st.p, QE); // one scale length out: e⁻¹ = +1.086 mag
    const N = Math.max(1, Math.round(st.T / st.t)), snr = stackSNR(Fo, Fs, st.dark, st.sigma, st.t, N), snr1 = stackSNR(Fo, Fs, st.dark, st.sigma, st.t, 1);
    const tsky = skyLimitedSub(Fs, st.sigma), rate = galaxyRate(W, W, st.p, st.D, QE, st.mu, 30);
    M = { st, Fs, Fo, N, rate, one: stackImage(rate, Fs, st.dark, st.sigma, st.t, 1, 1), stack: stackImage(rate, Fs, st.dark, st.sigma, st.t, N, 2), sub: null, c: {} };
    const ideal = (Fo * N * st.t) / Math.sqrt(N * (Fo + Fs) * st.t);
    ro.replaceChildren(readouts([
      ['Sky per pixel', Fs.toFixed(2) + ' e⁻/s'],
      ['Galaxy one scale length out', Fo.toFixed(3) + ' e⁻/s (' + (100 * Fo / Fs).toFixed(1) + ' % of the sky)'],
      ['Sub-exposures', `${N} × ${fmtT(st.t)}`],
      ['SNR per pixel: one sub · stack', `${snr1.toFixed(2)} · ${snr.toFixed(1)}`],
      ['Read noise costs', ((1 - snr / ideal) * 100).toFixed(1) + ' % of the SNR'],
      ['Sky-limited from (σ_r² = 0.1 F_sky t)', fmtT(tsky)],
    ]));
    calc.set(String.raw`\begin{aligned}
    \mathrm{SNR} &= \frac{F_o N t}{\sqrt{N\left[(F_o+F_s+F_d)\,t+\sigma_r^2\right]}} = ${texNum(snr, 3)}\\
    t_\text{sky} &= \frac{\sigma_r^2}{0.1\,F_s} = ${texNum(tsky, 3)}\ \text{s}
    \end{aligned}`);
    [single, stack, subPlot, totPlot].forEach((x) => x.redraw());
  }
  function drawImg(ctx, w, hh, key) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    if (!M.c[key]) {
      const a = M[key], ic = imageCanvas(W, W), scale = M.rate[(W / 2) * W + W / 2] * M.st.t * 0.6; // same stretch for both
      for (let k = 0; k < W * W; k++) { const v = Math.asinh(Math.max(-1, a[k] / scale) * 3) / Math.asinh(3), g = 255 * Math.max(0, Math.min(1, 0.06 + 0.94 * v)), o = k * 4; ic.data[o] = g; ic.data[o + 1] = g * 0.97; ic.data[o + 2] = g * 1; ic.data[o + 3] = 255; }
      ic.put(); M.c[key] = ic.c;
    }
    const sz = Math.min(w, hh) - 4; ctx.imageSmoothingEnabled = true; ctx.drawImage(M.c[key], (w - sz) / 2, (hh - sz) / 2, sz, sz);
  }
  function drawSub(ctx, w, hh) {
    if (!M) return;
    const st = M.st, ts = logRange(1, 900, 80);
    plot(ctx, w, hh, {
      title: `SNR after ${fmtT(st.T)} vs sub-exposure length`, x: { min: 1, max: 900, log: true, label: 'sub-exposure (s)' }, y: { min: 0, max: 1.1, label: 'SNR / SNR without read noise' },
      series: [1, 4, 7, 9].map((b, i) => { const Fs = surfaceRate(BORTLE[b], st.D, st.p, QE); return { data: ts.map((t) => { const N = Math.max(1, Math.round(st.T / t)); return [t, stackSNR(M.Fo, Fs, st.dark, st.sigma, t, N) / ((M.Fo * N * t) / Math.sqrt(N * (M.Fo + Fs + st.dark) * t))]; }), color: ['#6be3a4', '#6ad7ff', '#ffb547', '#ff6b6b'][i], width: b === st.bortle ? 2.4 : 1.3, label: `Bortle ${b}` }; }),
      vlines: [{ x: st.t, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: w - 130, legendY: hh - 110,
    });
  }
  function drawTot(ctx, w, hh) {
    if (!M) return;
    const st = M.st, Ts = logRange(300, 72000, 60);
    plot(ctx, w, hh, {
      title: 'SNR per pixel vs total integration', x: { min: 300, max: 72000, log: true, label: 'total time (s)' }, y: { min: 0.05, max: 200, log: true, label: 'SNR' },
      series: [1, 4, 7, 9].map((b, i) => { const Fs = surfaceRate(BORTLE[b], st.D, st.p, QE); return { data: Ts.map((T) => [T, stackSNR(M.Fo, Fs, st.dark, st.sigma, st.t, Math.max(1, Math.round(T / st.t)))]), color: ['#6be3a4', '#6ad7ff', '#ffb547', '#ff6b6b'][i], width: b === st.bortle ? 2.4 : 1.3, label: `Bortle ${b}` }; }),
      vlines: [{ x: st.T, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: 70, legendY: 34,
    });
  }

  update();

  root.append(theory('Signal, noise and the night sky', String.raw`
<div class="theory-cols"><div>
<h3>The CCD equation for a stack</h3>
<p>Each pixel collects electrons from the object (\(F_o\)), the sky (\(F_s\)) and the dark current (\(F_d\)), all Poisson-distributed, plus read noise \(\sigma_r\) once per read. Averaging \(N\) sub-exposures of length \(t\) gives</p>
\[\mathrm{SNR} = \frac{F_o N t}{\sqrt{N\left[(F_o+F_s+F_d)\,t+\sigma_r^2\right]}}.\]
<p>Once \(F_s t \gg \sigma_r^2\), the stack equals one long exposure and the SNR grows as \(\sqrt{Nt}\), the square root of total time. With σ_r² = 0.1 F_s t, read noise costs about 5 % of the SNR. That defines the shortest sensible sub-exposure, \(t_\text{sky} = 10\sigma_r^2/F_s\): seconds under city skies, minutes under dark ones, and longer for narrow-band filters, which cut the sky. Longer subs gain little and lose more to satellites, wind and saturated stars.</p>
</div><div>
<h3>The cost of light pollution</h3>
<p>For a faint object, \(F_o \ll F_s\) and \(\mathrm{SNR}\approx F_o\sqrt{T/F_s}\). Each magnitude per square arcsecond of brighter sky multiplies \(F_s\) by 2.5, so the same SNR needs 2.5 times longer. From a Bortle 4 suburb (21.3 mag/″²) to a Bortle 8 city (18.9) the factor is about 9, and a galaxy disk at 24 mag/″² is then 1 % of the sky. The sky brightness is converted with a V-band zero point of 10⁶ photons s⁻¹ cm⁻² (100 nm band), a quantum efficiency × throughput of 0.5 and the pixel's solid angle. The image is the expected stack plus Gaussian noise of the exact variance. Flat-fielding, alignment, outlier rejection and colour are assumed perfect.</p>
</div></div>`));
  root.append(references([
    'S. B. Howell, <em>Handbook of CCD Astronomy</em>, 2nd ed., Cambridge University Press (2006): the CCD equation.',
    'J. E. Bortle, “Introducing the Bortle dark-sky scale”, <em>Sky &amp; Telescope</em> 101(2), 126 (2001).',
    'R. Glover, “Sub-exposure times and signal-to-noise ratio for astrophotography”, technical note (2009); C. Woodhouse, <em>The Astrophotography Manual</em>, 2nd ed. (2017).',
  ]));

  return () => [single, stack, subPlot, totPlot].forEach((x) => x.destroy());
}
