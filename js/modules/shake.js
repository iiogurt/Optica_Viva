import { h, controls, stage, readouts, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest } from '../lib/compute.js';
import { plot } from '../lib/plot.js';
import { t } from '../lib/i18n.js';

const D2R = Math.PI / 180;
const SHAKE = { steady: { name: 'Steady (braced, experienced)', sigma: 0.5, tremor: 0.3 }, normal: { name: 'Normal hand-held', sigma: 1, tremor: 0.6 }, shaky: { name: 'Unsteady (cold, tired, moving)', sigma: 2, tremor: 1.2 } };
const fmtT = (t) => (t >= 0.3 ? t.toPrecision(2) + ' s' : '1/' + Math.round(1 / t));

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>No one holds a camera perfectly still. Hands drift and tremble by roughly a degree per second, and during the exposure every point of the image smears along that motion. The longer the exposure, and the more the lens magnifies, the longer the smear.</p>
<p>That gives the old rule: hand-held, the shutter time should be no longer than one over the focal length, such as 1/50 s with a 50 mm lens. <strong>Image stabilisers</strong> measure the motion with tiny gyroscopes and move a lens element or the sensor to cancel it, buying several stops of longer exposure, but not unlimited ones.</p>`, [
    "Without stabilisation, find the slowest sharp shutter speed at 50 mm, then at 200 mm.",
    "Turn <strong>Image stabilisation</strong> on and read the gain in stops; then raise the gyro noise and watch the gain shrink.",
    "Switch <strong>Sharp means</strong> to 2 pixels of a 45 MP sensor: the safe shutter speed gets much faster.",
  ]));

  const ctl = controls({
    f: { type: 'range', label: 'Focal length (full frame)', min: 12, max: 600, log: true, value: 50, unit: 'mm' },
    t: { type: 'range', label: 'Shutter speed', min: 1 / 8000, max: 4, log: true, value: 1 / 15, fmt: fmtT },
    shake: { type: 'select', label: 'Photographer', value: 'normal', options: Object.entries(SHAKE).map(([k, s]) => [k, s.name]) },
    crit: { type: 'seg', label: 'Sharp means', value: 'coc', options: [['coc', 'blur ≤ 0.03 mm (print)'], ['px', 'blur ≤ 2 px of 45 MP']] },
    stab: { type: 'toggle', label: 'Image stabilisation', value: true },
    fc: { type: 'range', label: 'Stabiliser bandwidth', min: 5, max: 60, step: 1, value: 30, unit: 'Hz', when: (st) => st.stab },
    arw: { type: 'range', label: 'Gyro angle random walk', min: 20, max: 1000, log: true, value: 200, unit: 'µrad/√s', when: (st) => st.stab },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const picture = stage({ aspect: 1, label: 'One exposure of a Siemens star at the chosen settings (resample with the button)', draw: drawPic, minH: 240 });
  const pathView = stage({ aspect: 1, label: 'Path of a point on the sensor during that exposure (grid: 45 MP pixels, 4.4 microns)', draw: drawPath, minH: 240 });
  const curve = stage({ aspect: 2.3, label: '', draw: drawCurve, cls: 'plain', minH: 210 });
  const btn = h('button.btn', { type: 'button' }, t('Take another shot'));
  root.append(lab([h('div.grid-2', {}, picture.el, pathView.el), h('div', {}, btn), h('div.card', { style: { padding: '6px' } }, curve.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('shake');
  let R = null, seed = 1;
  btn.addEventListener('click', () => { seed++; update(); });
  function update() {
    const st = ctl.state, sh = SHAKE[st.shake], limit = st.crit === 'coc' ? 0.03 : 2 * 0.0044;
    job('shake', { shake: { sigma: sh.sigma * D2R, tau: 0.25, tremor: sh.tremor * D2R, ftrem: 10 }, st: st.stab ? { fc: st.fc, arw: st.arw * 1e-6 } : null, f: st.f, limit, t: st.t, px: 0.0044, seed }).then((r) => {
      R = { ...r, st: { ...st }, limit };
      const gain = r.safeStab ? Math.log2(r.safeStab / r.safeRaw) : null;
      ro.replaceChildren(readouts([
        ['Blur of this shot (extent)', `${(r.blur.extent * 1000).toFixed(1)} µm = ${(r.blur.extent / 0.0044).toFixed(1)} px`],
        ['Rule of thumb 1/f', fmtT(1 / st.f)],
        ['Safe shutter, no stabiliser (50 % sharp)', fmtT(r.safeRaw)],
        ['Safe shutter, stabilised', r.safeStab ? fmtT(r.safeStab) : '—'],
        ['Stabilisation gain', gain !== null ? gain.toFixed(1) + ' EV' : '—'],
      ]));
      calc.say(`At ${fmt(st.f, 3)} mm and ${fmtT(st.t)} the image smears by about <strong>${(r.blur.extent * 1000).toFixed(0)} µm</strong>; ${st.stab && r.safeStab ? 'with' : 'without'} stabilisation the slowest reliably sharp shutter speed is <strong>${fmtT(st.stab && r.safeStab ? r.safeStab : r.safeRaw)}</strong>.`);
      calc.set(String.raw`\begin{aligned}
      b &\approx f\,\omega\,t \le c\\
      t &\le \frac{c}{f\,\omega} = ${texNum(limit / (st.f * Math.hypot(sh.sigma, sh.tremor) * D2R), 3)}\ \text{s}\\
      \Delta EV &= \log_2\frac{t_\text{stab}}{t_\text{hand}} = ${gain !== null ? texNum(gain, 3) : '—'}
      \end{aligned}`);
      [picture, pathView, curve].forEach((x) => x.redraw());
    });
  }
  function drawPic(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const ic = imageCanvas(R.W, R.W);
    for (let k = 0; k < R.W * R.W; k++) { const v = 255 * Math.pow(R.img[k], 1 / 2.2); ic.data[k * 4] = ic.data[k * 4 + 1] = ic.data[k * 4 + 2] = v; ic.data[k * 4 + 3] = 255; }
    ic.put();
    const sz = Math.min(w, hh) - 6; ctx.imageSmoothingEnabled = false; ctx.drawImage(ic.c, (w - sz) / 2, (hh - sz) / 2, sz, sz);
  }
  function drawPath(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const p = R.path;
    let mx = 0, my = 0; p.forEach(([x, y]) => { mx += x; my += y; }); mx /= p.length; my /= p.length;
    const ext = Math.max(4.4 * 3, ...p.map(([x, y]) => Math.max(Math.abs(x - mx), Math.abs(y - my)))) * 1.2, sc = (Math.min(w, hh) / 2 - 16) / ext, cx = w / 2, cy = hh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    if (4.4 * sc > 4) for (let g = -Math.ceil(ext / 4.4); g <= Math.ceil(ext / 4.4); g++) { ctx.beginPath(); ctx.moveTo(cx + g * 4.4 * sc, 0); ctx.lineTo(cx + g * 4.4 * sc, hh); ctx.moveTo(0, cy + g * 4.4 * sc); ctx.lineTo(w, cy + g * 4.4 * sc); ctx.stroke(); }
    // criterion circle
    ctx.strokeStyle = 'rgba(107,227,164,0.6)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(cx, cy, (R.limit * 1000 / 2) * sc, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.6; ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(cx + (x - mx) * sc, cy + (y - my) * sc) : ctx.moveTo(cx + (x - mx) * sc, cy + (y - my) * sc))); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(t('{v1} µm across · green: sharpness limit', { v1: (2 * ext).toFixed(0) }), 8, hh - 8);
  }
  function drawCurve(ctx, w, hh) {
    if (!R) return;
    const st = R.st;
    plot(ctx, w, hh, {
      title: t('Probability of a sharp frame at {f} mm', { f: st.f.toFixed(0) }), x: { min: 1e-4, max: 10, log: true, label: 'exposure time (s)' }, y: { min: 0, max: 1.02, label: 'P(sharp)' },
      series: [{ data: R.raw, color: '#ff9cc0', width: 2, label: 'hand-held' }, ...(R.stab ? [{ data: R.stab, color: '#6be3a4', width: 2, label: 'stabilised' }] : [])],
      vlines: [{ x: 1 / st.f, color: 'rgba(255,255,255,0.35)', label: '1/f' }, { x: st.t, color: 'rgba(255,181,71,0.6)', label: 'this shot', dy: 14 }],
      legend: true, legendX: w - 160, legendY: 34,
    });
  }

  update();

  root.append(rule(String.raw`\[t \le \frac{c}{f\,\omega}\]
