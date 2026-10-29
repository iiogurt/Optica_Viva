import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot, logRange } from '../lib/plot.js';
import { snr, dynamicRange } from '../lib/hdr.js';
import { t } from '../lib/i18n.js';

const CAMS = {
  ff: { name: 'Full-frame CMOS (FWC 50 000 e⁻, read 3 e⁻)', k: 1000, fwc: 50000, read: 3, bits: 14 },
  aps: { name: 'APS-C, dual-gain (FWC 25 000 e⁻, read 1.5 e⁻)', k: 500, fwc: 25000, read: 1.5, bits: 14 },
  phone: { name: 'Phone sensor (FWC 6000 e⁻, read 2 e⁻)', k: 120, fwc: 6000, read: 2, bits: 12 },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A sunset can be a million times brighter near the sun than in the deepest shadows, while a camera sensor records a range of only a few thousand to one in a single shot. Expose for the sky and the shadows turn black; expose for the shadows and the sky turns white.</p>
<p>There are two ways out. A <strong>graduated filter</strong>, dark at the top and clear at the bottom, holds back the bright sky before the light reaches the sensor. Or you take several photos at different exposures, a <strong>bracket</strong>, and merge them, using the dark frames for the highlights and the bright ones for the shadows.</p>`, [
    "Set <strong>Bracketed frames</strong> to 1: the sky clips or the shadows drown in noise. Then try 3 and 5 frames.",
    "With a single frame, add 3 stops of <strong>Graduated ND</strong> and move its transition to the horizon.",
    "With 3 frames, change the <strong>Bracket step</strong> from 2 to 1 EV: the merged range shrinks by 2 stops.",
  ]));

  const ctl = controls({
    cam: { type: 'select', label: 'Sensor', value: 'ff', options: Object.entries(CAMS).map(([k, c]) => [k, c.name]) },
    ev0: { type: 'range', label: 'Base exposure (EV above 1/250 s)', min: -6, max: 10, step: 0.5, value: 5 },
    n: { type: 'seg', label: 'Bracketed frames', value: '3', options: ['1', '3', '5', '7'] },
    step: { type: 'range', label: 'Bracket step', min: 0.5, max: 3, step: 0.5, value: 2, unit: 'EV' },
    gnd: { type: 'range', label: 'Graduated ND over the sky', min: 0, max: 5, step: 0.5, value: 0, unit: 'stops' },
    gy: { type: 'range', label: 'Graduated ND transition height', min: 0.3, max: 0.8, step: 0.01, value: 0.55 },
    gw: { type: 'range', label: 'Transition width (0 = hard edge)', min: 0, max: 0.4, step: 0.01, value: 0.15 },
    fusion: { type: 'toggle', label: 'Compute exposure fusion', value: true },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const shot = stage({ aspect: 16 / 9, label: 'Middle exposure, as shot', draw: (c, w, hh) => drawImg(c, w, hh, 'shot'), minH: 160 });
  const merged = stage({ aspect: 16 / 9, label: 'Merged radiance, tone-mapped (Reinhard)', draw: (c, w, hh) => drawImg(c, w, hh, 'merged'), minH: 160 });
  const fused = stage({ aspect: 16 / 9, label: 'Exposure fusion (Mertens, Laplacian pyramids)', draw: (c, w, hh) => drawImg(c, w, hh, 'fused'), minH: 160 });
  const snrPlot = stage({ aspect: 1.9, label: '', draw: drawSNR, cls: 'plain', minH: 200 });
  const note = h('p.note', {}, '');
  root.append(lab([h('div.grid-2', {}, shot.el, merged.el), h('div.grid-2', {}, fused.el, h('div.card', { style: { padding: '6px' } }, snrPlot.el)), note], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('hdr');
  let R = null;
  const params = (st, W) => ({ W, H: Math.round((W * 9) / 16), cam: CAMS[st.cam], ev0: st.ev0, n: +st.n, step: st.step, grad: st.gnd > 0 ? { stops: st.gnd, y0: st.gy, w: st.gw } : null, nd: 0, fusion: st.fusion });
  function update() {
    const st = ctl.state, cam = CAMS[st.cam], n = +st.n, t0 = Math.pow(2, st.ev0) / 250, times = Array.from({ length: n }, (_, i) => t0 * Math.pow(2, (i - (n - 1) / 2) * st.step));
    const dr1 = dynamicRange([t0], cam), dr = dynamicRange(times, cam);
    ro.replaceChildren(readouts([
      ['Exposure times', times.map((t) => (t >= 1 ? t.toFixed(1) + ' s' : '1/' + Math.round(1 / t))).join(', ')],
      ['Single-frame dynamic range (SNR ≥ 1)', dr1.toFixed(1) + ' EV'],
      ['Bracket dynamic range', dr.toFixed(1) + ' EV (+' + (dr - dr1).toFixed(1) + ')'],
      ['Graduated ND: OD', st.gnd ? (st.gnd / Math.log2(10)).toFixed(2) + ` (${st.gnd} stops)` : '—'],
    ]));
    calc.say(`One frame of this sensor records <strong>${dr1.toFixed(1)} stops</strong>; the bracket of ${st.n} frame${st.n === '1' ? '' : 's'} covers <strong>${dr.toFixed(1)} stops</strong>` + (st.gnd ? `, and the graduated filter holds the sky back by ${st.gnd} more.` : '.') + ' The scene spans about 20 stops.' );
    calc.set(String.raw`\begin{aligned}
    S_{\mathrm{SNR}=1} &= \tfrac12\left(1+\sqrt{1+4\sigma_r^2}\right) = ${texNum((1 + Math.sqrt(1 + 4 * cam.read ** 2)) / 2, 3)}\ e^-\\
    \mathrm{DR} &= \log_2\frac{S_\text{FWC}}{S_{\mathrm{SNR}=1}} = ${texNum(dr1, 3)}\ \text{EV}\\
    w_i &= \frac{t_i^2}{S_i+\sigma_r^2}\quad(\text{inverse variance})
    \end{aligned}`);
    snrPlot.redraw();
    job('hdr', params(st, 192)).then((r) => { R = r; draw(); return job('hdr', params(st, 384)); }).then((r) => { if (r) { R = r; draw(); } });
  }
  function draw() {
    ['shot', 'merged', 'fused'].forEach((k) => { if (R) R['c_' + k] = null; });
    [shot, merged, fused].forEach((x) => x.redraw());
    note.textContent = R ? `Middle frame: ${(100 * R.clipFrac).toFixed(1)} % of pixels clipped, ${(100 * R.darkFrac).toFixed(0)} % below 10 × the read noise. ${R.W}×${R.H} px, computed in the worker.` : '';
  }
  function drawImg(ctx, w, hh, key) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R || !R[key]) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px Inter, sans-serif'; ctx.fillText(key === 'fused' ? t('needs ≥ 3 frames and fusion on') : '…', 12, 22); return; }
    if (!R['c_' + key]) {
      const ic = imageCanvas(R.W, R.H), a = R[key];
      for (let p = 0; p < R.W * R.H; p++) { for (let c = 0; c < 3; c++) ic.data[p * 4 + c] = 255 * a[p * 3 + c]; ic.data[p * 4 + 3] = 255; }
      ic.put(); R['c_' + key] = ic.c;
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(R['c_' + key], 0, 0, w, hh);
    if (key === 'shot' && ctl.state.gnd > 0) { const y = ctl.state.gy * hh; ctx.strokeStyle = 'rgba(255,181,71,0.6)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]); }
  }
  function drawSNR(ctx, w, hh) {
    const st = ctl.state, cam = CAMS[st.cam], n = +st.n, t0 = Math.pow(2, st.ev0) / 250, times = Array.from({ length: n }, (_, i) => t0 * Math.pow(2, (i - (n - 1) / 2) * st.step));
    const xs = logRange(1e-2, 1e6, 260);
    plot(ctx, w, hh, {
      title: 'SNR of the radiance estimate vs scene radiance', x: { min: 1e-2, max: 1e6, log: true, label: 'scene radiance (foreground ≈ 1, sun ≈ 10⁵)' }, y: { min: 0.3, max: 1000, log: true, label: 'SNR' },
      series: [
        ...times.map((t, i) => ({ data: xs.map((x) => [x, Math.max(0.3, snr(x, [t], cam))]), color: 'rgba(255,255,255,0.3)', width: 1, dash: [3, 3], label: i === 0 ? 'single frames' : undefined })),
        { data: xs.map((x) => [x, Math.max(0.3, snr(x, times, cam))]), color: '#ffb547', width: 2.2, label: 'merged (inverse-variance)' },
      ],
      bands: [{ x: [0.09, 4], color: 'rgba(106,215,255,0.07)' }, { x: [60, 1500], color: 'rgba(255,181,71,0.07)' }],
      legend: true, legendX: 70, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[\mathrm{DR}_\text{bracket} \approx \mathrm{DR}_1 + (n-1)\,\Delta\]
<p>Each extra frame in a bracket, spaced \(\Delta\) stops apart, adds \(\Delta\) stops to the range you can record. A sensor with 12 stops of single-frame dynamic range, bracketed with 3 frames 2 stops apart, covers 16 stops; 5 frames cover 20, enough for most sunsets. Every stop doubles the light, so 20 stops is a contrast of a million to one.</p>`,
    String.raw`It assumes nothing moves between the frames; wind, water and people leave ghosts in the merge. Steps much larger than 2–3 stops leave noisy gaps, and the result must still be compressed into the few stops a screen or print can show, which is the job of tone mapping.`));
  root.append(theory('Capturing more stops than the sensor has', String.raw`
<div class="theory-cols"><div>
<h3>Dynamic range of one exposure</h3>
<p>A pixel collects \(S = L\,k\,t\) photoelectrons. Its noise is the shot noise \(\sqrt S\) plus read noise \(\sigma_r\), and it clips at the full-well capacity. The engineering dynamic range runs from the signal with SNR = 1, where \(S^2 = S + \sigma_r^2\), to the full well:</p>
\[\mathrm{DR} = \log_2\frac{S_\text{FWC}}{\tfrac12\left(1+\sqrt{1+4\sigma_r^2}\right)}.\]
<p>Modern full-frame sensors reach about 14 EV, phone sensors about 11. A sunset with the sun in frame spans 20 (the shaded bands in the plot: foreground and sky).</p>
<h3>Filters</h3>
<p>A neutral-density filter of optical density OD transmits \(10^{-\mathrm{OD}}\), that is \(3.32\,\mathrm{OD}\) stops. A graduated ND darkens only the sky. Its transition must follow the horizon: a hard edge suits a flat sea, while a soft edge hides the line but darkens mountain tops that cross it. Filters improve the photon budget itself: the foreground gets the full exposure without the sky clipping.</p>
</div><div>
<h3>Merging a bracket</h3>
<p>Each frame \(i\) estimates the radiance as \(S_i/(k t_i)\) with variance \((S_i+\sigma_r^2)/(k t_i)^2\). The minimum-variance combination weights each unclipped estimate by the inverse of that variance,</p>
\[\hat L = \frac{\sum_i w_i\,S_i/(kt_i)}{\sum_i w_i},\qquad w_i = \frac{t_i^2}{S_i+\sigma_r^2},\qquad \mathrm{SNR}^2 = \sum_i \mathrm{SNR}_i^2,\]
<p>which is the orange curve. A bracket of \(n\) frames \(\Delta\) EV apart extends the range by \((n-1)\Delta\). The merged radiance must then be tone-mapped for display, here with Reinhard's global operator \(L_d = L_s/(1+L_s)\) on the log-average key. Motion between frames (wind, people) must be handled separately and is not simulated here.</p>
<h3>Exposure fusion</h3>
<p>Mertens, Kautz and Van Reeth skip the radiance map. Each output pixel is a weighted blend of the display-referred frames, with weights favouring contrast, saturation and mid-tones. Blending the Laplacian pyramids of the frames with the Gaussian pyramids of the weights avoids seams. The result looks natural but has no physical radiance scale.</p>
</div></div>`));
  root.append(references([
    'P. E. Debevec &amp; J. Malik, “Recovering high dynamic range radiance maps from photographs”, <em>SIGGRAPH</em> (1997).',
    'T. Mertens, J. Kautz &amp; F. Van Reeth, “Exposure fusion”, <em>Pacific Graphics</em> (2007); P. J. Burt &amp; E. H. Adelson, “The Laplacian pyramid as a compact image code”, <em>IEEE Trans. Commun.</em> 31, 532 (1983).',
    'E. Reinhard, M. Stark, P. Shirley &amp; J. Ferwerda, “Photographic tone reproduction for digital images”, <em>ACM Trans. Graph.</em> 21, 267 (2002).',
    'S. W. Hasinoff, F. Durand &amp; W. T. Freeman, “Noise-optimal capture for high dynamic range photography”, <em>CVPR</em> (2010).',
  ]));

  return () => [shot, merged, fused, snrPlot].forEach((x) => x.destroy());
}
