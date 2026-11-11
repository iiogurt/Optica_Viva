// Infrared and ultraviolet photography. Pure functions; wavelengths in nm.
//
// A digital camera's silicon sensor responds from about 300 to 1100 nm; its Bayer colour filters
// pass the near infrared almost equally in all three channels, and a "hot mirror" in front of the
// sensor normally removes everything outside 400–680 nm. Remove the hot mirror and put a long-pass
// filter in front of the lens, and the camera sees the near infrared: foliage turns white (the Wood
// effect: chlorophyll absorbs red, but the leaf's cell structure reflects about half of the light
// beyond the "red edge" at 700 nm), a clear sky turns dark (Rayleigh scattering falls as λ⁻⁴), and
// water turns black. With an ultraviolet-pass filter, flowers show patterns meant for insects.
//
// The spectra below are representative smooth curves, not measured data: vegetation after the
// shape of leaf-reflectance spectra (green peak, red absorption, red edge, near-infrared plateau),
// silicon after a typical front-illuminated sensor, the colour filters after typical dyes.
import { index, abbe } from './glass.js';
import { planck } from './colorsci.js';
import { uniform } from './random.js';
import { N_ } from './i18n.js';

export const L0 = 300, L1 = 1100, DL = 10, NL = (L1 - L0) / DL + 1;
export const lams = Array.from({ length: NL }, (_, i) => L0 + i * DL);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const edge = (l, at, width) => smooth((l - at + width / 2) / width); // 0 below, 1 above
const bump = (l, c, w) => Math.exp(-(((l - c) / w) ** 2));

// Reflectance of the scene's materials.
export const MATERIALS = {
  leaf: (l) => 0.04 + 0.08 * bump(l, 550, 35) + 0.46 * edge(l, 715, 45) - 0.03 * bump(l, 670, 20),
  grass: (l) => 0.05 + 0.07 * bump(l, 555, 40) + 0.38 * edge(l, 710, 50) - 0.03 * bump(l, 670, 20),
  bark: (l) => 0.06 + 0.12 * edge(l, 600, 300),
  water: (l) => 0.03 * (1 - edge(l, 750, 100)) + 0.005, // absorbs the near infrared
  cloud: () => 0.8,
  petal: (l) => 0.05 + 0.75 * edge(l, 510, 40) + 0.3 * bump(l, 365, 35), // yellow, and the rim reflects UV
  centre: (l) => 0.04 + 0.7 * edge(l, 510, 40), // yellow too, but absorbs UV: the bullseye bees see
  skin: (l) => 0.08 + 0.45 * edge(l, 600, 120),
  sunscreen: (l) => (0.08 + 0.45 * edge(l, 600, 120)) * (0.08 + 0.92 * edge(l, 390, 30)), // absorbs UV
};

// Daylight on the scene: the Sun (a 5778 K blackbody with an ultraviolet cut by ozone below 320 nm).
export const sunlight = (l) => (planck(l, 5778) / planck(560, 5778)) * edge(l, 315, 20);
// The blue sky's own radiance: sunlight scattered as λ⁻⁴, relative to 550 nm.
export const skylight = (l) => sunlight(l) * (550 / l) ** 4;

// Silicon (front-illuminated) and the Bayer dyes, which become transparent in the near infrared.
export const silicon = (l) => smooth((l - 300) / 120) * (1 - smooth((l - 820) / 280)) * 0.9;
export const bayer = [
  (l) => 0.95 * edge(l, 585, 40) * (1 - 0.35 * bump(l, 680, 10)) + 0.0, // red: passes everything above ~580
  (l) => 0.9 * bump(l, 535, 45) + 0.85 * edge(l, 800, 60), // green: a band, transparent in the IR
  (l) => 0.9 * bump(l, 455, 45) + 0.85 * edge(l, 810, 60) + 0.15 * bump(l, 370, 30), // blue: also some UV
];

