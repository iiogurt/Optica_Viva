// Laser guide stars and the cone effect: an artificial star high in the atmosphere lets adaptive
// optics work anywhere in the sky, but its light crosses the turbulence in a cone, not the cylinder
// a real star's light fills, so the correction it guides is slightly wrong.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paintMap } from '../lib/pixels.js';
import { lut } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { coneError } from '../lib/lgs.js';
import { t } from '../lib/i18n.js';

const RDBU = lut('viridis');
const HS = Array.from({ length: 28 }, (_, i) => 5e3 * (200 / 5) ** (i / 27)); // laser heights 5–200 km

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Adaptive optics measures how the air bends a star's light and reshapes a mirror hundreds of times a second to undo it. It needs a bright star to measure, and most of the sky has none nearby. So observatories make one: a laser lights a small spot high up, in a layer of sodium atoms 90 km above us, or lower in the air.</p>
<p>That artificial star is not infinitely far away. Its light reaches the telescope in a narrowing cone, so it crosses a high patch of turbulent air through a smaller area than the starlight does, like looking through a smaller window. The correction is then a little wrong, more so for big telescopes and for low lasers.</p>`, [
    'Bring the laser down from the sodium layer (90 km) to <strong>15 km</strong>, like a Rayleigh laser: how much sharpness is lost?',
    'Make the telescope <strong>five times bigger</strong> with the same laser: does the cone effect matter more or less?',
    'Put <strong>all the turbulence near the ground</strong>: does it still matter how high the laser is?',
  ]));

  const ctl = controls({
    D: { type: 'range', label: 'Telescope diameter', min: 1, max: 40, log: true, value: 8, fmt: (v) => `${fmt(v, 3)} m` },
    H: { type: 'range', label: 'Height of the laser guide star', min: 5, max: 200, log: true, value: 90, fmt: (v) => `${fmt(v, 3)} km` },
    hHigh: { type: 'range', label: 'Height of the high turbulent layer', min: 1, max: 20, step: 0.5, value: 10, unit: 'km' },
    wHigh: { type: 'range', label: 'Share of the turbulence up there', min: 0, max: 1, step: 0.05, value: 0.4 },
    r0: { type: 'range', label: 'Fried parameter r₀ (500 nm, zenith)', min: 5, max: 30, step: 0.5, value: 15, unit: 'cm' },
    zeta: { type: 'range', label: 'Zenith angle', min: 0, max: 60, step: 1, value: 0, unit: '°' },
    lam: { type: 'range', label: 'Observing wavelength', min: 0.5, max: 2.2, step: 0.05, value: 1.65, unit: 'µm' },
  }, () => update());
  const naBtn = h('button.btn', { type: 'button', onclick: () => { ctl.set.H(90); update(); } }, t('Sodium laser (90 km)'));
  const raBtn = h('button.btn', { type: 'button', onclick: () => { ctl.set.H(15); update(); } }, t('Rayleigh laser (15 km)'));
  const ro = h('div'), calc = liveCalc();
  const geo = stage({ aspect: 1, label: 'Starlight fills a cylinder, laser light a cone', draw: drawGeo, minH: 240 });
  const maps = stage({ aspect: 1, label: 'The high layer: what each light crosses (one realisation)', draw: drawMaps, minH: 240 });
  const ch = stage({ aspect: 2.3, label: '', draw: drawCurve, cls: 'plain', minH: 220 });
  const chD = stage({ aspect: 2.3, label: '', draw: drawD, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing the cone effect…'));
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([h('div.grid-2', {}, geo.el, maps.el), note, card(ch), card(chD)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, naBtn, raBtn)), h('div.card', {}, ro), calc.el]));

  const job = latest('lgs');
  let R = null, key = '', timer = 0;
  const par = (st) => ({ D: st.D, H: st.H * 1e3, r0: st.r0 / 100, wHigh: st.wHigh, hHigh: st.hHigh * 1e3, zeta: (st.zeta * Math.PI) / 180, lam: st.lam * 1e-6 });

  function update() {
    const st = ctl.state, p = par(st), e = coneError(p);
    words(st, p, e);
    geo.redraw(); chD.redraw();
    const k = JSON.stringify(p);
    if (k === key) return;
    key = k;
    clearTimeout(timer);
    timer = setTimeout(() => {
      note.textContent = t('Computing the cone effect…');
      job('lgs', { ...p, Hs: HS }).then((r) => {
        R = { ...r, key: k, st: { ...st } };
        note.textContent = t('Left: the cylinder of starlight (blue) and the cone of laser light (amber) cross the high layer through areas of different size. Right: one random high layer as the star sees it, as the laser sees it (its middle {a} % stretched over the aperture), and their difference with piston and tilt removed: what the adaptive optics gets wrong. All three share one colour scale.', { a: Math.round(100 * Math.max(0, 1 - p.hHigh / p.H)) });
        maps.redraw(); ch.redraw();
      }, (err) => console.error(err));
    }, R ? 150 : 0);
  }
  function words(st, p, e) {
    const star = (1 - p.hHigh / p.H);
    ro.replaceChildren(readouts([
      ['Laser light’s footprint on the high layer', `${fmt(100 * Math.max(0, star), 3)} % ${t('of the aperture')}`],
      ['d₀ at the observing wavelength', isFinite(e.d0) ? `${fmt(e.d0, 3)} m` : '∞'],
      ['Cone-effect error (piston and tilt removed)', `${fmt(e.nm, 3)} nm RMS`],
      ['Strehl ratio from the cone effect alone', fmt(e.strehl, 3)],
    ]));
    calc.say(t('On an {D} m telescope the laser at {H} km leaves <strong>{nm} nm</strong> of wavefront error from the cone effect alone: a Strehl ratio of <strong>{s}</strong> at {l} µm. The telescope would need to be smaller than d₀ = {d0} for the error to stay below one radian.', { D: fmt(st.D, 3), H: fmt(st.H, 3), nm: fmt(e.nm, 3), s: fmt(e.strehl, 2), l: st.lam, d0: isFinite(e.d0) ? `${fmt(e.d0, 3)} m` : '∞' }));
    calc.set(String.raw`\begin{aligned}
    \alpha &= 1 - \frac hH = ${texNum(Math.max(0, star), 3)}\\
    \sigma^2 &= 6.88\,F(\alpha)\,(D/r_h)^{5/3}\\
    &= ${texNum(e.s2, 3)}\ \text{rad}^2\\
    d_0 &= D\,\sigma^{-6/5} = ${isFinite(e.d0) ? texNum(e.d0, 3) : '\\infty'}\ \text{m}\\
    S &\approx e^{-\sigma^2} = ${texNum(e.strehl, 3)}
    \end{aligned}`);
  }

  function drawGeo(ctx, w, hh) {
    const st = ctl.state, p = par(st);
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    const top = 36, bot = hh - 30, Hm = Math.max(p.H, p.hHigh) * 1.08, Y = (z) => bot - (z / Hm) * (bot - top), cx = w / 2, half = w * 0.18; // the aperture drawn this wide
    // the layers
    for (const [z, a, lab] of [[0, 1 - p.wHigh, t('ground layer')], [p.hHigh, p.wHigh, t('high layer, {h} km', { h: fmt(st.hHigh, 3) })]]) {
      ctx.fillStyle = `rgba(160,190,255,${(0.08 + 0.35 * a).toFixed(3)})`; ctx.fillRect(16, Y(z) - 5, w - 32, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillText(lab, 20, Y(z) - 8);
    }
    // the star's cylinder and the laser's cone (widths exaggerated sideways, heights to scale)
    ctx.fillStyle = 'rgba(106,215,255,0.12)'; ctx.fillRect(cx - half, top, 2 * half, bot - top);
    ctx.strokeStyle = 'rgba(106,215,255,0.8)'; ctx.beginPath(); ctx.moveTo(cx - half, bot); ctx.lineTo(cx - half, top); ctx.moveTo(cx + half, bot); ctx.lineTo(cx + half, top); ctx.stroke();
    ctx.fillStyle = 'rgba(255,181,71,0.25)'; ctx.beginPath(); ctx.moveTo(cx - half, bot); ctx.lineTo(cx, Y(p.H)); ctx.lineTo(cx + half, bot); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,0.9)'; ctx.beginPath(); ctx.moveTo(cx - half, bot); ctx.lineTo(cx, Y(p.H)); ctx.lineTo(cx + half, bot); ctx.stroke();
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(cx, Y(p.H), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,214,140,0.95)'; ctx.fillText(t('laser guide star, {H} km', { H: fmt(st.H, 3) }), cx + 10, Y(p.H) + 4);
    // the footprints on the high layer
    const a = Math.max(0, 1 - p.hHigh / p.H), yl = Y(p.hHigh);
    ctx.lineWidth = 3; ctx.strokeStyle = '#6ad7ff'; ctx.beginPath(); ctx.moveTo(cx - half, yl + 3); ctx.lineTo(cx + half, yl + 3); ctx.stroke();
    ctx.strokeStyle = '#ffb547'; ctx.beginPath(); ctx.moveTo(cx - a * half, yl - 3); ctx.lineTo(cx + a * half, yl - 3); ctx.stroke(); ctx.lineWidth = 1;
    // the telescope
    ctx.fillStyle = '#c9d4e6'; ctx.fillRect(cx - half, bot, 2 * half, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(t('telescope, {D} m (widths not to scale)', { D: fmt(st.D, 3) }), cx - half, bot + 20);
  }
  function drawMaps(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const { m, pts, star, las, res } = R.maps, panels = [[star, t('the star sees')], [las, t('the laser sees')], [res, t('the error')]];
    const sz = Math.min((w - 16) / 2, (hh - 40) / 2), pos = [[4, 30], [w / 2 + 4, 30], [w / 4 + 4, 30 + sz + 6]];
    let lim = 0;
    for (const v of star) lim = Math.max(lim, Math.abs(v));
    panels.forEach(([vals, lab], k) => {
      const a = new Float32Array(m * m).fill(NaN), mask = new Float32Array(m * m);
      pts.forEach(([i, j], n) => { a[j * m + i] = vals[n]; mask[j * m + i] = 1; });
      paintMap(maps, { x: pos[k][0], y: pos[k][1], w: sz, h: sz }, { a, w: m, h: m, lut: RDBU, mask, value: (v) => 0.5 + v / (2 * lim), linear: true }, `${R.key}|${k}`, k);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(lab, pos[k][0] + 4, pos[k][1] + sz - 6);
    });
  }
  function drawCurve(ctx, w, hh) {
    const st = ctl.state;
    if (!R || R.key !== JSON.stringify(par(st))) { plot(ctx, w, hh, { title: 'Strehl ratio from the cone effect against the laser’s height', x: { min: 5, max: 200, log: true, label: 'height of the guide star (km)' }, y: { min: 0, max: 1, label: 'Strehl ratio' }, series: [] }); return; }
    plot(ctx, w, hh, {
      title: 'Strehl ratio from the cone effect against the laser’s height', x: { min: 5, max: 200, log: true, label: 'height of the guide star (km)' }, y: { min: 0, max: 1, label: 'Strehl ratio' },
      series: [{ data: R.curve.map((c) => [c.H / 1e3, c.strehl]), color: '#ffb547', width: 2.2, label: t('{D} m telescope at {l} µm', { D: fmt(st.D, 3), l: st.lam }) }],
      vlines: [{ x: 90, color: 'rgba(255,214,102,0.5)' }, { x: 15, color: 'rgba(197,139,255,0.5)' }, { x: st.H, color: 'rgba(255,255,255,0.7)' }, { x: st.hHigh, color: 'rgba(160,190,255,0.5)' }], legend: true,
    });
  }
  function drawD(ctx, w, hh) {
    const st = ctl.state, p = par(st), Ds = Array.from({ length: 60 }, (_, i) => 40 ** (i / 59));
    const s = (H) => Ds.map((D) => [D, coneError({ ...p, D, H, n: 20000 }).nm]);
    plot(ctx, w, hh, {
      title: 'Cone-effect error against telescope size', x: { min: 1, max: 40, log: true, label: 'telescope diameter (m)' }, y: { min: 1, max: 2000, log: true, label: 'RMS wavefront error (nm)' },
      series: [
        { data: s(90e3), color: '#ffd27a', width: 2, label: t('sodium laser, 90 km') },
        { data: s(15e3), color: '#c58bff', width: 2, label: t('Rayleigh laser, 15 km') },
        { data: s(p.H), color: '#ffffff', width: 1.4, dash: [5, 3], label: t('this laser') },
      ],
      hlines: [{ y: (st.lam * 1000) / (2 * Math.PI), color: 'rgba(120,230,160,0.6)' }], vlines: [{ x: st.D, color: 'rgba(255,255,255,0.4)' }], legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[\sigma^2 = \left(\frac{D}{d_0}\right)^{5/3}\]
<p>The cone effect grows with the telescope's diameter \(D\) as \(D^{5/3}\), measured against a diameter \(d_0\) set by the laser's height and how much turbulence lies high up. With a 15 cm \(r_0\), 40 % of the turbulence 10 km up and a sodium laser at 90 km, \(d_0\) is about 12 m at 1.65 µm: an 8 m telescope keeps a Strehl ratio near 0.6 from this effect alone, a 40 m one almost nothing, unless it uses several lasers.</p>`,
    String.raw`For a single laser and a two-layer atmosphere. Real profiles have turbulence at many heights, and the sodium layer itself is several kilometres thick and moves. Several lasers around the field (laser tomography) measure the high layers from several directions and largely remove the cone effect; a laser also cannot measure the overall tilt, so a faint natural star is still needed for that.`));
  root.append(theory('The cone effect, from the structure function', String.raw`
<div class="theory-cols"><div>
<h3>Cone and cylinder</h3>
<p>Light from a star at infinity crosses every layer through a cylinder as wide as the telescope; light from a guide star at height \(H\) crosses a layer at height \(h\) through a disc shrunk by \(\alpha = 1 - h/H\). If the layer adds the phase \(\varphi\), the star's light carries \(\varphi(\mathbf x)\) at the aperture point \(\mathbf x\), the laser's \(\varphi(\alpha\mathbf x)\), and the adaptive optics, guided by the laser, leaves the error</p>
\[e(\mathbf x) = \varphi(\mathbf x) - \varphi(\alpha\mathbf x).\]
<p>The laser cannot sense tilt: its light goes up and comes down through the same air, so the spot's apparent position does not tell the tilt; a natural star measures it. So piston and tilt are removed. For Kolmogorov turbulence, \(D_\varphi(r) = 6.88\,(r/r_0)^{5/3}\), the remaining variance is a fourfold integral of the structure function:</p>
\[\sigma^2 = \frac{1}{2A^2}\iint D_e(\mathbf x, \mathbf y) + \frac1A\sum_{k=x,y}\frac{\tfrac12\iint Z_k(\mathbf x)Z_k(\mathbf y)\,D_e(\mathbf x, \mathbf y)}{\int Z_k^2},\]
<p>with \(D_e(\mathbf x, \mathbf y) = -\tfrac12\sum_{ij} c_ic_j D_\varphi(P_i - P_j)\) over the four points \(\mathbf x, \alpha\mathbf x, \mathbf y, \alpha\mathbf y\) with weights \(1, -1, -1, 1\), and \(Z_k\) the tilts. The page integrates it by Monte Carlo over pairs of points in the aperture: \(\sigma^2 = 6.88\,F(\alpha)\,(D/r_0)^{5/3}\) for one layer.</p>
</div><div>
<h3>Checks</h3>
<p>At \(\alpha = 0\), a laser at the height of the layer itself, the error is the whole phase of the layer, and the integral gives \(1.032\,(D/r_0)^{5/3}\) with piston removed and \(0.133\,(D/r_0)^{5/3}\) with tilt removed too: Noll's 1.0299 and 0.134. For \(\alpha = 0.7\) and 0.3, random phase screens (the same as the page's seeing laboratories) give the same variance to within their scatter of a few per cent.</p>
<h3>Why sodium, and why several lasers</h3>
<p>The higher the laser, the closer \(\alpha\) is to 1: the mesospheric sodium layer at about 90 km is the highest place a laser can make a bright spot, by exciting the sodium atoms at 589 nm (Foy and Labeyrie 1985 proposed laser guide stars for astronomy). Lasers scattered back from air molecules (Rayleigh lasers) are cheaper but range-gated at 10–20 km, where the cone effect is much worse. Because \(\sigma^2 \propto D^{5/3}\), the same laser serves an 8 m telescope well and a 40 m one poorly: extremely large telescopes use several lasers and reconstruct the turbulence layer by layer.</p>
<h3>Approximations</h3>
<p>Kolmogorov turbulence (infinite outer scale) in two thin layers; a point-like laser spot; perfect correction otherwise (no fitting, servo-lag or noise errors); Strehl ratio from \(e^{-\sigma^2}\).</p>
</div></div>`));
  root.append(references([
    'R. Foy &amp; A. Labeyrie, <em>Astronomy &amp; Astrophysics</em> 152, L29–L31 (1985): the laser guide star proposed for astronomy.',
    'J. W. Hardy, <em>Adaptive Optics for Astronomical Telescopes</em>, Oxford University Press (1998).',
    'F. Roddier (ed.), <em>Adaptive Optics in Astronomy</em>, Cambridge University Press (1999).',
    'R. J. Noll, “Zernike polynomials and atmospheric turbulence”, <em>J. Opt. Soc. Am.</em> 66, 207 (1976).',
  ]));

  return () => { clearTimeout(timer); [geo, maps, ch, chD].forEach((x) => x.destroy()); };
}
