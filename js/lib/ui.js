// Small DOM toolkit: element builder, controls, responsive hi-DPI canvases, KaTeX helpers.
import { t, localNum, decimalComma } from './i18n.js';
import { readout, readoutLabel } from './plot.js';

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    // custom properties (--c) need setProperty: Object.assign on el.style silently ignores them
    if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x; }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ' ' + v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// ── KaTeX ────────────────────────────────────────────────────────────────────────────────
// Equations wider than their column scroll sideways (CSS). Such a region, and only such a region,
// is made focusable and named, so it can be scrolled with the keyboard too (WCAG 2.1.1); checked
// after every render and whenever such a box changes size (a scrollbar appearing narrows the column).
const MATH_SCROLLERS = '.calc, .katex-display, .entry-body .eq, .mstep-eq, .table-scroll';
const watched = new Set();
let sizes = null;
export function markScrollableMath(root = document) {
  if (!sizes && typeof ResizeObserver === 'function') sizes = new ResizeObserver(() => checkMathSoon());
  for (const el of watched) if (!el.isConnected) { sizes.unobserve(el); watched.delete(el); }
  for (const el of root.querySelectorAll(MATH_SCROLLERS)) {
    if (sizes && !watched.has(el)) { watched.add(el); sizes.observe(el); }
    const ox = getComputedStyle(el).overflowX;
    const table = el.classList.contains('table-scroll');
    const wide = (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !!el.querySelector(table ? 'table' : '.katex');
    if (wide && !el.hasAttribute('data-scrolls')) {
      el.setAttribute('data-scrolls', ''); el.tabIndex = 0; el.setAttribute('role', 'group'); el.setAttribute('aria-label', table ? t('Table, scrolls sideways') : t('Equation, scrolls sideways'));
    } else if (!wide && el.hasAttribute('data-scrolls')) {
      for (const a of ['data-scrolls', 'tabindex', 'role', 'aria-label']) el.removeAttribute(a);
    }
  }
}
let mathPending = false;
const checkMathSoon = () => {
  if (mathPending || typeof requestAnimationFrame !== 'function') return;
  mathPending = true;
  requestAnimationFrame(() => { mathPending = false; markScrollableMath(); });
};
if (typeof window !== 'undefined') { window.addEventListener('resize', checkMathSoon); document.fonts?.ready.then(checkMathSoon); }
// One set of options for every formula. KaTeX's trust stays off: no page needs \href, \url,
// \includegraphics or the \html… commands, so they render as errors instead of links or attributes.
export const TEX_OPTIONS = Object.freeze({ throwOnError: false, strict: false });
export function tex(src, display = false) {
  const span = h(display ? 'div.tex-display' : 'span');
  try { window.katex.render(src, span, { ...TEX_OPTIONS, displayMode: display }); }
  catch { span.textContent = src; }
  checkMathSoon();
  return span;
}
export function setTex(el, src, display = true) {
  try { window.katex.render(src, el, { ...TEX_OPTIONS, displayMode: display }); }
  catch { el.textContent = src; }
  checkMathSoon();
}
export function renderMath(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      ...TEX_OPTIONS,
    });
  }
  checkMathSoon();
}
// Prose block: HTML string with \( \) and \[ \] math.
export function prose(html, cls = '') {
  const el = h('div.prose' + (cls ? '.' + cls : ''), { html });
  // a wide table scrolls inside its own box instead of widening the page
  for (const tb of el.querySelectorAll('table')) { const w = h('div.table-scroll'); tb.replaceWith(w); w.append(tb); }
  renderMath(el);
  return el;
}

// ── Number formatting ────────────────────────────────────────────────────────────────────
export function fmt(v, digits = 3) {
  if (!isFinite(v)) return v > 0 ? '∞' : '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return localNum(v.toExponential(digits - 1).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (_, e) => toSup(e)));
  const out = (+v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  return decimalComma() ? out.replace(/,/g, '\u202f').replace('.', ',') : out;
}
function toSup(s) { const m = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }; return s.split('').map((c) => m[c] ?? c).join(''); }
export const texNum = (v, d = 3) => {
  if (!isFinite(v)) return '\\infty';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) { const e = Math.floor(Math.log10(a)), m = (v / 10 ** e).toPrecision(d); return `${decimalComma() ? m.replace('.', '{,}') : m}\\times10^{${e}}`; }
  return decimalComma() ? String(+v.toPrecision(d)).replace('.', '{,}') : String(+v.toPrecision(d));
};