// Filters on the lens (or the hot mirror in the camera): transmission.
export const FILTERS = {
  normal: { label: N_('Normal camera (hot mirror)'), T: (l) => edge(l, 400, 20) * (1 - edge(l, 670, 30)) },
  super: { label: N_('590 nm long-pass ("super colour")'), T: (l) => edge(l, 590, 20) },
  ir720: { label: N_('720 nm infrared filter'), T: (l) => edge(l, 720, 25) },
  ir850: { label: N_('850 nm infrared filter (black and white)'), T: (l) => edge(l, 850, 25) },
  full: { label: N_('Full spectrum, no filter'), T: () => 1 },
  uv: { label: N_('Ultraviolet pass (320–390 nm)'), T: (l) => edge(l, 320, 15) * (1 - edge(l, 395, 15)) },
};

// Camera signal per channel for a spectrum S(λ) (radiance reaching the lens) through a filter.
export function camera(S, T) {
  const out = [0, 0, 0];
  for (const l of lams) { const s = S(l) * T(l) * silicon(l) * DL; for (let c = 0; c < 3; c++) out[c] += s * bayer[c](l); }
  return out;
}

// A thin achromatic doublet (crown N-BK7, flint F2) corrected for F and C: its focal length against
// wavelength. The powers split as φ₁ = φV₁/(V₁ − V₂), φ₂ = −φV₂/(V₁ − V₂) at the d line; each element's
// power scales with (n(λ) − 1). The secondary spectrum leaves the near infrared focused behind the
// visible: the red "R" mark on old lenses' focus scales.
export function achromat(f = 50, crown = 'N-BK7', flint = 'F2') {
  const V1 = abbe(crown), V2 = abbe(flint), phi = 1 / f, p1 = (phi * V1) / (V1 - V2), p2 = (-phi * V2) / (V1 - V2);
  const nd1 = index(crown, 587.56) - 1, nd2 = index(flint, 587.56) - 1;
  const power = (l) => p1 * ((index(crown, l) - 1) / nd1) + p2 * ((index(flint, l) - 1) / nd2);
  return { f: (l) => 1 / power(l), shift: (l) => 1 / power(l) - f };
}

// The scene: a material for each point (x, y) in [0, 1]² (y down), with soft edges: weights per
// material and a shading factor. Sky (with clouds), a tree, hills of trees, grass, a pond and a
// flower close by.
const TAB = (() => { const r = uniform(17); return Float64Array.from({ length: 4096 }, r); })();
const hash = (x, y) => TAB[(((x * 73856093) ^ (y * 19349663)) >>> 0) & 4095]; // seeded value noise on the integer lattice
const vnoise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1), sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.25 * vnoise(2 * x + 3, 2 * y + 1) + 0.125 * vnoise(4 * x + 7, 4 * y + 5) + 0.0625 * vnoise(8 * x + 1, 8 * y + 9);
export function sceneAt(x, y) {
  const hill = 0.5 - 0.06 * Math.sin(x * 5 + 1) - 0.03 * Math.sin(x * 13) - 0.05 * fbm(x * 8, 0.3);
  const crown = Math.hypot((x - 0.28) / 0.17, (y - 0.33) / 0.2) + 0.25 * (fbm(x * 14, y * 14) - 0.5);
  const trunk = Math.abs(x - 0.28) < 0.018 && y > 0.45 && y < 0.66;
  const pond = Math.hypot((x - 0.55) / 0.2, (y - 0.78) / 0.07) < 1;
  const fl = Math.hypot((x - 0.86) / 0.09, (y - 0.78) / 0.135), petals = fl < 1 + 0.18 * Math.cos(Math.atan2(y - 0.78, x - 0.86) * 9);
  if (petals && fl < 0.38) return { m: 'centre', shade: 1 };
  if (petals) return { m: 'petal', shade: 1 };
  if (trunk) return { m: 'bark', shade: 0.75 };
  if (crown < 1) return { m: 'leaf', shade: 0.7 + 0.3 * (1 - crown) };
  if (y < hill) {
    const cl = fbm(x * 5, y * 9) - 0.1 * y;
    return cl > 0.55 ? { m: 'cloud', shade: 0.85 + 0.3 * (cl - 0.55) } : { m: 'sky', shade: 0.7 + 0.5 * (y / hill) };
  }
  if (y < 0.62) return { m: 'leaf', shade: 0.55 + 0.25 * fbm(x * 30, y * 30) }; // distant woods
  if (pond) return { m: 'water', shade: 1 };
  return { m: 'grass', shade: 0.65 + 0.35 * fbm(x * 40, y * 60) };
}
