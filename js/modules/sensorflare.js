// Sensor (red-dot) flare: the sensor's microlenses diffract the light of a bright source back up,
// the IR-cut filter reflects it down again, and a grid of coloured dots appears around the source.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { wavelengthCSS } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { LAM, SENS, filterTR, edgeAt, microlensOrders, landing, criticalN } from '../lib/sensorflare.js';
import { t } from '../lib/i18n.js';

const SUN = (0.5333 / 2) * (Math.PI / 180); // the Sun's angular radius

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'cinema'] }));
  root.append(idea(String.raw`<p>Photograph a street lamp or the Sun with the lens stopped down, and a neat grid of red dots may appear around it. The lens is not to blame. The sensor's surface is a regular pattern of tiny lenses, one per pixel, and a regular pattern bends light into a few fixed directions, as the grooves of a CD do (theirs are finer, so a CD spreads the colours wider). That light goes back up, the glass filter just above the sensor reflects it down again, and every direction becomes a dot. Mostly red light makes the trip, because the filter lets red through on the way in but reflects it on the way back.</p>`, [
    'Open the aperture from <strong>f/11</strong> to <strong>f/2.8</strong>: do the dots stay separate?',
    'Switch the filter to <strong>absorbing glass</strong>: what happens to the colour and the brightness of the dots?',
    'Make the pixels <strong>smaller</strong>: do the dots move closer together or farther apart?',
  ]));

  const ctl = controls({
    hs: { type: 'heading', label: 'Light source and lens' },
    src: { type: 'seg', label: 'Source', value: 'lamp', options: [['lamp', 'Street lamp (2700 K)'], ['led', 'White LED'], ['sun', 'The Sun']] },
    ev: { type: 'range', label: 'Brightness (stops above what fills one pixel)', min: 12, max: 34, step: 0.5, value: 21 },
    N: { type: 'range', label: 'Aperture (f-number)', min: 1.4, max: 22, log: true, value: 11, fmt: (v) => `f/${fmt(v, 2)}` },
    fl: { type: 'range', label: 'Focal length (sets the Sun\'s size)', min: 14, max: 200, log: true, value: 24, fmt: (v) => `${Math.round(v)} mm` },
    hz: { type: 'heading', label: 'Sensor and filter' },
    p: { type: 'range', label: 'Pixel pitch', min: 2, max: 8, step: 0.1, value: 4, unit: 'µm' },
    hl: { type: 'range', label: 'Microlens height', min: 0, max: 1.2, step: 0.05, value: 0.5, unit: 'µm' },
    Rs: { type: 'range', label: 'Sensor reflectance', min: 1, max: 15, step: 0.5, value: 5, unit: '%' },
    d: { type: 'range', label: 'Filter height above the sensor', min: 0.3, max: 3, step: 0.05, value: 1, unit: 'mm' },
    kind: { type: 'seg', label: 'IR-cut filter', value: 'interference', options: [['interference', 'Reflecting (interference)'], ['absorptive', 'Absorbing glass']] },
    edge: { type: 'range', label: 'Filter cut-off', min: 600, max: 700, step: 5, value: 650, unit: 'nm' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const photo = stage({ aspect: 1, label: 'The sensor around the source, drawn order by order and wavelength by wavelength', draw: drawPhoto, minH: 260 });
  const side = stage({ aspect: 2.6, label: 'Side view (not to scale): 650 nm orders go up to the filter and back', draw: drawSide, minH: 150 });
  const spec = stage({ aspect: 1.5, label: '', draw: drawSpec, cls: 'plain', minH: 210 });
  const ord = stage({ aspect: 1.5, label: '', draw: drawOrders, cls: 'plain', minH: 210 });
  const note = h('p.note', {}, t('Computing the flare…'));
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([photo.el, note, side.el, h('div.grid-2', {}, card(spec), card(ord))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('sensorFlare');
  let R = null, key = '', timer = 0;
  const filterOf = (st) => (st.kind === 'absorptive' ? { kind: 'absorptive', edge: st.edge, width: 20, Rmin: 0.005 } : { kind: 'interference', edge: st.edge, width: 8, Rmin: 0.01 });
  const optOf = (st) => ({ p: st.p * 1e-6, h: st.hl * 1e-6, d: st.d * 1e-3, N: st.N, Rs: st.Rs / 100, filter: filterOf(st), src: st.src });
  // the view: three orders of red light on each side, plus a disc
  const halfOf = (o) => landing(Math.min(0.8, (3.3 * 660e-9) / o.p), o.d) + o.d / o.N;
  const sunR = (st) => (st.src === 'sun' ? st.fl * 1e-3 * Math.tan(SUN) : 0);

  function update() {
    const st = ctl.state, o = optOf(st), view = { n: 320, half: halfOf(o), sunR: sunR(st) }, k = JSON.stringify([o, view]);
    words(st, o);
    [side, spec, ord].forEach((x) => x.redraw());
    if (k === key) { photo.redraw(); return; }
    key = k;
    clearTimeout(timer);
    timer = setTimeout(() => {
      note.textContent = t('Computing the flare…');
      job('sensorFlare', { o, view }).then((r) => {
        R = { ...r, key: k };
        note.textContent = t('{n} diffraction orders from 400 to 780 nm, each drawn as the defocused image of the lens aperture where it lands; the direct image is the lens\'s Airy pattern{sun}. Brightness is clipped where a pixel saturates.', { n: r.orders, sun: st.src === 'sun' ? t(', and everything is spread over the Sun\'s disc') : '' });
        words(ctl.state, optOf(ctl.state));
        photo.redraw();
      }, (e) => console.error(e));
    }, R ? 200 : 0);
  }

  function words(st, o) {
    const l = 650e-9, s1 = l / o.p, th = Math.asin(Math.min(1, s1)), dx = landing(s1, o.d), dia = (2 * o.d) / o.N, Nc = criticalN(o.p, l);
    const e = microlensOrders(o.h, l, 1), eta = (m, n) => e.find((q) => q.m === m && q.n === n).eta;
    const top = R && R.key === key ? R.dots.find((q) => q.m || q.n) : null;
    const stops = top ? -Math.log2(top.perPixel) : NaN;
    ro.replaceChildren(readouts([
      ['First order at 650 nm', `${fmt((th * 180) / Math.PI, 3)}°`],
      ['Dot spacing (650 nm)', `${fmt(dx * 1000, 3)} mm = ${Math.round(dx / o.p)} px`],
      ['Dot diameter ≈ 2d/N', `${fmt(dia * 1000, 3)} mm`],
      ['Dots separate above', `f/${fmt(Nc, 3)}`],
      ['Filter edge at that angle', st.kind === 'interference' ? `${fmt(edgeAt(o.filter, s1), 4)} nm` : t('does not move')],
      ['Light into orders (0,0), (1,0), (1,1)', `${fmt(100 * eta(0, 0), 3)} %, ${fmt(100 * eta(1, 0), 3)} %, ${fmt(100 * eta(1, 1), 3)} %`],
      ['Brightest dot, below the source', top ? `${fmt(stops, 3)} ${t('stops')} (${top.m}, ${top.n})` : '…'],
    ]));
    const sep = st.N > Nc;
    calc.say(t('Red light leaves the sensor’s grid at <strong>{th}°</strong> and lands <strong>{dx} mm</strong> from the source after the round trip to the filter; each dot is <strong>{dia} mm</strong> across, so at f/{N} the dots are <strong>{sep}</strong>.', { th: fmt((th * 180) / Math.PI, 3), dx: fmt(dx * 1000, 3), dia: fmt(dia * 1000, 3), N: fmt(st.N, 2), sep: sep ? t('separate') : t('merged into a haze') }));
    calc.set(String.raw`\begin{aligned}
    \sin\theta_1 &= \frac{\lambda}{p} = \frac{650\ \text{nm}}{${texNum(st.p, 3)}\ \mu\text{m}} = ${texNum(s1, 3)}\\
    \Delta x &= 2d\tan\theta_1 = ${texNum(dx * 1000, 3)}\ \text{mm}\\
    \varnothing &\approx \frac{2d}{N} = ${texNum(dia * 1000, 3)}\ \text{mm}\\
    N_c &= \frac{p}{\lambda} = ${texNum(Nc, 3)}
    \end{aligned}`);
  }

  function drawPhoto(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const st = ctl.state, { img, n, half } = R, g = 2 ** st.ev, sz = Math.min(w, hh) - 4, r = { x: (w - sz) / 2, y: (hh - sz) / 2, w: sz, h: sz };
    paint(photo, r, (u, v, o) => {
      const fx = u * n - 0.5, fy = v * n - 0.5, x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(n - 2, Math.floor(fy))), ax = Math.min(1, Math.max(0, fx - x0)), ay = Math.min(1, Math.max(0, fy - y0));
      for (let c = 0; c < 3; c++) {
        const a = img[3 * (y0 * n + x0) + c], b = img[3 * (y0 * n + x0 + 1) + c], cc = img[3 * ((y0 + 1) * n + x0) + c], d = img[3 * ((y0 + 1) * n + x0 + 1) + c];
        o[c] = encode(Math.min(1, g * ((a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + d * ax) * ay)));
      }
    }, `${R.key}|${st.ev}`);
    // scale bar
    const mm = 2 * half * 1000, bar = mm > 3 ? 1 : mm > 1.2 ? 0.5 : 0.2, px = (bar / mm) * sz;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(r.x + 12, r.y + sz - 16, px, 2);
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillText(`${bar} mm`, r.x + 12, r.y + sz - 22);
  }

  function drawSide(ctx, w, hh) {
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state, o = optOf(st), half = halfOf(o), y0 = hh - 26, yF = 40, X = (x) => w / 2 + (x / half) * (w / 2 - 10), Y = (z) => y0 - (z / o.d) * (y0 - yF);
    // the converging cone from the lens
    const u = Math.asin(1 / (2 * o.N)), top = 30;
    ctx.fillStyle = 'rgba(255,220,150,0.12)'; ctx.beginPath(); ctx.moveTo(X(0), y0); ctx.lineTo(X(-((y0 - top) / (y0 - yF)) * o.d * Math.tan(u)), top); ctx.lineTo(X(((y0 - top) / (y0 - yF)) * o.d * Math.tan(u)), top); ctx.closePath(); ctx.fill();
    // filter and sensor
    ctx.fillStyle = st.kind === 'interference' ? 'rgba(150,200,255,0.35)' : 'rgba(90,150,230,0.55)'; ctx.fillRect(0, yF - 6, w, 6);
    ctx.fillStyle = '#39405a'; ctx.fillRect(0, y0, w, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.fillText(t('IR-cut filter'), 8, yF + 14); ctx.fillText(t('sensor'), 8, y0 + 17);
    ctx.fillText(`d = ${fmt(st.d, 3)} mm`, w - 92, (y0 + yF) / 2);
    const col = wavelengthCSS(650, 0.9);
    for (let m = -4; m <= 4; m++) {
      const s = (m * 650e-9) / o.p;
      if (Math.abs(s) >= 0.97) continue;
      const up = o.d * Math.tan(Math.asin(s)), back = 2 * up;
      if (Math.abs(back) > half * 1.02) continue;
      ctx.strokeStyle = m ? col : 'rgba(255,255,255,0.5)'; ctx.lineWidth = m ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(X(0), y0); ctx.lineTo(X(up), Y(o.d)); ctx.lineTo(X(back), y0); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(back), y0 + 2, 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(String(m), X(back) - 3, y0 - 6);
    }
  }

  function drawSpec(ctx, w, hh) {
    const st = ctl.state, o = optOf(st), s1 = Math.min(0.95, 650e-9 / o.p), th = (Math.asin(s1) * 180) / Math.PI;
    const T = LAM.map((l) => filterTR(l, 0, o.filter)[0]), Rr = LAM.map((l) => filterTR(l, s1, o.filter)[1]);
    plot(ctx, w, hh, {
      title: 'Why the dots are red', x: { min: 400, max: 780, label: 'wavelength (nm)' }, y: { min: 0, max: 1.05, label: 'fraction' },
      series: [
        { data: LAM.map((l, i) => [l, T[i]]), color: 'rgba(255,255,255,0.75)', width: 1.6, label: t('passes, straight in') },
        { data: LAM.map((l, i) => [l, Rr[i]]), color: '#6aa8ff', width: 1.6, label: t('reflected at {a}°', { a: fmt(th, 2) }) },
        { data: LAM.map((l, i) => [l, 4 * T[i] * Rr[i]]), color: '#ff6a5a', width: 2.4, fill: 'rgba(255,106,90,0.15)', label: t('round trip × 4') },
        { data: LAM.map((l, i) => [l, SENS[0][i]]), color: 'rgba(255,140,120,0.6)', width: 1.2, dash: [4, 3], label: t('red pixels') },
      ], legend: true,
    });
  }

  function drawOrders(ctx, w, hh) {
    const st = ctl.state, ls = [[460, '#6aa8ff'], [540, '#7fd68f'], [650, '#ff7a6a']];
    plot(ctx, w, hh, {
      title: 'Light the microlenses send into each order', x: { min: -0.3, max: 6.3, label: 'order m (with n = 0)' }, y: { min: 1e-5, max: 1, log: true, label: 'share of the reflected light' },
      series: ls.map(([l, c]) => ({ data: microlensOrders(st.hl * 1e-6, l * 1e-9, 6).filter((q) => q.n === 0 && q.m >= 0).map((q) => [q.m, Math.max(1e-6, q.eta)]), color: c, points: true, label: `${l} nm` })), legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[N_c = \frac{p}{\lambda}\]
<p>The dots are separate when the f-number is larger than the pixel pitch divided by the wavelength. For 4 µm pixels and red light (650 nm), that is f/6.2: at f/11 the dots stand apart, at f/2.8 they merge into a soft red haze. The rule holds for any filter height, because the dots' spacing and their size both grow in proportion to it.</p>`,
    String.raw`The rule compares the first two orders near the centre; far out, the spacing grows faster than the dots. It assumes the sensor repeats with the pixel pitch; a pattern that repeats every two pixels (the colour filters) adds dots halfway between.`));
  root.append(theory('A grating made of pixels', String.raw`
<div class="theory-cols"><div>
<h3>The sensor as a reflective grating</h3>
<p>A sensor reflects a few per cent of the light that reaches it, mostly at the surface of its microlenses. The microlenses repeat with the pixel pitch \(p\), so the reflected light leaves only in the directions of a two-dimensional grating: order \((m, n)\) has direction sines</p>
\[s_x = s_{x,\text{in}} + \frac{m\lambda}{p},\qquad s_y = s_{y,\text{in}} + \frac{n\lambda}{p}.\]
<p>The share of the light in each order is the squared Fourier coefficient of the reflected field over one cell, here \(e^{2ikh(x,y)}\) for a microlens of height profile \(h\) (a thin-element, scalar model: the phase is taken on the surface, and the orders' shares add up to 1). A flat surface sends everything back in the zero order; a curved microlens, a convex mirror, spreads the light over many orders, more of them the taller it is.</p>
<h3>The round trip</h3>
<p>Light leaving the sensor with direction sines \(\mathbf{s}\) reaches the filter at height \(d\) and returns, after reflection, at \(\mathbf{x} = 2d\,\mathbf{s}/\sqrt{1-|\mathbf{s}|^2}\). The lens delivers a cone of directions, a disc of radius \(\sigma = 1/2N\) in direction sines; every order shifts the whole disc by \((m, n)\lambda/p\), so each order lands as a disc, a defocused image of the aperture, about \(2d/N\) across. Neighbouring discs touch when \(\lambda/p = 2\sigma\), at \(N_c = p/\lambda\); stopped down further, the dots are separate, which is why the effect is seen at small apertures. On the page each disc is drawn exactly: every sample looks back along its direction and asks whether that ray came from inside the aperture, with the irradiance \(P/\pi\sigma^2\cdot D^2/(|\mathbf{x}|^2+D^2)^2\), \(D = 2d\), from the change of variables.</p>
</div><div>
<h3>Why red</h3>
<p>The light in a dot crossed the IR-cut filter once on the way in, with transmission \(T(\lambda)\), and was reflected by it once on the way back, with \(R(\lambda,\theta)\). A reflecting (interference) filter absorbs nothing, so \(R = 1 - T\), and the product \(T(1-T)\) is largest at the filter's cut-off edge, where both are one half. Below the edge the filter passes almost everything and reflects little; above it, nothing got through to begin with. The edge of an interference filter moves to shorter wavelengths when the light meets it obliquely,</p>
\[\lambda_c(\theta) = \lambda_c\sqrt{1-\frac{\sin^2\theta}{n_\text{eff}^2}},\]
<p>so the far orders, reflected at larger angles, return a broader band reaching into the orange. An absorbing (blue-glass) filter removes the red instead of reflecting it: what is left is the weak reflection of its coated surface, the same at all wavelengths, and the dots fade by several stops and lose their colour. This is the reason many cameras use hybrid filters with an absorbing layer.</p>
<h3>Approximations</h3>
<p>Scalar diffraction with the microlens phase taken on a thin surface (pixels a few wavelengths wide make this rough, especially for the far orders); a paraboloidal microlens filling its square cell; one reflection at the sensor and one at the filter, with the filter's coating facing the sensor, \(n_\text{eff} = 1.7\), and a model filter edge; light arriving around the normal (the centre of the frame); a pupil filled uniformly in direction sines (an aplanatic lens); model sensitivities of the colour pixels. The dots' positions, sizes and colours follow from the geometry; their absolute brightness depends on the sensor's reflectance and the microlens shape, which are model values here. The colours shown are the camera's white-balanced channels taken as display primaries. Real lenses add their own ghosts and veiling glare, not drawn here.</p>
</div></div>`));
  root.append(references([
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), ch. 8: diffraction gratings.',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 4th ed., W. H. Freeman (2017): thin phase elements and their Fourier coefficients.',
    'H. A. Macleod, <i>Thin-Film Optical Filters</i>, 4th ed., CRC Press (2010): edge filters and the shift of their edge with the angle of incidence.',
    'RED Digital Cinema, “DSMC – Flare Grid Pattern”, support article: the grid of red dots, more visible as the lens is stopped down.',
  ]));

  return () => { clearTimeout(timer); [photo, side, spec, ord].forEach((x) => x.destroy()); };
}