// ── Controls ─────────────────────────────────────────────────────────────────────────────
// ── Shareable state: every control mirrors its non-default value into the URL hash ─────
// (#/psf?preset=jwst&band=nir). The router calls resetUrlState() before mounting a page.
let urlKeys = new Map(), allKeys = new Map(), setters = new Map(), panels = 0;
export function resetUrlState() { urlKeys = new Map(); allKeys = new Map(); setters = new Map(); panels = 0; }
// Every control's current value, defaults included (for saved settings).
export const allSettings = () => Object.fromEntries([...allKeys].map(([k, get]) => [k, get()]));
// Set a control as if the reader had moved it (guided tours). Returns its row, or null if the page has no such control.
// animate: a slider glides to its new value (about ½ s, the page recomputing on the way) unless
// the reader prefers reduced motion; other controls change at once.
export function setControl(key, v, { animate = false } = {}) {
  const c = setters.get(key);
  if (!c) return null;
  if (animate && c.tween && !reducedMotion()) c.tween(v); else c.set(v);
  return c.row;
}
// ease-in-out (cubic) over [0, 1]
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, get] of urlKeys) { const v = get(); if (v != null) p.set(k, v); }
  const base = location.hash.split('?')[0] || '#/';
  history.replaceState(null, '', base + (p.toString() ? '?' + p : ''));
}
const writeUrlSoon = rafThrottle(writeUrl);
function parseParam(s, raw) {
  if (raw == null) return undefined;
  if (s.type === 'range') { const v = +raw; return isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : undefined; }
  if (s.type === 'toggle') return raw === '1';
  const ok = s.options.some((o) => String(Array.isArray(o) ? o[0] : o) === raw);
  if (!ok) return undefined;
  const opt = s.options.find((o) => String(Array.isArray(o) ? o[0] : o) === raw);
  return Array.isArray(opt) ? opt[0] : opt;
}
const serialise = (s, v) => (s.type === 'toggle' ? (v ? '1' : '0') : s.type === 'range' ? String(+(+v).toPrecision(6)) : String(v));

// Extra (non-control) state in the URL, e.g. a custom lens: getter returns a string or null.
export const readUrlParam = (key) => hashParams().get(key);
export function bindUrlParam(key, getter) { urlKeys.set(key, getter); writeUrlSoon(); }
export const syncUrl = () => writeUrlSoon();
// Embed mode (#/<lab>?embed=1): the page without navigation or theory, for an iframe.
export function withEmbed(url, on) {
  const [base, q = ''] = url.split('#'), [path, query = ''] = q.split('?');
  const p = new URLSearchParams(query);
  if (on) p.set('embed', '1'); else p.delete('embed');
  return base + '#' + path + (p.toString() ? '?' + p : '');
}
export const embedCode = (url, title) => `<iframe src="${withEmbed(url, true).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" title="${title.replace(/"/g, '&quot;')} (Optica Viva)" width="100%" height="760" style="border:0;border-radius:12px" loading="lazy"></iframe>`;

