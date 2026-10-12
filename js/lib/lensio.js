// Lens prescription import/export: JSON and a practical subset of Zemax .zmx (sequential,
// STANDARD and EVENASPH surfaces). Pure functions, no DOM.
import { GLASSES } from './glass.js';

const ALIASES = { BK7: 'N-BK7', BAK4: 'N-BAK4', SF5: 'N-SF5', SF11: 'N-SF11', FK51: 'N-FK51A', FK51A: 'N-FK51A', SILICA: 'Fused silica', F_SILICA: 'Fused silica', CAF2: 'CaF2' };

// Resolve a glass: catalogue name, alias, or a (n_d, V_d) model glass. Returns {glass, warning}.
export function resolveGlass(name, nd, vd) {
  if (!name || /^(AIR|MIRROR)$/i.test(name)) return { glass: 'air' };
  const up = name.toUpperCase();
  const hit = Object.keys(GLASSES).find((k) => k.toUpperCase() === up) || ALIASES[up];
  if (hit) return { glass: hit };
  if (nd > 1 && vd > 0) return { glass: { name, nd, vd }, warning: `${name}: not in the catalogue, modelled from n_d = ${nd}, V_d = ${vd}` };
  return { glass: 'N-BK7', warning: `${name}: unknown glass without n_d/V_d, substituted N-BK7` };
}

// Parse a Zemax .zmx (text; UTF-16 files must be decoded by the caller).
export function parseZmx(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const surfs = [], warnings = [];
  let cur = null, epd = 10, fields = [0], name = 'Imported lens', fieldType = 0;
  for (const line of lines) {
    const [key, ...rest] = line.split(/\s+/);
    const num = (i) => parseFloat(rest[i]);
    switch (key) {
      case 'NAME': if (rest.length) name = rest.join(' '); break;
      case 'ENPD': epd = num(0); break;
      case 'FTYP': fieldType = parseInt(rest[0], 10) || 0; break;
      case 'YFLN': fields = rest.map(parseFloat).filter((v) => isFinite(v)); break;
      case 'UNIT': if (rest[0] && rest[0] !== 'MM') warnings.push(`units ${rest[0]} assumed to be mm`); break;
      case 'SURF': cur = { curv: 0, t: 0, glass: 'air', k: 0, parm: [], stop: false, type: 'STANDARD', sd: null }; surfs.push(cur); break;
      case 'TYPE': if (cur) cur.type = rest[0]; break;
      case 'CURV': if (cur) cur.curv = num(0); break;
      case 'DISZ': if (cur) cur.t = rest[0] === 'INFINITY' ? Infinity : num(0); break;
      case 'CONI': if (cur) cur.k = num(0); break;
      case 'PARM': if (cur) cur.parm[parseInt(rest[0], 10)] = num(1); break;
      case 'DIAM': if (cur) cur.sd = num(0); break;
      case 'STOP': if (cur) cur.stop = true; break;
      case 'GLAS': if (cur) { const r = resolveGlass(rest[0], num(3), num(4)); cur.glass = r.glass; if (r.warning) warnings.push(r.warning); } break;
      default:
    }
  }
  if (surfs.length < 3) throw new Error('no sequential surfaces found');
  // drop the object surface (0) and the image surface (last)
  const body = surfs.slice(1, -1);
  const surfaces = body.map((s, i) => {
    if (!/^(STANDARD|EVENASPH)$/.test(s.type)) warnings.push(`surface ${i + 1}: type ${s.type} treated as STANDARD`);
    const out = { R: s.curv ? 1 / s.curv : Infinity, t: isFinite(s.t) ? s.t : 0, glass: s.glass };
    if (s.k) out.k = s.k;
    // EVENASPH PARM n multiplies r^(2n); our a[] starts at r⁴ (PARM 1, the r² term, is folded away)
    if (s.type === 'EVENASPH') {
      if (s.parm[1]) warnings.push(`surface ${i + 1}: r² aspheric term ignored`);
      const a = [2, 3, 4, 5].map((p) => s.parm[p] || 0);
      if (a.some((v) => v)) out.a = a;
    }
    if (s.stop) out.stop = true;
    return out;
  });
  if (!surfaces.some((s) => s.stop)) { surfaces[0].stop = true; warnings.push('no STOP surface: the first surface is used'); }
  if (fieldType !== 0) warnings.push('field type is not an angle: maximum field set to 5°');
  const field = fieldType === 0 ? Math.max(0.5, ...fields.map(Math.abs)) : 5;
  return { lens: { name, epd, field, surfaces }, warnings };
}

// JSON round trip (Infinity is not valid JSON, so it is written as the string "inf").
export function lensToJSON(lens) {
  const surfaces = lens.surfaces.map((s) => {
    const o = { R: isFinite(s.R) ? +s.R.toPrecision(10) : 'inf', t: s.t, glass: s.glass };
    if (s.k) o.k = s.k;
    if (s.a && s.a.some((v) => v)) o.a = s.a;
    if (s.stop) o.stop = true;
    return o;
  });
  return JSON.stringify({ format: 'optica-viva-lens', version: 1, name: lens.name, epd: lens.epd, field: lens.field, surfaces }, null, 2);
}
export function lensFromJSON(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!Array.isArray(d.surfaces) || d.surfaces.length < 2) throw new Error('a lens needs at least two surfaces');
  const surfaces = d.surfaces.map((s) => ({ ...s, R: s.R === 'inf' || s.R === null ? Infinity : +s.R, t: +s.t }));
  if (!surfaces.some((s) => s.stop)) surfaces[0].stop = true;
  return { name: d.name || 'Custom lens', epd: +d.epd || 10, field: +d.field || 5, surfaces };
}
// Validate a prescription; returns a list of problems (empty when usable).
export function validateLens(lens) {
  const errs = [];
  if (!(lens.epd > 0)) errs.push('entrance-pupil diameter must be positive');
  lens.surfaces.forEach((s, i) => {
    if (s.R === 0 || Number.isNaN(s.R)) errs.push(`surface ${i + 1}: radius must be non-zero (use inf for a plane)`);
    if (!(s.t >= 0)) errs.push(`surface ${i + 1}: thickness must be ≥ 0`);
    if (typeof s.glass === 'string' && s.glass !== 'air' && !GLASSES[s.glass]) errs.push(`surface ${i + 1}: unknown glass ${s.glass}`);
  });
  if (lens.surfaces.filter((s) => s.stop).length !== 1) errs.push('exactly one surface must be the stop');
  return errs;
}
// Compact, URL-safe encoding for shareable custom lenses.
export const encodeLens = (lens) => btoa(unescape(encodeURIComponent(lensToJSON(lens).replace(/\s+/g, '')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeLens = (s) => lensFromJSON(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
