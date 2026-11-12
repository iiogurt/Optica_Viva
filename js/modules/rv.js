// Radial-velocity precision: the photon-noise limit of a stellar spectrum, and which planets it reveals.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { wavelengthRGB } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { makeRng } from '../lib/random.js';
import { C, PLANETS, semiAmplitude, observe } from '../lib/rv.js';
import { t, N_ } from '../lib/i18n.js';

const PLANET_LABELS = {
  peg51: N_('51 Pegasi b (hot Jupiter, 4.2 days)'), hotNeptune: N_('A hot Neptune (17 Earths, 10 days)'), jupiter: N_('Jupiter, seen from afar (11.9 years)'),
  proxb: N_('Proxima b (1.1 Earths, red dwarf, 11.2 days)'), earth: N_('Earth, seen from afar (1 year)'),
};
const ROWS = 34, COLS = 1400, ZOOM = 0.12; // echelle rows; columns kept per row; zoom half-width, nm
const MC_MAX = 160, MC_BATCH = 8;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A planet and its star circle their common centre, so the star moves towards us and away again, by about 12 metres per second for Jupiter and 9 centimetres per second for Earth. That motion shifts the dark lines in the star's spectrum a tiny bit towards blue, then red: by a thousandth of a pixel on the camera, or less.</p>
<p>No single line can be measured that well. But a star has thousands of lines, and every steep flank of every line adds a little information. How much depends on how much light you collect, how sharp the lines are and how fast the star spins.</p>`, [
    'Make the star <strong>spin faster</strong>: why does the precision get worse when the lines just get wider?',
    'Halve the <strong>resolution</strong>: how much worse does it get? Compare an F star with an M star.',
    'Pick <strong>Earth</strong>: how many measurements would you need, and what does star "jitter" do to that?',
  ]));

  const ctl = controls({
    type: { type: 'seg', label: 'Star', value: 'G', options: [['F', 'F (6500 K)'], ['G', 'G (Sun)'], ['K', 'K (4800 K)'], ['M', 'M (3300 K)']] },
    vsini: { type: 'range', label: 'Rotation speed at the equator (v sin i)', min: 0.5, max: 30, log: true, value: 2, unit: 'km/s' },
    R: { type: 'range', label: 'Resolving power of the spectrograph', min: 20000, max: 200000, log: true, value: 115000, fmt: (v) => fmt(Math.round(v / 1000), 3) + ' 000' },
    snr: { type: 'range', label: 'Signal-to-noise ratio per pixel', min: 10, max: 1000, log: true, value: 100 },
    planet: { type: 'select', label: 'Planet', value: 'peg51', options: Object.keys(PLANETS).map((k) => [k, PLANET_LABELS[k]]) },
    N: { type: 'range', label: 'Number of measurements', min: 4, max: 1000, log: true, step: 1, value: 40 },
    jitter: { type: 'range', label: 'Star jitter (activity) and instrument drift', min: 0, max: 5, step: 0.05, value: 0, unit: 'm/s' },
    zoom: { type: 'range', label: 'Look closely at', min: 381, max: 689, step: 0.05, value: 527, unit: 'nm' },
  }, () => update());
  let seed = 5;
  const again = h('button.tag', { type: 'button', onClick: () => { seed++; refresh(); } }, t('Observe again'));
  const ro = h('div'), calc = liveCalc();
  const pic = stage({ aspect: 1.75, label: 'The spectrum as an echelle spectrograph records it, 380–690 nm in rows', draw: drawPic, minH: 260 });
  const zoom = stage({ aspect: 1.5, label: '', draw: drawZoom, cls: 'plain', minH: 230 });
  const hist = stage({ aspect: 1.5, label: '', draw: drawHist, cls: 'plain', minH: 230 });
  const orbit = stage({ aspect: 2.6, label: '', draw: drawOrbit, cls: 'plain', minH: 220 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([pic.el, h('div.grid-2', {}, card(zoom), card(hist)), card(orbit)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, again)), h('div.card', {}, ro), calc.el]));

  const job = latest('rv'), mcJob = latest('rvmc');
  let S = null, rows = null, mc = [], mcKey = '', alive = true;
  const specOf = (st) => ({ type: st.type, R: Math.round(st.R), vsini: Math.round(st.vsini * 1000) });
  const request = debounce(() => {
    const spec = specOf(ctl.state), key = JSON.stringify(spec);
    job('rv', spec).then((r) => {
      S = { ...r, key }; rows = echelleRows(r); refresh(); pic.redraw(); zoom.redraw();
      if (mcKey !== key) { mcKey = key; mc = []; runMC(spec, key); }
    }, () => {});
  }, 80);
  function runMC(spec, key) {
    if (!alive || mcKey !== key || mc.length >= MC_MAX) return;
    mcJob('rvMC', { spec, trials: MC_BATCH, seed: 100 + mc.length }).then((e) => {
      if (mcKey !== key) return;
      mc.push(...e); hist.redraw(); words();
      setTimeout(() => runMC(spec, key), 30);
    }, () => {});
  }
  function update() { request(); refresh(); }
  function refresh() { words(); zoom.redraw(); hist.redraw(); orbit.redraw(); }

  // mean flux of each echelle row in COLS columns (rows are equal in log λ, as real orders are)
  function echelleRows(r) {
    const per = r.n / ROWS, out = new Float32Array(ROWS * COLS);
    for (let k = 0; k < ROWS; k++) for (let c = 0; c < COLS; c++) {
      const a = Math.floor(k * per + (c * per) / COLS), b = Math.max(a + 1, Math.floor(k * per + ((c + 1) * per) / COLS));
      let s = 0; for (let i = a; i < b; i++) s += r.flux[i]; out[k * COLS + c] = s / (b - a);
    }
    return out;
  }
  const lambdaAt = (i) => S.l0 * Math.exp((i * S.dv) / C);
  const indexOf = (l) => (Math.log(l / S.l0) * C) / S.dv;
  const sigmaPhoton = (st) => (S ? S.sigma1 / st.snr : NaN);
  const planetK = (st) => { const p = PLANETS[st.planet]; return semiAmplitude(p.mp, p.P, p.M); };

  function words() {
    const st = ctl.state;
    if (!S) return;
    const sp = sigmaPhoton(st), tot = Math.hypot(sp, st.jitter), K = planetK(st), fit = observe(K, tot, Math.round(st.N), seed), px = S.dv;
    const sig = fit.K / fit.sigmaK, verdict = sig > 5 ? t('a clear detection') : sig > 3 ? t('a marginal detection') : t('not a detection');
    let mcs = NaN; if (mc.length > 3) { let s = 0; for (const e of mc) s += e * e; mcs = Math.sqrt(s / mc.length) / st.snr; }
    ro.replaceChildren(readouts([
      ['Photon-noise limit per measurement', `${fmt(sp, 3)} m/s`],
      ['… measured by simulation', mc.length > 3 ? `${fmt(mcs, 3)} m/s (${mc.length})` : '…'],
      ['Quality factor Q of the spectrum', fmt(S.Q, 4)],
      ['One pixel, as a velocity', `${fmt(px, 4)} m/s`],
      ['Lines in the spectrum', fmt(S.lines, 4)],
      ['The planet\'s pull, K', `${fmt(K, 3)} m/s (${fmt(K / px, 2)} px)`],
      ['Fitted K from the measurements', `${fmt(fit.K, 3)} ± ${fmt(fit.sigmaK, 2)} m/s`],
    ]));
    calc.say(t('With a signal-to-noise ratio of {snr} per pixel, the {n} lines of this star give a photon-noise limit of <strong>{s} m/s</strong>: 1/{frac} of a pixel. The planet moves the star by K = {K} m/s; {N} measurements of {tot} m/s each give K = {Kf} ± {sK} m/s, <strong>{verdict}</strong>.', {
      snr: fmt(st.snr, 3), n: fmt(S.lines, 4), s: fmt(sp, 3), frac: fmt(px / sp, 3), K: fmt(K, 3), N: Math.round(st.N), tot: fmt(tot, 3), Kf: fmt(fit.K, 3), sK: fmt(fit.sigmaK, 2), verdict,
    }));
    calc.set(String.raw`\begin{aligned}
    \sigma_V &= \Big(\sum_i \frac{(\partial A_i/\partial v)^2}{A_i}\Big)^{-1/2} = ${texNum(sp, 3)}\ \text{m/s}\\
    Q &= \frac{c}{\sigma_V\sqrt{N_e}} = ${texNum(S.Q, 4)}\\
    K &= \Big(\frac{2\pi G}{P}\Big)^{1/3}\frac{m_p\sin i}{(M_\star+m_p)^{2/3}} = ${texNum(K, 3)}\ \text{m/s}\\
    \sigma_K &\approx \sigma\sqrt{2/N} = ${texNum(tot * Math.sqrt(2 / Math.round(st.N)), 3)}\ \text{m/s}
    \end{aligned}`);
  }

  function drawPic(ctx, w, hh) {
    ctx.fillStyle = '#04050a'; ctx.fillRect(0, 0, w, hh);
    if (!S) return;
    const L = 46, top = 30, rh = (hh - top - 8) / ROWS, per = S.n / ROWS;
    const tint = Array.from({ length: ROWS }, (_, k) => Array.from({ length: 9 }, (_, j) => wavelengthRGB(lambdaAt((k + j / 8) * per), false)));
    paint(pic, { x: L, y: top, w: w - L - 10, h: hh - top - 8 }, (u, v, o) => {
      const y = v * ROWS, k = Math.min(ROWS - 1, Math.floor(y)), fy = y - k;
      if (fy < 0.14 || fy > 0.86) { o[0] = o[1] = o[2] = 0.015; return; }
      const x = u * (COLS - 1), c = Math.floor(x), fc = x - c, f = rows[k * COLS + c] * (1 - fc) + rows[k * COLS + Math.min(COLS - 1, c + 1)] * fc;
      const q = u * 8, j = Math.min(7, Math.floor(q)), a = tint[k][j], b = tint[k][j + 1], fq = q - j, edge = Math.sin(((fy - 0.14) / 0.72) * Math.PI) ** 0.4;
      for (let ch = 0; ch < 3; ch++) o[ch] = encode((0.06 + 0.94 * ((1 - fq) * a[ch] + fq * b[ch])) * f * edge * 1.1);
    }, S.key);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let k = 0; k < ROWS; k += 3) ctx.fillText(fmt(lambdaAt(k * per), 3), L - 5, top + (k + 0.5) * rh);
    ctx.save(); ctx.translate(11, top + (hh - top) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(t('row starts at (nm)'), 0, 0); ctx.restore();
    // the zoom window
    const i = indexOf(ctl.state.zoom), k = Math.min(ROWS - 1, Math.floor(i / per)), u0 = (indexOf(ctl.state.zoom - ZOOM) - k * per) / per, u1 = (indexOf(ctl.state.zoom + ZOOM) - k * per) / per;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(L + u0 * (w - L - 10) - 2, top + k * rh, Math.max(4, (u1 - u0) * (w - L - 10)) + 4, rh);
  }

  function drawZoom(ctx, w, hh) {
    if (!S) return;
    const st = ctl.state, l0 = st.zoom - ZOOM, l1 = st.zoom + ZOOM, a = Math.max(1, Math.floor(indexOf(l0))), b = Math.min(S.n - 2, Math.ceil(indexOf(l1)));
    const tpl = [], dat = [], wt = [], rng = makeRng(1000 + Math.round(st.zoom * 20)), N = st.snr * st.snr;
    let wmax = 0; const ws = [];
    for (let i = a; i <= b; i++) { const d = (S.flux[i + 1] - S.flux[i - 1]) / 2, wv = (d * d) / S.flux[i]; ws.push(wv); wmax = Math.max(wmax, wv); }
    for (let i = a; i <= b; i++) {
      const l = lambdaAt(i), f = S.flux[i];
      tpl.push([l, f]); dat.push([l, f + (Math.sqrt(N * f) / N) * rng.g()]); wt.push([l, 0.02 + 0.3 * (ws[i - a] / (wmax || 1))]);
    }
    plot(ctx, w, hh, {
      title: N_('A close look: where the velocity information sits'), x: { min: l0, max: l1, label: N_('wavelength (nm)'), fmt: (v) => v.toFixed(2) }, y: { min: 0, max: 1.12, label: N_('flux (continuum = 1)') },
      series: [{ data: wt, color: 'rgba(255,181,71,0.0)', fill: 'rgba(255,181,71,0.35)', label: N_('weight of each pixel, (dA/dv)²/A') }, { data: tpl, color: '#6ad7ff', width: 1.6, label: N_('spectrum') }, { data: dat, color: 'rgba(255,255,255,0.75)', points: true, r: 1.6, label: N_('measured pixels') }],
      legend: true,
    });
  }

  function drawHist(ctx, w, hh) {
    const st = ctl.state;
    if (!S) return;
    const sp = sigmaPhoton(st), span = 4 * sp, bins = 24, cnt = new Array(bins).fill(0), errs = mc.map((e) => e / st.snr);
    for (const e of errs) { const k = Math.floor(((e + span) / (2 * span)) * bins); if (k >= 0 && k < bins) cnt[k]++; }
    const bw = (2 * span) / bins, step = [], gauss = [];
    cnt.forEach((c, k) => { const x0 = -span + k * bw; step.push([x0, c], [x0 + bw, c]); });
    for (let i = 0; i <= 120; i++) { const x = -span + (i / 120) * 2 * span; gauss.push([x, (errs.length * bw * Math.exp(-0.5 * (x / sp) ** 2)) / (sp * Math.sqrt(2 * Math.PI))]); }
    const ymax = Math.max(4, ...cnt, (errs.length * bw) / (sp * Math.sqrt(2 * Math.PI))) * 1.15;
    plot(ctx, w, hh, {
      title: N_('Simulated measurements of a star at rest'), x: { min: -span, max: span, label: N_('measured velocity (m/s)') }, y: { min: 0, max: ymax, label: N_('number of spectra') },
      series: [{ data: step, color: '#6ad7ff', width: 1.4, fill: 'rgba(106,215,255,0.25)', label: N_('noisy spectra, least-squares velocity') }, { data: gauss, color: '#ffb547', width: 2, label: N_('photon-noise limit σ_V') }],
      legend: true,
    });
  }

  function drawOrbit(ctx, w, hh) {
    const st = ctl.state;
    if (!S) return;
    const sp = sigmaPhoton(st), tot = Math.hypot(sp, st.jitter), K = planetK(st), fit = observe(K, tot, Math.round(st.N), seed), model = [];
    for (let i = 0; i <= 200; i++) model.push([i / 200, K * Math.sin((2 * Math.PI * i) / 200)]);
    const lim = Math.max(K * 1.6, 3.2 * tot);
    const pts = fit.pts.slice().sort((p, q) => p[0] - q[0]);
    const m = plot(ctx, w, hh, {
      title: N_('The star\'s velocity over one orbit'), x: { min: 0, max: 1, label: N_('orbital phase') }, y: { min: -lim, max: lim, label: N_('radial velocity (m/s)') },
      series: [{ data: model, color: '#ffb547', width: 2, label: N_('true motion') }, { data: pts, color: '#6ad7ff', points: true, r: 2.4, label: N_('measurements, with 1σ error bars') }],
      legend: true,
    });
    if (m && pts.length <= 300) {
      ctx.save(); ctx.strokeStyle = 'rgba(106,215,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const [x, y] of pts) { const X = m.X(x), y0 = m.Y(Math.max(-lim, y - tot)), y1 = m.Y(Math.min(lim, y + tot)); ctx.moveTo(X + 0.5, y0); ctx.lineTo(X + 0.5, y1); }
      ctx.stroke(); ctx.restore();
    }
  }
  update();

  root.append(rule(String.raw`\[\sigma_V \approx \frac{c}{Q\sqrt{N_e}}\]
