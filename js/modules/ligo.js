// LIGO as an optical instrument: photon shot noise against radiation pressure, the standard quantum
// limit, squeezed light, and what a compact binary looks like in the detector's output.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint } from '../lib/pixels.js';
import { colormap } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { DEFAULTS, noise, crossover, BINARIES, fISCO, hTilde, tauOf, snr, range, FS, TC, HBAR, C } from '../lib/ligo.js';
import { t, N_ } from '../lib/i18n.js';

const SOURCES = {
  bbh: { ...BINARIES.bbh, label: N_('Black holes, 36 + 29 suns (like GW150914)') },
  nsbh: { ...BINARIES.nsbh, label: N_('Black hole + neutron star, 10 + 1.4 suns') },
  bns: { ...BINARIES.bns, label: N_('Two neutron stars, 1.4 + 1.4 suns') },
};
const COL = { shot: '#6ad7ff', rp: '#ff6b6b', total: '#ffffff', sql: 'rgba(255,255,255,0.45)', sig: '#ffb547' };
const PROTON = 0.84e-15; // proton charge radius, m

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>LIGO measures a change in length a thousand times smaller than a proton, using light. A laser beam is split, sent down two 4 km arms between mirrors, and brought back together; a passing gravitational wave stretches one arm and squeezes the other, and the light at the output changes.</p>
<p>Light comes in grains (photons), and that sets two limits. Too few photons and their random arrival hides the signal, like rain counted drop by drop. Too many and their random pushes shake the 40 kg mirrors. In between lies the best that ordinary light can do: the <strong>standard quantum limit</strong>. "Squeezed" light beats it.</p>`, [
    'Raise the <strong>laser power</strong>: which part of the noise falls and which rises? Where do they meet?',
    'Make the <strong>mirrors heavier</strong>: what happens to the radiation-pressure noise and to the quantum limit?',
    'Switch on <strong>phase squeezing</strong>: why does it help at high frequencies but hurt at low ones, and what does frequency-dependent squeezing change?',
  ]));

  const ctl = controls({
    src: { type: 'select', label: 'Source', value: 'bbh', options: Object.entries(SOURCES).map(([k, s]) => [k, s.label]) },
    D: { type: 'range', label: 'Distance', min: 10, max: 3000, log: true, value: 410, unit: 'Mpc' },
    P: { type: 'range', label: 'Light power in each arm', min: 10, max: 3000, log: true, value: 400, unit: 'kW' },
    m: { type: 'range', label: 'Mass of each mirror', min: 10, max: 400, log: true, value: 40, unit: 'kg' },
    fbw: { type: 'range', label: 'Detector bandwidth', min: 30, max: 2000, log: true, value: 450, unit: 'Hz' },
    sqz: { type: 'seg', label: 'Squeezed light', value: 'none', options: [['none', 'None'], ['phase', 'Phase'], ['freq', 'Frequency-dependent']] },
    db: { type: 'range', label: 'Squeezing (detected)', min: 0, max: 10, step: 0.5, value: 6, unit: 'dB' },
  }, () => update());
  let seed = 1;
  const again = h('button.tag', { type: 'button', onClick: () => { seed++; request(); } }, t('New noise'));
  const ro = h('div'), calc = liveCalc();
  const pic = stage({ aspect: 1.9, label: 'The detector\'s output: whitened strain and its spectrogram', draw: drawPic, minH: 260 });
  const asd = stage({ aspect: 1.5, label: '', draw: drawASD, cls: 'plain', minH: 240 });
  const ifo = stage({ aspect: 1.5, label: '', name: N_('The interferometer: laser, recycling mirrors, beam splitter, arms, squeezer and photodetector'), draw: drawIFO, cls: 'plain', minH: 240 });
  root.append(lab([pic.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, asd.el), h('div.card', { style: { padding: '6px' } }, ifo.el))], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, again)), h('div.card', {}, ro), calc.el]));

  const opt = (st) => ({ ...DEFAULTS, P: st.P * 1e3, m: st.m, fbw: st.fbw, sqz: st.sqz, sqzDb: st.sqz === 'none' ? 0 : st.db });
  const job = latest('ligo');
  let R = null;
  function request() {
    const st = ctl.state, s = SOURCES[st.src];
    job('ligo', { o: opt(st), m1: s.m1, m2: s.m2, D: st.D, seed }).then((r) => {
      let top = 0; for (const v of r.sp.data) if (v > top) top = v;
      R = { ...r, st: { ...st }, scale: Math.max(25, 0.6 * top) }; pic.redraw();
    }, () => {});
  }
  function update() { words(); asd.redraw(); ifo.redraw(); request(); }

  function words() {
    const st = ctl.state, o = opt(st), s = SOURCES[st.src], n100 = noise(100, o), fx = crossover(o);
    const rho = snr(o, s.m1, s.m2, st.D), bns = range(o, 1.4, 1.4), photons = o.P / ((HBAR * 2 * Math.PI * C) / o.lambda);
    const dL = Math.sqrt(n100.total) * o.L;
    ro.replaceChildren(readouts([
      ['Quantum noise at 100 Hz', `${fmt(Math.sqrt(n100.total), 3)} /√Hz`],
      ['… as a length change of an arm', `${fmt(dL, 3)} m/√Hz`],
      ['Standard quantum limit at 100 Hz', `${fmt(Math.sqrt(n100.sql), 3)} /√Hz`],
      ['Shot noise = radiation pressure at', `${fmt(fx, 3)} Hz`],
      ['Photons in each arm per second', fmt(photons, 3)],
      ['Signal-to-noise ratio of this source (from 10 Hz)', fmt(rho, 3)],
      ['Neutron-star range (quantum noise only)', `${fmt(bns, 3)} Mpc`],
    ]));
    calc.say(t('At 100 Hz the quantum noise is <strong>{h} per √Hz</strong>: a change of {dL} m/√Hz in a 4 km arm, {p} proton radii. Below {fx} Hz the photons\' pushes on the {m} kg mirrors dominate, above it the randomness of counting them. This binary at {D} Mpc reaches a signal-to-noise ratio of <strong>{rho}</strong> (8 counts as a detection).', {
      h: fmt(Math.sqrt(n100.total), 3), dL: fmt(dL, 2), p: fmt(dL / PROTON, 2), fx: fmt(fx, 3), m: fmt(st.m, 3), D: fmt(st.D, 3), rho: fmt(rho, 3),
    }));
    calc.set(String.raw`\begin{aligned}
    h_\text{SQL}(100\,\text{Hz}) &= \sqrt{\frac{8\hbar}{m\,\Omega^2L^2}} = ${texNum(Math.sqrt(n100.sql), 3)}\\
    K &= \frac{16\,\omega_0\gamma P}{c\,m\,L\,\Omega^2(\gamma^2+\Omega^2)}\\
    S_h &= \frac{h_\text{SQL}^2}{2}\left(\frac1K + K\right)\\
    \sqrt{S_h(100\,\text{Hz})} &= ${texNum(Math.sqrt(n100.total), 3)}\\
    \rho^2 &= 4\int\frac{|\tilde h(f)|^2}{S_h(f)}\,df,\quad \rho = ${texNum(rho, 3)}
    \end{aligned}`);
  }

  // top: whitened strain with the clean signal on it; bottom: spectrogram on a log frequency axis
  function drawPic(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const s = SOURCES[R.st.src], tau = tauOf(R.fstart, s.m1, s.m2), t0 = Math.max(0.05, TC - Math.min(3.1, tau + 0.25)), t1 = TC + 0.2;
    const L = 52, Rr = 12, top = 26, mid = top + (hh - top) * 0.36, bot = hh - 28, X = (tt) => L + ((tt - t0) / (t1 - t0)) * (w - L - Rr);
    // time series
    const yc = (top + mid - 12) / 2, amp = (mid - 12 - top) / 2, k0 = Math.floor(t0 * FS), k1 = Math.ceil(t1 * FS);
    let peak = 4; for (let k = k0; k < k1; k++) peak = Math.max(peak, Math.abs(R.clean[k]));
    const Y = (v) => yc - (v / (peak * 1.15)) * amp;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(L, yc + 0.5); ctx.lineTo(w - Rr, yc + 0.5); ctx.stroke();
    const trace = (arr, colour, lw) => {
      ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.beginPath();
      const step = Math.max(1, Math.floor((k1 - k0) / (2 * (w - L - Rr))));
      for (let k = k0; k < k1; k += step) { const x = X(k / FS), y = Y(arr[k]); k === k0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    };
    trace(R.data, 'rgba(160,190,230,0.55)', 0.8); trace(R.clean, COL.sig, 1.6);
    ctx.font = '11px Inter, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(160,190,230,0.9)'; ctx.fillText(t('detector output (whitened, 20–1024 Hz)'), L + 4, top);
    ctx.fillStyle = COL.sig; ctx.fillText(t('the signal alone'), L + 4, top + 14);
    // spectrogram
    const sp = R.sp, fLo = sp.f0, fHi = sp.f1, sy0 = mid + 4, sy1 = bot, lf = Math.log(fHi / fLo);
    paint(pic, { x: L, y: sy0, w: w - L - Rr, h: sy1 - sy0 }, (u, v, o) => {
      const tt = t0 + u * (t1 - t0), r = (1 - v) * (sp.NF - 1), j = (tt / sp.T) * sp.M;
      const r0 = Math.min(sp.NF - 2, Math.floor(r)), j0 = Math.max(0, Math.min(sp.M - 2, Math.floor(j))), fr = r - r0, fj = Math.min(1, Math.max(0, j - j0));
      const at = (rr, jj) => sp.data[rr * sp.M + jj];
      const e = (1 - fr) * ((1 - fj) * at(r0, j0) + fj * at(r0, j0 + 1)) + fr * ((1 - fj) * at(r0 + 1, j0) + fj * at(r0 + 1, j0 + 1));
      const c = colormap('inferno', Math.min(1, Math.sqrt(e / R.scale)));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    }, `${seed}:${R.st.src}:${R.st.D}:${R.st.P}:${R.st.m}:${R.st.fbw}:${R.st.sqz}:${R.st.db}`);
    // axes
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const f of [32, 64, 128, 256, 512, 1024]) { const y = sy0 + (1 - Math.log(f / fLo) / lf) * (sy1 - sy0); ctx.fillText(String(f), L - 6, y); ctx.fillRect(L - 4, y, 4, 1); }
    ctx.save(); ctx.translate(12, (sy0 + sy1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(t('frequency (Hz)'), 0, 0); ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tick = t1 - t0 > 1.5 ? 0.5 : 0.1;
    for (let tt = Math.ceil((t0 - TC) / tick) * tick; tt <= t1 - TC + 1e-9; tt += tick) { const x = X(TC + tt); ctx.fillRect(x, sy1, 1, 4); ctx.fillText(fmt(+tt.toFixed(2), 2), x, sy1 + 6); }
    ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(t('time to the merger (s)'), w - Rr, hh - 13);
  }

  function drawASD(ctx, w, hh) {
    const st = ctl.state, o = opt(st), s = SOURCES[st.src], shot = [], rp = [], tot = [], sql = [], sig = [], raw = [];
    const plain = { ...o, sqz: 'none', sqzDb: 0 }, fmax = fISCO(s.m1 + s.m2);
    for (let e = Math.log10(5); e <= Math.log10(5000); e += 0.02) {
      const f = 10 ** e, n = noise(f, o);
      shot.push([f, Math.sqrt(n.shot)]); rp.push([f, Math.sqrt(n.rp)]); tot.push([f, Math.sqrt(n.total)]); sql.push([f, Math.sqrt(n.sql)]);
      if (o.sqz !== 'none') raw.push([f, Math.sqrt(noise(f, plain).total)]);
      if (f >= 10 && f <= fmax) sig.push([f, 2 * Math.sqrt(f) * hTilde(f, s.m1, s.m2, st.D)]);
    }
    const series = [
      { data: sql, color: COL.sql, width: 1.2, dash: [5, 4], label: N_('standard quantum limit') },
      { data: shot, color: COL.shot, width: 1.6, label: N_('shot noise') },
      { data: rp, color: COL.rp, width: 1.6, label: N_('radiation pressure') },
      { data: tot, color: COL.total, width: 2.2, label: N_('total quantum noise') },
      { data: sig, color: COL.sig, width: 2, label: N_('signal, 2√f |h̃(f)|') },
    ];
    if (raw.length) series.splice(3, 0, { data: raw, color: 'rgba(255,255,255,0.35)', width: 1, dash: [2, 3], label: N_('without squeezing') });
    plot(ctx, w, hh, {
      title: N_('Quantum noise and the signal'), padL: 62, x: { min: 5, max: 5000, log: true, label: N_('frequency (Hz)') }, y: { min: 1e-25, max: 1e-20, log: true, label: N_('strain per √Hz') },
      series, legend: true,
    });
  }

  // schematic: power-recycled, signal-recycled Michelson with Fabry–Perot arms (not to scale)
  function drawIFO(ctx, w, hh) {
    const st = ctl.state, o = opt(st), inset = ctx.canvas._inset || 0;
    ctx.fillStyle = '#0b0e16'; ctx.fillRect(0, 0, w, hh);
    const bsx = w * 0.3, bsy = hh * 0.62, xEnd = w - 30, yEnd = 26 + inset + 20, itmX = bsx + (xEnd - bsx) * 0.18, itmY = bsy - (bsy - yEnd) * 0.18;
    const armW = 1.5 + 2.5 * Math.log10(o.P / 1e4 + 1), glow = Math.min(1, 0.35 + 0.25 * Math.log10(o.P / 1e4 + 1));
    const beam = (x0, y0, x1, y1, width, a) => {
      ctx.strokeStyle = `rgba(255,70,60,${a * 0.18})`; ctx.lineWidth = width * 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = `rgba(255,110,90,${a})`; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    beam(20, bsy, bsx, bsy, 1.2, 0.6);
    beam(bsx, bsy, itmX, bsy, 1.6, 0.7); beam(bsx, bsy, bsx, itmY, 1.6, 0.7);
    beam(itmX, bsy, xEnd, bsy, armW, glow); beam(bsx, itmY, bsx, yEnd, armW, glow);
    beam(bsx, bsy, bsx, hh - 30, 0.8, 0.25);
    const mirror = (x, y, vertical, size, label, colour = '#cfd8ea') => {
      ctx.fillStyle = colour; vertical ? ctx.fillRect(x - 3, y - size / 2, 6, size) : ctx.fillRect(x - size / 2, y - 3, size, 6);
      if (label) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(label, vertical ? x : x + size / 2 + 20, vertical ? y + size / 2 + 3 : y - 5); }
    };
    const ms = 10 + 6 * Math.log10(o.m / 10 + 1);
    ctx.save(); ctx.translate(bsx, bsy); ctx.rotate(-Math.PI / 4); ctx.fillStyle = '#9fb2d4'; ctx.fillRect(-12, -2, 24, 4); ctx.restore();
    mirror(bsx * 0.55, bsy, true, 16, null);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(t('power recycling'), bsx * 0.55, bsy + 12);
    mirror(itmX, bsy, true, ms, null); mirror(xEnd, bsy, true, ms, t('{m} kg', { m: fmt(o.m, 3) }));
    mirror(bsx, itmY, false, ms, null); mirror(bsx, yEnd, false, ms, t('{m} kg', { m: fmt(o.m, 3) }));
    mirror(bsx, bsy + (hh - 30 - bsy) * 0.4, false, 16, null);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t('signal recycling'), bsx + 14, bsy + (hh - 30 - bsy) * 0.4);
    // laser and photodetector
    ctx.fillStyle = '#ff6b6b'; ctx.fillRect(6, bsy - 8, 16, 16); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(t('laser, 1064 nm'), 6, bsy - 11);
    ctx.fillStyle = '#6ad7ff'; ctx.beginPath(); ctx.arc(bsx, hh - 22, 7, 0, 7); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(t('photodetector'), bsx + 12, hh - 22);
    if (o.sqz !== 'none') {
      const sx = bsx + 70, sy = bsy + (hh - 30 - bsy) * 0.75;
      ctx.strokeStyle = '#c18cff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(bsx + 2, sy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c18cff'; ctx.fillRect(sx, sy - 8, 16, 16); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(o.sqz === 'freq' ? t('squeezer + filter cavity') : t('squeezer'), sx + 22, sy);
    }
    // arm labels
    ctx.fillStyle = 'rgba(255,190,170,0.95)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('4 km arm, {P} kW', { P: fmt(st.P, 3) }), (itmX + xEnd) / 2, bsy - 8);
    ctx.save(); ctx.translate(bsx - 10, (itmY + yEnd) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(t('4 km arm, {P} kW', { P: fmt(st.P, 3) }), 0, 0); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('not to scale; infrared drawn red'), w - 8, hh - 6);
  }
  update();

  root.append(rule(String.raw`\[h_\text{SQL} = \sqrt{\frac{8\hbar}{m\,\Omega^2 L^2}}\]
