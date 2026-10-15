// Mission: a security camera that can recognise a face, or a drone that maps a field sharply.
import { h, controls, stage, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { MODULES } from '../app.js';
import { DORI, security, drone } from '../lib/survey.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const isSec = (st) => st.mode === 'sec', isDrone = (st) => st.mode === 'drone';
const COL = { Detection: '#9aa1b5', Observation: '#6ad7ff', Recognition: '#ffb547', Identification: '#6be3a4' };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video', 'photo'] }));
  root.append(idea(String.raw`<p>Whether a camera can recognise a face or count cracks in a roof depends on one number: how many pixels land on each metre of the target. A wide-angle security camera with millions of pixels may still give a face at 20 m only a handful of them. Standards for security cameras name four levels, from merely seeing that someone is there to telling who it is.</p>
<p>A camera moving over the ground, on a drone, adds two more limits: the shutter must be short enough that the ground does not smear, and photos must overlap enough to be stitched into a map.</p>`, [
    'With the security camera, walk the person from 5 m to 30 m: watch the face lose its features.',
    'Swap the 4 mm lens for 12 mm: recognition reaches three times farther, but the view narrows.',
    'Switch to the <strong>Drone</strong> and raise the speed to 15 m/s: the safe shutter time shrinks.',
  ]));

  const ctl = controls({
    mode: { type: 'seg', label: 'Use', value: 'sec', options: [['sec', 'Security camera'], ['drone', 'Drone survey']] },
    nx: { type: 'range', label: 'Horizontal pixels', min: 640, max: 7680, log: true, value: 2560, fmt: (v) => Math.round(v), when: isSec },
    w: { type: 'range', label: 'Sensor width', min: 3, max: 13.2, step: 0.1, value: 5.6, unit: 'mm', when: isSec },
    f: { type: 'range', label: 'Focal length', min: 2, max: 50, log: true, value: 4, unit: 'mm', when: isSec },
    d: { type: 'range', label: 'Distance to the person', min: 2, max: 100, log: true, value: 10, unit: 'm', when: isSec },
    v: { type: 'range', label: 'Walking speed', min: 0.5, max: 8, step: 0.1, value: 1.5, unit: 'm/s', when: isSec },
    t: { type: 'range', label: 'Shutter time (1/x s)', min: 25, max: 2000, log: true, value: 100, fmt: (v) => '1/' + Math.round(v), when: isSec },
    A: { type: 'range', label: 'Flight altitude', min: 20, max: 120, step: 1, value: 80, unit: 'm', when: isDrone },
    df: { type: 'range', label: 'Focal length', min: 4, max: 35, log: true, value: 8.8, unit: 'mm', when: isDrone },
    dv: { type: 'range', label: 'Ground speed', min: 2, max: 20, step: 0.5, value: 8, unit: 'm/s', when: isDrone },
    overlap: { type: 'range', label: 'Forward overlap', min: 0.5, max: 0.9, step: 0.01, value: 0.75, fmt: (v) => (v * 100).toFixed(0) + ' %', when: isDrone },
    dt: { type: 'range', label: 'Shutter time (1/x s)', min: 100, max: 4000, log: true, value: 1000, fmt: (v) => '1/' + Math.round(v), when: isDrone },
    shutter: { type: 'seg', label: 'Shutter type', value: 'rolling', options: [['rolling', 'Rolling (30 ms)'], ['global', 'Mechanical or global']], when: isDrone },
  }, () => update());
  const calc = liveCalc('Your plan');
  const steps = [1, 2, 3, 4].map((n) => missionStep(n, '', null, ''));
  const view = stage({ aspect: 2.4, label: '', draw: drawView, cls: 'plain', minH: 220 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), h('div.card', { style: { padding: '8px' } }, view.el)], [h('div.card', {}, ctl.el), calc.el]));

  const setTitle = (k, title, labId) => {
    const el = steps[k].el;
    el.querySelector('h3').textContent = title;
    el.querySelector('.mstep-lab')?.remove();
    if (labId) el.append(h('a.mstep-lab', { href: '#/' + labId }, 'Explore: ' + titleOf(labId) + ' →'));
  };

  let M = null;
  function update() {
    const st = ctl.state;
    if (isSec(st)) {
      const r = security({ nx: st.nx, w: st.w / 1000, f: st.f / 1000, d: st.d, v: st.v, t: 1 / st.t });
      M = { st, r };
      setTitle(0, 'Pixels on the person', 'sampling'); setTitle(1, 'Reach of each level', 'sensor'); setTitle(2, 'Motion blur', 'shake'); setTitle(3, 'Rolling shutter', 'motion');
      steps[0].set({
        answer: `${r.ppm.toFixed(0)} px/m <small>(${r.level})</small>`,
        why: `At ${st.d} m the view is ${r.width.toFixed(1)} m wide, so each metre gets ${r.ppm.toFixed(0)} pixels and a face (16 cm wide) about ${(0.16 * r.ppm).toFixed(0)}. IEC 62676-4 asks for 25, 62.5, 125 and 250 px/m to detect, observe, recognise and identify a person.`,
        tex: String.raw`\rho = \frac{n_x f}{w\,d} = ${texNum(r.ppm, 3)}\ \text{px/m}`,
      });
      steps[1].set({
        answer: `${r.maxDist[2][1].toFixed(0)} m <small>to recognise</small>`,
        why: r.maxDist.map(([n, x]) => `${n}: up to ${x.toFixed(0)} m`).join(' · ') + `. A longer lens reaches farther in proportion but sees a narrower ${(r.hfov * 180 / Math.PI).toFixed(0)}° field.`,
        tex: String.raw`d_\text{max} = \frac{n_x f}{w\,\rho_\text{level}}`,
      });
      steps[2].set({
        answer: `${r.blur.toFixed(1)} px <small>of blur</small>`,
        why: `Walking at ${st.v} m/s for 1/${Math.round(st.t)} s smears a person by ${r.blur.toFixed(1)} pixels at this pixel density. ${r.blur > 1 ? `Use 1/${Math.ceil(st.v * r.ppm)} s or faster for under one pixel; at night that needs more light or gain.` : 'That is below a pixel.'}`,
        tex: String.raw`b = v\,t\,\rho`,
      });
      steps[3].set({
        answer: `${r.skew.toFixed(0)} px skew`,
        why: `A 20 ms rolling readout lets a walking person move ${(st.v * 0.02 * 100).toFixed(0)} cm between the top and bottom rows, ${r.skew.toFixed(0)} pixels here: upright edges lean slightly.`,
        tex: String.raw`s = v\,T_\text{read}\,\rho`,
      });
      calc.say(`At ${st.d} m this camera gives <strong>${r.ppm.toFixed(0)} pixels per metre</strong> (${r.level.toLowerCase()}); it can recognise a person up to <strong>${r.maxDist[2][1].toFixed(0)} m</strong> and identify one up to ${r.maxDist[3][1].toFixed(0)} m.`);
      calc.set(String.raw`W = \frac{w\,d}{f} = ${texNum(r.width, 3)}\ \text{m},\quad \rho = \frac{n_x}{W}`);
    } else {
      const p = 2.4e-6, r = drone({ A: st.A, p, f: st.df / 1000, sw: 13.2e-3, sh: 8.8e-3, v: st.dv, overlap: st.overlap, t: 1 / st.dt, readout: st.shutter === 'rolling' ? 0.03 : 0 });
      M = { st, r };
      setTitle(0, 'Ground sample distance', 'earthobs'); setTitle(1, 'Photo interval', null); setTitle(2, 'Shutter', 'shake'); setTitle(3, 'Rolling shutter', 'motion');
      steps[0].set({
        answer: `${(r.gsd * 100).toFixed(1)} cm`,
        why: `A 20 MP 1″ sensor (2.4 µm pixels) behind ${st.df} mm at ${st.A} m: each pixel covers ${(r.gsd * 100).toFixed(1)} cm, and one photo ${r.across.toFixed(0)} × ${r.along.toFixed(0)} m.`,
        tex: String.raw`\text{GSD} = \frac{A\,p}{f} = ${texNum(r.gsd * 100, 3)}\ \text{cm}`,
      });
      steps[1].set({
        answer: `every ${r.interval.toFixed(1)} s`,
        why: `For ${(st.overlap * 100).toFixed(0)} % forward overlap the drone may fly ${(r.along * (1 - st.overlap)).toFixed(0)} m between photos; at ${st.dv} m/s that is one photo every ${r.interval.toFixed(1)} s.`,
        tex: String.raw`\Delta t = \frac{L_\text{along}(1-o)}{v}`,
      });
      steps[2].set({
        answer: `≤ 1/${Math.ceil(1 / r.tMax)} s`,
        why: `To keep motion blur under half a pixel, the shutter must be shorter than ${(r.tMax * 1000).toFixed(2)} ms. At 1/${Math.round(st.dt)} s the blur is ${r.blur.toFixed(2)} px${r.blur > 0.5 ? ': too much for sharp maps' : ''}.`,
        tex: String.raw`t \le \frac{\text{GSD}}{2v}`,
      });
      steps[3].set({
        answer: st.shutter === 'rolling' ? `${r.skew.toFixed(0)} px skew` : 'none',
        why: st.shutter === 'rolling' ? `A 30 ms rolling readout lets the drone move ${(st.dv * 0.03).toFixed(2)} m during one frame: ${r.skew.toFixed(0)} pixels of skew, which mapping software must model or a mechanical shutter avoid.` : 'A mechanical or global shutter exposes all rows at once: no skew.',
        tex: String.raw`s = \frac{v\,T_\text{read}}{\text{GSD}}`,
      });
      calc.say(`<strong>${(r.gsd * 100).toFixed(1)} cm per pixel</strong> from ${st.A} m; shoot every ${r.interval.toFixed(1)} s at 1/${Math.ceil(1 / r.tMax)} s or faster${st.shutter === 'rolling' ? `, and account for ${r.skew.toFixed(0)} px of rolling-shutter skew` : ''}.`);
      calc.set(String.raw`L = \frac{A\,s}{f}:\ ${texNum(r.across, 3)} \times ${texNum(r.along, 3)}\ \text{m}`);
    }
    view.redraw();
  }

  function drawView(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!M) return;
    if (isSec(M.st)) {
      // the DORI zones along the distance axis, and the face at this pixel density
      const r = M.r, dmax = Math.max(80, r.maxDist[0][1] * 1.1), x0 = 20, x1 = w - 220, X = (d) => x0 + (Math.log(d / 1) / Math.log(dmax / 1)) * (x1 - x0);
      let prev = 1;
      [...r.maxDist].reverse().forEach(([name, dm]) => { ctx.fillStyle = COL[name]; ctx.globalAlpha = 0.35; ctx.fillRect(X(prev), 40, X(Math.min(dm, dmax)) - X(prev), 26); ctx.globalAlpha = 1; ctx.fillStyle = '#e9ebf3'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; if (X(Math.min(dm, dmax)) - X(prev) > 60) ctx.fillText(name, (X(prev) + X(Math.min(dm, dmax))) / 2, 57); prev = dm; });
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(M.st.d), 34); ctx.lineTo(X(M.st.d), 72); ctx.stroke();
      ctx.fillStyle = '#9aa1b5'; ctx.textAlign = 'center';
      for (const tk of [1, 2, 5, 10, 20, 50, 100]) if (tk <= dmax) { ctx.fillRect(X(tk), 66, 1, 5); ctx.fillText(tk + ' m', X(tk), 84); }
      ctx.textAlign = 'left'; ctx.fillText('distance to the person (logarithmic)', x0, 104); ctx.fillText(`person at ${M.st.d} m`, Math.min(X(M.st.d) + 4, x1 - 80), 30);
      // a face 16 × 22 cm drawn on the pixel grid
      const n = Math.max(1, Math.round(0.16 * r.ppm)), m = Math.max(1, Math.round(0.22 * r.ppm)), ic = imageCanvas(n, m);
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
        let acc = 0; const ss = 4;
        for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) {
          const u = ((i + (a + 0.5) / ss) / n) * 2 - 1, v = ((j + (b + 0.5) / ss) / m) * 2 - 1;
          let val = u * u + v * v < 1 ? 0.75 : 0.15;
          if (Math.hypot(u + 0.38, v + 0.2) < 0.13 || Math.hypot(u - 0.38, v + 0.2) < 0.13) val = 0.1;
          if (Math.abs(u) < 0.09 && v > -0.15 && v < 0.25) val = 0.55;
          if (Math.abs(u) < 0.35 && Math.abs(v - 0.5) < 0.06) val = 0.25;
          if (v < -0.55 && u * u + v * v < 1) val = 0.3;
          acc += val;
        }
        const g = (acc / (ss * ss)) * 255, k = 4 * (j * n + i);
        ic.data[k] = g; ic.data[k + 1] = g * 0.92; ic.data[k + 2] = g * 0.85; ic.data[k + 3] = 255;
      }
      ic.put();
      ctx.imageSmoothingEnabled = false;
      const fh = hh - 30, fw = (fh * 0.16) / 0.22;
      ctx.drawImage(ic.c, w - 20 - fw, 14, fw, fh);
      ctx.fillStyle = '#9aa1b5'; ctx.textAlign = 'right'; ctx.fillText(`face: ${n} × ${m} px`, w - 20, hh - 4);
    } else {
      // footprints along the flight line with the forward overlap
      const r = M.r, s = Math.min((w - 40) / (r.along * 3.2), (hh - 60) / r.across);
      for (let k = 0; k < 4; k++) {
        const x = 20 + k * r.along * (1 - M.st.overlap) * s;
        ctx.strokeStyle = k % 2 ? '#6ad7ff' : '#ffb547'; ctx.fillStyle = k % 2 ? 'rgba(106,215,255,0.08)' : 'rgba(255,181,71,0.08)';
        ctx.fillRect(x, 30, r.along * s, r.across * s); ctx.strokeRect(x, 30, r.along * s, r.across * s);
      }
      ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`photo footprints ${r.along.toFixed(0)} m along × ${r.across.toFixed(0)} m across, ${(M.st.overlap * 100).toFixed(0)} % overlap; flight direction →`, 20, 20);
    }
  }

  update();

  root.append(rule(String.raw`\[\rho = \frac{n_x\,f}{w\,d}\]
<p>Pixels per metre on the target fall in proportion to distance. A 2560-pixel camera with a 4 mm lens on a 5.6 mm sensor sees a 14 m wide view at 10 m: 183 px/m, enough to recognise a person (125 px/m) but not to identify one (250 px/m), which needs the person within 7 m or a lens three times longer. For a drone the same law gives the ground sample distance \(Ap/f\): 2.4 µm pixels behind 8.8 mm from 80 m cover 2.2 cm.</p>`,
    String.raw`Pixel density is necessary, not sufficient: the lens must resolve those pixels, compression and noise at night remove detail, and recognition by people or software also depends on lighting, angle and contrast. The DORI levels refer to a person at the target distance in good conditions.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Security camera</h3>
<p>The horizontal field at distance \(d\) is \(W = wd/f\), the pixel density \(\rho = n_x/W\), and the distance limit for a level \(\rho_L\) is \(n_x f/(w\rho_L)\). The levels of IEC 62676-4 are 25 (detection), 62.5 (observation), 125 (recognition) and 250 px/m (identification). A walking person blurs by \(v t \rho\) pixels during the exposure and is skewed by \(v T_\text{read}\rho\) pixels by a 20 ms rolling readout.</p>
</div><div>
<h3>Drone survey</h3>
<p>The ground sample distance is \(Ap/f\) and one photo covers \(As_w/f \times As_h/f\). Forward overlap \(o\) sets the distance between photos, \(L_\text{along}(1-o)\), and the interval at speed \(v\). Motion blur \(vt/\text{GSD}\) stays below half a pixel for \(t \le \text{GSD}/(2v)\), and a rolling shutter reading out in 30 ms skews the frame by \(vT_\text{read}/\text{GSD}\) pixels.</p>
</div></div>`));
  root.append(references([
    'IEC 62676-4:2015, <i>Video surveillance systems for use in security applications — Part 4: Application guidelines</i>: DORI pixel densities.',
    'J. Johnson, "Analysis of image forming systems", Image Intensifier Symposium, Fort Belvoir (1958): resolution criteria for detection, recognition and identification.',
    'ASPRS, <i>Manual of Photogrammetry</i>, 6th ed. (2013): ground sample distance, overlap and image motion.',
  ]));
}
