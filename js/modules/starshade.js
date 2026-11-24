import { h, controls, stage, readouts, texNum, fmt } from '../lib/ui.js';
import { paint, paintMap, keyOf } from '../lib/pixels.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { latest, run } from '../lib/compute.js';
import { plot, range } from '../lib/plot.js';
import { lut, wavelengthRGB } from '../lib/color.js';
import { OCCULTERS, fresnelNumber, iwa, apertureGrid, petalEdges, petalMinLam, rippleSpectrum, RIPPLE, glintSpots, glintImage } from '../lib/starshade.js';
import { view3d } from '../lib/gl3d.js';
import { starshadeScene } from '../lib/starshade3d.js';
import { t } from '../lib/i18n.js';

const INF = lut('inferno');
const MAS = 206264806.2;
// line colours: the visible hue, but never darker than a readable minimum (violet and infrared would vanish)
const css = (l) => { const c = wavelengthRGB(Math.min(680, Math.max(420, l * 1e9)), false), m = Math.max(...c); return `rgb(${c.map((v) => Math.round(255 * (0.25 + (0.75 * v) / m))).join(',')})`; };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space'] }));
  root.append(idea(String.raw`<p>Finding an Earth-like planet around another star is like spotting a firefly beside a lighthouse from thousands of kilometres away: the planet is ten billion times fainter and sits almost on top of its star.</p>
<p>A <strong>starshade</strong> is a flower-shaped screen tens of metres wide, flown tens of thousands of kilometres in front of a space telescope. It casts a deep shadow of the star while the planet beside it stays visible. A plain round disc would not work: light bending around its edge makes a bright spot right in the middle of the shadow. The carefully shaped petals cancel that spot.</p>`, [
    "Compare the suppression of the starshade with that of the same-size opaque disc: the disc lets far more light through.",
    "Move the telescope from 80 000 km to <strong>30 000 km</strong>: the Fresnel number falls and starlight leaks into the shadow.",
    "Choose the petal error <strong>One petal turned sideways</strong>: before looking, guess where the leaked starlight appears in the telescope's image. Then compare it with the drawing.",
  ]));

  const ctl = controls({
    a: { type: 'range', label: 'Opaque core radius a', min: 4, max: 20, step: 0.5, value: 12.5, unit: 'm' },
    b: { type: 'range', label: 'Petal length scale b', min: 4, max: 20, step: 0.5, value: 12.5, unit: 'm' },
    n: { type: 'range', label: 'Hypergaussian order n', min: 2, max: 10, step: 1, value: 6 },
    N: { type: 'range', label: 'Number of petals', min: 8, max: 32, step: 1, value: 16 },
    z: { type: 'range', label: 'Telescope–starshade distance', min: 10000, max: 150000, step: 1000, value: 80000, unit: 'km' },
    D: { type: 'range', label: 'Telescope diameter', min: 1, max: 8, step: 0.1, value: 4, unit: 'm' },
    lam: { type: 'range', label: 'Wavelength for the shadow map', min: 300, max: 1100, step: 10, value: 550, unit: 'nm' },
    err: { type: 'select', label: 'Petal error', value: 'none', options: [['none', 'Perfect petals'], ['clock', 'One petal turned sideways'], ['width', 'Every petal wider (negative: narrower)'], ['shift', 'One petal slid outwards along its axis'], ['random', 'Random ripple along every edge']] },
    d: { type: 'range', label: 'Size of the error (at the petal tip or edge)', min: -1000, max: 1000, step: 10, value: 500, unit: 'µm', when: (st) => st.err !== 'none', hint: 'For the random ripple: its RMS along each edge' },
    seed: { type: 'range', label: 'Random draw', min: 1, max: 20, step: 1, value: 1, when: (st) => st.err === 'random' },
    ho: { type: 'heading', label: 'Optimised profile' },
    frac: { type: 'range', label: 'Tip radius of the optimised shade (share of this one’s)', min: 60, max: 100, step: 5, value: 80, unit: '%' },
    hs: { type: 'heading', label: 'Sunlight on the edges' },
    beta: { type: 'range', label: 'Sun angle from the line of sight', min: 40, max: 90, step: 1, value: 60, unit: '°', hint: 'The Sun is behind the shade, which keeps the side facing the telescope dark' },
    phis: { type: 'range', label: 'Direction of the Sun in the shade’s plane', min: 0, max: 355, step: 5, value: 30, unit: '°' },
    ae: { type: 'range', label: 'Radius of the rounded edges', min: 0, max: 50, step: 1, value: 10, unit: 'µm', hint: 'The reflection model needs it much larger than the wavelength; 0 is a knife edge, which only diffracts' },
    refl: { type: 'range', label: 'Reflectance of the edges', min: 0.01, max: 1, step: 0.01, value: 0.1 },
    dpc: { type: 'range', label: 'Distance of the star (a twin of the Sun)', min: 3, max: 30, step: 1, value: 10, unit: 'pc' },
    popt: { type: 'toggle', label: 'Real petals with the optimised profile', value: false, hint: 'Once optimised: the drawing, the exact shadow, the errors and the image use it' },
  }, () => update());
  const ro = h('div');
  // the optimised profile, once computed (see runOpt below)
  let OP = null, optBusy = false;
  const calc = liveCalc();
  const shape = stage({ aspect: 1, label: 'Starshade seen from the telescope', draw: drawShape, minH: 200 });
  const map = stage({ aspect: 1, label: 'Averaged shadow (log intensity)', draw: drawMap, minH: 200 });
  const prof = stage({ aspect: 2.1, label: '', draw: drawProf, cls: 'plain', minH: 220 });
  const spec = stage({ aspect: 2.1, label: '', draw: drawSpec, cls: 'plain', minH: 220 });
  const note = h('p.note', {}, t('Computing the Fresnel integrals in the worker…'));
  const ap = stage({ aspect: 1, label: 'Real-petal shadow (log intensity)', draw: drawAp, minH: 200 });
  const img = stage({ aspect: 1, label: 'Leaked starlight in the image', draw: drawImg, minH: 200 });
  const gl = stage({ aspect: 1, label: 'Sunlight glinting off the edges, in the image', draw: drawGlint, minH: 200 });
  const glNote = h('p.note', {});
  const note2 = h('p.note', {}, t('Computing the exact shadow of the petals…'));
  const opt = stage({ aspect: 2.1, label: '', draw: drawOpt, cls: 'plain', minH: 220 });
  const optNote = h('p.note', {}, t('Press the button to find the best profile for a shade of this size by linear programming (about five seconds on a Raspberry Pi 4).'));
  const optBtn = h('button.btn', { type: 'button', onclick: () => runOpt() }, t('Optimise the profile'));
  const rip = stage({ aspect: 2.1, label: '', draw: drawRip, cls: 'plain', minH: 220 });
  const v3 = view3d({ label: '3-D: the telescope, the starshade tens of thousands of kilometres away, and its shadow on the telescope', aspect: 1.9, minH: 260, yaw: -0.7, pitch: 0.35 });
  root.append(lab([h('div.grid-2', {}, shape.el, map.el), note, h('div.grid-2', {}, ap.el, img.el), note2, v3.el, h('div.card', { style: { padding: '6px' } }, prof.el), h('div.card', { style: { padding: '6px' } }, spec.el), h('div.grid-2', {}, gl.el, h('div', {}, glNote)), h('div.card', { style: { padding: '6px' } }, rip.el), h('div.card', { style: { padding: '6px' } }, opt.el), optNote], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '8px' } }, optBtn)), h('div.card', {}, ro), calc.el]));

  const job = latest('starshade');
  let R = null;
  const lams = (st) => [...new Set([400e-9, st.lam * 1e-9, 1000e-9])].sort((x, y) => x - y);
  const specLams = range(300e-9, 1200e-9, 46);
  // 3-D: drawn at once with the last computed shadow, then again when the new one arrives; the
  // camera stays put unless the distance changes more than 1.5×
  let z3d = 0;
  function show3d(st, z, rhos, prof) {
    const keep = z3d > 0 && z / z3d < 1.5 && z3d / z < 1.5;
    // with the optimised profile switched on, the 3-D view shows it and its own shadow
    const sh = shadeOf(st), op = sh.opt && OP.prof.length === rhos.length ? { shape: sh.o, rI: sh.rI, prof: OP.prof } : {};
    v3.setScene(starshadeScene({ a: st.a, b: st.b, n: st.n, N: st.N, z, D: st.D, lamNm: st.lam, rhos, prof, ...op }), keep);
    if (!keep) z3d = z;
  }
  function update() {
    const st = ctl.state, Rt = st.a + st.b, z = st.z * 1e3, lam = st.lam * 1e-9, F = fresnelNumber(Rt, lam, z), th = iwa(Rt, z) * MAS;
    shape.redraw();
    show3d(st, z, R ? R.rhos : [], R ? R.prof[R.p.lams.indexOf(R.st.lam * 1e-9)] : []);
    calc.set(String.raw`\begin{aligned}
    F &= \frac{(a+b)^2}{\lambda z}\\
    &= \frac{(${texNum(Rt, 3)}\ \text{m})^2}{${texNum(st.lam, 3)}\ \text{nm}\times ${texNum(st.z / 1000, 3)}\,\text{Mm}} = ${texNum(F, 3)}\\
    \theta_\text{IWA} &\approx \frac{a+b}{z} = ${texNum(th, 3)}\ \text{mas}\\
    \lambda/D &= ${texNum((lam / st.D) * MAS, 3)}\ \text{mas}\\
    E(0) &= 1 + i\,\frac{2\pi}{\lambda z}\int_0^\infty A(r)\,e^{i\pi r^2/\lambda z}\,r\,dr\\
    E(\mathbf p) &= 1 + \frac{1}{2\pi}\oint_{\text{edge}}\left(e^{i\pi s^2/\lambda z}-1\right)d\alpha
    \end{aligned}`);
    // the azimuthally averaged model does not depend on the petals: skip it when only they change
    const rk = JSON.stringify([st.a, st.b, st.n, st.z, st.D, st.lam]);
    if (R && R.rk === rk) { show(); runPetals(); runRipple(); return; }
    note.textContent = t('Computing the Fresnel integrals in the worker…');
    const p = { kind: 'hyper', a: st.a, b: st.b, n: st.n, z, D: st.D, lams: lams(st), lamC: lam, rhoMax: Math.max(1.4 * Rt, st.D), nr: 120, specLams, steps: 2000 };
    job('starshade', p).then((r) => {
      R = { st: { ...st }, p, rk, ...r };
      show();
      show3d(st, z, r.rhos, r.prof[R.p.lams.indexOf(lam)]);
    });
    runPetals();
    runRipple();
  }

  // Which ripple periods matter: the leak added per unit RMS² at each period of the ripple's
  // spectrum, by first-order perturbation theory (averaged over the random phases, so no draw is
  // needed), at 8 points over the aperture. About a second and a half on a Raspberry Pi 4.
  const ripJob = latest('rippleSens'), ripPeriods = Array.from(rippleSpectrum().periods);
  const ripKey = (st) => JSON.stringify([st.a, st.b, st.n, st.N, st.z, st.D, st.lam]);
  let RS = null, rTimer = 0;
  function runRipple() {
    const st0 = ctl.state;
    if (st0.err !== 'random' || (RS && RS.key === ripKey(st0))) { rip.redraw(); return; }
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
      const st = { ...ctl.state }, key = ripKey(st), px = [], py = [];
      for (const f of [0.35, 0.8]) for (let k = 0; k < 4; k++) { const th = ((k + 0.5) * Math.PI) / 2; px.push((f * st.D * Math.cos(th)) / 2); py.push((f * st.D * Math.sin(th)) / 2); }
      ripJob('rippleSens', { o: { a: st.a, b: st.b, n: st.n }, N: st.N, lam: st.lam * 1e-9, z: st.z * 1e3, px, py, periods: ripPeriods }).then((S) => { RS = { key, S }; show(); }, (e) => console.error(e));
    }, RS ? 150 : 0);
    rip.redraw();
  }
  // expected added leak of the ripple on the page, over all draws: σ² Σ (cₘ²/2) S(ℓₘ)
  function rippleExpected(st) {
    if (!RS || RS.key !== ripKey(st)) return null;
    const { c } = rippleSpectrum(), s2 = (st.d * 1e-6) ** 2;
    return RS.S.reduce((acc, v, m) => acc + (c[m] * c[m] * v * s2) / 2, 0);
  }

  // Real petals: the exact two-dimensional field over the aperture (a G×G grid, for the map and the
  // image) and on a coarser grid across the spectrum. A job takes about a second and a half on a
  // Raspberry Pi 4 (in the worker that already holds the tasks; starting the pool would cost more),
  // so it runs where a dragged slider pauses.
  const G = 48, GS = 10, MAXNODES = 30000, specP = specLams.filter((_, i) => i % 2 === 0);
  let PR = null, pTimer = 0, pTicket = 0;
  // the error as the library takes it: d in metres; the random ripple's RMS is |d|, its phases set by the draw
  const errOf = (st) => (st.err === 'none' ? null : st.err === 'random' ? { kind: 'random', d: Math.abs(st.d) * 1e-6, seed: st.seed } : { kind: st.err, d: st.d * 1e-6, petal: 0 });
  const petalKey = (st) => JSON.stringify([st.a, st.b, st.n, st.N, st.z, st.D, st.lam, st.err, st.err === 'none' ? 0 : st.d, st.err === 'random' ? st.seed : 0, usesOpt(st) ? OP.key + OP.tbl.c : 0]);
  // the shade the real-petal panels use: the hypergaussian, or the optimised profile when chosen and
  // still valid. rI: the radius of the inner working angle, where A falls to 1/e (a + b for Cash's)
  const usesOpt = (st) => !!(st.popt && optNow(st));
  function shadeOf(st) {
    if (usesOpt(st)) {
      const T = OP.tbl, o = { kind: 'table', R: T.R, r0: T.r0, dr: T.dr, A: T.A }, A = (r) => OCCULTERS.table.A(r, T);
      let rI = T.R;
      for (let r = T.r0; r < T.R; r += T.dr / 8) if (A(r) < Math.exp(-1)) { rI = r; break; }
      return { o, Rm: T.R, base: T.r0, A, rI, opt: true };
    }
    return { o: { a: st.a, b: st.b, n: st.n }, Rm: OCCULTERS.hyper.Rmax(st), base: st.a, A: (r) => OCCULTERS.hyper.A(r, st), rI: st.a + st.b, opt: false };
  }
  function runPetals() {
    const st0 = ctl.state;
    if (PR && PR.key === petalKey(st0)) return;
    note2.textContent = t('Computing the exact shadow of the petals…');
    clearTimeout(pTimer);
    pTimer = setTimeout(() => {
      const st = { ...ctl.state }, my = ++pTicket, key = petalKey(st), z = st.z * 1e3, lam = st.lam * 1e-9;
      const sh = shadeOf(st), o = sh.o, err = errOf(st);
      const grid = apertureGrid(st.D, G), sg = apertureGrid(st.D, GS), rhoMax = st.D / Math.SQRT2;
      // a work budget: the edge needs more points the more Fresnel zones it crosses (a big shade, a
      // short distance, short wavelengths); wavelengths that would need more than MAXNODES are left out
      const lmin = Math.max(specP[0], petalMinLam(o, st.N, z, rhoMax, MAXNODES, err)), sl = specP.filter((l) => l >= lmin);
      if (lam < lmin) { PR = { key, st, z, tooBig: lmin }; show(); return; }
      // the map's grid at the chosen wavelength, then each wavelength of the spectrum on a coarser grid
      const items = [{ lam, x0: grid.x0, dx: grid.dx, nx: G, ys: grid.ys }, ...sl.map((l) => ({ lam: l, x0: sg.x0, dx: sg.dx, nx: GS, ys: sg.ys }))];
      run('petals', { o, N: st.N, err, z, lamMin: Math.min(lam, lmin), rhoMax, items }).then((res) => {
        if (my !== pTicket) return null;
        const field = res[0], spec = res.slice(1).map((f) => sg.idx.reduce((acc, q) => acc + (f[2 * q] ** 2 + f[2 * q + 1] ** 2) / sg.idx.length, 0));
        const Iap = new Float32Array(G * G);
        let mean = 0;
        for (let q = 0; q < G * G; q++) Iap[q] = field[2 * q] ** 2 + field[2 * q + 1] ** 2;
        for (const q of grid.idx) mean += Iap[q] / grid.idx.length;
        return run('petalImage', { field, idx: grid.idx, G, D: st.D, lam, n: 512 }).then((im) => {
          if (my !== pTicket) return;
          PR = { key, st, Iap, mean, spec, sl, im, z, sh };
          show();
        });
      }).catch((e) => console.error(e));
    }, PR ? 150 : 0);
  }
  // the brightest leak in the image between the inner working angle and twice the tip radius
  function leak(P) {
    const { I, n, pix } = P.im, th0 = P.sh.rI / P.z, th1 = (2 * P.sh.Rm) / P.z;
    let best = 0, at = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const th = Math.hypot(x - n / 2, y - n / 2) * pix;
      if (th >= th0 && th <= th1 && I[y * n + x] > best) { best = I[y * n + x]; at = th; }
    }
    return { best, at };
  }
  // Sunlight glinting off the edges: cheap (a fifth of a second on a Raspberry Pi 4), so computed
  // here whenever the shade or the sunlight changes
  let GLT = null;
  const glintKey = (st) => JSON.stringify([st.a, st.b, st.n, st.N, st.z, st.D, st.lam, st.beta, st.phis, st.ae, st.refl, st.dpc, usesOpt(st) ? OP.key + OP.tbl.c : 0]);
  function glintNow(st) {
    const key = glintKey(st);
    if (GLT && GLT.key === key) return GLT;
    const sh = shadeOf(st), z = st.z * 1e3, g = glintSpots(sh.o, st.N, { beta: (st.beta * Math.PI) / 180, phiS: (st.phis * Math.PI) / 180, a: st.ae * 1e-6, refl: st.refl, z, dpc: st.dpc, lam: st.lam * 1e-9 });
    const im = glintImage(g.spots, { z, D: st.D, lam: st.lam * 1e-9, half: (1.5 * sh.Rm) / z, n: 128 });
    GLT = { key, st: { ...st }, sh, z, ...g, im };
    return GLT;
  }
  function show() {
    if (!R) return;
    const st = ctl.state, lam = st.lam * 1e-9, k = R.p.lams.indexOf(R.st.lam * 1e-9), sp = R.supp[k], th = iwa(R.st.a + R.st.b, R.st.z * 1e3) * MAS;
    const P0 = PR && PR.key === petalKey(st) ? PR : null, big = P0 && P0.tooBig ? P0.tooBig : 0, P = big ? null : P0, L = P ? leak(P) : null, none = big ? '—' : '…';
    ro.replaceChildren(readouts([
      [t('Fresnel number at {l} nm', { l: R.st.lam }), fresnelNumber(R.st.a + R.st.b, R.st.lam * 1e-9, R.st.z * 1e3).toFixed(1)],
      ['Inner working angle', th.toFixed(0) + ' mas = ' + (th / ((lam / st.D) * MAS)).toFixed(1) + ' λ/D'],
      ['Suppression over the aperture, azimuthal average', sp.toExponential(1)],
      ['Suppression over the aperture, real petals', P ? P.mean.toExponential(1) : none],
      ['Brightest leak beyond the inner working angle', P ? t('{c} at {th} mas', { c: L.best.toExponential(1), th: (L.at * MAS).toFixed(0) }) : none],
      ['Same-size opaque disk', t('{s} (Poisson spot)', { s: R.diskSupp.toExponential(1) })],
      ...(st.err === 'random' ? [[t('Leak added by the ripple, expected over all draws'), rippleExpected(st) != null ? rippleExpected(st).toExponential(1) : '…']] : []),
      ['Edge glint: brightest point in the image', glintNow(st).im.peak.toExponential(1)],
      ['Edge glint: all spots together', t('{c} in {n} spots', { c: glintNow(st).total.toExponential(1), n: glintNow(st).spots.length })],
      ['Edge glint: reflected, diffracted', `${glintNow(st).reflected.toExponential(1)}, ${glintNow(st).diffracted.toExponential(1)}`],
      ['Band with suppression < 10⁻¹⁰', P && P.sl.length === specP.length ? band(P.sl, P.spec, 1e-10) : band(specLams, R.specSupp, 1e-10)],
    ]));
    const v2 = P ? P.mean : sp;
    calc.say(t('At {v1} thousand km the starshade dims the starlight over the telescope to <strong>{v2}</strong> of its unblocked level, against {v3} for a plain disc of the same size. Planets can be seen from <strong>{th} mas</strong> from the star outwards.', { v1: fmt(R.st.z / 1000, 3), v2: fmt(v2, 2), v3: fmt(R.diskSupp, 2), th: th.toFixed(0) }));
    note.textContent = t('Shadow of a hypergaussian starshade (a = {a} m, b = {b} m, n = {n}) at {z} km. The telescope aperture is the dashed circle. Scalar Fresnel diffraction, azimuthally averaged petals.', { a: R.st.a, b: R.st.b, n: R.st.n, z: Math.round(R.st.z) });
    if (big) note2.textContent = t('At these settings the petal edges cross so many Fresnel zones that the exact shadow would take too long here; it is computed from {l} nm upwards. Lengthen the wavelength, shrink the shade or move it further away.', { l: Math.ceil(big * 1e9 / 10) * 10 });
    if (P) note2.textContent = t("Exact Fresnel field of the {N} binary petals over the {D} m telescope (left, 10⁻¹³ … 10⁻⁶) and the image the telescope makes of the light that leaks past them (right, contrast 10⁻¹⁴ … 10⁻⁸ relative to the star's peak; the dashed circle is the inner working angle). Both are oriented like the drawing of the shade, so a leak shows up beside the petal that causes it.", { N: P.st.N, D: P.st.D }) + (P.sh.opt ? ' ' + t('The petals have the optimised profile (tip radius {R} m).', { R: P.sh.Rm.toFixed(1) }) : '');
    showOpt(st);
    { const g = glintNow(st); glNote.textContent = t('Sunlight reflected by the rounded petal edges (radius {a} µm, reflectance {R}) with the Sun {b}° from the line of sight, as a share of a Sun-like star {d} pc away; contrast 10⁻¹⁴ … 10⁻⁸, the dashed circle is the inner working angle. Reflection (gold on the drawing) comes from edges whose outward normal faces the Sun, in geometrical optics for edges much rounder than the wavelength; diffraction (blue) from edges facing the Sun or away from it, as at a knife edge. The {D} m telescope blurs every spot into its Airy pattern at {l} nm.', { a: g.st.ae, R: g.st.refl, b: g.st.beta, d: g.st.dpc, D: g.st.D, l: g.st.lam }); }
    [shape, map, prof, spec, ap, img, rip, opt, gl].forEach((x) => x.redraw());
  }
  function band(ls, s, thr) {
    const ok = ls.filter((_, i) => s[i] < thr);
    return ok.length ? `${Math.round(ok[0] * 1e9)}–${Math.round(ok[ok.length - 1] * 1e9)} nm` : 'none';
  }
  function drawShape(ctx, w, hh) {
    const st = ctl.state, sh = shadeOf(st), Rm = sh.Rm, sc = (Math.min(w, hh) / 2 - 10) / Rm, cx = w / 2, cy = hh / 2;
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#c9d4e6'; ctx.beginPath();
    const steps = 80;
    for (let k = 0; k < st.N; k++) {
      const ax = (2 * Math.PI * k) / st.N, pts = [];
      for (let i = 0; i <= steps; i++) { const r = sh.base + ((Rm - sh.base) * i) / steps, half = (Math.PI * sh.A(r)) / st.N; pts.push([r, half]); }
      pts.forEach(([r, hf], i) => { const x = cx + sc * r * Math.cos(ax - hf), y = cy + sc * r * Math.sin(ax - hf); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      for (let i = pts.length - 1; i >= 0; i--) { const [r, hf] = pts[i]; ctx.lineTo(cx + sc * r * Math.cos(ax + hf), cy + sc * r * Math.sin(ax + hf)); }
      ctx.closePath();
    }
    ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, sc * sh.base, 0, 2 * Math.PI); ctx.fill();
    if (st.err !== 'none') {
      // the petal with the error (the error itself, a fraction of a millimetre, is far too small to see)
      const err = errOf(st), js = st.err === 'width' || st.err === 'random' ? [...Array(st.N).keys()] : [0];
      ctx.fillStyle = 'rgba(255,181,71,0.85)';
      for (const j of js) {
        ctx.beginPath();
        const rs = Array.from({ length: steps + 1 }, (_, i) => sh.base + ((Rm - sh.base) * i) / steps), e = rs.map((r) => petalEdges(j, r, sh.o, st.N, err));
        rs.forEach((r, i) => { const x = cx + sc * r * Math.cos(e[i][0]), y = cy + sc * r * Math.sin(e[i][0]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        for (let i = steps; i >= 0; i--) ctx.lineTo(cx + sc * rs[i] * Math.cos(e[i][1]), cy + sc * rs[i] * Math.sin(e[i][1]));
        ctx.closePath(); ctx.fill();
      }
    }
    // where the edges glint in sunlight (gold), the Sun's direction marked on the rim
    if (R) {
      const g = glintNow(st), ph = (st.phis * Math.PI) / 180;
      for (const q of g.spots) { ctx.fillStyle = q.kind === 'reflect' ? 'rgba(255,214,102,0.95)' : 'rgba(106,215,255,0.9)'; ctx.beginPath(); ctx.arc(cx + sc * q.x, cy + sc * q.y, q.kind === 'reflect' ? 3.5 : 2.5, 0, 2 * Math.PI); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,214,102,0.95)';
      ctx.beginPath(); ctx.arc(cx + (Math.min(w, hh) / 2 - 6) * Math.cos(ph), cy + (Math.min(w, hh) / 2 - 6) * Math.sin(ph), 4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,181,71,0.7)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, sc * sh.rI, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(t('diameter {v1} m tip to tip', { v1: (2 * Rm).toFixed(0) }), 8, hh - 24); ctx.fillStyle = 'rgba(255,181,71,0.9)'; ctx.fillText(sh.opt ? t('optimised profile; A = 1/e (IWA radius)') : t('a + b (IWA radius)'), 8, hh - 9);
  }
  function drawMap(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    // the shadow is round: each screen pixel reads the computed profile at its own distance
    const k = R.p.lams.indexOf(R.st.lam * 1e-9), I = R.prof[k], rs = R.rhos, rm = rs[rs.length - 1], last = rs.length - 1;
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    paint(map, { x: x0, y: y0, w: sz, h: sz }, (u, v, o) => {
      const rr = Math.hypot(u * 2 - 1, v * 2 - 1), f = Math.min(last - 1e-3, rr * last), i = Math.floor(f), a = f - i;
      const val = rr > 1 ? 1 : I[i] * (1 - a) + I[i + 1] * a, L = Math.max(0, Math.min(1, (Math.log10(Math.max(val, 1e-16)) + 14) / 14));
      const tt = L * 255, j = Math.min(254, tt | 0), q = tt - j, p = j * 3;
      for (let c = 0; c < 3; c++) o[c] = (INF[p + c] + (INF[p + 3 + c] - INF[p + c]) * q) / 255;
    }, `${keyOf(R)}|${k}`);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 26); // keeps the stage label readable on the bright rim
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, (R.st.D / 2 / rm) * (sz / 2), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    const txt = `${R.st.lam} nm, ±${rm.toFixed(0)} m; 10⁻¹⁴ … 1`;
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function tooBigText(ctx, w, hh, l) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('computed from {l} nm upwards', { l: Math.ceil((l * 1e9) / 10) * 10 }), w / 2, hh / 2); ctx.textAlign = 'left';
  }
  function drawAp(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const P = PR;
    if (P && P.tooBig) { tooBigText(ctx, w, hh, P.tooBig); return; }
    if (!P) return;
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    paintMap(ap, { x: x0, y: y0, w: sz, h: sz }, { a: P.Iap, w: G, h: G, lut: INF, pre: (v) => Math.log10(Math.max(v, 1e-16)), value: (v) => (v + 13) / 7 }, P.key);
    // only the telescope's circle: darken the corners of the square that was computed
    ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.beginPath(); ctx.rect(0, 0, w, hh); ctx.arc(w / 2, hh / 2, sz / 2, 0, 2 * Math.PI); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(w / 2, hh / 2, sz / 2, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 26);
    const txt = t('{D} m telescope; 10⁻¹³ … 10⁻⁶', { D: P.st.D });
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function drawGlint(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!R) return;
    const g = glintNow(ctl.state), { I, n, pix } = g.im, sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    paintMap(gl, { x: x0, y: y0, w: sz, h: sz }, { a: I, w: n, h: n, lut: INF, pre: (v) => Math.log10(Math.max(v, 1e-16)), value: (v) => (v + 14) / 6 }, g.key);
    const s = sz / (n * pix), cx = w / 2, cy = hh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(cx, cy, s * (g.sh.rI / g.z), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    // the Sun's direction in the shade's plane
    const ph = (g.st.phis * Math.PI) / 180, L = sz * 0.46;
    ctx.strokeStyle = 'rgba(255,214,102,0.7)'; ctx.beginPath(); ctx.moveTo(cx + 0.8 * L * Math.cos(ph), cy + 0.8 * L * Math.sin(ph)); ctx.lineTo(cx + L * Math.cos(ph), cy + L * Math.sin(ph)); ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,102,0.9)'; ctx.beginPath(); ctx.arc(cx + L * Math.cos(ph), cy + L * Math.sin(ph), 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 26);
    const txt = t('±{v} mas; contrast 10⁻¹⁴ … 10⁻⁸', { v: Math.round((n / 2) * pix * MAS) });
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function drawImg(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const P = PR;
    if (P && P.tooBig) { tooBigText(ctx, w, hh, P.tooBig); return; }
    if (!P) return;
    const { I, n, pix } = P.im, Th = (1.5 * P.sh.Rm) / P.z, half = Math.min(n / 2 - 1, Th / pix);
    const sz = Math.min(w, hh) - 4, x0 = (w - sz) / 2, y0 = (hh - sz) / 2;
    paintMap(img, { x: x0, y: y0, w: sz, h: sz }, { a: I, w: n, h: n, x0: n / 2 - half, y0: n / 2 - half, cw: 2 * half, ch: 2 * half, lut: INF, pre: (v) => Math.log10(Math.max(v, 1e-16)), value: (v) => (v + 14) / 6 }, P.key);
    // the inner working angle and the petal tips
    const s = sz / (2 * half * pix), cx = w / 2, cy = hh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(cx, cy, s * (P.sh.rI / P.z), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 26);
    const txt = t('±{v} mas; contrast 10⁻¹⁴ … 10⁻⁸', { v: Math.round(half * pix * MAS) });
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, hh - 22, ctx.measureText(txt).width + 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(txt, 8, hh - 9);
  }
  function drawProf(ctx, w, hh) {
    if (!R) return;
    const rm = R.rhos[R.rhos.length - 1];
    plot(ctx, w, hh, {
      title: 'Shadow profile: intensity relative to the unobstructed starlight', x: { min: 0, max: rm, label: 'distance from the shadow centre (m)' }, y: { min: 1e-16, max: 10, log: true, label: 'I / I₀' },
      series: [
        { data: R.rhos.map((r, i) => [r, Math.max(1e-16, R.disk[i])]), color: 'rgba(255,255,255,0.45)', width: 1.4, dash: [4, 3], label: t('opaque disk, {l} nm', { l: R.st.lam }) },
        ...R.p.lams.map((l, j) => ({ data: R.rhos.map((r, i) => [r, Math.max(1e-16, R.prof[j][i])]), color: css(l), width: 2, label: t('starshade, {l} nm', { l: Math.round(l * 1e9) }) })),
        ...(optNow(ctl.state) && OP.prof.length === R.rhos.length ? [{ data: R.rhos.map((r, i) => [r, Math.max(1e-16, OP.prof[i])]), color: '#7fd68f', width: 1.6, dash: [6, 3], label: t('optimised, {l} nm', { l: R.st.lam }) }] : []),
      ],
      bands: [{ x: [0, R.st.D / 2], color: 'rgba(106,215,255,0.08)' }], hlines: [{ y: 1e-10, color: 'rgba(255,181,71,0.5)' }],
      legend: true,
    });
  }
  function drawSpec(ctx, w, hh) {
    if (!R) return;
    plot(ctx, w, hh, {
      title: 'Starlight suppression averaged over the telescope aperture', x: { min: 300, max: 1200, label: 'wavelength (nm)' }, y: { min: 1e-16, max: 10, log: true, label: 'suppression' },
      series: [
        { data: specLams.map((l, i) => [l * 1e9, Math.max(1e-16, R.specSupp[i])]), color: '#ffb547', width: 2.2, label: t('azimuthal average') },
        ...(PR && PR.key === petalKey(ctl.state) && !PR.tooBig ? [{ data: PR.sl.map((l, i) => [l * 1e9, Math.max(1e-16, PR.spec[i])]), color: '#6ad7ff', width: 2, label: t('{N} real petals', { N: PR.st.N }) }] : []),
        ...(optNow(ctl.state) ? [{ data: specLams.map((l, i) => [l * 1e9, Math.max(1e-16, OP.spec[i])]), color: '#7fd68f', width: 2, label: t('optimised, tip radius {R} m', { R: OP.tbl.R.toFixed(1) }) }] : []),
      ],
      legend: true,
      bands: [{ y: [1e-16, 1e-10], color: 'rgba(120,230,160,0.06)' }], vlines: [{ x: R.st.lam, color: 'rgba(255,255,255,0.35)' }], hlines: [{ y: 1e-10, color: 'rgba(255,181,71,0.5)' }],
    });
  }

  // The optimised profile: a linear program over the profile A(r) for a shade with the chosen tip
  // radius, over the telescope and 400–1000 nm, with the hypergaussian's own sharpest bend as the
  // limit on |A″|; then checked with the exact radial integral. Run on request.
  const optJob = latest('occulterLP'), K_HYPER = (st) => { let m = 0; const A = (r) => OCCULTERS.hyper.A(r, st), hstep = 1e-3; for (let r = st.a; r < OCCULTERS.hyper.Rmax(st); r += 0.02) m = Math.max(m, Math.abs((A(r + hstep) - 2 * A(r) + A(r - hstep)) / hstep ** 2)); return m; };
  const optKey = (st) => JSON.stringify([st.a, st.b, st.n, st.z, st.D, st.lam, st.frac]);
  function runOpt() {
    if (!R) return;
    const st = { ...ctl.state }, key = optKey(st), K = K_HYPER(st);
    optBusy = true; optBtn.disabled = true;
    optNote.textContent = t('Solving the linear program and checking the result…');
    opt.redraw();
    optJob('occulterLP', { a: st.a, b: st.b, n: st.n, z: st.z * 1e3, D: st.D, frac: st.frac / 100, K, specLams, lamC: st.lam * 1e-9, rhos: R.rhos }).then((r) => {
      OP = { key, st, K, ...r };
      optBusy = false; optBtn.disabled = false;
      show();
      if (ctl.state.popt) { const q = ctl.state; shape.redraw(); runPetals(); show3d(q, q.z * 1e3, R.rhos, R.prof[R.p.lams.indexOf(R.st.lam * 1e-9)]); }
    }, (e) => { optBusy = false; optBtn.disabled = false; optNote.textContent = t('The optimisation failed: {e}', { e: e.message }); });
  }
  const optNow = (st) => (OP && OP.key === optKey(st) ? OP : null);
  function showOpt(st) {
    const O = optNow(st);
    if (optBusy) return;
    if (!O) { optNote.textContent = OP ? t('The settings have changed: press the button to optimise again.') : t('Press the button to find the best profile for a shade of this size by linear programming (about five seconds on a Raspberry Pi 4).'); return; }
    optNote.innerHTML = t('Optimised profile, tip radius {R} m (this hypergaussian: {H} m), monotone and no more sharply curved than the hypergaussian (|A″| ≤ {K} m⁻²). Worst leak over the {D} m telescope at 400–1000 nm, from the exact radial integral: <strong>{o}</strong>, against {h} for the hypergaussian. Switch on “Real petals with the optimised profile” to see its exact shadow and image.', { R: O.tbl.R.toFixed(1), H: OCCULTERS.hyper.Rmax(st).toFixed(1), K: O.K.toFixed(3), D: st.D, o: O.worst.opt.toExponential(1), h: O.worst.hyper.toExponential(1) });
  }
  function drawOpt(ctx, w, hh) {
    const st = ctl.state, O = optNow(st), Rm = OCCULTERS.hyper.Rmax(st), xs = Array.from({ length: 200 }, (_, i) => (Rm * 1.02 * i) / 199);
    plot(ctx, w, hh, {
      title: 'Petal profile A(r): the share of each circle the shade covers', x: { min: 0, max: Rm * 1.02, label: 'radius (m)' }, y: { min: 0, max: 1.05, label: 'A(r)' },
      series: [
        { data: xs.map((r) => [r, OCCULTERS.hyper.A(r, st)]), color: '#ffb547', width: 2.2, label: t('hypergaussian') },
        ...(O ? [{ data: xs.map((r) => [r, OCCULTERS.table.A(r, O.tbl)]), color: '#7fd68f', width: 2.2, label: t('optimised, tip radius {R} m', { R: O.tbl.R.toFixed(1) }) }] : []),
      ],
      legend: true,
    });
  }
  function drawRip(ctx, w, hh) {
    const st = ctl.state, ok = RS && RS.key === ripKey(st);
    if (st.err !== 'random' || !ok || !R) {
      plot(ctx, w, hh, { title: 'Leak per ripple period', x: { min: RIPPLE.lmin, max: RIPPLE.lmax, log: true, label: 'ripple period along the edge (m)' }, y: { min: 1e-16, max: 1e-8, log: true, label: 'added suppression' }, series: [] });
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px "Inter", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(st.err !== 'random' ? t('Choose the petal error “Random ripple along every edge” to see which ripple periods leak.') : t('Computing the leak per ripple period…'), w / 2, hh / 2);
      ctx.textAlign = 'left';
      return;
    }
    const s2 = (st.d * 1e-6) ** 2, data = ripPeriods.map((l, m) => [l, Math.max(1e-16, RS.S[m] * s2)]), k = R.p.lams.indexOf(R.st.lam * 1e-9);
    let top = R.supp[k];
    for (const [, v] of data) top = Math.max(top, v);
    const ymax = 10 ** Math.ceil(Math.log10(top));
    plot(ctx, w, hh, {
      title: t('Leak added by {s} µm RMS of ripple at a single period', { s: Math.abs(st.d) }), x: { min: RIPPLE.lmin, max: RIPPLE.lmax, log: true, label: 'ripple period along the edge (m)' }, y: { min: ymax * 1e-6, max: ymax, log: true, label: 'added suppression' },
      series: [{ data, color: '#6ad7ff', width: 2.2, label: t('one period at a time') }, { data: [[RIPPLE.lmin, R.supp[k]], [RIPPLE.lmax, R.supp[k]]], color: '#ffb547', width: 1.4, dash: [5, 3], label: t('perfect petals (azimuthal average)') }],
      legend: true, vlines: [{ x: (st.lam * 1e-9 * st.z * 1e3) / (st.a + st.b), color: 'rgba(255,255,255,0.35)' }],
    });
  }

  update();

  root.append(rule(String.raw`\[F = \frac{R^2}{\lambda z},\qquad \theta_\text{IWA} \approx \frac{R}{z}\]
<p>The Fresnel number \(F\) of a starshade of radius \(R\) at distance \(z\) measures how deep its shadow can be; deep shadows need \(F\) of order 10 or more. A starshade of 25 m radius at 80 000 km in 550 nm light has \(F = 25^2/(550 \times 10^{-9} \times 8 \times 10^{7}) = 14\), and it hides a region of \(25/(8 \times 10^{7})\) rad = 64 mas around the star, the inner working angle. Planets farther out are visible.</p>`,
    String.raw`These are scaling rules. The actual suppression depends on the petal shape, on manufacturing and deployment accurate to a fraction of a millimetre (the petal error controls show how much), and on sunlight glinting off the petal edges (reflection in geometrical optics, plus knife-edge diffraction). The scalar Fresnel model used here also ignores polarisation and the thickness of the petals.`));
  root.append(theory('Casting a shadow ten billion times darker', String.raw`
<div class="theory-cols"><div>
<h3>Fresnel diffraction behind an occulter</h3>
<p>The starshade is in the Fresnel regime: its radius \(R\) and the distance \(z\) give a Fresnel number \(F = R^2/\lambda z\) of order 10, so the shadow is neither a geometric silhouette (\(F\to\infty\)) nor a far-field pattern (\(F\ll1\)). For a circularly symmetric screen that blocks a fraction \(A(r)\) of each circle, the field behind it relative to the unobstructed starlight is</p>
\[E(\rho) = 1 + \frac{2\pi i}{\lambda z}\,e^{i\pi\rho^2/\lambda z}\int_0^\infty A(r)\,e^{i\pi r^2/\lambda z}\,J_0\!\left(\frac{2\pi r\rho}{\lambda z}\right) r\,dr.\]
<p>For an opaque disk (\(A = 1\) for \(r\le R\)) the axial integral is elementary, \(E(0) = e^{i\pi F}\), so \(|E(0)|^2 = 1\) exactly: the centre of the shadow of any round object is as bright as if the object were not there. This is the Poisson–Arago spot, the dashed curve in the profile plot. A round occulter is useless; the edge must be soft.</p>
<h3>Apodisation by petals</h3>
<p>A smooth transmission profile that falls from 0 to 1 over many Fresnel zones makes the edge contributions cancel. A screen with graded grey transmission cannot be built to \(10^{-10}\) accuracy, but a binary screen can: \(N\) petals whose angular width at radius \(r\) is \(2\pi A(r)/N\) block exactly the fraction \(A(r)\) of each circle. Expanding the petals in a Fourier series in angle, \(A + \sum_j \tfrac{2\sin(j\pi A)}{j\pi}\cos(jN\theta)\), adds to the field terms in \(J_{N}, J_{2N},\dots\) of argument \(2\pi r\rho/\lambda z\). They vanish on the axis and grow like \((\pi r\rho/\lambda z)^N/N!\) away from it. At the edge of a 4 m telescope behind the default shade that argument reaches about 10 at the petal tips. There, 16 petals change the shadow only slightly, while 8 petals let three times as much light into the aperture as the average predicts. Over an 8 m telescope 16 petals let in 60 % more, and 24 petals bring it back to the average. Cash's hypergaussian</p>
\[A(r) = \exp\!\left[-\left(\frac{r-a}{b}\right)^n\right]\quad(r > a),\qquad A = 1\ (r\le a)\]
<p>gives suppression below \(10^{-10}\) over a broad band when \(a\), \(b\) and \(z\) are chosen so that \(F\lesssim 15\) at the longest wavelength. Numerically optimised profiles (Vanderbei, Cady and Kasdin) do better with smaller shades.</p>
<h3>An optimised profile</h3>
<p>The field is linear in the profile \(A(r)\), so the profile that keeps the shadow darkest is the solution of a linear program, the approach of Vanderbei, Cady and Kasdin (2007). On this page \(A\) is piecewise linear on 60 nodes from \(0.2R\) to the tip radius \(R\), written as \(A = 1 - \sum_i d_i\,\mathrm{ramp}_i(r)\) with \(d_i \ge 0\) and \(\sum_i d_i \le 1\). It therefore falls monotonically from 1 and never below 0. Its bend is limited to \(|A''| \le K\), with \(K\) the hypergaussian's own sharpest bend, so the result is no harder to make. The program minimises a bound \(c\) on \(|\mathrm{Re}\,E|\) and \(|\mathrm{Im}\,E|\) at sample radii over the telescope and at wavelengths from 400 to 1000 nm, evenly spaced in \(1/\lambda\) (the Fresnel number). A dense check then adds the worst points and the program is solved again, three times over. A simplex method (Harris's ratio test, which avoids the tiny pivots that would wreck a dense tableau) takes a few seconds. The profile is then checked independently with the radial integral above, on a finer grid. For the default shade, a 4 m telescope and 80 000 km, a profile with a 20 % smaller tip radius keeps the worst leak over the band near \(2\times10^{-11}\), where the hypergaussian reaches \(2\times10^{-7}\) at 1000 nm. At full size it stays below \(10^{-13}\). Outside the band it is worse, because the program optimised only what it was asked to. Real designs add limits this page leaves out, such as the narrowest petal tip and gap that can be made, and tolerances for deployment and manufacturing.</p>
</div><div>
<h3>Real petals: the shadow in two dimensions</h3>
<p>For a binary screen the area integral collapses onto its edge. With \(\mathbf s\) the vector from the field point \(\mathbf p\) to the edge and \(\alpha\) its direction, \(\nabla\cdot\big[\mathbf s\,(e^{iks^2}-1)/(2iks^2)\big] = e^{iks^2}\) with \(k=\pi/\lambda z\), so</p>
\[E(\mathbf p) = 1 + \frac{i}{\lambda z}\iint_{\text{shade}} e^{iks^2}\,dA = 1 + \frac{1}{2\pi}\oint_{\text{edge}}\left(e^{iks^2}-1\right)d\alpha,\]
<p>the boundary-diffraction form used for starshades by Cady (2012). The integrand stays finite on the edge, so no inside-or-outside test is needed. The page traces the hub and the \(2N\) petal edges with Gauss–Legendre panels sized to the Fresnel zones they cross. On the axis it reproduces the radial integral exactly; off the axis it agrees with the Bessel series above to \(10^{-12}\) in field. Its azimuthal mean is again the radial result.</p>
<p>The errors are those of a real shade:</p>
<ul>
<li>One petal can be turned about the centre so that its tip moves sideways.</li>
<li>Every edge can be moved outwards along its normal: a manufacturing width error.</li>
<li>One petal can be slid outwards along its own axis, with its base still sealed to the hub.</li>
</ul>
<p>Where a petal would overlap its neighbour the two are merged, so nothing is counted twice. Over a 4 m telescope behind the default shade, at 550 nm, a petal turned so that its tip moves 1 mm sideways raises the leak about ninefold. Edges a tenth of a millimetre too wide raise it 27-fold. A petal slid 1 mm outwards raises it less than fourfold, because its smooth profile still cancels most of the edge waves; what leaks comes through the thin slits it opens along the valleys, where it had touched its neighbours. The leaked light is not spread evenly. In the telescope's image (the Fraunhofer transform of the field over the aperture, in units of the unblocked star's peak) it appears beside the faulty petal, near its tip, which is just outside the inner working angle and exactly where planets are sought. Starshade error budgets (Shaklan et al. 2010) are built from sensitivities like these, one for every kind of error.</p>
<p>The fourth kind of error is the one error budgets describe by its spatial spectrum: a random ripple along every edge. Here each of the \(2N\) edges moves along its normal by \(\delta(r) = \sigma\sum_m c_m\sin(2\pi r/\ell_m + \varphi_m)\), with 24 periods \(\ell_m\) from 0.25 to 8 m, a power spectrum falling as \(f^{-2}\), RMS \(\sigma\) and random phases (the draw). The ripple fades out in the valleys, where neighbouring petals meet, and where a petal tip is narrower than about a millimetre, as no real tip is sharper. To first order a displacement \(\delta\) adds the strip \(\delta\,ds\) to the shade, so</p>
\[\delta E(\mathbf p) = \frac{i}{\lambda z}\oint_{\text{edges}} e^{i\pi s^2/\lambda z}\,\delta\,ds,\]
<p>and the exact edge integral agrees with it to 0.2 %. Averaged over the random phases, it gives the bottom chart: the leak from one period at a time. It peaks sharply where the ripple's period matches the spacing of the Fresnel zones on the outer petals, \(\ell \approx \lambda z/r\) (the line is at \(\lambda z/(a+b)\)). There the ripple keeps step with the zones and its contributions add up along the edge, while much shorter or longer periods cancel themselves. For the default shade at 550 nm, 100 µm RMS spread over the whole spectrum adds about \(3.6\times10^{-10}\), some 60 times the leak of the perfect shade, nearly all of it from periods between 1.3 and 2.5 m.</p>
<h3>The geometry in 3-D</h3>
<p>The 3-D view keeps the distances along the line of sight to scale and enlarges everything across it by one round factor, typically \(5\times10^5\). A 66 m starshade 80 000 km away subtends 170 mas, about the size of a coin seen from 15 km. Because both directions across are enlarged alike, angles are enlarged by the same factor and the line of sight that grazes the petal tips is the inner working angle \((a+b)/z\). The telescope sits deep inside the geometric shadow, a cylinder of radius \(a+b\). The coloured disc around the pupil is the computed shadow: the apodised petals keep the light that diffracts round the edge out of the centre, so the pupil sees \(10^{-10}\) or less where a plain disc would put the bright Poisson spot.</p>
<h3>The trade-offs</h3>
<p>Diffraction gets worse at long wavelengths (smaller \(F\), fewer zones over the petal), so the band's red end sets the size. The inner working angle, the smallest star–planet separation that is not covered, is about \((a+b)/z\). Moving the shade further away shrinks the IWA but lowers \(F\), and a larger shade restores \(F\) but must be built and flown to millimetre precision. Typical designs are 30–70 m across at 30 000–100 000 km, with IWAs of 60–100 mas, independent of telescope size. That is the main appeal: the telescope itself needs no coronagraph and no wavefront control.</p>
<h3>Sunlight on the edges</h3>
<p>The Sun shines on the shade from behind, at an angle \(\beta\) from the line of sight, so the side the telescope sees is dark. The petal edges are not. An edge rounded to a radius \(a\) is a thin reflecting tube along the outline, and it sends sunlight to the telescope wherever its outward normal in the shade's plane points to the Sun's azimuth. There the light is turned through the angle \(\beta\), the tube's surface has the Gaussian curvature \(K = \cos(\beta/2)/(aR_c)\), with \(R_c\) the outline's radius of curvature, and geometrical optics gives a reflecting surface the radiant intensity \(J = RS/4K\):</p>
\[J = \frac{R\,S\,a\,R_c}{4\cos(\beta/2)}.\]
<p>A brute-force sum over the patches of a reflecting torus agrees with this to 1 %. The Sun is not a point: its disc, 0.27° in radius, spreads the matching normals over \(\pm\alpha_\odot/\sin\beta\), so \(R_c\) becomes its average over that window. This stays finite where the outline's curvature passes through zero. As a share of a Sun-like star at a distance \(d\), one glint spot is</p>
\[C = \frac{R\,a\,\langle R_c\rangle}{4\cos(\beta/2)\,z^2}\left(\frac{d}{1\ \text{AU}}\right)^2,\]
<p>because the shade is 1 AU from the Sun and the solar constant cancels. Averaged over the Sun's azimuth, the glinting radii add up to the length of free edge divided by \(2\pi\), which the page checks to 0.3 %. The spots are incoherent with each other and with the starlight, and the telescope blurs each into its Airy pattern. For the default shade with edges of 10 µm radius and reflectance 0.1, the Sun 60° from the line of sight and a star 10 pc away, the brightest glint in the image is about \(4\times10^{-9}\), forty times a planet at \(10^{-10}\). It scales with \(a\) and \(R\), hence sharp, dark edges. The reflection needs \(a \gg \lambda\).</p>
<p>The edge also diffracts sunlight, and that remains for a knife edge (\(a \to 0\)). In the plane across the edge the sheet is a half-plane, the Sun lies at \(\varphi' = \pi/2 \pm \beta\) from it and the telescope at \(\varphi = 3\pi/2\). Keller's diffraction coefficient \(D = -\tfrac{e^{-i\pi/4}}{2\sqrt{2\pi k}}\left[\sec\tfrac{\varphi-\varphi'}{2} \mp \sec\tfrac{\varphi+\varphi'}{2}\right]\), averaged over the two polarisations, gives \(|D|^2 = \lambda/(4\pi^2\sin^2\beta)\) for edges facing the Sun and facing away from it alike. It matches Sommerfeld's exact solution for the half-plane to \(10^{-4}\), which the page checks. The diffracted power per radian replaces the reflected one, so a diffraction spot has</p>
\[C_d = \frac{\lambda\,\langle R_c\rangle}{4\pi^2\sin^3\beta\,z^2}\left(\frac{d}{1\ \text{AU}}\right)^2,\]
<p>independent of \(a\) and of the reflectance. For the default shade at 550 nm, the diffracted spots together give about \(1.6\times10^{-9}\), against \(1.1\times10^{-8}\) reflected by edges of 10 µm radius and reflectance 0.1. Rounding the edges down to a few micrometres removes most of the reflection but not this floor. Between the two limits, edges of radius close to \(\lambda\), neither model holds. Edges closer than \(4a\) to a neighbour and petals narrower than \(4a\) do not glint, and the tips of a tabulated profile (its truncation arcs) are left out.</p>
<h3>Numerical method and approximations</h3>
<p>The azimuthal average is integrated in \(u = r^2\), where the Fresnel phase is linear. Each step integrates the phase exactly (Filon's midpoint rule), which makes the opaque core exact; one Richardson step removes the \(O(\Delta u^2)\) error left by \(J_0\) off axis. \(J_0\) itself is summed from its power series up to an argument of 12 and from Hankel's asymptotic series beyond, accurate to \(10^{-12}\); the usual polynomial fits are good only to \(5\times10^{-8}\), which is too coarse for a field of \(10^{-6}\). At 2000 steps the intensity has converged to better than \(10^{-14}\).</p>
<p>The two-dimensional field is computed on a \(48\times48\) grid over the aperture at the chosen wavelength and on a \(10\times10\) grid for each point of the spectrum. Along a grid row the phase of each edge point changes by a fixed factor, so the sum needs no sines or cosines. The image is a 512-point FFT of the aperture field. Doubling the edge points changes the result by less than one part in a million.</p>
<p>With “Real petals with the optimised profile” switched on, the drawing, the exact shadow, the petal errors and the image use the optimised profile; its edges bend at the profile's nodes, which become panel boundaries of the edge integral. So does the 3-D view, with the optimised shade's own shadow. Not included: vector diffraction at the edges (the sunlight's diffraction uses the scalar half-plane, averaged over polarisation), the petals' thickness, and the finite size of the star (about 1 mas, much smaller than the shadow). The errors are applied to first order in their size; for millimetre errors the outline is then right to better than a tenth of a micrometre. The ripple's spectrum (its range of periods and its slope) is illustrative, not that of a particular design's error budget.</p>
</div></div>`));
  root.append(references([
    'W. Cash, “Detection of Earth-like planets around nearby stars using a petal-shaped occulter”, <em>Nature</em> 442, 51 (2006).',
    'R. J. Vanderbei, E. Cady &amp; N. J. Kasdin, “Optimal occulter design for finding extrasolar planets”, <em>Astrophys. J.</em> 665, 794 (2007).',
    'S. B. Shaklan <em>et al.</em>, “Error budgeting and tolerancing of starshades for exoplanet detection”, <em>Proc. SPIE</em> 7731 (2010).',
    'E. Cady, “Boundary diffraction wave integrals for diffraction modeling of external occulters”, <em>Opt. Express</em> 20, 15196 (2012).',
    'S. Seager <em>et al.</em>, “Exo-S: Starshade probe-class exoplanet direct imaging mission concept”, final report, NASA/JPL (2015).',
    'M. Born &amp; E. Wolf, <em>Principles of Optics</em>, 7th ed., §8.8 (Fresnel diffraction, Lommel functions).',
  ]));

  return () => { clearTimeout(pTimer); pTicket++; clearTimeout(rTimer); [shape, map, prof, spec, ap, img, rip, opt, gl, v3].forEach((x) => x.destroy()); };
}
