import { h, controls, stage, readouts, texNum, imageCanvas } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { oetf, wavelengthCSS } from '../lib/color.js';
import { ILLUMINANTS, TCS, CMF } from '../lib/colordata.js';
import { view3d } from '../lib/gl3d.js';
import { colourSolidScene, gamutCoverage, samplesOutside } from '../lib/colour3d.js';
import { LAMBDA, xyz, chromaticity, uv1960, blackbody, daylight, cri, sampleSRGB, planck, CAMERAS, EXTRA_PATCHES, cameraColour, wbGains, lutherResidual, metamer, xyzToSRGB, lab as cielab, adapt, deltaE00, D65_XYZ } from '../lib/colorsci.js';
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
    ro.replaceChildren(readouts([
      ['Correlated colour temperature', r.cct.toFixed(0) + ' K'],
      ['Distance from the Planckian locus Duv', (r.duv >= 0 ? '+' : '') + r.duv.toFixed(4)],
      ['Chromaticity x, y', `${xy[0].toFixed(4)}, ${xy[1].toFixed(4)}`],
      ['Reference illuminant', r.cct < 5000 ? 'black body' : 'CIE daylight'],
      ['General CRI Ra (R1–R8)', r.Ra.toFixed(1)],
      ['Saturated red R9', r.R[8].toFixed(1)],
      ['Skin tone R13', r.R[12].toFixed(1)],
      ['Luminous efficacy of radiation', ler.toFixed(0) + ' lm/W'],
      ['Display gamut, share of all chromaticities', (100 * gamutCoverage(st.gamut)).toFixed(1) + ' %'],
      ['Test colours the display cannot show', `${samplesOutside(S.spd, st.gamut)} of 14`],
    ]));
    calc.say(`This light has a colour temperature of <strong>${r.cct.toFixed(0)} K</strong> and a colour rendering index of <strong>${r.Ra.toFixed(0)}</strong> (100 means colours look as under the reference light)` + (r.R[8] < 50 ? `; saturated red scores only ${r.R[8].toFixed(0)}, so reds look dull.` : '.'));
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
    [spdView, bars, diagram].forEach((x) => x.redraw());
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
      legend: true, legendX: w - 200, legendY: 34,
    });
    // rainbow fill under the test spectrum
    ctx.save();
    for (let i = 0; i < LAMBDA.length - 1; i++) {
      const x0 = P.X(LAMBDA[i]), x1 = P.X(LAMBDA[i + 1]);
      ctx.fillStyle = wavelengthCSS(LAMBDA[i] + 2.5, 0.55);
      ctx.beginPath(); ctx.moveTo(x0, P.Y(0)); ctx.lineTo(x0, P.Y(t[i])); ctx.lineTo(x1, P.Y(t[i + 1])); ctx.lineTo(x1, P.Y(0)); ctx.fill();
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
      legend: true, legendX: w - 190, legendY: 34,
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
      legend: true, legendX: w - 160, legendY: 34,
    });
  }

  updateCam();
  updateMeta();
  update();

  root.append(rule(String.raw`\[X = \int S(\lambda)\,R(\lambda)\,\bar x(\lambda)\,d\lambda\quad\text{(likewise } Y, Z)\]
<p>Three colour-matching functions \(\bar x, \bar y, \bar z\), which stand in for the eye's three kinds of cone, are each multiplied by the light's spectrum \(S\) and the surface's reflectance \(R\), wavelength by wavelength, and summed. Two different spectra that give the same three sums look identical: that is metamerism. A colour rendering index of 100 means test colours look as they do under a reference light of the same colour temperature; good LED lamps reach 90–98, cheap ones 70–80.</p>`,
    String.raw`The colour-matching functions describe an average observer under standard viewing; real people differ, especially with narrow-band LEDs. The CRI averages only eight pastel colours, so a lamp can score well and still render saturated reds poorly, which is why R9 is listed too.`));
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
    'ANSI/IES TM-30-20, <em>Method for evaluating light source color rendition</em>; EBU Tech 3355, <em>Method for the assessment of the colorimetric properties of luminaires: the Television Lighting Consistency Index (TLCI-2012)</em>.',
  ]));

  return () => [spdView, bars, diagram, solid3, sensView, mspec].forEach((s) => s.destroy());
}
