import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';

const ARC = Math.PI / 180 / 3600;
const C = 299792.458; // km/s
// flat ΛCDM angular-diameter distance between z1 < z2 (Mpc)
function DA(z1, z2, H0 = 70, Om = 0.3) {
  const E = (z) => Math.sqrt(Om * (1 + z) ** 3 + 1 - Om);
  const n = 400; let s = 0;
  for (let i = 0; i < n; i++) { const z = z1 + ((i + 0.5) * (z2 - z1)) / n; s += 1 / E(z); }
  return (C / H0) * s * ((z2 - z1) / n) / (1 + z2);
}

// deflection α(θ) in arcsec for a lens model; θ in arcsec
function deflect(P, x, y) {
  let ax = 0, ay = 0;
  if (P.model === 'point') {
    const r2 = x * x + y * y + 1e-12; ax = (P.b * P.b * x) / r2; ay = (P.b * P.b * y) / r2;
  } else if (P.model === 'sis' || P.q > 0.999) {
    const r = Math.hypot(x, y) + 1e-12; ax = (P.b * x) / r; ay = (P.b * y) / r;
  } else {
    // singular isothermal ellipsoid (Kormann, Schneider & Bartelmann 1994), major axis at angle pa
    const c = Math.cos(P.pa), s = Math.sin(P.pa);
    const xr = c * x + s * y, yr = -s * x + c * y;
    const q = P.q, e = Math.sqrt(1 - q * q), psi = Math.sqrt(q * q * xr * xr + yr * yr) + 1e-12;
    const k = (P.b * Math.sqrt(q)) / e;
    const axr = k * Math.atan((e * xr) / psi), ayr = k * Math.atanh(Math.min(0.999999, (e * yr) / psi));
    ax = c * axr - s * ayr; ay = s * axr + c * ayr;
  }
  if (P.gamma) {
    const g1 = P.gamma * Math.cos(2 * P.gpa), g2 = P.gamma * Math.sin(2 * P.gpa);
    ax += g1 * x + g2 * y; ay += g2 * x - g1 * y;
  }
  return [ax, ay];
}

