import { h, controls, stage, readouts, texNum, imageCanvas } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { oetf, wavelengthCSS } from '../lib/color.js';
import { ILLUMINANTS, TCS, CMF } from '../lib/colordata.js';
import { LAMBDA, xyz, chromaticity, uv1960, blackbody, daylight, cri, sampleSRGB, planck } from '../lib/colorsci.js';

const css = (rgb) => `rgb(${rgb.map((v) => Math.round(255 * oetf(Math.min(1, Math.max(0, v))))).join(',')})`;
const TCS_NAMES = ['Light greyish red', 'Dark greyish yellow', 'Strong yellow green', 'Moderate yellowish green', 'Light bluish green', 'Light blue', 'Light violet', 'Light reddish purple', 'Strong red (R9)', 'Strong yellow', 'Strong green', 'Strong blue', 'Light yellowish pink (skin)', 'Moderate olive green (leaf)'];

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'A colour is not a property of an object alone. It is the product of a light source\'s spectrum, a surface\'s reflectance and the spectral sensitivities of an eye or a camera. Two lamps of the same "colour temperature" can make the same skin look healthy or grey, and a camera can disagree with the eye about which colours match. This lab computes all of it from CIE tables, wavelength by wavelength.', domains: ['photo', 'video'] }));

  const ctl = controls({
    src: { type: 'select', label: 'Light source', value: 'LED-B3', options: [['bb', 'Black body (incandescent, candle)'], ['day', 'CIE daylight (D series)'], ...Object.entries(ILLUMINANTS).map(([k, v]) => [k, v.name])] },
    T: { type: 'range', label: 'Temperature', min: 1500, max: 12000, log: true, value: 3200, unit: 'K', when: (st) => st.src === 'bb' || st.src === 'day' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const spdView = stage({ aspect: 2.2, label: '', draw: drawSPD, cls: 'plain', minH: 220 });
  const swatches = h('div.card', { style: { padding: '12px' } });
  const bars = stage({ aspect: 1.45, label: '', draw: drawBars, cls: 'plain', minH: 260 });
  const diagram = stage({ aspect: 1.45, label: 'CIE 1960 (u, v) with the Planckian locus', draw: drawUV, minH: 260 });
  root.append(lab([h('div.card', { style: { padding: '6px' } }, spdView.el), swatches, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, bars.el), diagram.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

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
    ]));
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
  }

  function drawSPD(ctx, w, hh) {
    if (!C) return;
    const n = (s) => { const m = Math.max(...s); return s.map((v) => v / m); };
    const t = n(C.S.spd), rf = n(C.r.ref);
    const P = plot(ctx, w, hh, {
      title: `Spectral power distribution: ${C.S.name}`, x: { min: 380, max: 780, label: 'wavelength (nm)' }, y: { min: 0, max: 1.08, label: 'relative power' },
      series: [{ data: LAMBDA.map((l, i) => [l, rf[i]]), color: 'rgba(255,255,255,0.6)', width: 1.4, dash: [5, 3], label: `reference (${C.r.cct.toFixed(0)} K)` }, { data: LAMBDA.map((l, i) => [l, t[i]]), color: '#ffffff', width: 2, label: 'test source' }],
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
    const P = plot(ctx, w, hh, { title: `Special colour rendering indices (Ra = ${C.r.Ra.toFixed(1)})`, x: { min: 0.5, max: 14.5, step: 1, label: 'test colour sample', fmt: (v) => 'R' + v }, y: { min: Math.min(0, Math.floor(Math.min(...C.r.R) / 20) * 20), max: 100, label: 'Rᵢ' }, series: [] });
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
    ctx.textAlign = 'left'; ctx.fillText('dashed: Duv = ±0.01, ±0.02', X(u0) + 6, Y(v0) - 6);
  }

  update();

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
</div></div>`));
  root.append(references([
    'CIE 13.3-1995, <em>Method of measuring and specifying colour rendering properties of light sources</em>; CIE 15:2018, <em>Colorimetry</em>, 4th ed. (CIE, Vienna). Tables via the colour-science project (BSD-3-Clause).',
    'G. Wyszecki &amp; W. S. Stiles, <em>Color Science</em>, 2nd ed., Wiley (1982): CCT, daylight basis functions, U*V*W*.',
    'D. B. Judd, D. L. MacAdam &amp; G. Wyszecki, “Spectral distribution of typical daylight as a function of correlated color temperature”, <em>J. Opt. Soc. Am.</em> 54, 1031 (1964).',
    'G. Sharma, W. Wu &amp; E. N. Dalal, “The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations”, <em>Color Res. Appl.</em> 30, 21 (2005).',
    'ANSI/IES TM-30-20, <em>Method for evaluating light source color rendition</em>; EBU Tech 3355, <em>Method for the assessment of the colorimetric properties of luminaires: the Television Lighting Consistency Index (TLCI-2012)</em>.',
  ]));

  return () => [spdView, bars, diagram].forEach((s) => s.destroy());
}
