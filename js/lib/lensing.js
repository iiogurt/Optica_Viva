// Strong gravitational lensing for the lensing laboratory: deflection by point-mass, SIS and SIE
// lenses with external shear, a procedural source galaxy, critical curves, and the renders, as pure
// functions so that the compute workers can produce them in parallel.

export const FOV = 7; // arcsec across the image plane
export const SFOV = 3.5; // source-plane panel

// deflection α(θ) in arcsec for a lens model; θ in arcsec
export function deflect(P, x, y) {
  let ax = 0, ay = 0;
  if (P.model === 'point') {
    const r2 = x * x + y * y + 1e-12; ax = (P.b * P.b * x) / r2; ay = (P.b * P.b * y) / r2;
  } else if (P.model === 'sis' || P.q > 0.999) {
    const r = Math.hypot(x, y) + 1e-12; ax = (P.b * x) / r; ay = (P.b * y) / r;
  } else {
    // singular isothermal ellipsoid (Kormann, Schneider & Bartelmann 1994), major axis at angle pa
    const c = Math.cos(P.pa), s = Math.sin(P.pa);
    const xr = c * x + s * y, yr = -s * x + c * y;
    const q = P.q, e = Math.sqrt(1 - q * q), psi = Math.sqrt(q * q * xr * xr + yr * yr) + 1e-12;
    const k = (P.b * Math.sqrt(q)) / e;
    const axr = k * Math.atan((e * xr) / psi), ayr = k * Math.atanh(Math.min(0.999999, (e * yr) / psi));
    ax = c * axr - s * ayr; ay = s * axr + c * ayr;
  }
  if (P.gamma) {
    const g1 = P.gamma * Math.cos(2 * P.gpa), g2 = P.gamma * Math.sin(2 * P.gpa);
    ax += g1 * x + g2 * y; ay += g2 * x - g1 * y;
  }
  return [ax, ay];
}

// procedural spiral galaxy, β in arcsec relative to its centre → linear RGB
export function galaxy(bx, by, R) {
  const r = Math.hypot(bx, by) / R, ph = Math.atan2(by, bx);
  const bulge = 1.6 * Math.exp(-7.67 * (Math.pow(r / 0.12 + 1e-6, 0.25) - 1)) / 3000;
  const arms = Math.pow(0.5 + 0.5 * Math.cos(2 * (ph - Math.log(r + 1e-3) / Math.tan(0.35))), 3);
  const disk = Math.exp(-r / 0.3) * (0.25 + 1.4 * arms);
  const knots = arms > 0.8 && r > 0.25 && r < 0.9 ? 0.6 * Math.exp(-r / 0.5) * (0.5 + 0.5 * Math.sin(37 * ph + 11 * r)) : 0;
  return [bulge * 1.0 + disk * 0.3 + knots * 1.1, bulge * 0.75 + disk * 0.5 + knots * 0.35, bulge * 0.4 + disk * 1.05 + knots * 0.85];
}

export function criticalCurves(P) {
  // det A on a grid, marching squares for det = 0
  const G = 220, s = FOV / G, det = new Float64Array((G + 1) * (G + 1)), hD = 1e-3;
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const x = -FOV / 2 + i * s, y = FOV / 2 - j * s;
    const [a1, b1] = deflect(P, x + hD, y), [a0, b0] = deflect(P, x - hD, y), [a2, b2] = deflect(P, x, y + hD), [a3, b3] = deflect(P, x, y - hD);
    const A11 = 1 - (a1 - a0) / (2 * hD), A12 = -(a2 - a3) / (2 * hD), A21 = -(b1 - b0) / (2 * hD), A22 = 1 - (b2 - b3) / (2 * hD);
    det[j * (G + 1) + i] = A11 * A22 - A12 * A21;
  }
  const segs = [];
  const P0 = (i, j) => [-FOV / 2 + i * s, FOV / 2 - j * s];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const v = [det[j * (G + 1) + i], det[j * (G + 1) + i + 1], det[(j + 1) * (G + 1) + i + 1], det[(j + 1) * (G + 1) + i]];
    const c = [P0(i, j), P0(i + 1, j), P0(i + 1, j + 1), P0(i, j + 1)];
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const a = v[e], b = v[(e + 1) % 4];
      if ((a > 0) !== (b > 0)) { const t = a / (a - b); pts.push([c[e][0] + t * (c[(e + 1) % 4][0] - c[e][0]), c[e][1] + t * (c[(e + 1) % 4][1] - c[e][1])]); }
    }
    if (pts.length >= 2) segs.push([pts[0], pts[1]]);
    if (pts.length === 4) segs.push([pts[2], pts[3]]);
  }
  return segs;
}

// Linear light → display bytes (soft shoulder, gamma 1.8)
const tone = (v) => Math.round(255 * Math.pow(1 - Math.exp(-v * 1.1), 1 / 1.8));

