// Gravitational microlensing: a star with a planet drifts in front of a star in the Galactic bulge. The
// caustic map of the source plane, the images a perfect telescope would see, the light curve with a
// season of Roman-like photometry, and the planet's signal with its detection Δχ².
import { h, controls, stage, readouts, fmt, texNum, debounce, setControl, reducedMotion } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, paintMap, encode } from '../lib/pixels.js';
import { lut } from '../lib/color.js';
import { parallel, poolSize } from '../lib/compute.js';
import { plan, einstein, lenses, images, path, merge, refine, survey, interp, topology, pacz, M_EARTH, DCHI2, SEASON, CADENCE, KAPPA } from '../lib/microlensing.js';
import { t, N_ } from '../lib/i18n.js';

const RAD = Math.PI / 180, DS = 8, MAP = lut('magma');
const MAPN = 200, ZOOMN = 170;

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>When a star passes almost exactly in front of a more distant star, its gravity bends the distant star's light towards us like a lens. The distant star brightens for a few weeks and fades again in a smooth, symmetric curve; the stars are far too close together to be seen apart, so we only see the brightening.</p>
<p>If the lensing star has a planet, the planet's own small lens adds a short blip: a few hours for an Earth, a day or two for a Jupiter. Roman, NASA's next survey telescope, will watch millions of stars every 15 minutes to catch these blips, even from planets far from their star.</p>`, [
    'Play the event, then lower the <strong>Planet mass</strong> to one Earth: does the blip get weaker, shorter, or both?',
    'Move the <strong>Planet distance</strong> until the planet\'s caustic leaves the source\'s path: what remains of the signal?',
    'Make the <strong>Source star</strong> a giant of 10 solar radii: predict what happens to an Earth-mass planet\'s blip.',
  ]));

  const ctl = controls({
    h1: { type: 'heading', label: 'The lens: a star and its planet' },
    M: { type: 'range', label: 'Lens star mass', min: 0.08, max: 1.2, step: 0.01, value: 0.3, unit: 'M☉' },
    mp: { type: 'range', label: 'Planet mass', min: 0.1, max: 3000, log: true, value: 10, unit: 'M⊕' },
    a: { type: 'range', label: 'Planet distance from its star (projected)', min: 0.3, max: 15, log: true, value: 2.5, unit: 'AU' },
    DL: { type: 'range', label: 'Lens distance', min: 1, max: 7.5, step: 0.05, value: 6, unit: 'kpc' },
    h2: { type: 'heading', label: 'The source and its path' },
    rstar: { type: 'range', label: 'Source star radius', min: 0.3, max: 30, log: true, value: 1, unit: 'R☉' },
    ld: { type: 'range', label: 'Limb darkening (linear coefficient)', min: 0, max: 1, step: 0.05, value: 0.4 },
    mu: { type: 'range', label: 'Relative proper motion', min: 1, max: 15, step: 0.1, value: 6, unit: 'mas/yr' },
    u0: { type: 'range', label: 'Closest approach to the lens', min: 0, max: 1, step: 0.002, value: 0.2, unit: 'θ_E' },
    alpha: { type: 'range', label: 'Direction of motion', min: 0, max: 360, step: 0.1, value: 201.5, unit: '°' },
    h3: { type: 'heading', label: 'The survey' },
    sigma: { type: 'range', label: 'Photometric error at baseline', min: 0.1, max: 5, log: true, value: 1, unit: '%' },
    t: { type: 'range', label: 'Time from closest approach', min: -36, max: 36, step: 0.01, value: -9.9, unit: 'd' },
    play: { type: 'toggle', label: 'Play the event (slow motion through the planet\'s signal)', value: false },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const sky = stage({ aspect: 2.05, label: 'Source plane: caustics and the source\'s path, with a zoom', draw: drawSky, minH: 260 });
  const img = stage({ aspect: 1.05, label: 'What a perfect telescope sees', draw: drawImages, minH: 260 });
  const lc = stage({ aspect: 1.05, label: '', name: N_('Light curve'), draw: drawCurve, cls: 'plain', minH: 260 });
  const an = stage({ aspect: 2.7, label: '', name: N_('The planet\'s signal'), draw: drawAnomaly, cls: 'plain', minH: 210 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([sky.el, h('div.grid-2', {}, img.el, card(lc)), card(an)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ── parameters ──
  const par = () => {
    const s = ctl.state, E = einstein({ M: s.M, DL: s.DL, DS, mu: s.mu, Rstar: s.rstar });
    const q = (s.mp * M_EARTH) / s.M, W = Math.min(SEASON / 2, 3 * E.tE);
    return { E, W, p: { s: s.a / E.rE, q, u0: s.u0, alpha: s.alpha * RAD, rho: E.rho, ld: s.ld, T: W / E.tE } };
  };
  const keyOf = (p) => JSON.stringify(p);

  // ── computation: plan, a quick hexadecapole pass, then the full curve with refinement, on the pool ──
  let gen = 0, CUR = null, MAPS = null;
  const chunks = (taus) => { const n = Math.max(1, poolSize()), out = Array.from({ length: n }, () => []); taus.forEach((x, i) => out[i % n].push(x)); return out.filter((c) => c.length); };
  const evalAll = async (p, taus) => {
    const cs = chunks(taus), rs = await parallel('mlEval', cs.map((c) => ({ p, taus: c })));
    let cur = { tau: [], A: [], point: [], single: [] };
    cs.forEach((c, i) => { cur = merge(cur, c, rs[i]); });
    return cur;
  };
  async function compute() {
    const my = ++gen, { E, W, p } = par(), key = keyOf(p);
    // the plan (caustics and sampling times) takes milliseconds, so it runs here
    const P0 = plan(p), pl = { tau: P0.tau, fine: P0.fine, caus: P0.caustics.caus, crit: P0.caustics.crit, curves: P0.caustics.curves };
    // first a quick curve, then the maps, then the exact curve: the pool works through them in order
    let curve = await evalAll({ ...p, quick: true }, pl.tau);
    if (my !== gen) return;
    publish(curve, pl, key, E, W, false);
    await maps(p, pl, key);
    if (my !== gen) return;
    curve = await evalAll(p, pl.tau);
    for (let pass = 0; pass < 5; pass++) {
      if (my !== gen) return;
      const extra = refine(curve.tau, curve.A, pl.fine);
      if (!extra.length) break;
      const e = await evalAll(p, extra);
      curve = merge(curve, e.tau, e);
    }
    if (my !== gen) return;
    publish(curve, pl, key, E, W, true);
  }
  function publish(curve, pl, key, E, W, final) {
    const data = survey(curve, E.tE, W, ctl.state.sigma / 100, 7);
    // where the planet shows: the largest deviation from the star alone, and the span where it exceeds 5 % of that
    let dmax = 0, imax = 0;
    for (let i = 0; i < curve.tau.length; i++) { const d = Math.abs(curve.A[i] / curve.single[i] - 1); if (d > dmax) { dmax = d; imax = i; } }
    let i0 = imax, i1 = imax;
    const thr = Math.max(0.05 * dmax, 1e-3);
    for (let i = 0; i < curve.tau.length; i++) if (Math.abs(curve.A[i] / curve.single[i] - 1) > thr) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); }
    CUR = { key, curve, pl, data, E, W, final, dmax, tmax: curve.tau[imax] * E.tE, span: [curve.tau[i0] * E.tE, curve.tau[i1] * E.tE], sigmaKey: ctl.state.sigma };
    words(); lc.redraw(); an.redraw(); sky.redraw(); img.redraw();
  }
  // the caustic maps (point-source magnification) for the whole view and the zoom
  let mapGen = 0;
  async function maps(p, pl, key) {
    const my = ++mapGen, win = windows(p, pl), bands = (ny) => { const n = Math.max(1, poolSize()); return Array.from({ length: n }, (_, i) => [Math.round((i * ny) / n), Math.round(((i + 1) * ny) / n)]); };
    const one = async (w, n) => {
      const rs = await parallel('mlMap', bands(n).map(([j0, j1]) => ({ s: p.s, q: p.q, win: w, nx: n, ny: n, j0, j1 })));
      // rows come bottom first (y up); the picture wants the top row first
      const a = new Float32Array(n * n);
      let j = 0;
      for (const r of rs) for (let k = 0; k < r.length / n; k++, j++) a.set(r.subarray(k * n, (k + 1) * n), (n - 1 - j) * n);
      // log magnification, shown from the window's faintest value to its 99.5th percentile
      for (let i = 0; i < a.length; i++) a[i] = Math.log10(Math.max(1, a[i]));
      const sorted = Float32Array.from(a).sort();
      return { a, lo: sorted[0], hi: Math.max(sorted[0] + 0.05, sorted[Math.floor(0.995 * (sorted.length - 1))]) };
    };
    const [big, zoom] = await Promise.all([one(win.big, MAPN), one(win.zoom, ZOOMN)]);
    if (my !== mapGen) return;
    MAPS = { key, win, big, zoom };
    sky.redraw();
  }
  // the whole view: the lenses, the Einstein ring and every caustic; the zoom: the caustic the path
  // passes closest to (or the closest approach to the star when there is none nearby)
  function windows(p, pl) {
    const L = lenses(p.s, p.q);
    let x0 = Math.min(-1.4, L.x1 - 1.2), x1 = Math.max(1.4, L.x2 + 0.3), y0 = -1.4, y1 = 1.4;
    for (const tr of pl.caus) for (const [x, y] of tr) { x0 = Math.min(x0, x - 0.2); x1 = Math.max(x1, x + 0.2); y0 = Math.min(y0, y - 0.2); y1 = Math.max(y1, y + 0.2); }
    const side = Math.max(x1 - x0, y1 - y0), big = { x0: (x0 + x1) / 2 - side / 2, y0: (y0 + y1) / 2 - side / 2, w: side, h: side };
    const ca = Math.cos(p.alpha), sa = Math.sin(p.alpha);
    let best = null, bd = Infinity;
    for (const tr of pl.caus) for (const [x, y] of tr) {
      const tau = x * ca + y * sa, d = Math.abs(-x * sa + y * ca - p.u0);
      if (Math.abs(tau) < p.T && d < bd) { bd = d; best = [x, y]; }
    }
    let half = Math.max(12 * p.rho, (2.5 * Math.sqrt(p.q)) / Math.max(1, p.s), 0.004);
    if (!best || bd > 4 * half) { best = path(0, p.u0, p.alpha); half = Math.max(half, 0.05); }
    // centre on the path near that point, so the source crosses the middle of the zoom
    const tau = best[0] * ca + best[1] * sa, on = path(tau, p.u0, p.alpha), c = [(best[0] + on[0]) / 2, (best[1] + on[1]) / 2];
    half = Math.max(half, 1.3 * Math.hypot(best[0] - on[0], best[1] - on[1]));
    return { big, zoom: { x0: c[0] - half, y0: c[1] - half, w: 2 * half, h: 2 * half } };
  }

  const request = debounce(() => compute().catch(console.error), 120);
  let lastKey = null;
  function update() {
    const k = keyOf(par().p);
    if (k !== lastKey) { lastKey = k; request(); }
    else if (CUR && CUR.sigmaKey !== ctl.state.sigma) publish(CUR.curve, CUR.pl, CUR.key, CUR.E, CUR.W, CUR.final);
    words(); sky.redraw(); img.redraw(); lc.redraw(); an.redraw();
    if (ctl.state.play && !raf) raf = requestAnimationFrame(loop);
  }

  // ── playing the event: a season in about 25 s, ten times slower through the planet's signal ──
  let raf = 0, lastT = 0;
  function loop(now) {
    raf = 0;
    if (!ctl.state.play || !root.isConnected) return;
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    const W = par().W, inSig = CUR && CUR.dmax > 0.01 && ctl.state.t > CUR.span[0] - 0.3 && ctl.state.t < CUR.span[1] + 0.3;
    let v = ctl.state.t + ((2 * W) / 25) * dt * (inSig ? 0.06 : 1);
    if (v > W) v = -W;
    setControl('t', +v.toFixed(3));
    raf = requestAnimationFrame(loop);
  }

  // ── words and the live calculation ──
  function words() {
    const s = ctl.state, { E, p, W } = par(), topo = topology(p.q), L = lenses(p.s, p.q), tau = s.t / E.tE, [zx, zy] = path(tau, p.u0, p.alpha);
    const im = images(L, zx, zy), u = Math.hypot(zx - L.x1, zy);
    const kind = p.s < topo.close ? t('close: two small caustics off the axis, on the far side of the star') : p.s > topo.wide ? t('wide: one planetary caustic beyond the star, towards the planet') : t('resonant: one large caustic around the star');
    const At = CUR ? interp(CUR.curve.tau, CUR.curve.A, tau) : NaN, A1 = CUR ? interp(CUR.curve.tau, CUR.curve.single, tau) : NaN;
    const det = CUR && CUR.data.dchi2 > DCHI2;
    ro.replaceChildren(readouts([
      ['Einstein radius θ_E', `${fmt(E.thetaE, 3)} mas = ${fmt(E.rE, 3)} AU at the lens`],
      ['Einstein time t_E', `${fmt(E.tE, 3)} d`],
      ['Source size ρ = θ*/θ_E', `${fmt(E.rho, 3)} (θ* = ${fmt(E.thetaS * 1000, 3)} µas)`],
      ['Mass ratio q, separation s', `${fmt(p.q, 3)}, ${fmt(p.s, 3)} θ_E`],
      ['Caustic topology', kind],
      ['Images now, magnification', `${im.n}, ${Number.isFinite(At) ? fmt(At, 4) : '…'} (star alone ${Number.isFinite(A1) ? fmt(A1, 4) : '…'})`],
      ['Largest deviation from the star alone', CUR ? `${fmt(CUR.dmax * 100, 3)} % at ${fmt(CUR.tmax, 3)} d` : '…'],
      ['Duration of the planet\'s signal', CUR && CUR.dmax > 1e-3 ? `${fmt((CUR.span[1] - CUR.span[0]) * 24, 3)} h` : '—'],
      ['Δχ² against the star alone', CUR ? `${fmt(CUR.data.dchi2, 3)} (${det ? t('detected') : t('not detected')}, threshold ${DCHI2})` : '…'],
      ['Photometry', t('{n} points, one every {c} min over {w} d', { n: CUR ? CUR.data.t.length : '…', c: Math.round(CADENCE * 1440), w: fmt(2 * W, 3) })],
    ]));
    calc.say(t('The lens star\'s Einstein ring has a radius of <strong>{th} mas</strong> ({re} AU at the lens), and the source crosses it in t_E = <strong>{te} days</strong>. The planet, {q} times the star\'s mass at s = {s} Einstein radii, puts its caustic {pc} Einstein radii from the star. Against the star alone, the Roman-like photometry gives Δχ² = <strong>{chi}</strong>: {det}.', {
      th: fmt(E.thetaE, 3), re: fmt(E.rE, 3), te: fmt(E.tE, 3), q: fmt(p.q, 2), s: fmt(p.s, 3), pc: fmt(Math.abs(p.s - 1 / p.s), 3), chi: CUR ? fmt(CUR.data.dchi2, 3) : '…',
      det: CUR ? (det ? t('the planet would be detected') : t('the planet would be missed')) : '…',
    }));
    calc.set(String.raw`\begin{aligned}
    \theta_E &= \sqrt{\kappa M\Big(\frac{1}{D_L}-\frac{1}{D_S}\Big)} = \sqrt{${texNum(KAPPA, 4)}\times ${texNum(s.M, 3)}\times\Big(\frac{1}{${texNum(s.DL, 3)}}-\frac{1}{${DS}}\Big)} = ${texNum(E.thetaE, 3)}\ \text{mas},\qquad t_E = \frac{\theta_E}{\mu_\text{rel}} = ${texNum(E.tE, 3)}\ \text{d}\\
    u(t) &= \sqrt{u_0^2+(t/t_E)^2} = ${texNum(u, 3)},\qquad A_\text{star alone} = \frac{u^2+2}{u\sqrt{u^2+4}} = ${texNum(pacz(u), 4)}\ \ (\rho = ${texNum(E.rho, 3)})\\
    q &= \frac{m_p}{M} = ${texNum(p.q, 3)},\quad s = \frac{a_\perp}{\theta_E D_L} = ${texNum(p.s, 3)},\quad \Big|s-\frac1s\Big| = ${texNum(Math.abs(p.s - 1 / p.s), 3)},\qquad \Delta\chi^2 = \sum_i\Big(\frac{A_i-A_{1,i}}{\sigma_i}\Big)^2 = ${CUR ? texNum(CUR.data.dchi2, 3) : '\\ldots'}
    \end{aligned}`);
  }

  // ── drawing ──
  const toPx = (rect, win) => (x, y) => [rect.x + ((x - win.x0) / win.w) * rect.w, rect.y + (1 - (y - win.y0) / win.h) * rect.h];
  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!CUR) return;
    if (!MAPS) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('Computing the caustic map…'), w / 2, hh / 2); return; }
    const { p, E } = par(), top = 40, S = Math.min(w / 2 - 36, hh - top - 30), rects = [{ x: w / 4 - S / 2, y: top, w: S, h: S }, { x: (3 * w) / 4 - S / 2, y: top, w: S, h: S }];
    const wins = [MAPS.win.big, MAPS.win.zoom], arrs = [MAPS.big, MAPS.zoom], ns = [MAPN, ZOOMN], L = lenses(p.s, p.q), tau = ctl.state.t / E.tE, src = path(tau, p.u0, p.alpha);
    rects.forEach((r, k) => {
      const m = arrs[k];
      paintMap(sky, r, { a: m.a, w: ns[k], h: ns[k], lut: MAP, linear: true, value: (v) => 0.03 + (0.94 * (v - m.lo)) / (m.hi - m.lo) }, `${MAPS.key}|${k}`, k);
      const P = toPx(r, wins[k]);
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      // Einstein ring of the whole mass
      if (k === 0) { const [cx, cy] = P(0, 0), [ex] = P(1, 0); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(cx, cy, ex - cx, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      // caustics
      ctx.strokeStyle = 'rgba(255,226,140,0.95)'; ctx.lineWidth = 1.1;
      for (const tr of CUR.pl.caus) {
        ctx.beginPath(); let prev = null;
        for (const [x, y] of tr) { const q = P(x, y); if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < r.w * 0.08) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); prev = q; }
        ctx.stroke();
      }
      // the path, with a tick every hour (in the zoom) and the source at its true size
      const a = P(...path(-p.T, p.u0, p.alpha)), b = P(...path(p.T, p.u0, p.alpha));
      ctx.strokeStyle = 'rgba(106,215,255,0.8)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
      if (k === 1) {
        const hr = 1 / 24 / E.tE, pxPerHr = (hr / wins[1].w) * r.w;
        if (pxPerHr > 5) {
          ctx.fillStyle = 'rgba(106,215,255,0.7)';
          const n = Math.ceil(r.w / pxPerHr) + 2;
          for (let j = -n; j <= n; j++) { const q = P(...path(tau + j * hr, p.u0, p.alpha)); ctx.beginPath(); ctx.arc(q[0], q[1], 1.3, 0, 7); ctx.fill(); }
        }
      }
      const [sx, sy] = P(src[0], src[1]), rp = (p.rho / wins[k].w) * r.w;
      ctx.fillStyle = 'rgba(255,240,215,0.35)'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(rp, 3), 0, 7); if (rp > 3) ctx.fill(); ctx.stroke();
      // the lenses (their positions in the lens plane, shown for reference)
      if (k === 0) {
        const [hx, hy] = P(L.x1, 0), [px, py] = P(L.x2, 0);
        ctx.fillStyle = '#ffb35c'; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#9fe0ff'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill();
        const z = wins[1], [zx0, zy0] = P(z.x0, z.y0 + z.h), [zx1, zy1] = P(z.x0 + z.w, z.y0);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(zx0, zy0, Math.max(4, zx1 - zx0), Math.max(4, zy1 - zy0));
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(k ? t('Zoom: {w} θ_E across ({h} h of motion)', { w: fmt(wins[1].w, 2), h: fmt((wins[1].w * E.tE) * 24, 3) }) : t('Caustics (gold), star (orange), planet (blue), Einstein ring'), r.x + r.w / 2, r.y + r.h + 7);
    });
  }

  function drawImages(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!CUR) return;
    const { p, E } = par(), L = lenses(p.s, p.q), tau = ctl.state.t / E.tE, [zx, zy] = path(tau, p.u0, p.alpha);
    const top = 40, S = Math.min(w - 20, hh - top - 30), r = { x: (w - S) / 2, y: top, w: S, h: S };
    const xa = Math.min(L.x1 - 1.6, L.x2 - 0.4), xb = Math.max(L.x1 + 1.6, L.x2 + 0.4), side = Math.max(3.2, xb - xa), win = { x0: (xa + xb) / 2 - side / 2, y0: -side / 2, w: side, h: side };
    const ps = side / S, Rd = Math.max(p.rho, 2.2 * ps), grow = Rd / p.rho, c = ctl.state.ld;
    // every pixel sent back through the lens equation lands in the source plane: lit if inside the star
    const shade = (wn, R0) => (u, v, o) => {
      const x = wn.x0 + u * wn.w, y = wn.y0 + (1 - v) * wn.h;
      const d1 = (x - L.x1) ** 2 + y * y, d2 = (x - L.x2) ** 2 + y * y;
      const bx = x - (L.m1 * (x - L.x1)) / d1 - (L.m2 * (x - L.x2)) / d2, by = y - (L.m1 * y) / d1 - (L.m2 * y) / d2;
      const d = Math.hypot(bx - zx, by - zy) / R0;
      if (d >= 1) { o[0] = o[1] = o[2] = 0.004; return; }
      const I = 1 - c * (1 - Math.sqrt(1 - d * d));
      o[0] = encode(I); o[1] = encode(0.93 * I); o[2] = encode(0.8 * I);
    };
    const pk = `${keyOf(p)}|${ctl.state.t}|${c}`;
    paint(img, r, shade(win, Rd), pk, 0);
    const P = toPx(r, win);
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const [cx, cy] = P(0, 0), [ex] = P(1, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(cx, cy, ex - cx, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(214,140,255,0.55)'; ctx.lineWidth = 1;
    for (const tr of CUR.pl.crit) { ctx.beginPath(); let prev = null; for (const [x, y] of tr) { const q = P(x, y); if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < r.w * 0.08) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); prev = q; } ctx.stroke(); }
    // where the source really is (unlensed), and the two lenses
    const [ux, uy] = P(zx, zy);
    ctx.strokeStyle = 'rgba(106,215,255,0.8)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(ux, uy, Math.max(4, Rd / ps), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const [hx, hy] = P(L.x1, 0), [px, py] = P(L.x2, 0);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9); g.addColorStop(0, 'rgba(255,190,110,1)'); g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#9fe0ff'; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, 7); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // an inset at true size around the brightest image: its real shape, stretched along the ring
    if (grow > 1.05) {
      const im = images(L, zx, zy).list.sort((a, b) => Math.abs(b.mu) - Math.abs(a.mu))[0], half = p.rho * (0.8 * Math.abs(im.mu) + 3);
      const ri = { x: r.x + r.w - r.w * 0.36 - 6, y: r.y + 6, w: r.w * 0.36, h: r.w * 0.36 }, wi = { x0: im.x - half, y0: im.y - half, w: 2 * half, h: 2 * half };
      paint(img, ri, shade(wi, p.rho), pk + '|inset', 1);
      const [ix, iy] = P(im.x, im.y);
      ctx.strokeStyle = 'rgba(255,214,120,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(ri.x + 0.5, ri.y + 0.5, ri.w - 1, ri.h - 1);
      ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ri.x, ri.y + ri.h); ctx.stroke();
      ctx.fillStyle = 'rgba(255,214,120,0.9)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.textBaseline = 'bottom'; ctx.fillText(t('True size, {m} µas across', { m: fmt(2 * half * E.thetaE * 1000, 2) }), ri.x + 4, ri.y + ri.h - 3);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(grow > 1.05 ? t('{s} θ_E across = {m} mas; source drawn {k}× larger', { s: fmt(side, 2), m: fmt(side * E.thetaE, 3), k: fmt(grow, 2) }) : t('{s} θ_E across = {m} mas', { s: fmt(side, 2), m: fmt(side * E.thetaE, 3) }), w / 2, r.y + r.h + 7);
  }

  function drawCurve(ctx, w, hh) {
    if (!CUR) return;
    const { W, E } = par(), C = CUR.curve, D = CUR.data, model = [], single = [], pts = [];
    for (let i = 0; i < C.tau.length; i++) { const d = C.tau[i] * E.tE; if (Math.abs(d) <= W) { model.push([d, C.A[i]]); single.push([d, C.single[i]]); } }
    for (let i = 0; i < D.t.length; i++) pts.push([D.t[i], D.obs[i]]);
    const ymax = Math.max(...model.map((q) => q[1])) * 1.15, log = ymax > 12;
    plot(ctx, w, hh, {
      title: N_('Light curve: one Roman-like season'), x: { min: -W, max: W, label: N_('time from closest approach (days)') }, y: { min: log ? 0.9 : 0.9, max: ymax, log, label: N_('magnification') },
      series: [{ data: pts, color: 'rgba(106,215,255,0.55)', points: true, r: 1.1, label: N_('photometry (every 15 min)') }, { data: single, color: '#9aa3b2', width: 1.5, dash: [5, 4], label: N_('star alone') }, { data: model, color: '#ffffff', width: 1.8, label: N_('star and planet') }],
      vlines: [{ x: ctl.state.t, label: N_('now'), color: '#ffd27a' }], legend: true,
    });
  }

  function drawAnomaly(ctx, w, hh) {
    if (!CUR) return;
    const { W, E } = par(), C = CUR.curve, D = CUR.data, has = CUR.dmax > 2e-3;
    let a = CUR.span[0], b = CUR.span[1];
    const pad = Math.max(0.15, 0.6 * (b - a));
    a = Math.max(-W, (has ? a : CUR.tmax) - pad); b = Math.min(W, (has ? b : CUR.tmax) + pad);
    const dev = [], devP = [], pts = [];
    for (let i = 0; i < C.tau.length; i++) { const d = C.tau[i] * E.tE; if (d >= a && d <= b) { dev.push([d, 100 * (C.A[i] / C.single[i] - 1)]); devP.push([d, 100 * (C.point[i] / interp(C.tau, C.single, C.tau[i]) - 1)]); } }
    for (let i = 0; i < D.t.length; i++) if (D.t[i] >= a && D.t[i] <= b) pts.push([D.t[i], 100 * (D.obs[i] / interp(C.tau, C.single, D.t[i] / E.tE) - 1)]);
    const vals = dev.map((q) => q[1]), lo = Math.min(-3 * ctl.state.sigma, ...vals), hi = Math.max(3 * ctl.state.sigma, ...vals), m = 0.1 * (hi - lo);
    plot(ctx, w, hh, {
      title: has ? N_('The planet\'s signal: deviation from the star alone') : N_('No planetary signal on this path: deviation from the star alone'),
      x: { min: a, max: b, label: N_('time from closest approach (days)') }, y: { min: lo - m, max: hi + m, label: N_('deviation (%)') },
      series: [{ data: devP, color: '#c18cff', width: 1.2, dash: [4, 3], label: N_('point source') }, { data: dev, color: '#ffffff', width: 1.8, label: N_('finite source') }, { data: pts, color: '#6ad7ff', points: true, r: 2.2, label: N_('photometry') }],
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.3)' }], vlines: ctl.state.t >= a && ctl.state.t <= b ? [{ x: ctl.state.t, label: N_('now'), color: '#ffd27a' }] : [], legend: true,
    });
  }

  if (ctl.state.play && reducedMotion()) setControl('play', false);
  update();

  root.append(rule(String.raw`\[A(u) = \frac{u^2+2}{u\sqrt{u^2+4}}, \qquad \Delta t_\text{planet} \approx t_E\sqrt{q}\]
