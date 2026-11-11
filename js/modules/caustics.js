// Caustics on a pool floor and apparent depth: sunlight traced through a wavy water surface.
import { h, controls, stage, readouts, fmt, texNum, reducedMotion } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { makeWaves, focusDepth, landing1D, apparentDepth } from '../lib/caustics.js';
import { nWater, absorption } from '../lib/underwater.js';
import { aces } from '../lib/flarescene.js';
import { t, N_, localNum } from '../lib/i18n.js';

const SIZE = 1.2; // m: the patch of water traced (it repeats seamlessly)
const LAMS = [640, 545, 460]; // nm: the red, green and blue channels

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>On a sunny day the floor of a pool is covered in a moving net of bright lines. Each little wave on the surface is a weak lens: its curved crest bends sunlight towards a point, its trough spreads it out. A few tens of centimetres to a few metres down, the light from neighbouring parts of the wave crosses and piles up into bright lines.</p>
<p>The same bending makes the pool look shallower than it is: from straight above, a coin 1 metre down looks only 75 cm deep. Seen at a slant it looks shallower still, and slightly smeared.</p>`, [
    'Make the <strong>pool deeper</strong> from 0.3 m to 3 m: the lines sharpen, then turn into a fine, busy pattern. Where are they sharpest?',
    'Lower the <strong>Sun</strong>: the net stretches away from the Sun.',
    'Turn on <strong>Colours</strong> and make the waves steeper: the brightest lines get coloured edges. Why?',
  ]));

  const ctl = controls({
    A: { type: 'range', label: 'Wave height (amplitude)', min: 0.5, max: 20, log: true, value: 4, unit: 'mm' },
    lam: { type: 'range', label: 'Wavelength of the waves', min: 5, max: 100, log: true, value: 30, unit: 'cm' },
    D: { type: 'range', label: 'Depth of the pool', min: 0.1, max: 5, log: true, value: 1.5, unit: 'm' },
    el: { type: 'range', label: 'Height of the Sun', min: 20, max: 90, step: 1, value: 70, unit: '°' },
    colour: { type: 'toggle', label: 'Colours (three wavelengths)', value: true },
    move: { type: 'toggle', label: 'Moving waves', value: false },
    view: { type: 'range', label: 'Looking at a coin on the floor, from the vertical', min: 0, max: 75, step: 1, value: 40, unit: '°' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const floor = stage({ aspect: 2, label: 'The pool floor from above (two tiles of a 1.2 m patch that repeats)', draw: drawFloor, minH: 240 });
  const side = stage({ aspect: 2.6, label: '', draw: drawSide, cls: 'plain', minH: 220 });
  const depth = stage({ aspect: 2.2, label: '', draw: drawDepth, cls: 'plain', minH: 220 });
  root.append(lab([floor.el, h('div.card', { style: { padding: '6px' } }, side.el), h('div.card', { style: { padding: '6px' } }, depth.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('caustics');
  let R = null, W = null, time = 0, raf = 0, alive = true;
  const wavesOf = (st) => ({ A: st.A / 1000, lam: st.lam / 100, size: SIZE });
  function request() {
    const st = ctl.state, moving = st.move && !reducedMotion();
    const lams = st.colour ? LAMS : [545];
    job('caustics', { waves: wavesOf(st), floor: { N: moving ? 128 : 192, D: st.D, el: (st.el * Math.PI) / 180, az: 0, lams, rpp: moving ? 2 : 4, t: time } }).then((r) => {
      R = { img: r, N: moving ? 128 : 192, st: { ...st }, lams };
      floor.redraw();
      if (alive && st.move && !reducedMotion()) { time += 0.08; raf = requestAnimationFrame(request); }
    }, () => {});
  }
  function update() {
    cancelAnimationFrame(raf);
    const st = ctl.state;
    W = makeWaves(wavesOf(st));
    words(); side.redraw(); depth.redraw();
    request();
  }
  function words() {
    const st = ctl.state, n = nWater(545), main = W.waves[0], k = Math.hypot(main.kx, main.ky), Dstar = focusDepth(main.a, k, n);
    const ad0 = apparentDepth(st.D, 0, n), ad = apparentDepth(st.D, (st.view * Math.PI) / 180, n);
    ro.replaceChildren(readouts([
      ['Depth where the main wave focuses', fmt(Dstar, 3) + ' m'],
      ['Steepest slope of the surface', fmt((Math.atan(main.a * k) * 180) / Math.PI, 2) + '°'],
      ['Index of water (545 nm)', fmt(n, 4)],
      ['Apparent depth from straight above', fmt(ad0.tangential, 3) + ' m'],
      ['Apparent depth at the chosen angle (in the plane / across it)', `${fmt(ad.tangential, 3)} / ${fmt(ad.sagittal, 3)} m`],
    ]));
    calc.say(t('Each crest of the main wave focuses sunlight about <strong>{Ds} m</strong> down, so a floor {D} m deep is {where}. A coin on the floor looks <strong>{a0} m</strong> deep from straight above, and {at} m seen {v}° from the vertical.', {
      Ds: fmt(Dstar, 3), D: fmt(st.D, 3), where: st.D < 0.6 * Dstar ? t('above the focus: soft, wide bright patches') : st.D < 1.6 * Dstar ? t('near the focus: the sharpest lines') : t('beyond the focus: a fine, criss-crossed net'),
      a0: fmt(ad0.tangential, 3), at: fmt(ad.tangential, 3), v: st.view,
    }));
    calc.set(String.raw`\begin{aligned}
    \mathbf t &= \frac{\mathbf d}{n} + \left(\frac{\cos i}{n} - \cos r\right)\mathbf m\\
    D^* &= \frac{n}{(n-1)\,A k^2} = \frac{${texNum(n, 4)}}{${texNum(n - 1, 3)}\times${texNum(main.a * 1000, 3)}\,\text{mm}\times(${texNum(k, 3)}\,\text{m}^{-1})^2} = ${texNum(Dstar, 3)}\ \text{m}\\
    d' &= \frac{d}{n} = ${texNum(ad0.tangential, 3)}\ \text{m},\quad d'_t = \frac{d\cos^3\theta_a}{n\cos^3\theta_w} = ${texNum(ad.tangential, 3)}\ \text{m}
    \end{aligned}`);
  }

  // the floor: pale blue paint with dark grout every 25 cm, lit by the traced light and seen through
  // the water (absorbed on the way down and back up), through one tone curve
  function drawFloor(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { img, N, st, lams } = R, tint = lams.map((l) => Math.exp(-absorption(l, 0) * 2 * st.D)), paintC = [0.55, 0.78, 0.9];
    const sun = Math.sin((st.el * Math.PI) / 180);
    paint(floor, { x: 0, y: 0, w, h: hh }, (u, v, o) => {
      const xm = u * 2 * SIZE, ym = v * SIZE, gx = Math.abs(((xm / 0.25) % 1) - 0.5), gy = Math.abs(((ym / 0.25) % 1) - 0.5), grout = gx > 0.47 || gy > 0.47 ? 0.45 : 1;
      const X = ((u * 2) % 1) * N - 0.5, Y = v * N - 0.5;
      for (let c = 0; c < 3; c++) {
        const ch = lams.length === 3 ? c : 0, E = bilinear(img[ch], N, N, (X + N) % N, Y);
        o[c] = encode(aces(0.4 * sun * E * paintC[c] * grout * tint[lams.length === 3 ? c : 1] + 0.02));
      }
    }, keyOf(R));
  }
  function drawSide(ctx, w, hh) {
    if (!W) return;
    const st = ctl.state, n = nWater(545), main = W.waves[0], k = Math.hypot(main.kx, main.ky), Lw = (2 * Math.PI) / k, A = main.a;
    const xs = Array.from({ length: 49 }, (_, i) => (i / 48) * 2 * Lw), series = [];
    const zs = (x) => A * Math.sin(k * x);
    for (const x of xs) series.push({ data: [[x * 100, zs(x) * 100], [landing1D(A, k, n, st.D, x) * 100, -st.D * 100]], color: 'rgba(255,214,120,0.55)', width: 1 });
    const surf = Array.from({ length: 200 }, (_, i) => { const x = (i / 199) * 2 * Lw; return [x * 100, zs(x) * 100]; });
    const Ds = focusDepth(A, k, n);
    plot(ctx, w, hh, {
      title: N_('Side view: sunlight through two waves, overhead Sun'), x: { min: 0, max: 2 * Lw * 100, label: N_('across the wave (cm)') }, y: { min: -st.D * 100 * 1.05, max: Math.max(5, A * 400), label: N_('height (cm)') },
      series: [...series, { data: surf, color: '#6ad7ff', width: 2, label: N_('water surface') }],
      hlines: [{ y: -st.D * 100, color: 'rgba(255,255,255,0.4)', label: N_('floor') }, ...(Ds < st.D * 1.05 ? [{ y: -Ds * 100, color: 'rgba(255,181,71,0.6)', label: N_('focus of a crest') }] : [])],
    });
  }
  function drawDepth(ctx, w, hh) {
    const st = ctl.state, n = nWater(545), tan = [], sag = [];
    for (let a = 0; a <= 80; a += 1) { const r = apparentDepth(st.D, (a * Math.PI) / 180, n); tan.push([a, r.tangential]); sag.push([a, r.sagittal]); }
    plot(ctx, w, hh, {
      title: N_('How deep the floor looks'), x: { min: 0, max: 80, label: N_('viewing angle from the vertical (°)') }, y: { min: 0, max: st.D * 1.05, label: N_('apparent depth (m)') },
      series: [{ data: tan, color: '#6ad7ff', width: 2, label: N_('lines in the plane of view') }, { data: sag, color: '#ffb547', width: 2, dash: [5, 3], label: N_('lines across it') }],
      hlines: [{ y: st.D, color: 'rgba(255,255,255,0.35)', label: N_('true depth') }], vlines: [{ x: st.view, color: 'rgba(255,255,255,0.4)', label: '' }],
    });
  }
  update();

  root.append(rule(String.raw`\[D^* = \frac{n}{(n-1)\,A k^2}\]
