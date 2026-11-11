import { h, reducedMotion } from '../lib/ui.js';
import { MODULES, READY, translated } from '../app.js';
import { COUNT } from '../lib/phenomena.js';
import { index, GLASS_NAMES } from '../lib/glass.js';
import { LENSES } from '../lib/raytrace.js';
import { t, N_ } from '../lib/i18n.js';
import { wavelengthRGB, oetf } from '../lib/color.js';
import { FEATURED, thumbOf } from '../lib/thumbs.js';
import { PATH } from '../lib/path.js';
import { TOURS } from '../lib/tours.js';

// "How to read this laboratory" (HTML; translated as whole paragraphs)
const READ_1 = N_('Every page climbs from simple to exact, and you can stop at any step. <strong>① The idea</strong> explains the phenomenon in plain words and suggests things to try. The <strong>simulation</strong> recomputes the physics as you move the sliders, and its <strong>live calculation</strong> states the result in a sentence, then shows the governing equations with your numbers substituted. <strong>② Rule of thumb</strong> gives the one formula worth remembering and where it stops working. <strong>③ Full model</strong> derives everything, with its assumptions and limits, and <strong>④ References</strong> lead to the primary literature. Dotted-underlined words have a short definition: hover over or tap them.');
const READ_2 = N_('Models are chosen to be the most exact that can run interactively. Real lenses are traced with vector Snell\'s law through spherical and aspheric surfaces and mirrors, and glass dispersion uses manufacturer Sellmeier coefficients. Diffraction is the full Fraunhofer integral evaluated by FFT, with each wavelength computed separately. Coatings use the characteristic-matrix method for thin-film interference. Turbulence uses von Kármán phase screens. Where an approximation is used (paraxial ghost tracing, geometric bokeh), the page says so and explains when it breaks down.');

