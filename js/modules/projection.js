import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { SENSORS } from '../lib/sensors.js';
import { PROJ, tissotCircles, tissotColour } from '../lib/projection.js';
import { parallel, rowBands } from '../lib/compute.js';
import { view3d } from '../lib/gl3d.js';
import { projectionScene } from '../lib/projection3d.js';
import { t } from '../lib/i18n.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video', 'space'] }));
  root.append(idea(String.raw`<p>A wide-angle lens has to squeeze a huge spread of directions onto a flat rectangle, and like a flat map of the round Earth, it cannot get everything right at once. A normal (<strong>rectilinear</strong>) lens keeps straight lines straight, but to do so it stretches things near the edges, and it can never see a full half of the world.</p>
<p>A <strong>fisheye</strong> gives up straight lines to fit in 180 degrees or more. Lines bend into curves, but shapes near the edge stay more natural. Each kind of fisheye chooses what to keep true: angles, areas or distances from the centre.</p>`, [
    "Turn on <strong>Tissot indicatrices</strong> and set the rectilinear lens to 10 mm: the circles near the corners stretch into long ellipses.",
    "Switch to <strong>Stereographic</strong>: the circles stay round everywhere, they just grow towards the edge.",
    "Choose <strong>Equisolid</strong> at 8 mm and turn the <strong>Yaw</strong>: straight columns curve, but the view covers a whole hemisphere.",
  ]));

  const ctl = controls({
    proj: { type: 'select', label: 'Projection', value: 'rectilinear', options: Object.entries(PROJ).map(([k, p]) => [k, p.name]) },
    f: { type: 'range', label: 'Focal length', min: 4, max: 50, log: true, value: 14, unit: 'mm' },
    sensor: { type: 'select', label: 'Sensor', value: 'ff', options: ['ff', 'apsc', 'mft'].map((k) => [k, SENSORS[k].name]) },
    yaw: { type: 'range', label: 'Yaw', min: -90, max: 90, step: 1, value: 0, unit: '°' },
    pitch: { type: 'range', label: 'Pitch', min: -60, max: 60, step: 1, value: 0, unit: '°' },
    tissot: { type: 'toggle', label: 'Tissot indicatrices (10° circles)', value: true },
    ss: { type: 'toggle', label: 'Anti-aliasing (2×2)', value: true },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 1.5, label: 'Rendered view', draw: drawView, minH: 280 });
  const curves = stage({ aspect: 2.2, label: '', draw: drawCurves, cls: 'plain', minH: 220 });
  const v3 = view3d({ label: '3-D: the sphere of directions with Tissot circles, and where the projection puts them on the image plane', aspect: 1.7, minH: 280, yaw: 0.95, pitch: 0.3 });
  root.append(lab([view.el, v3.el, h('div.card', { style: { padding: '6px' } }, curves.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let img = null;
  // rendered in parallel row bands by the compute workers (js/lib/projection.js); a newer
  // request makes older results stale
  let ticket = 0;
  async function render() {
    const my = ++ticket, st = ctl.state, S = SENSORS[st.sensor];
    const W = 480, H = Math.round((W * S.h) / S.w);
    const p = { proj: st.proj, f: st.f, sw: S.w, sh: S.h, W, H, yaw: st.yaw, pitch: st.pitch, ss: st.ss };
    const parts = await parallel('projectionRows', rowBands(H).map(([y0, y1]) => ({ p, y0, y1 })));
    if (my !== ticket) return;
    const ic = imageCanvas(W, H);
    let off = 0;
    for (const q of parts) { ic.data.set(q, off); off += q.length; }
    ic.put();
    img = { c: ic.c, W, H, S };
    view.redraw();
  }

  function update() {
    render().catch(console.error);
    const st = ctl.state, S = SENSORS[st.sensor];
    const hd = Math.hypot(S.w, S.h) / 2;
    const fovFor = (p) => {
      if (PROJ[p].cyl) return NaN;
      const t = PROJ[p].Rinv(hd, st.f);
      return isFinite(t) ? Math.min(2 * t, 2 * PROJ[p].max) * 180 / Math.PI : NaN;
    };
    const P = PROJ[st.proj];
    const circ = P.cyl ? null : P.R(Math.min(P.max, Math.PI / 2), st.f);
    ro.replaceChildren(readouts([
      ...['rectilinear', 'stereographic', 'equidistant', 'equisolid', 'orthographic'].map((p) => [`Diagonal FOV, ${p}`, isFinite(fovFor(p)) ? fovFor(p).toFixed(1) + '°' : 'circular image']),
      ['180° image circle diameter', st.proj === 'rectilinear' ? '∞ (cannot reach 90°)' : circ && isFinite(circ) ? (2 * circ).toFixed(1) + ' mm' : '—'],
      ['Sensor half-diagonal', hd.toFixed(2) + ' mm'],
    ]));
    const th = 40 * Math.PI / 180;
    const sc = (p) => { const R = PROJ[p].R, hh2 = (R(th + 1e-5, 1) - R(th - 1e-5, 1)) / 2e-5, k = R(th, 1) / Math.sin(th); return [hh2, k]; };
    const [hr, kr] = sc('rectilinear'), [he, ke] = sc('equisolid'), [hs, ks] = sc('stereographic');
    calc.say((P.cyl ? `${P.name} is a panoramic mapping: it unrolls the scene onto a cylinder, so verticals stay straight while horizontal lines bend.`
      : `At ${fmt(st.f, 3)} mm on ${S.name}, this projection covers <strong>${isFinite(fovFor(st.proj)) ? fovFor(st.proj).toFixed(0) + '°' : 'a full circle'}</strong> across the diagonal`
      + (st.proj === 'rectilinear' ? `; an equisolid fisheye of the same focal length would cover ${isFinite(fovFor('equisolid')) ? fovFor('equisolid').toFixed(0) + '°' : 'a full circular image'}.` : '.')));
    calc.set(String.raw`\begin{aligned}
    &\text{Scale factors at } \theta = 40^\circ\ (f=1):\\
    &h = \frac{dR}{d\theta},\quad k = \frac{R(\theta)}{\sin\theta}\\
    &\text{rect: } h=${texNum(hr, 3)},\ k=${texNum(kr, 3)},\ hk=${texNum(hr * kr, 3)}\\
    &\text{equisolid: } h=${texNum(he, 3)},\ k=${texNum(ke, 3)},\ hk=${texNum(he * ke, 3)}\\
    &\text{stereo: } h=${texNum(hs, 3)},\ k=${texNum(ks, 3)},\ h/k=${texNum(hs / ks, 3)}
    \end{aligned}`);
    view.redraw(); curves.redraw();
    show3d();
  }
  // 3-D: the camera stays where the reader put it, unless the scene's size changes more than 1.5×
  let size3d = 0;
  function show3d() {
    const st = ctl.state, S = SENSORS[st.sensor], size = Math.max(st.f, Math.hypot(S.w, S.h) / 2);
    const keep = size3d > 0 && size / size3d < 1.5 && size3d / size < 1.5;
    v3.setScene(projectionScene({ proj: st.proj, f: st.f, sw: S.w, sh: S.h, yaw: st.yaw, pitch: st.pitch }), keep);
    if (!keep) size3d = size;
  }

  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!img) return;
    const sc = Math.min(w / img.W, hh / img.H), dw = img.W * sc, dh = img.H * sc, ox = (w - dw) / 2, oy = (hh - dh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.c, ox, oy, dw, dh);
    const st = ctl.state;
    if (!st.tissot) return;
    const S = img.S, mm = dw / S.w;
    for (const t of tissotCircles(st.proj, st.f, st.yaw, st.pitch)) {
      if (!t.img) continue;
      const pts = [...t.img.slice(1), t.img[1]].map(([x, y]) => [ox + dw / 2 + x * mm, oy + dh / 2 - y * mm]);
      if (pts.some(([x, y]) => x < ox - 40 || x > ox + dw + 40 || y < oy - 40 || y > oy + dh + 40)) continue;
      if (t.ratio > 60) continue;
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fillStyle = `rgba(${tissotColour(t.ratio).join(',')},0.45)`; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(ox + 8, oy + dh - 26, 300, 20);
    ctx.fillStyle = '#fff'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('Tissot: red = area enlarged, blue = shrunk', ox + 14, oy + dh - 12);
  }

  function drawCurves(ctx, w, hh) {
    const st = ctl.state, S = SENSORS[st.sensor], hd = Math.hypot(S.w, S.h) / 2;
    const th = range(0, 180, 181);
    const radial = ['rectilinear', 'stereographic', 'equidistant', 'equisolid', 'orthographic'];
    plot(ctx, w, hh, {
      title: t('Mapping functions r(θ) for f = {f} mm', { f: st.f.toPrecision(3) }), x: { min: 0, max: 180, label: 'field angle θ (°), from the optical axis' }, y: { min: 0, max: Math.max(hd * 2, st.f * 4), label: 'image height r (mm)' },
      series: radial.map((p) => ({ data: th.filter((t) => (t * Math.PI) / 180 <= PROJ[p].max).map((t) => [t, PROJ[p].R((t * Math.PI) / 180, st.f)]), color: PROJ[p].color, width: p === st.proj ? 2.6 : 1.3, label: PROJ[p].name })),
      hlines: [{ y: hd, color: '#ff6b6b', label: 'sensor half-diagonal' }, { y: S.w / 2, color: 'rgba(255,107,107,0.5)', label: 'half-width' }],
      legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[r = f\tan\theta\ \ \text{(rectilinear)}\qquad r = 2f\sin\tfrac{\theta}{2}\ \ \text{(equisolid fisheye)}\]
<p>A ray arriving at angle \(\theta\) from the lens axis lands a distance \(r\) from the image centre. Because \(\tan\theta\) runs to infinity at 90°, a rectilinear lens can never cover 180°, and near the edges it stretches objects outwards by \(1/\cos^2\theta\): 2.4 times at 50° off axis. A 14 mm rectilinear lens on full frame covers 114° across the diagonal. An 8 mm equisolid fisheye maps the whole hemisphere into a circle 22.6 mm wide, which fits inside the 24 mm height of the sensor.</p>`,
    String.raw`Real lenses follow these formulas only approximately; most fisheyes lie between two of the ideal projections and are calibrated with a polynomial. The stretch factors describe small shapes; large objects near the edge also bend.`));
  root.append(theory('The geometry of mapping a sphere onto a plane', String.raw`
<div class="theory-cols"><div>
<h3>Mapping functions</h3>
<p>A rotationally symmetric lens maps a ray at field angle \(\theta\) from the axis to image height \(r = R(\theta)\), keeping its azimuth. The choice of \(R\) is a design decision, made by how strongly the front elements bend the chief rays:</p>
<table>
<tr><th>Projection</th><th>\(R(\theta)\)</th><th>Preserves</th></tr>
<tr><td>Rectilinear (gnomonic)</td><td>\(f\tan\theta\)</td><td>straight lines</td></tr>
<tr><td>Stereographic</td><td>\(2f\tan(\theta/2)\)</td><td>local shape (conformal)</td></tr>
<tr><td>Equidistant</td><td>\(f\theta\)</td><td>radial angular distance</td></tr>
<tr><td>Equisolid</td><td>\(2f\sin(\theta/2)\)</td><td>area (solid angle)</td></tr>
<tr><td>Orthographic</td><td>\(f\sin\theta\)</td><td>illuminance on a plane (cos law)</td></tr>
</table>
<p>The gnomonic projection is the only one in which every great circle, and so every straight line in space, maps to a straight line. It is central projection through a pinhole. It diverges at \(\theta = 90^\circ\), so no rectilinear lens can cover a hemisphere.</p>
<h3>Tissot's indicatrix</h3>
<p>An infinitesimal circle of angular radius \(\delta\) on the sphere maps to an ellipse with semi-axes \(h\delta\) (radial) and \(k\delta\) (tangential), where</p>
\[h = \frac{dR}{d\theta},\qquad k = \frac{R(\theta)}{\sin\theta}.\]
<p>Conformality means \(h = k\) (stereographic). Equal area means \(hk = f^2\) (equisolid). For a rectilinear lens \(h = f\sec^2\theta\) and \(k = f\sec\theta\). Area therefore grows as \(\sec^3\theta\), and objects are stretched radially by a further factor \(\sec\theta\). This is the "volume anamorphosis" that turns faces at the edge of a wide-angle group photo into ovals. The overlay draws the exact images of 10° circles by mapping 24 boundary directions through the projection. Each is coloured by its area relative to the image of the same 24-sided polygon under the equal-area mapping, so the polygon's own area deficit cancels.</p>
<h3>The sphere of directions</h3>
<p>Every projection starts from the same object: the sphere of all directions around the centre of projection. The 3-D view draws it with radius \(f\), so that the image plane is the plane tangent to it at the optical axis. The gnomonic projection is then literal: each direction's image is where the straight line from the centre through the sphere meets the plane, and nothing beyond 90° ever reaches it. Every other mapping places the image at \(R(\theta)\) instead of \(f\tan\theta\), so the line from a circle to its image no longer passes through the centre. The fisheyes fold the whole forward hemisphere inside the gold circle \(r = R(90^\circ)\). The outline on the sphere is the sensor's border mapped back through the projection: the part of the world the picture contains. Near the back pole a 5° circle's image becomes a thin crescent, which the 24-point outline only approximates.</p>
</div><div>
<h3>Why spheres become ellipses</h3>
<p>A sphere subtends a circular cone. A gnomonic projection images that cone as a conic section (an ellipse whose eccentricity grows with \(\theta\)), even though the projection is "distortion-free" in the lens-designer's sense. Panoramic projections such as cylindrical and Panini give up straightness of horizontal lines to keep verticals straight and objects round. Panini (\(d = 1\)) is a stereographic projection of a cylinder. Painters of vedute used it intuitively.</p>
<h3>Distortion as lens designers define it</h3>
<p>The distortion percentage of a lens is always measured <em>relative to its intended mapping</em>: \(D = (r_\text{real} - R(\theta))/R(\theta)\). A fisheye is not distorted when it follows \(f\theta\). Real lenses deviate from their target, and the deviation is corrected in software (see <a href="#/perspective">Perspective &amp; distortion</a>).</p>
<h3>Across domains</h3>
<p><strong>Photography and video:</strong> action cameras use near-equisolid fisheyes, and VR cinema records two equidistant or equisolid hemispheres and remaps them to equirectangular. <strong>Astronomy:</strong> all-sky meteor and aurora cameras use equidistant or equisolid fisheyes, because those give uniform angular sampling or photometry. Planetarium domes are projected with equidistant (f-θ) lenses. Wide-field survey telescopes are designed to be close to gnomonic, so that celestial coordinates map by the tangent-plane (TAN) projection of the FITS WCS standard.</p>
</div></div>`));
  root.append(references([
    'K. Miyamoto, "Fish eye lens", JOSA 54, 1060 (1964).',
    'J. P. Snyder, <i>Map Projections: A Working Manual</i>, USGS Professional Paper 1395 (1987): Tissot indicatrix.',
    'T. K. Sharpless, B. Postle &amp; D. M. German, "Pannini: a new projection for rendering wide angle perspective images", Computational Aesthetics (2010).',
    'M. R. Calabretta &amp; E. W. Greisen, "Representations of celestial coordinates in FITS", A&amp;A 395, 1077 (2002).',
  ]));
  return () => [view, v3, curves].forEach((s) => s.destroy());
}