// procedural spiral galaxy, β in arcsec relative to its centre → linear RGB
function galaxy(bx, by, R) {
  const r = Math.hypot(bx, by) / R, ph = Math.atan2(by, bx);
  const bulge = 1.6 * Math.exp(-7.67 * (Math.pow(r / 0.12 + 1e-6, 0.25) - 1)) / 3000;
  const arms = Math.pow(0.5 + 0.5 * Math.cos(2 * (ph - Math.log(r + 1e-3) / Math.tan(0.35))), 3);
  const disk = Math.exp(-r / 0.3) * (0.25 + 1.4 * arms);
  const knots = arms > 0.8 && r > 0.25 && r < 0.9 ? 0.6 * Math.exp(-r / 0.5) * (0.5 + 0.5 * Math.sin(37 * ph + 11 * r)) : 0;
  return [bulge * 1.0 + disk * 0.3 + knots * 1.1, bulge * 0.75 + disk * 0.5 + knots * 0.35, bulge * 0.4 + disk * 1.05 + knots * 0.85];
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Mass bends light. A galaxy or cluster between us and a more distant galaxy acts as a lens, shaped by its gravitational potential rather than by glass. It produces arcs, Einstein rings and multiple images, and magnifies sources that would otherwise be invisible. JWST and Hubble use these natural telescopes to see the first galaxies.', domains: ['space'] }));

  const ctl = controls({
    model: { type: 'seg', label: 'Lens model', value: 'sie', options: [['point', 'Point mass'], ['sis', 'SIS'], ['sie', 'SIE + shear']] },
    b: { type: 'range', label: 'Einstein radius θ_E', min: 0.3, max: 3, step: 0.01, value: 1.4, unit: '″' },
    q: { type: 'range', label: 'Axis ratio q (SIE)', min: 0.3, max: 1, step: 0.01, value: 0.7 },
    pa: { type: 'range', label: 'Position angle', min: 0, max: 180, step: 1, value: 30, unit: '°' },
    gamma: { type: 'range', label: 'External shear γ', min: 0, max: 0.2, step: 0.005, value: 0.04 },
    R: { type: 'range', label: 'Source size', min: 0.1, max: 1.5, step: 0.01, value: 0.45, unit: '″' },
    light: { type: 'toggle', label: 'Show lens-galaxy light', value: true },
    zl: { type: 'range', label: 'Lens redshift z_l', min: 0.05, max: 1.5, step: 0.01, value: 0.3 },
    zs: { type: 'range', label: 'Source redshift z_s', min: 0.2, max: 6, step: 0.01, value: 2 },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const img = stage({ aspect: 1, label: 'Image plane: what the telescope sees', draw: drawImage });
  const src = stage({ aspect: 1, label: 'Source plane: drag the galaxy · caustics', draw: drawSource });
  root.append(lab([h('div.grid-2', {}, img.el, src.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let srcPos = [0.12, 0.06];
  const FOV = 7; // arcsec across the image plane
  const SFOV = 3.5; // source-plane panel
  let dragging = false;
  const mv = (e) => { const r = src.canvas.getBoundingClientRect(); srcPos = [((e.clientX - r.left) / r.width - 0.5) * SFOV, (0.5 - (e.clientY - r.top) / r.height) * SFOV]; render(); };
  src.canvas.addEventListener('pointerdown', (e) => { dragging = true; src.canvas.setPointerCapture(e.pointerId); mv(e); });
  src.canvas.addEventListener('pointermove', (e) => dragging && mv(e));
  src.canvas.addEventListener('pointerup', () => (dragging = false));

  let L = null;
  function params() { const st = ctl.state; return { model: st.model, b: st.b, q: st.q, pa: (st.pa * Math.PI) / 180, gamma: st.model === 'sie' ? st.gamma : 0, gpa: ((st.pa + 70) * Math.PI) / 180 }; }

  function criticalCurves(P) {
    // det A on a grid, marching squares for det = 0
    const G = 220, s = FOV / G, det = new Float64Array((G + 1) * (G + 1)), hD = 1e-3;
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const x = -FOV / 2 + i * s, y = FOV / 2 - j * s;
      const [a1, b1] = deflect(P, x + hD, y), [a0, b0] = deflect(P, x - hD, y), [a2, b2] = deflect(P, x, y + hD), [a3, b3] = deflect(P, x, y - hD);
      const A11 = 1 - (a1 - a0) / (2 * hD), A12 = -(a2 - a3) / (2 * hD), A21 = -(b1 - b0) / (2 * hD), A22 = 1 - (b2 - b3) / (2 * hD);
      det[j * (G + 1) + i] = A11 * A22 - A12 * A21;
    }
    const segs = [];
    const P0 = (i, j) => [-FOV / 2 + i * s, FOV / 2 - j * s];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const v = [det[j * (G + 1) + i], det[j * (G + 1) + i + 1], det[(j + 1) * (G + 1) + i + 1], det[(j + 1) * (G + 1) + i]];
      const c = [P0(i, j), P0(i + 1, j), P0(i + 1, j + 1), P0(i, j + 1)];
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a > 0) !== (b > 0)) { const t = a / (a - b); pts.push([c[e][0] + t * (c[(e + 1) % 4][0] - c[e][0]), c[e][1] + t * (c[(e + 1) % 4][1] - c[e][1])]); }
      }
      if (pts.length >= 2) segs.push([pts[0], pts[1]]);
      if (pts.length === 4) segs.push([pts[2], pts[3]]);
    }
    return segs;
  }

  let imgCanvas = null, srcCanvas = null;
  function render() {
    const st = ctl.state, P = L.P;
    const N = 320, ss = 2, ic = imageCanvas(N, N);
    let maxMu = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
        const x = ((i + (si + 0.5) / ss) / N - 0.5) * FOV, y = (0.5 - (j + (sj + 0.5) / ss) / N) * FOV;
        const [ax, ay] = deflect(P, x, y);
        const c = galaxy(x - ax - srcPos[0], y - ay - srcPos[1], st.R);
        r += c[0]; g += c[1]; b += c[2];
        // lens-galaxy light: de Vaucouleurs profile, I_e = 0.07 at r_e = 0.9″
        if (st.light) { const rr = Math.hypot(x, y * 1.3) / 0.9; const l = Math.min(4, 0.07 * Math.exp(-7.67 * (Math.pow(rr + 1e-4, 0.25) - 1))); r += l * 1.0; g += l * 0.72; b += l * 0.42; }
      }
      const k = (j * N + i) * 4, f = 1 / (ss * ss);
      const tm = (v) => Math.round(255 * Math.pow(1 - Math.exp(-v * f * 1.1), 1 / 1.8));
      ic.data[k] = tm(r); ic.data[k + 1] = tm(g); ic.data[k + 2] = tm(b); ic.data[k + 3] = 255;
    }
    ic.put(); imgCanvas = ic.c;
    const sc = imageCanvas(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * SFOV, y = (0.5 - j / N) * SFOV;
      const c = galaxy(x - srcPos[0], y - srcPos[1], st.R);
      const k = (j * N + i) * 4, tm = (v) => Math.round(255 * Math.pow(1 - Math.exp(-v * 1.1), 1 / 1.8));
      sc.data[k] = tm(c[0]); sc.data[k + 1] = tm(c[1]); sc.data[k + 2] = tm(c[2]); sc.data[k + 3] = 255;
    }
    sc.put(); srcCanvas = sc.c;
    // magnification of the source centre: count of images via local det near the solutions is complex; estimate total μ by area ratio
    let srcArea = 0, imgArea = 0;
    const thr = 0.05;
    for (let j = 0; j < 160; j++) for (let i = 0; i < 160; i++) {
      const x = (i / 160 - 0.5) * FOV, y = (0.5 - j / 160) * FOV;
      const [ax, ay] = deflect(P, x, y);
      const c = galaxy(x - ax - srcPos[0], y - ay - srcPos[1], st.R);
      if (c[1] > thr) imgArea++;
      const xs = (i / 160 - 0.5) * FOV, ys = (0.5 - j / 160) * FOV;
      if (galaxy(xs - srcPos[0], ys - srcPos[1], st.R)[1] > thr) srcArea++;
    }
    L.mu = srcArea ? imgArea / srcArea : NaN;
    img.redraw(); src.redraw();
    const dd = ro.querySelectorAll('dd'); if (dd.length) dd[dd.length - 1].textContent = isFinite(L.mu) ? L.mu.toFixed(1) + '×' : '—';
  }

  function update() {
    const st = ctl.state, P = params();
    const crit = criticalCurves(P);
    const caus = crit.map(([a, b]) => [a, b].map(([x, y]) => { const [ax, ay] = deflect(P, x, y); return [x - ax, y - ay]; }));
    L = { P, crit, caus };
    const Dl = DA(0, st.zl), Ds = DA(0, Math.max(st.zs, st.zl + 0.01)), Dls = DA(st.zl, Math.max(st.zs, st.zl + 0.01));
    const Mpc = 3.0857e22, G = 6.674e-11, c = 2.998e8, Msun = 1.989e30;
    const tE = st.b * ARC;
    const M = (tE * tE * c * c * Dl * Ds * Mpc) / (4 * G * Dls) / Msun; // mass inside θ_E
    const sigma = C * Math.sqrt((tE * Ds) / (4 * Math.PI * Dls));
    const RE = tE * Dl * 1000; // kpc
    ro.replaceChildren(readouts([
      ['D_l / D_s / D_ls', `${Dl.toFixed(0)} / ${Ds.toFixed(0)} / ${Dls.toFixed(0)} Mpc`],
      ['Physical Einstein radius', RE.toFixed(2) + ' kpc'],
      ['Mass inside θ_E', M.toExponential(2) + ' M☉'],
      ['SIS velocity dispersion σ_v', sigma.toFixed(0) + ' km/s'],
      ['Total magnification (area ratio)', '…'],
    ]));
    calc.set(String.raw`\begin{aligned}
    \boldsymbol\beta &= \boldsymbol\theta - \boldsymbol\alpha(\boldsymbol\theta)\\
    \theta_E &= \sqrt{\frac{4GM}{c^2}\frac{D_{ls}}{D_lD_s}} \Rightarrow M = ${texNum(M, 3)}\,M_\odot\\
    \theta_E^\text{SIS} &= 4\pi\frac{\sigma_v^2}{c^2}\frac{D_{ls}}{D_s} \Rightarrow \sigma_v = ${texNum(sigma, 3)}\ \text{km/s}\\
    \mu &= \frac{1}{\det A},\quad A_{ij} = \delta_{ij} - \partial_j\alpha_i
    \end{aligned}`);
    render();
  }

  function drawImage(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!imgCanvas) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(imgCanvas, (w - side) / 2, (hh - side) / 2, side, side);
    const X = (x) => w / 2 + (x / FOV) * side, Y = (y) => hh / 2 - (y / FOV) * side;
    ctx.strokeStyle = 'rgba(106,215,255,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const [a, b] of L.crit) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${FOV}″ field · cyan = critical curves`, w - 10, hh - 10);
  }
  function drawSource(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!srcCanvas) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(srcCanvas, (w - side) / 2, (hh - side) / 2, side, side);
    const X = (x) => w / 2 + (x / SFOV) * side, Y = (y) => hh / 2 - (y / SFOV) * side;
    ctx.strokeStyle = 'rgba(255,181,71,0.9)'; ctx.lineWidth = 1.3; ctx.beginPath();
    for (const [a, b] of L.caus) { if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.3) continue; ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${SFOV}″ field · amber = caustics · ● lens axis`, w - 10, hh - 10);
  }

  update();

  root.append(theory('Gravitational lensing as optics', String.raw`
