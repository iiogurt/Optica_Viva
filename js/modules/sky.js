// Sky colours and sunsets: sunlight scattered by air and haze, computed wavelength by wavelength.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { paint, encode, bilinear, keyOf } from '../lib/pixels.js';
import { LAMS, column, opticalDepth, rayleighBeta, ozoneSigma, airMass, kastenYoung, sunColour, HM } from '../lib/sky.js';
import { aces } from '../lib/flarescene.js';
import { t, N_ } from '../lib/i18n.js';

const W = 128, H = 64, AZ = 1.75, LO = -0.07, HI = 0.9; // the panorama: ±100° of azimuth, −4° … +52°

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video', 'space'] }));
  root.append(idea(String.raw`<p>Sunlight is white, but the air does not scatter all colours equally: the molecules of air throw blue light around about six times more than red. Wherever you look away from the Sun you see that scattered light, so the sky is blue.</p>
<p>When the Sun is low, its light crosses thirty times more air before it reaches you. Most of the blue has been scattered out of the beam on the way, so the Sun turns yellow, orange and red, and so do the clouds and the haze it lights. Haze scatters all colours more evenly, which turns the sky paler and whiter.</p>`, [
    'Lower the <strong>Sun</strong> from 60° to the horizon: when does the Sun itself turn orange?',
    'Add <strong>haze</strong>: the sky turns white near the Sun and the sunset redder. Why are both true?',
    'Put the Sun 3° below the horizon and look <strong>away from the Sun</strong>: a blue-grey band rises from the horizon with a pink one above it. That band is the Earth\'s own shadow.',
  ]));

  const ctl = controls({
    el: { type: 'range', label: 'Height of the Sun', min: -6, max: 60, step: 0.5, value: 4, unit: '°' },
    look: { type: 'seg', label: 'Looking', value: 'sun', options: [['sun', 'Towards the Sun'], ['back', 'Away from the Sun']] },
    aod: { type: 'range', label: 'Haze (aerosol optical depth at 550 nm)', min: 0, max: 0.8, step: 0.01, value: 0.1 },
    alpha: { type: 'range', label: 'Size of the haze particles (Ångström exponent)', min: 0, max: 2.5, step: 0.1, value: 1.3, hint: 'Small particles scatter blue more (high exponent); large ones scatter all colours alike (near 0).' },
    ozone: { type: 'toggle', label: 'Ozone (Chappuis band)', value: true },
    ev: { type: 'range', label: 'Exposure (relative to automatic)', min: -4, max: 4, step: 0.1, value: 0, unit: 'EV' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const view = stage({ aspect: 2.4, label: 'The sky, computed: 200° wide, from 4° below the horizon to 52° above', draw: drawSky, minH: 240 });
  const trans = stage({ aspect: 1.5, label: '', draw: drawTrans, cls: 'plain', minH: 220 });
  const mass = stage({ aspect: 1.5, label: '', draw: drawMass, cls: 'plain', minH: 220 });
  root.append(lab([view.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, trans.el), h('div.card', { style: { padding: '6px' } }, mass.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('sky');
  let R = null;
  const atmOf = (st) => ({ aod: st.aod, alpha: st.alpha, ozone: st.ozone });
  function update() {
    const st = ctl.state;
    job('sky', { W, H, az: AZ, lo: LO, hi: HI, sunEl: (st.el * Math.PI) / 180, ...atmOf(st), back: st.look === 'back' }).then((r) => {
      // three planes, and an exposure that puts the brighter sky (95th percentile of luminance) near
      // the top of the tone curve, whatever the Sun's height; the EV slider shifts it
      const planes = [0, 1, 2].map((c) => Float32Array.from({ length: W * H }, (_, k) => Math.max(0, r[k * 3 + c])));
      const lum = Array.from({ length: W * H }, (_, k) => 0.2126 * planes[0][k] + 0.7152 * planes[1][k] + 0.0722 * planes[2][k]).sort((a, b) => a - b);
      R = { planes, auto: 0.9 / Math.max(1e-12, lum[Math.floor(lum.length * 0.95)]), st: { ...st } };
      view.redraw();
    }, () => {});
    words(); trans.redraw(); mass.redraw();
  }
  function words() {
    const st = ctl.state, el = (st.el * Math.PI) / 180, X = st.el > -0.5 ? airMass(Math.PI / 2 - Math.max(0, el)) : Infinity, sun = sunColour(Math.max(0, el), atmOf(st));
    const T = (lam) => { const col = column(1, Math.sin(Math.max(0, el)), 200); return col ? Math.exp(-opticalDepth(col, lam, atmOf(st))) : 0; };
    const v = column(0, 1, 200), tauR = rayleighBeta(550) * v[0];
    ro.replaceChildren(readouts([
      ['Air the sunlight crosses (air mass)', st.el >= 0 ? fmt(X, 3) + ' ×' : t('the Sun is below the horizon')],
      ['Sunlight left at 450 / 550 / 650 nm', st.el >= 0 ? `${fmt(T(450) * 100, 2)} / ${fmt(T(550) * 100, 2)} / ${fmt(T(650) * 100, 2)} %` : '—'],
      ['Rayleigh optical depth, straight up (550 nm)', fmt(tauR, 3)],
      ['Blue (450 nm) scattered more than red (700 nm)', fmt(rayleighBeta(450) / rayleighBeta(700), 3) + ' ×'],
      ['Ozone optical depth, straight up (600 nm)', fmt(ozoneSigma(600) * v[2], 2)],
    ]));
    const desc = st.el < 0 ? t('below the horizon: only the high air is still lit') : sun.rgb[2] > 0.5 * sun.rgb[0] ? t('white-yellow') : sun.rgb[1] > 0.4 * sun.rgb[0] ? t('orange') : t('deep red');
    calc.say(st.el >= 0
      ? t('At {el}° the sunlight crosses <strong>{X} times</strong> as much air as from overhead; {b} % of its blue (450 nm) and {r} % of its red (650 nm) get through, so the Sun looks <strong>{desc}</strong>.', { el: st.el, X: fmt(X, 3), b: fmt(T(450) * 100, 2), r: fmt(T(650) * 100, 2), desc })
      : t('The Sun is {d}° below the horizon: the ground is in shadow, but sunlight still reaches the air above, which glows pink and blue.', { d: -st.el }));
    calc.set(String.raw`\begin{aligned}
    \beta_R &= \frac{8\pi^3(n^2-1)^2}{3N\lambda^4}F_K,\quad \beta_R(550) = ${texNum(rayleighBeta(550) * 1e6, 3)}\times10^{-6}\ \text{m}^{-1}\\
    \tau &= \beta_R H_R\,X + \tau_\text{haze}\left(\tfrac{\lambda}{550}\right)^{-\alpha}X + \tau_{O_3}X\\
    T &= e^{-\tau},\quad X(${texNum(90 - Math.max(0, st.el), 3)}^\circ) = ${st.el >= 0 ? texNum(X, 3) : '\\infty'}
    \end{aligned}`);
  }

  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { planes, auto, st } = R, g = 2 ** st.ev * auto;
    paint(view, { x: 0, y: 0, w, h: hh }, (u, v, o) => {
      const x = u * W - 0.5, y = v * H - 0.5;
      for (let c = 0; c < 3; c++) o[c] = encode(aces(bilinear(planes[c], W, H, x, y) * g));
    }, keyOf(R));
    // the Sun's disc (0.53°) with limb darkening, in the colour that reaches the eye
    if (st.look === 'sun' && st.el > -0.3) {
      const el = (st.el * Math.PI) / 180, sun = sunColour(Math.max(0, el), atmOf(st)), x = w / 2, y = ((HI - el) / (HI - LO)) * hh;
      const r = Math.max(2.5, ((0.0047 / (2 * AZ)) * w)), m = Math.max(...sun.rgb, 1e-9);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const col = (k) => `rgba(${sun.rgb.map((c) => Math.round(255 * Math.min(1, (c / m) * k ** 0.5))).join(',')},1)`;
      grad.addColorStop(0, col(1)); grad.addColorStop(0.85, col(0.75)); grad.addColorStop(1, col(0.55));
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    const hz = ((HI - 0) / (HI - LO)) * hh;
    ctx.fillText(st.look === 'sun' ? t('Sun') : t('antisolar point'), w / 2, Math.min(hh - 6, hz + 16));
  }
  function drawTrans(ctx, w, hh) {
    const st = ctl.state, el = Math.max(0, (st.el * Math.PI) / 180), col = column(1, Math.sin(el), 200);
    if (!col) return;
    const ls = Array.from({ length: 61 }, (_, i) => 400 + i * 5), atm = atmOf(st);
    const tot = ls.map((l) => [l, Math.exp(-opticalDepth(col, l, atm))]);
    const ray = ls.map((l) => [l, Math.exp(-rayleighBeta(l) * col[0])]);
    const haze = ls.map((l) => [l, Math.exp(-(st.aod / HM) * (l / 550) ** -st.alpha * col[1])]);
    plot(ctx, w, hh, {
      title: N_('Sunlight that reaches you'), x: { min: 400, max: 700, label: N_('wavelength (nm)') }, y: { min: 0, max: 1, label: N_('share transmitted') },
      series: [{ data: ray, color: '#6ad7ff', width: 1.5, dash: [5, 3], label: N_('air alone') }, { data: haze, color: '#c9c9c9', width: 1.5, dash: [2, 3], label: N_('haze alone') }, { data: tot, color: '#ffb547', width: 2.2, label: N_('everything') }],
      legend: true,
    });
  }
  function drawMass(ctx, w, hh) {
    const st = ctl.state, sph = [], flat = [], ky = [];
    for (let e = 0.5; e <= 30; e += 0.5) { const z = 90 - e; sph.push([e, airMass((z * Math.PI) / 180)]); flat.push([e, 1 / Math.cos((z * Math.PI) / 180)]); ky.push([e, kastenYoung(z)]); }
    plot(ctx, w, hh, {
      title: N_('How much air the sunlight crosses'), x: { min: 0, max: 30, label: N_('height of the Sun (°)') }, y: { min: 1, max: 60, log: true, label: N_('air mass (overhead = 1)') },
      series: [{ data: flat, color: 'rgba(255,255,255,0.45)', width: 1.2, dash: [4, 3], label: N_('flat Earth: 1/cos z') }, { data: ky, color: '#c18cff', width: 1.5, dash: [2, 3], label: N_('Kasten & Young (1989)') }, { data: sph, color: '#6ad7ff', width: 2, label: N_('computed (round Earth)') }],
      legend: true,
      vlines: st.el > 0 && st.el <= 30 ? [{ x: st.el, color: 'rgba(255,181,71,0.6)', label: '' }] : [],
    });
  }
  update();

  root.append(rule(String.raw`\[\beta_R \propto \lambda^{-4}:\quad \frac{\beta_R(450)}{\beta_R(700)} \approx 6\]
<p>Molecules scatter light with a strength proportional to \(1/\lambda^4\), so blue is scattered about six times more than red, and a clear sky is blue. Straight up, air dims green light by about 9 % (an optical depth of 0.097); at sunset the light crosses about 38 times as much air, which leaves under 3 % of the blue and most of the red: the Sun turns orange and red.</p>`,
    String.raw`Only light scattered once is counted, which makes the sky near the horizon and the twilight sky too dark (in real skies multiple scattering adds 20–50 % there). The haze is one uniform kind of particle, the ozone band a simple shape, and refraction (which lifts the setting Sun by half a degree) is left out.`));
  root.append(theory('Scattering in the atmosphere', String.raw`
<div class="theory-cols"><div>
<h3>Rayleigh scattering</h3>
<p>A molecule much smaller than the wavelength radiates like a tiny dipole driven by the light's field. Its scattering cross-section is \(\sigma = \frac{8\pi^3(n^2-1)^2}{3N^2\lambda^4}F_K\), with the index of air \(n(\lambda)\) (Peck &amp; Reeder 1972), the number density \(N\) and the King factor \(F_K = (6+3\rho)/(6-7\rho) = 1.048\) for the anisotropy of the molecules (\(\rho = 0.0279\)). The angular pattern is \(\frac{3}{16\pi}(1+\cos^2\theta)\). The column of air above sea level holds \(P_0/(mg) = 2.15\times10^{29}\) molecules per m², so straight up the optical depth at 550 nm is 0.097 (Bucholtz 1995).</p>
<h3>Haze and ozone</h3>
<p>Aerosols scatter more evenly across the spectrum, \(\beta \propto \lambda^{-\alpha}\) with Ångström's exponent \(\alpha\) between about 0 (cloud droplets, dust) and 2 (smoke), and mostly forwards (Henyey–Greenstein, \(g = 0.76\)): the white glow round the Sun. Ozone absorbs in the Chappuis band, weakly but over a long path: when the Sun is below the horizon it removes orange light and keeps the twilight zenith blue (Hulburt 1953).</p>
</div><div>
<h3>The radiance of the sky</h3>
<p>For each direction the laboratory sums, along the line of sight through a spherical atmosphere (Earth radius 6371 km, molecules falling off with a scale height of 8.4 km, haze 1.2 km),</p>
\[L(\lambda) = \int \big[\beta_R\rho_R P_R(\theta) + \beta_M\rho_M P_M(\theta)\big]\,e^{-\tau_\text{Sun}(s)-\tau_\text{eye}(s)}\,ds,\]
<p>at eight wavelengths, weighted by the Sun's spectrum (a 5778 K blackbody) and the CIE colour-matching functions. With the Sun below the horizon, points high along the line of sight are still in sunlight while the air near the ground is in the Earth's shadow: looking away from the Sun this shows as the dark band of the Earth's shadow with the pink Belt of Venus above it.</p>
<h3>Air mass</h3>
<p>The air crossed by sunlight, relative to straight up, is \(1/\cos z\) over a flat Earth but stays finite at the horizon over a round one: the laboratory integrates it (34 at the horizon, without refraction); Kasten &amp; Young's formula, fitted with refraction, gives 38.</p>
</div></div>`));
  root.append(references([
    'A. Bucholtz, "Rayleigh-scattering calculations for the terrestrial atmosphere", Appl. Opt. 34, 2765 (1995).',
    'E. R. Peck &amp; K. Reeder, "Dispersion of air", J. Opt. Soc. Am. 62, 958 (1972).',
    'F. Kasten &amp; A. T. Young, "Revised optical air mass tables and approximation formula", Appl. Opt. 28, 4735 (1989).',
    'E. O. Hulburt, "Explanation of the brightness and color of the sky, particularly the twilight sky", J. Opt. Soc. Am. 43, 113 (1953).',
    'T. Nishita, T. Sirai, K. Tadamura &amp; E. Nakamae, "Display of the Earth taking into account atmospheric scattering", SIGGRAPH 93, 175 (1993).',
  ]));
  return () => [view, trans, mass].forEach((s) => s.destroy());
}
