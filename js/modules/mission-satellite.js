// Mission: design an Earth-observation satellite camera for a target ground resolution.
import { h, controls, stage, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { MODULES } from '../app.js';
import { designFor } from '../lib/satellite.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const len = (m) => (m < 1 ? (m * 100).toFixed(0) + ' cm' : m.toPrecision(3) + ' m');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Start from what you want to see: cars need pixels of about half a metre on the ground, fields and forests 10 m. Everything else follows. The camera's pixels, magnified by the height of the orbit and divided by the focal length, must match that size; the mirror must be wide enough that diffraction does not blur it; and because the satellite races over the ground, each line of the image gets only a fraction of a millisecond of light.</p>
<p>This mission sizes the telescope, the number of times each line is exposed to collect enough light, and the flood of data the camera produces.</p>`, [
    'Halve the <strong>ground sample distance</strong> from 1 m to 0.5 m: the mirror doubles in width.',
    'Raise the <strong>swath</strong> from 15 to 100 km: the data rate grows nearly sevenfold.',
    'Lower the orbit from 600 to 400 km: a shorter telescope does the same job, but the satellite meets more air drag.',
  ]));

  const ctl = controls({
    gsd: { type: 'range', label: 'Target ground sample distance', min: 0.25, max: 30, log: true, value: 0.5, fmt: (v) => (v < 1 ? (v * 100).toFixed(0) + ' cm' : v.toPrecision(2) + ' m') },
    H: { type: 'range', label: 'Orbit height', min: 400, max: 800, step: 5, value: 600, unit: 'km' },
    p: { type: 'range', label: 'Detector pixel size', min: 3, max: 15, step: 0.1, value: 7, unit: 'µm' },
    Q: { type: 'range', label: 'Optics Q = λf/(Dp) (1 is a common compromise)', min: 0.5, max: 2, step: 0.05, value: 1 },
    snr: { type: 'range', label: 'Required signal-to-noise ratio', min: 20, max: 200, log: true, value: 100, fmt: (v) => Math.round(v) },
    swath: { type: 'range', label: 'Swath width', min: 5, max: 300, log: true, value: 15, unit: 'km' },
  }, () => update());
  const calc = liveCalc('Your satellite');
  const steps = [
    missionStep(1, 'Focal length', 'earthobs', titleOf('earthobs')),
    missionStep(2, 'Mirror', 'psf', titleOf('psf')),
    missionStep(3, 'Light: TDI stages', 'earthobs', titleOf('earthobs')),
    missionStep(4, 'Data', null, ''),
  ];
  const view = stage({ aspect: 2.6, label: 'The telescope to scale with a person (1.8 m)', draw: drawScale, minH: 200 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), view.el], [h('div.card', {}, ctl.el), calc.el]));

  let R = null;
  function update() {
    const st = ctl.state;
    R = { st, ...designFor({ gsd: st.gsd, H: st.H * 1000, p: st.p * 1e-6, Q: st.Q, snrTarget: st.snr, swathKm: st.swath }) };
    const r = R;
    steps[0].set({
      answer: `${len(r.f)}`,
      why: `A ${st.p} µm pixel seen from ${st.H} km covers ${len(st.gsd)} when the focal length is ${len(r.f)}. Folded with a secondary mirror, as in most satellite telescopes, the tube is a few times shorter.`,
      tex: String.raw`f = \frac{H\,p}{\text{GSD}} = ${texNum(r.f, 3)}\ \text{m}`,
    });
    steps[1].set({
      answer: `${len(r.D)} wide`,
      why: `At Q = ${st.Q.toFixed(2)} the diffraction blur (${len(r.diffGround)} on the ground at 550 nm) matches the pixel; a smaller mirror would make the pixels finer than the detail the optics can deliver. Contrast at the finest recorded pattern: ${(r.mtf * 100).toFixed(0)} %.`,
      tex: String.raw`D = \frac{\lambda f}{Q\,p} = ${texNum(r.D, 3)}\ \text{m}`,
    });
    steps[2].set({
      answer: `${r.N} stages <small>(SNR ${r.snr.toFixed(0)})</small>`,
      why: `The ground moves ${(r.ground / 1000).toFixed(2)} km/s, so each line gets ${(r.t * 1e6).toFixed(0)} µs. Exposing each line ${r.N} times as it passes (time-delay integration) collects ${fmt(r.e, 3)} electrons from a 20 % grey ground under a 45° Sun.`,
      tex: String.raw`t_\text{line} = \frac{\text{GSD}}{v_g} = ${texNum(r.t * 1e6, 3)}\ \mu\text{s}`,
    });
    steps[3].set({
      answer: `${(r.dataRate / 1e9).toPrecision(3)} Gbit/s`,
      why: `${fmt(r.pixelsAcross, 3)} pixels across the swath, ${fmt(r.lineRate, 3)} lines per second, 11 bits each: ${(r.dataRate * 60 / 8e9).toFixed(1)} GB per minute of imaging. Radio downlinks carry roughly 0.1–3 Gbit/s, so images are compressed and stored until the next ground-station pass.`,
      tex: String.raw`R = n_\text{px}\cdot\frac{v_g}{\text{GSD}}\cdot b`,
    });
    calc.say(`For <strong>${len(st.gsd)} pixels from ${st.H} km</strong>: a ${len(r.D)} mirror, ${len(r.f)} focal length, ${r.N} TDI stages for SNR ${r.snr.toFixed(0)}, and ${(r.dataRate / 1e9).toPrecision(3)} Gbit/s of raw data over a ${st.swath} km swath.`);
    calc.set(String.raw`\begin{aligned}
    f &= ${texNum(r.f, 3)}\ \text{m},\quad D = ${texNum(r.D, 3)}\ \text{m},\quad N = f/D = ${texNum(r.f / r.D, 3)}\\
    \text{lines} &= ${texNum(r.lineRate, 3)}\ \text{s}^{-1}
    \end{aligned}`);
    view.redraw();
  }

  function drawScale(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!R) return;
    const fold = 5, tube = R.f / fold, scale = Math.min((hh - 80) / Math.max(1.8, R.D * 1.2), (w - 200) / Math.max(tube, 1));
    const base = hh - 20, x0 = 60;
    // person
    ctx.strokeStyle = '#9aa1b5'; ctx.lineWidth = 2; const ph = 1.8 * scale, px = 30;
    ctx.beginPath(); ctx.arc(px, base - ph + ph * 0.07, ph * 0.07, 0, 2 * Math.PI); ctx.moveTo(px, base - ph * 0.86); ctx.lineTo(px, base - ph * 0.42); ctx.lineTo(px - ph * 0.1, base); ctx.moveTo(px, base - ph * 0.42); ctx.lineTo(px + ph * 0.1, base); ctx.moveTo(px - ph * 0.15, base - ph * 0.7); ctx.lineTo(px + ph * 0.15, base - ph * 0.7); ctx.stroke();
    // telescope tube (folded by a telephoto factor of 5) with the primary mirror
    const tw = tube * scale, td = R.D * scale;
    ctx.fillStyle = 'rgba(106,215,255,0.12)'; ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 1.5;
    ctx.fillRect(x0, base - td - 6, tw, td + 6); ctx.strokeRect(x0, base - td - 6, tw, td + 6);
    ctx.fillStyle = '#ffd27a'; ctx.fillRect(x0 + tw - 4, base - td - 3, 4, td);
    ctx.fillStyle = '#e9ebf3'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`mirror ${len(R.D)} · tube about ${len(tube)} (focal length ${len(R.f)} folded ×${fold})`, x0, Math.max(14, base - td - 14));
  }

  update();

  root.append(rule(String.raw`\[f = \frac{H\,p}{\text{GSD}},\qquad D = \frac{\lambda f}{Q\,p} \approx \frac{\lambda H}{Q\,\text{GSD}}\]
<p>The mirror needed for a ground resolution depends only on the height and the wavelength: \(D \approx 0.55\,\mu\text{m}\times 600\,\text{km}/0.5\,\text{m} = 0.66\) m at Q = 1 for 50 cm pixels. Halving the pixel on the ground doubles the mirror and, at fixed pixel size, the focal length; satellite mass and cost grow faster still, which is why sub-30 cm imagery needs mirrors of a metre or more.</p>`,
    String.raw`These are nadir values for a diffraction-limited telescope in the visible. Looking sideways stretches the ground pixel, the atmosphere and pointing jitter blur it further, and real designs trade Q, aperture and TDI against mass, power and downlink capacity.`));

  root.append(theory('How the design is computed', String.raw`
<div class="theory-cols"><div>
<h3>Optics</h3>
<p>The focal length follows from GSD \(= Hp/f\), the aperture from \(Q = \lambda f/(Dp)\) at 550 nm. \(Q = 2\) samples the optical cut-off at the detector's Nyquist frequency; most Earth-observation systems choose \(Q \approx 1\), trading some aliasing for more light and contrast. The MTF shown is the diffraction-limited circular aperture times the pixel-aperture and one-pixel smear MTFs at Nyquist, as in the Earth-observation laboratory.</p>
</div><div>
<h3>Light and data</h3>
<p>Each line integrates for \(\text{GSD}/v_g\). The signal uses the laboratory's model of sunlit Lambertian ground (reflectance 0.2, Sun at 45°, two-way transmission 0.75) in a 300 nm panchromatic band, with throughput × quantum efficiency 0.4 and 2 e⁻ of read noise per stage; the number of TDI stages is the smallest standard count reaching the required SNR. The raw data rate is pixels across × line rate × 11 bits, before compression.</p>
</div></div>`));
  root.append(references([
    'J. R. Schott, <i>Remote Sensing: The Image Chain Approach</i>, 2nd ed., Oxford University Press (2007).',
    'R. D. Fiete, "Image quality and λFN/p for remote sensing systems", Optical Engineering 38, 1229 (1999).',
    'W. J. Larson and J. R. Wertz (eds.), <i>Space Mission Analysis and Design</i>, 3rd ed., Microcosm (1999).',
  ]));
  return () => [view].forEach((s) => s.destroy());
}
