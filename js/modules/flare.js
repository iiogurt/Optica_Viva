import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { LENSES, paraxial, vertices, stopIndex } from '../lib/raytrace.js';
import { index } from '../lib/glass.js';
import { fresnel, stackReflectance, COATINGS } from '../lib/thinfilm.js';
import { spectralBasis, linspace, cmf, xyzToLinearRGB, gamutClip, oetf } from '../lib/color.js';
import { rasterAperture, psf, rescale } from '../lib/pupil.js';
import { plot, range } from '../lib/plot.js';

const LAMS = linspace(420, 680, 8);
const BASIS = spectralBasis(LAMS);

// Paraxial ghost tracing. State (y, w = n·u); media are signed (negative after an odd number of reflections).
function ghostMatrices(lens, lam, zImg) {
  const S = lens.surfaces, N = S.length;
  const m = (k) => (k < 0 ? 1 : index(S[k].glass, lam)); // medium after surface k
  const c = (k) => (isFinite(S[k].R) ? 1 / S[k].R : 0);
  const zv = vertices(lens), si = stopIndex(lens);
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  const T = (t, n) => [1, t / n, 0, 1];
  const Rf = (p) => [1, 0, -p, 1];
  const out = [];
  for (let j = 1; j < N; j++) for (let i = 0; i < j; i++) {
    let M = [1, 0, 0, 1], stopM = null;
    const atStop = (k) => { if (k === si && !stopM) stopM = M.slice(); };
    // forward to surface j
    for (let k = 0; k < j; k++) { atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); M = mul(T(S[k].t, m(k)), M); }
    atStop(j);
    M = mul(Rf(-2 * m(j - 1) * c(j)), M); // reflect at j, travelling in medium m(j−1)
    // backward to surface i
    for (let k = j - 1; k > i; k--) { M = mul(T(S[k].t, m(k)), M); atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); }
    M = mul(T(S[i].t, m(i)), M);
    atStop(i);
    M = mul(Rf(2 * m(i) * c(i)), M); // reflect at i, travelling backward in medium m(i)
    // forward to the image plane
    for (let k = i + 1; k < N; k++) { M = mul(T(S[k - 1].t, m(k - 1)), M); atStop(k); M = mul(Rf((m(k) - m(k - 1)) * c(k)), M); }
    M = mul(T(zImg - zv[N - 1], 1), M);
    if (!stopM) continue;
    out.push({ i, j, M, stopM });
  }
  return out;
}

