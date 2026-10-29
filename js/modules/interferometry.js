import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { lut } from '../lib/color.js';
import { view3d } from '../lib/gl3d.js';
import { interfScene } from '../lib/interf3d.js';
import { MAS, diskVisibility, firstNull, fringes, fringeVisibility, ARRAYS } from '../lib/interferometry.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno'), DIV = lut('diverging');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A telescope's sharpness grows with its width, but mirrors cannot be made arbitrarily large. Two small telescopes far apart can instead combine their light: the waves from both interfere and make stripes of light and dark called <strong>fringes</strong>. How clear the stripes are reveals the size of the source, down to details that only a single telescope as wide as their separation could see.</p>
<p>A point-like star gives crisp fringes; a slightly larger star blurs them. In 1920 this gave the first measured size of a star other than the Sun. Today radio dishes spread across the Earth act together as one Earth-sized telescope.</p>`, [
    "Increase the <strong>Baseline</strong> until the fringes vanish at about 3 m: that is how Betelgeuse was measured.",
    "Make the star smaller: the fringes stay clear up to longer baselines.",
    "In the array section below, shorten the <strong>Observing time</strong>: fewer tracks fill the u-v plane and the image gets worse.",
  ]));

  // ── Michelson stellar interferometer ──
  const ctl = controls({
    theta: { type: 'range', label: 'Angular diameter of the star', min: 1, max: 100, log: true, value: 47, unit: 'mas' },
    B: { type: 'range', label: 'Baseline between the mirrors (Betelgeuse: fringes vanish at 3.07 m)', min: 0.1, max: 20, log: true, value: 2, unit: 'm' },
    lam: { type: 'range', label: 'Wavelength', min: 400, max: 2200, log: true, value: 575, unit: 'nm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const fr = stage({ aspect: 2.3, label: '', draw: drawFringes, cls: 'plain', minH: 200 });
  const vis = stage({ aspect: 2.3, label: '', draw: drawVis, cls: 'plain', minH: 200 });
  root.append(lab([h('div.card', { style: { padding: '6px' } }, fr.el), h('div.card', { style: { padding: '6px' } }, vis.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));
  let F = null;
  function update() {
    const st = ctl.state, th = st.theta * MAS, lam = st.lam * 1e-9, xs = Array.from({ length: 600 }, (_, i) => (i / 599 - 0.5) * 8 * lam / st.B);
    const I = fringes(st.B, lam, th, xs), Vsim = fringeVisibility(I), V = diskVisibility(th, st.B, lam), B0 = firstNull(th, lam);
    F = { st, xs, I, th, lam, B0 };
    ro.replaceChildren(readouts([
      ['Fringe spacing λ/B', ((lam / st.B) / MAS).toFixed(1) + ' mas'],
      ['Visibility (simulated fringes)', Vsim.toFixed(3)],
      ['Visibility |2J₁(x)/x|', V.toFixed(3)],
      ['First null of the visibility', B0.toFixed(2) + ' m'],
      ['A single telescope resolves (1.22 λ/D) with D = B', ((1.22 * lam / st.B) / MAS).toFixed(1) + ' mas'],
    ]));
    calc.say(t('The fringes have a visibility of <strong>{V}</strong> (1 would be a point source); they first vanish at a baseline of <strong>{B0} m</strong>.', { V: V.toFixed(2), B0: B0.toFixed(2) }));
    calc.set(String.raw`\begin{aligned}
    V(B) &= \left|\frac{2J_1(\pi\theta B/\lambda)}{\pi\theta B/\lambda}\right| = ${texNum(V, 3)}\\
    B_0 &= 1.22\,\frac{\lambda}{\theta} = ${texNum(B0, 3)}\ \text{m}
    \end{aligned}`);
    [fr, vis].forEach((x) => x.redraw());
  }
  function drawFringes(ctx, w, hh) {
    if (!F) return;
    plot(ctx, w, hh, {
      title: 'Fringes of the star (both beams combined)', x: { min: F.xs[0] / MAS, max: F.xs[F.xs.length - 1] / MAS, label: 'angle on the sky (mas)' }, y: { min: 0, max: 2.1, label: 'intensity' },
      series: [{ data: F.xs.map((x, i) => [x / MAS, 1 + Math.cos((2 * Math.PI * F.st.B * x) / F.lam)]), color: 'rgba(255,255,255,0.3)', width: 1, dash: [4, 3], label: 'point source' }, { data: F.xs.map((x, i) => [x / MAS, F.I[i]]), color: '#ffb547', width: 2, label: t('{d} mas disk', { d: F.st.theta }) }],
      legend: true, legendX: w - 170, legendY: 34,
    });
  }
  function drawVis(ctx, w, hh) {
    if (!F) return;
    const Bs = Array.from({ length: 300 }, (_, i) => 0.05 + (i / 299) * Math.max(3 * F.B0, 1.2 * F.st.B));
    plot(ctx, w, hh, {
      title: 'Visibility vs baseline (van Cittert–Zernike)', x: { min: 0, max: Bs[Bs.length - 1], label: 'baseline (m)' }, y: { min: 0, max: 1.05, label: 'fringe visibility' },
      series: [{ data: Bs.map((B) => [B, diskVisibility(F.th, B, F.lam)]), color: '#6ad7ff', width: 2 }],
      vlines: [{ x: F.st.B, color: 'rgba(255,255,255,0.45)', label: 'baseline' }, { x: F.B0, color: 'rgba(255,181,71,0.6)', label: 'first null', dy: 14 }],
    });
  }

  // ── aperture synthesis ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Aperture synthesis: from u-v coverage to an image'));
  const actl = controls({
    array: { type: 'select', label: 'Array', value: 'eht', options: Object.entries(ARRAYS).map(([k, a]) => [k, a.name]) },
    dec: { type: 'range', label: 'Declination of the source', min: -80, max: 80, step: 1, value: 12, unit: '°' },
    hours: { type: 'range', label: 'Observing time (Earth rotation)', min: 0.2, max: 24, log: true, value: 12, unit: 'h' },
    sky: { type: 'seg', label: 'Source', value: 'ring', options: [['ring', 'Black-hole ring'], ['binary', 'Binary'], ['jet', 'Core + jet'], ['disk', 'Disk']] },
    scale: { type: 'range', label: 'Source size', min: 1, max: 20, log: true, value: 8, fmt: (v) => v.toPrecision(2) + ' × λ/B_max' },
    natural: { type: 'toggle', label: 'Natural weighting (else uniform)', value: false },
    niter: { type: 'range', label: 'CLEAN iterations', min: 0, max: 1000, step: 10, value: 300 },
    H: { type: 'range', label: 'Moment shown in 3-D (hour angle)', min: -12, max: 12, step: 0.1, value: 0, unit: 'h' },
  }, () => updA());
  const aro = h('div');
  const uv = stage({ aspect: 1, label: 'u-v coverage (each baseline traces an ellipse as the Earth turns)', draw: drawUV, minH: 220 });
  const beam = stage({ aspect: 1, label: 'Dirty beam (point-spread function of the array)', draw: (c, w, hh) => drawMap(c, w, hh, 'beam', true), minH: 220 });
  const skyV = stage({ aspect: 1, label: 'True sky', draw: (c, w, hh) => drawMap(c, w, hh, 'sky'), minH: 200 });
  const dirty = stage({ aspect: 1, label: 'Dirty image (sky ⊗ dirty beam)', draw: (c, w, hh) => drawMap(c, w, hh, 'dirty', true), minH: 200 });
  const rest = stage({ aspect: 1, label: 'After Högbom CLEAN, restored', draw: (c, w, hh) => drawMap(c, w, hh, 'restored'), minH: 200 });
  const v3 = view3d({ label: '3-D: the Earth turns under the source, and each baseline, as the source sees it, traces its track in the u-v plane', aspect: 1.7, minH: 280, yaw: 0.75, pitch: 0.35 });
  sec2.append(lab([h('div.grid-2', {}, uv.el, beam.el), v3.el, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' } }, skyV.el, dirty.el, rest.el)], [h('div.card', {}, actl.el), h('div.card', {}, aro)]));
  root.append(sec2);
  const job = latest('aperture');
  let A = null, lastArr = actl.state.array;
  // the 3-D view follows every control; the imaging pipeline only the ones it uses
  let jobKey = '', view3dFor = '';
  function updA() {
    const st = actl.state;
    if (st.array !== lastArr) { lastArr = st.array; actl.set.dec(ARRAYS[st.array].dec); }
    const geom = [st.array, actl.state.dec, st.hours].join();
    v3.setScene(interfScene({ array: st.array, dec: actl.state.dec, hours: st.hours, H: st.H }), view3dFor === st.array);
    view3dFor = st.array;
    const key = JSON.stringify([geom, st.sky, st.scale, st.natural, st.niter]);
    if (key === jobKey) return;
    jobKey = key;
    job('aperture', { array: st.array, dec: actl.state.dec, hours: st.hours, sky: st.sky, scale: st.scale, natural: st.natural, niter: st.niter, N: 128 }).then((r) => {
      A = { st: { ...st }, ...r };
      const arr = ARRAYS[st.array], unit = r.res / MAS >= 1000 ? [1000 * MAS, 'arcsec'] : r.res / MAS >= 1 ? [MAS, 'mas'] : [MAS / 1000, 'µas'];
      aro.replaceChildren(readouts([
        ['Wavelength', arr.lam >= 1e-3 ? (arr.lam * 1000).toFixed(1) + ' mm' : (arr.lam * 1e6).toFixed(2) + ' µm'],
        ['Longest projected baseline', (r.bmax * arr.lam / 1000).toFixed(r.bmax * arr.lam > 1e5 ? 0 : 2) + ' km'],
        ['Resolution λ/B_max', (r.res / unit[0]).toPrecision(3) + ' ' + unit[1]],
        ['u-v samples', String(r.uv.length)],
        ['CLEAN components', String(r.ncomp)],
      ]));
      [uv, beam, skyV, dirty, rest].forEach((x) => x.redraw());
    });
  }
  function drawUV(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!A) return;
    const sc = (Math.min(w, hh) / 2 - 12) / (A.bmax * 1.05), cx = w / 2, cy = hh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(cx, 6); ctx.lineTo(cx, hh - 6); ctx.moveTo(6, cy); ctx.lineTo(w - 6, cy); ctx.stroke();
    ctx.fillStyle = '#ffb547';
    for (const [u, v] of A.uv) ctx.fillRect(cx + u * sc - 0.8, cy - v * sc - 0.8, 1.6, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(`u, v up to ${A.bmax.toExponential(1)} λ`, 8, hh - 8);
  }
  function drawMap(ctx, w, hh, key, signed = false) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!A) return;
    const N = A.N, a = A[key], ic = imageCanvas(N, N);
    let mx = 1e-12, mn = 0; for (const v of a) { if (v > mx) mx = v; if (v < mn) mn = v; }
    for (let k = 0; k < N * N; k++) {
      const o = k * 4;
      if (signed) { const t = Math.round((Math.max(-1, Math.min(1, a[k] / mx)) * 0.5 + 0.5) * 255) * 3; ic.data[o] = DIV[t]; ic.data[o + 1] = DIV[t + 1]; ic.data[o + 2] = DIV[t + 2]; }
      else { const t = Math.round(255 * Math.max(0, Math.min(1, a[k] / mx))) * 3; ic.data[o] = INF[t]; ic.data[o + 1] = INF[t + 1]; ic.data[o + 2] = INF[t + 2]; }
      ic.data[o + 3] = 255;
    }
    ic.put();
    const sz = Math.min(w, hh) - 4; ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, (w - sz) / 2, (hh - sz) / 2, sz, sz);
  }

  update(); updA();

  root.append(rule(String.raw`\[B_0 = 1.22\,\frac{\lambda}{\theta}\]
