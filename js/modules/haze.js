// Haze and aerial perspective: ridges at 0.4–70 km fading into the airlight, in colour from spectra,
// with the Sun's direction, a polarising filter and an infrared camera; Koschmieder's law.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { KOSCHMIEDER, betaR, betaA, beta, pureAirRange, polR, colours, infrared, contrast, skyColour } from '../lib/haze.js';
import { t, N_ } from '../lib/i18n.js';

const RAD = Math.PI / 180, FOV = 50, VFOV = FOV / 2.1, SKYN = 9; // horizontal and vertical field of view (°), sky samples
// ridges: distance (km), kind, height of the base and amplitude (fractions of the picture height), seed
const RIDGES = [
  [70, 'rock', 0.4, 0.07, 1], [35, 'rock', 0.37, 0.09, 2], [16, 'veg', 0.33, 0.1, 3], [7, 'veg', 0.28, 0.11, 4], [3, 'veg', 0.22, 0.12, 5], [1.2, 'veg', 0.15, 0.12, 6], [0.4, 'veg', 0.06, 0.1, 7],
];
const COLS = 33;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'cinema'] }));
  root.append(idea(String.raw`<p>Distant mountains look paler and bluer than near ones, layer behind layer, until the farthest merge with the sky. Painters call it <em>aerial perspective</em>. The air between you and the mountain does two things: it scatters away some of the mountain's own light, and it scatters sunlight towards you, adding a veil of brightness called <em>airlight</em>. The farther away, the more veil and the less mountain.</p>
<p>The air's molecules scatter blue light much more than red, which tints the veil blue; dust and droplets (haze) scatter all colours and make it white. Through haze, a camera that sees infrared light can see much farther.</p>`, [
    'Lower the <strong>Visual range</strong> from 100 km to 10 km: which ridge disappears first, and what colour is the veil?',
    'Turn the <strong>Sun</strong> from behind you to almost in front of you: predict whether the haze gets brighter or darker.',
    'Switch to the <strong>Infrared camera</strong>, then try the <strong>Polarising filter</strong>: which one cuts through the haze better?',
  ]));

  const ctl = controls({
    V: { type: 'range', label: 'Visual range (meteorological)', min: 3, max: 300, log: true, value: 40, unit: 'km' },
    alpha: { type: 'range', label: 'Ångström exponent of the haze (0 = fog, 2 = fine smoke)', min: 0, max: 2.2, step: 0.05, value: 1.3 },
    sun: { type: 'range', label: 'Angle between the view and the Sun', min: 20, max: 170, step: 1, value: 115, unit: '°' },
    pol: { type: 'seg', label: 'Polarising filter', value: '0', options: [['0', 'None'], ['1', 'Turned to darken the haze'], ['2', 'Turned the wrong way']] },
    ir: { type: 'toggle', label: 'Infrared camera (850 nm)', value: false },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const scene = stage({ aspect: 2.2, label: 'Ridges from 0.4 to 70 km away, seen through the air', draw: drawScene, minH: 280 });
  const ch1 = stage({ aspect: 1.25, label: '', name: N_('Contrast against distance'), draw: drawContrast, cls: 'plain', minH: 230 });
  const ch2 = stage({ aspect: 1.25, label: '', name: N_('Extinction against wavelength'), draw: drawBeta, cls: 'plain', minH: 230 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([scene.el, h('div.grid-2', {}, card(ch1), card(ch2))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const opts = () => { const s = ctl.state; return { V: s.V * 1000, alpha: s.alpha, theta: s.sun * RAD, pol: +s.pol }; };
  // colours of every ridge and of the sky at COLS directions across the frame (the scattering angle
  // changes by the field of view from left to right: the Sun is to the right)
  let C = null;
  function prepare() {
    const s = ctl.state, o = opts(), key = JSON.stringify(s), cols = [];
    for (let c = 0; c < COLS; c++) {
      const th = Math.min(179, Math.max(1, s.sun + FOV / 2 - (FOV * c) / (COLS - 1))) * RAD, oc = { ...o, theta: th }, shade = 0.15 + 0.75 * (1 - Math.cos(th)) / 2;
      const f = s.ir ? infrared : colours;
      // the sky at SKYN elevations from the horizon to the top of the frame
      const sky = Array.from({ length: SKYN }, (_, i) => skyColour(oc, (i / (SKYN - 1)) ** 1.5 * (VFOV / 2) * RAD, s.ir));
      cols.push({ ridges: RIDGES.map(([z, kind]) => f(oc, kind, z * 1000, shade)), sky });
    }
    // exposure: the horizon sky and the nearest ridge in the middle of the frame no brighter than 75 %
    const m = cols[(COLS - 1) / 2], near = m.ridges[RIDGES.length - 1], mx = (v) => (Array.isArray(v) ? Math.max(...v) : v);
    const peak = Math.max(mx(m.sky[0]), Array.isArray(near.obj) ? Math.max(...near.obj.map((v, i) => 1.3 * v + near.air[i])) : 1.3 * near.obj + near.air);
    C = { key, cols, k: 0.75 / peak, ir: s.ir };
  }
  function update() { prepare(); words(); scene.redraw(); ch1.redraw(); ch2.redraw(); }

  // ridge outlines: deterministic sums of sines
  const top = (k, x) => { const [, , base, amp, sd] = RIDGES[k]; return base + amp * (0.55 * Math.sin(x * (0.6 + 0.15 * sd) + sd * 1.7) + 0.3 * Math.sin(x * (1.7 + 0.3 * sd) + sd * 4.1) + 0.15 * Math.sin(x * (4.5 + 0.5 * sd) + sd)); };
  const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };

  function drawScene(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!C) return;
    const r = { x: 8, y: 34, w: w - 16, h: hh - 42 }, horizon = 0.5, cs = C.cols;
    const pick = (u, f) => { const p = u * (COLS - 1), i = Math.min(COLS - 2, Math.floor(p)), a = p - i; return f(cs[i]).map ? f(cs[i]).map((v, k) => v * (1 - a) + f(cs[i + 1])[k] * a) : f(cs[i]) * (1 - a) + f(cs[i + 1]) * a; };
    paint(scene, r, (u, v, o) => {
      const y = 1 - v; // height from the bottom
      let k = -1;
      for (let j = RIDGES.length - 1; j >= 0; j--) if (y <= top(j, u * 6)) { k = j; break; } // nearest ridge covering the pixel
      let val;
      if (k < 0) {
        const p = Math.max(0, (y - horizon) / (1 - horizon)) * (SKYN - 1), i0 = Math.min(SKYN - 2, Math.floor(p)), a = p - i0;
        const lo = pick(u, (c) => c.sky[i0]), hi = pick(u, (c) => c.sky[i0 + 1]);
        val = C.ir ? lo * (1 - a) + hi * a : lo.map((x, i) => x * (1 - a) + hi[i] * a);
      } else {
        const z = RIDGES[k][0], sc = 60 / z ** 0.5, tex = 0.55 + 0.9 * noise(u * sc * 2.2, v * sc) * (0.6 + 0.4 * noise(u * sc * 0.4 + 9, v * sc * 0.4));
        const ob = pick(u, (c) => c.ridges[k].obj), ai = pick(u, (c) => c.ridges[k].air);
        val = C.ir ? ob * tex + ai : ob.map((x, i) => x * tex + ai[i]);
      }
      if (C.ir) { const g = encode(val * C.k); o[0] = o[1] = o[2] = g; }
      else { o[0] = encode(val[0] * C.k); o[1] = encode(val[1] * C.k); o[2] = encode(val[2] * C.k); }
    }, C.key, 0);
    // distance labels on the ridges
    ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
    RIDGES.forEach(([z], k) => { const u = 0.08 + 0.12 * k, y = top(k, u * 6); if (k === RIDGES.length - 1 || y > top(k + 1, u * 6) + 0.02) ctx.fillText(`${fmt(z, 2)} km`, r.x + u * r.w, r.y + (1 - y) * r.h - 2); });
    ctx.textAlign = 'right'; ctx.fillText(t('Sun to the right · {a}° from the centre of view', { a: fmt(ctl.state.sun, 3) }), r.x + r.w - 6, r.y + 16);
  }

  function words() {
    const s = ctl.state, o = opts(), bR = betaR(550), bA = betaA(550, o.V, s.alpha), b = bR + bA, p = polR(o.theta);
    const far = RIDGES.filter(([z]) => Math.exp(-b * z * 1000) > 0.02).map(([z]) => z), ir = RIDGES.filter(([z]) => Math.exp(-beta(850, o.V, s.alpha) * z * 1000) > 0.02).map(([z]) => z);
    ro.replaceChildren(readouts([
      ['Extinction at 550 nm: molecules + haze', `${fmt(bR * 1e3, 3)} + ${fmt(bA * 1e3, 3)} km⁻¹`],
      ['Visual range 3.912/β', `${fmt(KOSCHMIEDER / b / 1000, 3)} km`],
      ['… in perfectly clean air', `${fmt(pureAirRange() / 1000, 3)} km`],
      ['Farthest ridge above 2 % contrast (550 nm)', far.length ? `${fmt(Math.max(...far), 3)} km` : '—'],
      ['… at 850 nm (infrared)', ir.length ? `${fmt(Math.max(...ir), 3)} km` : '—'],
      ['Visual range at 850 nm', `${fmt(KOSCHMIEDER / beta(850, o.V, s.alpha) / 1000, 3)} km`],
      ['Polarisation of the molecules\' airlight here', `${fmt(p * 100, 3)} %`],
      ['Contrast of the 16 km ridge (black-object law)', `${fmt(Math.abs(contrast(550, 16000, o.V, s.alpha)) * 100, 3)} %`],
    ]));
    calc.say(t('At 550 nm the air removes <strong>{b}</strong> per kilometre ({r} by molecules, the rest by haze), so a dark ridge 16 km away keeps e^(−βz) = <strong>{c} %</strong> of its contrast and anything beyond <strong>{v} km</strong> falls below the eye\'s 2 % threshold. At 850 nm the haze scatters less and the molecules hardly at all: the infrared visual range is {vi} km.', {
      b: fmt(b * 1000, 3), r: fmt(bR * 1000, 3), c: fmt(Math.exp(-b * 16000) * 100, 3), v: fmt(KOSCHMIEDER / b / 1000, 3), vi: fmt(KOSCHMIEDER / beta(850, o.V, s.alpha) / 1000, 3),
    }));
    calc.set(String.raw`\begin{aligned}
    L(z) &= L_0 e^{-\beta z} + L_\text{air}\,(1-e^{-\beta z}),\qquad C(z) = C_0\,e^{-\beta z},\qquad V = \frac{\ln 50}{\beta} = \frac{3.912}{${texNum(b * 1000, 3)}\ \text{km}^{-1}} = ${texNum(KOSCHMIEDER / b / 1000, 3)}\ \text{km}\\
    \beta_R &= \frac{24\pi^3 (n^2-1)^2}{\lambda^4 N^2 (n^2+2)^2}\,\frac{6+3\rho}{6-7\rho}\,N = ${texNum(bR * 1000, 3)}\ \text{km}^{-1},\qquad \beta_a(\lambda) = \beta_a(550)\Big(\frac{\lambda}{550\ \text{nm}}\Big)^{-${texNum(s.alpha, 3)}}
    \end{aligned}`);
  }

  function drawContrast(ctx, w, hh) {
    const o = opts(), zs = Array.from({ length: 160 }, (_, i) => 0.1 * Math.pow(3000, i / 159));
    const ser = [[450, '#7aa7ff'], [550, '#7be38f'], [650, '#ff7a6b'], [850, '#d7b4ff']].map(([l, c]) => ({ data: zs.map((z) => [z, Math.abs(contrast(l, z * 1000, o.V, o.alpha)) * 100]), color: c, width: l === 550 ? 2.2 : 1.5, dash: l === 850 ? [5, 4] : undefined, label: `${l} nm` }));
    plot(ctx, w, hh, {
      title: N_('Contrast of a black object against the horizon'), x: { min: 0.1, max: 300, log: true, label: N_('distance (km)') }, y: { min: 0.1, max: 100, log: true, label: N_('contrast (%)') },
      series: ser, hlines: [{ y: 2, label: N_('2 %: just visible'), color: 'rgba(255,214,120,0.7)' }],
      vlines: RIDGES.filter((_, i) => i % 2 === 0).map(([z]) => ({ x: z, color: 'rgba(255,255,255,0.18)' })), legend: true,
    });
  }

  function drawBeta(ctx, w, hh) {
    const o = opts(), ls = Array.from({ length: 106 }, (_, i) => 380 + i * 5);
    plot(ctx, w, hh, {
      title: N_('Extinction against wavelength'), x: { min: 380, max: 900, label: N_('wavelength (nm)') }, y: { min: 1e-3, max: 2, log: true, label: N_('extinction (km⁻¹)') },
      series: [
        { data: ls.map((l) => [l, betaR(l) * 1000]), color: '#7aa7ff', width: 1.6, dash: [5, 4], label: N_('molecules (λ⁻⁴)') },
        { data: ls.map((l) => [l, betaA(l, o.V, o.alpha) * 1000]), color: '#e8e0c8', width: 1.6, dash: [2, 3], label: N_('haze (λ^−α)') },
        { data: ls.map((l) => [l, beta(l, o.V, o.alpha) * 1000]), color: '#ffffff', width: 2.2, label: N_('total') },
      ],
      vlines: [{ x: 550, label: N_('visual'), color: 'rgba(123,227,143,0.6)' }, { x: 850, label: N_('infrared'), color: 'rgba(215,180,255,0.6)' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[C(z) = C_0\,e^{-\beta z},\qquad V = \frac{\ln 50}{\beta} \approx \frac{3.912}{\beta}\]
<p>A dark object's contrast against the horizon sky falls by a factor e every 1/β; the eye needs about 2 %, which defines the visual range. Perfectly clean air (β = 0.0115 km⁻¹ at 550 nm) would let you see about 340 km; a hazy summer day with V = 20 km has β = 0.2 km⁻¹, so a ridge 10 km away keeps only 14 % of its contrast.</p>`,
    String.raw`Uniform horizontal air, single scattering, sunlight not dimmed on its way to the scattering air, airlight saturated as at the horizon; aerosol with fixed albedo 0.9 and Henyey–Greenstein phase function (g = 0.7), unpolarised; Rayleigh airlight fully polarised at 90°. The sky above the horizon and the ridges' lighting are illustrative, not computed.`));
  root.append(theory('The light between you and the view', String.raw`
<div class="theory-cols"><div>
<h3>Koschmieder's law</h3>
<p>Along a horizontal path, light from an object of radiance \(L_0\) is attenuated as \(e^{-\beta z}\), while every slab of air scatters sunlight into the line of sight. Summed along the path this airlight grows as \(1-e^{-\beta z}\) towards the horizon sky \(L_\text{air}\), so \(L(z) = L_0 e^{-\beta z} + L_\text{air}(1-e^{-\beta z})\) and the contrast \(C = (L-L_\text{air})/L_\text{air}\) decays as \(C_0 e^{-\beta z}\) (Koschmieder 1924). With a threshold of 2 % for a black object, the meteorological visual range is \(V = \ln 50/\beta\).</p>
<h3>Molecules and haze</h3>
<p>Air molecules scatter as small dipoles: \(\sigma = \frac{24\pi^3}{\lambda^4 N^2}\big(\frac{n^2-1}{n^2+2}\big)^2 F_K\), with the King factor \(F_K\) for their anisotropy, about \(5.2\times10^{-31}\ \text{m}^2\) at 532 nm (Bucholtz 1995). This blue-heavy scattering tints the airlight blue and is polarised, completely at 90° from the Sun in the ideal case. Haze particles, comparable to the wavelength, scatter more evenly (Ångström's \(\lambda^{-\alpha}\), α ≈ 1.3 for continental haze, near 0 for fog), mostly forwards, and without much polarisation.</p>
</div><div>
<h3>What photographers can do</h3>
<p>A polarising filter darkens the molecular part of the airlight, most at 90° from the Sun, and so improves distant contrast a little; against haze it can do little. Infrared cameras gain much more: at 850 nm Rayleigh scattering is 5.8 times weaker than at 550 nm and haze a little weaker too, and vegetation reflects strongly (the red edge), which is why infrared landscapes look clear and their trees white. With the Sun ahead, forward scattering by haze makes the veil far brighter: backlit haze is the photographer's "atmosphere".</p>
<h3>Painters</h3>
<p>Leonardo described the bluing and paling of distant mountains in his notes on painting; the effect is a depth cue the visual system relies on, which is why landscapes without it, on the Moon or in very clean air, look smaller and closer than they are.</p>
</div></div>`));
  root.append(references([
    'H. Koschmieder, "Theorie der horizontalen Sichtweite", Beitr. Phys. freien Atmos. 12, 33 (1924).',
    'W. E. K. Middleton, <i>Vision through the Atmosphere</i>, University of Toronto Press (1952).',
    'A. Bucholtz, "Rayleigh-scattering calculations for the terrestrial atmosphere", Appl. Opt. 34, 2765 (1995).',
    'A. Ångström, "On the atmospheric transmission of sun radiation and on dust in the air", Geogr. Ann. 11, 156 (1929).',
    'C. F. Bohren &amp; E. E. Clothiaux, <i>Fundamentals of Atmospheric Radiation</i>, Wiley-VCH (2006).',
    'L. G. Henyey &amp; J. L. Greenstein, "Diffuse radiation in the galaxy", Astrophys. J. 93, 70 (1941).',
  ]));
  return () => [scene, ch1, ch2].forEach((st) => st.destroy());
}
