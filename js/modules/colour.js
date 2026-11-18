import { h, controls, stage, readouts, texNum, imageCanvas } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { oetf, wavelengthCSS } from '../lib/color.js';
import { ILLUMINANTS, TCS, CMF } from '../lib/colordata.js';
import { CES } from '../lib/cesdata.js';
import { tlci } from '../lib/tlci.js';
import { CHECKER_NAMES } from '../lib/tlcidata.js';
import { view3d } from '../lib/gl3d.js';
import { colourSolidScene, gamutCoverage, samplesOutside } from '../lib/colour3d.js';
import { LAMBDA, xyz, chromaticity, uv1960, blackbody, daylight, cri, tm30, sampleSRGB, planck, CAMERAS, EXTRA_PATCHES, cameraColour, wbGains, lutherResidual, metamer, xyzToSRGB, lab as cielab, adapt, deltaE00, D65_XYZ } from '../lib/colorsci.js';
import { t } from '../lib/i18n.js';

const css = (rgb) => `rgb(${rgb.map((v) => Math.round(255 * oetf(Math.min(1, Math.max(0, v))))).join(',')})`;
const TCS_NAMES = ['Light greyish red', 'Dark greyish yellow', 'Strong yellow green', 'Moderate yellowish green', 'Light bluish green', 'Light blue', 'Light violet', 'Light reddish purple', 'Strong red (R9)', 'Strong yellow', 'Strong green', 'Strong blue', 'Light yellowish pink (skin)', 'Moderate olive green (leaf)'];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'video'] }));
  root.append(idea(String.raw`<p>The colour you see is not simply painted on an object. It comes from three things together: the light falling on it, how strongly its surface reflects each colour of that light, and how your eyes, or a camera's sensor, respond. Change any one of them and the colour changes.</p>
<p>Two lamps can both look white and have the same "colour temperature", yet make skin look healthy under one and greyish under the other, because each lacks different colours. A camera can also disagree with your eye: two fabrics that match perfectly to you can look different in a photo. That is called <strong>metamerism</strong>.</p>`, [
    "Choose the <strong>Black body</strong> source at 3000 K and note the colour rendering index, then pick an LED of a similar temperature.",
    "In the camera section, set the white balance to <strong>Daylight preset</strong> under tungsten light: everything turns orange.",
    "In the metamerism section, change <strong>Compare under</strong> to another lamp: two samples that matched in daylight no longer match.",
  ]));

  const ctl = controls({
    src: { type: 'select', label: 'Light source', value: 'LED-B3', options: [['bb', 'Black body (incandescent, candle)'], ['day', 'CIE daylight (D series)'], ...Object.entries(ILLUMINANTS).map(([k, v]) => [k, v.name])] },
    T: { type: 'range', label: 'Temperature', min: 1500, max: 12000, log: true, value: 3200, unit: 'K', when: (st) => st.src === 'bb' || st.src === 'day' },
    gamut: { type: 'seg', label: 'Display gamut in 3-D', value: 'srgb', options: [['srgb', 'sRGB'], ['p3', 'Display P3'], ['rec2020', 'Rec. 2020']] },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const spdView = stage({ aspect: 2.2, label: '', draw: drawSPD, cls: 'plain', minH: 220 });
  const swatches = h('div.card', { style: { padding: '12px' } });
  const bars = stage({ aspect: 1.45, label: '', draw: drawBars, cls: 'plain', minH: 260 });
  const diagram = stage({ aspect: 1.45, label: 'CIE 1960 (u, v) with the Planckian locus', draw: drawUV, minH: 260 });
  const solid3 = view3d({ label: '3-D: every surface colour possible under this light, in CIE xyY, with a display gamut', aspect: 1.6, minH: 280, yaw: -0.35, pitch: 0.42 });
  root.append(lab([h('div.card', { style: { padding: '6px' } }, spdView.el), swatches, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, bars.el), diagram.el), solid3.el], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  // ── fidelity and gamut: CIE 2017 Rf and ANSI/IES TM-30 Rg, for the same light ──
  const secF = h('section.block', {}, h('h2', {}, 'Beyond Ra: 99 samples, fidelity Rf and gamut Rg (CIE 2017, ANSI/IES TM-30)'));
  const fro = h('div'), fcalc = liveCalc('Fidelity and gamut');
  const cvg = stage({ aspect: 1.75, label: 'Colour vector graphic: 16 hue bins in CAM02-UCS', draw: drawCVG, minH: 320 });
  const shifts = stage({ aspect: 2.6, label: '', draw: drawShifts, cls: 'plain', minH: 240 });
  secF.append(lab([cvg.el, h('div.card', { style: { padding: '6px' } }, shifts.el)], [h('div.card', {}, fro), fcalc.el]));
  root.append(secF);

  // ── TLCI-2012: the same light judged by a standard broadcast camera and display ──
  const secT = h('section.block', {}, h('h2', {}, 'Through a television camera: TLCI-2012 (EBU Tech 3355)'));
  const tro = h('div'), tcalc = liveCalc('Television lighting consistency');
  const checker = stage({ aspect: 1.5, label: 'ColorChecker through the EBU standard camera: reference light, test light inset', draw: drawChecker, minH: 260 });
  secT.append(lab([checker.el], [h('div.card', {}, tro), tcalc.el]));
  root.append(secT);

  let C = null;
  function source(st) {
    if (st.src === 'bb') return { spd: blackbody(st.T), name: `Black body ${st.T.toFixed(0)} K` };
    if (st.src === 'day') { const T = Math.max(4000, st.T); return { spd: daylight(T), name: `CIE daylight ${T.toFixed(0)} K` + (st.T < 4000 ? ' (defined from 4000 K)' : '') }; }
    return { spd: ILLUMINANTS[st.src].spd, name: ILLUMINANTS[st.src].name };
  }
  function update() {
    const st = ctl.state, S = source(st), r = cri(S.spd), W = xyz(S.spd), xy = chromaticity(W);
    // luminous efficacy of radiation over 380–780 nm
    const ler = (683 * S.spd.reduce((a, s, i) => a + s * CMF[1][i], 0)) / S.spd.reduce((a, s) => a + s, 0);
    const cols = TCS.map((t) => ({ test: sampleSRGB(t, S.spd), ref: sampleSRGB(t, r.ref) }));
    C = { st, S, r, xy, W, cols };
    updateFidelity(S, r);
    updateTLCI(S);
    ro.replaceChildren(readouts([
      ['Correlated colour temperature', r.cct.toFixed(0) + ' K'],
      ['Distance from the Planckian locus Duv', (r.duv >= 0 ? '+' : '') + r.duv.toFixed(4)],
      ['Chromaticity x, y', `${xy[0].toFixed(4)}, ${xy[1].toFixed(4)}`],
      ['Reference illuminant', r.cct < 5000 ? t('black body') : t('CIE daylight')],
      ['General CRI Ra (R1–R8)', r.Ra.toFixed(1)],
      ['Saturated red R9', r.R[8].toFixed(1)],
      ['Skin tone R13', r.R[12].toFixed(1)],
      ['Luminous efficacy of radiation', ler.toFixed(0) + ' lm/W'],
      ['Display gamut, share of all chromaticities', (100 * gamutCoverage(st.gamut)).toFixed(1) + ' %'],
      ['Test colours the display cannot show', `${samplesOutside(S.spd, st.gamut)} of 14`],
    ]));
    calc.say(r.R[8] < 50
      ? t('This light has a colour temperature of <strong>{T} K</strong> and a colour rendering index of <strong>{Ra}</strong> (100 means colours look as under the reference light); saturated red scores only {R9}, so reds look dull.', { T: r.cct.toFixed(0), Ra: r.Ra.toFixed(0), R9: r.R[8].toFixed(0) })
      : t('This light has a colour temperature of <strong>{T} K</strong> and a colour rendering index of <strong>{Ra}</strong> (100 means colours look as under the reference light).', { T: r.cct.toFixed(0), Ra: r.Ra.toFixed(0) }));
    calc.set(String.raw`\begin{aligned}
    T_{cp} &= \arg\min_T \lVert (u,v) - (u,v)_\text{Planck}(T)\rVert = ${texNum(r.cct, 4)}\ \text{K}\\
    R_i &= 100 - 4.6\,\Delta E_{U^*V^*W^*,i}\\
    R_9 &= ${texNum(r.R[8], 3)},\quad R_a = \tfrac18\textstyle\sum_{i=1}^{8}R_i = ${texNum(r.Ra, 3)}
    \end{aligned}`);
    swatches.replaceChildren(
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--fg-dim)', marginBottom: '6px' } }, h('span', {}, `Upper half: reference (${r.cct < 5000 ? 'black body' : 'daylight'} at ${r.cct.toFixed(0)} K) · lower half: ${S.name}`), h('span', {}, 'colours as seen by an adapted observer')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' } }, ...cols.map((c, i) => h('div', { title: `TCS${String(i + 1).padStart(2, '0')} ${TCS_NAMES[i]}: R${i + 1} = ${r.R[i].toFixed(1)}`, style: { borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' } },
        h('div', { style: { height: '30px', background: css(c.ref) } }), h('div', { style: { height: '30px', background: css(c.test) } }),
        h('div', { style: { fontSize: '10.5px', padding: '3px 4px', fontFamily: '"JetBrains Mono", monospace', color: r.R[i] < 50 ? 'var(--warn)' : 'var(--fg-dim)' } }, `R${i + 1} ${r.R[i].toFixed(0)}`)))),
    );
    [spdView, bars, diagram, cvg, shifts, checker].forEach((x) => x.redraw());
    show3d(st, S);
  }
  // 3-D: rebuilt only when the light or the gamut changes; the camera stays put after the first scene
  let shown3d = '';
  function show3d(st, S) {
    const k = `${S.name}|${st.gamut}`;
    if (k === shown3d) return;
    solid3.setScene(colourSolidScene(S.spd, st.gamut), !!shown3d);
    shown3d = k;
  }

  function drawSPD(ctx, w, hh) {
    if (!C) return;
    const n = (s) => { const m = Math.max(...s); return s.map((v) => v / m); };
    const spd = n(C.S.spd), rf = n(C.r.ref);
    const P = plot(ctx, w, hh, {
      title: t('Spectral power distribution: {s}', { s: C.S.name }), x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: 0, max: 1.08, label: 'relative power' },
      series: [{ data: LAMBDA.map((l, i) => [l, rf[i]]), color: 'rgba(255,255,255,0.6)', width: 1.4, dash: [5, 3], label: t('reference ({T} K)', { T: C.r.cct.toFixed(0) }) }, { data: LAMBDA.map((l, i) => [l, spd[i]]), color: '#ffffff', width: 2, label: 'test source' }],
      legend: true,
    });
    // rainbow fill under the test spectrum
    ctx.save();
    for (let i = 0; i < LAMBDA.length - 1; i++) {
      const x0 = P.X(LAMBDA[i]), x1 = P.X(LAMBDA[i + 1]);
      ctx.fillStyle = wavelengthCSS(LAMBDA[i] + 2.5, 0.55);
      ctx.beginPath(); ctx.moveTo(x0, P.Y(0)); ctx.lineTo(x0, P.Y(spd[i])); ctx.lineTo(x1, P.Y(spd[i + 1])); ctx.lineTo(x1, P.Y(0)); ctx.fill();
    }
    ctx.restore();
  }

  function drawBars(ctx, w, hh) {
    if (!C) return;
    const P = plot(ctx, w, hh, { title: t('Special colour rendering indices (Ra = {Ra})', { Ra: C.r.Ra.toFixed(1) }), x: { min: 0.5, max: 14.5, step: 1, label: 'test colour sample', fmt: (v) => 'R' + v }, y: { min: Math.min(0, Math.floor(Math.min(...C.r.R) / 20) * 20), max: 100, label: 'Rᵢ' }, series: [] });
    C.r.R.forEach((R, i) => {
      const x = P.X(i + 1), bw = (P.X(2) - P.X(1)) * 0.7, y = P.Y(R);
      ctx.fillStyle = css(C.cols[i].ref); ctx.fillRect(x - bw / 2, Math.min(y, P.Y(0)), bw, Math.abs(P.Y(0) - y));
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(x - bw / 2, Math.min(y, P.Y(0)), bw, Math.abs(P.Y(0) - y));
    });
    ctx.strokeStyle = '#ffb547'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(P.X(0.5), P.Y(C.r.Ra)); ctx.lineTo(P.X(8.5), P.Y(C.r.Ra)); ctx.stroke(); ctx.setLineDash([]);
  }

  // spectral locus and Planckian locus in CIE 1960 (u, v)
  const locus = [];
  for (let l = 380; l <= 700; l += 5) { const i = (l - 380) / 5; locus.push(uv1960([CMF[0][i], CMF[1][i], CMF[2][i]])); }
  const planckLocus = [];
  for (let T = 1000; T <= 25000; T *= 1.05) planckLocus.push([T, uv1960(xyz(LAMBDA.map((l) => planck(l, T))))]);
  function drawUV(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!C) return;
    const u0 = 0.15, u1 = 0.345, v0 = 0.25, v1 = 0.375, padL = 34, padB = 26, padT = 30;
    const sc = Math.min((w - padL - 10) / (u1 - u0), (hh - padB - padT) / (v1 - v0));
    const X = (u) => padL + (u - u0) * sc, Y = (v) => hh - padB - (v - v0) * sc;
    // gamut fill: each chromaticity inside the spectral locus at full sRGB brightness
    if (!drawUV.img || drawUV.img.sc !== sc) {
      const Wp = Math.ceil((u1 - u0) * sc), Hp = Math.ceil((v1 - v0) * sc), ic = imageCanvas(Wp, Hp);
      const inside = (u, v) => { let c = false; for (let a = 0, b = locus.length - 1; a < locus.length; b = a++) { const [ua, va] = locus[a], [ub, vb] = locus[b]; if ((va > v) !== (vb > v) && u < ((ub - ua) * (v - va)) / (vb - va) + ua) c = !c; } return c; };
      for (let py = 0; py < Hp; py++) for (let px = 0; px < Wp; px++) {
        const u = u0 + (px + 0.5) / sc, v = v1 - (py + 0.5) / sc, o = (py * Wp + px) * 4;
        if (!inside(u, v)) continue;
        const d = 2 * u - 8 * v + 4, x = (3 * u) / d, y = (2 * v) / d, Xc = x / y, Zc = (1 - x - y) / y;
        let rgb = [3.2406 * Xc - 1.5372 - 0.4986 * Zc, -0.9689 * Xc + 1.8758 + 0.0415 * Zc, 0.0557 * Xc - 0.204 + 1.057 * Zc];
        const mn = Math.min(...rgb); if (mn < 0) rgb = rgb.map((q) => q - mn);
        const mx = Math.max(...rgb);
        for (let c = 0; c < 3; c++) ic.data[o + c] = 255 * oetf(rgb[c] / mx);
        ic.data[o + 3] = 120;
      }
      ic.put();
      drawUV.img = { sc, c: ic.c };
    }
    ctx.drawImage(drawUV.img.c, X(u0), Y(v1));
    ctx.save(); ctx.beginPath(); ctx.rect(X(u0), Y(v1), (u1 - u0) * sc, (v1 - v0) * sc); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2; ctx.beginPath();
    locus.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.closePath(); ctx.stroke();
    // lines of constant Duv (±0.01, ±0.02): offsets of the locus along its normal
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    for (const dv of [-0.02, -0.01, 0.01, 0.02]) {
      ctx.beginPath();
      planckLocus.forEach(([, [u, v]], i) => {
        const [, [u2, v2]] = planckLocus[Math.min(planckLocus.length - 1, i + 1)], [, [u1p, v1p]] = planckLocus[Math.max(0, i - 1)];
        const tu = u2 - u1p, tv = v2 - v1p, l = Math.hypot(tu, tv) || 1, nu = tv / l, nv = -tu / l; // normal pointing up-left
        const x = X(u - nu * dv), y = Y(v - nv * dv);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 3.2; ctx.beginPath();
    planckLocus.forEach(([, [u, v]], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.stroke();
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    for (const T of [2000, 2700, 3500, 5000, 6500, 10000]) {
      const [u, v] = uv1960(xyz(LAMBDA.map((l) => planck(l, T))));
      ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(X(u), Y(v), 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(10,10,14,0.85)'; ctx.fillText(T + ' K', X(u) + 5, Y(v) + 14);
    }
    const [ut, vt] = uv1960(C.W);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(ut), Y(vt), 5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(X(u0), Y(v1), (u1 - u0) * sc, (v1 - v0) * sc);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    for (let u = 0.16; u <= u1; u += 0.04) ctx.fillText(u.toFixed(2), X(u), Y(v0) + 14);
    ctx.textAlign = 'right';
    for (let v = 0.26; v <= v1; v += 0.04) ctx.fillText(v.toFixed(2), X(u0) - 4, Y(v) + 4);
    ctx.textAlign = 'left'; ctx.fillText(t('dashed: Duv = ±0.01, ±0.02'), X(u0) + 6, Y(v0) - 6);
  }

  // TM-30: scores, the hue bins' colours (their samples under the reference, as an adapted observer
  // sees them) and the live calculation
  let F = null;
  function updateFidelity(S, r) {
    const f = tm30(S.spd), sum = Array.from({ length: 16 }, () => [0, 0, 0]);
    f.refUCS.forEach((p, i) => { const c = sampleSRGB(CES[i], f.ref), s = sum[Math.min(15, Math.floor(p[3] / 22.5))]; for (let k = 0; k < 3; k++) s[k] += c[k]; });
    const binCol = sum.map((s, j) => { const m = Math.max(...s) || 1; return s.map((q) => (0.9 * q) / m); });
    const big = f.hue.reduce((b, x, j) => (Math.abs(x.Rcs) > Math.abs(f.hue[b].Rcs) ? j : b), 0);
    const most = f.hue.reduce((b, x, j) => (x.Rcs > f.hue[b].Rcs ? j : b), 0), least = f.hue.reduce((b, x, j) => (x.Rcs < f.hue[b].Rcs ? j : b), 0);
    const low = f.Ri.reduce((b, x, i) => (x < f.Ri[b] ? i : b), 0);
    const meanDE = f.dE.reduce((a, x) => a + x, 0) / f.dE.length;
    const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + ' %';
    F = { f, binCol };
    const refName = f.cct < 4000 ? t('black body') : f.cct > 5000 ? t('CIE daylight') : t('black body and CIE daylight mixed, {p} % daylight', { p: (100 * (f.cct - 4000) / 1000).toFixed(0) });
    fro.replaceChildren(readouts([
      ['Light source', S.name],
      ['Fidelity index Rf', f.Rf.toFixed(1)],
      ['Gamut index Rg', f.Rg.toFixed(1)],
      ['General CRI Ra (R1–R8)', r.Ra.toFixed(1)],
      ['Red fidelity Rf,h1', f.hue[0].Rf.toFixed(0)],
      ['Red chroma shift Rcs,h1', pct(f.hue[0].Rcs)],
      ['Largest chroma shift', t('{v} in hue bin {j}', { v: pct(f.hue[big].Rcs), j: big + 1 })],
      ['Lowest sample score', t('{v} (sample CES{n})', { v: f.Ri[low].toFixed(0), n: String(low + 1).padStart(2, '0') })],
      ['Reference for Rf', refName],
    ]));
    // the saturated case names the bin that gains most, the dull case the one that loses most
    const k = f.Rg > 102 ? most : least, base = { Rf: f.Rf.toFixed(0), Ra: r.Ra.toFixed(0), Rg: f.Rg.toFixed(0), j: k + 1, cs: pct(f.hue[k].Rcs) };
    fcalc.say(f.Rg > 102
      ? t('Judged on 99 samples, this light scores <strong>Rf = {Rf}</strong> for fidelity (Ra gave {Ra}) and <strong>Rg = {Rg}</strong> for gamut: colours look more saturated than under the reference light, most of all in hue bin {j} ({cs} chroma).', base)
      : f.Rg < 98
        ? t('Judged on 99 samples, this light scores <strong>Rf = {Rf}</strong> for fidelity (Ra gave {Ra}) and <strong>Rg = {Rg}</strong> for gamut: colours look duller than under the reference light, most of all in hue bin {j} ({cs} chroma).', base)
        : t('Judged on 99 samples, this light scores <strong>Rf = {Rf}</strong> for fidelity (Ra gave {Ra}) and <strong>Rg = {Rg}</strong> for gamut: colours are about as saturated as under the reference light.', base));
    fcalc.set(String.raw`\begin{aligned}
    \Delta E_i &= \big\lVert \Delta(J',a',b')_i\big\rVert,\quad \overline{\Delta E} = ${texNum(meanDE, 3)}\\
    R_f &= 10\ln\!\big(e^{(100 - 6.73\,\overline{\Delta E})/10} + 1\big)\\ &= ${texNum(f.Rf, 3)}\\
    R_g &= 100\,A_\text{test}/A_\text{ref} = ${texNum(f.Rg, 3)}\\
    R_{cs,h1} &= 100\,\Delta\bar{\mathbf a}'_1\cdot\hat{\mathbf u}_1\big/\lvert\bar{\mathbf a}'_{\text{ref},1}\rvert = ${texNum(f.hue[0].Rcs, 2)}\ \%
    \end{aligned}`);
  }

  function drawCVG(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!F) return;
    const { f, binCol } = F, cx = w / 2, cy = hh / 2 + 6, R = Math.min(w, hh) * 0.31;
    const P = ([a, b]) => [cx + R * a, cy - R * b], deg = Math.PI / 180;
    for (let j = 0; j < 16; j++) {
      ctx.fillStyle = css(binCol[j]); ctx.globalAlpha = 0.32;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.42, -j * 22.5 * deg, -(j + 1) * 22.5 * deg, true); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    for (const q of [0.6, 0.8, 1.2]) { ctx.beginPath(); ctx.arc(cx, cy, R * q, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    // test polygon, then an arrow per bin from the reference to the test average
    ctx.beginPath(); f.hue.forEach((b, j) => { const [x, y] = P(b.test); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    f.hue.forEach((b, j) => {
      const [x0, y0] = P(b.ref), [x1, y1] = P(b.test), L = Math.hypot(x1 - x0, y1 - y0);
      ctx.strokeStyle = ctx.fillStyle = css(binCol[j].map((q) => Math.min(1, q * 1.25))); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (L > 4) { const ux = (x1 - x0) / L, uy = (y1 - y0) / L; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 7 * ux - 3.5 * uy, y1 - 7 * uy + 3.5 * ux); ctx.lineTo(x1 - 7 * ux + 3.5 * uy, y1 - 7 * uy - 3.5 * ux); ctx.closePath(); ctx.fill(); }
      const a = (22.5 * j + 11.25) * deg;
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(j + 1), cx + R * 1.32 * Math.cos(a), cy - R * 1.32 * Math.sin(a) + 4);
    });
    // top right beside the caption on wide canvases, above the legend on narrow ones
    const narrow = w < 560;
    ctx.textAlign = narrow ? 'left' : 'right'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(`Rf ${f.Rf.toFixed(0)}   Rg ${f.Rg.toFixed(0)}`, narrow ? 10 : w - 10, narrow ? hh - 26 : 20);
    ctx.textAlign = 'left';
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(t('dashed circle: reference · white: test light'), 10, hh - 8);
  }

  function drawShifts(ctx, w, hh) {
    if (!F) return;
    const cs = F.f.hue.map((b) => b.Rcs), m = Math.max(20, Math.ceil(Math.max(...cs.map(Math.abs)) / 10) * 10);
    const P = plot(ctx, w, hh, { title: 'Chroma shift by hue bin, Rcs,h', x: { min: 0.5, max: 16.5, step: 1, label: 'hue bin', fmt: (v) => String(v) }, y: { min: -m, max: m, label: 'chroma shift (%)' }, series: [] });
    cs.forEach((v, j) => {
      const x = P.X(j + 1), bw = (P.X(2) - P.X(1)) * 0.72, y = P.Y(v), y0 = P.Y(0);
      ctx.fillStyle = css(F.binCol[j]); ctx.fillRect(x - bw / 2, Math.min(y, y0), bw, Math.abs(y0 - y));
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(x - bw / 2, Math.min(y, y0), bw, Math.abs(y0 - y));
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(P.X(0.5), P.Y(0)); ctx.lineTo(P.X(16.5), P.Y(0)); ctx.stroke();
  }

  // TLCI: Qa, the EBU's CCT and distance, and a chart coded 0–255 from the camera signal (sRGB rule [60])
  let TL = null;
  function updateTLCI(S) {
    const q = tlci(S.spd);
    TL = q;
    const coloured = q.patches.slice(0, 18), worst = coloured.reduce((b, p, i) => (p.used && (!coloured[b].used || p.dE > coloured[b].dE) ? i : b), 0);
    const refName = q.T < 3400 ? t('black body') : q.T > 5000 ? t('CIE daylight') : t('black body at 3400 K and daylight at 5000 K mixed, {p} % daylight', { p: ((100 * (q.T - 3400)) / 1600).toFixed(0) });
    tro.replaceChildren(readouts([
      ['Television lighting consistency index Qa', q.Qa === null ? '—' : q.Qa.toFixed(1)],
      ['Colour temperature (EBU method)', `${q.T.toFixed(0)} K (${q.locus === 'daylight' ? t('daylight locus') : t('Planckian locus')})`],
      ['Distance from the locus d', (q.d >= 0 ? '+' : '') + q.d.toFixed(2)],
      ['Reference for TLCI', refName],
      ['Mean colour error ΔE*a (4th-power mean)', Number.isFinite(q.dEa) ? q.dEa.toFixed(2) : '—'],
      ['Largest error', t('{v} on {name}', { v: coloured[worst].dE.toFixed(1), name: t(CHECKER_NAMES[worst]) })],
      ['Coloured patches used', t('{n} of 18', { n: q.n })],
    ]));
    if (q.Qa === null) tcalc.say(t('Every coloured patch clips in the camera under this light, so TLCI is undefined.'));
    else tcalc.say(q.Qa >= 50
      ? t('A standard television camera sees this light at <strong>TLCI {Q}</strong>: colours are off by ΔE {dE} on average, small enough for a colourist to correct (50 is the watershed).', { Q: q.Qa.toFixed(0), dE: q.dEa.toFixed(1) })
      : t('A standard television camera sees this light at <strong>TLCI {Q}</strong>: colours are off by ΔE {dE} on average, beyond what a colourist can easily correct (50 is the watershed).', { Q: q.Qa.toFixed(0), dE: q.dEa.toFixed(1) }));
    tcalc.set(String.raw`\begin{aligned}
    \Delta E^*_a &= \Big(\tfrac{1}{${q.n}}\textstyle\sum_i \Delta E_{00,i}^4\Big)^{1/4} = ${Number.isFinite(q.dEa) ? texNum(q.dEa, 3) : '\\text{—}'}\\
    Q_a &= \frac{100}{1 + (\Delta E^*_a/3.16)^{2.4}} = ${q.Qa === null ? '\\text{—}' : texNum(q.Qa, 3)}
    \end{aligned}`);
  }

  function drawChecker(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!TL) return;
    const code = (V) => `rgb(${V.map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`;
    const narrow = w < 560, top = 30, bottom = narrow ? 36 : 22, gap = Math.max(4, w * 0.012), cw = (w - 2 * gap - 5 * gap) / 6, ch = Math.min(cw, (hh - top - bottom - 3 * gap) / 4);
    const x0 = (w - 6 * cw - 5 * gap) / 2;
    ctx.font = `${Math.max(9.5, Math.min(12, cw / 8))}px "JetBrains Mono", monospace`; ctx.textAlign = 'center';
    TL.patches.forEach((p, i) => {
      const x = x0 + (i % 6) * (cw + gap), y = top + Math.floor(i / 6) * (ch + gap);
      ctx.fillStyle = code(p.ref); ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = code(p.test); ctx.fillRect(x + cw * 0.3, y + ch * 0.22, cw * 0.4, ch * 0.4);
      if (i < 18) {
        const light = p.ref[1] > 0.55;
        ctx.fillStyle = light ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
        ctx.fillText(p.used ? `ΔE ${p.dE.toFixed(1)}` : t('clipped'), x + cw / 2, y + ch - 6);
        if (p.used && p.dE >= 3.16) { ctx.strokeStyle = '#ff6a6a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
      }
    });
    // the score at the top right beside the caption; the key on one line, or two on narrow canvases
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(TL.Qa === null ? 'TLCI —' : `TLCI ${TL.Qa.toFixed(0)}`, w - 10, 20);
    ctx.textAlign = 'left'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const k1 = t('coded 0–255 from the camera signal'), k2 = t('red frame: ΔE ≥ 3.16 · grey row not scored');
    if (narrow) { ctx.fillText(k1, x0, hh - 21); ctx.fillText(k2, x0, hh - 7); } else ctx.fillText(`${k1} · ${k2}`, x0, hh - 7);
  }

  // ── camera colour: sensitivities, white balance and the colour matrix ──
  const SCENES = { D65: 'CIE D65 daylight', A: 'CIE A (tungsten)', FL11: 'CIE FL11 (tri-band fluorescent)', 'LED-B3': 'CIE LED-B3 (phosphor white)', 'LED-RGB1': 'CIE LED-RGB1 (RGB mix)', HP1: 'CIE HP1 (sodium)' };
  const spdOf = (k) => (k === 'D65' ? daylight(6504) : ILLUMINANTS[k].spd);
  const PATCHES = [...TCS.map((r, i) => ({ name: `TCS${String(i + 1).padStart(2, '0')} ${TCS_NAMES[i]}`, r })), ...EXTRA_PATCHES];
  const sec2 = h('section.block', {}, h('h2', {}, 'Camera colour: spectral sensitivities, white balance and the colour matrix'));
  const cctl = controls({
    cam: { type: 'select', label: 'Sensor', value: 'cmos', options: Object.entries(CAMERAS).map(([k, c]) => [k, c.name]) },
    ill: { type: 'select', label: 'Scene illuminant', value: 'A', options: Object.entries(SCENES) },
    wb: { type: 'seg', label: 'White balance', value: 'auto', options: [['auto', 'Auto (grey card)'], ['day', 'Daylight preset'], ['tung', 'Tungsten preset']] },
    mat: { type: 'seg', label: 'Colour matrix fitted under', value: 'scene', options: [['scene', 'This illuminant'], ['d65', 'Daylight only']] },
  }, () => updateCam());
  const cro = h('div');
  const ccalc = liveCalc();
  const sensView = stage({ aspect: 2.2, label: '', draw: drawSens, cls: 'plain', minH: 200 });
  const chart = h('div.card', { style: { padding: '12px' } });
  sec2.append(lab([h('div.card', { style: { padding: '6px' } }, sensView.el), chart], [h('div.card', {}, cctl.el), h('div.card', {}, cro), ccalc.el]));
  root.append(sec2);
  let K = null;
  function updateCam() {
    const st = cctl.state, sens = CAMERAS[st.cam].sens, spd = spdOf(st.ill);
    const gains = st.wb === 'auto' ? undefined : wbGains(st.wb === 'day' ? daylight(6504) : ILLUMINANTS.A.spd, sens);
    const matrix = st.mat === 'd65' ? cameraColour({ sens, spd: daylight(6504), patches: PATCHES.map((p) => p.r) }).M : undefined;
    const r = cameraColour({ sens, spd, gains, matrix, patches: PATCHES.map((p) => p.r) });
    K = { st, sens, r, luther: lutherResidual(sens) };
    cro.replaceChildren(readouts([
      ['White-balance gains R, G, B', r.gains.map((g) => g.toFixed(2)).join(', ')],
      ['Mean colour error ΔE₀₀', r.mean.toFixed(2)],
      ['Worst patch ΔE₀₀', `${r.max.toFixed(1)} (${PATCHES[r.dE.indexOf(r.max)].name.replace(/^TCS\d+ /, '')})`],
      ['Luther–Ives residual', (100 * K.luther).toFixed(1) + ' %'],
    ]));
    const M = r.M, f = (v) => texNum(v / 100, 3);
    ccalc.set(String.raw`\begin{aligned}
    \mathbf{XYZ} &= \mathbf M\,\mathrm{diag}(g_R, g_G, g_B)\,\mathbf{RGB}_\text{raw}\\
    \mathbf M &= \begin{pmatrix}${f(M[0][0])}&${f(M[0][1])}&${f(M[0][2])}\\ ${f(M[1][0])}&${f(M[1][1])}&${f(M[1][2])}\\ ${f(M[2][0])}&${f(M[2][1])}&${f(M[2][2])}\end{pmatrix}\\
    \overline{\Delta E_{00}} &= ${texNum(r.mean, 3)}
    \end{aligned}`);
    chart.replaceChildren(
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--fg-dim)', marginBottom: '6px' } }, h('span', {}, 'Left: what an observer adapted to the scene sees · right: the camera after white balance and matrix'), h('span', {}, 'ΔE₀₀ per patch')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' } }, ...PATCHES.map((p, i) => h('div', { title: `${p.name}: ΔE00 = ${r.dE[i].toFixed(2)}`, style: { borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' } },
        h('div', { style: { display: 'flex', height: '40px' } }, h('div', { style: { flex: 1, background: css(xyzToSRGB(r.truth[i])) } }), h('div', { style: { flex: 1, background: css(xyzToSRGB(r.cam[i])) } })),
        h('div', { style: { fontSize: '10.5px', padding: '3px 4px', fontFamily: '"JetBrains Mono", monospace', color: r.dE[i] > 5 ? 'var(--warn)' : 'var(--fg-dim)' } }, r.dE[i].toFixed(1))))),
    );
    sensView.redraw();
  }
  function drawSens(ctx, w, hh) {
    if (!K) return;
    const mx = Math.max(...K.sens.flat()), cm = Math.max(...CMF.flat());
    plot(ctx, w, hh, {
      title: t('Spectral sensitivities: {c}', { c: CAMERAS[K.st.cam].name }), x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: 0, max: 1.1, label: 'relative sensitivity' },
      series: [
        ...['x̄', 'ȳ', 'z̄'].map((n, c) => ({ data: LAMBDA.map((l, i) => [l, CMF[c][i] / cm]), color: 'rgba(255,255,255,0.35)', width: 1, dash: [4, 3], label: c === 0 ? 'CIE x̄ ȳ z̄ (eye)' : undefined })),
        ...K.sens.map((s, c) => ({ data: LAMBDA.map((l, i) => [l, s[i] / mx]), color: ['#ff6b6b', '#6be3a4', '#6ad7ff'][c], width: 2.2, label: ['R', 'G', 'B'][c] })),
      ],
      legend: true,
    });
  }

  // ── metamerism ──
  const sec3 = h('section.block', {}, h('h2', {}, 'Metamerism: same colour, different spectra'));
  const mctl = controls({
    base: { type: 'select', label: 'Original sample', value: '12', options: PATCHES.map((p, i) => [String(i), p.name]) },
    strength: { type: 'range', label: 'Metameric black added', min: 0, max: 1, step: 0.01, value: 1, fmt: (v) => (v * 100).toFixed(0) + ' %' },
    other: { type: 'select', label: 'Compare under', value: 'FL11', options: Object.entries(SCENES).filter(([k]) => k !== 'D65') },
  }, () => updateMeta());
  const mro = h('div');
  const mspec = stage({ aspect: 2.2, label: '', draw: drawMeta, cls: 'plain', minH: 200 });
  const mpair = h('div.card', { style: { padding: '12px' } });
  sec3.append(lab([h('div.card', { style: { padding: '6px' } }, mspec.el), mpair], [h('div.card', {}, mctl.el), h('div.card', {}, mro)]));
  root.append(sec3);
  let MM = null;
  const observed = (r, spd) => { const W = xyz(spd), k = 100 / W[1]; return adapt(xyz(spd.map((s, i) => s * r[i])).map((q) => q * k), W.map((q) => q * k), D65_XYZ); };
  function updateMeta() {
    const st = mctl.state, r1 = PATCHES[+st.base].r, D65 = daylight(6504), r2 = metamer(r1, D65, st.strength), other = spdOf(st.other);
    const sens = CAMERAS.cmos.sens;
    const camOf = (spd) => { const c = cameraColour({ sens, spd, patches: [...PATCHES.map((p) => p.r), r1, r2] }); const n = c.cam.length; return [c.cam[n - 2], c.cam[n - 1]]; };
    const pairs = [
      ['Eye, daylight D65', observed(r1, D65), observed(r2, D65)],
      ['Eye, ' + SCENES[st.other], observed(r1, other), observed(r2, other)],
      ['Camera (CMOS model), D65', ...camOf(D65)],
      ['Camera, ' + SCENES[st.other], ...camOf(other)],
    ].map(([n, a, b]) => ({ n, a, b, dE: deltaE00(cielab(a), cielab(b)) }));
    MM = { r1, r2 };
    mro.replaceChildren(readouts(pairs.map((p) => [p.n, 'ΔE₀₀ ' + p.dE.toFixed(2)])));
    mpair.replaceChildren(
      h('div', { style: { fontSize: '12px', color: 'var(--fg-dim)', marginBottom: '6px' } }, 'Each pair: original (left) and its metamer (right). They are built to match exactly for the CIE observer in daylight.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' } }, ...pairs.map((p) => h('div', {},
        h('div', { style: { display: 'flex', height: '56px', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' } }, h('div', { style: { flex: 1, background: css(xyzToSRGB(p.a)) } }), h('div', { style: { flex: 1, background: css(xyzToSRGB(p.b)) } })),
        h('div', { style: { fontSize: '11px', marginTop: '4px', color: 'var(--fg-dim)' } }, p.n),
        h('div', { style: { fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: p.dE > 2 ? 'var(--warn)' : 'var(--fg-dim)' } }, 'ΔE₀₀ ' + p.dE.toFixed(2))))),
    );
    mspec.redraw();
  }
  function drawMeta(ctx, w, hh) {
    if (!MM) return;
    plot(ctx, w, hh, {
      title: 'Reflectance spectra', x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: 0, max: 1, label: 'reflectance' },
      series: [{ data: LAMBDA.map((l, i) => [l, MM.r1[i]]), color: '#ffffff', width: 2, label: 'original' }, { data: LAMBDA.map((l, i) => [l, MM.r2[i]]), color: '#ffb547', width: 2, label: 'metamer' }],
      legend: true,
    });
  }

  updateCam();
  updateMeta();
  update();

  root.append(rule(String.raw`\[X = \int S(\lambda)\,R(\lambda)\,\bar x(\lambda)\,d\lambda\quad\text{(likewise } Y, Z)\]
<p>Three colour-matching functions \(\bar x, \bar y, \bar z\), which stand in for the eye's three kinds of cone, are each multiplied by the light's spectrum \(S\) and the surface's reflectance \(R\), wavelength by wavelength, and summed. Two different spectra that give the same three sums look identical: that is metamerism. A colour rendering index of 100 means test colours look as they do under a reference light of the same colour temperature; good LED lamps reach 90–98, cheap ones 70–80.</p>`,
    String.raw`The colour-matching functions describe an average observer under standard viewing; real people differ, especially with narrow-band LEDs. The CRI averages only eight pastel colours, so a lamp can score well and still render saturated reds poorly, which is why R9 is listed too, and why the fidelity index Rf of CIE 2017 judges 99 samples instead.`));
  root.append(theory('Spectra, colour temperature and colour rendering', String.raw`
<div class="theory-cols"><div>
<h3>From spectrum to colour</h3>
<p>The eye has three cone types, so every spectrum maps to three numbers. The CIE 1931 standard observer expresses them as tristimulus values</p>
\[X = \int S(\lambda)R(\lambda)\bar x(\lambda)\,d\lambda,\quad Y = \int S R\,\bar y\,d\lambda,\quad Z = \int S R\,\bar z\,d\lambda,\]
<p>for a source \(S\) and a surface reflectance \(R\). Here the integrals are sums over the tabulated CIE data at 5 nm from 380 to 780 nm. Very different spectra can share the same \((X, Y, Z)\). Such <em>metamers</em> are why a white LED can look like daylight while rendering objects quite differently.</p>
<h3>Correlated colour temperature</h3>
<p>A black body at temperature \(T\) emits Planck's spectrum \(M(\lambda,T) \propto \lambda^{-5}/(e^{c_2/\lambda T}-1)\). Its chromaticities trace the Planckian locus. The correlated colour temperature of any white source is the temperature of the nearest point on that locus in the CIE 1960 \((u, v)\) diagram. \(D_{uv}\) is the distance from it, positive towards green and negative towards magenta. Above 4000 K the CIE also defines daylight spectra from three basis functions \(S_0 + M_1S_1 + M_2S_2\) (Judd, MacAdam &amp; Wyszecki 1964).</p>
</div><div>
<h3>The colour rendering index</h3>
<p>CIE 13.3 compares how 14 test colour samples look under the source and under a reference of the same CCT: a black body below 5000 K, daylight above. After a von Kries-type adaptation in \((u, v)\), the colour difference in the 1964 \(U^*V^*W^*\) space gives</p>
\[R_i = 100 - 4.6\,\Delta E_i,\qquad R_a = \frac18\sum_{i=1}^{8}R_i .\]
<p>Ra averages only eight pastel samples, so a lamp can score in the 80s while rendering saturated red (R9) or skin (R13) poorly. That is the classic weakness of blue-pumped phosphor LEDs, which lack deep red. Film and video lighting is therefore specified with R9, with the TM-30 fidelity and gamut indices, or with the camera-based TLCI (EBU Tech 3355), which replaces the eye with a model camera. This page computes CRI exactly as published. It reproduces the CIE's own values for the FL series: FL2 64, FL7 90 and FL11 83.</p>
<p>The swatches show each sample as an observer adapted to the lamp would see it, transformed to the sRGB display by a Bradford adaptation. Differences between the two halves are what the indices measure.</p>
<h3>The colour solid</h3>
<p>No surface reflects more than all the light falling on it, so a light source bounds the colours that objects can have under it. For each chromaticity, the brightest possible surface reflects everything in one band of wavelengths and nothing outside it, or nothing in one band for the purples (Schrödinger 1920). These <em>optimal colours</em> enclose every real surface colour; their outline at each lightness is called the MacAdam limit (MacAdam 1935). The 3-D view draws them in CIE xyY: chromaticity \((x, y)\) on the floor, luminance factor \(Y\) upwards, the perfect white reflector at \(Y = 100\) on top. Each band is built from the 5 nm samples, so the surface is a polyhedron of 81 bands around. Colours are shown as an observer adapted to the source sees them (Bradford to D65). Bradford is linear in XYZ, so under a strongly coloured source the solid's lower edge can stray slightly past the spectral locus drawn on the floor, which belongs to the unadapted observer.</p>
<p>A display's gamut is the image of its RGB cube: the triangle of its primaries on the floor, with walls above each side and a roof at the brightest mixtures. Its share of all chromaticities is the triangle's area over the area inside the spectral locus in \((x, y)\). That diagram is not perceptually uniform, so the shares overstate wide gamuts compared with \((u', v')\). A colour can be unreachable even when its chromaticity lies inside the triangle, because it is too bright for that hue. A narrow-band source such as the high-pressure sodium lamp shrinks the solid towards a thin sliver: almost nothing can look saturated under it.</p>
</div></div>`));
  root.append(theory('Fidelity and gamut: CIE 2017 and ANSI/IES TM-30', String.raw`
<div class="theory-cols"><div>
<h3>99 samples in a uniform colour space</h3>
<p>CIE 224:2017 replaces the colour rendering index's eight pastel samples with 99 <em>colour evaluation samples</em>: measured reflectances of natural objects, skin, textiles, paints, plastics and inks, chosen from more than 100 000 so that they cover colour space evenly in hue and chroma and have no wavelength they are especially sensitive to (David et al. 2015). The same samples underlie ANSI/IES TM-30. Each is rendered under the test light and under a reference of the same correlated colour temperature, using the CIE 1964 10° observer (normalised so that the light's white has \(Y = 100\)), and compared in CAM02-UCS, a uniform space built on the CIECAM02 colour appearance model. The model runs with the illuminant fully discounted (\(D = 1\)), an adapting luminance \(L_A = 100\ \text{cd/m}^2\), background \(Y_b = 20\) and an average surround. From lightness \(J\), colourfulness \(M\) and hue angle \(h\),</p>
\[J' = \frac{1.7\,J}{1 + 0.007\,J},\qquad M' = \frac{\ln(1 + 0.0228\,M)}{0.0228},\]
\[(a', b') = M'(\cos h, \sin h).\]
<p>The fidelity of sample \(i\) follows from its colour difference \(\Delta E_i\), and the general index from the mean difference,</p>
\[R_{f} = 10\ln\!\big(e^{(100 - c_f\overline{\Delta E})/10} + 1\big),\qquad c_f = 6.73,\]
<p>which is \(100 - c_f\overline{\Delta E}\) for good lights and approaches zero, never negative, for bad ones. (TM-30-15 used \(c_f = 7.54\); TM-30-18 and later adopted the CIE value.) The reference is Planckian below 4000 K, CIE daylight above 5000 K and between them a mixture whose daylight share rises linearly with temperature, each part normalised to the same luminance. This removes the jump of the colour rendering index, whose reference switches abruptly at 5000 K.</p>
</div><div>
<h3>Gamut, and which way colours move</h3>
<p>Fidelity cannot say <em>how</em> colours change. TM-30 sorts the samples into 16 bins of hue angle (22.5° each, by their hue under the reference) and averages \((a', b')\) in each bin under both lights. The gamut index is the ratio of the areas of the two 16-sided polygons,</p>
\[R_g = 100\,\frac{A_\text{test}}{A_\text{ref}},\]
<p>above 100 when colours look on average more saturated than under the reference, below when duller. For bin \(j\), with the bin's centre direction \(\hat{\mathbf u}_j\) and reference average \(\bar{\mathbf a}'_{\text{ref},j}\), the chroma shift is \(R_{cs,hj} = 100\,(\bar{\mathbf a}'_{\text{test},j} - \bar{\mathbf a}'_{\text{ref},j})\cdot\hat{\mathbf u}_j/\lvert\bar{\mathbf a}'_{\text{ref},j}\rvert\) and the hue shift is the same with the perpendicular direction. The colour vector graphic puts each bin's reference on a unit circle at the bin's mean reference hue and moves it by the bin's shift divided by the reference average's length: a shape stretched towards red and green oversaturates them, a dent desaturates.</p>
<p>The two numbers trade off: a light can raise Rg only by moving colours away from the reference, which lowers Rf. Studies of preference found that many viewers like a modest increase in red saturation (positive \(R_{cs,h1}\)) at slightly lower fidelity, so TM-30's informative Annex E recommends combinations of fidelity, gamut and red chroma shift for different design intents rather than one number (Royer 2022).</p>
<h3>This implementation</h3>
<p>Everything is computed on the 5 nm grid from 380 to 780 nm, which CIE 224 allows. The correlated colour temperature is found as the nearest point of the Planckian locus by direct search rather than by Ohno's method; the two agree to within about 0.5 K for the lamps checked. The page reproduces reference values computed with the official CIE and IES spreadsheets (as quoted by the colour-science project): Rf = 70.1 and Rg = 86 for CIE FL2, Rf = 80.6 for FL1, and all 99 sample scores and 16 bin values of FL2 within the precision those values are quoted to.</p>
</div></div>`));
  root.append(theory('Through a television camera: TLCI-2012', String.raw`
<div class="theory-cols"><div>
<h3>Why a camera index</h3>
<p>Ra, Rf and Rg ask how colours look to a human observer. In television the observer is a camera, whose sensitivities are not the eye's, followed by a colourist who can correct a uniform cast but not colours that move in different directions. The <em>Television Lighting Consistency Index</em> of the EBU (Tech 3355, first issued 2012, from work at the BBC by Sproson and Taylor from 1971) therefore replaces the eye with a standard broadcast camera and display, and scores how differently 18 coloured ColorChecker patches come out under the test light and under a reference of the same colour temperature.</p>
<h3>The notional camera and display</h3>
<p>Spectra are summed from 380 to 760 nm in 5 nm steps. The camera's responsivities \(\bar r, \bar g, \bar b\) are averages of measured modern broadcast cameras (EBU Tech 3353). For each light the signals are balanced so that a 90 % neutral gives \(R = G = B = 1\), the white patch then reaching peak white. A 3×3 matrix with rows summing to 1 (\(R_M = 1.182R_C - 0.209G_C + 0.027B_C\), …) is followed by a saturation of 90 %, the BT.709 opto-electronic curve</p>
\[V = \begin{cases} 4.5\,L, & L < 0.018,\\ 1.099\,L^{0.45} - 0.099, & L \ge 0.018,\end{cases}\]
<p>and a display with gamma 2.4 and BT.709 primaries, whose light is converted to CIELAB relative to the display's D65 white. The chart on this page shows the camera signal \(V\) coded 0–255, as the document prescribes for computer screens: each patch under the reference light, with the test light inset.</p>
</div><div>
<h3>From colour errors to Qa</h3>
<p>Each patch's difference is the standard CIEDE2000 (Sharma, Wu &amp; Dalal 2005) with unit weights. The document's printing has small slips (the hue difference in its [53], a hue wrap of 180° for 360°), and its [48] writes the plain rather than the adjusted mean chroma; following that literally changes Qa by less than 0.05 for every light on this page. To keep the worst colours from being diluted by the good ones, the errors are combined as a fourth-power mean, and mapped to</p>
\[\Delta E^*_a = \Big(\frac1n\sum_{i=1}^{n}\Delta E_i^{4}\Big)^{1/4},\]
\[Q_a = \frac{100}{1 + (\Delta E^*_a/3.16)^{2.4}} .\]
<p>The constant 3.16 is the error a daylight fluorescent tube produced, which professional colourists judged the limit of what can be corrected acceptably: Qa = 50 is the watershed, and the scale cannot go negative. A patch whose camera or display signal falls below zero would clip in a real camera, so it is left out (the page reports how many were used). The grey row is shown but not scored.</p>
<h3>Reference light and colour temperature</h3>
<p>The colour temperature is found by the document's own method: the foot of the normal from the light's chromaticity to the tabulated Planckian locus in CIE 1960 \((u, v)\), or, above 5000 K, to the tabulated daylight locus. Its tables use Planck's law with \(c_2 = 1.435\times10^{-2}\) m K, so illuminant A reads 2848 K here instead of 2856 K. The reference is Planckian below 3400 K, CIE daylight above 5000 K, and between them a linear mixture of the Planckian at 3400 K and daylight at 5000 K. The distance \(d\) from that locus is in units of 0.0054 (about one just-noticeable difference), negative towards green; values beyond 1 make the colour temperature, and so the comparison, less meaningful. The document's adjustment of \(d\) between 4000 and 5000 K is left out, because as printed it moves a black body off its own locus; \(d\) does not enter Qa.</p>
<p>All tables are transcribed from Tech 3355 and checked against its printed sums. The page reproduces a Sekonic C-7000 meter's TLCI of 99 for a measured 12 000 K light, and for CIE FL1 gives D6426, \(d = -0.71\) and Qa 47, close to the document's example for a daylight tube (D6434, \(-0.7\), 50), which may not be the same spectrum. Not implemented: the colourist's advice table and the Television Luminaire Matching Factor (TLMF-2013) for mixed lights.</p>
</div></div>`));
  root.append(theory('How a camera sees colour', String.raw`
<div class="theory-cols"><div>
<h3>Spectral sensitivities and the Luther–Ives condition</h3>
<p>A camera pixel integrates \(\int S(\lambda)R(\lambda)s_c(\lambda)\,d\lambda\) with its own sensitivity \(s_c\), not the eye's \(\bar x, \bar y, \bar z\). A camera is colorimetric (it matches the eye for <em>every</em> spectrum) only if its sensitivities are a linear combination of the colour-matching functions: the <em>Luther–Ives condition</em>. No real colour filter array satisfies it. The residual here is the fraction of the CMFs that no combination of the camera's curves can reproduce. Narrow filters give saturated colours but large errors. Broad, overlapping filters collect more light but need a strong matrix, which amplifies noise.</p>
<h3>White balance and the colour matrix</h3>
<p>Raw RGB is first scaled by diagonal <em>white-balance</em> gains that make a grey card neutral, a von Kries adaptation in camera space. A 3×3 matrix then maps the balanced RGB to XYZ. It is fitted here by least squares over 24 reflectances, under the constraint that white maps exactly to white:</p>
\[\min_{\mathbf M}\sum_k\lVert\mathbf M\,\mathbf c_k - \mathbf t_k\rVert^2\quad\text{s.t.}\quad\mathbf M\,\mathbf c_\text{white} = \mathbf t_\text{white},\]
<p>with targets \(\mathbf t_k\) the colours an observer adapted to the scene would see (Bradford to D65). Errors are CIEDE2000. A matrix fitted under daylight and reused under tungsten, which is what a single camera profile does, degrades even for the ideal Luther camera, because diagonal scaling in camera space is not the eye's adaptation. Raw converters therefore interpolate between two matrices calibrated under A and D65.</p>
</div><div>
<h3>Metamerism</h3>
<p>Adding to a reflectance any spectrum \(b(\lambda)\) orthogonal to \(S\bar x\), \(S\bar y\) and \(S\bar z\) (a <em>metameric black</em>) leaves its tristimulus values unchanged under \(S\). The page builds one by projecting a smooth wave out of those three directions, then adds as much as keeps the reflectance between 0.01 and 0.99. The pair matches exactly in daylight for the CIE observer. It separates under another lamp (<em>illuminant metamerism</em>) and for a camera whose sensitivities differ from the eye's (<em>observer</em> or <em>camera metamerism</em>). This is why a costume can match on set and clash on screen, and why the colour of a car's bumper and its painted body are checked under several lights.</p>
<p>The camera models are representative Gaussian filter shapes with an IR-cut filter, not measurements of a specific product. The extra patches are smooth synthetic reflectances.</p>
</div></div>`));
  root.append(references([
    'CIE 13.3-1995, <em>Method of measuring and specifying colour rendering properties of light sources</em>; CIE 15:2018, <em>Colorimetry</em>, 4th ed. (CIE, Vienna). Tables via the colour-science project (BSD-3-Clause).',
    'G. Wyszecki &amp; W. S. Stiles, <em>Color Science</em>, 2nd ed., Wiley (1982): CCT, daylight basis functions, U*V*W*.',
    'D. B. Judd, D. L. MacAdam &amp; G. Wyszecki, “Spectral distribution of typical daylight as a function of correlated color temperature”, <em>J. Opt. Soc. Am.</em> 54, 1031 (1964).',
    'R. Luther, “Aus dem Gebiet der Farbreizmetrik”, <em>Z. Tech. Phys.</em> 8, 540 (1927); H. E. Ives, “The transformation of color-mixture equations from one system to another”, <em>J. Franklin Inst.</em> 180, 673 (1915).',
    'G. D. Finlayson &amp; M. S. Drew, “Constrained least-squares regression in color spaces”, <em>J. Electron. Imaging</em> 6, 484 (1997): white-point-preserving colour correction.',
    'G. Sharma, W. Wu &amp; E. N. Dalal, “The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations”, <em>Color Res. Appl.</em> 30, 21 (2005).',
    'E. Schrödinger, “Theorie der Pigmente von größter Leuchtkraft”, <em>Ann. Phys.</em> 62, 603 (1920); D. L. MacAdam, “Maximum visual efficiency of colored materials”, <em>J. Opt. Soc. Am.</em> 25, 249 (1935): optimal colours.',
    'IEC 61966-2-1:1999, <em>Default RGB colour space: sRGB</em>; ITU-R BT.2020-2, <em>Parameter values for ultra-high definition television systems</em> (2015); SMPTE EG 432-1:2010 (P3 primaries).',
    'CIE 224:2017, <em>CIE 2017 colour fidelity index for accurate scientific use</em> (CIE, Vienna); CIE 159:2004, <em>A colour appearance model for colour management systems: CIECAM02</em>. The 99 sample reflectances and the 10° observer via the colour-science project (BSD-3-Clause).',
    'M. R. Luo, G. Cui &amp; C. Li, “Uniform colour spaces based on CIECAM02 colour appearance model”, <em>Color Res. Appl.</em> 31, 320 (2006): CAM02-UCS.',
    'A. David, P. T. Fini, K. W. Houser, Y. Ohno, M. P. Royer, K. A. G. Smet, M. Wei &amp; L. Whitehead, “Development of the IES method for evaluating the color rendition of light sources”, <em>Opt. Express</em> 23, 15888 (2015).',
    'M. P. Royer, “Tutorial: background and guidance for using the ANSI/IES TM-30 method for evaluating light source color rendition”, <em>LEUKOS</em> 18, 191 (2022).',
    'EBU Tech 3353, <em>Development of a “standard” television camera model implemented in the TLCI-2012</em> (2012); E. W. Taylor, <em>The assessment of the colorimetric properties of light sources for use in television scene lighting</em>, BBC Research Department Report 1988/2 (the ColorChecker reflectances); A. Roberts, J. Emmett &amp; P. Böhler, “A Television Lighting Consistency Index”, <em>Proc. IBC</em> (2011).',
    'ANSI/IES TM-30-20, <em>Method for evaluating light source color rendition</em> (current edition TM-30-24); EBU Tech 3355, <em>Method for the assessment of the colorimetric properties of luminaires: the Television Lighting Consistency Index (TLCI-2012)</em>.',
  ]));

  return () => [spdView, bars, diagram, cvg, shifts, checker, solid3, sensView, mspec].forEach((s) => s.destroy());
}
