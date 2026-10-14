// Mission: photograph the Milky Way with a camera on a fixed tripod.
import { h, controls, stage, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { MODULES } from '../app.js';
import { SENSORS } from '../lib/sensors.js';
import { BORTLE, surfaceRate } from '../lib/stacking.js';
import { plan, SIDEREAL } from '../lib/milkyway.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const fmtT = (t) => (t >= 60 ? (t / 60).toFixed(t >= 600 ? 0 : 1) + ' min' : (t >= 10 || Number.isInteger(t) ? t.toFixed(0) : t.toPrecision(2)) + ' s');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>The Milky Way is faint, so you want to collect as much light as possible: a wide aperture and a long exposure. But the Earth turns, and in a long exposure the stars smear into short lines. The camera on a tripod therefore gets only a few seconds per shot.</p>
<p>The way out is to take many short shots and average them, which makes the noise fall while the stars stay sharp. This mission works out, for your camera and your sky, how long each shot can be, which ISO to use, and how many shots to take.</p>`, [
    'Change the <strong>Focal length</strong> from 14 to 50 mm: the safe exposure shrinks, because a longer lens magnifies the drift.',
    'Move the <strong>Sky</strong> from Bortle 2 to Bortle 7: the stars stay the same, but you need several times more frames.',
    'Compare the star at <strong>your exposure</strong> with the star at the <strong>500 rule</strong> on the pixel view: the popular rule trails visibly on modern sensors.',
  ]));

  const ctl = controls({
    sensor: { type: 'select', label: 'Camera sensor', value: 'ff', options: ['ff', 'apsc', 'mft', 'one', 'phone'].map((k) => [k, SENSORS[k].name]) },
    f: { type: 'range', label: 'Focal length', min: 8, max: 85, log: true, value: 20, unit: 'mm' },
    N: { type: 'range', label: 'Aperture (f-number)', min: 1.2, max: 5.6, log: true, value: 2.8, fmt: (v) => 'f/' + v.toPrecision(2) },
    dec: { type: 'range', label: 'Target declination (Milky Way core −29°)', min: -80, max: 80, step: 1, value: -29, unit: '°' },
    bortle: { type: 'range', label: 'Sky (Bortle class)', min: 1, max: 9, step: 1, value: 3, fmt: (v) => `${v} · ${BORTLE[v].toFixed(1)} mag/″²` },
    mu: { type: 'range', label: 'Faintest detail to show', min: 21, max: 25, step: 0.1, value: 23, unit: 'mag/″²' },
  }, () => update());
  const calc = liveCalc('Your plan');
  const steps = [
    missionStep(1, 'Exposure per shot', 'mission-milkyway', ''),
    missionStep(2, 'Aperture', 'vignetting', titleOf('vignetting')),
    missionStep(3, 'ISO', 'noise', titleOf('noise')),
    missionStep(4, 'Frames to stack', 'stacking', titleOf('stacking')),
  ];
  steps[0].el.querySelector('.mstep-lab').remove();
  const pix = stage({ aspect: 2.2, label: 'One star at 100 % (each square is a pixel)', draw: drawPixels, minH: 200 });
  const snrPlot = stage({ aspect: 2.2, label: '', draw: drawSNR, cls: 'plain', minH: 220 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), pix.el, h('div.card', { style: { padding: '8px' } }, snrPlot.el)], [h('div.card', {}, ctl.el), calc.el]));

  let P = null;
  function update() {
    const st = ctl.state;
    P = { st: { ...st }, ...plan({ sensor: st.sensor, f: st.f, N: st.N, dec: st.dec, bortle: st.bortle, mu: st.mu }) };
    const r = P;
    steps[0].set({
      answer: `${fmtT(r.t)} <small>(limit ${r.trail.t.toFixed(1)} s)</small>`,
      why: `In ${r.trail.t.toFixed(1)} s a star drifts by the larger of two pixels and its own blur. The 500 rule would allow ${r.t500.toFixed(0)} s (${(r.t500 / r.trail.t).toFixed(1)}× too long for ${r.pitch.toFixed(1)} µm pixels); the NPF rule ${r.tNPF.toFixed(0)} s.`,
      tex: String.raw`t \le \frac{\max(2p,\ 2.44\lambda N)}{f\,\omega\cos\delta} = ${texNum(r.trail.t, 3)}\ \text{s}`,
    });
    steps[1].set({
      answer: `f/${st.N.toPrecision(2)} <small>(${(16 / (st.N * st.N)).toFixed(1)}× the light of f/4)</small>`,
      why: 'Light per shot grows with the square of the aperture, so use the widest one. If stars in the corners look like seagulls (coma) or the corners are dark, close down by a third to two-thirds of a stop.',
      tex: String.raw`E \propto \frac{t}{N^2}`,
    });
    steps[2].set({
      answer: `ISO ${r.iso}`,
      why: `Above about ISO ${(Math.round(r.isoInv / 100) * 100).toFixed(0)} the camera's read noise stops falling (${r.sigma.toFixed(1)} e⁻ here), so a higher ISO only clips bright stars sooner. Each shot collects ${r.sky.toFixed(r.sky < 10 ? 1 : 0)} sky electrons per pixel; read noise is ${(r.readShare * 100).toFixed(0)} % of the noise${r.readShare > 0.3 ? ', a sign that short shots cost you some signal' : ''}.`,
      tex: String.raw`\sigma_r = \sqrt{\sigma_\text{pre}^2 + (\sigma_\text{post}/g)^2} = ${texNum(r.sigma, 3)}\ e^-`,
    });
    steps[3].set({
      answer: `${r.frames} frames <small>(${fmtT(r.total)} in total)</small>`,
      why: `Detail at ${st.mu.toFixed(1)} mag/″² reaches a signal-to-noise ratio of 5, enough to show, after ${r.frames} shots of ${fmtT(r.t)}. Under a pristine Bortle 1 sky ${r.frames1} would do.${r.frames > 400 ? ' That many frames suggests a star tracker, which allows minutes per shot.' : ''}`,
      tex: String.raw`N = \left(\frac{5}{\mathrm{SNR}_1}\right)^2,\quad \mathrm{SNR}_1 = ${texNum(r.s1, 3)}`,
    });
    calc.say(`<strong>f/${st.N.toPrecision(2)} · ${fmtT(r.t)} · ISO ${r.iso} · ${r.frames} frames</strong> (${fmtT(r.total)}). Each star trails ${r.trailPx.toFixed(1)} pixels per shot; the stack shows detail down to ${st.mu.toFixed(1)} mag/″² under a Bortle ${st.bortle} sky.`);
    calc.set(String.raw`\begin{aligned}
    p &= ${texNum(r.pitch, 3)}\ \mu\text{m}\ (${texNum(r.p, 3)}''/\text{px})\\
    F_s &= ${texNum(r.Fs, 3)}\ e^-/\text{s}\ \text{(sky)}\\
    F_d &= ${texNum(r.Fd, 3)}\ e^-/\text{s}\ \text{(detail)}\\
    \mathrm{SNR}_N &= \sqrt{N}\,\mathrm{SNR}_1 = ${texNum(Math.sqrt(r.frames) * r.s1, 3)}
    \end{aligned}`);
    pix.redraw(); snrPlot.redraw();
  }

  // a star integrated over the pixel grid while it drifts across the sensor
  function drawPixels(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!P) return;
    const panels = [[`your exposure: ${fmtT(P.t)}`, P.t], [`500 rule: ${fmtT(P.t500)}`, P.t500]];
    const n = 15, gap = 24, side = Math.min((w - gap * 3) / 2, hh - 60), cell = side / n;
    panels.forEach(([label, t], k) => {
      const ox = gap + k * (side + gap), oy = 50;
      const pitch = P.pitch / 1000, sig = Math.max(0.45 * pitch, (1.03 * 0.55e-3 * P.st.N) / 2.355); // mm
      const L = P.trail.speed * t; // trail length, mm
      const img = new Float64Array(n * n); let mx = 0;
      const steps = 60;
      for (let s = 0; s < steps; s++) {
        const cx = ((s / (steps - 1)) - 0.5) * L, cy = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const x = (i - n / 2 + 0.5) * pitch - cx, y = (j - n / 2 + 0.5) * pitch - cy;
          img[j * n + i] += Math.exp(-(x * x + y * y) / (2 * sig * sig));
        }
      }
      for (const v of img) mx = Math.max(mx, v);
      const ic = imageCanvas(n, n);
      for (let i = 0; i < n * n; i++) { const v = Math.pow(img[i] / mx, 1 / 2.2) * 255; ic.data[4 * i] = v; ic.data[4 * i + 1] = v; ic.data[4 * i + 2] = Math.min(255, v * 1.08); ic.data[4 * i + 3] = 255; }
      ic.put();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ic.c, ox, oy, side, side);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + side); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + side, oy + i * cell); ctx.stroke(); }
      ctx.fillStyle = k ? '#ff9a7a' : '#6be3a4'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${label} · trail ${((L * 1000) / P.pitch).toFixed(1)} px`, ox, 40);
    });
  }

  function drawSNR(ctx, w, hh) {
    if (!P) return;
    const st = P.st, Ns = range(1, Math.max(50, P.frames * 2.5), 120);
    const series = [[st.bortle, '#ffb547'], ...(st.bortle !== 1 ? [[1, '#6be3a4']] : [])].map(([b, color]) => {
      const Fs = surfaceRate(BORTLE[b], P.D, P.p, 0.3);
      const s1 = (P.Fd * P.t) / Math.sqrt((P.Fd + Fs) * P.t + P.sigma * P.sigma);
      return { data: Ns.map((N) => [N, Math.sqrt(N) * s1]), color, label: `Bortle ${b}` };
    });
    plot(ctx, w, hh, {
      title: `Signal-to-noise of ${st.mu.toFixed(1)} mag/″² detail vs number of frames`, x: { min: 1, max: Ns[Ns.length - 1], label: 'frames' }, y: { min: 0, max: 10, label: 'SNR' },
      series, hlines: [{ y: 5, color: 'rgba(255,255,255,0.35)', label: 'visible (SNR 5)' }], vlines: [{ x: P.frames, color: 'rgba(255,181,71,0.5)' }], legend: true, legendX: w - 130, legendY: hh - 90,
    });
  }

  update();

  root.append(rule(String.raw`\[t_\text{max} = \frac{b}{f\,\omega\cos\delta}\]
