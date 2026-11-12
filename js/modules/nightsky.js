// The natural night sky: airglow and zodiacal light across the whole sky, the darkest sky a camera on
// the ground can have, and what it costs in limiting magnitude.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode } from '../lib/pixels.js';
import { colormap } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { geometry, skyAt, zodiacal, airglow, airglowZenith, vanRhijn, airmass, extinction, toMag, fisheye, vec, eclipticOf, RAD } from '../lib/nightsky.js';
import { t, N_ } from '../lib/i18n.js';

const GRID = 160, MU_HI = 19.5, MU_LO = 23; // false-colour range, mag/arcsec²
const TINT_AG = [0.55, 1, 0.62], TINT_ZL = [1, 0.9, 0.74];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>Even far from any town, the night sky is never black. High in the atmosphere, about 90 km up, atoms and molecules that the Sun's ultraviolet light split apart by day recombine at night and glow faintly: the <em>airglow</em>, green and red in long photographs. It looks brightest near the horizon, where we look through the glowing layer at a slant.</p>
<p>Sunlight is also scattered by dust between the planets, which lies in the plane of the planets' orbits: the <em>zodiacal light</em>, a tilted cone rising from where the Sun has set, and a faint glow exactly opposite the Sun. Together they set the darkest sky any camera on Earth can see.</p>`, [
    'Make the <strong>ecliptic steep</strong> (as on spring evenings in the north), then shallow: when does the zodiacal cone stand out?',
    'Turn up the <strong>solar activity</strong>: how much brighter is the zenith, and how many magnitudes of faint stars does it cost?',
    'Point the target at the <strong>horizon</strong> and then at the zenith: which part of the sky is darkest?',
  ]));

  const ctl = controls({
    iota: { type: 'range', label: 'Angle of the ecliptic to the horizon', min: 20, max: 90, step: 1, value: 65, unit: '°' },
    depth: { type: 'range', label: 'Sun below the western horizon', min: 18, max: 60, step: 0.5, value: 22, unit: '°' },
    activity: { type: 'range', label: 'Solar activity (0 = minimum, 1 = maximum)', min: 0, max: 1, step: 0.05, value: 0.3 },
    k: { type: 'range', label: 'Extinction coefficient (V)', min: 0.1, max: 0.4, step: 0.01, value: 0.15, unit: 'mag/airmass' },
    alt: { type: 'range', label: 'Target altitude', min: 5, max: 90, step: 1, value: 50, unit: '°' },
    az: { type: 'range', label: 'Target azimuth (0 = north, 90 = east)', min: 0, max: 359, step: 1, value: 180, unit: '°' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const sky = stage({ aspect: 2, label: 'The whole sky from a dark site: a long exposure and a brightness map', draw: drawSky, minH: 280 });
  const ecl = stage({ aspect: 1.4, label: '', draw: drawEcl, cls: 'plain', minH: 230 });
  const mer = stage({ aspect: 1.4, label: '', draw: drawAlt, cls: 'plain', minH: 230 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([sky.el, h('div.grid-2', {}, card(ecl), card(mer))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('nightsky');
  let G = null;
  const p = () => { const s = ctl.state; return { iota: Math.max(s.iota, s.depth + 0.5), depth: s.depth, activity: s.activity, k: s.k, n: GRID }; };
  const key = () => JSON.stringify(p());
  const request = debounce(() => { const k = key(); job('nightsky', p()).then((r) => { G = { ...r, key: k }; sky.redraw(); words(); }, () => {}); }, 60);
  function update() { request(); words(); sky.redraw(); ecl.redraw(); mer.redraw(); }

  // the darkest point of the sky above 10° altitude (from the grid)
  function darkest() {
    if (!G) return null;
    let best = Infinity, at = null;
    for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) {
      const x = ((i + 0.5) / G.n) * 2 - 1, y = ((j + 0.5) / G.n) * 2 - 1, r = Math.hypot(x, y), v = G.zl[j * G.n + i] + G.ag[j * G.n + i];
      if (r <= 80 / 90 && v < best) { best = v; at = [90 - r * 90, (Math.atan2(-x, -y) / RAD + 360) % 360]; }
    }
    return { s10: best, at };
  }

  function words() {
    const s = ctl.state, q = p(), geo = geometry(q.iota, q.depth), tg = skyAt(s.alt, s.az, geo, s.activity, s.k), zen = skyAt(90, 0, geo, s.activity, s.k), dk = darkest();
    const loss = dk ? 1.25 * Math.log10(tg.total / dk.s10) : NaN;
    ro.replaceChildren(readouts([
      ['Sky at the target', Number.isFinite(tg.total) ? `${fmt(toMag(tg.total), 4)} mag/arcsec² (${fmt(tg.total, 3)} S10)` : '—'],
      ['… airglow', `${fmt(tg.ag, 3)} S10`],
      ['… zodiacal light', Number.isFinite(tg.zl) ? `${fmt(tg.zl, 3)} S10` : '—'],
      ['Target: ecliptic latitude, longitude from the Sun', `${fmt(tg.beta, 3)}°, ${fmt(tg.dLon, 3)}°`],
      ['Airmass at the target', fmt(airmass(90 - s.alt), 3)],
      ['Sky at the zenith', `${fmt(toMag(zen.total), 4)} mag/arcsec²`],
      ['Darkest sky above 10°', dk ? `${fmt(toMag(dk.s10), 4)} mag/arcsec² (alt ${fmt(dk.at[0], 2)}°, az ${fmt(dk.at[1], 3)}°)` : '…'],
      ['Faint stars lost at the target, against the darkest point', dk ? `${fmt(loss, 2)} mag` : '…'],
    ]));
    calc.say(t('At altitude {alt}° the airglow layer is seen {vr} times thicker than overhead, giving {ag} S10; the zodiacal light there, {beta}° from the ecliptic and {lon}° from the Sun, adds {zl} S10. The sky is <strong>{mu} mag/arcsec²</strong>, and a sky-limited exposure there reaches {loss} mag less deep than at the darkest point of the sky.', {
      alt: fmt(s.alt, 3), vr: fmt(vanRhijn(90 - s.alt), 3), ag: fmt(tg.ag, 3), beta: fmt(Math.abs(tg.beta), 3), lon: fmt(tg.dLon, 3), zl: fmt(tg.zl, 3), mu: fmt(toMag(tg.total), 4), loss: fmt(loss, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    I_\text{ag} &= I_0\,\frac{10^{-0.4kX}}{10^{-0.4k}}\Big/\sqrt{1-\Big(\frac{R}{R+h}\Big)^2\sin^2 z} = ${texNum(airglowZenith(s.activity), 3)} \times ${texNum(vanRhijn(90 - s.alt), 3)} \times ${texNum(extinction(90 - s.alt, s.k) / extinction(0, s.k), 3)} = ${texNum(tg.ag, 3)}\ \text{S10}\\
    I_\text{zl} &= Z(\lambda-\lambda_\odot, \beta)\,10^{-0.4kX} = ${texNum(zodiacal(tg.dLon, tg.beta), 3)} \times ${texNum(extinction(90 - s.alt, s.k), 3)} = ${texNum(tg.zl, 3)}\ \text{S10}\\
    \mu &= 10 - 2.5\log_{10}\frac{I_\text{ag}+I_\text{zl}}{3600^2} = ${texNum(toMag(tg.total), 4)}\ \text{mag arcsec}^{-2}, \qquad \Delta m_\text{lim} = 1.25\log_{10}\frac{I}{I_\text{min}} = ${texNum(loss, 2)}
    \end{aligned}`);
  }

  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!G) return;
    const s = ctl.state, top = 46, R = Math.min((w / 2 - 40) / 2, (hh - top - 46) / 2), cy = top + R, cxs = [w / 4, (3 * w) / 4];
    const sample = (x, y, arr) => { const i = Math.min(G.n - 1, Math.max(0, Math.floor(((x + 1) / 2) * G.n))), j = Math.min(G.n - 1, Math.max(0, Math.floor(((y + 1) / 2) * G.n))); return arr[j * G.n + i]; };
    // bilinear sample of a grid
    const bil = (x, y, arr) => {
      const fx = ((x + 1) / 2) * G.n - 0.5, fy = ((y + 1) / 2) * G.n - 0.5, i = Math.max(0, Math.min(G.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(G.n - 2, Math.floor(fy))), a = fx - i, b = fy - j;
      const v = [arr[j * G.n + i], arr[j * G.n + i + 1], arr[(j + 1) * G.n + i], arr[(j + 1) * G.n + i + 1]];
      if (v.some((q) => !Number.isFinite(q))) return sample(x, y, arr);
      return (1 - a) * (1 - b) * v[0] + a * (1 - b) * v[1] + (1 - a) * b * v[2] + a * b * v[3];
    };
    // left: a long exposure in natural colours (linear in light: 4000 S10 would be white)
    paint(sky, { x: cxs[0] - R, y: cy - R, w: 2 * R, h: 2 * R }, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1;
      if (x * x + y * y > 1) { o[0] = o[1] = o[2] = 0; return; }
      const zl = bil(x, y, G.zl), ag = bil(x, y, G.ag), z = Number.isFinite(zl) ? zl : 3000;
      for (let c = 0; c < 3; c++) o[c] = encode((ag * TINT_AG[c] + z * TINT_ZL[c]) / 4000);
    }, G.key, 0);
    // right: false colour in mag/arcsec²
    paint(sky, { x: cxs[1] - R, y: cy - R, w: 2 * R, h: 2 * R }, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1;
      if (x * x + y * y > 1) { o[0] = o[1] = o[2] = 0; return; }
      const zl = bil(x, y, G.zl), ag = bil(x, y, G.ag), mu = Number.isFinite(zl) ? toMag(zl + ag) : MU_HI, c = colormap('inferno', (MU_LO - mu) / (MU_LO - MU_HI) * 0.95 + 0.02);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    }, G.key, 1);
    // overlays: horizon, altitude rings, cardinal points, the ecliptic, the target
    const geo = geometry(p().iota, s.depth), ecl = [];
    for (let l = 0; l <= 360; l += 2) {
      // a point on the ecliptic: rotate the Sun about the pole by l
      const P = geo.pole, S = geo.sun, c = Math.cos(l * RAD), sn = Math.sin(l * RAD), cr = [P[1] * S[2] - P[2] * S[1], P[2] * S[0] - P[0] * S[2], P[0] * S[1] - P[1] * S[0]];
      const d = [S[0] * c + cr[0] * sn, S[1] * c + cr[1] * sn, S[2] * c + cr[2] * sn], alt = Math.asin(d[2]) / RAD, az = (Math.atan2(d[0], d[1]) / RAD + 360) % 360;
      ecl.push(alt >= 0 ? fisheye(alt, az) : null);
    }
    cxs.forEach((cx, k) => {
      ctx.save(); ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; for (const a of [30, 60]) { ctx.beginPath(); ctx.arc(0, 0, R * (90 - a) / 90, 0, 7); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,214,120,0.6)'; ctx.setLineDash([5, 4]); ctx.beginPath(); let pen = false;
      for (const q of ecl) { if (!q) { pen = false; continue; } if (pen) ctx.lineTo(q[0] * R, q[1] * R); else ctx.moveTo(q[0] * R, q[1] * R); pen = true; }
      ctx.stroke(); ctx.setLineDash([]);
      const [tx, ty] = fisheye(s.alt, s.az); ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx * R, ty * R, 7, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [[t('N'), 0, -1], [t('S'), 0, 1], [t('E'), -1, 0], [t('W'), 1, 0]].forEach(([l, x, y]) => ctx.fillText(l, x * (R + 11), y * (R + 11)));
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(k ? t('Brightness, {a}–{b} mag/arcsec²', { a: MU_HI, b: MU_LO }) : t('Long exposure: airglow (green) and zodiacal light'), cx, hh - 18);
    });
  }

  function drawEcl(ctx, w, hh) {
    const lon = Array.from({ length: 166 }, (_, i) => 15 + i), series = [0, 30, 60].map((b, i) => ({ data: lon.map((l) => [l, zodiacal(l, b)]), color: ['#ffd27a', '#ffb547', '#c18cff'][i], width: 2, label: [N_('on the ecliptic'), N_('30° from it'), N_('60° from it')][i] }));
    series.push({ data: [[15, airglowZenith(ctl.state.activity)], [180, airglowZenith(ctl.state.activity)]], color: '#6be3a4', width: 1.5, dash: [5, 4], label: N_('airglow at the zenith') });
    const tg = skyAt(ctl.state.alt, ctl.state.az, geometry(p().iota, ctl.state.depth), ctl.state.activity, ctl.state.k);
    plot(ctx, w, hh, {
      title: N_('Zodiacal light above the atmosphere'), x: { min: 15, max: 180, label: N_('longitude from the Sun (°)') }, y: { min: 40, max: 10000, log: true, label: N_('brightness (S10)') },
      series, vlines: [{ x: tg.dLon, label: N_('target'), color: '#6ad7ff' }, { x: 180, label: N_('gegenschein'), color: 'rgba(255,255,255,0.3)', dy: 14 }], legend: true,
    });
  }

  function drawAlt(ctx, w, hh) {
    const s = ctl.state, geo = geometry(p().iota, s.depth), ag = [], zl = [], tot = [];
    for (let a = 2; a <= 90; a += 1) { const q = skyAt(a, s.az, geo, s.activity, s.k); ag.push([a, q.ag]); if (Number.isFinite(q.zl)) { zl.push([a, q.zl]); tot.push([a, q.total]); } }
    plot(ctx, w, hh, {
      title: N_('From the horizon to the zenith'), x: { min: 0, max: 90, label: N_('altitude (°)') }, y: { min: 30, max: 3000, log: true, label: N_('brightness (S10)') },
      series: [{ data: ag, color: '#6be3a4', width: 1.8, dash: [5, 4], label: N_('airglow') }, { data: zl, color: '#ffd27a', width: 1.8, dash: [2, 3], label: N_('zodiacal light') }, { data: tot, color: '#ffffff', width: 2.2, label: N_('total') }],
      vlines: [{ x: s.alt, label: N_('target'), color: '#6ad7ff' }], legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[\mu = 10 - 2.5\log_{10}\frac{I_\text{S10}}{3600^2}\ \text{mag arcsec}^{-2}, \qquad \Delta m_\text{lim} = 1.25\log_{10}\frac{I}{I_\text{min}}\]
<p>The darkest natural sky is about 220 S10 at the zenith, 21.9 mag/arcsec²: some 140 S10 of airglow and 60–80 S10 of zodiacal light. Where the sky limits an exposure, the faintest star reached gets brighter by 1.25 magnitudes for every tenfold rise in sky brightness; a sky twice as bright, near the horizon or in the zodiacal cone, costs 0.38 mag.</p>`,
    String.raw`V band only; no starlight, Milky Way or light pollution, and no Moon. The zodiacal light is Leinert's table (500 nm, outside the atmosphere) bilinearly interpolated, without its seasonal and colour variations; the airglow is a uniform layer at 90 km with a fixed zenith brightness for the solar cycle (it varies by about ±0.3 mag from night to night and has waves and bands). Extinction dims both by 10^(−0.4kX); light scattered within the atmosphere is ignored. The ecliptic is simplified to a great circle through the west point.`));
  root.append(theory('The light of the night sky', String.raw`
<div class="theory-cols"><div>
<h3>Airglow</h3>
<p>By day, solar ultraviolet light splits oxygen molecules; at night the atoms recombine in a layer near 95 km and excite the green oxygen line at 557.7 nm. Hydroxyl molecules near 87 km emit the Meinel bands, which dominate the red and near infrared, and sodium (589 nm) and higher oxygen (630 nm) add more lines. Seen at zenith angle \(z\), a thin layer at height \(h\) is crossed along a path longer by the van Rhijn factor \(1/\sqrt{1-(R/(R+h))^2\sin^2 z}\), six times at the horizon. Its brightness follows the solar cycle by about half a magnitude (Patat 2008).</p>
<h3>Units</h3>
<p>Astronomers measure the sky in S10, the light of one star of magnitude 10 spread over a square degree (\(\mu = 23.3\) for 60 S10), or directly in magnitudes per square arcsecond.</p>
</div><div>
<h3>Zodiacal light</h3>
<p>Dust from comets and asteroid collisions, grains of 10–100 µm, fills the inner solar system in a flattened cloud. It scatters sunlight mostly forwards, so the zodiacal light is strongest near the Sun (thousands of S10 at 20°), falls to about 60 S10 at the ecliptic poles and rises slightly again opposite the Sun, the <em>gegenschein</em>, where the grains show their fully lit faces. Its spectrum is the Sun's, slightly reddened.</p>
<h3>For telescopes</h3>
<p>Above the atmosphere airglow vanishes but the zodiacal light remains: it is the main background for Hubble and JWST in the visible and near infrared, so faint targets are observed far from the Sun and the ecliptic. On the ground, astronomical twilight ends when the Sun is 18° below the horizon; after that only these natural sources (and artificial light) remain.</p>
</div></div>`));
  root.append(references([
    'Ch. Leinert et al., "The 1997 reference of diffuse night sky brightness", Astron. Astrophys. Suppl. Ser. 127, 1 (1998).',
    'F. Patat, "UBVRI night sky brightness during sunspot maximum at ESO-Paranal", Astron. Astrophys. 400, 1183 (2003).',
    'F. Patat, "The dancing sky: 6 years of night-sky observations at Cerro Paranal", Astron. Astrophys. 481, 575 (2008).',
    'K. Krisciunas &amp; B. E. Schaefer, "A model of the brightness of moonlight", Publ. Astron. Soc. Pac. 103, 1033 (1991).',
    'F. E. Roach &amp; J. L. Gordon, <i>The Light of the Night Sky</i>, Reidel (1973).',
  ]));
  return () => [sky, ecl, mer].forEach((s) => s.destroy());
}
