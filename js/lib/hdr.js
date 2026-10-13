// High dynamic range: a procedural high-contrast scene, neutral-density and graduated filters,
// a photon-transfer camera model, exposure bracketing merged into radiance with inverse-variance
// weights, global tone mapping, and exposure fusion (Mertens et al. 2007) with Laplacian pyramids.

// Seeded Gaussian deviates.
export function gauss(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// Scene radiance (linear RGB, arbitrary units: the dark foreground ≈ 1, the sky near the sun
// ≈ 10³, the sun's disk ≈ 10⁵): a sunset over hills with a lit window in the foreground.
export function scene(W, H) {
  const L = new Float32Array(W * H * 3), sx = 0.62, sy = 0.36;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i / W, y = j / H, k = (j * W + i) * 3;
    const ridge = 0.55 + 0.06 * Math.sin(x * 7.3 + 1) + 0.03 * Math.sin(x * 23.1) + 0.015 * Math.sin(x * 61);
    let r, g, b;
    if (y < ridge) {
      const d = Math.hypot((x - sx) * 1.6, y - sy), alt = (ridge - y) / ridge;
      const glow = 900 * Math.exp(-d / 0.05) + 260 * Math.exp(-d / 0.22), base = 60 + 140 * (1 - alt);
      r = base * 1.0 + glow * 1.0; g = base * 0.62 + glow * 0.7; b = base * 0.5 * (0.5 + alt) + glow * 0.35;
      const cl = Math.max(0, Math.sin(x * 9 + y * 30) * Math.sin(x * 17 - y * 11)); // thin clouds lit from behind
      r += 120 * cl * Math.exp(-d / 0.3); g += 60 * cl * Math.exp(-d / 0.3); b += 30 * cl * Math.exp(-d / 0.3);
      if (d < 0.022) { r = 1e5; g = 9e4; b = 7e4; }
    } else {
      const depth = (y - ridge) / (1 - ridge), tex = 0.6 + 0.4 * Math.sin(i * 0.9) * Math.sin(j * 1.3);
      r = (0.6 + 2.2 * (1 - depth)) * tex * 1.1; g = (0.6 + 2.2 * (1 - depth)) * tex; b = (0.7 + 2 * (1 - depth)) * tex * 0.9;
      // a lit cabin window and its door
      if (x > 0.18 && x < 0.24 && y > 0.74 && y < 0.8) { r = 300; g = 190; b = 90; }
      if (x > 0.145 && x < 0.29 && y > 0.7 && y < 0.9 && !(x > 0.18 && x < 0.24 && y > 0.74 && y < 0.8)) { r *= 0.35; g *= 0.35; b *= 0.4; }
    }
    L[k] = r; L[k + 1] = g; L[k + 2] = b;
  }
  return L;
}

// Neutral density: transmission 10^(−OD) = 2^(−stops). Graduated ND: full strength above the
// transition line at height y0, with a smooth (soft) or sharp (hard) edge of width w.
export const ndTransmission = (stops) => Math.pow(2, -stops);
export const odToStops = (od) => od * Math.log2(10);
export function gradTransmission(y, stops, y0, w) {
  const t = w > 0 ? Math.min(1, Math.max(0, (y - (y0 - w / 2)) / w)) : y > y0 ? 1 : 0;
  const s = t * t * (3 - 2 * t); // smoothstep
  return Math.pow(2, -stops * (1 - s));
}

// Camera: photoelectrons = L · k · t (k chosen so that L = 1 for 1 s gives kE electrons), shot
// noise, read noise σ_r, full-well clipping and ADC quantisation (bits). Returns electrons.
export function expose(L, t, cam, rand) {
  const out = new Float32Array(L.length), q = cam.fwc / (2 ** cam.bits - 1);
  for (let k = 0; k < L.length; k++) {
    const mu = L[k] * cam.k * t;
    let e = mu + Math.sqrt(Math.max(mu, 0)) * rand() + cam.read * rand();
    e = Math.min(cam.fwc, Math.max(0, e));
    out[k] = Math.round(e / q) * q;
  }
  return out;
}