// spec: { key: {type:'range'|'select'|'toggle'|'seg', label, ...} } → {el, state}
// Labels, hints and option texts are translated here (js/lib/i18n.js).
const tr = (s) => (typeof s === 'string' ? t(s) : s);
export function controls(spec, onChange) {
  const state = {};
  const el = h('div.controls');
  const panel = ++panels;
  // s.when(state) → false hides a control (e.g. options that only apply to one model)
  const conditional = [];
  const applyWhen = () => conditional.forEach(([row, when]) => { row.hidden = !when(state); });
  const fire = rafThrottle(() => { applyWhen(); writeUrlSoon(); onChange && onChange(state); });
  const api = { el, state, set: {} }, tweens = new Map();
  const params = hashParams();
  for (const [key, s] of Object.entries(spec)) {
    if (s.type === 'heading') { el.append(h('div.ctl-heading', {}, tr(s.label))); continue; }
    // URL key: plain, or prefixed when a second control panel on the page reuses the name
    const uk = urlKeys.has(key) ? `p${panel}.${key}` : key;
    const fromUrl = parseParam(s, params.get(uk));
    state[key] = fromUrl !== undefined ? fromUrl : s.value;
    urlKeys.set(uk, () => (serialise(s, state[key]) === serialise(s, s.value) ? null : serialise(s, state[key])));
    allKeys.set(uk, () => state[key]);
    let row;
    if (s.type === 'range') {
      const toPos = (v) => (s.log ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min));
      const fromPos = (p) => {
        let v = s.log ? s.min * Math.pow(s.max / s.min, p) : s.min + p * (s.max - s.min);
        if (s.step && !s.log) v = Math.round(v / s.step) * s.step;
        if (s.log) v = +v.toPrecision(3);
        return v;
      };
      const input = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: Math.round(toPos(state[key]) * 1000), 'aria-label': tr(s.label) });
      const out = h('output');
      // the input runs over positions 0–1000 (linear or logarithmic); assistive technology hears the
      // physical value with its unit instead, on load, on every change and when a tour sets it
      const show = () => { out.textContent = localNum(s.fmt ? s.fmt(state[key]) : fmt(state[key])) + (s.unit ? ' ' + s.unit : ''); input.setAttribute('aria-valuetext', out.textContent); };
      let glide = 0; // a running tween (setControl … animate), stopped by the reader's own input
      input.addEventListener('input', () => { cancelAnimationFrame(glide); state[key] = fromPos(+input.value / 1000); show(); fire(); });
      api.set[key] = (v) => { cancelAnimationFrame(glide); state[key] = v; input.value = Math.round(toPos(v) * 1000); show(); writeUrlSoon(); };
      // in slider position, so a logarithmic control glides evenly; the last frame sets v exactly
      tweens.set(key, (v, ms = 550) => {
        cancelAnimationFrame(glide);
        const p0 = toPos(state[key]), p1 = toPos(v), t0 = performance.now();
        if (!(Math.abs(p1 - p0) > 1e-4)) { api.set[key](v); fire(); return; }
        const step = (now) => {
          const x = Math.min(1, (now - t0) / ms);
          state[key] = x < 1 ? fromPos(p0 + (p1 - p0) * ease(x)) : v;
          input.value = Math.round(toPos(state[key]) * 1000); show(); fire();
          if (x < 1) glide = requestAnimationFrame(step); else writeUrlSoon();
        };
        glide = requestAnimationFrame(step);
      });
      show();
      row = h('label.ctl.ctl-range', {}, h('span.ctl-label', {}, tr(s.label), out), input);
    } else if (s.type === 'select') {
      const sel = h('select', {}, ...s.options.map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: v === state[key] }, tr(text));
      }));
      sel.addEventListener('change', () => { state[key] = sel.value; fire(); });
      api.set[key] = (v) => { state[key] = v; sel.value = v; writeUrlSoon(); };
      row = h('label.ctl', {}, h('span.ctl-label', {}, tr(s.label)), sel);
    } else if (s.type === 'toggle') {
      const cb = h('input', { type: 'checkbox', checked: !!state[key] });
      cb.addEventListener('change', () => { state[key] = cb.checked; fire(); });
      api.set[key] = (v) => { state[key] = v; cb.checked = v; writeUrlSoon(); };
      row = h('label.ctl.ctl-toggle', {}, cb, h('span.switch'), h('span.ctl-label', {}, tr(s.label)));
    } else if (s.type === 'seg') {
      const btns = s.options.map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, o];
        const b = h('button', { type: 'button', class: v === state[key] ? 'on' : '', 'aria-pressed': String(v === state[key]) }, tr(text));
        b.addEventListener('click', () => { state[key] = v; btns.forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); fire(); });
        b.dataset.v = v;
        return b;
      });
      api.set[key] = (v) => { state[key] = v; btns.forEach((x) => { x.classList.toggle('on', x.dataset.v == v); x.setAttribute('aria-pressed', String(x.dataset.v == v)); }); writeUrlSoon(); };
      row = h('div.ctl', {}, s.label ? h('span.ctl-label', {}, tr(s.label)) : null, h('div.seg', {}, ...btns));
    }
    if (s.hint) row.title = tr(s.hint);
    if (api.set[key]) setters.set(uk, { row, set: (v) => { api.set[key](v); fire(); }, tween: tweens.get(key) });
    if (s.when) conditional.push([row, s.when]);
    el.append(row);
  }
  applyWhen();
  return api;
}

export function rafThrottle(fn) {
  let pending = false;
  return (...a) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...a); });
  };
}

// Copy the current URL (with its state), or other text, to the clipboard.
export async function copyLink(btn, url = location.href, done = t('Link copied ✓')) {
  try { await navigator.clipboard.writeText(url); }
  catch { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, url); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  const old = btn.textContent; btn.textContent = done; setTimeout(() => (btn.textContent = old), 1600);
}

