// Thermal focus shift and athermalisation: a camera lens in its barrel, or a space telescope on its
// truss, warmed or cooled; the star it then images; the athermal glass chart.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paintMap } from '../lib/pixels.js';
import { lut } from '../lib/color.js';
import { psf } from '../lib/pupil.js';
import { abbe } from '../lib/glass.js';
import { THERMO, THERMO_GLASSES, MATERIALS, T0, P0, LAMBDA, nRel, gamma, lensDesign, lensFocus, lensDefocus, intercept, cassegrain, cassDefocus, depthOfFocus, blur } from '../lib/thermal.js';
import { t, N_, localNum } from '../lib/i18n.js';

const TMIN = -40, TMAX = 60, LUT = lut('magma'), NPSF = 128;
const HUBBLE = { D: 2.4, F1: 2.3, b: 1.5 }; // a Hubble-like Ritchey–Chrétien, approximately

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>Warm a lens and two things happen: the glass expands, and light travels through it at a slightly different speed, so the lens bends light a little differently and its focus moves. The metal tube that holds the sensor behind the lens expands too. If the two changes do not match, a lens that was sharp at room temperature is blurred on a hot day or in the cold of space.</p>
<p>Designers fight this by pairing glasses whose changes cancel, and by choosing tube materials that grow just as much as the focus moves. Telescopes in space use structures that hardly expand at all.</p>`, [
    'Heat the <strong>aluminium</strong> barrel to 60 °C: which moves more, the lens\'s focus or the sensor? Now try <strong>Invar</strong>.',
    'Take the lens from <strong>air into vacuum</strong> without changing the temperature: predict whether the focus moves.',
    'Switch to the <strong>space telescope</strong> with an aluminium truss: how small a temperature change ruins the image?',
  ]));

  const glassOpts = THERMO_GLASSES.map((g) => [g, g]), matOpts = Object.entries(MATERIALS).map(([k, m]) => [k, m.name]);
  const lensMode = (s) => s.mode === 'lens', scopeMode = (s) => s.mode === 'scope';
  const ctl = controls({
    mode: { type: 'seg', label: 'System', value: 'lens', options: [['lens', 'Camera lens'], ['scope', 'Space telescope']] },
    T: { type: 'range', label: 'Temperature', min: TMIN, max: TMAX, step: 0.5, value: 45, unit: '°C' },
    g1: { type: 'select', label: 'First lens glass (positive)', value: 'N-BK7', options: glassOpts, when: lensMode },
    g2: { type: 'select', label: 'Second lens glass (negative)', value: 'F2', options: [['none', 'none (a single lens)'], ...glassOpts], when: lensMode },
    f: { type: 'range', label: 'Focal length', min: 20, max: 600, log: true, value: 200, unit: 'mm', when: lensMode },
    N: { type: 'range', label: 'f-number', min: 1.4, max: 22, log: true, value: 4, when: lensMode },
    housing: { type: 'select', label: 'Lens barrel', value: 'aluminium', options: matOpts, when: lensMode },
    env: { type: 'seg', label: 'Surroundings', value: 'air', options: [['air', 'Air'], ['vacuum', 'Vacuum']], when: lensMode },
    m: { type: 'range', label: 'Secondary-mirror magnification', min: 2, max: 14, step: 0.01, value: 10.43, when: scopeMode },
    truss: { type: 'select', label: 'Truss between the mirrors', value: 'aluminium', options: matOpts, when: scopeMode },
    mirror: { type: 'select', label: 'Mirror material', value: 'ule', options: matOpts, when: scopeMode },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const draw = stage({ aspect: 2.4, label: 'Cross-section, coloured by temperature (shifts exaggerated)', draw: drawSection, minH: 220 });
  const star = stage({ aspect: 1.25, label: 'A star at 20 °C and now', draw: drawStar, minH: 240 });
  const curve = stage({ aspect: 1.25, label: '', name: N_('Focus error against temperature'), draw: drawCurve, cls: 'plain', minH: 240 });
  const chart = stage({ aspect: 2.1, label: '', name: N_('Athermal chart'), draw: drawChart, cls: 'plain', minH: 260 });
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([draw.el, h('div.grid-2', {}, star.el, card(curve)), card(chart)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ── the model at a temperature ──
  function model(T) {
    const s = ctl.state;
    if (s.mode === 'scope') {
      const c = cassegrain({ ...HUBBLE, m: s.m }), aM = MATERIALS[s.mirror].cte, aT = MATERIALS[s.truss].cte, r = cassDefocus(c, aM, aT, T);
      // the telescope is in metres; focus errors here in mm like the lens
      const mOnly = cassDefocus(c, aM, 0, T).defocus;
      return { scope: true, c, N: c.N, defocus: r.defocus * 1000, partA: mOnly * 1000, partB: (r.defocus - mOnly) * 1000, r, aM, aT };
    }
    const g2 = s.g2 === 'none' ? null : s.g2, els = lensDesign(s.g1, g2, s.f), P = s.env === 'vacuum' ? 0 : P0, aH = MATERIALS[s.housing].cte;
    const r = lensDefocus(els, s.f, aH, T, P);
    return { scope: false, els, N: s.N, P, aH, defocus: r.defocus, partA: r.lensPart, partB: -r.housingPart, r };
  }
  const len = (um) => (Math.abs(um) >= 1000 ? `${fmt(um / 1000, 3)} mm` : `${fmt(um, 3)} µm`);
  const slope = () => (model(T0 + 0.5).defocus - model(T0 - 0.5).defocus); // mm per K at 20 °C

  // ── the star image: a defocused Airy pattern (Fourier optics) or, for large defocus, the geometric disk ──
  function starImage(defocusMm, N, fov) {
    const lam = LAMBDA, Dpx = Math.min(64, Math.max(8, fov / (lam * N))), pix = (lam * N * Dpx) / NPSF;
    const W20 = (Math.abs(defocusMm) * 1000) / (8 * N * N); // µm of wavefront at the pupil edge
    if (W20 / lam > 5 || Dpx < fov / (lam * N) - 1e-9) {
      const r = (blur(defocusMm, N) * 1000) / 2, I = new Float32Array(NPSF * NPSF);
      for (let j = 0; j < NPSF; j++) for (let i = 0; i < NPSF; i++) { const d = Math.hypot(i - NPSF / 2 + 0.5, j - NPSF / 2 + 0.5) * (fov / NPSF); I[j * NPSF + i] = Math.max(0, Math.min(1, r - d + 0.5)); }
      return { I, pix: fov / NPSF, peak: 1 };
    }
    const amp = new Float64Array(NPSF * NPSF), W = new Float64Array(NPSF * NPSF);
    for (let j = 0; j < NPSF; j++) for (let i = 0; i < NPSF; i++) {
      const x = (i - NPSF / 2) / (Dpx / 2), y = (j - NPSF / 2) / (Dpx / 2), r2 = x * x + y * y;
      if (r2 <= 1) { amp[j * NPSF + i] = 1; W[j * NPSF + i] = W20 * r2; }
    }
    const p = psf(amp, W, NPSF, lam);
    return { I: Float32Array.from(p.I), pix, peak: p.peak };
  }
  let STARS = null;
  function stars() {
    const M = model(ctl.state.T), N = M.N, fov = Math.max(16 * LAMBDA * N, 1.6 * blur(M.defocus, N) * 1000);
    const k = JSON.stringify([ctl.state, fov]);
    if (STARS && STARS.k === k) return STARS;
    const a = starImage(0, N, Math.min(fov, 64 * LAMBDA * N)), b = starImage(M.defocus, N, fov);
    STARS = { k, a, b, fov, strehl: b.pix === a.pix ? b.peak / a.peak : NaN };
    return STARS;
  }

  function update() { words(); draw.redraw(); star.redraw(); curve.redraw(); chart.redraw(); }

  // ── words and the live calculation ──
  function words() {
    const s = ctl.state, M = model(s.T), dof = depthOfFocus(M.N), sl = slope(), tol = dof / Math.abs(sl), S = stars();
    const strehl = Number.isFinite(S.strehl) ? `${fmt(100 * S.strehl, 3)} %` : t('below 1 %');
    if (M.scope) {
      const c = M.c, amp = c.m * c.m + 1;
      ro.replaceChildren(readouts([
        ['Primary, spacing, secondary', `f₁ = ${fmt(c.f1, 3)} m, d = ${fmt(c.d * 1000, 4)} mm, f₂ = ${fmt(c.f2 * 1000, 4)} mm`],
        ['Final focal ratio', `f/${fmt(c.N, 3)}`],
        ['Focus moves per secondary movement', `m² + 1 = ${fmt(amp, 4)}`],
        ['Mirror spacing change', `${fmt(M.r.dd * 1e6, 3)} µm`],
        ['Focus error at the detector', len(M.defocus * 1000)],
        ['Depth of focus ±2λN²', `±${len(dof * 1000)}`],
        ['Temperature change it tolerates', `±${fmt(tol, 3)} K`],
        ['Star peak against focused (Strehl)', strehl],
      ]));
      calc.say(t('A change of {dT} K stretches the {d} m between the mirrors by <strong>{dd} µm</strong>; the secondary magnifies that {amp} times along the axis, so the focus moves <strong>{df} µm</strong> against a depth of focus of ±{dof} µm. This telescope stays sharp only within <strong>±{tol} K</strong>.', {
        dT: fmt(s.T - T0, 3), d: fmt(c.d, 4), dd: fmt(M.r.dd * 1e6, 3), amp: fmt(amp, 4), df: fmt(M.defocus * 1000, 3), dof: fmt(dof * 1000, 3), tol: fmt(tol, 2),
      }));
      calc.set(String.raw`\begin{aligned}
      \Delta d &= \alpha_\text{truss}\, d\,\Delta T = ${texNum(M.aT * 1e6, 3)}\times10^{-6}\times ${texNum(c.d, 4)}\ \text{m}\times ${texNum(s.T - T0, 3)}\ \text{K} = ${texNum(M.r.dd * 1e6, 3)}\ \mu\text{m}\\
      \Delta z &\approx -(m^2+1)\,\Delta d + \ldots = ${texNum(M.defocus * 1000, 3)}\ \mu\text{m}\quad(\text{exact paraxial, with the mirrors' and the instrument's expansion})\\
      \delta &= \pm 2\lambda N^2 = \pm 2\times ${texNum(LAMBDA, 4)}\ \mu\text{m}\times ${texNum(c.N, 3)}^2 = \pm ${texNum(dof * 1000, 3)}\ \mu\text{m}
      \end{aligned}`);
      return;
    }
    const best = bestPartner(s.g1, M.aH, M.P), g2 = s.g2 === 'none' ? null : s.g2, gs = M.els.map((e) => gamma(e.g, LAMBDA, T0, M.P)), sys = M.els.reduce((a, e, i) => a + e.phi * gs[i], 0) / (1 / s.f);
    const vac = lensDefocus(M.els, s.f, M.aH, T0, 0).defocus;
    ro.replaceChildren(readouts([
      ['Elements', M.els.map((e) => `${e.g}: f = ${fmt(1 / e.phi, 4)} mm`).join(', ')],
      ['Thermal power coefficient γ = (dn/dT)/(n − 1) − α', M.els.map((e, i) => `${e.g} ${fmt(gs[i] * 1e6, 3)}`).join(', ') + ' ppm/K'],
      ['… of the whole lens', `${fmt(sys * 1e6, 3)} ppm/K (athermal barrel: α = ${fmt(-sys * 1e6, 3)} ppm/K)`],
      ['Lens focus moves', `${fmt(M.partA * 1000, 4)} µm`],
      ['Barrel grows', `${fmt(-M.partB * 1000, 4)} µm (${MATERIALS[s.housing].name}, ${fmt(M.aH * 1e6, 3)} ppm/K)`],
      ['Focus error at the sensor', `${fmt(M.defocus * 1000, 4)} µm; blur ${fmt(blur(M.defocus, M.N) * 1000, 3)} µm`],
      ['Depth of focus ±2λN²', `±${fmt(dof * 1000, 3)} µm`],
      ['Temperature change it tolerates', `±${fmt(tol, 3)} K`],
      ['Star peak against focused (Strehl)', strehl],
      ['From air into vacuum at 20 °C', `${fmt(vac * 1000, 4)} µm`],
      ['Best second glass for this barrel', best ? `${best.g} (${fmt(best.slope * 1000, 3)} µm/K)` : '—'],
    ]));
    calc.say(t('At {T} °C the lens\'s focus moves <strong>{lens} µm</strong> while the barrel ({mat}) carries the sensor <strong>{bar} µm</strong>; the difference, <strong>{def} µm</strong>, blurs a star to {blur} µm against a depth of focus of ±{dof} µm. The lens stays sharp within <strong>±{tol} K</strong> of 20 °C.', {
      T: fmt(s.T, 3), lens: fmt(M.partA * 1000, 3), mat: t(MATERIALS[s.housing].name), bar: fmt(-M.partB * 1000, 3), def: fmt(M.defocus * 1000, 3), blur: fmt(blur(M.defocus, M.N) * 1000, 3), dof: fmt(dof * 1000, 3), tol: fmt(tol, 2),
    }));
    const n1 = nRel(s.g1, LAMBDA, T0, M.P);
    calc.set(String.raw`\begin{aligned}
    \gamma &= \frac{1}{\varphi}\frac{d\varphi}{dT} = \frac{dn_\text{rel}/dT}{n-1}-\alpha_g:\quad \gamma_\text{${s.g1}} = \frac{${texNum((gamma(s.g1, LAMBDA, T0, M.P) + THERMO[s.g1].cte) * (n1 - 1) * 1e6, 3)}\times10^{-6}}{${texNum(n1 - 1, 4)}} - ${texNum(THERMO[s.g1].cte * 1e6, 3)}\times10^{-6} = ${texNum(gs[0] * 1e6, 3)}\ \text{ppm/K}\\
    \gamma_\text{lens} &= \sum_i \frac{\varphi_i}{\varphi}\gamma_i = ${texNum(sys * 1e6, 3)}\ \text{ppm/K}${g2 ? '' : '\\ (\\text{one element})'},\qquad \frac{d\Delta}{dT} = -f\,(\gamma_\text{lens}+\alpha_h) = -${texNum(s.f, 4)}\ \text{mm}\times(${texNum(sys * 1e6, 3)} + ${texNum(M.aH * 1e6, 3)})\times10^{-6} = ${texNum(sl * 1000, 3)}\ \mu\text{m/K}\\
    \Delta(T) &= ${texNum(M.defocus * 1000, 4)}\ \mu\text{m}\ \ (\text{exact, at } ${texNum(s.T, 3)}\ ^\circ\text{C}),\qquad \delta = \pm2\lambda N^2 = \pm${texNum(dof * 1000, 3)}\ \mu\text{m}
    \end{aligned}`);
  }
  function bestPartner(g1, aH, P) {
    let best = null;
    for (const g of THERMO_GLASSES) {
      if (g === g1 || abbe(g1) - abbe(g) < 15) continue; // a flint partner: at least 15 Abbe numbers lower
      const sl = ctl.state.f * Math.abs(intercept(g1, g, P) + aH);
      if (!best || sl < best.slope) best = { g, slope: sl };
    }
    return best;
  }

  // ── drawing ──
  const tcol = (T, a = 1) => { const x = (T - TMIN) / (TMAX - TMIN), c = x < 0.6 ? [70 + 185 * (x / 0.6), 140 + 80 * (x / 0.6), 255 - 60 * (x / 0.6)] : [255, 220 - 170 * ((x - 0.6) / 0.4), 195 - 165 * ((x - 0.6) / 0.4)]; return `rgba(${c.map(Math.round).join(',')},${a})`; };
  const nice = (v) => { const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e; };
  function drawSection(ctx, w, hh) {
    const s = ctl.state, M = model(s.T), top = 34, cy = top + (hh - top - 26) / 2, H = Math.min(70, (hh - top - 40) / 2);
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    ctx.font = '11.5px Inter, sans-serif'; ctx.textBaseline = 'middle';
    if (M.scope) {
      const c = M.c, x0 = 0.07 * w, span = c.b + c.d, sc = (0.84 * w) / span, xP = x0 + c.b * sc, shifts = Math.max(Math.abs(M.defocus) / 1000, Math.abs(M.r.dd), 1e-12);
      const K = Math.max(1, nice((0.06 * w) / (sc * shifts)));
      const xS = xP + (c.d + K * M.r.dd) * sc, xF = xP - (M.r.image + (K - 1) * (M.r.image - c.b)) * sc, xD = xP - (c.b + K * (M.r.detector - c.b)) * sc;
      // truss
      ctx.strokeStyle = tcol(s.T); ctx.lineWidth = 3;
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(xP, cy + sg * H); ctx.lineTo(xS, cy + sg * H * 0.35); ctx.stroke(); }
      // rays: parallel light → primary → secondary → focus through the hole
      ctx.strokeStyle = 'rgba(255,236,170,0.55)'; ctx.lineWidth = 1;
      for (const y of [-0.85, -0.55, 0.55, 0.85]) {
        const yP = cy + y * H, yS = cy + y * H * 0.28;
        ctx.beginPath(); ctx.moveTo(w - 6, yP); ctx.lineTo(xP, yP); ctx.lineTo(xS, yS); ctx.lineTo(xF, cy); ctx.lineTo(xF - (xS - xF) * 0.04, cy - (yS - cy) * 0.04); ctx.stroke();
      }
      // mirrors
      ctx.strokeStyle = '#d8e6ff'; ctx.lineWidth = 4;
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(xP + 4, cy + sg * H * 1.02); ctx.quadraticCurveTo(xP, cy + sg * H * 0.6, xP - 1, cy + sg * H * 0.18); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(xS, cy - H * 0.32); ctx.quadraticCurveTo(xS + 4, cy, xS, cy + H * 0.32); ctx.stroke();
      // detector and focus
      ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xD, cy - H * 0.3); ctx.lineTo(xD, cy + H * 0.3); ctx.stroke();
      ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(xF, cy, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'center';
      ctx.fillText(t('primary'), xP, cy + H + 14); ctx.fillText(t('secondary'), xS, cy + H * 0.35 + 14); ctx.fillText(t('detector'), xD, cy + H * 0.3 + 14);
      ctx.textAlign = 'left'; ctx.fillText(t('{T} °C · shifts drawn ×{k} · focus (gold) against the detector (blue): {d} µm', { T: fmt(s.T, 3), k: fmt(K, 3), d: fmt(M.defocus * 1000, 3) }), 10, hh - 12);
      return;
    }
    const f0 = lensFocus(M.els, T0), xL = 0.16 * w, sc = (0.66 * w) / f0, shifts = Math.max(Math.abs(M.partA), Math.abs(M.partB), 1e-12);
    const K = Math.max(1, nice((0.07 * w) / (sc * shifts)));
    const xF = xL + (f0 + K * M.partA) * sc, xS = xL + (f0 - K * M.partB) * sc;
    // barrel
    ctx.fillStyle = tcol(s.T, 0.22); ctx.strokeStyle = tcol(s.T); ctx.lineWidth = 2;
    for (const sg of [-1, 1]) { ctx.fillRect(xL - 18, cy + sg * (H + 4) - (sg < 0 ? 10 : 0), xS - xL + 26, 10); ctx.strokeRect(xL - 18, cy + sg * (H + 4) - (sg < 0 ? 10 : 0), xS - xL + 26, 10); }
    // lens elements
    M.els.forEach((e, i) => {
      const x = xL + i * 10, pos = e.phi > 0;
      ctx.fillStyle = pos ? 'rgba(160,210,255,0.35)' : 'rgba(255,190,140,0.35)'; ctx.strokeStyle = pos ? '#a8d6ff' : '#ffc08a'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (pos) { ctx.moveTo(x, cy - H); ctx.quadraticCurveTo(x - 12, cy, x, cy + H); ctx.quadraticCurveTo(x + 12, cy, x, cy - H); }
      else { ctx.moveTo(x - 1, cy - H); ctx.lineTo(x + 7, cy - H); ctx.quadraticCurveTo(x + 2, cy, x + 7, cy + H); ctx.lineTo(x - 1, cy + H); ctx.quadraticCurveTo(x + 4, cy, x - 1, cy - H); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    // rays to the focus and on to the sensor
    ctx.strokeStyle = 'rgba(255,236,170,0.6)'; ctx.lineWidth = 1;
    for (const y of [-0.8, -0.4, 0.4, 0.8]) {
      const y0 = cy + y * H, xe = Math.max(xS, xF) + 20, ye = cy + ((y0 - cy) * (xe - xF)) / (xL + 10 - xF);
      ctx.beginPath(); ctx.moveTo(6, y0); ctx.lineTo(xL + 10, y0); ctx.lineTo(xe, ye); ctx.stroke();
    }
    ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xS, cy - H * 0.55); ctx.lineTo(xS, cy + H * 0.55); ctx.stroke();
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(xF, cy, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'left';
    ctx.fillText(t('{T} °C in {env} · shifts drawn ×{k} · focus (gold) against the sensor (blue): {d} µm', { T: fmt(s.T, 3), env: s.env === 'vacuum' ? t('vacuum') : t('air'), k: fmt(K, 3), d: fmt(M.defocus * 1000, 3) }), 10, hh - 12);
  }

  function drawStar(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const S = stars(), top = 34, side = Math.min(w / 2 - 20, (hh - top) * 0.58), rects = [{ x: w / 4 - side / 2, y: top, w: side, h: side }, { x: (3 * w) / 4 - side / 2, y: top, w: side, h: side }];
    [S.a, S.b].forEach((im, k) => {
      let pk = 0;
      for (const v of im.I) if (v > pk) pk = v;
      // the 20 °C star at the same scale as the other: crop its smaller field when they differ
      const scale = (im.pix * NPSF) / S.fov, cw = NPSF / scale, x0 = (NPSF - cw) / 2;
      paintMap(star, rects[k], { a: im.I, w: NPSF, h: NPSF, x0, y0: x0, cw, ch: cw, lut: LUT, linear: true, value: (v) => Math.sqrt(Math.max(0, v) / pk) }, `${S.k}|${k}`, k);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(rects[k].x + 0.5, rects[k].y + 0.5, side - 1, side - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(k ? t('at {T} °C', { T: fmt(ctl.state.T, 3) }) : t('at 20 °C (focused)'), rects[k].x + side / 2, rects[k].y + side + 5);
    });
    const bar = nice(S.fov / 4), px = (bar / S.fov) * side, r = rects[1];
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r.x + 8, r.y + side - 10); ctx.lineTo(r.x + 8 + px, r.y + side - 10); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = '10.5px Inter, sans-serif'; ctx.fillText(len(bar), r.x + 8, r.y + side - 13);
    // a cut through both stars, in light per unit area relative to the focused peak
    const y0 = top + side + 42, y1 = hh - 10, x0 = 14, x1 = w - 14;
    if (y1 - y0 < 30) return;
    const cut = (im) => { const out = [], j = NPSF / 2; for (let i = 0; i < NPSF; i++) out.push([(i - NPSF / 2 + 0.5) * im.pix, im.I[j * NPSF + i] / (im.pix * im.pix)]); return out; };
    const a = cut(S.a), b = cut(S.b), pk = Math.max(...a.map((p) => p[1])), X = (x) => x0 + ((x / S.fov) + 0.5) * (x1 - x0), Y = (v) => y1 - (v / pk) * (y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    [[a, 'rgba(255,255,255,0.55)'], [b, '#ffd27a']].forEach(([c, col]) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); let pen = false;
      for (const [x, v] of c) { if (Math.abs(x) > S.fov / 2) { pen = false; continue; } const X1 = X(x), Y1 = Y(Math.min(v, pk)); if (pen) ctx.lineTo(X1, Y1); else ctx.moveTo(X1, Y1); pen = true; }
      ctx.stroke();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '10.5px Inter, sans-serif';
    ctx.fillText(t('Cut through the stars: 20 °C (white) and now (gold), same scale'), x0, y0 - 14);
  }

  function drawCurve(ctx, w, hh) {
    // µm for a lens, mm for the telescope
    const tot = [], A = [], B = [], s = ctl.state, M0 = model(s.T), u = M0.scope ? 1 : 1000, dof = depthOfFocus(M0.N) * u;
    for (let T = TMIN; T <= TMAX; T += 1) { const M = model(T); tot.push([T, M.defocus * u]); A.push([T, M.partA * u]); B.push([T, M.partB * u]); }
    const all = [...tot, ...A, ...B].map((p) => p[1]), lim = Math.max(3 * dof, ...all.map(Math.abs)) * 1.08;
    plot(ctx, w, hh, {
      title: N_('Focus error against temperature'), x: { min: TMIN, max: TMAX, label: N_('temperature (°C)') }, y: { min: -lim, max: lim, label: M0.scope ? N_('focus error (mm)') : N_('focus error (µm)') },
      bands: [{ y: [-dof, dof], color: 'rgba(107,227,164,0.14)' }],
      series: [
        { data: A, color: '#a8d6ff', width: 1.4, dash: [5, 4], label: M0.scope ? N_('mirrors') : N_('lens') },
        { data: B, color: '#ffc08a', width: 1.4, dash: [2, 3], label: M0.scope ? N_('truss') : N_('barrel') },
        { data: tot, color: '#ffffff', width: 2.2, label: N_('focus error') },
      ],
      vlines: [{ x: s.T, label: N_('now'), color: '#ffd27a' }], hlines: [{ y: dof, label: N_('depth of focus'), color: 'rgba(107,227,164,0.7)' }], legend: true,
    });
  }

  function drawChart(ctx, w, hh) {
    const s = ctl.state;
    if (s.mode === 'scope') {
      // how far each truss material can be warmed before the image blurs (log scale, 0.001–1000 K)
      const c = cassegrain({ ...HUBBLE, m: s.m }), dof = depthOfFocus(c.N), aM = MATERIALS[s.mirror].cte, rows = Object.entries(MATERIALS).map(([k, m]) => {
        const sl = Math.abs(cassDefocus(c, aM, m.cte, T0 + 0.5).defocus - cassDefocus(c, aM, m.cte, T0 - 0.5).defocus) * 1000;
        return [k, m.name, dof / sl];
      }).sort((a, b) => a[2] - b[2]);
      const pl = 150, pr = 24, pt = 48, pb = 34, X = (v) => pl + ((Math.log10(Math.min(1e3, Math.max(1e-3, v))) + 3) / 6) * (w - pl - pr), rowH = (hh - pt - pb) / rows.length;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(t('Temperature change each truss tolerates'), pl, 14);
      ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let e = -3; e <= 3; e++) { const x = X(10 ** e); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.moveTo(x, pt - 4); ctx.lineTo(x, hh - pb); ctx.stroke(); ctx.fillText(localNum(['0.001', '0.01', '0.1', '1', '10', '100', '1000'][e + 3]), x, hh - pb + 6); }
      ctx.fillText(t('tolerated change (K)'), (pl + w - pr) / 2, hh - 16);
      rows.forEach((r, i) => {
        const y = pt + (i + 0.5) * rowH, x = X(r[2]), on = r[0] === s.truss;
        ctx.fillStyle = on ? '#ffd27a' : 'rgba(168,214,255,0.55)'; ctx.fillRect(pl, y - rowH * 0.3, x - pl, rowH * 0.6);
        ctx.fillStyle = on ? '#ffd27a' : 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(t(r[1]), pl - 8, y);
        ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(r[2] >= 1e3 ? `> ${localNum('1000')} K` : `±${fmt(r[2], 2)} K`, Math.min(x + 6, w - pr - 60), y);
      });
      return;
    }
    const P0n = s.env === 'vacuum' ? 0 : P0, pts = THERMO_GLASSES.map((g) => [1 / abbe(g), gamma(g, LAMBDA, T0, P0n) * 1e6, g]);
    const series = [{ data: pts.map((p) => [p[0], p[1]]), color: '#a8d6ff', points: true, r: 3.5, label: N_('glasses') }];
    const aH = MATERIALS[s.housing].cte * 1e6;
    let yPair = 0;
    if (s.g2 !== 'none') {
      const a = pts.find((p) => p[2] === s.g1), b = pts.find((p) => p[2] === s.g2), y0 = intercept(s.g1, s.g2, P0n) * 1e6;
      yPair = Math.max(-120, Math.min(60, y0));
      series.push({ data: [[0, y0], [a[0], a[1]], [b[0], b[1]]].sort((u, v) => u[0] - v[0]), color: '#ffd27a', width: 1.6, label: N_('this pair, extended to ω = 0') });
    }
    series.push({ data: [[0, -aH]], color: '#6be3a4', points: true, r: 5, label: N_('barrel: −α') });
    const ys = pts.map((p) => p[1]), lo = Math.min(-aH - 5, yPair - 5, ...ys) - 4, hi = Math.max(yPair + 5, ...ys) + 6;
    const P = plot(ctx, w, hh, { title: N_('Athermal chart: an achromat is athermal when its line meets −α of the barrel'), x: { min: 0, max: 0.045, label: N_('dispersion ω = 1/V') }, y: { min: lo, max: hi, label: N_('thermal power coefficient γ (ppm/K)') }, series, legend: true });
    ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // label the pair first, then every glass whose label does not overlap one already placed
    const placed = [], order = [...pts].sort((u, v) => (v[2] === s.g1 || v[2] === s.g2) - (u[2] === s.g1 || u[2] === s.g2));
    for (const [x, y, g] of order) {
      const bx = P.X(x) + 5, by = P.Y(y) - 6, bw = ctx.measureText(g).width;
      if (placed.some((r) => bx < r[0] + r[2] && bx + bw > r[0] && Math.abs(by - r[1]) < 11)) continue;
      placed.push([bx, by, bw]);
      ctx.fillStyle = g === s.g1 || g === s.g2 ? '#ffd27a' : 'rgba(255,255,255,0.75)';
      ctx.fillText(g, bx, by);
    }
    ctx.fillStyle = '#6be3a4'; ctx.fillText(t(MATERIALS[s.housing].name), P.X(0) + 8, P.Y(-aH));
  }
  update();

  root.append(rule(String.raw`\[\frac{1}{f}\frac{df}{dT} = -\gamma,\quad \gamma = \frac{dn/dT}{n-1}-\alpha_g,\qquad \text{in focus when } \gamma_\text{lens} = -\alpha_\text{barrel}\]
