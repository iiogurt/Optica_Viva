import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { parallel, rowBands } from '../lib/compute.js';
import { B_CRIT, R_ISCO, muasPerM, TARGETS } from '../lib/blackhole.js';
import { view3d } from '../lib/gl3d.js';
import { blackholeScene } from '../lib/blackhole3d.js';
import { t, N_ } from '../lib/i18n.js';

const N = 220, FOV = 22; // pixels, half-width of the field in M
const HEAT = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A black hole bends light so strongly that light passing close to it can loop around it, or fall in and never come out. Seen from far away, it casts a dark "shadow" on the glowing gas swirling around it, about two and a half times wider than the hole's edge.</p>
<p>The gas is so hot that it glows, and it moves at a large fraction of the speed of light, so the side coming towards us looks brighter. Light from the gas behind the hole is bent over and under it, so we see the back of the disk too. A telescope as large as the Earth is needed to see this for real: the Event Horizon Telescope.</p>`, [
    'Tilt the disk with <strong>Inclination</strong> from 10° to 85°: the far side of the disk appears to rise above and below the shadow.',
    'Switch <strong>Images</strong> to <strong>Direct image only</strong>: the thin bright ring around the shadow disappears. Which light made it?',
    'Predict, then check: does the shadow of Sgr A*, 1600 times less massive than M87*, look bigger or smaller from Earth?',
  ]));

  const ctl = controls({
    target: { type: 'seg', label: 'Black hole', value: 'm87', options: [['m87', 'M87*'], ['sgra', 'Sgr A*']] },
    incl: { type: 'range', label: 'Inclination (line of sight to the disk axis)', min: 0, max: 89, step: 1, value: 17, unit: '°' },
    rOut: { type: 'range', label: 'Outer edge of the disk', min: 8, max: 22, step: 0.5, value: 20, unit: 'M' },
    order: { type: 'seg', label: 'Images', value: '3', options: [['1', 'Direct image only'], ['2', '+ lensed far side'], ['3', 'All orders']] },
    beam: { type: 'range', label: 'Telescope resolution (beam FWHM)', min: 2, max: 40, step: 0.5, value: 25, unit: 'µas' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const model = stage({ aspect: 1, label: 'The disk around the black hole, computed from the light paths', draw: (c, w, hh) => blit(c, w, hh, 'model'), minH: 240 });
  const eht = stage({ aspect: 1, label: 'As a telescope of this resolution sees it', draw: (c, w, hh) => blit(c, w, hh, 'eht'), minH: 240 });
  const cut = stage({ aspect: 2.4, label: 'Brightness along the horizontal line through the centre', draw: drawCut, minH: 180 });
  const v3 = view3d({ label: '3-D: light paths near the black hole, from falling in to looping round to escaping', aspect: 1.7, minH: 260, yaw: -0.3, pitch: 0.9 });
  root.append(lab([h('div.grid-2', {}, model.el, eht.el), cut.el, v3.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));
  v3.setScene(blackholeScene({ rOut: ctl.state.rOut }));

  let img = null, blurred = null, ticket = 0, canvases = {};
  async function render() {
    const my = ++ticket, st = ctl.state;
    const parts = await parallel('bhRows', rowBands(N).map(([y0, y1]) => ({ N, fov: FOV, incl: (st.incl * Math.PI) / 180, rOut: st.rOut, maxOrder: +st.order, y0, y1 })));
    if (my !== ticket) return;
    img = new Float32Array(N * N);
    let off = 0;
    for (const p of parts) { img.set(p, off); off += p.length; }
    finish();
  }
  // the telescope's view: the model blurred by a Gaussian beam of the chosen FWHM (in µas → pixels)
  function finish() {
    const st = ctl.state, T = TARGETS[st.target], perM = muasPerM(T.M, T.D), pxPerMuas = N / (2 * FOV * perM);
    const sigma = (st.beam / 2.3548) * pxPerMuas;
    blurred = gaussBlur(img, N, sigma);
    canvases.model = toCanvas(img); canvases.eht = toCanvas(blurred);
    model.redraw(); eht.redraw(); cut.redraw();
  }
  function gaussBlur(a, n, s) {
    if (s < 0.3) return a.slice();
    const r = Math.ceil(3 * s), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * s * s))), ks = k.reduce((p, q) => p + q, 0);
    const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < n) v += a[y * n + xx] * k[i + r]; } tmp[y * n + x] = v / ks; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < n) v += tmp[yy * n + x] * k[i + r]; } out[y * n + x] = v / ks; }
    return out;
  }
  function toCanvas(a) {
    const c = imageCanvas(N, N), m = Math.max(...a) || 1;
    for (let k = 0; k < N * N; k++) { const i = Math.min(255, Math.round(255 * Math.pow(a[k] / m, 0.55))) * 3; c.data[k * 4] = HEAT[i]; c.data[k * 4 + 1] = HEAT[i + 1]; c.data[k * 4 + 2] = HEAT[i + 2]; c.data[k * 4 + 3] = 255; }
    c.put(); return c.c;
  }
  function blit(ctx, w, hh, which) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!canvases[which]) return;
    const side = Math.min(w, hh), x0 = (w - side) / 2, y0 = (hh - side) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(canvases[which], x0, y0, side, side);
    const st = ctl.state, T = TARGETS[st.target], perM = muasPerM(T.M, T.D), P = (m) => (m / FOV) * (side / 2);
    // the shadow's edge, b = 3√3 M, and a scale bar of 20 µas
    ctx.strokeStyle = 'rgba(106,215,255,0.45)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(w / 2, hh / 2, P(B_CRIT), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    const bar = P(20 / perM);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0 + 12, y0 + side - 16, bar, 2);
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText('20 µas', x0 + 16 + bar, y0 + side - 12);
    if (which === 'eht') { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x0 + side - 24, y0 + side - 24, P(st.beam / perM) / 2, 0, 2 * Math.PI); ctx.stroke(); }
  }
  function drawCut(ctx, w, hh) {
    if (!img) return;
    const st = ctl.state, T = TARGETS[st.target], perM = muasPerM(T.M, T.D), row = N / 2;
    const mi = Math.max(...img.slice(row * N, row * N + N)) || 1, mb = Math.max(...blurred.slice(row * N, row * N + N)) || 1;
    const xs = (i) => ((i + 0.5) / N * 2 - 1) * FOV * perM;
    plot(ctx, w, hh, {
      x: { min: -FOV * perM, max: FOV * perM, label: 'angle on the sky (µas)' }, y: { min: 0, max: 1.1, label: 'brightness (relative)' },
      series: [
        { data: Array.from({ length: N }, (_, i) => [xs(i), img[row * N + i] / mi]), color: 'rgba(255,181,71,0.75)', width: 1.2, label: N_('computed') },
        { data: Array.from({ length: N }, (_, i) => [xs(i), blurred[row * N + i] / mb]), color: '#6ad7ff', width: 2, label: N_('at the telescope\'s resolution') },
      ],
      vlines: [{ x: -B_CRIT * perM, color: 'rgba(255,255,255,0.35)', label: '' }, { x: B_CRIT * perM, color: 'rgba(255,255,255,0.35)', label: N_('shadow edge') }],
      legend: true, legendX: 60, legendY: 40, padT: 32,
    });
  }

  let lastROut = null;
  function update() {
    const st = ctl.state, T = TARGETS[st.target], perM = muasPerM(T.M, T.D), dSh = 2 * B_CRIT * perM;
    ro.replaceChildren(readouts([
      ['Size of one gravitational radius GM/c²', fmt(perM, 3) + ' µas'],
      ['Shadow diameter 2·3√3 GM/c²', fmt(dSh, 3) + ' µas'],
      ['Innermost stable orbit (6M), diameter', fmt(2 * R_ISCO * perM, 3) + ' µas'],
      ['Shadow / beam', fmt(dSh / st.beam, 3)],
    ]));
    calc.say(t('For {name} ({m} solar masses at {d}), one gravitational radius spans {pm} µas, so the shadow is <strong>{sh} µas</strong> across; with a {beam} µas beam the telescope resolves it {k} times over.', { name: st.target === 'm87' ? 'M87*' : 'Sgr A*', m: fmt(T.M, 2), d: st.target === 'm87' ? '16.8 Mpc' : '8.2 kpc', pm: fmt(perM, 3), sh: fmt(dSh, 3), beam: st.beam, k: fmt(dSh / st.beam, 2) }));
    calc.set(String.raw`\begin{aligned}
    \frac{d^2u}{d\varphi^2} &= 3\frac{GM}{c^2}u^2 - u,\quad u = \frac1r\\
    b_c &= 3\sqrt3\,\frac{GM}{c^2}\\
    \theta_\text{sh} &= \frac{2b_c}{D} = ${texNum(dSh, 3)}\ \mu\text{as}\\
    I_\text{obs} &= g^4 F(r),\quad g = \frac{\sqrt{1-3M/r}}{1-\Omega\lambda}
    \end{aligned}`);
    if (st.rOut !== lastROut) { lastROut = st.rOut; v3.setScene(blackholeScene({ rOut: st.rOut }), true); }
    render().catch(console.error);
  }
  update();

  root.append(rule(String.raw`\[\theta_\text{shadow} = 2\sqrt{27}\,\frac{GM}{c^2D}\]
