// Laser communication across the solar system: the beam's spread, the link budget, and photon-counting
// pulse-position modulation that makes each detected photon carry several bits.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { latest } from '../lib/compute.js';
import { uniform } from '../lib/random.js';
import { PRESETS, ETA, KM, AU, R_EARTH, KA, budget, radioRate, photonFrames, atmosphere } from '../lib/lasercom.js';
import { t, N_, fmtInt } from '../lib/i18n.js';

const PRESET_LABELS = { dsoc: N_('Psyche (DSOC) at 386 million km'), mars: N_('The same terminal at 55 million km'), llcd: N_('A lunar link like LLCD (384 400 km)') };
const FRAMES = 14;
const MOON = 384.4e6, MEASURED = [[384.4e6, 622e6], [386e9, 8.3e6]];

function rateText(b) {
  if (!(b > 0)) return t('{v} bit/s', { v: 0 });
  if (b >= 1e9) return t('{v} Gbit/s', { v: fmt(b / 1e9, 3) });
  if (b >= 1e6) return t('{v} Mbit/s', { v: fmt(b / 1e6, 3) });
  if (b >= 1e3) return t('{v} kbit/s', { v: fmt(b / 1e3, 3) });
  return t('{v} bit/s', { v: fmt(b, 3) });
}
function distText(m) {
  if (m < 2e9) return t('{v} km', { v: fmtInt(m / KM) });
  return t('{v} million km ({au} AU)', { v: fmt(m / 1e9, 3), au: fmt(m / AU, 3) });
}

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Every beam spreads as it travels, because light is a wave squeezed through an opening: the smaller the opening compared with the wave, the faster it spreads. Light waves are thousands of times shorter than the radio waves spacecraft use, so a laser telescope the size of a dinner plate makes a far narrower beam than a big radio dish.</p>
<p>Even so, from near Mars the beam covers a patch of Earth thousands of kilometres wide, and a 5-metre telescope catches only a few million photons (particles of light) a second. So each photon must count: the message is coded in <em>when</em> a short pulse arrives, in one of many time slots, and one photon can carry several bits.</p>`, [
    'Make the <strong>spacecraft\'s telescope</strong> twice as wide: guess how much faster the link gets, then check.',
    'Switch from the <strong>Moon</strong> to <strong>Psyche</strong>: the distance grows a thousandfold. How much does the data rate fall?',
    'Raise the <strong>background light</strong>: why does a longer code (more slots) stop helping?',
  ]));

  const ctl = controls({
    preset: { type: 'select', label: 'Link', value: 'dsoc', options: Object.keys(PRESETS).map((k) => [k, PRESET_LABELS[k]]) },
    R: { type: 'range', label: 'Distance', min: 3e5, max: 3e9, log: true, value: PRESETS.dsoc.R / KM, fmt: (v) => distText(v * KM) },
    P: { type: 'range', label: 'Laser power (average)', min: 0.1, max: 50, log: true, value: PRESETS.dsoc.P, unit: 'W' },
    Dt: { type: 'range', label: 'Spacecraft telescope diameter', min: 2, max: 100, log: true, value: PRESETS.dsoc.Dt * 100, unit: 'cm' },
    Dr: { type: 'range', label: 'Ground telescope diameter', min: 0.3, max: 12, log: true, value: PRESETS.dsoc.Dr, unit: 'm' },
    jitter: { type: 'range', label: 'Pointing jitter (per axis)', min: 0, max: 10, step: 0.1, value: PRESETS.dsoc.jitter, unit: 'µrad' },
    el: { type: 'range', label: 'Elevation above the horizon', min: 10, max: 90, step: 1, value: PRESETS.dsoc.el, unit: '°' },
    lambda: { type: 'seg', label: 'Wavelength', value: '1550', options: [['1064', '1064 nm'], ['1550', '1550 nm']] },
    M: { type: 'select', label: 'Pulse-position order M (slots per symbol)', value: '128', options: [4, 8, 16, 32, 64, 128, 256].map((m) => [String(m), String(m)]) },
    Ts: { type: 'seg', label: 'Slot length', value: '0.5', options: [['0.2', '0.2 ns'], ['0.5', '0.5 ns'], ['1', '1 ns'], ['2', '2 ns']] },
    nb: { type: 'range', label: 'Background photons per slot (sky, planet, dark counts)', min: 1e-5, max: 0.3, log: true, value: PRESETS.dsoc.nb },
  }, () => update());
  let last = ctl.state.preset, obs = PRESETS.dsoc.obs, seed = 3;
  const again = h('button.tag', { type: 'button', onClick: () => { seed++; frames.redraw(); } }, t('New photons'));
  const ro = h('div'), calc = liveCalc();
  const beam = stage({ aspect: 1.9, label: 'The beam from the spacecraft and its footprint at Earth (across the beam to scale)', draw: drawBeam, minH: 250 });
  const frames = stage({ aspect: 1.45, label: '', name: N_('Detected photons, symbol by symbol'), draw: drawFrames, cls: 'plain', minH: 240 });
  const bud = stage({ aspect: 1.45, label: '', name: N_('The link budget in decibels'), draw: drawBudget, cls: 'plain', minH: 240 });
  const dist = stage({ aspect: 2.5, label: '', draw: drawRate, cls: 'plain', minH: 230 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([beam.el, h('div.grid-2', {}, card(frames), card(bud)), card(dist)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, again)), h('div.card', {}, ro), calc.el]));

  const job = latest('lasercom');
  let W = null, B = null;
  const params = () => {
    const s = ctl.state;
    return { R: s.R * KM, P: s.P, Dt: s.Dt / 100, Dr: s.Dr, obs, jitter: s.jitter, lambda: +s.lambda, el: s.el, M: +s.M, Ts: +s.Ts, nb: s.nb };
  };
  const request = debounce(() => { job('lasercom', params()).then((r) => { W = r; words(); frames.redraw(); dist.redraw(); }, () => {}); }, 60);
  function update() {
    const s = ctl.state;
    if (s.preset !== last) {
      const p = PRESETS[s.preset]; last = s.preset; obs = p.obs;
      ctl.set.R(p.R / KM); ctl.set.P(p.P); ctl.set.Dt(p.Dt * 100); ctl.set.Dr(p.Dr); ctl.set.jitter(p.jitter); ctl.set.el(p.el);
      ctl.set.lambda(String(p.lambda)); ctl.set.M(String(p.M)); ctl.set.Ts(String(p.Ts)); ctl.set.nb(p.nb);
    }
    B = budget(params()); words(); beam.redraw(); bud.redraw(); request();
  }

  function words() {
    const s = ctl.state, p = params(), rf = radioRate(p.R);
    if (!B) return;
    const now = W?.now;
    ro.replaceChildren(readouts([
      ['Beam spread (1/e² half-angle)', `${fmt(B.theta * 1e6, 3)} µrad`],
      ['Width of the beam at Earth', t('{v} km', { v: fmtInt(B.footprint / KM) })],
      ['Share of the light the telescope catches', `1 : ${fmt(1 / B.catch, 3)}`],
      ['Received power', `${fmt(B.Pr, 3)} W`],
      ['Detected photons per second', fmt(B.rate, 3)],
      ['Photons per pulse', now ? fmt(now.ns, 3) : '…'],
      ['Bits per detected photon', now ? fmt(now.perPhoton, 3) : '…'],
      ['Data rate', now ? rateText(now.rate) : '…'],
      ['Ceiling set by the slots, log₂M / (M T_s)', now ? rateText(now.max) : '…'],
      ['A Ka-band radio link at this distance', rateText(rf.rate)],
    ]));
    if (now) calc.say(t('At {R} the beam has spread to <strong>{fp} km</strong>, and the {Dr} m telescope catches one photon in {catch}. {ph} photons a second are detected, {ns} per pulse; with {M} slots each carries {bpp} bits, so the link sends <strong>{rate}</strong>. A 35 W Ka-band radio with a 2 m dish would send {rf}.', {
      R: distText(p.R), fp: fmtInt(B.footprint / KM), Dr: fmt(s.Dr, 3), catch: fmt(1 / B.catch, 3), ph: fmt(B.rate, 3), ns: fmt(now.ns, 3), M: s.M, bpp: fmt(now.perPhoton, 3), rate: rateText(now.rate), rf: rateText(rf.rate),
    }));
    calc.set(String.raw`\begin{aligned}
    G_t &= 0.81\Big(\frac{\pi D_t}{\lambda}\Big)^2 = ${texNum(B.G, 3)}, \quad \theta_0=\sqrt{8/G_t} = ${texNum(B.theta * 1e6, 3)}\ \mu\text{rad}\\
    P_r &= \frac{P_t G_t}{4\pi R^2}\,A_r\,\eta\,L_p = ${texNum(B.Pr, 3)}\ \text{W}, \quad L_p = \frac{1}{1+4\sigma^2/\theta_0^2} = ${texNum(B.Lp, 3)}\\
    \dot n &= \frac{P_r\lambda}{hc}\,\eta_d = ${texNum(B.rate, 3)}\ \text{s}^{-1}, \quad n_s = \dot n\,M T_s = ${texNum(now ? now.ns : NaN, 3)}\\
    C &= \log_2 M - \mathrm{E}\Big[\log_2 \sum_j L^{k_j-k_1}\Big] = ${texNum(now ? now.bitsPerSymbol : NaN, 3)}\ \text{bit}, \quad \frac{C}{M T_s} = ${texNum(now ? now.rate : NaN, 3)}\ \text{bit/s}
    \end{aligned}`);
  }

  // ── the beam and its footprint ─────────────────────────────────────────────────────────────
  function drawBeam(ctx, w, hh) {
    ctx.fillStyle = '#03040a'; ctx.fillRect(0, 0, w, hh);
    const rnd = uniform(11);
    for (let i = 0; i < 160; i++) { const a = rnd() ** 3; ctx.fillStyle = `rgba(220,230,255,${0.15 + 0.6 * a})`; ctx.fillRect(rnd() * w, rnd() * hh, 1 + a, 1 + a); }
    if (!B) return;
    const p = params(), split = w * 0.56, cy = hh * 0.52, R = Math.min(hh * 0.4, (w - split) * 0.42), cx = split + (w - split) / 2;
    // the right-hand panel: Earth and the footprint to one scale
    const wkm = B.theta * p.R, scale = R / Math.max(R_EARTH * 1.05, wkm * 1.6), re = R_EARTH * scale, wf = wkm * scale;
    // the beam cone (not to scale along the path)
    const sx = Math.max(54, w * 0.14), gl = ctx.createLinearGradient(sx, 0, cx, 0);
    gl.addColorStop(0, 'rgba(255,92,64,0.85)'); gl.addColorStop(1, 'rgba(255,92,64,0.12)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.moveTo(sx, cy - 2); ctx.lineTo(cx, cy - Math.max(2, wf)); ctx.lineTo(cx, cy + Math.max(2, wf)); ctx.lineTo(sx, cy + 2); ctx.fill();
    // Earth
    const ge = ctx.createRadialGradient(cx - re * 0.35, cy - re * 0.35, re * 0.1, cx, cy, re);
    ge.addColorStop(0, '#6fb6ff'); ge.addColorStop(0.6, '#2a5fa8'); ge.addColorStop(1, '#0c1a33');
    ctx.fillStyle = ge; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, re), 0, 7); ctx.fill();
    // the footprint: a Gaussian, I ∝ exp(−2r²/w²), drawn to 1.6 w
    const gf = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, wf * 1.6));
    for (let i = 0; i <= 8; i++) { const r = (i / 8) * 1.6; gf.addColorStop(i / 8, `rgba(255,120,80,${0.75 * Math.exp(-2 * r * r)})`); }
    ctx.fillStyle = gf; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, wf * 1.6), 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,170,0.85)'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, wf), 0, 7); ctx.stroke();
    if (p.jitter > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, p.jitter * 1e-6 * p.R * scale), 0, 7); ctx.stroke(); }
    ctx.setLineDash([]);
    // the spacecraft
    ctx.fillStyle = '#c9d2e6'; ctx.fillRect(sx - 26, cy - 9, 22, 18); ctx.fillStyle = '#3d6fd8'; ctx.fillRect(sx - 44, cy - 16, 14, 32);
    ctx.fillStyle = '#ff6a4a'; ctx.beginPath(); ctx.arc(sx - 3, cy, 3.5, 0, 7); ctx.fill();
    ctx.font = '11.5px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(t('Spacecraft: {D} cm telescope, {P} W', { D: fmt(p.Dt * 100, 3), P: fmt(p.P, 3) }), w * 0.085, 36);
    ctx.fillText(distText(p.R), w * 0.085, 53);
    const xr = w * 0.915; ctx.textAlign = 'right';
    ctx.fillText(t('Earth and the beam, to one scale'), xr, 36);
    ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,215,190,0.95)';
    ctx.fillText(t('beam {v} km across (1/e²)', { v: fmtInt(B.footprint / KM) }), xr, hh - 26);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(t('a {D} m telescope catches 1 photon in {n}', { D: fmt(p.Dr, 3), n: fmt(1 / B.catch, 3) }), xr, hh - 9);
  }

  // ── photons in the PPM slots ─────────────────────────────────────────────────────────────
  function drawFrames(ctx, w, hh) {
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, w, hh);
    if (!W) return;
    const s = ctl.state, M = +s.M, f = photonFrames(M, W.now.ns, s.nb, FRAMES, seed);
    const L = 12, Rr = 30, top = 44, bot = 8, cw = (w - L - Rr) / M, rh = (hh - top - bot) / FRAMES, rnd = uniform(seed * 7 + 1);
    ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('Detected photons, symbol by symbol'), L, 6);
    ctx.font = '10.5px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    let ok = 0, er = 0; for (let r = 0; r < FRAMES; r++) { if (f.dec[r] === f.pos[r]) ok++; else if (f.dec[r] < 0) er++; }
    ctx.fillText(t('{M} slots of {Ts} ns each · {ok} right, {er} lost, {bad} wrong', { M, Ts: s.Ts, ok, er, bad: FRAMES - ok - er }), L, 23);
    for (let r = 0; r < FRAMES; r++) {
      const y = top + r * rh;
      ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(L, y + 1, w - L - Rr, rh - 2);
      ctx.fillStyle = 'rgba(255,181,71,0.22)'; ctx.fillRect(L + f.pos[r] * cw, y + 1, Math.max(1.5, cw), rh - 2);
      for (let j = 0; j < M; j++) {
        const k = f.counts[r * M + j];
        for (let q = 0; q < k; q++) {
          ctx.fillStyle = j === f.pos[r] ? '#ffb547' : '#6ad7ff';
          ctx.beginPath(); ctx.arc(L + (j + 0.5) * cw + (rnd() - 0.5) * Math.min(cw, 6) * 0.5, y + rh * (0.25 + 0.5 * rnd()), Math.max(2.2, Math.min(3.2, cw * 0.45)), 0, 7); ctx.fill();
        }
      }
      const good = f.dec[r] === f.pos[r];
      ctx.fillStyle = good ? '#6be3a4' : f.dec[r] < 0 ? 'rgba(255,255,255,0.45)' : '#ff6b6b';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px Inter, sans-serif';
      ctx.fillText(good ? '✓' : f.dec[r] < 0 ? '?' : '✗', w - Rr / 2, y + rh / 2);
    }
  }

  // ── the link budget, step by step in decibels ───────────────────────────────────────────
  function drawBudget(ctx, w, hh) {
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, w, hh);
    if (!B) return;
    const p = params(), db = (x) => 10 * Math.log10(x);
    const steps = [
      [t('laser power'), db(p.P), true], [t('transmit gain'), db(B.G), false], [t('spreading, 1/(4πR²)'), -db(4 * Math.PI * p.R * p.R), false],
      [t('collecting area'), db(B.Ar), false], [t('pointing'), db(B.Lp), false], [t('atmosphere'), db(atmosphere(p.el)), false],
      [t('optics and detector'), db(ETA.tx * ETA.rx * ETA.det), false],
    ];
    let acc = 0; const bars = steps.map(([name, v, start]) => { const a = start ? 0 : acc; acc = start ? v : acc + v; return { name, a, b: acc, v }; });
    bars.push({ name: t('detected'), a: 0, b: acc, v: acc, end: true });
    const lo = Math.min(...bars.map((x) => Math.min(x.a, x.b))) - 10, hi = Math.max(...bars.map((x) => Math.max(x.a, x.b))) + 10;
    const L = 118, Rr = 14, top = 30, bot = 26, rh = (hh - top - bot) / bars.length, X = (v) => L + ((v - lo) / (hi - lo)) * (w - L - Rr);
    ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('The link budget in decibels'), 10, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'center';
    for (let v = Math.ceil(lo / 50) * 50; v <= hi; v += 50) { ctx.beginPath(); ctx.moveTo(X(v) + 0.5, top); ctx.lineTo(X(v) + 0.5, hh - bot); ctx.stroke(); ctx.fillText(fmt(v, 3), X(v), hh - bot + 5); }
    ctx.fillText(t('dB relative to 1 W'), (L + w - Rr) / 2, hh - 11);
    bars.forEach((x, i) => {
      const y = top + i * rh, x0 = X(Math.min(x.a, x.b)), x1 = X(Math.max(x.a, x.b));
      ctx.fillStyle = x.end ? '#ffb547' : i === 0 ? '#c18cff' : x.v >= 0 ? '#6be3a4' : '#ff6b6b';
      ctx.fillRect(x0, y + rh * 0.2, Math.max(1.5, x1 - x0), rh * 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '11px Inter, sans-serif';
      ctx.fillText(x.name, L - 6, y + rh / 2);
      ctx.font = '10px "JetBrains Mono", monospace';
      const txt = (x.v > 0 && !x.end && i ? '+' : '') + fmt(x.v, 3), tw = ctx.measureText(txt).width;
      // beside the bar where there is room, else inside it
      const where = x1 + 4 + tw < w - Rr ? 'right' : x0 - 4 - tw > L ? 'left' : 'in';
      ctx.textAlign = where === 'right' ? 'left' : 'right'; ctx.fillStyle = where === 'in' ? '#1a0b0b' : 'rgba(255,255,255,0.75)';
      ctx.fillText(txt, where === 'right' ? x1 + 4 : where === 'left' ? x0 - 4 : x1 - 5, y + rh / 2);
    });
  }

  // ── data rate against distance ──────────────────────────────────────────────────────────
  function drawRate(ctx, w, hh) {
    if (!W) return;
    const p = params(), km = (d) => d.map(([R, v]) => [R / KM, v]), radio = [];
    for (const [R] of W.curve.fixed) radio.push([R / KM, radioRate(R).rate]);
    plot(ctx, w, hh, {
      title: N_('Data rate against distance'), x: { min: 3e5, max: 3e9, log: true, label: N_('distance (km)') }, y: { min: 1e3, max: 1e10, log: true, label: N_('data rate (bit/s)') },
      series: [
        { data: km(W.curve.best), color: 'rgba(255,92,64,0.55)', width: 1.5, dash: [5, 4], label: N_('laser, best slot count M at each distance') },
        { data: km(W.curve.fixed), color: '#ff6a4a', width: 2.2, label: N_('laser, this M') },
        { data: radio, color: '#6ad7ff', width: 2, label: N_('Ka-band radio: 35 W, 2 m dish, 34 m antenna') },
        { data: MEASURED.map(([R, v]) => [R / KM, v]), color: '#ffffff', points: true, r: 3.5, label: N_('measured (LLCD 622 Mbit/s, DSOC 8.3 Mbit/s)') },
      ],
      vlines: [{ x: MOON / KM, label: N_('Moon'), color: 'rgba(255,255,255,0.35)' }, { x: AU / KM, label: N_('1 AU'), color: 'rgba(255,255,255,0.35)' }, { x: p.R / KM, label: N_('this link'), color: '#ffb547', dy: 14 }],
      legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[P_r = \frac{P_t\,G_t}{4\pi R^2}\,A_r\,\eta, \qquad G_t \approx 0.81\Big(\frac{\pi D_t}{\lambda}\Big)^2\]
<p>The transmitter's gain \(G_t\) says how much brighter the beam is on its axis than light spread evenly in every direction. For Psyche's 22 cm telescope at 1550 nm it is \(1.6\times10^{11}\): 4 W then give \(3\times10^{-13}\) W per square metre at 386 million km, and the 5.1 m Hale telescope collects about \(10^{-12}\) W, some five million photons a second. At 1 to 4 bits per photon that is several megabits per second: this page's model, with its assumed efficiencies, gives 17 Mbit/s, and DSOC measured 8.3 at that distance.</p>`,
    String.raw`Average losses only: clouds stop the link altogether, turbulence makes the received power flicker (scintillation) and the beam wander, and daytime sky or a planet near the line of sight raises the background. The efficiencies of the optics (0.5 each end), the detector (0.5) and the clear sky at the zenith (0.9) are typical assumptions, not those of a particular mission. The code is taken 1 dB from the channel's capacity; real modems also limit the rate (LLCD's rate-½ code turned 1.25 Gbit/s of slots into 622 Mbit/s). The radio for comparison has a 30 K receiver, needs 1 dB of \(E_b/N_0\) and sends at most 2 bit/s per hertz in 500 MHz.`));
  root.append(theory('How a laser link works', String.raw`
<div class="theory-cols"><div>
<h3>Gain and spread</h3>
<p>A beam leaving an aperture \(D\) spreads at an angle of about \(\lambda/D\). A Gaussian beam truncated by the aperture at the optimum (the waist \(w = D/2.24\)) has the on-axis gain \(G_t = 0.8145\,(\pi D/\lambda)^2\) (Klein &amp; Degnan 1974), and its far field is close to a Gaussian with the \(1/e^2\) half-angle \(\theta_0 = \sqrt{8/G_t}\). Because \(\lambda\) is 6000 times shorter at 1550 nm than at Ka band (32 GHz), a 22 cm laser telescope has almost half a million times the gain of a 2 m radio dish, and its beam at Mars is a few thousand kilometres wide instead of millions.</p>
<h3>Pointing</h3>
<p>So narrow a beam must be pointed to a fraction of \(\theta_0\). With random jitter \(\sigma\) per axis the mean power falls by \(1/(1+4\sigma^2/\theta_0^2)\). The spacecraft locks onto a beacon (DSOC used a 1064 nm laser from the ground) and aims ahead of it: the beam must arrive where Earth will be after the light time, a point-ahead angle of \(2v_\perp/c\), tens to hundreds of microradians.</p>
</div><div>
<h3>Counting photons</h3>
<p>Far from Earth only a few photons arrive per microsecond, so the receiver counts single photons (superconducting nanowire detectors) and the transmitter uses pulse-position modulation: one pulse in one of \(M\) slots carries \(\log_2 M\) bits. With \(n_s\) signal and \(n_b\) background photons per slot, the counts are Poisson and the capacity per symbol is \(C = \log_2 M - \mathrm{E}[\log_2\sum_j L^{k_j-k_1}]\), \(L = 1+n_s/n_b\), computed here by Monte Carlo. Without background, a symbol is either right or lost (no photon), and \(C = (1-e^{-n_s})\log_2 M\): a photon can carry more than one bit, up to \(\log_2 M\). Background makes long codes pay less, because more empty slots can catch a stray photon.</p>
<h3>Light versus radio</h3>
<p>Radio links are limited by thermal noise, \(kT\) per hertz, and need about 1 dB of \(E_b/N_0\); optical links are limited by the photons themselves. The ratio of gains, \((D/\lambda)^2\) at both ends, is what makes a few watts of laser compete with a radio transmitter of tens of watts and a 34 m dish.</p>
</div></div>`));
  root.append(references([
    'B. J. Klein &amp; J. J. Degnan, "Optical antenna gain. 1: Transmitting antennas", Appl. Opt. 13, 2134 (1974).',
    'B. Moision &amp; J. Hamkins, "Deep-space optical communications downlink budget: modulation and coding", IPN Progress Report 42-154, Jet Propulsion Laboratory (2003).',
    'H. Hemmati (ed.), <i>Deep Space Optical Communications</i>, Wiley (2006).',
    'D. M. Boroson et al., "The Lunar Laser Communications Demonstration (LLCD)", Proc. IEEE SMC-IT, 23 (2009).',
    'A. E. Velasco et al., "Operational results from the Deep Space Optical Communications (DSOC) project ground laser transmitter", IEEE J. Sel. Top. Quantum Electron. 32 (1) (2026).',
    'L. C. Andrews &amp; R. L. Phillips, <i>Laser Beam Propagation through Random Media</i>, 2nd ed., SPIE Press (2005).',
  ]));
  return () => [beam, frames, bud, dist].forEach((s) => s.destroy());
}
