import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { GLASSES, index, abbe, partialDispersion, LINES } from '../lib/glass.js';
import { wavelengthCSS, spectralBasis, linspace, oetf } from '../lib/color.js';
import { plot, range } from '../lib/plot.js';
import { fft2d } from '../lib/fft.js';
import { besselJ1 } from '../lib/pupil.js';

const GL = Object.keys(GLASSES).filter((g) => g !== 'SK16');
const DOUBLETS = { 'N-BK7/F2': ['N-BK7', 'F2'], 'N-FK51A/N-SF5': ['N-FK51A', 'N-SF5'], 'CaF2/N-BAK4': ['CaF2', 'N-BAK4'] };
const TRIPLETS = { 'CaF2/F5/N-SF11': ['CaF2', 'F5', 'N-SF11'], 'CaF2/N-BAK4/N-SF5': ['CaF2', 'N-BAK4', 'N-SF5'], 'N-FK51A/F5/N-SF11': ['N-FK51A', 'F5', 'N-SF11'] };
const k = (g, l) => (index(g, l) - 1) / (index(g, LINES.d) - 1);

function solve(A, b) {
  const n = b.length; A = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]];
    for (let j = 0; j < n; j++) if (j !== i) { const f = A[j][i] / A[i][i]; for (let c = i; c <= n; c++) A[j][c] -= f * A[i][c]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
// Thin-lens systems in contact, total power φ at d; returns element powers.
const singlet = (g) => ({ glasses: [g], phi: [0.01] });
const achromat = ([a, b]) => ({ glasses: [a, b], phi: solve([[1, 1], [k(a, LINES.C) - k(a, LINES.F), k(b, LINES.C) - k(b, LINES.F)]], [0.01, 0]) });
const apochromat = (gl) => ({ glasses: gl, phi: solve([gl.map(() => 1), gl.map((g) => k(g, LINES.C) - k(g, LINES.F)), gl.map((g) => k(g, LINES.F) - k(g, LINES.g))], [0.01, 0, 0]) });
const focal = (sys, l) => 1 / sys.glasses.reduce((s, g, i) => s + sys.phi[i] * k(g, l), 0); // mm

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Glass bends blue light more than red. A simple lens therefore has a different focal length for every colour. Longitudinal chromatic aberration (LoCA) puts magenta and green fringes on out-of-focus edges, and lateral colour (LaCA) splits the image radially towards the corners. Correcting it requires pairing glasses whose dispersions cancel.', domains: ['photo', 'video', 'space'] }));

  // ── Section 1: dispersion & glass map ──
  const disp = stage({ aspect: 1.25, label: '', draw: drawN, cls: 'plain' });
  const abbeSt = stage({ aspect: 1.25, label: '', draw: drawAbbe, cls: 'plain' });
  const pgf = stage({ aspect: 1.25, label: '', draw: drawPgF, cls: 'plain' });
  root.append(h('section.block', {}, h('h2', {}, 'Dispersion and the glass map'), h('div.grid-3', {}, h('div.card', { style: { padding: '6px' } }, disp.el), h('div.card', { style: { padding: '6px' } }, abbeSt.el), h('div.card', { style: { padding: '6px' } }, pgf.el))));

  // ── Section 2: lab ──
  const ctl = controls({
    glass: { type: 'select', label: 'Singlet glass', value: 'N-BK7', options: GL },
    pair: { type: 'select', label: 'Achromat pair', value: 'N-BK7/F2', options: Object.keys(DOUBLETS) },
    triple: { type: 'select', label: 'Apochromat triplet', value: 'CaF2/F5/N-SF11', options: Object.keys(TRIPLETS) },
    show: { type: 'seg', label: 'Render lens', value: 'achromat', options: [['singlet', 'Singlet'], ['achromat', 'Achromat'], ['apo', 'Apo']] },
    N: { type: 'range', label: 'f-number', min: 1.4, max: 11, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    dz: { type: 'range', label: 'Object offset from focus (3 m)', min: -0.6, max: 0.6, step: 0.005, value: 0.08, fmt: (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' cm' },
    lat: { type: 'range', label: 'Lateral colour at corner (F–C)', min: 0, max: 12, step: 0.1, value: 4, unit: 'px' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const shift = stage({ aspect: 2.3, label: '', draw: drawShift, cls: 'plain', minH: 230 });
  const loca = stage({ aspect: 1, label: 'LoCA: backlit branches, 1 mm of sensor', draw: drawLoca });
  const edge = stage({ aspect: 1, label: '', draw: drawEdge, cls: 'plain' });
  const laca = stage({ aspect: 1.5, label: 'LaCA: test grid, full frame', draw: drawLaca, minH: 240 });
  root.append(h('section.block', {}, h('h2', {}, 'Correcting colour: singlet → achromat → apochromat'),
    lab([h('div.card', { style: { padding: '6px' } }, shift.el), h('div.grid-2', {}, loca.el, h('div.card', { style: { padding: '6px' } }, edge.el)), laca.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el])));

  let S = null;
  const lams = linspace(410, 690, 15);
  const basis = spectralBasis(lams);

  // Branch scene (luminance, 256²), drawn once
  const NS = 256;
  const scene = (() => {
    const c = document.createElement('canvas'); c.width = c.height = NS;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, NS); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#d8d8d8');
    g.fillStyle = gr; g.fillRect(0, 0, NS, NS);
    g.strokeStyle = '#050505'; g.lineCap = 'round';
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const branch = (x, y, a, w, depth) => {
      if (depth <= 0 || w < 0.6) return;
      const L = 30 + 40 * r();
      const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + 10 * (r() - 0.5), (y + y2) / 2 + 10 * (r() - 0.5), x2, y2); g.stroke();
      branch(x2, y2, a + 0.5 * (r() - 0.3), w * 0.72, depth - 1);
      if (r() < 0.7) branch(x2, y2, a - 0.6 - 0.4 * r(), w * 0.6, depth - 1);
    };
    branch(-10, 240, -0.7, 14, 7); branch(266, 40, 2.6, 10, 6);
    const d = g.getImageData(0, 0, NS, NS).data;
    const L = new Float64Array(NS * NS);
    for (let i = 0; i < NS * NS; i++) L[i] = (d[i * 4] / 255) ** 2.2;
    const re = L.slice(), im = new Float64Array(NS * NS);
    fft2d(re, im, NS);
    return { re, im };
  })();

  function systems() {
    const st = ctl.state;
    return { singlet: singlet(st.glass), achromat: achromat(DOUBLETS[st.pair]), apo: apochromat(TRIPLETS[st.triple]) };
  }

  function update() {
    const st = ctl.state, sys = systems();
    const fd = (s) => focal(s, 587.56);
    const curves = {};
    for (const [key, s] of Object.entries(sys)) curves[key] = range(410, 700, 59).map((l) => [l, (focal(s, l) - fd(s)) * 1000]);
    const sel = sys[st.show];
    S = { sys, curves, sel, st: { ...st } };
    const V = abbe(st.glass);
    const sp = (s) => (focal(s, LINES.g) - focal(s, LINES.F)) * 1000;
    ro.replaceChildren(readouts([
      ['Singlet: Abbe V_d', V.toFixed(2)],
      ['Singlet: f_C − f_F', ((focal(sys.singlet, LINES.C) - focal(sys.singlet, LINES.F)) * 1000).toFixed(0) + ' µm'],
      ['Achromat powers φ·f', sys.achromat.phi.map((p) => (p * 100).toFixed(3)).join(' / ')],
      ['Achromat secondary spectrum (g–F)', sp(sys.achromat).toFixed(1) + ' µm'],
      ['Apochromat powers φ·f', sys.apo.phi.map((p) => (p * 100).toFixed(2)).join(' / ')],
      ['Apochromat residual (g–F)', sp(sys.apo).toFixed(2) + ' µm'],
      ['Diffraction depth of focus ±2λN²', '±' + (2 * 0.55 * st.N * st.N).toFixed(1) + ' µm'],
    ]));
    const [a, b] = DOUBLETS[st.pair];
    calc.set(String.raw`\begin{aligned}
    \Delta f_\text{singlet} &\approx -\frac{f}{V_d} = -\frac{100}{${texNum(V, 4)}}\,\text{mm}\\
    \frac{\phi_1}{V_1} + \frac{\phi_2}{V_2} &= 0 \Rightarrow \phi_1 = \phi\frac{V_1}{V_1-V_2}\\
    V_{1,2} &= ${texNum(abbe(a), 4)},\ ${texNum(abbe(b), 4)}\\
    \frac{\delta f}{f} &\approx \frac{P_1 - P_2}{V_1 - V_2} = \frac{${texNum(partialDispersion(a), 4)} - ${texNum(partialDispersion(b), 4)}}{${texNum(abbe(a) - abbe(b), 4)}}
    \end{aligned}`);
    [disp, abbeSt, pgf, shift, edge, laca].forEach((s) => s.redraw());
    computeLoca();
  }

  // Defocus blur diameter (µm) at the sensor for wavelength l, object at 3 m + dz,
  // sensor focused at 550 nm on the 3 m plane (contrast-detect AF behaviour).
  function blurUm(sys, l) {
    const s = 3000, d = s + S.st.dz * 1000;
    const f = focal(sys, l), f0 = focal(sys, 550);
    const vs = (f0 * s) / (s - f0);
    const v = (f * d) / (d - f);
    const A = f0 / S.st.N;
    return (A * Math.abs(v - vs) / v) * 1000 * Math.sign(v - vs);
  }

  let locaImg = null;
  const computeLoca = debounce(() => {
    if (!S) return;
    const R = new Float64Array(NS * NS), G = new Float64Array(NS * NS), B = new Float64Array(NS * NS);
    const pxUm = 1000 / NS; // 1 mm across
    lams.forEach((l, i) => {
      const c = Math.abs(blurUm(S.sel, l)) / pxUm; // diameter in px
      const re = scene.re.slice(), im = scene.im.slice();
      for (let y = 0; y < NS; y++) {
        const fy = (y < NS / 2 ? y : y - NS) / NS;
        for (let x = 0; x < NS; x++) {
          const fx = (x < NS / 2 ? x : x - NS) / NS;
          const a = Math.PI * c * Math.hypot(fx, fy);
          const H = a < 1e-6 ? 1 : (2 * besselJ1(a)) / a;
          re[y * NS + x] *= H; im[y * NS + x] *= H;
        }
      }
      fft2d(re, im, NS, true);
      const [r, g, b] = basis[i];
      for (let k2 = 0; k2 < NS * NS; k2++) { const v = re[k2]; R[k2] += v * r; G[k2] += v * g; B[k2] += v * b; }
    });
    const ic = imageCanvas(NS, NS);
    for (let k2 = 0; k2 < NS * NS; k2++) {
      ic.data[k2 * 4] = oetf(Math.min(1, Math.max(0, R[k2]))) * 255;
      ic.data[k2 * 4 + 1] = oetf(Math.min(1, Math.max(0, G[k2]))) * 255;
      ic.data[k2 * 4 + 2] = oetf(Math.min(1, Math.max(0, B[k2]))) * 255;
      ic.data[k2 * 4 + 3] = 255;
    }
    ic.put();
    locaImg = ic.c;
    loca.redraw();
  }, 60);

  function drawLoca(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!locaImg) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(locaImg, (w - side) / 2, (hh - side) / 2, side, side);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect((w - side) / 2 + 8, hh - 28, 180, 20);
    ctx.fillStyle = '#fff'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${S.st.show}, f/${S.st.N.toPrecision(2)}, Δ ${(S.st.dz * 100).toFixed(1)} cm`, (w - side) / 2 + 14, hh - 14);
  }

  function drawEdge(ctx, w, hh) {
    if (!S) return;
    const F = (u) => (u <= -1 ? 0 : u >= 1 ? 1 : 1 - Math.acos(u) / Math.PI + (u * Math.sqrt(1 - u * u)) / Math.PI);
    const radii = lams.map((l) => Math.abs(blurUm(S.sel, l)) / 2 + 1e-6);
    const xmax = Math.max(8, Math.max(...radii) * 1.3);
    const xs = range(-xmax, xmax, 200);
    const ch = [[], [], []];
    for (const x of xs) {
      const c = [0, 0, 0];
      lams.forEach((l, i) => { const v = F(x / radii[i]); for (let q = 0; q < 3; q++) c[q] += v * basis[i][q]; });
      for (let q = 0; q < 3; q++) ch[q].push([x, c[q]]);
    }
    plot(ctx, w, hh, {
      title: 'Edge response per channel (dark → bright)', x: { min: -xmax, max: xmax, label: 'position on sensor (µm)' }, y: { min: -0.05, max: 1.1, label: 'linear signal' },
      series: [{ data: ch[0], color: '#ff5a5a', width: 2, label: 'R' }, { data: ch[1], color: '#5aff8a', width: 2, label: 'G' }, { data: ch[2], color: '#5a9bff', width: 2, label: 'B' }],
      legend: true,
    });
  }

  function drawShift(ctx, w, hh) {
    if (!S) return;
    const all = Object.values(S.curves).flat().map((p) => p[1]);
    const lo = Math.max(-2500, Math.min(...all)), hi = Math.min(2500, Math.max(...all));
    const dof = 2 * 0.55 * S.st.N * S.st.N;
    plot(ctx, w, hh, {
      title: 'Focal shift Δf(λ) of thin-lens systems, f = 100 mm', x: { min: 410, max: 700, label: 'wavelength (nm)' }, y: { min: lo - 20, max: hi + 20, label: 'Δf (µm)' },
      bands: [{ y: [-dof, dof], color: 'rgba(107,227,164,0.12)' }],
      series: [
        { data: S.curves.singlet, color: '#ff8a5a', width: 2, label: `singlet ${S.st.glass}` },
        { data: S.curves.achromat, color: '#6ad7ff', width: 2, label: `achromat ${S.st.pair}` },
        { data: S.curves.apo, color: '#c18cff', width: 2, label: `apochromat ${S.st.triple}` },
      ],
      vlines: [['g', LINES.g], ['F', LINES.F], ['d', LINES.d], ['C', LINES.C]].map(([n, l]) => ({ x: l, color: wavelengthCSS(l, 0.5), label: n })),
      legend: true, legendX: w - 260, legendY: hh - 100,
    });
  }

  function drawLaca(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!S) return;
    const W = Math.min(480, Math.round(w)), H = Math.round(W / 1.5);
    const ic = imageCanvas(W, H);
    const cx = W / 2, cy = H / 2, rc = Math.hypot(cx, cy);
    const g = S.st.glass, nd = index(g, LINES.d), dn = index(g, LINES.F) - index(g, LINES.C);
    const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);
    const cell = W / 16;
    const sceneF = (x, y) => {
      // thin white grid lines and dots, analytically anti-aliased
      const gx = Math.abs(((x % cell) + cell) % cell - cell / 2), gy = Math.abs(((y % cell) + cell) % cell - cell / 2);
      const line = Math.max(0, 1 - Math.abs(gx - cell / 2 + 0.6)) + Math.max(0, 1 - Math.abs(gy - cell / 2 + 0.6));
      const dot = Math.max(0, 1 - (Math.hypot(gx, gy) - 2.2));
      return Math.min(1, 0.45 * line + dot);
    };
    lams.forEach((l, i) => {
      const disp = (S.st.lat * (index(g, l) - nd)) / dn; // px at the corner, scaled by the glass dispersion
      const m = 1 + disp / rc;
      const [r, gg, b] = basis[i];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = sceneF(cx + (x - cx) / m, cy + (y - cy) / m);
        if (!v) continue;
        const k2 = y * W + x; R[k2] += v * r; G[k2] += v * gg; B[k2] += v * b;
      }
    });
    for (let k2 = 0; k2 < W * H; k2++) {
      ic.data[k2 * 4] = oetf(Math.min(1, R[k2])) * 255; ic.data[k2 * 4 + 1] = oetf(Math.min(1, G[k2])) * 255; ic.data[k2 * 4 + 2] = oetf(Math.min(1, B[k2])) * 255; ic.data[k2 * 4 + 3] = 255;
    }
    ic.put();
    const sc = Math.min(w / W, hh / H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ic.c, (w - W * sc) / 2, (hh - H * sc) / 2, W * sc, H * sc);
  }

  function drawN(ctx, w, hh) {
    const sel = ['N-FK51A', 'CaF2', 'N-BK7', 'N-BAK4', 'F2', 'N-SF5', 'N-SF11', 'Fused silica'];
    const cols = ['#c18cff', '#8fd8ff', '#6ad7ff', '#6be3a4', '#ffd27a', '#ffb547', '#ff6b6b', '#ffffff'];
    plot(ctx, w, hh, {
      title: 'Sellmeier dispersion n(λ)', x: { min: 380, max: 1000, label: 'wavelength (nm)' }, y: { min: 1.42, max: 1.86, label: 'refractive index' },
      series: sel.map((g, i) => ({ data: range(380, 1000, 80).map((l) => [l, index(g, l)]), color: cols[i], width: 1.6, label: g })),
      bands: [{ x: [400, 700], color: 'rgba(255,255,255,0.03)' }], legend: true, legendX: w - 120,
    });
  }

  function drawAbbe(ctx, w, hh) {
    const pts = GL.map((g) => [abbe(g), index(g, LINES.d), g]);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Abbe diagram (V_d axis reversed)', x: { min: 100, max: 20, label: 'Abbe number V_d' }, y: { min: 1.4, max: 1.82, label: 'n_d' },
      bands: [{ x: [100, 50], color: 'rgba(106,215,255,0.04)' }],
      vlines: [{ x: 50, color: 'rgba(255,255,255,0.25)', label: 'crowns │ flints' }],
    });
    ctx.font = '10px Inter, sans-serif';
    for (const [v, n, g] of pts) {
      ctx.fillStyle = GLASSES[g].type.includes('flint') ? '#ffb547' : '#6ad7ff';
      ctx.beginPath(); ctx.arc(X(v), Y(n), 4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'left'; ctx.fillText(g, X(v) + 6, Y(n) + 3);
    }
  }
  function drawPgF(ctx, w, hh) {
    const pts = GL.map((g) => [abbe(g), partialDispersion(g), g]);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Partial dispersion P_g,F vs V_d', x: { min: 100, max: 20, label: 'Abbe number V_d' }, y: { min: 0.51, max: 0.63, label: 'P_g,F' },
      series: [{ data: [[100, 0.6438 - 0.001682 * 100], [20, 0.6438 - 0.001682 * 20]], color: 'rgba(255,255,255,0.4)', dash: [5, 4], width: 1, label: 'normal line' }],
      legend: true, legendX: w - 130, legendY: hh - 60,
    });
    ctx.font = '10px Inter, sans-serif';
    for (const [v, p, g] of pts) {
      const dev = p - (0.6438 - 0.001682 * v);
      ctx.fillStyle = dev > 0.008 ? '#c18cff' : GLASSES[g].type.includes('flint') ? '#ffb547' : '#6ad7ff';
      ctx.beginPath(); ctx.arc(X(v), Y(p), 4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'left'; ctx.fillText(g + (dev > 0.008 ? ' (anomalous)' : ''), X(v) + 6, Y(p) + 3);
    }
  }

  update();

  root.append(theory('Theory of chromatic correction', String.raw`
<div class="theory-cols"><div>
<h3>Dispersion and the Abbe number</h3>
<p>A thin lens has power \(\phi(\lambda) = (n(\lambda)-1)\,K\), where \(K = 1/R_1 - 1/R_2\). Its spread of focus between the blue F (486.1 nm) and red C (656.3 nm) hydrogen lines is set by one material number, the Abbe number:</p>
\[V_d = \frac{n_d - 1}{n_F - n_C},\qquad \frac{\phi_F - \phi_C}{\phi_d} = \frac{1}{V_d}\ \Rightarrow\ f_C - f_F \approx \frac{f}{V_d}.\]
<p>A 100 mm N-BK7 lens (\(V_d = 64.2\)) therefore focuses red 1.6 mm farther than blue. That is about 180 times the whole diffraction depth of focus at f/2 (\(\pm2\lambda N^2\approx\pm4.4\ \mu\)m).</p>
<h3>The achromat</h3>
<p>Two thin elements in contact with powers \(\phi_1+\phi_2 = \phi\) bring F and C to a common focus when</p>
\[\frac{\phi_1}{V_1} + \frac{\phi_2}{V_2} = 0\ \Rightarrow\ \phi_1 = \phi\frac{V_1}{V_1 - V_2},\quad \phi_2 = -\phi\frac{V_2}{V_1 - V_2}.\]
<p>A large \(V_1 - V_2\) (a crown paired with a flint) keeps the element powers, and with them the higher-order aberrations, small. Because all glasses' dispersion curves have similar shapes, but not identical ones, the focal-shift curve folds into a parabola. The residual is the <strong>secondary spectrum</strong>:</p>
\[\frac{\delta f_{g,F}}{f} = \frac{P_1 - P_2}{V_1 - V_2},\qquad P_{g,F} = \frac{n_g - n_F}{n_F - n_C}.\]
<p>For ordinary glasses \(P\) lies close to the "normal line" \(P_{g,F}\approx0.6438 - 0.001682\,V_d\). So \((P_1-P_2)/(V_1-V_2)\approx -0.0017\) whatever pair is chosen: the g–F secondary spectrum is about \(f/600\), and the often-quoted \(f/2000\) is the smaller C–d interval. Only glasses off the normal line can reduce it.</p>
</div><div>
<h3>Apochromats and anomalous glasses</h3>
<p>Bringing three wavelengths to one focus requires materials that sit <em>off</em> the normal line: fluorite (CaF₂), FK51A-type "ED" glasses, and KzFS short flints. With three thin elements the conditions are linear in the powers:</p>
\[\sum_i\phi_i = \phi,\qquad \sum_i\phi_i\,\frac{n_{i,C} - n_{i,F}}{n_{i,d}-1} = 0,\qquad \sum_i\phi_i\,\frac{n_{i,F} - n_{i,g}}{n_{i,d}-1} = 0.\]
<p>This page solves that 3×3 system for the chosen glasses, using their Sellmeier equations at every wavelength. The residual is the tertiary spectrum.</p>
<h3>What you see in images</h3>
<p><strong>LoCA</strong> appears only out of focus, so it changes with focus distance. In an achromat, red and blue share a focus slightly behind green (the parabola above). For an object in front of the focal plane, green is therefore the sharpest colour and red plus blue form the larger blur, so edges take a magenta fringe. Behind focus green is blurred most and the fringe turns green. That is the "magenta front, green back" signature of fast portrait lenses. A singlet behaves differently: its focus is monotonic in wavelength, so the fringes run from red to blue. The render convolves a scene with a uniform defocus disk at each of 15 wavelengths, using the exact OTF \(2J_1(\pi c\nu)/(\pi c\nu)\) in Fourier space, then integrates over CIE colour-matching functions.</p>
<p><strong>LaCA</strong> is a wavelength-dependent magnification, \(m(\lambda) = m_d\,[1 + \kappa\,(n(\lambda)-n_d)/(n_F-n_C)]\). It grows linearly with field height, does not depend on aperture, and can be removed in software by rescaling the colour channels. LoCA cannot be removed that way, because it is a blur rather than a displacement.</p>
<p><strong>Space telescopes</strong> use mirrors, which have no dispersion at all. JWST, Hubble and Euclid are therefore free of chromatic aberration across their whole spectral range. The residual chromatic effects come from refractive correctors, filters and dichroics.</p>
</div></div>`));
  root.append(references([
    'R. Kingslake &amp; R. B. Johnson, <i>Lens Design Fundamentals</i>, 2nd ed. (2010), ch. 5 and 7: achromats and the secondary spectrum.',
    'N. v. d. W. Lessing, "Selection of optical glasses in apochromats", JOSA 47, 955 (1957).',
    'R. D. Sigler, "Glass selection for airspaced apochromats using the Buchdahl dispersion equation", Appl. Opt. 25, 4311 (1986).',
    'SCHOTT AG, TIE-29 "Refractive Index and Dispersion" (2016): normal line and partial dispersion.',
  ]));
  return () => [disp, abbeSt, pgf, shift, loca, edge, laca].forEach((s) => s.destroy());
}
