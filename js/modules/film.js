import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { stock, meanDensity, speedPoint, selwyn, reciprocityCorrection } from '../lib/film.js';
import { t } from '../lib/i18n.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>Photographic film is coated with billions of tiny silver-halide crystals. A crystal that catches a few photons becomes "developable", and the developer turns it into a speck of black silver. Each crystal is either on or off, so the picture is built from countless specks: film <strong>grain</strong>.</p>
<p>Bigger crystals catch light more easily, so fast, sensitive films have coarser grain. Film also responds gently at both ends of its range, an S-shaped curve that gives highlights a soft roll-off. And in very long exposures it gets less sensitive, so night photographers have to add extra time.</p>`, [
    "Raise the <strong>Film speed</strong> from ISO 100 to 3200: the grain grows.",
    "Move the <strong>Exposure</strong> to +4 and −4 EV and follow the point along the S-shaped curve: highlights compress, shadows block up.",
    "In the reciprocity section below, set a metered exposure of 60 s and read how much longer the film really needs.",
  ]));

  const ctl = controls({
    iso: { type: 'range', label: 'Film speed', min: 25, max: 3200, log: true, value: 400, fmt: (v) => 'ISO ' + Math.round(v) },
    sig: { type: 'range', label: 'Spread of grain sizes (log σ)', min: 0.3, max: 1, step: 0.05, value: 0.8, hint: 'narrow: contrasty slide-like emulsion; wide: negative film with long latitude' },
    ev: { type: 'range', label: 'Exposure relative to normal', min: -4, max: 4, step: 0.5, value: 0, unit: 'EV' },
    ap: { type: 'range', label: 'Scanning aperture (granularity)', min: 6, max: 96, log: true, value: 48, unit: 'µm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const wedge = stage({ aspect: 2.4, label: 'Developed emulsion, 48 × 20 microns: eight steps 1 stop apart (dark = dense silver)', draw: drawWedge, minH: 160 });
  const hd = stage({ aspect: 1.5, label: '', draw: drawHD, cls: 'plain', minH: 230 });
  const gr = stage({ aspect: 1.5, label: '', draw: drawGran, cls: 'plain', minH: 230 });
  root.append(lab([wedge.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, hd.el), h('div.card', { style: { padding: '6px' } }, gr.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('film');
  let R = null, F = null;
  function update() {
    const st = ctl.state, f = stock(st.iso, st.sig), Hs = speedPoint(f), H0 = Hs * Math.pow(10, 0.8);
    F = { st, f, Hs, H0 };
    job('film', { iso: st.iso, sig: st.sig, W: 192, H0, ev: st.ev, ap: st.ap }).then((r) => {
      R = r;
      const Hm = H0 * 2 ** st.ev, g = (meanDensity(Hm * 1.05, f) - meanDensity(Hm / 1.05, f)) / (2 * Math.log10(1.05));
      ro.replaceChildren(readouts([
        ['Median grain diameter', (2 * f.r).toFixed(2) + ' µm'],
        ['Speed point (D = fog + 0.1)', t('{h} photons/µm²', { h: Hs.toFixed(3) })],
        ['Density of this exposure', r.Dmid.toFixed(2)],
        ['Local contrast γ = dD/dlog H', g.toFixed(2)],
        ['RMS granularity at this aperture', (1000 * r.sigma).toFixed(1) + ' (σ_D × 1000)'],
        ['Selwyn constant σ_D √A', r.G.toFixed(3) + ' µm'],
        ['Detective quantum efficiency', (100 * r.dqe).toFixed(2) + ' %'],
      ]));
      calc.say(t('At ISO {v1} the median grain is <strong>{v2} µm</strong> across, and the film puts only <strong>{v3} %</strong> of the photons to use (its detective quantum efficiency); a modern sensor reaches over 50 %.', { v1: Math.round(st.iso), v2: (2 * f.r).toFixed(2), v3: (100 * r.dqe).toFixed(1) }));
      calc.set(String.raw`\begin{aligned}
      D &= 0.434\,L\,n\,\langle p\,\pi r^2\rangle + D_\text{fog}\\
      &= ${texNum(r.Dmid, 3)}\\
      \mathrm{DQE} &= \frac{(\gamma\log_{10}e)^2}{H A \sigma_D^2} = ${texNum(r.dqe, 3)}
      \end{aligned}`);
      [wedge, hd, gr].forEach((x) => x.redraw());
    });
  }
  function drawWedge(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const W = R.W, rows = Math.round(W / 2.4), ic = imageCanvas(W, rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) { const v = 255 * Math.pow(10, -R.wedge[y * W + x]) ** (1 / 2.2), o = (y * W + x) * 4; ic.data[o] = v; ic.data[o + 1] = v * 0.97; ic.data[o + 2] = v * 0.92; ic.data[o + 3] = 255; }
    ic.put();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, 0, 0, w, hh);
  }
  function drawHD(ctx, w, hh) {
    if (!F) return;
    const pts = [], { f, H0, st } = F;
    for (let l = -2.5; l <= 4.5; l += 0.05) pts.push([l, meanDensity(10 ** l, f)]);
    plot(ctx, w, hh, {
      title: t('Characteristic (H&D) curve, ISO {iso}', { iso: Math.round(st.iso) }), x: { min: -2.5, max: 4.5, label: 'log₁₀ exposure (photons/µm²)' }, y: { min: 0, max: 2.8, label: 'optical density D' },
      series: [{ data: pts, color: '#ffb547', width: 2.2 }],
      vlines: Array.from({ length: 8 }, (_, i) => ({ x: Math.log10(H0 * 2 ** st.ev) + 0.3 * (i - 3.5), color: 'rgba(255,255,255,0.15)' })),
    });
  }
  function drawGran(ctx, w, hh) {
    if (!F) return;
    const { f } = F, isos = [25, 50, 100, 200, 400, 800, 1600, 3200];
    plot(ctx, w, hh, {
      title: 'RMS granularity (48 µm aperture, D ≈ 1) vs speed', x: { min: 25, max: 3200, log: true, label: 'ISO' }, y: { min: 1, max: 300, log: true, label: 'σ_D × 1000' },
      series: [{ data: isos.map((iso) => { const g = stock(iso, f.sig), Hs = speedPoint(g); return [iso, (1000 * selwyn(Hs * 10 ** 0.8, g)) / Math.sqrt(Math.PI * 24 * 24)]; }), color: '#6ad7ff', width: 2.2 }],
      vlines: [{ x: F.st.iso, color: 'rgba(255,255,255,0.4)' }],
    });
  }

  // ── reciprocity failure ──
  const sec2 = h('section.block', {}, h('h2', {}, 'Reciprocity failure'));
  const rctl = controls({ t: { type: 'range', label: 'Metered exposure time', min: 0.1, max: 300, log: true, value: 30, unit: 's' }, p: { type: 'range', label: 'Schwarzschild exponent p', min: 0.6, max: 1, step: 0.01, value: 0.8 } }, () => updR());
  const rro = h('div');
  const rplot = stage({ aspect: 2.3, label: '', draw: drawR, cls: 'plain', minH: 200 });
  sec2.append(lab([h('div.card', { style: { padding: '6px' } }, rplot.el)], [h('div.card', {}, rctl.el), h('div.card', {}, rro)]));
  root.append(sec2);
  function updR() {
    const st = rctl.state, tc = reciprocityCorrection(st.t, st.p);
    rro.replaceChildren(readouts([['Corrected exposure time', tc.toFixed(1) + ' s'], ['Extra exposure needed', Math.log2(tc / st.t).toFixed(2) + ' EV'], ['Digital sensor', t('no failure (photon counting is linear)')]]));
    rplot.redraw();
  }
  function drawR(ctx, w, hh) {
    const ts = Array.from({ length: 60 }, (_, i) => 0.1 * Math.pow(3000, i / 59)), st = rctl.state;
    plot(ctx, w, hh, {
      title: 'Exposure time needed vs metered time', x: { min: 0.1, max: 300, log: true, label: 'metered time (s)' }, y: { min: 0.1, max: 3000, log: true, label: 'required time (s)' },
      series: [{ data: ts.map((t) => [t, t]), color: 'rgba(255,255,255,0.35)', width: 1, dash: [4, 3], label: 'reciprocity (digital)' }, ...[0.9, 0.8, 0.7].map((p, i) => ({ data: ts.map((t) => [t, reciprocityCorrection(t, p)]), color: ['#6be3a4', '#ffb547', '#ff9cc0'][i], width: Math.abs(p - st.p) < 0.051 ? 2.4 : 1.2, label: `p = ${p}` }))],
      vlines: [{ x: st.t, color: 'rgba(255,255,255,0.4)' }], legend: true, legendX: 70, legendY: 34,
    });
  }

  update(); updR();

  root.append(rule(String.raw`\[\sigma_D \sqrt{A} = G\]
