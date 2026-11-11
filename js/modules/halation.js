// Halation and diffusion filters: two kinds of glow around highlights on film.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { reflectBack, criticalAngle, ringRadius, returned, LAYER } from '../lib/halation.js';
import { aces } from '../lib/flarescene.js';
import { t, N_ } from '../lib/i18n.js';

const N = 512;
const VIEWS = { full: { label: N_('Whole frame'), width: 36, cx: 0, cy: 0 }, crop: { label: N_('4× crop around the lamps'), width: 9, cx: -2, cy: 3.5 } };
const FILTERS = [['0', N_('None')], ['0.06', '1/8'], ['0.12', '1/4'], ['0.22', '1/2'], ['0.35', '1']];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Bright lights on film often wear a reddish glow. Light that the film does not absorb passes into its clear plastic base, reflects off the back of it and comes back a fraction of a millimetre away, exposing the film again around the light. This is <strong>halation</strong>. Most cinema film has a dark backing that soaks up this light; film sold without it glows red around every lamp.</p>
<p>A <strong>diffusion filter</strong> in front of the lens does something different: tiny specks in the glass spread a little of all the light into a soft, wide haze that softens contrast and highlights.</p>`, [
    'Turn the <strong>anti-halation backing</strong> off and look closely at a street lamp in the crop: a red ring appears. Why red?',
    'Make the <strong>film base</strong> thicker: does the ring grow or shrink?',
    'Compare a <strong>1/4 diffusion filter</strong> with halation: which one also lifts the shadows?',
  ]));

  const ctl = controls({
    view: { type: 'seg', label: 'View', value: 'crop', options: Object.entries(VIEWS).map(([k, v]) => [k, v.label]) },
    backing: { type: 'toggle', label: 'Anti-halation backing (remjet)', value: false },
    t: { type: 'range', label: 'Thickness of the film base', min: 60, max: 200, step: 5, value: 125, unit: 'µm' },
    n: { type: 'range', label: 'Refractive index of the base', min: 1.45, max: 1.7, step: 0.01, value: 1.65 },
    base: { type: 'range', label: 'Light reaching the base (red layer)', min: 0.05, max: 0.5, step: 0.01, value: 0.25, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    filter: { type: 'seg', label: 'Diffusion filter', value: '0', options: FILTERS },
    ev: { type: 'range', label: 'Exposure', min: -3, max: 3, step: 0.1, value: 0, unit: 'EV' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const shot = stage({ aspect: 1.5, label: 'The film, developed', draw: drawShot, minH: 260 });
  const ker = stage({ aspect: 1.6, label: '', draw: drawKernel, cls: 'plain', minH: 220 });
  const fres = stage({ aspect: 1.6, label: '', draw: drawFresnel, cls: 'plain', minH: 220 });
  root.append(lab([shot.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, ker.el), h('div.card', { style: { padding: '6px' } }, fres.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('halation');
  let R = null;
  function update() {
    const st = ctl.state, V = VIEWS[st.view], s = +st.filter;
    job('halation', { N, width: V.width, cx: V.cx, cy: V.cy, t: st.t / 1000, n: st.n, backing: st.backing ? 0.02 : 1, base: st.base, s, w: 0.6 }).then((r) => {
      R = { rgb: r, st: { ...st } };
      shot.redraw();
    }, () => {});
    words(); ker.redraw(); fres.redraw();
  }
  function words() {
    const st = ctl.state, tc = criticalAngle(st.n), rc = ringRadius(st.t / 1000, st.n), back = st.backing ? 0.02 : 1, ret = returned(st.n, back), red = ret * st.base * LAYER[0];
    ro.replaceChildren(readouts([
      ['Critical angle at the back of the base', fmt((tc * 180) / Math.PI, 3) + '°'],
      ['Radius of the halation ring 2t·tan θc', fmt(rc * 1000, 3) + ' µm'],
      ['Share of that light reflected back', fmt(ret * 100, 3) + ' %'],
      ['Halation in the red layer, of a highlight\'s exposure', fmt(red * 100, 3) + ' %'],
      ['Light moved into the haze by the filter', fmt(+st.filter * 100, 2) + ' %'],
    ]));
    calc.say(t('Light inside the base beyond <strong>{tc}°</strong> is totally reflected at its back and returns <strong>{rc} µm</strong> from where it entered, about {px} of a 4K frame\'s pixels on 35 mm film. {back}', {
      tc: fmt((tc * 180) / Math.PI, 3), rc: fmt(rc * 1000, 3), px: fmt((rc * 4096) / 24.9, 2),
      back: st.backing ? t('The dark backing absorbs it: almost no glow.') : t('Without a backing the red layer receives {p} % of a highlight\'s exposure again, as a ring around it.', { p: fmt(red * 100, 2) }),
    }));
    calc.set(String.raw`\begin{aligned}
    \theta_c &= \arcsin\frac{1}{n} = ${texNum((tc * 180) / Math.PI, 3)}^\circ\\
    r(\theta) &= 2t\tan\theta,\quad r_c = ${texNum(rc * 1000, 3)}\ \mu\text{m}\\
    \eta &= \int_0^{\pi/2} R(\theta)\,2\sin\theta\cos\theta\,d\theta = ${texNum(ret, 3)}
    \end{aligned}`);
  }
  function drawShot(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { rgb, st } = R, V = VIEWS[st.view], g = 2 ** st.ev * 0.9;
    // the N × N grid spans `width` mm; the frame shown is 3:2 of it, centred
    const fw = Math.min(w, hh * 1.5), fh = fw / 1.5, rows = N / 1.5;
    paint(shot, { x: (w - fw) / 2, y: (hh - fh) / 2, w: fw, h: fh }, (u, v, o) => {
      const x = u * N - 0.5, y = (N - rows) / 2 + v * rows - 0.5;
      for (let c = 0; c < 3; c++) o[c] = encode(aces(Math.max(0, bilinear(rgb[c], N, N, x, y)) * g));
    }, keyOf(R));
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(t('{w} × {h} mm of the film', { w: V.width, h: (V.width / 1.5).toFixed(V.width < 20 ? 1 : 0) }), (w + fw) / 2 - 10, (hh + fh) / 2 - 10);
  }
  function drawKernel(ctx, w, hh) {
    const st = ctl.state, n = st.n, tt = st.t / 1000, back = st.backing ? 0.02 : 1, pts = [];
    // radial density of the returning light per unit area, against r
    for (let i = 1; i < 400; i++) {
      const th = (i / 400) * (Math.PI / 2) * 0.98, r = 2 * tt * Math.tan(th), dr = 2 * tt / Math.cos(th) ** 2;
      const e = reflectBack(th, n) * back * 2 * Math.sin(th) * Math.cos(th);
      pts.push([r * 1000, e / (2 * Math.PI * r * dr) / 1000]);
    }
    plot(ctx, w, hh, {
      title: N_('Where the reflected light lands'), x: { min: 0, max: 1000, label: N_('distance from the highlight (µm)') }, y: { min: 1e-4, max: 1, log: true, label: N_('light per area (relative)') },
      series: [{ data: pts.filter((p) => p[0] <= 1000 && p[1] > 0), color: '#ff7a5a', width: 2 }],
      vlines: [{ x: ringRadius(tt, n) * 1000, color: 'rgba(255,255,255,0.45)', label: N_('ring') }],
    });
  }
  function drawFresnel(ctx, w, hh) {
    const st = ctl.state, n = st.n, pts = [];
    for (let i = 0; i <= 180; i++) { const th = (i / 180) * 90; pts.push([th, reflectBack((th * Math.PI) / 180, n)]); }
    plot(ctx, w, hh, {
      title: N_('Reflection at the back of the base'), x: { min: 0, max: 90, label: N_('angle inside the base (°)') }, y: { min: 0, max: 1.05, label: N_('reflected share') },
      series: [{ data: pts, color: '#6ad7ff', width: 2 }],
      vlines: [{ x: (criticalAngle(n) * 180) / Math.PI, color: 'rgba(255,181,71,0.7)', label: N_('critical angle') }],
    });
  }
  update();

  root.append(rule(String.raw`\[r_c = 2t\tan\theta_c,\qquad \sin\theta_c = \frac1n\]
