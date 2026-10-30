import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { runOn } from '../lib/compute.js';
import { huygens, S } from '../lib/fdtd.js';
import { t, N_ } from '../lib/i18n.js';

const NX = 280, NY = 190, X0 = 90, SCREEN = NX - 36;
const SLITS = ['single', 'double', 'grating'];
// field colours: blue (negative) through black to amber (positive)
const FIELD = (() => {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 127.5 - 1, a = Math.min(1, Math.abs(v)) ** 0.8, c = v < 0 ? [70, 160, 255] : [255, 181, 71];
    for (let k = 0; k < 3; k++) L[i * 3 + k] = c[k] * a;
  }
  return L;
})();
const HEAT = lut('inferno');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>Light is a wave: electric and magnetic fields that rise and fall a million billion times a second. Here the wave is slowed down so you can watch it move. Bright amber and blue are the crests and troughs of the field.</p>
<p>When the wave squeezes through a narrow opening, it spreads out behind it. When it passes two openings, the two new waves overlap: where crests meet crests they add up, where crests meet troughs they cancel. That makes the bright and dark stripes you see on the screen. Glass slows the wave down, so a lens, thicker in the middle, bends the wave into a point.</p>`, [
    'Choose <strong>Two slits</strong> and move the slits further apart: do the stripes on the screen get closer or further apart? Predict, then check.',
    'Choose <strong>Round obstacle</strong> and switch to <strong>Brightness (time average)</strong>: a bright line appears right in the middle of the shadow.',
    'Choose <strong>Glass lens</strong> and lower the <strong>Refractive index</strong> towards 1: the focus moves away and fades.',
  ]));

  const ctl = controls({
    scene: { type: 'select', label: 'Scene', value: 'double', options: [['single', 'Single slit'], ['double', 'Two slits'], ['grating', 'Grating (9 slits)'], ['edge', 'Straight edge'], ['disc', 'Round obstacle'], ['lens', 'Glass lens'], ['interface', 'Glass surface'], ['film', 'Thin film']] },
    view: { type: 'seg', label: 'Show', value: 'field', options: [['field', 'Field'], ['intensity', 'Brightness (time average)']] },
    source: { type: 'seg', label: 'Source', value: 'plane', options: [['plane', 'Plane wave'], ['point', 'Point source']] },
    lam: { type: 'range', label: 'Wavelength', min: 8, max: 20, step: 1, value: 12, unit: 'cells' },
    w: { type: 'range', label: 'Slit or obstacle width', min: 0.3, max: 6, step: 0.1, value: 1.5, unit: 'λ', when: (st) => ['single', 'double', 'grating', 'disc', 'film'].includes(st.scene) },
    d: { type: 'range', label: 'Slit separation', min: 1.5, max: 10, step: 0.1, value: 4, unit: 'λ', when: (st) => ['double', 'grating'].includes(st.scene) },
    n: { type: 'range', label: 'Refractive index', min: 1, max: 2.5, step: 0.01, value: 1.5, when: (st) => ['lens', 'interface', 'film'].includes(st.scene) },
    f: { type: 'range', label: 'Focal length', min: 4, max: 14, step: 0.5, value: 8, unit: 'λ', when: (st) => st.scene === 'lens' },
    tilt: { type: 'range', label: 'Angle of incidence', min: 0, max: 70, step: 1, value: 30, unit: '°', when: (st) => st.scene === 'interface' },
    speed: { type: 'range', label: 'Steps per frame', min: 1, max: 16, step: 1, value: 4 },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const status = h('p.note', { role: 'status' }, '');
  const pause = h('button.btn', { type: 'button', onClick: () => { running = !running; pause.textContent = running ? t('Pause') : t('Run'); if (running) loop(); } }, t('Pause'));
  const restart = h('button.btn', { type: 'button', onClick: () => init() }, t('Restart'));
  const field = stage({ aspect: NX / NY, label: 'The wave, computed from Maxwell\'s equations (FDTD)', draw: drawField, minH: 240 });
  const prof = stage({ aspect: 2.4, label: 'Brightness along the screen (dashed line)', draw: drawProfile, minH: 180 });
  root.append(lab([field.el, h('div.rx-actions', { style: { alignItems: 'center' } }, pause, restart, status), prof.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let running = true, busy = false, alive = true, gen = 0, masks = null, frame = null, scale = 0.2, img = imageCanvas(NX, NY);
  const params = () => { const st = ctl.state, L = st.lam; return { nx: NX, ny: NY, lam: L, x0: X0, scene: st.scene, source: st.source, p: { w: st.w * L, d: st.d * L, n: st.n, f: st.f * L, tilt: st.tilt } }; };
  async function init() {
    const my = ++gen;
    masks = await runOn(0, 'waveInit', params());
    if (my !== gen) return;
    frame = null; scale = 0.2;
    if (!busy) loop();
  }
  async function loop() {
    if (!alive || !running || busy) return;
    busy = true;
    const my = gen, st = ctl.state;
    const r = await runOn(0, 'waveStep', { n: st.speed, intensity: st.view === 'intensity' || SLITS.includes(st.scene) });
    busy = false;
    if (!alive || my !== gen || !r) { if (alive && running) requestAnimationFrame(loop); return; }
    frame = r; paint(); field.redraw(); prof.redraw();
    const periods = (r.t * S) / st.lam;
    status.textContent = t('{p} periods simulated · {s} time steps', { p: periods.toFixed(1), s: r.t });
    if (running) requestAnimationFrame(loop);
  }
  function paint() {
    const st = ctl.state, N = NX * NY, d = img.data, ez = frame.ez;
    if (st.view === 'field') {
      let m = 0;
      for (let y = 40; y < NY - 40; y++) for (let x = 40; x < NX - 40; x++) m = Math.max(m, Math.abs(ez[y * NX + x]));
      scale = Math.max(scale * 0.97, m * 0.8, 1e-6);
    } else if (frame.I) {
      let m = 0;
      for (let y = 36; y < NY - 36; y++) for (let x = X0 + 4; x < NX - 36; x++) m = Math.max(m, frame.I[y * NX + x]);
      scale = m || 1;
    }
    for (let k = 0; k < N; k++) {
      let c, i;
      if (st.view === 'field') { i = Math.max(0, Math.min(255, Math.round((ez[k] / scale) * 127.5 + 127.5))); c = FIELD; }
      else { i = frame.I ? Math.min(255, Math.round(Math.sqrt(frame.I[k] / scale) * 255)) : 0; c = HEAT; }
      let r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
      if (masks.pec[k]) { r = 150; g = 155; b = 165; }
      else if (masks.eps[k] > 1.001) { r = r * 0.8 + 30; g = g * 0.8 + 45; b = b * 0.8 + 70; }
      d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
    }
    img.put();
  }
  function drawField(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!frame) return;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img.c, 0, 0, w, hh);
    const sx = w / NX, st = ctl.state;
    if (SLITS.includes(st.scene)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(SCREEN * sx, 0); ctx.lineTo(SCREEN * sx, hh); ctx.stroke(); ctx.setLineDash([]);
    }
    // a one-wavelength scale bar
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(12, hh - 14, st.lam * sx, 2);
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillText('λ', 12 + st.lam * sx + 5, hh - 10);
  }
  function drawProfile(ctx, w, hh) {
    const st = ctl.state;
    if (!frame || !frame.I || !frame.nI) return;
    const L = st.lam, I = new Float64Array(NY);
    for (let y = 0; y < NY; y++) I[y] = frame.I[y * NX + SCREEN];
    const m = Math.max(...I.slice(30, NY - 30)) || 1;
    const series = [{ data: Array.from(I, (v, y) => [(y - NY / 2) / L, v / m]).slice(30, NY - 30), color: '#ffb547', width: 2, label: N_('FDTD (Maxwell)') }];
    const holes = { single: [[0, st.w * L]], double: [[-st.d * L / 2, st.w * L], [st.d * L / 2, st.w * L]], grating: Array.from({ length: 9 }, (_, i) => [(i - 4) * st.d * L, st.w * L]) }[st.scene];
    if (holes && st.source === 'plane') {
      const hz = huygens({ nx: NX, ny: NY, lam: L, x0: X0, holes, x: SCREEN });
      const hm = Math.max(...hz.slice(30, NY - 30)) || 1;
      series.push({ data: Array.from(hz, (v, y) => [(y - NY / 2) / L, v / hm]).slice(30, NY - 30), color: 'rgba(255,255,255,0.55)', width: 1.2, dash: [4, 3], label: N_('Huygens–Fresnel') });
    }
    plot(ctx, w, hh, { x: { min: -(NY / 2 - 30) / L, max: (NY / 2 - 30) / L, label: 'position on the screen (λ)' }, y: { min: 0, max: 1.1, label: 'brightness (relative)' }, series, legend: true, legendX: 60, legendY: 40, padT: 32 });
  }

  let lastKey = '';
  function update() {
    const st = ctl.state, L = st.lam, dist = (SCREEN - X0 - 2) / L, D2R = Math.PI / 180;
    const key = JSON.stringify(params());
    if (key !== lastKey) { lastKey = key; init().catch(console.error); }
    else if (frame) { paint(); field.redraw(); prof.redraw(); }
    const rows = [[N_('Grid'), t('{nx} × {ny} cells = {a} × {b} λ', { nx: NX, ny: NY, a: (NX / L).toFixed(1), b: (NY / L).toFixed(1) })], [N_('Courant number S = cΔt/Δx'), String(S)], [N_('Steps per period'), String(Math.round(L / S))]];
    let say, tex;
    if (st.scene === 'single') {
      const s = 1 / st.w;
      rows.push([N_('First dark direction'), s < 1 ? (Math.asin(s) / D2R).toFixed(1) + '°' : t('none (slit narrower than λ)')]);
      say = s < 1 ? t('A slit {w} wavelengths wide spreads the light: the first dark direction lies at <strong>{a}°</strong> from the axis, where sin θ = λ/w.', { w: st.w.toFixed(1), a: (Math.asin(s) / D2R).toFixed(1) }) : t('A slit narrower than one wavelength spreads the light into the whole half-space behind it, without a dark direction.');
      tex = String.raw`\sin\theta_1 = \frac{\lambda}{w} = \frac{1}{${texNum(st.w, 3)}}`;
    } else if (st.scene === 'double' || st.scene === 'grating') {
      const s = 1 / st.d, ang = s < 1 ? Math.asin(s) / D2R : NaN, sp = dist / st.d;
      rows.push([N_('Angle between bright fringes (first order)'), isFinite(ang) ? ang.toFixed(1) + '°' : '—'], [N_('Fringe spacing on the screen (small angles)'), sp.toFixed(2) + ' λ']);
      say = t('Slits {d} wavelengths apart send their first bright order at <strong>{a}°</strong> (sin θ = λ/d); on the screen {L} wavelengths away the bright fringes lie about <strong>{s} λ</strong> apart.', { d: st.d.toFixed(1), a: isFinite(ang) ? ang.toFixed(1) : '—', L: dist.toFixed(1), s: sp.toFixed(2) });
      tex = String.raw`d\sin\theta_m = m\lambda,\quad \Delta y \approx \frac{\lambda L}{d} = \frac{${texNum(dist, 3)}}{${texNum(st.d, 3)}}\,\lambda = ${texNum(sp, 3)}\,\lambda`;
    } else if (st.scene === 'interface') {
      const th = st.tilt * D2R, s2 = Math.sin(th) / st.n, ct = Math.sqrt(1 - s2 * s2), rs = (Math.cos(th) - st.n * ct) / (Math.cos(th) + st.n * ct);
      rows.push([N_('Refraction angle (Snell)'), (Math.asin(s2) / D2R).toFixed(1) + '°'], [N_('Reflectance (s polarisation)'), (rs * rs * 100).toFixed(1) + ' %'], [N_('Wavelength in the glass'), (1 / st.n).toFixed(3) + ' λ']);
      say = t('Arriving at {a}°, the wave enters glass of index {n}: it bends to <strong>{r}°</strong> (Snell\'s law), its wavelength shrinks to {l} λ, and <strong>{R} %</strong> is reflected.', { a: st.tilt, n: st.n.toFixed(2), r: (Math.asin(s2) / D2R).toFixed(1), l: (1 / st.n).toFixed(2), R: (rs * rs * 100).toFixed(1) });
      tex = String.raw`\sin\theta_t = \frac{\sin\theta_i}{n},\quad r_s = \frac{\cos\theta_i - n\cos\theta_t}{\cos\theta_i + n\cos\theta_t} = ${texNum(rs, 3)}`;
    } else if (st.scene === 'film') {
      const n = st.n, r1 = (1 - n) / (1 + n), r2 = -r1, dl = 2 * Math.PI * n * st.w * 2;
      const re = r1 + r2 * Math.cos(dl), im = r2 * Math.sin(dl), dre = 1 + r1 * r2 * Math.cos(dl), dim = r1 * r2 * Math.sin(dl);
      const R = (re * re + im * im) / (dre * dre + dim * dim);
      rows.push([N_('Optical thickness n·w'), (n * st.w).toFixed(2) + ' λ'], [N_('Reflectance of the film'), (R * 100).toFixed(1) + ' %']);
      say = t('A layer {w} wavelengths thick with index {n} reflects <strong>{R} %</strong>: the reflections from its two faces interfere.', { w: st.w.toFixed(1), n: n.toFixed(2), R: (R * 100).toFixed(1) });
      tex = String.raw`r = \frac{r_1 + r_2e^{2i\delta}}{1 + r_1r_2e^{2i\delta}},\quad \delta = \frac{2\pi n w}{\lambda}\Rightarrow R = ${texNum(R * 100, 3)}\,\%`;
    } else if (st.scene === 'lens') {
      rows.push([N_('Lens focal length (thin lens)'), st.f.toFixed(1) + ' λ']);
      say = t('Glass of index {n} slows the wave most where the lens is thickest, so the wavefront curves and converges about <strong>{f} wavelengths</strong> behind the lens.', { n: st.n.toFixed(2), f: st.f.toFixed(1) });
      tex = String.raw`\frac1f = (n-1)\left(\frac1{R_1}-\frac1{R_2}\right),\quad R = 2(n-1)f = ${texNum(2 * (st.n - 1) * st.f, 3)}\,\lambda`;
    } else if (st.scene === 'disc') {
      say = t('Behind an obstacle {w} wavelengths wide, waves bending round both sides meet in step on the axis: a bright line runs down the middle of the shadow (the Poisson–Arago spot).', { w: st.w.toFixed(1) });
      tex = String.raw`\Delta s = 0\ \text{on the axis}\Rightarrow\text{constructive interference}`;
    } else {
      say = t('Behind a straight edge the light leaks into the geometric shadow and ripples beside it: Fresnel edge diffraction.');
      tex = String.raw`I(v) = \tfrac12\left[\left(C(v)+\tfrac12\right)^2 + \left(S(v)+\tfrac12\right)^2\right]`;
    }
    ro.replaceChildren(readouts(rows));
    calc.say(say);
    calc.set(String.raw`\begin{aligned}
    \frac{\partial H_x}{\partial t} &= -\frac{1}{\mu_0}\frac{\partial E_z}{\partial y},\quad \frac{\partial H_y}{\partial t} = \frac{1}{\mu_0}\frac{\partial E_z}{\partial x}\\
    \frac{\partial E_z}{\partial t} &= \frac{1}{\varepsilon}\left(\frac{\partial H_y}{\partial x} - \frac{\partial H_x}{\partial y}\right)\\
    &${tex.split(',\\quad ').join('\\\\ &')}
    \end{aligned}`);
  }
  update();

  root.append(rule(String.raw`\[\Delta y \approx \frac{\lambda L}{d}\]
