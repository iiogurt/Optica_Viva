// Mission: image Jupiter from a garden with a small telescope and a planetary camera.
import { h, controls, stage, imageCanvas, fmt, texNum, readUrlParam } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { MODULES } from '../app.js';
import { plan, JUPITER_FLATTENING } from '../lib/jupiter.js';
import { dispersion } from '../lib/adc.js';
import { TELESCOPES, ASTROCAMS } from '../lib/equipment.js';
import { gaussianExact } from '../lib/macro.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const fmtT = (t) => (t >= 60 ? (t / 60).toFixed(1) + ' min' : t.toFixed(0) + ' s');

// Jupiter's colours by planetographic latitude (deg): bright zones, brown belts, the Great Red Spot.
function jupiterRGB(lat, lon) {
  const zones = [[-90, [0.62, 0.6, 0.58]], [-45, [0.72, 0.66, 0.58]], [-28, [0.92, 0.86, 0.74]], [-17, [0.66, 0.46, 0.34]], [-8, [0.95, 0.9, 0.8]], [8, [0.93, 0.88, 0.78]], [17, [0.62, 0.44, 0.33]], [26, [0.9, 0.84, 0.72]], [34, [0.72, 0.58, 0.46]], [45, [0.8, 0.74, 0.64]], [90, [0.6, 0.58, 0.56]]];
  let c = zones[zones.length - 1][1];
  for (let i = 0; i < zones.length - 1; i++) if (lat >= zones[i][0] && lat < zones[i + 1][0]) {
    const u = (lat - zones[i][0]) / (zones[i + 1][0] - zones[i][0]), s = u * u * (3 - 2 * u);
    c = zones[i][1].map((v, k) => v + (zones[i + 1][1][k] - v) * s);
    break;
  }
  const grs = Math.hypot((lat + 22) / 5, (lon - 20) / 11);
  if (grs < 1) { const w = 1 - grs * grs; c = c.map((v, k) => v * (1 - 0.7 * w) + [0.78, 0.38, 0.26][k] * 0.7 * w); }
  return c;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Through a small telescope Jupiter is a tiny, shimmering disc. The air above you blurs it far more than the telescope does, but only on average: for a few thousandths of a second at a time the air is steady and the view is sharp.</p>
<p>Planetary imagers therefore record a video of thousands of very short frames, keep the sharpest, line them up and stack them. This mission works out how much to magnify the image for your camera, how short each frame must be, how long you can film before Jupiter's fast rotation smears the detail, and whether low altitude calls for a corrector against the air's rainbow effect.</p>`, [
    'Lower <strong>Jupiter\'s altitude</strong> from 60° to 20°: the colour fringes grow until an atmospheric dispersion corrector becomes essential.',
    'Change the <strong>pixel size</strong> from 2.9 to 5.8 µm: the right focal ratio doubles, so you need a stronger Barlow lens.',
    'Increase the <strong>aperture</strong> from 20 to 35 cm: finer detail, but a shorter capture before rotation blurs it.',
  ]));

  const ctl = controls({
    scope: { type: 'select', label: 'Telescope', value: 'dob8', options: [['custom', 'Custom'], ...Object.entries(TELESCOPES).map(([k, t]) => [k, t.name])] },
    D: { type: 'range', label: 'Telescope aperture', min: 5, max: 40, step: 0.1, value: 20, unit: 'cm' },
    N0: { type: 'range', label: 'Native focal ratio', min: 2, max: 15, step: 0.1, value: 6, fmt: (v) => 'f/' + v.toPrecision(2) },
    cam: { type: 'select', label: 'Camera', value: 'asi462', options: [['custom', 'Custom'], ...Object.entries(ASTROCAMS).map(([k, c]) => [k, `${c.name} (${c.pitch} µm)`])] },
    pitch: { type: 'range', label: 'Camera pixel size', min: 1.5, max: 6, step: 0.05, value: 2.9, unit: 'µm' },
    fps: { type: 'range', label: 'Camera maximum frame rate', min: 30, max: 500, log: true, value: 150, unit: 'fps' },
    fwhm: { type: 'range', label: 'Seeing (FWHM at 500 nm)', min: 0.6, max: 4, step: 0.1, value: 2, unit: '″' },
    wind: { type: 'range', label: 'High-altitude wind', min: 3, max: 40, step: 1, value: 10, unit: 'm/s' },
    alt: { type: 'range', label: 'Jupiter\'s altitude', min: 10, max: 85, step: 1, value: 35, unit: '°' },
    diam: { type: 'range', label: 'Jupiter\'s apparent diameter', min: 31, max: 50, step: 0.5, value: 45, unit: '″' },
  }, (st) => {
    if (st.scope !== seen.scope && st.scope !== 'custom') { const t = TELESCOPES[st.scope]; ctl.set.D(t.D / 10); ctl.set.N0(t.f / t.D); }
    if (st.cam !== seen.cam && st.cam !== 'custom') ctl.set.pitch(ASTROCAMS[st.cam].pitch);
    seen = { ...ctl.state };
    update();
  });
  let seen = { ...ctl.state };
  const calc = liveCalc('Your plan');
  const steps = [
    missionStep(1, 'Focal ratio', 'sampling', titleOf('sampling')),
    missionStep(2, 'Exposure per frame', 'seeing', titleOf('seeing')),
    missionStep(3, 'Capture length', null, ''),
    missionStep(4, 'Frames to keep', 'lucky', titleOf('lucky')),
    missionStep(5, 'Dispersion corrector', 'adc', titleOf('adc')),
  ];
  const view = stage({ aspect: 2.6, label: 'Jupiter on your sensor (each block is a pixel)', draw: drawJupiter, minH: 230 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), view.el], [h('div.card', {}, ctl.el), calc.el]));

  let P = null, imgs = null;
  function update() {
    const st = ctl.state;
    P = { st: { ...st }, ...plan({ D: st.D / 100, N0: st.N0, pitch: st.pitch, fwhm: st.fwhm, wind: st.wind, alt: st.alt, diam: st.diam, fps: st.fps }) };
    const r = P;
    steps[0].set({
      answer: `f/${r.N.toFixed(1)} <small>(${r.barlow < 1.05 ? 'no Barlow needed' : `Barlow ${r.barlow.toFixed(1)}×`})</small>`,
      why: `Two pixels per finest detail the telescope can pass, in green light. That gives ${r.scale.toFixed(2)}″ per pixel and a Jupiter ${r.discPx.toFixed(0)} pixels wide. More magnification only spreads the same light over more pixels.`,
      tex: String.raw`N = \frac{2p}{\lambda} = \frac{2\times${texNum(st.pitch, 3)}\ \mu\text{m}}{0.5\ \mu\text{m}} = ${texNum(r.N, 3)}`,
    });
    steps[1].set({
      answer: `${(r.t * 1000).toFixed(1)} ms <small>(${r.rate.toFixed(0)} fps)</small>`,
      why: `The air's pattern changes every ${(r.tau * 1000).toFixed(1)} ms (its coherence time with ${st.wind} m/s wind high up); shorter frames freeze it. Raise the gain until the histogram reaches about 70 %.`,
      tex: String.raw`\tau_0 = 0.314\,\frac{r_0}{v} = 0.314\times\frac{${texNum(r.r0 * 100, 3)}\ \text{cm}}{${st.wind}\ \text{m/s}} = ${texNum(r.tau * 1000, 3)}\ \text{ms}`,
    });
    steps[2].set({
      answer: `${fmtT(r.rot.t)} <small>(${fmt(r.frames, 3)} frames)</small>`,
      why: `Jupiter turns once in 9 h 56 min, so detail at the centre of the disc moves ${(r.rot.rate * 60).toFixed(2)}″ per minute. After ${fmtT(r.rot.t)} it has moved by the telescope's resolution of ${r.res.toFixed(2)}″. Derotation software can stretch this to several captures.`,
      tex: String.raw`t = \frac{\lambda/D}{\omega_J\,\theta_J/2} = ${texNum(r.rot.t, 3)}\ \text{s}`,
    });
    steps[3].set({
      answer: `best ${(r.keep * 100).toFixed(0)} % <small>(${fmt(r.kept, 3)} frames)</small>`,
      why: r.Dr0 < 3.5
        ? `With ${st.D} cm of aperture and r₀ = ${(r.r0 * 100).toFixed(1)} cm, D/r₀ is only ${r.Dr0.toFixed(1)}: most frames are close to sharp, so keep about half and gain signal.`
        : r.pLucky > r.keep
          ? `D/r₀ = ${r.Dr0.toFixed(1)}: Fried's formula gives ${(Math.min(1, r.pLucky) * 100).toPrecision(2)} % nearly sharp frames, so keeping the best half still selects only good ones.`
          : `D/r₀ = ${r.Dr0.toFixed(1)}: Fried's formula gives only ${(r.pLucky * 100).toPrecision(2)} % nearly sharp frames, so keep about that share.`,
      tex: String.raw`P \approx 5.6\,e^{-0.1557\,(D/r_0)^2} = ${texNum(Math.min(1, r.pLucky), 3)}`,
    });
    steps[4].set({
      answer: r.adc ? 'Use one' : 'Not needed',
      why: `At ${st.alt}° altitude the air spreads violet to red over ${r.disp.toFixed(2)}″, ${r.disp > r.res ? `${(r.disp / r.res).toFixed(1)} times` : 'less than'} the telescope's resolution of ${r.res.toFixed(2)}″. ${r.adc ? 'Colour fringes will soften the detail unless a corrector or a monochrome camera with filters is used.' : 'The colours stay within half a resolution element.'}`,
      tex: String.raw`\Delta R = [n(400) - n(700)]\tan z = ${texNum(r.disp, 3)}''`,
    });
    calc.say(`<strong>f/${r.N.toFixed(1)} · ${(r.t * 1000).toFixed(1)} ms · ${r.rate.toFixed(0)} fps · ${fmtT(r.rot.t)} per capture · keep ${(r.keep * 100).toFixed(0)} %</strong>${r.adc ? ' · with ADC' : ''}. Jupiter will be ${r.discPx.toFixed(0)} pixels wide; seeing alone would blur it to ${st.fwhm}″, the stack can reach ${r.res.toFixed(2)}″.`);
    calc.set(String.raw`\begin{aligned}
    r_0(550\,\text{nm}) &= ${texNum(r.r0 * 100, 3)}\ \text{cm},\quad D/r_0 = ${texNum(r.Dr0, 3)}\\
    \lambda/D &= ${texNum(r.res, 3)}'',\quad \text{scale} = ${texNum(r.scale, 3)}''/\text{px}
    \end{aligned}`);
    render();
    view.redraw();
  }

  // Three renders at the sensor's pixel scale: seeing-limited long exposure, lucky stack without a
  // corrector (colour channels displaced by dispersion), lucky stack with a corrector.
  function render() {
    const r = P, st = P.st;
    const n = Math.min(360, Math.ceil(r.discPx * 1.25)), R = r.discPx / 2, cx = n / 2, cy = n / 2;
    const base = [0, 1, 2].map(() => new Float64Array(n * n));
    const ss = 3;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const u = (x + (i + 0.5) / ss - cx) / R, v = (y + (j + 0.5) / ss - cy) / (R * (1 - JUPITER_FLATTENING));
        const rr = u * u + v * v;
        if (rr >= 1) continue;
        const mu = Math.sqrt(1 - rr), lat = (-Math.asin(v) * 180) / Math.PI, lon = (Math.asin(u / Math.sqrt(1 - v * v)) * 180) / Math.PI;
        const c = jupiterRGB(lat, lon), ld = Math.pow(mu, 0.45);
        for (let k = 0; k < 3; k++) acc[k] += c[k] * ld;
      }
      for (let k = 0; k < 3; k++) base[k][y * n + x] = acc[k] / (ss * ss);
    }
    const sigDiff = (0.42 * 0.55 * r.N) / st.pitch; // px, Airy core as a Gaussian
    const sigSee = st.fwhm / r.scale / 2.355;
    const z = ((90 - st.alt) * Math.PI) / 180;
    const shift = [dispersion(650, 550, z, 101325, 10), 0, dispersion(450, 550, z, 101325, 10)].map((d) => d / r.scale); // px, + towards the zenith
    const make = (sigma, shifts) => base.map((ch, k) => {
      const s = shifts ? Math.round(shifts[k]) : 0;
      const moved = new Float64Array(n * n);
      for (let y = 0; y < n; y++) { const ys = y + s; if (ys < 0 || ys >= n) continue; for (let x = 0; x < n; x++) moved[y * n + x] = ch[ys * n + x]; }
      return gaussianExact(moved, n, n, sigma);
    });
    imgs = { n, list: [['Long exposure (seeing)', make(Math.hypot(sigSee, sigDiff))], ['Lucky stack, no corrector', make(sigDiff, shift)], ['Lucky stack with corrector', make(sigDiff)]] };
  }

  function drawJupiter(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!imgs) return;
    const { n, list } = imgs, gap = 14, side = Math.min((w - gap * 4) / 3, hh - 46);
    list.forEach(([label, ch], k) => {
      const ic = imageCanvas(n, n);
      for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) ic.data[4 * i + c] = Math.round(Math.pow(Math.max(0, Math.min(1, ch[c][i])), 1 / 2.2) * 255);
      for (let i = 0; i < n * n; i++) ic.data[4 * i + 3] = 255;
      ic.put();
      const ox = gap + k * (side + gap), oy = 40;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ic.c, ox, oy, side, side);
      ctx.fillStyle = k === 2 ? '#6be3a4' : k === 1 ? '#ffb547' : '#9aa1b5'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(label, ox, 30);
    });
  }

  // a link that names a preset but not its values applies the preset
  if (ctl.state.scope !== 'custom' && readUrlParam('D') == null) { const t = TELESCOPES[ctl.state.scope]; ctl.set.D(t.D / 10); ctl.set.N0(t.f / t.D); }
  if (ctl.state.cam !== 'custom' && readUrlParam('pitch') == null) ctl.set.pitch(ASTROCAMS[ctl.state.cam].pitch);
  seen = { ...ctl.state };
  update();

  root.append(rule(String.raw`\[N = \frac{2p}{\lambda} \approx 4\,p_{[\mu\text{m}]},\qquad t_\text{rot} = \frac{\lambda/D}{\omega_J\,\theta_J/2}\]
<p>The focal ratio that puts two pixels across the finest detail the telescope passes is about four times the pixel size in micrometres in green light: f/11.6 for 2.9 µm pixels. Jupiter spins in under ten hours, so detail near the centre of its 45″ disc moves 0.24″ per minute; a 20 cm telescope resolves 0.57″, which allows about 2.4 minutes per capture.</p>`,
    String.raw`Full Nyquist sampling assumes the stack reaches the diffraction limit; in mediocre seeing many imagers sample a little less (about three times the pixel size) to collect more light per pixel. The rotation limit applies at the disc centre and shrinks with aperture; derotation software lengthens usable sessions to many minutes.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Sampling</h3>
<p>A telescope of diameter \(D\) passes no spatial frequency above \(D/\lambda\) (cycles per radian), which at focal ratio \(N\) is \(1/(\lambda N)\) cycles per millimetre on the sensor. Sampling it without aliasing needs pixels \(p \le \lambda N/2\), so \(N = 2p/\lambda\). The page uses \(\lambda = 0.5\) µm for a colour camera; the image scale is \(p/(DN)\) radians per pixel.</p>
<h3>Freezing the seeing</h3>
<p>The Fried parameter at 550 nm follows from the seeing FWHM at 500 nm as \(r_0 = 0.98\,\lambda/\text{FWHM}\), scaled by \(\lambda^{6/5}\). Frozen-flow turbulence decorrelates in \(\tau_0 = 0.314\,r_0/v\) (as in the seeing laboratory); frames are kept between 2 and 20 ms, and the frame rate is the smaller of \(1/t\) and the camera's maximum.</p>
<h3>Lucky selection</h3>
<p>Fried's estimate of the probability of a short exposure with less than 1 rad² of wavefront error, \(5.6\,e^{-0.1557(D/r_0)^2}\), is valid for \(D/r_0 \gtrsim 3.5\); below that most frames are good and about half are kept.</p>
</div><div>
<h3>Rotation</h3>
<p>Jupiter's System II period is 9 h 55 min 40.6 s. A feature at the centre of the disc of angular diameter \(\theta_J\) moves at \(\omega_J\theta_J/2\); the capture ends when it has moved one resolution element \(\lambda/D\) at 550 nm.</p>
<h3>Atmospheric dispersion</h3>
<p>Edlén's index of standard air (10 °C, sea-level pressure) and the plane-parallel refraction \((n-1)\tan z\) give the spread from 400 to 700 nm at zenith angle \(z = 90^\circ -\) altitude, as in the ADC laboratory. A corrector is recommended when it exceeds half the resolution element.</p>
<h3>The renders</h3>
<p>Jupiter is drawn with its polar flattening (0.065), limb darkening and simplified belts at the sensor's pixel scale. The long exposure is blurred by the seeing FWHM; the lucky stacks by a Gaussian matched to the Airy core, the best a perfect stack can do, with the red and blue channels displaced by the dispersion when there is no corrector.</p>
</div></div>`));
  root.append(references([
    'D. L. Fried, "Probability of getting a lucky short-exposure image through turbulence", J. Opt. Soc. Am. 68, 1651 (1978).',
    'J. H. Rogers, <i>The Giant Planet Jupiter</i>, Cambridge University Press (1995): rotation systems and belt nomenclature.',
    'B. Edlén, "The refractive index of air", Metrologia 2, 71 (1966).',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 3rd ed., Roberts (2005): the diffraction cut-off and sampling.',
  ]));
}
