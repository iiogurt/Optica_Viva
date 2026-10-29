import { h, controls, stage, readouts, imageCanvas, texNum, fmt, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { tiltedLens, tiltedObject } from '../lib/optics.js';
import { TILT, SHIFT, BLUR_LEVELS, camH, camPitch } from '../lib/scenes.js';
import { runOn, parallel, rowBands, poolSize } from '../lib/compute.js';
import { view3d } from '../lib/gl3d.js';
import { scheimpflugScene, townScene } from '../lib/tilt3d.js';
import { t } from '../lib/i18n.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Normally the sensor and the lens are parallel, so the zone of sharp focus is a flat wall facing the camera. Tilt the lens a few degrees and that wall tips over: it can lie along the ground, so flowers at your feet and distant mountains are sharp at once, even with a wide aperture.</p>
<p>Tilt it the other way and the sharp zone cuts steeply through the scene, leaving only a thin band sharp. A real town then looks like a toy model, because we link such shallow focus with tiny, close-up things. <strong>Shifting</strong> the lens upwards instead lets the camera stay level, so the walls of tall buildings stay vertical.</p>`, [
    "Set the tilt to <strong>0°</strong>, then slowly to <strong>−3°</strong>: the plane of sharp focus swings down onto the ground.",
    "Go back to <strong>+8°</strong> at f/2.8 and look at the town: a thin diagonal band is sharp and the scene looks like a miniature.",
    "Choose <strong>Shift</strong>, set the lens shift to 0 and tilt the whole camera up: the building leans backwards. Then level the camera and use the shift instead.",
  ]));

  const ctl = controls({
    mode: { type: 'seg', label: 'Movement', value: 'tilt', options: [['tilt', 'Tilt (Scheimpflug)'], ['shift', 'Shift (keystone)']] },
    h1: { type: 'heading', label: 'Tilt' },
    alpha: { type: 'range', label: 'Lens tilt α (+ reverse → miniature, − forward)', min: -8, max: 8, step: 0.1, value: 8, unit: '°' },
    f: { type: 'range', label: 'Focal length', min: 24, max: 135, log: true, value: 65, unit: 'mm' },
    N: { type: 'range', label: 'f-number', min: 2.8, max: 22, log: true, value: 2.8, fmt: (v) => 'f/' + v.toPrecision(2) },
    s: { type: 'range', label: 'Focus distance (on axis)', min: 15, max: 300, log: true, value: 52, unit: 'm' },
    h2: { type: 'heading', label: 'Shift' },
    pitch: { type: 'range', label: 'Camera pitch (tilt the whole camera)', min: 0, max: 35, step: 0.5, value: 0, unit: '°' },
    shift: { type: 'range', label: 'Lens shift (rise)', min: 0, max: 15, step: 0.1, value: 12, unit: 'mm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const photo = stage({ aspect: 1.5, label: 'Simulated photograph', draw: drawPhoto, minH: 280 });
  const side = stage({ aspect: 2.2, label: 'Side view: sensor, lens and the plane of focus (not to scale)', draw: drawSide, minH: 220 });
  const camera3 = view3d({ label: '3-D, true scale: sensor, tilted lens and plane of focus meet in one line', aspect: 1.25, minH: 260, yaw: -1.32, pitch: 0.12 });
  const town3 = view3d({ label: '3-D: the plane of focus and the depth-of-field wedge over the town', aspect: 1.25, minH: 260, yaw: -2.4, pitch: 0.45 });
  root.append(lab([photo.el, side.el, h('div.grid-2', {}, camera3.el, town3.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let IMG = null;
  // tilted-thin-lens imaging in camera coordinates (y up, z forward); lens axis tilted by α about x
  const geom = (st) => tiltedLens(st.f / 1000, st.alpha, st.s, st.N);
  // Rendering runs in the compute workers (js/lib/scenes.js, js/lib/tasks.js). The town's colour,
  // depth and blur stack depend only on the focal length, so they are recomputed (in parallel row
  // bands and blur levels) only when it changes; the blend for tilt, focus and aperture reuses
  // them in pool worker 0. A newer request makes older results stale.
  let ticket = 0, stackF = null;
  async function render(st) {
    const my = ++ticket;
    let rgba;
    if (st.mode === 'tilt') {
      const { W, H } = TILT;
      if (stackF !== st.f) {
        const parts = await parallel('tiltScene', rowBands(H).map(([y0, y1]) => ({ f: st.f, y0, y1 })));
        if (my !== ticket) return;
        const src = new Uint8ClampedArray(W * H * 4), depth = new Float32Array(W * H);
        let off = 0;
        for (const p of parts) {
          for (let k = 0; k < p.depth.length; k++) { const q = (off + k) * 4; src[q] = p.rgb[k * 3]; src[q + 1] = p.rgb[k * 3 + 1]; src[q + 2] = p.rgb[k * 3 + 2]; src[q + 3] = 255; }
          depth.set(p.depth, off); off += p.depth.length;
        }
        // the blur levels, dealt round-robin to the workers
        const n = poolSize(), sets = Array.from({ length: n }, (_, i) => BLUR_LEVELS.map((r, j) => [r, j]).filter((x, j) => j % n === i));
        const out = await parallel('blurLevels', sets.map((set) => ({ rgba: src, W, H, levels: set.map((x) => x[0]) })));
        if (my !== ticket) return;
        const stack = [];
        sets.forEach((set, i) => set.forEach(([, j], m) => { stack[j] = out[i][m]; }));
        await runOn(0, 'tiltStore', { f: st.f, depth, stack }, [depth.buffer, ...stack.map((x) => x.buffer)]);
        stackF = st.f;
        if (my !== ticket) return;
      }
      rgba = await runOn(0, 'tiltBlend', { st: { f: st.f, alpha: st.alpha, s: st.s, N: st.N } });
      if (!rgba) { stackF = null; return; } // the worker lost its cache: the next update rebuilds it
    } else {
      const parts = await parallel('shiftRows', rowBands(SHIFT.H).map(([y0, y1]) => ({ st: { pitch: st.pitch, shift: st.shift }, y0, y1 })));
      rgba = new Uint8ClampedArray(SHIFT.W * SHIFT.H * 4);
      let off = 0;
      for (const p of parts) { rgba.set(p, off); off += p.length; }
    }
    if (my !== ticket) return;
    const { W, H } = st.mode === 'tilt' ? TILT : SHIFT, ic = imageCanvas(W, H);
    ic.data.set(rgba); ic.put();
    IMG = ic.c;
    photo.redraw();
  }

  function update() {
    const st = ctl.state;
    render(st).catch(console.error);
    const G = geom(st), f = G.f, a = G.a;
    const J = Math.abs(a) > 1e-4 ? f / Math.sin(Math.abs(a)) : Infinity;
    // plane of focus inclination: tan ψ = (v / f − 1)… exact via two sensor points
    const pof = pofLine(G);
    ro.replaceChildren(readouts([
      ['Hinge distance J = f / sin α', isFinite(J) ? J.toFixed(2) + ' m' : '∞ (no tilt)'],
      ['Plane-of-focus angle to sensor plane', pof ? (() => { const d = Math.abs((pof.ang * 180) / Math.PI) % 180; return Math.min(d, 180 - d).toFixed(1) + '°'; })() : '—'],
      ['PoF crosses the lens plane at (traced)', pof ? (() => { const t = -pof.p1[2] / (pof.p2[2] - pof.p1[2]); return Math.abs(pof.p1[1] + t * (pof.p2[1] - pof.p1[1])).toFixed(3) + ' m ' + (st.alpha > 0 ? 'above' : 'below'); })() : '—'],
      ['Image distance v', (G.v * 1000).toFixed(2) + ' mm'],
      ['Required image circle (shift)', (2 * Math.hypot(12, 18 + st.shift)).toFixed(1) + ' mm'],
      ['Verticals', st.mode === 'shift' ? (st.pitch > 0.4 ? 'converge (keystone)' : 'parallel ✓') : '—'],
    ]));
    calc.say((st.mode === 'tilt'
      ? (isFinite(J)
        ? (st.alpha < 0
          ? t('The lens is tilted {a}°, so the plane of sharp focus pivots about a line <strong>{J} m</strong> from the lens and lies along the receding scene.', { a: Math.abs(st.alpha).toFixed(1), J: J.toFixed(2) })
          : t('The lens is tilted {a}°, so the plane of sharp focus pivots about a line <strong>{J} m</strong> from the lens and cuts steeply through the scene, leaving a thin band sharp.', { a: Math.abs(st.alpha).toFixed(1), J: J.toFixed(2) }))
        : t('No tilt: the plane of sharp focus is parallel to the sensor, {s} m away.', { s: fmt(st.s, 3) }))
      : (st.pitch > 0.4 ? t('The camera points {p}° upwards, so vertical lines converge (keystone distortion).', { p: st.pitch }) : t('The camera is level and the lens is shifted {s} mm: verticals stay parallel, and the lens must cover an image circle of {c} mm.', { s: st.shift, c: (2 * Math.hypot(12, 18 + st.shift)).toFixed(0) }))));
    calc.set(String.raw`\begin{aligned}
    &\text{Scheimpflug: sensor} \cap \text{lens plane} \cap \text{PoF} = \text{one line}\\
    &\text{Hinge rule: } J = \frac{f}{\sin\alpha} = \frac{${texNum(st.f, 3)}\,\text{mm}}{\sin ${texNum(Math.abs(st.alpha), 2)}^\circ} = ${isFinite(J) ? texNum(J, 3) + '\\,\\text{m}' : '\\infty'}\\
    &\frac{1}{u} + \frac{1}{u'} = \frac{1}{f}\ \text{along the tilted lens axis}
    \end{aligned}`);
    photo.redraw(); side.redraw();
    show3d(st);
  }
  // 3-D views of the tilt geometry (tilt mode only); cameras stay where the reader put them
  let shown3d = false;
  const show3d = debounce((st) => {
    const on = st.mode === 'tilt';
    camera3.el.hidden = town3.el.hidden = !on;
    if (!on || !camera3.ok) return;
    const p = { f: st.f, alpha: st.alpha, s: st.s, N: st.N };
    camera3.setScene(scheimpflugScene(p), shown3d);
    town3.setScene(townScene(p), shown3d);
    shown3d = true;
  }, 120);

  // plane of focus in the y–z (side) plane: image two sensor points back into object space
  const objOf = tiltedObject;
  function pofLine(G) {
    // sample close to the axis: at strong tilts the sensor edges are conjugate to points beyond infinity
    const p1 = objOf(G, [0, 0.0003, -G.v]), p2 = objOf(G, [0, -0.0003, -G.v]);
    if (!p1 || !p2) return null;
    return { p1, p2, ang: Math.atan2(p2[2] - p1[2], p2[1] - p1[1]) };
  }

  function drawPhoto(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!IMG) return;
    const sc = Math.min(w / IMG.width, hh / IMG.height);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(IMG, (w - IMG.width * sc) / 2, (hh - IMG.height * sc) / 2, IMG.width * sc, IMG.height * sc);
  }

  function drawSide(ctx, w, hh) {
    ctx.fillStyle = '#07080d'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state;
    if (st.mode === 'shift') {
      // image circle and the shifted sensor window
      const S = Math.min(w, hh) / 70, cx = w * 0.3, cy = hh / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, 32 * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#6ad7ff'; ctx.strokeRect(cx - 12 * S, cy - 18 * S, 24 * S, 36 * S);
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2; ctx.strokeRect(cx - 12 * S, cy - (18 + st.shift) * S, 24 * S, 36 * S); ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(t('dashed: 64 mm image circle of a shift lens'), cx + 34 * S, cy - 10);
      ctx.fillStyle = '#6ad7ff'; ctx.fillText(t('blue: centred sensor'), cx + 34 * S, cy + 8);
      ctx.fillStyle = '#ffb547'; ctx.fillText(t('amber: sensor window after {shift} mm rise', { shift: st.shift }), cx + 34 * S, cy + 26);
      return;
    }
    const G = geom(st);
    // image side drawn to true scale (k px per metre), object side log-compressed
    const lensX = w * 0.24, cy = hh * 0.5, k = (lensX * 0.8) / G.v;
    const Xi = (z) => lensX + z * k, Yi = (y) => cy - y * k;
    const Xo = (z) => lensX + Math.log1p(Math.max(0, z)) * ((w - lensX - 20) / Math.log1p(400));
    const Yo = (y) => cy - Math.sign(y) * Math.log1p(Math.abs(y)) * (hh * 0.11);
    // DoF wedge and plane of focus: conjugates of the sensor plane and of planes ±N·c from it
    const c = 0.00003, dz = st.N * c;
    const sample = (off) => { const pts = []; for (let q = -60; q <= 60; q++) { const o = objOf(G, [0, (q / 60) * 0.012, -G.v + off]); if (o && o[2] > 0 && o[2] < 400) pts.push(o); } return pts; };
    const near = sample(dz), far = sample(-dz), mid = sample(0);
    if (near.length && far.length) {
      ctx.fillStyle = 'rgba(107,227,164,0.13)'; ctx.beginPath();
      near.forEach((p, i) => (i ? ctx.lineTo(Xo(p[2]), Yo(p[1])) : ctx.moveTo(Xo(p[2]), Yo(p[1]))));
      far.slice().reverse().forEach((p) => ctx.lineTo(Xo(p[2]), Yo(p[1]))); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#6be3a4'; ctx.lineWidth = 2; ctx.beginPath();
    mid.forEach((p, i) => (i ? ctx.lineTo(Xo(p[2]), Yo(p[1])) : ctx.moveTo(Xo(p[2]), Yo(p[1])))); ctx.stroke(); ctx.lineWidth = 1;
    // ground plane in camera coordinates
    ctx.strokeStyle = 'rgba(255,181,71,0.7)'; ctx.beginPath();
    for (let q = 0; q <= 80; q++) { const z = 1 + q * 5; const yy = -camH / Math.cos(camPitch) + z * Math.tan(-camPitch); q ? ctx.lineTo(Xo(z), Yo(yy)) : ctx.moveTo(Xo(z), Yo(yy)); }
    ctx.stroke();
    // camera axis
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(Xi(-G.v * 1.1), cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);
    // sensor (true scale) and tilted lens
    ctx.strokeStyle = '#e9ebf3'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Xi(-G.v), Yi(0.012)); ctx.lineTo(Xi(-G.v), Yi(-0.012)); ctx.stroke();
    const lp = 0.022;
    ctx.strokeStyle = '#6ad7ff'; ctx.beginPath(); ctx.moveTo(Xi(lp * Math.sin(G.a)), Yi(lp * Math.cos(G.a))); ctx.lineTo(Xi(-lp * Math.sin(G.a)), Yi(-lp * Math.cos(G.a))); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t('sensor'), Xi(-G.v), Yi(0.012) - 6); ctx.fillStyle = '#6ad7ff'; ctx.fillText(t('lens (α = {alpha}°)', { alpha: st.alpha }), lensX, Yi(lp) - 6);
    ctx.textAlign = 'left'; ctx.fillStyle = '#6be3a4'; ctx.fillText(t('plane of focus + DoF wedge'), lensX + 60, 18);
    ctx.fillStyle = '#ffb547'; ctx.fillText(t('ground'), w - 60, Math.min(hh - 8, Yo(-camH / Math.cos(camPitch) + 400 * Math.tan(-camPitch)) + 14));
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText(t('image space: true scale · object space: log distance'), 10, hh - 8);
  }

  update();

  root.append(rule(String.raw`\[J = \frac{f}{\sin\alpha}\]
<p>The <strong>hinge rule</strong>: tilting a lens of focal length \(f\) by an angle \(\alpha\) makes the plane of sharp focus pivot about a line at distance \(J\) from the lens. Focusing only swings the plane about that line. To lay the focus along the ground from a camera 1.5 m high with a 24 mm lens, you need \(\sin\alpha = 24/1500\): a tilt of only 0.9°. Small tilts do a lot.</p>`,
    String.raw`It is exact for a thin lens. In a real lens the distances are measured from its principal planes, and a pupil magnification different from 1 moves the hinge line slightly. The sharp zone is a wedge that opens away from the hinge, not a slab, so near objects get less depth than far ones.`));
  root.append(theory('The Scheimpflug principle', String.raw`
<div class="theory-cols"><div>
<h3>Three planes, one line</h3>
<p>A thin lens maps every object plane onto an image plane. A projective (collineation) argument shows that the object plane, the lens plane and the image plane always meet in one common line. This is Scheimpflug's 1904 rule, though Carpentier and Desargues knew it earlier. Tilting the lens by \(\alpha\) relative to the sensor therefore swings the plane of focus about that line. It is computed exactly here, by mapping sensor points back through the tilted thin lens with \(1/u + 1/u' = 1/f\) along the tilted axis.</p>
<h3>The hinge rule</h3>
<p>Merklinger's hinge rule fixes where the plane of focus pivots. It always passes through the line parallel to the sensor, through the front focal plane, at distance</p>
\[J = \frac{f}{\sin\alpha}\]
<p>from the lens. Refocusing rotates the plane of focus about this hinge, and changing the tilt moves the hinge. Landscape photographers tilt forward so the plane of focus lies along the ground from the near flowers to the horizon, even at f/8.</p>
</div><div>
<h3>The DoF wedge</h3>
<p>The near and far depth-of-field limits are the conjugates of planes parallel to the sensor at \(\pm Nc\). They too pass through the hinge line, so depth of field becomes a wedge opening away from the camera, drawn shaded green in the side view. Reverse tilt sets the plane of focus nearly perpendicular to the ground. Only a narrow band of a receding scene stays sharp. Because we associate such shallow depth of field with close-up photographs of small objects, the brain reads the scene as a <em>miniature</em>. The render computes each pixel's true defocus through the tilted lens, then blends a stack of images blurred with exact uniform-disk (pillbox) kernels, the geometric defocus PSF.</p>
<h3>Shift and keystoning</h3>
<p>Pointing a camera upward tilts the sensor relative to a building façade. Its verticals then converge to a vanishing point, the keystone effect. Keeping the camera level keeps the sensor parallel to the façade, so verticals stay parallel. A <strong>shift</strong> lens then slides the sensor window up inside a larger image circle (around 60–80 mm for full-frame shift lenses) to include the top of the building. Raising the shift slider here at zero pitch frames the façade without any convergence. Architectural photography, and every view camera since the 19th century, depends on this.</p>
</div></div>`));
  root.append(references([
    'T. Scheimpflug, GB Patent 1196 (1904).',
    'H. M. Merklinger, <i>Focusing the View Camera</i> (1996): the hinge rule.',
    'L. Larmore, <i>Introduction to Photographic Principles</i>, Dover (1965), ch. 7.',
  ]));
  return () => { [photo, side].forEach((s) => s.destroy()); camera3.destroy(); town3.destroy(); };
}