<div class="theory-cols"><div>
<h3>An effective refractive index</h3>
<p>In a weak, static gravitational potential \(\Phi\ (|\Phi|\ll c^2)\), the metric makes light travel as if through a medium of index \(n = 1 - 2\Phi/c^2 \ge 1\). Applying Fermat's principle gives the deflection</p>
\[\hat{\boldsymbol\alpha} = \frac{2}{c^2}\int\nabla_\perp\Phi\,dl,\qquad \hat\alpha = \frac{4GM}{c^2b}\ \text{(point mass)}.\]
<p>That is twice the Newtonian value, as confirmed by Eddington in 1919. It is 1.75″ at the solar limb.</p>
<h3>The lens equation</h3>
<p>In the thin-lens approximation, with angular-diameter distances \(D_l, D_s, D_{ls}\), a source at angular position \(\boldsymbol\beta\) is seen at every \(\boldsymbol\theta\) satisfying</p>
\[\boldsymbol\beta = \boldsymbol\theta - \boldsymbol\alpha(\boldsymbol\theta),\qquad \boldsymbol\alpha = \frac{D_{ls}}{D_s}\hat{\boldsymbol\alpha} = \nabla\psi,\]
<p>where \(\psi\) is the lensing potential (the projected \(\Phi\)). The map from \(\boldsymbol\theta\) to \(\boldsymbol\beta\) is single-valued, which makes <em>inverse ray-shooting</em> trivial. Each image pixel looks up the source brightness at \(\boldsymbol\beta(\boldsymbol\theta)\). Because surface brightness is conserved (Liouville's theorem, the gravitational analogue of radiance invariance), the render is photometrically exact.</p>
<h3>Einstein radius</h3>
<p>A source directly behind a circular lens appears as a ring of radius</p>
\[\theta_E = \sqrt{\frac{4GM(<\theta_E)}{c^2}\frac{D_{ls}}{D_lD_s}},\qquad \theta_E^{SIS} = 4\pi\frac{\sigma_v^2}{c^2}\frac{D_{ls}}{D_s}.\]
<p>Distances here come from flat ΛCDM (\(H_0 = 70\), \(\Omega_m = 0.3\)), so θ_E gives the enclosed mass. This is how lensing weighs dark matter.</p>
</div><div>
<h3>Magnification, critical curves and caustics</h3>
<p>The Jacobian \(A_{ij} = \partial\beta_i/\partial\theta_j = \delta_{ij} - \partial_i\partial_j\psi\) is a lensing "aberration matrix". Its isotropic part is the convergence \(\kappa\) (focusing), and its trace-free part is the shear \(\gamma\) (astigmatism). The magnification is \(\mu = 1/\det A = 1/[(1-\kappa)^2 - \gamma^2]\). Where \(\det A = 0\) lie the <strong>critical curves</strong> (cyan), and their images in the source plane are the <strong>caustics</strong> (amber). Every time the source crosses a caustic, a pair of images is created or destroyed. Inside the diamond-shaped tangential caustic of an elliptical lens, the source has five images, one of them demagnified at the centre. This is the "Einstein cross" configuration.</p>
<h3>Connection to ordinary optics</h3>
<p>Gravitational lenses are extremely aberrated: a point mass has a single focal line instead of a focal point, and its "spherical aberration" is infinite. Caustics here are the same mathematical objects as the bright lines at the bottom of a swimming pool, or the caustic in the <a href="#/raytracer">ray tracer's</a> focus view. Catastrophe theory classifies them into folds and cusps.</p>
<h3>In practice</h3>
<p>Cluster lenses magnify galaxies at \(z>10\) by factors of 10–100 for JWST, as in the "lensed" fields of Abell 2744 and MACS 0416. Time delays between multiple images of a variable quasar measure \(H_0\) (H0LiCOW, TDCOSMO). Microlensing by stars detects exoplanets, and Euclid's weak lensing maps dark matter statistically across a third of the sky.</p>
</div></div>`));
  root.append(references([
    'P. Schneider, J. Ehlers &amp; E. E. Falco, <i>Gravitational Lenses</i>, Springer (1992).',
    'R. Kormann, P. Schneider &amp; M. Bartelmann, "Isothermal elliptical gravitational lens models", A&amp;A 284, 285 (1994).',
    'C. R. Keeton, "A catalog of mass models for gravitational lensing", arXiv:astro-ph/0102341 (2001).',
    'R. Narayan &amp; M. Bartelmann, "Lectures on gravitational lensing", arXiv:astro-ph/9606001 (1996).',
    'T. Treu, "Strong lensing by galaxies", ARA&amp;A 48, 87 (2010).',
  ]));
  return () => [img, src].forEach((s) => s.destroy());
}