<p>Two slits a distance \(d\) apart make bright fringes on a screen at distance \(L\) separated by \(\lambda L/d\). With green light (\(\lambda\) = 0.5 µm), slits 0.1 mm apart and a screen 1 m away, the fringes are 5 mm apart: the closer the slits, the wider the pattern.</p>`,
    String.raw`The small-angle form holds while the fringes are much closer to the axis than the screen distance and the screen is far compared with \(d^2/\lambda\). Close to the slits (as in this grid) the pattern is still forming, and slits narrower than half a wavelength barely let this polarisation through.`));
  root.append(theory('Maxwell\'s equations on a grid', String.raw`
<div class="theory-cols"><div>
<h3>The Yee scheme</h3>
<p>In two dimensions with the electric field along \(z\) (TM\(_z\)), Maxwell's curl equations couple \(E_z\) to the in-plane magnetic field:</p>
\[\partial_t H_x = -\frac{1}{\mu_0}\partial_y E_z,\qquad \partial_t H_y = \frac{1}{\mu_0}\partial_x E_z,\qquad \partial_t E_z = \frac{1}{\varepsilon}\left(\partial_x H_y - \partial_y H_x\right).\]
<p>Yee (1966) staggered the three fields by half a cell in space and half a step in time, so every derivative is a centred difference, accurate to second order. The laboratory steps \(H\), then \(E\), on a 280 × 190 grid, with the Courant number \(S = c\,\Delta t/\Delta x = 0.5\), safely inside the two-dimensional stability limit \(1/\sqrt2\).</p>
<h3>Numerical dispersion</h3>
<p>On a grid, waves travel slightly slower than \(c\), more so for short wavelengths and oblique directions. With 12 cells per wavelength the phase-velocity error is below 1 %: the test suite measures a wavelength of 16.02 cells for 16 in vacuum and 10.56 for 10.67 in glass of \(n = 1.5\).</p>
<h3>Materials and boundaries</h3>
<p>Glass is a cell with \(\varepsilon = n^2\varepsilon_0\); a metal screen is a perfect conductor, where \(E_z = 0\). The edges of the grid are a 28-cell absorbing layer whose electric and magnetic losses grow as the cube of the depth and are matched (\(\sigma^*/\mu_0 = \sigma/\varepsilon_0\)), so an incoming wave meets no impedance step and dies away; a little light still returns at oblique incidence. The plane wave is a soft line source with a broad Gaussian profile, switched on smoothly over three periods; the point source is a single soft cell.</p>
</div><div>
<h3>What the scenes show</h3>
<p><b>Slits and gratings.</b> Each opening acts as a source of new wavelets (Huygens). Their sum at the screen is compared with the scalar Huygens–Fresnel integral in two dimensions, \(U(y) \propto \sum e^{ikr}(1+\cos\theta)/(2\sqrt r)\) over the openings. Rigorous and scalar results agree for openings wider than a wavelength; for narrower slits they part, because a slit is a metal waveguide whose lowest mode for \(E\) parallel to its walls is cut off below a width of \(\lambda/2\).</p>
<p><b>Edge and obstacle.</b> Light reaches into the geometric shadow of an edge and makes ripples beside it (Fresnel integrals). Behind a round obstacle the waves from both sides meet in phase on the axis, the bright line Poisson predicted to disprove the wave theory and Arago then saw.</p>
<p><b>Glass.</b> At a surface the wave slows to \(c/n\), its wavelength shrinks to \(\lambda/n\), it bends by Snell's law and part of it is reflected as the Fresnel equations say. A lens is glass that is thickest in the middle, so it delays the centre of the wavefront and makes it converge. A thin film reflects from both faces, and the two reflections interfere.</p>
<h3>Limits</h3>
<p>The world here is two-dimensional: the slits are long slots and the obstacle a cylinder, so waves spread as \(1/\sqrt r\) rather than \(1/r\). The grid is about 23 × 16 wavelengths, so everything happens in the near field, and the light is a single wavelength without dispersion. Real light oscillates \(10^{15}\) times a second; here a period takes a few dozen frames.</p>
</div></div>`));
  root.append(references([
    'K. S. Yee, "Numerical solution of initial boundary value problems involving Maxwell\'s equations in isotropic media", IEEE Trans. Antennas Propag. 14, 302 (1966).',
    'A. Taflove &amp; S. C. Hagness, <i>Computational Electrodynamics: The Finite-Difference Time-Domain Method</i>, 3rd ed., Artech House (2005).',
    'J. B. Schneider, <i>Understanding the Finite-Difference Time-Domain Method</i>, Washington State University (2010).',
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999), ch. 8 and 11.',
    'E. Hecht, <i>Optics</i>, 5th ed., Pearson (2017), ch. 9–10.',
  ]));
  return () => { alive = false; gen++; [field, prof].forEach((s) => s.destroy()); };
}
