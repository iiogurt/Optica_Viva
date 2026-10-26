// 3-D scene for the colour-science laboratory (shown by js/lib/gl3d.js): in CIE xyY, the solid of
// every surface colour possible under a light source (the optimal colours, or MacAdam limits),
// the spectral locus on the floor, a display's gamut as a glass solid and the 14 CIE test colour
// samples. Colours are those seen by an observer adapted to the source (Bradford to D65), as in
// the laboratory's swatches, so a display's white and the perfect white reflector coincide.
// Pure: no DOM.
import { CMF, TCS, NWL } from './colordata.js';
import { LAMBDA, xyz, adapt, D65_XYZ, xyzToSRGB } from './colorsci.js';
import { oetf, gamutClip, wavelengthRGB } from './color.js';
import { sphere, normalsFrom } from './mesh3d.js';

// RGB primaries (x, y) of three display standards, all with the D65 white point.
export const GAMUTS = {
  srgb: { name: 'sRGB', xy: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], color: [1, 1, 1] },
  p3: { name: 'Display P3', xy: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]], color: [1, 0.78, 0.36] },
  rec2020: { name: 'Rec. 2020', xy: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]], color: [0.42, 0.84, 1] },
};
const WHITE_XY = [0.3127, 0.3290];

const inv3 = (m) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
};
const mv = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

// RGB → XYZ matrix of a display (white RGB = (1, 1, 1) → Y = 100): columns are the primaries'
// XYZ, scaled so they add up to the white point.
export function rgbToXYZ(key) {
  const P = GAMUTS[key].xy.map(([x, y]) => [x / y, 1, (1 - x - y) / y]), [xw, yw] = WHITE_XY;
  const Pm = [0, 1, 2].map((r) => P.map((p) => p[r])), s = mv(inv3(Pm), [(100 * xw) / yw, 100, (100 * (1 - xw - yw)) / yw]);
  return Pm.map((r) => r.map((v, c) => v * s[c]));
}

// Shoelace area of a polygon [[x, y], …].
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
// The spectral locus (380–780 nm, 5 nm) as chromaticities; closed by the line of purples.
export const LOCUS = Array.from({ length: NWL }, (_, i) => { const s = CMF[0][i] + CMF[1][i] + CMF[2][i]; return [CMF[0][i] / s, CMF[1][i] / s]; });
// Share of all chromaticities (the area inside the spectral locus in CIE 1931 x, y) that a
// display's primaries enclose.
export const gamutCoverage = (key) => area(GAMUTS[key].xy) / area(LOCUS);

// Per-wavelength tristimulus contributions of a source, adapted to D65 and scaled so the perfect
// white reflector has Y = 100. A trace of the colour-matching functions (10⁻⁷ of the total) keeps
// the chromaticity of bands where the source emits nothing defined (it sits on the locus at Y ≈ 0).
function contributions(spd) {
  const W = xyz(spd), k = 100 / W[1], Wn = W.map((q) => q * k);
  const cmfY = CMF[1].reduce((a, b) => a + b, 0);
  return LAMBDA.map((_, i) => adapt([0, 1, 2].map((c) => spd[i] * CMF[c][i] * k + (1e-7 * 100 * CMF[c][i]) / cmfY), Wn, D65_XYZ));
}

// Optimal colours (Schrödinger 1920, MacAdam 1935): reflectance 1 on one band of wavelengths and 0
// elsewhere, the band wrapping from 780 to 380 nm for purples. ring[L][a] is the XYZ of the band of
// L samples starting at sample a, for L = 0 … N (L = 0 is black, L = N the white reflector).
export function optimalColours(spd) {
  const c = contributions(spd), N = c.length, S = [[0, 0, 0]];
  // prefix sums over two laps, so a band is a difference of two of them
  for (let k = 0; k < 2 * N; k++) S.push(S[k].map((v, j) => v + c[k % N][j]));
  return Array.from({ length: N + 1 }, (_, L) => Array.from({ length: N }, (_, a) => S[a + L].map((v, j) => v - S[a][j])));
}

// Colour of a reflectance under the source, as seen adapted (XYZ, white Y = 100).
const seen = (refl, spd) => { const W = xyz(spd), k = 100 / W[1]; return adapt(xyz(spd.map((s, i) => s * refl[i])).map((q) => q * k), W.map((q) => q * k), D65_XYZ); };
// How many of the 14 test colour samples the display cannot show under this source.
export function samplesOutside(spd, key) {
  const Mi = inv3(rgbToXYZ(key));
  return TCS.filter((r) => { const rgb = mv(Mi, seen(r, spd)); return Math.min(...rgb) < -1e-3 || Math.max(...rgb) > 1 + 1e-3; }).length;
}

// xyY → scene: chromaticity in the floor (x to the right, y away from the viewer), Y up; the white
// point's column is the scene's axis.
const SC = 2, HT = 1.3;
const toScene = ([X, Y, Z]) => { const s = X + Y + Z || 1e-30; return [SC * (X / s - WHITE_XY[0]), (HT * Y) / 100, -SC * (Y / s - WHITE_XY[1])]; };
const floor = ([x, y]) => [SC * (x - WHITE_XY[0]), 0, -SC * (y - WHITE_XY[1])];
// Display colour (sRGB-encoded) of XYZ: desaturated towards grey into the gamut, dimmed below 1.
const display = (XYZ) => { const g = gamutClip(xyzToSRGB(XYZ)), m = Math.max(1, ...g); return g.map((v) => oetf(Math.max(0, v / m))); };