// Merge a bracket into radiance: inverse-variance weights w = t²/(S + σ_r²) per sample (noise of
// the radiance estimate S/(k t)), excluding clipped samples. Returns radiance and the number of
// usable frames per pixel.
export function mergeHDR(frames, times, cam) {
  const n = frames[0].length, L = new Float32Array(n), used = new Uint8Array(n), clip = cam.fwc * 0.98;
  for (let p = 0; p < n; p++) {
    let num = 0, den = 0, c = 0;
    for (let f = 0; f < frames.length; f++) {
      const S = frames[f][p];
      if (S >= clip) continue;
      const w = (times[f] * times[f]) / (Math.max(S, 0) + cam.read * cam.read);
      num += w * (S / (cam.k * times[f])); den += w; c++;
    }
    if (!den) { // everything clipped: take the shortest exposure's clipped value
      const f = times.indexOf(Math.min(...times)); num = frames[f][p] / (cam.k * times[f]); den = 1;
    }
    L[p] = num / den; used[p] = c;
  }
  return { L, used };
}

// SNR of the radiance estimate at scene radiance x (single exposure, or optimally merged).
export function snr(x, times, cam) {
  let s2 = 0;
  for (const t of times) { const S = x * cam.k * t; if (S >= cam.fwc) continue; s2 += (S * S) / (S + cam.read * cam.read); }
  return Math.sqrt(s2);
}
// Engineering dynamic range (EV): from the radiance with SNR = 1 to the highest unclipped radiance.
export function dynamicRange(times, cam) {
  const tMin = Math.min(...times), hi = (0.999 * cam.fwc) / (cam.k * tMin);
  let lo = hi;
  for (let x = hi; x > 1e-9; x /= 1.01) { if (snr(x, times, cam) < 1) break; lo = x; }
  return Math.log2(hi / lo);
}

// Global tone mapping (Reinhard 2002) of radiance with key a on log-average luminance, then sRGB.
export function reinhard(L, W, H, a = 0.18, white = Infinity) {
  let s = 0;
  for (let p = 0; p < W * H; p++) s += Math.log(1e-4 + 0.2126 * L[p * 3] + 0.7152 * L[p * 3 + 1] + 0.0722 * L[p * 3 + 2]);
  const lav = Math.exp(s / (W * H)), out = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const Y = 0.2126 * L[p * 3] + 0.7152 * L[p * 3 + 1] + 0.0722 * L[p * 3 + 2], Ys = (a / lav) * Y;
    const Yd = (Ys * (1 + Ys / (white * white))) / (1 + Ys), k = Y > 0 ? Yd / Y : 0;
    for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.min(1, L[p * 3 + c] * k);
  }
  return out;
}

// ── Exposure fusion with Laplacian pyramids ─────────────────────────────────────────────────
const down = (a, W, H) => {
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), o = new Float32Array(w * h);
  const k = [1, 4, 6, 4, 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const xx = Math.min(W - 1, Math.max(0, 2 * x + i)), yy = Math.min(H - 1, Math.max(0, 2 * y + j)), wt = k[i + 2] * k[j + 2];
      s += wt * a[yy * W + xx]; n += wt;
    }
    o[y * w + x] = s / n;
  }
  return { a: o, W: w, H: h };
};
const up = (a, w, h, W, H) => {
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(h - 1, Math.max(0, (y - 0.5) / 2)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    o[y * W + x] = (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
  }
  return o;
};
function gaussPyr(a, W, H, n) { const p = [{ a, W, H }]; for (let i = 1; i < n; i++) p.push(down(p[i - 1].a, p[i - 1].W, p[i - 1].H)); return p; }
function lapPyr(a, W, H, n) {
  const g = gaussPyr(a, W, H, n), l = [];
  for (let i = 0; i < n - 1; i++) { const u = up(g[i + 1].a, g[i + 1].W, g[i + 1].H, g[i].W, g[i].H); l.push({ a: g[i].a.map((v, k) => v - u[k]), W: g[i].W, H: g[i].H }); }
  l.push(g[n - 1]);
  return l;
}
// images: display-referred sRGB frames in [0, 1] (W·H·3). Weights: contrast (|Laplacian|),
// saturation (channel std) and well-exposedness exp(−(v − 0.5)²/(2·0.2²)), as in Mertens et al.
export function exposureFusion(images, W, H, levels = 6) {
  const n = W * H, Wt = images.map((im) => {
    const w = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const r = im[p * 3], g = im[p * 3 + 1], b = im[p * 3 + 2], m = (r + g + b) / 3;
      const sat = Math.sqrt(((r - m) ** 2 + (g - m) ** 2 + (b - m) ** 2) / 3);
      const x = p % W, y = (p / W) | 0, gr = (q) => 0.333 * (im[q * 3] + im[q * 3 + 1] + im[q * 3 + 2]);
      const lap = x > 0 && x < W - 1 && y > 0 && y < H - 1 ? Math.abs(4 * gr(p) - gr(p - 1) - gr(p + 1) - gr(p - W) - gr(p + W)) : 0;
      const we = Math.exp(-((r - 0.5) ** 2) / 0.08) * Math.exp(-((g - 0.5) ** 2) / 0.08) * Math.exp(-((b - 0.5) ** 2) / 0.08);
      w[p] = (lap + 0.02) * (sat + 0.02) * we + 1e-12;
    }
    return w;
  });
  for (let p = 0; p < n; p++) { let s = 0; for (const w of Wt) s += w[p]; for (const w of Wt) w[p] /= s; }
  const out = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    let acc = null;
    images.forEach((im, f) => {
      const ch = new Float32Array(n); for (let p = 0; p < n; p++) ch[p] = im[p * 3 + c];
      const L = lapPyr(ch, W, H, levels), G = gaussPyr(Wt[f], W, H, levels);
      if (!acc) acc = L.map((l) => ({ a: new Float32Array(l.a.length), W: l.W, H: l.H }));
      L.forEach((l, i) => { for (let k = 0; k < l.a.length; k++) acc[i].a[k] += G[i].a[k] * l.a[k]; });
    });
    // collapse
    let img = acc[levels - 1].a;
    for (let i = levels - 2; i >= 0; i--) { const u = up(img, acc[i + 1].W, acc[i + 1].H, acc[i].W, acc[i].H); img = acc[i].a.map((v, k) => v + u[k]); }
    for (let p = 0; p < n; p++) out[p * 3 + c] = Math.min(1, Math.max(0, img[p]));
  }
  return out;
}

