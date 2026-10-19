// Small DOM toolkit: element builder, controls, responsive hi-DPI canvases, KaTeX helpers.
import { t } from './i18n.js';

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
export function tex(src, display = false) {
  const span = h(display ? 'div.tex-display' : 'span');
  try { window.katex.render(src, span, { throwOnError: false, displayMode: display, strict: false, trust: true }); }
  catch { span.textContent = src; }
  return span;
}
export function setTex(el, src, display = true) {
  try { window.katex.render(src, el, { throwOnError: false, displayMode: display, strict: false }); }
  catch { el.textContent = src; }
}
export function renderMath(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false, strict: false,
    });
  }
}
// Prose block: HTML string with \( \) and \[ \] math.
export function prose(html, cls = '') {
  const el = h('div.prose' + (cls ? '.' + cls : ''), { html });
  renderMath(el);
  return el;
}

// ── Number formatting ────────────────────────────────────────────────────────────────────
export function fmt(v, digits = 3) {
  if (!isFinite(v)) return v > 0 ? '∞' : '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(digits - 1).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (_, e) => toSup(e));
  return (+v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function toSup(s) { const m = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }; return s.split('').map((c) => m[c] ?? c).join(''); }
export const texNum = (v, d = 3) => {
  if (!isFinite(v)) return '\\infty';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(d)}\\times10^{${e}}`; }
  return String(+v.toPrecision(d));
};

// ── Controls ─────────────────────────────────────────────────────────────────────────────
// ── Shareable state: every control mirrors its non-default value into the URL hash ─────
// (#/psf?preset=jwst&band=nir). The router calls resetUrlState() before mounting a page.
let urlKeys = new Map(), allKeys = new Map(), setters = new Map(), panels = 0;
export function resetUrlState() { urlKeys = new Map(); allKeys = new Map(); setters = new Map(); panels = 0; }
// Every control's current value, defaults included (for saved settings).
export const allSettings = () => Object.fromEntries([...allKeys].map(([k, get]) => [k, get()]));
// Set a control as if the reader had moved it (guided tours). Returns its row, or null if the page has no such control.
export function setControl(key, v) { const c = setters.get(key); if (!c) return null; c.set(v); return c.row; }
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
  const api = { el, state, set: {} };
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
      const show = () => { out.textContent = (s.fmt ? s.fmt(state[key]) : fmt(state[key])) + (s.unit ? ' ' + s.unit : ''); };
      input.addEventListener('input', () => { state[key] = fromPos(+input.value / 1000); show(); fire(); });
      api.set[key] = (v) => { state[key] = v; input.value = Math.round(toPos(v) * 1000); show(); writeUrlSoon(); };
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
    if (api.set[key]) setters.set(uk, { row, set: (v) => { api.set[key](v); fire(); } });
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

export function stage({ aspect = 16 / 9, draw, minH = 160, maxH = Infinity, label, cls = '' }) {
  // canvases are images to assistive technology; the numeric results live in the readouts
  const canvas = h('canvas', { role: 'img', 'aria-label': label ? tr(label) : t('Chart') });
  const wrap = h('figure.stage' + (cls ? '.' + cls : ''), {}, canvas, label ? h('figcaption', {}, tr(label)) : null);
  wrap.append(exportTools(canvas, label));
  const ctx = canvas.getContext('2d');
  const st = { canvas, ctx, el: wrap, w: 0, h: 0, dpr: 1, draw };
  const resize = () => {
    const w = canvas.clientWidth || wrap.clientWidth;
    if (!w) return;
    const hh = Math.max(minH, Math.min(maxH, Math.round(w / aspect)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (st.w === w && st.h === hh && st.dpr === dpr) return;
    st.w = w; st.h = hh; st.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    canvas.style.height = hh + 'px';
    st.redraw();
  };
  st.redraw = () => {
    if (!st.w) return;
    canvas._plots = [];
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, st.w, st.h);
    st.draw && st.draw(ctx, st.w, st.h, st);
  };
  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  st.destroy = () => ro.disconnect();
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
  return h('dl.readouts', { role: 'group', 'aria-label': t('Results') }, ...rows.flatMap(([k, v]) => [h('dt', {}, tr(k)), h('dd', {}, v)]));
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
// Every stage gets small buttons to save its picture as PNG and, when it holds a chart, the
// plotted data as CSV. File names start with the page id.
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
function exportTools(canvas, label) {
  const name = () => `${pageId()}-${slug(label || canvas._plots?.[0]?.title) || 'figure'}`;
  const png = h('button.st-btn', { type: 'button', title: t('Save this picture as PNG'), onClick: () => {
    // paint the page background behind transparent stages
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d'); x.fillStyle = getComputedStyle(document.body).backgroundColor || '#07080d'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
    c.toBlob((b) => b && download(b, name() + '.png'), 'image/png');
  } }, 'PNG');
  const csv = h('button.st-btn', { type: 'button', title: t('Save the chart data as CSV'), onClick: () => download(new Blob([plotsToCSV(canvas._plots || [])], { type: 'text/csv' }), name() + '.csv') }, 'CSV');
  const box = h('div.stage-tools', {}, png, csv);
  // show the CSV button only when the canvas holds a chart
  const refresh = () => { csv.hidden = !(canvas._plots && canvas._plots.length); };
  canvas.addEventListener('pointerenter', refresh); box.addEventListener('focusin', refresh); box.addEventListener('pointerenter', refresh);
  return box;
}