<p>The sky turns at \(\omega = 7.29 \times 10^{-5}\) radians per second, so a star at declination \(\delta\) drifts across the sensor at \(f\omega\cos\delta\). With 4.4 µm pixels and an allowed trail \(b\) of two pixels (8.8 µm), a 20 mm lens aimed at the Milky Way core (\(\delta = -29^\circ\)) gets \(0.0088/(20 \times 7.29 \times 10^{-5} \times 0.87) \approx 7\) s. The popular 500 rule (\(500/f\) = 25 s) dates from film and trails by about seven pixels on such a sensor.</p>`,
    String.raw`It assumes a fixed tripod and a target near the image centre; stars away from the centre of a wide lens drift at slightly different rates. Coma and astigmatism of fast wide lenses smear corner stars more than the trailing does. A star tracker cancels the drift and allows minutes per shot.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Trailing</h3>
<p>A star at declination \(\delta\) moves along its diurnal circle at angular rate \(\omega\cos\delta\), with \(\omega = 2\pi/86\,164\ \text{s}\) (the sidereal day). Its image on the sensor moves at \(f\omega\cos\delta\). The trail is invisible while it stays below the blur that is there anyway: two pixels (the sampling limit with a Bayer mosaic) or the Airy diameter \(2.44\lambda N\), whichever is larger. The chosen exposure is the longest standard shutter speed below the limit. The page also shows the 500 rule, \(t = 500/(f k)\) with crop factor \(k\), and the simplified NPF rule of F. Michaud, \(t = (35N + 30p)/f\) with \(p\) in µm, both for the celestial equator.</p>
<h3>ISO</h3>
<p>Read noise is modelled as in the noise laboratory: a pre-amplifier term (1.6 e⁻) and an ADC term (12 e⁻ at ISO 100) divided by the analogue gain \(g = \text{ISO}/100\). The ISO-invariance point is where the total is within 10 % of the pre-amplifier floor; above it, raising the ISO no longer lowers the noise and only reduces the headroom for bright stars.</p>
</div><div>
<h3>Sky, signal and stacking</h3>
<p>Sky and detail are surface brightnesses \(\mu\) in V magnitudes per square arcsecond, converted to electrons per second per pixel with the stacking laboratory's photon zero point (\(10^6\) photons s⁻¹ cm⁻² for V = 0 in a 100 nm band), the entrance-pupil area \(\pi(f/2N)^2\), the pixel's solid angle and a system throughput × quantum efficiency of 0.3 for a camera lens and a Bayer pixel. The Bortle classes map to zenith sky brightness from 22.0 (class 1) to 18.0 mag/″² (class 9). One frame gives
\[\mathrm{SNR}_1 = \frac{F_d t}{\sqrt{(F_d + F_s)\,t + \sigma_r^2}},\]
and the average of \(N\) aligned frames \(\sqrt N\) times more. The plan asks for an SNR of 5 on the chosen detail.</p>
<div class="callout">Not included: dark current and sensor heating in warm nights, the Moon, extinction and the brighter sky near the horizon, lens transmission losses and vignetting in the corners, and the alignment errors of stacking software. Each makes the real requirement somewhat longer.</div>
</div></div>`));
  root.append(references([
    'F. Michaud, Société Astronomique du Havre: the NPF rule for untrailed star exposures.',
    'J. E. Bortle, "Introducing the Bortle Dark-Sky Scale", Sky &amp; Telescope 101(2), 126 (2001).',
    'S. B. Howell, <i>Handbook of CCD Astronomy</i>, 2nd ed., Cambridge (2006), ch. 4: the CCD equation.',
    'R. N. Clark, clarkvision.com: digital camera sensor analysis (read noise against ISO).',
  ]));
}
