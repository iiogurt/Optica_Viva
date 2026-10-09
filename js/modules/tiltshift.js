import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';

// ── toy town: houses (boxes) and trees (spheres) bucketed in a 12 m cell grid ──────────
const CELL = 12, GX0 = -5, GX1 = 5, GZ0 = 0, GZ1 = 14;
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const CELLS = new Map();
const cellOf = (gx, gz) => { const k = gx + ',' + gz; if (!CELLS.has(k)) CELLS.set(k, []); return CELLS.get(k); };
for (let gx = GX0; gx <= GX1; gx++) for (let gz = GZ0; gz <= GZ1; gz++) {
  const cx = gx * CELL, cz = gz * CELL, list = cellOf(gx, gz);
  for (let k = 0; k < 2; k++) {
    const w = 2.5 + rnd() * 2.5, d = 2.5 + rnd() * 2.5, x = cx + 1.5 + w / 2 + rnd() * (8 - w), z = cz + 1.5 + d / 2 + rnd() * (8 - d), hgt = 3 + rnd() * 9;
    list.push({ box: true, a: [x - w / 2, 0, z - d / 2], b: [x + w / 2, hgt, z + d / 2], col: [[214, 120, 96], [236, 200, 140], [150, 170, 200], [240, 236, 226], [190, 120, 150]][Math.floor(rnd() * 5)] });
  }
  if (rnd() < 0.85) list.push({ box: false, c: [cx + 10.75, 2.2, cz + 2 + rnd() * 8], r: 1.2 + rnd() * 0.5 });
}
function hitObj(O, o, d) {
  if (!O.box) {
    const ox = o[0] - O.c[0], oy = o[1] - O.c[1], oz = o[2] - O.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - O.r * O.r, disc = b * b - c;
    return disc > 0 ? { t: -b - Math.sqrt(disc), col: [70, 140, 70], n: 3 } : null;
  }
  let t0 = -Infinity, t1 = Infinity, ax = 0;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / d[k]; let ta = (O.a[k] - o[k]) * inv, tb = (O.b[k] - o[k]) * inv;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; ax = k; }
    if (tb < t1) t1 = tb;
  }
  return t0 < t1 && t0 > 0 ? { t: t0, col: ax === 1 ? [O.col[0] * 0.75, O.col[1] * 0.45, O.col[2] * 0.4] : O.col, n: ax } : null;
}
// ray cast with a 2-D DDA over the cell grid (Amanatides & Woo), tested near-to-far
function castTown(o, d) {
  const tGround = d[1] < 0 ? -o[1] / d[1] : Infinity;
  let gx = Math.floor(o[0] / CELL), gz = Math.floor(o[2] / CELL);
  const sx = Math.sign(d[0]) || 1, sz = Math.sign(d[2]) || 1;
  let tmx = d[0] ? ((gx + (sx > 0 ? 1 : 0)) * CELL - o[0]) / d[0] : Infinity, tmz = d[2] ? ((gz + (sz > 0 ? 1 : 0)) * CELL - o[2]) / d[2] : Infinity;
  const tdx = d[0] ? (CELL / Math.abs(d[0])) : Infinity, tdz = d[2] ? (CELL / Math.abs(d[2])) : Infinity;
  let best = null, tCellEnd = Math.min(tmx, tmz);
  for (let step = 0; step < 80; step++) {
    const list = CELLS.get(gx + ',' + gz);
    if (list) for (const O of list) { const r = hitObj(O, o, d); if (r && r.t > 0 && (!best || r.t < best.t)) best = r; }
    if (best && best.t <= tCellEnd + 0.5) break; // objects may overhang a cell slightly
    if (tCellEnd > tGround) break;
    if (tmx < tmz) { gx += sx; tmx += tdx; } else { gz += sz; tmz += tdz; }
    tCellEnd = Math.min(tmx, tmz);
  }
  if (best && best.t < tGround) { const shade = best.n === 0 ? 0.8 : best.n === 2 ? 0.65 : 1; return { col: best.col.map((c) => c * shade), t: best.t }; }
  if (isFinite(tGround)) {
    const x = o[0] + tGround * d[0], z = o[2] + tGround * d[2];
    const fx = ((x % CELL) + CELL) % CELL, fz = ((z % CELL) + CELL) % CELL;
    const road = fx > 9.5 || fz < 1.4;
    let col = road ? [70, 70, 76] : [120, 150, 90];
    if (road && Math.abs(fx - 10.75) < 0.08) col = [230, 220, 160];
    return { col, t: tGround };
  }
  return { col: [150, 180, 220], t: 1e5 };
}
// facade for the shift demo
function castFacade(o, d) {
  if (d[2] <= 0) return [150, 180, 220];
  const t = (30 - o[2]) / d[2], x = o[0] + t * d[0], y = o[1] + t * d[1];
  if (y < 0) return [90, 90, 95];
  if (Math.abs(x) > 12 || y > 48) { const s = Math.min(1, Math.max(0, d[1])); return [150 - 60 * s, 185 - 50 * s, 230 - 20 * s]; }
  const fx = ((x + 12) % 3 + 3) % 3, fy = (y % 4 + 4) % 4;
  const win = fx > 0.7 && fx < 2.3 && fy > 1 && fy < 3.2;
  if (Math.abs(x) > 11.6 || Math.abs(x) < 0.25) return [120, 100, 90];
  return win ? [60 + y * 2, 90 + y * 2, 130 + y] : [214, 196, 170];
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Tilting the lens relative to the sensor swings the plane of sharp focus. Three planes then meet in one line (Scheimpflug), and the depth of field becomes a wedge. Tilt one way and a whole receding landscape is sharp. Tilt the other and a real city looks like a miniature model. Shifting the lens instead keeps the sensor parallel to a façade, so its verticals stay vertical.', domains: ['photo', 'video'] }));

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
  root.append(lab([photo.el, side.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let IMG = null;
  const camH = 30, camPitch = (-30 * Math.PI) / 180; // town camera: 26 m up (a rooftop), looking 28° down

  // tilted-thin-lens imaging in camera coordinates (y up, z forward); lens axis tilted by α about x
  function geom(st) {
    const f = st.f / 1000, a = (st.alpha * Math.PI) / 180;
    const nL = [0, Math.sin(a), Math.cos(a)]; // α > 0 tips the lens axis up: hinge above the lens (reverse tilt)
    // sensor at z = −v; after tilting, the photographer refocuses so the sensor centre stays
    // conjugate to distance s along the tilted axis: its distance to the lens plane, v·cos α, equals fs/(s−f)
    const s = st.s, v = (f * s) / (s - f) / Math.cos(a);
    return { f, a, nL, v, A: f / st.N };
  }
  function imageOf(G, p) {
    const u = p[1] * G.nL[1] + p[2] * G.nL[2];
    if (u <= G.f * 1.0001) return null;
    const up = (G.f * u) / (u - G.f), m = -up / u;
    const w = [p[0], p[1] - u * G.nL[1], p[2] - u * G.nL[2]];
    return [m * w[0], -up * G.nL[1] + m * w[1], -up * G.nL[2] + m * w[2]];
  }

  function renderTilt() {
    const st = ctl.state, G = geom(st);
    const W = 640, H = 427, sw = 0.036, sh = 0.024, F = st.f / 1000;
    const base = new Float32Array(W * H * 3), blur = new Float32Array(W * H);
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const o = [6, camH, -6];
    let minB = Infinity;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const xs = ((i + 0.5) / W - 0.5) * sw, ys = (0.5 - (j + 0.5) / H) * sh;
      const dc = [xs, ys, F], L = Math.hypot(...dc); dc[0] /= L; dc[1] /= L; dc[2] /= L;
      const dw = [dc[0], dc[1] * cp + dc[2] * sp, -dc[1] * sp + dc[2] * cp];
      const r = castTown(o, dw), k = j * W + i;
      base[k * 3] = r.col[0]; base[k * 3 + 1] = r.col[1]; base[k * 3 + 2] = r.col[2];
      // the hit point in camera coordinates is simply t·dc
      const p = [dc[0] * r.t, dc[1] * r.t, dc[2] * r.t];
      const q = imageOf(G, p);
      let c = 0.01;
      if (q) c = (G.A * Math.abs(q[2] + G.v)) / Math.abs(q[2]); // blur diameter on the sensor (m)
      else c = 0.01;
      const px = (c / sw) * W / 2; // radius in px
      blur[k] = Math.min(24, px);
      if (px < minB) minB = px;
    }
    // blur stack (Gaussian σ ≈ r/2 approximates the uniform disk's second moment), per-pixel blend
    const levels = [0, 0.7, 1.5, 2.5, 3.8, 5.5, 8, 11, 15, 19, 24];
    const src = imageCanvas(W, H);
    for (let k = 0; k < W * H; k++) { src.data[k * 4] = base[k * 3]; src.data[k * 4 + 1] = base[k * 3 + 1]; src.data[k * 4 + 2] = base[k * 3 + 2]; src.data[k * 4 + 3] = 255; }
    src.put();
    const stack = levels.map((r) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); if (r > 0) g.filter = `blur(${(r / 2).toFixed(2)}px)`;
      g.drawImage(src.c, 0, 0); return g.getImageData(0, 0, W, H).data;
    });
    const out = imageCanvas(W, H);
    for (let k = 0; k < W * H; k++) {
      const b = blur[k]; let li = 0; while (li < levels.length - 2 && levels[li + 1] < b) li++;
      const t = Math.min(1, Math.max(0, (b - levels[li]) / (levels[li + 1] - levels[li])));
      for (let ch = 0; ch < 3; ch++) out.data[k * 4 + ch] = stack[li][k * 4 + ch] * (1 - t) + stack[li + 1][k * 4 + ch] * t;
      // miniature look: a touch of saturation and contrast
      out.data[k * 4 + 3] = 255;
    }
    out.put();
    return out.c;
  }

  function renderShift() {
    const st = ctl.state, W = 300, H = 200, sw = 36, sh = 24, F = 24;
    const ic = imageCanvas(W, H), p = (st.pitch * Math.PI) / 180, cp = Math.cos(p), sp = Math.sin(p);
    const o = [0, 1.6, 0];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      // portrait-orientation sensor; shift moves the sensor window up within the image circle
      const xs = ((i + 0.5) / W - 0.5) * sh * 1.5, ys = (0.5 - (j + 0.5) / H) * sw * (2 / 3) + st.shift;
      const d = [xs, ys, F], L = Math.hypot(...d);
      const dc = [d[0] / L, d[1] / L, d[2] / L];
      const dw = [dc[0], dc[1] * cp + dc[2] * sp, -dc[1] * sp + dc[2] * cp];
      const c = castFacade(o, dw), k = (j * W + i) * 4;
      ic.data[k] = c[0]; ic.data[k + 1] = c[1]; ic.data[k + 2] = c[2]; ic.data[k + 3] = 255;
    }
    ic.put(); return ic.c;
  }

  function update() {
    const st = ctl.state;
    IMG = st.mode === 'tilt' ? renderTilt() : renderShift();
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
    calc.set(String.raw`\begin{aligned}
    &\text{Scheimpflug: sensor} \cap \text{lens plane} \cap \text{PoF} = \text{one line}\\
    &\text{Hinge rule: } J = \frac{f}{\sin\alpha} = \frac{${texNum(st.f, 3)}\,\text{mm}}{\sin ${texNum(Math.abs(st.alpha), 2)}^\circ} = ${isFinite(J) ? texNum(J, 3) + '\\,\\text{m}' : '\\infty'}\\
    &\frac{1}{u} + \frac{1}{u'} = \frac{1}{f}\ \text{along the tilted lens axis}
    \end{aligned}`);
    photo.redraw(); side.redraw();
  }

  // plane of focus in the y–z (side) plane: image two sensor points back into object space
  function objOf(G, q) { // inverse thin-lens mapping (same law, image ↔ object)
    const up = -(q[1] * G.nL[1] + q[2] * G.nL[2]);
    if (up <= G.f * 1.0001) return null;
    const u = (G.f * up) / (up - G.f), m = -u / up;
    const w = [0, q[1] + up * G.nL[1], q[2] + up * G.nL[2]];
    return [0, u * G.nL[1] + m * w[1], u * G.nL[2] + m * w[2]];
  }
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
      ctx.fillText('dashed: 64 mm image circle of a shift lens', cx + 34 * S, cy - 10);
      ctx.fillStyle = '#6ad7ff'; ctx.fillText('blue: centred sensor', cx + 34 * S, cy + 8);
      ctx.fillStyle = '#ffb547'; ctx.fillText(`amber: sensor window after ${st.shift} mm rise`, cx + 34 * S, cy + 26);
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
    ctx.fillText('sensor', Xi(-G.v), Yi(0.012) - 6); ctx.fillStyle = '#6ad7ff'; ctx.fillText(`lens (α = ${st.alpha}°)`, lensX, Yi(lp) - 6);
    ctx.textAlign = 'left'; ctx.fillStyle = '#6be3a4'; ctx.fillText('plane of focus + DoF wedge', lensX + 60, 18);
    ctx.fillStyle = '#ffb547'; ctx.fillText('ground', w - 60, Math.min(hh - 8, Yo(-camH / Math.cos(camPitch) + 400 * Math.tan(-camPitch)) + 14));
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('image space: true scale · object space: log distance', 10, hh - 8);
  }

  update();

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
<p>The near and far depth-of-field limits are the conjugates of planes parallel to the sensor at \(\pm Nc\). They too pass through the hinge line, so depth of field becomes a wedge opening away from the camera, drawn shaded green in the side view. Reverse tilt sets the plane of focus nearly perpendicular to the ground. Only a narrow band of a receding scene stays sharp. Because we associate such shallow depth of field with close-up photographs of small objects, the brain reads the scene as a <em>miniature</em>. The render computes each pixel's true defocus through the tilted lens, then blends a stack of blurred images.</p>
<h3>Shift and keystoning</h3>
<p>Pointing a camera upward tilts the sensor relative to a building façade. Its verticals then converge to a vanishing point, the keystone effect. Keeping the camera level keeps the sensor parallel to the façade, so verticals stay parallel. A <strong>shift</strong> lens then slides the sensor window up inside a larger image circle (around 60–80 mm for full-frame shift lenses) to include the top of the building. Raising the shift slider here at zero pitch frames the façade without any convergence. Architectural photography, and every view camera since the 19th century, depends on this.</p>
</div></div>`));
  root.append(references([
    'T. Scheimpflug, GB Patent 1196 (1904).',
    'H. M. Merklinger, <i>Focusing the View Camera</i> (1996): the hinge rule.',
    'L. Larmore, <i>Introduction to Photographic Principles</i>, Dover (1965), ch. 7.',
  ]));
  return () => [photo, side].forEach((s) => s.destroy());
}
