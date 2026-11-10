// Minimal, crisp canvas charting: linear/log axes, nice ticks, series, fills, markers.
import { theme } from './ui.js';
import { t, localNum } from './i18n.js';

// Chart text (title, axis labels, marker labels, legend) is translated here, like the toolkit's
// control labels; text that is not a string, or has no translation, is drawn as given.
const tr = (s) => (typeof s === 'string' ? t(s) : s);

function niceStep(range, target) {
  const raw = range / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}
function ticks(ax, target) {
  if (ax.log) {
    const out = [];
    for (let e = Math.floor(Math.log10(ax.min)); e <= Math.ceil(Math.log10(ax.max)); e++) {
      for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= ax.min * 0.999 && v <= ax.max * 1.001) out.push({ v, major: m === 1 }); }
    }
    return out;
  }
  const lo = Math.min(ax.min, ax.max), hi = Math.max(ax.min, ax.max); // reversed axes allowed
  const st = ax.step || niceStep(hi - lo, target);
  const out = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-9; v += st) out.push({ v: Math.abs(v) < st * 1e-9 ? 0 : v, major: true });
  return out;
}
// Large and small ticks in exponent form with as few digits as still give the tick's value, so
// neighbouring ticks never share a label (−15 000 is −1.5e+4, not −2e+4).
const expLabel = (v) => { for (let p = 0; p < 4; p++) { const s = v.toExponential(p); if (Math.abs(+s - v) <= 1e-6 * Math.abs(v)) return s; } return v.toExponential(3); };
export const tickLabel = (v, ax = {}) => localNum(ax.fmt ? ax.fmt(v) : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? expLabel(v) : String(+v.toPrecision(4)));

// The legend sits in rows above the plot area, never on the curves. Given the width of each label,
// returns the rows as lists of { i, x }: entry i starts x px from the left of its row.
export const LEGEND_ROW = 16, LEGEND_MARK = 20;
export function legendRows(widths, maxW, gap = 14) {
  const rows = [];
  let x = Infinity;
  widths.forEach((wd, i) => {
    if (x + LEGEND_MARK + wd > maxW) { rows.push([]); x = 0; }
    rows[rows.length - 1].push({ i, x });
    x += LEGEND_MARK + wd + gap;
  });
  return rows;
}

// A value for the hover readout: four significant digits, exponent form outside 1e-3 … 1e5.
export const readoutLabel = (v, ax = {}) => localNum(ax.fmt ? String(ax.fmt(v)) : v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) ? v.toExponential(2) : String(+v.toPrecision(4)));

// What a chart shows under the pointer. p is a plot as stored on its canvas (axes, padding, size,
// series); px, py are in the plot's own pixels. A series whose x runs one way is interpolated at
// the pointer's x; any other (a closed curve, scattered points) gives its nearest point within
// `reach` px. Returns null outside the plot area, else { x, px, rows: [{ i, x, y, px, py, at }] }.
export function readout(p, px, py, reach = 24) {
  const { pad, w, h, x, y } = p;
  if (px < pad.l || px > w - pad.r || py < pad.t || py > h - pad.b) return null;
  const fx = (px - pad.l) / (w - pad.l - pad.r), fy = (h - pad.b - py) / (h - pad.t - pad.b);
  const inv = (ax, f) => (ax.log ? ax.min * (ax.max / ax.min) ** f : ax.min + f * (ax.max - ax.min));
  const X = (v) => pad.l + (x.log ? Math.log(v / x.min) / Math.log(x.max / x.min) : (v - x.min) / (x.max - x.min)) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (y.log ? Math.log(v / y.min) / Math.log(y.max / y.min) : (v - y.min) / (y.max - y.min)) * (h - pad.t - pad.b);
  const rows = [];
  p.series.forEach((s, i) => {
    const pts = s.data.filter((q) => isFinite(q[0]) && isFinite(q[1]) && (!y.log || q[1] > 0) && (!x.log || q[0] > 0));
    if (!pts.length) return;
    let dir = 0, mono = !s.points && pts.length > 1;
    for (let k = 1; k < pts.length && mono; k++) {
      const d = Math.sign(pts[k][0] - pts[k - 1][0]);
      if (d && dir && d !== dir) mono = false;
      dir ||= d;
    }
    if (mono && dir) {
      for (let k = 1; k < pts.length; k++) {
        const a = X(pts[k - 1][0]), b = X(pts[k][0]);
        if (a === b || (px - a) * (px - b) > 0) continue;
        const f = (px - a) / (b - a), qy = Y(pts[k - 1][1]) + f * (Y(pts[k][1]) - Y(pts[k - 1][1]));
        if (qy >= pad.t - 1 && qy <= h - pad.b + 1) rows.push({ i, x: inv(x, fx), y: inv(y, (h - pad.b - qy) / (h - pad.t - pad.b)), px, py: qy, at: false });
        return;
      }
      return;
    }
    let best = null, bd = reach * reach;
    for (const q of pts) {
      const qx = X(q[0]), qy = Y(q[1]), d = (qx - px) ** 2 + (qy - py) ** 2;
      if (d <= bd) { bd = d; best = { i, x: q[0], y: q[1], px: qx, py: qy, at: true }; }
    }
    if (best) rows.push(best);
  });
  return { x: inv(x, fx), y: inv(y, fy), px, py, rows };
}

