import { h, controls, stage, readouts, imageCanvas, texNum, fmt } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { wavelengthRGB } from '../lib/color.js';
import { index } from '../lib/glass.js';
import { SOURCES, diffractionAngle, wavelengthAt, blazeAngle, angularDispersion, gratingR, blazeEfficiency, dndl, prismDeviation, prismR, observe, intrinsic, slitR, combinedR, slitThroughput, sunAt, echellePosition, echelleOrders } from '../lib/spectro.js';
import { t } from '../lib/i18n.js';

const D2R = Math.PI / 180, L0 = 380, L1 = 760, APEX = 60 * D2R;
const GLASS = ['N-SF11', 'N-SF5', 'F2', 'N-BK7', 'Fused silica', 'CaF2'];

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>Pass sunlight through a prism and it fans out into a rainbow, a <strong>spectrum</strong>. Look closely and the rainbow is crossed by thousands of dark lines, each a fingerprint of an element absorbing light at its own exact colour. From these lines astronomers read what stars are made of, how hot they are and how fast they move.</p>
<p>A spectrograph spreads light with a prism or with a grating, a surface ruled with thousands of fine grooves. How finely it can tell two colours apart depends mostly on how many grooves the light covers: more grooves, finer detail.</p>`, [
    "Set the grating width to 1 mm and zoom in on 589 nm: the yellow sodium line looks single. At 5 mm it splits into two lines 0.6 nm apart.",
    "Switch to the 2nd <strong>diffraction order</strong>: the resolving power doubles, but orders start to overlap. Turn on the order-sorting filter.",
    "Switch to the <strong>Prism</strong> and compare how unevenly it spreads blue and red.",
  ]));

  const ctl = controls({
    disp: { type: 'seg', label: 'Disperser', value: 'grating', options: [['prism', 'Prism'], ['grating', 'Diffraction grating']] },
    src: { type: 'select', label: 'Light source', value: 'sun', options: Object.entries(SOURCES).map(([k, s]) => [k, s.name]) },
    glass: { type: 'select', label: 'Prism glass (60° apex)', value: 'N-SF11', options: GLASS, when: (st) => st.disp === 'prism' },
    base: { type: 'range', label: 'Prism base (filled by the beam)', min: 2, max: 150, log: true, value: 30, unit: 'mm', when: (st) => st.disp === 'prism' },
    rho: { type: 'range', label: 'Groove density', min: 50, max: 2400, log: true, value: 600, unit: 'lines/mm', when: (st) => st.disp === 'grating' },
    W: { type: 'range', label: 'Illuminated grating width', min: 0.5, max: 150, log: true, value: 2, unit: 'mm', when: (st) => st.disp === 'grating' },
    m: { type: 'seg', label: 'Diffraction order', value: '1', options: ['1', '2', '3', '4'], when: (st) => st.disp === 'grating' },
    lamB: { type: 'range', label: 'Blaze wavelength (first order)', min: 300, max: 1200, step: 5, value: 500, unit: 'nm', when: (st) => st.disp === 'grating' },
    filt: { type: 'toggle', label: 'Order-sorting filter', value: false, when: (st) => st.disp === 'grating' },
    zc: { type: 'range', label: 'Zoom centre', min: 385, max: 755, step: 0.05, value: 589.3, unit: 'nm' },
    zw: { type: 'range', label: 'Zoom width', min: 0.3, max: 60, log: true, value: 3, unit: 'nm' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const strip = stage({ aspect: 3.6, label: 'Detector: the spectrum spread across the camera (angle, not wavelength, is linear)', draw: drawStrip, minH: 150 });
  const zoom = stage({ aspect: 2.3, label: '', draw: drawZoom, cls: 'plain', minH: 220 });
  const aux = stage({ aspect: 2.3, label: '', draw: drawAux, cls: 'plain', minH: 220 });
  root.append(lab([strip.el, h('div.card', { style: { padding: '6px' } }, zoom.el), h('div.card', { style: { padding: '6px' } }, aux.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let M = null;
  // resolving power at λ for the current disperser
  const Rof = (st, lam) => (st.disp === 'prism' ? prismR(st.glass, lam, st.base) : gratingR(+st.m, st.rho, st.W));
  function update() {
    const st = ctl.state, m = +st.m, lc = st.zc, R = Rof(st, lc);
    const thB = blazeAngle(st.lamB, st.rho, 1), alpha = thB; // Littrow mounting at the first-order blaze
    M = { st, R, thB, alpha, img: null };
    const rows = [['Resolving power R at ' + lc.toFixed(1) + ' nm', R.toFixed(0)], ['Smallest resolvable δλ = λ/R', (lc / R < 0.1 ? (1000 * lc / R).toFixed(1) + ' pm' : (lc / R).toFixed(3) + ' nm')]];
    if (st.disp === 'grating') {
      const beta = diffractionAngle(m, lc, st.rho, alpha), N = st.rho * st.W;
      rows.push(['Grooves illuminated N', N.toFixed(0)], ['Blaze angle (Littrow)', (thB / D2R).toFixed(2) + '°'], ['Diffraction angle β at λ', Number.isFinite(beta) ? (beta / D2R).toFixed(2) + '°' : 'evanescent'],
        ['Angular dispersion', Number.isFinite(beta) ? (angularDispersion(m, st.rho, beta) / D2R * 3600).toFixed(0) + '″/nm' : '—'], ['Blaze efficiency at λ (scalar)', (100 * blazeEfficiency(m, lc, st.rho, alpha, thB)).toFixed(0) + ' %'],
        ['Free spectral range λ/m', (lc / m).toFixed(0) + ' nm']);
      calc.say(t('With {v1} grooves in order {m}, the resolving power is <strong>R = {v3}</strong>: at {lc} nm it separates lines <strong>{v5} nm</strong> apart.', { v1: fmt(N, 4), m, v3: fmt(R, 4), lc: lc.toFixed(1), v5: (lc / R).toFixed(3) }));
      calc.set(String.raw`\begin{aligned}
      m\lambda &= d(\sin\alpha + \sin\beta),\quad d = ${texNum(1e6 / st.rho, 4)}\ \text{nm}\\
      R &= mN = ${m}\times${texNum(N, 4)} = ${texNum(R, 4)}\\
      \delta\lambda &= \lambda/R = ${texNum(lc / R, 3)}\ \text{nm}
      \end{aligned}`);
    } else {
      const dn = dndl(st.glass, lc);
      rows.push(['n and dn/dλ at λ', `${index(st.glass, lc).toFixed(4)}, ${(dn * 1e3).toFixed(4)} /µm`], ['Deviation at minimum', (prismDeviation(st.glass, lc, APEX) / D2R).toFixed(2) + '°'],
        ['Angular dispersion', ((2 * Math.sin(APEX / 2) / Math.sqrt(1 - (index(st.glass, lc) * Math.sin(APEX / 2)) ** 2)) * Math.abs(dn) / D2R * 3600).toFixed(1) + '″/nm']);
      calc.say(t('This {glass} prism with a {base} mm base reaches <strong>R = {v3}</strong>: at {lc} nm it separates lines <strong>{v5} nm</strong> apart, and it spreads blue light far more than red.', { glass: st.glass, base: st.base, v3: fmt(R, 4), lc: lc.toFixed(1), v5: (lc / R).toFixed(3) }));
      calc.set(String.raw`\begin{aligned}
      R &= b\left|\frac{dn}{d\lambda}\right| = ${texNum(st.base, 3)}\ \text{mm}\times${texNum(Math.abs(dn) * 1e6, 4)}\ \text{mm}^{-1} = ${texNum(R, 4)}\\
      \delta\lambda &= \lambda/R = ${texNum(lc / R, 3)}\ \text{nm}
      \end{aligned}`);
    }
    rows.push(['Na D doublet (0.597 nm)', lc / R <= 0.597 && R >= 987 ? 'resolved' : 'blended (needs R ≥ 987)']);
    ro.replaceChildren(readouts(rows));
    [strip, zoom, aux].forEach((x) => x.redraw());
  }

  // detector strip: columns are equal steps of exit angle across the order's 380–760 nm range
  function drawStrip(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!M) return;
    const st = M.st, m = +st.m, Wp = Math.min(1400, Math.round(w)), top = 38, sh = (hh - top - 22) * 0.72, dh = (hh - top - 22) * 0.28 - 3;
    let angAt, lamsAt;
    if (st.disp === 'grating') {
      const b0 = diffractionAngle(m, L0, st.rho, M.alpha), b1 = diffractionAngle(m, L1, st.rho, M.alpha);
      if (!Number.isFinite(b0) || !Number.isFinite(b1)) { ctx.fillStyle = '#fff'; ctx.font = '13px Inter, sans-serif'; ctx.fillText(t('Order {m} does not reach 760 nm at {rho} lines/mm (|sin β| > 1).', { m, rho: st.rho.toFixed(0) }), 16, hh / 2); return; }
      angAt = (x) => b0 + ((x + 0.5) / Wp) * (b1 - b0);
      // every order k that lands on this column, with its blaze efficiency
      lamsAt = (beta) => { const out = []; for (let k = 1; k <= 8; k++) { const l = wavelengthAt(k, beta, st.rho, M.alpha); if (l >= 330 && l <= 1050 && (!st.filt || k === m)) out.push([l, blazeEfficiency(k, l, st.rho, M.alpha, M.thB)]); } return out; };
    } else {
      const d0 = prismDeviation(st.glass, L0, APEX), d1 = prismDeviation(st.glass, L1, APEX);
      angAt = (x) => d0 + ((x + 0.5) / Wp) * (d1 - d0);
      // invert the deviation by bisection
      lamsAt = (dev) => { let a = 330, b = 1050; for (let i = 0; i < 40; i++) { const c = (a + b) / 2; prismDeviation(st.glass, c, APEX) > dev ? (a = c) : (b = c); } return [[(a + b) / 2, 1]]; };
    }
    if (!M.img || M.img.W !== Wp) {
      // observed spectrum on a fine grid, with the resolution capped at ~2 samples per column
      const step = 0.05, grid = Array.from({ length: Math.round((1050 - 330) / step) + 1 }, (_, i) => 330 + i * step);
      const dcol = (L1 - L0) / Wp, Rcol = Math.min(M.R, 570 / (2 * dcol), 570 / (2 * step));
      const obs = observe(st.src, grid, Rcol), mx = obs.reduce((a, v) => Math.max(a, v), 1e-12);
      const at = (l) => { const t = (l - 330) / step, i = Math.floor(t), f = t - i; return i < 0 || i >= grid.length - 1 ? 0 : (obs[i] * (1 - f) + obs[i + 1] * f) / mx; };
      // row 0: colour as the eye would see it; row 1: signal of a silicon detector (all orders,
      // UV and near-IR included, flat quantum efficiency for simplicity)
      const col = new Float64Array(Wp * 3), det = new Float64Array(Wp);
      let cm = 1e-12, dm = 1e-12;
      for (let x = 0; x < Wp; x++) {
        for (const [l, eff] of lamsAt(angAt(x))) {
          const c = wavelengthRGB(l, false), v = at(l) * eff;
          for (let q = 0; q < 3; q++) col[x * 3 + q] += c[q] * v;
          det[x] += v;
        }
        cm = Math.max(cm, col[x * 3], col[x * 3 + 1], col[x * 3 + 2]); dm = Math.max(dm, det[x]);
      }
      const ic = imageCanvas(Wp, 2);
      for (let x = 0; x < Wp; x++) {
        for (let q = 0; q < 3; q++) ic.data[x * 4 + q] = 255 * Math.pow(col[x * 3 + q] / cm, 1 / 2.2);
        const g = 255 * Math.pow(det[x] / dm, 1 / 2.2);
        ic.data[(Wp + x) * 4] = ic.data[(Wp + x) * 4 + 1] = ic.data[(Wp + x) * 4 + 2] = g;
        ic.data[x * 4 + 3] = ic.data[(Wp + x) * 4 + 3] = 255;
      }
      ic.put();
      M.img = { W: Wp, c: ic.c };
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(M.img.c, 0, 0, M.img.W, 1, 0, top, w, sh);
    ctx.drawImage(M.img.c, 0, 1, M.img.W, 1, 0, top + sh + 3, w, dh);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(w - 150, top + sh + 3, 150, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(t('detector signal (incl. UV/IR)'), w - 4, top + sh + 13);
    // wavelength ticks of the selected order along the top
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    const a0 = angAt(-0.5), a1 = angAt(Wp - 0.5);
    for (let l = 400; l <= 750; l += 50) {
      const a = st.disp === 'grating' ? diffractionAngle(m, l, st.rho, M.alpha) : prismDeviation(st.glass, l, APEX), x = ((a - a0) / (a1 - a0)) * w;
      ctx.fillRect(x, top - 4, 1, 4); ctx.fillText(l + '', x, top - 7);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(st.disp === 'grating' ? (st.filt ? t('order {m}', { m }) : t('order {m} · other orders overlap where they land', { m })) : t('prism: blue spread out, red compressed'), 6, hh - 6);
    // zoom window
    const za = (l) => ((st.disp === 'grating' ? diffractionAngle(m, l, st.rho, M.alpha) : prismDeviation(st.glass, l, APEX)) - a0) / (a1 - a0) * w;
    const x0 = za(st.zc - st.zw / 2), x1 = za(st.zc + st.zw / 2);
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5; ctx.strokeRect(Math.min(x0, x1) - 1, top, Math.max(2, Math.abs(x1 - x0) + 2), sh + dh + 3);
  }

  function drawZoom(ctx, w, hh) {
    if (!M) return;
    const st = M.st, n = 500, lams = Array.from({ length: n }, (_, i) => st.zc - st.zw / 2 + (i / (n - 1)) * st.zw);
    const R = Rof(st, st.zc), obs = observe(st.src, lams, R), S = SOURCES[st.src];
    let series;
    if (S.type === 'emission') {
      const pk = Math.max(...obs, 1e-9);
      series = [{ data: lams.map((l, i) => [l, obs[i] / pk]), color: '#ffb547', width: 2.2, label: t('observed, R = {R}', { R: R.toFixed(0) }) }];
    } else {
      const intr = intrinsic(st.src, lams), mx = Math.max(...intr, ...obs);
      series = [{ data: lams.map((l, i) => [l, intr[i] / mx]), color: 'rgba(255,255,255,0.45)', width: 1.2, label: 'intrinsic' }, { data: lams.map((l, i) => [l, obs[i] / mx]), color: '#ffb547', width: 2.2, label: t('observed, R = {R}', { R: R.toFixed(0) }) }];
    }
    const lines = S.lines.filter((L) => Math.abs(L[0] - st.zc) <= st.zw / 2);
    plot(ctx, w, hh, {
      title: t('Zoom: {a}–{b} nm', { a: (st.zc - st.zw / 2).toFixed(2), b: (st.zc + st.zw / 2).toFixed(2) }), x: { min: lams[0], max: lams[n - 1], label: 'wavelength (nm)' }, y: { min: 0, max: 1.1, label: 'relative intensity' },
      series, vlines: lines.slice(0, 12).map((L, i) => ({ x: L[0], color: 'rgba(106,215,255,0.35)', label: L[3] || L[0].toFixed(2), dy: (i % 3) * 12 })), legend: true, legendX: w - 210, legendY: hh - 80,
    });
  }

  function drawAux(ctx, w, hh) {
    if (!M) return;
    const st = M.st, ls = Array.from({ length: 200 }, (_, i) => 330 + i * 4);
    if (st.disp === 'grating') {
      const cols = ['#ff6b6b', '#6be3a4', '#6ad7ff', '#c18cff'];
      plot(ctx, w, hh, {
        title: t('Blaze efficiency per order (scalar theory), blaze {l} nm in order 1', { l: st.lamB.toFixed(0) }), x: { min: 330, max: 1100, label: 'wavelength (nm)' }, y: { min: 0, max: 1.05, label: 'relative efficiency' },
        series: [1, 2, 3, 4].map((k) => ({ data: ls.map((l) => [l, blazeEfficiency(k, l, st.rho, M.alpha, M.thB)]), color: cols[k - 1], width: k === +st.m ? 2.4 : 1.2, label: `m = ${k}` })),
        bands: [{ x: [L0, L1], color: 'rgba(255,255,255,0.04)' }], legend: true, legendX: w - 110, legendY: 34,
      });
    } else {
      plot(ctx, w, hh, {
        title: t('Resolving power of a {b} mm prism vs wavelength', { b: st.base.toFixed(0) }), x: { min: 380, max: 1000, label: 'wavelength (nm)' }, y: { min: 10, max: 1e5, log: true, label: 'R = b |dn/dλ|' },
        series: GLASS.map((g, i) => ({ data: ls.filter((l) => l >= 380).map((l) => [l, Math.max(10, prismR(g, l, st.base))]), color: ['#ffb547', '#ff9cc0', '#c18cff', '#6ad7ff', '#6be3a4', '#ffffff'][i], width: g === st.glass ? 2.4 : 1.1, label: g })),
        legend: true, legendX: w - 130, legendY: 34,
      });
    }
  }

  // ── astronomical échelle spectrograph ──
  const ECH = { r2: { name: 'R2 échelle (θB = 63.4°), 31.6 lines/mm', rho: 31.6, thB: Math.atan(2) }, r4: { name: 'R4 échelle (θB = 76.0°), 31.6 lines/mm', rho: 31.6, thB: Math.atan(4) }, r4b: { name: 'R4 échelle, 41.6 lines/mm', rho: 41.6, thB: Math.atan(4) } };
  const FCAM = 750, DET = 61.44, SLITLEN = 4; // camera focal length (mm), 4096 × 15 µm detector, slit length (″)
  const sec2 = h('section.block', {}, h('h2', {}, 'The astronomical spectrograph: slit, seeing and the échelle'));
  const ectl = controls({
    D: { type: 'range', label: 'Telescope diameter', min: 0.5, max: 40, log: true, value: 8.2, unit: 'm' },
    seeing: { type: 'range', label: 'Seeing FWHM', min: 0.2, max: 2.5, step: 0.05, value: 0.8, unit: '″' },
    slit: { type: 'range', label: 'Slit width', min: 0.1, max: 3, step: 0.05, value: 1, unit: '″' },
    Dcol: { type: 'range', label: 'Collimated beam diameter', min: 20, max: 400, log: true, value: 200, unit: 'mm' },
    ech: { type: 'select', label: 'Échelle grating', value: 'r4', options: Object.entries(ECH).map(([k, e]) => [k, e.name]) },
    xd: { type: 'select', label: 'Cross-disperser prism', value: 'N-SF11', options: ['N-SF11', 'F2', 'N-BK7', 'Fused silica'] },
  }, () => updateEch());
  const ero = h('div');
  const ecalc = liveCalc();
  const gram = stage({ aspect: 1, label: 'Échellogram of the Sun on a 4k × 4k detector with 15-micron pixels (orders stacked by the prism)', draw: drawGram, minH: 300 });
  const rs = stage({ aspect: 1.5, label: '', draw: drawRS, cls: 'plain', minH: 220 });
  const ezoom = stage({ aspect: 1.5, label: '', draw: drawEZoom, cls: 'plain', minH: 220 });
  sec2.append(lab([gram.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, rs.el), h('div.card', { style: { padding: '6px' } }, ezoom.el))], [h('div.card', {}, ectl.el), h('div.card', {}, ero), ecalc.el]));
  root.append(sec2);
  let E = null;
  function updateEch() {
    const st = ectl.state, e = ECH[st.ech], Rs = slitR(e.thB, st.Dcol, st.slit, st.D), Rd = (2 * st.Dcol * 1e6 * Math.tan(e.thB)) / 550;
    const R = combinedR(Rs, Rd), T = slitThroughput(st.slit, st.seeing), ord = echelleOrders(e.rho, e.thB, 380, 700);
    const m550 = Math.round((2e6 * Math.sin(e.thB)) / (e.rho * 550)), disp = ((1e6 / e.rho) * Math.cos(e.thB)) / (m550 * FCAM); // nm per mm at 550 nm
    const resPx = 550 / R / disp / 0.015;
    E = { st, e, Rs, Rd, R, T, ord, img: null };
    ero.replaceChildren(readouts([
      ['Slit-limited R', Rs.toFixed(0)], ['Diffraction-limited R = 2 D_col tan θB / λ', Rd.toExponential(2)], ['Effective R at 550 nm', R.toFixed(0)],
      ['Slit transmission of the seeing disk', (100 * T).toFixed(0) + ' %'], ['Orders 380–700 nm', `${ord.mMin}–${ord.mMax} (${ord.mMax - ord.mMin + 1})`],
      ['Free spectral range at 550 nm', t('{d} nm (order {m})', { d: (550 / m550).toFixed(2), m: m550 })], ['Resolution element on the detector', resPx < 2 ? t('{n} px (undersampled)', { n: resPx.toFixed(1) }) : resPx.toFixed(1) + ' px'],
    ]));
    ecalc.set(String.raw`\begin{aligned}
    R_\text{slit} &= \frac{2\tan\theta_B\,D_\text{col}}{\phi\,D_\text{tel}} = ${texNum(Rs, 4)}\\
    T &= \operatorname{erf}\!\left(\sqrt{\ln2}\,\phi/\mathrm{FWHM}\right) = ${texNum(T, 3)}
    \end{aligned}`);
    [gram, rs, ezoom].forEach((x) => x.redraw());
  }
  function drawGram(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!E) return;
    const S = 600, mmpp = DET / S;
    if (!E.img) {
      const st = E.st, e = E.e, opt = { rho: e.rho, thB: e.thB, fcam: FCAM, glass: st.xd, apex: APEX, lamRef: 520 };
      const acc = new Float32Array(S * S * 3), slitH = (SLITLEN * (Math.PI / 648000) * st.D * FCAM * 1000) / st.Dcol / mmpp; // px
      const labels = [];
      for (let m = E.ord.mMin - 2; m <= E.ord.mMax + 2; m++) {
        let lab0 = null;
        for (let x = 0; x < S; x++) {
          const xmm = (x + 0.5) * mmpp - DET / 2, beta = e.thB + Math.atan(xmm / FCAM), lam = wavelengthAt(m, beta, e.rho, e.thB);
          if (lam < 370 || lam > 720) continue;
          const pos = echellePosition(opt, m, lam);
          if (!pos) continue;
          const yc = S / 2 - pos[1] / mmpp;
          if (yc < -slitH || yc > S + slitH) continue;
          const I = sunAt(lam, E.R) * blazeEfficiency(m, lam, e.rho, e.thB, e.thB), c = wavelengthRGB(lam, false);
          for (let y = Math.floor(yc - slitH / 2 - 1); y <= Math.ceil(yc + slitH / 2 + 1); y++) {
            if (y < 0 || y >= S) continue;
            const cov = Math.max(0, Math.min(1, slitH / 2 + 0.5 - Math.abs(y + 0.5 - yc)));
            for (let q = 0; q < 3; q++) acc[(y * S + x) * 3 + q] += I * cov * c[q];
          }
          if (!lab0 && x > 4) lab0 = [m, yc, lam];
        }
        if (lab0) labels.push(lab0);
      }
      let mx = 1e-9; for (let k = 0; k < acc.length; k++) mx = Math.max(mx, acc[k]);
      const ic = imageCanvas(S, S);
      for (let k = 0; k < S * S; k++) { for (let q = 0; q < 3; q++) ic.data[k * 4 + q] = 255 * Math.pow(acc[k * 3 + q] / mx, 1 / 2.2); ic.data[k * 4 + 3] = 255; }
      ic.put();
      E.img = { c: ic.c, labels };
    }
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(E.img.c, x0, y0, sz, sz);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    E.img.labels.forEach(([m, yc, lam], i) => { const y = y0 + (yc / S) * sz; if (i % 4 === 0 && y > y0 + 8 && y < y0 + sz - 4) ctx.fillText(`m=${m} ${lam.toFixed(0)} nm`, x0 + 4, y + 3); });
  }
  function drawRS(ctx, w, hh) {
    if (!E) return;
    const st = E.st, sl = Array.from({ length: 120 }, (_, i) => 0.1 + (i / 119) * 2.9);
    const R = sl.map((p) => combinedR(slitR(E.e.thB, st.Dcol, p, st.D), E.Rd)), T = sl.map((p) => slitThroughput(p, st.seeing)), Rmax = Math.max(...R);
    plot(ctx, w, hh, {
      title: 'Resolution vs light: the slit-width trade-off', x: { min: 0.1, max: 3, label: 'slit width (″)' }, y: { min: 0, max: 1.05, label: 'R / R(0.1″) · throughput' },
      series: [{ data: sl.map((p, i) => [p, R[i] / Rmax]), color: '#6ad7ff', width: 2, label: 'resolving power' }, { data: sl.map((p, i) => [p, T[i]]), color: '#ffb547', width: 2, label: 'slit throughput' }, { data: sl.map((p, i) => [p, (R[i] / Rmax) * T[i] * 2]), color: '#6be3a4', width: 1.4, dash: [5, 3], label: 'R × throughput (×2)' }],
      vlines: [{ x: st.slit, color: 'rgba(255,255,255,0.4)' }, { x: st.seeing, color: 'rgba(255,181,71,0.35)', label: 'seeing', dy: 14 }], legend: true, legendX: w - 200, legendY: hh - 100,
    });
  }
  function drawEZoom(ctx, w, hh) {
    if (!E) return;
    const lams = Array.from({ length: 400 }, (_, i) => 588.6 + i * 0.0035), o = observe('sun', lams, E.R), I = intrinsic('sun', lams), mx = Math.max(...I);
    plot(ctx, w, hh, {
      title: t('Sodium D at R = {R}', { R: E.R.toFixed(0) }), x: { min: lams[0], max: lams[lams.length - 1], label: 'wavelength (nm)' }, y: { min: 0, max: 1.05, label: 'relative intensity' },
      series: [{ data: lams.map((l, i) => [l, I[i] / mx]), color: 'rgba(255,255,255,0.4)', width: 1.1, label: 'intrinsic' }, { data: lams.map((l, i) => [l, o[i] / mx]), color: '#ffb547', width: 2, label: 'observed' }],
      legend: true, legendX: w - 130, legendY: hh - 80,
    });
  }
  updateEch();

  update();

  root.append(rule(String.raw`\[R = \frac{\lambda}{\delta\lambda} = mN\]
