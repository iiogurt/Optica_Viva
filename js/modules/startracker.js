// Star trackers: a small camera that tells a spacecraft where it points. Stars in the field, sub-pixel
// centroids of a deliberately defocused spot, and the pointing and roll errors that follow.
import { h, controls, stage, readouts, fmt, texNum, debounce } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { latest } from '../lib/compute.js';
import { makeRng } from '../lib/random.js';
import { LATITUDE, attitudeFrom, attitude, electrons, starField, smear, windowFor, exposure, centroid } from '../lib/startracker.js';
import { t, N_ } from '../lib/i18n.js';

const DARK = 100, WELL = 20000; // dark current (e⁻/s) and full well (e⁻), fixed

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>A spacecraft has to know which way it points before it can aim a telescope or an antenna. A star tracker is a small camera that photographs the sky, finds the stars, recognises their pattern (as you recognise a constellation) and works out the direction from them.</p>
<p>Stars are so far away that a sharp lens would put each on a single pixel. So the camera blurs them a little on purpose, over a few pixels: from how the light is shared between them, the centre can be found to a tenth of a pixel or better. Many stars together fix the pointing to about an arcsecond, the width of a coin seen from 4 kilometres.</p>`, [
    'Make the spot <strong>sharper</strong> (σ = 0.3 pixels): is a sharper star located better? Look at the S-curve.',
    'Turn the spacecraft at <strong>1° per second</strong>: what happens to the faint stars, and to the pointing error?',
    'Narrow the <strong>field of view</strong> to 5°: the pixels see finer angles, but how many stars are left?',
  ]));

  const ctl = controls({
    fov: { type: 'range', label: 'Field of view (square)', min: 5, max: 40, step: 0.5, value: 15, unit: '°' },
    n: { type: 'seg', label: 'Pixels across', value: '1024', options: [['512', '512'], ['1024', '1024'], ['2048', '2048']] },
    D: { type: 'range', label: 'Lens aperture', min: 0.5, max: 5, log: true, value: 1.6, unit: 'cm' },
    t: { type: 'range', label: 'Exposure time', min: 5, max: 500, log: true, value: 50, unit: 'ms' },
    sigma: { type: 'range', label: 'Spot size (deliberate defocus), σ', min: 0.3, max: 3, step: 0.05, value: 1, unit: 'px' },
    read: { type: 'range', label: 'Read noise', min: 1, max: 50, log: true, value: 20, unit: 'e⁻' },
    rate: { type: 'range', label: 'Spacecraft turning rate', min: 0, max: 3, step: 0.05, value: 0, unit: '°/s' },
    lat: { type: 'seg', label: 'Where it looks', value: 'mean', options: [['pole', 'Galactic pole'], ['mean', 'Average sky'], ['plane', 'Milky Way']] },
    mz: { type: 'range', label: 'Star in the close-up: magnitude', min: 0, max: 9, step: 0.1, value: 5 },
  }, () => update());
  let seed = 4;
  const again = h('button.tag', { type: 'button', onClick: () => { seed++; sky.redraw(); } }, t('Point elsewhere'));
  const ro = h('div'), calc = liveCalc();
  const sky = stage({ aspect: 1.75, label: 'The star tracker\'s picture, and one star up close in its pixels', draw: drawSky, minH: 280 });
  const err = stage({ aspect: 1.4, label: '', draw: drawErr, cls: 'plain', minH: 230 });
  const sc = stage({ aspect: 1.4, label: '', draw: drawS, cls: 'plain', minH: 230 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([sky.el, h('div.grid-2', {}, card(err), card(sc))], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, again)), h('div.card', {}, ro), calc.el]));

  const job = latest('startracker');
  let R = null, A = null;
  const params = () => {
    const s = ctl.state;
    return { fov: s.fov, n: +s.n, D: s.D / 100, t: s.t / 1000, sigma: s.sigma, read: s.read, dark: DARK, well: WELL, rate: s.rate, lat: LATITUDE[s.lat] };
  };
  const request = debounce(() => job('startracker', params()).then((r) => { R = r; A = attitudeFrom(r.curve, params()); words(); err.redraw(); sc.redraw(); }, () => {}), 60);
  function update() { const p = params(); if (!R) A = attitude(p, 0.1); sky.redraw(); words(); request(); }

  // the close-up star's centroid error, interpolated from the Monte-Carlo curve
  const errAt = (m) => {
    if (!R) return NaN;
    const c = R.curve, k = Math.min(c.length - 2, Math.max(0, Math.floor((m - c[0][0]) / (c[1][0] - c[0][0])))), f = (m - c[k][0]) / (c[k + 1][0] - c[k][0]);
    return Math.exp(Math.log(c[k][1]) * (1 - f) + Math.log(c[k + 1][1]) * f);
  };

  function words() {
    const s = ctl.state, p = params(), a = A || attitude(p, 0.1), S = electrons(s.mz, p.D, p.t), e = errAt(s.mz);
    ro.replaceChildren(readouts([
      ['Angle seen by one pixel', `${fmt(a.ifov, 3)}″`],
      ['Faintest star detected (5σ)', fmt(a.mlim, 3)],
      ['Stars in the field, on average', fmt(a.N, 3)],
      ['Chance of at least 3 stars (needed to identify)', `${fmt(100 * a.pAtLeast3, 3)} %`],
      ['Electrons from the close-up star', fmt(S, 3)],
      ['Its centroid error', R ? `${fmt(e, 2)} px = ${fmt(e * a.ifov, 2)}″` : '…'],
      ['Trail length while turning', `${fmt(smear(p), 2)} px`],
      ['Pointing error across the line of sight', R ? `${fmt(a.cross, 2)}″` : '…'],
      ['Roll error about it', R ? `${fmt(a.roll, 2)}″` : '…'],
    ]));
    if (!R) return;
    calc.say(t('About {N} stars brighter than magnitude {m} fall in the {fov}° field. A star of magnitude {mz} gives {S} electrons, and its centre is found to {e} pixels ({as}″). Together the stars fix the pointing to <strong>{cross}″</strong> across the line of sight and <strong>{roll}″</strong> in roll, which is weaker because a turn about the centre moves the stars only by their distance from it.', {
      N: fmt(a.N, 3), m: fmt(a.mlim, 3), fov: fmt(s.fov, 3), mz: fmt(s.mz, 2), S: fmt(S, 3), e: fmt(e, 2), as: fmt(e * a.ifov, 2), cross: fmt(a.cross, 2), roll: fmt(a.roll, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    S &= \Phi_0\,10^{-0.4m}\,\tfrac{\pi D^2}{4}\,t = ${texNum(S, 3)}\ e^-, \qquad \sigma_c \ge \frac{\sigma}{\sqrt S} = ${texNum(p.sigma / Math.sqrt(S), 2)}\ \text{px}\\
    \bar N &= N({<}\,m_\text{lim})\,\frac{\text{FOV}^2}{41\,253\ \text{deg}^2} = ${texNum(a.N, 3)}, \qquad I = \int \frac{dN/dm}{\sigma_c(m)^2}\,dm = ${texNum(a.I, 3)}\ \text{px}^{-2}\\
    \sigma_\perp &= \frac{\text{IFOV}}{\sqrt I} = ${texNum(a.cross, 2)}'', \qquad \sigma_\text{roll} = \arctan\frac{1}{0.3825\,n\sqrt I} = ${texNum(a.roll, 2)}''
    \end{aligned}`);
  }

  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#020309'; ctx.fillRect(0, 0, w, hh);
    const s = ctl.state, p = params(), a = A || attitude(p, 0.1), top = 50, side = Math.min(hh - top - 10, w * 0.6), x0 = 12, y0 = top;
    const stars = starField(p, seed, Math.min(a.mlim + 1.5, 10)), sc0 = side / p.n, L = smear(p) * sc0;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, side, side); ctx.clip();
    ctx.fillStyle = '#05070f'; ctx.fillRect(x0, y0, side, side);
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    const lim = electrons(a.mlim, p.D, p.t);
    for (const st of stars) {
      const S = electrons(st.m, p.D, p.t), b = Math.max(0, Math.min(1, Math.log10(S / lim) / 3 + 0.25)), r = 0.8 + 2.6 * b, X = x0 + st.x * side, Y = y0 + st.y * side;
      if (b <= 0.02) continue;
      ctx.strokeStyle = ctx.fillStyle = `rgba(225,232,255,${0.25 + 0.75 * b})`;
      if (L > 0.5) { ctx.lineWidth = 2 * r; ctx.beginPath(); ctx.moveTo(X - L / 2, Y); ctx.lineTo(X + L / 2, Y); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'source-over';
    // detected stars ringed; the brightest four joined, the pattern matched against the catalogue
    const det = stars.filter((q) => q.m < a.mlim);
    ctx.strokeStyle = 'rgba(107,227,164,0.55)'; ctx.lineWidth = 1;
    for (const q of det.slice(0, 120)) { ctx.beginPath(); ctx.arc(x0 + q.x * side, y0 + q.y * side, 6, 0, 7); ctx.stroke(); }
    const four = det.slice(0, 4);
    ctx.strokeStyle = 'rgba(255,181,71,0.7)'; ctx.setLineDash([4, 3]);
    for (let i = 0; i < four.length; i++) for (let j = i + 1; j < four.length; j++) { ctx.beginPath(); ctx.moveTo(x0 + four[i].x * side, y0 + four[i].y * side); ctx.lineTo(x0 + four[j].x * side, y0 + four[j].y * side); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(x0 + 0.5, y0 + 0.5, side, side);
    ctx.font = '11.5px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    ctx.fillText(t('{fov}° field · {n} stars detected · the brightest four form the pattern', { fov: fmt(s.fov, 3), n: det.length }), x0, y0 - 6);

    // the close-up: one star of the chosen magnitude in its pixels, with its true centre and centroid
    const [wy, wx] = windowFor(p.sigma, smear(p)), rng = makeRng(seed * 31 + 7), cx = Math.floor(wx / 2) + 0.2 + 0.6 * rng.u(), cy = Math.floor(wy / 2) + 0.2 + 0.6 * rng.u();
    const img = exposure(rng, cx, cy, p.sigma, wy, electrons(s.mz, p.D, p.t), Math.hypot(p.read, Math.sqrt(DARK * p.t)), WELL, smear(p), wx), [ex, ey] = centroid(img, wy, wx);
    const zx = x0 + side + 28, zw = w - zx - 14, cell = Math.min(zw / wx, (hh - top - 60) / wy), zy = top + 10;
    let mx = 1; for (const v of img) mx = Math.max(mx, v);
    for (let j = 0; j < wy; j++) for (let i = 0; i < wx; i++) {
      const v = Math.max(0, img[j * wx + i] / mx) ** 0.5, g = Math.round(255 * v);
      ctx.fillStyle = img[j * wx + i] >= WELL - 1 ? '#ff6b6b' : `rgb(${g},${g},${Math.min(255, g + 20)})`; ctx.fillRect(zx + i * cell, zy + j * cell, cell - 1, cell - 1);
    }
    const P = (x, y) => [zx + x * cell, zy + y * cell];
    ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 1.5; const [tx, ty] = P(cx, cy);
    ctx.beginPath(); ctx.moveTo(tx - 9, ty); ctx.lineTo(tx + 9, ty); ctx.moveTo(tx, ty - 9); ctx.lineTo(tx, ty + 9); ctx.stroke();
    const [qx, qy] = P(ex, ey); ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(qx, qy, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('Magnitude {m} star up close ({w} × {h} pixels)', { m: fmt(s.mz, 2), w: wx, h: wy }), zx, zy - 2);
    ctx.textBaseline = 'top'; ctx.font = '11px Inter, sans-serif';
    const dy = zy + wy * cell + 8;
    ctx.fillStyle = '#6ad7ff'; ctx.fillText(t('+ true centre'), zx, dy);
    ctx.fillStyle = '#ffb547'; ctx.fillText(t('● centroid: off by {e} px', { e: fmt(Math.hypot(ex - cx, ey - cy), 2) }), zx, dy + 16);
    if (img.some((v) => v >= WELL - 1)) { ctx.fillStyle = '#ff6b6b'; ctx.fillText(t('red: pixel full (saturated)'), zx, dy + 32); }
  }

  function drawErr(ctx, w, hh) {
    if (!R) return;
    const a = A, mc = R.curve.filter((q) => q[0] <= a.mlim + 0.6).map(([m, e]) => [m, Math.min(e, 3)]), floor = R.curve.map(([m, , f]) => [m, f]);
    plot(ctx, w, hh, {
      title: N_('How well a star\'s centre is found'), x: { min: 0, max: 9, label: N_('star magnitude') }, y: { min: 1e-3, max: 3, log: true, label: N_('centroid error (pixels)') },
      series: [{ data: floor, color: '#ffb547', width: 1.8, dash: [5, 4], label: N_('photon-noise floor σ/√S') }, { data: mc, color: '#6ad7ff', width: 2, label: N_('simulated exposures (centre of mass)') }],
      vlines: [{ x: a.mlim, label: N_('limit'), color: 'rgba(107,227,164,0.8)' }, { x: ctl.state.mz, label: N_('close-up'), color: 'rgba(255,255,255,0.4)', dy: 14 }],
      legend: true,
    });
  }

  function drawS(ctx, w, hh) {
    if (!R) return;
    const lim = Math.max(0.01, ...R.s3.map((q) => Math.abs(q[1]))) * 1.2;
    plot(ctx, w, hh, {
      title: N_('The S-curve: error against sub-pixel position'), x: { min: -0.5, max: 0.5, label: N_('position of the star within the pixel (px)') }, y: { min: -lim, max: lim, label: N_('centroid error, no noise (px)') },
      series: [{ data: R.s3, color: '#ff6b6b', width: 2, label: N_('a sharp spot, σ = 0.3 px') }, { data: R.s, color: '#6be3a4', width: 2, label: N_('this spot') }],
      legend: true,
    });
  }
  update();

  root.append(rule(String.raw`\[\sigma_\perp \approx \frac{\sigma_c\,\text{IFOV}}{\sqrt N}, \qquad \sigma_\text{roll} \approx \frac{1}{\sqrt N}\arctan\frac{\sigma_c}{0.3825\,n}\]
<p>A 15° field on 1024 pixels gives each pixel 52.7″. With centroids good to 0.1 pixel and 25 stars, the pointing is known to \(52.7 \times 0.1/5 = 1.05''\) across the line of sight, and the roll to about 10.5″, ten times worse: turning about the centre moves stars only by their distance from it, on average 0.38 of the field's width.</p>`,
    String.raw`Star counts are a fit to the mean over the sky (within a factor of two), and the latitude factors are rough. The signal assumes a Sun-like colour, a fixed dark current (100 e⁻/s) and full well (20 000 e⁻), no stray light from the Sun, Earth or Moon, no lens distortion and no radiation hits. Centroids use the plain centre of mass; real trackers subtract a threshold and correct the S-curve by calibration. Liebe's mean-distance formula is a simple estimate; a least-squares fit uses the actual star positions.`));
  root.append(theory('From stars to attitude', String.raw`
<div class="theory-cols"><div>
<h3>Centroids</h3>
<p>The centre of mass of a spot of width \(\sigma\) made of \(S\) photo-electrons scatters by \(\sigma/\sqrt S\) from photon noise alone; read noise in every pixel of the window adds to it, which is why faint stars and large windows do badly. A spot sharper than about half a pixel puts nearly all its light in one pixel, and the centre of mass is pulled towards the pixel's centre: the S-shaped error against the sub-pixel position. Defocusing to \(\sigma \approx 0.5\)–1 pixel removes most of it; a larger spot spreads the light over more noisy pixels. A turning spacecraft smears stars into trails, which spread the light further.</p>
<h3>How many stars</h3>
<p>The number of stars brighter than magnitude \(m\) grows by a factor of about 2.9 per magnitude (here \(N({<}m) \approx 4800\cdot10^{0.46(m-6)}\) over the whole sky), several times more along the Milky Way than towards the galactic poles. The limiting magnitude follows from the signal needed to stand five standard deviations above the noise of the pixels under the spot.</p>
</div><div>
<h3>Lost in space</h3>
<p>With no idea of its attitude, the tracker identifies stars by their geometry: the angles between three or four bright stars are compared with a catalogue of star pairs (triangle and pyramid algorithms). At least three stars are needed, so the field must be wide or the camera sensitive enough even towards the galactic poles. Once locked, it tracks the known stars from frame to frame.</p>
<h3>Attitude</h3>
<p>The directions of the identified stars in the camera and in the catalogue are fitted by a rotation (Wahba's problem). Errors across the line of sight average down as \(1/\sqrt N\); roll is determined by the stars' displacement around the centre and is several times worse, so spacecraft often carry two trackers at right angles. Good trackers reach about 1″ across and 5–10″ in roll at several updates a second.</p>
</div></div>`));
  root.append(references([
    'C. C. Liebe, "Accuracy performance of star trackers — a tutorial", IEEE Trans. Aerosp. Electron. Syst. 38, 587 (2002).',
    'C. C. Liebe, "Star trackers for attitude determination", IEEE Aerosp. Electron. Syst. Mag. 10 (6), 10 (1995).',
    'D. Mortari, M. A. Samaan, C. Bruccoleri &amp; J. L. Junkins, "The pyramid star identification technique", Navigation 51, 171 (2004).',
    'G. Wahba, "A least squares estimate of satellite attitude", SIAM Review 7, 409 (1965).',
    'ESA, <i>The Hipparcos and Tycho Catalogues</i>, ESA SP-1200 (1997).',
  ]));
  return () => [sky, err, sc].forEach((s) => s.destroy());
}
