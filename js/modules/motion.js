import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot, range } from '../lib/plot.js';

const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'A camera samples time as well as space. A rolling-shutter sensor reads its rows one after another, so fast motion is sheared and bent. Video samples motion at a fixed frame rate, so a spinning wheel can appear to stop or turn backwards. Exposures that do not span whole cycles of a flickering light leave dark bands across the frame. These are all sampling theory, applied to the time axis.', domains: ['video', 'photo'] }));

  const ctl = controls({
    h1: { type: 'heading', label: 'Rolling shutter' },
    rpm: { type: 'range', label: 'Propeller speed', min: 0, max: 3000, step: 10, value: 1200, unit: 'rpm' },
    blades: { type: 'range', label: 'Blades', min: 2, max: 6, step: 1, value: 3 },
    readout: { type: 'range', label: 'Sensor readout time (top → bottom)', min: 0, max: 40, step: 0.5, value: 16, unit: 'ms' },
    exp: { type: 'range', label: 'Exposure per row', min: 0.05, max: 10, log: true, value: 0.25, unit: 'ms' },
    h2: { type: 'heading', label: 'Frame rate & shutter angle' },
    fps: { type: 'range', label: 'Frame rate', min: 12, max: 120, step: 1, value: 24, unit: 'fps' },
    angle: { type: 'range', label: 'Shutter angle', min: 5, max: 360, step: 5, value: 180, unit: '°' },
    wrpm: { type: 'range', label: 'Wheel speed', min: 0, max: 600, step: 1, value: 172, unit: 'rpm' },
    spokes: { type: 'range', label: 'Spokes', min: 3, max: 16, step: 1, value: 8 },
    h3: { type: 'heading', label: 'Flicker' },
    flick: { type: 'seg', label: 'Light flicker', value: '100', options: [['100', '100 Hz (50 Hz mains)'], ['120', '120 Hz (60 Hz mains)'], ['pwm', 'LED PWM 400 Hz']] },
    depth: { type: 'range', label: 'Modulation depth', min: 0, max: 1, step: 0.01, value: 0.8 },
    fexp: { type: 'range', label: 'Exposure (flicker test)', min: 0.1, max: 25, log: true, value: 2, unit: 'ms' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const rs = stage({ aspect: 1, label: 'Rolling shutter', draw: (c, w, hh) => blit(c, w, hh, P.rolling) });
  const gs = stage({ aspect: 1, label: 'Global shutter (same exposure)', draw: (c, w, hh) => blit(c, w, hh, P.global) });
  const wheel = stage({ aspect: 1, label: 'Wheel as filmed (live playback)', draw: drawWheel });
  const alias = stage({ aspect: 1.6, label: '', draw: drawAlias, cls: 'plain' });
  const band = stage({ aspect: 1.6, label: 'Flicker banding (rolling shutter)', draw: (c, w, hh) => blit(c, w, hh, P.band) });
  const bandP = stage({ aspect: 1.6, label: '', draw: drawBand, cls: 'plain' });
  root.append(lab([h('div.grid-2', {}, rs.el, gs.el), h('div.grid-2', {}, wheel.el, h('div.card', { style: { padding: '6px' } }, alias.el)), h('div.grid-2', {}, band.el, h('div.card', { style: { padding: '6px' } }, bandP.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const P = {};
  function blit(ctx, w, hh, c) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!c) return;
    const sc = Math.min(w / c.width, hh / c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, (w - c.width * sc) / 2, (hh - c.height * sc) / 2, c.width * sc, c.height * sc);
  }

  function propeller(rolling) {
    const st = ctl.state, N = 220, ic = imageCanvas(N, N);
    const om = (st.rpm / 60) * 2 * Math.PI, tr = st.readout / 1000, te = st.exp / 1000, K = 10;
    for (let y = 0; y < N; y++) {
      const t0 = rolling ? (y / N) * tr : tr / 2;
      for (let x = 0; x < N; x++) {
        const dx = (x - N / 2) / (N / 2), dy = (y - N / 2) / (N / 2), r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        let cover = 0;
        if (r < 0.95 && r > 0.1) for (let s = 0; s < K; s++) {
          const t = t0 + ((s + 0.5) / K) * te;
          for (let b = 0; b < st.blades; b++) {
            const phi = om * t + (2 * Math.PI * b) / st.blades;
            const half = 0.2 * (1 - 0.55 * r) + 0.04;
            if (Math.abs(wrap(th - phi - 0.25 * r)) < half) { cover++; break; }
          }
        }
        const v = r <= 0.1 ? 1 : cover / K;
        const sky = [92 + 40 * (y / N), 140 + 40 * (y / N), 205];
        const o = (y * N + x) * 4;
        ic.data[o] = sky[0] * (1 - v) + 30 * v; ic.data[o + 1] = sky[1] * (1 - v) + 28 * v; ic.data[o + 2] = sky[2] * (1 - v) + 34 * v; ic.data[o + 3] = 255;
      }
    }
    ic.put();
    return ic.c;
  }

  function flicker() {
    const st = ctl.state, W = 240, H = 150, ic = imageCanvas(W, H);
    const f = st.flick === 'pwm' ? 400 : +st.flick, tr = st.readout / 1000, te = st.fexp / 1000, m = st.depth;
    const light = (t) => (st.flick === 'pwm' ? ((t * f) % 1 < 1 - m * 0.75 ? 1 : 1 - m) : 1 + m * Math.sin(2 * Math.PI * f * t));
    const rows = [];
    for (let y = 0; y < H; y++) {
      const t0 = (y / H) * tr; let s = 0; const K = 200;
      for (let k = 0; k < K; k++) s += light(t0 + ((k + 0.5) / K) * te);
      rows.push(s / K);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const base = 0.62 + 0.06 * Math.cos((x - W / 2) / 70); // an evenly lit wall
      const v = Math.min(1, base * rows[y] * 0.8), o = (y * W + x) * 4;
      ic.data[o] = 255 * v; ic.data[o + 1] = 235 * v; ic.data[o + 2] = 205 * v; ic.data[o + 3] = 255;
    }
    ic.put();
    P.rows = rows;
    return ic.c;
  }

  function update() {
    const st = ctl.state;
    P.rolling = propeller(true); P.global = propeller(false); P.band = flicker();
    const fSpoke = (st.wrpm / 60) * st.spokes, fa = fSpoke - st.fps * Math.round(fSpoke / st.fps);
    const appRpm = (fa / st.spokes) * 60;
    const texp = st.angle / 360 / st.fps;
    const f = st.flick === 'pwm' ? 400 : +st.flick;
    const tipSpeed = (st.rpm / 60) * 2 * Math.PI; // rad/s
    ro.replaceChildren(readouts([
      ['Propeller rotation during readout', ((tipSpeed * st.readout) / 1000 * 180 / Math.PI).toFixed(0) + '°'],
      ['Blade rotation during one row exposure', ((tipSpeed * st.exp) / 1000 * 180 / Math.PI).toFixed(1) + '°'],
      ['Frame exposure (angle/360 · 1/fps)', '1/' + Math.round(1 / texp) + ' s'],
      ['Spoke-passing frequency', fSpoke.toFixed(2) + ' Hz'],
      ['Apparent wheel speed', appRpm.toFixed(1) + ' rpm' + (Math.abs(appRpm) < 0.5 ? ' (frozen)' : appRpm * st.wrpm < 0 ? ' (backwards!)' : '')],
      ['Exposure / flicker period', (st.fexp / (1000 / f)).toFixed(2) + ' cycles'],
      ['Flicker bands across frame', ((st.readout / 1000) * f).toFixed(1)],
    ]));
    calc.set(String.raw`\begin{aligned}
    t_\text{row}(y) &= t_0 + \frac{y}{H}T_\text{read}\\
    t_\text{exp} &= \frac{\theta_\text{shutter}}{360^\circ}\cdot\frac{1}{f_\text{fps}} = \frac{${st.angle}}{360\times${st.fps}}\ \text{s}\\
    f_\text{app} &= f - f_s\,\mathrm{round}(f/f_s) = ${texNum(fa, 3)}\ \text{Hz}\\
    I(y) &= \frac{1}{t_e}\int_{t(y)}^{t(y)+t_e}\!L(t)\,dt
    \end{aligned}`);
    [rs, gs, alias, band, bandP].forEach((s) => s.redraw());
  }

  // live wheel playback: each displayed frame is a camera frame integrated over the shutter interval
  let raf = 0, t0 = performance.now();
  function drawWheel(ctx, w, hh) {
    const st = ctl.state;
    ctx.fillStyle = '#0a0b10'; ctx.fillRect(0, 0, w, hh);
    const now = (performance.now() - t0) / 1000;
    const frame = Math.floor(now * st.fps), tStart = frame / st.fps, te = st.angle / 360 / st.fps;
    const om = (st.wrpm / 60) * 2 * Math.PI, R = Math.min(w, hh) * 0.4, cx = w / 2, cy = hh / 2;
    const K = 24;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = '#d8dde8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1 / K * 2.2; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffd27a';
    for (let s = 0; s < K; s++) {
      const a = om * (tStart + ((s + 0.5) / K) * te);
      ctx.beginPath();
      for (let k = 0; k < st.spokes; k++) { const b = a + (2 * Math.PI * k) / st.spokes; ctx.moveTo(0, 0); ctx.lineTo(R * Math.cos(b), R * Math.sin(b)); }
      ctx.stroke();
      // a red marker on one spoke reveals the true direction of rotation
      ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(R * 0.75 * Math.cos(a), R * 0.75 * Math.sin(a), 7, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${st.fps} fps · ${st.angle}° · frame ${frame}`, w - 10, hh - 10);
  }
  const loop = () => { wheel.redraw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  function drawAlias(ctx, w, hh) {
    const st = ctl.state, xs = range(0, 600, 400);
    const app = (rpm) => { const f = (rpm / 60) * st.spokes; return ((f - st.fps * Math.round(f / st.fps)) / st.spokes) * 60; };
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Wagon-wheel effect: apparent vs true speed', x: { min: 0, max: 600, label: 'true wheel speed (rpm)' }, y: { min: -(st.fps / st.spokes) * 30 * 1.1, max: (st.fps / st.spokes) * 30 * 1.1, label: 'apparent (rpm)' },
      series: [{ data: xs.map((r) => [r, app(r)]), color: '#6ad7ff', width: 2 }],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.3)', dash: [] }],
      vlines: [1, 2, 3].map((k) => ({ x: (k * st.fps * 60) / st.spokes, color: 'rgba(107,227,164,0.5)', label: k === 1 ? 'frozen' : '' })),
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(st.wrpm), Y(app(st.wrpm)), 5, 0, 7); ctx.fill();
  }
  function drawBand(ctx, w, hh) {
    if (!P.rows) return;
    plot(ctx, w, hh, {
      title: 'Row brightness (exposure-integrated light)', x: { min: 0, max: P.rows.length - 1, label: 'sensor row (read order →)' }, y: { min: 0, max: 2, label: 'relative signal' },
      series: [{ data: P.rows.map((v, i) => [i, v]), color: '#ffb547', width: 2 }],
      hlines: [{ y: 1, color: 'rgba(255,255,255,0.3)', label: 'mean' }],
    });
  }

  update();

  root.append(theory('Sampling in time', String.raw`
<div class="theory-cols"><div>
<h3>Rolling shutter</h3>
<p>Most CMOS sensors reset and read rows sequentially. Row \(y\) of an \(H\)-row frame starts integrating at \(t(y) = t_0 + (y/H)\,T_\text{read}\). An object moving with image velocity \(\mathbf v\) is therefore sheared: vertical lines tilt by \(\arctan(v_x T_\text{read}/H)\). Rotating objects bend into the characteristic curved, detached propeller blades. The page renders this exactly, by evaluating the scene at each row's own time and integrating over the exposure with 10 sub-samples for motion blur. Typical readout times are 20–30 ms for phones and older large sensors, 4–8 ms for stacked sensors with on-chip memory, and 0 for global shutters, which need a storage node in every pixel.</p>
<h3>Shutter angle and motion blur</h3>
<p>Cinema describes exposure as the fraction of the frame period the shutter is open, inherited from rotating-disk shutters: \(t_e = (\theta/360^\circ)/f_\text{fps}\). The 180° rule (1/48 s at 24 fps) gives blur trails half as long as each frame's motion. That is the look audiences read as natural motion. Narrow angles give the staccato, strobed look of battle scenes. 360° gives smeared, dreamlike motion.</p>
</div><div>
<h3>Temporal aliasing: the wagon-wheel effect</h3>
<p>A wheel with \(k\) identical spokes turning at \(\nu\) rev/s presents a periodic signal at \(f = k\nu\). Sampled at \(f_s\) frames per second, it appears at</p>
\[f_\text{app} = f - f_s\,\mathrm{round}\!\left(\frac{f}{f_s}\right),\qquad \nu_\text{app} = f_\text{app}/k.\]
<p>When \(f\) is a multiple of \(f_s\) the wheel freezes, and just below it the wheel turns slowly backwards. Motion blur from a wide shutter angle is the temporal anti-aliasing filter. It averages the spokes into a grey disk before sampling, just as an OLPF does spatially (see <a href="#/sampling">Aliasing</a>).</p>
<h3>Flicker banding</h3>
<p>Mains-powered lights flicker at twice the line frequency (100 or 120 Hz), and PWM-dimmed LEDs at hundreds of Hz to kHz. Each row integrates the light over its own window:</p>
\[I(y) = \frac{1}{t_e}\int_{t(y)}^{t(y)+t_e}L(t)\,dt.\]
<p>When \(t_e\) is a whole number of flicker periods (1/100, 1/50 s…) the integral is the same for every row and the bands vanish. Otherwise the modulation survives, with about \(T_\text{read}\cdot f\) bands across the frame. "Flicker-free" shutter modes simply quantise \(t_e\) to those values.</p>
</div></div>`));
  root.append(references([
    'C.-K. Liang, L.-W. Chang &amp; H. H. Chen, "Analysis and compensation of rolling shutter effect", IEEE Trans. Image Process. 17, 1323 (2008).',
    'E. H. Adelson &amp; J. R. Bergen, "Spatiotemporal energy models for the perception of motion", JOSA A 2, 284 (1985).',
    'IEEE 1789-2015, "Recommended practices for modulating current in high-brightness LEDs for mitigating health risks to viewers".',
  ]));
  return () => { cancelAnimationFrame(raf); [rs, gs, wheel, alias, band, bandP].forEach((s) => s.destroy()); };
}
