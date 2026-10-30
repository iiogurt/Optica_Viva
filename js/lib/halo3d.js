// 3-D scene for the halo laboratory (shown by js/lib/gl3d.js): a hexagonal ice crystal with the
// exact ray paths behind three halos: the 22° halo (two side faces, a 60° prism) and the 46° halo
// (a side and an end face, a 90° prism) at minimum deviation, and the circumzenithal arc (in
// through the top of a plate, out through a side) for the current solar elevation. The exit rays
// are drawn for red (650 nm) and blue (450 nm) light, so the dispersion shows. Pure: no DOM.
import { nIce, minDeviation } from './atmo.js';
import { merge, quad } from './mesh3d.js';
import { N_ } from './i18n.js';

const S3 = Math.sqrt(3), D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

// Faces of a hexagonal prism with apothem 1 and half-height c: side k has the outward normal at
// k·60°, the ends ±z. Each face is { n, d } for the plane n·p = d.
export function crystalFaces(c) {
  const f = [];
  for (let k = 0; k < 6; k++) f.push({ n: [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3), 0], d: 1, k });
  f.push({ n: [0, 0, 1], d: c, k: 6 }, { n: [0, 0, -1], d: c, k: 7 });
  return f;
}
// is p on face f (within its edges)?
function onFace(f, p, c) {
  if (f.k < 6) { const t = [-f.n[1], f.n[0], 0]; return Math.abs(dot(p, t)) <= 1 / S3 + 1e-9 && Math.abs(p[2]) <= c + 1e-9; }
  for (let k = 0; k < 6; k++) if (p[0] * Math.cos((k * Math.PI) / 3) + p[1] * Math.sin((k * Math.PI) / 3) > 1 + 1e-9) return false;
  return true;
}
// refraction of direction d at a surface whose normal m faces against d, index ratio eta = n1/n2
function refract(d, m, eta) {
  const ci = -dot(d, m), k = 1 - eta * eta * (1 - ci * ci);
  if (k < 0) return null;
  return add(d.map((x) => eta * x), m, eta * ci - Math.sqrt(k));
}

// The crystal as a flat-shaded mesh: six side quads and two hexagonal ends (fans).
export function crystalMesh(c) {
  const R = 2 / S3, v = (k, z) => [R * Math.cos(((k - 0.5) * Math.PI) / 3), R * Math.sin(((k - 0.5) * Math.PI) / 3), z];
  const parts = [];
  for (let k = 0; k < 6; k++) {
    const a = v(k, 0), b = v(k + 1, 0), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
    parts.push(quad(mid, unit([b[0] - a[0], b[1] - a[1], 0]), [0, 0, 1], R / 2, c));
  }
  for (const s of [1, -1]) {
    const pos = [0, 0, s * c], P = [...pos], N = [0, 0, s], nrm = [...N], idx = [];
    for (let k = 0; k <= 6; k++) { P.push(...v(k, s * c)); nrm.push(...N); }
    for (let k = 1; k <= 6; k++) idx.push(0, s > 0 ? k : k + 1, s > 0 ? k + 1 : k);
    parts.push({ positions: new Float32Array(P), normals: new Float32Array(nrm), indices: new Uint32Array(idx) });
  }
  return merge(parts);
}

// A path through entry face fi and exit face fo with internal direction dir (at 550 nm), through a
// point chosen so both crossings lie on the faces. Returns the entry and exit points and the
// external directions in and out at each wavelength, or null.
function prismPath(faces, c, fi, fo, inc) {
  const A = faces[fi], B = faces[fo], n0 = nIce(550);
  const dir = refract(inc, A.n, 1 / n0);
  if (!dir) return null;
  // try entry points across the entry face; keep the one nearest its middle that exits through fo
  let best = null;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
    const u = i / 40 - 0.5, w = j / 40 - 0.5;
    let p;
    if (A.k < 6) { const t = [-A.n[1], A.n[0], 0]; p = add(add(A.n.map((x) => x * A.d), t, (u * 2) / S3), [0, 0, 1], w * 2 * c); }
    else p = [u * 2 / S3 * 1.7, w * 1.7, A.n[2] * c];
    if (!onFace(A, p, c)) continue;
    // first face the internal ray reaches
    let tmin = Infinity, hit = null;
    for (const f of faces) { const dn = dot(f.n, dir); if (dn <= 1e-12) continue; const tt = (f.d - dot(f.n, p)) / dn; if (tt > 1e-9 && tt < tmin) { tmin = tt; hit = f; } }
    if (hit !== B) continue;
    const q = add(p, dir, tmin), score = u * u + w * w;
    if (!best || score < best.score) best = { p, q, score };
  }
  if (!best) return null;
  const out = {};
  for (const lam of [450, 550, 650]) {
    const n = nIce(lam), d = refract(inc, A.n, 1 / n), o = d && refract(d, B.n.map((x) => -x), n);
    if (o) out[lam] = { inside: d, out: o };
  }
  return out[550] ? { p: best.p, q: best.q, inc, out } : null;
}

