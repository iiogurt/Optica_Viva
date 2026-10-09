// Small DOM toolkit: element builder, controls, responsive hi-DPI canvases, KaTeX helpers.

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
// spec: { key: {type:'range'|'select'|'toggle'|'seg', label, ...} } → {el, state}
export function controls(spec, onChange) {
  const state = {};
  const el = h('div.controls');
  const fire = rafThrottle(() => onChange && onChange(state));
  const api = { el, state, set: {} };
  for (const [key, s] of Object.entries(spec)) {
    if (s.type === 'heading') { el.append(h('div.ctl-heading', {}, s.label)); continue; }
    state[key] = s.value;
    let row;
    if (s.type === 'range') {
      const toPos = (v) => (s.log ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min));
      const fromPos = (p) => {
        let v = s.log ? s.min * Math.pow(s.max / s.min, p) : s.min + p * (s.max - s.min);
        if (s.step && !s.log) v = Math.round(v / s.step) * s.step;
        if (s.log) v = +v.toPrecision(3);
        return v;
      };
      const input = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: Math.round(toPos(s.value) * 1000) });
      const out = h('output');
      const show = () => { out.textContent = (s.fmt ? s.fmt(state[key]) : fmt(state[key])) + (s.unit ? ' ' + s.unit : ''); };
      input.addEventListener('input', () => { state[key] = fromPos(+input.value / 1000); show(); fire(); });
      api.set[key] = (v) => { state[key] = v; input.value = Math.round(toPos(v) * 1000); show(); };
      show();
      row = h('label.ctl.ctl-range', {}, h('span.ctl-label', {}, s.label, out), input);
    } else if (s.type === 'select') {
      const sel = h('select', {}, ...s.options.map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: v === s.value }, t);
      }));
      sel.addEventListener('change', () => { state[key] = sel.value; fire(); });
      api.set[key] = (v) => { state[key] = v; sel.value = v; };
      row = h('label.ctl', {}, h('span.ctl-label', {}, s.label), sel);
    } else if (s.type === 'toggle') {
      const cb = h('input', { type: 'checkbox', checked: !!s.value });
      cb.addEventListener('change', () => { state[key] = cb.checked; fire(); });
      api.set[key] = (v) => { state[key] = v; cb.checked = v; };
      row = h('label.ctl.ctl-toggle', {}, cb, h('span.switch'), h('span.ctl-label', {}, s.label));
    } else if (s.type === 'seg') {
      const btns = s.options.map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        const b = h('button', { type: 'button', class: v === s.value ? 'on' : '' }, t);
        b.addEventListener('click', () => { state[key] = v; btns.forEach((x) => x.classList.remove('on')); b.classList.add('on'); fire(); });
        b.dataset.v = v;
        return b;
      });
      api.set[key] = (v) => { state[key] = v; btns.forEach((x) => x.classList.toggle('on', x.dataset.v == v)); };
      row = h('div.ctl', {}, s.label ? h('span.ctl-label', {}, s.label) : null, h('div.seg', {}, ...btns));
    }
    if (s.hint) row.title = s.hint;
    el.append(row);
  }
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

// Defer heavy computations so slider dragging stays fluid.
export function debounce(fn, ms = 60) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Canvas stage: responsive, hi-DPI, aspect-locked ──────────────────────────────────────
export function stage({ aspect = 16 / 9, draw, minH = 160, maxH = Infinity, label, cls = '' }) {
  const canvas = h('canvas');
  const wrap = h('figure.stage' + (cls ? '.' + cls : ''), {}, canvas, label ? h('figcaption', {}, label) : null);
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
  return h('dl.readouts', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
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