<p>A source passing \(u = 0.1\) Einstein radii from a single lens star is magnified 10×; at \(u = 1\), 1.34×. A planet of mass ratio \(q\) adds a signal lasting about \(t_E\sqrt q\): for an Earth (\(q = 10^{-5}\)) around a 0.3 M☉ star with \(t_E = 20\) days, about 1.5 hours, which is why the survey must look every 15 minutes.</p>`,
    String.raw`Straight-line motion: no parallax from the Earth's or the telescope's orbit, no orbital motion of the planet, one planet, and no light from other stars blended with the source. The photometry is photon noise scaled from a baseline error, without systematics, and Δχ² compares with the single-lens curve of the same parameters instead of a refitted one, so it overestimates real detections. Finite sources use the hexadecapole approximation away from caustics and contour integration near them, to about 0.2 %.`));
  root.append(theory('Lensing by a star and its planet', String.raw`
<div class="theory-cols"><div>
<h3>The Einstein ring</h3>
<p>A point mass \(M\) deflects light passing at impact parameter \(b\) by \(4GM/(c^2b)\). For a lens at \(D_L\) in front of a source at \(D_S\), the images of a source exactly behind it form a ring of angular radius \(\theta_E=\sqrt{\kappa M\pi_\text{rel}}\), \(\kappa = 4G/(c^2\,\text{AU}) = 8.144\) mas/M☉ and \(\pi_\text{rel} = \text{AU}(1/D_L - 1/D_S)\): about half a milliarcsecond for a red dwarf halfway to the Galactic bulge, far below any telescope's resolution. A source at angular distance \(u\theta_E\) has two images, at \(u_\pm = (u\pm\sqrt{u^2+4})/2\), and their total magnification is Paczyński's \(A(u)\). As the source moves at the relative proper motion \(\mu_\text{rel}\), \(u(t) = \sqrt{u_0^2+((t-t_0)/t_E)^2}\) with \(t_E = \theta_E/\mu_\text{rel}\), typically 20 days.</p>
<h3>Finite sources</h3>
<p>Point-source magnification diverges at \(u = 0\) and on caustics; a real star of angular radius \(\theta_*\) (\(\rho = \theta_*/\theta_E\)) caps it, at \(\sqrt{1+4/\rho^2}\) for a uniform disk centred on a point lens (Witt &amp; Mao 1994). Here the single lens is the exact one-dimensional integral over circles about the lens; for the binary lens, Gould's hexadecapole (13 point magnifications) away from caustics and, near them, the area of the images by Green's theorem along the images of the source's limb (Gould &amp; Gaucherel 1997), with linear limb darkening as a sum of uniform disks.</p>
</div><div>
<h3>Two lenses</h3>
<p>With complex positions, the lens equation is \(\zeta = z - \sum_i m_i/(\bar z - \bar z_i)\). Eliminating \(\bar z\) gives a fifth-degree polynomial (Witt &amp; Mao 1995): a binary lens has three or five images, and five when the source is inside a caustic, where the signed magnifications of the five images add up to exactly one. Here its roots are found by the Aberth–Ehrlich method and polished on the lens equation itself, since the polynomial loses precision for small mass ratios. The magnification diverges on the critical curves, where \(\det J = 1 - |\sum m_i/(\bar z-\bar z_i)^2|^2 = 0\); their images in the source plane are the caustics.</p>
<h3>Planets</h3>
<p>Depending on the separation \(s\), the caustics form three topologies (Erdl &amp; Schneider 1993): close, resonant and wide, with boundaries at \(s = 1/\sqrt2\) and \(s = 2\) for equal masses. For a planet, a small central caustic sits at the star, and a planetary caustic at \(s - 1/s\) from it (Han 2006); a source crossing either shows a signal lasting about \(t_E\sqrt q\) (Gould &amp; Loeb 1992). The first microlensing planet was found in 2003 (Bond et al. 2004). Roman's Galactic Bulge Time Domain Survey will image about 2 square degrees every 15 minutes in its 0.93–2.0 µm W149 filter during six 72-day seasons, and is predicted to find about 1400 bound planets down to a tenth of an Earth mass (Penny et al. 2019).</p>
</div></div>`));
  root.append(references([
    'B. Paczyński, "Gravitational microlensing by the galactic halo", Astrophys. J. 304, 1 (1986).',
    'S. Mao &amp; B. Paczyński, "Gravitational microlensing by double stars and planetary systems", Astrophys. J. 374, L37 (1991).',
    'A. Gould &amp; A. Loeb, "Discovering planetary systems through gravitational microlenses", Astrophys. J. 396, 104 (1992).',
    'H. Erdl &amp; P. Schneider, "Classification of the multiple deflection two point-mass gravitational lens models", Astron. Astrophys. 268, 453 (1993).',
    'H. J. Witt &amp; S. Mao, "Can lensed stars be regarded as pointlike for microlensing by MACHOs?", Astrophys. J. 430, 505 (1994).',
    'H. J. Witt &amp; S. Mao, "On the minimum magnification between caustic crossings for microlensing by binary and multiple stars", Astrophys. J. 447, L105 (1995).',
    'A. Gould &amp; C. Gaucherel, "Stokes\'s theorem applied to microlensing of finite sources", Astrophys. J. 477, 580 (1997).',
    'C. Han, "Properties of planetary caustics in gravitational microlensing", Astrophys. J. 638, 1080 (2006).',
    'A. Gould, "Hexadecapole approximation to planetary and binary microlensing", Astrophys. J. 681, 1593 (2008).',
    'I. A. Bond et al., "OGLE 2003-BLG-235/MOA 2003-BLG-53: a planetary microlensing event", Astrophys. J. 606, L155 (2004).',
    'M. T. Penny et al., "Predictions of the WFIRST microlensing survey. I. Bound planet detection rates", Astrophys. J. Suppl. 241, 3 (2019).',
  ]));
  return () => { cancelAnimationFrame(raf); gen++; mapGen++; [sky, img, lc, an].forEach((s) => s.destroy()); };
}
