import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { SENSORS } from '../lib/sensors.js';

// Mapping functions r = R(θ) (radial) or explicit forward/inverse maps (cylindrical families).
const PROJ = {
  rectilinear: { name: 'Rectilinear (gnomonic)  r = f tan θ', R: (t, f) => f * Math.tan(t), Rinv: (r, f) => Math.atan(r / f), max: Math.PI / 2 - 0.01, color: '#ffffff' },
  stereographic: { name: 'Stereographic (conformal)  r = 2f tan(θ/2)', R: (t, f) => 2 * f * Math.tan(t / 2), Rinv: (r, f) => 2 * Math.atan(r / (2 * f)), max: Math.PI * 0.98, color: '#6ad7ff' },
  equidistant: { name: 'Equidistant  r = f θ', R: (t, f) => f * t, Rinv: (r, f) => r / f, max: Math.PI, color: '#6be3a4' },
  equisolid: { name: 'Equisolid (equal-area)  r = 2f sin(θ/2)', R: (t, f) => 2 * f * Math.sin(t / 2), Rinv: (r, f) => (r <= 2 * f ? 2 * Math.asin(r / (2 * f)) : NaN), max: Math.PI, color: '#ffb547' },
  orthographic: { name: 'Orthographic  r = f sin θ', R: (t, f) => f * Math.sin(t), Rinv: (r, f) => (r <= f ? Math.asin(r / f) : NaN), max: Math.PI / 2, color: '#c18cff' },
  panini: { name: 'Panini (d = 1), panoramic', cyl: true, color: '#ff9cc0' },
  equirect: { name: 'Equirectangular (cylindrical)', cyl: true, color: '#9aa1b5' },
};

// camera-space direction (x right, y up, z forward) ↔ sensor (x, y) in mm
function inverse(p, x, y, f) {
  if (p === 'panini') {
    const phi = 2 * Math.atan(x / (2 * f)), S = 2 / (1 + Math.cos(phi)), hgt = y / f / S;
    const d = [Math.sin(phi), hgt, Math.cos(phi)], L = Math.hypot(...d);
    return Math.abs(phi) < Math.PI ? [d[0] / L, d[1] / L, d[2] / L] : null;
  }
  if (p === 'equirect') {
    const phi = x / f, lat = y / f;
    if (Math.abs(phi) > Math.PI || Math.abs(lat) > Math.PI / 2) return null;
    return [Math.cos(lat) * Math.sin(phi), Math.sin(lat), Math.cos(lat) * Math.cos(phi)];
  }
  const r = Math.hypot(x, y), P = PROJ[p];
  const t = P.Rinv(r, f);
  if (!(t >= 0) || t > P.max) return null;
  const s = Math.sin(t) / (r || 1);
  return [x * s, y * s, Math.cos(t)];
}
function forward(p, d, f) {
  if (p === 'panini') {
    const phi = Math.atan2(d[0], d[2]), S = 2 / (1 + Math.cos(phi));
    return [f * S * Math.sin(phi), f * S * d[1] / Math.hypot(d[0], d[2])];
  }
  if (p === 'equirect') return [f * Math.atan2(d[0], d[2]), f * Math.asin(Math.max(-1, Math.min(1, d[1])))];
  const t = Math.acos(Math.max(-1, Math.min(1, d[2]))), P = PROJ[p];
  if (t > P.max) return null;
  const r = P.R(t, f), a = Math.atan2(d[1], d[0]);
  return [r * Math.cos(a), r * Math.sin(a)];
}

