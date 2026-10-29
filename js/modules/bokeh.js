import { h, controls, stage, readouts, debounce, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { LENSES, autoSemiDiameters, stopIndex, hasMirrors } from '../lib/raytrace.js';
import { linspace } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { view3d } from '../lib/gl3d.js';
import { t, N_ } from '../lib/i18n.js';

const K = 112; // kernel resolution (px)
const PALETTE = [[255, 196, 120], [255, 150, 90], [140, 200, 255], [255, 230, 190], [190, 160, 255], [255, 255, 255]];
const LAMS = linspace(420, 680, 8);
const GRID = [-1, 0, 1]; // traced kernels: 3 × 3 field positions (image heights ±16 mm, ±10.7 mm)

// Colour kernel from the traced lens (linear RGB, K×K) → canvas tinted by the light's colour.
function rgbKernelCanvas(k, tint, gain) {
  const n = k.K, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), im = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    for (let ch = 0; ch < 3; ch++) im.data[i * 4 + ch] = Math.min(255, k.rgb[i * 3 + ch] * gain * tint[ch]);
    im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
// Luminance statistics of a traced kernel about its centroid: radius from the second moment
// (uniform disk: <r²> = R²/2), mean luminance in the centre (r < 0.4 R) and on the rim (0.8–0.98 R).
function kernelStats(k) {
  const n = k.K, L = new Float64Array(n * n);
  let s = 0, sx = 0, sy = 0, sr = 0;
  for (let i = 0; i < n * n; i++) { L[i] = 0.2126 * k.rgb[i * 3] + 0.7152 * k.rgb[i * 3 + 1] + 0.0722 * k.rgb[i * 3 + 2]; s += L[i]; sx += L[i] * (i % n); sy += L[i] * Math.floor(i / n); }
  const cx = sx / s, cy = sy / s;
  for (let i = 0; i < n * n; i++) sr += L[i] * ((i % n - cx) ** 2 + (Math.floor(i / n) - cy) ** 2);
  const R = Math.sqrt((2 * sr) / s), m = [0, 0], c = [0, 0];
  for (let i = 0; i < n * n; i++) {
    const r = Math.hypot(i % n - cx, Math.floor(i / n) - cy) / R;
    if (r < 0.4) { m[0] += L[i]; c[0]++; } else if (r >= 0.8 && r < 0.98) { m[1] += L[i]; c[1]++; }
  }
  return { L, cx, cy, Rpx: R, Dmm: (2 * R * k.mmW) / n, centre: m[0] / c[0], rim: m[1] / c[1] };
}

// Build a defocus kernel by forward-splatting a dense pupil grid.
// side = +1 behind the focal plane (background), −1 in front (foreground).
// field = [fx, fy] normalised image position (corner ≈ 1.2).
function kernel(P, side, field) {
  const img = new Float32Array(K * K);
  const G = 150;
  const sector = (2 * Math.PI) / Math.max(3, P.blades);
  const cp = Math.cos(Math.PI / Math.max(3, P.blades));
  const iris = Math.pow(2, -P.stop / 2); // iris circumradius relative to the full pupil
  const fr = Math.hypot(field[0], field[1]);
  const ux = fr ? field[0] / fr : 1, uy = fr ? field[1] / fr : 0;
  const vshift = P.vig * fr * 1.1; // offset of the vignetting (barrel) circle, pupil units
  // radial transverse-aberration polynomial: r(ρ) = ρ + s ρ³ (+ ripple). Sign convention: P.sa < 0 is
  // under-corrected (marginal focus nearer the lens). Behind focus the cone has already crossed, so the
  // marginal rays spread further (s > 0, soft edge); in front of focus they bunch up (s < 0, bright rim).
  const s = -P.sa * side;
  const orient = side > 0 ? -1 : 1; // background disks are inverted images of the pupil
  const scale = 1 / (1 + Math.max(0, s) + P.ripple * 0.05) * 0.46; // keep kernel inside the canvas
  let total = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = ((i + 0.5) / G) * 2 - 1, y = ((j + 0.5) / G) * 2 - 1;
    const rho = Math.hypot(x, y);
    if (rho > 1) continue;
    // aperture: polygon iris (with blade curvature) ∩ circular full aperture
    if (P.blades >= 3) {
      let ph = Math.atan2(y, x) - P.rot;
      ph = ((ph % sector) + sector) % sector - sector / 2;
      const rp = (cp / Math.cos(ph)) * (1 - P.round) + P.round;
      if (rho > Math.min(1, iris * rp)) continue;
    } else if (rho > Math.min(1, iris)) continue;
    if (rho < P.obs * Math.min(1, iris)) continue;
    // mechanical vignetting: the barrel window seen off-axis (cat's eye)
    if (Math.hypot(x - ux * vshift, y - uy * vshift) > 1.0) continue;
    let w = 1;
    if (P.apod) w = Math.exp(-((rho / Math.min(1, iris)) ** 2) * 2.2);
    const rn = rho / Math.min(1, iris);
    let r = rn + s * rn * rn * rn + P.ripple * 0.012 * Math.sin(2 * Math.PI * 9 * rn * rn);
    const ang = Math.atan2(y, x);
    const X = K / 2 + orient * Math.cos(ang) * r * scale * K;
    const Y = K / 2 - orient * Math.sin(ang) * r * scale * K;
    const xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
    if (xi < 0 || yi < 0 || xi >= K - 1 || yi >= K - 1) continue;
    img[yi * K + xi] += w * (1 - fx) * (1 - fy); img[yi * K + xi + 1] += w * fx * (1 - fy);
    img[(yi + 1) * K + xi] += w * (1 - fx) * fy; img[(yi + 1) * K + xi + 1] += w * fx * fy;
    total += w;
  }
  // light 3×3 smoothing (finite sampling), normalise peak
  const out = new Float32Array(K * K);
  let mx = 0;
  for (let y = 1; y < K - 1; y++) for (let x = 1; x < K - 1; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += img[(y + dy) * K + x + dx] * (dx || dy ? (dx && dy ? 0.06 : 0.12) : 0.28);
    out[y * K + x] = v; if (v > mx) mx = v;
  }
  return { data: out, mx, total };
}

