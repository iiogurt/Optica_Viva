import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { angularDiameterDistance as DA, C_KMS as C } from '../lib/optics.js';
import { FOV, SFOV } from '../lib/lensing.js';
import { runOn, parallel, rowBands, poolSize } from '../lib/compute.js';
import { view3d } from '../lib/gl3d.js';
import { lensingScene, comoving } from '../lib/lensing3d.js';
import { t } from '../lib/i18n.js';

const ARC = Math.PI / 180 / 3600;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Mass bends light. A massive galaxy between us and a more distant galaxy acts like a giant lens, made not of glass but of gravity. It can stretch the far galaxy into arcs, split it into several images or, when the two line up exactly, turn it into a complete circle, an <strong>Einstein ring</strong>.</p>
<p>Gravitational lenses also magnify, so astronomers use them as natural telescopes to see galaxies too faint to find otherwise. And because the bending depends only on mass, they weigh galaxies, including their invisible dark matter.</p>`, [
    "Choose the <strong>Point mass</strong> model and place the source right behind the lens: the arcs close into an Einstein ring.",
    "Switch to <strong>SIE + shear</strong> and lower the <strong>Axis ratio</strong>: the ring breaks into four images, an Einstein cross.",
    "Move the <strong>Lens redshift</strong> closer to the source: the same Einstein radius now needs much more mass.",
  ]));

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
  const v3 = view3d({ label: '3-D: the light paths from the source galaxy past the lens to the telescope, with the Einstein ring as a cone', aspect: 1.9, minH: 280, yaw: -1.05, pitch: 0.32 });
  root.append(lab([h('div.grid-2', {}, img.el, src.el), v3.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let srcPos = [0.12, 0.06];
  let dragging = false;
  const mv = (e) => { const r = src.canvas.getBoundingClientRect(); srcPos = [((e.clientX - r.left) / r.width - 0.5) * SFOV, (0.5 - (e.clientY - r.top) / r.height) * SFOV]; render().catch(console.error); };
  src.canvas.tabIndex = 0;
  src.canvas.setAttribute('aria-label', 'Source plane. Arrow keys move the background galaxy.');
  src.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
    if (!d) return;
    e.preventDefault(); srcPos = [srcPos[0] + d[0], srcPos[1] + d[1]]; render().catch(console.error);
  });
  src.canvas.addEventListener('pointerdown', (e) => { dragging = true; src.canvas.setPointerCapture(e.pointerId); mv(e); });
  src.canvas.addEventListener('pointermove', (e) => dragging && mv(e));
  src.canvas.addEventListener('pointerup', () => (dragging = false));

  let L = null;
  function params() { const st = ctl.state; return { model: st.model, b: st.b, q: st.q, pa: (st.pa * Math.PI) / 180, gamma: st.model === 'sie' ? st.gamma : 0, gpa: ((st.pa + 70) * Math.PI) / 180 }; }

  // Renders run in the compute workers (js/lib/lensing.js): the image plane in parallel row bands,
  // the source panel and magnification on another worker, and the critical curves and caustics only
  // when the lens changes. A newer request makes older results stale.
  let imgCanvas = null, srcCanvas = null, ticket = 0, curvesFor = '';
  const toCanvas = (rgba, N) => { const c = imageCanvas(N, N); c.data.set(rgba); c.put(); return c.c; };
  async function render() {
    const my = ++ticket, st = ctl.state, P = L.P, N = 320, key = JSON.stringify(P);
    const bands = parallel('lensRows', rowBands(N).map(([y0, y1]) => ({ p: { P, src: srcPos, R: st.R, light: st.light, N, ss: 2 }, y0, y1 })));
    const side = runOn(poolSize() - 1, 'lensSide', { P, src: srcPos, R: st.R, N, curves: curvesFor !== key });
    const [parts, extra] = await Promise.all([bands, side]);
    if (my !== ticket) return;
    const rgba = new Uint8ClampedArray(N * N * 4);
    let off = 0;
    for (const q of parts) { rgba.set(q, off); off += q.length; }
    imgCanvas = toCanvas(rgba, N); srcCanvas = toCanvas(extra.img, N);
    if (extra.crit) { L.crit = extra.crit; L.caus = extra.caus; curvesFor = key; }
    L.mu = extra.mu; L.images = extra.images;
    show3d();
    img.redraw(); src.redraw();
    const dd = ro.querySelectorAll('dd'); if (dd.length) dd[dd.length - 1].textContent = isFinite(L.mu) ? L.mu.toFixed(1) + '×' : '—';
  }

  function update() {
    const st = ctl.state, P = params();
    L = { P, crit: L ? L.crit : [], caus: L ? L.caus : [], images: L ? L.images : [] };
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
    calc.say(t('An Einstein radius of {b}″ at these distances encloses about <strong>{v2} solar masses</strong>, within a radius of {RE} kpc at the lens.', { b: st.b, v2: fmt(M, 2), RE: RE.toFixed(1) }));
    calc.set(String.raw`\begin{aligned}
    \boldsymbol\beta &= \boldsymbol\theta - \boldsymbol\alpha(\boldsymbol\theta)\\
    \theta_E &= \sqrt{\frac{4GM}{c^2}\frac{D_{ls}}{D_lD_s}} \Rightarrow M = ${texNum(M, 3)}\,M_\odot\\
    \theta_E^\text{SIS} &= 4\pi\frac{\sigma_v^2}{c^2}\frac{D_{ls}}{D_s} \Rightarrow \sigma_v = ${texNum(sigma, 3)}\ \text{km/s}\\
    \mu &= \frac{1}{\det A},\quad A_{ij} = \delta_{ij} - \partial_j\alpha_i
    \end{aligned}`);
    render().catch(console.error);
  }

  // 3-D: the camera stays where the reader put it, unless the source distance changes more than 1.5×
  let depth3d = 0;
  function show3d() {
    const st = ctl.state, D = comoving(Math.max(st.zs, st.zl + 0.01)), keep = depth3d > 0 && D / depth3d < 1.5 && depth3d / D < 1.5;
    v3.setScene(lensingScene({ P: L.P, zl: st.zl, zs: st.zs, src: srcPos, R: st.R, images: L.images, crit: L.crit, caus: L.caus }), keep);
    if (!keep) depth3d = D;
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
    ctx.fillText(t('{FOV}″ field · cyan = critical curves', { FOV }), w - 10, hh - 10);
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
    ctx.fillText(t('{SFOV}″ field · amber = caustics · ● lens axis', { SFOV }), w - 10, hh - 10);
  }

  update();

  root.append(rule(String.raw`\[\theta_E = \sqrt{\frac{4GM}{c^2}\,\frac{D_{ls}}{D_l D_s}}\]