// Returns a mapper {X(v), Y(v), pad} so callers can overlay custom marks.
export function plot(ctx, w, h, opt) {
  const T = theme();
  const x = opt.x, y = opt.y;
  // room for the stage's own caption (ui.js), unless the caller set the top padding itself
  const inset = opt.padT == null ? ctx.canvas._inset || 0 : 0;
  const padL = opt.padL ?? 52, padR = opt.padR ?? 14;
  const shown = opt.legend ? (opt.series || []).filter((s) => s.label) : [];
  ctx.save(); ctx.font = '11px Inter, system-ui, sans-serif';
  const lrows = legendRows(shown.map((s) => ctx.measureText(tr(s.label)).width), w - padL - padR);
  ctx.restore();
  const top = (opt.padT ?? (opt.title ? 26 : 12)) + inset;
  const pad = { l: padL, r: padR, t: top + (lrows.length ? lrows.length * LEGEND_ROW + 2 : 0), b: opt.padB ?? 38 };
  const X = (v) => pad.l + (x.log ? Math.log(v / x.min) / Math.log(x.max / x.min) : (v - x.min) / (x.max - x.min)) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (y.log ? Math.log(v / y.min) / Math.log(y.max / y.min) : (v - y.min) / (y.max - y.min)) * (h - pad.t - pad.b);
  ctx.save();
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
  ctx.lineWidth = 1;
  // grid + ticks
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of ticks(x, Math.max(3, (w - pad.l - pad.r) / 80))) {
    const px = Math.round(X(t.v)) + 0.5;
    ctx.strokeStyle = t.major ? T.grid : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, h - pad.b); ctx.stroke();
    if (t.major || !x.log) { ctx.fillStyle = T.dim; ctx.fillText(tickLabel(t.v, x), px, h - pad.b + 6); }
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of ticks(y, Math.max(3, (h - pad.t - pad.b) / 50))) {
    const py = Math.round(Y(t.v)) + 0.5;
    ctx.strokeStyle = t.major ? T.grid : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(w - pad.r, py); ctx.stroke();
    if (t.major || !y.log) { ctx.fillStyle = T.dim; ctx.fillText(tickLabel(t.v, y), pad.l - 6, py); }
  }
  // axis labels
  ctx.fillStyle = T.dim; ctx.font = '11.5px Inter, system-ui, sans-serif';
  if (x.label) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(tr(x.label), (pad.l + w - pad.r) / 2, h - 3); }
  if (y.label) { ctx.save(); ctx.translate(12, (pad.t + h - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr(y.label), 0, 0); ctx.restore(); }
  if (opt.title) {
    ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 12px Inter, system-ui, sans-serif';
    let title = tr(opt.title);
    const room = w - pad.l - pad.r;
    if (ctx.measureText(title).width > room) { while (title.length > 4 && ctx.measureText(title + '…').width > room) title = title.slice(0, -1); title = title.trimEnd() + '…'; }
    ctx.fillText(title, pad.l, 6 + inset);
  }
  // legend: rows between the title and the plot area, each entry marked the way its series is drawn
  lrows.forEach((row, r) => {
    const ly = top - 4 + r * LEGEND_ROW + LEGEND_ROW / 2;
    for (const { i, x: lx0 } of row) {
      const s = shown[i], lx = pad.l + lx0;
      ctx.fillStyle = ctx.strokeStyle = s.color;
      if (s.points) { ctx.beginPath(); ctx.arc(lx + 7, ly, 3, 0, 7); ctx.fill(); }
      else { ctx.lineWidth = Math.min(3, s.width || 2); ctx.setLineDash(s.dash || []); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 14, ly); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = T.fg; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(tr(s.label), lx + LEGEND_MARK, ly);
    }
  });
  ctx.lineWidth = 1;

  ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
  for (const b of opt.bands || []) {
    ctx.fillStyle = b.color;
    if (b.x) ctx.fillRect(X(b.x[0]), pad.t, X(b.x[1]) - X(b.x[0]), h - pad.t - pad.b);
    if (b.y) ctx.fillRect(pad.l, Y(b.y[1]), w - pad.l - pad.r, Y(b.y[0]) - Y(b.y[1]));
  }
  for (const s of opt.series || []) {
    const pts = s.data.filter((p) => isFinite(p[0]) && isFinite(p[1]) && (!y.log || p[1] > 0) && (!x.log || p[0] > 0));
    if (!pts.length) continue;
    if (s.fill) {
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Y(s.fillTo ?? (y.log ? y.min : Math.max(y.min, 0))));
      for (const p of pts) ctx.lineTo(X(p[0]), Y(p[1]));
      ctx.lineTo(X(pts[pts.length - 1][0]), Y(s.fillTo ?? (y.log ? y.min : Math.max(y.min, 0))));
      ctx.closePath(); ctx.fillStyle = s.fill; ctx.fill();
    }
    if (s.points) {
      ctx.fillStyle = s.color;
      for (const p of pts) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), s.r || 3, 0, 7); ctx.fill(); }
      continue;
    }
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
    ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
  }
  for (const v of opt.vlines || []) {
    ctx.strokeStyle = v.color || T.faint; ctx.setLineDash(v.dash || [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(v.x) + 0.5, pad.t); ctx.lineTo(X(v.x) + 0.5, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
    if (v.label) { ctx.fillStyle = v.color || T.dim; ctx.font = '10.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(tr(v.label), X(v.x) + 4, pad.t + 4 + (v.dy || 0)); }
  }
  for (const v of opt.hlines || []) {
    ctx.strokeStyle = v.color || T.faint; ctx.setLineDash(v.dash || [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v.y) + 0.5); ctx.lineTo(w - pad.r, Y(v.y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    if (v.label) { ctx.fillStyle = v.color || T.dim; ctx.font = '10.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(tr(v.label), w - pad.r - 4, Y(v.y) - 3); }
  }
  ctx.restore();
  ctx.strokeStyle = T.faint; ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, w - pad.l - pad.r - 1, h - pad.t - pad.b - 1);
  // keep the plotted data with the canvas so it can be exported as CSV
  const store = ctx.canvas._plots || (ctx.canvas._plots = []);
  // … and its geometry, for the hover readout (ui.js): size, padding, axes and where it was drawn
  const m = ctx.getTransform();
  store.push({ title: opt.title || '', x: x.label || 'x', y: y.label || 'y',
    series: (opt.series || []).map((s, i) => ({ label: s.label || `series ${i + 1}`, data: s.data || [], named: !!s.label, color: s.color, points: !!s.points })),
    geo: { pad, w, h, x, y, m: [m.a, m.d, m.e, m.f] } });
  return { X, Y, pad };
}

export function range(a, b, n) { return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)); }
export function logRange(a, b, n) { return Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1))); }
