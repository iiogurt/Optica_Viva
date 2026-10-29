// Underwater photography: colour lost with depth and distance, ports, and strobes against backscatter.
import { h, controls, stage, readouts, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { oetf, gamutClip } from '../lib/color.js';
import { WATERS, absorption, patchColours, bandsLeft, flatPort, domeImage, backscatterStart } from '../lib/underwater.js';
import { t } from '../lib/i18n.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Water swallows red light first: a few metres down, a red fish looks brown and everything turns blue-green. The light loses colour twice, once on its way down from the surface and again on its way from the subject to the camera, so getting close matters as much as staying shallow. A flash restores the colours, because its light only travels the short distance to the subject and back.</p>
<p>The camera's window to the water changes the picture too. A flat window magnifies and narrows the view like a glass of water; a curved dome keeps the wide view but makes the lens focus on a ghost image just in front of the dome.</p>`, [
    'Take the colour chart from 2 m to 15 m deep without the strobe: reds fade first, then oranges.',
    'At 15 m, move the subject from 3 m to 0.5 m: half the colour loss comes from the distance.',
    'Swing the <strong>strobes</strong> outwards: the lit water in front of the lens moves away, and with it the backscatter.',
  ]));

  const ctl = controls({
    h1: { type: 'heading', label: 'Water and light' },
    water: { type: 'seg', label: 'Water', value: 'ocean', options: Object.entries(WATERS).map(([k, w]) => [k, w[0]]) },
    z: { type: 'range', label: 'Depth', min: 0, max: 30, step: 0.5, value: 10, unit: 'm' },
    r: { type: 'range', label: 'Distance to the subject', min: 0.2, max: 5, log: true, value: 1.5, unit: 'm' },
    wb: { type: 'toggle', label: 'White balance on a grey card', value: true },
    h2: { type: 'heading', label: 'Port and strobes' },
    hfov: { type: 'range', label: 'Lens field of view in air', min: 20, max: 120, step: 1, value: 84, unit: '°' },
    f: { type: 'range', label: 'Focal length (full frame)', min: 10, max: 100, log: true, value: 24, unit: 'mm' },
    R: { type: 'range', label: 'Dome radius', min: 0.05, max: 0.2, step: 0.005, value: 0.1, unit: 'm' },
    s: { type: 'range', label: 'Strobe distance from the lens axis', min: 0.1, max: 0.6, step: 0.01, value: 0.3, unit: 'm' },
    beta: { type: 'range', label: 'Strobe beam half-angle (in water)', min: 20, max: 60, step: 1, value: 40, unit: '°' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const chart = stage({ aspect: 2.5, label: 'Colour chart (CIE test colours and grey): at the surface, by daylight at depth, with a strobe', draw: drawChart, minH: 200 });
  const spec = stage({ aspect: 2.4, label: '', draw: drawSpectrum, cls: 'plain', minH: 200 });
  const geo = stage({ aspect: 2.4, label: '', draw: drawGeometry, cls: 'plain', minH: 200 });
  root.append(lab([chart.el, h('div.grid-2', {}, h('div.card', { style: { padding: '8px' } }, spec.el), h('div.card', { style: { padding: '8px' } }, geo.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  function update() {
    const st = ctl.state, ag = WATERS[st.water][1];
    const surface = patchColours({ z: 0, r: 0, ag, wb: false });
    const ambient = patchColours({ z: st.z, r: st.r, ag, wb: st.wb });
    const strobe = patchColours({ z: st.z, r: st.r, ag, strobe: true, wb: st.wb });
    const bands = bandsLeft(st.z + st.r, ag), fp = flatPort(st.hfov, st.f), dome = domeImage(st.r, st.R);
    const bs = backscatterStart(st.s, st.beta, st.hfov / 2);
    M = { st, ag, surface, ambient, strobe, bands, fp, dome, bs };
    ro.replaceChildren(readouts([
      ['Light path (down + across)', (st.z + st.r).toFixed(1) + ' m'],
      ['Red left (600–700 nm)', (bands.red * 100).toPrecision(2) + ' %'],
      ['Green left (500–600 nm)', (bands.green * 100).toPrecision(2) + ' %'],
      ['Blue left (400–500 nm)', (bands.blue * 100).toPrecision(2) + ' %'],
      ['Flat port: field in water', fp.hfovWater.toFixed(0) + '° (from ' + st.hfov + '°)'],
      ['Flat port: colour fringe at the edge', fp.lateral.toFixed(0) + ' µm on the sensor'],
      ['Dome: focus the lens at', (dome.fromPupil * 100).toFixed(0) + ' cm (infinity → ' + (dome.atInfinity * 100).toFixed(0) + ' cm)'],
      ['Strobe light enters the view at', (bs * 100).toFixed(0) + ' cm in front of the port'],
    ]));
    calc.say(`After ${(st.z + st.r).toFixed(1)} m of ${WATERS[st.water][0].toLowerCase()}, <strong>${(bands.red * 100).toPrecision(2)} %</strong> of the red light is left against ${(bands.blue * 100).toPrecision(2)} % of the blue. A strobe's light travels only ${(2 * st.r).toFixed(1)} m. Behind a dome, the lens must focus at <strong>${(dome.fromPupil * 100).toFixed(0)} cm</strong> to see a subject ${st.r} m away.`);
    calc.set(String.raw`\begin{aligned}
    T(\lambda) &= e^{-a(\lambda)\,(z + r)}\\
    a(650) &= ${texNum(absorption(650, ag), 3)}\ \text{m}^{-1}\\
    a(450) &= ${texNum(absorption(450, ag), 3)}\ \text{m}^{-1}\\
    v &= ${texNum(dome.v * 100, 3)}\ \text{cm}\ \text{(dome image)}
    \end{aligned}`);
    chart.redraw(); spec.redraw(); geo.redraw();
  }

  function drawChart(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!M) return;
    const rows = [['Surface', M.surface], [`${M.st.z} m deep, ${M.st.r} m away`, M.ambient], ['With a strobe', M.strobe]];
    const n = 15, x0 = 150, cw = (w - x0 - 10) / n, ch = (hh - 30) / 3;
    rows.forEach(([label, cols], j) => {
      ctx.fillStyle = '#9aa1b5'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(label, 8, 22 + j * ch + ch / 2);
      cols.forEach((c, i) => {
        const g = gamutClip(c.map((v) => Math.max(0, v))).map((v) => Math.round(oetf(Math.min(1, v)) * 255));
        ctx.fillStyle = `rgb(${g[0]},${g[1]},${g[2]})`;
        ctx.fillRect(x0 + i * cw + 2, 22 + j * ch + 3, cw - 4, ch - 6);
      });
    });
  }

  function drawSpectrum(ctx, w, hh) {
    if (!M) return;
    const { st, ag } = M, ls = range(400, 700, 61);
    plot(ctx, w, hh, {
      title: 'Light left after the path through the water', x: { min: 400, max: 700, label: 'wavelength (nm)' }, y: { min: 0, max: 1, label: 'transmission' },
      series: [
        { data: ls.map((l) => [l, Math.exp(-absorption(l, ag) * (st.z + st.r))]), color: '#6ad7ff', label: 'daylight: depth + distance' },
        { data: ls.map((l) => [l, Math.exp(-absorption(l, ag) * 2 * st.r)]), color: '#ffb547', label: 'strobe: twice the distance' },
      ], legend: true, legendX: 70, legendY: hh - 70,
    });
  }

  // top view: port, camera field in water, strobe beams and where they first cross the field
  function drawGeometry(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!M) return;
    const { st, bs } = M, s = (hh - 50) / (2 * (st.s + 0.3)), zmax = (w - 40) / s, X = (z) => 20 + z * s, cy = hh / 2 + 10, Y = (x) => cy - x * s;
    const tw = (st.hfov / 2) * Math.PI / 180, tb = (st.beta * Math.PI) / 180;
    ctx.fillStyle = 'rgba(106,215,255,0.10)'; ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(zmax), Y(zmax * Math.tan(tw))); ctx.lineTo(X(zmax), Y(-zmax * Math.tan(tw))); ctx.closePath(); ctx.fill();
    for (const sg of [1, -1]) {
      ctx.fillStyle = 'rgba(255,181,71,0.12)'; ctx.beginPath(); ctx.moveTo(X(0), Y(sg * st.s)); ctx.lineTo(X(zmax), Y(sg * st.s + zmax * Math.tan(tb))); ctx.lineTo(X(zmax), Y(sg * st.s - zmax * Math.tan(tb))); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb547'; ctx.fillRect(X(0) - 8, Y(sg * st.s) - 5, 10, 10);
    }
    ctx.strokeStyle = '#ff6b6b'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(bs), 12); ctx.lineTo(X(bs), hh - 8); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e9ebf3'; ctx.fillRect(X(0) - 12, cy - 8, 12, 16);
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t('top view: strobe light enters the view at {v1} cm', { v1: (bs * 100).toFixed(0) }), 8, 14);
  }

  update();

  root.append(rule(String.raw`\[T = e^{-a(\lambda)\,(z + r)},\qquad a(650\,\text{nm}) \approx 0.35\ \text{m}^{-1}\]
<p>Pure water absorbs red light about forty times more strongly than blue. At 10 m depth plus 1.5 m to the subject, only \(e^{-0.35 \times 11.5} \approx 2\) % of the light at 650 nm is left, against 90 % at 450 nm. A strobe 1.5 m away loses red light over only 3 m: \(e^{-0.35\times3} \approx 35\) %, which is why underwater photographers say "get close, then closer".</p>`,
    String.raw`Absorption alone underestimates the loss: particles and plankton scatter light, add a veil of blue-green haze and absorb more, especially in coastal and lake water. Downwelling daylight also travels slanted paths, so the effective depth is somewhat greater than the actual depth.`));

  root.append(theory('Water, ports and strobes', String.raw`
<div class="theory-cols"><div>
<h3>Absorption</h3>
<p>The page uses the pure-water absorption coefficients of Pope &amp; Fry (1997), from 0.006 m⁻¹ at 420 nm to 0.6 m⁻¹ at 700 nm, plus dissolved organic matter \(a_g(\lambda) = a_g(440)\,e^{-0.015(\lambda-440)}\) (0.3 m⁻¹ for coastal water, 1.2 m⁻¹ for a green lake), which absorbs blue and turns water green. CIE daylight D65 crosses depth \(z\) and distance \(r\); a 5500 K strobe crosses \(2r\). The chart shows the CIE test colours (TCS 1–14) and a grey card, converted to sRGB; white balance adapts the grey card to neutral with the Bradford transform, as a camera's custom white balance does, but cannot recover light that is no longer there.</p>
</div><div>
<h3>Ports</h3>
<p>Behind a flat port a ray at angle \(\theta_a\) in air left the water at \(\theta_w = \arcsin(\sin\theta_a/n)\), with \(n = 1.333\): the field narrows and the image is magnified by about \(n\) at the centre and more at the edges (pincushion distortion). Water's dispersion (\(n_F - n_C \approx 0.006\)) spreads colours at the frame's edge. A dome centred on the entrance pupil keeps the field but acts as a negative lens: from \(n/u + 1/v = (1-n)/R\), a subject at infinity forms a virtual image \(R/(n-1) \approx 3R\) in front of the dome, which the lens must focus on.</p>
<h3>Backscatter</h3>
<p>Particles lit between the lens and the subject reflect strobe light into the lens. Strobes at a lateral distance \(s\) aimed forwards with beam half-angle \(\beta\) first light the field of half-angle \(\theta\) at \(s/(\tan\beta + \tan\theta)\); moving them out pushes the lit water away from the lens.</p>
</div></div>`));
  root.append(references([
    'R. M. Pope and E. S. Fry, "Absorption spectrum (380–700 nm) of pure water. II. Integrating cavity measurements", Appl. Opt. 36, 8710 (1997).',
    'C. D. Mobley, <i>Light and Water: Radiative Transfer in Natural Waters</i>, Academic Press (1994).',
    'M. Edge, <i>The Underwater Photographer</i>, 4th ed., Focal Press (2010): ports, strobes and backscatter.',
  ]));
  return () => [chart, spec, geo].forEach((s) => s.destroy());
}
