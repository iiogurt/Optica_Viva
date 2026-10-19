// Optical glass catalogue: three-term Sellmeier dispersion formulas.
//   n²(λ) − 1 = Σ_i B_i λ² / (λ² − C_i),   λ in µm.
// Coefficients from the Schott catalogue (N- and classic lead glasses) and
// Malitson (1965) for fused silica and CaF₂.
// GLASSES is the core set used across the laboratories; CATALOGUE (js/lib/glasscat.js, generated)
// adds 431 SCHOTT, OHARA and CDGM glasses. Both are looked up by name.
import { CATALOGUE } from './glasscat.js';

export const GLASSES = {
  'N-BK7':   { B: [1.03961212, 0.231792344, 1.01046945], C: [0.00600069867, 0.0200179144, 103.560653], type: 'crown' },
  'N-BAK4':  { B: [1.28834642, 0.132817724, 0.945395373], C: [0.00779980626, 0.0315631177, 105.965875], type: 'crown' },
  'N-SK16':  { B: [1.34317774, 0.241144399, 0.994317969], C: [0.00704687339, 0.0229005, 92.7508526], type: 'crown' },
  'SK16':    { B: [1.34317774, 0.241144399, 0.994317969], C: [0.00704687339, 0.0229005, 92.7508526], type: 'crown' },
  'SK2':     { B: [1.28189012, 0.257738258, 0.96818604], C: [0.0072719164, 0.0242823527, 110.377773], type: 'crown' },
  'N-FK51A': { B: [0.971247817, 0.216901417, 0.904651666], C: [0.00472301995, 0.0153575612, 168.68133], type: 'ED crown' },
  'F2':      { B: [1.34533359, 0.209073176, 0.937357162], C: [0.00997743871, 0.0470450767, 111.886764], type: 'flint' },
  'F5':      { B: [1.3104463, 0.19603426, 0.96612977], C: [0.00958633048, 0.0457627627, 115.011883], type: 'flint' },
  'N-SF5':   { B: [1.52481889, 0.187085527, 1.42729015], C: [0.011254756, 0.0588995392, 129.141675], type: 'dense flint' },
  'N-SF11':  { B: [1.73759695, 0.313747346, 1.89878101], C: [0.013188707, 0.0623068142, 155.23629], type: 'dense flint' },
  'Fused silica': { B: [0.6961663, 0.4079426, 0.8974794], C: [0.004679148, 0.01351206, 97.934], type: 'crystal' },
  'CaF2':    { B: [0.5675888, 0.4710914, 3.8484723], C: [0.00252643, 0.01007833, 1200.556], type: 'fluorite' },
};

// Fraunhofer lines (nm)
export const LINES = { i: 365.01, h: 404.66, g: 435.83, F: 486.13, e: 546.07, d: 587.56, C: 656.27, r: 706.52 };

// Crown or flint by the usual Abbe-diagram boundary: V_d > 50 below n_d = 1.60, V_d > 55 above.
const family = (nd, vd) => ((nd < 1.6 ? vd > 50 : vd > 55) ? 'crown' : 'flint');

// Every glass name: the core set first, then the catalogue.
export const GLASS_NAMES = [...new Set([...Object.keys(GLASSES), ...Object.keys(CATALOGUE)])];

// { B, C, type, maker, range: [λmin, λmax] µm } for a glass name, or undefined.
const cache = new Map();
export function glassData(name) {
  if (GLASSES[name]) return GLASSES[name];
  if (cache.has(name)) return cache.get(name);
  const c = CATALOGUE[name];
  if (!c) return undefined;
  const G = { B: c.slice(1, 4), C: c.slice(4, 7), maker: c[0], range: [c[7], c[8]] };
  cache.set(name, G);
  G.type = family(index(G, LINES.d), abbe(G));
  return G;
}

// Six-digit glass code: the first three decimals of n_d and 10 V_d, rounded (N-BK7 → 517642,
// n_d = 2.003 → 003…).
export const glassCode = (glass) => {
  const n = Math.round((index(glass, LINES.d) - 1) * 1000) % 1000, v = Math.round(abbe(glass) * 10);
  return String(n).padStart(3, '0') + String(v).padStart(3, '0');
};

export function index(glass, lambdaNm) {
  if (!glass || glass === 'air') return 1.0;
  const G = typeof glass === 'string' ? glassData(glass) : glass;
  if (!G) throw new Error('unknown glass ' + glass);
  // perturbed glass for tolerancing: { base, dn } shifts the whole dispersion curve by dn
  if (G.base !== undefined) return index(G.base, lambdaNm) + (G.dn || 0);
  const l2 = (lambdaNm / 1000) ** 2;
  // model glass from (n_d, V_d): two-term Cauchy n = A + B/λ², reproducing n_d and V_d exactly
  if (G.nd) {
    const B = (G.nd - 1) / G.vd / (1 / (LINES.F / 1000) ** 2 - 1 / (LINES.C / 1000) ** 2);
    return G.nd + B * (1 / l2 - 1 / (LINES.d / 1000) ** 2);
  }
  let s = 1;
  for (let i = 0; i < 3; i++) s += G.B[i] * l2 / (l2 - G.C[i]);
  return Math.sqrt(s);
}

export function abbe(glass) {
  const nd = index(glass, LINES.d), nF = index(glass, LINES.F), nC = index(glass, LINES.C);
  return (nd - 1) / (nF - nC);
}

// Relative partial dispersion P_{g,F} = (n_g − n_F)/(n_F − n_C)
export function partialDispersion(glass) {
  const ng = index(glass, LINES.g), nF = index(glass, LINES.F), nC = index(glass, LINES.C);
  return (ng - nF) / (nF - nC);
}

// Group index n_g = n − λ dn/dλ (central difference) — relevant for pulse/coherence effects.
export function groupIndex(glass, lambdaNm) {
  const h = 0.5;
  const dn = (index(glass, lambdaNm + h) - index(glass, lambdaNm - h)) / (2 * h);
  return index(glass, lambdaNm) - lambdaNm * dn;
}

// One row per glass for glass maps: n_d, V_d, P_g,F and its departure from the normal line
// P_g,F = 0.6438 − 0.001682 V_d (anomalous partial dispersion, the apochromat's lever).
let table = null;
export function glassTable() {
  if (table) return table;
  table = GLASS_NAMES.map((name) => {
    const G = glassData(name), nd = index(name, LINES.d), vd = abbe(name), pgf = partialDispersion(name);
    return { name, maker: CATALOGUE[name]?.[0] || 'core', nd, vd, pgf, dpgf: pgf - (0.6438 - 0.001682 * vd), code: glassCode(name), type: G.type || family(nd, vd), range: G.range || (CATALOGUE[name] ? CATALOGUE[name].slice(7, 9) : null) };
  });
  return table;
}
