// In-camera lens corrections: what straightening, brightening and realigning a picture costs.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { distort, vignette, sampling, cropScale, keptShare } from '../lib/corrections.js';
import { t, N_ } from '../lib/i18n.js';

const W = 240, H = 160, FIELD = 0.73; // corner field angle (rad): about a 24 mm lens on full frame

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Small, cheap or very wide lenses are often designed to be imperfect on purpose: straight lines bow outwards, the corners come out darker, and edges get thin coloured fringes. The camera then fixes all three in software before you ever see the picture.</p>
<p>The fixes are not free. To straighten bowed lines the camera stretches the corners, so they are made from fewer real pixels and look softer, and it has to crop the edges. To brighten dark corners it turns their brightness up, and their noise with it.</p>`, [
    'Set strong <strong>barrel distortion</strong> and compare the corner stars in the zoomed views: which one has finer spokes?',
    'Make the corners <strong>2 stops darker</strong> and the light dim: after correction, which part of the picture is noisiest?',
    'Switch each <strong>correction</strong> off in turn and watch what it was hiding.',
  ]));

  const ctl = controls({
    k1: { type: 'range', label: 'Distortion of the lens (k₁: barrel < 0 < pincushion)', min: -0.25, max: 0.15, step: 0.005, value: -0.12 },
    ca: { type: 'range', label: 'Lateral colour (red larger than blue by)', min: 0, max: 0.6, step: 0.01, value: 0.25, fmt: (v) => v.toFixed(2) + ' %' },
    mech: { type: 'range', label: 'Extra darkening of the corners by the lens', min: 0, max: 2.5, step: 0.1, value: 0.8, unit: 'stops' },
    photons: { type: 'range', label: 'Light: photoelectrons per pixel at the centre', min: 20, max: 5000, log: true, value: 300 },
    fixDist: { type: 'toggle', label: 'Correct distortion', value: true },
    fixVig: { type: 'toggle', label: 'Correct vignetting', value: true },
    fixCA: { type: 'toggle', label: 'Correct lateral colour', value: true },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const rawSt = stage({ aspect: 1.5, label: 'As the sensor recorded it', draw: (c, w, hh) => drawPic(c, w, hh, 'raw'), minH: 200 });
  const fixSt = stage({ aspect: 1.5, label: 'After the camera\'s corrections', draw: (c, w, hh) => drawPic(c, w, hh, 'fixed'), minH: 200 });
  const zoom = stage({ aspect: 2.2, label: 'The top-left star, 4× (left: recorded, right: corrected)', draw: drawZoom, minH: 200 });
  const cost = stage({ aspect: 2.4, label: '', draw: drawCost, cls: 'plain', minH: 220 });
  root.append(lab([h('div.grid-2', {}, rawSt.el, fixSt.el), zoom.el, h('div.card', { style: { padding: '6px' } }, cost.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('corrections');
  let R = null;
  const params = (st) => ({ W, H, k1: st.k1, k2: 0, ca: st.ca / 100, field: FIELD, mech: st.mech, photons: st.photons, read: 3, fixDist: st.fixDist, fixVig: st.fixVig, fixCA: st.fixCA });
  function update() {
    const st = ctl.state;
    job('corrections', params(st)).then((r) => { R = { ...r, st: { ...st } }; [rawSt, fixSt, zoom].forEach((s) => s.redraw()); }, () => {});
    words(); cost.redraw();
  }
  function words() {
    const st = ctl.state, s = cropScale(st.k1), smp = sampling(s, st.k1), V = vignette(distort(s, st.k1), FIELD, st.mech), kept = keptShare(st.k1);
    const lin = Math.sqrt(Math.min(1, smp.radial) * Math.min(1, smp.tangential));
    ro.replaceChildren(readouts([
      ['Distortion at the corner (r_d/r_u − 1)', fmt((distort(1, st.k1) - 1) * 100, 3) + ' %'],
      ['Share of the recorded field kept after straightening', fmt(kept * 100, 3) + ' %'],
      ['Sensor pixels per output pixel at the corner (radial / tangential)', `${fmt(smp.radial, 3)} / ${fmt(smp.tangential, 3)}`],
      ['Corner light (vignetting)', fmt(-Math.log2(V), 3) + ' ' + t('stops darker')],
      ['Corner signal-to-noise against the centre', fmt(Math.sqrt(V) * 100, 3) + ' %'],
    ]));
    calc.say(t('Straightening this lens keeps <strong>{kept} %</strong> of what the sensor recorded; in the corners each output pixel is made from about <strong>{lin}</strong> of a sensor pixel, so fine detail there is {loss} % coarser than in the middle. The corners got {stops} stops less light: brightening them leaves their signal-to-noise ratio at {snr} % of the centre\'s.', {
      kept: fmt(kept * 100, 3), lin: fmt(lin, 2), loss: fmt(Math.max(0, (1 - lin) * 100), 2), stops: fmt(-Math.log2(V), 2), snr: fmt(Math.sqrt(V) * 100, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    r_d &= r_u\,(1 + k_1 r_u^2),\quad k_1 = ${texNum(st.k1, 3)}\\
    \frac{dr_d}{dr_u} &= 1 + 3k_1r_u^2 = ${texNum(smp.radial, 3)},\quad \frac{r_d}{r_u} = ${texNum(smp.tangential, 3)}\\
    \frac{\text{SNR}_\text{corner}}{\text{SNR}_\text{centre}} &= \sqrt{V} = ${texNum(Math.sqrt(V), 3)}
    \end{aligned}`);
  }
  // linear values → screen, with the same white for both pictures
  const tone = (v) => encode(Math.max(0, Math.min(1, v * 1.05)));
  function drawPic(ctx, w, hh, which) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const p = R[which], st = R.st, g = which === 'raw' ? 1 : 1;
    const pw = Math.min(w, hh * 1.5), ph = pw / 1.5;
    paint(which === 'raw' ? rawSt : fixSt, { x: (w - pw) / 2, y: (hh - ph) / 2, w: pw, h: ph }, (u, v, o) => {
      for (let c = 0; c < 3; c++) o[c] = tone(bilinear(p[c], W, H, u * W - 0.5, v * H - 0.5) * g);
    }, keyOf(R) + which + st.photons);
  }
  // the top-left star: in the recorded picture it sits where the lens put it, in the corrected one
  // where it belongs; each shown 4× around its own position
  function drawZoom(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const st = R.st, HX = 1.5 / Math.hypot(1.5, 1), HY = 1 / Math.hypot(1.5, 1), cx = -0.62, cy = 0.36, ru = Math.hypot(cx, cy);
    const s = st.fixDist ? cropScale(st.k1) : 1, fd = distort(ru, st.k1) / ru;
    const centres = { raw: [cx * fd, cy * fd], fixed: [cx / s, cy / s] }, side = Math.min((w - 30) / 2, hh - 20);
    ['raw', 'fixed'].forEach((which, k) => {
      const [x0, y0] = centres[which], px = (x0 / (2 * HX) + 0.5) * W, py = (0.5 - y0 / (2 * HY)) * H, half = (0.15 / (2 * HX)) * W, p = R[which];
      paint(zoom, { x: 10 + k * (side + 10), y: (hh - side) / 2, w: side, h: side }, (u, v, o) => {
        const x = px - half + u * 2 * half - 0.5, y = py - half + v * 2 * half - 0.5;
        for (let c = 0; c < 3; c++) o[c] = tone(bilinear(p[c], W, H, x, y));
      }, keyOf(R) + 'z', k);
    });
  }
  function drawCost(ctx, w, hh) {
    const st = ctl.state, s = cropScale(st.k1), rad = [], tan = [], snr = [];
    for (let i = 0; i <= 100; i++) {
      const r = i / 100, ru = r * s, smp = sampling(ru, st.k1), V = vignette(distort(ru, st.k1), FIELD, st.mech);
      rad.push([r, smp.radial]); tan.push([r, smp.tangential]); snr.push([r, Math.sqrt(V)]);
    }
    plot(ctx, w, hh, {
      title: N_('What the corrections cost, from the centre to the corner'), x: { min: 0, max: 1, label: N_('distance from the centre (corner = 1)') }, y: { min: 0, max: 1.4, label: N_('relative to the centre') },
      series: [{ data: rad, color: '#6ad7ff', width: 2, label: N_('sensor pixels per output pixel, radially') }, { data: tan, color: '#6be3a4', width: 2, dash: [5, 3], label: N_('… tangentially') }, { data: snr, color: '#ffb547', width: 2, label: N_('signal-to-noise after brightening') }],
      hlines: [{ y: 1, color: 'rgba(255,255,255,0.25)', label: '' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[\frac{dr_d}{dr_u} = 1 + 3k_1r^2,\qquad \frac{\text{SNR}_\text{corner}}{\text{SNR}_\text{centre}} = \sqrt{V}\]
<p>A lens with barrel distortion \(k_1 = -0.1\) squeezes the corners radially to \(1 - 0.3 = 70\,\%\): straightening stretches them back, so each corner pixel of the result holds only about 0.7 of a recorded pixel's detail along the radius, and about a tenth of the field is cropped. A corner two stops darker (\(V = 1/4\)) keeps half the centre's signal-to-noise ratio however much it is brightened.</p>`,
    String.raw`For distortion and vignetting that change smoothly with radius, and shot-noise-limited exposures (at very low light, read noise makes brightened corners worse still). Real cameras correct with their own lens profiles and often sharpen the corners afterwards, which hides some of the softness and adds its own artefacts.`));
  root.append(theory('Resampling a picture', String.raw`
<div class="theory-cols"><div>
<h3>Distortion</h3>
<p>Brown's model maps an ideal point at radius \(r_u\) to \(r_d = r_u(1 + k_1r_u^2 + k_2r_u^4)\). To correct, the camera computes for each pixel of the output where the lens put that point and interpolates the recorded picture there. The local scale of that mapping is \(dr_d/dr_u\) along the radius and \(r_d/r_u\) around it; where they fall below 1 the output spends more than one pixel on each recorded one, and no interpolation can restore the detail that the sensor did not record. Barrel correction needs a crop: the sensor's rectangle maps to a pincushion-shaped field, and the largest rectangle inside it is kept.</p>
<h3>Lateral colour</h3>
<p>Red and blue are imaged at slightly different scales, a fraction of a per cent here, which puts coloured fringes on edges far from the centre. Fetching each channel at its own scale removes them; the sampling cost is the same as for distortion.</p>
</div><div>
<h3>Vignetting</h3>
<p>A wide lens loses light towards the corners: the natural \(\cos^4\theta\) of the field angle (the pupil seen obliquely, the longer path, the oblique incidence on the sensor) and mechanical vignetting by the barrel. Multiplying the corner by \(1/V\) restores its brightness. With \(N\) photoelectrons at the centre, the corner received \(VN\): its shot noise is \(\sqrt{VN}\), so after brightening the signal-to-noise ratio is \(\sqrt{VN}\), a fraction \(\sqrt V\) of the centre's; read noise \(\sigma_r\) is multiplied by \(1/V\) and matters in dim light.</p>
<h3>What the laboratory does</h3>
<p>It renders a test chart through the lens (2 × 2 samples per pixel on a 240 × 160 sensor, photon and read noise) and then applies the camera's three corrections by bilinear resampling, with the cropped field filling the output.</p>
</div></div>`));
  root.append(references([
    'D. C. Brown, "Decentering distortion of lenses", Photogrammetric Engineering 32, 444 (1966).',
    'S. F. Ray, <i>Applied Photographic Optics</i>, 3rd ed., Focal Press (2002): distortion and the cos⁴ law.',
    'Adobe, "Adobe Camera Model" lens profile specification (2010): distortion, lateral colour and vignetting models.',
    'E. Hecht, <i>Optics</i>, 5th ed., Pearson (2017), §6.3: aberrations.',
  ]));
  return () => [rawSt, fixSt, zoom, cost].forEach((s) => s.destroy());
}
