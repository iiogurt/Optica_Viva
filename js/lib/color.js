// Colour science: CIE 1931 2° colour-matching functions (Wyman, Sloan & Shirley 2013
// multi-lobe fit, < 1% error vs. tabulated CMFs), XYZ→linear sRGB, sRGB OETF, colormaps.

const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };

export function cmf(lambda) {
  const x = 1.056 * g(lambda, 599.8, 37.9, 31.0) + 0.362 * g(lambda, 442.0, 16.0, 26.7) - 0.065 * g(lambda, 501.1, 20.4, 26.2);
  const y = 0.821 * g(lambda, 568.8, 46.9, 40.5) + 0.286 * g(lambda, 530.9, 16.3, 31.1);
  const z = 1.217 * g(lambda, 437.0, 11.8, 36.0) + 0.681 * g(lambda, 459.0, 26.0, 13.8);
  return [x, y, z];
}

export function xyzToLinearRGB([X, Y, Z]) {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
}

export const oetf = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export const eotf = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

// Out-of-gamut handling: desaturate toward the luminance axis until all channels ≥ 0.
export function gamutClip(rgb) {
  const [r, gg, b] = rgb;
  const Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const m = Math.min(r, gg, b);
  if (m >= 0) return rgb;
  const k = Y / (Y - m + 1e-12);
  return [Y + (r - Y) * k, Y + (gg - Y) * k, Y + (b - Y) * k];
}

// Display colour of a monochromatic wavelength, normalised so the max channel = 1.
export function wavelengthRGB(lambda, gamma = true) {
  let rgb = gamutClip(xyzToLinearRGB(cmf(lambda)));
  const mx = Math.max(...rgb, 1e-9);
  // fade outside the visible band so 380/720 nm don't appear as full-intensity colours
  const fade = lambda < 420 ? 0.3 + 0.7 * (lambda - 380) / 40 : lambda > 680 ? 0.3 + 0.7 * (720 - lambda) / 40 : 1;
  rgb = rgb.map((v) => Math.max(0, v / mx) * Math.max(0.15, fade));
  return gamma ? rgb.map(oetf) : rgb;
}

export const wavelengthCSS = (lambda, a = 1) => {
  const [r, gg, b] = wavelengthRGB(lambda);
  return `rgba(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0},${a})`;
};

// Sample a set of wavelengths with per-wavelength linear-RGB weights such that a flat
// (equal-energy) spectrum sums to neutral white (1,1,1).
export function spectralBasis(lambdas) {
  const raw = lambdas.map((l) => xyzToLinearRGB(cmf(l)));
  const sum = [0, 0, 0];
  raw.forEach((c) => { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; });
  return raw.map((c) => [c[0] / sum[0], c[1] / sum[1], c[2] / sum[2]]);
}

export function linspace(a, b, n) {
  if (n === 1) return [(a + b) / 2];
  return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
}

// Polynomial fits of matplotlib colormaps (M. Zucker), t ∈ [0,1] → sRGB [0,1].
const POLY = {
  inferno: [[0.0002189403691192265, 0.001651004631001012, -0.01948089843709184], [0.1065134194856116, 0.5639564367884091, 3.932712388889277], [11.60249308247187, -3.972853965665698, -15.9423941062914], [-41.70399613139459, 17.43639888205313, 44.35414519872813], [77.162935699427, -33.40235894210092, -81.80730925738993], [-71.31942824499214, 32.62606426397723, 73.20951985803202], [25.13112622477341, -12.24266895238567, -23.07032500287172]],
  viridis: [[0.2777273272234177, 0.005407344544966578, 0.3340998053353061], [0.1050930431085774, 1.404613529898575, 1.384590162594685], [-0.3308618287255563, 0.214847559468213, 0.09509516302823659], [-4.634230498983486, -5.799100973351585, -19.33244095627987], [6.228269936347081, 14.17993336680509, 56.69055260068105], [4.776384997670288, -13.74514537774601, -65.35303263337234], [-5.435455855934631, 4.645852612178535, 26.3124352495832]],
  magma: [[-0.002136485053939582, -0.000749655052795221, -0.005386127855323933], [0.2516605407371642, 0.6775232436837668, 2.494026599312351], [8.353717279216625, -3.577719514958484, 0.3144679030132573], [-27.66873308576866, 14.26473078096533, -13.64921318813922], [52.17613981234068, -27.94360607168351, 12.94416944238394], [-50.76852536473588, 29.04658282127291, 4.23415299384598], [18.65570506591883, -11.48977351997711, -5.601961508734096]],
};

export function colormap(name, t) {
  t = Math.min(1, Math.max(0, t));
  const c = POLY[name];
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let v = 0;
    for (let k = 6; k >= 0; k--) v = v * t + c[k][ch];
    out[ch] = Math.min(1, Math.max(0, v));
  }
  return out;
}

// Diverging blue–white–red map for signed quantities (wavefront, phase).
export function diverging(t) {
  t = Math.min(1, Math.max(-1, t));
  const a = [0.13, 0.4, 0.85], w = [0.96, 0.96, 0.96], b = [0.86, 0.2, 0.25];
  const s = Math.abs(t), e = t < 0 ? a : b;
  return [w[0] + (e[0] - w[0]) * s, w[1] + (e[1] - w[1]) * s, w[2] + (e[2] - w[2]) * s];
}

// Build a 256-entry LUT for fast image writes.
export function lut(name) {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = name === 'diverging' ? diverging(i / 127.5 - 1) : colormap(name, i / 255);
    L[i * 3] = c[0] * 255; L[i * 3 + 1] = c[1] * 255; L[i * 3 + 2] = c[2] * 255;
  }
  return L;
}
