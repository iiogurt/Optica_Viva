import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { SENSORS } from '../lib/sensors.js';
import { plot, range } from '../lib/plot.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Image corners are darker than the centre for three independent reasons. Geometry dims oblique light (the cos⁴ law). The lens barrel clips oblique bundles (mechanical vignetting, seen as cat\'s-eye bokeh). Pixels accept light only within a limited cone (pixel vignetting). Each one can be computed, and each behaves differently when you stop down.', domains: ['photo', 'video', 'space'] }));

  const ctl = controls({
    sensor: { type: 'select', label: 'Sensor', value: 'ff', options: ['ff', 'apsc', 'mft', 'phone'].map((k) => [k, SENSORS[k].name]) },
    f: { type: 'range', label: 'Focal length', min: 10, max: 100, log: true, value: 24, unit: 'mm' },
    N: { type: 'range', label: 'f-number', min: 1.2, max: 16, log: true, value: 1.4, fmt: (v) => 'f/' + v.toPrecision(2) },
    n: { type: 'range', label: 'Natural falloff exponent (cosⁿ)', min: 2, max: 4, step: 0.05, value: 4, hint: '4 for a thin lens; retrofocus designs with pupil magnification behave like n ≈ 3' },
    Rf: { type: 'range', label: 'Front rim radius', min: 6, max: 40, step: 0.5, value: 20, unit: 'mm' },
    df: { type: 'range', label: 'Front rim ahead of the pupil', min: 0, max: 60, step: 0.5, value: 18, unit: 'mm' },
    Rr: { type: 'range', label: 'Rear rim radius', min: 6, max: 40, step: 0.5, value: 17, unit: 'mm' },
    dr: { type: 'range', label: 'Rear rim behind the pupil', min: 0, max: 60, step: 0.5, value: 14, unit: 'mm' },
    xp: { type: 'range', label: 'Exit-pupil distance (→ chief-ray angle)', min: 8, max: 200, log: true, value: 55, unit: 'mm' },
    ml: { type: 'range', label: 'Microlens acceptance half-angle', min: 8, max: 45, step: 0.5, value: 22, unit: '°' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const flat = stage({ aspect: 1.5, label: 'Flat field (uniform white wall), with ⅓-EV contours', draw: drawFlat, minH: 260 });
  const curve = stage({ aspect: 2.4, label: '', draw: drawCurve, cls: 'plain', minH: 220 });
  const pupils = stage({ aspect: 5, label: 'Transmitted pupil area at 0, ¼, ½, ¾ and full field', draw: drawPupils, minH: 140 });
  root.append(lab([flat.el, h('div.card', { style: { padding: '6px' } }, curve.el), pupils.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  // fraction of the entrance pupil (radius rp) not clipped by the projected front and rear rims
  function mech(st, th) {
    const rp = st.f / (2 * st.N), t = Math.tan(th), G = 90;
    let inP = 0, pass = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = ((i + 0.5) / G * 2 - 1) * rp, y = ((j + 0.5) / G * 2 - 1) * rp;
      if (x * x + y * y > rp * rp) continue;
      inP++;
      if (Math.hypot(x - st.df * t, y) <= st.Rf && Math.hypot(x + st.dr * t, y) <= st.Rr) pass++;
    }
    return inP ? pass / inP : 0;
  }
  const pixel = (st, cra) => { const s = (st.ml * Math.PI) / 180; return Math.exp(-0.5 * (cra / (s / 1.5)) ** 2); };

  function update() {
    const st = ctl.state, S = SENSORS[st.sensor];
    const hd = Math.hypot(S.w, S.h) / 2;
    const thMax = Math.atan(hd / st.f);
    const hs = range(0, hd, 40);
    const comp = hs.map((hgt) => {
      const th = Math.atan(hgt / st.f), cra = Math.atan(hgt / st.xp);
      const nat = Math.pow(Math.cos(th), st.n), me = mech(st, th), px = pixel(st, cra) / pixel(st, 0);
      return { hgt, th, nat, me, px, tot: nat * me * px };
    });
    M = { st, S, hd, comp, thMax };
    const c = comp[comp.length - 1], ev = (v) => (v > 0 ? Math.log2(v) : -Infinity);
    ro.replaceChildren(readouts([
      ['Field angle at the corner', ((thMax * 180) / Math.PI).toFixed(1) + '°'],
      ['Chief-ray angle on the sensor', ((Math.atan(hd / st.xp) * 180) / Math.PI).toFixed(1) + '°'],
      ['Natural falloff (cosⁿ)', ev(c.nat).toFixed(2) + ' EV'],
      ['Mechanical vignetting', ev(c.me).toFixed(2) + ' EV'],
      ['Pixel vignetting', ev(c.px).toFixed(2) + ' EV'],
      ['Total corner falloff', ev(c.tot).toFixed(2) + ' EV'],
      ['Entrance-pupil radius f/2N', (st.f / (2 * st.N)).toFixed(2) + ' mm'],
    ]));
    calc.set(String.raw`\begin{aligned}
    \mathrm{RI}(\theta) &= \cos^{n}\theta\cdot V_\text{mech}(\theta)\cdot T_\text{px}(\theta_\text{CRA})\\
    &= ${texNum(c.nat, 3)}\times${texNum(c.me, 3)}\times${texNum(c.px, 3)} = ${texNum(c.tot, 3)}\\
    \Delta EV &= \log_2\mathrm{RI} = ${texNum(ev(c.tot), 3)}\\
    \theta_\text{CRA} &= \arctan(h/z_{XP}) = ${texNum((Math.atan(hd / st.xp) * 180) / Math.PI, 3)}^\circ
    \end{aligned}`);
    [flat, curve, pupils].forEach((s2) => s2.redraw());
  }

  function riAt(hgt) {
    const c = M.comp, t = (hgt / M.hd) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(t)), f = t - i;
    return c[i].tot * (1 - f) + c[i + 1].tot * f;
  }
  function drawFlat(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const S = M.S, W = 300, H = Math.round((W * S.h) / S.w), ic = imageCanvas(W, H);
    const RI = new Float64Array(W * H), EV = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const hx = ((x + 0.5) / W - 0.5) * S.w, hy = ((y + 0.5) / H - 0.5) * S.h, r = Math.min(M.hd, Math.hypot(hx, hy));
      RI[y * W + x] = riAt(r); EV[y * W + x] = 3 * Math.log2(Math.max(RI[y * W + x], 1e-3));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, v = RI[k], ev = EV[k];
      // contour every ⅓ EV, ~1 px wide: distance to the level divided by the local gradient
      const gx = EV[y * W + Math.min(W - 1, x + 1)] - ev, gy = EV[Math.min(H - 1, y + 1) * W + x] - ev;
      const band = ev < -0.15 && v > 2e-3 && Math.abs(ev - Math.round(ev)) / Math.max(Math.hypot(gx, gy), 1e-6) < 0.55;
      const g = Math.round(255 * Math.pow(Math.min(1, v * 0.92), 1 / 2.2)), o = (y * W + x) * 4;
      ic.data[o] = band ? 255 : g; ic.data[o + 1] = band ? 181 : g; ic.data[o + 2] = band ? 71 : g; ic.data[o + 3] = 255;
    }
    ic.put();
    const sc = Math.min(w / W, hh / H);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, (w - W * sc) / 2, (hh - H * sc) / 2, W * sc, H * sc);
  }
  function drawCurve(ctx, w, hh) {
    if (!M) return;
    const ev = (v) => Math.max(-6, Math.log2(Math.max(v, 1e-6)));
    plot(ctx, w, hh, {
      title: 'Relative illumination vs image height', x: { min: 0, max: M.hd, label: 'image height (mm)' }, y: { min: -4, max: 0.2, label: 'EV relative to centre' },
      series: [
        { data: M.comp.map((c) => [c.hgt, ev(c.nat)]), color: '#6ad7ff', width: 1.5, dash: [5, 3], label: 'natural cosⁿθ' },
        { data: M.comp.map((c) => [c.hgt, ev(c.me)]), color: '#c18cff', width: 1.5, dash: [5, 3], label: 'mechanical' },
        { data: M.comp.map((c) => [c.hgt, ev(c.px)]), color: '#6be3a4', width: 1.5, dash: [5, 3], label: 'pixel (CRA)' },
        { data: M.comp.map((c) => [c.hgt, ev(c.tot)]), color: '#ffb547', width: 2.6, label: 'total' },
      ],
      vlines: [{ x: M.S.w / 2, color: 'rgba(255,255,255,0.3)', label: 'edge' }, { x: M.S.h / 2, color: 'rgba(255,255,255,0.2)', label: 'top', dy: 14 }],
      legend: true, legendX: 70, legendY: hh - 110,
    });
  }
  function drawPupils(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const st = M.st, rp = st.f / (2 * st.N);
    const scale = Math.min(hh - 30, w / 5 - 10) / (2 * Math.max(rp, st.Rf, st.Rr) * 1.1);
    [0, 0.25, 0.5, 0.75, 1].forEach((fr, i) => {
      const th = Math.atan((fr * M.hd) / st.f), t = Math.tan(th);
      const cx = (w / 5) * (i + 0.5), cy = hh / 2 + 6;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, rp * scale, 0, 7); ctx.clip();
      ctx.beginPath(); ctx.arc(cx + st.df * t * scale, cy, st.Rf * scale, 0, 7); ctx.clip();
      ctx.beginPath(); ctx.arc(cx - st.dr * t * scale, cy, st.Rr * scale, 0, 7); ctx.clip();
      ctx.fillStyle = '#ffd27a'; ctx.fillRect(cx - 200, cy - 200, 400, 400);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx, cy, rp * scale, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(193,140,255,0.8)'; ctx.beginPath(); ctx.arc(cx + st.df * t * scale, cy, st.Rf * scale, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(106,215,255,0.8)'; ctx.beginPath(); ctx.arc(cx - st.dr * t * scale, cy, st.Rr * scale, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${((th * 180) / Math.PI).toFixed(0)}°`, cx, hh - 4);
    });
  }

  update();

  root.append(theory('Three kinds of vignetting', String.raw`
<div class="theory-cols"><div>
<h3>Natural vignetting: the cos⁴ law</h3>
<p>For an object point at field angle \(\theta\), viewed through a thin lens with a pupil of area \(A_p\), four factors of \(\cos\theta\) appear. One comes from the pupil being seen obliquely (projected area \(A_p\cos\theta\)). Two come from the longer distance to the image point (\(1/r^2 \to \cos^2\theta/f^2\)). One comes from the oblique incidence on the sensor. Hence</p>
\[E(\theta) = E_0\cos^4\theta.\]
<p>At 37° (the corner of a 28 mm lens on full frame) this is already −1.3 EV. Real wide-angle lenses beat it through <em>pupil aberration</em>. In retrofocus designs, the entrance pupil grows and tilts towards the oblique bundle, giving an effective exponent nearer 2–3. The Russar and Biogon designs exploited this deliberately.</p>
<h3>Mechanical (optical) vignetting</h3>
<p>An oblique bundle passes through the stop but is clipped by the rims of the front and rear elements. Projected onto the pupil plane, these rims are circles displaced by \(d\tan\theta\) in opposite directions. The transmitted bundle is the intersection of three circles, so this page counts a 90×90 grid of pupil points. It is the cat's-eye bokeh shape, and it shrinks rapidly on stopping down, because the small stop moves inside the rims' shadow.</p>
</div><div>
<h3>Pixel vignetting</h3>
<p>Microlenses funnel light into each photodiode only within an acceptance cone. The <em>chief-ray angle</em> at image height \(h\) is \(\theta_\text{CRA} = \arctan(h/z_{XP})\), set by the exit-pupil distance \(z_{XP}\). Short-flange mirrorless mounts and phone lenses have small \(z_{XP}\) and steep CRAs. Sensor makers compensate by shifting microlenses progressively toward the centre, but colour crosstalk and falloff remain. This is why legacy rangefinder wide-angles produce magenta corners on digital bodies. Image-space telecentric designs (\(z_{XP}\to\infty\)) remove pixel vignetting entirely, at the cost of a rear element as large as the sensor.</p>
<h3>Total relative illumination</h3>
\[\mathrm{RI}(\theta) = \cos^n\theta\;V_\text{mech}(\theta)\;T_\text{px}(\theta_\text{CRA}).\]
<p>Stopping down removes \(V_\text{mech}\) but not \(\cos^n\) or \(T_\text{px}\). Cameras correct the remainder with lens profiles (a radial gain map), which costs noise in the corners: every +1 EV of gain doubles the input-referred noise.</p>
<h3>Telescopes</h3>
<p>Astronomers correct vignetting, dust shadows and pixel-response non-uniformity together by dividing every frame by a <em>flat field</em>, an image of a uniformly illuminated twilight sky or dome screen. Accurate flats are essential for photometry at the 0.1 % level.</p>
</div></div>`));
  root.append(references([
    'M. Aggarwal, H. Hua &amp; N. Ahuja, "On cosine-fourth and vignetting effects in real lenses", ICCV (2001).',
    'R. Kingslake, "Illumination in optical images", in <i>Applied Optics and Optical Engineering</i> II, Academic Press (1965).',
    'P. B. Catrysse &amp; B. A. Wandell, "Optical efficiency of image sensor pixels", JOSA A 19, 1610 (2002).',
  ]));
  return () => [flat, curve, pupils].forEach((s) => s.destroy());
}
