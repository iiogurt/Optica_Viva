// Laser speckle and coherent imaging: a rough, printed surface seen in laser light and in ordinary
// (incoherent) light; partial coherence, a rotating diffuser, polarisation and big pixels against
// the speckle; the coherent edge's ringing and the two transfer functions.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear } from '../lib/pixels.js';
import { parallel, poolSize, run } from '../lib/compute.js';
import { NGRID, REGION, looks, split, bin, stats, gammaPdf, speckleSize, ctf, otf } from '../lib/speckle.js';
import { t, N_ } from '../lib/i18n.js';

const TINT = { 405: [0.62, 0.36, 1], 532: [0.35, 1, 0.4], 633: [1, 0.3, 0.22] };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'cinema'] }));
  root.append(idea(String.raw`<p>Shine a laser pointer on a wall and the spot looks grainy and glittery, and the grains seem to move when you move your head. A laser's light waves all march in step. A wall is rough on the scale of the light's wavelength, so the light reflected from neighbouring bumps arrives at your eye with random delays and adds up in some places and cancels in others: <em>speckle</em>.</p>
<p>Ordinary light is a jumble of many independent waves whose speckle patterns blur into each other, so you never notice it. Laser projectors, holography and laser cameras fight speckle by mixing many independent patterns.</p>`, [
    'Turn the <strong>Surface roughness</strong> down to zero: does the speckle go away, and what is left at the edges of the print?',
    'Raise the <strong>Rotating diffuser</strong> frames from 1 to 16: predict how much smoother the white paper gets.',
    'Grow the <strong>Light source</strong> from a laser to one that fills the lens: what happens to the grains, and to the bars?',
  ]));

  const ctl = controls({
    obj: { type: 'seg', label: 'Object', value: 'target', options: [['target', 'Printed target'], ['edge', 'Edge']] },
    rough: { type: 'range', label: 'Surface roughness (RMS height, in wavelengths)', min: 0, max: 0.5, step: 0.005, value: 0.5 },
    sigma: { type: 'range', label: 'Light source size σ (0 = laser, 1 = fills the lens)', min: 0, max: 1, step: 0.05, value: 0 },
    frames: { type: 'select', label: 'Rotating diffuser: frames averaged', value: '1', options: [['1', '1 (no diffuser)'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16']] },
    pol: { type: 'toggle', label: 'Depolarising surface (two independent polarisations)', value: false },
    pix: { type: 'select', label: 'Camera pixel (in units of λN)', value: '1', options: [['1', '0.25'], ['2', '0.5'], ['4', '1'], ['8', '2'], ['16', '4']] },
    lam: { type: 'seg', label: 'Laser wavelength', value: '532', options: [['405', '405 nm'], ['532', '532 nm'], ['633', '633 nm']] },
    N: { type: 'range', label: 'f-number of the camera', min: 1.4, max: 16, log: true, value: 8 },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const pics = stage({ aspect: 2.05, label: 'Left: laser light (this setting) · right: ordinary incoherent light', draw: drawPics, minH: 260 });
  const hist = stage({ aspect: 1.25, label: '', name: N_('Speckle statistics'), draw: drawHist, cls: 'plain', minH: 230 });
  const cut = stage({ aspect: 1.25, label: '', name: N_('A cut through the image'), draw: drawCut, cls: 'plain', minH: 230 });
  const tf = stage({ aspect: 3, label: '', name: N_('Transfer functions'), draw: drawTf, cls: 'plain', minH: 180 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([pics.el, h('div.grid-2', {}, card(hist), card(cut)), card(tf)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ── computation on the pool ──
  let gen = 0, R = null, INC = {};
  const params = () => { const s = ctl.state; return { kind: s.obj, rough: s.rough, list: looks({ sigma: s.sigma, frames: +s.frames, pol: s.pol }) }; };
  async function compute() {
    const my = ++gen, p = params(), key = JSON.stringify([p.kind, p.rough, ctl.state.sigma, ctl.state.frames, ctl.state.pol]);
    if (R && R.key === key) { R = { ...R }; finish(); return; }
    busy = true; pics.redraw();
    const [parts, inc] = await Promise.all([
      parallel('speckleLooks', split(p.list, Math.max(1, poolSize())).map((list) => ({ kind: p.kind, rough: p.rough, list }))),
      INC[p.kind] || run('speckleIncoh', { kind: p.kind }),
    ]);
    INC[p.kind] = inc;
    if (my !== gen) return;
    const I = new Float32Array(NGRID * NGRID);
    for (const a of parts) for (let i = 0; i < I.length; i++) I[i] += a[i];
    R = { key, I, looks: p.list.length, kind: p.kind };
    busy = false; finish();
  }
  let busy = false;
  // the camera's pixels (binning) and the statistics of the plain paper
  function finish() {
    if (!R) return;
    const k = +ctl.state.pix, b = bin(R.I, NGRID, k), st = stats(b.a, b.m, REGION[R.kind]), inc = bin(INC[R.kind], NGRID, k);
    R.view = { b, st, inc, k };
    words(); pics.redraw(); hist.redraw(); cut.redraw(); tf.redraw();
  }
  const request = debounce(() => compute().catch(console.error), 80);
  function update() { request(); words(); tf.redraw(); }

  function words() {
    const s = ctl.state, lam = +s.lam / 1000, d = speckleSize(lam, s.N), NA = 1 / (2 * s.N), V = R && R.view;
    const indep = +s.frames * (s.pol ? 2 : 1), pred = 1 / Math.sqrt(indep);
    ro.replaceChildren(readouts([
      ['Speckle size 1.22 λN', `${fmt(d, 3)} µm`],
      ['Coherent cut-off NA/λ', `${fmt(NA / lam * 1000, 3)} lp/mm`],
      ['Incoherent cut-off 2NA/λ', `${fmt((2 * NA) / lam * 1000, 3)} lp/mm`],
      ['Patterns added (source points × frames × polarisations)', R ? `${R.looks}` : '…'],
      ['Speckle contrast σ/⟨I⟩ on the paper', V ? fmt(V.st.contrast, 3) : '…'],
      ['… for fully developed speckle, 1/√(frames × polarisations)', fmt(pred, 3)],
      ['Independent patterns it is worth, 1/C²', V ? fmt(1 / V.st.contrast ** 2, 3) : '…'],
      ['Camera pixel', `${fmt((+s.pix / 4) * lam * s.N, 3)} µm (${fmt(+s.pix / 4 / 1.22, 3)} × speckle)`],
    ]));
    calc.say(t('Light from neighbouring bumps of the surface reaches each point of the image with random phases, so it interferes into grains about <strong>{d} µm</strong> across (1.22 λN, the size of the lens\'s diffraction spot). Adding {L} patterns leaves a contrast of <strong>{c}</strong>; fully developed speckle averaged over {m} independent patterns would have 1/√{m} = {p}.', {
      d: fmt(d, 3), L: R ? R.looks : '…', c: V ? fmt(V.st.contrast, 3) : '…', m: indep, p: fmt(pred, 3),
    }));
    calc.set(String.raw`\begin{aligned}
    I(\mathbf x) &= \sum_{s,m,p}\Big|\mathcal F^{-1}\big[P(\mathbf f-\mathbf f_s)\,\mathcal F\{A\,e^{i\varphi_p}e^{i\psi_m}\}\big]\Big|^2,\qquad \varphi = \frac{4\pi h}{\lambda},\ \sigma_\varphi = 4\pi\times ${texNum(s.rough, 3)} = ${texNum(4 * Math.PI * s.rough, 3)}\ \text{rad}\\
    d_\text{speckle} &= 1.22\,\lambda N = 1.22\times ${texNum(lam, 3)}\ \mu\text{m}\times ${texNum(s.N, 3)} = ${texNum(d, 3)}\ \mu\text{m},\qquad C = \frac{\sigma_I}{\langle I\rangle} \approx \frac{1}{\sqrt{M}} = ${texNum(pred, 3)}\ (\text{measured } ${V ? texNum(V.st.contrast, 3) : '\\ldots'})
    \end{aligned}`);
  }

  // ── drawing ──
  function drawPics(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const V = R && R.view;
    if (!V) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('Computing…'), w / 2, hh / 2); return; }
    const top = 34, S = Math.min(w / 2 - 18, hh - top - 26), rects = [{ x: w / 4 - S / 2, y: top, w: S, h: S }, { x: (3 * w) / 4 - S / 2, y: top, w: S, h: S }];
    const tint = TINT[ctl.state.lam], m = V.b.m, near = (a, u, v) => a[Math.min(m - 1, Math.floor(v * m)) * m + Math.min(m - 1, Math.floor(u * m))];
    const scale = 2 * V.st.mean, si = stats(V.inc.a, V.inc.m, REGION[R.kind]).mean;
    paint(pics, rects[0], (u, v, o) => { const x = near(V.b.a, u, v) / scale; o[0] = encode(x * tint[0]); o[1] = encode(x * tint[1]); o[2] = encode(x * tint[2]); }, `${R.key}|${V.k}|${ctl.state.lam}`, 0);
    paint(pics, rects[1], (u, v, o) => { const x = (V.k > 1 ? near(V.inc.a, u, v) : bilinear(V.inc.a, m, m, u * m - 0.5, v * m - 0.5)) / (2 * si); o[0] = o[1] = o[2] = encode(x); }, `inc|${R.kind}|${V.k}`, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const um = (NGRID * (+ctl.state.lam / 1000) * ctl.state.N) / 4;
    ctx.fillText(t('Laser, contrast {c} · field {f} µm', { c: fmt(V.st.contrast, 2), f: fmt(um, 3) }), rects[0].x + S / 2, rects[0].y + S + 6);
    ctx.fillText(t('Incoherent light, same lens'), rects[1].x + S / 2, rects[1].y + S + 6);
    // the paper area used for the statistics
    const [x0, y0, x1, y1] = REGION[R.kind];
    ctx.strokeStyle = 'rgba(106,215,255,0.7)'; ctx.setLineDash([4, 3]); ctx.strokeRect(rects[0].x + (x0 / NGRID) * S, rects[0].y + (y0 / NGRID) * S, ((x1 - x0) / NGRID) * S, ((y1 - y0) / NGRID) * S); ctx.setLineDash([]);
    if (busy) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(rects[0].x, rects[0].y, 90, 18); ctx.fillStyle = '#ffd27a'; ctx.textAlign = 'left'; ctx.fillText(t('computing…'), rects[0].x + 6, rects[0].y + 3); }
  }

  function drawHist(ctx, w, hh) {
    const V = R && R.view;
    if (!V) return;
    const nb = 40, top = 5, hb = new Float64Array(nb);
    for (const x of V.st.values) { const i = Math.floor((x / top) * nb); if (i >= 0 && i < nb) hb[i]++; }
    const n = V.st.values.length, pts = [];
    for (let i = 0; i < nb; i++) if (hb[i]) pts.push([((i + 0.5) / nb) * top, hb[i] / n / (top / nb)]);
    const xs = Array.from({ length: 120 }, (_, i) => 0.02 + (i / 119) * (top - 0.02)), L = 1 / V.st.contrast ** 2;
    plot(ctx, w, hh, {
      title: N_('Speckle statistics: brightness of the white paper'), x: { min: 0, max: top, label: N_('intensity / mean') }, y: { min: 1e-3, max: 3, log: true, label: N_('probability density') },
      series: [
        { data: xs.map((x) => [x, Math.exp(-x)]), color: '#9aa3b2', width: 1.4, dash: [5, 4], label: N_('one pattern: e^(−I)') },
        { data: xs.map((x) => [x, gammaPdf(x, Math.max(1, Math.min(200, L)))]), color: '#ffd27a', width: 1.6, label: N_('gamma law with L = 1/C²') },
        { data: pts, color: '#6ad7ff', points: true, r: 2.6, label: N_('this image') },
      ], legend: true,
    });
  }

  function drawCut(ctx, w, hh) {
    const V = R && R.view;
    if (!V) return;
    const m = V.b.m, row = Math.floor(((R.kind === 'edge' ? 64 : 185) / NGRID) * m), lam = +ctl.state.lam / 1000, px = (V.k * lam * ctl.state.N) / 4;
    const si = stats(V.inc.a, V.inc.m, REGION[R.kind]).mean, a = [], b = [];
    for (let i = 0; i < m; i++) { a.push([i * px, V.b.a[row * m + i] / V.st.mean]); b.push([i * px, V.inc.a[row * m + i] / si]); }
    const x0 = R.kind === 'edge' ? 96 * (px / V.k) : 0, x1 = R.kind === 'edge' ? 160 * (px / V.k) : m * px;
    plot(ctx, w, hh, {
      title: R.kind === 'edge' ? N_('Across the edge') : N_('Across the bars'), x: { min: x0, max: x1, label: N_('position (µm)') }, y: { min: 0, max: R.kind === 'edge' && ctl.state.rough === 0 ? 1.4 : 4, label: N_('intensity / paper') },
      series: [{ data: b, color: '#ffffff', width: 1.6, dash: [5, 4], label: N_('incoherent') }, { data: a, color: '#6be3a4', width: 1.6, label: N_('laser, this setting') }],
      hlines: R.kind === 'edge' ? [{ y: 1.187, label: N_('coherent overshoot 1.18'), color: 'rgba(255,214,120,0.6)' }] : [], legend: true,
    });
  }

  function drawTf(ctx, w, hh) {
    const s = ctl.state, xs = Array.from({ length: 241 }, (_, i) => (i / 240) * 2.4);
    plot(ctx, w, hh, {
      title: N_('Transfer functions of the same round lens'), x: { min: 0, max: 2.4, label: N_('spatial frequency (units of NA/λ)') }, y: { min: 0, max: 1.1, label: N_('transfer') },
      series: [{ data: xs.map((f) => [f, ctf(f)]), color: '#6be3a4', width: 2, label: N_('coherent (of the field)') }, { data: xs.map((f) => [f, otf(f)]), color: '#ffffff', width: 1.6, dash: [5, 4], label: N_('incoherent OTF (of the intensity)') }],
      vlines: s.sigma > 0 ? [{ x: 1 + s.sigma, label: N_('partially coherent cut-off (1 + σ)NA/λ'), color: '#ffd27a' }] : [], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[C = \frac{\sigma_I}{\langle I\rangle} = \frac{1}{\sqrt{M}},\qquad d_\text{speckle}\approx 1.22\,\lambda N\]
<p>Fully developed speckle has a contrast of 1: the brightness of a point follows the exponential law, and a third of the points are brighter than average. Adding M independent patterns, from a moving diffuser, two polarisations or a larger source, lowers the contrast to 1/√M: 16 frames give 0.25. The grains are as large as the lens's diffraction spot: 5 µm for green light at f/8, so stopping down makes speckle coarser.</p>`,
    String.raw`Scalar Fourier optics with a round pupil and no aberrations; the rough surface is a random phase screen with independent heights from pixel to pixel (no height correlation, no shadowing); partial coherence by Abbe's method with source points FC/2 apart; the diffuser gives fully random phases; one grey level per pixel without photon noise. Speckle seen by the eye or a camera through its own lens is subjective speckle, as here; speckle on a screen in free space (objective speckle) has a size set by the illuminated area instead.`));
  root.append(theory('Coherent light and speckle', String.raw`
<div class="theory-cols"><div>
<h3>Speckle</h3>
<p>Each point of the image receives light from a patch of the surface as large as the lens's resolution spot, from many bumps with random phases \(\varphi = 4\pi h/\lambda\). The field is a sum of many random phasors, a circular complex Gaussian variable, so the intensity has the exponential density \(p(I) = e^{-I/\langle I\rangle}/\langle I\rangle\) and contrast \(\sigma_I/\langle I\rangle = 1\) (Goodman 1975). Its autocorrelation is the squared modulus of the pupil's Fourier transform, \(|2J_1(v)/v|^2\) for a round lens, so grains are about \(1.22\lambda N\) across. When the surface is smoother than about λ/8 a specular part remains and the contrast falls.</p>
<h3>Reducing it</h3>
<p>The sum of M independent fully developed patterns follows a gamma law with contrast \(1/\sqrt M\). Independent patterns come from diffusers moved during the exposure, wavelength or polarisation diversity, an extended source (several angles of illumination), or camera pixels larger than a grain. Laser projectors combine several of these.</p>
</div><div>
<h3>Coherent imaging</h3>
<p>With coherent illumination a lens is linear in the field: the image field is the object field filtered by the pupil, so the transfer function is the pupil itself, flat up to NA/λ and zero beyond. Incoherent imaging is linear in intensity with the OTF, the pupil's autocorrelation, which extends to 2NA/λ but falls gradually. An edge imaged coherently rings, with the amplitude overshoot of Gibbs's phenomenon, 1.09, an intensity overshoot of 18 %; the incoherent edge does not. Partially coherent light (a source of size σ times the pupil) passes frequencies up to (1 + σ)NA/λ, which is why microscope condensers and lithography scanners shape their sources.</p>
</div></div>`));
  root.append(references([
    'J. W. Goodman, "Statistical properties of laser speckle patterns", in <i>Laser Speckle and Related Phenomena</i>, ed. J. C. Dainty, Springer (1975).',
    'J. W. Goodman, <i>Speckle Phenomena in Optics</i>, 2nd ed., SPIE Press (2020).',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 4th ed., W. H. Freeman (2017).',
    'H. H. Hopkins, "On the diffraction theory of optical images", Proc. R. Soc. A 217, 408 (1953).',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999).',
  ]));
  return () => { gen++; [pics, hist, cut, tf].forEach((st) => st.destroy()); };
}