// Hero: white light dispersed by an N-SF11 prism, traced exactly (Snell + TIR, Sellmeier n(λ)).
function heroCanvas() {
  const canvas = h('canvas');
  const ctx = canvas.getContext('2d');
  let raf, W = 0, H = 0, dpr = 1, mouseY = null, turn = 0, drag = null;
  // many thin rays whose linear colours are normalised so that together they make white: where
  // they overlap, just outside the prism, the light is white again, and it fans out into a spectrum
  const lambdas = Array.from({ length: 90 }, (_, i) => 400 + (300 * i) / 89);
  const lin = lambdas.map((l) => wavelengthRGB(l, false));
  const sum = [0, 1, 2].map((c) => lin.reduce((a, v) => a + v[c], 0));
  const cols = lin.map((v) => { const u = v.map((x, c) => (x / sum[c]) * 26), m = Math.max(...u, 1); return u.map((x) => Math.round(oetf(x / m) * 255)); });
  const stars = Array.from({ length: 220 }, () => [Math.random(), Math.random(), Math.random() ** 3]);

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  // the beam follows the pointer's height; dragging sideways turns the prism
  const still = () => { if (reducedMotion()) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) turn = Math.max(-0.45, Math.min(0.45, drag.turn + ((e.clientX - drag.x) / r.width) * 1.6));
    else if (e.pointerType === 'mouse') mouseY = (e.clientY - r.top) / r.height;
    still();
  });
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, turn }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
  const drop = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);

  function intersect(o, d, poly) {
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den;
      const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
      if (t > 1e-6 && u >= 0 && u <= 1 && (!best || t < best.t)) {
        let nx = ey, ny = -ex; const L = Math.hypot(nx, ny); nx /= L; ny /= L;
        best = { t, p: [o[0] + t * d[0], o[1] + t * d[1]], n: [nx, ny] };
      }
    }
    return best;
  }
  function refract(d, n, n1, n2) {
    let nx = n[0], ny = n[1];
    let cosi = -(d[0] * nx + d[1] * ny);
    if (cosi < 0) { nx = -nx; ny = -ny; cosi = -cosi; }
    const mu = n1 / n2, k = 1 - mu * mu * (1 - cosi * cosi);
    if (k < 0) return { d: [d[0] + 2 * cosi * nx, d[1] + 2 * cosi * ny], tir: true };
    const f = mu * cosi - Math.sqrt(k);
    return { d: [mu * d[0] + f * nx, mu * d[1] + f * ny], tir: false };
  }

  function frame(t) {
    if (!W) { raf = requestAnimationFrame(frame); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
    for (const [x, y, b] of stars) { ctx.fillStyle = `rgba(200,215,255,${0.15 + 0.6 * b})`; ctx.fillRect(x * W, y * H, 1.2, 1.2); }
    const S = Math.min(W, H) * 0.42;
    const cx = W * 0.56, cy = H * 0.36;
    // orientation chosen so a horizontal beam meets the prism near minimum deviation
    const rot = -Math.PI / 2 + 0.574 + turn + (drag ? 0 : 0.07 * Math.sin(t / 3400));
    const prism = [0, 1, 2].map((k) => [cx + S * 0.62 * Math.cos(rot + (k * 2 * Math.PI) / 3), cy + S * 0.62 * Math.sin(rot + (k * 2 * Math.PI) / 3)]);
    const midY = (prism[0][1] + prism[2][1]) / 2, span = Math.abs(prism[0][1] - prism[2][1]);
    const by = midY + span * (mouseY != null ? (mouseY - 0.5) * 0.6 : 0.12 * Math.sin(t / 2100));
    const o0 = [-10, by], dirIn = [1, 0];

    ctx.globalCompositeOperation = 'lighter';
    // incident white beam
    const hit0 = intersect(o0, dirIn, prism);
    const grad = ctx.createLinearGradient(0, 0, hit0 ? hit0.p[0] : W, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.shadowColor = 'white'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(o0[0], o0[1]); ctx.lineTo(hit0 ? hit0.p[0] : W, hit0 ? hit0.p[1] : o0[1] + dirIn[1] * W); ctx.stroke();
    ctx.shadowBlur = 0;

    if (hit0) {
      lambdas.forEach((lam, i) => {
        const n = index('N-SF11', lam);
        let o = hit0.p, d = refract(dirIn, hit0.n, 1, n).d, inside = true;
        const pts = [o];
        for (let b = 0; b < 4 && inside; b++) {
          const hit = intersect(o, d, prism);
          if (!hit) break;
          pts.push(hit.p);
          const r = refract(d, hit.n, n, 1);
          o = hit.p; d = r.d;
          if (!r.tir) inside = false;
        }
        if (inside) return;
        const [r, g, bb] = cols[i];
        // inside the glass: faint
        ctx.strokeStyle = `rgba(${r},${g},${bb},0.06)`; ctx.lineWidth = 2;
        ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        // emergent fan: a faint wide glow and a thin core, fading with distance
        const L = W * 1.5, end = [o[0] + d[0] * L, o[1] + d[1] * L];
        const g2 = ctx.createLinearGradient(o[0], o[1], end[0], end[1]);
        g2.addColorStop(0, `rgba(${r},${g},${bb},0.30)`); g2.addColorStop(0.45, `rgba(${r},${g},${bb},0.12)`); g2.addColorStop(1, `rgba(${r},${g},${bb},0)`);
        ctx.strokeStyle = g2;
        ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(end[0], end[1]);
        ctx.globalAlpha = 0.18; ctx.lineWidth = 9; ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    // prism body
    const pg = ctx.createLinearGradient(prism[0][0], prism[0][1], prism[1][0], prism[1][1]);
    pg.addColorStop(0, 'rgba(160,190,255,0.10)'); pg.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = pg; ctx.strokeStyle = 'rgba(210,225,255,0.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); prism.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (!reducedMotion()) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { canvas, destroy: () => { cancelAnimationFrame(raf); ro.disconnect(); } };
}

export default function mount(root) {
  const hero = heroCanvas();
  root.append(
    h('div.hero', {}, hero.canvas,
      h('div.hero-text', {},
        h('h1', { html: 'Optica <em>Viva</em>' }),
        h('p', {}, t('A living laboratory of the optics behind every photograph, every film frame and every image from a space telescope. Each phenomenon is computed from first principles in your browser: exact ray tracing, Fourier diffraction, thin-film interference and turbulence statistics. Nothing is a canned animation.'))),
      h('span.hero-hint', { 'aria-hidden': 'true' }, t('Drag the prism to turn it'))),
  );
  const mods = MODULES.map(translated);
  // a card's picture: a snapshot of the laboratory, captured from the running page
  const pic = (id, big) => { const src = thumbOf(id); return src && READY.has(id) ? h('img.thumb', { src, alt: '', width: big ? 800 : 400, height: big ? 500 : 250, loading: big ? 'eager' : 'lazy', decoding: 'async' }) : null; };
  const card = (m, href, kicker, title, blurb, cls = '') => {
    const p = pic(m.id);
    return h('a.mcard' + cls + (p ? '.has-thumb' : ''), { href, style: { '--c': m.c } }, p, h('div.mbody', {}, h('span.k', {}, kicker), h('h3', {}, title), h('p', {}, blurb)));
  };
  root.append(h('section.block.featured', {}, h('h2', {}, t('Featured laboratories')),
    h('div.feat', {}, ...FEATURED.map((id) => mods.find((m) => m.id === id)).map((m) =>
      h('a.fcard', { href: '#/' + m.id, style: { '--c': m.c } }, pic(m.id, true), h('div.fbody', {}, h('span.k', {}, m.group), h('h3', {}, m.title), h('p', {}, m.blurb)))))));
  const groups = [...new Set(mods.filter((m) => m.blurb).map((m) => m.group))];
  root.append(h('section.block', { style: { marginTop: '38px' } },
    h('div.stat-row', {},
      h('div.stat', {}, h('b', {}, `${[...READY].filter((id) => id !== 'home').length} / ${MODULES.length - 1}`), h('span', {}, READY.size >= MODULES.length ? t('interactive laboratories and reference pages') : t('laboratories live (the rest are in progress)'))),
      h('div.stat', {}, h('b', {}, String(COUNT)), h('span', {}, t('catalogued phenomena with governing equations'))),
      h('div.stat', {}, h('b', {}, String(GLASS_NAMES.length)), h('span', {}, t('real glasses (Sellmeier), {n} lens and telescope prescriptions', { n: Object.keys(LENSES).length }))),
      h('div.stat', {}, h('b', {}, '0'), h('span', {}, t('precomputed results: every laboratory computes its pictures live'))),
    )));
  let visited = new Set();
  try { visited = new Set(JSON.parse(localStorage.getItem('ov-visited') || '[]')); } catch { /* storage unavailable */ }
  let n = 0;
  root.append(h('section.block.start-here', {}, h('h2', {}, t('Start here')),
    h('p.lede', {}, t('New to optics? Follow this path from everyday photography to the research frontier. Each page starts with the idea in plain words and builds up to the full physics, so stop wherever you like; the order is only a suggestion.')),
    h('div.path', {}, ...PATH.map((st) => h('div.path-stage', {},
      h('div.path-head', {}, h('h3', {}, t(st.stage)), h('span.note', {}, t(st.note))),
      h('ol.path-steps', { start: n + 1 }, ...st.steps.map(([id, q]) => {
        n++;
        const m = mods.find((x) => x.id === id);
        return h('li', {}, h('a.path-step' + (visited.has(id) ? '.seen' : ''), { href: '#/' + id, style: { '--c': m.c } },
          h('span.path-n', { 'aria-hidden': 'true' }, visited.has(id) ? '✓' : String(n)),
          h('span.path-t', {}, h('b', {}, m.title), h('span', {}, t(q))),
          visited.has(id) ? h('span.sr-only', {}, ' ' + t('(opened before)')) : null));
      })))))));
  root.append(h('section.block', {}, h('h2', {}, t('Guided tours')),
    h('p.lede', {}, t('A few minutes each: the tour moves the controls for you, one step at a time, and says what to look at.')),
    h('div.cards', {}, ...TOURS.map((tour) => {
      const m = mods.find((x) => x.id === tour.lab);
      return card(m, `#/${tour.lab}?tour=${tour.id}`, t('{lab} · {n} steps', { lab: m.title, n: tour.steps.length }), t(tour.title), t(tour.blurb));
    }))));
  for (const g of groups) {
    root.append(h('section.block', {}, h('h2', {}, g),
      h('div.cards', {}, ...mods.filter((m) => m.group === g && m.blurb).map((m) =>
        card(m, '#/' + m.id, READY.has(m.id) ? m.group : m.group + ' · ' + t('coming soon'), m.title, m.blurb, READY.has(m.id) ? '' : '.soon')))));
  }
  root.append(h('section.block', {}, h('h2', {}, t('How to read this laboratory')),
    h('div.prose', { html: `<p>${t(READ_1)}</p><p>${t(READ_2)}</p>` })));
  return () => hero.destroy();
}
