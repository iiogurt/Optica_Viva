// Lighting: the size of a light sets the softness of shadows, its distance sets how fast light
// falls off, and its reflection in the eye is the catchlight.
import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot, logRange } from '../lib/plot.js';
import { latest } from '../lib/compute.js';
import { makeLight, shadowGeometry, angularSize, catchlight, falloff, flashAperture, fresnel0 } from '../lib/lighting.js';

const PRESETS = { bulb: ['Bare flash or bulb', 5], small: ['Small softbox', 60], large: ['Large softbox', 120], window: ['Window or scrim', 200] };
const R_HEAD = 0.1;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>The size of a light, as seen from the subject, decides almost everything about how it looks. A small light, like a bare flash or the midday sun, casts shadows with hard edges and makes shiny skin glare. A large light, like a softbox or a window, wraps around the face, and its shadows fade gently from dark to light.</p>
<p>"Large" means large compared with its distance: moving a softbox closer makes it effectively bigger and softer. Moving it closer also makes the light fall off faster with distance, so the background behind the subject gets darker. The reflection of the light in the eyes, the <strong>catchlight</strong>, shows its shape and size.</p>`, [
    'Switch from <strong>Bare flash</strong> to <strong>Large softbox</strong> at the same distance: the shadow on the wall loses its hard edge.',
    'Keep the large softbox and move it from 0.6 m to 3 m: it acts more and more like a small, hard light.',
    'Move the <strong>light</strong> closer to the subject while keeping the wall where it is: the background turns darker.',
  ]));

  const ctl = controls({
    preset: { type: 'select', label: 'Light', value: 'small', options: Object.entries(PRESETS).map(([k, p]) => [k, `${p[0]} (${p[1]} cm)`]) },
    size: { type: 'range', label: 'Light diameter', min: 3, max: 200, log: true, value: 60, unit: 'cm' },
    dist: { type: 'range', label: 'Light distance to the subject', min: 0.5, max: 4, log: true, value: 1, unit: 'm' },
    az: { type: 'range', label: 'Light direction (0° = from the camera)', min: -80, max: 80, step: 1, value: 35, unit: '°' },
    el: { type: 'range', label: 'Light height above the subject', min: 0, max: 60, step: 1, value: 25, unit: '°' },
    b: { type: 'range', label: 'Wall behind the subject', min: 0.2, max: 4, log: true, value: 0.6, unit: 'm' },
    glossy: { type: 'toggle', label: 'Glossy surface (shows the reflection of the light)', value: true },
    gn: { type: 'range', label: 'Flash guide number (m, ISO 100)', min: 10, max: 60, step: 1, value: 36 },
    iso: { type: 'range', label: 'ISO', min: 100, max: 1600, log: true, value: 100, fmt: (v) => Math.round(v) },
  }, (s) => { if (s.preset !== last) { ctl.set.size(PRESETS[s.preset][1]); last = s.preset; } update(); });
  let last = ctl.state.preset;
  const ro = h('div');
  const calc = liveCalc();
  const scene = stage({ aspect: 10 / 7, label: 'Rendered: a head-sized matte or glossy sphere in front of a wall', draw: drawScene, minH: 260 });
  const top = stage({ aspect: 2.4, label: '', draw: drawTop, cls: 'plain', minH: 200 });
  const fall = stage({ aspect: 2.4, label: '', draw: drawFall, cls: 'plain', minH: 200 });
  root.append(lab([scene.el, h('div.card', { style: { padding: '8px' } }, top.el), h('div.card', { style: { padding: '8px' } }, fall.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('lighting');
  let M = null, img = null;
  function update() {
    const st = ctl.state, S = st.size / 100;
    const light = makeLight(st.dist, st.az, st.el, S);
    const sg = shadowGeometry(S, st.dist, st.b, R_HEAD), ang = angularSize(S, st.dist), fo = falloff(light, st.b);
    const cl = catchlight(S, st.dist), N = flashAperture(st.gn, st.dist, st.iso);
    M = { st: { ...st }, S, light, sg, ang, fo, cl, N };
    ro.replaceChildren(readouts([
      ['Size of the light seen from the subject', (ang * 180 / Math.PI).toFixed(1) + '°'],
      ['Soft edge of the wall shadow (each side)', (sg.pen * 100).toFixed(1) + ' cm'],
      ['Fully dark core of the shadow', sg.umbra > 0 ? (sg.umbra * 100).toFixed(1) + ' cm' : 'none: all penumbra'],
      ['Wall darker than the subject by', fo.stops.toFixed(2) + ' stops'],
      ['Catchlight in the eye', (cl * 1000).toFixed(2) + ' mm across'],
      ['Flash aperture at full power', 'f/' + N.toPrecision(2)],
      ['Specular reflectance of skin / cornea', (fresnel0(1.376) * 100).toFixed(1) + ' %'],
    ]));
    calc.say(`A ${st.size.toFixed(0)} cm light at ${st.dist.toFixed(2)} m looks <strong>${(ang * 180 / Math.PI).toFixed(0)}°</strong> wide from the subject. The shadow on the wall ${st.b.toFixed(1)} m behind has soft edges <strong>${(sg.pen * 100).toFixed(0)} cm</strong> wide${sg.umbra > 0 ? '' : ' and no hard core'}, and the wall is <strong>${fo.stops.toFixed(1)} stops</strong> darker than the face.`);
    calc.set(String.raw`\begin{aligned}
    w_\text{pen} &= \frac{S\,b}{d} = \frac{${texNum(S, 3)}\times${texNum(st.b, 3)}}{${texNum(st.dist, 3)}} = ${texNum(sg.pen * 100, 3)}\ \text{cm}\\
    \Delta &= \log_2\frac{E_\text{subject}}{E_\text{wall}} = ${texNum(fo.stops, 3)}\ \text{stops}\\
    N &= \frac{GN\sqrt{\text{ISO}/100}}{d} = ${texNum(N, 3)}
    \end{aligned}`);
    top.redraw(); fall.redraw();
    job('lighting', { dist: st.dist, az: st.az, el: st.el, size: S, b: st.b, glossy: st.glossy, R: R_HEAD, W: 240, H: 168, rings: 6 })
      .then((r) => { img = r; scene.redraw(); }).catch(console.error);
  }

  function drawScene(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!img) return;
    const { W, H } = img, ic = imageCanvas(W, H);
    for (let k = 0; k < W * H; k++) {
      const v = Math.pow(Math.min(1, 0.82 * img.img[k]), 1 / 2.2) * 255;
      ic.data[4 * k] = v; ic.data[4 * k + 1] = v * 0.93; ic.data[4 * k + 2] = v * 0.86; ic.data[4 * k + 3] = 255;
    }
    ic.put();
    const s = Math.min(w / W, hh / H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ic.c, (w - W * s) / 2, (hh - H * s) / 2, W * s, H * s);
  }

  // Top view: light, subject and wall with the umbra and penumbra cones.
  function drawTop(ctx, w, hh) {
    if (!M) return;
    const { st, S } = M;
    ctx.clearRect(0, 0, w, hh);
    const az = (st.az * Math.PI) / 180, lx = st.dist * Math.sin(az), lz = st.dist * Math.cos(az);
    const zmin = -st.b - 0.2, zmax = Math.max(lz, 0.4) + 0.3, xmax = Math.max(1.2, Math.abs(lx) + S);
    const sc = Math.min((w - 40) / (zmax - zmin), (hh - 40) / (2 * xmax));
    const X = (z) => 20 + (z - zmin) * sc, Y = (x) => hh / 2 - x * sc;
    // the wall
    ctx.strokeStyle = '#9aa1b5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(-st.b), 10); ctx.lineTo(X(-st.b), hh - 10); ctx.stroke();
    // shadow cones from the light's edges past the sphere to the wall (in the plane of the drawing)
    const ex = Math.cos(az), ez = -Math.sin(az); // across the light
    const edges = [-1, 1].map((s) => [lx + (s * S) / 2 * ex, lz + (s * S) / 2 * ez]);
    const toWall = (px, pz, tx, tz) => { const t = (-st.b - pz) / (tz - pz); return [px + t * (tx - px), -st.b]; };
    const tang = (e, side) => { // tangent point on the circle from point e, side ±1
      const [ex0, ez0] = e, d = Math.hypot(ex0, ez0), a = Math.asin(R_HEAD / d), base = Math.atan2(ex0, ez0) + Math.PI;
      const ang = base + side * a, l = Math.sqrt(d * d - R_HEAD * R_HEAD);
      return [ex0 + l * Math.sin(ang), ez0 + l * Math.cos(ang)];
    };
    ctx.fillStyle = 'rgba(255,181,71,0.10)';
    for (const side of [-1, 1]) {
      const p1 = tang(edges[0], side), p2 = tang(edges[1], side);
      const w1 = toWall(edges[0][0], edges[0][1], p1[0], p1[1]), w2 = toWall(edges[1][0], edges[1][1], p2[0], p2[1]);
      ctx.beginPath(); ctx.moveTo(X(p1[1]), Y(p1[0])); ctx.lineTo(X(-st.b), Y(w1[0])); ctx.lineTo(X(-st.b), Y(w2[0])); ctx.lineTo(X(p2[1]), Y(p2[0])); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,181,71,0.35)'; ctx.lineWidth = 1;
    for (const e of edges) for (const side of [-1, 1]) { const p = tang(e, side), q = toWall(e[0], e[1], p[0], p[1]); ctx.beginPath(); ctx.moveTo(X(e[1]), Y(e[0])); ctx.lineTo(X(q[1]), Y(q[0])); ctx.stroke(); }
    // subject and light
    ctx.fillStyle = '#e9ebf3'; ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(3, R_HEAD * sc), 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(edges[0][1]), Y(edges[0][0])); ctx.lineTo(X(edges[1][1]), Y(edges[1][0])); ctx.stroke();
    ctx.fillStyle = '#9aa1b5'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('top view: light, subject, wall · shaded: penumbra (soft edges)', 10, 14);
    ctx.fillText(`camera →`, w - 70, hh - 8);
  }

  function drawFall(ctx, w, hh) {
    if (!M) return;
    const { st, fo } = M, ds = logRange(0.3, 8, 120);
    plot(ctx, w, hh, {
      title: 'Light falls off with the square of the distance from the light', x: { min: 0.3, max: 8, log: true, label: 'distance from the light (m)' }, y: { min: -8, max: 4, label: 'stops relative to the subject' },
      series: [{ data: ds.map((d) => [d, 2 * Math.log2(fo.ds / d)]), color: '#ffd27a', label: 'inverse square' }],
      vlines: [{ x: fo.ds, color: '#e9ebf3', label: 'subject' }, { x: fo.dw, color: '#9aa1b5', label: 'wall' }],
    });
  }

  update();

  root.append(rule(String.raw`\[w_\text{pen} = \frac{S\,b}{d},\qquad E \propto \frac{1}{d^2}\]
