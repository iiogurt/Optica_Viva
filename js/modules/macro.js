import { h, controls, stage, readouts, imageCanvas, texNum, fmt } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { run } from '../lib/compute.js';
import { plot, logRange } from '../lib/plot.js';
import { oetf } from '../lib/color.js';
import { closeUp, macroDoF, airyDiameter, optimalNw, stackFrames } from '../lib/macro.js';

const D2R = Math.PI / 180, COC = 0.03, LAM = 550, PX = 0.006; // full-frame CoC (mm), λ (nm), 24 MP pixel (mm)
// Representative unit-focusing lenses: pupil magnification m_p, front vertex ahead of the front
// principal plane (negative: H lies in front of the lens, as in a telephoto) and barrel length.
const LENSES = {
  sym50: { name: '50 mm f/2.8 symmetric + extension tubes', f: 50, N: 2.8, mp: 1, front: 14, len: 32 },
  mac100: { name: '100 mm f/2.8 macro (unit focusing)', f: 100, N: 2.8, mp: 0.8, front: 48, len: 95 },
  ret35: { name: '35 mm f/2 retrofocus + extension', f: 35, N: 2, mp: 2, front: 58, len: 62 },
  rev35: { name: '35 mm retrofocus, reversed', f: 35, N: 2, mp: 0.5, front: -3, len: 62 },
  tele180: { name: '180 mm f/3.5 telephoto macro', f: 180, N: 3.5, mp: 0.6, front: -32, len: 135 },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>To photograph something tiny at life size, the lens has to sit far from the sensor, about twice as far as for a distant scene. The light that passes the aperture is then spread over a larger area, so the image gets darker, as if the aperture were smaller than marked.</p>
<p>At the same time the zone of sharp focus shrinks to a fraction of a millimetre, so only a sliver of an insect is sharp. Closing the aperture deepens it, but only up to a point: soon diffraction blurs the whole picture. Macro photographers therefore take many shots focused at slightly different depths and merge them, which is called <strong>focus stacking</strong>.</p>`, [
    "At <strong>1 : 1</strong> with the 100 mm macro set to f/8, read the working f-number: the lens behaves like about f/18.",
    "Stop down from f/8 to <strong>f/32</strong> and watch the ruler: the sharp zone grows, but everything gets softer.",
    "Keep the subject depth at 5 mm and add <strong>focus-stack frames</strong> until the whole depth is covered.",
  ]));

  const ctl = controls({
    lens: { type: 'select', label: 'Lens', value: 'mac100', options: Object.entries(LENSES).map(([k, l]) => [k, l.name]) },
    m: { type: 'range', label: 'Magnification m', min: 0.05, max: 5, log: true, value: 1, fmt: (v) => (v >= 1 ? v.toPrecision(3) + ' : 1' : '1 : ' + (1 / v).toPrecision(3)) },
    N: { type: 'range', label: 'Set f-number N (at infinity)', min: 2, max: 32, log: true, value: 8, fmt: (v) => 'f/' + v.toPrecision(2) },
    tilt: { type: 'range', label: 'Ruler tilt away from the camera', min: 0, max: 75, step: 1, value: 45, unit: '°' },
    frames: { type: 'range', label: 'Focus-stack frames', min: 1, max: 40, step: 1, value: 1, fmt: (v) => (v === 1 ? 'single shot' : v + ' frames') },
    depth: { type: 'range', label: 'Subject depth to cover', min: 0.2, max: 50, log: true, value: 5, unit: 'mm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 1.5, label: 'Full frame (36 × 24 mm): a steel ruler with bar targets, rendered through each pixel\'s chief ray', draw: (c, w, hh) => drawImg(c, w, hh, 'full'), minH: 240 });
  const crop = stage({ aspect: 1.5, label: '100 % crop of a 24 MP sensor (6 µm pixels) on the bar targets', draw: (c, w, hh) => drawImg(c, w, hh, 'crop'), minH: 240 });
  const note = h('p.note', {}, '');
  const side = stage({ aspect: 3.2, label: 'Side view (axial distances to scale, heights exaggerated): subject, lens with entrance (EP) and exit (XP) pupils, extension and sensor', draw: drawSide, minH: 150 });
  const blur = stage({ aspect: 1.35, label: '', draw: drawBlur, cls: 'plain', minH: 230 });
  const nw = stage({ aspect: 1.35, label: '', draw: drawNw, cls: 'plain', minH: 230 });
  root.append(lab([h('div.grid-2', {}, view.el, crop.el), note, side.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, blur.el), h('div.card', { style: { padding: '6px' } }, nw.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let S = null, imgs = { full: null, crop: null }, want = null, busy = false, alive = true, lastKey = '';
  const lens = () => LENSES[ctl.state.lens];
  // full view: a draft while controls move, then full resolution plus the 1:1 crop
  function request(draft) {
    const st = ctl.state, L = lens(), key = JSON.stringify(st) + (draft ? 'd' : 'f');
    if (key === lastKey) return;
    lastKey = key;
    const base = { f: L.f, N: st.N, mp: L.mp, m: st.m, tilt: st.tilt * D2R, frames: st.frames, lam: LAM };
    const W = draft ? 240 : 480;
    // the crop is centred on the bar-target strip (u = 3 mm on the ruler; the image is inverted)
    want = { draft, args: { full: { ...base, W, H: (W * 2) / 3, mmPerPx: 36 / W, cx: 0, cy: 0 }, crop: draft ? null : { ...base, W: 360, H: 240, mmPerPx: PX, cx: -3 * st.m, cy: 0 } } };
    if (!busy) pump();
  }
  function pump() {
    const job = want;
    want = null;
    if (!job || !alive) return;
    busy = true;
    const t0 = performance.now();
    run('macroRuler', job.args).then((r) => {
      busy = false;
      if (!alive) return;
      imgs.full = { ...r.full, c: null };
      if (r.crop) imgs.crop = { ...r.crop, c: null };
      view.redraw(); crop.redraw();
      const s = r.full.stats;
      note.textContent = `Visible depth of the ruler ${s.depth.toFixed(1)} mm; largest blur ${(2 * s.rMax * (36 / r.full.W) * 1000).toFixed(0)} µm on the sensor; diffraction σ ${(s.sigma * 36 / r.full.W * 1000).toFixed(1)} µm. ${s.foci > 1 ? s.foci + ' frames stacked.' : 'Single frame.'} ${(performance.now() - t0).toFixed(0)} ms in the worker${job.draft ? ' (draft)' : ''}.`;
      if (want) pump();
      else if (job.draft) request(false);
    }, (e) => { busy = false; note.textContent = 'Render failed: ' + e.message; });
  }

  function update() {
    const st = ctl.state, L = lens(), o = { f: L.f, N: st.N, mp: L.mp, m: st.m }, g = closeUp(o);
    const dof = macroDoF(o, COC), airy = airyDiameter(g.Nw, LAM), wd = g.u - L.front;
    const NwOpt = optimalNw(st.m, st.depth, LAM), Nopt = NwOpt / (1 + st.m / L.mp);
    const nFrames = stackFrames(st.depth, dof);
    S = { st, L, o, g, dof, airy, wd, NwOpt, Nopt, nFrames };
    request(true);
    ro.replaceChildren(readouts([
      ['Effective (working) f-number N_w', 'f/' + g.Nw.toPrecision(3)],
      ['Exposure loss (bellows factor)', g.evLoss.toFixed(2) + ' EV'],
      ['Extension beyond ∞ focus', g.ext.toFixed(1) + ' mm'],
      ['Field of view on the subject', `${(36 / st.m).toPrecision(3)} × ${(24 / st.m).toPrecision(3)} mm`],
      ['Working distance (front of lens)', wd > 0 ? wd.toFixed(1) + ' mm' : 'subject inside the lens!'],
      ['Total depth of field (c = 0.03 mm)', dof < 1 ? (dof * 1000).toFixed(0) + ' µm' : dof.toFixed(2) + ' mm'],
      ['Airy diameter on the sensor', (airy * 1000).toFixed(1) + ' µm (' + (airy / PX).toFixed(1) + ' px)'],
      ['Optimum for the subject depth', 'f/' + Nopt.toPrecision(2) + ' (N_w ' + NwOpt.toPrecision(3) + ')'],
      ['Stack frames for that depth', nFrames + ' at f/' + st.N.toPrecision(2)],
    ]));
    calc.say(`At ${st.m >= 1 ? st.m.toPrecision(2) + ' : 1' : '1 : ' + (1 / st.m).toPrecision(2)} the lens set to f/${st.N.toPrecision(2)} works at <strong>f/${g.Nw.toPrecision(2)}</strong>, ${g.evLoss.toFixed(1)} stops less light, and only <strong>${dof < 1 ? (dof * 1000).toFixed(0) + ' µm' : dof.toFixed(2) + ' mm'}</strong> of depth is sharp.`);
    calc.set(String.raw`\begin{aligned}
    N_w &= N\left(1+\frac{m}{m_p}\right) = ${texNum(st.N, 3)}\left(1+\frac{${texNum(st.m, 3)}}{${texNum(L.mp, 2)}}\right) = ${texNum(g.Nw, 3)}\\
    \Delta EV &= 2\log_2\!\left(1+\tfrac{m}{m_p}\right) = ${texNum(g.evLoss, 3)}\\
    t_\text{DoF} &= \frac{2N_wc}{m^2} = ${texNum(dof, 3)}\ \text{mm}\\
    N_{w,\text{opt}} &= \sqrt{\frac{m^2\delta}{2\cdot2.44\lambda}} = ${texNum(NwOpt, 3)}
    \end{aligned}`);
    [side, blur, nw].forEach((x) => x.redraw());
  }

  function drawImg(ctx, w, hh, which) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const I = imgs[which];
    if (!I) return;
    if (!I.c) {
      const ic = imageCanvas(I.W, I.H);
      for (let k = 0; k < I.W * I.H; k++) {
        const v = I.img[k];
        ic.data[k * 4] = 255 * oetf(Math.min(1, v * 1.08)); ic.data[k * 4 + 1] = 255 * oetf(Math.min(1, v * 1.04)); ic.data[k * 4 + 2] = 255 * oetf(Math.min(1, v * 0.96)); ic.data[k * 4 + 3] = 255;
      }
      ic.put();
      I.c = ic.c;
    }
    ctx.imageSmoothingEnabled = which === 'full';
    const sc = Math.min(w / I.W, hh / I.H);
    ctx.drawImage(I.c, (w - I.W * sc) / 2, (hh - I.H * sc) / 2, I.W * sc, I.H * sc);
    if (which === 'full' && S) {
      // outline of the crop region (360 × 240 px of 6 µm, centred on the bar strip)
      const cw = (360 * PX) / 36 * I.W * sc, chh = (240 * PX) / 24 * I.H * sc;
      const cx = (w - I.W * sc) / 2 + (0.5 + (-3 * S.st.m) / 36) * I.W * sc, cy = hh / 2;
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - cw / 2, cy - chh / 2, cw, chh);
    }
  }

  function drawSide(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!S) return;
    const { L, g, st } = S, f = L.f;
    // axial positions relative to the principal planes (taken as coincident)
    const zObj = -g.u, zEP = -f * (1 - 1 / L.mp), zXP = f * (1 - L.mp), zImg = f * (1 + st.m);
    const zFront = -L.front, zRear = zFront + L.len;
    const lo = Math.min(zObj, zFront) - 10, hi = Math.max(zImg, zRear) + 10, sc = (w - 40) / (hi - lo), X = (z) => 20 + (z - lo) * sc, yc = hh / 2 + 6;
    const yObj = Math.min(18 / st.m, 12);
    // heights are exaggerated to fill the panel (lengths along the axis are to scale)
    const Y = (mm) => mm * ((hh * 0.34) / Math.max(yObj, yObj * st.m, (f / st.N / 2) * L.mp, f / st.N / 2));
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, yc); ctx.lineTo(w - 10, yc); ctx.stroke();
    // lens barrel
    const bh = Math.max(Y(f / st.N / 2) * 1.6, 18);
    ctx.fillStyle = 'rgba(106,215,255,0.07)'; ctx.strokeStyle = 'rgba(106,215,255,0.45)';
    ctx.fillRect(X(zFront), yc - bh, X(zRear) - X(zFront), 2 * bh); ctx.strokeRect(X(zFront), yc - bh, X(zRear) - X(zFront), 2 * bh);
    // extension (tubes/bellows) between the barrel and the sensor
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(X(zRear), yc - bh * 0.8, X(zImg) - X(zRear), 1.6 * bh);
    // rays: axial cone through the pupils, and the chief ray of the object top
    ctx.strokeStyle = 'rgba(255,181,71,0.75)'; ctx.lineWidth = 1.2;
    for (const sg of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(X(zObj), yc); ctx.lineTo(X(zEP), yc - sg * Y(f / st.N / 2)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(zXP), yc - sg * Y((f / st.N / 2) * L.mp)); ctx.lineTo(X(zImg), yc); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(106,227,164,0.85)';
    ctx.beginPath(); ctx.moveTo(X(zObj), yc - Y(yObj)); ctx.lineTo(X(zEP), yc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(zXP), yc); ctx.lineTo(X(zImg), yc + Y(yObj * st.m)); ctx.stroke();
    ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(zEP), yc); ctx.lineTo(X(zXP), yc); ctx.stroke(); ctx.setLineDash([]);
    // pupils, object, sensor
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#6ad7ff'; ctx.beginPath(); ctx.moveTo(X(zEP), yc - Y(f / st.N / 2)); ctx.lineTo(X(zEP), yc + Y(f / st.N / 2)); ctx.stroke();
    ctx.strokeStyle = '#c18cff'; ctx.beginPath(); ctx.moveTo(X(zXP), yc - Y((f / st.N / 2) * L.mp)); ctx.lineTo(X(zXP), yc + Y((f / st.N / 2) * L.mp)); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(X(zObj), yc); ctx.lineTo(X(zObj), yc - Y(yObj)); ctx.stroke();
    ctx.strokeStyle = '#ff9cc0'; ctx.beginPath(); ctx.moveTo(X(zImg), yc - bh); ctx.lineTo(X(zImg), yc + bh); ctx.stroke();
    ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#6ad7ff'; ctx.fillText('EP', X(zEP), yc - Y(f / st.N / 2) - 6);
    ctx.fillStyle = '#c18cff'; ctx.fillText('XP', X(zXP), yc + Y((f / st.N / 2) * L.mp) + 14);
    ctx.fillStyle = '#fff'; ctx.fillText('subject', X(zObj), yc + 16);
    ctx.fillStyle = '#ff9cc0'; ctx.fillText('sensor', X(zImg), yc + bh + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`working distance ${S.wd.toFixed(0)} mm`, (X(zObj) + X(zFront)) / 2, yc - bh - 8);
    ctx.fillText(`extension ${g.ext.toFixed(0)} mm`, (X(zRear) + X(zImg)) / 2, yc - bh - 8);
  }

  function drawBlur(ctx, w, hh) {
    if (!S) return;
    const { st, L } = S, Ns = logRange(1.4, 64, 160), half = st.depth / 2;
    const geo = (N) => (st.m * st.m * half) / (N * (1 + st.m / L.mp)) * 1000, dif = (N) => airyDiameter(N * (1 + st.m / L.mp), LAM) * 1000;
    const all = Ns.map((N) => [N, Math.hypot(geo(N), dif(N))]);
    plot(ctx, w, hh, {
      title: `Blur at ±${half.toPrecision(2)} mm from focus vs set f-number`, x: { min: 1.4, max: 64, log: true, label: 'set f-number N' }, y: { min: 1, max: 5000, log: true, label: 'blur diameter on sensor (µm)' },
      series: [
        { data: Ns.map((N) => [N, geo(N)]), color: '#6ad7ff', width: 1.6, dash: [5, 3], label: 'geometric (defocus)' },
        { data: Ns.map((N) => [N, dif(N)]), color: '#c18cff', width: 1.6, dash: [5, 3], label: 'diffraction (Airy Ø)' },
        { data: all, color: '#ffb547', width: 2.4, label: 'combined (RSS)' },
      ],
      vlines: [{ x: Math.min(64, Math.max(1.4, S.Nopt)), color: 'rgba(107,227,164,0.7)', label: 'optimum' }, { x: st.N, color: 'rgba(255,255,255,0.4)', label: 'set', dy: 14 }],
      bands: [{ y: [1, PX * 2000], color: 'rgba(255,255,255,0.04)' }],
      legend: true, legendX: w - 200, legendY: hh - 100,
    });
  }

  function drawNw(ctx, w, hh) {
    if (!S) return;
    const ms = logRange(0.05, 5, 120), cols = { 0.5: '#ff9cc0', 1: '#6ad7ff', 2: '#6be3a4' };
    const series = [0.5, 1, 2].map((mp) => ({ data: ms.map((m) => [m, 2 * Math.log2(1 + m / mp)]), color: cols[mp], width: 1.4, dash: [4, 3], label: `m_p = ${mp}` }));
    series.push({ data: ms.map((m) => [m, 2 * Math.log2(1 + m / S.L.mp)]), color: '#ffb547', width: 2.4, label: `this lens (m_p = ${S.L.mp})` });
    plot(ctx, w, hh, {
      title: 'Exposure loss vs magnification', x: { min: 0.05, max: 5, log: true, label: 'magnification m' }, y: { min: 0, max: 7, label: 'stops lost  (N_w = N·2^(ΔEV/2))' },
      series, vlines: [{ x: S.st.m, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: 60, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[N_w \approx N\,(1+m),\qquad \text{DoF} \approx \frac{2N_w c}{m^2}\]
<p>At magnification \(m\) the effective (working) f-number grows by the factor \(1+m\), and the depth of field depends almost only on the working f-number and the magnification, not on the focal length. At life size (\(m = 1\)) a symmetric lens set to f/8 works at f/16, loses two stops of light and keeps about \(2 \times 16 \times 0.03 / 1 \approx 1\) mm sharp.</p>`,
    String.raw`The factor \(1+m\) is for a symmetric lens. Telephoto and retrofocus designs have a pupil magnification \(m_p \neq 1\), and the right factor is \(1 + m/m_p\), which this page uses (the 100 mm macro has \(m_p = 0.8\), so f/8 becomes f/18). At high magnification diffraction, not depth of field, decides the best aperture.`));
  root.append(theory('Optics at close range', String.raw`
<div class="theory-cols"><div>
<h3>Magnification and the bellows factor</h3>
<p>A lens of focal length \(f\) images a subject at magnification \(m\) when the subject is \(u = f(1+1/m)\) in front of the front principal plane and the image \(v = f(1+m)\) behind the rear one. Focusing by extension therefore moves the lens \(\Delta = fm\) forward: one focal length for 1 : 1.</p>
<p>The f-number engraved on the lens is defined for an object at infinity. What matters for exposure and diffraction is the cone angle at the image, set by the exit pupil (diameter \(m_pf/N\)) and its distance from the image, \(f(m+m_p)\):</p>
\[N_w = N\left(1+\frac{m}{m_p}\right),\qquad \Delta EV = 2\log_2\!\left(1+\frac{m}{m_p}\right),\qquad m_p = \frac{D_{XP}}{D_{EP}}.\]
<p>A symmetric lens (\(m_p = 1\)) at 1 : 1 loses exactly two stops: f/8 behaves as f/16. A telephoto design (\(m_p < 1\)) loses more, and a retrofocus wide-angle (\(m_p > 1\)) loses less. <em>Reversing</em> the retrofocus inverts its pupil magnification, so the long working distance of its rear element comes with a large exposure penalty. The subject sits \(f(1/m + 1/m_p)\) in front of the entrance pupil, the true centre of perspective.</p>
<h3>Depth of field shrinks as 1/m²</h3>
<p>Near the subject, longitudinal magnification is \(m^2\), so a depth \(\delta\) in the subject becomes \(m^2\delta\) at the sensor and blurs to \(m^2\delta/N_w\). Setting this equal to the circle of confusion \(c\) gives the total depth of field</p>
\[t = \frac{2N_wc}{m^2} = \frac{2Nc\,(1+m/m_p)}{m^2},\]
<p>independent of focal length at a given magnification. At 1 : 1 and f/8 with \(c = 0.03\) mm it is 0.96 mm. That is why insect photographers stack dozens of frames.</p>
</div><div>
<h3>Diffraction sets the floor</h3>
<p>The Airy disk at the sensor has diameter \(2.44\lambda N_w\): 21 µm at f/16 effective, already 3.6 pixels of a 24 MP full-frame sensor. Stopping down trades geometric blur (∝ 1/N_w) for diffraction blur (∝ N_w). Their quadratic sum is smallest when they are equal:</p>
\[\frac{m^2\delta}{2N_w} = 2.44\lambda N_w\ \Rightarrow\ N_{w,\text{opt}} = \sqrt{\frac{m^2\delta}{2\cdot2.44\,\lambda}}.\]
<p>Beyond that, stopping down makes every part of the image softer. The bar targets in the crop show it directly: as you stop down, the finest groups that were resolved first lose contrast, then vanish when their frequency passes the diffraction cut-off \(1/(\lambda N_w)\).</p>
<h3>Focus stacking</h3>
<p>Stacking photographs the subject at several focus distances at the optimum or a wider aperture and keeps, for each pixel, the frame in which it is sharpest. The required number of frames is the subject depth divided by the depth of field, with about 20 % overlap. The render does the same, with frames evenly spaced across the visible depth of the ruler, and assumes perfect alignment of their slightly different magnifications.</p>
<h3>What the render computes</h3>
<p>Each sensor pixel (2 × 2 supersampled) sends its chief ray back through the entrance pupil to the tilted ruler, so perspective at close range is exact. The point's distance gives its own magnification and the exact geometric blur from the exit-pupil cone. The image is blended from a stack of uniform-disk blurs, then convolved with a Gaussian of the Airy core's width (σ = 0.42 λN_w), monochromatic at 550 nm. Real macro lenses use floating elements and internal focusing, which change \(f\) and \(m_p\) with distance. This page assumes pure extension.</p>
</div></div>`));
  root.append(references([
    'R. Kingslake, <em>Lens Design Fundamentals</em>, Academic Press (1978), §4: pupils, pupil magnification and close-up exposure.',
    'S. F. Ray, <em>Applied Photographic Optics</em>, 3rd ed., Focal Press (2002): close-up photography and photomacrography, bellows factor, depth of field.',
    'Zerene Systems, technical notes on focus stacking and the optimum aperture in macro photography (zerenesystems.com).',
    'J. W. Goodman, <em>Introduction to Fourier Optics</em>, 3rd ed., Roberts (2005), §6.3: the incoherent cut-off frequency 1/(λN).',
  ]));

  return () => { alive = false; [view, crop, side, blur, nw].forEach((s) => s.destroy()); };
}
