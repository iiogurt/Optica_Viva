// Minimal, crisp canvas charting: linear/log axes, nice ticks, series, fills, markers.
import { theme } from './ui.js';

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
  const st = ax.step || niceStep(ax.max - ax.min, target);
  const out = [];
  for (let v = Math.ceil(ax.min / st - 1e-9) * st; v <= ax.max + st * 1e-9; v += st) out.push({ v: Math.abs(v) < st * 1e-9 ? 0 : v, major: true });
  return out;
}
const tickLabel = (v, ax) => ax.fmt ? ax.fmt(v) : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(0) : String(+v.toPrecision(4));

// Returns a mapper {X(v), Y(v), area} so callers can overlay custom marks.
export function plot(ctx, w, h, opt) {
  const T = theme();
  const pad = { l: opt.padL ?? 52, r: opt.padR ?? 14, t: opt.padT ?? (opt.title ? 26 : 12), b: opt.padB ?? 38 };
  const x = opt.x, y = opt.y;
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
  if (x.label) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(x.label, (pad.l + w - pad.r) / 2, h - 3); }
  if (y.label) { ctx.save(); ctx.translate(12, (pad.t + h - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(y.label, 0, 0); ctx.restore(); }
  if (opt.title) { ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.fillText(opt.title, pad.l, 6); }

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
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.setLineDash(s.dash || []);
    ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
  }
  for (const v of opt.vlines || []) {
    ctx.strokeStyle = v.color || T.faint; ctx.setLineDash(v.dash || [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(v.x) + 0.5, pad.t); ctx.lineTo(X(v.x) + 0.5, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
    if (v.label) { ctx.fillStyle = v.color || T.dim; ctx.font = '10.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(v.label, X(v.x) + 4, pad.t + 4 + (v.dy || 0)); }
  }
  for (const v of opt.hlines || []) {
    ctx.strokeStyle = v.color || T.faint; ctx.setLineDash(v.dash || [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v.y) + 0.5); ctx.lineTo(w - pad.r, Y(v.y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    if (v.label) { ctx.fillStyle = v.color || T.dim; ctx.font = '10.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(v.label, w - pad.r - 4, Y(v.y) - 3); }
  }
  ctx.restore();
  // legend
  if (opt.legend) {
    ctx.save();
    ctx.font = '11px Inter, system-ui, sans-serif';
    const items = (opt.series || []).filter((s) => s.label);
    let lx = opt.legendX ?? pad.l + 10, ly = opt.legendY ?? pad.t + 10;
    for (const s of items) {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 1, 14, 3);
      ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, lx + 20, ly);
      ly += 16;
    }
    ctx.restore();
  }
  ctx.strokeStyle = T.faint; ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, w - pad.l - pad.r - 1, h - pad.t - pad.b - 1);
  return { X, Y, pad };
}

export function range(a, b, n) { return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)); }
export function logRange(a, b, n) { return Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1))); }
