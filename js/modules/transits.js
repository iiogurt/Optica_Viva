// Exoplanet transits: a planet crossing its star dims it by the ratio of their areas.
import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { makeRng } from '../lib/random.js';
import { fluxAt, intensity, orbit, zAt, precision, transitSNR, sampleTransit, REARTH, AU } from '../lib/transit.js';
import { view3d } from '../lib/gl3d.js';
import { transitScene } from '../lib/transit3d.js';
import { t } from '../lib/i18n.js';

// Planet radius (Earth radii), period (d), stellar mass and radius (solar), impact parameter, V.
const SYSTEMS = {
  earth: { name: 'Earth and the Sun (seen from afar)', Rp: 1, P: 365.25, M: 1, R: 1, b: 0, V: 10 },
  jupiter: { name: 'Jupiter and the Sun', Rp: 11.21, P: 4332.6, M: 1, R: 1, b: 0, V: 10 },
  hd209: { name: 'HD 209458 b (hot Jupiter)', Rp: 15.2, P: 3.5247, M: 1.12, R: 1.16, b: 0.51, V: 7.65 },
  trappist: { name: 'TRAPPIST-1 e (red dwarf)', Rp: 0.92, P: 6.099, M: 0.0898, R: 0.1192, b: 0.24, V: 18.8 },
};
const SCOPES = {
  backyard: { name: 'Backyard telescope, 20 cm (1 mmag floor)', D: 0.2, floor: 1000, q: 0.4 },
  tess: { name: 'TESS, 10.5 cm (60 ppm floor)', D: 0.105, floor: 60, q: 0.5 },
  kepler: { name: 'Kepler, 0.95 m (20 ppm floor)', D: 0.95, floor: 20, q: 0.5 },
  jwst: { name: 'JWST, 6.5 m (10 ppm floor)', D: 6.5, floor: 10, q: 0.4 },
};

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>When a planet passes in front of its star, it blocks a tiny part of the star's light, like a fly crossing a distant lamp. The star dims by the planet's share of the star's disc: about 1 % for a Jupiter in front of a Sun, but less than 0.01 % for an Earth.</p>
<p>Measuring such small dips means counting enough photons that their natural randomness is smaller than the dip, which is why the hunt for small planets is done from space. How long the dip lasts tells how far the planet is from its star; its shape shows that stars are darker towards their edges.</p>`, [
    'Choose <strong>Earth and the Sun</strong>, then <strong>Jupiter and the Sun</strong>: the dip grows about 125-fold.',
    'With the Earth, switch the telescope from <strong>Backyard</strong> to <strong>Kepler</strong>: the dip emerges from the noise.',
    'Raise the <strong>impact parameter</strong> towards 1: the planet grazes the edge, and the dip becomes short and V-shaped.',
  ]));

  const ctl = controls({
    sys: { type: 'select', label: 'System', value: 'hd209', options: Object.entries(SYSTEMS).map(([k, s]) => [k, s.name]) },
    Rp: { type: 'range', label: 'Planet radius', min: 0.5, max: 20, log: true, value: 15.2, fmt: (v) => v.toPrecision(3) + ' R⊕' },
    P: { type: 'range', label: 'Orbital period', min: 0.5, max: 5000, log: true, value: 3.5247, fmt: (v) => (v < 10 ? v.toFixed(2) : v.toFixed(0)) + ' d' },
    R: { type: 'range', label: 'Star radius', min: 0.1, max: 3, log: true, value: 1.16, fmt: (v) => v.toFixed(2) + ' R☉' },
    M: { type: 'range', label: 'Star mass', min: 0.08, max: 3, log: true, value: 1.12, fmt: (v) => v.toFixed(2) + ' M☉' },
    b: { type: 'range', label: 'Impact parameter (0 = centre)', min: 0, max: 1.2, step: 0.01, value: 0.51 },
    ld: { type: 'toggle', label: 'Limb darkening (Sun-like, visible light)', value: true },
    V: { type: 'range', label: 'Star brightness (V magnitude)', min: 4, max: 19, step: 0.1, value: 7.65 },
    scope: { type: 'select', label: 'Telescope', value: 'tess', options: Object.entries(SCOPES).map(([k, s]) => [k, s.name]) },
    t: { type: 'range', label: 'Exposure per point', min: 10, max: 1800, log: true, value: 120, unit: 's' },
  }, (s) => {
    if (s.sys !== last) { const p = SYSTEMS[s.sys]; last = s.sys; ctl.set.Rp(p.Rp); ctl.set.P(p.P); ctl.set.R(p.R); ctl.set.M(p.M); ctl.set.b(p.b); ctl.set.V(p.V); }
    update();
  });
  let last = ctl.state.sys;
  const ro = h('div');
  const calc = liveCalc();
  const disc = stage({ aspect: 2.2, label: 'The star as seen by the telescope, with the planet\'s path', draw: drawStar, minH: 180 });
  const curve = stage({ aspect: 2.2, label: '', draw: drawCurve, cls: 'plain', minH: 240 });
  const v3 = view3d({ label: '3-D, true scale: the orbit, the sight lines through the star and the transit chord', aspect: 1.9, minH: 260, yaw: 2.3, pitch: 0.4 });
  root.append(lab([disc.el, h('div.card', { style: { padding: '8px' } }, curve.el), v3.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null, aR3d = 0;
  function update() {
    const st = ctl.state, sc = SCOPES[st.scope];
    const u = st.ld ? [0.4, 0.26] : [0, 0];
    const o = orbit({ P: st.P, Mstar: st.M, Rstar: st.R, Rp: st.Rp * REARTH, b: st.b });
    const sigW = precision({ V: st.V, D: sc.D, q: sc.q, t: st.t }), sigR = sc.floor; // ppm
    const transits = o.valid && isFinite(o.T14);
    const sys = { P: st.P, aR: o.aR, inc: o.inc, k: o.k, u1: u[0], u2: u[1], T14: o.T14 };
    const centre = o.valid ? 1 - fluxAt(st.b, o.k, u[0], u[1]) : 0;
    // the light curve over ±0.8 T14 (±3 h without a transit), and back-to-back exposures, each the
    // average of the light curve over its length; the SNR comes from these same exposures
    const span = transits ? Math.max(0.8 * o.T14, 1.5 * st.t) : 3 * 3600, n = 160;
    const model = o.valid ? Array.from({ length: n }, (_, i) => { const tt = -span + (2 * span * i) / (n - 1); return [tt / 3600, fluxAt(zAt(tt, st.P, o.aR, o.inc), o.k, u[0], u[1])]; }) : [];
    const exps = transits ? sampleTransit(sys, st.t, span) : [];
    const d = exps.map(([, f]) => 1 - f), nIn = d.filter((x) => x > 0).length;
    const snr1 = transits ? transitSNR(d, sigW * 1e-6, sigR * 1e-6) : 0;
    const need = snr1 > 0 ? Math.ceil((7.1 / snr1) ** 2) : Infinity;
    const sumD = d.reduce((a, x) => a + x, 0), sumD2 = d.reduce((a, x) => a + x * x, 0);
    // what the telescope records: white noise per exposure and a slow drift of the floor's size
    // (an Ornstein–Uhlenbeck process lasting about a transit), for the picture only
    const rng = makeRng(7), tau = transits ? o.T14 : 3 * 3600, rho = Math.exp(-st.t / tau);
    let drift = sigR * 1e-6 * rng.g();
    const pts = (transits ? exps : Array.from({ length: Math.min(4001, 2 * Math.floor(span / st.t) + 1) }, (_, i) => [(i - Math.floor(span / st.t)) * st.t, 1]))
      .map(([tt, f]) => { drift = rho * drift + Math.sqrt(1 - rho * rho) * sigR * 1e-6 * rng.g(); return [tt / 3600, f + sigW * 1e-6 * rng.g() + drift]; });
    M = { st, o, u, sig: Math.hypot(sigW, sigR), centre, model, pts, transits };
    const na = '—';
    ro.replaceChildren(readouts([
      ['Depth (R_p/R★)²', o.k >= 1 ? t('{v} (planet larger than the star: up to 100 %)', { v: fmt(o.depth, 3) }) : fmt(o.depth * 1e6, 3) + ' ppm = ' + (o.depth * 100).toPrecision(2) + ' %'],
      ['Dip at mid-transit (with limb darkening)', o.valid ? fmt(centre * 1e6, 3) + ' ppm' : na],
      ['Orbit radius', (o.a / AU).toPrecision(3) + ' AU = ' + o.aR.toPrecision(3) + ' R★'],
      ['Transit duration T₁₄', transits ? (o.T14 / 3600).toPrecision(3) + ' h' : o.valid ? t('no transit (b > 1 + k)') : na],
      ['Chance of any transit, (R★ + R_p)/a', o.valid ? (o.prob * 100).toPrecision(2) + ' %' : na],
      ['Photon noise per exposure', fmt(sigW, 3) + ' ppm'],
      ['Correlated floor per transit', fmt(sigR, 3) + ' ppm'],
      ['Exposures in transit', transits ? String(nIn) : na],
      ['SNR of one transit', transits ? snr1.toFixed(1) : na],
      ['Transits for a detection (SNR 7.1)', isFinite(need) ? String(need) : na],
    ]));
    const D2 = { ppm: fmt(centre * 1e6, 3), h: (o.T14 / 3600).toPrecision(2), sig: fmt(sigW, 3), floor: fmt(sigR, 3), dt: st.t.toFixed(0), n: nIn, snr: snr1 >= 100 ? snr1.toFixed(0) : snr1.toFixed(1) };
    calc.say(!o.valid
      ? (o.reason === 'inside'
        ? t('No such system: an orbit of {a} stellar radii lies inside the star (it must be wider than R★ + R_p = {m} R★). Lengthen the period, or choose a smaller star or planet.', { a: o.aR.toPrecision(3), m: (1 + o.k).toPrecision(3) })
        : t('No such system: an impact parameter of {b} is larger than the orbit ({a} stellar radii), and no inclination gives it.', { b: st.b.toFixed(2), a: o.aR.toPrecision(3) }))
      : transits
        ? t('The planet blocks <strong>{ppm} ppm</strong> of the starlight at mid-transit for <strong>{h} hours</strong>. {n} exposures of {dt} s fall in the transit, each with {sig} ppm of photon noise, on top of a {floor} ppm floor that does not average away within one transit: one transit gives signal-to-noise <strong>{snr}</strong>.', D2)
          + ' ' + (snr1 >= 7.1 ? t('That is a clear detection.') : t('About {n} transits ({y} years) are needed.', { n: need, y: fmt((need * st.P) / 365.25, 2) }))
        : t('At impact parameter {b} the planet passes beside the star: no transit is seen from this direction.', { b: st.b.toFixed(2) }));
    calc.set(String.raw`\begin{aligned}
    \delta &= \left(\frac{R_p}{R_\star}\right)^2 = ${texNum(o.k, 3)}^2 = ${texNum(o.depth * 1e6, 3)}\ \text{ppm}\\
    a &= \left(\frac{GM_\star P^2}{4\pi^2}\right)^{1/3} = ${texNum(o.a / AU, 3)}\ \text{AU} = ${texNum(o.aR, 3)}\,R_\star\\
    T_{14} &= \frac{P}{\pi}\arcsin\!\left[\frac{R_\star}{a}\frac{\sqrt{(1+k)^2-b^2}}{\sin i}\right] = ${transits ? texNum(o.T14 / 3600, 3) + '\\ \\text{h}' : '\\text{—}'}\\
    \mathrm{SNR}^2 &= \frac{1}{\sigma_w^2}\left[\sum d_i^2 - \frac{\sigma_r^2\left(\sum d_i\right)^2}{\sigma_w^2 + n\,\sigma_r^2}\right],\ n = ${nIn}\ \Rightarrow\ \mathrm{SNR} = ${transits ? texNum(snr1, 3) : '0'}
    \end{aligned}`);
    disc.redraw(); curve.redraw();
    // 3-D: the camera stays where the reader put it unless the orbit's size changes more than 1.5×
    if (!o.valid) return;
    const keep = aR3d > 0 && o.aR / aR3d < 1.5 && aR3d / o.aR < 1.5;
    v3.setScene(transitScene({ aR: o.aR, inc: o.inc, k: o.k, b: st.b }), keep);
    if (!keep) aR3d = o.aR;
  }

  function drawStar(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const { o, u, st } = M, R = Math.min(hh * 0.42, w * 0.2), cx = w / 2, cy = hh / 2, n = Math.ceil(2 * R);
    const ic = imageCanvas(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5 - n / 2) / R, (y + 0.5 - n / 2) / R), I = intensity(r, u[0], u[1]), k = 4 * (y * n + x);
      ic.data[k] = 255 * I; ic.data[k + 1] = 225 * I; ic.data[k + 2] = 170 * I; ic.data[k + 3] = r < 1 ? 255 : 0;
    }
    ic.put();
    ctx.drawImage(ic.c, cx - n / 2, cy - n / 2);
    // the planet's path at the impact parameter, and the planet at mid-transit
    const yb = cy - st.b * R;
    ctx.strokeStyle = 'rgba(106,215,255,0.5)'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(cx - 1.8 * R, yb); ctx.lineTo(cx + 1.8 * R, yb); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, yb, Math.max(1.2, o.k * R), 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t('planet to scale: {v1} % of the star\'s radius', { v1: (o.k * 100).toPrecision(2) }), 12, hh - 12);
  }

  function drawCurve(ctx, w, hh) {
    if (!M) return;
    const { model, pts, centre, sig } = M;
    if (!model.length) {
      ctx.fillStyle = '#9aa1b5'; ctx.font = '13px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(t('No light curve: these values do not describe a possible system.'), w / 2, hh / 2);
      return;
    }
    const lo = -Math.max(1.5 * centre * 1e6, 3 * sig), hi = Math.max(0.5 * centre * 1e6, 3 * sig);
    const clip = (v) => Math.max(lo, Math.min(hi, v));
    plot(ctx, w, hh, {
      title: 'Brightness of the star during the transit', x: { min: model[0][0], max: model[model.length - 1][0], label: 'hours from mid-transit' },
      y: { min: lo, max: hi, label: 'change in brightness (ppm)' }, padL: 66,
      series: [{ data: pts.map(([t, f]) => [t, clip((f - 1) * 1e6)]), color: 'rgba(154,161,181,0.5)', points: true, r: pts.length > 400 ? 1.2 : 2, label: 'measurements' }, { data: model.map(([t, f]) => [t, (f - 1) * 1e6]), color: '#ffb547', label: 'model' }],
      legend: true, legendX: w - 150, legendY: hh - 80,
    });
  }

  update();

  root.append(rule(String.raw`\[\delta = \left(\frac{R_p}{R_\star}\right)^2\]
