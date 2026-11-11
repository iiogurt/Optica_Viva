// Stereoscopic 3-D: how the cameras' interaxial and convergence and the viewer's screen decide what
// the audience sees.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { E, SPHERES, screenParallax, perceived, shape, orthoRig, render } from '../lib/stereo.js';
import { t, N_ } from '../lib/i18n.js';

const W = 320, H = 180, SENSOR = 24.89; // Super 35 width, mm
const SCREENS = { cinema: { label: N_('Cinema (10 m screen, 12 m away)'), S: 10, V: 12 }, tv: { label: N_('Television (1.2 m, 2.5 m away)'), S: 1.2, V: 2.5 }, phone: { label: N_('Phone (14 cm, 35 cm away)'), S: 0.14, V: 0.35 } };
const OBJECTS = SPHERES.map((s) => s.c[2]);

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video', 'photo'] }));
  root.append(idea(String.raw`<p>Our two eyes see the world from points 6.5 cm apart, and the brain turns the small differences between the two pictures into depth. A 3-D film does the same with two cameras: each eye is shown only its own camera's picture, and the brain builds the depth again.</p>
<p>But the room in the cinema is not the room where the film was shot. How far apart the cameras were, where they were aimed and how big the screen is decide whether things look natural, flattened like cardboard, shrunk like puppets, or so far behind the screen that your eyes would have to point outwards to see them.</p>`, [
    'With red–cyan glasses, or by looking at the colour fringes: which sphere sits on the screen?',
    'Move the <strong>cameras further apart</strong>: when do the distant spheres need your eyes to point outwards?',
    'Keep the same shot but change the <strong>screen</strong> from a phone to a cinema: why is a film shot for the cinema comfortable on a phone, but not the other way round?',
  ]));

  const ctl = controls({
    screen: { type: 'select', label: 'Screen', value: 'tv', options: Object.entries(SCREENS).map(([k, s]) => [k, s.label]) },
    b: { type: 'range', label: 'Distance between the cameras (interaxial)', min: 0.005, max: 0.15, log: true, value: 0.04, fmt: (v) => (v * 100).toFixed(1) + ' cm' },
    f: { type: 'range', label: 'Focal length (Super 35)', min: 12, max: 100, log: true, value: 32, unit: 'mm' },
    C: { type: 'range', label: 'Convergence distance (what sits on the screen)', min: 1, max: 30, log: true, value: 4, unit: 'm' },
    mode: { type: 'seg', label: 'Show', value: 'ana', options: [['ana', 'Red–cyan'], ['cross', 'Side by side (cross-eyed)'], ['left', 'Left eye only']] },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const pic = stage({ aspect: 16 / 9, label: 'The two cameras\' pictures, as the audience gets them', draw: drawPic, minH: 220 });
  const where = stage({ aspect: 1.5, label: '', draw: drawWhere, cls: 'plain', minH: 220 });
  const budget = stage({ aspect: 1.5, label: '', draw: drawBudget, cls: 'plain', minH: 220 });
  const ortho = h('button.tag', { type: 'button', onClick: () => { const v = SCREENS[ctl.state.screen], o = orthoRig(v, SENSOR); ctl.set.b(o.b); ctl.set.f(Math.min(100, Math.max(12, o.f))); ctl.set.C(Math.min(30, Math.max(1, o.C))); update(); } }, t('Set the natural (orthostereo) rig for this screen'));
  root.append(lab([pic.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, where.el), h('div.card', { style: { padding: '6px' } }, budget.el))], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, ortho)), h('div.card', {}, ro), calc.el]));

  const rigOf = (st) => ({ b: st.b, f: st.f, s: SENSOR, C: st.C });
  let R = null;
  const renderSoon = debounce(() => { const st = ctl.state, rig = rigOf(st); R = { L: render(rig, -1, W, H), R: render(rig, 1, W, H), st: { ...st } }; pic.redraw(); }, 60);
  function update() { words(); where.redraw(); budget.redraw(); renderSoon(); }
  function words() {
    const st = ctl.state, view = SCREENS[st.screen], rig = rigOf(st);
    const pInf = (rig.f * rig.b * (1 / rig.C) * view.S) / rig.s, near = screenParallax(rig, view, Math.min(...OBJECTS)), far = screenParallax(rig, view, Math.max(...OBJECTS));
    const atC = shape(rig, view, st.C);
    ro.replaceChildren(readouts([
      ['Screen parallax of infinity (eyes 65 mm apart)', `${fmt(pInf * 1000, 3)} mm${pInf > E ? ' ⚠' : ''}`],
      ['Parallax of the nearest / farthest sphere', `${fmt(near * 1000, 3)} / ${fmt(far * 1000, 3)} mm`],
      ['Depth budget (share of the screen width)', `${fmt((near / view.S) * 100, 2)} % … ${fmt((far / view.S) * 100, 2)} %`],
      ['Size of the scene as seen, at the screen', fmt(atC.kw, 3) + ' ×'],
      ['Roundness at the screen (1 = natural)', fmt(atC.round, 3)],
    ]));
    calc.say(t('On this screen, things at infinity are shown <strong>{p} mm</strong> apart for the two eyes, {cmp} the 65 mm between the eyes{warn}. Objects at {C} m sit on the screen; there the scene looks {k} times its real size, and its depth is {r} times what that size would need, so it looks {how}.', {
      p: fmt(pInf * 1000, 3), cmp: pInf > E ? t('more than') : t('less than'), warn: pInf > E ? t(': the background would make the eyes diverge') : '', C: fmt(st.C, 3), k: fmt(atC.kw, 2), r: fmt(atC.round, 2),
      how: atC.round < 0.7 ? t('flattened, like cardboard cut-outs') : atC.round > 1.4 ? t('stretched in depth') : t('naturally rounded'),
    }));
    calc.set(String.raw`\begin{aligned}
    P &= \frac{S}{s}\,f\,b\left(\frac1C - \frac1Z\right),\quad P_\infty = ${texNum(pInf * 1000, 3)}\ \text{mm}\\
    Z_p &= \frac{V e}{e - P},\quad e = 65\ \text{mm}\\
    \rho &= \frac{dZ_p/dZ}{k_w} = ${texNum(atC.round, 3)}
    \end{aligned}`);
  }
  // red–cyan: the left eye's luminance in red, the right eye's green and blue
  function drawPic(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { L, R: Rr, st } = R, lum = (p, x, y) => 0.3 * bilinear(p[0], W, H, x, y) + 0.59 * bilinear(p[1], W, H, x, y) + 0.11 * bilinear(p[2], W, H, x, y);
    if (st.mode === 'cross') {
      const pw = w / 2 - 6, ph = Math.min(hh, (pw * H) / W);
      [[Rr, 0], [L, 1]].forEach(([p, k]) => paint(pic, { x: k * (pw + 12), y: (hh - ph) / 2, w: pw, h: ph }, (u, v, o) => { for (let c = 0; c < 3; c++) o[c] = encode(bilinear(p[c], W, H, u * W - 0.5, v * H - 0.5)); }, keyOf(R) + 'x', k));
      return;
    }
    const pw = Math.min(w, (hh * W) / H), ph = (pw * H) / W;
    paint(pic, { x: (w - pw) / 2, y: (hh - ph) / 2, w: pw, h: ph }, (u, v, o) => {
      const x = u * W - 0.5, y = v * H - 0.5;
      if (st.mode === 'left') { for (let c = 0; c < 3; c++) o[c] = encode(bilinear(L[c], W, H, x, y)); return; }
      o[0] = encode(lum(L, x, y)); o[1] = encode(bilinear(Rr[1], W, H, x, y)); o[2] = encode(bilinear(Rr[2], W, H, x, y));
    }, keyOf(R) + st.mode);
  }
  function drawWhere(ctx, w, hh) {
    const st = ctl.state, view = SCREENS[st.screen], rig = rigOf(st), line = [], ortho = [], dots = [];
    const zmax = Math.max(...OBJECTS) * 1.6;
    for (let Z = 0.6; Z <= zmax; Z *= 1.03) { const Zp = perceived(screenParallax(rig, view, Z), view.V); line.push([Z, Math.min(Zp, 1e3)]); ortho.push([Z, Z]); }
    for (const Z of OBJECTS) dots.push([Z, Math.min(perceived(screenParallax(rig, view, Z), view.V), 1e3)]);
    plot(ctx, w, hh, {
      title: N_('Where the audience sees things'), x: { min: 0.6, max: zmax, log: true, label: N_('distance in the scene (m)') }, y: { min: 0.2, max: 300, log: true, label: N_('distance as seen from the seat (m)') },
      series: [{ data: ortho, color: 'rgba(255,255,255,0.35)', width: 1.2, dash: [4, 3], label: N_('as in reality') }, { data: line, color: '#6ad7ff', width: 2, label: N_('as seen') }, { data: dots, color: '#ffb547', points: true, label: N_('the spheres') }],
      hlines: [{ y: view.V, color: 'rgba(255,181,71,0.5)', label: N_('the screen') }], legend: true,
    });
  }
  function drawBudget(ctx, w, hh) {
    const st = ctl.state, view = SCREENS[st.screen], rig = rigOf(st), pts = OBJECTS.map((Z) => [Z, (screenParallax(rig, view, Z) / view.S) * 100]);
    const div = (E / view.S) * 100, curve = [];
    for (let Z = 0.8; Z <= 60; Z *= 1.04) curve.push([Z, (screenParallax(rig, view, Z) / view.S) * 100]);
    plot(ctx, w, hh, {
      title: N_('Parallax on the screen'), x: { min: 0.8, max: 60, log: true, label: N_('distance in the scene (m)') }, y: { min: -4, max: Math.max(2, div * 1.3, ...curve.map((p) => p[1])), label: N_('parallax (% of the screen width)') },
      series: [{ data: curve, color: '#6ad7ff', width: 2 }, { data: pts, color: '#ffb547', points: true, label: N_('the spheres') }],
      hlines: [{ y: div, color: '#ff6b6b', label: N_('eyes 65 mm apart: divergence') }, { y: -2, color: 'rgba(255,255,255,0.35)', label: N_('comfortable in front') }, { y: 0, color: 'rgba(255,255,255,0.2)', label: '' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[P = \frac{S}{s}\,f\,b\left(\frac1C - \frac1Z\right),\qquad P_\infty < e = 65\ \text{mm}\]
<p>The parallax of the background grows with the screen: a shot whose background lies 50 mm apart on a 10 m cinema screen lies 0.7 mm apart on a phone, fine there, but the same shot made for a phone would need 3.6 m of parallax in the cinema. Hence the rule: shoot for the largest screen; the background's parallax must stay below 65 mm there, and objects in front of the screen within about 2 % of its width.</p>`,
    String.raw`For an audience seated centrally, eyes 65 mm apart and parallel cameras converged by shifting the picture. Seats to the side shear the scene; eyes closer together (children) see more depth; the comfort limits are rules of thumb, not physiology.`));
  root.append(theory('The geometry of stereoscopy', String.raw`
<div class="theory-cols"><div>
<h3>Cameras</h3>
<p>Two cameras with parallel axes \(b\) apart see a point at distance \(Z\) with a horizontal offset \(f b/Z\) between their pictures; shifting the pictures by \(f b/C\) (horizontal image translation) puts the plane at \(C\) at zero offset. On a screen \(M = S/s\) times wider than the sensor, the parallax is \(P = M f b(1/C - 1/Z)\): zero for the convergence plane, at most \(M f b/C\) for infinity, and without limit in front.</p>
<h3>Viewer</h3>
<p>Eyes \(e\) apart at distance \(V\) from the screen look at two points \(P\) apart; their lines of sight cross at \(Z_p = Ve/(e - P)\): on the screen for \(P = 0\), at infinity for \(P = e\), and nowhere (the eyes must diverge) beyond. Negative parallax brings things out in front of the screen.</p>
</div><div>
<h3>Shape</h3>
<p>A small object at \(Z\) appears with width scaled by \(k_w = M f Z_p/(Z V)\) and depth by \(k_d = dZ_p/dZ\). Their ratio, the roundness \(\rho = k_d/k_w\), is 1 when the depth matches the width; below 1 objects look flat (cardboarding), and when \(k_w\) is small (a large interaxial) the whole scene looks like a model (puppet theatre, gigantism for the reverse).</p>
<h3>Orthostereoscopy</h3>
<p>With \(b = e\), the screen seen from the seat under the same angle as the scene by the camera (\(f/s = V/S\)) and convergence at \(C = V\), the formulas give \(Z_p = Z\), \(k_w = 1\) and \(\rho = 1\) at every distance: the audience sees the scene at its true size and place. The button sets this rig; it is rarely used in practice because it leaves no freedom for framing.</p>
</div></div>`));
  root.append(references([
    'B. Mendiburu, <i>3D Movie Making: Stereoscopic Digital Cinema from Script to Screen</i>, Focal Press (2009).',
    'R. Spottiswoode, N. L. Spottiswoode &amp; C. Smith, "Basic principles of the three-dimensional film", J. SMPTE 59, 249 (1952).',
    'A. Woods, T. Docherty &amp; R. Koch, "Image distortions in stereoscopic video systems", Proc. SPIE 1915, 36 (1993).',
    'L. Lipton, <i>Foundations of the Stereoscopic Cinema</i>, Van Nostrand Reinhold (1982).',
  ]));
  return () => [pic, where, budget].forEach((s) => s.destroy());
}