// Full pipeline for the lab (runs in the worker): scene → optional graduated ND → bracket of
// exposures → (a) the middle exposure as shot, (b) merged radiance tone-mapped, (c) exposure
// fusion. o = { W, H, cam, ev0 (base exposure, EV relative to 1/250 s), n (frames), step (EV),
// grad: { stops, y0, w } | null, nd (stops), fusion (bool) }
let sceneCache = null;
export function hdrPipeline(o) {
  if (!sceneCache || sceneCache.W !== o.W || sceneCache.H !== o.H) sceneCache = { W: o.W, H: o.H, L: scene(o.W, o.H) };
  const { W, H } = o, L0 = sceneCache.L, L = new Float32Array(L0.length), nd = ndTransmission(o.nd || 0);
  for (let j = 0; j < H; j++) {
    const g = o.grad ? gradTransmission(j / H, o.grad.stops, o.grad.y0, o.grad.w) : 1;
    for (let i = 0; i < W; i++) for (let c = 0; c < 3; c++) { const k = (j * W + i) * 3 + c; L[k] = L0[k] * g * nd; }
  }
  const t0 = Math.pow(2, o.ev0) / 250, half = (o.n - 1) / 2, times = Array.from({ length: o.n }, (_, i) => t0 * Math.pow(2, (i - half) * o.step));
  const rand = gauss(7), frames = times.map((t) => expose(L, t, o.cam, rand));
  const disp = (f) => { const a = new Float32Array(f.length); for (let k = 0; k < f.length; k++) a[k] = Math.pow(Math.min(1, f[k] / o.cam.fwc), 1 / 2.2); return a; };
  const shot = disp(frames[Math.floor(o.n / 2)]);
  let clip = 0, dark = 0; const mid = frames[Math.floor(o.n / 2)];
  for (let p = 0; p < W * H; p++) { const g = mid[p * 3 + 1]; if (g >= o.cam.fwc * 0.98) clip++; else if (g < 10 * o.cam.read) dark++; }
  const merged = mergeHDR(frames, times, o.cam), tm = reinhard(merged.L, W, H, 0.18, 2000);
  const tmd = new Float32Array(tm.length); for (let k = 0; k < tm.length; k++) tmd[k] = Math.pow(tm[k], 1 / 2.2);
  const fused = o.fusion && o.n > 1 ? exposureFusion(frames.map(disp), W, H, 5) : null;
  return { W, H, shot, merged: tmd, fused, times, clipFrac: clip / (W * H), darkFrac: dark / (W * H), dr: dynamicRange(times, o.cam), dr1: dynamicRange([times[Math.floor(o.n / 2)]], o.cam) };
}
