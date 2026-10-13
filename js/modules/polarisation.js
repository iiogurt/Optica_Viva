import { h, controls, stage, readouts, imageCanvas, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { run } from '../lib/compute.js';
import { plot, range } from '../lib/plot.js';
import { oetf, colormap } from '../lib/color.js';
import { polariser, retarder, mapply, ellipse, fresnelAmp, brewster, rayleighDoP } from '../lib/polar.js';

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

  update();
  updateChain();

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
  root.append(references([
    'M. Born &amp; E. Wolf, <em>Principles of Optics</em>, 7th ed., §1.5 (Fresnel formulae) and §10.8 (Stokes parameters), Cambridge University Press (1999).',
    'E. Collett, <em>Field Guide to Polarization</em>, SPIE Press (2005); D. Goldstein, <em>Polarized Light</em>, 3rd ed., CRC Press (2011).',
    'S. Chandrasekhar, <em>Radiative Transfer</em>, Oxford (1950), ch. I and X (Rayleigh scattering, the polarised sky).',
    'J. E. Hansen &amp; L. D. Travis, “Light scattering in planetary atmospheres”, <em>Space Sci. Rev.</em> 16, 527 (1974): Rayleigh optical depth.',
    'K. L. Coulson, <em>Polarization and Intensity of Light in the Atmosphere</em>, A. Deepak (1988); G. P. Können, <em>Polarized Light in Nature</em>, Cambridge (1985).',
    'R. M. Pope &amp; E. S. Fry, “Absorption spectrum (380–700 nm) of pure water. II”, <em>Appl. Opt.</em> 36, 8710 (1997).',
  ]));

  return () => { alive = false; [scene, skymap, fplot, chainView, malus].forEach((s) => s.destroy()); };
}
