// Mission: photograph a total solar eclipse, from the partial phases to the outer corona.
import { h, controls, stage, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { MODULES } from '../app.js';
import { SENSORS, pitchUm } from '../lib/sensors.js';
import { SUBJECTS, exposure, nearestShutter, coronaQ, driftLimit, fFor, SUN_RADIUS } from '../lib/eclipse.js';
import { t } from '../lib/i18n.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const fmtT = (t) => (t >= 1 ? t.toPrecision(2) + ' s' : '1/' + Math.round(1 / t) + ' s');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>During a total solar eclipse the Moon covers the Sun for a few minutes and the faint outer atmosphere of the Sun, the <strong>corona</strong>, appears around the black disc. Before and after, the uncovered Sun is as dangerous as ever: the camera and your eyes need a proper solar filter that blocks all but a hundred-thousandth of the light.</p>
<p>The corona itself spans an enormous range of brightness, from glowing pink flames at the edge to faint streamers far out, more than any single exposure can hold. Photographers therefore shoot a fast ladder of exposures during totality and merge them. This mission plans the filter, the framing, the ladder and whether you need a tracking mount.</p>`, [
    'Compare the <strong>single exposure</strong> with the <strong>merged ladder</strong>: the inner glow burns out or the outer streamers vanish, never both visible at once.',
    'Raise the <strong>focal length</strong> from 400 to 1200 mm: the Sun grows, but the outer corona no longer fits.',
    'Switch the mount to <strong>tripod</strong>: the long corona exposures smear by many pixels.',
  ]));

  const ctl = controls({
    sensor: { type: 'select', label: 'Camera sensor', value: 'ff', options: ['ff', 'apsc', 'mft'].map((k) => [k, SENSORS[k].name]) },
    f: { type: 'range', label: 'Focal length', min: 100, max: 2000, log: true, value: 500, unit: 'mm' },
    N: { type: 'range', label: 'Aperture', min: 4, max: 16, log: true, value: 8, fmt: (v) => 'f/' + v.toPrecision(2) },
    iso: { type: 'range', label: 'ISO', min: 100, max: 1600, log: true, value: 200, fmt: (v) => Math.round(v) },
    mount: { type: 'seg', label: 'Mount', value: 'track', options: [['tripod', 'Fixed tripod'], ['track', 'Tracking mount']] },
    dur: { type: 'range', label: 'Length of totality', min: 30, max: 300, step: 5, value: 150, unit: 's' },
    fps: { type: 'range', label: 'Camera frames per second (bracketing)', min: 1, max: 20, step: 1, value: 5 },
    showQ: { type: 'range', label: 'Single exposure shown (brightness exponent Q)', min: -3, max: 12, step: 1, value: 1 },
  }, () => update());
  const calc = liveCalc('Your plan');
  const steps = [
    missionStep(1, 'Filter for the partial phases', null, ''),
    missionStep(2, 'Framing', 'telescope', titleOf('telescope')),
    missionStep(3, 'Totality ladder', 'hdr', titleOf('hdr')),
    missionStep(4, 'Mount', 'mission-milkyway', titleOf('mission-milkyway')),
  ];
  const view = stage({ aspect: 2.3, label: 'The corona: one exposure and the merged ladder (streamer shapes illustrative)', draw: drawCorona, minH: 240 });
  const chart = stage({ aspect: 2.4, label: '', draw: drawLadder, cls: 'plain', minH: 240 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), view.el, h('div.card', { style: { padding: '8px' } }, chart.el)], [h('div.card', {}, ctl.el), calc.el]));

  let P = null;
  function update() {
    const st = ctl.state, S = SENSORS[st.sensor], short = Math.min(S.w, S.h), pitch = pitchUm(S);
    const ladder = SUBJECTS.map(([name, Q, kind]) => ({ name, Q, kind, t: exposure(st.N, st.iso, Q), ts: nearestShutter(exposure(st.N, st.iso, Q)) }));
    const total = ladder.filter((l) => l.kind === 'total');
    const seqTime = total.reduce((a, l) => a + Math.max(l.ts, 1 / st.fps), 0);
    const sunMm = 2 * st.f * Math.tan(SUN_RADIUS), sunPx = (sunMm * 1000) / pitch;
    const reach = Math.atan(short / 2 / st.f) / SUN_RADIUS - 1; // corona height that fits, R☉ above the limb
    const drift = driftLimit(st.f, pitch, 1), longest = total[total.length - 1].ts;
    P = { st, ladder, total, seqTime, sunMm, sunPx, reach, drift, longest, pitch, fit4: fFor(short, 4) };
    steps[0].set({
      answer: `ND 5.0 <small>(1/100 000 of the light)</small>`,
      why: `A certified solar filter goes over the <strong>front</strong> of the lens for every partial phase and comes off only at the start of totality. Behind it, f/${st.N.toPrecision(2)} at ISO ${Math.round(st.iso)} needs about ${fmtT(ladder[0].ts)}. Eyes need eclipse glasses to ISO 12312-2.`,
      tex: String.raw`t = \frac{N^2}{I\,2^{Q}},\ Q = 8 \Rightarrow ${texNum(ladder[0].t * 1000, 3)}\ \text{ms}`,
    });
    steps[1].set({
      answer: `${sunMm.toFixed(1)} mm Sun <small>(${sunPx.toFixed(0)} px)</small>`,
      why: `At ${Math.round(st.f)} mm the frame holds the corona out to ${reach.toFixed(1)} solar radii above the edge. ${reach < 4 ? `For the corona out to 4 R☉ use at most ${Math.round(P.fit4)} mm.` : 'That shows the long streamers.'}`,
      tex: String.raw`d_\odot = 2f\tan(0.267^\circ) = ${texNum(sunMm, 3)}\ \text{mm}`,
    });
    steps[2].set({
      answer: `${fmtT(total[0].ts)} to ${fmtT(longest)} <small>(${total.length} exposures)</small>`,
      why: `Baily's beads to the outer corona span ${total[0].Q - total[total.length - 1].Q} stops. One pass of the ladder takes ${seqTime.toFixed(1)} s at ${st.fps} frames per second, so it fits ${Math.floor(st.dur / seqTime)} times into ${st.dur} s of totality. Shoot the bright end at second and third contact, the faint end in mid-totality.`,
      tex: String.raw`\Delta Q = ${total[0].Q} - (${total[total.length - 1].Q}) = ${total[0].Q - total[total.length - 1].Q}\ \text{stops}`,
    });
    const smear = (longest / drift).toFixed(0);
    steps[3].set({
      answer: st.mount === 'track' ? 'Tracking: fine' : (longest > drift ? `${smear} px smear` : 'Tripod: fine'),
      why: st.mount === 'track'
        ? `A tracking mount follows the Sun; on a fixed tripod the ${fmtT(longest)} outer-corona exposure would smear by ${smear} pixels (the Sun drifts one pixel in ${(drift * 1000).toFixed(0)} ms at ${Math.round(st.f)} mm).`
        : longest > drift ? `The Sun drifts one pixel every ${(drift * 1000).toFixed(0)} ms at ${Math.round(st.f)} mm. Use a tracking mount, or keep the tripod exposures below ${fmtT(nearestShutter(drift))} and accept a fainter outer corona.` : 'At this focal length the drift is below a pixel even for the longest exposure.',
      tex: String.raw`t_\text{1 px} = \frac{p}{f\,\omega} = ${texNum(drift * 1000, 3)}\ \text{ms}`,
    });
    calc.say(`<strong>ND 5.0 filter for the partial phases at ${fmtT(ladder[0].ts)}; at totality, filter off and a ladder from ${fmtT(total[0].ts)} to ${fmtT(longest)}</strong> at f/${st.N.toPrecision(2)}, ISO ${Math.round(st.iso)}, ${seqTime.toFixed(1)} s per pass. The Sun is ${sunPx.toFixed(0)} pixels wide${st.mount === 'tripod' && longest > drift ? '; a tripod smears the faint corona' : ''}.`);
    calc.set(String.raw`\begin{aligned}
    t &= \frac{N^2}{I\cdot 2^Q} = \frac{${texNum(st.N, 3)}^2}{${Math.round(st.iso)}\cdot 2^Q}\\
    Q &= 12\ (\text{Baily's beads}) \dots -3\ (8\,R_\odot)
    \end{aligned}`);
    view.redraw(); chart.redraw();
  }

  // Corona brightness 2^Q(h): one exposure at the chosen Q (clipped, gamma) against a log-mapped merge.
  function drawCorona(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!P) return;
    const n = Math.round(Math.min(hh - 44, (w - 40) / 2)), Rpx = n / 7.5, gap = (w - 2 * n) / 3;
    const make = (single) => {
      const ic = imageCanvas(n, n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (x + 0.5 - n / 2) / Rpx, dy = (y + 0.5 - n / 2) / Rpx, r = Math.hypot(dx, dy), k = 4 * (y * n + x);
        let rgb = [0, 0, 0];
        if (r > 1) {
          const hgt = r - 1, th = Math.atan2(dy, dx);
          // streamers along the solar equator, plumes at the poles (illustrative)
          const shape = 0.55 + 0.9 * Math.pow(Math.abs(Math.cos(th)), 6) * Math.exp(-hgt / 3) + 0.15 * Math.pow(Math.abs(Math.sin(th)), 20) + 0.1 * Math.cos(9 * th);
          let Q = coronaQ(hgt) + Math.log2(Math.max(0.2, shape));
          let col = [1, 0.97, 0.92];
          // a prominence at the limb
          if (hgt < 0.06 && Math.abs(th - 2.3) < 0.08) { Q = 9; col = [1, 0.35, 0.45]; }
          const v = single ? Math.min(1, 2 ** (Q - P.st.showQ)) : Math.max(0, Math.min(1, (Q + 2.5) / 14.5)) ** 2;
          rgb = col.map((c) => Math.pow(v, 1 / 2.2) * 255 * c);
        }
        ic.data[k] = rgb[0]; ic.data[k + 1] = rgb[1]; ic.data[k + 2] = rgb[2]; ic.data[k + 3] = 255;
      }
      ic.put();
      return ic.c;
    };
    ctx.drawImage(make(true), gap, 40);
    ctx.drawImage(make(false), 2 * gap + n, 40);
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t('one exposure at Q = {showQ} ({v2})', { showQ: P.st.showQ, v2: fmtT(nearestShutter(exposure(P.st.N, P.st.iso, P.st.showQ))) }), gap, 34);
    ctx.fillText(t('merged ladder (logarithmic)'), 2 * gap + n, 34);
  }

  function drawLadder(ctx, w, hh) {
    if (!P) return;
    const pts = P.ladder.map((l, i) => [i, l.ts]);
    plot(ctx, w, hh, {
      title: 'Exposure for each subject at your aperture and ISO', padL: 60,
      x: { min: -0.5, max: P.ladder.length - 0.5, label: 'from partial phases (left) to the outer corona (right)' }, y: { min: 1e-4, max: 10, log: true, label: 'exposure (s)' },
      series: [{ data: pts, color: '#ffb547', points: true, r: 4 }, { data: pts, color: 'rgba(255,181,71,0.4)' }],
      hlines: P.st.mount === 'tripod' ? [{ y: P.drift, color: '#ff6b6b', label: 'tripod: 1 px drift' }] : [],
    });
  }

  update();

  root.append(rule(String.raw`\[t = \frac{N^2}{I \cdot 2^{Q}}\]
<p>Espenak's exposure guide gives every eclipse subject a brightness exponent \(Q\); each step in \(Q\) is a factor of two. At f/8 and ISO 200, Baily's beads (\(Q = 12\)) need 1/12 800 s (in practice the fastest shutter speed), the inner corona at 0.2 solar radii (\(Q = 5\)) 1/100 s, and the outer corona at 4 radii (\(Q = -1\)) 0.6 s: fifteen stops from the brightest to the faintest subject of totality.</p>`,
    String.raw`The table is a starting point: the corona's brightness changes with the solar cycle, thin cloud or haze dims everything, and the sky brightness during totality limits how far out the corona can be traced. Bracket around each value, and always fit the solar filter for the partial phases.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Exposure</h3>
<p>Espenak's guide (NASA TP-2004-212762, table 23) writes the exposure as \(t = N^2/(I\,2^Q)\): the familiar exposure equation with the subject's luminance hidden in the exponent \(Q\). Its values run from 12 for Baily's beads and 11 for the chromosphere, through 9 for prominences, to the corona at 0.1, 0.2, 0.5, 1, 2, 4 and 8 solar radii above the limb (\(Q\) = 7, 5, 3, 1, 0, −1, −3); partial phases behind an ND 5.0 filter use \(Q = 8\). The page rounds each time to the nearest standard shutter speed.</p>
<h3>Filters</h3>
<p>Optical density 5.0 transmits \(10^{-5}\) of the light, about 17 stops; it belongs in front of the lens so the focused sunlight never reaches the camera unfiltered. For viewing, eclipse glasses must meet ISO 12312-2.</p>
</div><div>
<h3>Framing and drift</h3>
<p>The Sun's mean apparent radius is 0.267°, so its image is \(2f\tan 0.267^\circ\) wide, about 4.7 mm at 500 mm. The corona out to a height \(h\) above the limb fits the sensor's short side \(s\) when \(f \le s/[2\tan((1+h)\,0.267^\circ)]\). On a fixed tripod the Sun drifts at close to the sidereal rate (\(7.29\times10^{-5}\) rad/s, at the equator the worst case), one pixel in \(p/(f\omega)\).</p>
<h3>The rendered corona</h3>
<p>Brightness is \(2^{Q(h)}\) with \(Q\) interpolated logarithmically between the table's heights; the streamer and plume shapes are illustrative. The single exposure clips at the chosen \(Q\); the merge maps \(\log_2\) brightness linearly, as HDR stacking of the ladder does.</p>
</div></div>`));
  root.append(references([
    'F. Espenak and J. Anderson, <i>Total Solar Eclipse of 2006 March 29</i>, NASA TP-2004-212762 (2004), table 23: solar eclipse exposure guide.',
    'ISO 12312-2:2015, <i>Eye and face protection — Filters for direct observation of the sun</i>.',
    'J. M. Pasachoff and M. Covington, <i>Cambridge Eclipse Photography Guide</i>, Cambridge University Press (1993).',
  ]));
  return () => [view, chart].forEach((s) => s.destroy());
}