function kernelCanvas(k, rgb, gain = 1) {
  const c = document.createElement('canvas'); c.width = c.height = K;
  const g = c.getContext('2d'), im = g.createImageData(K, K);
  for (let i = 0; i < K * K; i++) {
    const v = Math.min(1, (k.data[i] / k.mx) * gain);
    im.data[i * 4] = rgb[0]; im.data[i * 4 + 1] = rgb[1]; im.data[i * 4 + 2] = rgb[2]; im.data[i * 4 + 3] = v * 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Out-of-focus points of light, such as street lamps behind a portrait, turn into discs. Each disc is a small picture of the lens opening itself, which is why every lens has its own "bokeh".</p>
<p>The iris blades give the discs their outline, round or polygonal. The lens barrel clips them into cat's eyes near the edges of the frame. And small lens errors decide whether a disc is evenly lit, has a bright rim like a soap bubble, or fades softly from a bright centre, which is what photographers usually call "creamy" bokeh.</p>`, [
    "Set <strong>Iris blades</strong> to 6 and stop down 2 EV: the discs become hexagons. Raise <strong>Blade roundness</strong> to make them round again.",
    "Compare the discs at the centre and in the corners: the barrel cuts the corner ones into cat's eyes. Stop down and they turn round.",
    "Switch the <strong>Model</strong> to phenomenological and move <strong>Spherical aberration</strong> from one side to the other: background discs swap a bright rim for a soft edge.",
  ]));

  const traced = (s) => s.model === 'traced', pheno = (s) => s.model !== 'traced';
  const ctl = controls({
    model: { type: 'select', label: 'Model', value: 'traced', options: [['traced', 'Traced lens: real rays through a prescription'], ['pheno', 'Phenomenological: pupil + aberration sliders']] },
    lens: { type: 'select', label: 'Lens', value: 'double-gauss', options: Object.entries(LENSES).filter(([, l]) => !hasMirrors(l)).map(([k, l]) => [k, l.name]), when: traced },
    focus: { type: 'range', label: 'Focus distance', min: 300, max: 20000, log: true, value: 1500, fmt: (v) => (v / 1000).toFixed(2) + ' m', when: traced },
    barrel: { type: 'range', label: 'Barrel clear apertures (cat\'s eye)', min: 0, max: 0.4, step: 0.01, value: 0.3, fmt: (v) => '−' + (v * 100).toFixed(0) + ' %', when: traced },
    blades: { type: 'range', label: 'Iris blades (0 = circular)', min: 0, max: 15, step: 1, value: 9, fmt: (v) => (v < 3 ? 'circular' : v) },
    round: { type: 'range', label: 'Blade roundness', min: 0, max: 1, step: 0.01, value: 0.55, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    stop: { type: 'range', label: 'Stopped down from wide open', min: 0, max: 4, step: 0.05, value: 0.6, fmt: (v) => v.toFixed(1) + ' EV' },
    vig: { type: 'range', label: 'Mechanical vignetting (cat\'s eye)', min: 0, max: 0.8, step: 0.01, value: 0.42, when: pheno },
    sa: { type: 'range', label: 'Spherical aberration (under ← → over)', min: -0.45, max: 0.45, step: 0.005, value: 0.2, when: pheno },
    ripple: { type: 'range', label: 'Asphere polishing ripple ("onion rings")', min: 0, max: 1, step: 0.01, value: 0, when: pheno },
    obs: { type: 'range', label: 'Central obstruction (mirror lens)', min: 0, max: 0.6, step: 0.01, value: 0, when: pheno },
    apod: { type: 'toggle', label: 'Apodisation filter (STF / smooth trans focus)', value: false, when: pheno },
    blur: { type: 'range', label: 'Background blur size', min: 10, max: 120, step: 1, value: 64, unit: 'px', when: pheno },
  }, () => recompute());
  const ro = h('div');
  const note = h('div.note', { role: 'status' });
  const calc = liveCalc();
  const scene = stage({ aspect: 1.6, label: 'Night scene: background behind focus, a few lights in front', draw: drawScene, minH: 300 });
  const close = stage({ aspect: 4, label: 'Kernels: centre behind · centre in front · edge behind · corner behind', draw: drawClose, minH: 140 });
  const prof = stage({ aspect: 2.6, label: '', draw: drawProf, cls: 'plain', minH: 200 });
  // small disks: the diffraction PSF of the traced, defocused pupil
  const dctl = controls({ w020: { type: 'range', label: 'Defocus W₀₂₀ of a small disk', min: 0.25, max: 12, step: 0.05, value: 2.5, unit: 'waves' } }, () => recomputeDiff());
  const dview = stage({ aspect: 2.4, label: 'Diffraction PSF', draw: drawDiff, minH: 220 });
  const dnote = h('div.note', { role: 'status' });
  const diffCard = h('div.card', {}, h('h3', {}, 'Small disks: diffraction'), dctl.el, dview.el, dnote);
  const v3 = view3d({ label: '3-D: real rays from two background points through the iris and the barrel, and where they land on the sensor', aspect: 2.2, minH: 240, yaw: -0.5, pitch: 0.28 });
  root.append(lab([scene.el, note, close.el, v3.el, h('div.card', { style: { padding: '6px' } }, prof.el), diffCard], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // deterministic set of lights
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const LIGHTS = [];
  for (let i = 0; i < 70; i++) LIGHTS.push({ x: rnd(), y: 0.08 + 0.75 * rnd() ** 1.3, size: 0.6 + 0.6 * rnd(), col: Math.floor(rnd() * 5), side: 1, b: 0.6 + 0.4 * rnd() });
  for (let i = 0; i < 7; i++) LIGHTS.push({ x: rnd(), y: 0.7 + 0.28 * rnd(), size: 0.7 + 0.4 * rnd(), col: Math.floor(rnd() * 5), side: -1, b: 1 });

  let KS = null, TK = null;
  const grid = [-1, -0.5, 0, 0.5, 1];
  const bokehJob = latest('bokeh'), scene3dJob = latest('bokeh3d'), sdCache = new Map();
  let lens3d = '';
  let alive = true;
  // Traced lens: 18 kernels (background at ∞, foreground at half the focus distance; 3 × 3 field
  // positions) from the worker; brightness is physical within each side.
  function recomputeTraced(st) {
    const lens = LENSES[st.lens], si = stopIndex(lens);
    if (!sdCache.has(st.lens)) sdCache.set(st.lens, autoSemiDiameters(lens));
    const sd = sdCache.get(st.lens).map((v, k) => (k === si ? v : v * (1 - st.barrel)));
    const fields = GRID.flatMap((fy) => GRID.map((fx) => [fx * 16, fy * 10.7]));
    // 3-D (in the worker): the camera stays put while the lens stays the same
    scene3dJob('bokehScene3d', { lens, sd, focus: st.focus, stop: st.stop, blades: st.blades < 3 ? 0 : st.blades, round: st.round }).then((sc) => {
      if (!alive) return;
      v3.setScene(sc, lens3d === st.lens);
      lens3d = st.lens;
    }, () => {});
    note.textContent = t('Tracing rays through the lens for 18 kernels…');
    const t0 = performance.now();
    bokehJob('bokehTraced', { lens, sd, lambdas: LAMS, focus: st.focus, near: st.focus / 2, stop: st.stop, blades: st.blades < 3 ? 0 : st.blades, round: st.round, fields, K, grid: 36 }).then((r) => {
      if (!alive) return;
      const ks = r.kernels.map((k) => ({ ...k, K, st: kernelStats({ ...k, K }) }));
      const pick = (side, fx, fy) => ks.find((k) => k.side === side && k.field[0] === fx * 16 && k.field[1] === fy * 10.7);
      const gain = {};
      // display scale per side: the centre of the on-axis kernel at 60 % white
      for (const side of ['bg', 'fg']) gain[side] = (0.6 * 255) / Math.max(1e-30, pick(side, 0, 0).st.centre);
      ks.forEach((k) => { k.cv = PALETTE.map((c) => rgbKernelCanvas(k, c.map((v) => v / 255), gain[k.side])); });
      TK = { r, ks, pick, st: { ...st }, ms: performance.now() - t0 };
      updateTraced();
      scene.redraw(); close.redraw(); prof.redraw();
    }, (e) => { note.textContent = t('Ray tracing failed: {msg}', { msg: e.message }); });
  }
  function updateTraced() {
    const { r, pick, st, ms } = TK, lens = LENSES[st.lens];
    const b0 = pick('bg', 0, 0), f0 = pick('fg', 0, 0), bc = pick('bg', 1, 1);
    const f = r.efl, N = r.fnum, s = st.focus, cThin = (f * f) / (N * (s - f));
    note.textContent = t('Traced: 18 kernels × {n} wavelengths through the {lens} in {s} s. Background lights at infinity, foreground lights at {near} m.', { n: LAMS.length, lens: lens.name.split(' (')[0], s: (ms / 1000).toFixed(1), near: (s / 2000).toFixed(2) });
    const rc = (k) => k.st.rim / k.st.centre;
    const look = (q) => t(q > 1.08 ? N_('bright rim') : q < 0.92 ? N_('soft edge, bright centre') : N_('nearly uniform'));
    ro.replaceChildren(readouts([
      ['Lens', lens.name.split(' (')[0]],
      ['Working f-number', 'f/' + N.toFixed(1)],
      ['Sensor shift from ∞ focus', (r.zs - r.zInf).toFixed(2) + ' mm'],
      ['Background disk Ø (traced)', b0.st.Dmm.toFixed(2) + ' mm'],
      ['Thin-lens prediction f²/(N(s−f))', cThin.toFixed(2) + ' mm'],
      ['Background rim / centre', rc(b0).toFixed(2) + ' (' + look(rc(b0)) + ')'],
      ['Foreground rim / centre', rc(f0).toFixed(2) + ' (' + look(rc(f0)) + ')'],
      ['Corner kernel flux', t('{p} % of centre', { p: ((bc.flux / b0.flux) * 100).toFixed(0) })],
    ]));
    calc.say(t('A point at infinity behind the subject becomes a disc <strong>{Dmm} mm</strong> wide on the sensor (the thin-lens estimate gives {cThin} mm), and its rim is {rc} times as bright as its centre: {look}.', { Dmm: b0.st.Dmm.toFixed(2), cThin: cThin.toFixed(2), rc: rc(b0).toFixed(2), look: look(rc(b0)) }));
    calc.set(String.raw`\begin{aligned}
    c &= \frac{f^2}{N(s-f)} = \frac{${texNum(f, 3)}^2}{${texNum(N, 2)}\,(${texNum(s, 4)} - ${texNum(f, 3)})} = ${texNum(cThin, 3)}\ \text{mm}\\
    \Delta z &= z_s - z_\infty = ${texNum(r.zs - r.zInf, 3)}\ \text{mm}\\
    D_\text{traced} &= 2\sqrt{2\langle r^2\rangle} = ${texNum(b0.st.Dmm, 3)}\ \text{mm}\\
    E(\mathbf x) &= \textstyle\sum_\triangle \Phi_\triangle/A_\triangle\ \ (\mathbf x\in\triangle)
    \end{aligned}`);
    const row = (k) => { const n = K, y = Math.round(k.st.cy), mx = Math.max(...k.st.L); return range(0, n - 1, n).map((x) => [(x - k.st.cx) / k.st.Rpx, k.st.L[y * n + x] / mx]); };
    KS = { ...(KS || {}), prof: { b: row(b0), f: row(f0) } };
  }
  const recompute = debounce(() => {
    const st = ctl.state;
    diffCard.hidden = st.model !== 'traced';
    v3.el.hidden = st.model !== 'traced';
    if (st.model === 'traced') { recomputeTraced(st); recomputeDiff(); return; }
    TK = null;
    note.textContent = t('Phenomenological model: the pupil outline and a cubic transverse aberration set by the sliders.');
    const P = { blades: st.blades < 3 ? 0 : st.blades, round: st.round, stop: st.stop, vig: st.vig, sa: st.sa, ripple: st.ripple, obs: st.obs, apod: st.apod, rot: Math.PI / 2 };
    const cache = new Map();
    const get = (side, fx, fy) => {
      const key = side + ':' + fx + ':' + fy;
      if (!cache.has(key)) {
        const k = kernel(P, side, [fx * 1.2, fy * 0.8]);
        cache.set(key, { k, cv: PALETTE.map((c) => kernelCanvas(k, c, 1.15)) });
      }
      return cache.get(key);
    };
    KS = { P, get, st: { ...st } };
    // radial profile of an on-axis background kernel (centre row)
    const kb = get(1, 0, 0).k, kf = get(-1, 0, 0).k;
    const row = (k) => range(0, K - 1, K).map((x) => [(x - K / 2) / (K * 0.46), k.data[Math.round(K / 2) * K + x] / k.mx]);
    KS.prof = { b: row(kb), f: row(kf) };
    const iris = Math.pow(2, -st.stop / 2);
    ro.replaceChildren(readouts([
      ['Iris shape', st.blades < 3 ? t('circular') : t('{n} blades, {p} % rounded', { n: st.blades, p: (st.round * 100).toFixed(0) })],
      ['Iris / full aperture diameter', (iris * 100).toFixed(0) + ' %'],
      ['Wide-open edge kernel open area', t('{p} % of centre', { p: (get(1, 1, 1).k.total / get(1, 0, 0).k.total * 100).toFixed(0) })],
      ['Background disk', t(st.sa > 0 ? N_('bright rim (soap bubble)') : st.sa < 0 ? N_('soft edge, bright centre') : N_('uniform'))],
      ['Foreground disk', t(st.sa > 0 ? N_('soft edge, bright centre') : st.sa < 0 ? N_('bright rim') : N_('uniform'))],
    ]));
    calc.say(t('{bg}, and {fg}.', { bg: st.sa > 0 ? t('Background discs have a bright rim, like soap bubbles') : st.sa < 0 ? t('Background discs have a soft edge and a bright centre') : t('Background discs are evenly lit'), fg: st.sa > 0 ? t('foreground discs have a soft edge and a bright centre') : st.sa < 0 ? t('foreground discs have a bright rim') : t('foreground discs are evenly lit') }) + ' '
      + (st.blades >= 3 ? t('The iris is open to <strong>{p} %</strong> of the full aperture, so the discs take the shape of its {n} blades.', { p: (iris * 100).toFixed(0), n: st.blades }) : t('The iris is open to <strong>{p} %</strong> of the full aperture.', { p: (iris * 100).toFixed(0) })));
    calc.set(String.raw`\begin{aligned}
    r(\rho) &= c\,(\rho + s\rho^3)\\
    s_\text{bg} &= -2W_{040}/|W_{020}| = ${texNum(-st.sa, 3)}\\
    \frac{I(r)}{I_0} &= \frac{\rho}{r\,|dr/d\rho|} = \frac{1}{(1+s\rho^2)(1+3s\rho^2)}\\
    \text{bg edge/centre} &= ${1 - 3 * st.sa > 0 ? texNum(1 / ((1 - st.sa) * (1 - 3 * st.sa)), 3) : '\\infty\\ (\\text{caustic})'}
    \end{aligned}`);
    scene.redraw(); close.redraw(); prof.redraw();
  }, 40);

  function drawScene(ctx, w, hh) {
    const bg = ctx.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#04050b'); bg.addColorStop(0.7, '#0d0a14'); bg.addColorStop(1, '#170e10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, hh);
    if (ctl.state.model === 'traced') {
      if (!TK) return;
      ctx.globalCompositeOperation = 'lighter';
      for (const L of LIGHTS) {
        const fx = (L.x - 0.5) * 2, fy = (0.5 - L.y) * 2;
        const near = (v) => GRID.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
        const k = TK.pick(L.side < 0 ? 'fg' : 'bg', near(fx), near(fy));
        const D = (k.mmW * w) / 36; // the scene spans the 36 mm sensor width: kernels at physical size
        ctx.globalAlpha = L.b;
        ctx.drawImage(k.cv[L.col], L.x * w - D / 2, L.y * hh - D / 2, D, D);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (ctl.state.model === 'traced' || !KS || !KS.get) { drawSubject(ctx, w, hh); return; }
    const st = KS.st, iris = Math.pow(2, -st.stop / 2);
    ctx.globalCompositeOperation = 'lighter';
    for (const L of LIGHTS) {
      const fx = (L.x - 0.5) * 2, fy = (0.5 - L.y) * 2;
      const gx = grid.reduce((a, b) => (Math.abs(b - fx) < Math.abs(a - fx) ? b : a)), gy = grid.reduce((a, b) => (Math.abs(b - fy) < Math.abs(a - fy) ? b : a));
      const { cv, k } = KS.get(L.side, gx, gy);
      const D = st.blur * L.size * iris * (L.side < 0 ? 1.4 : 1) / 0.92; // kernel canvas spans ~1/0.92 of the disk
      // energy conservation: brightness ∝ 1/area, with a display gain
      const a = Math.min(1, (2000 / (D * D)) * L.b * (k.total / KS.get(1, 0, 0).k.total) + 0.08);
      ctx.globalAlpha = a;
      ctx.drawImage(cv[L.col], L.x * w - D / 2, L.y * hh - D / 2, D, D);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawSubject(ctx, w, hh);
  }
  function drawSubject(ctx, w, hh) {
    // in-focus subject silhouette
    ctx.fillStyle = '#020203';
    ctx.beginPath(); ctx.ellipse(w * 0.5, hh * 0.62, w * 0.07, hh * 0.13, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.36, hh); ctx.quadraticCurveTo(w * 0.5, hh * 0.62, w * 0.64, hh); ctx.fill();
  }

  function drawClose(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const side = Math.min(hh - 26, w / 4 - 12);
    if (ctl.state.model === 'traced') {
      if (!TK) return;
      // neutral white light, common scale: the relative sizes are physical
      const ks = [TK.pick('bg', 0, 0), TK.pick('fg', 0, 0), TK.pick('bg', 1, 0), TK.pick('bg', 1, 1)], big = Math.max(...ks.map((k) => k.mmW));
      ctx.globalCompositeOperation = 'lighter';
      ks.forEach((k, i) => { const d = (side * k.mmW) / big; ctx.drawImage(k.cv[5], (w / 4) * i + (w / 4 - d) / 2, 22 + (side - d) / 2, d, d); });
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (!KS || !KS.get) return;
    const items = [[1, 0, 0], [-1, 0, 0], [1, 1, 0], [1, 1, 1]];
    items.forEach(([s, fx, fy], i) => {
      const { cv } = KS.get(s, fx, fy);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(cv[3], (w / 4) * i + (w / 4 - side) / 2, 22, side, side);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  // Diffraction of a small defocused disk (worker task defocusPSF) for the current lens and stop.
  const diffJob = latest('bokehDiff');
  let DF = null;
  const recomputeDiff = debounce(() => {
    const st = ctl.state;
    if (st.model !== 'traced') return;
    const base = LENSES[st.lens], lens = { ...base, epd: base.epd * Math.pow(2, -st.stop / 2) };
    if (!sdCache.has(st.lens)) sdCache.set(st.lens, autoSemiDiameters(base));
    dnote.textContent = t('Computing the defocused diffraction PSF…');
    diffJob('defocusPSF', { lens, sd: sdCache.get(st.lens), w020: dctl.state.w020, lambdas: linspace(450, 650, 5), ref: 550 }).then((r) => {
      if (!alive || !r) return;
      const n = r.n, img = document.createElement('canvas');
      img.width = img.height = n;
      const g = img.getContext('2d'), im = g.createImageData(n, n);
      let mx = 0; for (let k = 0; k < n * n; k++) mx = Math.max(mx, r.rgb[k * 3 + 1]);
      for (let k = 0; k < n * n; k++) {
        for (let c = 0; c < 3; c++) im.data[k * 4 + c] = Math.min(255, 255 * Math.pow(Math.max(0, r.rgb[k * 3 + c] / mx), 1 / 2.2));
        im.data[k * 4 + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      DF = { ...r, img, w020: dctl.state.w020 };
      const airy = 2.44 * 550e-6 * r.N, Dgeo = 2 * r.Rgeo * r.du, sinc = Math.sin(Math.PI * DF.w020) / (Math.PI * DF.w020);
      dnote.textContent = t('Geometric disk Ø {d} µm = {airy} Airy diameters (f/{N}, sensor moved {dz} µm). Centre intensity I(0)/I₀ = {c}; pure defocus predicts sinc²(W₀₂₀/λ) = {p}.', { d: (Dgeo * 1000).toFixed(1), airy: (Dgeo / airy).toFixed(1), N: r.N.toFixed(1), dz: (r.dz * 1000).toFixed(0), c: r.centre.toFixed(3), p: (sinc * sinc).toFixed(3) });
      dview.redraw();
    }, (e) => { dnote.textContent = t('Diffraction PSF failed: {msg}', { msg: e.message }); });
  }, 60);

  function drawDiff(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!DF) return;
    // left: the PSF, cropped to 1.5 geometric radii (at least 12 px)
    const half = Math.min(DF.n / 2, Math.max(12, DF.Rgeo * 1.5)), side = Math.min(hh - 30, w * 0.38);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(DF.img, DF.n / 2 - half, DF.n / 2 - half, 2 * half, 2 * half, 12, 24, side, side);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(12 + side / 2, 24 + side / 2, (DF.Rgeo / half) * (side / 2), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    // right: radial profiles in µm, normalised to the geometric disk's uniform irradiance
    const geo = 1 / (Math.PI * Math.max(DF.Rgeo, 0.5) ** 2), um = DF.du * 1000, rmax = half * um;
    const series = (arr, color, label, width = 1.8) => ({ data: Array.from(arr, (v, b) => [b * DF.binPx * um, v / geo]).filter(([x]) => x <= rmax), color, width, label });
    const ox = side + 30;
    ctx.save(); ctx.translate(ox, 0);
    plot(ctx, w - ox, hh, {
      title: 'Radial profile, normalised to the geometric disk', x: { min: 0, max: rmax, label: 'radius on the sensor (µm)' }, y: { min: 0, max: 3, label: 'irradiance / geometric' },
      series: [
        { data: [[0, 1], [DF.Rgeo * um, 1], [DF.Rgeo * um, 0], [rmax, 0]], color: 'rgba(255,255,255,0.55)', width: 1.2, dash: [4, 3], label: 'geometric disk' },
        series(DF.pure, 'rgba(193,140,255,0.8)', 'pure defocus, 550 nm', 1.3), series(DF.prof, '#6ad7ff', 'this lens, 550 nm'), series(DF.poly, '#ffb547', 'this lens, 450–650 nm'),
      ],
      legend: true, legendX: w - ox - 175,
    });
    ctx.restore();
  }

  function drawProf(ctx, w, hh) {
    if (!KS) return;
    plot(ctx, w, hh, {
      title: 'Intensity across the bokeh disk (horizontal cut, on axis)', x: { min: -1.15, max: 1.15, label: 'normalised radius' }, y: { min: 0, max: 1.05, label: 'relative intensity' },
      series: [{ data: KS.prof.b, color: '#ffb547', width: 2, label: 'background (behind focus)' }, { data: KS.prof.f, color: '#6ad7ff', width: 2, label: 'foreground (in front)' }],
      legend: true, legendX: w - 230,
    });
  }

  recompute();

  root.append(rule(String.raw`\[c = \frac{f^2}{N\,(s-f)}\]
<p>With the lens focused at distance \(s\), a point at infinity becomes a disc of diameter \(c\) on the sensor. An 85 mm lens at f/1.8 focused at 2 m gives \(85^2/(1.8 \times 1915) = 2.1\) mm, 70 times the 0.03 mm that still counts as sharp. The disc grows with the square of the focal length and shrinks with the f-number and the focus distance.</p>`,
    String.raw`It gives the thin-lens disc for a point at infinity; nearer background points make smaller discs. The outline and the brightness inside the disc come from the iris, vignetting and aberrations, which only a ray trace or a pupil model like the ones above can predict.`));
  root.append(theory('The anatomy of a blur disk', String.raw`
<div class="theory-cols"><div>
<h3>Geometry: the disk is an image of the pupil</h3>
<p>A point far from the focal plane forms a cone of rays that the sensor cuts through. Within geometrical optics the illuminated patch is the exit pupil scaled by \(c/D_{XP}\), where \(c\) is the defocus blur diameter from <a href="#/dof">depth of field</a>. Every feature of the pupil therefore appears in the bokeh:</p>
<ul>
<li><strong>Iris blades.</strong> The polygon of \(n\) straight blades, or a smoother curve when the blades are curved. Many modern lenses use 9–11 rounded blades so the opening stays close to circular for the first 1–2 stops.</li>
<li><strong>Mechanical vignetting.</strong> Off axis, the front and rear barrel rims clip the oblique bundle. Their projections form a lens-shaped intersection of circles: the cat's eye. Its long axis is tangential, so cat's eyes across the frame form the "swirl" of Petzval and Helios lenses. Stopping down shrinks the iris inside the barrel window and the cat's eye disappears.</li>
<li><strong>Central obstruction.</strong> Catadioptric (mirror) lenses have an annular pupil, which gives donut bokeh.</li>
</ul>
<h3>Photometry: the inner brightness</h3>
<p>Without aberration, rays from equal pupil areas land on equal sensor areas, so the disk is uniformly bright. Spherical aberration adds a transverse error \(\propto \rho^3\). With defocus, the landing radius becomes</p>
\[r(\rho) = c\left(\rho + s\rho^3\right),\qquad s = \frac{2W_{040}}{W_{020}},\]
<p>and conservation of energy (\(I\,r\,dr = I_0\,\rho\,d\rho\)) gives</p>
\[\frac{I(r)}{I_0} = \frac{1}{(1+s\rho^2)(1+3s\rho^2)}.\]
</div><div>
<h3>Why foreground and background differ</h3>
<p>\(W_{020}\) changes sign on passing through focus, but \(W_{040}\) does not. Hence \(s\) flips sign. In an <em>under-corrected</em> lens the marginal rays focus closer to the lens than the paraxial ones. Behind focus they have already crossed and spread wider, so the background disk has a soft edge and bright centre, while the foreground disk gets a hard bright rim. Over-correction reverses the two and gives the "soap-bubble" backgrounds of the Meyer Trioplan. Many portrait lenses are deliberately left slightly under-corrected for creamy backgrounds; Nikon's Defocus-Control lenses let the photographer choose the sign. When \(1+3s\rho^2\) reaches zero, rays fold over and a caustic ring of very high intensity forms. The ray-splatting renderer captures this exactly, because it maps pupil samples forward instead of inverting \(r(\rho)\).</p>
<h3>Onion rings and apodisation</h3>
<p>Moulded or ground aspheric surfaces carry small periodic figure errors from the tool path. A ripple \(\delta W\propto\sin(k\rho^2)\) produces a slope error that modulates the ray density into concentric rings: "onion-ring" bokeh. An apodisation element, a radially graded neutral-density filter (Sony STF, Fujifilm APD), weights the pupil by \(T(\rho)\). The disk edge then fades smoothly, at the cost of about 1 stop of light (T-stop vs f-stop).</p>
<h3>Bokeh from the traced lens</h3>
<p>The default model needs none of these sliders. It traces exact rays through the chosen prescription: background lights at infinity, foreground lights at half the focus distance, and the sensor placed at the real-ray image of the focus distance. A \(37\times37\) grid of rays per wavelength (8 wavelengths) is rasterised as triangles. Each triangle carries its share of the flux, \(\Phi_\triangle\), spread over its image area \(A_\triangle\). The irradiance \(E = \Phi_\triangle/A_\triangle\) therefore holds energy exactly, including caustics where triangles fold over. The iris polygon and every clear aperture are tested per pixel, which keeps outlines sharp. Every effect above then emerges from the lens itself:</p>
<ul>
<li>the lens's real spherical aberration sets the rim or soft edge, with the sign flipping between foreground and background;</li>
<li>longitudinal colour (secondary spectrum) produces the classic <em>magenta foreground and green background</em> fringes of achromatised lenses, while a simple singlet shows violet behind focus and red in front;</li>
<li>the barrel's clear apertures cut cat's eyes off axis, and coma shades them unevenly.</li>
</ul>
<p>Disks are drawn at their physical size on a 36 mm sensor, so the scaling \(c = f^2/(N(s-f))\) is visible directly: a 50 mm f/5 lens gives small disks, a 100 mm f/3 large ones. The traced diameter agrees with this thin-lens value to within a few per cent, and the flux of a stopped-down kernel equals \(\pi r_{EP}^2\) within 1 % (see the tests).</p>
<h3>The cone in 3-D</h3>
<p>The 3-D view traces the same lens with 32 rays round the edge of the iris and one through its centre, from a background point on axis (blue) and one in the corner of a full-frame sensor (gold). Because the sensor sits behind the image of infinity, each bundle comes to a point in front of it and spreads again: the footprint on the sensor is an image of the iris, as large as \(f^2/(N(s-f))\). In the corner the bundle is tilted, so the clear apertures of the front and rear elements cut its two sides and the footprint becomes the cat's eye. Its share of the light is the fraction of a \(24\times24\) grid over the iris that gets through. The footprints are a few millimetres wide, so they are also drawn enlarged beside the sensor.</p>
<h3>Small disks: diffraction</h3>
<p>Geometry is the limit of large defocus. The <em>Small disks</em> panel computes the Fraunhofer PSF of the traced, defocused pupil by FFT. It uses the lens's own aberrations and vignetting, with the sensor moved by \(\Delta z = W_{020}/(1-\cos U')\). For pure defocus the pupil phase \(2\pi W_{020}\rho^2/\lambda\) divides the disk into Fresnel zones. Each extra wave of defocus adds one ring, and the centre alternates between bright and dark:</p>
\[\frac{I(0)}{I_0} = \operatorname{sinc}^2\!\left(\frac{W_{020}}{\lambda}\right),\]
<p>which is exactly zero at every whole number of waves. The edge rings are the Fresnel diffraction of the iris rim, and they survive when the disk is only a few dozen Airy diameters across, as for distant lights slightly out of focus, specular highlights, or stopped-down lenses. Averaging over 450–650 nm washes the rings into the soft coloured fringes of real small disks. Spherical aberration (try the Double-Gauss wide open) breaks the zone symmetry, and the profile departs from the pure-defocus curve. The FFT uses the same OPD in µm for every wavelength, so dispersion of the aberrations is neglected in this panel; the traced kernels above include it.</p>
<h3>What both models omit</h3>
<p>Polishing ripples on the real lens surfaces and an apodisation filter are available only in the phenomenological model.</p>
</div></div>`));
  root.append(references([
    'H. H. Nasse, "Depth of Field and Bokeh", Carl Zeiss Camera Lens Division (2010).',
    'J. Buhler &amp; D. Wexler, "A phenomenological model for bokeh rendering", SIGGRAPH Abstracts (2002).',
    'M. Hullin et al., "Polynomial optics: a construction kit for efficient ray-tracing of lens systems", Comput. Graph. Forum 31 (2012).',
    'S. Bhagavathula &amp; K. Thompson, "Bokeh: a review of the physics and aesthetics", Optics &amp; Photonics News (2020).',
  ]));
  return () => { alive = false; [scene, close, prof, dview, v3].forEach((s) => s.destroy()); };
}
