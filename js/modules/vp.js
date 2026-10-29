import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { moire, renderWall, bandProfile, bandAmplitude } from '../lib/virtual.js';
import { t } from '../lib/i18n.js';

const D2R = Math.PI / 180;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video'] }));
  root.append(idea(String.raw`<p>In virtual production the background is a giant LED screen, filmed directly by the camera, like a vast television showing the set. The screen is built from a grid of tiny lights, and the camera's sensor is a grid of pixels too. When the two grids nearly line up, they interfere and create wavy false patterns across the wall: <strong>moiré</strong>.</p>
<p>The usual cure is to keep the wall slightly out of focus, so its grid blurs before it reaches the sensor. The wall's lights also flicker very fast to set their brightness, and a camera that reads its picture line by line can turn that flicker into horizontal bands.</p>`, [
    "Set the focus distance equal to the wall distance: the grid is sharp and the pattern strongest. Then focus back on the actor at 3 m.",
    "Open the aperture from T2.8 to <strong>T1.4</strong>: more defocus blur, less moiré.",
    "In the banding section below, lower the <strong>LED PWM refresh rate</strong>: bands appear.",
  ]));

  const ctl = controls({
    p: { type: 'range', label: 'LED pixel pitch', min: 1.2, max: 4, step: 0.1, value: 2.6, unit: 'mm' },
    fill: { type: 'range', label: 'Emitter fill factor', min: 0.1, max: 0.7, step: 0.05, value: 0.3 },
    Z: { type: 'range', label: 'Camera to wall', min: 1, max: 30, log: true, value: 6, unit: 'm' },
    s: { type: 'range', label: 'Focus distance', min: 1, max: 30, log: true, value: 3, unit: 'm' },
    f: { type: 'range', label: 'Focal length', min: 18, max: 135, log: true, value: 50, unit: 'mm' },
    N: { type: 'range', label: 'Aperture', min: 1.4, max: 16, log: true, value: 2.8, fmt: (v) => 'T' + v.toPrecision(2) },
    q: { type: 'range', label: 'Photosite pitch', min: 3, max: 9, step: 0.1, value: 6, unit: 'µm' },
    olpf: { type: 'toggle', label: 'Optical low-pass filter (1 px)', value: false },
    rot: { type: 'range', label: 'Wall rotation in frame', min: 0, max: 10, step: 0.1, value: 2, unit: '°' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 16 / 9, label: 'Camera pixels (1:1 crop at the image centre) looking at the wall behind an in-focus actor', draw: drawView, minH: 220 });
  const curve = stage({ aspect: 2.4, label: '', draw: drawCurve, cls: 'plain', minH: 210 });
  root.append(lab([view.el, h('div.card', { style: { padding: '6px' } }, curve.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  const params = (st, Z) => ({ p: st.p, fill: st.fill, Z: (Z ?? st.Z) * 1000, s: st.s * 1000, f: st.f, N: st.N, q: st.q / 1000, olpf: st.olpf, rot: st.rot * D2R });
  function update() {
    const st = ctl.state, o = params(st), r = moire(o), img = renderWall({ ...o, kmax: 4 }, 320, 180);
    M = { st, r, img };
    // nearest distance at which moiré stays below 1 % (scanning 1–30 m)
    let safe = null;
    for (const Z of logRange(1, 30, 200)) { const q = moire(params(st, Z)); if (q.aliased && q.contrast < 0.01) { safe = Z; break; } }
    ro.replaceChildren(readouts([
      ['Wall grid on the sensor', t('{nu} cycles/mm (pitch {p} µm)', { nu: r.nu.toFixed(1), p: (1000 / r.nu).toFixed(1) })],
      ['Sensor Nyquist frequency', t('{nu} cycles/mm', { nu: r.nyquist.toFixed(1) })],
      ['Grid is', r.aliased ? t('aliased → moiré at {nu} cycles/mm', { nu: r.alias.toFixed(1) }) : t('resolved (visible as a grid if sharp)')],
      ['Defocus blur of the wall', (r.b * 1000).toFixed(0) + ' µm'],
      ['Moiré / grid contrast', (100 * r.contrast).toFixed(2) + ' %'],
      ['Aliased and < 1 % from', safe ? safe.toFixed(1) + ' m' : '—'],
    ]));
    calc.say(t('On the sensor the wall\'s grid has <strong>{nu} cycles/mm</strong> against a Nyquist limit of {nyq}.', { nu: r.nu.toFixed(0), nyq: r.nyquist.toFixed(0) }) + ' '
      + (() => { const c = (100 * r.contrast).toFixed(1), low = r.contrast < 0.01;
        return r.aliased ? (low ? t('It aliases into moiré with <strong>{c} %</strong> contrast, below the 1 % at which it shows.', { c }) : t('It aliases into moiré with <strong>{c} %</strong> contrast.', { c }))
          : (low ? t('The grid itself is resolved, with {c} % contrast, below the 1 % at which it shows.', { c }) : t('The grid itself is resolved, with {c} % contrast.', { c })); })());
    calc.set(String.raw`\begin{aligned}
    \nu_w &= \frac{1}{m\,p} = ${texNum(r.nu, 3)}\ \text{mm}^{-1},\quad \nu_\text{alias} = \left|\nu_w - \tfrac{k}{q}\right| = ${texNum(r.alias, 3)}\\
    C &= M_\text{grid}\,\frac{2J_1(\pi b\nu_w)}{\pi b\nu_w}\,\mathrm{MTF}_\text{lens}\,\mathrm{sinc}(q\nu_w) = ${texNum(r.contrast, 3)}
    \end{aligned}`);
    [view, curve].forEach((x) => x.redraw());
  }
  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const { img } = M.img, W = 320, H = 180, ic = imageCanvas(W, H);
    // display: mean grey with the modulation stretched so that faint moiré stays visible
    let mean = 0; for (const v of img) mean += v; mean /= img.length;
    const gain = Math.min(50, Math.max(1, 0.35 / Math.max(M.r.contrast, 1e-4)));
    for (let k = 0; k < W * H; k++) { const v = Math.max(0, Math.min(1, 0.55 + 0.45 * gain * (img[k] / mean - 1))), o = k * 4; ic.data[o] = 255 * Math.pow(v, 1 / 2.2) * 0.55; ic.data[o + 1] = 255 * Math.pow(v, 1 / 2.2) * 0.75; ic.data[o + 2] = 255 * Math.pow(v, 1 / 2.2); ic.data[o + 3] = 255; }
    ic.put();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, 0, 0, w, hh);
    // actor silhouette (in focus, in front of the wall)
    ctx.fillStyle = '#16100c'; ctx.beginPath(); ctx.ellipse(w * 0.22, hh * 0.38, hh * 0.13, hh * 0.17, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.02, hh); ctx.quadraticCurveTo(w * 0.05, hh * 0.58, w * 0.22, hh * 0.56); ctx.quadraticCurveTo(w * 0.39, hh * 0.58, w * 0.42, hh); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(w - 170, hh - 22, 170, 22); ctx.fillStyle = '#fff'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(t('contrast stretched ×{gain}', { gain: gain.toFixed(0) }), w - 8, hh - 7); ctx.textAlign = 'left';
  }
  function drawCurve(ctx, w, hh) {
    if (!M) return;
    const st = M.st, Zs = logRange(1, 30, 160), data = Zs.map((Z) => { const r = moire(params(st, Z)); return [Z, Math.max(1e-5, r.contrast), r.aliased]; });
    const firstAliased = data.find((d) => d[2]);
    plot(ctx, w, hh, {
      title: 'Grid contrast reaching the sensor vs camera distance', x: { min: 1, max: 30, log: true, label: 'camera to wall (m)' }, y: { min: 1e-5, max: 1, log: true, label: 'contrast' },
      series: [{ data: data.map((d) => [d[0], d[1]]), color: '#ffb547', width: 2.2 }],
      bands: firstAliased ? [{ x: [firstAliased[0], 30], color: 'rgba(255,107,107,0.08)' }] : [],
      vlines: [{ x: st.Z, color: 'rgba(255,255,255,0.4)', label: 'camera' }, { x: st.s, color: 'rgba(107,227,164,0.5)', label: 'focus', dy: 14 }],
    });
    ctx.fillStyle = 'rgba(255,107,107,0.8)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(t('red: grid finer than Nyquist → aliased (moiré)'), 60, hh - 44);
  }

  // ── refresh and rolling shutter ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Refresh banding with a rolling shutter'));
  const bctl = controls({
    fp: { type: 'range', label: 'LED PWM refresh rate', min: 480, max: 7680, log: true, value: 3840, unit: 'Hz' },
    duty: { type: 'range', label: 'PWM duty (brightness)', min: 0.05, max: 1, step: 0.01, value: 0.3 },
    angle: { type: 'range', label: 'Shutter angle at 24 fps', min: 1, max: 360, log: true, value: 180, unit: '°' },
    readout: { type: 'range', label: 'Sensor readout time', min: 2, max: 30, step: 0.5, value: 15, unit: 'ms' },
    phase: { type: 'range', label: 'Phase of the wall relative to the camera (genlock)', min: 0, max: 1, step: 0.01, value: 0 },
  }, () => updB());
  const bro = h('div');
  const bands = stage({ aspect: 16 / 9, label: 'Recorded frame of a uniformly lit wall (contrast exaggerated ×10)', draw: drawBands, minH: 180 });
  const bplot = stage({ aspect: 1.6, label: '', draw: drawBPlot, cls: 'plain', minH: 200 });
  sec2.append(lab([h('div.grid-2', {}, bands.el, h('div.card', { style: { padding: '6px' } }, bplot.el))], [h('div.card', {}, bctl.el), h('div.card', {}, bro)]));
  root.append(sec2);
  let B = null;
  function updB() {
    const st = bctl.state, texp = st.angle / 360 / 24, rows = 270, prof = bandProfile({ fp: st.fp, duty: st.duty, texp, tline: st.readout / 1000 / rows, phase: st.phase }, rows);
    const amp = bandAmplitude(texp, st.fp, st.duty), cycles = texp * st.fp;
    B = { st, prof, texp };
    bro.replaceChildren(readouts([['Exposure', t('1/{s} s = {n} PWM periods', { s: Math.round(1 / texp), n: cycles.toFixed(2) })], ['Band amplitude (peak-to-peak)', (100 * amp).toFixed(2) + ' %'], ['Bands per frame', (st.readout / 1000 * st.fp).toFixed(1)], ['Remedy', amp < 0.005 ? t('none needed') : t('exposure = {n} PWM periods ({a}°) or a faster refresh', { n: Math.max(1, Math.round(cycles)), a: (360 * 24 * Math.max(1, Math.round(cycles)) / st.fp).toFixed(1) })]]));
    [bands, bplot].forEach((x) => x.redraw());
  }
  function drawBands(ctx, w, hh) {
    if (!B) return;
    const n = B.prof.length, m = B.prof.reduce((a, b) => a + b, 0) / n;
    for (let r = 0; r < n; r++) { const v = Math.max(0, Math.min(1, 0.55 + 10 * (B.prof[r] / m - 1) * 0.55)); ctx.fillStyle = `rgb(${Math.round(140 * v)},${Math.round(190 * v)},${Math.round(255 * v)})`; ctx.fillRect(0, (r / n) * hh, w, hh / n + 1); }
  }
  function drawBPlot(ctx, w, hh) {
    if (!B) return;
    const st = B.st, ang = logRange(1, 360, 400);
    plot(ctx, w, hh, {
      title: 'Banding vs shutter angle', x: { min: 1, max: 360, log: true, label: 'shutter angle (°, 24 fps)' }, y: { min: 0, max: 1, label: 'peak-to-peak band amplitude' },
      series: [{ data: ang.map((a) => [a, bandAmplitude(a / 360 / 24, st.fp, st.duty)]), color: '#ffb547', width: 1.8 }],
      vlines: [{ x: st.angle, color: 'rgba(255,255,255,0.4)' }],
    });
  }

  update(); updB();

  root.append(rule(String.raw`\[\nu_w = \frac{1}{m\,p} \approx \frac{Z}{f\,p}\]
<p>An LED wall with pixel pitch \(p\) at distance \(Z\) is imaged at magnification \(m \approx f/Z\), so its grid lands on the sensor at frequency \(\nu_w\). A 2.6 mm wall 6 m away through a 50 mm lens gives \(6000/(50 \times 2.6) = 46\) cycles/mm, below the 83 cycles/mm Nyquist limit of 6 µm photosites: the grid is resolved and shows if the wall is in focus. From 12 m it doubles to 92 cycles/mm, above Nyquist, and aliases into moiré. Defocusing the wall washes out both.</p>`,
    String.raw`The magnification formula holds for a wall much farther away than the focal length. Whether the pattern is visible depends on the contrast that survives defocus, the lens MTF and the photosites' own averaging, which this page computes, and on the shape of the wall's emitters.`));
  root.append(theory('Filming a screen', String.raw`
<div class="theory-cols"><div>
<h3>LED-wall moiré</h3>
<p>A wall of pixel pitch \(p\) at distance \(Z\) is imaged with magnification \(m = v/Z\), so its grid reaches the sensor at</p>
\[\nu_w = \frac{1}{m\,p}\quad\text{cycles/mm}.\]
<p>Above the Nyquist frequency \(1/2q\) of photosites of pitch \(q\) the grid cannot be represented and folds back to \(|\nu_w - k/q|\) as large, slowly varying moiré bands. Its contrast is the grid's own modulation (higher for small emitters) times the system MTF at \(\nu_w\): the defocus disk \(2J_1(\pi b\nu)/(\pi b\nu)\) (the wall is usually behind the focused actor), the lens's diffraction MTF, the photosite aperture and, where fitted, the OLPF.</p>
<p>Moiré is therefore worst with the wall in focus, stopped down, at the distance where \(\nu_w\) just exceeds Nyquist, and on sensors without an OLPF. Productions keep the wall out of focus, choose a fine pitch, and keep the camera beyond the distance where the contrast is negligible. The curve marks it.</p>
</div><div>
<h3>Refresh and rolling shutters</h3>
<p>LED brightness is set by pulse-width modulation at a few kilohertz. Each sensor row of a rolling shutter integrates the light over its own exposure window, starting a line time later than the previous row. If the exposure is a whole number of PWM periods, every row collects the same light. Otherwise the collected light depends on the phase, and the frame shows horizontal bands that repeat every PWM period of readout time. With \(n + \phi\) periods in the exposure and duty \(d\), the light collected varies between \(nd + \max(0, \phi-(1-d))\) and \(nd + \min(\phi, d)\), so the peak-to-peak band amplitude relative to the mean is</p>
\[\frac{\min(\phi, d) - \max(0, \phi + d - 1)}{(n+\phi)\,d}.\]
<p>The row-by-row simulation reproduces it. Remedies are higher refresh rates, shutter angles matched to the PWM period, and genlock of wall and camera. Scan-multiplexed walls, which light only a fraction of their rows at a time, add further structure that is not modelled here.</p>
</div></div>`));
  root.append(references([
    'Y. Nakamura (ed.), <em>Image Sensors and Signal Processing for Digital Still Cameras</em>, CRC Press (2006): sampling, aliasing and optical low-pass filters.',
    'SMPTE and ARRI/ROE technical notes on LED volumes: pixel pitch, moiré distance and genlock (2020–2023).',
    'J. W. Goodman, <em>Introduction to Fourier Optics</em>, 3rd ed. (2005): defocus and diffraction transfer functions.',
  ]));

  return () => [view, curve, bands, bplot].forEach((x) => x.destroy());
}
