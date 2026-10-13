import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { oetf } from '../lib/color.js';
import { LENSES } from '../lib/raytrace.js';
import { cardinalPoints, disparity } from '../lib/panorama.js';

const D2R = Math.PI / 180, PX = 0.006; // 24 MP full-frame pixel (mm)

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Stitching software assumes that every frame of a panorama was taken from the same point. That holds only if the camera turns about the entrance pupil of its lens, the "no-parallax point". Turn it about the tripod screw instead and near objects shift against the background between frames. They then appear twice, or are cut in half, where the frames overlap.', domains: ['photo', 'video'] }));

  const ctl = controls({
    e: { type: 'range', label: 'Entrance pupil ahead of the rotation axis', min: -120, max: 120, step: 1, value: 60, unit: 'mm', hint: 'Typical when a camera turns about its tripod screw: the pupil is 40–100 mm in front of it' },
    lat: { type: 'range', label: 'Sideways offset of the rotation axis', min: -40, max: 40, step: 1, value: 0, unit: 'mm' },
    delta: { type: 'range', label: 'Rotation between the two frames', min: 10, max: 70, step: 1, value: 40, unit: '°' },
    dn: { type: 'range', label: 'Distance of the near pole', min: 0.3, max: 10, log: true, value: 1, unit: 'm' },
    f: { type: 'range', label: 'Focal length (full frame)', min: 12, max: 50, step: 1, value: 24, unit: 'mm' },
    mode: { type: 'seg', label: 'Show', value: 'blend', options: [['blend', 'Stitched panorama'], ['diff', 'Frame difference']] },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const pano = stage({ aspect: 2.6, label: 'Two frames re-projected onto a cylinder and blended, as a stitcher assumes (overlap outlined)', draw: drawPano, minH: 200 });
  const zoom = stage({ aspect: 1.2, label: 'Overlap around the near pole, 3× enlarged', draw: drawZoom, minH: 220 });
  const top = stage({ aspect: 1.2, label: 'Top view to scale: camera at both positions, entrance pupils (dots) and lines of sight to the pole', draw: drawTop, minH: 220 });
  const table = h('div.card', { style: { padding: '12px' } });
  root.append(lab([pano.el, h('div.grid-2', {}, zoom.el, top.el), table], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // where are the entrance pupil and the nodal point of real designs?
  const rows = Object.entries(LENSES).map(([k, L]) => { const c = cardinalPoints(L); return [(L.name || k).replace(/\s*\(.*\)$/, ''), c.efl, c.zEP, c.zH]; });
  table.append(h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'No-parallax point vs nodal point of the library lenses (paraxial, mm behind the front vertex)'),
    h('div.prose', {}, h('table', {}, h('thead', {}, h('tr', {}, ...['Lens', 'f', 'Entrance pupil', 'Front nodal point', 'Difference'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map(([n, f, ep, hp]) => h('tr', {}, h('td', {}, n), h('td', {}, f.toFixed(1)), h('td', {}, ep.toFixed(1)), h('td', {}, hp.toFixed(1)), h('td', {}, (hp - ep).toFixed(1))))))),
    h('p.note', {}, 'The two coincide only when the stop sits at the front principal plane. For the Double-Gauss they are 8 mm apart; rotating about the nodal point, as often recommended, still leaves parallax.'));

  const job = latest('panorama');
  let P = null, draft = null;
  function params(st, W) { return { W, H: Math.round(W / 2.6), f: st.f, sensor: [36, 24], delta: st.delta * D2R, e: st.e / 1000, lat: st.lat / 1000, height: 1.5, dn: st.dn, df: 60, mode: st.mode }; }
  function update() {
    const st = ctl.state, delta = st.delta * D2R, e = st.e / 1000, disp = disparity(e, delta, st.dn, 60), pxPerRad = st.f / PX;
    const overlap = 2 * Math.atan(18 / st.f) / D2R - st.delta;
    const eMax = (PX / st.f) * st.dn / (2 * Math.sin(delta / 2)) * 1000; // mm for a 1-px error
    ro.replaceChildren(readouts([
      ['Parallax of the near pole', `${(Math.abs(disp) / D2R * 60).toFixed(2)}′ = ${(Math.abs(disp) * pxPerRad).toFixed(1)} px`],
      ['Frame overlap', overlap > 0 ? overlap.toFixed(1) + '°' : 'none (gap!)'],
      ['Largest pupil offset for ≤ 1 px at this distance', eMax.toFixed(2) + ' mm'],
      ['Nearest object stitchable to 1 px with this offset', e ? ((Math.abs(e) * 2 * Math.sin(delta / 2)) / (PX / st.f)).toFixed(1) + ' m' : '∞ (no parallax)'],
    ]));
    calc.set(String.raw`\begin{aligned}
    \Delta\varphi &= 2\arctan\frac{e\sin(\Delta/2)}{d - e\cos(\Delta/2)}\\
    &= ${texNum(Math.abs(disp) * 1000, 3)}\ \text{mrad}\\
    \Delta\varphi\,f/p &= ${texNum(Math.abs(disp) * pxPerRad, 3)}\ \text{px}
    \end{aligned}`);
    job('panorama', params(st, 360)).then((r) => { draft = r; P = null; [pano, zoom].forEach((x) => x.redraw()); return job('panorama', params(st, 1080)); }).then((r) => { if (r) { P = r; [pano, zoom].forEach((x) => x.redraw()); } });
    top.redraw();
  }
  const toCanvas = (R) => {
    if (R.c) return R.c;
    const ic = imageCanvas(R.W, R.H);
    for (let k = 0; k < R.W * R.H; k++) { for (let q = 0; q < 3; q++) ic.data[k * 4 + q] = 255 * oetf(Math.min(1, R.rgb[k * 3 + q])); ic.data[k * 4 + 3] = 255; }
    ic.put(); R.c = ic.c; return ic.c;
  };
  function drawPano(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const R = P || draft;
    if (!R) return;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(toCanvas(R), 0, 0, w, hh);
    // overlap region
    const st = ctl.state, hf = Math.atan(18 / st.f), x = (phi) => (phi / R.phiMax * 0.5 + 0.5) * w;
    const a = st.delta * D2R / 2 - hf, b = -st.delta * D2R / 2 + hf;
    if (b > a) { ctx.strokeStyle = 'rgba(255,181,71,0.8)'; ctx.setLineDash([5, 4]); ctx.strokeRect(x(a), 1, x(b) - x(a), hh - 2); ctx.setLineDash([]); }
  }
  function drawZoom(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const R = P || draft;
    if (!R) return;
    const c = toCanvas(R), sw = R.W / 6, sh = sw / (w / hh), cx = R.W / 2, cy = R.H * 0.62;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(c, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, w, hh);
  }
  // top view of the camera region to scale (the pole lies far beyond; lines of sight point to it)
  function drawTop(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state, e = st.e / 1000, lat = st.lat / 1000, delta = st.delta * D2R, dn = st.dn;
    const span = Math.max(0.12, Math.abs(e) + 0.1, Math.abs(lat) + 0.1), sc = Math.min(w, hh) * 0.42 / span;
    const ox = w / 2, oy = hh * 0.62, X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
    [-delta / 2, delta / 2].forEach((th, k) => {
      const col = k ? '#6ad7ff' : '#ff9cc0', ax = Math.sin(th), ay = Math.cos(th), P = (u, v) => [u * ay + v * ax, -u * ax + v * ay]; // camera (u right, v forward) → world
      // body 140 × 80 mm centred 30 mm behind the axis... sensor plane at the axis, lens barrel up to the pupil
      const poly = (pts) => { ctx.beginPath(); pts.forEach(([u, v], q) => { const [x, y] = P(u, v); q ? ctx.lineTo(X(x + lat * ay), Y(y - lat * ax)) : ctx.moveTo(X(x + lat * ay), Y(y - lat * ax)); }); ctx.closePath(); ctx.stroke(); };
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      poly([[-0.07, -0.05], [0.07, -0.05], [0.07, 0.03], [-0.07, 0.03]]);
      poly([[-0.035, 0.03], [0.035, 0.03], [0.03, Math.max(0.04, e + 0.01)], [-0.03, Math.max(0.04, e + 0.01)]]);
      const ep = [e * ax + lat * ay, e * ay - lat * ax];
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(ep[0]), Y(ep[1]), 4.5, 0, 7); ctx.fill();
      // line of sight from this pupil towards the pole at (0, dn)
      const dx = 0 - ep[0], dy = dn - ep[1], L = Math.hypot(dx, dy);
      ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(ep[0]), Y(ep[1])); ctx.lineTo(X(ep[0] + (dx / L) * span * 3), Y(ep[1] + (dy / L) * span * 3)); ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(X(0), Y(0), 4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('rotation axis', X(0) + 8, Y(0) + 14);
    ctx.fillText(`↑ to the pole, ${dn.toFixed(2)} m away`, 8, hh - 10);
    // scale bar
    const bar = 0.05 * sc; ctx.fillRect(w - bar - 14, hh - 16, bar, 2); ctx.textAlign = 'right'; ctx.fillText('50 mm', w - 14, hh - 22);
  }

  update();

  root.append(theory('Where to put the rotation axis', String.raw`
<div class="theory-cols"><div>
<h3>The entrance pupil is the centre of perspective</h3>
<p>Every ray that forms the image passes, on the object side, through the entrance pupil: the image of the aperture stop seen from the front. The chief ray of each image point aims at its centre. Two photographs show identical perspective, and can be stitched without parallax, only if their entrance pupils coincide. Rotating the camera about any other point moves the pupil by</p>
\[\mathbf p_k = \mathbf R(\theta_k)\,\mathbf e,\]
<p>and an object at distance \(d\) straight ahead then appears in directions that differ between two frames yawed by \(\pm\Delta/2\) by</p>
\[\Delta\varphi = 2\arctan\frac{e\sin(\Delta/2)}{d - e\cos(\Delta/2)} \approx \frac{2e\sin(\Delta/2)}{d}.\]
<p>The background (here 60 m away) moves far less. The stitcher aligns the background, so near objects are misplaced by the difference and appear doubled or cut in the blend. The test suite checks this formula against the ray-cast geometry exactly.</p>
<h3>"Nodal point" is a misnomer</h3>
<p>Panoramic heads are often adjusted to the "nodal point". The nodal points are a different pair of cardinal points: a ray aimed at the front one leaves from the rear one at the same angle, and in air they coincide with the principal points. They govern the image scale, not the perspective. The table computes both for the library lenses from their paraxial matrices: \(z_{EP} = B/A\) for the stop's image, \(z_H = (D-1)/C\) for the front principal point. They agree only when the stop lies in the principal plane, as in a thin lens.</p>
</div><div>
<h3>How precise must the pivot be?</h3>
<p>For an error below one pixel of angular size \(p/f\), the pupil must sit within</p>
\[e_\text{max} = \frac{p}{f}\,\frac{d}{2\sin(\Delta/2)}\]
<p>of the axis. With 6 µm pixels, a 24 mm lens, 40° steps and an object at 1 m that is 0.37 mm. Panoramic heads are therefore adjusted with test shots of two aligned poles. For distant scenes the requirement relaxes in proportion to the distance, which is why hand-held panoramas of landscapes work and those of interiors fail.</p>
<h3>Wide angles and fisheyes</h3>
<p>For off-axis bundles the entrance pupil of a real lens moves and tilts with field angle (pupil aberration). It moves strongly in fisheyes, whose pupils sweep forward by several millimetres towards the edge of the field. The no-parallax point is then defined for a particular field angle, usually the overlap zone. This page uses one fixed pupil per frame, the paraxial approximation.</p>
</div></div>`));
  root.append(references([
    'R. Kingslake, <em>Optical System Design</em>, Academic Press (1983), ch. 2: pupils, principal and nodal points.',
    'R. Littlefield, “Theory of the no-parallax point in panorama photography”, version 1.0 (2006): why the entrance pupil, not the nodal point, is the centre of perspective.',
    'R. Szeliski, “Image alignment and stitching: a tutorial”, <em>Found. Trends Comput. Graph. Vis.</em> 2, 1 (2006).',
  ]));

  return () => [pano, zoom, top].forEach((x) => x.destroy());
}
