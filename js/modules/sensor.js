import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { SENSORS, diag, crop, pitchUm, FF_DIAG } from '../lib/sensors.js';
import { plot, logRange } from '../lib/plot.js';

const COLORS = ['#ff6b6b', '#ff9a5a', '#ffd27a', '#ffffff', '#ff9cc0', '#6be3a4', '#6ad7ff', '#8fa6ff', '#c18cff', '#9aa1b5'];
const LAMBDA = 0.55; // µm

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Sensor size changes nothing about exposure, but almost everything about the photograph. For the same framing, a smaller sensor needs a shorter lens, has a smaller entrance pupil, collects fewer photons, renders deeper focus and reaches the diffraction limit sooner. One number, the entrance-pupil diameter, ties all of these together.', domains: ['photo', 'video'] }));

  const keys = Object.keys(SENSORS);
  const ctl = controls({
    ref: { type: 'select', label: 'Reference format', value: 'ff', options: keys.map((k) => [k, SENSORS[k].name]) },
    f: { type: 'range', label: 'Focal length (reference)', min: 10, max: 600, log: true, value: 50, unit: 'mm' },
    N: { type: 'range', label: 'f-number (reference)', min: 1, max: 22, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    iso: { type: 'range', label: 'ISO (reference)', min: 50, max: 12800, log: true, value: 400, fmt: (v) => Math.round(v) },
    s: { type: 'range', label: 'Subject distance', min: 0.5, max: 50, log: true, value: 3, unit: 'm' },
    show: { type: 'seg', label: 'Overlay', value: 'image', options: [['image', 'Same lens'], ['frame', 'Same framing']] },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  let M = null;

  const over = stage({ aspect: 1.6, label: '', draw: drawOverlay, minH: 300 });
  const fov = stage({ aspect: 1.6, label: '', draw: drawFov, cls: 'plain' });
  const snr = stage({ aspect: 1.6, label: '', draw: drawSnr, cls: 'plain' });
  const tableWrap = h('div.card', { style: { overflowX: 'auto' } });
  root.append(lab([over.el, tableWrap, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, fov.el), h('div.card', { style: { padding: '6px' } }, snr.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // procedural night landscape used as the "image circle" content
  const scene = (() => {
    const W = 1200, H = 800, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H * 0.7); sky.addColorStop(0, '#05081a'); sky.addColorStop(0.7, '#1b2347'); sky.addColorStop(1, '#a35a4a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    let seed = 3; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) { const b = r() ** 3; g.fillStyle = `rgba(220,230,255,${0.2 + 0.8 * b})`; g.fillRect(r() * W, r() * H * 0.65, 1 + b * 1.5, 1 + b * 1.5); }
    // Milky Way band
    for (let i = 0; i < 4000; i++) { const t = r(); const x = t * W, y = H * 0.1 + t * H * 0.35 + (r() - 0.5) * 120 * Math.exp(-((r() - 0.5) ** 2) * 4); g.fillStyle = `rgba(200,190,255,${0.05 + 0.08 * r()})`; g.fillRect(x, y, 2, 2); }
    const mtn = (base, amp, col, f) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 4) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * f) * Math.cos(x * f * 2.3 + 1)) - 20 * Math.sin(x * 0.05)); g.lineTo(W, H); g.fill(); };
    mtn(H * 0.72, 140, '#121628', 0.004); mtn(H * 0.8, 90, '#0a0c18', 0.007);
    g.fillStyle = '#ffd27a';
    for (let i = 0; i < 40; i++) { g.globalAlpha = 0.6 + 0.4 * r(); g.fillRect(W * 0.3 + r() * W * 0.4, H * 0.86 + r() * 30, 2, 2); }
    g.globalAlpha = 1;
    return c;
  })();

  function rows() {
    const st = ctl.state, R = SENSORS[st.ref];
    const kref = crop(R);
    return keys.map((k, i) => {
      const S = SENSORS[k], kk = crop(S), r = kref / kk; // focal-length ratio for equal framing
      const f = st.f / r, N = st.N / r, iso = st.iso / (r * r);
      const D = f / N; // entrance pupil (same for all)
      const hfov = 2 * Math.atan(S.w / (2 * f)) * 180 / Math.PI;
      const c = diag(S) / 1500, sm = st.s * 1000;
      const Dn = (sm * f * f) / (f * f + N * c * (sm - f)), den = f * f - N * c * (sm - f);
      const Df = den > 0 ? (sm * f * f) / den : Infinity;
      const p = pitchUm(S), airy = 2.44 * LAMBDA * st.N; // at the *reference* N on this format (same lens settings)
      const nDLA = p / (1.22 * LAMBDA);
      return { k, S, i, f, N, iso, D, hfov, dof: Df - Dn, p, airyPx: airy / p, nDLA, area: S.w * S.h, kk };
    });
  }

  function update() {
    const st = ctl.state;
    const R = rows();
    const ref = R.find((r) => r.k === st.ref);
    M = { R, ref, st: { ...st } };
    tableWrap.replaceChildren(h('table.eqtab', {},
      h('thead', {}, h('tr', {}, ...['Format', 'Crop', 'Equivalent f', 'Equivalent N', 'Equivalent ISO', 'h-FOV', 'DoF at subject', 'Pixel pitch', 'Diffraction-limited from', 'Light vs ref.'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...R.map((r) => h('tr', { class: r.k === st.ref ? 'sel' : '' },
        h('td', {}, h('i', { style: { background: COLORS[r.i] } }), r.S.name),
        h('td', {}, r.kk.toFixed(2) + '×'),
        h('td', {}, r.f.toFixed(1) + ' mm'),
        h('td', {}, 'f/' + r.N.toPrecision(2)),
        h('td', {}, Math.round(r.iso).toString()),
        h('td', {}, r.hfov.toFixed(1) + '°'),
        h('td', {}, isFinite(r.dof) ? fmt(r.dof / 1000, 3) + ' m' : '∞'),
        h('td', {}, r.p.toFixed(2) + ' µm'),
        h('td', {}, 'f/' + r.nDLA.toFixed(1)),
        h('td', {}, (Math.log2(r.area / ref.area) >= 0 ? '+' : '') + Math.log2(r.area / ref.area).toFixed(1) + ' EV'),
      )))));
    const S = SENSORS[st.ref];
    ro.replaceChildren(readouts([
      ['Diagonal', diag(S).toFixed(2) + ' mm'],
      ['Crop factor vs 36×24', crop(S).toFixed(3)],
      ['Entrance pupil D = f/N', (st.f / st.N).toFixed(2) + ' mm'],
      ['Horizontal FOV', ref.hfov.toFixed(2) + '°'],
      ['Pixel pitch (' + S.mp + ' MP)', ref.p.toFixed(2) + ' µm'],
      ['Airy diameter at f/' + st.N.toPrecision(2), (2.44 * LAMBDA * st.N).toFixed(2) + ' µm = ' + ref.airyPx.toFixed(2) + ' px'],
    ]));
    const k = crop(S);
    calc.set(String.raw`\begin{aligned}
    k &= \frac{43.27}{${texNum(diag(S), 4)}} = ${texNum(k, 4)}\\
    f_{FF} &= k f = ${texNum(k * st.f, 4)}\ \text{mm}\\
    N_{FF} &= k N = ${texNum(k * st.N, 3)}\\
    \text{ISO}_{FF} &= k^2\,\text{ISO} = ${texNum(k * k * st.iso, 3)}\\
    D &= f/N = ${texNum(st.f / st.N, 4)}\ \text{mm (invariant)}
    \end{aligned}`);
    [over, fov, snr].forEach((s) => s.redraw());
  }

  function drawOverlay(ctx, w, hh) {
    if (!M) return;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const sameLens = M.st.show === 'image';
    // mm → px: fit the largest format shown (or the image circle) into the canvas
    const ref = SENSORS[M.st.ref];
    // fit the medium-format frame; larger film formats run off the canvas, as they would off the image circle
    const maxW = sameLens ? Math.max(SENSORS.mf.w, ref.w) * 1.12 : ref.w * 1.05;
    const maxH = sameLens ? Math.max(SENSORS.mf.h, ref.h) * 1.12 : ref.h * 1.05;
    const sc = Math.min((w - 40) / maxW, (hh - 40) / maxH);
    const cx = w / 2, cy = hh / 2;
    if (sameLens) {
      // the lens projects an image; its scale on the sensor is set by f. Draw the scene so that
      // the reference format sees exactly hFOV(ref, f).
      const sceneW_mm = ref.w * 3.2; // scene spans 3.2× the reference width
      const circR = (diag(ref) / 2) * 1.06 * sc; // a lens designed for the reference format covers just its diagonal
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, circR, 0, 7); ctx.clip();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(scene, cx - (sceneW_mm / 2) * sc, cy - (sceneW_mm / 3) * sc, sceneW_mm * sc, (sceneW_mm * 2 / 3) * sc);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, circR, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('image circle of a lens made for ' + ref.name + ': larger formats vignette', cx, Math.min(hh - 8, cy + circR + 14));
      M.R.forEach((r) => {
        const W = r.S.w * sc, H = r.S.h * sc;
        ctx.strokeStyle = COLORS[r.i]; ctx.lineWidth = r.k === M.st.ref ? 2.5 : 1.2;
        ctx.shadowColor = COLORS[r.i]; ctx.shadowBlur = 8;
        ctx.strokeRect(cx - W / 2, cy - H / 2, W, H); ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS[r.i]; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left';
        if (W > 70 && W < w) ctx.fillText(r.S.name.split(' ')[0] + ' ' + (r.S.name.split(' ')[1] || ''), cx - W / 2 + 4, cy - H / 2 + 12);
      });
    } else {
      // same framing: every format captures the same scene; show the relative pupil sizes
      ctx.drawImage(scene, cx - (ref.w / 2) * sc, cy - (ref.h / 2) * sc, ref.w * sc, ref.h * sc);
      const n = M.R.length, cw = (w - 40) / n;
      M.R.forEach((r, i) => {
        const D = r.f / r.N, Dref = M.st.f / M.st.N;
        const rad = Math.min(cw * 0.4, 30) * Math.sqrt(D / Dref);
        const x = 20 + cw * (i + 0.5), y = hh - 46;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(20 + cw * i + 2, y - 36, cw - 4, 74);
        ctx.strokeStyle = COLORS[r.i]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Math.max(2, rad * 0.5), 0, 7); ctx.stroke();
        ctx.fillStyle = COLORS[r.i]; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${r.f.toFixed(0)}mm f/${r.N.toPrecision(2)}`, x, y + 30);
      });
      ctx.fillStyle = '#fff'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Identical framing, perspective, depth of field and total light: all share D = f/N = ' + (M.st.f / M.st.N).toFixed(1) + ' mm', 14, 20);
    }
  }

  function drawFov(ctx, w, hh) {
    if (!M) return;
    const fs = logRange(4, 800, 120);
    plot(ctx, w, hh, {
      title: 'Horizontal field of view vs focal length', x: { min: 4, max: 800, log: true, label: 'focal length (mm)' }, y: { min: 0.5, max: 150, log: true, label: 'h-FOV (°)' },
      series: M.R.map((r) => ({ data: fs.map((f) => [f, 2 * Math.atan(r.S.w / (2 * f)) * 180 / Math.PI]), color: COLORS[r.i], width: r.k === M.st.ref ? 2.4 : 1.1 })),
      vlines: [{ x: M.st.f, color: '#fff', label: M.st.f.toFixed(0) + ' mm' }],
    });
  }

  function drawSnr(ctx, w, hh) {
    if (!M) return;
    // shot-noise-limited SNR at 18 % grey for the same exposure (same N, t), per output image
    // normalised to an 8-MP output image: SNR_out = sqrt(photons per output pixel)
    // illustrative exposure: 1.8 lx·s on the sensor at 18 % grey (≈ ISO 100 metering),
    // 4.09e3 photons/(lx·s·µm²) at 555 nm, quantum efficiency 0.5
    const Hlux = 1.8;
    const photonsPerUm2 = 4.09e3 * Hlux * 0.5;
    const data = M.R.map((r) => [r.S.w * r.S.h, Math.sqrt((photonsPerUm2 * r.area * 1e6) / 8e6)]);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Image SNR vs sensor area (same exposure)', x: { min: 8, max: 15000, log: true, label: 'sensor area (mm²), 8 MP output' }, y: { min: 20, max: 5000, log: true, label: 'SNR at 18 % grey' },
      series: [{ data: [[8, Math.sqrt((photonsPerUm2 * 8 * 1e6) / 8e6)], [15000, Math.sqrt((photonsPerUm2 * 15000 * 1e6) / 8e6)]], color: 'rgba(255,255,255,0.3)', dash: [4, 4], width: 1 }],
    });
    M.R.forEach((r, i) => {
      ctx.fillStyle = COLORS[r.i]; ctx.beginPath(); ctx.arc(X(data[i][0]), Y(data[i][1]), r.k === M.st.ref ? 5.5 : 4, 0, 7); ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('SNR ∝ √area: +1 EV of sensor area = +½ EV of SNR', w - 18, hh - 46);
  }

  update();

  root.append(theory('Equivalence, derived', String.raw`
<div class="theory-cols"><div>
<h3>Crop factor and field of view</h3>
<p>A rectilinear lens maps an angle \(\theta\) to image height \(y = f\tan\theta\). A sensor of width \(w\) therefore sees \(\mathrm{FOV} = 2\arctan(w/2f)\). The crop factor \(k = d_{36\times24}/d\), a ratio of diagonals, is the factor by which focal length must scale for the same diagonal field. For a different aspect ratio, the horizontal and vertical fields cannot both match.</p>
<h3>Why the entrance pupil is the invariant</h3>
<p>Take two cameras with the same angle of view and the same subject position, so their perspective is identical. Three photographic properties depend only on the entrance-pupil diameter \(D = f/N\):</p>
<ul>
<li><strong>Depth of field.</strong> The angular blur of an out-of-focus point is \(\beta = D\,|1/s - 1/d|\), independent of \(f\).</li>
<li><strong>Diffraction.</strong> The Airy angular radius is \(1.22\,\lambda/D\).</li>
<li><strong>Total light.</strong> The flux from the scene into the camera is \(L\cdot\pi D^2/4\cdot\Omega_\text{scene}\).</li>
</ul>
<p>Matching all three requires \(f' = f/k\) and \(N' = N/k\). Image-plane irradiance \(E\propto1/N^2\) then rises by \(k^2\) on the small sensor. Equal output brightness at equal shutter speed therefore needs \(\text{ISO}' = \text{ISO}/k^2\). This is the full equivalence relation:</p>
\[(f,\ N,\ \text{ISO})_{36\times24} \;\equiv\; (f/k,\ N/k,\ \text{ISO}/k^2)_{\text{crop }k}.\]
</div><div>
<h3>Why big sensors have less noise</h3>
<p>Photon arrival is Poisson-distributed, so a region collecting \(\bar n\) photoelectrons has \(\mathrm{SNR} = \bar n/\sqrt{\bar n}=\sqrt{\bar n}\). At the same f-number and shutter speed, irradiance is the same on every format. The photon count per <em>fraction of the frame</em> therefore scales with sensor area, and once the image is viewed at a common size,</p>
\[\mathrm{SNR}_\text{image}\propto\sqrt{A_\text{sensor}}\propto\frac{1}{k}.\]
<p>Full frame gathers about 2.3× more light than APS-C (1.2 EV) and about 12× more than a 1/1.3″ phone sensor (3.6 EV), if the f-number is the same. Pixel count is secondary: when shot noise dominates, binning many small pixels gives the same SNR as fewer large ones. Read noise per unit area is the second-order term. Phones recover the deficit computationally, by stacking a burst of frames.</p>
<h3>Diffraction-limited aperture</h3>
<p>The Airy diameter \(2.44\lambda N\) grows with \(N\). When it exceeds about two pixel pitches, stopping down further visibly softens the image. The table lists \(N_\text{DLA} = p/(1.22\lambda)\) for each sensor. A 50 MP 1/1.3″ phone sensor has 1.2 µm pixels and is diffraction-limited from about f/1.8, which is exactly the aperture of its lens. There is no headroom left, which is one reason phone "50 MP" modes normally bin 2×2.</p>
<h3>Cinema and astronomy</h3>
<p>Super 35 (about 1.45×) became the cinema standard because its depth of field at practical T-stops suits narrative focus pulling. "Large-format" cinema such as ALEXA 65 or IMAX deliberately gives this up. In astronomy, the corresponding quantity is the <strong>plate scale</strong> \(206\,265/f\) arcsec/mm. Light-gathering power and resolution are set by the aperture \(D\) alone, which is the same equivalence written for point sources.</p>
</div></div>`));
  root.append(references([
    'J. Nasse (Zeiss), "Depth of Field and Bokeh", Camera Lens News (2010).',
    'R. N. Clark, "Digital camera sensor performance summary" (clarkvision.com): photon-transfer data across formats.',
    'J. R. Janesick, <i>Photon Transfer: DN → λ</i>, SPIE Press (2007).',
    'ISO 12232:2019, Digital still cameras: determination of exposure index and ISO speed ratings.',
  ]));
  return () => [over, fov, snr].forEach((s) => s.destroy());
}
