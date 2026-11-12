// Phase angle and sun glint: how bright a lit sphere looks as the Sun moves round it, and the Sun's
// mirror image on a wind-roughened sea seen from orbit.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { latest } from '../lib/compute.js';
import { RAD, WATER_DIFFUSE, slopeVar, lambertPhase, lsPhase, moonPhase, moonMag, fresnel, glint, reflectance, principalPlane } from '../lib/glint.js';
import { t, N_ } from '../lib/i18n.js';

const SURF = { lambert: N_('Cloud deck (Lambert, like Venus)'), moon: N_('Dusty regolith (Lommel–Seeliger, like the Moon)'), ocean: N_('Ocean (Cox–Munk sun glint)') };
// albedo and colour of each surface in the pictures (linear RGB)
const TINT = { lambert: [0.95, 0.86, 0.66], moon: [0.75, 0.73, 0.7], ocean: [0.08, 0.2, 0.42] };
const LAND = [0.09, 0.08, 0.05];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>The <em>phase angle</em> is the angle at a planet or moon between the directions to the Sun and to us. At 0° we see it fully lit (full Moon); at 90° half lit; near 180° only a thin crescent.</p>
<p>How the brightness falls depends on the surface. A matt cloud deck darkens smoothly towards its edge. Dusty lunar soil does not: the full Moon looks like a flat disc, and its brightness falls much faster with phase, because its rough surface hides its own shadows only when the Sun is behind us. Water is dark, except where it mirrors the Sun: a glint whose size tells how rough the waves are.</p>`, [
    'Move the <strong>phase angle</strong> from 0° to 90° for the Moon: guess how much dimmer the half Moon is than the full Moon, then check.',
    'Pick the <strong>ocean</strong> and go to a thin crescent: why does the planet get brighter again?',
    'Raise the <strong>wind speed</strong>: does the glint get brighter or just larger?',
  ]));

  const ctl = controls({
    alpha: { type: 'range', label: 'Phase angle', min: 0, max: 175, step: 0.5, value: 60, unit: '°' },
    surf: { type: 'select', label: 'Surface of the sphere', value: 'ocean', options: Object.keys(SURF).map((k) => [k, SURF[k]]) },
    U: { type: 'range', label: 'Wind speed over the sea', min: 0.5, max: 20, step: 0.1, value: 7, unit: 'm/s' },
    ts: { type: 'range', label: 'Sun\'s angle from the zenith (satellite view)', min: 0, max: 75, step: 0.5, value: 30, unit: '°' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const pic = stage({ aspect: 2, label: 'The sphere at this phase angle, and a satellite\'s view of the sun glint on a sea', draw: drawPic, minH: 280 });
  const phase = stage({ aspect: 1.4, label: '', draw: drawPhase, cls: 'plain', minH: 240 });
  const pp = stage({ aspect: 1.4, label: '', draw: drawPP, cls: 'plain', minH: 240 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([pic.el, h('div.grid-2', {}, card(phase), card(pp))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('glint');
  let P = null, lastU = NaN;
  const request = debounce(() => { const U = ctl.state.U; job('glint', { U }).then((r) => { P = r; lastU = U; words(); phase.redraw(); }, () => {}); }, 80);
  function update() { pic.redraw(); pp.redraw(); phase.redraw(); words(); if (ctl.state.U !== lastU) request(); }
  const curveAt = (c, d) => { if (!c) return NaN; const i = Math.min(c.length - 2, Math.floor(d / (c[1][0] - c[0][0]))), f = (d - c[i][0]) / (c[1][0] - c[0][0]); return c[i][1] * (1 - f) + c[i + 1][1] * f; };

  function words() {
    const s = ctl.state, a = s.alpha * RAD, s2 = slopeVar(s.U), prof = principalPlane(s.ts, s.U, -80, 80, 0.25);
    let peak = 0, at = 0; for (const [d, r] of prof) if (r > peak) { peak = r; at = d; }
    const half = prof.filter((q) => q[1] >= peak / 2), fwhm = half.length ? half[half.length - 1][0] - half[0][0] : NaN;
    const ocean = P ? curveAt(P.ocean, s.alpha) / P.ocean[0][1] : NaN;
    ro.replaceChildren(readouts([
      ['Matt sphere (Lambert), relative to full phase', fmt(lambertPhase(a), 3)],
      ['Regolith sphere (Lommel–Seeliger)', fmt(lsPhase(a), 3)],
      ['The real Moon (measured)', `${fmt(moonPhase(s.alpha), 3)} (${fmt(moonMag(s.alpha), 3)} mag)`],
      ['Ocean sphere', P ? fmt(ocean, 3) : '…'],
      ['Mean square wave slope σ²', `${fmt(s2, 3)} (rms ${fmt(Math.atan(Math.sqrt(s2)) / RAD, 3)}°)`],
      ['Peak glint reflectance', `${fmt(peak, 3)} (${fmt(at, 3)}°)`],
      ['Width of the glint (half maximum)', `${fmt(fwhm, 3)}°`],
      ['Fresnel reflectance of water at the Sun\'s angle', fmt(fresnel(Math.cos(s.ts * RAD)), 3)],
    ]));
    calc.say(t('At a phase angle of {a}°, a matt sphere keeps {L} % of its full-phase light and a regolith sphere {LS} %; the real Moon only {M} %, because its rough surface shows shadows. A sea under a {U} m/s wind has wave slopes of {rms}° (rms), so the Sun at {ts}° makes a glint about {w}° wide with a peak reflectance of <strong>{p}</strong>, {x} times the sea\'s own {d}.', {
      a: fmt(s.alpha, 3), L: fmt(100 * lambertPhase(a), 3), LS: fmt(100 * lsPhase(a), 3), M: fmt(100 * moonPhase(s.alpha), 3), U: fmt(s.U, 3), rms: fmt(Math.atan(Math.sqrt(s2)) / RAD, 3), ts: fmt(s.ts, 3), w: fmt(fwhm, 3), p: fmt(peak, 3), x: fmt(peak / WATER_DIFFUSE, 3), d: fmt(WATER_DIFFUSE, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    \Phi_L(\alpha) &= \frac{\sin\alpha + (\pi-\alpha)\cos\alpha}{\pi} = ${texNum(lambertPhase(a), 3)}, \qquad \Phi_{LS}(\alpha) = 1 - \sin\tfrac{\alpha}{2}\tan\tfrac{\alpha}{2}\ln\cot\tfrac{\alpha}{4} = ${texNum(lsPhase(a), 3)}\\
    \sigma^2 &= 0.003 + 0.00512\,U = ${texNum(s2, 3)}, \qquad p(\beta) = \frac{e^{-\tan^2\beta/\sigma^2}}{\pi\sigma^2}\\
    r_g &= \frac{\pi R(\omega)\,p(\beta)}{4\cos\theta_s\cos\theta_v\cos^4\beta} \le ${texNum(peak, 3)}, \qquad R(\theta_s) = ${texNum(fresnel(Math.cos(s.ts * RAD)), 3)}
    \end{aligned}`);
  }

  function drawPic(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const s = ctl.state, a = s.alpha * RAD, s2 = slopeVar(s.U), top = 56, half = w / 2;
    // left: the sphere, observer along +z, Sun in the x–z plane at α from the observer
    const R = Math.min(half * 0.36, (hh - top - 30) / 2), cx = half / 2, cy = top + (hh - top - 20) / 2;
    const sun = [Math.sin(a), 0, Math.cos(a)], view = [0, 0, 1], tint = TINT[s.surf];
    // exposure: the brightest point of this picture (sampled) maps to 0.9
    let mx = 1e-9;
    for (let j = 0; j < 60; j++) for (let i = 0; i < 60; i++) {
      const x = ((i + 0.5) / 60) * 2 - 1, y = ((j + 0.5) / 60) * 2 - 1, r2 = x * x + y * y;
      if (r2 < 1) { const n = [x, -y, Math.sqrt(1 - r2)], cs = n[0] * sun[0] + n[2] * sun[2]; if (cs > 0) mx = Math.max(mx, reflectance(s.surf, n, sun, view, s2) * cs); }
    }
    const k = 0.9 / Math.max(mx, s.surf === 'ocean' ? 0.004 : 1e-9);
    paint(pic, { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1, r2 = x * x + y * y;
      if (r2 >= 1) { o[0] = o[1] = o[2] = 0; return; }
      const n = [x, -y, Math.sqrt(1 - r2)], cs = n[0] * sun[0] + n[2] * sun[2];
      if (cs <= 0) { o[0] = o[1] = o[2] = encode(0.004); return; }
      if (s.surf === 'ocean') {
        const d = WATER_DIFFUSE * cs * k, g = glint(n, sun, view, s2) * cs * k;
        for (let c = 0; c < 3; c++) o[c] = encode(d * tint[c] * 4 + g);
      } else { const L = reflectance(s.surf, n, sun, view, s2) * cs * k; for (let c = 0; c < 3; c++) o[c] = encode(L * tint[c]); }
    }, `s|${s.surf}|${s.alpha}|${s.U}`, 0);
    // the geometry: Sun direction
    ctx.strokeStyle = 'rgba(255,214,120,0.8)'; ctx.fillStyle = 'rgba(255,214,120,0.9)'; ctx.lineWidth = 1.5;
    const sx = cx + Math.sin(a) * (R + 26), sy = cy, ok = Math.abs(Math.sin(a)) > 0.05;
    ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(t('Phase angle {a}° · Sun {where}', { a: fmt(s.alpha, 3), where: s.alpha < 1 ? t('behind you') : s.alpha > 90 ? t('behind the sphere, to the right') : t('to the right, in front') }), 12, top - 22);
    if (ok) { ctx.fillStyle = 'rgba(255,214,120,0.9)'; ctx.beginPath(); ctx.arc(Math.min(half - 12, sx), sy, 5, 0, 7); ctx.fill(); }

    // right: a satellite looking straight down from height H over a sea with an island; the Sun at θs towards −x
    const x0 = half + 12, y0 = top, W = w - x0 - 12, H = hh - top - 12, ts = s.ts * RAD, sunG = [-Math.sin(ts), 0, Math.cos(ts)], span = Math.tan(55 * RAD);
    let gmax = 0.05; for (let d = 0; d <= 70; d += 0.5) gmax = Math.max(gmax, glint([0, 0, 1], sunG, [Math.sin(d * RAD), 0, Math.cos(d * RAD)], s2));
    const kk = 0.85 / Math.max(gmax, 0.12), asp = W / H;
    paint(pic, { x: x0, y: y0, w: W, h: H }, (u, v, o) => {
      const gx = (u * 2 - 1) * span, gy = ((v * 2 - 1) * span) / asp;
      const l = Math.hypot(gx, gy, 1), view = [-gx / l, -gy / l, 1 / l];
      // an island: land where a wavy radius exceeds the distance from its centre
      const ix = gx + 0.55, iy = gy - 0.25, ang = Math.atan2(iy, ix), rad = 0.32 + 0.06 * Math.sin(3 * ang + 1) + 0.04 * Math.sin(7 * ang + 2) + 0.02 * Math.sin(13 * ang);
      if (Math.hypot(ix, iy) < rad) { for (let c = 0; c < 3; c++) o[c] = encode(LAND[c] * Math.cos(ts) * kk + 0.004); return; }
      const g = glint([0, 0, 1], sunG, view, s2), d = WATER_DIFFUSE * 1.5;
      for (let c = 0; c < 3; c++) o[c] = encode((d * TINT.ocean[c] * 6 + g) * kk * Math.cos(ts) + 0.004);
    }, `g|${s.ts}|${s.U}|${W}x${H}`, 1);
    // rings of equal view angle from the satellite
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, W, H); ctx.clip();
    const ccx = x0 + W / 2, ccy = y0 + H / 2, px = W / 2 / span;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const d of [20, 40]) { const r = Math.tan(d * RAD) * px; ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, 7); ctx.stroke(); ctx.fillText(`${d}°`, ccx + 3, ccy - r + 2); }
    ctx.setLineDash([]); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ccx, ccy, 2.5, 0, 7); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(x0 + 0.5, y0 + 0.5, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('From orbit, looking down · Sun {ts}° from the zenith, on the left', { ts: fmt(s.ts, 3) }), x0, top - 22);
  }

  function drawPhase(ctx, w, hh) {
    const s = ctl.state, deg = Array.from({ length: 176 }, (_, i) => i);
    const series = [
      { data: deg.map((d) => [d, lambertPhase(d * RAD)]), color: '#ffd27a', width: 2, label: N_('matt sphere (Lambert)') },
      { data: deg.map((d) => [d, lsPhase(d * RAD)]), color: '#c9ccd6', width: 2, dash: [5, 4], label: N_('regolith (Lommel–Seeliger)') },
      { data: deg.map((d) => [d, moonPhase(d)]), color: '#ffffff', width: 2, label: N_('the real Moon (measured)') },
    ];
    if (P) series.push({ data: P.ocean.map(([d, v]) => [d, v / P.ocean[0][1]]), color: '#6ad7ff', width: 2, label: N_('ocean sphere with glint') });
    plot(ctx, w, hh, {
      title: N_('Brightness against phase angle'), x: { min: 0, max: 175, label: N_('phase angle (°)') }, y: { min: 1e-3, max: 10, log: true, label: N_('brightness relative to full phase') },
      series, vlines: [{ x: s.alpha, label: N_('now'), color: '#ffb547' }], legend: true,
    });
  }

  function drawPP(ctx, w, hh) {
    const s = ctl.state, cur = principalPlane(s.ts, s.U, -10, 80, 0.5);
    const series = [2, 5, 10, 15].map((U, i) => ({ data: principalPlane(s.ts, U, -10, 80, 0.5), color: ['#3d6fd8', '#4f9be8', '#6ad7ff', '#a9ecff'][i], width: 1.2, dash: [4, 3], label: [N_('2 m/s'), N_('5 m/s'), N_('10 m/s'), N_('15 m/s')][i] }));
    series.push({ data: cur, color: '#ffb547', width: 2.4, label: N_('this wind') });
    const top = Math.max(...cur.map((q) => q[1]), 0.05) * 1.15;
    plot(ctx, w, hh, {
      title: N_('Glint seen along the Sun\'s plane'), x: { min: -10, max: 80, label: N_('viewing angle from the vertical, away from the Sun (°)') }, y: { min: 0, max: Math.min(top, 3), label: N_('glint reflectance factor') },
      series, vlines: [{ x: s.ts, label: N_('mirror direction'), color: 'rgba(255,255,255,0.4)' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[\Phi_L(\alpha) = \frac{\sin\alpha + (\pi-\alpha)\cos\alpha}{\pi}, \qquad \sigma^2 = 0.003 + 0.00512\,U\]
<p>A matt sphere at half phase (α = 90°) sends \(1/\pi = 32\%\) of its full-phase light; the real Moon only about 9 %, 2.6 magnitudes fainter. A sea under a 7 m/s wind has \(\sigma^2 = 0.039\), an rms slope of 11°; with the Sun 30° from the zenith the glint peaks at a reflectance of about 0.19 (ten times the sea's own 0.02) and is about 40° wide at half maximum.</p>`,
    String.raw`The phase curves are for spheres of one material, without atmosphere, limb effects or roughness; the measured lunar curve (Allen) holds for 0–150°. Cox & Munk's slope law is isotropic here (real seas are rougher along the wind), ignores shadowing of facets at grazing angles, foam and the light from below the surface; the island and the sea's own colour are illustrative. Each picture is exposed for its own brightest point.`));
  root.append(theory('Light scattered back and mirrored', String.raw`
<div class="theory-cols"><div>
<h3>Phase curves</h3>
<p>Summing the radiance of every visible element of a sphere lit at phase angle \(\alpha\) gives its phase function. For Lambert's law it is \(\Phi_L = [\sin\alpha + (\pi-\alpha)\cos\alpha]/\pi\) (Russell 1916). Dark, porous soils scatter light once, \(L \propto \cos\theta_s/(\cos\theta_s+\cos\theta_v)\) (Lommel–Seeliger), which leaves the full Moon without limb darkening and gives \(\Phi_{LS} = 1 - \sin\tfrac{\alpha}{2}\tan\tfrac{\alpha}{2}\ln\cot\tfrac{\alpha}{4}\). The real Moon falls even faster: its surface is rough on every scale, and its own shadows show except when the Sun is right behind us. Near \(\alpha = 0\) they hide and coherent backscatter adds, the <em>opposition surge</em> (Hapke 2012).</p>
<h3>Astronomy</h3>
<p>Phase curves tell planetary scientists how rough and porous a surface is, and help to find an exoplanet's clouds or oceans from its reflected light. An ocean world brightens towards the crescent, where the Fresnel reflectance of water climbs towards 1.</p>
</div><div>
<h3>Sun glint</h3>
<p>Cox &amp; Munk (1954) photographed the glint from an aircraft over Hawaii and found that the slopes of the sea surface are close to Gaussian with a variance \(\sigma^2 = 0.003 + 0.00512\,U\). A facet tilted by \(\beta\) mirrors the Sun into the viewer; the probability density of such tilts, the Fresnel reflectance \(R(\omega)\) and the change of solid angle give \(r_g = \pi R\,p(\beta)/(4\cos\theta_s\cos\theta_v\cos^4\beta)\). Calm seas give a small, intense glint; wind spreads it into a wide, dimmer patch.</p>
<h3>In practice</h3>
<p>Ocean-colour satellites tilt away from the glint or flag and correct it (Kay et al. 2009); the same glint measures wind speed and shows oil slicks, which calm the waves.</p>
</div></div>`));
  root.append(references([
    'C. Cox &amp; W. Munk, "Measurement of the roughness of the sea surface from photographs of the sun\'s glitter", J. Opt. Soc. Am. 44, 838 (1954).',
    'H. N. Russell, "On the albedo of the planets and their satellites", Astrophys. J. 43, 173 (1916).',
    'B. Hapke, <i>Theory of Reflectance and Emittance Spectroscopy</i>, 2nd ed., Cambridge University Press (2012).',
    'C. W. Allen, <i>Astrophysical Quantities</i>, 3rd ed., Athlone Press (1976).',
    'S. Kay, J. D. Hedley &amp; S. Lavender, "Sun glint correction of high and low spatial resolution images of aquatic scenes: a review", Remote Sens. 1, 697 (2009).',
  ]));
  return () => [pic, phase, pp].forEach((s) => s.destroy());
}
