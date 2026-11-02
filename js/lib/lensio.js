// Lens prescription import/export: JSON and a practical subset of Zemax .zmx (sequential,
// STANDARD and EVENASPH surfaces). Pure functions, no DOM.
import { GLASS_NAMES, glassData } from './glass.js';

const ALIASES = { BK7: 'N-BK7', BAK4: 'N-BAK4', SF5: 'N-SF5', SF11: 'N-SF11', FK51: 'N-FK51A', FK51A: 'N-FK51A', SILICA: 'Fused silica', F_SILICA: 'Fused silica', CAF2: 'CaF2' };

// Resolve a glass: catalogue name, alias, or a (n_d, V_d) model glass. Returns {glass, warning}.
export function resolveGlass(name, nd, vd) {
  if (!name || /^AIR$/i.test(name)) return { glass: 'air' };
  if (/^MIRROR$/i.test(name)) return { glass: 'mirror' };
  const up = name.toUpperCase();
  const hit = GLASS_NAMES.find((k) => k.toUpperCase() === up) || ALIASES[up];
  if (hit) return { glass: hit };
  if (nd > 1 && vd > 0) return { glass: { name, nd, vd }, warning: `${name}: not in the catalogue, modelled from n_d = ${nd}, V_d = ${vd}` };
  return { glass: 'N-BK7', warning: `${name}: unknown glass without n_d/V_d, substituted N-BK7` };
}

