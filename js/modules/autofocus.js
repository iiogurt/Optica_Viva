// Autofocus: phase detection with split pixels against contrast detection by hill climbing.
import { h, controls, stage, readouts, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { latest } from '../lib/compute.js';
import { defocus, disparityOf, imageDistance } from '../lib/autofocus.js';

const FRAME = 1 / 120; // s per autofocus frame (a 120 fps live view)

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A camera has two ways to find focus. <strong>Contrast detection</strong> works like you would with a manual lens: move the focus a little, look whether the picture got sharper, and keep going until it gets worse, then go back. It is accurate, but it has to search, and it cannot tell from one look which way to turn.</p>
<p><strong>Phase detection</strong> looks through the left and right halves of the lens separately, with pixels split in two. When the subject is out of focus, the two half-images are shifted against each other, and the size and direction of the shift say how far and which way to move. One look is enough, which is why it can follow moving subjects.</p>`, [
    'Move the subject from 3 m to 1 m: the shift between the half-images flips direction and grows.',
    'Lower the <strong>light</strong> to 20 photons per pixel: phase detection becomes less precise, contrast detection is unaffected here.',
    'Open the aperture to f/1.4: the half-images separate more, so phase detection gets more precise.',
  ]));

  const ctl = controls({
    f: { type: 'range', label: 'Focal length', min: 24, max: 200, log: true, value: 50, unit: 'mm' },
    N: { type: 'range', label: 'Aperture', min: 1.4, max: 8, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    u: { type: 'range', label: 'Subject distance', min: 0.6, max: 10, log: true, value: 3, unit: 'm' },
    focus: { type: 'range', label: 'Lens currently focused at', min: 0.6, max: 10, log: true, value: 2, unit: 'm' },
    pitch: { type: 'range', label: 'Pixel size', min: 2, max: 8, step: 1, value: 4, unit: 'µm' },
    photons: { type: 'range', label: 'Light (photons per pixel)', min: 10, max: 10000, log: true, value: 2000, fmt: (v) => Math.round(v) },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const halves = stage({ aspect: 2.4, label: '', draw: drawHalves, cls: 'plain', minH: 210 });
  const climb = stage({ aspect: 2.4, label: '', draw: drawClimb, cls: 'plain', minH: 210 });
  root.append(lab([h('div.card', { style: { padding: '8px' } }, halves.el), h('div.card', { style: { padding: '8px' } }, climb.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('autofocus');
  let R = null, P = null;
  function update() {
    const st = ctl.state, u = st.u * 1000, fc = st.focus * 1000;
    const d = defocus(st.f, st.N, u, fc), disp = disparityOf(d.dv, st.N);
    P = { st, d, disp };
    calc.set(String.raw`\begin{aligned}
    \Delta v &= v(u) - v(s) = ${texNum(d.dv * 1000, 3)}\ \mu\text{m}\\
    b &= \frac{|\Delta v|}{N} = ${texNum(d.blur * 1000, 3)}\ \mu\text{m}\\
    \delta &= \frac{4}{3\pi}\,\frac{\Delta v}{N} = ${texNum(disp * 1000, 3)}\ \mu\text{m} = ${texNum((disp * 1000) / st.pitch, 3)}\ \text{px}
    \end{aligned}`);
    job('autofocus', { f: st.f, N: st.N, u, focus: fc, pitchUm: st.pitch, photons: st.photons, trials: 8 }).then((r) => {
      R = r;
      const tPD = r.pdFrames * FRAME, tCD = r.frames * FRAME;
      ro.replaceChildren(readouts([
        ['Blur of the subject now', (d.blur * 1000).toFixed(0) + ' µm = ' + ((d.blur * 1000) / st.pitch).toFixed(1) + ' px'],
        ['Shift between the half-images', (disp * 1000).toFixed(1) + ' µm = ' + ((disp * 1000) / st.pitch).toFixed(1) + ' px'],
        ['Phase detection: focus set to', (r.pdU / 1000).toFixed(3) + ' m ± ' + (r.pdUsd / 10).toFixed(1) + ' cm'],
        ['Phase detection: frames, time', `${r.pdFrames}, ${(tPD * 1000).toFixed(0)} ms`],
        ['Contrast detection: focus set to', (r.cdU / 1000).toFixed(3) + ' m'],
        ['Contrast detection: frames, time', `${r.frames}, ${(tCD * 1000).toFixed(0)} ms`],
      ]));
      calc.say(`The subject is blurred by ${((d.blur * 1000) / st.pitch).toFixed(1)} pixels and the half-images are <strong>${Math.abs((disp * 1000) / st.pitch).toFixed(1)} px apart</strong> (${d.dv < 0 ? 'the lens is focused too close' : 'the lens is focused too far'}). Phase detection lands at ${(r.pdU / 1000).toFixed(2)} m in <strong>${r.pdFrames} frames</strong>; contrast detection needs <strong>${r.frames}</strong> to reach ${(r.cdU / 1000).toFixed(2)} m.`);
      halves.redraw(); climb.redraw();
    }).catch(console.error);
  }

  function drawHalves(ctx, w, hh) {
    if (!R) return;
    const n = R.left.length, a = Math.floor(n / 2 - 80), b = a + 160, xs = range(a, b - 1, b - a);
    const vals = xs.flatMap((i) => [R.left[i], R.right[i]]), lo = Math.min(...vals) - 0.05, hi = Math.max(...vals) + 0.05;
    plot(ctx, w, hh, {
      title: 'What the left and right halves of the split pixels see', x: { min: a, max: b, label: 'pixel' }, y: { min: lo, max: hi, label: 'brightness' },
      series: [{ data: xs.map((i) => [i, R.left[i]]), color: '#ffb547', label: 'left half of the lens' }, { data: xs.map((i) => [i, R.right[i]]), color: '#6ad7ff', label: 'right half of the lens' }],
      legend: true, legendX: w - 190, legendY: 34,
    });
  }

  function drawClimb(ctx, w, hh) {
    if (!R) return;
    const pts = R.path, vs = pts.map((p) => p[0]), lo = Math.min(...vs, R.vTrue) - 0.05, hi = Math.max(...vs, R.vTrue) + 0.05, top = Math.max(...pts.map((p) => p[1])) * 1.15;
    plot(ctx, w, hh, {
      title: 'Contrast detection: sharpness at each step of the search', x: { min: lo, max: hi, label: 'lens position (image distance, mm)' }, y: { min: 0, max: top, label: 'sharpness' },
      series: [{ data: pts, color: 'rgba(193,140,255,0.5)' }, { data: pts, color: '#c18cff', points: true, r: 3 }],
      vlines: [{ x: R.vTrue, color: '#6be3a4', label: 'true focus' }, { x: R.v0, color: '#9aa1b5', label: 'start' }],
    });
  }

  update();

  root.append(rule(String.raw`\[\delta = \frac{4}{3\pi}\,\frac{\Delta v}{N} \approx 0.42\,b\]
<p>Each half of the lens forms an image whose centre sits off the axis by the centroid of a half disc, so the two half-images are shifted by about 0.42 times the blur diameter \(b\). A 50 mm lens at f/2 focused at 2 m, with the subject at 3 m, puts the image 0.43 mm in front of the sensor: a 217 µm blur and a 92 µm shift, 23 pixels of 4 µm, which the camera turns straight into the lens movement. Contrast detection gets no such hint and must step through focus.</p>`,
    String.raw`Real split-pixel sensors see only part of each half of the pupil, and their baseline shrinks with small apertures (beyond about f/8 many cameras fall back to contrast detection). Low light, low-contrast or repetitive subjects and lens aberrations make the measured shift less reliable, so cameras combine both methods.`));

  root.append(theory('How the two methods are simulated', String.raw`
<div class="theory-cols"><div>
<h3>Defocus</h3>
<p>For a thin lens the image of a subject at \(u\) lies at \(v(u) = 1/(1/f - 1/u)\); with the sensor at \(v(s)\) the subject is blurred into a disc of diameter \(b = |v(u) - v(s)|/N\). A 1-D strip of the scene (random bars) is convolved with the projection of that disc, a semi-ellipse, by FFT, integrated over the pixels and given Poisson noise.</p>
<h3>Phase detection</h3>
<p>Split pixels see the scene through the left or right half of the pupil: their kernels are the two halves of the semi-ellipse, shifted apart by \(\delta = (4/3\pi)\Delta v/N\). The camera cross-correlates the two pixel rows (with a parabolic sub-pixel peak), converts the shift into \(\Delta v\) and moves the lens; it repeats until the move is within the depth of focus, at most four times. Eight noisy repetitions give the precision.</p>
</div><div>
<h3>Contrast detection</h3>
<p>The sharpness metric is the mean squared difference of neighbouring pixels, largest at focus. The search starts towards longer image distances with a step of a sixth of the initial error, keeps going while sharpness rises, and reverses with half the step when it falls, until the step is below a quarter of the depth of focus. Each step costs a frame; the page assumes a 120 fps live view. The search is shown without noise, since it averages over the whole focus area.</p>
</div></div>`));
  root.append(references([
    'J. Nakamura (ed.), <i>Image Sensors and Signal Processing for Digital Still Cameras</i>, CRC Press (2006): autofocus methods.',
    'R. Kingslake, <i>Optics in Photography</i>, SPIE Press (1992): focusing and depth of focus.',
    'Canon, Dual Pixel CMOS AF technical documentation (2013): split-pixel phase detection on the imaging sensor.',
  ]));
}
