// The pinhole camera: a hole instead of a lens. Too large a hole blurs by its own shadow, too small a
// one by diffraction; the exact Fresnel pattern behind the hole shows where the sharpest picture
// lies, and that "sharpest" depends on how sharpness is measured.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { latest } from '../lib/compute.js';
import { fresnelN, geomBlur, airyBlur, rayleighD, otf, geomMTF } from '../lib/pinhole.js';
import { t, N_ } from '../lib/i18n.js';

const W = 0.02; // film shown: 20 mm square
const CRIT = { conc: N_('brightest centre per unit light'), ee50: N_('smallest circle holding half the light'), mtf50: N_('highest frequency at half contrast (MTF50)') };
const COL = { conc: '#ffb547', ee50: '#6ad7ff', mtf50: '#c58bff' };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo'] }));
  root.append(idea(String.raw`<p>A pinhole camera is a dark box with a tiny hole instead of a lens. Light from each point of the scene passes through the hole in a narrow beam and paints a small patch on the film, so a picture forms, upside down.</p>
<p>A big hole paints big, overlapping patches: blurry. Making it smaller sharpens the picture only up to a point, because light squeezing through a very small hole spreads out on the other side (diffraction), like water through a narrow gap. The sharpest picture comes from a hole in between, and it gets less light than any lens camera: exposures take seconds.</p>`, [
    'Shrink the <strong>pinhole</strong> from 1 mm to 0.05 mm while watching the star chart: does it keep getting sharper?',
    'Press <strong>Rayleigh’s pinhole</strong>, then double the distance to the film: should the best hole double too?',
    'Look at the <strong>contrast curve</strong> of a hole that is too large: why do some fine spokes appear with black and white swapped?',
  ]));

  const ctl = controls({
    f: { type: 'range', label: 'Distance from the pinhole to the film', min: 20, max: 500, log: true, value: 100, unit: 'mm' },
    d: { type: 'range', label: 'Pinhole diameter', min: 0.05, max: 2, log: true, value: 0.6, fmt: (v) => `${fmt(v, 3)} mm` },
    far: { type: 'toggle', label: 'Subject far away (at infinity)', value: true },
    u: { type: 'range', label: 'Distance to the subject', min: 0.1, max: 20, log: true, value: 1, unit: 'm', when: (st) => !st.far },
    lam: { type: 'range', label: 'Wavelength for the curves', min: 400, max: 700, step: 5, value: 550, unit: 'nm' },
  }, () => update());
  const rayBtn = h('button.btn', { type: 'button', onclick: () => { const s = ctl.state; ctl.set.d(+(rayleighD(s.f / 1000, s.lam * 1e-9, s.far ? Infinity : s.u) * 1000).toFixed(3)); update(); } }, t('Rayleigh’s pinhole'));
  const ro = h('div'), calc = liveCalc();
  const photo = stage({ aspect: 1, label: 'The star chart photographed through the pinhole (20 mm of film)', draw: drawPhoto, minH: 240 });
  const psf = stage({ aspect: 1, label: '', draw: drawPSF, cls: 'plain', minH: 240 });
  const sw = stage({ aspect: 2.3, label: '', draw: drawSweep, cls: 'plain', minH: 230 });
  const mtf = stage({ aspect: 2.3, label: '', draw: drawMTF, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing the diffraction pattern…'));
  const swNote = h('p.note', {}, t('Vertical lines: white, this pinhole; orange, blue and violet, the best pinhole by each measure of sharpness; green, Rayleigh’s 1.9√(λz_e).'));
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([h('div.grid-2', {}, photo.el, card(psf)), note, card(sw), swNote, card(mtf)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, rayBtn)), h('div.card', {}, ro), calc.el]));

  const sweepJob = latest('pinholeSweep'), photoJob = latest('pinholePhoto');
  let S = null, P = null, sKey = '', pKey = '', timer = 0;
  const geo = (st) => ({ f: st.f / 1000, d: st.d / 1000, u: st.far ? Infinity : st.u, lam: st.lam * 1e-9 });

  function update() {
    const st = ctl.state, g = geo(st);
    words(st, g);
    [psf, sw, mtf].forEach((x) => x.redraw());
    // the sweep depends on f, u and λ; the photograph on d, f and u (it uses three wavelengths)
    const sk = JSON.stringify([g.f, g.u, g.lam]), pk = JSON.stringify([g.d, g.f, g.u]);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (sk !== sKey) { sKey = sk; sweepJob('pinholeSweep', { f: g.f, u: g.u, lam: g.lam, dmin: 0.03e-3, dmax: 3e-3 }).then((r) => { S = { ...r, key: sk }; words(ctl.state, geo(ctl.state)); sw.redraw(); }, (e) => console.error(e)); }
      if (pk !== pKey) {
        pKey = pk; note.textContent = t('Computing the diffraction pattern…');
        photoJob('pinholePhoto', { d: g.d, f: g.f, u: g.u, W, n: 256 }).then((r) => { P = { ...r, key: pk, g: { ...g, lam: 550e-9 } }; note.textContent = t('Exact Fresnel diffraction through the hole at 610, 550 and 465 nm, each colour blurred by its own pattern. The chart is 18 mm across on the film; the spokes get finer towards the centre, so the grey patch there shows the size of the blur.'); photo.redraw(); psf.redraw(); }, (e) => console.error(e));
      }
    }, S || P ? 150 : 0);
  }

  function words(st, g) {
    const N = fresnelN(g.d, g.f, g.u, g.lam), fnum = g.f / g.d, dR = rayleighD(g.f, g.lam, g.u), gb = geomBlur(g.d, g.f, g.u), ab = airyBlur(g.d, g.f, g.lam);
    const best = S && S.key === JSON.stringify([g.f, g.u, g.lam]) ? S.best : null;
    // sunny 16: f/16 at 1/ISO s; the pinhole needs (N/16)² times as long
    const t100 = (fnum / 16) ** 2 / 100;
    ro.replaceChildren(readouts([
      ['Fresnel number of the hole', fmt(N, 3)],
      ['f-number f/d', `f/${Math.round(fnum)}`],
      ['Sunlit exposure at ISO 100', t100 >= 1 ? `${fmt(t100, 2)} s` : `1/${Math.round(1 / t100)} s`],
      ['Shadow of the hole, Airy ring diameter', `${fmt(gb * 1000, 3)} mm, ${fmt(ab * 1000, 3)} mm`],
      ['Rayleigh’s pinhole 1.9√(λz_e)', `${fmt(dR * 1000, 3)} mm`],
      ...Object.keys(CRIT).map((k) => [t('Best for: {c}', { c: t(CRIT[k]) }), best ? `${fmt(best[k].d * 1000, 3)} mm = ${fmt(best[k].d / Math.sqrt(g.f * g.lam), 3)} √(fλ)` : '…']),
    ]));
    calc.say(t('This hole spans <strong>{N}</strong> Fresnel zones: {verdict} At f/{F}, a sunlit scene needs about <strong>{tt}</strong> at ISO 100.', {
      N: fmt(N, 2), F: Math.round(fnum), tt: t100 >= 1 ? `${fmt(t100, 2)} s` : `1/${Math.round(1 / t100)} s`,
      verdict: N > 2 ? t('the picture is blurred mostly by the shadow of the hole; a smaller one would be sharper.') : N < 0.3 ? t('the picture is blurred mostly by diffraction; a larger hole would be sharper.') : t('shadow and diffraction are balanced, close to the sharpest picture.'),
    }));
    calc.set(String.raw`\begin{aligned}
    z_e &= \left(\tfrac1u + \tfrac1f\right)^{-1} = ${texNum(1000 * (isFinite(g.u) ? (g.u * g.f) / (g.u + g.f) : g.f), 4)}\ \text{mm}\\
    N &= \frac{d^2}{4\lambda z_e} = ${texNum(N, 3)}\\
    b_\text{shadow} &= d\left(1+\tfrac fu\right) = ${texNum(gb * 1000, 3)}\ \text{mm}\\
    b_\text{Airy} &= 2.44\,\frac{\lambda f}{d} = ${texNum(ab * 1000, 3)}\ \text{mm}\\
    d_\text{Rayleigh} &= 1.9\sqrt{\lambda z_e} = ${texNum(dR * 1000, 3)}\ \text{mm}
    \end{aligned}`);
  }

  function drawPhoto(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!P) return;
    const { img, n } = P, sz = Math.min(w, hh) - 4, r = { x: (w - sz) / 2, y: (hh - sz) / 2, w: sz, h: sz };
    paint(photo, r, (u, v, o) => {
      // the picture is upside down on the film: shown as printed, the right way up
      const x = Math.min(n - 1, Math.floor(u * n)), y = Math.min(n - 1, Math.floor(v * n)), k = 3 * (y * n + x);
      o[0] = encode(img[k]); o[1] = encode(img[k + 1]); o[2] = encode(img[k + 2]);
    }, P.key);
  }
  function drawPSF(ctx, w, hh) {
    if (!P) { plot(ctx, w, hh, { title: 'Image of a point: irradiance across the film', x: { min: 0, max: 1, label: 'distance from the image point (mm)' }, y: { min: 0, max: 1, label: 'irradiance (relative to the hole)' }, series: [] }); return; }
    const pr = P.profiles, g = P.g, reach = 1000 * Math.min(pr[0].rs[pr[0].rs.length - 1], Math.max(geomBlur(g.d, g.f, g.u), airyBlur(g.d, g.f, g.lam || 550e-9))), cols = ['#ff7a6a', '#7fd68f', '#6aa8ff'];
    const gb = geomBlur(g.d, g.f, g.u) * 1000, top = Math.max(...pr.map((p) => Math.max(...p.I)));
    plot(ctx, w, hh, {
      title: 'Image of a point: irradiance across the film', x: { min: 0, max: reach, label: 'distance from the image point (mm)' }, y: { min: 0, max: top * 1.08, label: 'irradiance (relative to the hole)' },
      series: pr.map((p, i) => ({ data: p.rs.map((r, k) => [r * 1000, p.I[k]]), color: cols[i], width: 1.8, label: `${Math.round(p.lam * 1e9)} nm` })),
      vlines: [{ x: gb / 2, color: 'rgba(255,255,255,0.4)' }], legend: true,
    });
  }
  function drawSweep(ctx, w, hh) {
    const st = ctl.state, g = geo(st);
    if (!S || S.key !== JSON.stringify([g.f, g.u, g.lam])) { plot(ctx, w, hh, { title: 'Blur against pinhole diameter', x: { min: 0.03, max: 3, log: true, label: 'pinhole diameter (mm)' }, y: { min: 0.01, max: 10, log: true, label: 'blur diameter (mm)' }, series: [] }); return; }
    const rows = S.rows, mm = (v) => v * 1000;
    let lo = Infinity, hi = 0;
    for (const r of rows) { for (const v of [r.ee50, r.geo, r.airy]) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    plot(ctx, w, hh, {
      title: 'Blur against pinhole diameter', x: { min: 0.03, max: 3, log: true, label: 'pinhole diameter (mm)' }, y: { min: Math.max(1e-3, mm(lo) / 2), max: mm(hi) * 1.2, log: true, label: 'blur diameter (mm)' },
      series: [
        { data: rows.map((r) => [mm(r.d), mm(r.geo)]), color: 'rgba(255,255,255,0.55)', width: 1.4, dash: [5, 3], label: t('shadow of the hole d(1 + f/u)') },
        { data: rows.map((r) => [mm(r.d), mm(r.airy)]), color: 'rgba(255,143,184,0.8)', width: 1.4, dash: [5, 3], label: t('Airy ring 2.44 λf/d') },
        { data: rows.filter((r) => isFinite(r.ee50)).map((r) => [mm(r.d), mm(r.ee50)]), color: '#6ad7ff', width: 2.4, label: t('exact: circle holding half the light') },
      ],
      vlines: [
        { x: st.d, color: 'rgba(255,255,255,0.8)' },
        ...Object.keys(CRIT).map((k) => ({ x: mm(S.best[k].d), color: COL[k] })),
        { x: mm(rayleighD(g.f, g.lam, g.u)), color: 'rgba(127,214,143,0.9)' },
      ],
      legend: true,
    });
  }
  function drawMTF(ctx, w, hh) {
    const st = ctl.state, g = geo(st), cut = g.d / (g.lam * g.f) / 1000, xs = Array.from({ length: 240 }, (_, i) => (cut * (i + 0.5)) / 240);
    const airyMTF = (nu) => { const s = Math.min(1, nu / cut); return (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s)); };
    plot(ctx, w, hh, {
      title: 'Contrast of fine detail (MTF) through this pinhole', x: { min: 0, max: cut, label: 'cycles per mm on the film' }, y: { min: -0.3, max: 1, label: 'contrast transfer' },
      series: [
        { data: xs.map((v) => [v, otf(g.d, g.f, g.u, g.lam, v * 1000)]), color: '#ffffff', width: 2.2, label: t('exact (negative: contrast reversed)') },
        { data: xs.map((v) => [v, geomMTF(geomBlur(g.d, g.f, g.u), v * 1000)]), color: 'rgba(255,255,255,0.5)', width: 1.3, dash: [5, 3], label: t('shadow of the hole alone') },
        { data: xs.map((v) => [v, airyMTF(v)]), color: 'rgba(255,143,184,0.8)', width: 1.3, dash: [5, 3], label: t('diffraction alone (a perfect lens of the same f-number)') },
      ],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.3)' }, { y: 0.5, color: 'rgba(197,139,255,0.4)' }], legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[d_\text{opt} \approx 1.9\sqrt{f\lambda}\]
<p>Rayleigh's rule balances the hole's shadow, about \(d\) wide, against diffraction, about \(2.44\lambda f/d\). For a film 100 mm behind the hole in green light (550 nm) it gives \(1.9\sqrt{0.1\ \text{m}\times550\ \text{nm}} = 0.45\) mm, an f-number of f/225, and a sunlit exposure of about 2 s at ISO 100, against 1/100 s at f/16.</p>`,
    String.raw`The constant depends on what "sharpest" means: the exact pattern gives 1.4 to 1.7 for the measures on this page, and Rayleigh's own 1.9 came from his experiments. It assumes a thin hole in an opaque sheet (a thick plate vignettes the edge of the picture), light near the axis (the film far from the hole compared with its size), and one wavelength at a time.`));
  root.append(theory('Shadow, diffraction and the Fresnel zones', String.raw`
<div class="theory-cols"><div>
<h3>The field behind the hole</h3>
<p>A point source at distance \(u\) sends a spherical wave to a hole of radius \(a\). In the Fresnel approximation the field on the film, at distance \(f\) and radius \(r\) from the geometric image of the point, is</p>
\[U(r) = \frac{2\pi}{\lambda f}\int_0^a e^{i\pi\rho^2/\lambda z_e}\,J_0\!\left(\frac{2\pi r\rho}{\lambda f}\right)\rho\,d\rho,\qquad \frac1{z_e} = \frac1u + \frac1f,\]
<p>relative to the field at the hole. The quadratic phase is that of a lens focused at the wrong distance: a pinhole is a perfectly good lens of infinite focal length, out of focus by exactly the amount the camera needs. Everything depends on the Fresnel number \(N = a^2/\lambda z_e\), the number of half-wave zones the hole spans as seen from the image point. On the axis the integral is elementary,</p>
\[I(0) = \left(\frac{z_e}{f}\right)^2 4\sin^2\frac{\pi N}{2},\]
<p>brightest when the hole holds exactly the first zone (\(N = 1\), \(d = 2\sqrt{\lambda z_e}\)) and dark when it holds two. For \(N \gg 1\) the pattern fills the hole's shadow, \(d(1 + f/u)\) wide; for \(N \ll 1\) it is the Airy pattern of the hole, \(2.44\lambda f/d\) to its first dark ring. The page integrates in \(q = \rho^2\), where the Fresnel phase is linear and each step is integrated exactly, with a Richardson step for the sampled Bessel factor.</p>
<h3>The transfer function</h3>
<p>As a pupil, the hole carries the phase \(\pi\rho^2/\lambda z_e\). The transfer function is the overlap of two copies shifted by \(s = \lambda f\nu\), and there the quadratic phases differ by a linear one, so</p>
\[\mathrm{OTF}(\nu) = \frac1{\pi a^2}\iint_\text{overlap} e^{i2\pi x s/\lambda z_e}\,dx\,dy,\]
<p>a one-dimensional integral over the lens-shaped overlap. It is real and turns negative beyond its first zero: fine detail is then reproduced with black and white swapped, the spurious resolution of an out-of-focus picture. The page checks it against the Hankel transform of the computed pattern to \(10^{-4}\).</p>
</div><div>
<h3>Which hole is sharpest?</h3>
<p>With \(d = c\sqrt{f\lambda}\) (subject far away), the exact pattern gives a different best \(c\) for each measure of sharpness:</p>
<ul>
<li>The most light in the centre for the light let in, \(I(0)/\pi a^2 \propto \sin^2(\pi N/2)/N\), peaks where \(\tan x = 2x\) with \(x = \pi N/2\): \(N = 0.742\), \(c = 1.72\).</li>
<li>The smallest circle holding half the light: \(c \approx 1.50\).</li>
<li>The highest frequency still transferred at half contrast (MTF50): \(c \approx 1.38\).</li>
</ul>
<p>Rayleigh (1891) found \(c \approx 1.9\) by experiment, written as \(f/d = 505\,k\,d\) with \(d\) in millimetres and \(k = 1 + f/u\) for a subject at distance \(u\), that is \(d \approx 1.9\sqrt{\lambda z_e}\); Young (1971) measured pinhole images and found them consistent with the balance between the geometric and diffraction blurs. The differences are modest, because the blur changes slowly near the optimum: from \(1.4\) to \(1.9\sqrt{f\lambda}\) the circle holding half the light grows by about a quarter and MTF50 falls by about a seventh.</p>
<h3>Light</h3>
<p>The f-number of a pinhole, \(f/d\), is in the hundreds, so exposures are \((N_f/16)^2\) times longer than at f/16 in sunlight (the sunny-16 rule: f/16 at \(1/\text{ISO}\) seconds): fractions of a second to seconds by day, minutes indoors. The depth of field is unlimited in the sense that nothing is ever in better focus than the pinhole allows; for near subjects \(z_e < f\), so the best hole shrinks slightly.</p>
<h3>Approximations</h3>
<p>Scalar Fresnel diffraction near the axis; a hole in an infinitely thin, opaque sheet; each colour at one wavelength. Off axis the hole is seen obliquely, as an ellipse further from the film (the light falls off as \(\cos^4\) of the angle, more with a thick plate); the chart is treated as if every point were on the axis.</p>
</div></div>`));
  root.append(references([
    'Lord Rayleigh (J. W. Strutt), “On pin-hole photography”, <em>Philosophical Magazine</em> 31, 87–99 (1891).',
    'M. Young, “Pinhole optics”, <em>Applied Optics</em> 10, 2763–2767 (1971).',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), ch. 8: Fresnel diffraction at a circular aperture.',
  ]));

  return () => { clearTimeout(timer); [photo, psf, sw, mtf].forEach((x) => x.destroy()); };
}