// Indexed mesh from a grid of XYZ points rows × cols (cols wrap around when `wrap`), with colours.
function gridMesh(P, wrap) {
  const R = P.length, C = P[0].length, positions = new Float32Array(R * C * 3), colors = new Float32Array(R * C * 3), idx = [];
  P.forEach((row, r) => row.forEach((p, c) => { positions.set(toScene(p), (r * C + c) * 3); colors.set(display(p), (r * C + c) * 3); }));
  for (let r = 0; r + 1 < R; r++) for (let c = 0; c < (wrap ? C : C - 1); c++) {
    const a = r * C + c, b = r * C + ((c + 1) % C), d = a + C, e = b + C;
    idx.push(a, d, b, b, d, e);
  }
  const indices = new Uint32Array(idx);
  return { positions, normals: normalsFrom(positions, indices), colors, indices };
}

// The display's gamut solid: the RGB cube's six faces in xyY (the faces through black become the
// walls standing on the gamut triangle). δ keeps the free coordinates off black, where the
// chromaticity is undefined.
const SOLIDS = {};
function gamutSolid(key, n = 14, d = 1e-3) {
  if (SOLIDS[key]) return SOLIDS[key];
  const M = rgbToXYZ(key), at = (rgb) => mv(M, rgb), t = (i) => d + ((1 - d) * i) / n;
  const faces = [];
  for (const ax of [0, 1, 2]) for (const v of [0, 1]) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3;
    faces.push(Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => { const rgb = [0, 0, 0]; rgb[ax] = v; rgb[u] = t(i); rgb[w] = t(j); return at(rgb); })));
  }
  const edges = [];
  for (const ax of [0, 1, 2]) for (const p of [0, 1]) for (const q of [0, 1]) {
    edges.push(Array.from({ length: 25 }, (_, i) => { const rgb = [0, 0, 0]; rgb[ax] = d + ((1 - d) * i) / 24; rgb[(ax + 1) % 3] = p; rgb[(ax + 2) % 3] = q; return toScene(at(rgb)); }));
  }
  return SOLIDS[key] = { faces: faces.map((f) => gridMesh(f, false)), edges, top: GAMUTS[key].xy.map((_, k) => { const rgb = [0, 0, 0]; rgb[k] = 1; return toScene(at(rgb)); }) };
}

// The scene: the optimal-colour solid under spd, the spectral locus, the display gamut `key` and
// the test colour samples.
export function colourSolidScene(spd, key = 'srgb') {
  const meshes = [], lines = [], labels = [];
  const ring = optimalColours(spd), N = ring[0].length;
  // rings L = 1 … N − 1, a skirt down to the floor below L = 1, and the white pole on top
  const skirt = ring[1].map(([X, Y, Z]) => { const s = X + Y + Z; return [X / s * 1e-9, Y / s * 1e-9, Z / s * 1e-9]; });
  const rows = [skirt, ...ring.slice(1, N), ring[N]];
  meshes.push({ mesh: gridMesh(rows, true), color: [1, 1, 1] });
  // spectral locus on the floor, each 5 nm segment in its own colour, and the line of purples
  for (let i = 0; i + 1 < N; i++) lines.push({ points: [floor(LOCUS[i]), floor(LOCUS[i + 1])], color: [...wavelengthRGB(LAMBDA[i] + 2.5), 0.9], width: 1.8 });
  lines.push({ points: [floor(LOCUS[N - 1]), floor(LOCUS[0])], color: [0.8, 0.4, 0.9, 0.6], width: 1.2 });
  for (const l of [460, 480, 500, 520, 540, 560, 580, 600, 620]) {
    const [x, y] = LOCUS[(l - 380) / 5], dx = x - WHITE_XY[0], dy = y - WHITE_XY[1], r = Math.hypot(dx, dy);
    labels.push({ p: floor([x + (0.06 * dx) / r, y + (0.06 * dy) / r]), text: `${l} nm`, color: 'rgba(255,255,255,0.6)' });
  }
  // display gamut: glass faces, edges, the triangle on the floor
  const G = GAMUTS[key], g = gamutSolid(key);
  for (const f of g.faces) meshes.push({ mesh: f, color: G.color, opacity: 0.1, glass: true });
  for (const e of g.edges) lines.push({ points: e, color: [...G.color, 0.75], width: 1.3 });
  lines.push({ points: [...G.xy, G.xy[0]].map(floor), color: [...G.color, 0.6], width: 1.1 });
  labels.push({ p: [g.top[1][0], g.top[1][1] + 0.08, g.top[1][2]], text: G.name, color: `rgb(${G.color.map((c) => Math.round(c * 255)).join(',')})` });
  // the white axis and the test colour samples
  lines.push({ points: [[0, 0, 0], [0, HT, 0]], color: [1, 1, 1, 0.25], width: 1 });
  labels.push({ p: [0, HT + 0.09, 0], text: 'white, Y = 100', color: 'rgba(255,255,255,0.8)' });
  for (const r of TCS) { const p = seen(r, spd); meshes.push({ mesh: sphere(0.028, toScene(p), 12, 6), color: display(p) }); }
  return { meshes, lines, labels };
}