<p>The dip is the planet's share of the star's disc. Jupiter in front of the Sun: \((71\,492/695\,700)^2 = 1.06\) %. The Earth: \((6371/695\,700)^2 = 84\) ppm, a dip of 0.0084 % lasting 13 hours once a year. Small stars make small planets easier: the Earth-sized TRAPPIST-1 e dims its red dwarf by 0.5 %.</p>`,
    String.raw`It holds for a planet smaller than its star (\(k < 1\)); a larger one hides the whole star at most. It ignores limb darkening, which makes the centre of the dip up to about 20 % deeper than \((R_p/R_\star)^2\) and rounds its shape, and it assumes an opaque planet: an atmosphere adds a wavelength-dependent ring that transmission spectroscopy measures. Starspots, grazing orbits and blended neighbouring stars change the apparent depth.`));

  root.append(theory('Light curves, orbits and noise', String.raw`
<div class="theory-cols"><div>
<h3>The occulted flux</h3>
<p>The star's surface brightness follows the quadratic limb-darkening law \(I(\mu)/I(1) = 1 - u_1(1-\mu) - u_2(1-\mu)^2\) with \(\mu = \sqrt{1-r^2}\); with limb darkening on, \(u_1 = 0.4\), \(u_2 = 0.26\), typical of a Sun-like star in visible light. Its total flux is \(\pi(1 - u_1/3 - u_2/6)\). With the planet's disc (radius \(k = R_p/R_\star\)) at projected separation \(z\), the blocked light is \(\int I(r)\,\theta(r)\,r\,dr\), where \(\theta(r) = 2\arccos\!\big[(r^2+z^2-k^2)/(2rz)\big]\) is the angle of the circle of radius \(r\) that the planet covers (\(2\pi\) where it covers the whole circle). The page splits the integral where \(\theta\) or \(I\) has a square-root corner, maps each piece so the corners become smooth, and uses 32-point Gauss–Legendre quadrature. For a uniform star this reproduces the area of overlap of two circles to \(10^{-9}\) at every \(z\) and \(k\), including grazing contact and a planet larger than its star. With limb darkening it agrees with Mandel &amp; Agol (2002) for an opaque disc. No overlap gives exactly 1, and a planet that covers the whole star gives exactly 0. The rule's \((R_p/R_\star)^2\) is the area ratio; for \(k \ge 1\) the dip can never exceed 100 %.</p>
<h3>Orbit</h3>
<p>For a circular orbit, Kepler's third law gives the semi-major axis \(a\) from the period and the star's mass; the inclination follows from the impact parameter, \(\cos i = b R_\star/a\), and the projected separation is \(z = (a/R_\star)\sqrt{\sin^2\phi + \cos^2 i\cos^2\phi}\). The total duration \(T_{14}\) is the formula of Seager &amp; Mallén-Ornelas (2003), and \((R_\star + R_p)/a\) is the probability that a randomly oriented orbit shows any transit, grazing ones included (\(R_\star/a\) for a small planet). The model is a detached circular orbit, so it needs \(a > R_\star + R_p\) and \(b \le a/R_\star\). Settings that break either describe no possible system, and the page says so instead of reporting a missed transit. The 3-D view shows why: the telescope sees the star through a cylinder of sight lines of radius \(R_\star\) (plus \(R_p\)), and a transit happens only if the orbit, a circle of radius \(a\), cuts through it. The gold chord is the part of the orbit inside the cylinder; the planet spends \(T_{14}\) on it, and the white segment at mid-transit is \(b\). For a hot Jupiter (\(a \approx 9R_\star\)) one orbit in nine is tilted little enough; for the Earth seen from afar (\(a = 215R_\odot\)) one in 215.</p>
</div><div>
<h3>Noise</h3>
<p>Each exposure collects \(N_\gamma = 10^6\cdot10^{-0.4V}\cdot10^4\,\pi(D/2)^2\,q\,t\) photons, with \(D\) in metres (so \(10^4\pi(D/2)^2\) is the area in cm²), a V band 100 nm wide and throughput \(q\). That gives white photon noise \(\sigma_w = 1/\sqrt{N_\gamma}\), independent from one exposure to the next. On top of it each telescope has a floor \(\sigma_r\): pointing jitter, detector drifts and, from the ground, scintillation and changing extinction. Here the floor is modelled as noise that varies slowly, so it is shared by all the exposures of one transit and is independent from one transit to the next (Pont, Zucker &amp; Queloz 2006).</p>
<p>Exposures follow each other without gaps (100 % duty cycle), one centred on mid-transit. Each records the light curve averaged over its length, so a long exposure smears ingress and egress, and a transit shorter than one exposure shows as a shallower dip. The average is taken over enough sub-intervals that each lasts at most \(T_{14}/200\) (Kipping 2010). The deficits \(d_i = 1 - F_i\) of the \(n\) exposures that overlap the transit give, against a known baseline,</p>
\[\mathrm{SNR}^2 = \mathbf d^\top C^{-1}\mathbf d = \frac{1}{\sigma_w^2}\left[\sum d_i^2 - \frac{\sigma_r^2\left(\sum d_i\right)^2}{\sigma_w^2 + n\,\sigma_r^2}\right],\qquad C = \sigma_w^2 I + \sigma_r^2\,\mathbf 1\mathbf 1^\top .\]
<p>For a box-shaped dip of depth \(\delta\) this is \(\delta/\sqrt{\sigma_w^2/n + \sigma_r^2}\). More exposures beat down the photon noise, but not the floor. A grazing, V-shaped transit counts only with its actual, smaller deficits. \(N\) independent transits give \(\sqrt N\) times one; Kepler's pipeline required 7.1 for a detection. That threshold belongs to a search over many periods with a known noise level, so here it only indicates what a detection takes.</p>
<div class="callout">The telescopes' floors are illustrative, not mission specifications, and every telescope uses the same V-band photon model: bandpasses and stellar spectra are not modelled. The baseline is taken as known; in practice it is fitted from the data around the transit, which adds noise. Red noise from stellar granulation and spots, which grows with transit duration, is not modelled. The measurements in the plot show the photon noise and a slow drift of the floor's size lasting about one transit, for illustration.</div>
</div></div>`));
  root.append(references([
    'K. Mandel and E. Agol, "Analytic light curves for planetary transit searches", Astrophys. J. 580, L171 (2002).',
    'S. Seager and G. Mallén-Ornelas, "A unique solution of planet and star parameters from an extrasolar planet transit light curve", Astrophys. J. 585, 1038 (2003).',
    'D. Charbonneau, T. M. Brown, D. W. Latham and M. Mayor, "Detection of planetary transits across a Sun-like star", Astrophys. J. 529, L45 (2000): HD 209458 b.',
    'J. M. Jenkins et al., "Overview of the Kepler science processing pipeline", Astrophys. J. 713, L87 (2010): the 7.1σ threshold.',
    'M. Gillon et al., "Seven temperate terrestrial planets around the nearby ultracool dwarf star TRAPPIST-1", Nature 542, 456 (2017).',
  ]));
  return () => [disc, curve, v3].forEach((s) => s.destroy());
}
