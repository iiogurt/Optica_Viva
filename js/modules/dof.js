import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { SENSORS, diag, pitchUm } from '../lib/sensors.js';
import { plot, logRange } from '../lib/plot.js';
import { blurDiameter as blur, hyperfocal, dofLimits } from '../lib/optics.js';
import { blurredCanvas, diskBlurredCanvas } from '../lib/blur.js';
import { runOn, parallel, rowBands } from '../lib/compute.js';
import { view3d } from '../lib/gl3d.js';
import { dofScene, sceneDepth, CARDS, cardAngle } from '../lib/dof3d.js';
import { t } from '../lib/i18n.js';

const LAMBDA = 0.00055; // mm


// Draw `img` convolved with a uniform disk of radius r (px). Up to ~1.2 Mpx (padded) the exact,
// anti-aliased pillbox of js/lib/blur.js is used. Larger images (very near cards at long focal
// lengths) fall back to Vogel-spiral taps accumulated on an additive scratch layer, softened by a
// small Gaussian between taps; blurring commutes with shifting and summing, so the source is
// blurred once up front.
function diskBlit(ctx, img, x, y, r) {
  if (r < 0.6) { ctx.drawImage(img, x, y); return; }
  if ((img.width + 2 * r) * (img.height + 2 * r) <= 1.2e6) {
    const { canvas, pad } = diskBlurredCanvas(img, r);
    ctx.drawImage(canvas, x - pad, y - pad);
    return;
  }
  const n = Math.min(72, Math.max(10, Math.round(r * 2.2)));
  const soft = Math.max(0, (r / Math.sqrt(n)) * 0.9);
  const { canvas: src, pad: sp } = blurredCanvas(img, soft > 0.4 ? soft : 0);
  const pad = Math.ceil(r + 4);
  const tmp = document.createElement('canvas');
  tmp.width = src.width + 2 * pad; tmp.height = src.height + 2 * pad;
  const t = tmp.getContext('2d');
  t.globalCompositeOperation = 'lighter';
  t.globalAlpha = 1 / n;
  for (let i = 0; i < n; i++) {
    const rho = r * Math.sqrt((i + 0.5) / n), ph = i * 2.399963229728653;
    t.drawImage(src, pad + rho * Math.cos(ph), pad + rho * Math.sin(ph));
  }
  ctx.drawImage(tmp, x - pad - sp, y - pad - sp);
}

