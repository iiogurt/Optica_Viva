// Mission: a portrait session, from camera distance to the size of the light.
import { h, controls, stage, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc, missionStep } from '../lib/page.js';
import { MODULES } from '../app.js';
import { SENSORS } from '../lib/sensors.js';
import { plan, FRAMINGS } from '../lib/portrait.js';

const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
const cm = (m) => (m < 1 ? (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm' : m.toFixed(2) + ' m');

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>A flattering portrait starts with where you stand, not with the lens. From close up, the nose is much nearer to the camera than the ears and looks too big; from a few metres away the face looks as we know it. The lens is then chosen to fill the frame from that distance.</p>
<p>Next comes the aperture: wide enough to blur the background into soft colour, but not so wide that one eye is sharp and the other is not. Finally the light: a large light close to the face wraps around it gently, a small one gives hard shadows. This mission works out all four for your camera and room.</p>`, [
    'Move the <strong>camera distance</strong> from 0.8 m to 3 m and watch the nose enlargement fall.',
    'Change the distance but keep the framing: the depth of field across the face stays the same. Why?',
    'Move the <strong>background</strong> from 1 m to 6 m behind the subject: the blur grows and the background gets darker.',
  ]));

  const ctl = controls({
    sensor: { type: 'select', label: 'Camera sensor', value: 'ff', options: ['ff', 'apsc', 'mft', 'phone'].map((k) => [k, SENSORS[k].name]) },
    framing: { type: 'seg', label: 'Framing', value: 'head', options: Object.entries(FRAMINGS).map(([k, f]) => [k, f[0]]) },
    d: { type: 'range', label: 'Camera distance to the face', min: 0.5, max: 8, log: true, value: 2, unit: 'm' },
    N: { type: 'range', label: 'Aperture', min: 1.2, max: 11, log: true, value: 2, fmt: (v) => 'f/' + v.toPrecision(2) },
    B: { type: 'range', label: 'Background behind the subject', min: 0.3, max: 10, log: true, value: 3, unit: 'm' },
    light: { type: 'range', label: 'Light diameter (softbox)', min: 0.05, max: 2, log: true, value: 0.9, unit: 'm' },
    ld: { type: 'range', label: 'Light distance to the face', min: 0.4, max: 4, log: true, value: 1.2, unit: 'm' },
  }, () => update());
  const calc = liveCalc('Your plan');
  const steps = [
    missionStep(1, 'Distance and lens', 'perspective', titleOf('perspective')),
    missionStep(2, 'Aperture', 'dof', titleOf('dof')),
    missionStep(3, 'Background', 'bokeh', titleOf('bokeh')),
    missionStep(4, 'Light', 'lighting', titleOf('lighting')),
  ];
  const view = stage({ aspect: 2.6, label: 'Seen from above: camera, sharp zone, face, light and background (sideways distances compressed)', draw: drawTop, minH: 200 });
  root.append(lab([h('div.msteps', {}, ...steps.map((s) => s.el)), view.el], [h('div.card', {}, ctl.el), calc.el]));

  let P = null;
  function update() {
    const st = ctl.state;
    P = { st: { ...st }, ...plan({ sensor: st.sensor, framing: st.framing, d: st.d, N: st.N, B: st.B, light: st.light, ld: st.ld }) };
    const r = P, fmm = r.f * 1000;
    steps[0].set({
      answer: `${fmm.toFixed(0)} mm <small>at ${st.d.toFixed(1)} m</small>`,
      why: `From ${st.d.toFixed(1)} m the nose is drawn <strong>${(r.nose * 100).toFixed(0)} %</strong> larger, relative to the ears, than from far away${r.nose > 0.05 ? `; step back to about ${r.natural.toFixed(1)} m to bring it below 5 %` : ', which looks natural'}. A ${fmm.toFixed(0)} mm lens then fills the frame.`,
      tex: String.raw`f = \frac{h_\text{sensor}\,d}{H_\text{frame} + h_\text{sensor}} = ${texNum(fmm, 3)}\ \text{mm}`,
    });
    const STOPS = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16];
    const nRec = Math.max(st.N, STOPS.find((v) => v >= r.nFace - 0.05) ?? 16);
    steps[1].set({
      answer: `f/${nRec.toPrecision(2)} <small>(sharp zone ${cm(r.dof)} at f/${st.N.toPrecision(2)})</small>`,
      why: r.dof >= 0.06
        ? `At f/${st.N.toPrecision(2)} about ${cm(r.dof)} around the eyes is sharp, enough for both eyes in a three-quarter view.`
        : `At f/${st.N.toPrecision(2)} only ${cm(r.dof)} is sharp; close down to about f/${(STOPS.find((v) => v >= r.nFace - 0.05) ?? 16).toPrecision(2)} to keep both eyes sharp when the face is turned, or keep the face square to the camera.`,
      tex: String.raw`\text{DoF} \approx \frac{2Nc\,d^2}{f^2} = ${texNum(r.dof * 100, 3)}\ \text{cm}`,
    });
    steps[2].set({
      answer: `${(r.bgShare * 100).toFixed(1)} % <small>of the frame per blur disc</small>`,
      why: `A point of light ${st.B.toFixed(1)} m behind the subject becomes a disc ${(r.bg * 1000).toFixed(2)} mm wide on the sensor. ${r.bgShare > 0.03 ? 'That melts the background into soft shapes.' : r.bgShare > 0.01 ? 'The background is soft but still recognisable.' : 'The background stays fairly sharp: open up, step closer or move the subject away from the wall.'}`,
      tex: String.raw`c_\text{bg} = \frac{f^2}{N(d-f)}\cdot\frac{B}{d+B}`,
    });
    steps[3].set({
      answer: `${(r.ang * 180 / Math.PI).toFixed(0)}° wide <small>(${r.ang > 0.5 ? 'soft' : r.ang > 0.2 ? 'medium' : 'hard'} light)</small>`,
      why: `A ${cm(st.light)} light at ${st.ld.toFixed(1)} m looks ${(r.ang * 180 / Math.PI).toFixed(0)}° wide from the face${r.ang < 0.5 ? '; bring it closer, to about its own diameter, for soft light' : ''}. The background ${st.B.toFixed(1)} m behind gets ${r.fall.toFixed(1)} stops less light than the face.`,
      tex: String.raw`\theta = 2\arctan\frac{S}{2d} = ${texNum(r.ang * 180 / Math.PI, 3)}^\circ`,
    });
    calc.say(`<strong>${fmm.toFixed(0)} mm · ${st.d.toFixed(1)} m · f/${nRec.toPrecision(2)} · ${cm(st.light)} light at ${st.ld.toFixed(1)} m</strong>. The nose is ${(r.nose * 100).toFixed(0)} % enlarged, ${cm(r.dof)} of depth is sharp at f/${st.N.toPrecision(2)}, and background lights become discs ${(r.bgShare * 100).toFixed(1)} % of the frame wide.`);
    calc.set(String.raw`\begin{aligned}
    c &= ${texNum(r.c * 1e6, 3)}\ \mu\text{m}\ (\text{diagonal}/1500)\\
    \text{near}, \text{far} &= ${texNum(r.near, 4)},\ ${texNum(r.far, 4)}\ \text{m}
    \end{aligned}`);
    view.redraw();
  }

  // Top view (not to scale across): camera on the left, the face, the background, and the light.
  function drawTop(ctx, w, hh) {
    ctx.clearRect(0, 0, w, hh);
    if (!P) return;
    const { st } = P, total = st.d + st.B + 0.3, sx = (w - 60) / total, X = (z) => 30 + z * sx, cy = hh / 2 + 14;
    // sharp zone
    ctx.fillStyle = 'rgba(107,227,164,0.18)'; ctx.fillRect(X(st.d - (st.d - P.near)), cy - 40, Math.max(2, (P.far - P.near) * sx), 80);
    // camera
    ctx.fillStyle = '#e9ebf3'; ctx.fillRect(X(0) - 12, cy - 9, 18, 18); ctx.fillRect(X(0) + 6, cy - 5, 8, 10);
    // face
    ctx.beginPath(); ctx.arc(X(st.d), cy, Math.max(4, 0.1 * sx), 0, 2 * Math.PI); ctx.fillStyle = '#ffd27a'; ctx.fill();
    // background wall
    ctx.strokeStyle = '#9aa1b5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(st.d + st.B), 12); ctx.lineTo(X(st.d + st.B), hh - 12); ctx.stroke();
    // light 40° to the side of the camera axis, facing the face; (z along the axis, x across)
    const a = (40 * Math.PI) / 180, zl = st.d - st.ld * Math.cos(a), xl = st.ld * Math.sin(a);
    const sy = Math.min(sx, (hh / 2 - 22) / (xl + st.light / 2)), Y = (x) => cy - x * sy; // across: compressed to fit
    const hs = st.light / 2, lx = X(zl), ly = Y(xl);
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(zl - hs * Math.sin(a)), Y(xl - hs * Math.cos(a))); ctx.lineTo(X(zl + hs * Math.sin(a)), Y(xl + hs * Math.cos(a))); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,181,71,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(X(st.d), Y(0)); ctx.stroke();
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('camera', X(0), cy + 28); ctx.fillText('face', X(st.d), cy + 30); ctx.fillText('background', X(st.d + st.B), hh - 2);
    ctx.fillStyle = '#6be3a4'; ctx.fillText(`sharp zone ${cm(P.dof)}`, X(st.d), cy - 46);
    ctx.fillStyle = '#ffb547'; ctx.fillText('light', lx, Math.max(12, ly - 10));
  }

  update();

  root.append(rule(String.raw`\[\text{DoF} \approx \frac{2Nc\,(1+m)}{m^2}\]
<p>For the same framing (the same magnification \(m\)), depth of field depends only on the f-number, not on the focal length or the distance. A head-and-shoulders portrait on full frame (\(m \approx 1/15\)) at f/2 keeps about 3 cm sharp, whether you use 50 mm at 0.8 m or 135 mm at 2.2 m. What distance does change is perspective (the nose) and how much background fits behind the head, which is why longer lenses blur it into a smaller, softer patch.</p>`,
    String.raw`The circle of confusion \(c\) assumes a normal print viewed at a normal distance; a 100 % view on a screen needs closer to two pixels, which halves the depth of field. The formula is for subjects much farther than the focal length (true for portraits), and real lenses differ in how pleasantly they blur.`));

  root.append(theory('How the plan is computed', String.raw`
<div class="theory-cols"><div>
<h3>Distance, perspective and focal length</h3>
<p>The tip of the nose is taken 11 cm in front of the plane of the ears, as in the perspective laboratory, so its size relative to the ears is \((d + 0.01)/(d - 0.108)\). The focal length that makes the scene height \(H\) fill the sensor's long side \(h\) follows from the thin-lens magnification \(m = h/H = f/(d-f)\): \(f = hd/(H + h)\).</p>
<h3>Depth of field</h3>
<p>The near and far limits use the thin-lens formulas of the depth-of-field laboratory with \(c = \text{diagonal}/1500\) (29 µm on full frame). For a three-quarter view, the two eyes are about 6 cm apart in depth; the suggested aperture is the widest that keeps that much sharp, from \(\text{DoF} \approx 2Ncd^2/f^2\).</p>
</div><div>
<h3>Background blur</h3>
<p>A point at distance \(d + B\) images to a disc \(c_\text{bg} = \frac{f}{N}\cdot\frac{f\,B}{(d+B)(d-f)}\) on the sensor; the page reports it as a share of the frame's long side, the visual size of out-of-focus lights.</p>
<h3>Light</h3>
<p>The light's apparent size \(2\arctan(S/2d)\) sets how gradually the face turns from lit to shadow and how soft the shadows are, and the background's falloff in stops follows the inverse-square law from the light, as in the lighting laboratory (light 40° to the side, 25° high).</p>
</div></div>`));
  root.append(references([
    'S. F. Ray, <i>Applied Photographic Optics</i>, 3rd ed., Focal Press (2002): depth of field and perspective.',
    'F. Hunter, S. Biver and P. Fuqua, <i>Light: Science and Magic</i>, 5th ed., Routledge (2015): portrait lighting.',
    'H. M. Merklinger, <i>The INs and OUTs of FOCUS</i> (1992): background blur as a share of the frame.',
  ]));
  return () => [view].forEach((s) => s.destroy());
}
