// Mirages: light bent by air whose temperature changes with height, traced exactly.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, keyOf } from '../lib/pixels.js';
import { criticalGradient, rayCurvature, dndT } from '../lib/mirage.js';
import { t, N_ } from '../lib/i18n.js';

// Scenes: the air, where you stand and what you look at.
//   road: a thin layer of very hot air over sunlit asphalt (inferior mirage)
//   sea: cold water under warmer air (superior mirage, looming)
//   fata: cold water with a warm layer higher up (Fata Morgana)
//   plain: the standard atmosphere, for comparison
const SCENES = {
  road: { label: N_('Hot road'), atm: { Ta: 30, dT: 15, h: 0.05, dI: 0 }, z0: 1.6, L: 800, obj: 'car' },
  sea: { label: N_('Cold sea'), atm: { Ta: 10, dT: -6, h: 15, dI: 0 }, z0: 3, L: 20000, obj: 'ship' },
  fata: { label: N_('Fata Morgana'), atm: { Ta: 5, dT: -2, h: 10, dI: 6, zi: 25, wi: 4 }, z0: 3, L: 30000, obj: 'ship' },
  plain: { label: N_('Standard air'), atm: { Ta: 15, dT: 0, h: 1, dI: 0 }, z0: 3, L: 20000, obj: 'ship' },
};
// What stands at distance L: heights (m) and half-widths (m) of simple shapes, and colours.
const OBJECTS = {
  // a car seen from behind, 1.8 m wide, beside a few poles and trees along the road
  car: { H: 1.5, parts: [{ y: [-0.85, -0.55], z: [0, 0.4], c: [0.02, 0.02, 0.02] }, { y: [0.55, 0.85], z: [0, 0.4], c: [0.02, 0.02, 0.02] }, { y: [-0.9, 0.9], z: [0.3, 0.95], c: [0.55, 0.08, 0.06] }, { y: [-0.85, -0.6], z: [0.72, 0.85], c: [0.95, 0.15, 0.08] }, { y: [0.6, 0.85], z: [0.72, 0.85], c: [0.95, 0.15, 0.08] }, { y: [-0.72, 0.72], z: [0.95, 1.45], c: [0.5, 0.07, 0.05] }, { y: [-0.6, 0.6], z: [1.0, 1.38], c: [0.06, 0.08, 0.1] },
    { y: [-6.1, -5.95], z: [0, 4], c: [0.12, 0.12, 0.12] }, { y: [5.6, 5.75], z: [0, 4], c: [0.12, 0.12, 0.12] }, { y: [-9.5, -7.5], z: [1.2, 3.8], c: [0.06, 0.16, 0.06] }, { y: [-8.6, -8.4], z: [0, 1.3], c: [0.15, 0.09, 0.05] }, { y: [7.8, 10], z: [1.4, 4.2], c: [0.07, 0.18, 0.07] }, { y: [8.8, 9], z: [0, 1.5], c: [0.15, 0.09, 0.05] }] },
  ship: { H: 24, parts: [{ y: [-40, 40], z: [0, 7], c: [0.16, 0.035, 0.03] }, { y: [-12, 18], z: [7, 15], c: [0.75, 0.75, 0.72] }, { y: [-4, 6], z: [15, 18], c: [0.7, 0.7, 0.68] }, { y: [0.5, 1.2], z: [18, 24], c: [0.2, 0.2, 0.22] }, { y: [-30, -26], z: [7, 12], c: [0.6, 0.15, 0.1] }] },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video', 'space'] }));
  root.append(idea(String.raw`<p>Light travels a little faster in warm air than in cold air, so it bends: always towards the colder air. Over a road baking in the sun the air just above the surface is very hot, the light from the sky curves back up before it reaches the road, and you see the sky down there, like a puddle of water. That is a mirage, not a trick of the eye: a camera records it too.</p>
<p>Over cold water it goes the other way: light curves down, following the surface, and ships beyond the horizon rise into view, stretched or stacked into towers.</p>`, [
    'On the <strong>Hot road</strong>, make the hot layer thinner and hotter: the "puddle" grows and the car appears twice, once upside down.',
    'Choose <strong>Standard air</strong>, then <strong>Cold sea</strong>: the ship\'s hull, hidden below the horizon, comes back into view.',
    'In the <strong>Fata Morgana</strong>, raise the warm layer: the ship is drawn out into stacked, upright and inverted copies.',
  ]));

  const ctl = controls({
    scene: { type: 'seg', label: 'Scene', value: 'road', options: Object.entries(SCENES).map(([k, s]) => [k, s.label]) },
    dT: { type: 'range', label: 'Surface temperature minus the air above', min: -10, max: 25, step: 0.5, value: 15, unit: 'K' },
    h: { type: 'range', label: 'Thickness of the surface layer', min: 0.01, max: 30, log: true, value: 0.05, unit: 'm' },
    dI: { type: 'range', label: 'Warm layer above (inversion)', min: 0, max: 10, step: 0.5, value: 0, unit: 'K' },
    zi: { type: 'range', label: 'Height of the warm layer', min: 5, max: 80, log: true, value: 25, unit: 'm', when: (st) => st.dI > 0 },
    z0: { type: 'range', label: 'Your eye above the surface', min: 0.3, max: 40, log: true, value: 1.6, unit: 'm' },
    L: { type: 'range', label: 'Distance to the car or ship', min: 100, max: 50000, log: true, value: 800, fmt: (v) => (v >= 1000 ? (v / 1000).toPrecision(3) + ' km' : v.toFixed(0) + ' m') },
    curved: { type: 'toggle', label: 'Include the Earth\'s curvature', value: true },
  }, (st) => { if (st.scene !== lastScene) applyScene(st.scene); lastScene = st.scene; update(); });
  let lastScene = ctl.state.scene;
  function applyScene(k) {
    const S = SCENES[k];
    ctl.set.dT(S.atm.dT); ctl.set.h(S.atm.h); ctl.set.dI(S.atm.dI || 0); if (S.atm.zi) ctl.set.zi(S.atm.zi); ctl.set.z0(S.z0); ctl.set.L(S.L);
  }
  const ro = h('div'), calc = liveCalc();
  const view = stage({ aspect: 2.4, label: 'What you see (a narrow field: the picture spans a few milliradians)', draw: drawView, minH: 220 });
  const side = stage({ aspect: 2.6, label: '', draw: drawSide, cls: 'plain', minH: 220 });
  const xfer = stage({ aspect: 1.3, label: '', draw: drawTransfer, cls: 'plain', minH: 220 });
  const temp = stage({ aspect: 1.3, label: '', draw: drawTemp, cls: 'plain', minH: 220 });
  root.append(lab([view.el, h('div.card', { style: { padding: '6px' } }, side.el), h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, xfer.el), h('div.card', { style: { padding: '6px' } }, temp.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('mirage');
  let R = null;
  function update() {
    const st = ctl.state, S = SCENES[st.scene], O = OBJECTS[S.obj];
    const atm = { Ta: S.atm.Ta, dT: st.dT, h: st.h, dI: st.dI, zi: st.zi, wi: Math.max(1, st.zi / 6) };
    job('mirage', { atm, curved: st.curved, z0: st.z0, L: st.L, H: O.H, n: 301, fan: 27 }).then((r) => {
      R = { ...r, st: { ...st }, O, Ta: S.atm.Ta };
      words(); view.redraw(); side.redraw(); xfer.redraw(); temp.redraw();
    }, () => {});
  }
  // how many images of the object's middle height: crossings of the transfer curve
  function images(zMid) {
    let n = 0;
    for (let i = 1; i < R.z.length; i++) { const a = R.z[i - 1], b = R.z[i]; if (isFinite(a) && isFinite(b) && (a - zMid) * (b - zMid) <= 0 && a !== b) n++; }
    return n;
  }
  function words() {
    const st = R.st, T0 = R.Ta + 273.15, g = R.gradSurface, rc = rayCurvature(g, T0), crit = criticalGradient(T0), nImg = images(R.O.H / 2);
    const radius = 1 / Math.abs(rc.kappa);
    ro.replaceChildren(readouts([
      ['Temperature gradient at the surface', fmt(g, 3) + ' K/m'],
      ['Change of index per kelvin dn/dT', fmt(dndT(T0, 1013.25) * 1e6, 3) + ' × 10⁻⁶'],
      ['Radius of a horizontal ray at the surface', radius > 1e7 ? '> 10 000 km' : fmt(radius / 1000, 3) + ' km'],
      ['Ray curvature / Earth curvature', fmt(rc.k, 3)],
      ['Gradient at which light follows the Earth', fmt(crit, 3) + ' K/m'],
      ['Images of the object\'s middle', String(nImg)],
    ]));
    calc.say(t('Near the surface the temperature changes by <strong>{g} K per metre</strong>, so light travelling level with the ground curves with a radius of {r} ({k} times the Earth\'s curvature, {dir}). The middle of the {obj} is seen <strong>{n}</strong>.', {
      g: fmt(g, 3), r: radius > 1e7 ? t('more than 10 000 km') : fmt(radius / 1000, 3) + ' km', k: fmt(Math.abs(rc.k), 2),
      dir: rc.kappa > 0 ? t('bending down, towards the surface') : t('bending up, away from the surface'), obj: R.O === OBJECTS.car ? t('car') : t('ship'),
      n: nImg === 0 ? t('not at all (it is below the horizon)') : nImg === 1 ? t('once') : t('{n} times', { n: nImg }),
    }));
    calc.set(String.raw`\begin{aligned}
    n - 1 &= K\,\frac{P}{T},\quad \frac{dn}{dT} = -\frac{n-1}{T} = ${texNum(dndT(T0, 1013.25) * 1e6, 3)}\times10^{-6}\ \text{K}^{-1}\\
    \frac{d^2z}{dx^2} &= \left(1 + z'^2\right)\frac{1}{n}\frac{dn}{dz}\\
    \kappa &= -\frac{dn}{dz} = ${texNum(rc.kappa * 1e6, 3)}\times10^{-6}\ \text{m}^{-1} = ${texNum(rc.k, 3)}\,/R_E\\
    \left.\frac{dT}{dz}\right|_{\kappa = 1/R_E} &= ${texNum(crit, 3)}\ \text{K/m}
    \end{aligned}`);
  }

  // the object's colour at lateral position y and height z, or null
  const objectAt = (O, y, z) => { for (let i = O.parts.length - 1; i >= 0; i--) { const p = O.parts[i]; if (y >= p.y[0] && y <= p.y[1] && z >= p.z[0] && z <= p.z[1]) return p.c; } return null; };
  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { a, z, aLo, aHi, O, st } = R, n = a.length, span = aHi - aLo, road = O === OBJECTS.car;
    const halfW = (span * (w / hh)) / 2; // horizontal angle, same scale as vertical
    paint(view, { x: 0, y: 0, w, h: hh }, (u, v, o) => {
      const el = aHi - v * span, f = ((el - aLo) / span) * (n - 1), i = Math.max(0, Math.min(n - 2, Math.floor(f))), q = f - i;
      const z0 = z[i], z1 = z[i + 1];
      let c;
      if (!isFinite(z0) || !isFinite(z1)) { const sh = 0.6 + 0.4 * Math.min(1, Math.max(0, (el - aLo) / span)); c = road ? [0.07 * sh, 0.07 * sh, 0.075 * sh] : [0.05 * sh, 0.1 * sh, 0.14 * sh]; }
      else {
        const zz = z0 + (z1 - z0) * q, y = (u - 0.5) * 2 * halfW * st.L;
        c = objectAt(O, y, zz);
        if (!c) { const s = Math.min(1, Math.max(0, zz / (O.H * 3))); c = [0.55 - 0.35 * s, 0.68 - 0.3 * s, 0.85 - 0.2 * s]; } // sky: pale at the horizon
      }
      o[0] = encode(c[0]); o[1] = encode(c[1]); o[2] = encode(c[2]);
    }, keyOf(R));
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(t('{v} mrad high · {d} away', { v: (span * 1000).toFixed(1), d: st.L >= 1000 ? (st.L / 1000).toPrecision(3) + ' km' : st.L.toFixed(0) + ' m' }), w - 10, hh - 10);
  }
  function drawSide(ctx, w, hh) {
    if (!R) return;
    const { paths, st, O } = R, km = st.L >= 3000, sx = km ? 1e-3 : 1;
    const zmax = Math.max(O.H * 2.5, st.z0 * 1.5);
    const series = paths.map((p, i) => ({ data: p.map(([x, zz]) => [x * sx, zz]), color: `hsla(${200 + (i / paths.length) * 140}, 80%, 65%, 0.75)`, width: 1.2 }));
    plot(ctx, w, hh, {
      title: N_('Side view: the rays from your eye'), x: { min: 0, max: st.L * sx, label: km ? N_('distance (km)') : N_('distance (m)') }, y: { min: 0, max: zmax, label: N_('height above the surface (m)') },
      series: [...series, { data: [[st.L * sx, 0], [st.L * sx, O.H]], color: '#ffb547', width: 4, label: R.O === OBJECTS.car ? N_('car') : N_('ship') }],
    });
  }
  function drawTransfer(ctx, w, hh) {
    if (!R) return;
    const { a, z, O } = R, pts = [];
    for (let i = 0; i < a.length; i++) if (isFinite(z[i]) && z[i] <= O.H * 2.5) pts.push([z[i], a[i] * 1000]);
    plot(ctx, w, hh, {
      title: N_('Where each height appears'), x: { min: 0, max: O.H * 2.5, label: N_('height at the car or ship (m)') }, y: { min: R.aLo * 1000, max: R.aHi * 1000, label: N_('apparent elevation (mrad)') },
      series: [{ data: pts, color: '#6ad7ff', points: true, label: N_('rays reaching it') }],
      vlines: [{ x: O.H, color: 'rgba(255,181,71,0.6)', label: N_('top') }],
    });
  }
  function drawTemp(ctx, w, hh) {
    if (!R) return;
    const T = R.temp, zmax = T[T.length - 1][1];
    plot(ctx, w, hh, {
      title: N_('Temperature of the air'), x: { min: Math.min(...T.map((p) => p[0])) - 1, max: Math.max(...T.map((p) => p[0])) + 1, label: N_('temperature (°C)') }, y: { min: 0.01, max: zmax, log: true, label: N_('height (m)') },
      series: [{ data: T.filter((p) => p[1] > 0), color: '#ff9a6a', width: 2 }],
    });
  }
  update();

  root.append(rule(String.raw`\[\left.\frac{dT}{dz}\right|_\text{crit} \approx +0.13\ \text{K/m}\]
<p>Light bends towards denser, colder air, with a curvature \(\kappa = -dn/dz\); each kelvin changes the index of air by about \(-1\times10^{-6}\). In ordinary air, which cools with height, rays curve down gently, about a sixth as much as the Earth: the horizon is a little farther than it would be without air. When the air warms with height by about 0.13 K per metre (over cold water), light bends exactly as much as the Earth and can follow the surface: distant ships loom. Over a sunny road the air cools upwards by hundreds of kelvin per metre in the first centimetres, and light grazing the road at less than about 5 milliradians turns back up: the inferior mirage.</p>`,
    String.raw`The air is horizontally uniform here, so no shimmer, no tilted layers and no change along the path. A camera sees what is shown only for a steady air; real mirages flicker as warm parcels rise. Water vapour and the colour of light change the index by a few per cent, which is left out.`));
  root.append(theory('Rays in stratified air', String.raw`
<div class="theory-cols"><div>
<h3>The index of air</h3>
<p>For dry air at 550 nm, \(n - 1 = K P/T\) with \(K\) set by \(n - 1 = 2.77\times10^{-4}\) at 15 °C and 1013.25 hPa (Ciddor's equations give this value). Pressure falls with height hydrostatically, \(P(z) = P_0\,e^{-gz/(R_dT_0)}\). So \(dn/dT = -(n-1)/T \approx -0.96\times10^{-6}\ \text{K}^{-1}\): temperature, not pressure, makes the strong gradients near a surface.</p>
<h3>The ray equation</h3>
<p>Fermat's principle gives \(\frac{d}{ds}\left(n\frac{d\mathbf r}{ds}\right) = \nabla n\). When \(n\) depends on height only, \(n\cos\theta\) is conserved (Snell's law in layers) and, with \(z' = dz/dx\),</p>
\[\frac{d^2z}{dx^2} = \left(1 + z'^2\right)\frac{1}{n}\frac{dn}{dz},\]
<p>which the laboratory integrates by fourth-order Runge–Kutta in \(x\), with steps that shrink to a quarter of the thinnest layer near the surface. This form stays regular at the turning points of a mirage, where \(z'\) changes sign.</p>
</div><div>
<h3>The Earth's curvature</h3>
<p>Over a sphere of radius \(R_E\) the same equations hold over a flat surface if the index is replaced by \(n_\text{eff} = n\,(1 + z/R_E)\). A horizontal ray then keeps its height above the sea when \(dn/dz = -n/R_E\), which for the gas law with hydrostatic pressure needs \(dT/dz \approx +0.13\) K/m at 15 °C.</p>
<h3>Images</h3>
<p>Each row of the picture is one direction of view; the ray in that direction meets the plane of the car or ship at some height. Plotting that height against the direction (the transfer curve) shows everything: where it rises the image is upright, where it falls it is inverted, and where it folds back several directions see the same point, so the object appears several times. Rays that meet the surface first show the road or the sea.</p>
<h3>Limits</h3>
<p>Horizontally uniform, steady air; one wavelength (the green flash needs the dispersion of \(n\)); no humidity; the profiles are smooth models of real surface layers.</p>
</div></div>`));
  root.append(references([
    'A. T. Young, "An Introduction to Mirages", San Diego State University (web pages, 2006–).',
    'W. H. Lehn, "The Novaya Zemlya effect: An arctic mirage", J. Opt. Soc. Am. 69, 776 (1979).',
    'W. H. Lehn &amp; H. L. El-Arini, "Computer-graphics analysis of atmospheric refraction", Appl. Opt. 17, 3146 (1978).',
    'P. E. Ciddor, "Refractive index of air: new equations for the visible and near infrared", Appl. Opt. 35, 1566 (1996).',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), §3.2: the ray equation.',
  ]));
  return () => [view, side, xfer, temp].forEach((s) => s.destroy());
}
