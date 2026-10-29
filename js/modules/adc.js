import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { wavelengthRGB } from '../lib/color.js';
import { airRefractivityPT, refraction, dispersion, adcPrism, adcAngle, residual } from '../lib/adc.js';
import { t } from '../lib/i18n.js';

const D2R = Math.PI / 180;
const SITES = { sea: { name: 'Sea level (1013 hPa, 15 °C)', P: 101325, T: 15 }, paranal: { name: 'Paranal, 2635 m (743 hPa, 10 °C)', P: 74300, T: 10 }, mk: { name: 'Mauna Kea, 4205 m (615 hPa, 2 °C)', P: 61500, T: 2 } };
const PAIRS = { bkf2: ['N-BK7', 'F2', 'N-BK7 / F2'], fkf: ['N-FK51A', 'N-SF5', 'N-FK51A / N-SF5'], caf: ['CaF2', 'Fused silica', 'CaF₂ / fused silica'] };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>The atmosphere bends starlight that enters it at a slant, so stars appear slightly higher in the sky than they really are. Like a weak prism, it bends blue light a little more than red. Away from the zenith every star is therefore stretched into a tiny vertical rainbow, a fraction of an arcsecond long.</p>
<p>For sharp images and for spectrographs with narrow slits, that smear matters. Large telescopes cancel it with an <strong>atmospheric dispersion corrector</strong>: two pairs of glass prisms that rotate against each other to make an equal and opposite rainbow.</p>`, [
    "Raise the <strong>Zenith angle</strong> from 0° to 70°: the rainbow grows quickly towards the horizon.",
    "Turn the <strong>corrector</strong> off and on: the colours collapse back into one image.",
    "Switch the <strong>Site</strong> from sea level to Mauna Kea: in the thinner air the effect is about a third smaller.",
  ]));

  const ctl = controls({
    z: { type: 'range', label: 'Zenith angle', min: 0, max: 75, step: 0.5, value: 50, unit: '°' },
    site: { type: 'select', label: 'Site', value: 'paranal', options: Object.entries(SITES).map(([k, s]) => [k, s.name]) },
    l0: { type: 'range', label: 'Band: shortest wavelength', min: 350, max: 600, step: 5, value: 400, unit: 'nm' },
    l1: { type: 'range', label: 'Band: longest wavelength', min: 550, max: 1000, step: 5, value: 700, unit: 'nm' },
    seeing: { type: 'range', label: 'Seeing FWHM at 500 nm', min: 0.05, max: 1.5, step: 0.01, value: 0.4, unit: '″' },
    adc: { type: 'toggle', label: 'Atmospheric dispersion corrector', value: true },
    pair: { type: 'select', label: 'ADC glass pair', value: 'bkf2', options: Object.entries(PAIRS).map(([k, p]) => [k, p[2]]), when: (st) => st.adc },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const star = stage({ aspect: 2, label: 'A white star (5800 K) through the atmosphere: without (left) and with the ADC setting (right); zenith is up', draw: drawStar, minH: 220 });
  const disp = stage({ aspect: 2.2, label: '', draw: drawDisp, cls: 'plain', minH: 210 });
  const vsz = stage({ aspect: 2.2, label: '', draw: drawZ, cls: 'plain', minH: 200 });
  root.append(lab([star.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, disp.el), h('div.card', { style: { padding: '6px' } }, vsz.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ADC: doublets with a 0.2 rad crown prism; k chosen so that the corrector can just cancel the
  // 400–700 nm dispersion at z = 70° on Mauna Kea (prism dispersion is demagnified onto the sky)
  let M = null;
  function setup(st) {
    const [g1, g2] = PAIRS[st.pair], pr = adcPrism(g1, g2, 0.2, 550);
    const k = Math.abs(dispersion(400, 700, 70 * D2R, 61500, 2) / (2 * (pr.delta(400) - pr.delta(700))));
    return { pr, k };
  }
  function update() {
    const st = ctl.state, s = SITES[st.site], z = st.z * D2R, { pr, k } = setup(st);
    const th = adcAngle(pr, k, st.l0, st.l1, z, s.P, s.T), lams = Array.from({ length: 31 }, (_, i) => st.l0 + ((st.l1 - st.l0) * i) / 30), lc = (st.l0 + st.l1) / 2;
    const air = lams.map((l) => refraction(l, z, s.P, s.T) - refraction(lc, z, s.P, s.T)), res = lams.map((l) => residual(l, lc, pr, k, th, z, s.P, s.T));
    M = { st, s, z, pr, k, th, lams, lc, air, res };
    const span = (a) => Math.max(...a) - Math.min(...a);
    ro.replaceChildren(readouts([
      ['Refraction at 550 nm', refraction(550, z, s.P, s.T).toFixed(1) + '″'],
      ['(n − 1) of air at 550 nm', airRefractivityPT(550, s.P, s.T).toExponential(4)],
      [`Dispersion ${st.l0}–${st.l1} nm`, span(air).toFixed(3) + '″'],
      ['ADC rotation (each doublet)', (th / D2R).toFixed(1) + '°'],
      ['Residual with the ADC', span(res).toFixed(3) + '″'],
      ['Seeing FWHM', st.seeing.toFixed(2) + '″'],
    ]));
    calc.say(st.adc
      ? t('At {z}° from the zenith the air lifts the star by <strong>{R}″</strong> and spreads {l0}–{l1} nm over <strong>{span}″</strong>; the corrector leaves {res}″, against a seeing disc of {seeing}″.', { z: st.z, R: refraction(550, z, s.P, s.T).toFixed(0), l0: st.l0, l1: st.l1, span: span(air).toFixed(2), res: span(res).toFixed(3), seeing: st.seeing })
      : t('At {z}° from the zenith the air lifts the star by <strong>{R}″</strong> and spreads {l0}–{l1} nm over <strong>{span}″</strong>, against a seeing disc of {seeing}″.', { z: st.z, R: refraction(550, z, s.P, s.T).toFixed(0), l0: st.l0, l1: st.l1, span: span(air).toFixed(2), seeing: st.seeing }));
    calc.set(String.raw`\begin{aligned}
    R_{550} &= (n-1)\tan z = ${texNum(refraction(550, z, s.P, s.T), 4)}''\\
    \Delta R &= [n(\lambda_1)-n(\lambda_2)]\tan z = ${texNum(span(air), 3)}''\\
    \cos\theta &= \frac{\Delta R}{2k\,\Delta\delta}\ \Rightarrow\ \theta = ${texNum(th / D2R, 3)}^\circ
    \end{aligned}`);
    [star, disp, vsz].forEach((x) => x.redraw());
  }
  function drawStar(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const st = M.st, S = 120, field = Math.max(3 * st.seeing, 1.6 * (Math.max(...M.air) - Math.min(...M.air)) + 2 * st.seeing, 0.3), px = field / S; // arcsec per px
    const T = 5800, planck = (l) => { const x = l * 1e-9; return 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * T)) - 1)); };
    [false, true].forEach((corr, side) => {
      const acc = new Float32Array(S * S * 3);
      M.lams.forEach((l, i) => {
        const off = corr && st.adc ? M.res[i] : M.air[i], fw = st.seeing * Math.pow(l / 500, -0.2), sg = fw / 2.3548 / px, c = wavelengthRGB(l, false), wgt = planck(l);
        const cy = S / 2 - off / px;
        for (let y = 0; y < S; y++) { const gy = Math.exp(-0.5 * ((y - cy) / sg) ** 2); if (gy < 1e-4) continue; for (let x = 0; x < S; x++) { const g = gy * Math.exp(-0.5 * ((x - S / 2) / sg) ** 2) * wgt / (sg * sg); for (let q = 0; q < 3; q++) acc[(y * S + x) * 3 + q] += g * c[q]; } }
      });
      let mx = 1e-30; for (const v of acc) mx = Math.max(mx, v);
      const ic = imageCanvas(S, S);
      for (let k = 0; k < S * S; k++) { for (let q = 0; q < 3; q++) ic.data[k * 4 + q] = 255 * Math.pow(acc[k * 3 + q] / mx, 1 / 2.2); ic.data[k * 4 + 3] = 255; }
      ic.put();
      const sz = Math.min(w / 2, hh) - 16, x0 = side * (w / 2) + (w / 2 - sz) / 2;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, x0, (hh - sz) / 2, sz, sz);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif';
      ctx.fillText(t('{s} · {f}″ across', { s: side ? (st.adc ? t('with ADC') : t('ADC off')) : t('without ADC'), f: field.toFixed(2) }), x0 + 4, (hh + sz) / 2 - 6);
    });
  }
  function drawDisp(ctx, w, hh) {
    if (!M) return;
    const lo = Math.min(...M.air, ...M.res), hi = Math.max(...M.air, ...M.res);
    plot(ctx, w, hh, {
      title: t('Image position relative to {l} nm', { l: M.lc.toFixed(0) }), x: { min: M.st.l0, max: M.st.l1, label: 'wavelength (nm)' }, y: { min: lo - 0.05 * (hi - lo + 0.01), max: hi + 0.05 * (hi - lo + 0.01), label: 'offset towards zenith (″)' },
      series: [{ data: M.lams.map((l, i) => [l, M.air[i]]), color: '#ff9cc0', width: 2, label: 'atmosphere' }, ...(M.st.adc ? [{ data: M.lams.map((l, i) => [l, M.res[i]]), color: '#6be3a4', width: 2, label: 'with ADC (residual)' }] : [])],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.2)' }], legend: true, legendX: w - 190, legendY: 34,
    });
  }
  function drawZ(ctx, w, hh) {
    if (!M) return;
    const zs = Array.from({ length: 76 }, (_, i) => i), s = M.s;
    plot(ctx, w, hh, {
      title: t('Dispersion {a}–{b} nm vs zenith angle', { a: M.st.l0, b: M.st.l1 }), x: { min: 0, max: 75, label: 'zenith angle (°)' }, y: { min: 0, max: Math.max(0.5, dispersion(M.st.l0, M.st.l1, 75 * D2R, s.P, s.T) * 1.05), label: 'dispersion (″)' },
      series: Object.entries(SITES).map(([key, si], i) => ({ data: zs.map((z) => [z, dispersion(M.st.l0, M.st.l1, z * D2R, si.P, si.T)]), color: ['#ff9cc0', '#ffb547', '#6ad7ff'][i], width: key === M.st.site ? 2.4 : 1.2, label: si.name.split(' (')[0] })),
      hlines: [{ y: M.st.seeing, color: 'rgba(255,255,255,0.35)', label: 'seeing FWHM' }], vlines: [{ x: M.st.z, color: 'rgba(255,255,255,0.35)' }], legend: true, legendX: 70, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[R \approx (n-1)\tan z\]
<p>Refraction lifts a star at zenith angle \(z\) by about \((n-1)\tan z\). At sea level \(n - 1 \approx 2.8 \times 10^{-4}\), so at 45° a star rises by 57″. Blue light has a slightly larger \(n\): between 400 and 700 nm the difference at 45° is 1.4″, already several times the size of a diffraction-limited image on a large telescope. At 60° it is \(\sqrt3\) times larger.</p>`,
    String.raw`The plane-parallel formula works to about 75° from the zenith; nearer the horizon the curvature of the atmosphere matters. The refractive index depends on pressure, temperature and humidity, and a corrector cancels the dispersion exactly only for one zenith angle per setting.`));
  root.append(theory('A prism made of air', String.raw`
<div class="theory-cols"><div>
<h3>Refraction and its dispersion</h3>
<p>Light entering the atmosphere obliquely is bent towards the vertical. For a plane-parallel atmosphere only the refractive index at the telescope matters, and the apparent elevation gain is</p>
\[R \approx (n-1)\tan z,\]
<p>about 58″ at 45° from the zenith at sea level. Edlén's formula for standard air,</p>
\[(n-1)\times10^8 = 8342.54 + \frac{2\,406\,147}{130-\sigma^2} + \frac{15\,998}{38.9-\sigma^2},\quad \sigma = 1/\lambda\ [\mu\text{m}^{-1}],\]
<p>scaled by pressure and temperature, makes \(n-1\) about 1.5 % larger at 400 nm than at 700 nm. The star becomes a short vertical spectrum, blue end towards the zenith, of length \([n(\lambda_1)-n(\lambda_2)]\tan z\). At 60° that is 2.5″ at sea level and 1.9″ at Paranal, where the air is thinner. Seeing at good sites is 0.5–0.8″, adaptive optics reaches 0.05″, so the smear soon dominates. For spectroscopy, part of the light misses a narrow slit unless the slit lies along the parallactic angle (Filippenko 1982).</p>
</div><div>
<h3>The atmospheric dispersion corrector</h3>
<p>An ADC is a pair of identical prism doublets in a converging or collimated beam. Each doublet combines two glasses with apex angles chosen so that the deviation vanishes at a central wavelength, \(A_1(n_1-1) = A_2(n_2-1)\), leaving a dispersion \(\delta(\lambda) = A_1(n_1-1) - A_2(n_2-1)\). Rotating the two doublets by \(\pm\theta\) about the axis adds their dispersions as vectors: \(2\delta\cos\theta\) along one direction, while the perpendicular components cancel. Setting \(\cos\theta\) for each zenith angle cancels the atmosphere's dispersion. Since glass and air disperse with different curve shapes, a small <em>secondary spectrum</em> remains (the green curve). Good glass pairs make it a few hundredths of an arcsecond. The plane-parallel formula is accurate to about 1 % below 70°. Water vapour, which lowers the refractivity slightly, is neglected.</p>
</div></div>`));
  root.append(references([
    'B. Edlén, “The refractive index of air”, <em>Metrologia</em> 2, 71 (1966).',
    'A. V. Filippenko, “The importance of atmospheric differential refraction in spectrophotometry”, <em>PASP</em> 94, 715 (1982).',
    'C. G. Wynne &amp; S. P. Worswick, “Atmospheric dispersion correctors at the Cassegrain focus”, <em>MNRAS</em> 220, 657 (1986).',
  ]));

  return () => [star, disp, vsz].forEach((x) => x.destroy());
}
