// Mission: film under LED light and in front of an LED wall without flicker bands or moiré.
import { h, controls, stage, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { plot, logRange, range } from '../lib/plot.js';
import { MODULES } from '../app.js';
import { moire } from '../lib/virtual.js';
import { plan } from '../lib/ledset.js';
import { t } from '../lib/i18n.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const pct = (x) => (x * 100 < 0.1 ? '< 0.1 %' : (x * 100).toPrecision(2) + ' %');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video'] }));
  root.append(idea(String.raw`<p>Many lights flicker far too fast for the eye: lamps on mains power pulse 100 or 120 times a second, and LED panels switch on and off thousands of times a second to set their brightness. A video camera, which reads its picture line by line, catches different moments of that flicker in different lines and records dark bands rolling through the frame.</p>
<p>The cure is an exposure that spans whole flicker cycles, chosen with the shutter angle. In front of an LED wall a second problem appears: its grid of tiny lights can clash with the camera's pixel grid and create wavy moiré, unless the wall is far enough away and slightly out of focus.</p>`, [
    'At 24 fps with 50 Hz mains, change the <strong>shutter angle</strong> from 180° to 172.8°: the mains bands vanish.',
    'Lower the <strong>LED fixture PWM</strong> frequency to 300 Hz: the fixture bands become strong and many.',
    'Move the <strong>wall</strong> closer and focus on it: the moiré contrast jumps.',
  ]));

  const ctl = controls({
    fps: { type: 'seg', label: 'Frame rate', value: '24', options: ['24', '25', '30', '50', '60'] },
    angle: { type: 'range', label: 'Shutter angle', min: 11.25, max: 360, step: 0.1, value: 180, unit: '°' },
    mains: { type: 'seg', label: 'Mains frequency', value: '50', options: [['50', '50 Hz'], ['60', '60 Hz']] },
    depth: { type: 'range', label: 'Practical lights: flicker depth', min: 0, max: 1, step: 0.01, value: 0.3, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    pwm: { type: 'range', label: 'LED fixture PWM frequency', min: 200, max: 30000, log: true, value: 2000, unit: 'Hz' },
    duty: { type: 'range', label: 'LED fixture dimming (PWM duty)', min: 0.05, max: 1, step: 0.01, value: 0.4, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    readout: { type: 'range', label: 'Sensor readout time', min: 1, max: 30, step: 0.5, value: 15, unit: 'ms' },
    p: { type: 'range', label: 'LED wall pixel pitch', min: 1.2, max: 4, step: 0.1, value: 2.6, unit: 'mm' },
    Z: { type: 'range', label: 'Camera to wall', min: 1, max: 30, log: true, value: 6, unit: 'm' },
    s: { type: 'range', label: 'Focus distance (the actor)', min: 1, max: 30, log: true, value: 3, unit: 'm' },
    f: { type: 'range', label: 'Focal length', min: 18, max: 135, log: true, value: 50, unit: 'mm' },
    N: { type: 'range', label: 'Aperture', min: 1.4, max: 11, log: true, value: 2.8, fmt: (v) => 'T' + v.toPrecision(2) },
  }, () => update());
  const calc = liveCalc('Your plan');
  const steps = [
    missionStep(1, 'Shutter angle for mains light', 'motion', titleOf('motion')),
    missionStep(2, 'LED fixtures', 'motion', titleOf('motion')),
    missionStep(3, 'LED wall distance', 'vp', titleOf('vp')),
  ];
  const bands = stage({ aspect: 2.4, label: '', draw: drawBands, cls: 'plain', minH: 200 });
  const moi = stage({ aspect: 2.4, label: '', draw: drawMoire, cls: 'plain', minH: 200 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), h('div.grid-2', {}, h('div.card', { style: { padding: '8px' } }, bands.el), h('div.card', { style: { padding: '8px' } }, moi.el))], [h('div.card', {}, ctl.el), calc.el]));

  let P = null;
  function update() {
    const st = ctl.state, fps = +st.fps;
    P = { st, fps, ...plan({ fps, angle: st.angle, mains: +st.mains, depth: st.depth, pwm: st.pwm, duty: st.duty, readout: st.readout / 1000, f: st.f, N: st.N, s: st.s, Z: st.Z, p: st.p }) };
    const r = P, best = r.angles.reduce((b, a) => (Math.abs(a - 180) < Math.abs(b - 180) ? a : b), r.angles[0]);
    steps[0].set({
      answer: r.mainsBands < 0.005 ? `${st.angle.toFixed(1)}° <small>(flicker-free)</small>` : `${best.toFixed(1)}° <small>(now ${pct(r.mainsBands)} bands)</small>`,
      why: `Mains lights flicker at ${r.fl} Hz. At ${fps} fps the exposure is ${(r.t * 1000).toFixed(1)} ms; it spans whole flicker cycles at ${r.angles.map((a) => a.toFixed(1) + '°').join(', ')}. ${r.mainsBands < 0.005 ? 'This angle is one of them.' : `About ${r.nMains.toFixed(1)} dark bands would roll through the frame.`}`,
      tex: String.raw`\theta = 360^\circ\cdot\frac{k\,f_\text{fps}}{f_\text{flicker}},\quad \text{bands} = 2m\,\bigl|\mathrm{sinc}(f t)\bigr| = ${texNum(r.mainsBands * 100, 3)}\,\%`,
    });
    steps[1].set({
      answer: r.fixtureBands < 0.01 ? `Fine <small>(${pct(r.fixtureBands)})</small>` : `${pct(r.fixtureBands)} <small>bands</small>`,
      why: `A fixture dimmed to ${(st.duty * 100).toFixed(0)} % by ${Math.round(st.pwm)} Hz PWM flickers ${(st.pwm * r.t).toFixed(1)} times per exposure${r.fixtureBands < 0.01 ? ', enough to average out.' : `, leaving ${r.nFixture.toFixed(0)} thin bands; use fixtures with a higher PWM frequency, run them near full power, or choose a shutter angle that spans whole PWM cycles.`}`,
      tex: String.raw`\frac{\Delta L}{L} = ${texNum(r.fixtureBands * 100, 3)}\,\%`,
    });
    const m = r.moire;
    steps[2].set({
      answer: m.contrast < 0.01 ? 'No moiré' : r.safe ? `≥ ${r.safe.toFixed(1)} m` : 'Too close',
      why: `The wall's grid lands on the sensor at ${m.nu.toFixed(0)} cycles/mm against a pixel limit of ${m.nyquist.toFixed(0)}; ${m.aliased ? 'it aliases into moiré' : 'it is resolved as a grid'} with ${pct(m.contrast)} contrast. ${m.contrast < 0.01 ? 'That is below the 1 % at which it shows.' : r.safe ? `Keep the wall at least ${r.safe.toFixed(1)} m away with focus on the actor, or open the aperture.` : 'Increase the distance or defocus the wall.'}`,
      tex: String.raw`\nu_w = \frac{1}{m\,p} = ${texNum(m.nu, 3)}\ \text{mm}^{-1}`,
    });
    calc.say(t('<strong>{fps} fps at {ang}°</strong> ({ms} ms) for {mains} Hz mains; at your {yours}°, LED fixtures leave {led} bands; the wall shows {moire} moiré at {Z} m.', { fps, ang: r.mainsBands < 0.005 ? st.angle.toFixed(1) : best.toFixed(1), ms: (exposureMs(fps, r.mainsBands < 0.005 ? st.angle : best)).toFixed(1), mains: st.mains, yours: st.angle.toFixed(1), led: pct(r.fixtureBands), moire: pct(m.contrast), Z: st.Z.toFixed(1) })
      + (r.safe && m.contrast >= 0.01 ? ' ' + t('The moiré falls below 1 % from {d} m.', { d: r.safe.toFixed(1) }) : ''));
    calc.set(String.raw`\begin{aligned}
    t &= \frac{\theta}{360^\circ\,f_\text{fps}} = ${texNum(r.t * 1000, 3)}\ \text{ms}\\
    n_\text{bands} &= T_\text{readout}\,f_\text{flicker} = ${texNum(r.nMains, 3)}
    \end{aligned}`);
    bands.redraw(); moi.redraw();
  }
  const exposureMs = (fps, a) => (a / 360 / fps) * 1000;

  // brightness of each row of the frame: mains flicker and the LED fixture's PWM
  function drawBands(ctx, w, hh) {
    if (!P) return;
    const { st, t: te, fl } = P, rows = range(0, 1, 300), T = st.readout / 1000;
    const span = Math.max(0.04, 0.7 * Math.max(P.mainsBands, P.fixtureBands));
    const mainsRow = (y) => { const t0 = y * T; let a = 0; const n = 60; for (let k = 0; k < n; k++) a += 1 + st.depth * Math.cos(2 * Math.PI * fl * (t0 + ((k + 0.5) / n) * te)); return a / n; };
    const pwmRow = (y) => { const t0 = y * T, Tp = 1 / st.pwm; let a = 0; const n = 400; for (let k = 0; k < n; k++) { const ph = (((t0 + ((k + 0.5) / n) * te) / Tp) % 1); a += ph < st.duty ? 1 : 0; } return a / n / st.duty; };
    plot(ctx, w, hh, {
      title: 'Brightness down the frame (top to bottom)', x: { min: 0, max: 1, label: 'position in the frame' }, y: { min: 1 - span, max: 1 + span, label: 'relative brightness' },
      series: [{ data: rows.map((y) => [y, mainsRow(y)]), color: '#ffb547', label: t('mains {f} Hz', { f: fl }) }, { data: rows.map((y) => [y, pwmRow(y)]), color: '#6ad7ff', label: t('LED PWM {f} Hz', { f: Math.round(st.pwm) }) }],
      legend: true, legendX: w - 170, legendY: 34,
    });
  }

  function drawMoire(ctx, w, hh) {
    if (!P) return;
    const { st } = P, Zs = logRange(1, 30, 160);
    const c = (Z) => moire({ f: st.f, N: st.N, s: st.s * 1000, Z: Z * 1000, p: st.p, q: 0.006, fill: 0.3 }).contrast;
    plot(ctx, w, hh, {
      title: 'Moiré or grid contrast vs wall distance', x: { min: 1, max: 30, log: true, label: 'camera to wall (m)' }, y: { min: 1e-4, max: 1, log: true, label: 'contrast' },
      series: [{ data: Zs.map((Z) => [Z, Math.max(1e-4, c(Z))]), color: '#c18cff' }],
      hlines: [{ y: 0.01, color: 'rgba(255,255,255,0.35)', label: 'visible above 1 %' }], vlines: [{ x: st.Z, color: '#ffb547', label: 'wall' }, { x: st.s, color: '#6be3a4', label: 'focus' }],
    });
  }

  update();

  root.append(rule(String.raw`\[\theta = 360^\circ \cdot \frac{k\,f_\text{fps}}{f_\text{flicker}}\]
<p>An exposure that lasts a whole number of flicker periods averages the flicker out. Mains-powered lights flicker at twice the mains frequency: 100 Hz in 50 Hz countries. At 25 fps a 180° shutter (1/50 s) spans exactly two cycles; at 24 fps it does not, and 172.8° (1/50 s, two flicker periods) is the flicker-free choice. Under 60 Hz mains (120 Hz flicker), 24 fps at 144° or 30 fps at 180° are safe.</p>`,
    String.raw`It assumes a steady flicker frequency. Mains frequency drifts slightly, so bands may crawl slowly even at the right angle, and fixtures with low-frequency PWM or a cheap driver can flicker at frequencies unrelated to the mains. For an LED wall, genlocking the wall's refresh to the camera removes banding entirely.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Flicker and the rolling shutter</h3>
<p>A light modulated as \(1 + m\cos(2\pi f t)\), integrated over an exposure \(t\) that starts at a different moment for each row (the readout takes \(T_r\)), gives rows of brightness \(1 + m\,\mathrm{sinc}(ft)\cos\phi_\text{row}\): bands of peak-to-peak contrast \(2m|\mathrm{sinc}(ft)|\), zero when \(ft\) is a whole number. About \(T_r f\) bands fill the frame. LED fixtures dimmed by pulse-width modulation are treated as square waves of frequency \(f_p\) and duty \(d\), with the exact band amplitude of the virtual-production laboratory.</p>
</div><div>
<h3>LED-wall moiré</h3>
<p>The wall's pixel grid of pitch \(p\) is imaged at magnification \(m\) and lands on the sensor at \(\nu_w = 1/(mp)\). Its contrast is the grid's own modulation times the defocus, lens and photosite MTFs at \(\nu_w\), as in the virtual-production laboratory (6 µm photosites, 30 % emitter fill). Above the sensor's Nyquist frequency it aliases into moiré; below, the grid itself is visible. The plan looks for the nearest wall distance beyond which the contrast stays under 1 %.</p>
</div></div>`));
  root.append(references([
    'IEEE Std 1789-2015, <i>Recommended Practices for Modulating Current in High-Brightness LEDs for Mitigating Health Risks to Viewers</i>: flicker frequency and depth.',
    'The <a href="#/motion">Rolling shutter &amp; time</a> and <a href="#/vp">Virtual production</a> laboratories of this site, for the models and their primary references.',
  ]));
  return () => [bands, moi].forEach((s) => s.destroy());
}