<p>The Einstein radius \(\theta_E\) grows with the square root of the lens mass \(M\) and depends on the distances to the lens (\(D_l\)), to the source (\(D_s\)) and between them (\(D_{ls}\)). Double the mass and the ring grows by \(\sqrt2\). With the lens at redshift 0.3 and the source at 2, a 1.4″ ring encloses about \(2.9 \times 10^{11}\) solar masses. Galaxies make rings of about 1″, clusters of galaxies tens of arcseconds. Images appear near \(\theta_E\) and are magnified most when the source sits right behind the lens.</p>`,
    String.raw`The formula is exact for a point mass, and for any round lens it gives the mass enclosed by the ring. Real galaxies are extended and elliptical and sit in groups that add shear, so image positions need a full lens model like the SIE used here, and the distances depend on the cosmological model.`));
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
<h3>The 3-D view</h3>
<p>The view finds every image \(\boldsymbol\theta_i\) of the source centre by solving the lens equation (a grid search for near-solutions, then Newton's method with the Jacobian \(A\)) and draws each light path as two straight legs that meet in the lens plane. Along the line of sight the planes sit at their <em>comoving</em> distances \(\chi = (1+z)D_A\). In a flat universe space is Euclidean in comoving coordinates, so light travels in straight lines there and \(\chi_s = \chi_l + \chi_{ls}\), which angular-diameter distances do not satisfy (beyond \(z \approx 1.6\) a farther galaxy even has a smaller \(D_A\)). Since \(D_{ls}/D_s = \chi_{ls}/\chi_s\), the bend of each drawn path is exactly the deflection \(\hat\alpha\). Across the line of sight all angles are multiplied by 40 000, or the arcsecond bends would be invisible over gigaparsecs. The gold double cone is the Einstein ring: the directions \(\theta_E\) from the telescope, closing on the axis at the source plane.</p>
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
  return () => [img, src, v3].forEach((s) => s.destroy());
}
