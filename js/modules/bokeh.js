import { h, controls, stage, readouts, debounce, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';

const K = 112; // kernel resolution (px)
const PALETTE = [[255, 196, 120], [255, 150, 90], [140, 200, 255], [255, 230, 190], [190, 160, 255]];

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
  root.append(header({ ...meta, lede: 'An out-of-focus point of light is a projected image of the lens\'s own exit pupil. Its outline comes from the iris blades and the barrel\'s mechanical vignetting. Its inner brightness comes from residual spherical aberration and polishing errors on aspheric surfaces. Bokeh quality is therefore pupil geometry plus wavefront error, made visible.', domains: ['photo', 'video'] }));

  const ctl = controls({
    blades: { type: 'range', label: 'Iris blades (0 = circular)', min: 0, max: 15, step: 1, value: 9, fmt: (v) => (v < 3 ? 'circular' : v) },
    round: { type: 'range', label: 'Blade roundness', min: 0, max: 1, step: 0.01, value: 0.55, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    stop: { type: 'range', label: 'Stopped down from wide open', min: 0, max: 4, step: 0.05, value: 0.6, fmt: (v) => v.toFixed(1) + ' EV' },
    vig: { type: 'range', label: 'Mechanical vignetting (cat\'s eye)', min: 0, max: 0.8, step: 0.01, value: 0.42 },
    sa: { type: 'range', label: 'Spherical aberration (under ← → over)', min: -0.45, max: 0.45, step: 0.005, value: 0.2 },
    ripple: { type: 'range', label: 'Asphere polishing ripple ("onion rings")', min: 0, max: 1, step: 0.01, value: 0 },
    obs: { type: 'range', label: 'Central obstruction (mirror lens)', min: 0, max: 0.6, step: 0.01, value: 0 },
    apod: { type: 'toggle', label: 'Apodisation filter (STF / smooth trans focus)', value: false },
    blur: { type: 'range', label: 'Background blur size', min: 10, max: 120, step: 1, value: 64, unit: 'px' },
  }, () => recompute());
  const ro = h('div');
  const calc = liveCalc();
  const scene = stage({ aspect: 1.6, label: 'Night scene: background behind focus, a few lights in front', draw: drawScene, minH: 300 });
  const close = stage({ aspect: 4, label: 'Kernels: centre behind · centre in front · edge behind · corner behind', draw: drawClose, minH: 140 });
  const prof = stage({ aspect: 2.6, label: '', draw: drawProf, cls: 'plain', minH: 200 });
  root.append(lab([scene.el, close.el, h('div.card', { style: { padding: '6px' } }, prof.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // deterministic set of lights
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const LIGHTS = [];
  for (let i = 0; i < 70; i++) LIGHTS.push({ x: rnd(), y: 0.08 + 0.75 * rnd() ** 1.3, size: 0.6 + 0.6 * rnd(), col: Math.floor(rnd() * 5), side: 1, b: 0.6 + 0.4 * rnd() });
  for (let i = 0; i < 7; i++) LIGHTS.push({ x: rnd(), y: 0.7 + 0.28 * rnd(), size: 0.7 + 0.4 * rnd(), col: Math.floor(rnd() * 5), side: -1, b: 1 });

  let KS = null;
  const grid = [-1, -0.5, 0, 0.5, 1];
  const recompute = debounce(() => {
    const st = ctl.state;
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
      ['Iris shape', st.blades < 3 ? 'circular' : `${st.blades} blades, ${(st.round * 100).toFixed(0)} % rounded`],
      ['Iris / full aperture diameter', (iris * 100).toFixed(0) + ' %'],
      ['Wide-open edge kernel open area', (get(1, 1, 1).k.total / get(1, 0, 0).k.total * 100).toFixed(0) + ' % of centre'],
      ['Background disk', st.sa > 0 ? 'bright rim (soap bubble)' : st.sa < 0 ? 'soft edge, bright centre' : 'uniform'],
      ['Foreground disk', st.sa > 0 ? 'soft edge, bright centre' : st.sa < 0 ? 'bright rim' : 'uniform'],
    ]));
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
    if (!KS) return;
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
    // in-focus subject silhouette
    ctx.fillStyle = '#020203';
    ctx.beginPath(); ctx.ellipse(w * 0.5, hh * 0.62, w * 0.07, hh * 0.13, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.36, hh); ctx.quadraticCurveTo(w * 0.5, hh * 0.62, w * 0.64, hh); ctx.fill();
  }

  function drawClose(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!KS) return;
    const items = [[1, 0, 0], [-1, 0, 0], [1, 1, 0], [1, 1, 1]];
    const side = Math.min(hh - 26, w / 4 - 12);
    items.forEach(([s, fx, fy], i) => {
      const { cv } = KS.get(s, fx, fy);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(cv[3], (w / 4) * i + (w / 4 - side) / 2, 22, side, side);
      ctx.globalCompositeOperation = 'source-over';
    });
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
<h3>What the model omits</h3>
<p>Diffraction adds Fresnel edge ringing, which is visible only for small disks. Longitudinal colour tints the rims magenta in front and green behind, and pupil aberrations slightly distort the disk shape. Optical design programs model all of these by tracing real rays through the full prescription. That is the <a href="#/raytracer">ray tracer</a>, applied to a defocused point.</p>
</div></div>`));
  root.append(references([
    'H. H. Nasse, "Depth of Field and Bokeh", Carl Zeiss Camera Lens Division (2010).',
    'J. Buhler &amp; D. Wexler, "A phenomenological model for bokeh rendering", SIGGRAPH Abstracts (2002).',
    'M. Hullin et al., "Polynomial optics: a construction kit for efficient ray-tracing of lens systems", Comput. Graph. Forum 31 (2012).',
    'S. Bhagavathula &amp; K. Thompson, "Bokeh: a review of the physics and aesthetics", Optics &amp; Photonics News (2020).',
  ]));
  return () => [scene, close, prof].forEach((s) => s.destroy());
}