<p>A crest of height \(A\) and wavenumber \(k = 2\pi/\Lambda\) is a weak lens of radius \(1/(Ak^2)\); in water (\(n = 1.33\)) it focuses sunlight about four times its radius below the surface. For ripples 4 mm high and 30 cm long that is about 2.3 m: the bright lines are sharpest at the bottom of a deep pool, and in a shallow one they are soft. Straight down, things look \(1/n = 75\,\%\) as deep as they are.</p>`,
    String.raw`For gentle waves (slopes of a few degrees) and a flat floor. Steep or breaking waves, bubbles and the Sun's own size (half a degree, which blurs lines at depths beyond a metre or two by about a centimetre) are left out; so is light reflected from the floor back to the surface.`));
  root.append(theory('Refraction at a moving surface', String.raw`
<div class="theory-cols"><div>
<h3>Rays through the surface</h3>
<p>The water surface \(z = h(x, y, t)\) is a sum of travelling waves \(a_i\sin(\mathbf k_i\cdot\mathbf r - \omega_i t + \phi_i)\) with the deep-water dispersion \(\omega = \sqrt{gk}\). Its unit normal is \(\mathbf m = (-h_x, -h_y, 1)/\sqrt{1 + h_x^2 + h_y^2}\). Sunlight of direction \(\mathbf d\) enters along \(\mathbf t = \mathbf d/n + (\cos i/n - \cos r)\,\mathbf m\) (Snell's law in vector form) and reaches the floor at depth \(D\). The laboratory traces sixteen rays per floor pixel per wavelength (four while the waves move) and counts where they land; the patch's wave vectors are multiples of \(2\pi/L\), so the pattern repeats without seams, and the mean brightness stays that of flat water.</p>
<h3>Caustics</h3>
<p>Where the map from surface point to floor point folds, neighbouring rays cross and the brightness would be infinite in geometric optics: the caustic. For one wave \(h = A\sin kx\) and an overhead Sun the landing point is \(X \approx x + D\,\frac{n-1}{n}Ak\cos kx\); it first folds (\(dX/dx = 0\)) at \(D^* = n/[(n-1)Ak^2]\). Below that depth the fold lines are the familiar bright net; in reality diffraction and the Sun's size keep them finite (catastrophe optics).</p>
</div><div>
<h3>Apparent depth</h3>
<p>Rays from a point at depth \(d\) leave the water at angle \(\theta_a\) with \(\sin\theta_a = n\sin\theta_w\). Their extensions back into the water meet at different depths for neighbouring rays in the plane of view (tangential) and around it (sagittal):</p>
\[d'_t = \frac{d\cos^3\theta_a}{n\cos^3\theta_w},\qquad d'_s = d\,\frac{\tan\theta_w}{\tan\theta_a}.\]
<p>Straight down both equal \(d/n\); at a slant the image is astigmatic, which is why tiles on a pool floor look drawn out and blurred near the far side.</p>
<h3>Colour</h3>
<p>Water's index falls from 1.341 in the blue to 1.331 in the red, so the blue image of a caustic lies slightly deeper than the red one: steep waves give the brightest lines coloured edges. The water also absorbs red light along the path down and back up.</p>
</div></div>`));
  root.append(references([
    'J. F. Nye, <i>Natural Focusing and Fine Structure of Light: Caustics and Wave Dislocations</i>, Institute of Physics Publishing (1999).',
    'M. V. Berry &amp; C. Upstill, "Catastrophe optics: morphologies of caustics and their diffraction patterns", Progress in Optics 18, 257 (1980).',
    'D. K. Lynch &amp; W. Livingston, <i>Color and Light in Nature</i>, 2nd ed., Cambridge University Press (2001).',
    'E. Hecht, <i>Optics</i>, 5th ed., Pearson (2017), §5.2: refraction at a plane surface and apparent depth.',
  ]));
  return () => { alive = false; cancelAnimationFrame(raf); [floor, side, depth].forEach((s) => s.destroy()); };
}