// Incoming direction for minimum deviation through faces fi → fo: the internal ray is
// perpendicular to the bisector of the two outward normals.
function minDevIncoming(faces, fi, fo) {
  const A = faces[fi], B = faces[fo], b = unit(add(A.n, B.n)), axis = unit(cross(A.n, B.n));
  let dir = unit(cross(axis, b));
  if (dot(dir, A.n) > 0) dir = dir.map((x) => -x);
  // the outside direction that refracts into dir: reverse the ray out through the entry face
  const back = refract(dir.map((x) => -x), A.n.map((x) => -x), nIce(550));
  return back.map((x) => -x);
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deviation = (path, lam = 550) => Math.acos(Math.max(-1, Math.min(1, dot(path.inc, path.out[lam].out)))) / D2R;

// The scene. kind: 'column' or 'plate' (the crystal drawn); h: solar elevation (rad) for the
// circumzenithal arc. Returns { meshes, lines, labels, paths }.
export function haloScene({ kind = 'column', h = 20 * D2R }) {
  const c = kind === 'plate' ? 0.32 : 1.6, faces = crystalFaces(c);
  const meshes = [{ mesh: crystalMesh(c), color: [0.78, 0.9, 1.0], opacity: 0.22, glass: true }], lines = [], labels = [];
  const L = 2.4, paths = {};
  const draw = (path, col, label) => {
    const { p, q, inc, out } = path;
    lines.push({ points: [add(p, inc, -L), p], color: [1, 0.97, 0.88, 0.95], width: 2 });
    lines.push({ points: [p, q], color: [...col, 0.95], width: 1.8 });
    for (const [lam, rgb] of [[650, [1, 0.35, 0.3]], [450, [0.45, 0.6, 1]]]) if (out[lam]) lines.push({ points: [q, add(q, out[lam].out, L)], color: [...rgb, 0.95], width: 1.6 });
    labels.push({ p: add(q, out[550].out, L * 1.08), ...label, color: `rgb(${col.map((x) => Math.round(x * 255)).join(',')})` });
  };
  // 22°: side faces 2 → 0; 46°: top (6) → side 0, both at minimum deviation
  const p22 = prismPath(faces, c, 2, 0, minDevIncoming(faces, 2, 0));
  if (p22) { paths.halo22 = p22; draw(p22, [1, 0.71, 0.28], { text: N_('22° halo: through a 60° prism, deviated {d}°'), vars: { d: deviation(p22).toFixed(1) } }); }
  const p46 = prismPath(faces, c, 6, 3, minDevIncoming(faces, 6, 3));
  if (p46) { paths.halo46 = p46; draw(p46, [0.42, 0.84, 1], { text: N_('46° halo: through a 90° prism, deviated {d}°'), vars: { d: deviation(p46).toFixed(1) } }); }
  // circumzenithal arc: sunlight at elevation h enters the top face of a horizontal crystal and
  // leaves through a side face (here the crystal is taken as a horizontal plate)
  if (kind === 'plate') {
    const inc = [Math.cos(h), 0, -Math.sin(h)], pz = prismPath(faces, c, 6, 0, inc);
    if (pz) { paths.cza = pz; draw(pz, [0.42, 0.89, 0.64], { text: N_('circumzenithal arc: in through the top, out through a side') }); }
  }
  labels.push({ p: [-0.9, -0.9, c + 1.1], text: kind === 'plate' ? N_('ice plate (hexagonal prism)') : N_('ice column (hexagonal prism)'), color: 'rgba(200,215,255,0.8)' });
  return { meshes, lines, labels, paths };
}
export { deviation as pathDeviation, minDeviation };