// Defer heavy computations so slider dragging stays fluid.
export function debounce(fn, ms = 60) {
  let timer;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

// ── Canvas stage: responsive, hi-DPI, aspect-locked ──────────────────────────────────────
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A canvas without its own caption is named after the charts drawn on it, their titles and axes
// ("Spot size: RMS radius (µm) against field (°)"), so several charts on a page can be told apart.
function nameFromPlots(canvas) {
  const plots = canvas._plots || [];
  if (!plots.length) return;
  const name = plots.map((p) => (p.title ? t('{title}: {y} against {x}', { title: tr(p.title), x: tr(p.x), y: tr(p.y) }) : t('Chart: {y} against {x}', { x: tr(p.x), y: tr(p.y) }))).join('; ');
  if (canvas.getAttribute('aria-label') !== name) canvas.setAttribute('aria-label', name);
}
// name: an accessible name for a canvas without a visible caption that draws no chart of plot()
export function stage({ aspect = 16 / 9, draw, minH = 160, maxH = Infinity, label, name, cls = '' }) {
  // canvases are images to assistive technology; the numeric results live in the readouts
  const canvas = h('canvas', { role: 'img', 'aria-label': label ? tr(label) : name ? tr(name) : t('Chart') });
  const wrap = h('figure.stage' + (cls ? '.' + cls : ''), {}, canvas, label ? h('figcaption', {}, tr(label)) : null);
  if (label) canvas._inset = 16; // charts start below the caption (plot.js)
  const ctx = canvas.getContext('2d');
  const st = { canvas, ctx, el: wrap, w: 0, h: 0, dpr: 1, draw, hover: null };
  const resize = () => {
    const w = canvas.clientWidth || wrap.clientWidth;
    if (!w) return;
    // enlarged, the figure keeps its shape and fills the window (its width is set in zoom())
    const hh = big ? Math.round(w / aspect) : Math.max(minH, Math.min(maxH, Math.round(w / aspect)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (st.w === w && st.h === hh && st.dpr === dpr) return;
    st.w = w; st.h = hh; st.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    canvas.style.height = hh + 'px';
    st.redraw();
    st.resized && st.resized(); // a page that computes at the canvas's resolution can recompute
  };
  st.redraw = () => {
    if (!st.w) return;
    canvas._plots = [];
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, st.w, st.h);
    st.draw && st.draw(ctx, st.w, st.h, st);
    if (!label) nameFromPlots(canvas);
    st.refreshTools && st.refreshTools();
    if (shown) show(shown); // the readout follows new data
  };

  // ── A second canvas above the picture for transient marks: the hover readout of a chart, or
  // whatever a laboratory draws with over(). It is not part of the PNG export.
  let top = null;
  st.over = () => {
    if (!top) { top = h('canvas.stage-over', { 'aria-hidden': 'true' }); canvas.after(top); }
    if (top.width !== canvas.width || top.height !== canvas.height) { top.width = canvas.width; top.height = canvas.height; top.style.height = canvas.style.height; }
    const o = top.getContext('2d');
    o.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    o.clearRect(0, 0, st.w, st.h);
    return o;
  };
  // Hover readout: a guide at the pointer, a dot on every series there and the values in a box.
  // `shown` is { k, px, py } in the pixels of chart k; mark(x) shows the readout at data value x
  // of the first chart (to link it to another figure) and mark(null) removes it; st.hover(info)
  // is told what the pointer shows ({ k, x, y, rows } or null).
  let shown = null;
  const geoOf = (k) => { const p = canvas._plots?.[k]; return p?.geo ? { ...p.geo, series: p.series, ox: p.geo.m[2] / st.dpr, oy: p.geo.m[3] / st.dpr } : null; };
  function show(at) {
    shown = at;
    const g = at && geoOf(at.k), r = g && readout(g, at.px, at.py);
    if (!r) { shown = null; if (top) st.over(); return null; }
    const o = st.over(), T = theme();
    o.translate(g.ox, g.oy);
    const guide = r.rows.some((q) => !q.at) || !r.rows.length;
    if (guide) { o.strokeStyle = 'rgba(255,255,255,0.28)'; o.lineWidth = 1; o.beginPath(); o.moveTo(Math.round(r.px) + 0.5, g.pad.t); o.lineTo(Math.round(r.px) + 0.5, g.h - g.pad.b); o.stroke(); }
    for (const q of r.rows) { o.beginPath(); o.arc(q.px, q.py, 4, 0, 7); o.fillStyle = g.series[q.i].color || T.fg; o.fill(); o.lineWidth = 1.5; o.strokeStyle = '#07080d'; o.stroke(); }
    // the box: the x value, then one line per series
    const xName = tr(g.x.label || 'x'), lines = [{ text: `${xName}: ${readoutLabel(guide ? r.x : r.rows[0].x, g.x)}`, head: true }];
    for (const q of r.rows) {
      const s = g.series[q.i], val = q.at && guide ? `${readoutLabel(q.x, g.x)}, ${readoutLabel(q.y, g.y)}` : readoutLabel(q.y, g.y);
      lines.push({ text: s.named ? `${tr(s.label)}: ${val}` : val, color: s.color || T.fg });
    }
    if (!r.rows.length) lines.push({ text: `${tr(g.y.label || 'y')}: ${readoutLabel(r.y, g.y)}`, color: null });
    o.font = '11.5px Inter, system-ui, sans-serif';
    const bw = Math.min(g.w - 8, Math.max(...lines.map((l) => o.measureText(l.text).width + (l.head ? 0 : 14))) + 16), bh = lines.length * 16 + 10;
    const bx = r.px + 14 + bw > g.w - 2 ? Math.max(2, r.px - 14 - bw) : r.px + 14, by = Math.max(2, Math.min(g.h - bh - 2, at.py - bh / 2));
    o.fillStyle = 'rgba(12,14,22,0.94)'; o.strokeStyle = 'rgba(255,255,255,0.16)'; o.lineWidth = 1;
    o.beginPath(); o.roundRect(bx + 0.5, by + 0.5, bw, bh, 7); o.fill(); o.stroke();
    o.textBaseline = 'middle'; o.textAlign = 'left';
    lines.forEach((l, i) => {
      const ty = by + 13 + i * 16;
      if (l.head) { o.fillStyle = T.dim; o.fillText(l.text, bx + 8, ty, bw - 16); return; }
      if (l.color) { o.fillStyle = l.color; o.fillRect(bx + 8, ty - 1.5, 8, 3); }
      o.fillStyle = T.fg; o.fillText(l.text, bx + 22, ty, bw - 30);
    });
    return r;
  }
  st.mark = (x) => {
    const g = geoOf(0);
    if (x == null || !g || !isFinite(x)) { show(null); return; }
    const f = g.x.log ? Math.log(x / g.x.min) / Math.log(g.x.max / g.x.min) : (x - g.x.min) / (g.x.max - g.x.min);
    show({ k: 0, px: g.pad.l + f * (g.w - g.pad.l - g.pad.r), py: (g.pad.t + g.h - g.pad.b) / 2 });
  };
  const point = rafThrottle((e) => {
    const n = canvas._plots?.length || 0;
    if (!n) return;
    const box = canvas.getBoundingClientRect(), cx = e.clientX - box.left, cy = e.clientY - box.top;
    let r = null, k = 0;
    for (; k < n && !r; k++) { const g = geoOf(k); if (g) r = show({ k, px: cx - g.ox, py: cy - g.oy }); }
    wrap.classList.toggle('reading', !!r); // the tools step aside while values are read
    st.hover && st.hover(r ? { k: k - 1, ...r } : null);
  });
  canvas.addEventListener('pointermove', point);
  canvas.addEventListener('pointerdown', point);
  canvas.addEventListener('pointerleave', () => { requestAnimationFrame(() => { wrap.classList.remove('reading'); if (shown) show(null); st.hover && st.hover(null); }); });

  // ── Enlarge: the figure, at its own shape, as large as the window allows; Escape or a click
  // beside it puts it back. A placeholder keeps the page from jumping.
  let big = null;
  st.zoom = (on = !big) => {
    if (!!on === !!big) return;
    if (on) {
      const hold = h('div.stage-hold', { style: { height: wrap.offsetHeight + 'px' } }), shade = h('div.stage-shade', { onClick: () => st.zoom(false) });
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); st.zoom(false); } };
      const fit = () => { wrap.style.width = Math.floor(Math.min(innerWidth * 0.94, innerHeight * 0.9 * aspect)) + 'px'; };
      big = { hold, shade, key, fit };
      wrap.before(hold); document.body.append(shade); wrap.classList.add('zoomed'); fit();
      document.addEventListener('keydown', key); window.addEventListener('resize', fit);
    } else {
      big.hold.remove(); big.shade.remove(); wrap.classList.remove('zoomed'); wrap.style.width = '';
      document.removeEventListener('keydown', big.key); window.removeEventListener('resize', big.fit);
      big = null;
    }
    resize();
    st.onZoom && st.onZoom(!!big);
  };
  wrap.append(exportTools(canvas, label, st));
  // without a hovering pointer (touch screens) the tools appear when the figure is tapped and go
  // when anything else is
  wrap.addEventListener('pointerdown', () => {
    if (wrap.classList.contains('tapped')) return;
    wrap.classList.add('tapped');
    const away = (e) => { if (!wrap.contains(e.target)) { wrap.classList.remove('tapped'); document.removeEventListener('pointerdown', away, true); } };
    document.addEventListener('pointerdown', away, true);
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  st.destroy = () => { if (big) st.zoom(false); ro.disconnect(); };
  st.resize = resize;
  return st;
}

// Blit a float/rgba buffer through an offscreen canvas.
export function imageCanvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const cx = c.getContext('2d');
  const img = cx.createImageData(w, hgt);
  return { c, cx, img, data: img.data, put: () => cx.putImageData(img, 0, 0) };
}

