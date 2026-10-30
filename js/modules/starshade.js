import { h, controls, stage, readouts, imageCanvas, texNum, fmt } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot, range } from '../lib/plot.js';
import { lut, wavelengthRGB } from '../lib/color.js';
import { OCCULTERS, fresnelNumber, iwa } from '../lib/starshade.js';
import { view3d } from '../lib/gl3d.js';
import { starshadeScene } from '../lib/starshade3d.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno');
const MAS = 206264806.2;
// line colours: the visible hue, but never darker than a readable minimum (violet and infrared would vanish)
const css = (l) => { const c = wavelengthRGB(Math.min(680, Math.max(420, l * 1e9)), false), m = Math.max(...c); return `rgb(${c.map((v) => Math.round(255 * (0.25 + (0.75 * v) / m))).join(',')})`; };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Finding an Earth-like planet around another star is like spotting a firefly beside a lighthouse from thousands of kilometres away: the planet is ten billion times fainter and sits almost on top of its star.</p>
<p>A <strong>starshade</strong> is a flower-shaped screen tens of metres wide, flown tens of thousands of kilometres in front of a space telescope. It casts a deep shadow of the star while the planet beside it stays visible. A plain round disc would not work: light bending around its edge makes a bright spot right in the middle of the shadow. The carefully shaped petals cancel that spot.</p>`, [
    "Compare the suppression of the starshade with that of the same-size opaque disc: the disc lets far more light through.",
    "Move the telescope from 80 000 km to <strong>30 000 km</strong>: the Fresnel number falls and starlight leaks into the shadow.",
    "Set the <strong>Wavelength for the shadow map</strong> to 1000 nm: the shadow is shallower in red light.",
  ]));

  const ctl = controls({
    a: { type: 'range', label: 'Opaque core radius a', min: 4, max: 20, step: 0.5, value: 12.5, unit: 'm' },
    b: { type: 'range', label: 'Petal length scale b', min: 4, max: 20, step: 0.5, value: 12.5, unit: 'm' },
    n: { type: 'range', label: 'Hypergaussian order n', min: 2, max: 10, step: 1, value: 6 },
    N: { type: 'range', label: 'Number of petals (drawing only)', min: 8, max: 32, step: 1, value: 16 },
    z: { type: 'range', label: 'Telescope–starshade distance', min: 10000, max: 150000, step: 1000, value: 80000, unit: 'km' },
    D: { type: 'range', label: 'Telescope diameter', min: 1, max: 8, step: 0.1, value: 4, unit: 'm' },
    lam: { type: 'range', label: 'Wavelength for the shadow map', min: 300, max: 1100, step: 10, value: 550, unit: 'nm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const shape = stage({ aspect: 1, label: 'Starshade seen from the telescope', draw: drawShape, minH: 200 });
  const map = stage({ aspect: 1, label: 'Shadow at the telescope (log intensity)', draw: drawMap, minH: 200 });
  const prof = stage({ aspect: 2.1, label: '', draw: drawProf, cls: 'plain', minH: 220 });
  const spec = stage({ aspect: 2.1, label: '', draw: drawSpec, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing the Fresnel integrals in the worker…'));
  const v3 = view3d({ label: '3-D: the telescope, the starshade tens of thousands of kilometres away, and its shadow on the telescope', aspect: 1.9, minH: 260, yaw: -0.7, pitch: 0.35 });
  root.append(lab([h('div.grid-2', {}, shape.el, map.el), note, v3.el, h('div.card', { style: { padding: '6px' } }, prof.el), h('div.card', { style: { padding: '6px' } }, spec.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('starshade');
  let R = null;
  const lams = (st) => [...new Set([400e-9, st.lam * 1e-9, 1000e-9])].sort((x, y) => x - y);
  const specLams = range(300e-9, 1200e-9, 46);
  // 3-D: drawn at once with the last computed shadow, then again when the new one arrives; the
  // camera stays put unless the distance changes more than 1.5×
  let z3d = 0;
  function show3d(st, z, rhos, prof) {
    const keep = z3d > 0 && z / z3d < 1.5 && z3d / z < 1.5;
    v3.setScene(starshadeScene({ a: st.a, b: st.b, n: st.n, N: st.N, z, D: st.D, lamNm: st.lam, rhos, prof }), keep);
    if (!keep) z3d = z;
  }
  function update() {
    const st = ctl.state, Rt = st.a + st.b, z = st.z * 1e3, lam = st.lam * 1e-9, F = fresnelNumber(Rt, lam, z), th = iwa(Rt, z) * MAS;
    shape.redraw();
    show3d(st, z, R ? R.rhos : [], R ? R.prof[R.p.lams.indexOf(R.st.lam * 1e-9)] : []);
    calc.set(String.raw`\begin{aligned}
    F &= \frac{(a+b)^2}{\lambda z}\\
    &= \frac{(${texNum(Rt, 3)}\ \text{m})^2}{${texNum(st.lam, 3)}\ \text{nm}\times ${texNum(st.z / 1000, 3)}\,\text{Mm}} = ${texNum(F, 3)}\\
    \theta_\text{IWA} &\approx \frac{a+b}{z} = ${texNum(th, 3)}\ \text{mas}\\
    \lambda/D &= ${texNum((lam / st.D) * MAS, 3)}\ \text{mas}\\
    E(0) &= 1 + i\,\frac{2\pi}{\lambda z}\int_0^\infty A(r)\,e^{i\pi r^2/\lambda z}\,r\,dr
    \end{aligned}`);
    note.textContent = t('Computing the Fresnel integrals in the worker…');
    const p = { kind: 'hyper', a: st.a, b: st.b, n: st.n, z, D: st.D, lams: lams(st), lamC: lam, rhoMax: Math.max(1.4 * Rt, st.D), nr: 120, specLams, steps: 2000 };
    job('starshade', p).then((r) => {
      R = { st: { ...st }, p, ...r };
      const k = R.p.lams.indexOf(lam), sp = r.supp[k];
      ro.replaceChildren(readouts([
        [t('Fresnel number at {l} nm', { l: st.lam }), F.toFixed(1)],
        ['Inner working angle', th.toFixed(0) + ' mas = ' + (th / ((lam / st.D) * MAS)).toFixed(1) + ' λ/D'],
        ['Suppression over the aperture (starshade)', sp.toExponential(1)],
        ['Same-size opaque disk', t('{s} (Poisson spot)', { s: r.diskSupp.toExponential(1) })],
        ['Band with suppression < 10⁻¹⁰', band(r.specSupp, 1e-10)],
      ]));
      calc.say(t('At {v1} thousand km the starshade dims the starlight over the telescope to <strong>{v2}</strong> of its unblocked level, against {v3} for a plain disc of the same size. Planets can be seen from <strong>{th} mas</strong> from the star outwards.', { v1: fmt(st.z / 1000, 3), v2: fmt(sp, 2), v3: fmt(r.diskSupp, 2), th: th.toFixed(0) }));
      note.textContent = t('Shadow of a hypergaussian starshade (a = {a} m, b = {b} m, n = {n}) at {z} km. The telescope aperture is the dashed circle. Scalar Fresnel diffraction, azimuthally averaged petals.', { a: st.a, b: st.b, n: st.n, z: Math.round(st.z) });
      [map, prof, spec].forEach((x) => x.redraw());
      show3d(st, z, r.rhos, r.prof[k]);
    });
  }
  function band(s, thr) {
    const ok = specLams.filter((_, i) => s[i] < thr);
    return ok.length ? `${Math.round(ok[0] * 1e9)}–${Math.round(ok[ok.length - 1] * 1e9)} nm` : 'none';
  }
  function drawShape(ctx, w, hh) {
    const st = ctl.state, occ = OCCULTERS.hyper, Rm = occ.Rmax(st), sc = (Math.min(w, hh) / 2 - 10) / Rm, cx = w / 2, cy = hh / 2;
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#c9d4e6'; ctx.beginPath();
    const steps = 80;
    for (let k = 0; k < st.N; k++) {
      const ax = (2 * Math.PI * k) / st.N, pts = [];
      for (let i = 0; i <= steps; i++) { const r = st.a + ((Rm - st.a) * i) / steps, half = (Math.PI * occ.A(r, st)) / st.N; pts.push([r, half]); }
      pts.forEach(([r, hf], i) => { const x = cx + sc * r * Math.cos(ax - hf), y = cy + sc * r * Math.sin(ax - hf); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      for (let i = pts.length - 1; i >= 0; i--) { const [r, hf] = pts[i]; ctx.lineTo(cx + sc * r * Math.cos(ax + hf), cy + sc * r * Math.sin(ax + hf)); }
      ctx.closePath();
    }
    ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, sc * st.a, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,0.7)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, sc * (st.a + st.b), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(t('diameter {v1} m tip to tip', { v1: (2 * Rm).toFixed(0) }), 8, hh - 24); ctx.fillStyle = 'rgba(255,181,71,0.9)'; ctx.fillText(t('a + b (IWA radius)'), 8, hh - 9);
  }
  function drawMap(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const k = R.p.lams.indexOf(R.st.lam * 1e-9), I = R.prof[k], rs = R.rhos, rm = rs[rs.length - 1], n = 160, ic = imageCanvas(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const rr = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2) * rm, f = Math.min(rs.length - 1.001, (rr / rm) * (rs.length - 1)), i = Math.floor(f), t = f - i;
      const v = rr > rm ? 1 : I[i] * (1 - t) + I[i + 1] * t, L = Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-16)) + 14) / 14)), c = Math.round(255 * L) * 3, o = (y * n + x) * 4;
      ic.data[o] = INF[c]; ic.data[o + 1] = INF[c + 1]; ic.data[o + 2] = INF[c + 2]; ic.data[o + 3] = 255;
    }
    ic.put();
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, x0, y0, sz, sz);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 26); // keeps the stage label readable on the bright rim
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, (R.st.D / 2 / rm) * (sz / 2), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    const txt = `${R.st.lam} nm, ±${rm.toFixed(0)} m; 10⁻¹⁴ … 1`;
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function drawProf(ctx, w, hh) {
    if (!R) return;
    const rm = R.rhos[R.rhos.length - 1];
    plot(ctx, w, hh, {
      title: 'Shadow profile: intensity relative to the unobstructed starlight', x: { min: 0, max: rm, label: 'distance from the shadow centre (m)' }, y: { min: 1e-16, max: 10, log: true, label: 'I / I₀' },
      series: [
        { data: R.rhos.map((r, i) => [r, Math.max(1e-16, R.disk[i])]), color: 'rgba(255,255,255,0.45)', width: 1.4, dash: [4, 3], label: t('opaque disk, {l} nm', { l: R.st.lam }) },
        ...R.p.lams.map((l, j) => ({ data: R.rhos.map((r, i) => [r, Math.max(1e-16, R.prof[j][i])]), color: css(l), width: 2, label: t('starshade, {l} nm', { l: Math.round(l * 1e9) }) })),
      ],
      bands: [{ x: [0, R.st.D / 2], color: 'rgba(106,215,255,0.08)' }], hlines: [{ y: 1e-10, color: 'rgba(255,181,71,0.5)' }],
      legend: true, legendX: w - 230, legendY: 120,
    });
  }
  function drawSpec(ctx, w, hh) {
    if (!R) return;
    plot(ctx, w, hh, {
      title: 'Starlight suppression averaged over the telescope aperture', x: { min: 300, max: 1200, label: 'wavelength (nm)' }, y: { min: 1e-16, max: 10, log: true, label: 'suppression' },
      series: [{ data: specLams.map((l, i) => [l * 1e9, Math.max(1e-16, R.specSupp[i])]), color: '#ffb547', width: 2.2 }],
      bands: [{ y: [1e-16, 1e-10], color: 'rgba(120,230,160,0.06)' }], vlines: [{ x: R.st.lam, color: 'rgba(255,255,255,0.35)' }], hlines: [{ y: 1e-10, color: 'rgba(255,181,71,0.5)' }],
    });
  }

  update();

  root.append(rule(String.raw`\[F = \frac{R^2}{\lambda z},\qquad \theta_\text{IWA} \approx \frac{R}{z}\]
