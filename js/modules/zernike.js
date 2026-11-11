import { h, controls, stage, readouts, debounce, texNum } from '../lib/ui.js';
import { paint, paintMap, catmull, bilinear, toe, edge, keyOf } from '../lib/pixels.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { rasterAperture, ZERNIKE_NAMES } from '../lib/pupil.js';
import { lut } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { view3d } from '../lib/gl3d.js';
import { wavefrontMesh, psfMesh, ring } from '../lib/surf3d.js';
import { t } from '../lib/i18n.js';

const MODES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 22];
const PRESETS = {
  clean: { label: 'Diffraction-limited (≈ λ/20)', c: { 4: 0.02, 6: 0.03, 8: 0.02, 11: 0.02 } },
  astig: { label: 'Astigmatism 0.25 λ', c: { 6: 0.25 } },
  coma: { label: 'Coma 0.25 λ', c: { 8: 0.25 } },
  trefoil: { label: 'Trefoil 0.2 λ (mount stress)', c: { 10: 0.2 } },
  spherical: { label: 'Spherical 0.2 λ', c: { 11: 0.2 } },
  hubble: { label: 'Hubble 1990 flaw (Z₁₁ ≈ −0.27 µm @ 550 nm)', c: { 11: -0.49 } },
  mix: { label: 'Typical mixed (camera lens off-axis)', c: { 4: 0.05, 6: 0.12, 8: 0.15, 11: 0.06, 10: 0.04 } },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>A perfect lens turns the light from a star into a perfectly curved wave that closes down to a sharp point. A real lens dents that wave by tiny amounts, often less than a thousandth of a millimetre, and the dents decide how sharp the image is.</p>
<p>Opticians describe the dents as a mix of standard shapes, much as a sound can be described as a mix of pure tones. Each shape has a name and a typical look: <strong>defocus</strong> blurs evenly, <strong>astigmatism</strong> stretches stars into lines, <strong>coma</strong> gives them comet tails. Add the shapes up and you can predict the whole image.</p>`, [
    "Choose the <strong>Custom</strong> preset with every coefficient at 0, then raise only <strong>Z4 defocus</strong> to 0.1: the star stays round but dims. Now give the same amount to a coma term instead.",
    "Raise one coefficient until the Strehl ratio drops below 0.8. Try another term: the limit is about the same RMS, roughly 0.075 waves, whatever the shape.",
    "In the JWST section below, step through the <strong>commissioning steps</strong>: 18 separate mirror segments become one telescope.",
  ]));

  const spec = { preset: { type: 'select', label: 'Preset', value: 'mix', options: [['custom', 'Custom'], ...Object.entries(PRESETS).map(([k, p]) => [k, p.label])] } };
  spec.h1 = { type: 'heading', label: 'Zernike coefficients (waves RMS, Noll)' };
  for (const j of MODES) spec['z' + j] = { type: 'range', label: `Z${j} ${ZERNIKE_NAMES[j]}`, min: -0.6, max: 0.6, step: 0.005, value: PRESETS.mix.c[j] || 0, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(3) };
  spec.h2 = { type: 'heading', label: 'Display' };
  spec.tilt = { type: 'range', label: 'Interferometer tilt fringes', min: 0, max: 12, step: 0.5, value: 5 };
  spec.log = { type: 'toggle', label: 'Log PSF display', value: true };
  let applying = false;
  const ctl = controls(spec, (s) => {
    if (!applying && s.preset !== 'custom' && s.preset !== lastPreset) {
      applying = true;
      for (const j of MODES) ctl.set['z' + j](PRESETS[s.preset].c[j] || 0);
      applying = false;
    } else if (!applying && s.preset === lastPreset && s.preset !== 'custom') {
      const p = PRESETS[s.preset].c;
      if (MODES.some((j) => Math.abs((p[j] || 0) - s['z' + j]) > 1e-9)) { ctl.set.preset('custom'); }
    }
    lastPreset = ctl.state.preset;
    recompute();
  });
  let lastPreset = ctl.state.preset;
  const ro = h('div');
  const calc = liveCalc();

  const n = 256, Dpx = 64; // Q = 4
  const amp = rasterAperture({ type: 'circle' }, n, Dpx, 4);
  let D = null;

  const wf = stage({ aspect: 1, label: 'Wavefront W(ρ,θ)', draw: (c, w, hh, st) => drawMap(c, w, hh, 'wf', st) });
  const ifg = stage({ aspect: 1, label: 'Interferogram (Fizeau)', draw: (c, w, hh, st) => drawMap(c, w, hh, 'ifg', st) });
  const ps = stage({ aspect: 1, label: 'PSF', draw: (c, w, hh, st) => drawMap(c, w, hh, 'psf', st) });
  const tf = stage({ aspect: 5, label: 'Through focus: −1, −½, 0, +½, +1 λ of added defocus', draw: drawThrough, minH: 130 });
  const sp = stage({ aspect: 2.4, label: '', draw: drawStrehl, cls: 'plain', minH: 220 });
  const v3 = view3d({ label: '3-D: the wavefront over the pupil (left) and the star image it makes, log brightness (right)', aspect: 2.3, minH: 260, yaw: -0.5, pitch: 0.55 });
  root.append(lab([h('div.grid-3', {}, wf.el, ifg.el, ps.el), v3.el, tf.el, h('div.card', { style: { padding: '8px' } }, sp.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const coeffs = () => { const c = {}; for (const j of MODES) c[j] = ctl.state['z' + j]; return c; };

  // 23 FFTs per update (PSF, 5 through-focus, 17-point Strehl curve) run in the compute worker
  const job = latest('zernike');
  const recompute = debounce(() => {
    const c = coeffs();
    job('zernikeLab', { coeffs: c, n, Dpx }).then((r) => present(c, r)).catch(console.error);
  }, 30);
  function present(c, r) {
    const { rms } = r, mx = r.pv, mn = 0;
    D = r;
    const sm = Math.exp(-((2 * Math.PI * rms) ** 2));
    ro.replaceChildren(readouts([
      ['RMS wavefront σ', rms.toFixed(4) + ' λ'],
      ['Peak-to-valley', (mx - mn).toFixed(3) + ' λ'],
      ['Strehl (exact, FFT)', D.strehl.toFixed(4)],
      ['Strehl (Maréchal)', sm.toFixed(4)],
      ['Maréchal criterion S ≥ 0.8', D.strehl >= 0.8 ? 'met ✓' : 'not met'],
      ['Rayleigh λ/4 P-V rule', mx - mn <= 0.25 ? 'met ✓' : 'not met'],
    ]));
    const nz = MODES.filter((j) => c[j]);
    const terms = (nz.slice(0, 3).map((j) => `${texNum(c[j], 2)}^2`).join('+') + (nz.length > 3 ? '+\\cdots' : '')) || '0';
    calc.say((D.strehl >= 0.8
      ? t('The wavefront deviates by <strong>{rms} waves RMS</strong> ({pv} peak to valley), so the star\'s peak is <strong>{S} %</strong> as bright as with a perfect lens: diffraction-limited by the Maréchal criterion.', { rms: rms.toFixed(3), pv: (mx - mn).toFixed(2), S: (D.strehl * 100).toFixed(0) })
      : t('The wavefront deviates by <strong>{rms} waves RMS</strong> ({pv} peak to valley), so the star\'s peak is <strong>{S} %</strong> as bright as with a perfect lens.', { rms: rms.toFixed(3), pv: (mx - mn).toFixed(2), S: (D.strehl * 100).toFixed(0) })));
    calc.set(String.raw`\begin{aligned}\sigma_W^2 &= \textstyle\sum_{j\ge4} a_j^2 = ${terms}\\ \sigma_W &= ${texNum(rms, 4)}\,\lambda\\ S &\approx e^{-(2\pi\sigma_W)^2} = ${texNum(sm, 4)}\\ S_\text{exact} &= \frac{\max|\mathcal F\{Pe^{i2\pi W}\}|^2}{\max|\mathcal F\{P\}|^2} = ${texNum(D.strehl, 4)}\end{aligned}`);
    [wf, ifg, ps, tf, sp].forEach((s) => s.redraw());
    show3d(r);
  }

  // 3-D: wavefront relief (height ∝ W, scaled so the largest |W| is fixed) and the PSF's log relief
  let shown3d = false;
  function show3d(r) {
    if (!v3.ok) return;
    const wf3 = wavefrontMesh(r.W, r.n, r.Dpx, { cx: -1.25 }), psf3 = psfMesh(r.I, r.n, { crop: 64, cx: 1.25 });
    const sq = [[0.25, 0, -1], [2.25, 0, -1], [2.25, 0, 1], [0.25, 0, 1], [0.25, 0, -1]];
    v3.setScene({
      meshes: [{ mesh: wf3.mesh }, { mesh: psf3 }],
      lines: [{ points: ring(1, -1.25), color: [1, 1, 1, 0.35], width: 1 }, { points: sq, color: [1, 1, 1, 0.25], width: 1 }],
      labels: [
        { p: [-1.25, 0.75, -1.15], text: 'W(ρ, θ), height ±{w} λ', vars: { w: wf3.wmax.toFixed(2) } },
        { p: [1.25, 1.15, -1.15], text: 'PSF, log brightness · Strehl {s}', vars: { s: r.strehl.toFixed(3) } },
      ],
    }, shown3d);
    shown3d = true;
  }

  const DIV = lut('diverging'), INF = lut('inferno');
  function drawMap(ctx, w, hh, kind, st) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!D) return;
    const side = Math.min(w, hh) - 16, rect = { x: (w - side) / 2, y: (hh - side) / 2, w: side, h: side };
    if (kind === 'psf') {
      const crop = 96, off = (n - crop) / 2, log = ctl.state.log;
      paintMap(st, rect, { a: D.I, w: n, h: n, x0: off, y0: off, cw: crop, ch: crop, lut: INF,
        pre: log ? (v) => Math.log10(v / D.P0 + 1e-12) : (v) => v / D.P0, value: log ? (v) => toe(1 + v / 4) : (v) => v }, `${keyOf(D)}|${log}`);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
      ctx.fillText(t('S = {strehl} (peak rel. to perfect)', { strehl: D.strehl.toFixed(3) }), w - 10, hh - 10);
      return;
    }
    const crop = Dpx + 4, off = (n - crop) / 2;
    const lim = Math.max(0.05, Math.abs(D.pv / 2));
    let wmax = 1e-6; for (let k = 0; k < n * n; k++) if (amp[k] > 0.5) wmax = Math.max(wmax, Math.abs(D.W[k]));
    const bg = [5, 6, 10];
    if (kind === 'wf') {
      const sc = Math.max(wmax, lim);
      paintMap(st, rect, { a: D.W, w: n, h: n, x0: off, y0: off, cw: crop, ch: crop, lut: DIV, mask: amp, bg, value: (v) => (v / sc) * 0.5 + 0.5 }, keyOf(D));
    } else {
      // double-pass Fizeau interferogram: fringe = 2W, plus reference tilt
      const tilt = ctl.state.tilt, sc = (side * st.dpr) / crop;
      paint(st, rect, (u, v, o) => {
        const x = off + u * crop - 0.5, y = off + v * crop - 0.5, m = edge(bilinear(amp, n, n, x, y), sc);
        if (m <= 0) { o[0] = bg[0] / 255; o[1] = bg[1] / 255; o[2] = bg[2] / 255; return; }
        const xn = (x - n / 2) / (Dpx / 2);
        const f = 0.5 + 0.5 * Math.cos(2 * Math.PI * (2 * catmull(D.W, n, n, x, y) + tilt * xn / 2));
        o[0] = (bg[0] + (60 + 195 * f - bg[0]) * m) / 255; o[1] = (bg[1] + (40 + 160 * f - bg[1]) * m) / 255; o[2] = (bg[2] + (20 + 40 * f - bg[2]) * m) / 255;
      }, `${keyOf(D)}|${tilt}`);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(kind === 'wf' ? `±${wmax.toFixed(2)} λ` : t('double pass: 1 fringe = λ/2'), w - 10, hh - 10);
  }

  function drawThrough(ctx, w, hh, st) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!D) return;
    const crop = 80, off = (n - crop) / 2, side = Math.min(hh - 30, w / 5 - 12);
    D.through.forEach((I, i) => {
      const x0 = (w / 5) * i + (w / 5 - side) / 2;
      paintMap(st, { x: x0, y: 24, w: side, h: side }, { a: I, w: n, h: n, x0: off, y0: off, cw: crop, ch: crop, lut: INF,
        pre: (v) => Math.log10(v / D.P0 + 1e-12), value: (v) => toe(1 + v / 3.5) }, keyOf(D), i);
    });
  }

  function drawStrehl(ctx, w, hh) {
    if (!D) return;
    const mar = []; for (let s = 0; s <= 0.4; s += 0.005) mar.push([s, Math.exp(-((2 * Math.PI * s) ** 2))]);
    const xmax = Math.max(0.2, D.curve[D.curve.length - 1][0]);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Strehl ratio vs RMS wavefront error (current mode mix, scaled ×0…2)',
      x: { min: 0, max: Math.min(0.4, xmax), label: 'σ_W (waves RMS)' }, y: { min: 0, max: 1, label: 'Strehl ratio' },
      series: [{ data: mar, color: 'rgba(255,255,255,0.5)', dash: [5, 4], width: 1.2, label: 'Maréchal e^{−(2πσ)²}' }, { data: D.curve, color: '#ffb547', width: 2, label: 'exact (FFT)' }],
      hlines: [{ y: 0.8, color: '#6be3a4', label: 'S = 0.8 (≈ λ/14)' }], legend: true,
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(Math.min(D.rms, 0.4)), Y(D.strehl), 4.5, 0, 7); ctx.fill();
  }

  recompute();

  // ── JWST segment phasing ────────────────────────────────────────────────────────────
  const segSection = h('section.block', {}, h('h2', {}, 'Phasing a segmented mirror: JWST commissioning'));
  const segCtl = controls({
    stage: { type: 'seg', label: 'Commissioning step', value: 'stack', options: [['raw', '1 · Deployed'], ['stack', '2 · Stacked'], ['coarse', '3 · Coarse phased'], ['fine', '4 · Fine phased']] },
    seed: { type: 'range', label: 'Random realisation', min: 1, max: 20, step: 1, value: 3 },
    lam: { type: 'range', label: 'Wavelength', min: 0.6, max: 5, step: 0.05, value: 2, unit: 'µm' },
  }, () => recomputeSeg());
  const segPupil = stage({ aspect: 1, label: 'Segment piston map', draw: (c, w, hh, st) => drawSeg(c, w, hh, 'pupil', st) });
  const segPsf = stage({ aspect: 1, label: 'Image of a star', draw: (c, w, hh, st) => drawSeg(c, w, hh, 'psf', st) });
  const segRo = h('div');
  segSection.append(lab([h('div.grid-2', {}, segPupil.el, segPsf.el)], [h('div.card', {}, segCtl.el), h('div.card', {}, segRo)]));
  root.append(segSection);

  const nS = 512, DS = 128;
  let SD = null;
  // the JWST raster, segment map and two 512² FFTs per update run in the compute worker
  const segJob = latest('phasing');
  const recomputeSeg = debounce(() => {
    const st = { ...segCtl.state };
    segJob('segPhasing', { st, nS, DS }).then((r) => {
      SD = { ...r, st };
      segRo.replaceChildren(readouts([
        ['Segment piston RMS', (r.rmsP * 1000).toFixed(0) + ' nm'],
        ['Piston RMS in waves', (r.rmsP / st.lam).toFixed(3) + ' λ'],
        ['Peak / perfect (Strehl)', r.strehl.toFixed(3)],
        ['JWST requirement', 'S ≥ 0.8 at 2 µm (≈ 150 nm WFE)'],
      ]));
      segPupil.redraw(); segPsf.redraw();
    }).catch(console.error);
  }, 40);

  function drawSeg(ctx, w, hh, kind, st) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!SD) return;
    const side = Math.min(w, hh) - 16, rect = { x: (w - side) / 2, y: (hh - side) / 2, w: side, h: side };
    if (kind === 'pupil') {
      const crop = DS + 4, off = (nS - crop) / 2;
      let wm = 1e-6; for (let k = 0; k < nS * nS; k++) if (SD.amp[k]) wm = Math.max(wm, Math.abs(SD.W[k]));
      // piston steps between segments stay sharp: bilinear sampling
      paintMap(st, rect, { a: SD.W, w: nS, h: nS, x0: off, y0: off, cw: crop, ch: crop, lut: DIV, mask: SD.amp, linear: true, value: (v) => (v / wm) * 0.5 + 0.5 }, keyOf(SD));
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
      ctx.fillText(t('±{wm} µm OPD', { wm: wm.toFixed(2) }), w - 10, hh - 10);
      return;
    }
    const crop = SD.st.stage === 'raw' ? nS : 160, off = (nS - crop) / 2;
    paintMap(st, rect, { a: SD.I, w: nS, h: nS, x0: off, y0: off, cw: crop, ch: crop, lut: INF,
      pre: (v) => Math.log10(v / SD.mx + 1e-12), value: (v) => toe(1 + v / 4.5) }, keyOf(SD));
    const mas = (crop / 4) * (SD.st.lam * 1e-6 / 6.6) * 206265 * 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(t('field {f} · λ {l} µm', { f: mas > 2000 ? (mas / 1000).toFixed(1) + '″' : mas.toFixed(0) + ' mas', l: SD.st.lam }), w - 10, hh - 10);
  }
  recomputeSeg();

  root.append(rule(String.raw`\[S \approx e^{-(2\pi\sigma)^2}\]
<p>The Strehl ratio \(S\), the peak brightness of a star image relative to a perfect lens, depends mainly on the RMS wavefront error \(\sigma\) in waves and hardly on its shape. A system counts as diffraction-limited when \(S \ge 0.8\), which needs \(\sigma \le \lambda/14 \approx 0.07\) waves (Maréchal): only 39 nm at 550 nm. A mirror doubles its surface errors in the reflected wave, so its surface must be accurate to about 20 nm.</p>`,
    String.raw`The formula works well up to about 0.1–0.15 waves RMS. For larger errors it can be far off and the shape of the aberration matters, so the image has to be computed from the full wavefront, as the FFT on this page does.`));
  root.append(theory('Wavefront aberration theory', String.raw`
<div class="theory-cols"><div>
<h3>Zernike polynomials</h3>
<p>On the unit disk, the Zernike polynomials \(Z_j(\rho,\theta) = N_n^m R_n^{|m|}(\rho)\{\cos,\sin\}(m\theta)\) form a complete orthonormal set (Noll 1976 normalisation):</p>
\[\frac1\pi\int_0^{2\pi}\!\!\int_0^1 Z_jZ_{j'}\,\rho\,d\rho\,d\theta = \delta_{jj'},\qquad R_n^m(\rho) = \sum_{k=0}^{(n-m)/2}\frac{(-1)^k(n-k)!\,\rho^{n-2k}}{k!\left(\frac{n+m}2-k\right)!\left(\frac{n-m}2-k\right)!}.\]
<p>Because they are orthonormal, each coefficient \(a_j\) is the RMS contribution of its mode, and the total variance is \(\sigma_W^2 = \sum_{j\ge2}a_j^2\) once piston is removed. Low orders map onto the Seidel terms. Defocus \(Z_4 = \sqrt3(2\rho^2-1)\), astigmatism \(Z_{5,6}\), coma \(Z_{7,8} = \sqrt8(3\rho^3-2\rho)\{\sin,\cos\}\theta\) and spherical \(Z_{11} = \sqrt5(6\rho^4-6\rho^2+1)\) each contain the lower-order "balancing" terms that minimise their own variance. That balancing is what makes them the natural description at best focus.</p>
<h3>Strehl ratio</h3>
<p>The Strehl ratio is the PSF peak relative to a perfect system. At the origin of the image plane the Fraunhofer integral gives</p>
\[S = \left|\big\langle e^{i2\pi W/\lambda}\big\rangle_\text{pupil}\right|^2 \approx 1 - (2\pi\sigma_W)^2 \approx e^{-(2\pi\sigma_W)^2}.\]
<p>The last form is Mahajan's extended Maréchal approximation, accurate to a few percent for \(S\gtrsim0.3\). The plot compares it with the exact FFT result for whatever mode mix you choose. The approximation fails for large aberrations, and it fails differently for different modes, because only the variance enters it.</p>
</div><div>
<h3>Reading the maps</h3>
<p>A Fizeau interferometer tests a mirror in double pass, so each fringe is a \(\lambda/2\) contour of surface height, or a \(\lambda\) contour of wavefront in transmission. Adding reference tilt makes straight fringes, and aberrations bend them. Coma gives the classic "C" shapes, astigmatism gives saddle-shaped hyperbolae, and spherical aberration gives S-curves.</p>
<p>The <strong>through-focus series</strong> is diagnostic. Astigmatism rotates its line focus by 90° through focus. Spherical aberration makes the patterns on either side of focus asymmetric: one bright-ringed, one soft. This is the test that exposed Hubble's 1990 flaw. Its primary mirror had been figured with a conic constant of −1.0139 instead of −1.0023, an edge error of 2.2 µm, and stars showed a sharp core inside a large halo. COSTAR and WFPC2 corrected it with optics carrying an equal and opposite \(Z_{11}\).</p>
<h3>Segment phasing</h3>
<p>JWST's 18 segments each have six actuators for tip, tilt, piston and translation, plus a radius-of-curvature actuator. After deployment, each segment formed its own image of the reference star HD 84406, scattered over arcminutes. The segments were identified and stacked by tilt, then phased. Coarse phasing used dispersed-fringe sensing to reach about 100 nm. Fine phasing used defocused-image phase retrieval to reach about 10 nm. The resulting telescope wavefront error is about 60–70 nm RMS, far better than the 150 nm requirement. This makes JWST diffraction-limited at 1.1 µm, compared with a 2 µm specification.</p>
</div></div>`));
  root.append(references([
    'R. J. Noll, "Zernike polynomials and atmospheric turbulence", JOSA 66, 207 (1976).',
    'V. N. Mahajan, "Strehl ratio for primary aberrations in terms of their aberration variance", JOSA 73, 860 (1983).',
    'L. Allen et al., <i>The Hubble Space Telescope Optical Systems Failure Report</i>, NASA (1990).',
    'J. Rigby et al., "The science performance of JWST as characterized in commissioning", PASP 135, 048001 (2023).',
    'D. S. Acton et al., "Wavefront sensing and controls for the James Webb Space Telescope", Proc. SPIE 8442 (2012).',
  ]));
  return () => { [wf, ifg, ps, tf, sp, segPupil, segPsf].forEach((s) => s.destroy()); v3.destroy(); };
}