function cardImage(wpx, hpx, label, subject) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(wpx)); c.height = Math.max(2, Math.round(hpx));
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  // post
  g.fillStyle = '#2a2622'; g.fillRect(W * 0.47, H * 0.55, W * 0.06, H * 0.45);
  // board
  const bh = H * 0.58;
  g.fillStyle = subject ? '#ffcf6e' : '#f1ede4'; g.fillRect(0, 0, W, bh);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = Math.max(1, W * 0.02); g.strokeRect(0, 0, W, bh);
  // bar target (5 bars)
  g.fillStyle = '#111';
  const bw = W * 0.05;
  for (let i = 0; i < 5; i++) g.fillRect(W * 0.1 + i * 2 * bw, bh * 0.15, bw, bh * 0.4);
  // fine radial star
  const cx = W * 0.78, cy = bh * 0.35, rr = Math.min(W * 0.16, bh * 0.25);
  for (let k = 0; k < 16; k++) {
    g.beginPath(); g.moveTo(cx, cy);
    g.arc(cx, cy, rr, (k * Math.PI) / 8, ((k + 0.5) * Math.PI) / 8); g.closePath(); g.fill();
  }
  g.font = `600 ${Math.max(6, Math.min(bh * 0.26, (W * 1.5) / Math.max(3, label.length)))}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#c0392b';
  g.fillText(label, W / 2, bh * 0.9);
  return c;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A lens can bring only one distance into perfect focus. Anything nearer or farther becomes a small blurred spot instead of a point. While those spots stay small, the eye still reads them as sharp, so there is a zone around the focus distance that looks sharp: the <strong>depth of field</strong>.</p>
<p>Three things set its depth. A <strong>smaller aperture</strong> (a larger f-number such as f/11) narrows the cone of light and deepens the zone, which is why squinting helps you see. <strong>Focusing farther away</strong> deepens it quickly. A <strong>longer lens</strong> at the same distance makes it shallower.</p>`, [
    'Set the aperture to <strong>f/1.8</strong> and focus at <strong>2 m</strong>: only a thin slice is sharp. Guess what <strong>f/11</strong> will do, then try it.',
    'Keep f/1.8 and move the focus from 2 m to <strong>10 m</strong>. The sharp zone grows about 25-fold, not 5-fold. The rule of thumb below says why.',
    'Stop down to <strong>f/32</strong> and toggle <strong>Include diffraction</strong>: past a point, a smaller aperture makes everything slightly soft.',
  ]));

  const ctl = controls({
    sensor: { type: 'select', label: 'Sensor format', value: 'ff', options: Object.entries(SENSORS).map(([k, s]) => [k, s.name]) },
    f: { type: 'range', label: 'Focal length', min: 8, max: 400, log: true, value: 85, unit: 'mm' },
    N: { type: 'range', label: 'Aperture f-number', min: 0.95, max: 32, log: true, value: 1.8, fmt: (v) => 'f/' + v.toPrecision(2) },
    s: { type: 'range', label: 'Focus distance', min: 0.3, max: 100, log: true, value: 2.2, unit: 'm' },
    coc: { type: 'select', label: 'Circle-of-confusion criterion', value: '1500', options: [['1500', 'diagonal / 1500 (classic, 0.029 mm FF)'], ['1730', 'diagonal / 1730 (Zeiss)'], ['3000', 'diagonal / 3000 (critical, large prints)'], ['pix', '2 × pixel pitch (pixel-peeping)']] },
    diff: { type: 'toggle', label: 'Include diffraction (λ = 550 nm)', value: true },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  let M = null;

  const photo = stage({ aspect: 1.5, label: 'Simulated photograph', draw: drawPhoto, minH: 260 });
  const dia = stage({ aspect: 4.2, label: '', draw: drawDiagram, minH: 150, cls: 'plain' });
  const bp = stage({ aspect: 2.6, label: '', draw: drawBlurPlot, minH: 220, cls: 'plain' });
  const view = view3d({ label: '3-D, true scale: what the camera sees, the plane of focus and the sharp zone', aspect: 1.9, minH: 260, yaw: -2.35, pitch: 0.38 });
  root.append(lab([photo.el, h('div.card', { style: { padding: '8px' } }, dia.el), view.el, h('div.card', { style: { padding: '8px' } }, bp.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  function model() {
    const st = ctl.state, sen = SENSORS[st.sensor];
    const f = st.f, N = st.N, s = Math.max(st.s * 1000, f * 1.05);
    const d = diag(sen);
    const c = st.coc === 'pix' ? 2 * pitchUm(sen) / 1000 : d / +st.coc;
    const H = hyperfocal(f, N, c);
    const { near: Dn, far: Df } = dofLimits(f, N, c, s);
    const m = f / (s - f);
    const Nw = N * (1 + m);
    const airy = 2.44 * LAMBDA * Nw;
    return { sen, f, N, s, c, H, Dn, Df, m, Nw, airy, diff: st.diff, hfov: 2 * Math.atan(sen.w / (2 * f)) * 180 / Math.PI };
  }

  function update() {
    M = model();
    const { f, N, s, c, H, Dn, Df, m, airy, hfov } = M;
    const tot = Df - Dn;
    ro.replaceChildren(readouts([
      ['Horizontal field of view', hfov.toFixed(1) + '°'],
      ['Circle of confusion c', (c * 1000).toFixed(1) + ' µm'],
      ['Hyperfocal distance H', fmt(H / 1000, 4) + ' m'],
      ['Near limit', fmt(Dn / 1000, 4) + ' m'],
      ['Far limit', isFinite(Df) ? fmt(Df / 1000, 4) + ' m' : '∞'],
      ['Total depth of field', isFinite(tot) ? fmt(tot / 1000, 3) + ' m' : '∞'],
      ['Front : behind split', isFinite(Df) ? `${(((s - Dn) / tot) * 100).toFixed(0)} : ${(((Df - s) / tot) * 100).toFixed(0)}` : '— : ∞'],
      ['Magnification m', fmt(m, 3) + '×'],
      ['Blur of ∞ background', (blur(f, N, s, 1e12) * 1000).toFixed(1) + ' µm'],
      ['Airy disk diameter', (airy * 1000).toFixed(1) + ' µm'],
      ['Diffraction vs CoC', airy > c ? t('diffraction-limited ⚠') : t('{p} % of c', { p: (airy / c * 100).toFixed(0) })],
    ]));
    const m1 = (x) => fmt(x / 1000, 3) + ' m';
    calc.say((isFinite(Df)
      ? t('Sharp from <strong>{near}</strong> to <strong>{far}</strong>, {depth} deep: {front} % of it in front of the focus, {behind} % behind.', { near: m1(Dn), far: m1(Df), depth: tot < 1000 ? fmt(tot / 10, 2) + ' cm' : fmt(tot / 1000, 2) + ' m', front: (((s - Dn) / tot) * 100).toFixed(0), behind: (((Df - s) / tot) * 100).toFixed(0) })
      : t('Sharp from <strong>{near}</strong> to <strong>infinity</strong>: the focus is at or beyond the hyperfocal distance ({H}).', { near: m1(Dn), H: m1(H) }))
      + (M.diff && airy > c ? ' ' + t('At this f-number diffraction alone blurs more than the sharpness limit, so nothing is perfectly crisp.') : ''));
    calc.set(String.raw`\begin{aligned}
H &= \frac{f^2}{Nc} + f = \frac{${texNum(f, 4)}^2}{${texNum(N, 3)}\times${texNum(c, 3)}} + ${texNum(f, 4)}\\ &= ${texNum(H / 1000, 4)}\ \text{m}\\[2pt]
D_N &= \frac{s f^2}{f^2 + Nc(s-f)} = ${texNum(Dn / 1000, 4)}\ \text{m}\\[2pt]
D_F &= \frac{s f^2}{f^2 - Nc(s-f)} = ${isFinite(Df) ? texNum(Df / 1000, 4) + '\\ \\text{m}' : '\\infty\\ (s \\ge H)'}\\[2pt]
c(d) &= \frac{f}{N}\cdot\frac{f\,|d-s|}{d\,(s-f)}
\end{aligned}`);
    renderPhoto(M).catch(console.error); dia.redraw(); bp.redraw();
    show3d(M);
  }
  // 3-D: the camera stays where the reader put it, unless the scene's depth changes more than 2×
  let depth3d = 0;
  function show3d(m) {
    const D = sceneDepth(m.s / 1000, m.Df / 1000), keep = depth3d > 0 && D / depth3d < 2 && depth3d / D < 2;
    view.setScene(dofScene(m), keep);
    if (!keep) depth3d = D;
  }

  // The photograph renders off the main thread: the ground in parallel row bands, and each layer's
  // disk blur as its own job on the worker pool; the layers are then composited far to near. It is
  // rendered at a fixed internal width and scaled to the stage. A newer request makes older
  // results stale.
  let IMG = null, ticket = 0;
  const RW = 720;
  // disk-blur a canvas on pool worker i into a padded canvas (as diskBlurredCanvas in js/lib/blur.js)
  async function diskBlurAsync(src, r, i) {
    const pad = Math.ceil(r) + 2, c = document.createElement('canvas');
    c.width = src.width + 2 * pad; c.height = src.height + 2 * pad;
    const g = c.getContext('2d');
    g.drawImage(src, pad, pad);
    const im = g.getImageData(0, 0, c.width, c.height);
    const out = await runOn(i, 'diskBlur', { data: im.data, w: c.width, h: c.height, r }, [im.data.buffer]);
    g.putImageData(new ImageData(out, c.width, c.height), 0, 0);
    return { canvas: c, pad };
  }
  // A function that draws `img` blurred by a disk of radius r at (x, y). Sharp layers are drawn
  // directly, and very large ones use diskBlit's Vogel-spiral fallback on the main thread.
  function layer(img, x, y, r, i) {
    if (r < 0.6 || (img.width + 2 * r) * (img.height + 2 * r) > 1.2e6) return Promise.resolve((g) => diskBlit(g, img, x, y, r));
    return diskBlurAsync(img, r, i).then(({ canvas, pad }) => (g) => g.drawImage(canvas, x - pad, y - pad));
  }
  async function renderPhoto(m) {
    const my = ++ticket;
    const { sen, f, N, s } = m;
    const IW = RW, IH = Math.round(RW / (sen.w / sen.h));
    const pxmm = IW / sen.w; // pixels per sensor-mm
    const hc = 450; // camera height (mm): a low, tabletop viewpoint
    const hz = IH * 0.32; // horizon row: the sensor is shifted down (shift-lens framing, verticals stay vertical)
    const ground = parallel('dofGround', rowBands(IH).map(([y0, y1]) => ({ p: { IW, IH, hz, pmm: 1 / pxmm, f, N, s, diff: m.diff, Nw: m.Nw }, y0, y1 })));
    // distant hills (Z = 800 m)
    const hills = document.createElement('canvas'); hills.width = IW; hills.height = Math.ceil(hz) + 4;
    const hg = hills.getContext('2d');
    const Zh = 800000;
    hg.fillStyle = '#3b3550';
    hg.beginPath(); hg.moveTo(0, hills.height);
    for (let x = 0; x <= IW; x += 2) {
      const X = ((x - IW / 2) * Zh) / (f * pxmm);
      const Y = 30000 + 18000 * Math.sin(X / 90000) + 9000 * Math.sin(X / 23000 + 1.3) + 4000 * Math.sin(X / 7000);
      hg.lineTo(x, hz - ((f * (Y - hc)) / Zh) * pxmm);
    }
    hg.lineTo(IW, hills.height); hg.closePath(); hg.fill();
    const hillLayer = layer(hills, 0, 0, (blur(f, N, s, Zh) * pxmm) / 2, 0);
    // cards, far to near (painter's algorithm); include a subject card at the focus distance
    const items = CARDS.map((d, i) => ({ Z: d * 1000, X: d * 1000 * Math.tan(cardAngle(i)), label: d + ' m' }));
    items.push({ Z: s, X: s * Math.tan(2 * Math.PI / 180), label: '◎', subject: true });
    items.sort((a, b) => b.Z - a.Z);
    const cardLayers = [];
    for (const it of items) {
      if (it.Z <= f * 1.2) continue;
      const cw = 120, chh = 300; // card 0.12 m wide, 0.30 m tall incl. post
      const wpx = ((f * cw) / it.Z) * pxmm, hpx = ((f * chh) / it.Z) * pxmm;
      if (wpx < 1.5 || wpx > IW * 3) continue;
      const x = IW / 2 + ((f * (it.X - cw / 2)) / it.Z) * pxmm;
      const yb = hz + ((f * hc) / it.Z) * pxmm; // ground contact
      cardLayers.push(layer(cardImage(wpx, hpx, it.label, it.subject), x, yb - hpx, (blur(f, N, s, it.Z) * pxmm) / 2, cardLayers.length + 1));
    }
    const [parts, drawHills, ...drawCards] = await Promise.all([ground, hillLayer, ...cardLayers]);
    if (my !== ticket) return;
    const cv = document.createElement('canvas'); cv.width = IW; cv.height = IH;
    const g = cv.getContext('2d');
    const img = g.createImageData(IW, IH);
    let off = 0;
    for (const p of parts) { img.data.set(p, off); off += p.length; }
    g.putImageData(img, 0, 0);
    drawHills(g);
    // lamps (Z = 60–200 m)
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const Z = 60000 + ((i * 7919) % 140000);
      const X = (((i * 104729) % 1000) / 1000 - 0.5) * 2 * Z * 0.7;
      const Y = 2000 + ((i * 31) % 9) * 700;
      const x = IW / 2 + ((f * X) / Z) * pxmm, y = hz - ((f * (Y - hc)) / Z) * pxmm;
      const r = Math.max(0.8, (blur(f, N, s, Z) * pxmm) / 2);
      const a = Math.min(0.95, 5 / (r * r) + 0.04);
      const hue = i % 3 === 0 ? '255,190,120' : i % 3 === 1 ? '255,230,180' : '170,210,255';
      g.fillStyle = `rgba(${hue},${a})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    for (const d of drawCards) d(g);
    IMG = { cv, f, N, sen };
    photo.redraw();
  }

  function drawPhoto(ctx, w, hh) {
    if (!IMG) return;
    const { cv, sen, f, N } = IMG;
    // keep sensor aspect inside the stage
    const ar = sen.w / sen.h;
    let W = w, H = Math.round(w / ar);
    if (H > hh) { H = hh; W = Math.round(hh * ar); }
    const ox = Math.round((w - W) / 2), oy = Math.round((hh - H) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cv, ox, oy, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.strokeRect(ox + 0.5, oy + 0.5, W - 1, H - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(ox + W - 210, oy + H - 26, 204, 20);
    ctx.fillStyle = '#fff'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${f.toFixed(0)} mm  f/${N.toPrecision(2)}  ${sen.w}×${sen.h} mm`, ox + W - 12, oy + H - 12);
  }

  function drawDiagram(ctx, w, hh) {
    if (!M) return;
    const { Dn, Df, s, H } = M;
    const x0 = 40, x1 = w - 30, lo = 0.1, hi = 1000;
    const X = (mm) => { const m = mm / 1000; return m >= hi ? x1 : x0 + (Math.log(Math.max(lo, m) / lo) / Math.log(hi / lo)) * (x1 - x0); };
    const y = hh * 0.55;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'center';
    for (const t of [0.1, 0.3, 1, 3, 10, 30, 100, 300]) { ctx.fillRect(X(t * 1000), y - 3, 1, 6); ctx.fillText(t + ' m', X(t * 1000), y + 18); }
    ctx.fillText('∞', x1, y + 18);
    // DoF zone
    const xa = X(Dn), xb = isFinite(Df) ? X(Df) : x1;
    const grd = ctx.createLinearGradient(xa, 0, xb, 0);
    grd.addColorStop(0, 'rgba(107,227,164,0.15)'); grd.addColorStop(0.5, 'rgba(107,227,164,0.35)'); grd.addColorStop(1, 'rgba(107,227,164,0.15)');
    ctx.fillStyle = grd; ctx.fillRect(xa, y - 26, xb - xa, 52);
    ctx.strokeStyle = '#6be3a4'; ctx.strokeRect(xa + 0.5, y - 26, xb - xa, 52);
    // focus & hyperfocal
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(s), y - 34); ctx.lineTo(X(s), y + 30); ctx.stroke();
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c18cff';
    ctx.beginPath(); ctx.moveTo(X(H), y - 34); ctx.lineTo(X(H), y + 30); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb547'; ctx.textAlign = 'center'; ctx.fillText(t('focus'), X(s), y - 40);
    ctx.fillStyle = '#c18cff'; ctx.fillText('H', X(H), y + 42);
    // card positions
    for (const d of CARDS) {
      const c = blur(M.f, M.N, s, d * 1000);
      ctx.fillStyle = c <= M.c ? '#6be3a4' : '#ff6b6b';
      ctx.beginPath(); ctx.arc(X(d * 1000), y, 3.5, 0, 7); ctx.fill();
    }
    // camera icon
    ctx.fillStyle = '#e9ebf3'; ctx.fillRect(6, y - 8, 20, 16); ctx.fillRect(26, y - 5, 6, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'left'; ctx.font = '600 10.5px Inter, sans-serif';
    ctx.fillText(t('DEPTH OF FIELD (log distance) · ● card within c   ● card outside c'), x0, 16);
  }

  function drawBlurPlot(ctx, w, hh) {
    if (!M) return;
    const { f, N, s, c, airy } = M;
    const ds = logRange(Math.max(0.1, (f * 1.2) / 1000), 1000, 300);
    const def = ds.map((d) => [d, blur(f, N, s, d * 1000) * 1000]);
    const tot = def.map(([d, v]) => [d, Math.sqrt(v * v + (M.diff ? (airy * 1000) ** 2 : 0))]);
    plot(ctx, w, hh, {
      title: 'Blur-spot diameter on the sensor vs object distance',
      x: { min: 0.1, max: 1000, log: true, label: 'object distance (m)' },
      y: { min: 1, max: 3000, log: true, label: 'diameter (µm)' },
      series: [
        { data: def, color: '#6ad7ff', width: 2, label: 'geometric defocus c(d)' },
        ...(M.diff ? [{ data: tot, color: '#ffb547', width: 1.5, dash: [5, 3], label: '√(c² + d_Airy²)' }] : []),
      ],
      hlines: [{ y: c * 1000, color: '#6be3a4', label: 'circle of confusion' }, ...(M.diff ? [{ y: airy * 1000, color: '#c18cff', label: 'Airy diameter 2.44λN_w' }] : [])],
      vlines: [{ x: s / 1000, color: '#ffb547', label: 'focus' }],
      legend: true, legendX: w - 230,
    });
  }

  update();

  root.append(rule(String.raw`\[\mathrm{DoF} \approx \frac{2\,N c\, s^2}{f^2}\]
<p>Depth of field grows with the f-number \(N\) and with the <em>square</em> of the focus distance \(s\), and shrinks with the square of the focal length \(f\). \(c\) is the largest blur spot that still looks sharp, about 0.03 mm on a full-frame sensor. Example: an 85 mm lens at f/1.8 focused at 2 m gives \(2 \times 1.8 \times 0.03 \times 2000^2 / 85^2 \approx 60\) mm, so only 6 cm is sharp. Focus at 4 m and it is four times deeper.</p>
<p>A second rule: focus at the <strong>hyperfocal distance</strong> \(H \approx f^2/(Nc)\) and everything from \(H/2\) to infinity looks sharp. For a 24 mm lens at f/8 that is 2.4 m, so everything beyond 1.2 m is sharp.</p>`,
    String.raw`It assumes the subject is much farther away than the focal length and much closer than the hyperfocal distance. Near \(H\) the far limit runs off to infinity, and in close-up work the magnification term takes over. The full model below handles both, and the live calculation uses it.`));
  root.append(theory('Derivation', String.raw`
<div class="theory-cols"><div>
<h3>Blur disk from the thin-lens equation</h3>
<p>A thin lens of focal length \(f\) images an object at distance \(d\) to \(v_d = fd/(d-f)\). With the sensor at \(v_s = fs/(s-f)\) (focused at \(s\)), the cone from an aperture of diameter \(A = f/N\) is cut at the wrong plane. By similar triangles its cross-section has diameter</p>
\[c(d) = A\,\frac{|v_d - v_s|}{v_d} = \frac{f}{N}\cdot\frac{f\,|d-s|}{d\,(s-f)}.\]
<p>This is exact in the thin-lens, entrance-pupil = principal-plane model. Two limits are worth remembering:</p>
\[c(\infty) = \frac{f^2}{N(s-f)},\qquad \frac{dc}{dd}\Big|_{d\to s} = \frac{f^2}{N s(s-f)}.\]
<h3>Depth-of-field limits</h3>
<p>Setting \(c(d) = c\) and solving for \(d\) on each side of focus:</p>
\[D_{N,F} = \frac{s f^2}{f^2 \pm Nc\,(s-f)},\qquad H = \frac{f^2}{Nc} + f.\]
<p>Focusing at the <strong>hyperfocal distance</strong> \(H\) puts the far limit at infinity and the near limit at \(\approx H/2\). For \(s \ll H\) the depth of field is roughly symmetric and \(\mathrm{DoF}\approx 2Ncs^2/f^2\). It is quadratic in distance, linear in \(N\), and inverse-square in focal length.</p>
<h3>The circle of confusion is a viewing standard</h3>
<p>\(c\) is not a property of the lens. It is the largest blur that a viewer cannot tell from a point, given a print size and viewing distance. The classic \(d/1500\) assumes an 8×10″ print viewed at about 25 cm by a 20/20 eye resolving about 1′ of arc, scaled by the enlargement factor. Pixel-level inspection of a 45 MP image asks for roughly \(d/4000\).</p>
</div><div>
<h3>Why the photograph looks right</h3>
<p>The render is a forward model of the camera. Every pixel of the ground is back-projected to the ground plane, at depth \(Z = f h_c / y'\), where \(y'\) is measured from the horizon. The horizon sits in the upper third because the sensor is shifted, as with a shift lens. The ground texture is a product of cosines of period \(P\), whose local image frequency is</p>
\[\nu_x = \frac{f}{ZP},\qquad \nu_y = \frac{f h_c}{Z^2 P}.\]
<p>The pattern's contrast is multiplied by the exact optical transfer function of a uniform defocus disk of diameter \(c(Z)\), and by the diffraction MTF when that is enabled:</p>
\[\mathrm{MTF}_\text{defocus}(\nu) = \frac{2J_1(\pi c\nu)}{\pi c\nu}.\]
<p>This function goes <em>negative</em>, which is spurious resolution: contrast reversal in strongly defocused stripes. You can see it on the ground as rows of "phantom" tiles in counter-phase. The upright cards and the distant scenery are convolved with an exact, anti-aliased uniform-disk (pillbox) kernel, so their blur is a true bokeh disk rather than a Gaussian.</p>
<h3>Diffraction sets a floor</h3>
<p>The Airy pattern has first-zero diameter \(2.44\lambda N_w\), with working f-number \(N_w = N(1+m)\). At f/16 that is 21 µm, close to the full-frame CoC. Stopping down therefore stops increasing perceived sharpness. Adding the two blurs in quadrature, as the dashed curve does, is a common heuristic. The rigorous approach is to multiply MTFs (see <a href="#/mtf">MTF</a>).</p>
<div class="callout">Equivalence: keep the framing and change format, scaling \(f\) by the crop factor \(k\). Then \(c\) scales by \(1/k\), and the depth of field is the same only if \(N\) also scales by \(k\). That is why a phone at f/1.8 renders like a full-frame camera at about f/12 (see <a href="#/sensor">Sensor size</a>).</div>
</div></div>`));
  root.append(references([
    'S. F. Ray, <i>Applied Photographic Optics</i>, 3rd ed., Focal Press (2002), ch. 21–22: depth of field and depth of focus.',
    'H. H. Hopkins, "The frequency response of a defocused optical system", Proc. R. Soc. A 231, 91 (1955).',
    'H. M. Merklinger, <i>The INs and OUTs of FOCUS</i> (1992): an object-field view of depth of field.',
    'Zeiss, "Depth of Field and Bokeh", Camera Lens News 35 (2010): the d/1730 criterion.',
  ]));
  return () => [photo, dia, view, bp].forEach((s) => s.destroy());
}
