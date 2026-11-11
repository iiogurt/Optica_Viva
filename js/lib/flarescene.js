// The flare laboratory's scene: a dusk landscape rendered in linear light (relative radiance; the
// sky at the horizon is about 1), so that the sun, the sky round it and the dark foreground keep
// their real contrast until one tone curve maps them to the screen. A sky with the forward-
// scattering glow round the sun, thin clouds lit from below, three mountain ridges fading into the
// haze with distance (aerial perspective), and a lake that mirrors all of it with a glitter path
// under the sun. Procedural and seeded: the same scene every time.
import { uniform } from './random.js';

export const HORIZON = 0.72; // the lake's far shore, as a fraction of the picture height
const SUN = [1, 0.78, 0.55]; // colour of the low sun and of the light it scatters forwards
const ZENITH = [0.035, 0.06, 0.16], LOW = [1, 0.5, 0.3];

// Tables built once: smooth value noise, the three ridge lines and the cloud layer.
export function makeScene(seed = 11) {
  const r = uniform(seed), N = 1024, tab = Float32Array.from({ length: N }, r);
  const noise = (x) => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return tab[i & (N - 1)] + (tab[(i + 1) & (N - 1)] - tab[i & (N - 1)]) * s; };
  const fbm = (x, oct = 5) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * noise(x * f + o * 37.13); f *= 2.03; a *= 0.5; } return s / (1 - 0.5 ** oct); };
  // ridges, far to near: the top edge (fraction of the height) at 1025 points across the picture
  const R = 1024;
  const ridges = [
    { base: 0.585, amp: 0.10, freq: 2.6, haze: 0.70, col: [0.06, 0.05, 0.09] },
    { base: 0.64, amp: 0.075, freq: 4.4, haze: 0.42, col: [0.03, 0.025, 0.045] },
    { base: 0.69, amp: 0.05, freq: 8.0, haze: 0.12, col: [0.008, 0.007, 0.012] },
  ].map((g, k) => ({ ...g, top: Float32Array.from({ length: R + 1 }, (_, i) => Math.min(HORIZON - 0.004, g.base - g.amp * (fbm((i / R) * g.freq + 17 * k) - 0.35) * 2)) }));
  // clouds between 25 % and 60 % of the height: density on a 512 × 160 grid
  const CW = 512, CH = 160, cloud = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) {
    const v = 0.25 + (0.35 * j) / (CH - 1), band = Math.exp(-(((v - 0.42) / 0.07) ** 2));
    for (let i = 0; i < CW; i++) {
      const u = i / (CW - 1), d = fbm(u * 5 + 0.6 * fbm(v * 9 + 3, 3) + 50, 5);
      cloud[j * CW + i] = Math.max(0, Math.min(1, (d - 0.5) * 3.2)) * band;
    }
  }
  return { tab, noise, ridges, R, cloud, CW, CH };
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ridgeTop(g, R, u) { const x = Math.min(1, Math.max(0, u)) * R, i = Math.min(R - 1, x | 0), f = x - i; return g.top[i] + (g.top[i + 1] - g.top[i]) * f; }

// Radiance of the sky or the mountains (no lake) at (u, v) ∈ [0, 1]² (v downwards), with the sun at
// (su, sv) and the picture's width/height ratio aspect; writes linear RGB into out.
function above(S, u, v, su, sv, aspect, out) {
  const d = Math.hypot((u - su) * aspect, v - sv);
  const near = 2.4 * Math.exp(-d / 0.045), wide = 0.85 * Math.exp(-d / 0.24); // Mie forward lobe
  // mountains, nearest first: dark rock seen through haze that is lit like the sky at the horizon
  for (let k = S.ridges.length - 1; k >= 0; k--) {
    const g = S.ridges[k];
    if (v >= ridgeTop(g, S.R, u)) {
      const dh = Math.hypot((u - su) * aspect, HORIZON - 0.04 - sv), hz = 1 + 1.6 * Math.exp(-dh / 0.2);
      const c = lerp3(g.col, LOW, g.haze * 0.55);
      for (let q = 0; q < 3; q++) out[q] = c[q] * (g.haze > 0.3 ? hz : 1 + 0.25 * (hz - 1));
      return out;
    }
  }
  // sky: warm at the horizon, deep blue above, with the glow round the sun
  const e = Math.min(1, Math.max(0, (HORIZON - v) / HORIZON)), base = lerp3(LOW, ZENITH, Math.pow(e, 0.55));
  for (let q = 0; q < 3; q++) out[q] = base[q] + SUN[q] * (near + wide);
  // thin clouds, dark against the zenith and lit from below near the sun
  if (v > 0.25 && v < 0.6) {
    const x = u * (S.CW - 1), y = ((v - 0.25) / 0.35) * (S.CH - 1), i = Math.min(S.CW - 2, x | 0), j = Math.min(S.CH - 2, y | 0), fx = x - i, fy = y - j, c = S.cloud;
    const dens = (c[j * S.CW + i] * (1 - fx) + c[j * S.CW + i + 1] * fx) * (1 - fy) + (c[(j + 1) * S.CW + i] * (1 - fx) + c[(j + 1) * S.CW + i + 1] * fx) * fy;
    if (dens > 0) {
      const lit = 0.18 + 2.2 * wide + 1.2 * near;
      for (let q = 0; q < 3; q++) out[q] = out[q] * (1 - 0.85 * dens) + dens * (0.06 * base[q] + SUN[q] * lit * (q === 0 ? 1 : q === 1 ? 0.8 : 0.62));
    }
  }
  return out;
}

// Radiance of the whole scene at (u, v): above the horizon the sky and mountains; below it the lake,
// which mirrors them with small ripples. Water seen a few degrees below the horizon reflects most of
// the light (Fresnel reflectance about 0.6 at 85° incidence), less as the view steepens towards the
// near shore: here 0.55 at the far shore falling to 0.30. Under the sun, a glitter path of glints
// widens towards the viewer.
export function radiance(S, u, v, su, sv, aspect, out) {
  if (v < HORIZON) return above(S, u, v, su, sv, aspect, out);
  const depth = v - HORIZON;
  const ripple = 0.0035 * (S.noise(depth * 2400 / (1 + depth * 40)) - 0.5) * (1 + depth * 12);
  above(S, u + ripple, 2 * HORIZON - v, su, sv, aspect, out);
  const refl = 0.55 - 0.25 * Math.min(1, depth / 0.28);
  out[0] *= refl * 0.9; out[1] *= refl * 0.95; out[2] *= refl;
  if (sv < HORIZON) {
    // glints: a band under the sun that widens towards the viewer
    const half = 0.012 + depth * 0.3, dx = Math.abs(u - su) * aspect;
    if (dx < half) {
      const cell = S.tab[(Math.floor(u * 520) * 7 + Math.floor(depth * 1600) * 131) & 1023];
      const g = Math.pow(cell, 14) * 9 * (1 - dx / half) * Math.exp(-depth / 0.35);
      for (let q = 0; q < 3; q++) out[q] += SUN[q] * g;
    }
  }
  return out;
}

// Filmic tone curve (Narkowicz's fit to the ACES reference rendering), linear in → display-linear out.
export const aces = (x) => { const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return y < 0 ? 0 : y > 1 ? 1 : y; };