<p>The Fresnel number \(F\) of a starshade of radius \(R\) at distance \(z\) measures how deep its shadow can be; deep shadows need \(F\) of order 10 or more. A starshade of 25 m radius at 80 000 km in 550 nm light has \(F = 25^2/(550 \times 10^{-9} \times 8 \times 10^{7}) = 14\), and it hides a region of \(25/(8 \times 10^{7})\) rad = 64 mas around the star, the inner working angle. Planets farther out are visible.</p>`,
    String.raw`These are scaling rules. The actual suppression depends on the petal shape, on manufacturing and deployment accurate to a fraction of a millimetre, and on sunlight scattered off the petal edges. The scalar Fresnel model used here also ignores polarisation and the thickness of the petals.`));
  root.append(theory('Casting a shadow ten billion times darker', String.raw`
<div class="theory-cols"><div>
<h3>Fresnel diffraction behind an occulter</h3>
<p>The starshade is in the Fresnel regime: its radius \(R\) and the distance \(z\) give a Fresnel number \(F = R^2/\lambda z\) of order 10, so the shadow is neither a geometric silhouette (\(F\to\infty\)) nor a far-field pattern (\(F\ll1\)). For a circularly symmetric screen that blocks a fraction \(A(r)\) of each circle, the field behind it relative to the unobstructed starlight is</p>
\[E(\rho) = 1 + \frac{2\pi i}{\lambda z}\,e^{i\pi\rho^2/\lambda z}\int_0^\infty A(r)\,e^{i\pi r^2/\lambda z}\,J_0\!\left(\frac{2\pi r\rho}{\lambda z}\right) r\,dr.\]
<p>For an opaque disk (\(A = 1\) for \(r\le R\)) the axial integral is elementary, \(E(0) = e^{i\pi F}\), so \(|E(0)|^2 = 1\) exactly: the centre of the shadow of any round object is as bright as if the object were not there. This is the Poisson–Arago spot, the dashed curve in the profile plot. A round occulter is useless; the edge must be soft.</p>
<h3>Apodisation by petals</h3>
<p>A smooth transmission profile that falls from 0 to 1 over many Fresnel zones makes the edge contributions cancel. A screen with graded grey transmission cannot be built to \(10^{-10}\) accuracy, but a binary screen can: \(N\) petals whose angular width at radius \(r\) is \(2\pi A(r)/N\) block exactly the fraction \(A(r)\) of each circle. The petals add terms in \(J_{N}, J_{2N},\dots\) which vanish near the axis as \((\pi r\rho/\lambda z)^N\), so 16–24 petals suffice over a telescope-sized region. Cash's hypergaussian</p>
\[A(r) = \exp\!\left[-\left(\frac{r-a}{b}\right)^n\right]\quad(r > a),\qquad A = 1\ (r\le a)\]
<p>gives suppression below \(10^{-10}\) over a broad band when \(a\), \(b\) and \(z\) are chosen so that \(F\lesssim 15\) at the longest wavelength. Numerically optimised profiles (Vanderbei, Cady and Kasdin) do better with smaller shades.</p>
</div><div>
<h3>The geometry in 3-D</h3>
<p>The 3-D view keeps the distances along the line of sight to scale and enlarges everything across it by one round factor, typically \(5\times10^5\). A 66 m starshade 80 000 km away subtends 170 mas, about the size of a coin seen from 15 km. Because both directions across are enlarged alike, angles are enlarged by the same factor and the line of sight that grazes the petal tips is the inner working angle \((a+b)/z\). The telescope sits deep inside the geometric shadow, a cylinder of radius \(a+b\). The coloured disc around the pupil is the computed shadow: the apodised petals keep the light that diffracts round the edge out of the centre, so the pupil sees \(10^{-10}\) or less where a plain disc would put the bright Poisson spot.</p>
<h3>The trade-offs</h3>
<p>Diffraction gets worse at long wavelengths (smaller \(F\), fewer zones over the petal), so the band's red end sets the size. The inner working angle, the smallest star–planet separation that is not covered, is about \((a+b)/z\). Moving the shade further away shrinks the IWA but lowers \(F\), and a larger shade restores \(F\) but must be built and flown to millimetre precision. Typical designs are 30–70 m across at 30 000–100 000 km, with IWAs of 60–100 mas, independent of telescope size. That is the main appeal: the telescope itself needs no coronagraph and no wavefront control.</p>
<h3>Numerical method and approximations</h3>
<p>The integral is taken in \(u = r^2\), where the Fresnel phase is linear. Each step integrates the phase exactly (Filon's midpoint rule), which makes the opaque core exact; one Richardson step removes the \(O(\Delta u^2)\) error left by \(J_0\) off axis. At 2000 steps the intensity has converged to better than \(10^{-14}\). Not included: the petal terms (see above), petal shape errors and edge scattering of sunlight, vector diffraction at the edges, and the finite size of the star (about 1 mas, much smaller than the shadow). Suppression is the area-weighted mean over the aperture; the planet's contrast in the image also depends on how the telescope spreads the leaked starlight.</p>
</div></div>`));
  root.append(references([
    'W. Cash, “Detection of Earth-like planets around nearby stars using a petal-shaped occulter”, <em>Nature</em> 442, 51 (2006).',
    'R. J. Vanderbei, E. Cady &amp; N. J. Kasdin, “Optimal occulter design for finding extrasolar planets”, <em>Astrophys. J.</em> 665, 794 (2007).',
    'S. B. Shaklan <em>et al.</em>, “Error budgeting and tolerancing of starshades for exoplanet detection”, <em>Proc. SPIE</em> 7731 (2010).',
    'S. Seager <em>et al.</em>, “Exo-S: Starshade probe-class exoplanet direct imaging mission concept”, final report, NASA/JPL (2015).',
    'M. Born &amp; E. Wolf, <em>Principles of Optics</em>, 7th ed., §8.8 (Fresnel diffraction, Lommel functions).',
  ]));

  return () => [shape, map, prof, spec, v3].forEach((x) => x.destroy());
}