// Parse a Zemax .zmx (text; UTF-16 files must be decoded by the caller).
export function parseZmx(text) {
  if (text.length > LENS_LIMITS.text) throw new Error(`file longer than ${LENS_LIMITS.text / 1024} K characters`);
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
  if (surfs.length - 2 > LENS_LIMITS.surfaces) throw new Error(`more than ${LENS_LIMITS.surfaces} surfaces`);
  // drop the object surface (0) and the image surface (last)
  const body = surfs.slice(1, -1);
  const surfaces = body.map((s, i) => {
    if (!/^(STANDARD|EVENASPH)$/.test(s.type)) warnings.push(`surface ${i + 1}: type ${s.type} treated as STANDARD`);
    const out = { R: s.curv ? 1 / s.curv : Infinity, t: isFinite(s.t) ? s.t : 0, glass: s.glass };
    if (s.k) out.k = s.k;
    if (s.sd > 0) out.sd = s.sd; // Zemax DIAM is a semi-diameter
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

// JSON round trip (Infinity is not valid JSON, so it is written as the string "inf"). indent 0 gives
// compact JSON for links; strings such as names keep their spaces either way.
export function lensToJSON(lens, indent = 2) {
  const surfaces = lens.surfaces.map((s) => {
    const o = { R: isFinite(s.R) ? +s.R.toPrecision(10) : 'inf', t: s.t, glass: s.glass };
    if (s.k) o.k = s.k;
    if (s.a && s.a.some((v) => v)) o.a = s.a;
    if (s.sd > 0) o.sd = s.sd;
    if (s.stop) o.stop = true;
    return o;
  });
  return JSON.stringify({ format: 'optica-viva-lens', version: 1, name: lens.name, epd: lens.epd, field: lens.field, surfaces }, null, indent || undefined);
}
// Limits for prescriptions from files, shared links and the editor: generous for real designs
// (the built-in lenses reach 14 surfaces, a 6.5 m pupil, a 45° field and 10 m spacings) and
// small enough that a hostile file or link cannot stall the page or break the arithmetic.
export const LENS_LIMITS = {
  text: 256 * 1024, // characters of JSON or .zmx text (a file may be twice as many bytes, UTF-16)
  surfaces: 64, epd: 20000, field: 80, t: 1e5, sd: 1e5, // mm, degrees
  k: 1e3, aTerms: 4, a: 1, // conic; a₄…a₁₀ (mm^(1−2n))
  name: 120, nd: [1, 3], vd: [5, 120], // model glass: refractive index and Abbe number
};
const SURFACE_KEYS = ['R', 't', 'glass', 'k', 'a', 'sd', 'stop'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

// JSON (text or parsed) → lens. Only the supported fields are kept; values are converted but not
// judged here: validateLens says what is wrong. Structural errors throw.
export function lensFromJSON(text) {
  if (typeof text === 'string' && text.length > LENS_LIMITS.text) throw new Error(`prescription longer than ${LENS_LIMITS.text / 1024} K characters`);
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!isObj(d) || !Array.isArray(d.surfaces) || d.surfaces.length < 2) throw new Error('a lens needs at least two surfaces');
  if (d.surfaces.length > LENS_LIMITS.surfaces) throw new Error(`more than ${LENS_LIMITS.surfaces} surfaces`);
  const surfaces = d.surfaces.map((s, i) => {
    if (!isObj(s)) throw new Error(`surface ${i + 1} is not an object`);
    const o = {};
    for (const k of SURFACE_KEYS) if (s[k] !== undefined) o[k] = s[k];
    o.R = s.R === 'inf' || s.R === null || s.R === Infinity || s.R === -Infinity ? Infinity : toNum(s.R);
    o.t = toNum(s.t);
    if (o.k !== undefined) o.k = toNum(o.k);
    if (o.sd !== undefined) o.sd = toNum(o.sd);
    if (Array.isArray(o.a)) o.a = o.a.map(toNum);
    if (isObj(o.glass)) o.glass = { name: o.glass.name, nd: toNum(o.glass.nd), vd: toNum(o.glass.vd) };
    if (o.glass === undefined) o.glass = 'air';
    if (o.stop !== undefined && typeof o.stop !== 'boolean') o.stop = 'invalid';
    if (o.stop === false) delete o.stop;
    return o;
  });
  if (!surfaces.some((s) => s.stop)) surfaces[0].stop = true;
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, LENS_LIMITS.name) : 'Custom lens';
  return { name, epd: d.epd === undefined ? 10 : toNum(d.epd), field: d.field === undefined ? 5 : toNum(d.field), surfaces };
}

// Validate a prescription; returns a list of problems (empty when usable). Every lens from a file,
// a shared link or the editor passes through here before any optical calculation.
export function validateLens(lens) {
  const L = LENS_LIMITS, errs = [];
  if (!isObj(lens) || !Array.isArray(lens.surfaces)) return ['not a lens prescription'];
  const inRange = (v, lo, hi) => Number.isFinite(v) && v > lo && v <= hi;
  if (!inRange(lens.epd, 0, L.epd)) errs.push(`entrance-pupil diameter must be positive and at most ${L.epd} mm`);
  if (!inRange(lens.field, 0, L.field)) errs.push(`maximum field must be positive and at most ${L.field}°`);
  if (lens.surfaces.length < 2 || lens.surfaces.length > L.surfaces) errs.push(`a lens needs 2 to ${L.surfaces} surfaces`);
  let dir = 1; // +1 while light travels toward +z; each mirror reverses it
  lens.surfaces.slice(0, L.surfaces).forEach((s, i) => {
    const at = `surface ${i + 1}`;
    if (!isObj(s)) { errs.push(`${at}: not a surface`); return; }
    for (const k of Object.keys(s)) if (!SURFACE_KEYS.includes(k) && !k.startsWith('_')) errs.push(`${at}: unsupported field ${String(k).slice(0, 20)}`);
    if (!(s.R === Infinity || s.R === -Infinity || (Number.isFinite(s.R) && s.R !== 0))) errs.push(`${at}: radius must be non-zero (use inf for a plane)`);
    if (s.glass === 'mirror') dir = -dir;
    if (!(Number.isFinite(s.t) && Math.abs(s.t) <= L.t)) errs.push(`${at}: thickness must be a number of at most ${L.t} mm`);
    else if (!(s.t * dir >= 0)) errs.push(`${at}: thickness must be ${dir > 0 ? '≥ 0' : '≤ 0 after an odd number of mirrors'}`);
    if (s.sd !== undefined && !inRange(s.sd, 0, L.sd)) errs.push(`${at}: semi-diameter must be positive and at most ${L.sd} mm`);
    if (s.k !== undefined && !(Number.isFinite(s.k) && Math.abs(s.k) <= L.k)) errs.push(`${at}: conic constant must be a number within ±${L.k}`);
    if (s.a !== undefined && !(Array.isArray(s.a) && s.a.length >= 1 && s.a.length <= L.aTerms && s.a.every((v) => Number.isFinite(v) && Math.abs(v) <= L.a))) errs.push(`${at}: aspheric terms must be 1 to ${L.aTerms} numbers within ±${L.a}`);
    if (s.stop !== undefined && typeof s.stop !== 'boolean') errs.push(`${at}: stop must be true or false`);
    const g = s.glass;
    if (typeof g === 'string') {
      if (g !== 'air' && g !== 'mirror' && !glassData(g)) errs.push(`${at}: unknown glass ${g.slice(0, 40)}`);
    } else if (isObj(g)) {
      if (!(typeof g.name === 'string' && g.name.length >= 1 && g.name.length <= 40)) errs.push(`${at}: a model glass needs a name of 1 to 40 characters`);
      if (!inRange(g.nd, L.nd[0], L.nd[1])) errs.push(`${at}: model glass n_d must be above ${L.nd[0]} and at most ${L.nd[1]}`);
      if (!(Number.isFinite(g.vd) && g.vd >= L.vd[0] && g.vd <= L.vd[1])) errs.push(`${at}: model glass V_d must be between ${L.vd[0]} and ${L.vd[1]}`);
    } else errs.push(`${at}: glass must be a name or a model glass {name, nd, vd}`);
  });
  if (lens.surfaces.filter((s) => isObj(s) && s.stop === true).length !== 1) errs.push('exactly one surface must be the stop');
  return errs;
}
// Compact, URL-safe encoding for shareable custom lenses.
export const encodeLens = (lens) => btoa(unescape(encodeURIComponent(lensToJSON(lens, 0)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeLens(s) {
  if (typeof s !== 'string' || s.length > Math.ceil((LENS_LIMITS.text * 4) / 3)) throw new Error('shared lens too long');
  return lensFromJSON(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
}
