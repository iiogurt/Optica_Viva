import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { xyzToLinearRGB, oetf } from '../lib/color.js';
import { parallel, poolSize } from '../lib/compute.js';
import { nIce, nWater, minDeviation, rainbowAngle, parhelion, circumzenithal, skyDir, HALO_FOV, DROP_LAMS, coronaAngles, antiAngles, CORONA_STEP, ANTI_STEP, CORONA_MAX, ANTI_MAX, sunSmear, profileXYZ } from '../lib/atmo.js';
import { view3d } from '../lib/gl3d.js';
import { haloScene } from '../lib/halo3d.js';
import { t, N_ } from '../lib/i18n.js';

const D2R = Math.PI / 180, N = 300;
// crystal populations: fractions of randomly oriented crystals, horizontal plates and horizontal columns
const CLOUDS = {
  random: { random: 1, plate: 0, column: 0 },
  plates: { random: 0.15, plate: 0.85, column: 0 },
  columns: { random: 0.15, plate: 0, column: 0.85 },
  cirrus: { random: 0.5, plate: 0.3, column: 0.2 },
};
const PASSES = 6, RAYS = 120000; // rays per worker per pass

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo'] }));
  root.append(idea(String.raw`<p>Rings and bright spots around the Sun or Moon are made by tiny ice crystals high in the sky. Each crystal is a little six-sided glass prism. Light passing through two of its sides is bent by at least 22 degrees, never less, so the light piles up into a bright ring of exactly that size.</p>
<p>Water drops do something different. Big raindrops send light back towards you at about 42 degrees from the point opposite the Sun: the rainbow. Tiny cloud droplets are so small that light behaves as a wave around them, and they make coloured rings instead: a corona around the Sun and a glory around your own shadow.</p>`, [
    'Choose <strong>Horizontal plates</strong> and raise the <strong>Sun elevation</strong> from 5° to 40°: the sundogs move away from the ring, and the arc near the top vanishes above 32°.',
    'Shrink the <strong>Drop radius</strong> from 200 µm to 10 µm: the rainbow fades to a white fogbow while a glory appears around the antisolar point.',
    'Predict, then check: do bigger cloud droplets make a bigger or a smaller corona?',
  ]));

  const ctl = controls({
    hIce: { type: 'heading', label: 'Ice crystals (halos)' },
    cloud: { type: 'select', label: 'Crystals in the cloud', value: 'cirrus', options: [['random', 'Randomly oriented'], ['plates', 'Horizontal plates'], ['columns', 'Horizontal columns'], ['cirrus', 'Mixed cirrostratus']] },
    elev: { type: 'range', label: 'Sun elevation', min: 0, max: 60, step: 1, value: 20, unit: '°' },
    tilt: { type: 'range', label: 'Wobble of oriented crystals', min: 0.1, max: 10, step: 0.1, value: 0.7, unit: '°', log: true },
    exposure: { type: 'range', label: 'Halo exposure', min: -3, max: 3, step: 0.1, value: 0, unit: 'EV' },
    hDrop: { type: 'heading', label: 'Water drops (rainbows, glories, coronas)' },
    a: { type: 'range', label: 'Drop radius', min: 1, max: 300, step: 0.1, value: 150, unit: 'µm', log: true },
    w: { type: 'range', label: 'Spread of drop sizes', min: 0, max: 20, step: 1, value: 5, unit: '%' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const note = h('p.note', {}, '');
  const sky = stage({ aspect: 1, label: 'Halos: the sky around the Sun (zenith up, ±66°)', draw: drawHalo, minH: 260 });
  const cor = stage({ aspect: 1, label: 'Around the Sun: the corona of the drops', draw: (c, w, hh) => drawDrop(c, w, hh, 'corona'), minH: 220 });
  const anti = stage({ aspect: 1, label: 'Around your shadow: glory, fogbow and rainbows (±60°)', draw: (c, w, hh) => drawDrop(c, w, hh, 'anti'), minH: 220 });
  const prof = stage({ aspect: 2.1, label: 'Scattered light around the antisolar point', draw: drawProfile, minH: 200 });
  const v3 = view3d({ label: '3-D: an ice crystal and the exact ray paths of the 22° and 46° halos and the circumzenithal arc', aspect: 1.7, minH: 260, yaw: -0.7, pitch: 0.35 });
  root.append(lab([sky.el, note, v3.el, h('div.grid-2', {}, cor.el, anti.el), prof.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ── halos: progressive Monte-Carlo passes on all workers ──
  let acc = null, haloTicket = 0, haloCanvas = null, haloRays = 0;
  async function runHalo() {
    const my = ++haloTicket, st = ctl.state, nw = poolSize();
    acc = { X: new Float64Array(N * N), Y: new Float64Array(N * N), Z: new Float64Array(N * N) }; haloRays = 0;
    for (let pass = 0; pass < PASSES; pass++) {
      const jobs = Array.from({ length: nw }, (_, i) => ({ N, rays: RAYS, seed: 1 + pass * 64 + i + my * 4096, h: st.elev * D2R, mix: CLOUDS[st.cloud], tilt: st.tilt * D2R }));
      const parts = await parallel('haloRays', jobs);
      if (my !== haloTicket) return;
      for (const p of parts) for (let k = 0; k < N * N; k++) { acc.X[k] += p.X[k]; acc.Y[k] += p.Y[k]; acc.Z[k] += p.Z[k]; }
      haloRays += RAYS * nw;
      paintHalo(); sky.redraw();
      note.textContent = pass < PASSES - 1 ? t('Tracing rays through ice crystals: {n} so far…', { n: haloRays }) : t('{n} rays traced through ice crystals.', { n: haloRays });
    }
  }
  // sky (a simple blue-sky gradient, brighter towards the horizon and the Sun), ground, the halo light
  function paintHalo() {
    const st = ctl.state, h0 = st.elev * D2R, s = [Math.cos(h0), 0, Math.sin(h0)], img = imageCanvas(N, N);
    const ys = [];
    for (let k = 0; k < N * N; k++) { const ix = k % N, iy = (k / N) | 0, x = ((ix + 0.5) / N * 2 - 1) * HALO_FOV, y = (1 - (iy + 0.5) / N * 2) * HALO_FOV; if (Math.hypot(x, y) > 3 && acc.Y[k] > 0) ys.push(acc.Y[k]); }
    ys.sort((p, q) => p - q);
    const ref = ys.length ? ys[Math.floor(ys.length * 0.995)] : 1, gain = (0.9 * 2 ** st.exposure) / ref;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const k = iy * N + ix, x = ((ix + 0.5) / N * 2 - 1) * HALO_FOV, y = (1 - (iy + 0.5) / N * 2) * HALO_FOV, r = Math.hypot(x, y);
      const v = skyDir(x, y, s), o = k * 4;
      let rgb;
      if (v[2] < 0) rgb = [0.035, 0.04, 0.035];
      else {
        const zen = Math.acos(v[2]), glow = 0.25 / (1 + (r / 6) ** 2);
        rgb = [0.05 + 0.06 * zen + glow, 0.09 + 0.08 * zen + glow, 0.22 + 0.1 * zen + glow];
        const hr = xyzToLinearRGB([acc.X[k] * gain, acc.Y[k] * gain, acc.Z[k] * gain]);
        rgb = rgb.map((c, i) => c + Math.max(0, hr[i]) * 0.55);
      }
      if (r < 0.6) rgb = [3, 3, 3];
      for (let i = 0; i < 3; i++) img.data[o + i] = 255 * oetf(Math.min(1, rgb[i]));
      img.data[o + 3] = 255;
    }
    img.put(); haloCanvas = img.c;
  }
  function drawHalo(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!haloCanvas) return;
    const side = Math.min(w, hh), x0 = (w - side) / 2, y0 = (hh - side) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(haloCanvas, x0, y0, side, side);
    const P = (deg) => (deg / HALO_FOV) * (side / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    for (const r of [22, 46]) { ctx.beginPath(); ctx.arc(w / 2, hh / 2, P(r), 0, 2 * Math.PI); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('22°', w / 2 + P(22) * 0.71 + 4, hh / 2 - P(22) * 0.71); ctx.fillText('46°', w / 2 + P(46) * 0.71 + 4, hh / 2 - P(46) * 0.71);
  }

  // ── drops: Mie profiles per wavelength, spread over the workers ──
  let D = null, dropTicket = 0;
  async function runDrops() {
    const my = ++dropTicket, st = ctl.state, nw = poolSize();
    const jobs = Array.from({ length: nw }, (_, i) => ({ lams: DROP_LAMS.map((_, li) => li).filter((li) => li % nw === i), a: st.a, w: st.w / 100 }));
    const parts = (await parallel('dropMie', jobs)).flat();
    if (my !== dropTicket) return;
    const corona = [], antiP = [];
    let qsca = 0;
    for (const p of parts) { corona[p.li] = sunSmear(p.corona, CORONA_STEP); antiP[p.li] = sunSmear(p.anti, ANTI_STEP); qsca += p.qsca / DROP_LAMS.length; }
    D = { cor: profileXYZ(corona), anti: profileXYZ(antiP), qsca };
    // the corona view spans about five rings: the first lies near 1.22λ/(2a)
    D.corMax = Math.min(CORONA_MAX, Math.max(2, (5 * 1.22 * 0.55) / (2 * st.a) / D2R));
    D.corImg = radial(D.cor, D.corMax, CORONA_STEP, 0.35);
    D.antiImg = radial(D.anti, ANTI_MAX, ANTI_STEP, 0);
    const Y = D.anti.Y, th = antiAngles();
    let pk = -1;
    for (let i = 0; i < th.length; i++) if (th[i] > 30 && th[i] < 47 && (pk < 0 || Y[i] > Y[pk])) pk = i;
    D.peak = th[pk];
    cor.redraw(); anti.redraw(); prof.redraw(); words();
  }
  // a radially symmetric image from an XYZ profile; brightness set by the 99th percentile beyond `skip` degrees
  function radial(P, max, step, skip) {
    const n = 220, img = imageCanvas(n, n), ys = [];
    for (let i = 0; i < P.Y.length && i * step <= max; i++) if (i * step > skip) ys.push(P.Y[i]);
    ys.sort((a, b) => a - b);
    const g = 0.85 / (ys[Math.floor(ys.length * 0.99)] || 1);
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
      const r = Math.hypot((ix + 0.5) / n * 2 - 1, (iy + 0.5) / n * 2 - 1) * max, o = (iy * n + ix) * 4;
      const f = r / step, i = Math.min(P.Y.length - 2, Math.floor(f)), u = f - i;
      const xyz = [0, 1, 2].map((c) => { const a = [P.X, P.Y, P.Z][c]; return (a[i] * (1 - u) + a[i + 1] * u) * g; });
      const rgb = r > max ? [0, 0, 0] : xyzToLinearRGB(xyz).map((v, c) => v + [0.03, 0.035, 0.05][c]);
      for (let c = 0; c < 3; c++) img.data[o + c] = 255 * oetf(Math.min(1, Math.max(0, rgb[c])));
      img.data[o + 3] = 255;
    }
    img.put(); return img.c;
  }
  function drawDrop(ctx, w, hh, which) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!D) return;
    const side = Math.min(w, hh), c = which === 'corona' ? D.corImg : D.antiImg;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(c, (w - side) / 2, (hh - side) / 2, side, side);
    if (which === 'corona') {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(w / 2, hh / 2, Math.max(2, (0.27 / D.corMax) * side / 2), 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
      ctx.fillText(t('field ±{r}°', { r: D.corMax < 5 ? D.corMax.toFixed(1) : D.corMax.toFixed(0) }), w - 8, hh - 8);
    }
    else {
      const n = nWater(550), P = (deg) => (deg / ANTI_MAX) * (side / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.setLineDash([3, 4]);
      for (const k of [1, 2]) { ctx.beginPath(); ctx.arc(w / 2, hh / 2, P(rainbowAngle(n, k)), 0, 2 * Math.PI); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.arc(w / 2, hh / 2, Math.max(3, side * 0.012), 0, 7); ctx.fill();
    }
  }
  function drawProfile(ctx, w, hh) {
    if (!D) return;
    const th = antiAngles(), Y = D.anti.Y, ymax = Math.max(...Y.slice(5)), n = nWater(550);
    plot(ctx, w, hh, {
      x: { min: 0, max: ANTI_MAX, label: 'angle from the antisolar point (°)' }, y: { min: ymax * 1e-3, max: ymax * 1.5, log: true, label: 'luminance (relative)' },
      series: [{ data: th.map((a, i) => [a, Math.max(ymax * 1e-3, Y[i])]), color: '#ffb547', width: 1.8, label: 'Mie theory, sunlight' }],
      vlines: [{ x: rainbowAngle(n, 1), color: 'rgba(255,255,255,0.45)', label: 'primary' }, { x: rainbowAngle(n, 2), color: 'rgba(255,255,255,0.3)', label: 'secondary' }],
      legend: true, legendX: 70, legendY: 30, padT: 30,
    });
  }

  function words() {
    const st = ctl.state, h0 = st.elev * D2R, n = nIce(550), d22 = minDeviation(Math.PI / 3, n) / D2R, ph = parhelion(n, h0), cz = circumzenithal(n, h0);
    const halo = ph && cz
      ? t('With the Sun {e}° high, the 22° halo has its sharp red inner edge at {d}°, plate crystals put sundogs {daz}° to either side of the Sun, and the circumzenithal arc shines {cz}° above the horizon.', { e: st.elev, d: d22.toFixed(1), daz: ph.daz.toFixed(1), cz: cz.elevation.toFixed(0) })
      : ph ? t('With the Sun {e}° high, the 22° halo has its sharp red inner edge at {d}° and plate crystals put sundogs {daz}° to either side of the Sun; above 32° there is no circumzenithal arc.', { e: st.elev, d: d22.toFixed(1), daz: ph.daz.toFixed(1) })
      : t('With the Sun {e}° high, the 22° halo has its sharp red inner edge at {d}°; the Sun is too high for sundogs.', { e: st.elev, d: d22.toFixed(1) });
    const drop = D ? ' ' + t('Drops of {a} µm put the brightest part of the bow at <strong>{pk}°</strong> from the antisolar point, against {geo}° from ray optics.', { a: st.a < 10 ? st.a.toFixed(1) : st.a.toFixed(0), pk: D.peak.toFixed(1), geo: rainbowAngle(nWater(550), 1).toFixed(1) }) : '';
    calc.say(halo + drop);
  }

  let last = {};
  function update() {
    const st = ctl.state, changed = (keys) => keys.some((q) => st[q] !== last[q]), h0 = st.elev * D2R, n = nIce(550), ph = parhelion(n, h0), cz = circumzenithal(n, h0), nw = nWater(550);
    const x = (2 * Math.PI * st.a) / 0.55;
    ro.replaceChildren(readouts([
      ['22° halo (inner edge, 400 / 550 / 700 nm)', [400, 550, 700].map((l) => (minDeviation(Math.PI / 3, nIce(l)) / D2R).toFixed(2)).join(' / ') + '°'],
      ['46° halo (inner edge, 550 nm)', (minDeviation(Math.PI / 2, n) / D2R).toFixed(2) + '°'],
      ['Sundogs: offset in azimuth / from the Sun', ph ? `${ph.daz.toFixed(1)}° / ${ph.rho.toFixed(1)}°` : '—'],
      ['Circumzenithal arc: elevation', cz ? cz.elevation.toFixed(1) + '°' : t('none (Sun above 32.2°)')],
      ['Rainbow radii (ray optics, 550 nm)', `${rainbowAngle(nw, 1).toFixed(2)}° / ${rainbowAngle(nw, 2).toFixed(2)}°`],
      ['Size parameter x = 2πa/λ (550 nm)', x < 100 ? x.toFixed(1) : x.toFixed(0)],
      ['Mie terms per wavelength', String(Math.round(x * 1.35 + 4 * Math.cbrt(x * 1.35) + 2))],
    ]));
    calc.set(String.raw`\begin{aligned}
    n_\text{ice}(550\,\text{nm}) &= ${texNum(n, 4)}\\
    D_{60^\circ} &= 2\arcsin(n\sin 30^\circ) - 60^\circ\\ &= ${texNum(minDeviation(Math.PI / 3, n) / D2R, 3)}^\circ\\
    n' &= \frac{\sqrt{n^2-\sin^2 h}}{\cos h} = ${texNum(Math.sqrt(n * n - Math.sin(h0) ** 2) / Math.cos(h0), 4)}\\
    \cos^2 i_k &= \frac{n^2-1}{k(k+2)}\\
    \theta_1 &= ${texNum(rainbowAngle(nw, 1), 3)}^\circ,\ \theta_2 = ${texNum(rainbowAngle(nw, 2), 3)}^\circ\\
    S_1(\theta) &= \sum_n \tfrac{2n+1}{n(n+1)}\,(a_n\pi_n + b_n\tau_n)\\
    x &= 2\pi a/\lambda = ${texNum(x, 3)}
    \end{aligned}`);
    if (changed(['cloud', 'elev'])) v3.setScene(haloScene({ kind: ['plates', 'cirrus'].includes(st.cloud) ? 'plate' : 'column', h: h0 }), !!last.cloud && last.cloud === st.cloud);
    if (changed(['cloud', 'elev', 'tilt'])) runHalo().catch(console.error);
    else if (changed(['exposure']) && acc) { paintHalo(); sky.redraw(); }
    if (changed(['a', 'w'])) runDrops().catch(console.error);
    last = { ...st };
    words();
  }
  update();

  root.append(rule(String.raw`\[D_\text{min} = 2\arcsin\!\left(n\sin 30^\circ\right) - 60^\circ \approx 22^\circ\]
<p>Light crossing two side faces of a hexagonal ice crystal passes a 60° prism. However the crystal is turned, it is bent by at least \(D_\text{min}\); near that minimum many orientations give almost the same angle, so light piles up into a ring. With \(n = 1.31\) the ring has a radius of 21.9°; through a side and an end face (a 90° prism) the same argument gives the 46° halo. For water drops, the ray that is bent least after one internal reflection leaves at 42° from the antisolar point: the rainbow.</p>`,
    String.raw`Minimum deviation is ray optics. It holds for crystals and drops much larger than the wavelength (above about 20 µm). Smaller cloud droplets diffract light into coronas, glories and white fogbows that only wave theory (Mie) describes, and oriented crystals add arcs whose positions depend on the Sun's elevation.`));
  root.append(theory('Halos, rainbows and glories', String.raw`
<div class="theory-cols"><div>
<h3>Ice crystals as prisms</h3>
<p>Cirrus ice grows as hexagonal prisms: flat <em>plates</em> and long <em>columns</em>. Any two side faces that are not parallel meet at 60°, a side and an end face at 90°. Through a prism of apex angle \(A\) the deviation of a ray has a minimum,</p>
\[D_\text{min} = 2\arcsin\!\left(n\sin\tfrac{A}{2}\right) - A,\]
<p>and near that minimum \(dD/di = 0\): a wide range of incidence angles leaves at nearly the same angle, so randomly turned crystals light a ring with a sharp inner edge and a soft outer tail. The index of ice falls from 1.319 at 400 nm to 1.307 at 700 nm (Warren &amp; Brandt), so red has the smaller ring and lies inside; the colours overlap outwards into white.</p>
<h3>Oriented crystals</h3>
<p>Falling plates glide with their faces horizontal, wobbling by a degree or less; columns fall with their long axes horizontal. Plates then act as prisms with vertical edges for rays that are not horizontal, with an effective index \(n' = \sqrt{n^2 - \sin^2 h}/\cos h\) at solar elevation \(h\): the sundogs (parhelia) sit on either side of the Sun and move outwards as it climbs, and vanish when \(n'\sin 30^\circ \ge 1\). Light entering a plate's top face and leaving a side face makes the circumzenithal arc, which exists only while \(\sqrt{n^2-\cos^2 h} < 1\), that is for \(h < 32.2^\circ\). Horizontal columns give the upper and lower tangent arcs.</p>
<h3>The halo simulation</h3>
<p>The sky view is a Monte-Carlo ray trace: for each ray a crystal is drawn from the chosen population (random orientation; horizontal plates with half-height 0.15 of the apothem; horizontal columns 2.5 times as long as wide, both with a Gaussian wobble), a wavelength is drawn uniformly between 400 and 700 nm, and the ray enters through a face chosen in proportion to its projected area. At every face the unpolarised Fresnel reflectance decides at random between reflection and transmission, with total internal reflection where it applies, until the ray leaves. Its exit direction is binned in an azimuthal-equidistant map around the Sun, weighted by the crystal's projected area and converted to colour with the CIE 1931 colour-matching functions. Several hundred thousand rays per pass on every worker build up the picture; the sky behind it is a schematic gradient, not a sky model.</p>
</div><div>
<h3>Water drops and Lorenz–Mie theory</h3>
<p>A spherical drop of radius \(a\) and index \(m\) scatters a plane wave exactly as the Lorenz–Mie series describes:</p>
\[S_1(\theta) = \sum_{n=1}^{\infty}\frac{2n+1}{n(n+1)}\left(a_n\pi_n + b_n\tau_n\right),\qquad S_2 = \sum \frac{2n+1}{n(n+1)}\left(a_n\tau_n + b_n\pi_n\right),\]
<p>with coefficients \(a_n, b_n\) from Riccati–Bessel functions of the size parameter \(x = 2\pi a/\lambda\) and of \(mx\), and \(\pi_n, \tau_n\) from Legendre functions. About \(x + 4x^{1/3} + 2\) terms are needed: over 3000 for a 200 µm raindrop at 400 nm. The laboratory follows Bohren &amp; Huffman's BHMIE (logarithmic derivative by downward recurrence) for 16 wavelengths between 405 and 705 nm and three radii of a narrow size distribution, then smears each profile by the 0.53° solar disc and integrates with sunlight (a 5800 K blackbody) and the colour-matching functions.</p>
<h3>One theory, many phenomena</h3>
<p>For large drops the series reproduces ray optics: the primary bow at about 42° (one internal reflection, minimum deviation where \(\cos^2 i = (n^2-1)/3\)), the secondary at 51°, the dark Alexander's band between them, and inside the primary the supernumerary bows that Airy explained as interference of the two rays leaving at the same angle. As drops shrink below 50 µm the bows widen and their colours overlap into a white <em>fogbow</em>. Near the antisolar point small droplets give the <em>glory</em>, a set of coloured rings from surface waves and edge rays that ray optics cannot produce at all. Around the Sun, forward diffraction by the droplets gives the <em>corona</em>, whose first ring has a radius near \(1.22\lambda/(2a)\): smaller droplets, bigger coronas.</p>
<h3>Limits</h3>
<p>Only single scattering is modelled, so thick clouds that wash out coronas and glories are not shown, and the drop sky is shown without the cloud or rain around it. Raindrops larger than about 1 mm flatten and are not spheres, and Mie theory beyond 300 µm is too slow to run interactively here. The halo crystals are ideal prisms without hollows or Parry orientations, and the polarisation of the scattered light is computed but not shown.</p>
</div></div>`));
  root.append(references([
    'W. Tape, <i>Atmospheric Halos</i>, Antarctic Research Series 64, American Geophysical Union (1994).',
    'R. Greenler, <i>Rainbows, Halos, and Glories</i>, Cambridge University Press (1980).',
    'C. F. Bohren &amp; D. R. Huffman, <i>Absorption and Scattering of Light by Small Particles</i>, Wiley (1983), appendix A (BHMIE).',
    'H. C. van de Hulst, <i>Light Scattering by Small Particles</i>, Wiley (1957).',
    'P. Laven, "Simulation of rainbows, coronas, and glories by use of Mie theory", Applied Optics 42, 436 (2003).',
    'S. G. Warren &amp; R. E. Brandt, "Optical constants of ice from the ultraviolet to the microwave: a revised compilation", J. Geophys. Res. 113, D14220 (2008).',
  ]));
  return () => { haloTicket++; dropTicket++; [sky, cor, anti, prof, v3].forEach((s) => s.destroy()); };
}