// Residual reflection colour of a coating (under an equal-energy illuminant, normalised).
function coatingColour(layers, ns, th) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 400; l <= 700; l += 10) { const R = stackReflectance(layers, 1, ns, l, th).R; const [x, y, z] = cmf(l); X += R * x; Y += R * y; Z += R * z; }
  const rgb = gamutClip(xyzToLinearRGB([X, Y, Z]));
  const mx = Math.max(...rgb, 1e-9);
  return `rgb(${rgb.map((v) => Math.round(oetf(Math.max(0, v / mx)) * 255)).join(',')})`;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Every glass–air surface reflects a few per cent of the light that reaches it. Light reflected twice inside a lens travels on toward the sensor as a defocused, displaced image of the aperture: a ghost. Coatings suppress those reflections by thin-film interference, and the iris edges diffract the light source itself into a star. Drag the sun across the frame.', domains: ['photo', 'video', 'space'] }));

  const ctl = controls({
    lens: { type: 'select', label: 'Lens', value: 'double-gauss', options: [['double-gauss', 'Double-Gauss 100 mm (11 surfaces)'], ['cooke', 'Cooke triplet 50 mm (6 surfaces)']] },
    coat: { type: 'select', label: 'Coating on every glass–air surface', value: 'mgf2', options: Object.entries(COATINGS).map(([k, c]) => [k, c.name]) },
    stopdown: { type: 'range', label: 'Stop down', min: 1, max: 6, log: true, value: 2, fmt: (v) => '×' + v.toFixed(2) + ' N' },
    blades: { type: 'range', label: 'Iris blades', min: 5, max: 10, step: 1, value: 7 },
    ev: { type: 'range', label: 'Source brightness', min: 0, max: 8, step: 0.1, value: 4.5, unit: 'EV' },
    angle: { type: 'range', label: 'Incidence angle for coating plots', min: 0, max: 60, step: 1, value: 0, unit: '°' },
  }, () => recompute());
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 1.5, label: 'Drag the sun', draw: drawView, minH: 300 });
  const rplot = stage({ aspect: 1.5, label: '', draw: drawR, cls: 'plain' });
  const fplot = stage({ aspect: 1.5, label: '', draw: drawFresnel, cls: 'plain' });
  root.append(lab([view.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, rplot.el), h('div.card', { style: { padding: '6px' } }, fplot.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let sun = [0.68, 0.3];
  const move = (e) => { const r = view.canvas.getBoundingClientRect(); sun = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; view.redraw(); };
  let dragging = false;
  view.canvas.addEventListener('pointerdown', (e) => { dragging = true; view.canvas.setPointerCapture(e.pointerId); move(e); });
  view.canvas.addEventListener('pointermove', (e) => dragging && move(e));
  view.canvas.addEventListener('pointerup', () => (dragging = false));

  let G = null;
  const recompute = debounce(() => {
    const st = ctl.state, base = LENSES[st.lens];
    const lens = { ...base, epd: base.epd / st.stopdown };
    const par = paraxial(lens, 587.56);
    const layers = COATINGS[st.coat].layers(1.6);
    // per-surface reflectance per wavelength (coated if air on either side)
    const S = lens.surfaces;
    const Rsurf = S.map((s, k) => LAMS.map((l) => {
      const n1 = k === 0 ? 1 : index(S[k - 1].glass, l), n2 = index(s.glass, l);
      if (Math.abs(n1 - n2) < 1e-6) return 0;
      const glassN = Math.max(n1, n2);
      return n1 === 1 || n2 === 1 ? stackReflectance(st.coat === 'graded' ? COATINGS.graded.layers(glassN) : layers, 1, glassN, l, 0).R : fresnel(n1, n2, 0).R;
    }));
    const ghosts = [];
    LAMS.forEach((l, li) => {
      const pl = paraxial(lens, l);
      for (const g of ghostMatrices(lens, l, par.zImage)) {
        const R = Rsurf[g.i][li] * Rsurf[g.j][li];
        if (R < 1e-9) continue;
        const [A, B] = g.M, [C, D] = g.stopM;
        if (Math.abs(C) < 1e-9) continue;
        ghosts.push({ i: g.i, j: g.j, li, R, k: B - (A * D) / C, rho: Math.abs(A / C) * pl.stopR, flip: Math.sign(A / C) });
      }
    });
    const rEP = lens.epd / 2;
    const T = S.reduce((t, s, k) => t * (1 - Rsurf[k][3]), 1);
    const totalGhost = ghosts.filter((g) => g.li === 3).reduce((a, g) => a + g.R, 0);
    const brightest = ghosts.filter((g) => g.li === 3).map((g) => ({ ...g, E: g.R * (rEP / Math.max(g.rho, 0.05)) ** 2 })).sort((a, b) => b.E - a.E)[0];
    // starburst PSF of the polygonal iris (polychromatic, no aberration → exact λ-scaling)
    const n = 256, amp = rasterAperture({ type: 'polygon', blades: st.blades, curvature: 0 }, n, 48, 4);
    const I0 = psf(amp, null, n, 0.55).I;
    const Rr = new Float64Array(n * n), Gg = new Float64Array(n * n), Bb = new Float64Array(n * n);
    LAMS.forEach((l, li) => { const I = rescale(I0, n, l / 550); const [r, g, b] = BASIS[li]; for (let q = 0; q < n * n; q++) { Rr[q] += I[q] * r; Gg[q] += I[q] * g; Bb[q] += I[q] * b; } });
    let mx = 0; for (let q = 0; q < n * n; q++) mx = Math.max(mx, Gg[q]);
    const star = imageCanvas(n, n);
    for (let q = 0; q < n * n; q++) {
      const L = (0.2126 * Rr[q] + 0.7152 * Gg[q] + 0.0722 * Bb[q]) / mx;
      const rr = Math.hypot((q % n) - n / 2, Math.floor(q / n) - n / 2) / (n / 2);
      const win = rr < 1 ? Math.cos((Math.PI / 2) * rr) ** 2 : 0; // smooth fade so the field edge never shows
      const t = Math.max(0, 1 + Math.log10(L + 1e-12) / 4.5) * win;
      const s = t / Math.max(L, 1e-12) / mx;
      star.data[q * 4] = Math.min(255, oetf(Math.min(1, Rr[q] * s)) * 255);
      star.data[q * 4 + 1] = Math.min(255, oetf(Math.min(1, Gg[q] * s)) * 255);
      star.data[q * 4 + 2] = Math.min(255, oetf(Math.min(1, Bb[q] * s)) * 255);
      star.data[q * 4 + 3] = 255;
    }
    star.put();
    G = { lens, par, ghosts, rEP, st: { ...st }, Rsurf, T, totalGhost, brightest, star: star.c };
    const nGlassAir = Rsurf.filter((r) => r[3] > 0).length;
    ro.replaceChildren(readouts([
      ['Reflecting surfaces k', String(nGlassAir)],
      ['Two-reflection ghost paths k(k−1)/2', String((nGlassAir * (nGlassAir - 1)) / 2)],
      ['Mean surface reflectance (550 nm)', (Rsurf.filter((r) => r[3] > 0).reduce((a, r) => a + r[3], 0) / nGlassAir * 100).toFixed(2) + ' %'],
      ['Lens transmission Π(1−R)', (T * 100).toFixed(1) + ' %'],
      ['Total ghost energy / signal', (totalGhost * 100).toFixed(3) + ' %'],
      ['Brightest ghost (surfaces)', brightest ? `${brightest.i + 1} & ${brightest.j + 1}` : '—'],
      ['Working f-number', 'f/' + par.fnum.toFixed(1)],
    ]));
    const Rm = Rsurf[0][3];
    calc.set(String.raw`\begin{aligned}
    R_\perp &= \left(\tfrac{n_1-n_2}{n_1+n_2}\right)^2\\
    R_1(550) &= ${texNum(Rm * 100, 3)}\,\%\\
    E_g/E_\text{src} &\approx R_iR_j\,(r_{EP}/\rho_g)^2\\
    \rho_g &= |A/C|\,r_\text{stop}\\
    \mathbf y_g &= (B - AD/C)\,\theta\\
    T &= \textstyle\prod_k(1 - R_k) = ${texNum(T * 100, 3)}\,\%
    \end{aligned}`);
    view.redraw(); rplot.redraw(); fplot.redraw();
  }, 40);

  function drawView(ctx, w, hh) {
    // dusk landscape
    const sky = ctx.createLinearGradient(0, 0, 0, hh);
    sky.addColorStop(0, '#0d1630'); sky.addColorStop(0.55, '#3a3350'); sky.addColorStop(0.75, '#a8665a'); sky.addColorStop(1, '#2b1d1d');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#0b0b10'; ctx.beginPath(); ctx.moveTo(0, hh);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, hh * 0.74 - 30 * Math.sin(x / 90) - 18 * Math.sin(x / 31 + 2) - (x > w * 0.6 && x < w * 0.66 ? 60 : 0));
    ctx.lineTo(w, hh); ctx.fill();
    if (!G) return;
    const st = G.st;
    // sensor 36 × 24 mm mapped to the canvas; field angle from sun position
    const mmpx = w / 36;
    const cx = w / 2, cy = hh / 2;
    const ys = [(sun[0] * w - cx) / mmpx, (cy - sun[1] * hh) / mmpx]; // image position of the sun (mm)
    const th = [ys[0] / G.par.efl, ys[1] / G.par.efl]; // paraxial field angle (rad)
    // calibration: an MgF₂-coated ghost (R_iR_j ≈ 1.6e-4) as large as the entrance pupil → ≈10 % at 4.5 EV
    const gain = Math.pow(2, st.ev) * 28;
    // veiling glare: scattered + ghost energy spread broadly
    const veil = Math.min(0.45, G.totalGhost * gain * 0.08 + 0.015 * Math.pow(2, st.ev - 6));
    const vg = ctx.createRadialGradient(sun[0] * w, sun[1] * hh, 0, sun[0] * w, sun[1] * hh, Math.max(w, hh));
    vg.addColorStop(0, `rgba(255,220,180,${veil})`); vg.addColorStop(1, `rgba(255,220,180,${veil * 0.25})`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, hh);
    // ghosts
    const sector = (2 * Math.PI) / st.blades;
    for (const g of G.ghosts) {
      const gx = cx + g.k * th[0] * mmpx, gy = cy - g.k * th[1] * mmpx;
      const rpx = Math.max(1.2, g.rho * mmpx);
      const E = g.R * (G.rEP / Math.max(g.rho, 1.2 / mmpx)) ** 2 * gain / LAMS.length;
      if (E < 0.002) continue;
      const a = Math.min(1, E);
      const [r, gg, b] = BASIS[g.li].map((v) => v * LAMS.length);
      ctx.fillStyle = `rgba(${Math.min(255, r * 255) | 0},${Math.min(255, gg * 255) | 0},${Math.min(255, b * 255) | 0},${a})`;
      ctx.beginPath();
      for (let k = 0; k <= st.blades; k++) {
        const ang = Math.PI / 2 + k * sector + (g.flip < 0 ? Math.PI : 0);
        const px = gx + rpx * Math.cos(ang), py = gy - rpx * Math.sin(ang);
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.fill();
    }
    // the sun: polychromatic diffraction starburst of the iris; its angular size scales with N
    const S = Math.min(w, hh) * (0.22 + 0.035 * G.par.fnum) * Math.min(1.5, 0.5 + st.ev / 8);
    ctx.globalAlpha = 1;
    ctx.drawImage(G.star, sun[0] * w - S / 2, sun[1] * hh - S / 2, S, S);
    const core = ctx.createRadialGradient(sun[0] * w, sun[1] * hh, 0, sun[0] * w, sun[1] * hh, 26);
    core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.4, 'rgba(255,240,210,0.8)'); core.addColorStop(1, 'rgba(255,200,150,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sun[0] * w, sun[1] * hh, 26, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // optical axis guide
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(sun[0] * w, sun[1] * hh); ctx.lineTo(2 * cx - sun[0] * w, 2 * cy - sun[1] * hh); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawR(ctx, w, hh) {
    if (!G) return;
    const th = (G.st.angle * Math.PI) / 180, ls = range(380, 780, 81);
    const series = Object.entries(COATINGS).map(([k, c], i) => ({ data: ls.map((l) => [l, stackReflectance(c.layers(1.52), 1, 1.52, l, th).R * 100]), color: ['#9aa1b5', '#6be3a4', '#6ad7ff', '#ffb547'][i], width: k === G.st.coat ? 2.6 : 1.3, label: c.name.split(' (')[0] }));
    const { X, Y } = plot(ctx, w, hh, { title: `One surface on n = 1.52 at ${G.st.angle}°`, x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: 0.01, max: 10, log: true, label: 'R (%)' }, series, legend: true, legendX: w - 180, legendY: hh - 100 });
    // residual colour swatch of the selected coating
    if (G.st.coat !== 'none') {
      ctx.fillStyle = coatingColour(COATINGS[G.st.coat].layers(1.52), 1.52, th);
      ctx.beginPath(); ctx.arc(w - 22, 13, 8, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('tint', w - 34, 17);
    }
  }

  function drawFresnel(ctx, w, hh) {
    const n2 = 1.52, a = range(0, 89.9, 200);
    const fr = a.map((d) => fresnel(1, n2, (d * Math.PI) / 180));
    const B = (Math.atan(n2) * 180) / Math.PI;
    plot(ctx, w, hh, {
      title: 'Fresnel reflection, air → glass (uncoated)', x: { min: 0, max: 90, label: 'angle of incidence (°)' }, y: { min: 0, max: 1, label: 'reflectance' },
      series: [{ data: a.map((d, i) => [d, fr[i].Rs]), color: '#6ad7ff', width: 2, label: 'R_s (TE)' }, { data: a.map((d, i) => [d, fr[i].Rp]), color: '#ffb547', width: 2, label: 'R_p (TM)' }, { data: a.map((d, i) => [d, fr[i].R]), color: 'rgba(255,255,255,0.5)', width: 1.2, dash: [4, 3], label: 'unpolarised' }],
      vlines: [{ x: B, color: '#c18cff', label: `Brewster ${B.toFixed(1)}°` }], legend: true,
    });
  }

  recompute();

  root.append(theory('Stray light: reflections, ghosts and coatings', String.raw`
<div class="theory-cols"><div>
<h3>Fresnel reflection</h3>
<p>The boundary conditions of Maxwell's equations at an interface give the amplitude reflection coefficients</p>
\[r_s = \frac{n_1\cos\theta_1 - n_2\cos\theta_2}{n_1\cos\theta_1 + n_2\cos\theta_2},\qquad r_p = \frac{n_2\cos\theta_1 - n_1\cos\theta_2}{n_2\cos\theta_1 + n_1\cos\theta_2}.\]
<p>At normal incidence \(R = ((n_1-n_2)/(n_1+n_2))^2\), which is 4.3 % for crown glass and 8 % for a dense flint. \(R_p\) vanishes at Brewster's angle \(\tan\theta_B = n_2/n_1\), which is why polarising filters cut glare from water and glass.</p>
<h3>Ghost images</h3>
<p>A lens with \(k\) reflecting surfaces has \(k(k-1)/2\) paths with exactly two reflections. Each one forms an image of the bright source, usually far out of focus. Paraxially, each path is just another \(2\times2\) system matrix. A reflection is a refraction into the medium \(-n\), with power \(\phi = -2nc\). Writing the ghost system's matrix from the entrance pupil to the sensor as \(\begin{psmallmatrix}A&B\\C'&D'\end{psmallmatrix}\), and the map from the entrance pupil to its pass through the stop as \(y_s = Cy + D\theta\), the ghost of a source at field angle \(\theta\) is</p>
\[\mathbf y_g = \left(B - \tfrac{AD}{C}\right)\theta,\qquad \rho_g = \left|\tfrac{A}{C}\right|r_\text{stop}.\]
<p>It is a scaled, possibly inverted, image of the iris polygon, centred on the line through the source and the image centre. Its irradiance relative to the source flux is \(R_iR_j\,(r_{EP}/\rho_g)^2\). Ghosts that happen to focus near the sensor (\(\rho_g\to0\)) become intense points, the most objectionable kind. The method is that of Hullin et al. (2011), evaluated separately at 8 wavelengths, so dispersion gives the ghosts their coloured fringes.</p>
</div><div>
<h3>Anti-reflection coatings: the characteristic matrix</h3>
<p>A layer of index \(n_j\) and thickness \(d_j\) has the characteristic matrix</p>
\[\mathbf M_j = \begin{pmatrix}\cos\delta_j & \frac{i}{\eta_j}\sin\delta_j\\ i\eta_j\sin\delta_j & \cos\delta_j\end{pmatrix},\quad \delta_j = \frac{2\pi n_jd_j\cos\theta_j}{\lambda},\]
<p>with \(\eta_j = n_j\cos\theta_j\) (s) or \(n_j/\cos\theta_j\) (p). Then \(\begin{psmallmatrix}B\\C\end{psmallmatrix} = \prod\mathbf M_j\begin{psmallmatrix}1\\\eta_s\end{psmallmatrix}\) and \(R = \left|\frac{\eta_0B - C}{\eta_0B + C}\right|^2\). A single quarter-wave layer zeroes reflection when \(n_1 = \sqrt{n_0n_s}\approx1.23\). MgF₂ (1.38) is the closest durable material and leaves 1.3 %. Multilayers broaden and deepen the minimum. Graded-index nanostructures (Canon SWC, Nikon Nano Crystal, moth-eye surfaces) remove the abrupt interface altogether, so reflection stays low even at steep angles. The residual reflection is coloured, which is why lens fronts glint green or magenta (see the tint swatch).</p>
<h3>Diffraction star and veiling glare</h3>
<p>The sun's star is the Fraunhofer pattern of the iris polygon, computed by FFT for 8 wavelengths. An odd blade count gives \(2n\) spikes. Light scattered by surface roughness, dust, and the ground glass edges and barrel interior adds a broad <em>veiling glare</em> that lifts the shadows and cuts contrast. In space telescopes, the same physics is fought with baffles, black coatings and super-polished mirrors. Stray light from the Sun and Earth is a primary design driver for JWST's sunshield and for coronagraphs.</p>
</div></div>`));
  root.append(references([
    'M. B. Hullin, E. Eisemann, H.-P. Seidel &amp; S. Lee, "Physically-based real-time lens flare rendering", ACM TOG 30(4), 108 (2011).',
    'H. A. Macleod, <i>Thin-Film Optical Filters</i>, 5th ed., CRC Press (2018).',
    'W. H. Southwell, "Gradient-index antireflection coatings", Opt. Lett. 8, 584 (1983).',
    'E. Hecht, <i>Optics</i>, 5th ed. (2017), §4.6: Fresnel equations.',
    'S. Lee &amp; E. Eisemann, "Practical real-time lens-flare rendering", Comput. Graph. Forum 32(4) (2013).',
  ]));
  return () => [view, rplot, fplot].forEach((s) => s.destroy());
}
