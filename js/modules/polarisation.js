import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { run } from '../lib/compute.js';
import { plot, range } from '../lib/plot.js';
import { oetf, colormap, wavelengthRGB } from '../lib/color.js';
import { polariser, retarder, mapply, ellipse, fresnelAmp, brewster, rayleighDoP, diskStress, principal, retardation, michelLevy, CRYSTALS, walkOff, maxWalkOff } from '../lib/polar.js';

const D2R = Math.PI / 180;

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Light is a transverse wave, and the direction in which its electric field oscillates is invisible to the eye but not to physics. Reflections off water and glass, and the blue sky itself, are partly polarised. A polariser on the lens can therefore remove glare and deepen the sky. This lab renders a whole scene with Stokes vectors and Mueller matrices, so every pixel carries its state of polarisation through reflection, refraction and the filter.', domains: ['photo', 'video', 'space'] }));

  // ── polarised lake scene ──
  const ctl = controls({
    pol: { type: 'toggle', label: 'Polarising filter on the lens', value: true },
    ang: { type: 'range', label: 'Filter rotation (transmission axis)', min: 0, max: 180, step: 1, value: 90, unit: '°', hint: '0° = horizontal axis, 90° = vertical axis (blocks horizontally polarised glare)' },
    sunEl: { type: 'range', label: 'Sun elevation', min: 2, max: 80, step: 0.5, value: 30, unit: '°' },
    sunAz: { type: 'range', label: 'Sun azimuth from the view direction', min: -180, max: 180, step: 1, value: 160, unit: '°' },
    pitch: { type: 'range', label: 'Camera tilt (negative = down)', min: -50, max: 10, step: 0.5, value: -12, unit: '°' },
    depth: { type: 'range', label: 'Water depth', min: 0.1, max: 6, log: true, value: 1.5, unit: 'm' },
    cdom: { type: 'range', label: 'Dissolved organic matter a_g(440)', min: 0, max: 2, step: 0.05, value: 0.5, unit: 'm⁻¹', hint: '0 = pure water (blue); 0.2–1 typical lakes (green); > 1 bog water (brown)' },
    ripple: { type: 'range', label: 'Ripple slope (RMS)', min: 0, max: 0.15, step: 0.005, value: 0.03 },
    pmax: { type: 'range', label: 'Peak sky polarisation', min: 0.3, max: 0.94, step: 0.01, value: 0.75, hint: 'Pure single Rayleigh scattering gives 0.94; multiple scattering and aerosols lower real skies to 0.6–0.8' },
  }, () => update());
  const ro = h('div');
  const calc = liveCalc();
  const scene = stage({ aspect: 16 / 9, label: 'Lake scene, rendered per pixel in Stokes form (Rayleigh sky, Fresnel reflection, seabed light)', draw: drawScene, minH: 240 });
  const note = h('p.note', {}, '');
  const skymap = stage({ aspect: 1, label: 'Sky polarisation: degree (colour) and E-vector direction (ticks)', draw: drawSky, minH: 220 });
  const fplot = stage({ aspect: 1.25, label: '', draw: drawFresnel, cls: 'plain', minH: 220 });
  root.append(lab([scene.el, note, h('div.grid-2', {}, skymap.el, h('div.card', { style: { padding: '6px' } }, fplot.el))], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const HFOV = 90 * D2R, N_W = 1.333;
  let img = null, want = null, busy = false, alive = true, lastKey = '';
  const args = (st, draft) => ({ W: draft ? 240 : 480, H: draft ? 135 : 270, hfov: HFOV, pitch: st.pitch * D2R, height: 1.7, sunEl: st.sunEl * D2R, sunAz: st.sunAz * D2R, pmax: st.pmax, n: N_W, depth: st.depth, cdom: st.cdom, ripple: st.ripple, pol: st.pol, polAngle: st.ang * D2R });
  // one worker job at a time: a half-resolution draft while controls move, then full resolution
  function request(draft) {
    const key = JSON.stringify(ctl.state) + (draft ? 'd' : 'f');
    if (key === lastKey) return;
    lastKey = key;
    want = { draft, args: args(ctl.state, draft) };
    if (!busy) pump();
  }
  function pump() {
    const job = want;
    want = null;
    if (!job || !alive) return;
    busy = true;
    const t0 = performance.now();
    run('polarLake', job.args).then((r) => {
      busy = false;
      if (!alive) return;
      img = { ...r, draft: job.draft, ms: performance.now() - t0, c: null };
      scene.redraw();
      if (want) pump();
      else if (job.draft) request(false);
      note.textContent = `${img.W}×${img.H} px (${img.draft ? 'draft' : 'full'}), ${img.ms.toFixed(0)} ms in the worker. Reflected skylight at the image centre through the filter: ${(Math.log2(Math.max(img.stats.centreGlare, 1e-6))).toFixed(2)} EV, over the whole water surface ${(Math.log2(Math.max(img.stats.glareRatio, 1e-6))).toFixed(2)} EV (relative to a neutral filter of the same density).`;
    }, (e) => { busy = false; note.textContent = 'Render failed: ' + e.message; });
  }

  function update() {
    const st = ctl.state;
    request(true);
    // geometry at the image centre
    const p = st.pitch * D2R, sEl = st.sunEl * D2R, sAz = st.sunAz * D2R;
    const v = [0, Math.cos(p), Math.sin(p)], s = [Math.cos(sEl) * Math.sin(sAz), Math.cos(sEl) * Math.cos(sAz), Math.sin(sEl)];
    const thB = brewster(1, N_W);
    const thC = v[2] < 0 ? Math.acos(-v[2]) : null;
    const f = thC !== null ? fresnelAmp(1, N_W, thC) : null;
    // the sky seen in the water at the image centre (mirror direction)
    const r = [v[0], v[1], Math.abs(v[2])];
    const cg = r[0] * s[0] + r[1] * s[1] + r[2] * s[2], P = rayleighDoP(cg, st.pmax);
    const ff = st.pol ? 0.401 : 1;
    ro.replaceChildren(readouts([
      ['Brewster angle, air → water', (thB / D2R).toFixed(2) + '°'],
      ['…reached looking down by', (90 - thB / D2R).toFixed(1) + '°'],
      ['Incidence at the image centre', thC !== null ? (thC / D2R).toFixed(1) + '°' : 'sky'],
      ['Rs, Rp at the centre', f ? `${(f.Rs * 100).toFixed(2)} %, ${(f.Rp * 100).toFixed(3)} %` : '—'],
      ['Sky DoP in the reflected direction', (P * 100).toFixed(0) + ' %'],
      ['Angle from the sun (reflected ray)', (Math.acos(Math.max(-1, Math.min(1, cg))) / D2R).toFixed(1) + '°'],
      ['Filter factor (unpolarised light)', st.pol ? (Math.log2(1 / ff)).toFixed(2) + ' EV' : '—'],
    ]));
    const P0 = f ? (f.Rs - f.Rp) / (f.Rs + f.Rp) : 0;
    calc.set(String.raw`\begin{aligned}
    \theta_B &= \arctan\frac{n_2}{n_1} = \arctan ${texNum(N_W, 4)} = ${texNum(thB / D2R, 4)}^\circ\\
    ${f ? String.raw`r_s &= \frac{\cos\theta_i - n\cos\theta_t}{\cos\theta_i + n\cos\theta_t} = ${texNum(f.rs, 4)},\quad r_p = ${texNum(f.rp, 4)}\\
    P_\text{refl} &= \frac{R_s - R_p}{R_s + R_p} = ${texNum(P0, 3)}\quad(\theta_i = ${texNum(thC / D2R, 3)}^\circ)\\` : ''}
    P_\text{sky}(\gamma) &= P_\text{max}\frac{\sin^2\gamma}{1+\cos^2\gamma} = ${texNum(P, 3)}\quad(\gamma = ${texNum(Math.acos(Math.max(-1, Math.min(1, cg))) / D2R, 3)}^\circ)
    \end{aligned}`);
    [skymap, fplot].forEach((x) => x.redraw());
  }

  function drawScene(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!img) return;
    if (!img.c) {
      const { W, H, rgb } = img, ic = imageCanvas(W, H);
      for (let k = 0; k < W * H; k++) for (let c = 0; c < 3; c++) {
        // filmic shoulder, then the sRGB transfer curve
        const x = rgb[k * 3 + c];
        ic.data[k * 4 + c] = 255 * oetf(1 - Math.exp(-1.7 * x));
      }
      for (let k = 0; k < W * H; k++) ic.data[k * 4 + 3] = 255;
      ic.put();
      img.c = ic.c;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.c, 0, 0, w, hh);
    // Brewster line: depression angle 90° − θB below the horizon
    const st = ctl.state, ty = Math.tan(HFOV / 2) * (hh / w);
    const yOf = (elev) => { const a = elev - st.pitch * D2R; return hh / 2 - (Math.tan(a) / ty) * (hh / 2); };
    const yb = yOf(-(90 * D2R - brewster(1, N_W)));
    if (yb > 0 && yb < hh) {
      ctx.strokeStyle = 'rgba(255,181,71,0.75)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(w, yb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,181,71,0.95)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Brewster angle (53.1° incidence)', 8, yb - 5);
    }
    if (st.pol) {
      // filter-orientation glyph
      const cx = w - 38, cy = 38, R = 24, a = st.ang * D2R;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - R * Math.cos(a), cy + R * Math.sin(a)); ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a)); ctx.stroke();
    }
  }

  // Equidistant all-sky map, forward (camera azimuth) at the top.
  function drawSky(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state, cx = w / 2, cy = hh / 2 + 10, R = Math.min(w, hh) / 2 - 30;
    const sEl = st.sunEl * D2R, sAz = st.sunAz * D2R;
    const s = [Math.cos(sEl) * Math.sin(sAz), Math.cos(sEl) * Math.cos(sAz), Math.sin(sEl)];
    const dirAt = (x, y) => {
      const dx = (x - cx) / R, dy = (cy - y) / R, rr = Math.hypot(dx, dy);
      if (rr > 1) return null;
      const z = rr * Math.PI / 2, A = Math.atan2(dx, dy);
      return [Math.sin(z) * Math.sin(A), Math.sin(z) * Math.cos(A), Math.cos(z)];
    };
    const toMap = (d) => { const z = Math.acos(Math.max(-1, Math.min(1, d[2]))), A = Math.atan2(d[0], d[1]), rr = (z / (Math.PI / 2)) * R; return [cx + rr * Math.sin(A), cy - rr * Math.cos(A)]; };
    const S = Math.max(1, Math.round(2 * R / 2)), ic = imageCanvas(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const d = dirAt(cx - R + (i + 0.5) * (2 * R / S), cy - R + (j + 0.5) * (2 * R / S)), o = (j * S + i) * 4;
      if (!d) { ic.data[o + 3] = 0; continue; }
      const cg = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], P = rayleighDoP(cg, st.pmax), c = colormap('viridis', P);
      ic.data[o] = c[0] * 255; ic.data[o + 1] = c[1] * 255; ic.data[o + 2] = c[2] * 255; ic.data[o + 3] = 255;
    }
    ic.put();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, cx - R, cy - R, 2 * R, 2 * R);
    // E-vector ticks: perpendicular to the plane through sun and view direction, length ∝ DoP
    ctx.strokeStyle = 'rgba(10,10,14,0.85)'; ctx.lineWidth = 1.4;
    const step = R / 7;
    for (let y = cy - R + step / 2; y < cy + R; y += step) for (let x = cx - R + step / 2; x < cx + R; x += step) {
      const d = dirAt(x, y);
      if (!d || d[2] < 0.03) continue;
      const cg = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], P = rayleighDoP(cg, st.pmax);
      let e = [s[1] * d[2] - s[2] * d[1], s[2] * d[0] - s[0] * d[2], s[0] * d[1] - s[1] * d[0]];
      const el = Math.hypot(...e);
      if (el < 1e-6) continue;
      e = e.map((q) => q / el);
      const eps = 0.02, a = toMap(d.map((q, k) => q - eps * e[k])), b = toMap(d.map((q, k) => q + eps * e[k]));
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, half = (step * 0.42 * Math.max(0.15, P / st.pmax)) / L;
      ctx.beginPath(); ctx.moveTo(x - (b[0] - a[0]) * half, y - (b[1] - a[1]) * half); ctx.lineTo(x + (b[0] - a[0]) * half, y + (b[1] - a[1]) * half); ctx.stroke();
    }
    // horizon, camera field, sun and anti-sun
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    const p = st.pitch * D2R, tx = Math.tan(HFOV / 2), ty = tx * 9 / 16;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([4, 3]); ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 160; k++) {
      const t = k / 40, side = Math.floor(t) % 4, u = t - Math.floor(t);
      const [px, py] = side === 0 ? [-1 + 2 * u, 1] : side === 1 ? [1, 1 - 2 * u] : side === 2 ? [1 - 2 * u, -1] : [-1, -1 + 2 * u];
      const d = [px * tx, Math.cos(p) - py * ty * Math.sin(p), Math.sin(p) + py * ty * Math.cos(p)];
      const l = Math.hypot(...d), dn = d.map((q) => q / l);
      if (dn[2] < 0) { first = true; continue; }
      const [mx, my] = toMap(dn);
      if (first) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      first = false;
    }
    ctx.stroke(); ctx.setLineDash([]);
    const [sx, sy] = toMap(s);
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.stroke();
    ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
    ctx.fillText('view ↑', cx, cy - R - 5); ctx.fillText('zenith', cx, cy + 4);
    ctx.textAlign = 'left'; ctx.fillText('DoP 0', 6, hh - 8); ctx.textAlign = 'right'; ctx.fillText(`DoP ${(st.pmax * 100).toFixed(0)} %`, w - 6, hh - 8);
  }

  function drawFresnel(ctx, w, hh) {
    const th = range(0, 89.9, 300), st = ctl.state;
    const curve = (n, key) => th.map((t) => { const f = fresnelAmp(1, n, t * D2R); return [t, key === 'P' ? (f.Rs - f.Rp) / (f.Rs + f.Rp + 1e-12) : f[key]]; });
    // range of incidence angles covered by the water in the frame (flat surface)
    const ty = Math.tan(HFOV / 2) * 9 / 16, p = st.pitch * D2R;
    const lo = Math.max(0, Math.min(90, 90 + (p - Math.atan(ty)) / D2R)), hi = Math.min(90, 90 + (p + Math.atan(ty)) / D2R);
    plot(ctx, w, hh, {
      title: 'Fresnel: water (solid), BK7 (dashed)', x: { min: 0, max: 90, label: 'angle of incidence (°)' }, y: { min: 0, max: 1, label: 'reflectance / degree of polarisation' },
      bands: hi > lo ? [{ x: [lo, hi], color: 'rgba(255,255,255,0.06)' }] : [],
      series: [
        { data: curve(N_W, 'Rs'), color: '#6ad7ff', width: 2, label: 'Rs (⊥ plane of incidence)' },
        { data: curve(N_W, 'Rp'), color: '#ff9cc0', width: 2, label: 'Rp (in the plane)' },
        { data: curve(N_W, 'P'), color: '#ffb547', width: 1.6, label: 'polarisation of the reflection' },
        { data: curve(1.5168, 'Rs'), color: '#6ad7ff', width: 1, dash: [4, 3] },
        { data: curve(1.5168, 'Rp'), color: '#ff9cc0', width: 1, dash: [4, 3] },
      ],
      vlines: [{ x: brewster(1, N_W) / D2R, color: 'rgba(255,181,71,0.6)', label: 'θB water' }, { x: brewster(1, 1.5168) / D2R, color: 'rgba(255,181,71,0.3)', label: 'BK7', dy: 14 }],
      legend: true, legendX: 60, legendY: 40,
    });
  }

  // ── polarisers in series ──
  const sec = h('section.block', {}, h('h2', {}, 'Polarisers and wave plates in series'));
  const pctl = controls({
    src: { type: 'seg', label: 'Input light', value: 'unpol', options: [['unpol', 'Unpolarised'], ['lin', 'Linear 0°'], ['circ', 'Circular']] },
    a1: { type: 'range', label: 'Polariser 1 axis', min: 0, max: 180, step: 1, value: 0, unit: '°' },
    mid: { type: 'seg', label: 'Middle element', value: 'pol', options: [['none', 'None'], ['pol', 'Polariser'], ['qwp', 'λ/4 plate'], ['hwp', 'λ/2 plate']] },
    a2: { type: 'range', label: 'Middle element axis', min: 0, max: 180, step: 1, value: 45, unit: '°' },
    a3: { type: 'range', label: 'Analyser axis', min: 0, max: 180, step: 1, value: 90, unit: '°' },
  }, () => updateChain());
  const pro = h('div');
  const pcalc = liveCalc();
  const chainView = stage({ aspect: 3.4, label: 'State of polarisation after each element (ellipse = polarised part, circle = unpolarised part)', draw: drawChain, minH: 150 });
  const malus = stage({ aspect: 2.4, label: '', draw: drawMalus, cls: 'plain', minH: 210 });
  sec.append(lab([chainView.el, h('div.card', { style: { padding: '6px' } }, malus.el)], [h('div.card', {}, pctl.el), h('div.card', {}, pro), pcalc.el]));
  root.append(sec);

  let C = null;
  const input = (src) => (src === 'unpol' ? [1, 0, 0, 0] : src === 'lin' ? [1, 1, 0, 0] : [1, 0, 0, 1]);
  const midM = (st) => (st.mid === 'pol' ? polariser(st.a2 * D2R) : st.mid === 'qwp' ? retarder(Math.PI / 2, st.a2 * D2R) : st.mid === 'hwp' ? retarder(Math.PI, st.a2 * D2R) : null);
  function chain(st, a3) {
    const S0 = input(st.src), S1 = mapply(polariser(st.a1 * D2R), S0), M = midM(st), S2 = M ? mapply(M, S1) : S1;
    return [S0, S1, S2, mapply(polariser(a3 * D2R), S2)];
  }
  function updateChain() {
    const st = pctl.state, S = chain(st, st.a3), out = S[3][0], e2 = ellipse(S[2]);
    C = { st, S, curve: range(0, 180, 181).map((a) => [a, chain(st, a)[3][0]]) };
    pro.replaceChildren(readouts([
      ['Transmitted intensity', (out * 100).toFixed(2) + ' %'],
      ['…in stops', out > 1e-9 ? Math.log2(out).toFixed(2) + ' EV' : '−∞'],
      ['Before the analyser: DoP', (e2.dop * 100).toFixed(0) + ' %'],
      ['…azimuth ψ, ellipticity χ', `${(e2.psi / D2R).toFixed(1)}°, ${(e2.chi / D2R).toFixed(1)}°`],
    ]));
    const S1 = S[1], d = (st.a3 - st.a1) * D2R;
    pcalc.set(st.mid === 'none' ? String.raw`\begin{aligned}
    I &= I_1\cos^2(\theta_3-\theta_1) = ${texNum(S1[0], 3)}\cos^2 ${texNum(d / D2R, 3)}^\circ = ${texNum(S[3][0], 4)}
    \end{aligned}` : String.raw`\begin{aligned}
    \mathbf S_\text{out} &= \mathbf M_\text{pol}(\theta_3)\,\mathbf M_\text{mid}(\theta_2)\,\mathbf M_\text{pol}(\theta_1)\,\mathbf S_\text{in}\\
    \mathbf S_2 &= (${S[2].map((x) => texNum(Math.abs(x) < 1e-9 ? 0 : x, 3)).join(',\\ ')})\\
    I_\text{out} &= ${texNum(S[3][0], 4)}${st.mid === 'pol' ? String.raw`\\ &= I_1\cos^2(\theta_2-\theta_1)\cos^2(\theta_3-\theta_2)` : ''}
    \end{aligned}`);
    chainView.redraw(); malus.redraw();
  }

  function drawChain(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!C) return;
    const st = C.st, names = ['input', 'after polariser 1', st.mid === 'none' ? '(no element)' : 'after ' + { pol: 'polariser 2', qwp: 'λ/4 plate', hwp: 'λ/2 plate' }[st.mid], 'after analyser'];
    const R = Math.min(hh * 0.33, w / 10);
    C.S.forEach((S, i) => {
      const cx = (w / 4) * (i + 0.5), cy = hh / 2 - 6, e = ellipse(S);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - R * 1.2, cy); ctx.lineTo(cx + R * 1.2, cy); ctx.moveTo(cx, cy - R * 1.2); ctx.lineTo(cx, cy + R * 1.2); ctx.stroke();
      const un = Math.max(0, S[0] - e.Ip);
      if (un > 1e-4) { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(cx, cy, R * Math.sqrt(un), 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (e.Ip > 1e-4) {
        // field ellipse: amplitude √Ip, semi-axes cos χ and sin χ along ψ (canvas y is down)
        const A = R * Math.sqrt(e.Ip), a = A * Math.cos(e.chi), b = A * Math.sin(e.chi);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, Math.abs(a)), Math.max(0.5, Math.abs(b)), -e.psi, 0, 7); ctx.stroke();
        if (Math.abs(b) > 2) {
          // handedness arrow at the end of the major axis
          const sgn = Math.sign(e.chi), px = cx + a * Math.cos(-e.psi), py = cy + a * Math.sin(-e.psi), tx = -Math.sin(-e.psi) * sgn, ty = Math.cos(-e.psi) * sgn;
          ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.moveTo(px + tx * 7, py + ty * 7); ctx.lineTo(px - ty * 4, py + tx * 4); ctx.lineTo(px + ty * 4, py - tx * 4); ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(names[i], cx, hh - 22);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10.5px "JetBrains Mono", monospace';
      ctx.fillText(`I = ${S[0].toFixed(3)}`, cx, hh - 8);
    });
  }
  function drawMalus(ctx, w, hh) {
    if (!C) return;
    plot(ctx, w, hh, {
      title: 'Transmission vs analyser angle', x: { min: 0, max: 180, step: 30, label: 'analyser axis θ₃ (°)' }, y: { min: 0, max: Math.max(0.55, ...C.curve.map((q) => q[1])) * 1.08, label: 'I / I_in' },
      series: [{ data: C.curve, color: '#ffb547', width: 2.2 }],
      vlines: [{ x: C.st.a3, color: 'rgba(255,255,255,0.4)', label: `${C.st.a3}°` }],
    });
  }


  // ── photoelasticity ──
  const MATS = {
    pc: { name: 'Polycarbonate (PSM-1 type)', C: 82, P: 300 },
    epoxy: { name: 'Cast epoxy', C: 55, P: 400 },
    pmma: { name: 'PMMA (acrylic)', C: 4.5, P: 5000 },
    bk7: { name: 'N-BK7 glass', C: 2.77, P: 15000 },
    silica: { name: 'Fused silica', C: 3.5, P: 15000 },
  };
  const DISK_D = 0.05, DISK_T = 0.006;
  const sec2 = h('section.block', {}, h('h2', {}, 'Stress birefringence: photoelasticity'));
  const ectl = controls({
    mat: { type: 'select', label: 'Material', value: 'pc', options: Object.entries(MATS).map(([k, m]) => [k, `${m.name}, C = ${m.C} Br`]) },
    P: { type: 'range', label: 'Diametral load P', min: 5, max: 50000, log: true, value: 300, unit: 'N' },
    scope: { type: 'seg', label: 'Polariscope', value: 'dark', options: [['dark', 'Circular, dark'], ['light', 'Circular, light'], ['plane', 'Plane, crossed']] },
    alpha: { type: 'range', label: 'Plane polariscope: polariser axis', min: 0, max: 90, step: 1, value: 0, unit: '°', when: (st) => st.scope === 'plane' },
    src: { type: 'seg', label: 'Illumination', value: 'white', options: [['white', 'White light'], ['na', 'Sodium 589 nm']] },
  }, () => updateStress());
  const ero = h('div');
  const ecalc = liveCalc();
  const diskView = stage({ aspect: 1.35, label: 'Disk Ø 50 mm × 6 mm under diametral compression, seen between polarisers', draw: drawDisk, minH: 260 });
  const mlBar = stage({ aspect: 5, label: 'Michel-Lévy interference colours (crossed polarisers), with the retardation at the disk centre', draw: drawML, minH: 120 });
  sec2.append(lab([diskView.el, mlBar.el], [h('div.card', {}, ectl.el), h('div.card', {}, ero), ecalc.el]));
  root.append(sec2);
  const ML = { dark: michelLevy(6000, 3001, false), light: michelLevy(6000, 3001, true) };
  let E = null, lastMat = ectl.state.mat;
  function updateStress() {
    const st = ectl.state, m = MATS[st.mat];
    // a new material starts at a load that shows a few fringes
    if (st.mat !== lastMat) { lastMat = st.mat; ectl.set.P(m.P); }
    const dsC = (8 * st.P) / (Math.PI * DISK_T * DISK_D), GC = retardation(m.C, DISK_T, dsC) * 1e9, fs = 589e-9 / (m.C * 1e-12);
    E = { st, m, GC, img: null };
    ero.replaceChildren(readouts([
      ['Centre stress difference σ₁ − σ₂', (dsC / 1e6).toFixed(3) + ' MPa'],
      ['Centre retardation Γ', GC.toFixed(1) + ' nm'],
      ['Centre fringe order N (589 nm)', (GC / 589).toFixed(3)],
      ['Material fringe value f_σ (589 nm)', (fs / 1000).toFixed(2) + ' kN/m'],
      ['Average compressive stress P/(Dt)', (st.P / (DISK_D * DISK_T) / 1e6).toFixed(3) + ' MPa'],
    ]));
    ecalc.set(String.raw`\begin{aligned}
    \sigma_1-\sigma_2\big|_0 &= \frac{8P}{\pi D t} = ${texNum(dsC / 1e6, 4)}\ \text{MPa}\\
    \Gamma &= C\,t\,(\sigma_1-\sigma_2) = ${texNum(GC, 4)}\ \text{nm}\\
    N &= \Gamma/\lambda = ${texNum(GC / 589, 4)}\quad(\lambda = 589\ \text{nm})
    \end{aligned}`);
    diskView.redraw(); mlBar.redraw();
  }
  const mlColor = (tab, G, out) => {
    if (G >= tab.Gmax) { out[0] = out[1] = out[2] = 0.5; return; }
    const t = (G / tab.Gmax) * (tab.N - 1), i = Math.floor(t), f = t - i, a = i * 3;
    for (let c = 0; c < 3; c++) out[c] = tab.T[a + c] * (1 - f) + tab.T[a + 3 + c] * f;
    // orders above ~5 wash out to grey (the spectrum averages sin² to ½)
    const wash = Math.min(1, Math.max(0, (G - 4000) / 2000));
    for (let c = 0; c < 3; c++) out[c] = out[c] * (1 - wash) + 0.5 * wash;
  };
  function drawDisk(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!E) return;
    const st = E.st, m = E.m, S = Math.round(Math.min(hh - 80, w) * Math.min(2, window.devicePixelRatio || 1)), Rpx = S / 2;
    if (!E.img || E.img.S !== S) {
      const ic = imageCanvas(S, S), col = [0, 0, 0], na = wavelengthRGB(589, false), tab = st.scope === 'light' ? ML.light : ML.dark, al = st.alpha * D2R;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const o = (j * S + i) * 4;
        // 2×2 supersampling (fringes crowd near the load points)
        let r = 0, g = 0, b = 0, inside = 0;
        for (let q = 0; q < 4; q++) {
          const x = ((i + 0.25 + 0.5 * (q & 1)) / Rpx - 1) * (DISK_D / 2), y = (1 - (j + 0.25 + 0.5 * (q >> 1)) / Rpx) * (DISK_D / 2);
          if (x * x + y * y > (DISK_D / 2) ** 2 * 0.9999) continue;
          inside++;
          const pr = principal(diskStress(x, y, st.P, DISK_D, DISK_T)), G = retardation(m.C, DISK_T, pr.ds) * 1e9;
          const iso = st.scope === 'plane' ? Math.sin(2 * (pr.phi - al)) ** 2 : 1;
          if (st.src === 'na') {
            const s2 = Math.sin((Math.PI * G) / 589) ** 2, v = (st.scope === 'light' ? 1 - s2 : s2) * iso;
            r += na[0] * v; g += na[1] * v; b += na[2] * v;
          } else { mlColor(tab, G, col); r += col[0] * iso; g += col[1] * iso; b += col[2] * iso; }
        }
        if (!inside) { ic.data[o + 3] = 0; continue; }
        const k = 1 / 4, cov = inside / 4;
        ic.data[o] = 255 * oetf(Math.min(1, r * k / cov)) ; ic.data[o + 1] = 255 * oetf(Math.min(1, g * k / cov)); ic.data[o + 2] = 255 * oetf(Math.min(1, b * k / cov)); ic.data[o + 3] = 255 * cov;
      }
      ic.put();
      E.img = { S, c: ic.c };
    }
    const D = S / Math.min(2, window.devicePixelRatio || 1), cx = w / 2, cy = hh / 2 + 8;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(E.img.c, cx - D / 2, cy - D / 2, D, D);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, D / 2, 0, 7); ctx.stroke();
    // load arrows
    ctx.fillStyle = '#ffb547'; ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2.5;
    for (const sg of [-1, 1]) {
      const y0 = cy + sg * (D / 2 + 18), y1 = cy + sg * (D / 2 + 3);
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1 - sg * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, y1); ctx.lineTo(cx - 6, y1 - sg * 9); ctx.lineTo(cx + 6, y1 - sg * 9); ctx.fill();
    }
    ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`P = ${st.P >= 1000 ? (st.P / 1000).toPrecision(3) + ' kN' : st.P.toPrecision(3) + ' N'}`, cx + 10, cy + D / 2 + 16);
    if (st.scope === 'plane') {
      const R = 22, x0 = w - 40, y0 = 40, a = st.alpha * D2R;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x0, y0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#6ad7ff'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x0 - R * Math.cos(a), y0 + R * Math.sin(a)); ctx.lineTo(x0 + R * Math.cos(a), y0 - R * Math.sin(a)); ctx.stroke();
      ctx.strokeStyle = '#ff9cc0';
      ctx.beginPath(); ctx.moveTo(x0 + R * Math.sin(a), y0 + R * Math.cos(a)); ctx.lineTo(x0 - R * Math.sin(a), y0 - R * Math.cos(a)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('polariser / analyser', x0 - 10, y0 + R + 14);
    }
  }
  function drawML(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!E) return;
    const Gmax = 2000, pad = 14, top = 30, bw = w - 2 * pad, bh = hh - top - 28, col = [0, 0, 0];
    const ic = imageCanvas(Math.max(1, Math.round(bw)), 1);
    for (let i = 0; i < ic.c.width; i++) {
      mlColor(E.st.scope === 'light' ? ML.light : ML.dark, (i / ic.c.width) * Gmax, col);
      const o = i * 4; ic.data[o] = 255 * oetf(Math.min(1, col[0])); ic.data[o + 1] = 255 * oetf(Math.min(1, col[1])); ic.data[o + 2] = 255 * oetf(Math.min(1, col[2])); ic.data[o + 3] = 255;
    }
    ic.put();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ic.c, pad, top, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    for (let G = 0; G <= Gmax; G += 250) { const x = pad + (G / Gmax) * bw; ctx.fillRect(x, top + bh, 1, 4); if (G % 500 === 0) ctx.fillText(G + ' nm', x, hh - 6); }
    for (const [G, lab2] of [[551, '1st-order red'], [1101, '2nd'], [1652, '3rd']]) { const x = pad + (G / Gmax) * bw; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x, top, 1, bh); ctx.fillStyle = '#05060a'; ctx.fillText(lab2, x, top + 12); }
    if (E.GC <= Gmax) {
      const x = pad + (E.GC / Gmax) * bw;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, top + bh); ctx.lineTo(x - 6, top + bh + 9); ctx.lineTo(x + 6, top + bh + 9); ctx.fill();
    }
  }

  // ── birefringent optical low-pass filter ──
  const sec3 = h('section.block', {}, h('h2', {}, 'Birefringence: the optical low-pass filter'));
  const bctl = controls({
    xtal: { type: 'select', label: 'Crystal', value: 'quartz', options: Object.entries(CRYSTALS).map(([k, c]) => [k, `${c.name} (nₒ ${c.no}, nₑ ${c.ne})`]) },
    th: { type: 'range', label: 'Optic axis to plate normal', min: 0, max: 90, step: 0.5, value: 45, unit: '°' },
    t: { type: 'range', label: 'Plate thickness', min: 0.05, max: 3, log: true, value: 0.75, unit: 'mm' },
    pitch: { type: 'range', label: 'Pixel pitch', min: 1, max: 10, step: 0.05, value: 4.4, unit: 'µm' },
  }, () => updateOLPF());
  const bro = h('div');
  const bcalc = liveCalc();
  const side = stage({ aspect: 3, label: 'Plate in section: the ordinary ray goes straight, the extraordinary ray walks off (lateral scale exaggerated)', draw: drawSide, minH: 150 });
  const wplot = stage({ aspect: 1.35, label: '', draw: drawWalk, cls: 'plain', minH: 220 });
  const spots = stage({ aspect: 1.35, label: 'Two crossed plates + depolariser: four spots on the Bayer pixels', draw: drawSpots, minH: 220 });
  sec3.append(lab([side.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, wplot.el), spots.el)], [h('div.card', {}, bctl.el), h('div.card', {}, bro), bcalc.el]));
  root.append(sec3);
  let B = null;
  function updateOLPF() {
    const st = bctl.state, c = CRYSTALS[st.xtal], rho = walkOff(c.no, c.ne, st.th * D2R), rmax = maxWalkOff(c.no, c.ne);
    const d = st.t * 1000 * Math.tan(Math.abs(rho)), tNeed = st.pitch / 1000 / Math.abs(Math.tan(rmax));
    B = { st, c, rho, rmax, d };
    bro.replaceChildren(readouts([
      ['Walk-off angle ρ', (Math.abs(rho) / D2R).toFixed(3) + '°'],
      ['Spot separation d', d.toFixed(2) + ' µm'],
      ['…in pixels', (d / st.pitch).toFixed(2)],
      ['Maximum walk-off (θ = arctan nₑ/nₒ)', (Math.abs(rmax) / D2R).toFixed(3) + '° at ' + (Math.atan(c.ne / c.no) / D2R).toFixed(2) + '°'],
      ['Thickness for d = pitch', (tNeed).toFixed(3) + ' mm'],
      ['MTF zero 1/(2d) vs Nyquist 1/(2p)', `${(1000 / (2 * d)).toFixed(0)} vs ${(1000 / (2 * st.pitch)).toFixed(0)} lp/mm`],
    ]));
    bcalc.set(String.raw`\begin{aligned}
    |\tan\rho| &= \frac{|1-r|\tan\theta}{1+r\tan^2\theta} = ${texNum(Math.tan(Math.abs(rho)), 4)},\quad r = \frac{n_o^2}{n_e^2}\\
    d &= t\tan\rho = ${texNum(d, 4)}\ \text{µm}\\
    \nu_0 &= \frac{1}{2d} = ${texNum(1000 / (2 * d), 4)}\ \text{lp/mm}
    \end{aligned}`);
    [side, wplot, spots].forEach((x) => x.redraw());
  }
  function drawSide(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!B) return;
    const x0 = w * 0.38, x1 = w * 0.62, y0 = hh * 0.2, y1 = hh * 0.8, yc = hh / 2;
    ctx.fillStyle = 'rgba(106,215,255,0.08)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(106,215,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // optic-axis hatching at θ to the plate normal (the x axis here)
    const th = B.st.th * D2R;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.strokeStyle = 'rgba(106,215,255,0.18)';
    for (let k = -20; k <= 20; k++) { const ox = (x0 + x1) / 2 + k * 14; ctx.beginPath(); ctx.moveTo(ox - 200 * Math.cos(th), yc + 200 * Math.sin(th)); ctx.lineTo(ox + 200 * Math.cos(th), yc - 200 * Math.sin(th)); ctx.stroke(); }
    ctx.restore();
    // exaggerate the walk-off so that d is visible
    const ex = Math.max(1, Math.round(((y1 - y0) * 0.35) / Math.max(1e-6, (x1 - x0) * Math.tan(Math.abs(B.rho)))));
    const dy = Math.min((y1 - y0) * 0.45, (x1 - x0) * Math.tan(Math.abs(B.rho)) * ex) * (B.rho < 0 ? 1 : -1) * (th > 0 ? 1 : 0);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(20, yc); ctx.lineTo(x0, yc); ctx.stroke();
    ctx.strokeStyle = '#ff9cc0'; ctx.beginPath(); ctx.moveTo(x0, yc); ctx.lineTo(x1, yc); ctx.lineTo(w - 20, yc); ctx.stroke();
    ctx.strokeStyle = '#6be3a4'; ctx.beginPath(); ctx.moveTo(x0, yc); ctx.lineTo(x1, yc - dy); ctx.lineTo(w - 20, yc - dy); ctx.stroke();
    ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ff9cc0'; ctx.fillText('ordinary (⊥ principal plane)', x1 + 10, yc + 15);
    ctx.fillStyle = '#6be3a4'; ctx.fillText('extraordinary (in principal plane)', x1 + 10, yc - dy - 7);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'center';
    ctx.fillText(`optic axis at ${B.st.th}° · d = ${B.d.toFixed(2)} µm · lateral scale × ${ex}`, (x0 + x1) / 2, y1 + 16);
  }
  function drawWalk(ctx, w, hh) {
    if (!B) return;
    const th = range(0, 90, 181), col = { quartz: '#6ad7ff', linbo3: '#ffb547', calcite: '#c18cff' };
    plot(ctx, w, hh, {
      title: 'Walk-off vs optic-axis angle', x: { min: 0, max: 90, step: 15, label: 'optic axis to plate normal θ (°)' }, y: { min: 1, max: 200, log: true, label: 'displacement per mm (µm)' },
      series: Object.entries(CRYSTALS).map(([k, c]) => ({ data: th.map((t) => [t, Math.max(1, 1000 * Math.abs(Math.tan(walkOff(c.no, c.ne, t * D2R))))]), color: col[k], width: k === B.st.xtal ? 2.4 : 1.2, label: c.name })),
      vlines: [{ x: B.st.th, color: 'rgba(255,255,255,0.4)' }],
      legend: true, legendX: 70, legendY: hh - 92,
    });
  }
  function drawSpots(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    if (!B) return;
    const p = B.st.pitch, sc = Math.min(w, hh) / (4.5 * p), cx = w / 2, cy = hh / 2;
    const bayer = [['#ff6b6b', '#6be3a4'], ['#6be3a4', '#6ad7ff']];
    for (let j = -3; j < 3; j++) for (let i = -4; i < 4; i++) {
      ctx.fillStyle = bayer[(j + 4) % 2][(i + 4) % 2]; ctx.globalAlpha = 0.18;
      ctx.fillRect(cx + i * p * sc + 1, cy + j * p * sc + 1, p * sc - 2, p * sc - 2);
    }
    ctx.globalAlpha = 1;
    // spots: first plate splits horizontally, the depolariser scrambles, the second splits vertically
    const d = B.d * sc;
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = cx - p * sc / 2 + ox * d, y = cy - p * sc / 2 + oy * d;
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(3, p * sc * 0.25));
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(3, p * sc * 0.25), 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`d = ${B.d.toFixed(2)} µm, pitch ${p} µm`, 8, hh - 8);
  }

  update();
  updateChain();
  updateStress();
  updateOLPF();

  root.append(theory('The vector nature of light', String.raw`
<div class="theory-cols"><div>
<h3>Stokes vectors and Mueller matrices</h3>
<p>Natural light is a random superposition of polarisation states. Its measurable content is four intensities, the Stokes vector</p>
\[\mathbf S = \begin{pmatrix} I \\ Q \\ U \\ V\end{pmatrix} = \begin{pmatrix} I_{0^\circ}+I_{90^\circ} \\ I_{0^\circ}-I_{90^\circ} \\ I_{45^\circ}-I_{-45^\circ} \\ I_\text{R}-I_\text{L}\end{pmatrix},\qquad P = \frac{\sqrt{Q^2+U^2+V^2}}{I}\le 1 .\]
<p>Every linear optical element maps \(\mathbf S\) to \(\mathbf M\mathbf S\) with a 4×4 Mueller matrix. An ideal linear polariser with its axis at \(\theta\) is</p>
\[\mathbf M_\text{pol}(\theta)=\tfrac12\begin{pmatrix}1&\cos2\theta&\sin2\theta&0\\ \cos2\theta&\cos^22\theta&\cos2\theta\sin2\theta&0\\ \sin2\theta&\cos2\theta\sin2\theta&\sin^22\theta&0\\0&0&0&0\end{pmatrix},\]
<p>and Malus's law \(I = I_0\cos^2(\theta_2-\theta_1)\) follows from multiplying two of them. Three polarisers at 0°, 45° and 90° pass \(\tfrac12\cdot\tfrac12\cdot\tfrac12 = \tfrac18\) of unpolarised light, although the first and last alone pass nothing. The middle one does not let light through; it <em>creates</em> a new state that has a component along the analyser. A quarter-wave plate at 45° turns linear light circular, which is why photographic polarisers are <em>circular</em>: a linear polariser followed by a λ/4 plate, so the light reaching phase-detection and metering beam splitters is no longer linearly polarised.</p>
<p>Real filters are not ideal. This page uses \(k_1 = 0.80\) along the axis and \(k_2 = 0.002\) across it, which gives the familiar filter factor of 1.3 EV for unpolarised light.</p>
<h3>Fresnel reflection and Brewster's angle</h3>
<p>At an interface the field components perpendicular (s) and parallel (p) to the plane of incidence reflect with different amplitudes:</p>
\[r_s=\frac{n_1\cos\theta_i-n_2\cos\theta_t}{n_1\cos\theta_i+n_2\cos\theta_t},\qquad r_p=\frac{n_2\cos\theta_i-n_1\cos\theta_t}{n_2\cos\theta_i+n_1\cos\theta_t}.\]
<p>\(r_p\) vanishes when the reflected and refracted rays are perpendicular, at \(\tan\theta_B = n_2/n_1\): 53.1° for water and 56.6° for crown glass. There the reflection is fully s-polarised (horizontal for a lake) and a vertical polariser extinguishes it. In Mueller form, with the frame (\(\hat s\), \(\hat k\times\hat s\)),</p>
\[\mathbf M_R = \begin{pmatrix}\tfrac{R_s+R_p}{2}&\tfrac{R_s-R_p}{2}&0&0\\ \tfrac{R_s-R_p}{2}&\tfrac{R_s+R_p}{2}&0&0\\0&0&r_sr_p&0\\0&0&0&r_sr_p\end{pmatrix},\]
<p>and transmission has the same form with \(T_{s,p} = 1-R_{s,p}\). The transmitted light is therefore partly p-polarised, so the filter that removes the glare <em>also passes more of the light from below the surface</em>. That is why the pebbles appear.</p>
</div><div>
<h3>The polarised blue sky</h3>
<p>Air molecules are much smaller than the wavelength, so each one radiates like a dipole driven by the incident field. Light scattered through the angle \(\gamma\) from the sun has the phase function \(\tfrac34(1+\cos^2\gamma)\) and the degree of polarisation</p>
\[P(\gamma) = P_\text{max}\,\frac{\sin^2\gamma}{1+\cos^2\gamma},\]
<p>with the E-vector perpendicular to the plane containing the sun and the line of sight. The polarisation peaks on the great circle 90° from the sun, which is where a polariser darkens the sky most. Pure single scattering by air (depolarisation factor 0.028) gives \(P_\text{max} = 0.94\). Multiple scattering, aerosols and light reflected from the ground lower it to 0.6–0.8 on clear days and produce the Arago, Babinet and Brewster neutral points, which this single-scattering model does not show.</p>
<p>The sky radiance uses the single-scattering solution for a homogeneous slab of Rayleigh optical depth \(\tau(\lambda)\) seen from the ground (Chandrasekhar 1950):</p>
\[L(\mu_v) = \frac{F_0}{4\pi}\tfrac34(1+\cos^2\gamma)\,\frac{\mu_s}{\mu_s-\mu_v}\left(e^{-\tau/\mu_s}-e^{-\tau/\mu_v}\right),\]
\[\tau(\lambda) = 0.008569\,\lambda^{-4}\left(1+0.0113\lambda^{-2}+0.00013\lambda^{-4}\right)\ (\lambda\text{ in µm}),\]
<p>evaluated at 16 wavelengths for a 5778 K sun and converted to sRGB with the CIE 1931 colour-matching functions. It gives a deep blue zenith, a pale horizon and a yellow low sun without any tuning. Ozone and aerosols are not modelled.</p>
<h3>What each pixel computes</h3>
<p>A camera ray that hits the (rippled) water is split in two. Its mirror direction looks up into the sky: the skylight Stokes vector is rotated from the scattering-plane frame into the plane-of-incidence frame, multiplied by \(\mathbf M_R\), and rotated into the frame of the filter. Its refracted direction reaches the pebbles at depth \(D\). They are lit by the sun and sky through the surface, and pure-water absorption (Pope &amp; Fry 1997) acts on the way down and up, which turns deep water blue-green. The light from below leaves through \(\mathbf M_T\), with radiance divided by \(n^2\). The camera meters the unfiltered scene and compensates the filter factor, so rotating the filter changes only polarised light.</p>
<p>Ripples tilt the local normal, so the Brewster condition holds only on average, and waves smaller than a pixel are averaged out. Single scattering, a flat-Earth atmosphere, specular water and grey pebbles are the stated approximations.</p>
</div></div>`));
  root.append(theory('Birefringence: two indices in one material', String.raw`
<div class="theory-cols"><div>
<h3>Uniaxial crystals and walk-off</h3>
<p>In a uniaxial crystal the ordinary wave sees \(n_o\) in every direction. The extraordinary wave, polarised in the plane containing the optic axis, sees an index between \(n_o\) and \(n_e\) that depends on its direction. Its energy (the Poynting vector) is not parallel to its wave vector. For a wave normal at \(\theta\) to the optic axis the ray deviates by</p>
\[\tan\rho = \frac{(1-n_o^2/n_e^2)\tan\theta}{1+(n_o^2/n_e^2)\tan^2\theta},\qquad \tan\rho_\text{max} = \frac{|n_e^2-n_o^2|}{2n_on_e}\ \text{at}\ \tan\theta = \frac{n_e}{n_o}.\]
<p>At normal incidence on a plate of thickness \(t\), the two polarisations leave as parallel beams displaced by \(d = t\tan\rho\). Quartz gives 5.9 µm per mm, lithium niobate 39 µm per mm and calcite 110 µm per mm. That is why calcite makes dramatic double images, and why a quartz OLPF for 4–6 µm pixels is about a millimetre thick.</p>
<h3>The optical low-pass filter</h3>
<p>One plate splits each image point into two copies a distance \(d\) apart. A quarter-wave plate (or depolariser) makes both copies circular, and a second plate, rotated 90°, splits each again. The four equal spots form a square of side \(d\), whose transfer function is \(|\cos\pi\nu_x d|\,|\cos\pi\nu_y d|\). With \(d = p\) the first zero falls exactly at the Nyquist frequency \(1/(2p)\), suppressing the moiré and colour aliasing shown in the <a href="#/sampling">sampling lab</a>. The price is a small loss of MTF below Nyquist, which is why many modern cameras omit the filter or cancel it with a second, reversed plate.</p>
</div><div>
<h3>Stress birefringence and photoelasticity</h3>
<p>An isotropic material under stress becomes birefringent. The index difference along the principal stress directions is proportional to the stress difference (Brewster 1816; Maxwell 1853):</p>
\[n_1-n_2 = C(\sigma_1-\sigma_2),\qquad \Gamma = Ct(\sigma_1-\sigma_2),\qquad N = \frac{\Gamma}{\lambda} = \frac{t(\sigma_1-\sigma_2)}{f_\sigma}.\]
<p>In a circular polariscope (polariser, λ/4, sample, λ/4, analyser) the transmitted intensity is \(\sin^2(\pi\Gamma/\lambda)\), independent of the stress direction. The fringes are therefore <em>isochromatics</em>, lines of constant \(\sigma_1-\sigma_2\). In white light each order has its interference colour (the Michel-Lévy sequence), and first-order red at Γ ≈ 551 nm is the most sensitive tint. A plane polariscope multiplies by \(\sin^2 2(\varphi-\alpha)\), adding dark <em>isoclinics</em> where a principal stress is parallel to the polariser.</p>
<p>The disk under diametral compression has the closed-form stress field of Hertz (1883):</p>
\[\sigma_y = -\frac{2P}{\pi t}\left[\frac{(R-y)^3}{r_1^4}+\frac{(R+y)^3}{r_2^4}-\frac1D\right],\]
<p>with similar expressions for \(\sigma_x\) and \(\tau_{xy}\). At the centre \(\sigma_1-\sigma_2 = 8P/(\pi Dt)\), which is how the fringe value \(f_\sigma\) of a photoelastic material is calibrated. The same physics limits optics. Mounting forces and annealing residue in a lens of N-BK7 (C = 2.77 Br) produce nanometres of retardance. That is harmless for photography, but it matters for polarimeters, interferometers and the polarisation-sensitive coronagraphs of space telescopes. Glass makers specify it in nm/cm.</p>
<p>The page treats the colour of the stress pattern as dispersion-free (the same Γ at every wavelength), assumes plane stress, and uses an equal-energy white source.</p>
</div></div>`));
  root.append(references([
    'M. Born &amp; E. Wolf, <em>Principles of Optics</em>, 7th ed., §1.5 (Fresnel formulae) and §10.8 (Stokes parameters), Cambridge University Press (1999).',
    'E. Collett, <em>Field Guide to Polarization</em>, SPIE Press (2005); D. Goldstein, <em>Polarized Light</em>, 3rd ed., CRC Press (2011).',
    'S. Chandrasekhar, <em>Radiative Transfer</em>, Oxford (1950), ch. I and X (Rayleigh scattering, the polarised sky).',
    'J. E. Hansen &amp; L. D. Travis, “Light scattering in planetary atmospheres”, <em>Space Sci. Rev.</em> 16, 527 (1974): Rayleigh optical depth.',
    'K. L. Coulson, <em>Polarization and Intensity of Light in the Atmosphere</em>, A. Deepak (1988); G. P. Können, <em>Polarized Light in Nature</em>, Cambridge (1985).',
    'M. M. Frocht, <em>Photoelasticity</em>, vol. 2, Wiley (1948); J. W. Dally &amp; W. F. Riley, <em>Experimental Stress Analysis</em>, 4th ed., ch. 13–14 (2005): disk in diametral compression, isochromatics and isoclinics.',
    'A. Yariv &amp; P. Yeh, <em>Optical Waves in Crystals</em>, Wiley (1984), ch. 4: walk-off in uniaxial crystals; Schott Technical Information TIE-27, <em>Stress in optical glass</em> (2004).',
    'R. M. Pope &amp; E. S. Fry, “Absorption spectrum (380–700 nm) of pure water. II”, <em>Appl. Opt.</em> 36, 8710 (1997).',
  ]));

  return () => { alive = false; [scene, skymap, fplot, chainView, malus, diskView, mlBar, side, wplot, spots].forEach((s) => s.destroy()); };
}
