// Images made by diffraction alone: a Fresnel zone plate that focuses light with rings instead of
// glass, and a grating that re-forms its own image at the Talbot distance.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paintMap } from '../lib/pixels.js';
import { lut } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { axialI, lensPeak, orderFocus, efficiency, focalProfile, talbotLength } from '../lib/zoneplate.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>A lens is not the only way to focus light. A <em>zone plate</em> is a flat disc of rings, alternately clear and dark, drawn so that light passing every clear ring arrives at one point in step. It focuses like a lens, though only a tenth of the light goes into the focus, and its focal length changes strongly with colour. Zone plates focus X-rays, which no glass lens can bend.</p>
<p>A grating of fine stripes does something stranger: at certain distances behind it, the light draws a perfect copy of the stripes, with no lens at all.</p>`, [
    'Change the <strong>wavelength</strong> from green to red: does the zone plate’s focus move closer or farther?',
    'Switch to a <strong>phase</strong> zone plate: how much brighter is the focus?',
    'Make the grating period <strong>2 µm</strong>: do the copies of the stripes still come back perfectly?',
  ]));

  const ctl = controls({
    hz: { type: 'heading', label: 'Zone plate' },
    f: { type: 'range', label: 'Focal length (at the design wavelength)', min: 10, max: 1000, log: true, value: 100, fmt: (v) => `${fmt(v, 3)} mm` },
    N: { type: 'range', label: 'Number of zones', min: 4, max: 200, step: 2, value: 40 },
    kind: { type: 'seg', label: 'Zones', value: 'amplitude', options: [['amplitude', 'Opaque rings'], ['phase', 'Phase steps (half a wave)']] },
    lam0: { type: 'range', label: 'Design wavelength', min: 400, max: 700, step: 5, value: 550, unit: 'nm' },
    lam: { type: 'range', label: 'Wavelength of the light', min: 400, max: 700, step: 5, value: 550, unit: 'nm' },
    ht: { type: 'heading', label: 'Talbot self-imaging' },
    d: { type: 'range', label: 'Grating period', min: 1, max: 100, log: true, value: 20, fmt: (v) => `${fmt(v, 3)} µm` },
    p: { type: 'range', label: 'Open fraction of the grating', min: 0.1, max: 0.9, step: 0.05, value: 0.5 },
    exact: { type: 'toggle', label: 'Exact propagation (else paraxial)', value: true },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const plate = stage({ aspect: 1, label: 'The zone plate', draw: drawPlate, minH: 220 });
  const axis = stage({ aspect: 1, label: '', draw: drawAxis, cls: 'plain', minH: 220 });
  const spot = stage({ aspect: 2.3, label: '', draw: drawSpot, cls: 'plain', minH: 200 });
  const carpetSt = stage({ aspect: 2.3, label: 'Talbot carpet: light behind the grating (across: two periods; along: 0 … 2 z_T)', draw: drawCarpet, minH: 200 });
  const corr = stage({ aspect: 2.3, label: '', draw: drawCorr, cls: 'plain', minH: 200 });
  const note = h('p.note', {}, t('Computing the Talbot carpet…'));
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([h('div.grid-2', {}, plate.el, card(axis)), card(spot), carpetSt.el, note, card(corr)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('talbot');
  let T = null, tKey = '', timer = 0;
  const zpOf = (st) => ({ f: st.f / 1000, lam0: st.lam0 * 1e-9, N: st.N, kind: st.kind });
  const grOf = (st) => ({ d: st.d * 1e-6, p: st.p, lam: st.lam * 1e-9, exact: st.exact });

  function update() {
    const st = ctl.state, zp = zpOf(st), lam = st.lam * 1e-9;
    words(st, zp, lam);
    [plate, axis, spot, corr].forEach((x) => x.redraw());
    const g = grOf(st), k = JSON.stringify(g);
    if (k === tKey) return;
    tKey = k;
    clearTimeout(timer);
    timer = setTimeout(() => {
      note.textContent = t('Computing the Talbot carpet…');
      job('talbot', g).then((r) => {
        T = { ...r, key: k, g };
        note.textContent = t('The field behind a grating of {d} µm period lit at {l} nm: {n} diffraction orders, each with its {mode} propagation phase. Bright copies of the grating return at z_T = 2d²/λ = {zt}; halfway, the copies are shifted by half a period.', { d: fmt(g.d * 1e6, 3), l: Math.round(g.lam * 1e9), n: r.orders, mode: g.exact ? t('exact') : t('paraxial'), zt: r.zT >= 1e-3 ? `${fmt(r.zT * 1e3, 3)} mm` : `${fmt(r.zT * 1e6, 3)} µm` });
        { const q = ctl.state; words(q, zpOf(q), q.lam * 1e-9); }
        carpetSt.redraw(); corr.redraw();
      }, (e) => console.error(e));
    }, T ? 150 : 0);
  }
  function words(st, zp, lam) {
    const rN = Math.sqrt(zp.N * zp.lam0 * zp.f), dr = rN - Math.sqrt((zp.N - 1) * zp.lam0 * zp.f), f1 = orderFocus(zp, lam), zT = talbotLength(st.d * 1e-6, lam);
    ro.replaceChildren(readouts([
      ['Plate radius, outermost zone width', `${fmt(rN * 1000, 3)} mm, ${fmt(dr * 1e6, 3)} µm`],
      ['Focal length at this wavelength', `${fmt(f1 * 1000, 4)} mm`],
      ['Light into the focus (first order)', `${fmt(100 * efficiency(st.kind), 3)} %`],
      ['Resolution 1.22 Δr_N', `${fmt(1.22 * dr * 1e6 * (f1 / zp.f), 3)} µm`],
      ['Talbot length 2d²/λ', zT >= 1e-3 ? `${fmt(zT * 1e3, 3)} mm` : `${fmt(zT * 1e6, 3)} µm`],
      ['Self-image at z_T (correlation)', T && T.key === JSON.stringify(grOf(st)) ? fmt(T.exact[60], 4) : '…'],
    ]));
    calc.say(t('The zone plate focuses {l} nm light <strong>{f} mm</strong> behind it, with <strong>{e} %</strong> of the light in the focus; its outermost zone, <strong>{dr} µm</strong> wide, sets the sharpness. The grating copies itself every <strong>{zt}</strong>.', { l: st.lam, f: fmt(f1 * 1000, 4), e: fmt(100 * efficiency(st.kind), 3), dr: fmt(dr * 1e6, 3), zt: zT >= 1e-3 ? `${fmt(zT * 1e3, 3)} mm` : `${fmt(zT * 1e6, 3)} µm` }));
    calc.set(String.raw`\begin{aligned}
    r_n &= \sqrt{n\lambda_0 f},\quad r_N = ${texNum(rN * 1000, 3)}\ \text{mm}\\
    f(\lambda) &= f\,\frac{\lambda_0}{\lambda} = ${texNum(f1 * 1000, 4)}\ \text{mm}\\
    \eta_1 &= ${st.kind === 'phase' ? String.raw`\tfrac{4}{\pi^2}` : String.raw`\tfrac{1}{\pi^2}`} = ${texNum(efficiency(st.kind), 3)}\\
    z_T &= \frac{2d^2}{\lambda} = ${texNum(zT * 1e3, 3)}\ \text{mm}
    \end{aligned}`);
  }

  function drawPlate(ctx, w, hh) {
    const st = ctl.state, zp = zpOf(st), rN = Math.sqrt(zp.N * zp.lam0 * zp.f), cx = w / 2, cy = hh / 2, R = Math.min(w, hh) / 2 - 8, s = R / rN;
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    // from the outside in: each zone painted over the next
    for (let n = zp.N; n >= 1; n--) {
      const r = Math.sqrt(n * zp.lam0 * zp.f) * s;
      ctx.fillStyle = n % 2 ? '#e8eef8' : st.kind === 'phase' ? '#8fa6c8' : '#0b0e16';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.fillText(t('{n} zones, {d} mm across', { n: zp.N, d: fmt(2 * rN * 1000, 3) }), 8, hh - 8);
  }
  function drawAxis(ctx, w, hh) {
    const st = ctl.state, zp = zpOf(st), lam = st.lam * 1e-9, ref = lensPeak(zp, lam), zs = Array.from({ length: 900 }, (_, i) => zp.f * (0.08 + (1.32 * i) / 899));
    plot(ctx, w, hh, {
      title: 'Light along the axis behind the plate', x: { min: zs[0] * 1000, max: zs[zs.length - 1] * 1000, label: 'distance behind the plate (mm)' }, y: { min: 1e-4, max: 1, log: true, label: 'irradiance / perfect lens' },
      series: [{ data: zs.map((z) => [z * 1000, Math.max(1e-6, axialI(zp, lam, z) / ref)]), color: '#ffb547', width: 1.8, label: t('zone plate') }],
      vlines: [1, 3, 5].map((m) => ({ x: orderFocus(zp, lam, m) * 1000, color: 'rgba(255,255,255,0.3)' })), hlines: [{ y: efficiency(st.kind), color: 'rgba(120,230,160,0.5)' }], legend: true,
    });
  }
  function drawSpot(ctx, w, hh) {
    const st = ctl.state, zp = zpOf(st), lam = st.lam * 1e-9, f1 = orderFocus(zp, lam), rN = Math.sqrt(zp.N * zp.lam0 * zp.f), r1 = (0.61 * lam * f1) / rN;
    const rs = Array.from({ length: 160 }, (_, i) => (i / 159) * 4 * r1), ref = lensPeak(zp, lam), I = focalProfile(zp, lam, f1, rs, 24);
    const airy = (r) => { const v = (2 * Math.PI * rN * r) / (lam * f1); if (v < 1e-9) return 1; let tt = v / 2, s = tt; for (let k = 1; k < 60; k++) { tt *= -(v * v) / (4 * k * (k + 1)); s += tt; } return (2 * s / v) ** 2; };
    plot(ctx, w, hh, {
      title: 'Across the focus: zone plate and a perfect lens of the same size', x: { min: 0, max: rs[rs.length - 1] * 1e6, label: 'distance from the axis (µm)' }, y: { min: 0, max: 1.05, label: 'irradiance / perfect lens peak' },
      series: [
        { data: rs.map((r, i) => [r * 1e6, I[i] / ref]), color: '#ffb547', width: 2.2, label: t('zone plate') },
        { data: rs.map((r) => [r * 1e6, airy(r)]), color: 'rgba(255,255,255,0.55)', width: 1.3, dash: [5, 3], label: t('perfect lens (Airy)') },
      ],
      vlines: [{ x: r1 * 1e6, color: 'rgba(255,255,255,0.25)' }], legend: true,
    });
  }
  function drawCarpet(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!T) return;
    // transpose: z runs left to right, x top to bottom
    const { a, nx, nz } = T, b = new Float32Array(nx * nz);
    let top = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = a[j * nx + i]; b[i * nz + j] = v; if (v > top) top = v; }
    paintMap(carpetSt, { x: 2, y: 28, w: w - 4, h: hh - 50 }, { a: b, w: nz, h: nx, lut: INF, value: (v) => Math.sqrt(v / top) }, T.key);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([4, 3]);
    for (const q of [0.25, 0.5, 0.75]) { const x = 2 + q * (w - 4); ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, hh - 22); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10.5px "JetBrains Mono", monospace';
    ['z_T/2', 'z_T', '3z_T/2'].forEach((s, i) => ctx.fillText(s, 2 + (0.25 * (i + 1)) * (w - 4) + 3, hh - 8));
  }
  function drawCorr(ctx, w, hh) {
    if (!T) { plot(ctx, w, hh, { title: 'How well the grating re-forms along the way', x: { min: 0, max: 2, label: 'distance (Talbot lengths)' }, y: { min: -1, max: 1, label: 'correlation with the grating' }, series: [] }); return; }
    plot(ctx, w, hh, {
      title: 'How well the grating re-forms along the way', x: { min: 0, max: 2, label: 'distance (Talbot lengths)' }, y: { min: -1, max: 1, label: 'correlation with the grating' },
      series: [
        { data: T.zs.map((z, i) => [z / T.zT, T.paraxial[i]]), color: 'rgba(255,255,255,0.5)', width: 1.4, dash: [5, 3], label: t('paraxial') },
        { data: T.zs.map((z, i) => [z / T.zT, T.exact[i]]), color: '#6ad7ff', width: 2.2, label: t('exact') },
      ],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.25)' }], legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[r_n = \sqrt{n\lambda f},\qquad z_T = \frac{2d^2}{\lambda}\]
<p>A zone plate for green light (550 nm) with a 100 mm focal length has its first ring 0.23 mm out and its fortieth 1.48 mm out, only 19 µm wide; the outermost width sets the resolution, about 1.22 times it. A grating of 20 µm period copies itself every \(2\times(20\ \mu\text{m})^2/550\ \text{nm} = 1.45\) mm.</p>`,
    String.raw`Both laws are paraxial: zones must be much wider than the wavelength and the grating period much longer, or the copies blur (try 2 µm). A zone plate focuses only one colour; its other orders (f/3, f/5 …) and the light passing straight through add a background.`));
  root.append(theory('Focusing and imaging by diffraction', String.raw`
<div class="theory-cols"><div>
<h3>The zone plate</h3>
<p>Seen from a point at distance \(f\), a plane wave's Fresnel zones are rings whose edges lie half a wave farther each time: \(r_n = \sqrt{n\lambda f}\) in the paraxial limit (exactly, \(r_n^2 = n\lambda f + n^2\lambda^2/4\)). In \(q = \rho^2\) every zone is an interval of the same width \(\lambda f\), and the field on the axis at distance \(z\),</p>
\[U(z) = -\frac{i\pi}{\lambda z}\sum_n t_n\int_{q_{n-1}}^{q_n}e^{i\pi q/\lambda z}\,dq,\]
<p>is a sum of elementary integrals. At \(z = f\) each open zone contributes \(2\) in magnitude, all in step, so \(N\) zones of which half are open give \(|U|^2 = N^2\); a perfect lens of the same aperture gives \((\pi N)^2\). The ratio, \(1/\pi^2 = 10.1\,\%\), is the plate's diffraction efficiency: the share of the light in the first-order focus. A phase plate, which delays the other zones by half a wave instead of blocking them, gives \(4/\pi^2 = 40.5\,\%\). The transmission is periodic in \(q\), so it has Fourier components that focus at \(f/3, f/5, \dots\) with efficiencies \(1/m^2\pi^2\), and one that passes straight through.</p>
<p>The focal length is \(f\lambda_0/\lambda\): the plate's dispersion is large and opposite to that of glass. The focal spot is the Airy pattern of the plate's aperture; its first zero is at \(0.61\lambda f/r_N = 1.22\,\Delta r_N\), with \(\Delta r_N\) the width of the outermost zone. X-ray microscopes reach tens of nanometres this way, limited by how fine the outermost zones can be made.</p>
</div><div>
<h3>The Talbot effect</h3>
<p>A grating of period \(d\) splits a plane wave into orders \(m\) with transverse frequencies \(m/d\). Behind it, each order travels with the phase \(kz\sqrt{1 - (m\lambda/d)^2}\); in the paraxial limit the phase differences are \(-\pi\lambda z m^2/d^2\). At the Talbot distance \(z_T = 2d^2/\lambda\) every \(m^2\) term is a multiple of \(2\pi\), and the field repeats the grating exactly (Talbot 1836; explained by Rayleigh 1881). At \(z_T/2\) the odd orders are reversed and the copy is shifted by half a period; at fractions of \(z_T\) the field is a sum of shifted copies, drawing the fractal "carpet". For a grating with equal bars and gaps, at \(z_T/4\) the light is uniform.</p>
<p>When \(d\) is only a few wavelengths, the exact phases \(\sqrt{1 - (m\lambda/d)^2}\) are no longer quadratic in \(m\), the orders never all come back in step, and the self-images fade: the correlation chart shows it. Even a coarse grating is not wholly paraxial: its highest orders, \(m\lambda/d\) close to 1, carry the sharp edges of the bars, so the copies return with softened edges (a correlation of 0.91 for 20 µm at 550 nm, against exactly 1 in the paraxial limit). Talbot imaging is used to print gratings without contact, and Talbot–Lau interferometers use it for X-ray phase imaging and for wavefront sensing.</p>
<h3>Approximations</h3>
<p>Scalar diffraction of a plane wave of one wavelength; thin, perfectly opaque or perfectly phase-shifting zones and bars; an infinite grating. The Talbot field's Fourier series is truncated at 40 orders (and at the evanescent ones), which leaves small ripples at the edges of the bars.</p>
</div></div>`));
  root.append(references([
    'H. F. Talbot, “Facts relating to optical science. No. IV”, <em>Philosophical Magazine</em> (December 1836).',
    'Lord Rayleigh, “On copying diffraction-gratings, and on some phenomena connected therewith”, <em>Philosophical Magazine</em> (5) 11, 196–205 (1881).',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), ch. 8: Fresnel zones and diffraction.',
  ]));

  return () => { clearTimeout(timer); [plate, axis, spot, carpetSt, corr].forEach((x) => x.destroy()); };
}