<p>A light of diameter \(S\) at distance \(d\) from the subject casts a shadow on a wall \(b\) behind it whose edges are \(S b/d\) wide. A 60 cm softbox 1 m away puts 60 cm soft edges on a wall 1 m behind; a 5 cm flash only 5 cm. The light also falls off with the square of the distance: with the light 1 m in front of the face and the wall 1 m behind it, the wall gets a quarter of the light, two stops darker. Move the light to 3 m and the difference shrinks to 0.8 stops.</p>`,
    String.raw`Shadow edges also depend on the occluder's own shape and on light bounced from the room, which fills shadows and lowers contrast. The inverse-square law holds once the distance is a few times the light's size; very close to a large softbox the light falls off more slowly.`));

  root.append(theory('Area lights, shadows and highlights', String.raw`
<div class="theory-cols"><div>
<h3>Irradiance from an area light</h3>
<p>A Lambertian emitter of radiance \(L\) and area \(A\) produces at a point with normal \(\mathbf n\)
\[E = L\int_A \frac{\cos\theta\,\cos\theta'}{r^2}\,V\,dA,\]
where \(\theta\) and \(\theta'\) are the angles at the receiver and the light and \(V\) is 1 where the light is visible. The page integrates over the light's disc with stratified samples on equal-area rings (at their area-median radius) and traces a shadow ray to each. On the axis of a disc of radius \(a\) the exact result is \(E = \pi L a^2/(a^2+d^2)\); the quadrature matches it within 1 % for distances above about half the light's diameter.</p>
<h3>Umbra and penumbra</h3>
<p>By similar triangles, an occluder of radius \(r\) at distance \(d\) from a source of diameter \(S\) shadows a wall \(b\) behind it with a penumbra \(S b/d\) wide on each side and an umbra \(2r - (S - 2r)b/d\) wide, which vanishes for large, close lights.</p>
</div><div>
<h3>Falloff</h3>
<p>Far from the light, \(E \approx I\cos\theta/d^2\). The difference between subject and wall is \(\log_2\)[\((\cos\theta_s/d_s^2)/(\cos\theta_w/d_w^2)\)] stops, with \(d_s, d_w\) measured from the light's centre.</p>
<h3>Highlights and catchlights</h3>
<p>Skin and the cornea reflect specularly with the Fresnel reflectance \(((n-1)/(n+1))^2 \approx 2.5\) % at \(n = 1.376\). A glossy point shows the light's own radiance times that reflectance, while its diffuse brightness is \(\rho E/\pi\), proportional to the light's solid angle. A small light of the same exposure therefore has a far higher radiance, and its highlight burns out. The cornea, radius 7.8 mm, is a convex mirror of focal length 3.9 mm, so the catchlight is \(S\,(3.9\ \text{mm})/d\) across.</p>
<h3>Flash</h3>
<p>The guide number is the product of distance and f-number for a correct exposure at ISO 100, so \(N = GN\sqrt{\text{ISO}/100}/d\).</p>
</div></div>`));
  root.append(references([
    'M. Pharr, W. Jakob and G. Humphreys, <i>Physically Based Rendering</i>, 4th ed., MIT Press (2023), ch. 4 (radiometry) and ch. 12 (light sources).',
    'F. Hunter, S. Biver and P. Fuqua, <i>Light: Science and Magic</i>, 5th ed., Routledge (2015): the family of angles, hard and soft light.',
    'Y. Le Grand and S. G. El Hage, <i>Physiological Optics</i>, Springer (1980): corneal radius and the Purkinje images.',
  ]));
}
