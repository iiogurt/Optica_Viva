import { h, controls, stage, readouts, imageCanvas, texNum, setControl } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { xyzToLinearRGB, oetf } from '../lib/color.js';
import { parallel, poolSize } from '../lib/compute.js';
import { GLASSES, index, abbe } from '../lib/glass.js';
import { prismDeviation } from '../lib/bench.js';
import { benchScene } from '../lib/bench3d.js';
import { view3d } from '../lib/gl3d.js';
import { t, N_ } from '../lib/i18n.js';

const NY = 120, NZ = 90, PASSES = 8, RAYS = 60000, D2R = Math.PI / 180;
const BEAM = { prism: 0.08, lens: 0.5, ball: 0.5 };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>White light is a mixture of all colours. Glass slows each colour down by a slightly different amount, violet the most and red the least. So when light enters glass at a slant, each colour bends by a different angle, and a prism fans white light out into a rainbow on the wall.</p>
<p>The same thing happens, more quietly, in every lens: blue light comes to a focus a little closer than red, which is why cheap lenses show coloured fringes. Here every speck of light is traced through the glass one colour at a time, and the screen shows where they land.</p>`, [
    'With the <strong>Prism</strong>, switch the glass from <strong>N-BK7</strong> to <strong>N-SF11</strong>: does the rainbow get wider or narrower? Predict, then check.',
    'Turn the prism with <strong>Prism rotation</strong>: the bend is smallest at one angle, and the colours there are sharpest.',
    'Choose the <strong>Glass ball</strong> and move the <strong>Screen distance</strong> through the focus: a bright ring with coloured edges appears.',
  ]));
  const glasses = Object.keys(GLASSES).filter((g) => !['SK16'].includes(g));
  const ctl = controls({
    scene: { type: 'seg', label: 'On the bench', value: 'prism', options: [['prism', 'Prism'], ['lens', 'Lens'], ['ball', 'Glass ball']] },
    glass: { type: 'select', label: 'Glass', value: 'N-SF11', options: glasses.map((g) => [g, g]) },
    rot: { type: 'range', label: 'Prism rotation', min: -45, max: 10, step: 0.5, value: -30, unit: '°', when: (st) => st.scene === 'prism' },
    dist: { type: 'range', label: 'Screen distance', min: 0.1, max: 3, step: 0.01, value: 2 },
    exposure: { type: 'range', label: 'Exposure', min: -3, max: 3, step: 0.1, value: 0, unit: 'EV' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const note = h('p.note', { role: 'status' }, '');
  const v3 = view3d({ label: '3-D: the bench, with rays of five colours and the screen painted by the traced light', aspect: 1.7, minH: 300, yaw: -0.55, pitch: 0.42 });
  const scr = stage({ aspect: NZ / NY * 1.0, label: 'The screen, seen from the front', draw: drawScreen, minH: 220 });
  root.append(lab([v3.el, note, h('div.grid-2', {}, scr.el, h('div'))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let acc = null, ticket = 0, rays = 0, keepCam = false, img = imageCanvas(NZ, NY);
  const params = () => { const st = ctl.state; return { kind: st.scene, p: { rot: st.rot }, glass: st.glass, dist: st.dist, ny: NY, nz: NZ, rb: BEAM[st.scene] }; };
  async function run() {
    const my = ++ticket, nw = poolSize(), P = params();
    acc = { X: new Float64Array(NY * NZ), Y: new Float64Array(NY * NZ), Z: new Float64Array(NY * NZ) }; rays = 0;
    show(P);
    for (let pass = 0; pass < PASSES; pass++) {
      const parts = await parallel('benchRays', Array.from({ length: nw }, (_, i) => ({ ...P, rays: RAYS, seed: 1 + i + pass * 32 + my * 1024 })));
      if (my !== ticket) return;
      for (const q of parts) for (let k = 0; k < NY * NZ; k++) { acc.X[k] += q.X[k]; acc.Y[k] += q.Y[k]; acc.Z[k] += q.Z[k]; }
      rays += RAYS * nw;
      show(P);
      note.textContent = pass < PASSES - 1 ? t('Tracing photons through the glass: {n} so far…', { n: rays }) : t('{n} photons traced, one wavelength each.', { n: rays });
    }
  }
  function gain() { const ys = Array.from(acc.Y).filter((v) => v > 0).sort((a, b) => a - b); return ys.length ? (0.85 * 2 ** ctl.state.exposure) / ys[Math.floor(ys.length * 0.995)] : 1; }
  function show(P) {
    const g = gain();
    v3.setScene(benchScene({ ...P, img: acc, gain: g }), keepCam); keepCam = true;
    for (let k = 0; k < NY * NZ; k++) { const rgb = xyzToLinearRGB([acc.X[k] * g, acc.Y[k] * g, acc.Z[k] * g]); for (let c = 0; c < 3; c++) img.data[k * 4 + c] = 255 * oetf(Math.min(1, Math.max(0, rgb[c]) + 0.04)); img.data[k * 4 + 3] = 255; }
    img.put(); scr.redraw();
  }
  function drawScreen(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const sc = Math.min(w / NZ, hh / NY);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img.c, (w - NZ * sc) / 2, (hh - NY * sc) / 2, NZ * sc, NY * sc);
  }

  let lastKey = '', lastScene = ctl.state.scene;
  function update() {
    // a new scene starts with the screen at a useful distance: behind the prism, or near the focus
    if (ctl.state.scene !== lastScene) { lastScene = ctl.state.scene; setControl('dist', { prism: 2, lens: 1.35, ball: 0.3 }[lastScene]); return; }
    const st = ctl.state, nF = index(st.glass, 486.13), nd = index(st.glass, 587.56), nC = index(st.glass, 656.27), V = abbe(st.glass);
    const rows = [[N_('n at F / d / C (486 / 588 / 656 nm)'), `${nF.toFixed(4)} / ${nd.toFixed(4)} / ${nC.toFixed(4)}`], [N_('Abbe number V_d'), V.toFixed(1)]];
    let say, tex;
    if (st.scene === 'prism') {
      const i = (30 - st.rot) * D2R, dF = prismDeviation(60 * D2R, nF, i), dC = prismDeviation(60 * D2R, nC, i), dd = prismDeviation(60 * D2R, nd, i);
      rows.push([N_('Angle of incidence'), ((i / D2R)).toFixed(1) + '°'], [N_('Deviation at F / d / C'), isFinite(dF) && isFinite(dC) ? `${(dF / D2R).toFixed(2)}° / ${(dd / D2R).toFixed(2)}° / ${(dC / D2R).toFixed(2)}°` : t('total internal reflection')]);
      say = isFinite(dF) && isFinite(dC)
        ? t('Light meets the {g} prism at {i}°: yellow is bent by <strong>{d}°</strong>, blue (F) {s}° more than red (C), so the spectrum fans out over {s}°.', { g: st.glass, i: (i / D2R).toFixed(1), d: (dd / D2R).toFixed(2), s: ((dF - dC) / D2R).toFixed(2) })
        : t('At this angle the light is totally reflected inside the {g} prism: turn the prism so the beam meets the face more obliquely.', { g: st.glass });
      tex = String.raw`D &= i + \arcsin\!\big(n\sin(A - r_1)\big) - A\\ r_1 &= \arcsin(\sin i / n)\\ D_d &= ${isFinite(dd) ? texNum(dd / D2R, 4) + '^\\circ' : '\\text{TIR}'}`;
    } else {
      const R = st.scene === 'ball' ? 0.6 : 1.6, fd = st.scene === 'ball' ? (nd * R) / (2 * (nd - 1)) : 1 / ((nd - 1) * (2 / R - ((nd - 1) * 0.36) / (nd * R * R)));
      const fF = st.scene === 'ball' ? (nF * R) / (2 * (nF - 1)) : 1 / ((nF - 1) * (2 / R - ((nF - 1) * 0.36) / (nF * R * R)));
      const fC = st.scene === 'ball' ? (nC * R) / (2 * (nC - 1)) : 1 / ((nC - 1) * (2 / R - ((nC - 1) * 0.36) / (nC * R * R)));
      rows.push([N_('Paraxial focal length f_d'), fd.toFixed(3)], [N_('Focal shift f_C − f_F'), (fC - fF).toFixed(4)]);
      say = t('Near the axis the {g} {what} focuses yellow light <strong>{f}</strong> units from its centre; red comes to focus {df} further out than blue, and rays far from the axis focus closer still (spherical aberration).', { g: st.glass, what: st.scene === 'ball' ? t('ball') : t('lens'), f: fd.toFixed(3), df: (fC - fF).toFixed(4) });
      tex = st.scene === 'ball' ? String.raw`f &= \frac{nR}{2(n-1)} = ${texNum(fd, 4)}` : String.raw`\frac1f &= (n-1)\left(\frac2R - \frac{(n-1)d}{nR^2}\right)\\ f &= ${texNum(fd, 4)}`;
    }
    ro.replaceChildren(readouts(rows));
    calc.say(say);
    calc.set(String.raw`\begin{aligned} n^2 &= 1 + \textstyle\sum_k \frac{B_k\lambda^2}{\lambda^2 - C_k}\\ V_d &= \frac{n_d - 1}{n_F - n_C} = ${texNum(V, 3)}\\ ${tex} \end{aligned}`);
    const key = JSON.stringify(params());
    if (key !== lastKey) { if (JSON.parse(lastKey || '{}').kind !== st.scene) keepCam = false; lastKey = key; run().catch(console.error); }
    else if (acc) show(params());
  }
  update();

  root.append(rule(String.raw`\[D_\text{min} = 2\arcsin\!\left(n\sin\tfrac{A}{2}\right) - A\]
