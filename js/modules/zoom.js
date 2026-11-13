// Zoom lenses: four groups, two of them moving on cams, traced paraxially as the focal length changes;
// what a camera sees through it, and what happens to focus when the compensator does not follow its cam.
import { h, controls, stage, readouts, fmt, texNum, setControl, reducedMotion } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { DESIGN as D, cam, trace, state, p2For, range, pupil, rays, depthOfFocus, blur, FULL_FRAME, halfAngle } from '../lib/zoom.js';
import { t, N_ } from '../lib/i18n.js';

const [FMIN, FMAX] = range(), SENSOR = D.p4 + D.f4;
const GROUPS = [N_('G1 focus group'), N_('G2 variator'), N_('G3 compensator'), N_('G4 master, stop')];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'cinema'] }));
  root.append(idea(String.raw`<p>A zoom lens changes its focal length, from wide-angle to telephoto, without being swapped. Inside, groups of lenses slide along the barrel: one group, the <em>variator</em>, changes the magnification, and a second group, the <em>compensator</em>, follows a carefully shaped curved slot (a <em>cam</em>) so that the picture stays sharp on the sensor the whole time.</p>
<p>A zoom that stays in focus while zooming is called <em>parfocal</em>; film and television cameras need it so the operator can zoom during a shot. Cheaper "varifocal" lenses let the focus drift and must be refocused.</p>`, [
    'Play the zoom and watch the <strong>compensator</strong>: does it move steadily one way, like the variator?',
    'Push the compensator <strong>100 µm off its cam</strong>: is the picture soft at every focal length, or only some? Then <strong>lock</strong> it.',
    'Look at the <strong>entrance pupil</strong> at 30 mm and at 100 mm with the f-number fixed: why must the front lens be so big?',
  ]));

  const ctl = controls({
    z: { type: 'range', label: 'Zoom ring', min: 0, max: 1, step: 0.001, value: 0.35, fmt: (v) => `${fmt(FMIN * (FMAX / FMIN) ** v, 3)} mm` },
    mode: { type: 'seg', label: 'Compensator', value: 'cam', options: [['cam', 'On its cam'], ['locked', 'Locked at the wide end']] },
    err: { type: 'range', label: 'Compensator off its cam by (machining, play)', min: 0, max: 200, step: 1, value: 0, unit: 'µm', when: (st) => st.mode === 'cam' },
    N: { type: 'range', label: 'f-number (stop in the master group)', min: 2, max: 11, log: true, value: 2.8 },
    play: { type: 'toggle', label: 'Zoom in and out', value: false },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const draw = stage({ aspect: 2.6, label: 'The lens: groups and rays (axial beam blue, edge of the field amber)', draw: drawLens, minH: 230 });
  const view = stage({ aspect: 1.5, label: 'What the camera sees (full frame)', draw: drawView, minH: 220 });
  const camSt = stage({ aspect: 1.25, label: '', name: N_('Cam curves'), draw: drawCam, cls: 'plain', minH: 230 });
  const focus = stage({ aspect: 2.8, label: '', name: N_('Focus error across the zoom range'), draw: drawFocus, cls: 'plain', minH: 190 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([draw.el, h('div.grid-2', {}, view.el, card(camSt)), card(focus)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // the compensator position in each mode, for variator position p2
  const p3w = cam(D.p2min);
  const comp = (p2, mode, err = ctl.state.err) => (mode === 'cam' ? cam(p2) + err / 1000 : p3w);
  // the zoom ring sets the variator; with the exact cam the focal length is then log-spaced
  const p2Of = (z) => p2For(FMIN * (FMAX / FMIN) ** z);
  const now = () => { const s = ctl.state, p2 = p2Of(s.z), p3 = comp(p2, s.mode), st = state(p2, p3); return { s, p2, p3, st, defocus: st.image - SENSOR }; };

  function update() { words(); draw.redraw(); view.redraw(); camSt.redraw(); focus.redraw(); if (ctl.state.play && !raf) raf = requestAnimationFrame(loop); }

  // playing: the ring swept from wide to tele and back in 8 s
  let raf = 0, last = 0, dir = 1;
  function loop(ts) {
    raf = 0;
    if (!ctl.state.play || !root.isConnected) { last = 0; return; }
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    let z = ctl.state.z + (dir * dt) / 4;
    if (z > 1) { z = 1; dir = -1; } else if (z < 0) { z = 0; dir = 1; }
    setControl('z', +z.toFixed(4));
    raf = requestAnimationFrame(loop);
  }

  function words() {
    const { s, p2, p3, st, defocus } = now(), N = s.N, ep = pupil(st, N), dof = depthOfFocus(N, FULL_FRAME.coc), hf = halfAngle(st.efl);
    ro.replaceChildren(readouts([
      ['Focal length', `${fmt(st.efl, 4)} mm (range ${fmt(FMIN, 3)}–${fmt(FMAX, 4)} mm, ${fmt(FMAX / FMIN, 3)}×)`],
      ['Variator and compensator positions', `${fmt(p2, 4)} mm, ${fmt(p3, 4)} mm`],
      ['Magnification of the afocal front (G1–G3)', `${fmt(st.M, 4)}×`],
      ['Entrance pupil diameter', `${fmt(ep, 3)} mm (f/${fmt(N, 2)} at every focal length)`],
      ['Horizontal field of view (36 mm)', `${fmt((2 * hf * 180) / Math.PI, 3)}°`],
      ['Image from the master group', `${fmt(st.bfl, 5)} mm (sensor at ${fmt(D.f4, 3)} mm)`],
      ['Focus error at the sensor', `${fmt(defocus * 1000, 4)} µm`],
      ['Depth of focus ±N·c (c = 30 µm)', `±${fmt(dof * 1000, 3)} µm`],
      ['Blur circle', `${fmt(blur(defocus, N) * 1000, 3)} µm`],
    ]));
    calc.say(t('The variator at {p2} mm makes the front groups an afocal telescope of magnification {M}, so the {f4} mm master group gives f = {f} mm. On its cam the compensator keeps the light between G3 and G4 parallel, so the image stays {f4} mm behind G4; an error δ of the compensator moves the image by (f₄/f₃)²·δ. The focus error is <strong>{d} µm</strong> against a depth of focus of ±{dof} µm.', {
      p2: fmt(p2, 4), M: fmt(st.M, 4), f4: D.f4, f: fmt(st.efl, 4), p3: fmt(p3, 4), d: fmt(defocus * 1000, 4), dof: fmt(dof * 1000, 3),
    }));
    calc.set(String.raw`\begin{aligned}
    s_2 &= f_1 - p_2 = ${texNum(D.f1 - p2, 4)},\quad s_2' = \Big(\frac{1}{f_2}+\frac{1}{s_2}\Big)^{-1} = ${texNum(1 / (1 / D.f2 + 1 / (D.f1 - p2)), 4)},\quad p_3^\text{cam} = p_2 + s_2' + f_3 = ${texNum(cam(p2), 4)}\ \text{mm}\\
    f &= M\,f_4 = ${texNum(st.M, 4)}\times ${D.f4} = ${texNum(st.efl, 4)}\ \text{mm},\qquad D_\text{EP} = M\,\frac{f_4}{N} = ${texNum(pupil(st, N), 3)}\ \text{mm},\qquad \frac{f}{D_\text{EP}} = ${texNum(N, 3)}
    \end{aligned}`);
  }

  // ── drawing the lens ──
  // group half-heights: the largest ray height at each group over the zoom range at f/2
  const HALF = (() => {
    const m = [0, 0, 0, 0];
    for (let i = 0; i <= 40; i++) {
      const z = i / 40, p2 = p2Of(z), p3 = cam(p2), r = rays(p2, p3, 2, halfAngle(state(p2, p3).efl));
      for (const [y, u] of [[r.marginal[0] + r.chief[0], r.chief[1]], [-r.marginal[0] + r.chief[0], r.chief[1]], [r.marginal[0], 0]]) trace(r.lenses, y, u).pts.forEach(([, yy], k) => { m[k] = Math.max(m[k], Math.abs(yy)); });
    }
    return m.map((v) => v * 1.06);
  })();
  function drawLens(ctx, w, hh) {
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    // lengths along the axis and heights have separate scales (heights compressed to fit)
    const { s, p2, p3, st } = now(), x0 = -30, sc = (w - 40) / (SENSOR - x0 + 10), sy = Math.min(sc, (hh - 104) / (2 * Math.max(...HALF))), cy = 34 + (hh - 54) / 2;
    const X = (x) => 20 + (x - x0) * sc, Y = (y) => cy - y * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(x0), cy); ctx.lineTo(X(SENSOR + 6), cy); ctx.stroke(); ctx.setLineDash([]);
    const r = rays(p2, p3, s.N, halfAngle(st.efl)), L = r.lenses;
    const ray = (y, u, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(x0), Y(y - u * (0 - x0)));
      const tr = trace(L, y, u);
      for (const [x, yy] of tr.pts) ctx.lineTo(X(x), Y(yy));
      ctx.lineTo(X(SENSOR), Y(tr.y + tr.u * (SENSOR - tr.x))); ctx.stroke();
    };
    const [h0] = r.marginal, [yc, uc] = r.chief;
    for (const sg of [-1, 1]) ray(sg * h0, 0, 'rgba(106,215,255,0.8)');
    for (const sg of [-1, 0, 1]) ray(yc + sg * h0, uc, sg ? 'rgba(255,200,110,0.65)' : 'rgba(255,200,110,0.95)');
    // the groups as thin-lens symbols
    L.forEach(([x, f], k) => {
      const hy = HALF[k], px = X(x), pos = f > 0, a = 6;
      ctx.strokeStyle = ['#a8d6ff', '#ffb08a', '#7be3a4', '#d7b4ff'][k]; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px, Y(hy)); ctx.lineTo(px, Y(-hy)); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath();
      if (pos) { ctx.moveTo(px - a, Y(hy) + a); ctx.lineTo(px, Y(hy)); ctx.lineTo(px + a, Y(hy) + a); ctx.moveTo(px - a, Y(-hy) - a); ctx.lineTo(px, Y(-hy)); ctx.lineTo(px + a, Y(-hy) - a); }
      else { ctx.moveTo(px - a, Y(hy) - a); ctx.lineTo(px, Y(hy)); ctx.lineTo(px + a, Y(hy) - a); ctx.moveTo(px - a, Y(-hy) + a); ctx.lineTo(px, Y(-hy)); ctx.lineTo(px + a, Y(-hy) + a); }
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(t(GROUPS[k]), px, Y(-hy) + 6);
    });
    // stop, sensor and image
    const ep = pupil(st, s.N) / 2;
    ctx.strokeStyle = '#d7b4ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(D.p4) + 5, Y(HALF[3])); ctx.lineTo(X(D.p4) + 5, Y(D.f4 / s.N / 2)); ctx.moveTo(X(D.p4) + 5, Y(-HALF[3])); ctx.lineTo(X(D.p4) + 5, Y(-D.f4 / s.N / 2)); ctx.stroke();
    ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(SENSOR), Y(FULL_FRAME.w / 2)); ctx.lineTo(X(SENSOR), Y(-FULL_FRAME.w / 2)); ctx.stroke();
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(X(Math.min(SENSOR + 8, Math.max(x0, st.image))), cy, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('f = {f} mm · entrance pupil {d} mm · sensor (blue), image of a distant point (gold) · heights ×{k}', { f: fmt(st.efl, 4), d: fmt(2 * ep, 3), k: fmt(sy / sc, 2) }), 10, hh - 18);
  }

  // ── what the camera sees: a log-polar test scene, blurred by the focus error ──
  const PAL = [[0.95, 0.75, 0.2], [0.2, 0.55, 0.85], [0.92, 0.92, 0.9], [0.85, 0.3, 0.25], [0.3, 0.7, 0.45], [0.55, 0.4, 0.8]];
  function sceneAt(ax, ay, o) {
    const r = Math.hypot(ax, ay), a = Math.atan2(ay, ax), R0 = 0.05;
    if (r < R0) { const v = Math.sin(18 * a) > 0 ? 0.06 : 0.92; o[0] = o[1] = o[2] = v; return; }
    const ring = Math.floor(Math.log(r / R0) / Math.log(1.3)), n = 10 + 4 * ring, f = ((a / (2 * Math.PI)) * n + n) % n, sec = Math.floor(f), fr = f - sec, rr = (Math.log(r / R0) / Math.log(1.3)) % 1;
    if (fr < 0.05 || rr < 0.07) { o[0] = o[1] = o[2] = 0.1; return; }
    const c = PAL[(sec * 7 + ring * 3) % PAL.length]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
  }
  const DISK = Array.from({ length: 16 }, (_, i) => { const r = Math.sqrt((i + 0.5) / 16), a = i * 2.39996; return [r * Math.cos(a), r * Math.sin(a)]; });
  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const { s, st, defocus } = now(), top = 34, Wd = w - 16, Hd = hh - top - 26, ww = Math.min(Wd, (Hd * 3) / 2), hd = (ww * 2) / 3, r = { x: (w - ww) / 2, y: top, w: ww, h: hd };
    const tx = FULL_FRAME.w / 2 / st.efl, ty = FULL_FRAME.h / 2 / st.efl, rho = blur(defocus, s.N) / 2 / st.efl, pix = (2 * tx) / ww, c = [0, 0, 0];
    paint(view, r, (u, v, o) => {
      const ax = Math.atan((u * 2 - 1) * tx), ay = Math.atan((1 - v * 2) * ty);
      if (rho < pix * 0.5) { sceneAt(ax, ay, o); return; }
      let R = 0, G = 0, B = 0;
      for (const [dx, dy] of DISK) { sceneAt(ax + dx * rho, ay + dy * rho, c); R += c[0] ** 2.2; G += c[1] ** 2.2; B += c[2] ** 2.2; }
      o[0] = encode(R / 16); o[1] = encode(G / 16); o[2] = encode(B / 16);
    }, `${fmt(st.efl, 6)}|${fmt(defocus, 6)}|${s.N}`, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(t('{f} mm · focus error {d} µm', { f: fmt(st.efl, 3), d: fmt(defocus * 1000, 3) }), w / 2, r.y + hd + 6);
  }

  // ── charts ──
  function drawCam(ctx, w, hh) {
    const s = ctl.state, zs = Array.from({ length: 81 }, (_, i) => i / 80), cur = now();
    const path = (fn) => zs.map((z) => { const p2 = p2Of(z); return [fn(p2), FMIN * (FMAX / FMIN) ** z]; });
    plot(ctx, w, hh, {
      title: N_('Cam curves: where the groups sit at each focal length'), x: { min: -5, max: SENSOR + 5, label: N_('position along the lens (mm)') }, y: { min: FMIN * 0.95, max: FMAX * 1.05, log: true, label: N_('focal length (mm)') },
      series: [
        { data: [[0, FMIN * 0.95], [0, FMAX * 1.05]], color: '#a8d6ff', width: 2, label: N_('G1, G4 and sensor fixed') },
        { data: [[D.p4, FMIN * 0.95], [D.p4, FMAX * 1.05]], color: '#d7b4ff', width: 2 },
        { data: [[SENSOR, FMIN * 0.95], [SENSOR, FMAX * 1.05]], color: '#6ad7ff', width: 2 },
        { data: path((p2) => p2), color: '#ffb08a', width: 2.2, label: N_('variator (linear)') },
        { data: path((p2) => cam(p2)), color: '#7be3a4', width: 2.2, label: N_('compensator cam') },
        ...(s.mode !== 'cam' ? [{ data: path((p2) => comp(p2, s.mode)), color: '#7be3a4', width: 1.4, dash: [5, 4], label: N_('compensator locked') }] : []),
      ],
      hlines: [{ y: cur.st.efl, label: N_('now'), color: '#ffd27a' }], legend: true,
    });
  }
  function drawFocus(ctx, w, hh) {
    const s = ctl.state, zs = Array.from({ length: 121 }, (_, i) => i / 120), dof = depthOfFocus(s.N, FULL_FRAME.coc) * 1000;
    const ser = (mode) => zs.map((z) => { const p2 = p2Of(z), st = state(p2, comp(p2, mode)); return [FMIN * (FMAX / FMIN) ** z, (st.image - SENSOR) * 1000]; });
    const lk = ser('locked'), off = ser('cam'), lim = Math.max(3 * dof, ...off.map((p) => Math.abs(p[1]))) * 1.15;
    plot(ctx, w, hh, {
      title: N_('Focus error across the zoom range'), x: { min: FMIN, max: FMAX, log: true, label: N_('focal length on the exact cam (mm)') }, y: { min: -lim, max: lim, label: N_('focus error (µm)') },
      bands: [{ y: [-dof, dof], color: 'rgba(107,227,164,0.14)' }],
      series: [{ data: off, color: '#ffffff', width: 2.2, label: N_('on its cam (with the set error)') }, { data: lk, color: '#c18cff', width: 1.5, dash: [2, 3], label: N_('locked at the wide end (soon off the chart)') }],
      vlines: [{ x: FMIN * (FMAX / FMIN) ** s.z, label: N_('now'), color: '#ffd27a' }], hlines: [{ y: dof, label: N_('depth of focus'), color: 'rgba(107,227,164,0.7)' }], legend: true,
    });
  }

  if (ctl.state.play && reducedMotion()) setControl('play', false);
  update();

  root.append(rule(String.raw`\[f = M\,f_4,\qquad N = \frac{f}{D_\text{EP}} = \frac{f_4}{D_\text{stop}}\]
<p>The three front groups form a telescope of adjustable magnification M in front of a fixed 50 mm master lens: M from 0.6 to 2.1 gives 30–106 mm. The aperture stop sits in the master group, so the f-number stays the same while the entrance pupil grows with M: at 100 mm and f/2.8 it is 36 mm wide, which is why telephoto zooms need large front elements.</p>`,
    String.raw`Thin groups traced paraxially (no aberrations, which in real zooms change with focal length and dominate their design); object at infinity, so focusing by G1 is not modelled; the straight cam joins the exact cam's end points. Real zooms have 10–25 elements in 4–6 groups, often with more than one compensator, floating groups and internal focusing.`));
  root.append(theory('How a zoom lens keeps its focus', String.raw`
<div class="theory-cols"><div>
<h3>The afocal zoom</h3>
<p>The front group G1 forms an image of a distant object at its focal point. The negative variator G2 re-images it with a magnification that changes as G2 slides; the compensator G3 is placed so that this image lies in its front focal plane, and the light leaving G3 is parallel again. G1–G3 form a telescope of angular magnification M, and the fixed master group G4 forms the final image at its own focal length behind it: \(f = M f_4\), and the image never moves. The compensator's path is not a straight line: here it moves quickly at the wide end and almost stops at the long end (in many designs it even reverses), so the cam slot in the barrel has to be machined with that curve (mechanically compensated zoom; Clark 1973).</p>
<h3>Constant aperture</h3>
<p>With the stop in G4, its image seen from the front, the entrance pupil, is M times the stop, so the f-number \(f/D_\text{EP} = f_4/D_\text{stop}\) does not change while zooming. Zooms with the stop in a moving group lose light at the long end (variable-aperture zooms).</p>
</div><div>
<h3>Parfocal and varifocal</h3>
<p>If the compensator does not follow the exact cam, the light leaving G3 is no longer parallel and the image moves off the sensor: a straight cam through the correct end positions leaves an error in between, and a locked compensator ruins focus completely. Varifocal lenses accept the drift and are refocused after zooming; cinema and broadcast zooms must be parfocal within the depth of focus, ±N·c.</p>
<h3>Optical compensation</h3>
<p>Early zooms moved two groups linked together on one slide (optically compensated), which kept the focus right only at a few points; cams made precise compensation practical (Kingslake 1960).</p>
</div></div>`));
  root.append(references([
    'R. Kingslake, "The development of the zoom lens", J. SMPTE 69, 534 (1960).',
    'A. D. Clark, <i>Zoom Lenses</i>, Adam Hilger (1973).',
    'W. J. Smith, <i>Modern Optical Engineering</i>, 4th ed., McGraw-Hill (2008).',
    'R. Kingslake &amp; R. B. Johnson, <i>Lens Design Fundamentals</i>, 2nd ed., Academic Press (2010).',
  ]));
  return () => { cancelAnimationFrame(raf); [draw, view, camSt, focus].forEach((st) => st.destroy()); };
}