<p>The fringes of a uniform disc of angular diameter \(\theta\) first disappear at the baseline \(B_0\). Michelson and Pease saw Betelgeuse's fringes vanish at 3.07 m in yellow light (575 nm), so \(\theta \approx 1.22 \times 575\,\text{nm}/3.07\,\text{m} = 0.047''\): the first diameter of a star after the Sun's. The Event Horizon Telescope combines dishes up to 10 000 km apart at 1.3 mm, for a resolution of about \(\lambda/B \approx 27\) microarcseconds.</p>`,
    String.raw`The formula assumes a uniformly bright disc; limb darkening and spots shift the null. Measuring fringes needs the light paths matched to a fraction of a wavelength, and turbulence scrambles the fringe position, so optical interferometers rely on fringe contrast and closure phases.`));
  root.append(theory('Seeing with separated telescopes', String.raw`
<div class="theory-cols"><div>
<h3>Fringes and visibility</h3>
<p>Light from a star reaching two apertures a baseline \(B\) apart interferes with fringes of angular period \(\lambda/B\). Every point of an extended source makes its own fringe pattern, shifted by its position. The patterns add incoherently, so the fringe contrast, the <em>visibility</em>, falls as the source grows. The van Cittert–Zernike theorem makes this exact: the complex visibility is the Fourier transform of the source's brightness distribution at spatial frequency \(\mathbf u = \mathbf B/\lambda\). For a uniform disk of diameter \(\theta\),</p>
\[V(B) = \left|\frac{2J_1(\pi\theta B/\lambda)}{\pi\theta B/\lambda}\right|,\]
<p>which first vanishes at \(B_0 = 1.22\,\lambda/\theta\). Michelson and Pease saw the fringes on Betelgeuse disappear at \(B = 3.07\) m (575 nm) in December 1920, giving 47 mas, the first measured diameter of a star. The fringe plot here is the numerical sum over the disk, and it reproduces the formula exactly.</p>
<h3>Earth-rotation synthesis</h3>
<p>Each pair of antennas samples one point \((u, v)\) of the source's Fourier transform. As the Earth turns, the projected baseline sweeps an ellipse through the \(u\)-\(v\) plane:</p>
\[u = \frac{X\sin H + Y\cos H}{\lambda},\qquad v = \frac{-X\sin\delta\cos H + Y\sin\delta\sin H + Z\cos\delta}{\lambda},\]
<p>with \((X, Y, Z)\) the baseline in equatorial coordinates, \(H\) the hour angle and \(\delta\) the declination. Stations count only while both see the source above 15° elevation. For the EHT this limits each baseline to a few hours of a day.</p>
<p>The 3-D view shows where the formula comes from. Turn the Earth by \(H\) under a fixed sky in which the source lies along \(\hat s = (\cos\delta, 0, \sin\delta)\). The \(u\)-\(v\) plane is the plane perpendicular to \(\hat s\), with \(\hat u = (0, 1, 0)\) pointing east and \(\hat v = (-\sin\delta, 0, \cos\delta)\) towards the pole. Then \(u = \mathbf b\cdot\hat u/\lambda\) and \(v = \mathbf b\cdot\hat v/\lambda\) are the baseline as the source sees it: the separation of the two stations' shadows on that plane. A source at the pole sees every baseline turn as a circle. One on the equator sees east–west baselines shrink to lines. A station counts while \(\hat n\cdot\hat s > \sin 15^\circ\), with \(\hat n\) its local vertical, using the same hour angle as the projection.</p>
</div><div>
<h3>Dirty images and CLEAN</h3>
<p>Inverting the sampled visibilities gives the <em>dirty image</em>: the true sky convolved with the <em>dirty beam</em>, the Fourier transform of the sampling pattern. Sparse coverage makes the beam's sidelobes strong. Uniform weighting gives every sampled cell equal weight and sharpens the beam; natural weighting maximises sensitivity. Högbom's CLEAN (1974) assumes the sky is a set of point sources. It repeatedly finds the residual peak, subtracts a fraction (gain 0.1) of the beam there, records the component, and finally restores the components with a clean Gaussian beam. It is the simplest of the deconvolution methods; the EHT used regularised maximum-likelihood imaging as well.</p>
<p>The resolution is \(\lambda/B_\text{max}\). At 1.3 mm on baselines of up to 10 000 km that is 25 µas, enough to resolve the 42 µas ring around M87*. The sky here is gridded on 128² cells. Visibilities are noise-free and perfectly calibrated (no atmospheric phase, no closure quantities), which real data never are.</p>
</div></div>`));
  root.append(references([
    'A. A. Michelson &amp; F. G. Pease, “Measurement of the diameter of α Orionis with the interferometer”, <em>Astrophys. J.</em> 53, 249 (1921).',
    'A. R. Thompson, J. M. Moran &amp; G. W. Swenson, <em>Interferometry and Synthesis in Radio Astronomy</em>, 3rd ed., Springer (2017).',
    'J. A. Högbom, “Aperture synthesis with a non-regular distribution of interferometer baselines”, <em>Astron. Astrophys. Suppl.</em> 15, 417 (1974).',
    'Event Horizon Telescope Collaboration, “First M87 Event Horizon Telescope results. I–IV”, <em>Astrophys. J. Lett.</em> 875 (2019).',
  ]));

  return () => [fr, vis, uv, beam, skyV, dirty, rest, v3].forEach((x) => x.destroy());
}