<p>With ordinary light, no choice of power gets the strain noise below this curve: more power lowers the shot noise but raises the radiation-pressure noise by the same factor, and the sum touches \(h_\text{SQL}\) only where the two are equal. For 40 kg mirrors and 4 km arms at 100 Hz, \(h_\text{SQL} \approx 1.8\times10^{-24}\) per √Hz, a length noise of \(7\times10^{-21}\) m/√Hz. Heavier mirrors and longer arms lower it; squeezed light with a frequency-dependent angle beats it.</p>`,
    String.raw`Quantum noise only: LIGO's sensitivity below about 20 Hz is set by seismic and suspension noise and in the middle band by thermal noise of the mirror coatings, which this page leaves out. Optical losses limit useful squeezing to about 6 dB today. The signal is the Newtonian inspiral of an optimally oriented binary up to the innermost stable orbit, without merger, ringdown or redshift.`));
  root.append(theory('Interferometry at the quantum limit', String.raw`
<div class="theory-cols"><div>
<h3>The instrument</h3>
<p>A Michelson interferometer held at a dark fringe turns a difference \(\delta L\) between its arms into light at the output port. Fabry–Perot cavities in the arms (finesse about 450) let the light make hundreds of round trips, power recycling at the input and signal recycling at the output raise the stored power to hundreds of kilowatts and set the detector's bandwidth. A strain \(h\) changes the arm difference by \(hL\).</p>
<h3>Two faces of the same vacuum</h3>
<p>Caves (1980) showed that both quantum noises come from vacuum fluctuations entering the dark port. Their phase quadrature adds random phase to the output: shot noise, \(\sqrt{S}\propto\sqrt{\hbar\omega_0/P}\), falling with power and flat up to the bandwidth \(\gamma\). Their amplitude quadrature beats with the carrier into a fluctuating force on the mirrors: radiation-pressure noise, \(\propto\sqrt{P}/(m\Omega^2)\), rising with power and steep at low frequency.</p>
</div><div>
<h3>Standard quantum limit</h3>
<p>Kimble et al. (2001) write the total as \(S_h = \tfrac12 h_\text{SQL}^2(1/K + K)\), with the coupling \(K\) between light and mirror motion. Since \(1/K + K \ge 2\), \(S_h \ge h_\text{SQL}^2\) at every frequency, whatever the power: the Heisenberg limit of a continuous position measurement on a free mass.</p>
<h3>Squeezing</h3>
<p>Squeezed vacuum injected at the dark port has less noise in one quadrature and more in the other. Squeezing the phase quadrature lowers shot noise but raises radiation pressure; rotating the squeeze angle with frequency in a 300 m filter cavity (LIGO since 2023) lowers both. LIGO detects about 6 dB of squeezing.</p>
<h3>Signal</h3>
<p>The stationary-phase spectrum of an inspiral falls as \(f^{-7/6}\); the matched-filter signal-to-noise ratio is \(\rho^2 = 4\int|\tilde h|^2/S_h\,df\). The chart compares \(2\sqrt f\,|\tilde h|\) with \(\sqrt{S_h}\), so the area between them shows where the signal is collected.</p>
</div></div>`));
  root.append(references([
    'C. M. Caves, "Quantum-mechanical radiation-pressure fluctuations in an interferometer", Phys. Rev. Lett. 45, 75 (1980).',
    'H. J. Kimble, Y. Levin, A. B. Matsko, K. S. Thorne &amp; S. P. Vyatchanin, "Conversion of conventional gravitational-wave interferometers into quantum nondemolition interferometers by modifying their input and/or output optics", Phys. Rev. D 65, 022002 (2001).',
    'A. Buonanno &amp; Y. Chen, "Quantum noise in second generation, signal-recycled laser interferometric gravitational-wave detectors", Phys. Rev. D 64, 042006 (2001).',
    'C. Cutler &amp; É. E. Flanagan, "Gravitational waves from merging compact binaries: how accurately can one extract the binary\'s parameters from the inspiral waveform?", Phys. Rev. D 49, 2658 (1994).',
    'LIGO Scientific Collaboration, "Advanced LIGO", Class. Quantum Grav. 32, 074001 (2015).',
    'D. Ganapathy et al., "Broadband quantum enhancement of the LIGO detectors with frequency-dependent squeezing", Phys. Rev. X 13, 041021 (2023).',
  ]));
  return () => [pic, asd, ifo].forEach((s) => s.destroy());
}
