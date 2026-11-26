// Gaussian laser beams: the waist, the Rayleigh range and the far-field angle, a lens that focuses a
// beam (where the waist lands is not the focal point), the Gouy phase, the beam quality M², and what a
// hard aperture does to the focus. The q-parameter laws are checked live against the Fresnel integral.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paintMap } from '../lib/pixels.js';
import { lut, wavelengthRGB } from '../lib/color.js';
import { latest } from '../lib/compute.js';
import { rayleigh, divergence, beamOf, qWaist, propagate, lens, focus } from '../lib/gaussbeam.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno');
const css = (nm) => { const c = wavelengthRGB(Math.min(680, Math.max(420, nm)), false), m = Math.max(...c); return `rgba(${c.map((v) => Math.round(255 * (0.3 + (0.7 * v) / m))).join(',')},`; };
const um = (m) => (m < 1e-3 ? `${fmt(m * 1e6, 3)} µm` : `${fmt(m * 1e3, 3)} mm`);

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['photo', 'space'] }));
  root.append(idea(String.raw`<p>A laser beam looks like a thin straight rod of light, but it is not quite: it has a narrowest place, the <em>waist</em>, and spreads slowly on both sides. Close to the waist it stays almost the same width; far away it widens at a fixed small angle, like a very narrow cone.</p>
<p>A lens can squeeze the beam into a tiny spot. The thinner the spot, the faster the beam spreads again behind it, so a sharp focus is always a short one. Real lasers are a little worse than the ideal beam; a single number, M², says by how much.</p>`, [
    'Make the laser’s <strong>waist</strong> ten times smaller: does the beam spread more or less far away?',
    'Move the lens <strong>far from the laser</strong> and watch the focus: is it at the lens’s focal length?',
    'Shrink the <strong>clear aperture</strong> of the lens to the beam’s own radius: what appears around the focused spot?',
  ]));

  const ctl = controls({
    lam: { type: 'range', label: 'Wavelength', min: 400, max: 1600, step: 5, value: 633, unit: 'nm' },
    w0: { type: 'range', label: 'Waist radius of the laser beam', min: 0.05, max: 5, log: true, value: 0.5, fmt: (v) => `${fmt(v, 3)} mm` },
    M2: { type: 'range', label: 'Beam quality M²', min: 1, max: 5, step: 0.1, value: 1 },
    s: { type: 'range', label: 'Distance from the waist to the lens', min: 0.01, max: 20, log: true, value: 1, fmt: (v) => `${fmt(v, 3)} m` },
    f: { type: 'range', label: 'Focal length of the lens', min: 10, max: 1000, log: true, value: 100, fmt: (v) => `${fmt(v, 3)} mm` },
    aRel: { type: 'range', label: 'Clear radius of the lens (in beam radii)', min: 0.5, max: 4, step: 0.05, value: 3 },
    zs: { type: 'range', label: 'Screen behind the lens (Rayleigh ranges from the focus)', min: -4, max: 4, step: 0.1, value: 0 },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const side = stage({ aspect: 2.6, label: 'The beam: from the laser’s waist to the lens, and from the lens through the focus', draw: drawSide, minH: 220 });
  const cross = stage({ aspect: 1, label: 'The spot on the screen (computed field)', draw: drawCross, minH: 230 });
  const prof = stage({ aspect: 1, label: '', draw: drawProf, cls: 'plain', minH: 230 });
  const wz = stage({ aspect: 2.3, label: '', draw: drawWz, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing the field behind the lens…'));
  const card = (s) => h('div.card', { style: { padding: '6px' } }, s.el);
  root.append(lab([side.el, h('div.grid-2', {}, cross.el, card(prof)), note, card(wz)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  const job = latest('gaussBeam');
  let N = null, nKey = '', timer = 0;
  // the beam as the analytic laws give it, in metres
  function model(st) {
    const lam = st.lam * 1e-9, w0 = st.w0 / 1000, s = st.s, f = st.f / 1000, M2 = st.M2;
    const zR = rayleigh(w0, lam, M2), qL = propagate(qWaist(w0, lam, M2), s), atLens = beamOf(qL, lam, M2), qA = lens(qL, f), F = focus(w0, lam, M2, s, f);
    const after = (z) => beamOf(propagate(qA, z), lam, M2);
    return { lam, w0, s, f, M2, zR, atLens, F, after, zScreen: Math.max(1e-6, F.sp + st.zs * F.zRp), theta: divergence(w0, lam, M2) };
  }
  function update() {
    const st = ctl.state, m = model(st);
    words(st, m);
    side.redraw(); wz.redraw();
    // the computed field: the embedded Gaussian (M² = 1, waist w₀/M), widths scaled by M (Siegman)
    const key = JSON.stringify([st.lam, st.w0, st.M2, st.s, st.f, st.aRel, st.zs]);
    if (key === nKey) return;
    nKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const M = Math.sqrt(m.M2), zs = Array.from({ length: 9 }, (_, i) => Math.max(1e-6, m.F.sp + (i - 4) * m.F.zRp));
      note.textContent = t('Computing the field behind the lens…');
      job('gaussBeam', { w0: m.w0 / M, lam: m.lam, s: m.s, f: m.f, aRel: st.aRel, zs, zScreen: m.zScreen, nr: 200 }).then((r) => {
        N = { ...r, key, M, zs, st: { ...st } };
        note.textContent = (m.M2 > 1 ? t('For M² > 1 the computed field is the embedded Gaussian (waist w₀/M), its widths scaled by M; a real multimode beam is not Gaussian in shape.') + ' ' : '') + t('The spot is the Fresnel integral of the beam through the lens (clear radius {a}), independent of the q-parameter laws; the dashed circle is their 1/e² radius.', { a: um(r.a * M) });
        cross.redraw(); prof.redraw(); wz.redraw();
      }, (e) => console.error(e));
    }, N ? 150 : 0);
  }
  function words(st, m) {
    ro.replaceChildren(readouts([
      ['Rayleigh range of the laser', `${fmt(m.zR, 3)} m`],
      ['Far-field half-angle M²λ/πw₀', `${fmt(m.theta * 1e3, 3)} mrad`],
      ['Beam radius at the lens', um(m.atLens.w)],
      ['Focused waist radius', um(m.F.w0p)],
      ['Waist behind the lens (focal length)', `${fmt(m.F.sp * 1000, 4)} mm (${fmt(m.f * 1000, 4)} mm)`],
      ['Depth of focus 2z′_R', um(2 * m.F.zRp)],
    ]));
    const shift = (m.F.sp - m.f) * 1000;
    calc.say(t('The lens squeezes the beam to a waist of <strong>{w}</strong> radius, <strong>{d} mm</strong> behind it, {sh}; the spot stays that small over only <strong>{dof}</strong>.', {
      w: um(m.F.w0p), d: fmt(m.F.sp * 1000, 4), dof: um(2 * m.F.zRp),
      sh: Math.abs(shift) < 1e-3 * m.f * 1000 ? t('at the focal plane') : shift > 0 ? t('{x} mm beyond the focal plane', { x: fmt(shift, 3) }) : t('{x} mm before the focal plane', { x: fmt(-shift, 3) }),
    }));
    calc.set(String.raw`\begin{aligned}
    z_R &= \frac{\pi w_0^2}{M^2\lambda} = ${texNum(m.zR, 3)}\ \text{m}\\
    w(s) &= w_0\sqrt{1 + (s/z_R)^2} = ${texNum(m.atLens.w * 1e3, 3)}\ \text{mm}\\
    q' &= \frac{q}{1 - q/f},\quad q = s + i z_R\\
    w_0' &= ${texNum(m.F.w0p * 1e6, 3)}\ \mu\text{m},\quad s' = ${texNum(m.F.sp * 1e3, 4)}\ \text{mm}
    \end{aligned}`);
  }

  // two panels: before the lens (laser waist → lens) and after it (lens → beyond the focus)
  function drawSide(ctx, w, hh) {
    const st = ctl.state, m = model(st), col = css(st.lam), top = 30, bot = hh - 24, mid = (top + bot) / 2, half = (bot - top) / 2 - 6;
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    const split = w * 0.38, panels = [
      { x0: 8, x1: split - 8, z0: 0, z1: m.s, wAt: (z) => beamOf(propagate(qWaist(m.w0, m.lam, m.M2), z), m.lam, m.M2).w, waists: [0], zR: m.zR },
      { x0: split + 8, x1: w - 8, z0: 0, z1: Math.max(m.F.sp + 3 * m.F.zRp, m.f * 1.2), wAt: (z) => m.after(z).w, waists: [m.F.sp], zR: m.F.zRp },
    ];
    ctx.font = '10.5px "JetBrains Mono", monospace';
    panels.forEach((p, k) => {
      const n = 200, zs = Array.from({ length: n + 1 }, (_, i) => p.z0 + ((p.z1 - p.z0) * i) / n), ws = zs.map(p.wAt), wmax = Math.max(...ws), X = (z) => p.x0 + ((z - p.z0) / (p.z1 - p.z0)) * (p.x1 - p.x0), Y = (v) => (v / wmax) * half;
      // the Rayleigh range around the waist
      for (const zw of p.waists) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(X(Math.max(p.z0, zw - p.zR)), top, Math.max(1, X(Math.min(p.z1, zw + p.zR)) - X(Math.max(p.z0, zw - p.zR))), bot - top); }
      // the beam: a band of ±w(z), brighter where it is narrow (irradiance ∝ 1/w²)
      for (let i = 0; i < n; i++) {
        const a = Math.min(1, (0.25 * Math.min(...ws)) / ws[i] + 0.2);
        ctx.fillStyle = `${col}${(0.25 + 0.65 * a).toFixed(3)})`;
        ctx.fillRect(X(zs[i]), mid - Y(ws[i]), X(zs[i + 1]) - X(zs[i]) + 0.5, 2 * Y(ws[i]));
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(p.x0, mid); ctx.lineTo(p.x1, mid); ctx.stroke(); ctx.setLineDash([]);
      for (const zw of p.waists) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(X(zw), mid - Y(p.wAt(zw)) - 6); ctx.lineTo(X(zw), mid + Y(p.wAt(zw)) + 6); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(k ? t('after the lens: {z}, full height ±{w}', { z: p.z1 >= 1 ? `${fmt(p.z1, 3)} m` : `${fmt(p.z1 * 1000, 3)} mm`, w: um(wmax) }) : t('laser to lens: {z}, full height ±{w}', { z: `${fmt(p.z1, 3)} m`, w: um(wmax) }), p.x0, hh - 8);
      if (k) {
        // the geometric focal plane
        const xf = X(m.f);
        ctx.strokeStyle = 'rgba(255,181,71,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xf, top); ctx.lineTo(xf, bot); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,181,71,0.9)'; ctx.fillText('f', xf + 3, top + 10);
        const xsN = X(m.zScreen);
        ctx.strokeStyle = 'rgba(106,215,255,0.9)'; ctx.beginPath(); ctx.moveTo(xsN, top); ctx.lineTo(xsN, bot); ctx.stroke();
      }
    });
    // the lens
    ctx.strokeStyle = 'rgba(200,220,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(split, mid, 5, half + 4, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.lineWidth = 1;
  }
  function drawCross(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!N) return;
    const { rs, I } = N, n = 160, R = rs[rs.length - 1] * N.M, top = I[0] || Math.max(...I), a = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = (Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)) * R / N.M, tt = (r / rs[rs.length - 1]) * (rs.length - 1), i = Math.floor(tt);
      a[y * n + x] = i >= rs.length - 1 ? 0 : (I[i] + (I[i + 1] - I[i]) * (tt - i)) / top;
    }
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    paintMap(cross, { x: x0, y: y0, w: sz, h: sz }, { a, w: n, h: n, lut: INF, pre: (v) => Math.log10(Math.max(v, 1e-6)), value: (v) => (v + 5) / 5 }, N.key);
    const m = model(N.st), wS = m.after(m.zScreen).w;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, (wS / R) * (sz / 2), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    const txt = t('±{r}; log irradiance, 10⁻⁵ … 1', { r: um(R) });
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function drawProf(ctx, w, hh) {
    if (!N) { plot(ctx, w, hh, { title: 'Across the spot: computed and Gaussian', x: { min: 0, max: 1, label: 'radius (µm)' }, y: { min: 1e-6, max: 2, log: true, label: 'irradiance (relative to the centre)' }, series: [] }); return; }
    const m = model(N.st), wS = m.after(m.zScreen).w, top = N.I[0] || 1, xs = N.rs.map((r) => r * N.M * 1e6);
    plot(ctx, w, hh, {
      title: 'Across the spot: computed and Gaussian', x: { min: 0, max: xs[xs.length - 1], label: 'radius (µm)' }, y: { min: 1e-6, max: 2, log: true, label: 'irradiance (relative to the centre)' },
      series: [
        { data: xs.map((x, i) => [x, Math.max(1e-7, N.I[i] / top)]), color: '#ffffff', width: 2, label: t('computed (Fresnel integral)') },
        { data: xs.map((x) => [x, Math.exp((-2 * (x * 1e-6) ** 2) / (wS * wS))]), color: '#ffb547', width: 1.4, dash: [5, 3], label: t('Gaussian of radius w(z)') },
      ],
      vlines: [{ x: wS * 1e6, color: 'rgba(255,255,255,0.35)' }], hlines: [{ y: Math.exp(-2), color: 'rgba(255,255,255,0.25)' }], legend: true,
    });
  }
  function drawWz(ctx, w, hh) {
    const m = model(ctl.state), z1 = m.F.sp + 4 * m.F.zRp, z0 = Math.max(0, m.F.sp - 4 * m.F.zRp), xs = Array.from({ length: 200 }, (_, i) => z0 + ((z1 - z0) * i) / 199);
    const dots = N && N.key === nKey ? N.zs.map((z, i) => [(z - m.F.sp) / m.F.zRp, N.widths[i] * N.M * 1e6]).filter((p) => isFinite(p[1])) : [];
    plot(ctx, w, hh, {
      title: 'Beam radius through the focus, and the Gouy phase', x: { min: (z0 - m.F.sp) / m.F.zRp, max: 4, label: 'distance from the waist (Rayleigh ranges)' }, y: { min: 0, max: m.after(z1).w * 1.15e6, label: 'radius w (µm)' },
      series: [
        { data: xs.map((z) => [(z - m.F.sp) / m.F.zRp, m.after(z).w * 1e6]), color: '#ffb547', width: 2.2, label: t('w(z) from the q-parameter') },
        { data: dots, color: '#6ad7ff', points: true, label: t('computed (Fresnel integral)') },
        { data: xs.map((z) => [(z - m.F.sp) / m.F.zRp, ((Math.atan((z - m.F.sp) / m.F.zRp) / Math.PI + 0.5) * m.after(z1).w * 1e6)]), color: 'rgba(197,139,255,0.8)', width: 1.4, dash: [4, 3], label: t('Gouy phase, 0 … π (scaled)') },
      ],
      vlines: [{ x: -1, color: 'rgba(255,255,255,0.2)' }, { x: 1, color: 'rgba(255,255,255,0.2)' }, { x: ctl.state.zs, color: 'rgba(106,215,255,0.6)' }], legend: true,
    });
  }

  update();

  root.append(rule(String.raw`\[z_R = \frac{\pi w_0^2}{\lambda},\qquad \theta = \frac{\lambda}{\pi w_0}\]
<p>A beam's waist \(w_0\) sets both how long it stays narrow, the Rayleigh range \(z_R\), and how fast it spreads beyond, the half-angle \(\theta\). A helium–neon laser (633 nm) with a 0.5 mm waist stays narrow over \(\pi(0.5\ \text{mm})^2/633\ \text{nm} = 1.24\) m and spreads at 0.40 mrad, to a radius of 40 cm at a kilometre. Focused to a 10 µm waist, the same light has a Rayleigh range of only 0.5 mm.</p>`,
    String.raw`For a real laser multiply \(\lambda\) by its beam quality \(M^2\) (1 for a perfect beam, 1.1–1.5 for good lasers, much more for diodes and multimode lasers). The laws hold in the paraxial approximation, for spots much larger than the wavelength; a lens clear aperture smaller than about 1.5 beam radii adds noticeable diffraction rings that the Gaussian laws do not describe.`));
  root.append(theory('The Gaussian beam and its q-parameter', String.raw`
<div class="theory-cols"><div>
<h3>A solution of the paraxial wave equation</h3>
<p>The field \(E = u(x, y, z)\,e^{ikz}\) of a beam varies slowly along \(z\), so \(u\) obeys the paraxial wave equation \(\nabla_\perp^2 u + 2ik\,\partial_z u = 0\). Its simplest solution keeps a Gaussian profile at every distance:</p>
\[u = \frac{w_0}{w(z)}\exp\!\left(-\frac{r^2}{w(z)^2}\right)\exp\!\left(\frac{ikr^2}{2R(z)} - i\psi(z)\right),\]
\[w(z) = w_0\sqrt{1 + (z/z_R)^2},\quad R(z) = z\left(1 + (z_R/z)^2\right),\quad \psi(z) = \arctan\frac{z}{z_R}.\]
<p>The wavefronts are flat at the waist, most curved at \(z = \pm z_R\) and spherical, centred on the waist, far away. The Gouy phase \(\psi\) makes the wave slip by half a period, \(\pi\), as it passes through a focus: one reason the modes of a laser resonator have the frequencies they have.</p>
<h3>The complex beam parameter</h3>
<p>Width and curvature combine into \(1/q = 1/R - i\lambda/\pi w^2\), and a beam \(z\) behind its waist has \(q = z + iz_R\). A lens and a gap act on \(q\) exactly as their ray-transfer matrix acts on a ray's height and angle, \(q' = (Aq + B)/(Cq + D)\) (Kogelnik and Li 1966). A thin lens of focal length \(f\) at distance \(s\) from the waist puts the new waist at</p>
\[\frac{1}{s + z_R^2/(s - f)} + \frac{1}{s'} = \frac1f\]
<p>(Self 1983), the thin-lens equation with \(s\) replaced by \(s + z_R^2/(s-f)\). The waist lands beyond the focal plane when the lens is outside \(z_R\) of the laser, and the shift is largest when \(s - f \approx z_R\).</p>
</div><div>
<h3>Beam quality</h3>
<p>A real laser beam spreads faster than the ideal one with the same waist. Its second-moment width still follows \(w(z)\), with \(z_R = \pi w_0^2/M^2\lambda\) and \(\theta = M^2\lambda/\pi w_0\): the beam behaves like an ideal Gaussian of waist \(w_0/M\), its embedded Gaussian, magnified \(M\) times (Siegman). \(M^2 \ge 1\), and the product of waist and angle, \(w_0\theta = M^2\lambda/\pi\), is fixed: no lens can improve it.</p>
<h3>The check: the Fresnel integral</h3>
<p>The page computes the spot independently. The beam arrives at the lens with width \(w\) and wavefront radius \(R\), passes the lens's clear radius \(a\) and its phase \(-k\rho^2/2f\), and travels on by \(z\):</p>
\[U(r) = \frac{k}{iz}e^{ikr^2/2z}\int_0^a e^{-\rho^2/w^2}\,e^{i\frac k2\rho^2\left(\frac1z + \frac1R - \frac1f\right)}J_0\!\left(\frac{kr\rho}{z}\right)\rho\,d\rho.\]
<p>In \(q = \rho^2\) the phase is linear and each step is integrated exactly; with a wide aperture the computed \(1/e^2\) radius matches the \(q\)-parameter law to \(10^{-4}\) at every plane checked. A narrow aperture cuts the Gaussian's wings: the focus then grows towards the Airy pattern of the aperture, with its rings.</p>
<h3>Approximations</h3>
<p>Paraxial scalar optics, thin aberration-free lenses, a beam of a single wavelength. For \(M^2 > 1\) the shape is shown for the embedded Gaussian; real multimode beams are flatter or ragged.</p>
</div></div>`));
  root.append(references([
    'H. Kogelnik &amp; T. Li, “Laser beams and resonators”, <em>Applied Optics</em> 5, 1550–1567 (1966).',
    'S. A. Self, “Focusing of spherical Gaussian beams”, <em>Applied Optics</em> 22, 658–661 (1983).',
    'A. E. Siegman, <i>Lasers</i>, University Science Books (1986), ch. 16–17.',
  ]));

  return () => { clearTimeout(timer); [side, cross, prof, wz].forEach((x) => x.destroy()); };
}