// Rows [y0, y1) of the N×N image plane, ss×ss supersampled, as RGBA bytes: the source galaxy at
// src (arcsec) seen through lens P, plus the lens galaxy's own light when `light` is set.
export function lensRows(p, y0, y1) {
  const { P, src, R, light, N, ss } = p, out = new Uint8ClampedArray((y1 - y0) * N * 4), f = 1 / (ss * ss);
  for (let j = y0; j < y1; j++) for (let i = 0; i < N; i++) {
    let r = 0, g = 0, b = 0;
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const x = ((i + (si + 0.5) / ss) / N - 0.5) * FOV, y = (0.5 - (j + (sj + 0.5) / ss) / N) * FOV;
      const [ax, ay] = deflect(P, x, y);
      const c = galaxy(x - ax - src[0], y - ay - src[1], R);
      r += c[0]; g += c[1]; b += c[2];
      // lens-galaxy light: de Vaucouleurs profile, I_e = 0.07 at r_e = 0.9″
      if (light) { const rr = Math.hypot(x, y * 1.3) / 0.9; const l = Math.min(4, 0.07 * Math.exp(-7.67 * (Math.pow(rr + 1e-4, 0.25) - 1))); r += l * 1.0; g += l * 0.72; b += l * 0.42; }
    }
    const k = ((j - y0) * N + i) * 4;
    out[k] = tone(r * f); out[k + 1] = tone(g * f); out[k + 2] = tone(b * f); out[k + 3] = 255;
  }
  return out;
}

// The unlensed source panel (N×N RGBA) and the total magnification, estimated as the ratio of
// the areas where the lensed and the unlensed galaxy are brighter than a threshold.
export function sourceAndMagnification({ P, src, R, N }) {
  const img = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N - 0.5) * SFOV, y = (0.5 - j / N) * SFOV;
    const c = galaxy(x - src[0], y - src[1], R), k = (j * N + i) * 4;
    img[k] = tone(c[0]); img[k + 1] = tone(c[1]); img[k + 2] = tone(c[2]); img[k + 3] = 255;
  }
  let srcArea = 0, imgArea = 0;
  const thr = 0.05;
  for (let j = 0; j < 160; j++) for (let i = 0; i < 160; i++) {
    const x = (i / 160 - 0.5) * FOV, y = (0.5 - j / 160) * FOV;
    const [ax, ay] = deflect(P, x, y);
    if (galaxy(x - ax - src[0], y - ay - src[1], R)[1] > thr) imgArea++;
    if (galaxy(x - src[0], y - src[1], R)[1] > thr) srcArea++;
  }
  return { img, mu: srcArea ? imgArea / srcArea : NaN };
}

// Every image θ (arcsec) of a point source at β = src, inside the field: local minima of
// |θ − α(θ) − β| on a grid, refined by Newton's method with the numerical Jacobian A. Returns
// [{ x, y, mu }] (mu = 1/det A, negative for images of odd parity), brightest first.
export function images(P, src, G = 140) {
  const h = FOV / G, res = new Float64Array((G + 1) * (G + 1));
  const at = (i, j) => [-FOV / 2 + i * h, -FOV / 2 + j * h];
  const miss = (x, y) => { const [ax, ay] = deflect(P, x, y); return [x - ax - src[0], y - ay - src[1]]; };
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) res[j * (G + 1) + i] = Math.hypot(...miss(...at(i, j)));
  const jac = (x, y) => {
    const d = 1e-5, [a1, b1] = deflect(P, x + d, y), [a0, b0] = deflect(P, x - d, y), [a2, b2] = deflect(P, x, y + d), [a3, b3] = deflect(P, x, y - d);
    return [1 - (a1 - a0) / (2 * d), -(a2 - a3) / (2 * d), -(b1 - b0) / (2 * d), 1 - (b2 - b3) / (2 * d)];
  };
  const out = [];
  for (let j = 1; j < G; j++) for (let i = 1; i < G; i++) {
    const r = res[j * (G + 1) + i];
    if (r > 4 * h) continue;
    let local = true;
    for (let dj = -1; dj <= 1 && local; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && res[(j + dj) * (G + 1) + i + di] < r) { local = false; break; }
    if (!local) continue;
    let [x, y] = at(i, j);
    for (let k = 0; k < 40; k++) {
      const [fx, fy] = miss(x, y), [a, b, c, d] = jac(x, y), det = a * d - b * c;
      if (!isFinite(det) || Math.abs(det) < 1e-12) break;
      const sx = (d * fx - b * fy) / det, sy = (a * fy - c * fx) / det, L = Math.hypot(sx, sy), damp = L > 0.2 ? 0.2 / L : 1;
      x -= sx * damp; y -= sy * damp;
      if (L < 1e-11) break;
    }
    if (Math.hypot(...miss(x, y)) > 1e-7 || Math.hypot(x, y) < 1e-3 || Math.abs(x) > FOV / 2 || Math.abs(y) > FOV / 2) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-4)) continue;
    const [a, b, c, d] = jac(x, y);
    out.push({ x, y, mu: 1 / (a * d - b * c) });
  }
  return out.sort((p, q) => Math.abs(q.mu) - Math.abs(p.mu));
}