// ── Scene: a 12 × 12 m hall with windows, chequered floor and globes ───────────────────
const BOX = { x: 6, yl: -1.6, yh: 3.4, z: 6 };
const GLOBES = [[-1.6, -0.6, 3.2, 0.9], [1.9, -0.9, 2.4, 0.7], [0, 0.2, 5.0, 0.7], [-3.6, -0.8, 0.8, 0.75], [3.7, -0.7, -1.5, 0.85]];
function shade(o, d) {
  // globes
  let best = Infinity, gi = -1;
  for (let i = 0; i < GLOBES.length; i++) {
    const [cx, cy, cz, r] = GLOBES[i];
    const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < best) { best = t; gi = i; } }
  }
  // box
  let tb = Infinity, face = '';
  const test = (t, fc) => { if (t > 0 && t < tb) { tb = t; face = fc; } };
  if (d[0] > 0) test((BOX.x - o[0]) / d[0], 'E'); else if (d[0] < 0) test((-BOX.x - o[0]) / d[0], 'W');
  if (d[1] > 0) test((BOX.yh - o[1]) / d[1], 'C'); else if (d[1] < 0) test((BOX.yl - o[1]) / d[1], 'F');
  if (d[2] > 0) test((BOX.z - o[2]) / d[2], 'N'); else if (d[2] < 0) test((-BOX.z - o[2]) / d[2], 'S');
  if (best < tb) {
    const [cx, cy, cz, r] = GLOBES[gi];
    const p = [o[0] + best * d[0] - cx, o[1] + best * d[1] - cy, o[2] + best * d[2] - cz].map((v) => v / r);
    const lat = Math.asin(p[1]), lon = Math.atan2(p[0], p[2]);
    const gl = Math.abs(((lat / (Math.PI / 12)) % 1 + 1) % 1 - 0.5) > 0.44 || Math.abs(((lon / (Math.PI / 12)) % 1 + 1) % 1 - 0.5) > 0.44;
    const light = 0.35 + 0.65 * Math.max(0, p[0] * -0.3 + p[1] * 0.8 + p[2] * -0.5);
    const base = [[230, 120, 90], [90, 170, 230], [240, 200, 90], [150, 220, 140], [200, 140, 230]][gi];
    return gl ? [25, 25, 30] : base.map((c) => c * light);
  }
  const P = [o[0] + tb * d[0], o[1] + tb * d[1], o[2] + tb * d[2]];
  const frac = (v) => v - Math.floor(v);
  const line = (v, w) => { const q = frac(v); return q < w || q > 1 - w; };
  if (face === 'F') {
    const ch = (Math.floor(P[0]) + Math.floor(P[2])) & 1;
    return ch ? [196, 188, 172] : [60, 56, 54];
  }
  if (face === 'C') return line(P[0] / 1.5, 0.04) || line(P[2] / 1.5, 0.04) ? [70, 64, 60] : [215, 212, 205];
  // walls: horizontal along-wall coordinate u, height v
  const u = face === 'E' || face === 'W' ? P[2] : P[0], v = P[1];
  const wall = { N: [200, 190, 170], S: [175, 190, 200], E: [205, 185, 175], W: [185, 200, 180] }[face];
  // pilasters every 2 m, windows between
  if (line(u / 2, 0.06)) return [90, 80, 75];
  if (Math.abs(v - 1.2) < 0.03 || Math.abs(v + 1.55) < 0.05) return [90, 80, 75];
  const wu = frac(u / 2), win = wu > 0.25 && wu < 0.75 && v > 0 && v < 2.6;
  if (win) {
    if (line(u / 0.5, 0.04) || line((v - 0) / 0.65, 0.04)) return [40, 40, 46];
    const t = (v - 0) / 2.6;
    return [110 + 80 * t, 150 + 70 * t, 210 + 35 * t];
  }
  return wall;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'A lens must map a hemisphere of directions onto a flat sensor, and no mapping can keep shapes, sizes, angles and straight lines all at once. Rectilinear lenses keep straight lines straight and stretch everything else. Fisheyes trade straightness for coverage and choose what they preserve: angles, areas or angular distance. The view below is rendered by back-tracing every pixel into a 3-D hall.', domains: ['photo', 'video', 'space'] }));

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
  root.append(lab([view.el, h('div.card', { style: { padding: '6px' } }, curves.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let img = null;
  function render() {
    const st = ctl.state, S = SENSORS[st.sensor];
    const W = 480, H = Math.round((W * S.h) / S.w);
    const ic = imageCanvas(W, H);
    const cy = Math.cos((st.yaw * Math.PI) / 180), sy = Math.sin((st.yaw * Math.PI) / 180);
    const cp = Math.cos((st.pitch * Math.PI) / 180), sp = Math.sin((st.pitch * Math.PI) / 180);
    const rot = (d) => { // pitch about x, then yaw about y
      const y1 = d[1] * cp + d[2] * sp, z1 = -d[1] * sp + d[2] * cp;
      return [d[0] * cy + z1 * sy, y1, -d[0] * sy + z1 * cy];
    };
    const o = [0, 0, 0];
    const n = st.ss ? 2 : 1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let sj = 0; sj < n; sj++) for (let si = 0; si < n; si++) {
        const x = ((i + (si + 0.5) / n) / W - 0.5) * S.w, y = (0.5 - (j + (sj + 0.5) / n) / H) * S.h;
        const d = inverse(st.proj, x, y, st.f);
        cnt++;
        if (!d) continue;
        const c = shade(o, rot(d));
        r += c[0]; g += c[1]; b += c[2];
      }
      const k = (j * W + i) * 4;
      ic.data[k] = r / cnt; ic.data[k + 1] = g / cnt; ic.data[k + 2] = b / cnt; ic.data[k + 3] = 255;
    }
    ic.put();
    img = { c: ic.c, W, H, S };
  }

  function update() {
    render();
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
    calc.set(String.raw`\begin{aligned}
    &\text{Scale factors at } \theta = 40^\circ\ (f=1):\\
    &h = \frac{dR}{d\theta},\quad k = \frac{R(\theta)}{\sin\theta}\\
    &\text{rect: } h=${texNum(hr, 3)},\ k=${texNum(kr, 3)},\ hk=${texNum(hr * kr, 3)}\\
    &\text{equisolid: } h=${texNum(he, 3)},\ k=${texNum(ke, 3)},\ hk=${texNum(he * ke, 3)}\\
    &\text{stereo: } h=${texNum(hs, 3)},\ k=${texNum(ks, 3)},\ h/k=${texNum(hs / ks, 3)}
    \end{aligned}`);
    view.redraw(); curves.redraw();
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
    const cyw = Math.cos((st.yaw * Math.PI) / 180), syw = Math.sin((st.yaw * Math.PI) / 180);
    const cp = Math.cos((st.pitch * Math.PI) / 180), sp = Math.sin((st.pitch * Math.PI) / 180);
    // world → camera (inverse of the render rotation)
    const toCam = (d) => {
      const x0 = d[0] * cyw - d[2] * syw, z0 = d[0] * syw + d[2] * cyw;
      return [x0, d[1] * cp - z0 * sp, d[1] * sp + z0 * cp];
    };
    const delta = (5 * Math.PI) / 180; // circle radius (10° diameter)
    for (let lat = -60; lat <= 60; lat += 20) for (let lon = -160; lon <= 180; lon += 20) {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      const c = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
      const e1 = [Math.cos(lo), 0, -Math.sin(lo)], e2 = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
      const pts = [];
      let ok = true;
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * 2 * Math.PI, ca = Math.cos(delta), sa = Math.sin(delta);
        const d = [0, 1, 2].map((q) => c[q] * ca + sa * (Math.cos(a) * e1[q] + Math.sin(a) * e2[q]));
        const p = forward(st.proj, toCam(d), st.f);
        if (!p || !isFinite(p[0])) { ok = false; break; }
        pts.push([ox + dw / 2 + p[0] * mm, oy + dh / 2 - p[1] * mm]);
      }
      if (!ok) continue;
      if (pts.some(([x, y]) => x < ox - 40 || x > ox + dw + 40 || y < oy - 40 || y > oy + dh + 40)) continue;
      // area relative to the image centre
      let A = 0; for (let k = 0; k < pts.length - 1; k++) A += pts[k][0] * pts[k + 1][1] - pts[k + 1][0] * pts[k][1];
      A = Math.abs(A) / 2;
      const A0 = Math.PI * (st.f * delta * mm) ** 2;
      const ratio = A / A0;
      if (ratio > 60) continue;
      const hue = ratio > 1 ? `rgba(255,${Math.max(60, 200 - 60 * Math.log2(ratio))},80,0.45)` : `rgba(90,${150 + 50 * ratio},255,0.45)`;
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fillStyle = hue; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke();
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
      title: `Mapping functions r(θ) for f = ${st.f.toPrecision(3)} mm`, x: { min: 0, max: 180, label: 'field angle θ (°), from the optical axis' }, y: { min: 0, max: Math.max(hd * 2, st.f * 4), label: 'image height r (mm)' },
      series: radial.map((p) => ({ data: th.filter((t) => (t * Math.PI) / 180 <= PROJ[p].max).map((t) => [t, PROJ[p].R((t * Math.PI) / 180, st.f)]), color: PROJ[p].color, width: p === st.proj ? 2.6 : 1.3, label: p })),
      hlines: [{ y: hd, color: '#ff6b6b', label: 'sensor half-diagonal' }, { y: S.w / 2, color: 'rgba(255,107,107,0.5)', label: 'half-width' }],
      legend: true, legendX: w - 130,
    });
  }

  update();

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
<p>Conformality means \(h = k\) (stereographic). Equal area means \(hk = f^2\) (equisolid). For a rectilinear lens \(h = f\sec^2\theta\) and \(k = f\sec\theta\). Area therefore grows as \(\sec^3\theta\), and objects are stretched radially by a further factor \(\sec\theta\). This is the "volume anamorphosis" that turns faces at the edge of a wide-angle group photo into ovals. The overlay draws the exact images of 10° circles by mapping 24 boundary directions through the projection.</p>
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
  return () => [view, curves].forEach((s) => s.destroy());
}
