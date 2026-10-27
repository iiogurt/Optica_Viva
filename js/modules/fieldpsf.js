import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { twoMirror, conics, seidelTwoMirror, fieldPoly, rmsPoly, astigNodes, sum, THREF } from '../lib/fieldpsf.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno'), VIR = lut('viridis');
const TELS = {
  hubble: { name: 'Hubble-like: 2.4 m, f/24, primary f/2.3', D: 2.4, N: 24, N1: 2.3, b: 1.5, eps: 0.33 },
  amateur: { name: 'Observatory RC: 0.4 m, f/8, primary f/3', D: 0.4, N: 8, N1: 3, b: 0.25, eps: 0.42 },
};
const FORMS = { cassegrain: 'Classical Cassegrain', rc: 'Ritchey–Chrétien', dk: 'Dall–Kirkham' };
const ARCMIN = Math.PI / 180 / 60;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A telescope is sharpest in the middle of its view. Away from the centre, stars gradually turn into small comets, crosses or blobs, because mirrors that are perfect on the axis cannot also be perfect at an angle. Designers choose mirror shapes that keep the sharp area as large as possible.</p>
<p>The mirrors must also stay in place to within a few thousandths of a millimetre. Shift the small secondary mirror slightly and the sharpest spot moves away from the centre, or splits in two. Hubble's famous flaw was a main mirror polished to a very slightly wrong shape.</p>`, [
    "Compare <strong>Classical Cassegrain</strong> and <strong>Ritchey–Chrétien</strong>: the RC keeps stars round much farther from the centre.",
    "Set the <strong>Secondary decentre</strong> to 100 µm: the best-corrected point moves off centre and the astigmatism splits around two points.",
    "Press the <strong>Hubble 1990</strong> button: every star in the field is blurred by the primary mirror's wrong shape.",
  ]));

  const ctl = controls({
    tel: { type: 'select', label: 'Telescope', value: 'hubble', options: Object.entries(TELS).map(([k, t]) => [k, t.name]) },
    form: { type: 'seg', label: 'Design', value: 'rc', options: Object.entries(FORMS).map(([k, t]) => [k, t]) },
    field: { type: 'range', label: 'Half-width of the field shown', min: 0.5, max: 15, step: 0.5, value: 4, unit: "'" },
    lam: { type: 'range', label: 'Wavelength', min: 400, max: 1600, step: 10, value: 600, unit: 'nm' },
    curved: { type: 'toggle', label: 'Detector on the medial focal surface (else flat)', value: true },
    hd: { type: 'heading', label: 'Errors' },
    dK: { type: 'range', label: 'Primary conic error ΔK₁', min: -0.02, max: 0.02, step: 0.0005, value: 0, fmt: (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(4) },
    dz: { type: 'range', label: 'Secondary despace (towards the primary)', min: -300, max: 300, step: 1, value: 0, unit: 'µm' },
    dx: { type: 'range', label: 'Secondary decentre', min: -200, max: 200, step: 2, value: 0, unit: 'µm' },
    tx: { type: 'range', label: 'Secondary tilt', min: -60, max: 60, step: 1, value: 0, unit: '″' },
  }, () => update());
  const hubble = h('button.btn', { type: 'button', onclick: () => { ctl.set.tel('hubble'); ctl.set.form('rc'); ctl.set.dK(-0.0116); ctl.set.dz(0); ctl.set.dx(0); ctl.set.tx(0); update(); } }, t('Hubble in 1990: K₁ = −1.0139'));
  const ro = h('div');
  const calc = liveCalc();
  const mosaic = stage({ aspect: 1, label: 'PSFs across the field, with Strehl', draw: drawMosaic, minH: 260 });
  const map = stage({ aspect: 1, label: 'RMS wavefront error over the field', draw: drawMap, minH: 260 });
  const curve = stage({ aspect: 2.2, label: '', draw: drawCurve, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing PSFs in the worker…'));
  root.append(lab([h('div.grid-2', {}, mosaic.el, map.el), note, h('div.card', { style: { padding: '6px' } }, curve.el)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, hubble)), h('div.card', {}, ro), calc.el]));

  const job = latest('fieldPSF');
  let R = null, S = null;
  function model(st) {
    const T = TELS[st.tel], t = twoMirror(T), c = conics(t, st.form), K1 = c.K1 + st.dK, sd = seidelTwoMirror(t, K1, c.K2, st.dz * 1e-6);
    const mis = { dx: st.dx * 1e-6, dy: 0, tx: (st.tx / 206265), ty: 0 };
    return { T, t, K1, K2: c.K2, sd, mis, hmax: (st.field * ARCMIN) / THREF };
  }
  function update() {
    const st = ctl.state;
    S = model(st);
    const { T, t: tel, K1, K2, sd, mis, hmax } = S, lam = st.lam * 1e-9; // tel: the two-mirror design (t is the translator)
    // field map: RMS on a grid, computed here (polynomial, cheap)
    const G = 41, rms = new Float64Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) rms[j * G + i] = rmsPoly(fieldPoly(sd, [(-1 + (2 * i) / (G - 1)) * hmax, (1 - (2 * j) / (G - 1)) * hmax], mis, st.curved), T.eps, 12, 24);
    S.map = { G, rms };
    S.nodes = astigNodes(sd, mis);
    const b0 = fieldPoly(sd, [0, 0], mis).b, b1 = fieldPoly(sd, [1, 0], mis).b, w131 = b1[0] - b0[0];
    S.comaZero = Math.abs(w131) > 1e-15 ? [-b0[0] / w131, -b0[1] / w131] : null;
    const W = (k, f) => sum(sd, k) / f, ub = st.field * ARCMIN / THREF;
    const lamD = (lam / T.D) * 206265e3;
    ro.replaceChildren(readouts([
      ['Conic constants K₁, K₂', `${K1.toFixed(4)}, ${K2.toFixed(3)}`],
      ['Secondary: magnification, distance', `${tel.m.toFixed(2)}, ${tel.d.toFixed(3)} m`],
      ['Diffraction limit λ/D', lamD.toFixed(1) + ' mas'],
      ['Diffraction-limited field (RMS < λ/14)', dlField(st, lam) ],
      ['Coma-free point', S.comaZero ? `(${(S.comaZero[0] * THREF / ARCMIN).toFixed(1)}′, ${(S.comaZero[1] * THREF / ARCMIN).toFixed(1)}′)` : 'none: coma is the same everywhere'],
    ]));
    calc.say(`Stars are diffraction-limited (RMS error below λ/14) over a field of <strong>${dlField(st, lam)}</strong>; the diffraction limit itself is ${lamD.toFixed(1)} mas.`);
    calc.set(String.raw`\begin{aligned}
    W_{040} &= \tfrac18 S_I = ${texNum(W('SI', 8) * 1e9, 3)}\ \text{nm}\\
    W_{131} &= \tfrac12 S_{II}\,H = ${texNum(W('SII', 2) * ub * 1e9, 3)}\ \text{nm}\\
    W_{222} &= \tfrac12 S_{III}\,H^2 = ${texNum(W('SIII', 2) * ub * ub * 1e9, 3)}\ \text{nm}\\
    W_{220} &= \tfrac14 S_{IV}\,H^2 = ${texNum(W('SIV', 4) * ub * ub * 1e9, 3)}\ \text{nm}\\
    &\quad(H = ${texNum(st.field, 3)}'\text{, field edge})
    \end{aligned}`);
    map.redraw(); curve.redraw();
    note.textContent = t('Computing PSFs in the worker…');
    job('fieldPSF', { tel, K1, K2, dz: st.dz * 1e-6, mis, field: st.field * ARCMIN, grid: 5, lam, eps: T.eps, spiders: 4, n: 128, Dpx: 48, crop: 64, curved: st.curved }).then((r) => {
      R = r;
      const alias = Math.max(...r.pts.map((p) => p.grad)) > 0.5;
      note.textContent = t('5 × 5 field points, ±{f}′. Each stamp spans {s} λ/D; Strehl relative to the unaberrated pupil.', { f: st.field, s: (64 * 48 / 128).toFixed(0) }) + (alias ? ' ' + t('Some wavefronts are too steep to sample even at 96 pupil pixels (over half a wave per pixel): those PSFs are only indicative.') : '');
      mosaic.redraw();
    });
  }
  function dlField(st, lam) {
    // largest field radius along +x (aligned, current detector) with RMS below λ/14
    const sd = S.sd;
    let lo = 0;
    for (let a = 0.05; a <= 60; a += 0.05) { if (rmsPoly(fieldPoly(sd, [(a * ARCMIN) / THREF, 0], S.mis, st.curved), S.T.eps, 12, 24) > lam / 14) break; lo = a; }
    return lo >= 60 ? '> 60′' : lo ? `±${lo.toFixed(2)}′` : 'none';
  }
  function drawMosaic(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const g = 5, C = R.pts[0].C, ic = imageCanvas(C * g, C * g);
    R.pts.forEach((p, k) => {
      const gi = k % g, gj = Math.floor(k / g);
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const v = p.I[y * C + x], L = Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-6)) + 4) / 4)), c = Math.round(255 * L) * 3, o = ((gj * C + y) * C * g + gi * C + x) * 4;
        ic.data[o] = INF[c]; ic.data[o + 1] = INF[c + 1]; ic.data[o + 2] = INF[c + 2]; ic.data[o + 3] = 255;
      }
    });
    ic.put();
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2, cs = sz / g;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, x0, y0, sz, sz);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let k = 1; k < g; k++) { ctx.beginPath(); ctx.moveTo(x0 + k * cs, y0); ctx.lineTo(x0 + k * cs, y0 + sz); ctx.moveTo(x0, y0 + k * cs); ctx.lineTo(x0 + sz, y0 + k * cs); ctx.stroke(); }
    ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    R.pts.forEach((p, k) => ctx.fillText(p.strehl.toFixed(2), x0 + (k % g) * cs + 4, y0 + Math.floor(k / g) * cs + cs - 5));
  }
  function drawMap(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!S) return;
    const { G, rms } = S.map, lam = ctl.state.lam * 1e-9, top = Math.max(lam / 28, ...rms), ic = imageCanvas(G, G);
    for (let k = 0; k < G * G; k++) {
      const v = Math.min(1, rms[k] / top), c = Math.round(255 * v) * 3;
      ic.data[k * 4] = VIR[c]; ic.data[k * 4 + 1] = VIR[c + 1]; ic.data[k * 4 + 2] = VIR[c + 2]; ic.data[k * 4 + 3] = 255;
    }
    ic.put();
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2, hmax = S.hmax;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, x0, y0, sz, sz);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, 26); // keeps the stage label readable
    // diffraction-limited contour: mark cells below λ/14
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const cell = sz / G;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i, inside = rms[k] < lam / 14;
      if (i < G - 1 && inside !== rms[k + 1] < lam / 14) ctx.fillRect(x0 + (i + 1) * cell - 1, y0 + j * cell + cell / 2 - 1, 2, 2);
      if (j < G - 1 && inside !== rms[k + G] < lam / 14) ctx.fillRect(x0 + i * cell + cell / 2 - 1, y0 + (j + 1) * cell - 1, 2, 2);
    }
    const P = (H) => [x0 + sz / 2 + (H[0] / hmax) * (sz / 2), y0 + sz / 2 - (H[1] / hmax) * (sz / 2)];
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2;
    for (const n of S.nodes) {
      const [px, py] = P(n);
      if (px < x0 - 4 || px > x0 + sz + 4 || py < y0 - 4 || py > y0 + sz + 4) continue;
      ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6); ctx.moveTo(px - 6, py + 6); ctx.lineTo(px + 6, py - 6); ctx.stroke();
    }
    if (S.comaZero) { const [px, py] = P(S.comaZero); ctx.strokeStyle = '#6ad7ff'; ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.lineWidth = 1;
    const lbl = `0 … ${(top * 1e9).toFixed(0)} nm · × astig. nodes · ○ coma zero · dots λ/14`;
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(lbl).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(lbl, 8, hh - 9);
  }
  function drawCurve(ctx, w, hh) {
    if (!S) return;
    const st = ctl.state, T = S.T, t = S.t, lam = st.lam * 1e-9, fmax = Math.max(st.field * 1.5, 1), xs = Array.from({ length: 80 }, (_, i) => (fmax * (i + 0.5)) / 80);
    const colors = { cassegrain: '#6ad7ff', rc: '#ffb547', dk: '#c58bff' };
    const series = Object.keys(FORMS).map((f) => {
      const c = conics(t, f), sd = seidelTwoMirror(t, c.K1, c.K2);
      return { data: xs.map((a) => [a, Math.max(1, rmsPoly(fieldPoly(sd, [(a * ARCMIN) / THREF, 0], {}, st.curved), T.eps, 12, 24) * 1e9)]), color: colors[f], width: f === st.form ? 2.4 : 1.3, label: FORMS[f] + ' (aligned)' };
    });
    series.push({ data: xs.map((a) => [a, Math.max(1, rmsPoly(fieldPoly(S.sd, [(a * ARCMIN) / THREF, 0], S.mis, st.curved), T.eps, 12, 24) * 1e9)]), color: '#fff', width: 1.6, dash: [5, 3], label: 'current, with errors' });
    plot(ctx, w, hh, {
      title: 'RMS wavefront error along the field (+x)', x: { min: 0, max: fmax, label: 'field angle (arcmin)' }, y: { min: 1, max: 1e4, log: true, label: 'RMS (nm)' },
      series, hlines: [{ y: (lam / 14) * 1e9, color: 'rgba(120,230,160,0.6)' }], vlines: [{ x: st.field, color: 'rgba(255,255,255,0.25)' }],
      legend: true, legendX: w - 250, legendY: hh - 112,
    });
  }

  update();

  root.append(rule(String.raw`\[W_\text{coma} \propto H,\qquad W_\text{astigmatism} \propto H^2\]
<p>Coma grows in proportion to the field angle \(H\), astigmatism and field curvature with its square: twice as far from the axis, the comet tails double but the astigmatic blur quadruples. A classical Cassegrain is free of spherical aberration only; a Ritchey–Chrétien also removes coma, so its leftover astigmatism takes over only farther out. That is why Hubble, Keck and most large modern telescopes are Ritchey–Chrétiens.</p>`,
    String.raw`These are third-order (Seidel) laws, accurate for the small fields of large telescopes. Wide fields add higher orders, misaligned mirrors add terms centred away from the axis (nodal aberration theory, used on this page), and the shape and tilt of the detector decide which field points are in focus.`));
  root.append(theory('Aberrations across the field', String.raw`
<div class="theory-cols"><div>
<h3>Third-order aberrations, mirror by mirror</h3>
<p>A paraxial marginal ray \((y, u)\) and chief ray \((\bar y, \bar u)\) traced through the telescope give, at each mirror, the refraction invariants \(A = n(u + yc)\) and \(\bar A = n(\bar u + \bar y c)\). A mirror is a refraction into \(n' = -n\). The Seidel sums of the spherical surface are</p>
\[S_I = -A^2 y\,\Delta\!\left(\tfrac un\right),\quad S_{II} = -A\bar A y\,\Delta\!\left(\tfrac un\right),\quad S_{III} = -\bar A^2 y\,\Delta\!\left(\tfrac un\right),\quad S_{IV} = -\mathcal H^2 c\,\Delta\!\left(\tfrac1n\right),\]
<p>and a conic constant \(K\) adds \(\delta S_I = K c^3\,\Delta n\,y^4\) with \(\delta S_{II} = \delta S_I\,\bar y/y\) and \(\delta S_{III} = \delta S_I\,(\bar y/y)^2\). The wavefront at normalised pupil \(\boldsymbol\rho\) and field \(\mathbf H\) is</p>
\[W = \tfrac18 S_I\rho^4 + \tfrac12 S_{II}(\mathbf H\cdot\boldsymbol\rho)\rho^2 + \tfrac12 S_{III}(\mathbf H\cdot\boldsymbol\rho)^2 + \tfrac14 S_{IV}H^2\rho^2.\]
<p>A classical Cassegrain has a parabolic primary, so \(S_I = 0\), but it keeps the coma of a paraboloid of the same focal length. Ritchey and Chrétien chose both conics to cancel \(S_I\) and \(S_{II}\). For Hubble's first-order layout this gives \(K_1 = -1.0023\), \(K_2 = -1.497\), the values it was built to. A Dall–Kirkham uses a spherical secondary, which is easy to make, and pays with several times the coma. What remains in an RC is astigmatism, growing as \(H^2\), and field curvature, which instruments remove by refocusing or with field flatteners (the detector toggle).</p>
</div><div>
<h3>Misalignment: nodal aberration theory</h3>
<p>When the secondary is decentred or tilted, each surface's aberration field is centred on its own point \(\boldsymbol\sigma_j\), and \(\mathbf H\) becomes \(\mathbf H - \boldsymbol\sigma_j\) in that surface's terms (Thompson 2005). For the sphere, \(\boldsymbol\sigma = n c\,\boldsymbol\delta_\text{CoC}/\bar A\), set by the displacement of its centre of curvature. For the conic cap, \(\boldsymbol\sigma = \boldsymbol\delta_\text{vertex}/\bar y\). Because an RC has \(\sum W_{131} = 0\), a decentred secondary leaves coma that is the <em>same at every field point</em>. Astigmatism, a quadratic in \(\mathbf H\), acquires two zeros, the <em>binodal</em> pattern. Both are what wavefront sensing across the field of a real observatory reveals.</p>
<h3>Hubble's spherical aberration</h3>
<p>Hubble's primary was polished to \(K_1 = -1.0139\) instead of \(-1.0023\): 2.2 µm too flat at the edge. Doubled on reflection, this gives \(W_{040}\approx 4.5\) µm, about 0.3 µm RMS at best focus, and the core of the PSF lost most of its light. Press the button and refocus with the despace slider (best focus is near +190 µm, where defocus balances \(W_{040}\)): the Strehl never recovers. COSTAR and WFPC2 corrected it in 1993 with optics that had the opposite spherical aberration.</p>
<h3>Approximations</h3>
<p>Third order only. Fifth-order terms matter in fast systems and at large fields, and a three-mirror anastigmat (JWST, Roman) cancels \(S_I\)–\(S_{III}\), leaving higher orders and manufacturing residuals. STPSF therefore interpolates measured and modelled Zernike maps across each instrument. Monochromatic scalar FFT PSFs; distortion and pointing shifts are removed, so every stamp is centred; no detector sampling or jitter.</p>
</div></div>`));
  root.append(references([
    'W. T. Welford, <em>Aberrations of Optical Systems</em>, Adam Hilger (1986), ch. 8.',
    'D. J. Schroeder, <em>Astronomical Optics</em>, 2nd ed., Academic Press (2000), ch. 6 and 9.',
    'K. P. Thompson, “Description of the third-order optical aberrations of near-circular pupil optical systems without symmetry”, <em>J. Opt. Soc. Am. A</em> 22, 1389 (2005).',
    'L. Allen <em>et al.</em>, <em>The Hubble Space Telescope Optical Systems Failure Report</em>, NASA TM-103443 (1990).',
    'M. D. Perrin <em>et al.</em>, “Updated point spread function simulations for JWST with WebbPSF”, <em>Proc. SPIE</em> 9143, 91433X (2014).',
  ]));

  return () => [mosaic, map, curve].forEach((x) => x.destroy());
}