<p>Light passing a black hole of mass \(M\) closer than \(b_c = 3\sqrt3\,GM/c^2\) falls in, so a black hole against glowing gas shows a dark disk \(\sqrt{27} \approx 5.2\) times its gravitational radius across. For M87* (6.5 billion solar masses, 16.8 Mpc away) that is 40 µas: the size of a doughnut on the Moon seen from Earth.</p>`,
    String.raw`Exact for a non-rotating (Schwarzschild) black hole seen from far away. Spin flattens and shifts the shadow by a few per cent, the bright ring sits slightly outside the shadow's edge (the EHT measured 42 ± 3 µas for M87*), and real emission comes from a thick, turbulent flow rather than a thin disk.`));
  root.append(theory('Light near a black hole', String.raw`
<div class="theory-cols"><div>
<h3>Photon orbits</h3>
<p>Outside a non-rotating mass \(M\) (Schwarzschild metric; \(G = c = M = 1\) below) a photon moves in a plane. With \(u = 1/r\) its orbit obeys</p>
\[\frac{d^2u}{d\varphi^2} + u = 3u^2,\qquad \left(\frac{du}{d\varphi}\right)^2 = \frac{1}{b^2} - u^2 + 2u^3,\]
<p>where \(b\) is the impact parameter, the photon's offset from the hole as seen by the distant observer. Far away the \(3u^2\) term is tiny and the deflection is \(4M/b\), twice Newton's value. At \(r = 3M\) light can orbit (the photon sphere); photons with \(b < 3\sqrt3\,M\) spiral in, those slightly above it wind around several times before escaping. The laboratory integrates the orbit by fourth-order Runge–Kutta in \(\varphi\) (step 0.004 rad) for about 1100 impact parameters, densest near \(3\sqrt3\), and checks the weak-field deflection \(4/b + 15\pi/(4b^2) + 128/(3b^3)\) and the capture threshold.</p>
<h3>Imaging a disk</h3>
<p>Following Luminet (1979), each pixel of the image is a ray traced back from the observer with impact parameter \(b\) and a direction on the sky. Its orbit plane cuts the disk plane along a line, so the ray crosses the disk at \(\varphi = \varphi_0, \varphi_0 + \pi, \dots\): the first crossing is the direct image, the next the lensed image of the disk's far side, and the following ones the thin photon ring. The first crossing between \(r = 6M\) (the innermost stable circular orbit) and the outer edge emits.</p>
</div><div>
<h3>Brightness: redshift and beaming</h3>
<p>The disk radiates the Page–Thorne flux \(F(r)\) of a thin disk around a Schwarzschild hole. Gas on circular orbits moves at \(\Omega = r^{-3/2}\); a photon of angular momentum \(\lambda\) about the disk axis reaches us with frequency ratio \(g = 1/[u^t(1 - \Omega\lambda)]\), \(u^t = (1 - 3/r)^{-1/2}\), combining gravitational redshift and the Doppler shift. Since \(I_\nu/\nu^3\) is conserved along a ray, the bolometric intensity scales as \(g^4\): the approaching side is much brighter.</p>
<h3>The Event Horizon Telescope</h3>
<p>The shadow of M87* is about 40 µas wide. Resolving it needs \(\lambda/B \approx\) 25 µas: radio telescopes across the Earth (\(B \approx\) 10 700 km) at \(\lambda\) = 1.3 mm, combined by very-long-baseline interferometry (see the interferometry laboratory). The "telescope" image here is the model blurred by a Gaussian beam of that width; real EHT images are reconstructed from sparse u-v coverage.</p>
<h3>Limits</h3>
<p>No spin (Kerr) and no thick or turbulent flow; the disk is geometrically thin and optically thick; emission is bolometric, without the 1.3 mm spectrum or synchrotron physics; the observer is at infinity.</p>
</div></div>`));
  root.append(references([
    'J.-P. Luminet, "Image of a spherical black hole with thin accretion disk", Astron. Astrophys. 75, 228 (1979).',
    'D. N. Page &amp; K. S. Thorne, "Disk-accretion onto a black hole. I. Time-averaged structure of accretion disk", ApJ 191, 499 (1974).',
    'Event Horizon Telescope Collaboration, "First M87 Event Horizon Telescope results. I. The shadow of the supermassive black hole", ApJL 875, L1 (2019).',
    'Event Horizon Telescope Collaboration, "First Sagittarius A* Event Horizon Telescope results. I.", ApJL 930, L12 (2022).',
    'S. Chandrasekhar, <i>The Mathematical Theory of Black Holes</i>, Oxford University Press (1983).',
  ]));
  return () => { ticket++; [model, eht, cut, v3].forEach((s) => s.destroy()); };
}
