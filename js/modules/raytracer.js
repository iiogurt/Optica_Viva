import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { LENSES, paraxial, aimRay, trace, toPlane, autoSemiDiameters, sag, referenceSphere, opd } from '../lib/raytrace.js';
import { GLASSES, abbe, index } from '../lib/glass.js';
import { wavelengthCSS } from '../lib/color.js';
import { plot, range } from '../lib/plot.js';
import { psf, rasterAperture } from '../lib/pupil.js';
import { lut } from '../lib/color.js';

// add the optimised BK7/F2 achromat (designed for this lab: SA-corrected, F = C focus)
LENSES.achromat = {
  name: 'Cemented achromat f/5, 100 mm (N-BK7 / F2)',
  epd: 20, field: 3,
  surfaces: [
    { R: 44.444, t: 5, glass: 'N-BK7', stop: true },
    { R: -42.447, t: 2.5, glass: 'F2' },
    { R: -826.165, t: 95, glass: 'air' },
  ],
};

const SPECTRA = {
  mono: [587.56],
  rgb: [486.13, 587.56, 656.27],
  full: [440, 486.13, 530, 587.56, 620, 656.27, 690],
};

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Real lenses are traced ray by ray with the exact vector form of Snell\'s law, using glass dispersion from Sellmeier equations and real-ray aiming at the aperture stop. The same traced wavefront is then Fourier-transformed into the diffraction PSF. This is how lens-design software works, compressed into one page.', domains: ['photo', 'video', 'space'] }));

  const S = { lens: 'cooke' };
  const ctl = controls({
    lens: { type: 'select', label: 'Lens prescription', value: 'cooke', options: Object.entries(LENSES).map(([k, L]) => [k, L.name]) },
    field: { type: 'range', label: 'Field angle', min: 0, max: 1, step: 0.01, value: 0.7, fmt: (v) => (v * (LENSES[S.lens]?.field || 1)).toFixed(1), unit: '°' },
    fnum: { type: 'range', label: 'Stop down (×  nominal f/#)', min: 1, max: 4, step: 0.01, value: 1, fmt: (v) => '×' + v.toFixed(2) },
    focus: { type: 'range', label: 'Image plane shift', min: -1, max: 1, step: 0.002, value: 0, fmt: (v) => (v * 1000).toFixed(0), unit: 'µm' },
    spectrum: { type: 'seg', label: 'Wavelengths', value: 'rgb', options: [['mono', 'd 588'], ['rgb', 'F·d·C'], ['full', '7 λ']] },
    nrays: { type: 'range', label: 'Rays in fan', min: 5, max: 41, step: 2, value: 15 },
    both: { type: 'toggle', label: 'Also draw on-axis bundle', value: true },
  }, () => update());
  Object.assign(S, ctl.state);
  const bestBtn = h('button.btn', { type: 'button', onClick: () => autoFocus() }, 'Find best focus (min RMS spot)');
  const ro = h('div');
  const calc = liveCalc('First-order calculation');

  let model = null;
  const layout = stage({ aspect: 2.25, label: 'Meridional ray trace', draw: drawLayout, minH: 260 });
  const zoom = stage({ aspect: 2.6, label: 'Focus region (magnified, caustic)', draw: drawZoom, minH: 200 });
  const spot = stage({ aspect: 1, label: 'Spot diagram', draw: drawSpot });
  const fan = stage({ aspect: 1, label: '', draw: drawFan, cls: 'plain' });
  const chroma = stage({ aspect: 1, label: '', draw: drawChroma, cls: 'plain' });
  const psfStage = stage({ aspect: 2, label: 'Wavefront (OPD) · diffraction PSF from the traced rays', draw: drawPSF, minH: 220 });

  root.append(lab([
    layout.el, zoom.el,
    h('div.grid-3', {}, spot.el, fan.el, chroma.el),
    psfStage.el,
  ], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '12px' } }, bestBtn)), h('div.card', {}, ro), calc.el], true));

  function build() {
    Object.assign(S, ctl.state);
    const base = LENSES[S.lens];
    const p0 = paraxial(base);
    const lens = { ...base, epd: base.epd / S.fnum };
    const lambdas = SPECTRA[S.spectrum];
    const sd = base._sd || (base._sd = autoSemiDiameters(base));
    const par = {};
    for (const l of new Set([...lambdas, 587.56, 486.13, 656.27])) par[l] = paraxial(lens, l);
    const pd = par[587.56];
    const zImg = pd.zImage + S.focus;
    const theta = S.field * base.field;
    // meridional fans
    const fans = [];
    const fields = S.both && theta > 0 ? [theta, 0] : [theta];
    for (const th of fields) for (const l of lambdas) {
      const rays = [];
      for (const py of range(-1, 1, S.nrays)) {
        const a = aimRay(lens, l, th, 0, py, par[l]);
        if (!a) continue;
        const r = trace(lens, l, a.p, a.d, { path: true, sd, zv: pd.zv });
        rays.push({ r, py, th, l });
      }
      fans.push({ th, l, rays });
    }
    // spot diagram (hexapolar pupil sampling)
    const spots = [];
    const ref = (() => { const a = aimRay(lens, 587.56, theta, 0, 0, pd); const r = trace(lens, 587.56, a.p, a.d, { clip: false, zv: pd.zv }); return toPlane(r, zImg); })();
    let sx = 0, sy = 0, n = 0;
    for (const l of lambdas) {
      const pts = [];
      for (let ring = 0; ring <= 6; ring++) {
        const cnt = ring === 0 ? 1 : 6 * ring;
        for (let k = 0; k < cnt; k++) {
          const rr = ring / 6, ph = (2 * Math.PI * k) / cnt;
          const a = aimRay(lens, l, theta, rr * Math.cos(ph), rr * Math.sin(ph), par[l]);
          if (!a) continue;
          const r = trace(lens, l, a.p, a.d, { sd, zv: pd.zv });
          if (!r.ok) continue;
          const P = toPlane(r, zImg);
          const q = [(P[0] - ref[0]) * 1000, (P[1] - ref[1]) * 1000];
          pts.push(q); sx += q[0]; sy += q[1]; n++;
        }
      }
      spots.push({ l, pts });
    }
    const cx = sx / n, cy = sy / n;
    let rms = 0, geo = 0;
    spots.forEach((s) => s.pts.forEach((q) => { const d2 = (q[0] - cx) ** 2 + (q[1] - cy) ** 2; rms += d2; geo = Math.max(geo, Math.sqrt(d2)); }));
    rms = Math.sqrt(rms / n);
    // ray-fan (transverse aberration) curves
    const fanCurves = lambdas.map((l) => {
      const T = [], Sg = [];
      const chief = (() => { const a = aimRay(lens, 587.56, theta, 0, 0, pd); return toPlane(trace(lens, 587.56, a.p, a.d, { clip: false, zv: pd.zv }), zImg); })();
      for (const t of range(-1, 1, 41)) {
        const a = aimRay(lens, l, theta, 0, t, par[l]);
        if (a) { const r = trace(lens, l, a.p, a.d, { clip: false, zv: pd.zv }); if (r.ok) T.push([t, (toPlane(r, zImg)[1] - chief[1]) * 1000]); }
        const b = aimRay(lens, l, theta, t, 0, par[l]);
        if (b) { const r = trace(lens, l, b.p, b.d, { clip: false, zv: pd.zv }); if (r.ok) Sg.push([t, (toPlane(r, zImg)[0] - chief[0]) * 1000]); }
      }
      return { l, T, Sg };
    });
    // chromatic focal shift (paraxial back focus vs λ)
    const chromaCurve = range(420, 700, 57).map((l) => [l, (paraxial(lens, l).zImage - pd.zImage) * 1000]);
    // distortion of the chief ray at full field
    const chiefFull = (() => { const a = aimRay(lens, 587.56, base.field, 0, 0, pd); const r = trace(lens, 587.56, a.p, a.d, { clip: false, zv: pd.zv }); return toPlane(r, pd.zImage)[1]; })();
    const ideal = pd.efl * Math.tan(base.field * Math.PI / 180);
    model = { base, lens, lambdas, sd, par, pd, zImg, theta, fans, spots, rms, geo, cx, cy, fanCurves, chromaCurve, distortion: (chiefFull - ideal) / ideal * 100, p0 };
  }

  function update() {
    build();
    const m = model, pd = m.pd;
    const N = m.pd.efl / m.lens.epd;
    const airy = 1.22 * 0.58756 * N;
    ro.replaceChildren(readouts([
      ['Effective focal length', fmt(pd.efl, 5) + ' mm'],
      ['Back focal distance', fmt(pd.bfl, 5) + ' mm'],
      ['Working f-number', 'f/' + N.toFixed(2)],
      ['Entrance pupil (from S1)', fmt(pd.zEP, 4) + ' mm'],
      ['Petzval radius', fmt(-1 / pd.petzval, 4) + ' mm'],
      ['Distortion at full field', fmt(m.distortion, 3) + ' %'],
      ['RMS spot radius', fmt(m.rms, 3) + ' µm'],
      ['GEO spot radius', fmt(m.geo, 3) + ' µm'],
      ['Airy radius (588 nm)', fmt(airy, 3) + ' µm'],
      ['Regime', m.rms > airy ? 'aberration-limited' : 'diffraction-limited'],
    ]));
    const s0 = m.lens.surfaces[0];
    const n1 = index(s0.glass, 587.56);
    calc.set(String.raw`\begin{aligned}
    &f' = -1/M_{21} = ${texNum(pd.efl, 5)}\ \text{mm}\\
    &N = f'/D_{EP} = ${texNum(pd.efl, 4)}/${texNum(m.lens.epd, 3)} = ${texNum(N, 3)}\\
    &\phi_1 = (n'-n)c_1 = \tfrac{${texNum(n1, 5)} - 1}{${isFinite(s0.R) ? texNum(s0.R, 5) : '\\infty'}} = ${texNum((n1 - 1) / s0.R, 4)}\,\text{mm}^{-1}\\
    &r_\text{Airy} = 1.22\lambda N = ${texNum(airy, 3)}\ \mu\text{m}\\
    &\textstyle\sum \phi_k/(n_k n_k') = ${texNum(pd.petzval, 4)}\,\text{mm}^{-1}
    \end{aligned}`);
    layout.redraw(); zoom.redraw(); spot.redraw(); fan.redraw(); chroma.redraw();
    computePSF();
  }

  function autoFocus() {
    let best = [1e9, 0];
    const save = ctl.state.focus;
    for (let f = -1; f <= 1; f += 0.01) { ctl.state.focus = f; build(); if (model.rms < best[0]) best = [model.rms, f]; }
    let a = best[1] - 0.012, b = best[1] + 0.012;
    for (let i = 0; i < 18; i++) {
      const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
      ctl.state.focus = m1; build(); const r1 = model.rms;
      ctl.state.focus = m2; build(); const r2 = model.rms;
      if (r1 < r2) b = m2; else a = m1;
    }
    ctl.state.focus = save;
    ctl.set.focus(Math.max(-1, Math.min(1, (a + b) / 2)));
    update();
  }

  // ── drawing ──
  function drawLayout(ctx, w, hh) {
    if (!model) return;
    const m = model, L = m.lens, zv = m.pd.zv;
    const zMin = -0.18 * m.zImg, zMax = m.zImg * 1.03;
    const yMax = Math.max(...m.sd) * 1.25;
    const sc = Math.min((w - 30) / (zMax - zMin), (hh - 30) / (2 * yMax));
    const X = (z) => 15 + (z - zMin) * sc, Y = (y) => hh / 2 - y * sc;
    // axis
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(0, hh / 2); ctx.lineTo(w, hh / 2); ctx.stroke(); ctx.setLineDash([]);
    // elements
    for (let i = 0; i < L.surfaces.length; i++) {
      const s = L.surfaces[i];
      if (s.glass === 'air') continue;
      const s2 = L.surfaces[i + 1];
      const r = Math.max(m.sd[i], m.sd[i + 1]);
      const r1 = Math.min(m.sd[i], r), r2 = Math.min(m.sd[i + 1], r);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const y = -r1 + (2 * r1 * k) / 40; const z = zv[i] + sag(s.R, y); k ? ctx.lineTo(X(z), Y(y)) : ctx.moveTo(X(z), Y(y)); }
      ctx.lineTo(X(zv[i] + sag(s.R, r1)), Y(r)); // edge
      for (let k = 0; k <= 40; k++) { const y = r2 - (2 * r2 * k) / 40; const z = zv[i + 1] + sag(s2.R, y); ctx.lineTo(X(z), Y(Math.abs(y) >= r2 - 1e-9 ? Math.sign(y) * r : y)); }
      ctx.lineTo(X(zv[i] + sag(s.R, -r1)), Y(-r));
      ctx.closePath();
      const flint = (GLASSES[s.glass]?.type || '').includes('flint');
      const g = ctx.createLinearGradient(0, Y(r), 0, Y(-r));
      const c = flint ? '150,120,255' : '120,200,255';
      g.addColorStop(0, `rgba(${c},0.10)`); g.addColorStop(0.5, `rgba(${c},0.22)`); g.addColorStop(1, `rgba(${c},0.10)`);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `rgba(${c},0.7)`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.glass, X((zv[i] + zv[i + 1]) / 2), Y(-r) + 14);
    }
    // aperture stop
    const si = L.surfaces.findIndex((s) => s.stop);
    const sr = m.pd.stopR;
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 3;
    const zs = X(zv[si] + sag(L.surfaces[si].R, sr));
    ctx.beginPath(); ctx.moveTo(zs, Y(sr)); ctx.lineTo(zs, Y(sr + yMax * 0.25)); ctx.moveTo(zs, Y(-sr)); ctx.lineTo(zs, Y(-sr - yMax * 0.25)); ctx.stroke();
    ctx.fillStyle = '#ffb547'; ctx.font = '600 10px Inter, sans-serif'; ctx.fillText('STOP', zs, Y(sr + yMax * 0.25) - 5);
    // rays
    ctx.globalCompositeOperation = 'lighter';
    for (const f of m.fans) {
      ctx.strokeStyle = wavelengthCSS(f.l, f.th === m.theta ? 0.65 : 0.35);
      ctx.lineWidth = 1;
      for (const { r } of f.rays) {
        if (!r.path) continue;
        ctx.beginPath();
        const p = r.path;
        ctx.moveTo(X(zMin), Y(p[0][1] + (zMin - p[0][2]) * (p[1][1] - p[0][1]) / (p[1][2] - p[0][2] || 1)));
        for (let k = 1; k < p.length; k++) ctx.lineTo(X(p[k][2]), Y(p[k][1]));
        if (r.ok) { const P = toPlane(r, m.zImg); ctx.lineTo(X(P[2]), Y(P[1])); }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // image plane
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(m.zImg), Y(yMax * 0.9)); ctx.lineTo(X(m.zImg), Y(-yMax * 0.9)); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('image plane', X(m.zImg) - 5, Y(yMax * 0.9) + 10);
    // scale bar
    const tenmm = 10 * sc;
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(w - 20 - tenmm, hh - 18, tenmm, 2);
    ctx.textAlign = 'right'; ctx.fillText('10 mm', w - 20, hh - 22);
  }

  function drawZoom(ctx, w, hh) {
    if (!model) return;
    const m = model;
    // rays after the last surface are straight: y(z) = p + (z − p_z) d_y/d_z
    const segs = [];
    let zlo = Infinity, zhi = -Infinity;
    for (const f of m.fans) {
      if (f.th !== m.theta) continue;
      for (const { r, py } of f.rays) {
        if (!r.ok) continue;
        const ty = r.d[1] / r.d[2];
        segs.push({ r, ty, l: f.l, py });
        // axial crossing (on-axis) or crossing with chief ray estimate
      }
    }
    if (!segs.length) return;
    const chiefSeg = segs.find((s) => Math.abs(s.py) < 1e-9 && s.l === 587.56) || segs[Math.floor(segs.length / 2)];
    const yc = (z) => chiefSeg.r.p[1] + (z - chiefSeg.r.p[2]) * chiefSeg.ty;
    for (const s of segs) {
      if (Math.abs(s.ty - chiefSeg.ty) < 1e-12) continue;
      const z = (chiefSeg.r.p[1] - chiefSeg.ty * chiefSeg.r.p[2] - s.r.p[1] + s.ty * s.r.p[2]) / (s.ty - chiefSeg.ty);
      if (isFinite(z)) { zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); }
    }
    const zc = m.zImg;
    const half = Math.max(0.15, Math.min(6, 0.75 * Math.max(Math.abs(zlo - zc), Math.abs(zhi - zc)) + 0.05));
    const z0 = zc - half, z1 = zc + half;
    let yspan = 0;
    for (const s of segs) for (const z of [z0, z1]) yspan = Math.max(yspan, Math.abs(s.r.p[1] + (z - s.r.p[2]) * s.ty - yc(z)));
    yspan *= 0.55;
    const X = (z) => ((z - z0) / (z1 - z0)) * w, Y = (z, y) => hh / 2 - ((y - yc(z)) / yspan) * (hh / 2);
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of segs) {
      ctx.strokeStyle = wavelengthCSS(s.l, 0.55); ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const z of [z0, z1]) { const y = s.r.p[1] + (z - s.r.p[2]) * s.ty; z === z0 ? ctx.moveTo(X(z), Y(z, y)) : ctx.lineTo(X(z), Y(z, y)); }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // paraxial foci per wavelength
    for (const l of m.lambdas) {
      const zp = m.par[l].zImage;
      if (zp < z0 || zp > z1) continue;
      ctx.fillStyle = wavelengthCSS(l, 1);
      ctx.beginPath(); ctx.arc(X(zp), hh / 2, 3.5, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(zc), 0); ctx.lineTo(X(zc), hh); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`z: ±${(half * 1000).toFixed(0)} µm   y: ±${(yspan * 1000 * 2).toFixed(1)} µm (anamorphic)`, 10, hh - 10);
    ctx.fillText('● paraxial focus per λ   ┆ current image plane', 10, 30);
  }

  function drawSpot(ctx, w, hh) {
    if (!model) return;
    const m = model;
    const N = m.pd.efl / m.lens.epd;
    const airy = 1.22 * 0.58756 * N;
    const R = Math.max(m.geo, airy) * 1.25;
    const sc = (Math.min(w, hh) / 2 - 16) / R;
    const cx = w / 2, cy = hh / 2;
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, hh); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, airy * sc, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of m.spots) {
      ctx.fillStyle = wavelengthCSS(s.l, 0.9);
      for (const q of s.pts) { ctx.beginPath(); ctx.arc(cx + (q[0] - m.cx) * sc, cy - (q[1] - m.cy) * sc, 1.6, 0, 7); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'source-over';
    // scale bar
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((v) => v * sc > w * 0.18) || 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(12, hh - 16, nice * sc, 2);
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(nice + ' µm', 12, hh - 22);
    ctx.textAlign = 'right'; ctx.fillText('┄ Airy disk', w - 10, hh - 12);
  }

  function drawFan(ctx, w, hh) {
    if (!model) return;
    let ym = 1e-3;
    model.fanCurves.forEach((c) => [...c.T, ...c.Sg].forEach((p) => (ym = Math.max(ym, Math.abs(p[1])))));
    ym *= 1.15;
    plot(ctx, w, hh, {
      title: 'Ray fan: ε vs pupil coordinate', x: { min: -1, max: 1, label: 'normalised pupil coordinate' }, y: { min: -ym, max: ym, label: 'transverse error ε (µm)' },
      series: model.fanCurves.flatMap((c) => [
        { data: c.T, color: wavelengthCSS(c.l), width: 1.8 },
        { data: c.Sg, color: wavelengthCSS(c.l, 0.8), width: 1.2, dash: [4, 3] },
      ]),
      hlines: [{ y: 0, color: 'rgba(255,255,255,0.25)', dash: [] }],
    });
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('— tangential   ┄ sagittal', w - 18, hh - 46);
  }

  function drawChroma(ctx, w, hh) {
    if (!model) return;
    const c = model.chromaCurve;
    let lo = Math.min(...c.map((p) => p[1])), hi = Math.max(...c.map((p) => p[1]));
    const pad = Math.max(5, (hi - lo) * 0.12);
    const { X, Y } = plot(ctx, w, hh, {
      title: 'Chromatic focal shift (paraxial)', x: { min: 420, max: 700, label: 'wavelength (nm)' }, y: { min: lo - pad, max: hi + pad, label: 'Δz focus (µm)' },
      series: [{ data: c, color: '#e9ebf3', width: 2 }],
      vlines: [486.13, 587.56, 656.27].map((l, i) => ({ x: l, color: wavelengthCSS(l, 0.6), label: 'FdC'[i] })),
    });
    // colour the curve by wavelength
    for (let i = 0; i < c.length - 1; i++) {
      ctx.strokeStyle = wavelengthCSS(c[i][0]); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(c[i][0]), Y(c[i][1])); ctx.lineTo(X(c[i + 1][0]), Y(c[i + 1][1])); ctx.stroke();
    }
  }

  // Diffraction PSF from the traced OPD (Huygens/Fraunhofer).
  let psfData = null;
  const computePSF = debounce(() => {
    const m = model; if (!m) return;
    const lam = 587.56;
    const par = m.par[lam];
    const ref = referenceSphere(m.lens, lam, m.theta, m.zImg, par);
    if (!ref) { psfData = null; psfStage.redraw(); return; }
    const G = 41, grid = new Float64Array(G * G).fill(NaN);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const px = -1 + (2 * i) / (G - 1), py = 1 - (2 * j) / (G - 1);
      if (px * px + py * py > 1.0001) continue;
      const v = opd(m.lens, lam, m.theta, px, py, ref, par);
      if (v != null) grid[j * G + i] = v;
    }
    // remove piston; RMS
    let s = 0, s2 = 0, c = 0, maxStep = 0;
    for (let k = 0; k < G * G; k++) if (!isNaN(grid[k])) { s += grid[k]; s2 += grid[k] ** 2; c++; }
    const mean = s / c, rmsW = Math.sqrt(s2 / c - mean * mean);
    for (let k = 0; k < G * G; k++) if (!isNaN(grid[k])) grid[k] -= mean;
    const n = 256, Dpx = 128;
    const amp = rasterAperture({ type: 'circle' }, n, Dpx, 3);
    const W = new Float64Array(n * n);
    let pv = [Infinity, -Infinity];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const k = y * n + x; if (!amp[k]) continue;
      const u = ((x - n / 2) / (Dpx / 2) + 1) / 2 * (G - 1), v = ((y - n / 2) / (Dpx / 2) + 1) / 2 * (G - 1);
      const i0 = Math.max(0, Math.min(G - 2, Math.floor(u))), j0 = Math.max(0, Math.min(G - 2, Math.floor(v)));
      const fx = Math.min(1, Math.max(0, u - i0)), fy = Math.min(1, Math.max(0, v - j0));
      const q = [grid[j0 * G + i0], grid[j0 * G + i0 + 1], grid[(j0 + 1) * G + i0], grid[(j0 + 1) * G + i0 + 1]];
      const ok = q.map((t) => !isNaN(t));
      let val;
      if (ok.every(Boolean)) val = (q[0] * (1 - fx) + q[1] * fx) * (1 - fy) + (q[2] * (1 - fx) + q[3] * fx) * fy;
      else { const v2 = q.filter((t, i) => ok[i]); val = v2.length ? v2.reduce((a, b) => a + b) / v2.length : 0; }
      W[k] = val * lam / 1000; // µm of OPD
      pv = [Math.min(pv[0], W[k]), Math.max(pv[1], W[k])];
      if (x > 0 && amp[k - 1]) maxStep = Math.max(maxStep, Math.abs(W[k] - W[k - 1]) / (lam / 1000));
    }
    const P = psf(amp, W, n, lam / 1000), P0 = psf(amp, null, n, lam / 1000);
    psfData = { I: P.I, n, Wmap: W, amp, rmsW, pvW: (pv[1] - pv[0]) / (lam / 1000), strehl: P.peak / P0.peak, aliased: maxStep > 0.5, N: m.pd.efl / m.lens.epd, lam };
    psfStage.redraw();
  }, 120);

  const infer = lut('inferno'), div = lut('diverging');
  function drawPSF(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!psfData) return;
    const d = psfData, n = d.n;
    const side = Math.min(hh - 60, w / 2 - 24);
    // OPD map (central crop = pupil)
    const crop = 128, off = (n - crop) / 2;
    const ic = imageCanvas(crop, crop);
    let wmax = 1e-9;
    for (let i = 0; i < n * n; i++) if (d.amp[i]) wmax = Math.max(wmax, Math.abs(d.Wmap[i]));
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const k = (y + off) * n + x + off, o = (y * crop + x) * 4;
      if (!d.amp[k]) { ic.data[o + 3] = 0; continue; }
      const t = Math.round(((d.Wmap[k] / wmax) * 0.5 + 0.5) * 255);
      ic.data[o] = div[t * 3]; ic.data[o + 1] = div[t * 3 + 1]; ic.data[o + 2] = div[t * 3 + 2]; ic.data[o + 3] = 255;
    }
    ic.put();
    const x1 = w / 4 - side / 2, y1 = 28;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ic.c, x1, y1, side, side);
    // PSF (log stretch, central 128 px)
    const ip = imageCanvas(crop, crop);
    let mx = 0; for (let i = 0; i < n * n; i++) mx = Math.max(mx, d.I[i]);
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const v = d.I[(y + off) * n + x + off] / mx;
      const t = Math.max(0, Math.min(255, Math.round((1 + Math.log10(v + 1e-12) / 4) * 255)));
      const o = (y * crop + x) * 4;
      ip.data[o] = infer[t * 3]; ip.data[o + 1] = infer[t * 3 + 1]; ip.data[o + 2] = infer[t * 3 + 2]; ip.data[o + 3] = 255;
    }
    ip.put();
    const x2 = (3 * w) / 4 - side / 2;
    ctx.drawImage(ip.c, x2, y1, side, side);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`OPD  P-V ${d.pvW.toFixed(2)} λ   RMS ${d.rmsW.toFixed(3)} λ   (±${(wmax / (d.lam / 1000)).toFixed(2)} λ)`, x1, hh - 10);
    const field = crop * d.lam / 1000 * d.N / 2; // µm across crop (Q = 2)
    ctx.fillText(`PSF log₁₀ (4 decades)  ${field.toFixed(0)} µm field   Strehl ${d.strehl.toFixed(3)}`, x2, hh - 10);
    if (d.aliased) { ctx.fillStyle = '#ff6b6b'; ctx.fillText('⚠ wavefront slope exceeds sampling: geometric regime, trust the spot diagram', x2 - side * 0.4, 18); }
  }

  update();

  root.append(theory('The physics behind the trace', String.raw`
<div class="theory-cols"><div>
<h3>Exact ray tracing</h3>
<p>A ray is a point \(\mathbf p\) and a unit direction \(\hat{\mathbf s}\). For a spherical surface with vertex at \(z_k\) and radius \(R\), the intersection solves \(|\mathbf p + t\hat{\mathbf s} - \mathbf C|^2 = R^2\) with \(\mathbf C = (0,0,z_k + R)\):</p>
\[t = -b \mp \sqrt{b^2 - (|\mathbf q|^2 - R^2)},\qquad \mathbf q = \mathbf p - \mathbf C,\ b = \mathbf q\cdot\hat{\mathbf s},\]
<p>choosing the root on the vertex-side hemisphere. The normal is \(\hat{\mathbf N} = (\mathbf p - \mathbf C)/R\), and refraction uses the vector Snell law</p>
\[\hat{\mathbf s}' = \mu\hat{\mathbf s} + \left(\mu\cos\theta - \sqrt{1-\mu^2(1-\cos^2\theta)}\right)\hat{\mathbf N},\quad \mu = \frac{n}{n'},\]
<p>where a negative radicand means total internal reflection. No small-angle approximation is made anywhere, so every monochromatic aberration of every order emerges naturally from the geometry.</p>
<h3>Ray aiming</h3>
<p>The aperture stop, not the front element, defines the bundle. For each requested normalised pupil coordinate \((p_x,p_y)\), the launch height is solved by Newton iteration with a finite-difference Jacobian until the real ray hits the stop at \((p_x,p_y)\,r_\text{stop}\). This matters for wide-angle lenses, whose entrance pupil shifts and tilts with field angle (pupil aberration).</p>
<h3>Reading the diagnostics</h3>
<ul>
<li><strong>Ray fan</strong>: transverse error \(\varepsilon_y(p_y)\). A cubic is spherical aberration, a parabola (even part) off-axis is coma, a straight line is defocus, and vertical offsets between colours are lateral colour.</li>
<li><strong>Spot diagram</strong>: the geometrical PSF. Compare it with the dashed Airy circle. If the spot fits inside, the lens is diffraction-limited and only the wave PSF below is meaningful.</li>
<li><strong>Chromatic focal shift</strong>: a singlet gives a monotonic curve (≈ \(f/V\) from F to C). An achromat folds it into a parabola, and the residual is the <em>secondary spectrum</em>.</li>
<li><strong>Caustic view</strong>: the envelope of rays near focus. For spherical aberration, marginal rays cross before paraxial rays. The narrowest waist, the "circle of least confusion", lies in between.</li>
</ul>
</div><div>
<h3>Paraxial first-order data</h3>
<p>The focal length, back focus and pupils come from the \(y\)–\(nu\) matrix trace. The entrance pupil is found by solving for the object-space ray that crosses the stop centre: if \(y_\text{stop} = A\,y_1 + B\,u_1\), the pupil lies at \(z_{EP} = B/A\) with radius \(r_\text{stop}/A\). The Petzval sum gives the radius of the natural image surface of an anastigmat.</p>
<h3>From rays to waves</h3>
<p>The optical path length \(\mathrm{OPL} = \sum n_i t_i\) is accumulated from a common incident wavefront to the exit-pupil reference sphere. That sphere is centred on the chief-ray image point, and its radius is the distance from the exit pupil. The optical path difference</p>
\[W(p_x,p_y) = \mathrm{OPL}(p_x,p_y) - \mathrm{OPL}_\text{chief}\]
<p>is sampled on a 41×41 pupil grid, interpolated onto the FFT grid, and propagated by the Fraunhofer integral \(\mathrm{PSF} = |\mathcal F\{P\,e^{i2\pi W/\lambda}\}|^2\). The Strehl ratio is the peak of this PSF divided by the peak for \(W=0\). Off-axis, the pupil is treated as circular in normalised stop coordinates, which ignores the small anamorphic projection of the pupil (≈ \(\cos\theta\)).</p>
<div class="callout">Try this: choose the <em>plano-convex</em> singlet, then its <em>reversed</em> twin. Bending alone changes the spherical aberration about 4× (the P–V OPD goes from ≈4.8 λ to ≈18.6 λ). Coddington's shape factor \(q = (R_2+R_1)/(R_2-R_1)\) controls it, with the optimum near \(q\approx+0.7\) for \(n\approx1.5\). Then open the achromat and watch the chromatic focal shift fold from a line into a parabola.</div>
<h3>Domain notes</h3>
<p><strong>Photography and cinema</strong> lenses are judged across the full field, which is why the Double-Gauss uses a near-symmetric layout to cancel coma, distortion and lateral colour. <strong>Space telescopes</strong> are reflective (no chromatic aberration). Their designs, such as Ritchey–Chrétien (Hubble) and the three-mirror anastigmat (JWST), use conic and aspheric surfaces to remove spherical aberration and coma together.</p>
</div></div>`));
  root.append(references([
    'W. J. Smith, <i>Modern Optical Engineering</i>, 4th ed., McGraw-Hill (2008): Cooke triplet and Double-Gauss forms.',
    'D. C. O\'Shea, <i>Elements of Modern Optical Design</i>, Wiley (1985): ray-aiming and pupil analysis.',
    'G. H. Spencer &amp; M. V. R. K. Murty, "General ray-tracing procedure", JOSA 52, 672 (1962).',
    'H. H. Hopkins, "Calculation of the aberrations and image assessment for a general optical system", Optica Acta 28, 667 (1981).',
    'Zemax sample prescriptions "Cooke 40 degree field" and "Double Gauss 28 degree field" (classic textbook forms).',
  ]));

  return () => { [layout, zoom, spot, fan, chroma, psfStage].forEach((s) => s.destroy()); };
}
