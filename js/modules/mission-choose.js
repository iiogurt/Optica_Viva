// Mission: choose between two cameras or two telescopes for the same job.
import { h, controls, stage, texNum, readUrlParam } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { MODULES } from '../app.js';
import { cameraOptions, resolveCamera, TELESCOPES } from '../lib/equipment.js';
import { camera, telescope, stops } from '../lib/choose.js';
import { t } from '../lib/i18n.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const FORMATS = ['mf', 'ff', 'apsc', 'mft', 'one', 'phone'];
const isCam = (st) => st.mode === 'cam', isTel = (st) => st.mode === 'tel';
const A = '#ffb547', B = '#6ad7ff';

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video', 'space'] }));
  root.append(idea(String.raw`<p>Buying advice is full of numbers that do not matter on their own: megapixels, f-numbers, magnification. What decides how a photograph looks is how much light the lens gathers for the picture you want, how much of the scene stays sharp, and how much detail survives. For a telescope it is mostly one number, the width of its main lens or mirror.</p>
<p>This mission compares two options for the same job and says, for each quality, which one wins and by how much.</p>`, [
    'Compare a full-frame camera with an f/1.8 lens against a phone at f/1.8: count the stops of light the phone loses.',
    'Give the smaller camera a faster lens until the light is equal: the depth of field becomes equal too.',
    'Switch to <strong>Telescopes</strong> and compare 80 mm with 200 mm: then set the seeing to 3″.',
  ]));

  const ctl = controls({
    mode: { type: 'seg', label: 'Compare', value: 'cam', options: [['cam', 'Cameras'], ['tel', 'Telescopes']] },
    h1: { type: 'heading', label: 'The shot', when: isCam },
    Feq: { type: 'range', label: 'Framing (full-frame equivalent focal length)', min: 14, max: 400, log: true, value: 50, unit: 'mm', when: isCam },
    s: { type: 'range', label: 'Subject distance', min: 0.5, max: 20, log: true, value: 3, unit: 'm', when: isCam },
    hA: { type: 'heading', label: 'Option A', when: isCam },
    sA: { type: 'select', label: 'Sensor A', value: 'ff', options: cameraOptions(FORMATS), when: isCam },
    NA: { type: 'range', label: 'Widest aperture A', min: 0.95, max: 8, log: true, value: 1.8, fmt: (v) => 'f/' + v.toPrecision(2), when: isCam },
    mA: { type: 'range', label: 'Megapixels A', min: 8, max: 100, log: true, value: 24, fmt: (v) => Math.round(v) + ' MP', when: isCam },
    hB: { type: 'heading', label: 'Option B', when: isCam },
    sB: { type: 'select', label: 'Sensor B', value: 'mft', options: cameraOptions(FORMATS), when: isCam },
    NB: { type: 'range', label: 'Widest aperture B', min: 0.95, max: 8, log: true, value: 1.8, fmt: (v) => 'f/' + v.toPrecision(2), when: isCam },
    mB: { type: 'range', label: 'Megapixels B', min: 8, max: 100, log: true, value: 20, fmt: (v) => Math.round(v) + ' MP', when: isCam },
    tA: { type: 'select', label: 'Telescope A', value: 'custom', options: [['custom', 'Custom'], ...Object.entries(TELESCOPES).map(([k, t]) => [k, t.name])], when: isTel },
    DA: { type: 'range', label: 'Telescope A aperture', min: 50, max: 500, log: true, value: 80, unit: 'mm', when: isTel },
    fA: { type: 'range', label: 'Telescope A focal length', min: 300, max: 4000, log: true, value: 600, unit: 'mm', when: isTel },
    tB: { type: 'select', label: 'Telescope B', value: 'custom', options: [['custom', 'Custom'], ...Object.entries(TELESCOPES).map(([k, t]) => [k, t.name])], when: isTel },
    DB: { type: 'range', label: 'Telescope B aperture', min: 50, max: 500, log: true, value: 200, unit: 'mm', when: isTel },
    fB: { type: 'range', label: 'Telescope B focal length', min: 300, max: 4000, log: true, value: 1000, unit: 'mm', when: isTel },
    seeing: { type: 'range', label: 'Typical seeing at your site', min: 0.5, max: 5, step: 0.1, value: 2, unit: '″', when: isTel },
  }, (st) => {
    // a chosen body sets its megapixels; a chosen telescope its aperture and focal length
    for (const [sel, mp] of [['sA', 'mA'], ['sB', 'mB']]) if (st[sel] !== seen[sel] && st[sel].startsWith('cam:')) ctl.set[mp](resolveCamera(st[sel]).mp);
    for (const [sel, D, f] of [['tA', 'DA', 'fA'], ['tB', 'DB', 'fB']]) if (st[sel] !== seen[sel] && st[sel] !== 'custom') { ctl.set[D](TELESCOPES[st[sel]].D); ctl.set[f](TELESCOPES[st[sel]].f); }
    seen = { ...ctl.state };
    update();
  });
  let seen = { ...ctl.state };
  const calc = liveCalc('Verdict');
  const steps = [1, 2, 3, 4].map((n) => missionStep(n, '', null, ''));
  const bars = stage({ aspect: 2.4, label: '', draw: drawBars, cls: 'plain', minH: 220 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), h('div.card', { style: { padding: '8px' } }, bars.el)], [h('div.card', {}, ctl.el), calc.el]));

  const setTitle = (k, title, lab) => {
    const el = steps[k].el;
    el.querySelector('h3').textContent = title;
    let a = el.querySelector('.mstep-lab');
    if (!a) { a = h('a.mstep-lab'); el.append(a); }
    a.href = '#/' + lab; a.textContent = t('Explore: {lab} →', { lab: titleOf(lab) });
  };
  const win = (x, y, more = true) => (Math.abs(x - y) / Math.max(x, y) < 0.03 ? 'equal' : (x > y) === more ? '<strong style="color:' + A + '">A</strong>' : '<strong style="color:' + B + '">B</strong>');

  let M = null;
  function update() {
    const st = ctl.state;
    if (isCam(st)) {
      const shot = { Feq: st.Feq, s: st.s }, a = camera({ sensor: resolveCamera(st.sA), N: st.NA, mp: st.mA }, shot), b = camera({ sensor: resolveCamera(st.sB), N: st.NB, mp: st.mB }, shot);
      const dl = stops(a.light, b.light);
      M = { st, a, b, rows: [['Light gathered', a.light, b.light, true], ['Sharp depth (more = deeper)', a.dof, b.dof, true], ['Megapixels', a.mp, b.mp, true], ['Entrance pupil (lens size)', a.D, b.D, true]] };
      setTitle(0, 'Light and noise', 'sensor'); setTitle(1, 'Background blur', 'dof'); setTitle(2, 'Detail', 'mtf'); setTitle(3, 'Equivalent settings', 'sensor');
      steps[0].set({
        answer: `${win(a.light, b.light)} <small>by ${Math.abs(dl).toFixed(1)} stops</small>`,
        why: `For the same framing, A's lens opening is ${a.D.toFixed(1)} mm wide and B's ${b.D.toFixed(1)} mm. The wider one collects more light in the same time, so the whole picture is less noisy, by ${Math.abs(dl).toFixed(1)} stops (${(2 ** Math.abs(dl)).toFixed(1)}× the light).`,
        tex: String.raw`\Delta = 2\log_2\frac{D_A}{D_B} = ${texNum(dl, 3)}\ \text{stops}`,
      });
      steps[1].set({
        answer: `${win(a.dof, b.dof, false)} <small>blurs more</small>`,
        why: `At ${st.s} m, A keeps ${(a.dof * 100).toFixed(0)} cm sharp and B ${(b.dof * 100).toFixed(0)} cm. The smaller depth of field gives the softer background; it belongs to the wider lens opening.`,
        tex: String.raw`\text{DoF} \approx \frac{2Nc\,s^2}{f^2}:\ ${texNum(a.dof * 100, 3)}\ \text{vs}\ ${texNum(b.dof * 100, 3)}\ \text{cm}`,
      });
      steps[2].set({
        answer: `${win(a.mp, b.mp)} <small>(${Math.round(a.mp)} vs ${Math.round(b.mp)} MP)</small>`,
        why: `Pixels of ${a.pitch.toFixed(1)} and ${b.pitch.toFixed(1)} µm. Beyond f/${a.nDiff.toFixed(1)} (A) and f/${b.nDiff.toFixed(1)} (B) diffraction blurs over two pixels, so stopping down further costs detail. The lens usually limits detail before the sensor does.`,
        tex: String.raw`N_\text{diff} = \frac{2p}{2.44\lambda}`,
      });
      const nMatch = st.NA * (a.k / b.k);
      steps[3].set({
        answer: `B at f/${nMatch.toPrecision(2)} <small>= A at f/${st.NA.toPrecision(2)}</small>`,
        why: `Scale A's f-number by the ratio of crop factors k_A/k_B (${(a.k / b.k).toFixed(2)}) to get the same lens opening: B would need f/${nMatch.toPrecision(2)} to match A in light and depth of field${nMatch < 0.95 ? ', faster than lenses for that format usually go' : ''}.`,
        tex: String.raw`N_B = N_A\,\frac{k_A}{k_B} = ${texNum(nMatch, 3)}`,
      });
      calc.say(`For this shot, <strong>${Math.abs(dl) < 0.1 ? 'both gather the same light' : (dl > 0 ? 'A' : 'B') + ' gathers ' + Math.abs(dl).toFixed(1) + ' stops more light'}</strong> and has the shallower depth of field; B would need f/${nMatch.toPrecision(2)} to equal A.`);
      calc.set(String.raw`\begin{aligned}
      f_A &= ${texNum(a.f, 3)}\ \text{mm},\ D_A = ${texNum(a.D, 3)}\ \text{mm}\\
      f_B &= ${texNum(b.f, 3)}\ \text{mm},\ D_B = ${texNum(b.D, 3)}\ \text{mm}
      \end{aligned}`);
    } else {
      const a = telescope({ D: st.DA, f: st.fA }, st.seeing), b = telescope({ D: st.DB, f: st.fB }, st.seeing);
      const effA = Math.max(a.rayleigh, st.seeing), effB = Math.max(b.rayleigh, st.seeing);
      M = { st, a, b, rows: [['Resolution (finer = better)', 1 / a.rayleigh, 1 / b.rayleigh, true], ['Light grasp', a.grasp, b.grasp, true], ['Faintest star (magnitude)', a.mlim, b.mlim, true], ['Widest field (shorter f)', 1 / a.f, 1 / b.f, true]] };
      setTitle(0, 'Fine detail', 'psf'); setTitle(1, 'Faint objects', 'stacking'); setTitle(2, 'Under your sky', 'seeing'); setTitle(3, 'Magnification and field', 'telescope');
      steps[0].set({
        answer: `${win(1 / a.rayleigh, 1 / b.rayleigh)} <small>(${a.rayleigh.toFixed(2)}″ vs ${b.rayleigh.toFixed(2)}″)</small>`,
        why: `The finest detail a telescope can show is set by its aperture alone: ${a.D} mm resolves ${a.rayleigh.toFixed(2)}″ (Dawes ${a.dawes.toFixed(2)}″), ${b.D} mm ${b.rayleigh.toFixed(2)}″.`,
        tex: String.raw`\theta = 1.22\,\frac{\lambda}{D}`,
      });
      steps[1].set({
        answer: `${win(a.grasp, b.grasp)} <small>by ${Math.abs(stops(a.grasp, b.grasp)).toFixed(1)} stops</small>`,
        why: `Light grasp grows with the aperture's area: ${a.grasp.toFixed(0)}× and ${b.grasp.toFixed(0)}× a dark-adapted eye. Faintest stars by eye: about magnitude ${a.mlim.toFixed(1)} and ${b.mlim.toFixed(1)}.`,
        tex: String.raw`m_\text{lim} \approx 7.5 + 5\log_{10} D_\text{cm}`,
      });
      steps[2].set({
        answer: a.seeingLimited && b.seeingLimited ? 'seeing decides' : `${win(1 / effA, 1 / effB)} <small>under ${st.seeing}″ seeing</small>`,
        why: `With ${st.seeing}″ seeing, detail finer than the seeing is lost in long exposures: A reaches ${effA.toFixed(2)}″, B ${effB.toFixed(2)}″. ${a.seeingLimited && b.seeingLimited ? 'Both are limited by the air; the larger one still gathers more light and benefits more on steady nights or with lucky imaging.' : ''}`,
        tex: String.raw`\theta_\text{eff} \approx \max(1.22\lambda/D,\ \text{seeing})`,
      });
      steps[3].set({
        answer: `f/${a.N.toFixed(1)} vs f/${b.N.toFixed(1)}`,
        why: `Useful magnification runs from about ${a.minMag.toFixed(0)}–${a.maxMag.toFixed(0)}× (A) and ${b.minMag.toFixed(0)}–${b.maxMag.toFixed(0)}× (B). The shorter focal length shows a wider field: ${st.fA < st.fB ? 'A' : 'B'} suits large nebulae and the Milky Way, the longer one planets and double stars.`,
        tex: String.raw`M_\text{max} \approx 2D_\text{mm},\quad M_\text{min} \approx D/7\ \text{mm}`,
      });
      calc.say(`<strong>${st.DB > st.DA ? 'B' : 'A'}</strong> shows finer detail and fainter objects; under ${st.seeing}″ seeing ${a.seeingLimited && b.seeingLimited ? 'both are limited by the air for long exposures' : 'the larger aperture still resolves more'}.`);
      calc.set(String.raw`\begin{aligned}
      \theta_A &= ${texNum(a.rayleigh, 3)}'',\quad \theta_B = ${texNum(b.rayleigh, 3)}''\\
      \Delta &= 2\log_2(D_B/D_A) = ${texNum(stops(b.grasp, a.grasp), 3)}\ \text{stops}
      \end{aligned}`);
    }
    bars.redraw();
  }

  // Each quality as a pair of bars scaled to the better of the two.
  function drawBars(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!M) return;
    const rows = M.rows, top = 30, rh = (hh - top - 10) / rows.length, x0 = 200, bw = w - x0 - 60;
    ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = '#e9ebf3'; ctx.textAlign = 'left';
    ctx.fillText('Each quality relative to the better option', 10, 18);
    ctx.fillStyle = A; ctx.fillText('■ A', w - 90, 18); ctx.fillStyle = B; ctx.fillText('■ B', w - 50, 18);
    rows.forEach(([name, a, b], i) => {
      const y = top + i * rh, m = Math.max(a, b) || 1;
      ctx.fillStyle = '#9aa1b5'; ctx.textAlign = 'left'; ctx.fillText(name, 10, y + rh / 2 + 4);
      [[a, A, 0], [b, B, 1]].forEach(([v, col, k]) => {
        const yy = y + 4 + k * (rh / 2 - 2), len = Math.max(2, (bw * v) / m);
        ctx.fillStyle = col; ctx.fillRect(x0, yy, len, rh / 2 - 6);
        ctx.fillStyle = '#e9ebf3'; ctx.textAlign = 'left'; ctx.fillText(((v / m) * 100).toFixed(0) + ' %', x0 + len + 6, yy + rh / 4 + 1);
      });
    });
  }

  // a link that names a preset but not its values applies the preset
  for (const [sel, mp] of [['sA', 'mA'], ['sB', 'mB']]) if (ctl.state[sel].startsWith('cam:') && readUrlParam(mp) == null) ctl.set[mp](resolveCamera(ctl.state[sel]).mp);
  for (const [sel, D, f] of [['tA', 'DA', 'fA'], ['tB', 'DB', 'fB']]) if (ctl.state[sel] !== 'custom' && readUrlParam(D) == null) { ctl.set[D](TELESCOPES[ctl.state[sel]].D); ctl.set[f](TELESCOPES[ctl.state[sel]].f); }
  seen = { ...ctl.state };
  update();

  root.append(rule(String.raw`\[D = \frac{f}{N}\]
<p>For the same framing, the width of the lens opening \(D\), the entrance pupil, sets the light gathered and the depth of field, whatever the sensor size. A full-frame camera with a 50 mm f/1.8 lens has a 28 mm pupil; a Micro Four Thirds camera framing the same scene uses 25 mm, and at f/1.8 its pupil is only 14 mm: two stops less light and twice the depth of field. At f/0.9 it would match. For telescopes the same \(D\) is everything: resolution \(1.22\lambda/D\) and light grasp \(\propto D^2\).</p>`,
    String.raw`Equivalence assumes sensors of similar efficiency per area and subjects much farther away than the focal length; lens sharpness, autofocus, size and price do not appear in it. For telescopes, the seeing usually caps resolution near 1–2″, and mount quality and optical quality matter as much as aperture.`));

  root.append(theory('How the comparison is computed', String.raw`
<div class="theory-cols"><div>
<h3>Cameras</h3>
<p>The shot fixes the full-frame-equivalent focal length and the distance. Each option's real focal length is that divided by its crop factor \(k\), its entrance pupil \(D = f/N\) at the widest aperture, and the light it gathers is proportional to \(D^2\) (same shutter time, same field of view), which also sets the photon shot noise of the whole picture. Depth of field is \(2Nc s^2/f^2\) with \(c\) = diagonal/1500, equal for equal \(D\). Diffraction spreads over two pixels at \(N = 2p/(2.44\lambda)\).</p>
</div><div>
<h3>Telescopes</h3>
<p>Resolution is the Rayleigh limit \(1.22\lambda/D\) at 550 nm (Dawes' empirical \(116''/D_\text{mm}\) for equal double stars is also shown). Light grasp is \((D/7\,\text{mm})^2\) relative to a dark-adapted pupil, and the visual limiting magnitude uses the common estimate \(7.5 + 5\log_{10}D_\text{cm}\), which depends on sky, observer and magnification. Useful magnification runs from the exit pupil equal to the eye's (\(D/7\)) to about \(2\times D_\text{mm}\).</p>
</div></div>`));
  root.append(references([
    'S. F. Ray, <i>Applied Photographic Optics</i>, 3rd ed., Focal Press (2002): format, equivalence and depth of field.',
    'W. R. Dawes, "Catalogue of micrometrical measurements of double stars", Mem. R. Astron. Soc. 35, 137 (1867): the Dawes limit.',
    'H. Rutten and M. van Venrooij, <i>Telescope Optics: Evaluation and Design</i>, Willmann-Bell (1988).',
  ]));
  return () => [bars].forEach((s) => s.destroy());
}
