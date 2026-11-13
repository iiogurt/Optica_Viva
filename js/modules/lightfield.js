// A light-field (plenoptic) camera: one exposure through a microlens array, and photographs made from
// it afterwards, refocused, stopped down or seen from another point in the lens.
import { h, controls, stage, readouts, fmt, texNum, rafThrottle, setControl } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, catmull, encode } from '../lib/pixels.js';
import { parallel, rowBands } from '../lib/compute.js';
import { camera, SCENE, PIX, imageDist, inside, linearise, apertureViews, refocus, disparity, blurConventional, blurRefocused, blurBest, refocusRange } from '../lib/lightfield.js';
import { t, N_ } from '../lib/i18n.js';

const ZMIN = 300, ZMAX = 10000;
// the point shown in the raw-sensor inset and the epipolar image until one is clicked: in the flower
const DEFAULT_PICK = (g) => [Math.floor(g.M * 0.86), Math.floor(g.Mh * 0.2)];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo'] }));
  root.append(idea(String.raw`<p>An ordinary camera adds up all the light arriving at each pixel, whichever part of the lens it came through, so the focus is fixed the moment you press the shutter. A light-field camera puts thousands of tiny lenses just in front of the sensor. Under each tiny lens a small patch of pixels records separately the light that came through each part of the main lens.</p>
<p>From that one exposure a computer can afterwards make the photograph focused near or far, with a large or a small aperture, or seen from slightly to the left or right. The price is resolution: every tiny lens becomes just one pixel of the final picture.</p>`, [
    'Click the <strong>flower</strong>, then the <strong>brick wall</strong>: the photograph refocuses after it was taken. Which objects can never be made fully sharp?',
    'Shrink the <strong>Synthetic aperture</strong> to its minimum: predict what happens to the depth of field, then move the <strong>Viewpoint</strong>.',
    'Raise the <strong>Pixels under each microlens</strong> from 5 to 15: what do you gain and what do you lose?',
  ]));

  const ctl = controls({
    N: { type: 'select', label: 'Pixels under each microlens (N × N)', value: '9', options: [['5', '5 × 5'], ['7', '7 × 7'], ['9', '9 × 9'], ['11', '11 × 11'], ['15', '15 × 15']] },
    fnum: { type: 'range', label: 'Main lens f-number', min: 1.4, max: 8, log: true, value: 2 },
    zf: { type: 'range', label: 'Main lens focused at (when the shot was taken)', min: 500, max: 5000, log: true, value: 1400, unit: 'mm' },
    zr: { type: 'range', label: 'Refocus to', min: ZMIN, max: ZMAX, log: true, value: 800, unit: 'mm' },
    ap: { type: 'range', label: 'Synthetic aperture (fraction of the lens)', min: 0.05, max: 1, step: 0.01, value: 1 },
    u0: { type: 'range', label: 'Viewpoint left–right in the lens', min: -1, max: 1, step: 0.01, value: 0 },
    v0: { type: 'range', label: 'Viewpoint up–down in the lens', min: -1, max: 1, step: 0.01, value: 0 },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const photo = stage({ aspect: 1.5, label: 'The photograph, made after the shot (click to refocus there); inset: the raw sensor', draw: drawPhoto, minH: 300 });
  const epi = stage({ aspect: 1.25, label: 'Epipolar-plane image: one row, every view', draw: drawEpi, minH: 240 });
  const chart = stage({ aspect: 1.25, label: '', name: N_('Blur against distance'), draw: drawChart, cls: 'plain', minH: 240 });
  root.append(lab([photo.el, h('div.grid-2', {}, epi.el, h('div.card', { style: { padding: '6px' } }, chart.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const geom = () => { const s = ctl.state; return camera({ F: 50, fnum: s.fnum, zf: s.zf, N: +s.N }); };
  let LF = null, gen = 0, IMG = null, imgGen = 0, pick = null; // pick: [i, j] microlens of the last click

  // ── the exposure: rendered in bands on the worker pool ──
  async function expose() {
    const g = geom(), key = JSON.stringify([g.N, g.fnum, g.zf]), my = ++gen;
    if (LF && LF.key === key) return;
    const bands = rowBands(g.Mh), parts = await parallel('lfRender', bands.map(([j0, j1]) => ({ g, j0, j1 })));
    if (my !== gen) return;
    const plane = g.M * g.Mh, lf = new Uint8Array(g.N * g.N * plane * 3), depth = new Float32Array(plane);
    parts.forEach((r, bi) => {
      const [j0, j1] = bands[bi], rows = (j1 - j0) * g.M;
      for (let v = 0; v < g.N * g.N; v++) lf.set(r.lf.subarray(v * rows * 3, (v + 1) * rows * 3), (v * plane + j0 * g.M) * 3);
      depth.set(r.depth, j0 * g.M);
    });
    LF = { key, g, lf, lin: linearise(lf), depth };
    develop(true); epi.redraw(); words();
  }

  // ── developing a photograph: a quick one from every other view while controls move, then all ──
  let idle = 0;
  const develop = rafThrottle((full) => {
    if (!LF) return;
    const s = ctl.state, g = LF.g, all = apertureViews(g, s.ap, (s.u0 * g.D) / 2, (s.v0 * g.D) / 2);
    const use = full || all.length < 20 ? all : all.filter((w) => (w.k + w.l) % 2 === 0);
    const img = refocus(g, LF.lin, s.zr, use), n = g.M * g.Mh, ch = [0, 1, 2].map(() => new Float32Array(n));
    for (let i = 0; i < n; i++) { ch[0][i] = img[3 * i]; ch[1][i] = img[3 * i + 1]; ch[2][i] = img[3 * i + 2]; }
    IMG = { g, ch, views: all.length, id: ++imgGen };
    photo.redraw(); words();
    clearTimeout(idle);
    if (!full) idle = setTimeout(() => develop(true), 160);
  });

  let lastKey = null;
  function update() {
    const g = geom(), key = JSON.stringify([g.N, g.fnum, g.zf]);
    if (key !== lastKey) { lastKey = key; pick = null; expose().catch(console.error); }
    else develop(false);
    words(); epi.redraw(); chart.redraw();
  }

  // click to refocus: the depth of the scene there, from the centre view
  photo.canvas.style.cursor = 'crosshair';
  photo.canvas.addEventListener('click', (e) => {
    if (!LF || !rect) return;
    const r = photo.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    // the lens forms the picture upside down on the sensor; it is shown turned upright
    const i = LF.g.M - 1 - Math.floor(((x - rect.x) / rect.w) * LF.g.M), j = LF.g.Mh - 1 - Math.floor(((y - rect.y) / rect.h) * LF.g.Mh);
    if (i < 0 || j < 0 || i >= LF.g.M || j >= LF.g.Mh) return;
    pick = [i, j];
    const z = LF.depth[j * LF.g.M + i];
    if (Number.isFinite(z)) setControl('zr', Math.min(ZMAX, Math.max(ZMIN, z)), { animate: true });
    epi.redraw(); photo.redraw();
  });

  // the near and far distances at which a blur curve reaches the threshold, around d0
  function range(f, thr, d0) {
    const zs = Array.from({ length: 400 }, (_, i) => ZMIN * 0.5 * Math.pow((ZMAX * 3) / (ZMIN * 0.5), i / 399));
    let near = zs[0], far = Infinity;
    for (const z of zs) if (z < d0 && f(z) > thr) near = z;
    for (const z of [...zs].reverse()) if (z > d0 && f(z) > thr) far = z;
    return [near, far];
  }
  const dist = (z) => (Number.isFinite(z) && z < ZMAX * 3 ? `${fmt(z / 1000, 3)} m` : '∞');

  function words() {
    const s = ctl.state, g = geom(), thr = Math.SQRT2 * g.p, lf = range((z) => blurBest(g, z), thr, g.zf), cv = range((z) => Math.hypot(blurConventional(g, z), g.p), thr, g.zf);
    const views = IMG ? IMG.views : apertureViews(g, s.ap).length, zClick = pick && LF ? LF.depth[pick[1] * LF.g.M + pick[0]] : NaN;
    ro.replaceChildren(readouts([
      ['Sensor', `${Math.round((g.M * g.N))} × ${Math.round(g.Mh * g.N)} px of ${fmt(PIX * 1000, 3)} µm`],
      ['Microlenses = picture pixels', `${g.M} × ${g.Mh}, pitch ${fmt(g.p * 1000, 3)} µm`],
      ['Views across the lens', `${g.N} × ${g.N} (${apertureViews(g, 1).length} inside the round aperture)`],
      ['Each view sees the lens at', `f/${fmt(g.N * g.fnum, 3)}`],
      ['Views in this photograph', `${views}`],
      ['Refocusable range (blur ≤ √2 microlenses)', `${dist(lf[0])} – ${dist(lf[1])}`],
      ['Ordinary photo, same lens and picture size', `${dist(cv[0])} – ${dist(cv[1])}`],
      ['Shift between neighbouring views at the refocus distance', `${fmt(disparity(g, s.zr), 3)} microlenses`],
      ['Depth where you clicked', Number.isFinite(zClick) ? dist(zClick) : '—'],
    ]));
    calc.say(t('Each microlens spreads the light from {n} × {n} parts of the lens over {n} × {n} pixels, so the picture has {m} × {mh} pixels, {n2} times fewer than the sensor. Each part sees the lens at f/{fn}, so the shot can be refocused sharply from <strong>{a}</strong> to <strong>{b}</strong>; an ordinary photograph at the same picture size is sharp only from {c} to {d}.', {
      n: g.N, m: g.M, mh: g.Mh, n2: g.N * g.N, fn: fmt(g.N * g.fnum, 3), a: dist(lf[0]), b: dist(lf[1]), c: dist(cv[0]), d: dist(cv[1]),
    }));
    const br = imageDist(g.F, s.zr);
    calc.set(String.raw`\begin{aligned}
    E(x,y) &= \frac{1}{|A|}\sum_{(u,v)\in A} L\Big(u, v,\ x + u\Big(1-\frac{b}{b_r}\Big),\ y + v\Big(1-\frac{b}{b_r}\Big)\Big),\quad b = ${texNum(g.b, 4)}\ \text{mm},\ b_r = \Big(\frac1F-\frac1{z_r}\Big)^{-1} = ${texNum(br, 4)}\ \text{mm}\\
    \Delta x_\text{view} &= \frac{D}{N}\Big(1-\frac{b}{b_r}\Big)\Big/p = \frac{${texNum(g.D, 3)}}{${g.N}}\times ${texNum(1 - g.b / br, 3)} \Big/ ${texNum(g.p, 3)} = ${texNum(disparity(g, s.zr), 3)}\ \text{microlenses per view}\\
    |b-b_z| &\lesssim N\,N_f\,p = ${g.N}\times ${texNum(g.fnum, 3)}\times ${texNum(g.p * 1000, 3)}\ \mu\text{m} = ${texNum(refocusRange(g), 3)}\ \text{mm}\quad(\text{an ordinary camera: } N_f\,p = ${texNum(g.fnum * g.p, 3)}\ \text{mm})
    \end{aligned}`);
  }

  // ── drawing ──
  let rect = null;
  function drawPhoto(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!IMG) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('Taking the exposure…'), w / 2, hh / 2); return; }
    const g = IMG.g, top = 34, availH = hh - top - 8, sc = Math.min((w - 16) / g.M, availH / g.Mh);
    rect = { x: (w - g.M * sc) / 2, y: top, w: g.M * sc, h: g.Mh * sc };
    paint(photo, rect, (u, v, o) => {
      const x = (1 - u) * g.M - 0.5, y = (1 - v) * g.Mh - 0.5; // turned upright
      o[0] = encode(catmull(IMG.ch[0], g.M, g.Mh, x, y)); o[1] = encode(catmull(IMG.ch[1], g.M, g.Mh, x, y)); o[2] = encode(catmull(IMG.ch[2], g.M, g.Mh, x, y));
    }, `img${IMG.id}`, 0);
    // the raw sensor around the chosen point: each microlens shows the lens's aperture, upside down
    // (shown turned upright like the photograph: each microlens's image of the aperture then appears the right way round)
    const [pi, pj] = pick || DEFAULT_PICK(g), nx = 9, ny = 6, I0 = Math.max(0, Math.min(g.M - nx, g.M - 1 - pi - (nx >> 1))), J0 = Math.max(0, Math.min(g.Mh - ny, g.Mh - 1 - pj - (ny >> 1)));
    const W = nx * g.N, H = ny * g.N, raw = new ImageData(W, H), plane = g.M * g.Mh;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let l = 0; l < g.N; l++) for (let k = 0; k < g.N; k++) {
      const px = i * g.N + k, py = j * g.N + l, o = (py * W + px) * 4, a = (((l * g.N + k) * plane) + (g.Mh - 1 - (J0 + j)) * g.M + g.M - 1 - (I0 + i)) * 3;
      raw.data[o] = LF.lf[a]; raw.data[o + 1] = LF.lf[a + 1]; raw.data[o + 2] = LF.lf[a + 2]; raw.data[o + 3] = 255;
    }
    const off = document.createElement('canvas'); off.width = W; off.height = H; off.getContext('2d').putImageData(raw, 0, 0);
    const iw = Math.min(rect.w * 0.34, 260), ih = (iw * H) / W, ix = rect.x + 8, iy = rect.y + 26;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, ix, iy, iw, ih); ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1; ctx.strokeRect(ix - 0.5, iy - 0.5, iw + 1, ih + 1);
    const bx = rect.x + (I0 / g.M) * rect.w, by = rect.y + (J0 / g.Mh) * rect.h;
    ctx.strokeRect(bx, by, (nx / g.M) * rect.w, (ny / g.Mh) * rect.h);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ix + iw * 0.5, iy + ih); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(ix, iy - 18, iw, 16);
    ctx.fillStyle = '#ffd27a'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t('Raw sensor: {nx} × {ny} microlenses, {n} × {n} pixels each', { nx, ny, n: g.N }), ix + 4, iy - 10);
    if (pick) { const cx = rect.x + ((g.M - 1 - pick[0] + 0.5) / g.M) * rect.w, cy = rect.y + ((g.Mh - 1 - pick[1] + 0.5) / g.Mh) * rect.h; ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(rect.x + rect.w - 230, rect.y + 6, 224, 18);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
    ctx.fillText(t('focused at {z} · {v} views', { z: dist(ctl.state.zr), v: IMG.views }), rect.x + rect.w - 12, rect.y + 15);
  }

  function drawEpi(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!LF) return;
    const g = LF.g, j = (pick || DEFAULT_PICK(g))[1], l = (g.N - 1) / 2, top = 40, H = hh - top - 34, rowH = H / g.N, plane = g.M * g.Mh;
    const img = new ImageData(g.M, g.N);
    for (let k = 0; k < g.N; k++) for (let i = 0; i < g.M; i++) {
      const a = (((l * g.N + k) * plane) + j * g.M + (g.M - 1 - i)) * 3, o = (k * g.M + i) * 4; // turned upright
      img.data[o] = LF.lf[a]; img.data[o + 1] = LF.lf[a + 1]; img.data[o + 2] = LF.lf[a + 2]; img.data[o + 3] = inside(g, k, l) ? 255 : 0;
    }
    const off = document.createElement('canvas'); off.width = g.M; off.height = g.N; off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 8, top, w - 16, H); ctx.imageSmoothingEnabled = true;
    // lines of the refocus slope: a point at the refocus distance lies on these
    const d = -disparity(g, ctl.state.zr), sx = (w - 16) / g.M; // the turned picture shifts the other way
    ctx.strokeStyle = 'rgba(255,214,120,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    for (let x0 = 0.1; x0 < 1; x0 += 0.2) {
      const xc = 8 + x0 * (w - 16), dx = d * sx * (g.N - 1) / 2;
      ctx.beginPath(); ctx.moveTo(xc - dx, top + rowH / 2); ctx.lineTo(xc + dx, top + H - rowH / 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('Rows: views across the lens · gold: slope at the refocus distance'), 8, top + H + 8);
  }

  function drawChart(ctx, w, hh) {
    const s = ctl.state, g = geom(), zs = Array.from({ length: 160 }, (_, i) => ZMIN * Math.pow(ZMAX / ZMIN, i / 159)), um = (v) => v * 1000;
    plot(ctx, w, hh, {
      title: N_('Blur against distance (on the sensor)'), x: { min: ZMIN, max: ZMAX, log: true, label: N_('object distance (mm)') }, y: { min: 10, max: 5000, log: true, label: N_('blur diameter (µm)') },
      series: [
        { data: zs.map((z) => [z, um(blurConventional(g, z))]), color: '#9aa3b2', width: 1.6, dash: [5, 4], label: N_('ordinary photo, same lens') },
        { data: zs.map((z) => [z, um(blurBest(g, z))]), color: '#6be3a4', width: 1.6, dash: [2, 3], label: N_('light field, refocused to each distance') },
        { data: zs.map((z) => [z, um(blurRefocused(g, z, s.zr, s.ap))]), color: '#ffffff', width: 2.2, label: N_('this photograph') },
      ],
      hlines: [{ y: um(g.p), label: N_('one microlens'), color: 'rgba(255,214,120,0.7)' }],
      vlines: [...SCENE.map((c, i) => ({ x: c.z, label: c.name, color: 'rgba(106,215,255,0.45)', dy: 13 * (i % 2) })), { x: s.zr, label: N_('refocus'), color: '#ffd27a', dy: 28 }], legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[\Delta x = u\Big(1-\frac{b}{b_r}\Big),\qquad \text{refocus range } |b-b_z| \lesssim N\cdot N_f\cdot p\]
<p>To focus at a new distance, every view is shifted in proportion to where in the lens it looked from, and the views are added. With 9 × 9 pixels under each microlens and an f/2 lens, each view sees the lens at f/18, so the range that can be refocused sharply is nine times the depth of field of an ordinary f/2 photograph of the same (reduced) resolution: here from about 0.6 m to infinity instead of 1.2 to 1.6 m.</p>`,
    String.raw`Thin main lens; ideal microlenses whose f-number matches the main lens, so their images of the aperture just touch; one ray per pixel through the centre of its part of the lens; a scene of flat cards without lighting. Refocusing shifts the views but ignores the slight change of magnification between focal planes; no diffraction (in real light-field cameras the microlenses' diffraction limits N).`));
  root.append(theory('Recording the light field', String.raw`
<div class="theory-cols"><div>
<h3>The 4-D light field</h3>
<p>In free space the light is described by its radiance along every ray, a function of four numbers: where a ray crosses two planes, for example the main lens \((u, v)\) and the sensor \((x, y)\). A camera integrates it over the lens, \(E(x, y) = \iint L(u, v, x, y)\,du\,dv\), and the focus is fixed by where the sensor is. With a microlens array in the image plane and the sensor one microlens focal length behind it, each microlens is a tiny camera photographing the main lens: the pixel under it at position \((k, l)\) records only light from one part \((u_k, v_l)\) of the aperture (Adelson &amp; Wang 1992; Ng et al. 2005).</p>
<h3>Refocusing</h3>
<p>Light that would come to focus on a plane \(b_r\) instead of \(b\) crosses the sensor plane at \(x + u(1 - b/b_r)\). Shifting each sub-aperture view by that amount and adding them makes the photograph that a sensor at \(b_r\) would have taken; in the Fourier domain this is a slice through the 4-D spectrum (Ng 2005).</p>
</div><div>
<h3>The trade-off</h3>
<p>A sensor of \(P\) pixels gives \(P/N^2\) picture pixels and \(N^2\) views. Each view has an aperture \(N\) times smaller, so it is sharp over an \(N\) times larger depth, and refocusing stays sharp over that range. Light-field cameras therefore spend resolution to buy focus after the shot, synthetic apertures, small changes of viewpoint and depth: the slope of each line in the epipolar-plane image is the depth of that point (Bolles, Baker &amp; Marimont 1987).</p>
<h3>In practice</h3>
<p>The first hand-held plenoptic camera (Ng et al. 2005) led to consumer cameras; industrial light-field cameras measure depth for inspection, and the "focused plenoptic camera" (Lumsdaine &amp; Georgiev 2009) places the microlenses to trade angular for spatial samples. Phone cameras with dual-pixel sensors record a 2 × 1 light field: two views through the left and right halves of the lens, used for autofocus and portrait depth.</p>
</div></div>`));
  root.append(references([
    'E. H. Adelson &amp; J. Y. A. Wang, "Single lens stereo with a plenoptic camera", IEEE Trans. Pattern Anal. Mach. Intell. 14, 99 (1992).',
    'M. Levoy &amp; P. Hanrahan, "Light field rendering", Proc. SIGGRAPH 1996, 31.',
    'R. Ng, M. Levoy, M. Brédif, G. Duval, M. Horowitz &amp; P. Hanrahan, "Light field photography with a hand-held plenoptic camera", Stanford Tech. Rep. CTSR 2005-02 (2005).',
    'R. Ng, "Fourier slice photography", ACM Trans. Graph. 24, 735 (2005).',
    'R. C. Bolles, H. H. Baker &amp; D. H. Marimont, "Epipolar-plane image analysis: an approach to determining structure from motion", Int. J. Comput. Vis. 1, 7 (1987).',
    'A. Lumsdaine &amp; T. Georgiev, "The focused plenoptic camera", Proc. IEEE ICCP 2009.',
  ]));
  return () => { gen++; clearTimeout(idle); [photo, epi, chart].forEach((st) => st.destroy()); };
}