<p>Light scattered into the film base beyond the critical angle is totally reflected at its back and lands at least \(2t\tan\theta_c\) away. For a 125 µm base of index 1.65 (\(\theta_c = 37^\circ\)) that is 0.19 mm: a ring about four times the size of the grain clumps, and 30 pixels of a 4K scan. For light scattered evenly in all directions (Lambert's law) the share beyond the critical angle is \(\cos^2\theta_c = 63\,\%\), so a dark backing is needed, not just a matt one.</p>`,
    String.raw`The emulsion's scattering is taken as Lambertian, the base as clear, and one bounce only. Real films differ in how much light reaches the base per colour and soften the ring by scattering on the way back; the diffusion filter's halo is a simple exponential, whereas real filters have a sharper core and a long tail.`));
  root.append(theory('Light in the film base', String.raw`
<div class="theory-cols"><div>
<h3>Where halation comes from</h3>
<p>A colour film has three layers: blue-sensitive on top, then green, then red next to a clear base about 0.1–0.2 mm thick. Light that passes the emulsion has been scattered in it and enters the base at all angles. At the base's back surface (base to air) it is reflected with the Fresnel reflectance \(R(\theta)\), and totally beyond \(\theta_c = \arcsin(1/n)\). It returns to the emulsion at \(r = 2t\tan\theta\). With a Lambertian angular spread \(2\sin\theta\cos\theta\,d\theta\), the light per unit area at radius \(r\) is</p>
\[K(r) = \frac{R(\theta)\,2\sin\theta\cos\theta}{2\pi r\,dr/d\theta},\quad \frac{dr}{d\theta} = \frac{2t}{\cos^2\theta},\]
<p>which jumps at \(r_c\) where total reflection begins: the ring. The red layer catches most of it, and the light reaching the base is mostly red, since blue and green have been absorbed higher up: hence the red-orange glow.</p>
</div><div>
<h3>Anti-halation layers</h3>
<p>Still films carry a dyed layer that bleaches in processing; motion-picture negative carries remjet, a carbon backing washed off before development. Films sold for still cameras after removing the remjet (CineStill 800T is the best known) keep the glow. Here the backing reduces the back reflection to 2 %.</p>
<h3>Diffusion filters</h3>
<p>A Pro-Mist or Glimmerglass filter holds small particles that scatter a fraction \(s\) of the light into angles of a few degrees, the rest passing unchanged: on the film each point becomes a sharp point plus a wide, dim halo. Unlike halation it acts on every colour equally and on all the light, so it also lifts the shadows near bright areas. The picture is the scene convolved with both effects by FFT on a 512 × 512 grid.</p>
</div></div>`));
  root.append(references([
    'C. E. K. Mees &amp; T. H. James (eds.), <i>The Theory of the Photographic Process</i>, 3rd ed., Macmillan (1966), ch. 21: halation.',
    'Kodak, "Motion picture film: remjet backing", technical data for Vision3 colour negative films.',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), §1.5: Fresnel formulae and total reflection.',
    'J. Lambert, <i>Photometria</i> (1760): the cosine law of diffuse emission.',
  ]));
  return () => [shot, ker, fres].forEach((s) => s.destroy());
}