// Readout grid: rows = [[label, valueNode|string]]
export function readouts(rows) {
  // a native description list (each quantity a dt, its value the dd), inside a named group: a role
  // on the dl itself would hide the name–value pairs from assistive technology
  return h('div.readouts-group', { role: 'group', 'aria-label': t('Results') },
    h('dl.readouts', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, tr(k)), h('dd', {}, localNum(v))])));
}

// Section scaffold shared by all modules.
export function section(title, ...children) {
  return h('section.block', {}, title ? h('h2', {}, title) : null, ...children);
}

export function card(...children) { return h('div.card', {}, ...children); }

export const theme = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { fg: v('--fg'), dim: v('--fg-dim'), faint: v('--fg-faint'), grid: v('--grid'), accent: v('--accent'), accent2: v('--accent-2'), accent3: v('--accent-3'), bg: v('--bg'), panel: v('--panel'), warn: v('--warn') };
};

// ── Export ─────────────────────────────────────────────────────────────────────────────────
// Every stage gets small buttons to enlarge it, save its picture as PNG and, when it holds a
// chart, the plotted data as CSV. File names start with the page id.
const pageId = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home');
const slug = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// CSV in long format (series, x, y), one block per chart on the canvas.
export function plotsToCSV(plots) {
  const q = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const rows = [['chart', 'series', 'x: ' + (plots[0]?.x || 'x'), 'y: ' + (plots[0]?.y || 'y')]];
  for (const p of plots) for (const s of p.series) for (const pt of s.data) if (pt && isFinite(pt[0]) && isFinite(pt[1])) rows.push([p.title, s.label, pt[0], pt[1]]);
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
function exportTools(canvas, label, st) {
  const name = () => `${pageId()}-${slug(label || canvas._plots?.[0]?.title) || 'figure'}`;
  const png = h('button.st-btn', { type: 'button', title: t('Save this picture as PNG'), onClick: () => {
    // paint the page background behind transparent stages
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d'); x.fillStyle = getComputedStyle(document.body).backgroundColor || '#07080d'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
    c.toBlob((b) => b && download(b, name() + '.png'), 'image/png');
  } }, 'PNG');
  const csv = h('button.st-btn', { type: 'button', title: t('Save the chart data as CSV'), onClick: () => download(new Blob([plotsToCSV(canvas._plots || [])], { type: 'text/csv' }), name() + '.csv') }, 'CSV');
  const grow = h('button.st-btn', { type: 'button', title: t('Enlarge this figure'), 'aria-pressed': 'false', onClick: () => st.zoom() }, '⤢');
  st.onZoom = (on) => { grow.setAttribute('aria-pressed', String(on)); grow.title = on ? t('Back to normal size') : t('Enlarge this figure'); grow.textContent = on ? '✕' : '⤢'; };
  const box = h('div.stage-tools', {}, grow, png, csv);
  // show the CSV button only when the canvas holds a chart
  const refresh = () => { csv.hidden = !(canvas._plots && canvas._plots.length); };
  refresh();
  st.refreshTools = refresh; // called after every redraw
  return box;
}
