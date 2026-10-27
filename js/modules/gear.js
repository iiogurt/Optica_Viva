// Test your own gear: sharpness (slanted edge), vignetting (flat field) and distortion (a straight
// line) measured from your own photographs, entirely in the browser.
import { h, controls, stage, readouts, texNum, readUrlParam } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { oetf } from '../lib/color.js';
import { makeRng } from '../lib/random.js';
import { esfr, edgeFit, mtfAt, syntheticEdge } from '../lib/esfr.js';
import { CAMERAS, pitchOf } from '../lib/equipment.js';
import { linearPlanes, vignetting, fitDistortion, undistort, distortPoint } from '../lib/gear.js';
import { t } from '../lib/i18n.js';

const TESTS = { sharp: 'Sharpness (slanted edge)', vig: 'Vignetting (flat field)', dist: 'Distortion (straight line)' };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video', 'space'] }));
  root.append(idea(String.raw`<p>Lens reviews measure sharpness, darkening corners and bending lines with test charts. You can do the same with your own camera and lens: photograph a dark edge on a bright card, a plain evenly lit wall, or a straight door frame, and load the picture here. Nothing is uploaded; every calculation happens in your browser.</p>
<p>For sharpness, draw a box across a slightly tilted edge: the way the edge goes from dark to bright shows how much fine detail the lens and sensor keep. For distortion, click points along something that is straight in reality.</p>`, [
    'With the sharpness <strong>demo image</strong>, drag a new box across the edge: compare the red, green and blue curves.',
    'Switch to <strong>Vignetting</strong> with the demo: how many stops darker are the corners?',
    'With the distortion demo, click six points along the curved top line: the fitted value tells barrel from pincushion.',
  ]));

  const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const loadBtn = h('button.btn', { type: 'button', onClick: () => fileIn.click() }, t('Load your photo…'));
  const demoBtn = h('button.btn', { type: 'button', onClick: () => loadDemo() }, t('Use the demo image'));
  const clearBtn = h('button.btn', { type: 'button', onClick: () => { pts = []; analyse(); } }, t('Clear points'));
  const ctl = controls({
    test: { type: 'seg', label: 'Test', value: 'sharp', options: Object.entries(TESTS).map(([k, t]) => [k, t.split(' (')[0]]) },
    body: { type: 'select', label: 'Your camera', value: 'custom', options: [['custom', 'Other (set the pixel size)'], ...Object.entries(CAMERAS).map(([k, c]) => [k, c.name])] },
    pitch: { type: 'range', label: 'Pixel size of your camera', min: 1, max: 9, step: 0.01, value: 4.3, unit: 'µm' },
  }, (st) => {
    if (st.body !== lastBody) { lastBody = st.body; if (st.body !== 'custom') { ctl.set.pitch(+pitchOf(CAMERAS[st.body]).toFixed(2)); return; } }
    if (st.test !== lastTest) { lastTest = st.test; pts = []; if (!userImage) { loadDemo(); return; } }
    analyse();
  });
  let lastBody = 'custom', lastTest = ctl.state.test;
  const status = h('p.note', { role: 'status' }, 'Load a photo or the demo image.');
  const howto = { sharp: 'Drag a box across a dark-to-bright edge tilted by a few degrees.', vig: 'Use a photo of an evenly lit, featureless surface.', dist: 'Click at least four points along a line that is straight in reality, near the edge of the frame.' };
  const hint = h('p.note');
  const ro = h('div');
  const calc = liveCalc('Result');
  const view = stage({ aspect: 1.5, label: '', draw: drawView, cls: 'plain', minH: 280 });
  const chart = stage({ aspect: 2.4, label: '', draw: drawChart, cls: 'plain', minH: 220 });
  root.append(lab([view.el, h('div.card', { style: { padding: '8px' } }, chart.el)], [h('div.card', {}, ctl.el, h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } }, loadBtn, demoBtn, clearBtn), fileIn, hint, status), h('div.card', {}, ro), calc.el]));

  // full-resolution image in an offscreen canvas; preview drawn scaled
  let src = null, W = 0, H = 0, userImage = false, roi = null, pts = [], R = null, drag = null;
  const off = document.createElement('canvas'), octx = off.getContext('2d', { willReadFrequently: true });
  const setImage = (draw, w, hh, isUser) => {
    W = w; H = hh; off.width = W; off.height = H; draw(octx); src = off; userImage = isUser; roi = null; pts = []; analyse();
  };
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 8000 / Math.max(bmp.width, bmp.height));
      setImage((c) => c.drawImage(bmp, 0, 0, bmp.width * scale, bmp.height * scale), Math.round(bmp.width * scale), Math.round(bmp.height * scale), true);
      status.textContent = `${f.name}: ${W} × ${H} pixels, analysed in your browser only.${scale < 1 ? ' (Scaled down to 8000 pixels.)' : ''}`;
    } catch (e) { status.textContent = t('That file could not be read as an image.'); }
  });

  // demo images with known answers: σ = 1 px blur, corners 1.5 stops down, barrel k = −0.06
  function loadDemo() {
    const test = ctl.state.test, w = 900, hh = 600, img = octx.createImageData(w, hh), d = img.data, rng = makeRng(3).g;
    const put = (k, r, g, b) => { d[4 * k] = Math.round(oetf(Math.min(1, Math.max(0, r))) * 255); d[4 * k + 1] = Math.round(oetf(Math.min(1, Math.max(0, g))) * 255); d[4 * k + 2] = Math.round(oetf(Math.min(1, Math.max(0, b))) * 255); d[4 * k + 3] = 255; };
    if (test === 'sharp') {
      // an edge tilted by 5°, blurred σ = 1 px, with lateral colour (red +0.6 px, blue −0.6 px)
      const chans = [0.6, 0, -0.6].map((dx) => syntheticEdge(w, hh, { angle: 5, sigma: 1, shift: dx }));
      for (let k = 0; k < w * hh; k++) put(k, chans[0][k] + 0.01 * rng(), chans[1][k] + 0.01 * rng(), chans[2][k] + 0.01 * rng());
      octx.putImageData(img, 0, 0);
      setImage(() => octx.putImageData(img, 0, 0), w, hh, false);
      roi = { x: w / 2 - 40, y: hh / 2 - 80, w: 80, h: 160 }; analyse();
      status.textContent = t('Demo: an edge tilted by 5°, blurred by σ = 1 pixel, with half a pixel of lateral colour.');
    } else if (test === 'vig') {
      for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - w / 2, y - hh / 2) / Math.hypot(w / 2, hh / 2), th = Math.atan(r * Math.tan((42 * Math.PI) / 180));
        const v = 0.6 * Math.cos(th) ** 4 * (r > 0.75 ? 1 - 0.8 * (r - 0.75) : 1) + 0.004 * rng();
        put(y * w + x, v, v, v);
      }
      setImage(() => octx.putImageData(img, 0, 0), w, hh, false);
      status.textContent = t('Demo: a flat field through a 24 mm lens on full frame (cos⁴ to 42° at the corner) with some mechanical vignetting.');
    } else {
      for (let k = 0; k < w * hh; k++) put(k, 0.85, 0.85, 0.85);
      setImage(() => {}, w, hh, false);
      octx.putImageData(img, 0, 0);
      octx.strokeStyle = '#202020'; octx.lineWidth = 3;
      for (const yy of [40, 160, 300, 440, 560]) { octx.beginPath(); for (let x = 20; x <= w - 20; x += 10) { const [a, b] = distortPoint(x, yy, -0.06, w, hh); x === 20 ? octx.moveTo(a, b) : octx.lineTo(a, b); } octx.stroke(); }
      for (const xx of [40, 250, 450, 650, 860]) { octx.beginPath(); for (let y = 20; y <= hh - 20; y += 10) { const [a, b] = distortPoint(xx, y, -0.06, w, hh); y === 20 ? octx.moveTo(a, b) : octx.lineTo(a, b); } octx.stroke(); }
      analyse();
      status.textContent = t('Demo: a grid photographed through a lens with barrel distortion (k = −0.06). Click points along one curved line near the edge.');
    }
  }

  // map between preview and image pixels
  const fit = () => { const s = Math.min(view.w / W, view.h / H); return { s, ox: (view.w - W * s) / 2, oy: (view.h - H * s) / 2 }; };
  const toImg = (e) => { const r = view.canvas.getBoundingClientRect(), f = fit(); return [(e.clientX - r.left - f.ox) / f.s, (e.clientY - r.top - f.oy) / f.s]; };
  view.canvas.addEventListener('pointerdown', (e) => {
    if (!src) return;
    const p = toImg(e);
    if (ctl.state.test === 'dist') { pts.push(p); analyse(); return; }
    if (ctl.state.test === 'sharp') { drag = p; roi = { x: p[0], y: p[1], w: 1, h: 1 }; view.canvas.setPointerCapture(e.pointerId); }
  });
  view.canvas.addEventListener('pointermove', (e) => { if (!drag) return; const p = toImg(e); roi = { x: Math.min(drag[0], p[0]), y: Math.min(drag[1], p[1]), w: Math.abs(p[0] - drag[0]), h: Math.abs(p[1] - drag[1]) }; view.redraw(); });
  view.canvas.addEventListener('pointerup', () => { if (drag) { drag = null; analyse(); } });

  function analyse() {
    R = null;
    const st = ctl.state;
    hint.textContent = howto[st.test];
    if (!src) { view.redraw(); chart.redraw(); return; }
    if (st.test === 'sharp' && roi && roi.w > 12 && roi.h > 12) {
      const x0 = Math.max(0, Math.round(roi.x)), y0 = Math.max(0, Math.round(roi.y)), w = Math.min(W - x0, Math.round(roi.w)), hh = Math.min(H - y0, Math.round(roi.h));
      const P = linearPlanes(octx.getImageData(x0, y0, w, hh).data, w, hh);
      // decide the edge orientation from the mean gradients; transpose horizontal edges
      let gx = 0, gy = 0; for (let y = 1; y < hh - 1; y++) for (let x = 1; x < w - 1; x++) { gx += Math.abs(P.Y[y * w + x + 1] - P.Y[y * w + x - 1]); gy += Math.abs(P.Y[(y + 1) * w + x] - P.Y[(y - 1) * w + x]); }
      const vertical = gx >= gy, T = (a) => { if (vertical) return a; const t = new Float32Array(w * hh); for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) t[x * hh + y] = a[y * w + x]; return t; };
      const ww = vertical ? w : hh, hgt = vertical ? hh : w;
      const res = {}; for (const c of ['R', 'G', 'B', 'Y']) res[c] = esfr(T(P[c]), ww, hgt);
      const fitY = res.Y.fit, ang = Math.abs(Math.atan(fitY.b) * 180 / Math.PI);
      const shift = (c) => res[c].fit.a - res.G.fit.a;
      R = { kind: 'sharp', res, ang, mtf50: mtfAt(res.Y.freqs, res.Y.mtf, 0.5), mtf10: mtfAt(res.Y.freqs, res.Y.mtf, 0.1), ca: [shift('R'), shift('B')], H };
      const lpmm = (f) => (f * 1000) / st.pitch;
      ro.replaceChildren(readouts([
        ['Edge angle', ang.toFixed(1) + '°' + (ang < 2 || ang > 10 ? ' (2–10° works best)' : '')],
        ['MTF50', `${R.mtf50.toFixed(3)} cycles/px = ${lpmm(R.mtf50).toFixed(0)} lp/mm`],
        ['MTF50 in line pairs per picture height', isFinite(R.mtf50) ? (R.mtf50 * Math.min(W, H)).toFixed(0) + ' lp/ph' : '—'],
        ['MTF10 (limit of visible detail)', isFinite(R.mtf10) ? R.mtf10.toFixed(3) + ' cycles/px' : '> 1'],
        ['Contrast at Nyquist (0.5 cycles/px)', (res.Y.mtf[res.Y.freqs.findIndex((f) => f >= 0.5)] * 100).toFixed(0) + ' %'],
        ['Lateral colour: red, blue vs green', `${R.ca[0].toFixed(2)} px, ${R.ca[1].toFixed(2)} px`],
      ]));
      calc.say(`Half the contrast survives up to <strong>${R.mtf50.toFixed(2)} cycles per pixel</strong> (${lpmm(R.mtf50).toFixed(0)} line pairs per mm with ${st.pitch} µm pixels). ${R.mtf50 > 0.35 ? 'That is very sharp, possibly sharpened in the camera.' : R.mtf50 > 0.25 ? 'That is a sharp lens at this spot.' : 'That is soft: check focus, shake or the aperture.'} Colour fringes: red ${R.ca[0].toFixed(2)} px, blue ${R.ca[1].toFixed(2)} px.`);
    } else if (st.test === 'vig') {
      const scale = Math.min(1, 900 / Math.max(W, H)), w = Math.round(W * scale), hh = Math.round(H * scale), c = document.createElement('canvas'); c.width = w; c.height = hh;
      const cx = c.getContext('2d'); cx.drawImage(src, 0, 0, w, hh);
      const P = linearPlanes(cx.getImageData(0, 0, w, hh).data, w, hh), v = vignetting(P.Y, w, hh);
      R = { kind: 'vig', v };
      const worst = Math.min(...v.cornerStops);
      ro.replaceChildren(readouts([
        ['Corners vs centre (stops)', v.cornerStops.map((s) => s.toFixed(2)).join(', ')],
        ['Darkest corner', worst.toFixed(2) + ' stops (' + (100 * 2 ** worst).toFixed(0) + ' %)'],
        ['Asymmetry between corners', (Math.max(...v.cornerStops) - worst).toFixed(2) + ' stops'],
      ]));
      calc.say(`The darkest corner gets <strong>${Math.abs(worst).toFixed(1)} stops</strong> less light than the centre (${(100 * 2 ** worst).toFixed(0)} %). ${Math.max(...v.cornerStops) - worst > 0.2 ? 'The corners differ by more than 0.2 stops: the lens may be decentred, or the light was uneven.' : 'The corners agree, as a well-centred lens should.'}`);
    } else if (st.test === 'dist') {
      if (pts.length >= 4) {
        const d = fitDistortion(pts, W, H);
        R = { kind: 'dist', d };
        ro.replaceChildren(readouts([
          ['Points', String(pts.length)],
          ['Division-model coefficient k', d.k.toFixed(4)],
          ['Distortion at the corner', d.corner.toFixed(2) + ' % (' + (d.k < -0.002 ? 'barrel' : d.k > 0.002 ? 'pincushion' : 'negligible') + ')'],
          ['Deviation from a straight line', `${d.before.toFixed(2)} px → ${d.after.toFixed(2)} px after correction`],
        ]));
        calc.say(`The points are straightened by k = <strong>${d.k.toFixed(3)}</strong>: <strong>${Math.abs(d.corner).toFixed(1)} % ${d.k < 0 ? 'barrel' : 'pincushion'} distortion</strong> at the corner. The line's deviation drops from ${d.before.toFixed(1)} to ${d.after.toFixed(2)} pixels.`);
      } else {
        ro.replaceChildren(readouts([['Points', `${pts.length} (click at least 4 along one straight line)`]]));
        calc.say('Click at least four points along a line that is straight in reality, preferably near the edge of the frame.');
      }
    }
    if (!R && st.test === 'sharp') { ro.replaceChildren(readouts([['Region', 'drag a box across a slightly tilted edge']])); calc.say('Drag a box across a dark-to-bright edge tilted by a few degrees.'); }
    calc.set(st.test === 'sharp' ? String.raw`\mathrm{MTF}(f) = \left|\frac{\mathcal{F}\{w\,\mathrm{LSF}\}(f)}{\mathcal{F}\{w\,\mathrm{LSF}\}(0)}\right|` : st.test === 'vig' ? String.raw`\Delta = \log_2\frac{E_\text{corner}}{E_\text{centre}}` : String.raw`x_u = c + \frac{x_d - c}{1 + k\,r_d^2}`);
    view.redraw(); chart.redraw();
  }

  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!src) return;
    const f = fit();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(src, f.ox, f.oy, W * f.s, H * f.s);
    if (ctl.state.test === 'sharp' && roi) { ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2; ctx.strokeRect(f.ox + roi.x * f.s, f.oy + roi.y * f.s, roi.w * f.s, roi.h * f.s); }
    if (ctl.state.test === 'dist') {
      ctx.fillStyle = '#ff6b6b'; for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(f.ox + x * f.s, f.oy + y * f.s, 4, 0, 2 * Math.PI); ctx.fill(); }
      if (R?.kind === 'dist') { ctx.fillStyle = '#6be3a4'; for (const [x, y] of undistort(pts, R.d.k, W, H)) { ctx.beginPath(); ctx.arc(f.ox + x * f.s, f.oy + y * f.s, 3, 0, 2 * Math.PI); ctx.fill(); } }
    }
    if (ctl.state.test === 'vig' && R?.kind === 'vig') {
      const { map, cells } = R.v, cw = (W * f.s) / cells, ch = (H * f.s) / cells;
      for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
        const s = Math.log2(map[j * cells + i]); ctx.fillStyle = `rgba(${s < 0 ? 255 : 106},${s < 0 ? 107 : 215},${s < 0 ? 107 : 255},${Math.min(0.6, Math.abs(s) / 2.5)})`;
        ctx.fillRect(f.ox + i * cw, f.oy + j * ch, cw + 0.5, ch + 0.5);
      }
    }
  }

  function drawChart(ctx, w, hh) {
    if (!R) return;
    if (R.kind === 'sharp') {
      const c = { R: '#ff6b6b', G: '#6be3a4', B: '#6ad7ff', Y: '#e9ebf3' };
      plot(ctx, w, hh, {
        title: 'MTF from the slanted edge', x: { min: 0, max: 1, label: 'spatial frequency (cycles/pixel)' }, y: { min: 0, max: 1.1, label: 'MTF' },
        series: ['R', 'G', 'B', 'Y'].map((k) => ({ data: R.res[k].freqs.map((f, i) => [f, R.res[k].mtf[i]]).filter((p) => p[0] <= 1), color: c[k], width: k === 'Y' ? 2.4 : 1.2, label: k === 'Y' ? 'luminance' : { R: 'red', G: 'green', B: 'blue' }[k] })),
        vlines: [{ x: 0.5, color: 'rgba(255,255,255,0.3)', label: 'Nyquist' }], legend: true, legendX: w - 130, legendY: 34,
      });
    } else if (R.kind === 'vig') {
      plot(ctx, w, hh, {
        title: 'Brightness from centre to corner', x: { min: 0, max: 1, label: 'distance from the centre (1 = corner)' }, y: { min: -3, max: 0.3, label: 'stops' },
        series: [{ data: R.v.profile.map(([r, v]) => [r, Math.log2(v)]), color: '#ffb547', points: true, r: 3 }, { data: R.v.profile.map(([r, v]) => [r, Math.log2(v)]), color: 'rgba(255,181,71,0.5)' }],
      });
    } else if (R.kind === 'dist') {
      const u = undistort(pts, R.d.k, W, H), all = [...pts, ...u], xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      plot(ctx, w, hh, {
        title: 'Your points (red) and after removing the distortion (green)', x: { min: Math.min(...xs) - 10, max: Math.max(...xs) + 10, label: 'x (px)' }, y: { min: Math.max(...ys) + 10, max: Math.min(...ys) - 10, label: 'y (px)' },
        series: [{ data: pts, color: '#ff6b6b', points: true, r: 3 }, { data: u, color: '#6be3a4', points: true, r: 3 }],
      });
    }
  }

  // a link that names a camera but not its pixel size applies the camera
  if (ctl.state.body !== 'custom' && readUrlParam('pitch') == null) ctl.set.pitch(+pitchOf(CAMERAS[ctl.state.body]).toFixed(2));
  lastBody = ctl.state.body;
  loadDemo();

  root.append(rule(String.raw`\[\text{MTF50} \approx \frac{0.187}{\sigma}\ \text{cycles/pixel (Gaussian blur of σ pixels)}\]
<p>The frequency at which a lens and sensor keep half the contrast summarises sharpness in one number. A Gaussian blur of \(\sigma\) pixels halves the contrast at \(0.187/\sigma\) cycles per pixel; with the pixel's own aperture added, \(\sigma = 1\) px gives about 0.18. Good lenses on modern sensors reach 0.25–0.35 cycles per pixel near the centre; above about 0.4, in-camera sharpening is usually at work.</p>`,
    String.raw`Results depend on everything in the chain: focus, camera shake, the aperture, the position in the frame and, above all, processing. JPEGs are sharpened and compressed, so for lens tests shoot raw and convert without sharpening. The edge should be tilted 2–10°, well lit, and not clipped to pure black or white.`));

  root.append(theory('How the measurements work', String.raw`
<div class="theory-cols"><div>
<h3>Slanted edge (ISO 12233 e-SFR)</h3>
<p>The selected region is decoded from sRGB to linear light. In every row the edge position is the centroid of the derivative; a straight line fitted through these positions gives the edge's angle and offset. Because the edge is slightly tilted, every pixel lies at a different sub-pixel distance from it: projecting all pixels onto the edge normal and averaging them in quarter-pixel bins builds an oversampled edge-spread function (ESF). Its derivative is the line-spread function (LSF); after a Hamming window, the magnitude of its Fourier transform, normalised at zero frequency and corrected for the finite-difference derivative, is the MTF. Done per colour channel, the edge offsets give the lateral colour shift.</p>
</div><div>
<h3>Flat field</h3>
<p>A photograph of an evenly lit, featureless surface (a white wall, a sheet over the lens against the sky) records only the lens and sensor's falloff. The page averages linear luminance in a 32 × 32 grid, normalises to the centre and reports each corner in stops.</p>
<h3>Distortion</h3>
<p>Points that lie on a straight line in reality are mapped with the one-parameter division model \(x_u = c + (x_d - c)/(1 + k r_d^2)\), \(r\) normalised to the half-diagonal; \(k\) is chosen by golden-section search to make them most nearly collinear. Negative \(k\) is barrel distortion, positive pincushion; the distortion at the corner is about \(100k\) %.</p>
<div class="callout">The demo images have known answers: an edge blurred by σ = 1 pixel with ±0.6 px of lateral colour, a flat field with cos⁴ falloff to 42° plus mechanical vignetting, and a grid with k = −0.06.</div>
</div></div>`));
  root.append(references([
    'ISO 12233:2017, <i>Photography — Electronic still picture imaging — Resolution and spatial frequency responses</i>.',
    'P. D. Burns, "Slanted-edge MTF for digital camera and scanner analysis", Proc. IS&amp;T PICS Conference, 135 (2000).',
    'A. W. Fitzgibbon, "Simultaneous linear estimation of multiple view geometry and lens distortion", Proc. IEEE CVPR (2001): the division model.',
  ]));
  return () => [view, chart].forEach((s) => s.destroy());
}