<p>Turning at angular speed \(\omega\) moves the image across the sensor at \(f\omega\), so the blur stays below \(c\) only if the exposure \(t\) is short enough. With \(\omega \approx 1^\circ\)/s (0.017 rad/s) and \(c = 0.03\) mm, a 50 mm lens needs \(t \le 0.03/(50 \times 0.017) \approx 1/30\) s, and doubling the focal length halves the safe time. The classic \(1/f\) rule is this formula with a little safety margin.</p>`,
    String.raw`Hand motion is not a steady drift: in short exposures tremor at around 10 Hz dominates, and people differ a lot. Stabilisers are limited by their gyro noise and bandwidth, lens-based ones cannot correct rotation around the lens axis, and none of them stops the subject from moving.`));
  root.append(theory('Shake, the reciprocal rule and stabilisers', String.raw`
<div class="theory-cols"><div>
<h3>The motion of a hand-held camera</h3>
<p>Measurements of hand-held cameras show angular velocities of the order of 1°/s. A slow wander, here an Ornstein–Uhlenbeck velocity with 0.25 s correlation time, is superposed on physiological tremor near 8–12 Hz. Translation matters only in close-up work and is not modelled. During an exposure \(t\) the image of a point moves along \(f\,\theta(t)\), and that path is the point-spread function of the shot.</p>
<h3>Why "1/f"</h3>
<p>For short exposures the angle changes almost linearly, so the blur is \(b\approx f\,\omega\,t\). Demanding \(b\le c\) gives</p>
\[t \le \frac{c}{f\,\omega}.\]
<p>With \(c = 0.03\) mm and \(\omega \approx 0.02\) rad/s this is about \(1.5/f\), close to the rule of thumb \(t\le 1/f\) (in seconds, f in mm, full frame). Being a statistical statement, it holds for roughly half the frames. The simulation measures the full probability curve over many random exposures. For pixel-level sharpness on a 45 MP sensor the safe time is about four times shorter.</p>
</div><div>
<h3>Stabilisers</h3>
<p>Gyroscopes measure the angular rate, and a servo moves a lens group (OIS) or the sensor (IBIS) to cancel the image motion. A type-2 servo of bandwidth \(f_c\) leaves a residual that falls as \((f/f_c)^2\) below the bandwidth, so the slow wander is removed almost completely and tremor is cut by an order of magnitude. What remains grows with time: the gyro's angle random walk, \(\sigma_\theta = \mathrm{ARW}\sqrt t\), which integration of rate noise makes unavoidable. That is why stabilisation is rated in stops (CIPA DC-011) and why the rating falls with focal length. Roll about the optical axis and translation of the camera, which real 5-axis systems also correct, are not modelled.</p>
</div></div>`));
  root.append(references([
    'CIPA DC-011, <em>Measurement method and notation of image stabilization performance of digital cameras</em> (CIPA, 2012/2024).',
    'B. Golik, “Development of a test method for image stabilizing systems”, diploma thesis, Cologne University of Applied Sciences (2006).',
    'N. Joshi, S. B. Kang, C. L. Zitnick &amp; R. Szeliski, “Image deblurring using inertial measurement sensors”, <em>ACM Trans. Graph.</em> 29 (2010).',
  ]));

  return () => [picture, pathView, curve].forEach((x) => x.destroy());
}
