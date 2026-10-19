import { h, controls, stage, readouts, imageCanvas, texNum, fmt } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { parallel, rowBands } from '../lib/compute.js';
import { BOX } from '../lib/perspective.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Things look smaller the farther away they are. That simple fact is all of perspective: how big a nose looks next to the ears, or a mountain next to a person, depends only on <strong>where the camera stands</strong>.</p>
<p>A selfie at arm's length makes the nose look big because it is noticeably closer to the lens than the ears. Step back and use a longer lens to fill the frame again, and the face looks natural. The longer lens did not flatten anything; the distance did. <strong>Lens distortion</strong> is something else: a lens bending straight lines because it does not follow its ideal design.</p>`, [
    "With the face size locked, move the camera from <strong>0.3 m</strong> to <strong>3 m</strong>: the background grows and the nose shrinks back to normal.",
    "Turn off <strong>Keep the face the same size</strong> and change only the focal length: everything scales together, nothing changes shape.",
    "Choose the <strong>Barrel</strong> and then the <strong>Pincushion</strong> preset: straight lines near the edges bow outwards, then inwards.",
  ]));

  const ctl = controls({
    h1: { type: 'heading', label: 'Perspective (dolly zoom)' },
    d: { type: 'range', label: 'Camera distance to the face', min: 0.3, max: 6, log: true, value: 0.5, unit: 'm' },
    keep: { type: 'toggle', label: 'Keep the face the same size (dolly zoom)', value: true },
    fman: { type: 'range', label: 'Focal length (when not locked)', min: 12, max: 300, log: true, value: 50, unit: 'mm' },
    h2: { type: 'heading', label: 'Lens distortion (Brown–Conrady)' },
    preset: { type: 'select', label: 'Preset', value: 'mustache', options: [['none', 'None'], ['barrel', 'Barrel (wide zoom)'], ['pin', 'Pincushion (tele zoom)'], ['mustache', 'Moustache (complex)'], ['custom', 'Custom']] },
    k1: { type: 'range', label: 'k₁', min: -0.4, max: 0.4, step: 0.005, value: -0.18 },
    k2: { type: 'range', label: 'k₂', min: -0.3, max: 0.3, step: 0.005, value: 0.12 },
    k3: { type: 'range', label: 'k₃', min: -0.2, max: 0.2, step: 0.005, value: 0 },
    p1: { type: 'range', label: 'p₁ (decentering)', min: -0.03, max: 0.03, step: 0.001, value: 0 },
    p2: { type: 'range', label: 'p₂ (decentering)', min: -0.03, max: 0.03, step: 0.001, value: 0 },
  }, (st) => {
    const P = { none: [0, 0, 0], barrel: [-0.12, 0.02, 0], pin: [0.08, 0.01, 0], mustache: [-0.18, 0.12, 0] }[st.preset];
    if (P && (st.k1 !== P[0] || st.k2 !== P[1] || st.k3 !== P[2]) && st.preset !== lastPreset) { ctl.set.k1(P[0]); ctl.set.k2(P[1]); ctl.set.k3(P[2]); }
    else if (st.preset === lastPreset && st.preset !== 'custom' && P && (st.k1 !== P[0] || st.k2 !== P[1] || st.k3 !== P[2])) ctl.set.preset('custom');
    lastPreset = ctl.state.preset;
    update();
  });
  let lastPreset = ctl.state.preset;
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 1.5, label: 'Camera view (36 × 24 mm sensor)', draw: drawView, minH: 260 });
  const top = stage({ aspect: 1.5, label: 'Top view', draw: drawTop, minH: 260 });
  const grid = stage({ aspect: 1.5, label: 'Distorted grid', draw: drawGrid });
  const dcurve = stage({ aspect: 1.5, label: '', draw: drawDist, cls: 'plain' });
  root.append(lab([h('div.grid-2', {}, view.el, top.el), h('div.grid-2', {}, grid.el, h('div.card', { style: { padding: '6px' } }, dcurve.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let img = null, F = 50;
  // rendered in parallel row bands by the compute workers (js/lib/perspective.js); a newer request
  // makes older results stale
  let ticket = 0;
  async function render() {
    const my = ++ticket, st = ctl.state;
    F = st.keep ? 50 * (st.d / 1.5) : st.fman;
    const W = 330, H = 220;
    const parts = await parallel('perspectiveRows', rowBands(H).map(([y0, y1]) => ({ p: { d: st.d, F, W, H }, y0, y1 })));
    if (my !== ticket) return;
    const ic = imageCanvas(W, H);
    let off = 0;
    for (const q of parts) { ic.data.set(q, off); off += q.length; }
    ic.put(); img = ic.c;
    view.redraw();
  }


  const D = (x, y) => {
    const st = ctl.state, r2 = x * x + y * y, rad = 1 + st.k1 * r2 + st.k2 * r2 * r2 + st.k3 * r2 * r2 * r2;
    return [x * rad + 2 * st.p1 * x * y + st.p2 * (r2 + 2 * x * x), y * rad + st.p1 * (r2 + 2 * y * y) + 2 * st.p2 * x * y];
  };

  function update() {
    render().catch(console.error);
    const st = ctl.state;
    // nose-to-ear size ratio: nose at distance d − 0.108, ears at d + 0.01 (relative magnification)
    const magNose = 1 / (st.d - 0.108), magEar = 1 / (st.d + 0.01);
    const hfov = (2 * Math.atan(18 / F) * 180) / Math.PI;
    // TV distortion: (edge-midpoint height − corner height) relative, per SMIA definition
    const ar = 24 / 36, cx = 1 / Math.hypot(1, ar), cy = ar * cx;
    const corner = D(cx, cy)[1], mid = D(0, cy)[1];
    const tv = ((corner - mid) / (2 * cy)) * 100;
    ro.replaceChildren(readouts([
      ['Focal length', F.toFixed(1) + ' mm'],
      ['Horizontal field of view', hfov.toFixed(1) + '°'],
      ['Nose magnification vs ears', ((magNose / magEar - 1) * 100).toFixed(1) + ' % larger'],
      ['Background (12 m) size vs face', ((st.d / (12 + st.d)) * 100).toFixed(1) + ' % of same object at face'],
      ['Radial distortion at corner', ((Math.hypot(...D(cx, cy)) / 1 - 1) * 100).toFixed(2) + ' %'],
      ['TV distortion (SMIA)', tv.toFixed(2) + ' %'],
    ]));
    calc.say(`From ${fmt(st.d, 2)} m the nose is drawn <strong>${((magNose / magEar - 1) * 100).toFixed(0)} %</strong> larger, relative to the ears, than in a distant view; a ${F.toFixed(0)} mm lens frames the face.`
      + (() => { const d = (Math.hypot(...D(cx, cy)) - 1) * 100; return Math.abs(d) < 0.05 ? ' The lens has no distortion.' : ` Lens distortion pulls the image corners ${d < 0 ? 'inwards' : 'outwards'} by ${Math.abs(d).toFixed(1)} %.`; })());
    calc.set(String.raw`\begin{aligned}
    m(z) &= \frac{f}{z}\Rightarrow \frac{m_\text{nose}}{m_\text{ear}} = \frac{d + 0.01}{d - 0.108} = ${texNum(magNose / magEar, 4)}\\
    x_d &= x\,(1 + k_1r^2 + k_2r^4 + k_3r^6) + 2p_1xy + p_2(r^2 + 2x^2)\\
    y_d &= y\,(1 + k_1r^2 + k_2r^4 + k_3r^6) + p_1(r^2+2y^2) + 2p_2xy
    \end{aligned}`);
    [view, top, grid, dcurve].forEach((s) => s.redraw());
  }

  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!img) return;
    const sc = Math.min(w / img.width, hh / img.height);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img, (w - img.width * sc) / 2, (hh - img.height * sc) / 2, img.width * sc, img.height * sc);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(10, hh - 28, 190, 20);
    ctx.fillStyle = '#fff'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${F.toFixed(0)} mm at ${ctl.state.d.toFixed(2)} m`, 16, hh - 14);
  }
  function drawTop(ctx, w, hh) {
    ctx.fillStyle = '#07080d'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state, zmin = -6.5, zmax = 18, sc = (w - 30) / (zmax - zmin);
    const X = (z) => 15 + (z - zmin) * sc, Y = (x) => hh / 2 - x * sc;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let z = -6; z <= 18; z += 2) { ctx.beginPath(); ctx.moveTo(X(z), 0); ctx.lineTo(X(z), hh); ctx.stroke(); }
    // FOV cone
    const half = Math.atan(18 / F), L = 30;
    ctx.fillStyle = 'rgba(255,181,71,0.10)'; ctx.strokeStyle = 'rgba(255,181,71,0.6)';
    ctx.beginPath(); ctx.moveTo(X(-st.d), Y(0)); ctx.lineTo(X(-st.d + L), Y(L * Math.tan(half))); ctx.lineTo(X(-st.d + L), Y(-L * Math.tan(half))); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e9ebf3'; ctx.fillRect(X(-st.d) - 8, Y(0) - 6, 10, 12);
    ctx.fillStyle = '#e4b696'; ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(3, 0.11 * sc), 0, 7); ctx.fill();
    for (const B of BOX.slice(1)) { ctx.fillStyle = 'rgba(200,190,170,0.85)'; ctx.fillRect(X(B.a[2]), Y(B.b[0]), (B.b[2] - B.a[2]) * sc, (B.b[0] - B.a[0]) * sc); }
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('camera', X(-st.d) - 10, Y(0) + 22); ctx.fillText('pillars at 4, 8, 12, 16 m', X(4), 16);
  }
  function drawGrid(ctx, w, hh) {
    ctx.fillStyle = '#07080d'; ctx.fillRect(0, 0, w, hh);
    const ar = 24 / 36, n = Math.hypot(1, ar), S = Math.min(w / 2, (hh / 2) / ar) * 0.86;
    const P = (x, y) => { const [a, b] = D(x / n, y / n); return [w / 2 + a * n * S, hh / 2 - b * n * S]; };
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.strokeRect(w / 2 - S, hh / 2 - ar * S, 2 * S, 2 * ar * S);
    ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 1.3;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath(); for (let k = 0; k <= 60; k++) { const [x, y] = P(i / 6, -ar + (2 * ar * k) / 60); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    }
    for (let j = -4; j <= 4; j++) {
      ctx.beginPath(); for (let k = 0; k <= 60; k++) { const [x, y] = P(-1 + (2 * k) / 60, (j / 4) * ar); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    }
  }
  function drawDist(ctx, w, hh) {
    const rs = range(0, 1, 100);
    plot(ctx, w, hh, {
      title: 'Radial distortion vs normalised image height', x: { min: 0, max: 1, label: 'r / half-diagonal' }, y: { min: -8, max: 8, label: 'distortion (%)' },
      series: [{ data: rs.map((r) => [r, (Math.hypot(...D(r, 0)) / Math.max(r, 1e-9) - 1) * 100]), color: '#ffb547', width: 2.4 }],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.3)', dash: [] }],
    });
  }

  update();

  root.append(rule(String.raw`\[\frac{\text{size}_1}{\text{size}_2} = \frac{\text{distance}_2}{\text{distance}_1}\]
<p>Apparent size is inversely proportional to distance. From 50 cm, the ears of a face are about 0.51 m from the lens and the tip of the nose 0.39 m, so the nose is drawn 30 % larger relative to the ears than in a distant view. From 3 m the difference falls to 4 %, which is why portrait photographers step back and use 85–135 mm lenses.</p>`,
    String.raw`This is exact for a pinhole (central) projection. It says nothing about lens distortion, which moves points away from where the pinhole model puts them. It also ignores how the picture is viewed: a photograph looks natural from a distance equal to the focal length times the enlargement.`));
  root.append(theory('Projection geometry and distortion', String.raw`
<div class="theory-cols"><div>
<h3>Perspective is position</h3>
<p>A rectilinear camera maps a point at depth \(z\) to image height \(y' = f\,y/z\). The <em>relative</em> size of two objects at depths \(z_1, z_2\) is therefore \(z_2/z_1\), independent of \(f\). Focal length scales the whole image uniformly and changes only how much of it lands on the sensor. Cropping a wide-angle image gives exactly the telephoto picture taken from the same spot.</p>
<p>For a face, the nose tip is about 11 cm nearer than the ears. At 0.5 m the nose is therefore about 30 % over-magnified relative to the ears, while at 3 m the difference is about 4 %. That is why portraits are made from 1.5–3 m: we know faces best at conversational distances. The <strong>dolly zoom</strong> (Hitchcock's <i>Vertigo</i> effect) moves the camera while zooming to hold the subject constant, so only the perspective changes and the background seems to breathe.</p>
<h3>Compression</h3>
<p>"Telephoto compression" is the same law. From far away, objects at 4 and 16 m differ in depth ratio by only \((d+16)/(d+4)\). That ratio approaches 1 as \(d\) grows, so the background looms large and the pillars stack together.</p>
</div><div>
<h3>Lens distortion: the Brown–Conrady model</h3>
<p>Distortion is a departure from the intended mapping (here gnomonic, \(r = f\tan\theta\)). It is the \(W_{311}\) Seidel term and its higher orders. Brown's model (1966) writes it in normalised image coordinates as a radial series plus decentering terms:</p>
\[x_d = x(1 + k_1r^2 + k_2r^4 + k_3r^6) + 2p_1xy + p_2(r^2 + 2x^2).\]
<p>\(k_1<0\) gives <strong>barrel</strong> distortion, typical of wide zooms, where the stop lies behind most of the positive power. \(k_1>0\) gives <strong>pincushion</strong>, typical of telezooms. Opposite-signed \(k_1, k_2\) make <strong>moustache</strong> distortion, which is barrel in the centre and pincushion at the edges and appears in aspheric retrofocus designs. The \(p\) terms come from tilted or decentred elements, which manufacturing tolerances always leave behind.</p>
<h3>TV distortion and correction</h3>
<p>Industry quotes "TV distortion" (SMIA): the bending of the frame's top edge, \((h_\text{corner} - h_\text{mid})/(2h)\). Software correction inverts the model by fixed-point iteration, \(\mathbf x_{n+1} = \mathbf x_d - \Delta(\mathbf x_n)\). Resampling stretches the corners and costs resolution there, which is why camera-lens profiles are a design trade. Photogrammetry and computer vision estimate \(k_i, p_i\) by Zhang's checkerboard calibration. Survey telescopes fit the same polynomials to star positions to reach milliarcsecond astrometry.</p>
</div></div>`));
  root.append(references([
    'D. C. Brown, "Decentering distortion of lenses", Photogrammetric Engineering 32, 444 (1966).',
    'Z. Zhang, "A flexible new technique for camera calibration", IEEE TPAMI 22, 1330 (2000).',
    'SMIA 1.0 Part 5: Camera characterisation specification (TV distortion).',
    'M. Kemp, <i>The Science of Art: Optical Themes in Western Art</i>, Yale (1990): perspective.',
  ]));
  return () => [view, top, grid, dcurve].forEach((s) => s.destroy());
}