<p>The precision improves as the square root of the light collected, \(N_e\) photo-electrons in the whole spectrum, and in proportion to the spectrum's quality factor \(Q\), which counts how many steep line flanks it has. For a quiet Sun-like star seen by HARPS (Q ≈ 10 000) at a signal-to-noise ratio of 100 per pixel, \(\sigma_V\) is about 0.7 m/s: 51 Pegasi b (56 m/s) shows in one night, while Earth (0.09 m/s) would need thousands of such measurements even if the star were perfectly quiet.</p>`,
    String.raw`Photon noise only, for a quiet star: real stars add 0.5–2 m/s of "jitter" from oscillations, granulation and spots, which no amount of light removes, and instruments drift. Q scales roughly as 1/v sin i above a few km/s and as R up to the intrinsic line width. The line list is synthetic, with a flat continuum and the same signal-to-noise ratio in every pixel.`));
  root.append(theory('The information in a spectrum', String.raw`
<div class="theory-cols"><div>
<h3>Optimal weighting</h3>
<p>A small shift \(\delta v\) changes pixel \(i\) by \(\delta A_i = (\partial A_i/\partial v)\,\delta v\) against a photon noise \(\sqrt{A_i}\). Each pixel alone measures \(\delta v\) with variance \(A_i/(\partial A_i/\partial v)^2\); combining them with inverse-variance weights gives Connes' (1985) limit \(\sigma_V^{-2} = \sum_i (\partial A_i/\partial v)^2/A_i\). The least-squares fit of a template reaches it, as the histogram shows; cross-correlation with a binary mask comes within about 10–20 % (Bouchy, Pepe &amp; Queloz 2001).</p>
<h3>Lines, resolution, rotation</h3>
<p>Only the slopes count: flat continuum carries nothing. Deep, narrow lines are best, so cool stars with many metal lines beat hot ones. Rotation and a low resolving power spread each line: its depth falls and its flanks lengthen, and \(\sigma_V\) grows roughly in proportion to the width. Here rotation uses Gray's profile with limb darkening 0.6, and the spectrograph a Gaussian line-spread function of FWHM \(c/R\), sampled by three pixels.</p>
</div><div>
<h3>The planet</h3>
<p>A planet of mass \(m_p\) on a circular orbit of period \(P\) moves its star with semi-amplitude \(K = (2\pi G/P)^{1/3} m_p\sin i/(M_\star+m_p)^{2/3}\): 12.5 m/s for Jupiter, 9 cm/s for Earth. Fitting a sinusoid of known period to \(N\) measurements of error \(\sigma\) gives \(K\) with an uncertainty of about \(\sigma\sqrt{2/N}\).</p>
<h3>The real limits</h3>
<p>ESPRESSO reaches about 0.25 m/s on bright quiet stars; the floor is set by the stars themselves (p-mode oscillations, granulation, spots and faculae) and by calibration with laser frequency combs. Finding Earth twins needs \(\sim\)10 cm/s and ways to model stellar activity.</p>
</div></div>`));
  root.append(references([
    'P. Connes, "Absolute astronomical accelerometry", Astrophys. Space Sci. 110, 211 (1985).',
    'F. Bouchy, F. Pepe &amp; D. Queloz, "Fundamental photon noise limit to radial velocity measurements", Astron. Astrophys. 374, 733 (2001).',
    'M. Mayor &amp; D. Queloz, "A Jupiter-mass companion to a solar-type star", Nature 378, 355 (1995).',
    'D. F. Gray, <i>The Observation and Analysis of Stellar Photospheres</i>, 3rd ed., Cambridge University Press (2005).',
    'G. Anglada-Escudé et al., "A terrestrial planet candidate in a temperate orbit around Proxima Centauri", Nature 536, 437 (2016).',
    'F. Pepe et al., "ESPRESSO at VLT: on-sky performance and first results", Astron. Astrophys. 645, A96 (2021).',
  ]));
  return () => { alive = false; [pic, zoom, hist, orbit].forEach((s) => s.destroy()); };
}