<p>Selwyn's law: the measured graininess \(\sigma_D\), the scatter of density, falls with the square root of the area \(A\) over which it is measured, with a constant \(G\) set by the film. Enlarge a frame twice as much and each spot the viewer resolves covers a quarter of the film area, so the graininess doubles. That is why grain shows far more in a 30 × 45 cm print than in a postcard from the same negative.</p>`,
    String.raw`Selwyn's law holds for measuring areas much larger than the grains; near grain size the structure of individual clumps shows. Perceived grain also depends on the development, the scanner and the content of the picture.`));
  root.append(theory('How film detects light', String.raw`
<div class="theory-cols"><div>
<h3>Grains as photon counters with a threshold</h3>
<p>A silver-halide crystal needs a few absorbed photons, about two to four, to form a stable latent-image speck. Below that the crystal stays unexposed; above, the developer reduces the whole crystal to metallic silver. With \(\bar q = H\,\pi r^2 q\) absorbed photons expected, the probability of development is a Poisson tail, \(p = 1 - \sum_{k<k_0} e^{-\bar q}\bar q^k/k!\). Larger grains catch more photons and are faster. That is why speed and grain grow together: doubling the speed means doubling the grain area.</p>
<h3>The characteristic curve</h3>
<p>Randomly placed opaque grains leave an uncovered fraction \(e^{-n\langle p\,\pi r^2\rangle}\) per layer (the Boolean model), so the optical density is</p>
\[D = 0.434\,L\,n\,\langle p(H)\,\pi r^2\rangle + D_\text{fog}\]
<p>(Nutting's law). Because crystals have a distribution of sizes, the onset of development is spread over a range of exposures. That spread produces the toe, the straight line of slope γ and the shoulder of the H&amp;D curve: a narrow distribution gives contrasty slide film, a wide one the long latitude of negative film.</p>
</div><div>
<h3>Granularity and DQE</h3>
<p>Measured through an aperture of area \(A\), the density fluctuates by \(\sigma_D\) with \(\sigma_D\sqrt A\) constant (Selwyn's law), as for any random texture much finer than the aperture. The page computes it exactly for the Boolean model from the overlap integral \(\int(e^{K(h)}-1)\,d^2h\). The detective quantum efficiency compares the output signal-to-noise ratio with that of the incident photons,</p>
\[\mathrm{DQE} = \frac{(\gamma\log_{10}e)^2}{H A \sigma_D^2},\]
<p>a few per cent at best for film, against 50–90 % for a modern sensor. A crystal's all-or-nothing switch discards most of the information in the photons it absorbs.</p>
<h3>Reciprocity failure</h3>
<p>At low intensity a latent-image speck may decay before the next photon arrives, so long exposures need more than the metered \(H = It\). Schwarzschild's empirical law \(H_\text{eff} = I t^p\) with \(p < 1\) is the usual correction. Digital sensors count photons linearly and do not suffer from it.</p>
<p>The emulsion parameters here are representative of black-and-white films, not of a specific product; real granularity numbers (around 10 for an ISO 100 film) also depend on development.</p>
</div></div>`));
  root.append(references([
    'T. H. James (ed.), <em>The Theory of the Photographic Process</em>, 4th ed., Macmillan (1977): latent-image formation, characteristic curve, reciprocity.',
    'J. C. Dainty &amp; R. Shaw, <em>Image Science</em>, Academic Press (1974): Selwyn granularity, Siedentopf formula, detective quantum efficiency.',
    'K. Schwarzschild, “On the deviations from the law of reciprocity for bromide of silver gelatine”, <em>Astrophys. J.</em> 11, 89 (1900).',
  ]));

  return () => [wedge, hd, gr, rplot].forEach((x) => x.destroy());
}
