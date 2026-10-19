// Glass-map picker: an Abbe diagram (n_d or P_g,F against V_d) of every catalogue glass in a modal
// dialog. Hover shows a glass's data, click picks it. Used by the prescription editor.
import { h } from './ui.js';
import { plot } from './plot.js';
import { glassTable } from './glass.js';

const MAKERS = { SCHOTT: '#6ad7ff', OHARA: '#ffb547', CDGM: '#6be3a4', core: '#c18cff' };
const VIEWS = {
  nd: { label: 'n_d', y: (g) => g.nd, min: 1.4, max: 2.06 },
  pgf: { label: 'P_g,F', y: (g) => g.pgf, min: 0.50, max: 0.67 },
};

// openGlassMap({ current: name, title, onPick(name) })
export function openGlassMap({ current, title = 'Glass map', onPick }) {
  const rows = glassTable();
  const st = { view: 'nd', makers: new Set(Object.keys(MAKERS)), q: '', hover: null };
  const canvas = h('canvas.glassmap-canvas', { role: 'img', 'aria-label': 'Abbe diagram of the glass catalogue; hover a point for its data, click to choose it' });
  const info = h('div.glassmap-info', { 'aria-live': 'polite' }, 'Hover a glass for its data; click to use it.');
  const search = h('input.glassmap-search', { type: 'search', placeholder: 'Name or glass code, e.g. N-LAK9 or 517642', 'aria-label': 'Search glasses' });
  const viewSel = h('select', { 'aria-label': 'Vertical axis' }, h('option', { value: 'nd' }, 'n_d against V_d'), h('option', { value: 'pgf' }, 'P_g,F against V_d'));
  const makerBoxes = Object.entries(MAKERS).map(([m, c]) => {
    const box = h('input', { type: 'checkbox', checked: true });
    box.addEventListener('change', () => { if (box.checked) st.makers.add(m); else st.makers.delete(m); draw(); });
    return h('label.glassmap-maker', { style: { '--c': c } }, box, m === 'core' ? 'other' : m);
  });
  const dlg = h('dialog.glassmap', { 'aria-label': title },
    h('div.glassmap-head', {}, h('strong', {}, title), search, viewSel, ...makerBoxes, h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close')),
    canvas, info);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  let geo = null;
  const visible = () => rows.filter((g) => st.makers.has(g.maker) && (!st.q || g.name.toUpperCase().includes(st.q) || g.code.startsWith(st.q)));
  function describe(g) {
    return `<b>${g.name}</b> (${g.maker === 'core' ? 'reference set' : g.maker}) · code ${g.code} · n<sub>d</sub> = ${g.nd.toFixed(5)} · V<sub>d</sub> = ${g.vd.toFixed(2)} · P<sub>g,F</sub> = ${g.pgf.toFixed(4)} (${g.dpgf >= 0 ? '+' : ''}${g.dpgf.toFixed(4)} from the normal line) · ${g.type}${g.range ? ` · fit valid ${g.range[0]}–${g.range[1]} µm` : ''}`;
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 800, hh = canvas.clientHeight || 480;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, w, hh);
    const V = VIEWS[st.view];
    const { X, Y } = plot(ctx, w, hh, {
      x: { min: 96, max: 16, label: 'Abbe number V_d (decreasing: more dispersion →)' }, y: { min: V.min, max: V.max, label: V.label },
      series: st.view === 'pgf' ? [{ data: [[96, 0.6438 - 0.001682 * 96], [16, 0.6438 - 0.001682 * 16]], color: 'rgba(255,255,255,0.35)', dash: [5, 4], width: 1 }] : [],
    });
    const pts = visible().map((g) => ({ g, x: X(g.vd), y: Y(V.y(g)) }));
    for (const p of pts) {
      ctx.fillStyle = MAKERS[p.g.maker]; ctx.globalAlpha = p.g === st.hover ? 1 : 0.75;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.g === st.hover ? 5 : 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const cur = rows.find((g) => g.name === current);
    for (const g of [cur, st.hover].filter(Boolean)) {
      const x = X(g.vd), y = Y(V.y(g));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = x > w - 120 ? 'right' : 'left';
      ctx.fillText(g.name + (g === cur ? ' (current)' : ''), x + (x > w - 120 ? -12 : 12), y - 10);
    }
    geo = pts;
  }
  const nearest = (e) => {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 12 * 12;
    for (const p of geo || []) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p.g; } }
    return best;
  };
  canvas.addEventListener('pointermove', (e) => { const g = nearest(e); if (g !== st.hover) { st.hover = g; if (g) info.innerHTML = describe(g); draw(); } });
  canvas.addEventListener('click', (e) => { const g = nearest(e); if (g) { onPick(g.name); dlg.close(); } });
  search.addEventListener('input', () => {
    st.q = search.value.trim().toUpperCase();
    const v = visible();
    info.innerHTML = st.q ? (v.length ? `${v.length} match${v.length > 1 ? 'es' : ''}${v.length <= 6 ? ': ' + v.map((g) => g.name).join(', ') : ''}. Press Enter to use ${v[0].name}.` : 'No glass matches.') : 'Hover a glass for its data; click to use it.';
    if (v.length === 1) { st.hover = v[0]; info.innerHTML = describe(v[0]) + ' Press Enter to use it.'; }
    draw();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = visible(), exact = v.find((g) => g.name.toUpperCase() === st.q || g.code === st.q);
    if (exact || v.length) { onPick((exact || v[0]).name); dlg.close(); }
  });
  viewSel.addEventListener('change', () => { st.view = viewSel.value; draw(); });
  dlg.showModal();
  draw();
  search.focus();
  return dlg;
}
