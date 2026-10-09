import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { SENSORS, pitchUm } from '../lib/sensors.js';
import { plot, logRange } from '../lib/plot.js';

const PHOTONS_PER_LUXS_UM2 = 1.2e4; // broadband daylight, 400–700 nm
const K_METER = 12.5, T_LENS = 0.9;

// Poisson sampler (Knuth for small means, Gaussian approximation above 40)
function makeRng(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const poisson = (l) => {
    if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
    const L = Math.exp(-l); let k = 0, p = 1;
    do { k++; p *= u(); } while (p > L);
    return k - 1;
  };
  return { u, gauss, poisson };
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Light arrives as photons, and photons arrive at random. Every pixel value is therefore a random variable whose spread is set by physics (shot noise) and by electronics (read noise, dark current, gain). Exposure sets the photon count, and ISO only decides where the analogue amplifier puts the clipping point. Here the full chain is simulated pixel by pixel.', domains: ['photo', 'video', 'space'] }));

  const ctl = controls({
    sensor: { type: 'select', label: 'Sensor', value: 'ff', options: ['mf', 'ff', 'apsc', 'mft', 'one', 'phone'].map((k) => [k, SENSORS[k].name]) },
    ev: { type: 'range', label: 'Scene brightness (EV₁₀₀)', min: -2, max: 15, step: 0.5, value: 4, fmt: (v) => v + (v <= 2 ? ' (night street)' : v <= 6 ? ' (indoor)' : v <= 11 ? ' (overcast)' : ' (sun)') },
    N: { type: 'range', label: 'f-number', min: 1.4, max: 16, log: true, value: 2.8, fmt: (v) => 'f/' + v.toPrecision(2) },
    t: { type: 'range', label: 'Shutter', min: 1 / 8000, max: 1, log: true, value: 1 / 125, fmt: (v) => (v >= 1 ? v.toFixed(1) + ' s' : '1/' + Math.round(1 / v)) },
    iso: { type: 'range', label: 'ISO (analogue gain)', min: 100, max: 25600, log: true, value: 800, fmt: (v) => Math.round(v) },
    pre: { type: 'range', label: 'Pre-amplifier read noise', min: 0.5, max: 5, step: 0.1, value: 1.6, unit: 'e⁻' },
    post: { type: 'range', label: 'Post-amplifier (ADC) noise at base ISO', min: 0, max: 30, step: 0.5, value: 12, unit: 'e⁻' },
    dark: { type: 'range', label: 'Dark current', min: 0, max: 5, step: 0.05, value: 0.2, unit: 'e⁻/s' },
    prnu: { type: 'range', label: 'PRNU (fixed-pattern gain)', min: 0, max: 2, step: 0.05, value: 0.5, unit: '%' },
    push: { type: 'toggle', label: 'Brighten in post to the metered level', value: true },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const imgSt = stage({ aspect: 1.6, label: '100 % crop: step wedge (½-stop patches) and gradient', draw: drawImg, minH: 260 });
  const ptc = stage({ aspect: 1.6, label: '', draw: drawPTC, cls: 'plain' });
  const dr = stage({ aspect: 1.6, label: '', draw: drawDR, cls: 'plain' });
  root.append(lab([imgSt.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, ptc.el), h('div.card', { style: { padding: '6px' } }, dr.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null, img = null;
  function model() {
    const st = ctl.state, S = SENSORS[st.sensor];
    const p = pitchUm(S), A = p * p; // µm²
    const fwc = 1800 * A; // e⁻ (≈ 1800 e⁻/µm², typical modern CMOS)
    const gain = st.iso / 100; // relative analogue gain
    const sigRead = Math.sqrt(st.pre ** 2 + (st.post / gain) ** 2); // input-referred
    const clip = Math.min(fwc, fwc / gain * 1); // electrons at which the ADC saturates
    const Lmid = (K_METER * Math.pow(2, st.ev)) / 100; // cd/m² of an 18 % grey (meter calibration)
    const Hmid = (Math.PI * T_LENS * Lmid * st.t) / (4 * st.N * st.N); // lux·s on the sensor
    const eMid = Hmid * A * PHOTONS_PER_LUXS_UM2 * 0.5; // QE 0.5
    const Hmeter = (Math.PI * T_LENS * K_METER) / (4 * st.iso); // lux·s the meter wants at this ISO
    const evOff = Math.log2(Hmid / Hmeter);
    const darkE = st.dark * st.t;
    const noise = (e) => Math.sqrt(e + darkE + sigRead ** 2 + ((st.prnu / 100) * e) ** 2);
    const DR = Math.log2(clip / Math.sqrt(sigRead ** 2 + darkE));
    return { st, S, p, A, fwc, gain, sigRead, clip, eMid, evOff, darkE, noise, DR, snrMid: eMid / noise(eMid) };
  }

  function render() {
    const m = M, st = m.st, W = 320, H = 200;
    const rng = makeRng(1234);
    const ic = imageCanvas(W, H);
    // PRNU map (fixed, per pixel)
    const prnu = new Float32Array(W * H);
    const r0 = makeRng(99); for (let i = 0; i < W * H; i++) prnu[i] = 1 + (st.prnu / 100) * r0.gauss();
    const toOut = st.push ? 0.18 / m.eMid : 0.18 / (m.eMid / Math.pow(2, m.evOff)); // keep metered brightness if pushed
    let clipped = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // reflectance: top row 16 patches from 90 % down in ½-stop steps; bottom a smooth log gradient
      let refl;
      if (y < H * 0.55) { const k = Math.floor((x / W) * 16); refl = 0.9 * Math.pow(2, -k / 2); }
      else refl = 0.9 * Math.pow(2, -8 * (x / W));
      const mean = m.eMid * (refl / 0.18) * prnu[y * W + x];
      let e = rng.poisson(mean + m.darkE);
      e = Math.min(e, m.fwc);
      let dn = e + m.sigRead * rng.gauss();
      if (dn >= m.clip) { dn = m.clip; clipped++; }
      // 14-bit quantisation of the amplified signal
      const q = m.clip / 16384; dn = Math.round(dn / q) * q;
      const lin = Math.max(0, dn * toOut);
      const g = Math.round(255 * Math.min(1, lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055));
      const o = (y * W + x) * 4; ic.data[o] = ic.data[o + 1] = ic.data[o + 2] = g; ic.data[o + 3] = 255;
    }
    ic.put(); img = ic.c;
    return clipped / (W * H);
  }

  function update() {
    M = model();
    const m = M, st = m.st;
    const clipFrac = render();
    const deep = m.eMid * (0.9 * Math.pow(2, -7.5) / 0.18);
    ro.replaceChildren(readouts([
      ['Pixel pitch / area', `${m.p.toFixed(2)} µm / ${m.A.toFixed(1)} µm²`],
      ['Full-well capacity', fmt(m.fwc, 3) + ' e⁻'],
      ['Clip point at this ISO', fmt(m.clip, 3) + ' e⁻'],
      ['Input-referred read noise', m.sigRead.toFixed(2) + ' e⁻'],
      ['18 % grey signal', fmt(m.eMid, 3) + ' e⁻'],
      ['SNR at 18 % grey', m.snrMid.toFixed(1) + ' (' + (20 * Math.log10(m.snrMid)).toFixed(1) + ' dB)'],
      ['SNR in the darkest patch', (deep / m.noise(deep)).toFixed(2)],
      ['Exposure vs meter', (m.evOff >= 0 ? '+' : '') + m.evOff.toFixed(2) + ' EV'],
      ['Engineering dynamic range', m.DR.toFixed(1) + ' EV'],
      ['Clipped pixels', (clipFrac * 100).toFixed(1) + ' %'],
    ]));
    calc.set(String.raw`\begin{aligned}
    E &= \frac{\pi T L}{4N^2},\quad \bar n = E\,t\,A_\text{px}\,\Phi_\gamma\,\eta = ${texNum(m.eMid, 3)}\ e^-\\
    \sigma &= \sqrt{\bar n + D t + \sigma_r^2 + (P\bar n)^2}\\
    \sigma_r &= \sqrt{\sigma_\text{pre}^2 + (\sigma_\text{post}/g)^2} = ${texNum(m.sigRead, 3)}\ e^-\\
    \mathrm{SNR} &= ${texNum(m.snrMid, 3)},\quad \mathrm{DR} = \log_2\frac{n_\text{clip}}{\sigma_r} = ${texNum(m.DR, 3)}\ \text{EV}
    \end{aligned}`);
    [imgSt, ptc, dr].forEach((s) => s.redraw());
  }

  function drawImg(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!img) return;
    const sc = Math.min(w / img.width, hh / img.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, (w - img.width * sc) / 2, (hh - img.height * sc) / 2, img.width * sc, img.height * sc);
  }

  function drawPTC(ctx, w, hh) {
    if (!M) return;
    const m = M, xs = logRange(0.1, Math.max(m.fwc, 10), 200);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Photon-transfer: SNR vs signal per pixel', x: { min: 0.1, max: 1e6, log: true, label: 'signal (e⁻)' }, y: { min: 0.05, max: 1000, log: true, label: 'SNR' },
      series: [
        { data: xs.map((e) => [e, Math.sqrt(e)]), color: 'rgba(106,215,255,0.6)', width: 1.2, dash: [4, 3], label: 'shot-noise limit √n' },
        { data: xs.map((e) => [e, e / Math.sqrt(m.sigRead ** 2 + m.darkE)]), color: 'rgba(255,107,107,0.6)', width: 1.2, dash: [4, 3], label: 'read-noise limit' },
        { data: xs.map((e) => [e, e / Math.max(1e-9, (m.st.prnu / 100) * e)]), color: 'rgba(193,140,255,0.6)', width: 1.2, dash: [4, 3], label: 'PRNU limit' },
        { data: xs.filter((e) => e <= m.clip).map((e) => [e, e / m.noise(e)]), color: '#ffb547', width: 2.4, label: 'total' },
      ],
      vlines: [{ x: m.clip, color: '#ff6b6b', label: 'clip' }],
      legend: true, legendX: w - 150, legendY: hh - 120,
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(m.eMid), Y(m.snrMid), 5, 0, 7); ctx.fill();
    ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('18 % grey', X(m.eMid) + 8, Y(m.snrMid) - 6);
  }

  function drawDR(ctx, w, hh) {
    if (!M) return;
    const st = M.st, isos = logRange(100, 25600, 60);
    const curve = (S) => {
      const A = pitchUm(S) ** 2, fwc = 1800 * A;
      return isos.map((iso) => { const g = iso / 100, sr = Math.sqrt(st.pre ** 2 + (st.post / g) ** 2); return [iso, Math.log2(fwc / g / sr)]; });
    };
    plot(ctx, w, hh, {
      title: 'Dynamic range vs ISO', x: { min: 100, max: 25600, log: true, label: 'ISO' }, y: { min: 2, max: 16, label: 'DR (EV)' },
      series: ['mf', 'ff', 'apsc', 'mft', 'phone'].map((k, i) => ({ data: curve(SENSORS[k]), color: ['#ff9a5a', '#ffffff', '#6be3a4', '#6ad7ff', '#c18cff'][i], width: k === st.sensor ? 2.6 : 1.2, label: SENSORS[k].name })),
      vlines: [{ x: st.iso, color: '#ffb547' }],
      legend: true, legendX: 70, legendY: hh - 120,
    });
  }

  update();

  root.append(theory('The photon-transfer model', String.raw`
<div class="theory-cols"><div>
<h3>From scene to electrons</h3>
<p>A reflected-light meter with calibration constant \(K = 12.5\ \text{cd/m}^2\) relates scene luminance to the exposure value through \(L = K\,2^{EV}/100\) for an 18 % grey. The camera equation then gives the image-plane illuminance, and the mean number of photoelectrons per pixel is</p>
\[\bar n = \frac{\pi T L}{4N^2}\,t\;A_\text{px}\;\Phi_\gamma\;\eta,\]
<p>with \(\Phi_\gamma\approx1.2\times10^4\) photons \(\text{lx}^{-1}\text{s}^{-1}\mu\text{m}^{-2}\) for daylight between 400 and 700 nm, and quantum efficiency \(\eta\approx0.5\). Photon arrival is a Poisson process, so the variance equals the mean. This shot noise is a property of light, not of the sensor.</p>
<h3>The noise budget</h3>
\[\sigma^2 = \underbrace{\bar n}_\text{shot} + \underbrace{Dt}_\text{dark} + \underbrace{\sigma_r^2}_\text{read} + \underbrace{(P\bar n)^2}_\text{PRNU} + \underbrace{q^2/12}_\text{quantisation}.\]
<p>Plotted on log–log axes (the <em>photon-transfer curve</em>, Janesick), SNR rises with slope 1 where read noise dominates, slope ½ where shot noise dominates, and flattens at \(1/P\) where pixel-to-pixel gain variation dominates, until the full well clips.</p>
</div><div>
<h3>What ISO really does</h3>
<p>ISO is an analogue gain applied <em>after</em> the photodiode, so it does not change the photon count. Read noise has two parts: a pre-amplifier part \(\sigma_\text{pre}\), which ISO cannot help, and downstream ADC noise \(\sigma_\text{post}\), which gain reduces when referred back to the input:</p>
\[\sigma_r(g) = \sqrt{\sigma_\text{pre}^2 + (\sigma_\text{post}/g)^2}.\]
<p>Raising ISO therefore lowers input-referred read noise at first. Once \(\sigma_\text{post}/g \ll \sigma_\text{pre}\), the sensor is <em>ISO-invariant</em>: underexposing at low ISO and brightening later gives the same result, with more highlight headroom. Each ISO doubling halves the clip point, so dynamic range falls by about 1 EV per stop in that regime.</p>
<h3>Why sensor size matters</h3>
<p>At equal f-number and shutter speed, a larger pixel collects proportionally more photons. Per unit image area, all sensors at equal exposure gather the same photon density, so the whole-image SNR scales with \(\sqrt{\text{area}}\) (see <a href="#/sensor">Sensor size</a>).</p>
<h3>Astronomy</h3>
<p>Scientific CCDs and CMOS sensors reach read noise below 1 e⁻ (EMCCDs and qCMOS effectively 0.3 e⁻) and dark current around \(10^{-3}\ e^-/\text{s}\) when cooled. JWST's HgCdTe arrays use up-the-ramp sampling, reading each pixel non-destructively many times during an exposure, to beat read noise and reject cosmic-ray hits. Long exposures of faint galaxies sit in the sky-background-limited regime, where SNR grows only as \(\sqrt{t}\).</p>
</div></div>`));
  root.append(references([
    'J. R. Janesick, <i>Photon Transfer: DN → λ</i>, SPIE Press (2007).',
    'EMVA Standard 1288, "Standard for characterization of image sensors and cameras", Release 4.0 (2021).',
    'ISO 12232:2019 and ISO 2720:1974, exposure index and meter calibration (K = 12.5).',
    'B. Rauscher et al., "New and better detectors for the JWST near-infrared spectrograph", PASP 126, 739 (2014).',
  ]));
  return () => [imgSt, ptc, dr].forEach((s) => s.destroy());
}
