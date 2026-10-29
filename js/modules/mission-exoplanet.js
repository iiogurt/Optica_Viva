// Mission: plan the direct imaging of a planet beside its star.
import { h, controls, stage, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { MODULES } from '../app.js';
import { PLANETS, plan } from '../lib/exoimaging.js';
import { t } from '../lib/i18n.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const hours = (s) => (s < 3600 ? (s / 60).toFixed(0) + ' min' : s < 86400 * 3 ? (s / 3600).toPrecision(2) + ' h' : (s / 86400).toPrecision(2) + ' days');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>To photograph an Earth around another star, a telescope must pick out a faint dot ten billion times dimmer than the star, and so close to it that the two nearly merge. Two questions decide whether it can be done: is the planet far enough from the star for the coronagraph or starshade to block the star but not the planet, and is the leftover starlight fainter than the planet?</p>
<p>If both answers are yes, the rest is patience: counting the planet's few photons until they stand out from the noise, and many more to split them into a spectrum that could reveal oxygen or water.</p>`, [
    'With the Earth twin at 10 parsecs, shrink the telescope from 6 m to 2.4 m: the planet slips inside the inner working angle.',
    'Raise the <strong>contrast floor</strong> from 10⁻¹⁰ to 10⁻⁹: the time to detect grows, because leftover starlight outshines the planet.',
    'Move the star from 10 to 5 parsecs: the planet is twice as far from the star on the sky and four times brighter.',
  ]));

  const ctl = controls({
    planet: { type: 'select', label: 'Planet', value: 'earth', options: Object.entries(PLANETS).map(([k, p]) => [k, p.name]) },
    d: { type: 'range', label: 'Distance to the star', min: 1.3, max: 30, log: true, value: 10, unit: 'pc' },
    D: { type: 'range', label: 'Telescope diameter', min: 1, max: 15, log: true, value: 6, unit: 'm' },
    lam: { type: 'range', label: 'Wavelength', min: 0.4, max: 1, step: 0.01, value: 0.55, unit: 'µm' },
    iwa: { type: 'range', label: 'Coronagraph inner working angle', min: 1.5, max: 6, step: 0.1, value: 3, fmt: (v) => v.toFixed(1) + ' λ/D' },
    floor: { type: 'range', label: 'Residual starlight (contrast floor)', min: 1e-11, max: 1e-8, log: true, value: 1e-10, fmt: (v) => v.toExponential(0) },
    nExo: { type: 'range', label: 'Exozodiacal dust', min: 0, max: 20, step: 0.5, value: 3, fmt: (v) => v + ' zodi' },
  }, () => update());
  const calc = liveCalc('Your observation');
  const steps = [
    missionStep(1, 'Planet contrast', 'telescope', titleOf('telescope')),
    missionStep(2, 'Separation', 'starshade', titleOf('starshade')),
    missionStep(3, 'Time to detect', 'stacking', titleOf('stacking')),
    missionStep(4, 'Time for a spectrum', 'spectro', titleOf('spectro')),
  ];
  const sky = stage({ aspect: 2.2, label: 'Around the star: rings every λ/D, shaded = inner working angle', draw: drawSky, minH: 220 });
  const curve = stage({ aspect: 2.2, label: '', draw: drawCurve, cls: 'plain', minH: 220 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), h('div.grid-2', {}, sky.el, h('div.card', { style: { padding: '8px' } }, curve.el))], [h('div.card', {}, ctl.el), calc.el]));

  let R = null;
  function update() {
    const st = ctl.state;
    R = { st, ...plan({ planet: st.planet, d: st.d, D: st.D, lam: st.lam, iwa: st.iwa, floor: st.floor, nExo: st.nExo }) };
    const r = R;
    steps[0].set({
      answer: `${fmt(r.C, 2)} <small>of the star</small>`,
      why: `In reflected light at its widest elongation the planet (${r.P.name}) returns ${fmt(r.C, 2)} of the starlight. ${r.aboveFloor ? `That is ${(r.C / st.floor).toPrecision(2)} times the leftover starlight around it.` : 'That is below the leftover starlight around it: the coronagraph must do better.'}`,
      tex: String.raw`C = A_g\,\Phi\left(\frac{R_p}{a}\right)^2 = ${texNum(r.C * 1e10, 3)}\times10^{-10}`,
    });
    steps[1].set({
      answer: r.outside ? `${r.sep.toFixed(0)} mas <small>(${r.sepLD.toFixed(1)} λ/D)</small>` : `Too close <small>(${r.sepLD.toFixed(1)} λ/D)</small>`,
      why: `A ${r.P.a} AU orbit at ${st.d} pc is ${r.sep.toFixed(0)} milliarcseconds from the star. The coronagraph blocks everything within ${st.iwa} λ/D = ${r.iwaMas.toFixed(0)} mas; ${r.outside ? 'the planet lies outside it.' : `a telescope of at least ${(st.D * r.iwaMas / r.sep).toFixed(1)} m, or a starshade, is needed.`}`,
      tex: String.raw`\theta = \frac{a}{d} = ${texNum(r.sep, 3)}\ \text{mas},\quad \frac{\lambda}{D} = ${texNum(r.lD, 3)}\ \text{mas}`,
    });
    steps[2].set({
      answer: r.outside ? hours(r.t) : '—',
      why: `The star delivers ${fmt(r.Fs, 3)} photons per second after a 5 % end-to-end throughput; the planet ${fmt(r.C * r.Fs, 2)}, against ${fmt(st.floor * r.Fs + r.Fz, 2)} from leftover starlight and zodiacal dust. A signal-to-noise ratio of 7 takes ${hours(r.t)}.`,
      tex: String.raw`t = \frac{\mathrm{SNR}^2 (F_p + F_b)}{F_p^2}`,
    });
    steps[3].set({
      answer: r.outside ? hours(r.tSpec) : '—',
      why: `Splitting the light into a spectrum with resolving power 70, enough for oxygen and water bands, spreads the photons over 14 channels and takes ${hours(r.tSpec)} at the same signal-to-noise ratio.`,
      tex: String.raw`t_\text{spec} \approx 0.2R\cdot t\ (R = 70)`,
    });
    calc.say(r.outside
      ? (r.aboveFloor
        ? t('<strong>Observable:</strong> the planet sits {s} λ/D from the star, above the leftover starlight; detection takes <strong>{td}</strong> and a spectrum about <strong>{ts}</strong>.', { s: r.sepLD.toFixed(1), td: hours(r.t), ts: hours(r.tSpec) })
        : t('<strong>Observable:</strong> the planet sits {s} λ/D from the star, below the leftover starlight; detection takes <strong>{td}</strong> and a spectrum about <strong>{ts}</strong>.', { s: r.sepLD.toFixed(1), td: hours(r.t), ts: hours(r.tSpec) }))
      : t('<strong>Not observable</strong> with this telescope: the planet lies inside the inner working angle ({s} λ/D against {iwa}).', { s: r.sepLD.toFixed(1), iwa: st.iwa }));
    calc.set(String.raw`\begin{aligned}
    V_\star &= 4.83 + 5\log_{10}(d/10\,\text{pc}) = ${texNum(r.V, 3)}\\
    F_p &= C\,F_\star = ${texNum(r.C * r.Fs, 3)}\ \text{s}^{-1}
    \end{aligned}`);
    sky.redraw(); curve.redraw();
  }

  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const cx = w / 2, cy = hh / 2 + 8, maxLD = Math.max(R.sepLD * 1.4, R.st.iwa * 1.6, 4), s = (Math.min(w, hh) / 2 - 20) / maxLD;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let k = 1; k <= maxLD; k++) { ctx.beginPath(); ctx.arc(cx, cy, k * s, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = 'rgba(193,140,255,0.15)'; ctx.beginPath(); ctx.arc(cx, cy, R.st.iwa * s, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#ffe9b0'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
    const px = cx + R.sepLD * s * 0.7071, py = cy - R.sepLD * s * 0.7071;
    ctx.fillStyle = R.outside ? '#6ad7ff' : '#ff6b6b'; ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = '#9aa1b5'; ctx.textAlign = 'left';
    ctx.fillText(t('planet at {sep} mas', { sep: R.sep.toFixed(0) }), px + 8, py - 4);
  }

  function drawCurve(ctx, w, hh) {
    if (!R) return;
    const { st } = R, ds = logRange(1.3, 30, 80);
    const data = ds.map((d) => { const r = plan({ planet: st.planet, d, D: st.D, lam: st.lam, iwa: st.iwa, floor: st.floor, nExo: st.nExo }); return [d, r.outside ? r.t / 3600 : NaN]; }).filter((p) => isFinite(p[1]));
    plot(ctx, w, hh, {
      title: 'Hours to detect vs distance to the star', x: { min: 1.3, max: 30, log: true, label: 'distance (pc)' }, y: { min: 0.01, max: 1e4, log: true, label: 'hours' },
      series: [{ data, color: '#6ad7ff' }], vlines: [{ x: st.d, color: '#ffb547', label: 'this star' }],
    });
  }

  update();

  root.append(rule(String.raw`\[C \approx A_g\,\frac{1}{\pi}\left(\frac{R_p}{a}\right)^2,\qquad \theta = \frac{a}{d}\]
<p>An Earth twin (\(A_g \approx 0.37\)) reflects \(0.37/\pi \times (6371/1.496\times10^8)^2 \approx 2\times10^{-10}\) of the Sun's light at its widest point. At 10 parsecs its 1 AU orbit is 100 mas from the star: 5 λ/D for a 6 m telescope in green light, but only 2 λ/D for a 2.4 m one. A planet's separation shrinks with distance while the number of candidate stars grows with its cube; that is why the mirror size decides how many Earths can be surveyed.</p>`,
    String.raw`The contrast ignores the planet's actual phase, clouds and the illumination geometry along its orbit; integration times include only photon noise from the planet, residual starlight and zodiacal dust, not detector noise, speckle drift or overheads, so real missions plan for several times longer.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Contrast and separation</h3>
<p>The reflected-light contrast is \(A_g\Phi(\alpha)(R_p/a)^2\) with the Lambert-sphere phase function at quadrature, \(\Phi = 1/\pi\). The separation at maximum elongation is \(a/d\) (1 AU at 1 pc is 1″). The coronagraph's inner working angle is given in units of \(\lambda/D\); a planet inside it is lost.</p>
<h3>Photons</h3>
<p>The star is Sun-like, \(V = 4.83 + 5\log_{10}(d/10\,\text{pc})\), with \(10^6\) photons s⁻¹ cm⁻² per 100 nm at \(V = 0\), a 100 nm (≈ 20 %) band and 5 % end-to-end throughput (mirrors, coronagraph core throughput, filters and detector). Residual starlight is the contrast floor times the star's rate in the planet's photometric aperture; zodiacal light is 22.5 V mag/arcsec² locally plus 22 mag/arcsec² per zodi of exozodiacal dust, over a 0.7 λ/D radius.</p>
</div><div>
<h3>Integration time</h3>
<p>With planet rate \(F_p\) and background \(F_b\), the photon-limited signal-to-noise ratio after time \(t\) is \(F_p t/\sqrt{(F_p + F_b)t}\), so \(t = \mathrm{SNR}^2(F_p+F_b)/F_p^2\). A spectrum at resolving power \(R\) over a 20 % band has \(0.2R\) channels, each receiving that share of the photons.</p>
<div class="callout">Order-of-magnitude planning only: mission studies such as those for the Habitable Worlds Observatory add detector noise, speckle stability, post-processing, overheads and the planet's orbital phase.</div>
</div></div>`));
  root.append(references([
    'W. A. Traub and B. R. Oppenheimer, "Direct imaging of exoplanets", in S. Seager (ed.), <i>Exoplanets</i>, University of Arizona Press (2010).',
    'C. C. Stark et al., "Maximizing the exoEarth candidate yield from a future direct imaging mission", Astrophys. J. 795, 122 (2014).',
    'LUVOIR and HabEx final reports (2019); NASA Habitable Worlds Observatory studies (2023 onwards).',
  ]));
  return () => [sky, curve].forEach((s) => s.destroy());
}