<p>A prism of apex angle \(A\) bends light least when the ray passes through it symmetrically. For a 60° prism of N-BK7 (\(n_d = 1.517\)) that is 38.7°; blue light at the F line (\(n_F = 1.522\)) is bent about 0.6° more than red at the C line, so a beam 2 m away spreads into a spectrum about 2 cm wide.</p>`,
    String.raw`Ray optics: valid while the glass is much larger than the wavelength. The colours separate because \(n\) changes with \(\lambda\) (the Sellmeier formula holds between the glass's absorption bands, roughly 0.3–2 µm); the beam's width blurs the spectrum, and a real prism also reflects 4–10 % at each face.`));
  root.append(theory('Dispersion, traced photon by photon', String.raw`
<div class="theory-cols"><div>
<h3>Glass and colour</h3>
<p>A glass's refractive index follows the Sellmeier formula \(n^2 = 1 + \sum_k B_k\lambda^2/(\lambda^2 - C_k)\), with three resonances fitted by the manufacturer (the coefficients here are SCHOTT's and Malitson's). Violet is slowed most. Crown glasses (N-BK7, \(V_d\) = 64) disperse little, dense flints (N-SF11, \(V_d\) = 25.7) much more, which is why spectrographs used flint prisms.</p>
<h3>The forward photon tracer</h3>
<p>Each photon gets one wavelength, drawn uniformly between 400 and 700 nm, and a starting point across a round white beam. It is traced exactly through the glass: the shapes are convex intersections of half-spaces, spheres and a cylinder, so one routine finds where a ray enters and leaves. At every surface Snell's law refracts it with the index for its wavelength; the unpolarised Fresnel reflectance decides at random between reflection and transmission (Russian roulette, so energy is conserved on average), and total internal reflection happens where it must. Where the photon meets the screen, its colour-matching values \(\bar x, \bar y, \bar z\) are added to that cell. Hundreds of thousands of photons per pass build up the caustic, and the screen is shown in sRGB.</p>
</div><div>
<h3>What to look for</h3>
<p><b>Prism.</b> The spectrum is narrowest and brightest near minimum deviation; a flint fans it out three times as far as a crown. <b>Lens.</b> A biconvex N-BK7 lens focuses blue in front of red (longitudinal chromatic aberration); rays far from the axis cross early (spherical aberration), so the focus is a caustic, not a point. <b>Glass ball.</b> A ball lens has strong spherical aberration: its marginal rays focus far inside the paraxial focus \(f = nR/(2(n-1))\), and the screen shows the bright caustic ring.</p>
<h3>Checks and limits</h3>
<p>The tests trace single rays and compare the prism's deviation with \(D = i + \arcsin(n\sin(A - r_1)) - A\) (to 10⁻⁴°) and the ball's paraxial focus with \(nR/(2(n-1))\). Not modelled: the absorption of the glass, polarisation-dependent colours, diffraction at the beam's edge and the screen's own scattering; the beam is perfectly collimated.</p>
</div></div>`));
  root.append(references([
    'W. Sellmeier, "Zur Erklärung der abnormen Farbenfolge im Spectrum einiger Substanzen", Ann. Phys. 219, 272 (1871).',
    'SCHOTT AG, <i>Optical Glass – Data Sheets</i> (2023); I. H. Malitson, "Interspecimen comparison of the refractive index of fused silica", JOSA 55, 1205 (1965).',
    'M. Pharr, W. Jakob &amp; G. Humphreys, <i>Physically Based Rendering</i>, 4th ed., MIT Press (2023), ch. 14 (light transport, spectral rendering).',
    'E. Hecht, <i>Optics</i>, 5th ed., Pearson (2017), ch. 5.',
  ]));
  return () => { ticket++; [v3, scr].forEach((s) => s.destroy()); };
}
