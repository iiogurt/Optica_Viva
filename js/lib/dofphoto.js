// The ground of the depth-of-field laboratory's synthetic photograph, as a pure function so that
// row bands can be rendered in parallel by the compute workers (js/lib/tasks.js).
import { blurDiameter as blur } from './optics.js';
import { besselJ1 } from './pupil.js';

const LAMBDA = 0.00055; // mm
const diskMTF = (x) => (Math.abs(x) < 1e-6 ? 1 : (2 * besselJ1(Math.PI * x)) / (Math.PI * x));

// Rows [y0, y1) of an IW×IH frame as RGBA bytes: sky above the horizon row hz, and a checked
// ground plane whose texture contrast is the exact defocus MTF of a uniform disk (times the
// diffraction MTF when diff is set) at its local spatial frequency, anti-aliased at Nyquist.
// p = { IW, IH, hz (px), pmm (sensor mm per px), f, N, s (mm), diff, Nw }
export function groundRows(p, y0, y1) {
  const { IW, hz, pmm, f, N, s } = p, out = new Uint8ClampedArray((y1 - y0) * IW * 4);
  const hc = 450; // camera height (mm): a low, tabletop viewpoint
  const P = 250; // ground tile period (mm)
  for (let y = y0; y < y1; y++) {
    const ymm = (y + 0.5 - hz) * pmm;
    for (let x = 0; x < IW; x++) {
      const o = ((y - y0) * IW + x) * 4;
      if (ymm <= 0.0001) { // sky
        const t = Math.min(1, Math.sqrt(-ymm / (hz * pmm)));
        out[o] = 236 - 214 * t; out[o + 1] = 150 - 120 * t; out[o + 2] = 120 - 60 * t; out[o + 3] = 255;
        continue;
      }
      const Z = (f * hc) / ymm;
      const xmm = (x + 0.5 - IW / 2) * pmm;
      const X = (xmm * Z) / f;
      const nx = f / (Z * P), nz = (f * hc) / (Z * Z * P);
      const nu = Math.hypot(nx, nz);
      const c = blur(f, N, s, Z);
      let mtf = diskMTF(nu * c);
      if (p.diff) { const v = nu * LAMBDA * p.Nw; mtf *= v < 1 ? (2 / Math.PI) * (Math.acos(v) - v * Math.sqrt(1 - v * v)) : 0; }
      const nyq = 0.5 / pmm;
      const aa = nu > nyq ? 0 : Math.max(0, 1 - nu / nyq);
      const tex = 0.5 + 0.5 * mtf * aa * Math.cos((2 * Math.PI * X) / P) * Math.cos((2 * Math.PI * Z) / P);
      const haze = 1 - Math.exp(-Z / 200000);
      const r = 38 + 52 * tex, gg = 52 + 58 * tex, b = 40 + 30 * tex;
      out[o] = r + (200 - r) * haze; out[o + 1] = gg + (128 - gg) * haze; out[o + 2] = b + (110 - b) * haze; out[o + 3] = 255;
    }
  }
  return out;
}
