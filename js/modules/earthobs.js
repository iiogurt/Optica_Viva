// Earth observation from orbit: what a satellite camera can see, and why.
import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';
import { makeRng } from '../lib/random.js';
import { design, groundScene, imageFromOrbit, mtfDiff } from '../lib/earthobs.js';
import { view3d } from '../lib/gl3d.js';
import { earthobsScene } from '../lib/earthobs3d.js';
import { t } from '../lib/i18n.js';

const PRESETS = {
  cubesat: { name: 'CubeSat camera (9 cm aperture)', H: 500, D: 0.09, f: 0.58, p: 5.5, N: 1 },
  mapping: { name: 'Mapping satellite (15 cm, wide swath)', H: 786, D: 0.15, f: 0.6, p: 7.5, N: 1 },
  vhr: { name: 'Very-high-resolution satellite (1.1 m mirror)', H: 617, D: 1.1, f: 13.3, p: 8, N: 32 },
};
const LAM = 550e-9;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>An Earth-observation satellite is a telescope looking down from a few hundred kilometres while racing along at 7 km per second. Each pixel of its camera covers a patch of ground, the <strong>ground sample distance</strong>: 10 m for a mapping satellite, 30 cm for the sharpest commercial ones.</p>
<p>Three limits fight each other. The mirror must be large enough that diffraction does not blur away detail finer than a pixel. The pixels must be small enough on the ground to record it. And because the ground rushes past, each pixel sees its patch for only a fraction of a millisecond, so the camera adds up the same line many times as it passes (time-delay integration) to collect enough light.</p>`, [
    'Compare the three <strong>presets</strong>: which can count the cars, which can see the road markings?',
    'With the very-high-resolution preset, set <strong>TDI stages</strong> to 1: the picture drowns in noise.',
    'Make the <strong>focal length</strong> longer without enlarging the mirror: the pixels get smaller on the ground, but diffraction blur keeps the picture soft.',
  ]));

  const ctl = controls({
    preset: { type: 'select', label: 'Satellite', value: 'vhr', options: Object.entries(PRESETS).map(([k, p]) => [k, p.name]) },
    H: { type: 'range', label: 'Orbit height', min: 300, max: 900, step: 1, value: 617, unit: 'km' },
    D: { type: 'range', label: 'Aperture (mirror) diameter', min: 0.05, max: 2, log: true, value: 1.1, unit: 'm' },
    f: { type: 'range', label: 'Focal length', min: 0.2, max: 25, log: true, value: 13.3, unit: 'm' },
    p: { type: 'range', label: 'Pixel size', min: 2, max: 15, step: 0.1, value: 8, unit: 'µm' },
    N: { type: 'range', label: 'TDI stages', min: 1, max: 128, log: true, value: 32, fmt: (v) => String(Math.round(v)) },
    el: { type: 'range', label: 'Sun elevation', min: 10, max: 80, step: 1, value: 45, unit: '°' },
  }, (s) => {
    if (s.preset !== last) { const p = PRESETS[s.preset]; last = s.preset; ctl.set.H(p.H); ctl.set.D(p.D); ctl.set.f(p.f); ctl.set.p(p.p); ctl.set.N(p.N); }
    update();
  });
  let last = ctl.state.preset;
  const ro = h('div');
  const calc = liveCalc();
  const view = stage({ aspect: 2.5, label: 'An 80 × 56 m city block: the ground (left) and from orbit (right)', draw: drawView, minH: 220 });
  const mtf = stage({ aspect: 2.4, label: '', draw: drawMTF, cls: 'plain', minH: 220 });
  const v3 = view3d({ label: '3-D, true scale: the orbit, the swath and the strip a push-broom camera images in a minute', aspect: 1.9, minH: 260, yaw: 0.75, pitch: 0.5 });
  root.append(lab([view.el, v3.el, h('div.card', { style: { padding: '8px' } }, mtf.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const rng = makeRng(5), scene = groundScene(80, 56, 0.1, rng.u);
  let M = null, shown3d = false;
  function update() {
    const st = ctl.state, N = Math.round(st.N);
    const d = { H: st.H * 1000, D: st.D, f: st.f, p: st.p * 1e-6, N, el: st.el };
    const r = design(d);
    const img = imageFromOrbit(scene, r, d, makeRng(9).g);
    M = { st, r, img, N };
    const swath = (r.gsd * 12000) / 1000;
    ro.replaceChildren(readouts([
      ['Ground sample distance', r.gsd < 1 ? (r.gsd * 100).toFixed(0) + ' cm' : r.gsd.toPrecision(3) + ' m'],
      ['Diffraction limit on the ground (1.22 λH/D)', r.diffGround < 1 ? (r.diffGround * 100).toFixed(0) + ' cm' : r.diffGround.toPrecision(3) + ' m'],
      ['Optics Q = λN/p', r.Q.toFixed(2) + (r.Q < 1 ? ' (pixel-limited)' : r.Q > 2 ? ' (diffraction-limited)' : '')],
      ['Ground speed', (r.ground / 1000).toFixed(2) + ' km/s'],
      ['Line rate', fmt(r.lineRate, 3) + ' lines/s'],
      ['Time per line', (r.t * 1e6).toFixed(0) + ' µs'],
      ['Signal (20 % reflectance)', fmt(r.e, 3) + ' e⁻ with ' + N + ' stages'],
      ['Signal-to-noise ratio', r.snr.toFixed(0)],
      ['MTF at Nyquist (optics × pixel × smear)', (r.mtf.total * 100).toFixed(0) + ' %'],
      ['Swath of a 12 000-pixel line', swath.toFixed(1) + ' km'],
    ]));
    const sees = r.gsd <= 0.15 ? 'road markings and car details' : r.gsd <= 0.5 ? 'individual cars and road markings' : r.gsd <= 1.5 ? 'cars as blobs' : r.gsd <= 5 ? 'roads and buildings, not cars' : 'fields, blocks and rivers';
    calc.say(`Each pixel covers <strong>${r.gsd < 1 ? (r.gsd * 100).toFixed(0) + ' cm' : r.gsd.toPrecision(2) + ' m'}</strong> of ground, enough to see ${sees}. The ground passes at ${(r.ground / 1000).toFixed(1)} km/s, so each line gets ${(r.t * 1e6).toFixed(0)} µs; ${N} TDI stages collect ${fmt(r.e, 3)} electrons, a signal-to-noise ratio of <strong>${r.snr.toFixed(0)}</strong>.`);
    calc.set(String.raw`\begin{aligned}
    \text{GSD} &= \frac{H\,p}{f} = ${texNum(r.gsd, 3)}\ \text{m}\\
    v_g &= \sqrt{\frac{GM}{R+H}}\,\frac{R}{R+H} = ${texNum(r.ground / 1000, 3)}\ \text{km/s}\\
    t_\text{line} &= \frac{\text{GSD}}{v_g} = ${texNum(r.t * 1e6, 3)}\ \mu\text{s}\\
    Q &= \frac{\lambda f}{D p} = ${texNum(r.Q, 3)}
    \end{aligned}`);
    view.redraw(); mtf.redraw();
    v3.setScene(earthobsScene({ H: d.H, gsd: r.gsd, v: r.v, ground: r.ground }), shown3d);
    shown3d = true;
  }

  function drawView(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const gap = 16, side = Math.min((w - 3 * gap) / 2, ((hh - 50) * 80) / 56), ph = (side * 56) / 80, oy = 46;
    const show = (data, iw, ih, ox) => {
      const ic = imageCanvas(iw, ih);
      for (let k = 0; k < iw * ih; k++) { const v = Math.pow(Math.max(0, Math.min(1, data[k] / 0.6)), 1 / 2.2) * 255; ic.data[4 * k] = v; ic.data[4 * k + 1] = v; ic.data[4 * k + 2] = v; ic.data[4 * k + 3] = 255; }
      ic.put();
      ctx.imageSmoothingEnabled = iw > side; // downscale smoothly, upscale as visible pixels
      ctx.drawImage(ic.c, ox, oy, side, ph);
    };
    show(scene.g, scene.W, scene.H, gap);
    show(M.img.img, M.img.w, M.img.h, 2 * gap + side);
    ctx.fillStyle = '#9aa1b5'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t('ground truth (10 cm)'), gap, 38);
    ctx.fillStyle = '#6ad7ff';
    ctx.fillText(t('from {H} km: {w} × {h} pixels', { H: M.st.H, w: M.img.w, h: M.img.h }), 2 * gap + side, 38);
  }

  function drawMTF(ctx, w, hh) {
    if (!M) return;
    const { st } = M, p = st.p * 1e-3, nyq = 1 / (2 * p), nuC = st.D / (LAM * 1e3 * st.f), xs = range(0, 2 * nyq, 200); // cycles/mm
    const sinc = (x) => (x === 0 ? 1 : Math.abs(Math.sin(Math.PI * x) / (Math.PI * x)));
    plot(ctx, w, hh, {
      title: 'Contrast transfer along track (MTF)', x: { min: 0, max: 2 * nyq, label: 'spatial frequency on the detector (cycles/mm)' }, y: { min: 0, max: 1, label: 'MTF' },
      series: [
        { data: xs.map((v) => [v, mtfDiff(v / nuC)]), color: '#6ad7ff', label: 'optics (diffraction)' },
        { data: xs.map((v) => [v, sinc(v * p)]), color: '#c18cff', label: 'pixel' },
        { data: xs.map((v) => [v, sinc(v * p)]), color: '#9aa1b5', dash: [4, 4], label: 'smear (one pixel)' },
        { data: xs.map((v) => [v, mtfDiff(v / nuC) * sinc(v * p) ** 2]), color: '#ffb547', width: 2.4, label: 'system' },
      ],
      vlines: [{ x: nyq, color: 'rgba(255,255,255,0.35)', label: 'Nyquist' }], legend: true, legendX: w - 170, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[\text{GSD} = \frac{H\,p}{f},\qquad D \gtrsim \frac{1.22\,\lambda H}{\text{GSD}}\]
<p>The ground sample distance is the pixel size scaled by height over focal length: 8 µm pixels behind a 13.3 m focal length at 617 km cover 37 cm. To keep diffraction from blurring away detail of that size, the mirror must be at least \(1.22 \times 0.55\,\mu\text{m} \times 617\,\text{km}/0.37\,\text{m} \approx 1.1\) m wide. Halving the GSD from the same orbit doubles both the focal length and the mirror, and the satellite's mass grows faster still.</p>`,
    String.raw`These are nadir values; looking sideways stretches the GSD by the slant range and the tilt of the ground. The atmosphere adds haze that lowers contrast, the satellite's pointing jitter adds blur, and the time per line is set by the ground speed, so faint scenes need TDI or a slower scan.`));

  root.append(theory('From orbit to pixels', String.raw`
<div class="theory-cols"><div>
<h3>Orbit and scan</h3>
<p>A circular orbit at height \(H\) has speed \(v = \sqrt{GM/(R_\oplus + H)}\), and the point below the satellite moves at \(v_g = v R_\oplus/(R_\oplus + H)\), about 7 km/s in low orbit (Earth's rotation, up to 0.46 km/s, is neglected). A push-broom camera images one line across track and lets the motion sweep it along: the line rate is \(v_g/\text{GSD}\), and each line integrates for \(t = \text{GSD}/v_g\). The 3-D view draws this at true scale: the swath is the line of pixels projected to the ground, \(N_\text{pix}\,\text{GSD}\) wide (4.5 km for the very-high-resolution satellite, 118 km for the mapping one), and the strip behind it grows by \(v_g\) every second, about 400 km a minute. Seen from 600–800 km the swath spans only 0.4° to 9°, which is why a very sharp satellite sees a given place rarely unless it can point sideways.</p>
<h3>Time-delay integration</h3>
<p>A TDI sensor shifts its charge from row to row in step with the image's motion, so \(N\) rows expose the same ground line one after another and the signal grows \(N\) times. Shot noise grows as \(\sqrt N\) and read noise is added once per stage here (2 e⁻), so the SNR improves almost as \(\sqrt N\).</p>
<h3>Signal</h3>
<p>Sunlight in a 100 nm band around 550 nm (1.5 W m⁻² nm⁻¹ at the top of the atmosphere) falls on Lambertian ground of reflectance \(\rho\) at elevation \(e\); the radiance at the satellite is \(\rho E\sin e\,T/\pi\) with a two-way atmospheric transmission \(T = 0.75\). The pixel collects it through the aperture area \(\pi D^2/4\) and its solid angle \((\text{GSD}/H)^2\), with throughput × quantum efficiency 0.4.</p>
</div><div>
<h3>Image quality</h3>
<p>The optics are a diffraction-limited circular aperture with cut-off \(\nu_c = D/(\lambda f)\) on the detector and MTF \(\tfrac{2}{\pi}[\arccos s - s\sqrt{1-s^2}]\), \(s = \nu/\nu_c\). The pixel aperture and the motion during one line are each a box one pixel wide, with MTF \(|\mathrm{sinc}(\nu p)|\); at Nyquist each is 0.64. \(Q = \lambda f/(Dp)\) compares the two: at \(Q = 2\) the detector samples the optics fully, while real systems choose \(Q \approx 1\) for better signal and contrast at Nyquist.</p>
<h3>The rendered block</h3>
<p>An 80 × 56 m city block at 10 cm resolution (lane markings 15 cm wide, cars 4.5 × 1.8 m) is blurred by a Gaussian matched to the Airy core projected on the ground, integrated over each pixel and one pixel of along-track motion, sampled at the GSD, and given photon and read noise for the computed signal.</p>
<div class="callout">Not modelled: atmospheric haze and adjacency effects, which lower contrast further, pointing jitter, off-nadir viewing, and image processing such as sharpening and pan-sharpening, which make commercial products look crisper than the raw MTF.</div>
</div></div>`));
  root.append(references([
    'G. C. Holst, <i>Electro-Optical Imaging System Performance</i>, 5th ed., SPIE Press (2008): MTF, Q and sampling.',
    'R. D. Fiete, "Image quality and λFN/p for remote sensing systems", Optical Engineering 38, 1229 (1999).',
    'J. R. Schott, <i>Remote Sensing: The Image Chain Approach</i>, 2nd ed., Oxford University Press (2007).',
    'W. J. Larson and J. R. Wertz (eds.), <i>Space Mission Analysis and Design</i>, 3rd ed., Microcosm (1999): orbits and ground speed.',
  ]));
  return () => [view, mtf, v3].forEach((s) => s.destroy());
}