<p>A grating resolves two wavelengths \(\delta\lambda\) apart when the order \(m\) times the number of illuminated grooves \(N\) exceeds \(\lambda/\delta\lambda\). The two sodium lines at 589.0 and 589.6 nm need \(R \approx 1000\): 2 mm of a 600 lines/mm grating in first order gives \(R = 1200\), just enough. A Doppler shift changes wavelengths by \(v/c\), so \(R = 100\,000\) resolves 3 km/s, and fitting thousands of lines pins velocities down to metres per second.</p>`,
    String.raw`\(R = mN\) is the diffraction limit of a perfect grating. A real spectrograph is usually limited by the width of its slit as projected on the detector and by the pixels, and higher orders overlap unless a filter or a cross-disperser separates them.`));
  root.append(theory('How spectrographs separate wavelengths', String.raw`
<div class="theory-cols"><div>
<h3>Prisms</h3>
<p>A prism deviates light by an amount that depends on its refractive index, so wavelengths separate because glass is dispersive. Its resolving power follows from the path difference across the beam. The two edges of the wavefront travel through glass thicknesses differing by the base \(b\), so</p>
\[R = \frac{\lambda}{\delta\lambda} = b\left|\frac{dn}{d\lambda}\right|.\]
<p>Dense flints with steep dispersion beat crowns by a factor of four, and all glasses disperse the blue far more than the red. A prism spectrum is therefore strongly non-linear, and glass absorbs in the UV and IR. Prisms survive in astronomy as cross-dispersers, as low-resolution "grisms", and in throughput-critical instruments.</p>
<h3>Gratings</h3>
<p>A grating of groove spacing \(d\) sends light into the directions where the path difference between neighbouring grooves is a whole number of wavelengths:</p>
\[m\lambda = d(\sin\alpha + \sin\beta),\qquad \frac{d\beta}{d\lambda} = \frac{m}{d\cos\beta}.\]
<p>With \(N\) grooves illuminated, the interference pattern of each order sharpens to a width \(\lambda/(mN)\), so</p>
\[R = mN = \frac{W(\sin\alpha+\sin\beta)}{\lambda},\]
<p>which depends only on the illuminated width \(W\) and the angles, not on the groove density separately. Two lines are just resolved (Rayleigh) when the maximum of one falls on the first zero of the other. The dip between them is then \(8/\pi^2 = 81\,\%\). The sodium D doublet (0.597 nm) needs \(R \ge 987\).</p>
</div><div>
<h3>Blaze and order overlap</h3>
<p>A grating with flat grooves sends most light into the undispersed zeroth order. Tilting each groove facet by the blaze angle \(\theta_B\) makes specular reflection off the facet coincide with order \(m\) at the blaze wavelength, so the single-facet diffraction envelope</p>
\[\eta_m(\lambda) = \mathrm{sinc}^2\!\left[\frac{\pi d\cos\theta_B}{\lambda}\big(\sin(\alpha-\theta_B)+\sin(\beta-\theta_B)\big)\right]\]
<p>peaks there. A blaze at 500 nm in order 1 also blazes 250 nm in order 2. The same exit angle \(\beta\) receives \(\lambda\) in order 1, \(\lambda/2\) in order 2, and so on, so orders overlap beyond the <em>free spectral range</em> \(\lambda/m\). An order-sorting filter or a cross-disperser separates them. The strip shows what reaches the detector without one. This is scalar theory: real gratings show polarisation-dependent Wood anomalies, especially at high groove densities.</p>
<h3>Spectra here</h3>
<p>An <em>échelle</em> is a coarse grating (tens of grooves per mm) used at a steep blaze angle in very high orders (m ≈ 50–150). Its resolving power is huge, but its free spectral range λ/m is only a few nanometres. A prism or grating at right angles, the <em>cross-disperser</em>, separates the orders vertically, so the spectrum fills a square detector as a stack of short rainbows: the échellogram.</p>
<h3>The slit sets the resolution</h3>
<p>On a telescope the spectrograph sees a star blurred by seeing, not a point. The slit width \(\phi\) on the sky is imaged onto the detector, and for a Littrow échelle that gives</p>
\[R = \frac{2\tan\theta_B\,D_\text{col}}{\phi\,D_\text{tel}},\]
<p>which falls in proportion to the telescope diameter. A 1″ slit on an 8 m telescope needs a 200 mm beam and an R4 échelle (tan θ_B = 4) to reach R ≈ 40 000, the design of ESO's UVES. Narrowing the slit raises R but loses light from the seeing disk: a slit as wide as the seeing FWHM passes erf(√ln2) = 76 %. That trade-off is why giant telescopes need ever larger spectrographs, and why adaptive optics (smaller images) and image slicers matter. An <em>integral-field unit</em> slices the focal plane into strips and lines them up along a long slit, giving a spectrum for every spatial pixel; it is described here but not simulated.</p>
<p>The solar spectrum is a 5778 K continuum with Gaussian Fraunhofer lines at their standard air wavelengths: calcium H and K, the hydrogen Balmer series, magnesium b, sodium D, iron, and the telluric oxygen bands A and B. Their depths and widths are illustrative. Lamp lines are the standard Hg, Ne, H and Na wavelengths with illustrative intensities. The observed spectrum is the intrinsic one convolved with the diffraction-limited instrument profile sinc²(πΔλR/λ). In the échellogram each line is broadened in quadrature to λ/R with its equivalent width conserved. The real solar spectrum has thousands more lines than the 17 drawn here.</p>
</div></div>`));
  root.append(references([
    'D. J. Schroeder, <em>Astronomical Optics</em>, 2nd ed., Academic Press (2000), ch. 13–15: gratings, prisms and spectrographs.',
    'H. Dekker et al., “Design, construction, and performance of UVES, the echelle spectrograph for the UT2 Kueyen Telescope at the ESO Paranal Observatory”, <em>Proc. SPIE</em> 4008, 534 (2000).',
    'C. Palmer &amp; E. Loewen, <em>Diffraction Grating Handbook</em>, 8th ed., MKS Newport (2020).',
    'M. Born &amp; E. Wolf, <em>Principles of Optics</em>, 7th ed., §8.6.3: resolving power of prisms and gratings.',
    'NIST Atomic Spectra Database (physics.nist.gov/asd): wavelengths of the Hg, Ne, H and Na lines; C. E. Moore, M. G. J. Minnaert &amp; J. Houtgast, <em>The Solar Spectrum 2935 Å to 8770 Å</em>, NBS Monograph 61 (1966).',
  ]));

  return () => [strip, zoom, aux, gram, rs, ezoom].forEach((x) => x.destroy());
}
