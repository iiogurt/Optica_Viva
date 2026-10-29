import { h, controls, stage, readouts, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { oetf } from '../lib/color.js';
import { COATINGS } from '../lib/thinfilm.js';
import { uniform } from '../lib/random.js';
import { anamorphicAspect, streakColour, angleOfView, breathing, surfaceReflectance, transmission, tStop } from '../lib/cinema.js';
import { t, N_ } from '../lib/i18n.js';

const D2R = Math.PI / 180;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video', 'photo'] }));
  root.append(idea(String.raw`<p>Most films are shown in a wide format, more than twice as wide as tall. <strong>Anamorphic</strong> lenses get there by squeezing the scene sideways onto the sensor, like a funhouse mirror that makes people look thin, and the picture is stretched back out for viewing. Out-of-focus lights then become tall ovals, and bright lights throw long horizontal streaks: the classic "cinematic" look.</p>
<p>Cinema lenses also face a test photographers rarely care about: moving the focus from one actor to another must not visibly zoom the picture, which is called <strong>breathing</strong>. And they are marked in T-stops, which count the light that actually gets through.</p>`, [
    "Switch between <strong>Spherical</strong> and <strong>Anamorphic</strong> and watch the background lights: circles become tall ovals.",
    "Turn on <strong>Show the squeezed image as recorded</strong>: this is what the sensor actually sees.",
    "In the breathing section below, move the focus distance from 20 m to 0.35 m and watch how much the frame changes size.",
  ]));

  // ── anamorphic ──
  const ctl = controls({
    lens: { type: 'seg', label: 'Lens', value: 'ana', options: [['sph', 'Spherical'], ['ana', 'Anamorphic']] },
    s: { type: 'seg', label: 'Squeeze factor', value: '2', options: ['1.33', '1.5', '1.8', '2'], when: (st) => st.lens === 'ana' },
    N: { type: 'range', label: 'Aperture', min: 1.4, max: 11, log: true, value: 2, fmt: (v) => 'T' + v.toPrecision(2) },
    uf: { type: 'range', label: 'Focus distance (subject)', min: 0.8, max: 10, log: true, value: 1.2, unit: 'm' },
    bg: { type: 'range', label: 'Distance of the background lights', min: 5, max: 200, log: true, value: 30, unit: 'm' },
    hl: { type: 'range', label: 'Headlight brightness above exposure', min: 6, max: 20, step: 0.5, value: 15, unit: 'EV', when: (st) => st.lens === 'ana' },
    coat: { type: 'select', label: 'Coating of the cylinder elements', value: 'qhq', options: Object.entries(COATINGS).map(([k, c]) => [k, c.name]), when: (st) => st.lens === 'ana' },
    raw: { type: 'toggle', label: 'Show the squeezed image as recorded', value: false, when: (st) => st.lens === 'ana' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 2.39, label: '2.39 : 1 frame, 50 mm lens on an 18.7 mm-high gate, subject in focus', draw: drawScene, minH: 200 });
  root.append(lab([view.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const F = 50, GATE_H = 18.66, rnd = uniform(11);
  const LIGHTS = Array.from({ length: 70 }, () => ({ x: rnd() * 2 - 1, y: rnd() * 0.75 - 0.15, b: 0.3 + rnd() * 0.7, hue: rnd() }));
  let A = null;
  function update() {
    const st = ctl.state, s = st.lens === 'ana' ? +st.s : 1, vAov = 2 * Math.atan(GATE_H / 2 / F), hAov = 2 * Math.atan(Math.tan(vAov / 2) * 2.39);
    const D = F / st.N, blurV = D * Math.abs(1 / (st.bg * 1000) - 1 / (st.uf * 1000)); // rad: angular blur of a background point
    const sc = s > 1 ? streakColour(st.coat) : null;
    A = { st, s, vAov, hAov, blurV, sc };
    const sensorW = (GATE_H * 2.39) / s;
    ro.replaceChildren(readouts([
      ['Sensor area used', `${sensorW.toFixed(1)} × ${GATE_H.toFixed(1)} mm${s > 1 ? ` (${(sensorW / GATE_H).toFixed(2)} : 1 recorded)` : ''}`],
      ['Horizontal angle of view', (hAov / D2R).toFixed(1) + '°'],
      ['Bokeh of the lights: height × width', `${(blurV / D2R * 60).toFixed(1)}′ × ${(blurV / s / D2R * 60).toFixed(1)}′ (ratio ${s.toFixed(2)})`],
      ['Streak strength (two reflections)', sc ? `${sc.strength.toExponential(1)} of the source → ${Math.log2(sc.strength * 2 ** st.hl).toFixed(1)} EV vs exposure` : '—'],
      ['Same framing on a spherical lens needs', s > 1 ? `a ${(sensorW * s).toFixed(1)} mm wide sensor or ${(F / s).toFixed(0)} mm with a crop` : '—'],
    ]));
    calc.say((s > 1 ? `A ${s}× anamorphic squeeze makes the background lights ovals ${s.toFixed(1)} times taller than wide` : 'A spherical lens draws the background lights as circles') + `; each spans <strong>${(blurV / D2R * 60).toFixed(0)} arcminutes</strong> in height.`);
    calc.set(String.raw`\begin{aligned}
    \text{aspect} &= s\,\frac{w}{h} = ${texNum(s, 3)}\times${texNum(sensorW / GATE_H, 3)} = 2.39\\
    \beta_v &= \frac{D}{1}\left|\frac1{u_o}-\frac1{u_f}\right| = ${texNum(blurV * 1000, 3)}\ \text{mrad},\quad \beta_h = \beta_v/s
    \end{aligned}`);
    view.redraw();
  }
  function drawScene(ctx, w, hh) {
    if (!A) return;
    const st = A.st, s = A.s, raw = s > 1 && st.raw;
    ctx.fillStyle = '#04050a'; ctx.fillRect(0, 0, w, hh);
    const pxPerRad = hh / A.vAov, sx = raw ? 1 / s : 1; // the recorded image is squeezed horizontally
    ctx.save(); ctx.translate(w / 2, hh / 2); ctx.scale(sx, 1);
    const hw = w / 2 / sx;
    ctx.globalCompositeOperation = 'lighter';
    const rv = Math.max(1.2, (A.blurV * pxPerRad) / 2), rh = rv / s;
    const hues = [[1, 0.75, 0.45], [1, 0.9, 0.7], [0.6, 0.8, 1], [1, 0.55, 0.35]];
    for (const L of LIGHTS) {
      const x = L.x * hw, y = -L.y * hh / 2, c = hues[Math.floor(L.hue * hues.length)], a = Math.min(0.9, 0.25 + 0.5 * L.b);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${c.map((q) => Math.round(255 * q)).join(',')},${a * 0.8})`); g.addColorStop(0.85, `rgba(${c.map((q) => Math.round(255 * q)).join(',')},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(x, y); ctx.scale(rh, rv); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill(); ctx.restore();
    }
    // a bright headlight and, through an anamorphic lens, its horizontal streak
    const hx = 0.32 * hw, hy = 0.05 * hh;
    if (A.sc) {
      const gain = Math.min(1, A.sc.strength * 2 ** st.hl),  c = A.sc.rgb.map((q) => Math.round(255 * oetf(q)));
      for (const [thk, al] of [[1.5, 0.9], [5, 0.35], [14, 0.12]]) {
        const g = ctx.createLinearGradient(-hw, 0, hw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5 + (hx / hw) * 0.5, `rgba(${c.join(',')},${al * gain})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(-hw, hy - thk / 2, 2 * hw, thk);
      }
    }
    const gl = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(rv, 10) * 1.2);
    gl.addColorStop(0, 'rgba(255,255,255,1)'); gl.addColorStop(0.3, 'rgba(255,240,220,0.8)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(hx, hy); ctx.scale(1 / s, 1); ctx.translate(-hx, -hy); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(hx, hy, Math.max(rv, 10) * 1.2, 0, 7); ctx.fill(); ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // subject in focus: head-and-shoulders silhouette with a rim light (scaled by angle)
    const k = hh / 2.2;
    ctx.fillStyle = '#0d0e14'; ctx.strokeStyle = 'rgba(255,200,150,0.55)'; ctx.lineWidth = 1.5 / sx;
    ctx.beginPath(); ctx.ellipse(-0.42 * hw, 0.05 * k, 0.17 * k, 0.22 * k, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.42 * hw - 0.55 * k, hh / 2); ctx.quadraticCurveTo(-0.42 * hw - 0.5 * k, 0.32 * k, -0.42 * hw, 0.3 * k); ctx.quadraticCurveTo(-0.42 * hw + 0.5 * k, 0.32 * k, -0.42 * hw + 0.55 * k, hh / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (raw) { ctx.strokeStyle = 'rgba(255,181,71,0.7)'; ctx.setLineDash([5, 4]); ctx.strokeRect(w / 2 - w / 2 / s, 1, w / s, hh - 2); ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText('recorded (squeezed) image', w / 2 - w / 2 / s + 6, 16); }
  }

  // ── focus breathing ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Focus breathing'));
  const bctl = controls({ umin: { type: 'range', label: 'Focus distance', min: 0.35, max: 20, log: true, value: 0.6, unit: 'm' } }, () => updB());
  const bro = h('div');
  const frames = stage({ aspect: 1.5, label: 'Frame at infinity focus (white) and at the chosen focus distance, Super 35 gate', draw: drawFrames, minH: 220 });
  const bplot = stage({ aspect: 1.5, label: '', draw: drawBPlot, cls: 'plain', minH: 220 });
  sec2.append(lab([h('div.grid-2', {}, frames.el, h('div.card', { style: { padding: '6px' } }, bplot.el))], [h('div.card', {}, bctl.el), h('div.card', {}, bro)]));
  root.append(sec2);
  const S35 = 24.89, SCHEMES = [['unit', N_('Unit focusing (whole lens moves)'), '#ffb547'], ['rear', N_('Internal focus (rear group moves)'), '#6ad7ff'], ['ideal', N_('Breathing-compensated cinema lens'), '#6be3a4']];
  function updB() {
    const u = bctl.state.umin * 1000;
    bro.replaceChildren(readouts(SCHEMES.map(([k, n]) => [n, `${(100 * breathing(k, F, u, S35)).toFixed(1)} % angle of view`])));
    [frames, bplot].forEach((x) => x.redraw());
  }
  function drawFrames(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    // a resolution chart as the scene
    const cw = w * 0.86, ch = cw / 1.5, x0 = (w - cw) / 2, y0 = (hh - ch) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(x0 + (i / 12) * cw, y0); ctx.lineTo(x0 + (i / 12) * cw, y0 + ch); ctx.stroke(); }
    for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(x0, y0 + (i / 8) * ch); ctx.lineTo(x0 + cw, y0 + (i / 8) * ch); ctx.stroke(); }
    const u = bctl.state.umin * 1000, a0 = angleOfView('unit', F, Infinity, S35);
    const box = (k, col, dash) => { const r = Math.tan(angleOfView(k, F, u, S35) / 2) / Math.tan(a0 / 2), bw = cw * 0.8 * r, bh = bw / 1.5; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 2; ctx.strokeRect(w / 2 - bw / 2, hh / 2 - bh / 2, bw, bh); ctx.setLineDash([]); };
    box('ideal', '#ffffff', []);
    SCHEMES.slice(0, 2).forEach(([k, , c]) => box(k, c, [6, 4]));
  }
  function drawBPlot(ctx, w, hh) {
    const us = logRange(300, 30000, 80);
    plot(ctx, w, hh, {
      title: 'Change of the horizontal angle of view (50 mm, S35)', x: { min: 0.3, max: 30, log: true, label: 'focus distance (m)' }, y: { min: -14, max: 2, label: 'Δ angle of view (%)' },
      series: SCHEMES.map(([k, n, c]) => ({ data: us.map((u) => [u / 1000, 100 * breathing(k, F, u, S35)]), color: c, width: 2, label: n })),
      vlines: [{ x: bctl.state.umin, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: w - 250, legendY: hh - 92,
    });
  }

  // ── T-stops ──
  const sec3 = h('section.block', {}, h('h2', {}, 'T-stops: counting the light that gets through'));
  const tctl = controls({
    N: { type: 'range', label: 'Geometric f-number', min: 1.2, max: 8, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    k: { type: 'range', label: 'Air–glass surfaces', min: 2, max: 40, step: 2, value: 20 },
    coat: { type: 'select', label: 'Coating', value: 'qhq', options: Object.entries(COATINGS).map(([k, c]) => [k, c.name]) },
  }, () => updT());
  const tro = h('div');
  const tcalc = liveCalc();
  const tplot = stage({ aspect: 2.3, label: '', draw: drawT, cls: 'plain', minH: 210 });
  sec3.append(lab([h('div.card', { style: { padding: '6px' } }, tplot.el)], [h('div.card', {}, tctl.el), h('div.card', {}, tro), tcalc.el]));
  root.append(sec3);
  function updT() {
    const st = tctl.state, R = surfaceReflectance(st.coat), tau = transmission(st.coat, st.k), T = tStop(st.N, tau);
    tro.replaceChildren(readouts([['Reflectance per surface (photopic)', (100 * R).toFixed(2) + ' %'], ['Transmission (incl. 1 % absorption)', (100 * tau).toFixed(1) + ' %'], ['T-stop', 'T' + T.toFixed(2)], ['Light lost vs the f-number', (Math.log2(1 / tau)).toFixed(2) + ' EV']]));
    tcalc.set(String.raw`T = \frac{N}{\sqrt{\tau}},\quad \tau = (1-R)^k\,\tau_\text{int} = (1-${texNum(R, 3)})^{${st.k}}\times0.99 = ${texNum(tau, 3)}\ \Rightarrow\ T = ${texNum(T, 3)}`);
    tplot.redraw();
  }
  function drawT(ctx, w, hh) {
    const ks = Array.from({ length: 20 }, (_, i) => 2 + 2 * i), st = tctl.state, cols = { none: '#ff6b6b', mgf2: '#ffb547', qhq: '#6ad7ff', graded: '#6be3a4' };
    plot(ctx, w, hh, {
      title: t('T-stop of an f/{N} lens vs number of air–glass surfaces', { N: st.N.toPrecision(2) }), x: { min: 2, max: 40, label: 'air–glass surfaces' }, y: { min: st.N * 0.95, max: st.N * 2.2, label: 'T-stop' },
      series: Object.keys(COATINGS).map((c) => ({ data: ks.map((k) => [k, tStop(st.N, transmission(c, k))]), color: cols[c] || '#fff', width: c === st.coat ? 2.4 : 1.3, label: COATINGS[c].name })),
      vlines: [{ x: st.k, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: 70, legendY: 34,
    });
  }

  update(); updB(); updT();

  root.append(rule(String.raw`\[\text{aspect on screen} = s \times \frac{w}{h}\]
<p>The squeeze factor \(s\) multiplies the aspect ratio recorded on the sensor. A 2× anamorphic on an area about 1.2 times as wide as tall gives the 2.39 : 1 widescreen format. Out-of-focus lights are squeezed by the same factor, so they look \(s\) times taller than wide once the picture is stretched back. T-stops: \(T = N/\sqrt{\tau}\), where \(\tau\) is the lens's transmission, so an f/2 lens that passes 80 % of the light is a T2.2.</p>`,
    String.raw`Real anamorphics squeeze by slightly different amounts at different focus distances and across the frame, and their ovals are also clipped by the cylindrical elements. T-stops fix the exposure, not the depth of field, which still follows the f-number.`));
  root.append(theory('Cinema optics', String.raw`
<div class="theory-cols"><div>
<h3>Anamorphic lenses</h3>
<p>An anamorphic lens adds cylindrical optics, classically an afocal front group, with an angular magnification of \(1/s\) horizontally and 1 vertically. The recorded image is squeezed horizontally by \(s\) and stretched back in projection or post-production. A 2× squeeze on a 1.2 : 1 gate gives 2.39 : 1 widescreen while using the full sensor height.</p>
<p>The afocal attachment also makes the entrance pupil \(s\) times narrower horizontally than vertically. An out-of-focus point subtends \(D\,|1/u_o - 1/u_f|\) vertically but \(1/s\) of that horizontally, so after desqueezing it is an oval \(s\) times taller than wide. Horizontal depth of field is correspondingly deeper. Lenses with a rear anamorphic group squeeze the bokeh less.</p>
<p>Bright sources produce the famous horizontal streak: light reflected twice between cylindrical surfaces stays focused vertically but spreads across the frame horizontally. Its colour is the spectrum \(R(\lambda)^2\) of the twice-reflected light, computed here from the thin-film reflectance of the chosen coating. Broadband multicoatings leave mostly violet and blue, hence the iconic blue streak; uncoated glass gives a brighter, near-white one.</p>
</div><div>
<h3>Focus breathing</h3>
<p>Focusing changes the angle of view. A lens moved bodily away from the sensor images with \(v = f(1+m)\), so the angle of view narrows by \(1/(1+m)\): −10 % for a 50 mm lens focused at 0.45 m. Internal-focus designs move a group instead. The paraxial model here, a positive front group and a negative rear group moving with the sensor fixed, breathes less. Cinema lenses are designed so that a focus pull does not visibly zoom.</p>
<h3>T-stops</h3>
<p>The f-number is geometry. The exposure depends on the transmitted fraction \(\tau\), so cinema lenses are marked in T-stops, \(T = N/\sqrt{\tau}\). Each air–glass surface reflects \(R\) (5 % uncoated at n = 1.6, under 0.5 % with a broadband multicoating), so \(\tau = (1-R)^k\tau_\text{int}\). A 20-surface zoom without coatings would lose 1.6 stops; with modern coatings it loses about 0.1. Matching T-stops, not f-stops, keeps exposure constant when lenses are changed between shots.</p>
</div></div>`));
  root.append(references([
    'S. F. Ray, <em>Applied Photographic Optics</em>, 3rd ed., Focal Press (2002): anamorphic systems, T-numbers, focusing methods.',
    'R. Kingslake, <em>A History of the Photographic Lens</em>, Academic Press (1989): Chrétien\'s Hypergonar and CinemaScope.',
    'H. A. Macleod, <em>Thin-Film Optical Filters</em>, 4th ed., CRC Press (2010): reflectance of single-layer and multilayer coatings.',
    'ISO 517:2008 / SMPTE: definitions of the T-number for cinematography lenses.',
  ]));

  return () => [view, frames, bplot, tplot].forEach((x) => x.destroy());
}