<p>An N-BK7 lens has γ ≈ −1.7 ppm/K, so its focal length grows by 1.7 µm per metre per kelvin, while an aluminium barrel grows 23 µm per metre per kelvin: a 200 mm f/4 lens warmed by 25 K is 107 µm out of focus, more than three times its depth of focus of ±19 µm. In a two-mirror telescope the secondary's movement is multiplied by m² + 1, about 110 for Hubble.</p>`,
    String.raw`Thin lenses in contact, designed as an achromat at 20 °C in air for the d line; uniform temperature everywhere (no gradients, which bend the image as well); linear expansion with fixed coefficients; the telescope traced paraxially on axis. Material expansion coefficients are typical values; the glass constants are SCHOTT's catalogue fits, valid from −100 to +140 °C.`));
  root.append(theory('Temperature, index and focus', String.raw`
<div class="theory-cols"><div>
<h3>Glass</h3>
<p>Heating a glass lowers its density, which lowers the index, but also shifts its ultraviolet absorption bands to longer wavelengths, which raises it. Which wins depends on the glass: dense flints and lanthanum glasses gain index, fluor-crowns like N-FK51A and N-PK52A lose it. SCHOTT fits the absolute index (against vacuum) with six constants per glass: \(\Delta n_\text{abs} = \frac{n^2-1}{2n}\big[D_0\Delta T + D_1\Delta T^2 + D_2\Delta T^3 + \frac{E_0\Delta T+E_1\Delta T^2}{\lambda^2-\lambda_{TK}^2}\big]\). Catalogue indices are relative to air, whose index \(n_\text{air}\approx 1.00027\) itself falls by about \(0.93\times10^{-6}\) per kelvin, so a lens behaves differently in air and in vacuum: the relative index rises when the air is pumped away, and the focal length shortens by \(f(n_\text{air}-1)\,n/(n-1)\), about 0.16 mm for a 200 mm crown lens.</p>
<h3>A lens and its barrel</h3>
<p>A thin lens of power \(\varphi=(n-1)(1/R_1-1/R_2)\) changes as \(\frac{1}{\varphi}\frac{d\varphi}{dT} = \frac{dn/dT}{n-1}-\alpha_g\): the index term and the expansion of the radii. The image moves by \(-f\gamma\,\Delta T\) while the barrel moves the sensor by \(\alpha_h L\,\Delta T\). With two glasses, the achromatic condition \(\varphi_1\omega_1+\varphi_2\omega_2=0\) and the athermal condition \(\varphi_1\gamma_1+\varphi_2\gamma_2=-\alpha_h\varphi\) can both be met; on a chart of \(\gamma\) against \(\omega=1/V\), the line through the two glasses must cross \(\omega=0\) at \(-\alpha_h\) (Tamagawa et al. 1994).</p>
</div><div>
<h3>Telescopes</h3>
<p>In a Cassegrain telescope the secondary mirror re-images the primary's focus with magnification \(m\), and moving it by \(\delta\) moves the final focus by \((m^2+1)\delta\). For Hubble, f/2.3 to f/24, that is about 110: the depth of focus of ±0.7 mm at the detector allows the secondary only ±6 µm, and an aluminium truss 4.9 m long would allow ±0.05 K. Hubble's metering truss is made of graphite-epoxy and its mirrors of ultra-low-expansion glass, and the telescope is kept warm; even so, its focus drifts slowly as the structure dries out in vacuum and is corrected by moving the secondary.</p>
<h3>Remedies</h3>
<p>Passive: choose glasses and mount materials so the effects cancel, or use low-expansion structures. Active: move a lens or the sensor with temperature, as autofocus does in cameras and focus mechanisms in space instruments. Thermal-infrared lenses are the extreme case: germanium's index changes about a hundred times faster than that of ordinary glass, so infrared cameras rely on athermal designs or motorised focus.</p>
</div></div>`));
  root.append(references([
    'SCHOTT AG, Technical Information TIE-19, "Temperature coefficient of the refractive index" (August 2023).',
    'B. Edlén, "The dispersion of standard air", J. Opt. Soc. Am. 43, 339 (1953).',
    'T. H. Jamieson, "Thermal effects in optical systems", Opt. Eng. 20, 156 (1981).',
    'Y. Tamagawa, S. Wakabayashi, T. Tajime &amp; T. Hashimoto, "Multilens system design with an athermal chart", Appl. Opt. 33, 8009 (1994).',
    'Crystran Ltd., <i>Handbook of infra-red and ultra-violet optical materials</i>, 5th ed. (2023).',
    'M. N. Polyanskiy, "Refractiveindex.info database of optical constants", Sci. Data 11, 94 (2024).',
  ]));
  return () => [draw, star, curve, chart].forEach((st) => st.destroy());
}
