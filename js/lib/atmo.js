// Atmospheric optics: halos from hexagonal ice crystals (Monte-Carlo ray tracing with Fresnel
// reflection and dispersion) and rainbows, glories, fogbows and coronas from water drops (exact
// Lorenz–Mie theory). Pure functions, so the heavy parts run in the compute workers.
import { uniform } from './random.js';
import { cmf } from './color.js';
import { nWater } from './underwater.js';

const D2R = Math.PI / 180;

// Refractive index of ice Ih (Cauchy fit to Warren & Brandt 2008: 1.3194 at 400 nm, 1.3098 at
// 589 nm, 1.3074 at 700 nm) and of water (the underwater laboratory's fit), λ in nm.
export const nIce = (lam) => 1.3016 + 2851 / (lam * lam);
export { nWater };

// Minimum deviation of a prism of apex angle A (rad) and index n: D = 2 asin(n sin(A/2)) − A.
export const minDeviation = (A, n) => 2 * Math.asin(Math.min(1, n * Math.sin(A / 2))) - A;

// Primary (k = 1) and secondary (k = 2) rainbow: the deviation is stationary where
// cos²i = (n² − 1)/(k(k + 2)); the bow is seen at 180° − D from the antisolar point (k = 1) or at
// D − 180° (k = 2). Returns the bow's radius around the antisolar point in degrees.
export function rainbowAngle(n, k = 1) {
  const ci = Math.sqrt((n * n - 1) / (k * (k + 2))), i = Math.acos(ci), r = Math.asin(Math.sin(i) / n);
  const D = k * Math.PI + 2 * i - 2 * (k + 1) * r;
  return Math.abs(180 - ((D / D2R) % 360));
}

// Parhelion (sundog) for horizontal plates with the Sun at elevation h (rad): rays cross a 60°
// prism whose edge is vertical, so the effective index is n' = √(n² − sin²h)/cos h. Returns the
// azimuth offset and the angular distance from the Sun, both in degrees.
export function parhelion(n, h) {
  const ne = Math.sqrt(n * n - Math.sin(h) ** 2) / Math.cos(h);
  if (ne * Math.sin(Math.PI / 6) >= 1) return null;
  const daz = minDeviation(Math.PI / 3, ne);
  const rho = Math.acos(Math.cos(h) ** 2 * Math.cos(daz) + Math.sin(h) ** 2);
  return { daz: daz / D2R, rho: rho / D2R };
}

// Circumzenithal arc: light enters a horizontal plate's top face and leaves a side face (90°
// prism). It exists while the Sun is below 32.2° (n = 1.31); its elevation is
// arccos(√(n² − cos²h)) measured from the zenith down, i.e. the arc lies 90° − that above the horizon.
export function circumzenithal(n, h) {
  const s = Math.sqrt(n * n - Math.cos(h) ** 2);
  if (s >= 1) return null;
  return { elevation: 90 - Math.acos(s) / D2R };
}

// ── Ice crystals ──────────────────────────────────────────────────────────────
// A hexagonal prism with apothem 1 and half-height c (c < 1: plate, c > 1: column): six side faces
// and two basal faces, each a plane n·p = d.
function prism(c) {
  const faces = [];
  for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; faces.push({ n: [Math.cos(a), Math.sin(a), 0], d: 1, area: (2 / Math.sqrt(3)) * 2 * c, k }); }
  faces.push({ n: [0, 0, 1], d: c, area: 2 * Math.sqrt(3), k: 6 }, { n: [0, 0, -1], d: c, area: 2 * Math.sqrt(3), k: 7 });
  return faces;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// unpolarised Fresnel reflectance for an incidence cosine ci, from index n1 into n2
function fresnel(ci, n1, n2) {
  const s = (n1 / n2) ** 2 * (1 - ci * ci);
  if (s >= 1) return 1;
  const ct = Math.sqrt(1 - s), rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return (rs * rs + rp * rp) / 2;
}
// refract direction d through a surface of normal m (pointing against d), eta = n1/n2
function refract(d, m, eta) {
  const ci = -dot(d, m), k = 1 - eta * eta * (1 - ci * ci);
  const f = eta * ci - Math.sqrt(k);
  return [eta * d[0] + f * m[0], eta * d[1] + f * m[1], eta * d[2] + f * m[2]];
}
const reflect = (d, m) => { const k = 2 * dot(d, m); return [d[0] - k * m[0], d[1] - k * m[1], d[2] - k * m[2]]; };

// A uniformly random point on a face of the prism.
function pointOn(f, c, rng) {
  if (f.k < 6) {
    const t = [-f.n[1], f.n[0], 0], u = (rng() - 0.5) * (2 / Math.sqrt(3)), z = (rng() * 2 - 1) * c;
    return [f.n[0] + u * t[0], f.n[1] + u * t[1], z];
  }
  for (;;) {
    const x = (rng() * 2 - 1) * (2 / Math.sqrt(3)), y = rng() * 2 - 1;
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) { const a = (k * Math.PI) / 3; ok = x * Math.cos(a) + y * Math.sin(a) <= 1; }
    if (ok) return [x, y, f.n[2] * c];
  }
}

// Trace one ray of direction d (crystal frame) through the prism. Fresnel reflection and
// transmission are chosen at random with their probabilities, so each ray carries unit weight.
// Returns the exit direction (crystal frame) and the path (list of points) or null if it is lost.
function traceCrystal(faces, c, d, n, rng, keepPath = false) {
  let tot = 0;
  const w = faces.map((f) => { const a = Math.max(0, -dot(f.n, d)) * f.area; tot += a; return a; });
  let r = rng() * tot, fi = 0;
  while (fi < 7 && r > w[fi]) r -= w[fi++];
  const f0 = faces[fi];
  let p = pointOn(f0, c, rng);
  const path = keepPath ? [p] : null;
  const ci = -dot(d, f0.n);
  if (rng() < fresnel(ci, 1, n)) return { out: reflect(d, f0.n), path, proj: tot };
  let dir = refract(d, f0.n, 1 / n);
  for (let bounce = 0; bounce < 14; bounce++) {
    let tmin = Infinity, hit = null;
    for (const f of faces) {
      const dn = dot(f.n, dir);
      if (dn <= 1e-12) continue;
      const tt = (f.d - dot(f.n, p)) / dn;
      if (tt > 1e-9 && tt < tmin) { tmin = tt; hit = f; }
    }
    if (!hit) return null;
    p = [p[0] + tmin * dir[0], p[1] + tmin * dir[1], p[2] + tmin * dir[2]];
    if (keepPath) path.push(p);
    const cosi = dot(dir, hit.n);
    if (rng() < fresnel(cosi, n, 1)) dir = reflect(dir, hit.n);
    else return { out: refract(dir, [-hit.n[0], -hit.n[1], -hit.n[2]], n), path, proj: tot };
  }
  return null;
}

// Rotation matrix (rows = world axes expressed in the crystal frame, i.e. world = R · crystal) for
// the three orientation families. `tilt` is the RMS wobble of oriented crystals (rad).
function orientation(kind, tilt, rng) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  let axis;
  if (kind === 'random') {
    const z = rng() * 2 - 1, ph = rng() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    axis = [s * Math.cos(ph), s * Math.sin(ph), z];
  } else if (kind === 'plate') {
    const tt = Math.abs(gauss() * tilt), ph = rng() * 2 * Math.PI;
    axis = [Math.sin(tt) * Math.cos(ph), Math.sin(tt) * Math.sin(ph), Math.cos(tt)];
  } else {
    const az = rng() * 2 * Math.PI, el = gauss() * tilt;
    axis = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  }
  // any vector not parallel to the axis, then a random spin about the axis
  const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [ref[1] * axis[2] - ref[2] * axis[1], ref[2] * axis[0] - ref[0] * axis[2], ref[0] * axis[1] - ref[1] * axis[0]];
  const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  let v = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  const sp = rng() * 2 * Math.PI, cs = Math.cos(sp), sn = Math.sin(sp);
  const ex = [cs * u[0] + sn * v[0], cs * u[1] + sn * v[1], cs * u[2] + sn * v[2]];
  v = [axis[1] * ex[2] - axis[2] * ex[1], axis[2] * ex[0] - axis[0] * ex[2], axis[0] * ex[1] - axis[1] * ex[0]];
  return [ex, v, axis]; // crystal x, y, z axes in world coordinates
}
const toCrystal = (R, w) => [dot(R[0], w), dot(R[1], w), dot(R[2], w)];
const toWorld = (R, c) => [R[0][0] * c[0] + R[1][0] * c[1] + R[2][0] * c[2], R[0][1] * c[0] + R[1][1] * c[1] + R[2][1] * c[2], R[0][2] * c[0] + R[1][2] * c[1] + R[2][2] * c[2]];

export const HALO_FOV = 66; // degrees from the Sun shown in the halo sky view
export const LAM0 = 400, LAM1 = 700;

// Sky position of a direction v (unit, world frame, z up) in the halo view: azimuthal equidistant
// around the Sun s, zenith up. Returns [x, y] in degrees.
export function skyXY(v, s) {
  const up = [-s[0] * s[2], -s[1] * s[2], 1 - s[2] * s[2]], ul = Math.hypot(...up);
  const e_up = up.map((x) => x / ul), e_r = [s[1] * e_up[2] - s[2] * e_up[1], s[2] * e_up[0] - s[0] * e_up[2], s[0] * e_up[1] - s[1] * e_up[0]];
  const rho = Math.acos(Math.max(-1, Math.min(1, dot(v, s)))) / D2R, a = Math.atan2(dot(v, e_r), dot(v, e_up));
  return [rho * Math.sin(a), rho * Math.cos(a)];
}
// The inverse: sky direction of a view point [x, y] (degrees)
export function skyDir(x, y, s) {
  const up = [-s[0] * s[2], -s[1] * s[2], 1 - s[2] * s[2]], ul = Math.hypot(...up);
  const e_up = up.map((q) => q / ul), e_r = [s[1] * e_up[2] - s[2] * e_up[1], s[2] * e_up[0] - s[0] * e_up[2], s[0] * e_up[1] - s[1] * e_up[0]];
  const rho = Math.hypot(x, y) * D2R, a = Math.atan2(x, y), sr = Math.sin(rho);
  return [0, 1, 2].map((i) => Math.cos(rho) * s[i] + sr * (Math.cos(a) * e_up[i] + Math.sin(a) * e_r[i]));
}

// Monte-Carlo halo image: N×N bins of XYZ over ±HALO_FOV degrees around the Sun. `mix` gives the
// fractions of randomly oriented, plate-oriented and column-oriented crystals; `cPlate` and
// `cColumn` their half-heights (apothem 1); `h` the solar elevation (rad); `tilt` the RMS wobble.
export function haloImage({ N, rays, seed, h, mix, cPlate = 0.15, cColumn = 2.5, tilt = 0.5 * D2R }) {
  const rng = uniform(seed), s = [Math.cos(h), 0, Math.sin(h)], din = [-s[0], -s[1], -s[2]];
  const X = new Float32Array(N * N), Y = new Float32Array(N * N), Z = new Float32Array(N * N);
  const plate = prism(cPlate), column = prism(cColumn), cum = [mix.random, mix.random + mix.plate];
  const tot = mix.random + mix.plate + mix.column || 1;
  let kept = 0;
  for (let i = 0; i < rays; i++) {
    const u = rng() * tot, kind = u < cum[0] ? 'random' : u < cum[1] ? 'plate' : 'column';
    const isPlate = kind === 'plate' || (kind === 'random' && rng() < 0.5);
    const faces = isPlate ? plate : column, c = isPlate ? cPlate : cColumn;
    const R = orientation(kind, tilt, rng), lam = LAM0 + rng() * (LAM1 - LAM0);
    const r = traceCrystal(faces, c, toCrystal(R, din), nIce(lam), rng);
    if (!r) continue;
    const o = toWorld(R, r.out), v = [-o[0], -o[1], -o[2]];
    const [x, y] = skyXY(v, s);
    const ix = Math.floor(((x / HALO_FOV + 1) / 2) * N), iy = Math.floor(((1 - y / HALO_FOV) / 2) * N);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
    // weight by the crystal's projected area (bigger crystals intercept more sunlight)
    const w = r.proj / (isPlate ? 2 * Math.sqrt(3) : 4.6 * cColumn), cm = cmf(lam), k = iy * N + ix;
    X[k] += w * cm[0]; Y[k] += w * cm[1]; Z[k] += w * cm[2]; kept++;
  }
  return { X, Y, Z, kept };
}

// ── Water drops: Lorenz–Mie theory ────────────────────────────────────────────
// Scattering amplitudes S1, S2 of a sphere of size parameter x = 2πa/λ and real relative index m
// at the cosines mu (Bohren & Huffman's BHMIE, with the logarithmic derivative D_n by downward
// recurrence). Returns the unpolarised intensity i(θ) = (|S1|² + |S2|²)/2 and the efficiencies.
export function mie(x, m, mu) {
  const nstop = Math.round(x + 4 * Math.cbrt(x) + 2), mx = m * x, nmx = Math.round(Math.max(nstop, mx) + 16);
  const D = new Float64Array(nmx + 1);
  for (let n = nmx; n > 0; n--) D[n - 1] = n / mx - 1 / (D[n] + n / mx);
  const na = mu.length;
  const s1r = new Float64Array(na), s1i = new Float64Array(na), s2r = new Float64Array(na), s2i = new Float64Array(na);
  const pi0 = new Float64Array(na), pi1 = new Float64Array(na).fill(1);
  let psi0 = Math.cos(x), psi1 = Math.sin(x), chi0 = -Math.sin(x), chi1 = Math.cos(x);
  let qext = 0, qsca = 0;
  for (let n = 1; n <= nstop; n++) {
    const psi = ((2 * n - 1) * psi1) / x - psi0, chi = ((2 * n - 1) * chi1) / x - chi0;
    // a_n = (A ψ_n − ψ_{n−1}) / (A ξ_n − ξ_{n−1}) with ξ = ψ − iχ, A = D_n/m + n/x (b_n: m D_n + n/x)
    const A = D[n] / m + n / x, B = m * D[n] + n / x;
    const ar = A * psi - psi1, ai = -(A * chi - chi1), br = B * psi - psi1, bi = -(B * chi - chi1);
    const ad = ar * ar + ai * ai, bd = br * br + bi * bi;
    const anr = (ar * ar) / ad, ani = -(ar * ai) / ad, bnr = (br * br) / bd, bni = -(br * bi) / bd;
    qext += (2 * n + 1) * (anr + bnr);
    qsca += (2 * n + 1) * (anr * anr + ani * ani + bnr * bnr + bni * bni);
    const fn = (2 * n + 1) / (n * (n + 1));
    for (let j = 0; j < na; j++) {
      const p = pi1[j], tau = n * mu[j] * p - (n + 1) * pi0[j];
      s1r[j] += fn * (anr * p + bnr * tau); s1i[j] += fn * (ani * p + bni * tau);
      s2r[j] += fn * (anr * tau + bnr * p); s2i[j] += fn * (ani * tau + bni * p);
      const pn = (((2 * n + 1) * mu[j] * p) - (n + 1) * pi0[j]) / n;
      pi0[j] = p; pi1[j] = pn;
    }
    psi0 = psi1; psi1 = psi; chi0 = chi1; chi1 = chi;
  }
  const I = new Float64Array(na);
  for (let j = 0; j < na; j++) I[j] = (s1r[j] ** 2 + s1i[j] ** 2 + s2r[j] ** 2 + s2i[j] ** 2) / 2;
  return { I, qext: (2 / (x * x)) * qext, qsca: (2 / (x * x)) * qsca };
}

// Wavelengths used for the drop views, and the scattering-angle grids: around the Sun (corona,
// θ = 0…CORONA_MAX) and around the antisolar point (glory, fogbow, rainbows, θ = 180° − 0…ANTI_MAX).
export const DROP_LAMS = Array.from({ length: 16 }, (_, i) => 405 + i * 20);
export const CORONA_MAX = 20, ANTI_MAX = 60, CORONA_STEP = 0.05, ANTI_STEP = 0.1;
export const coronaAngles = () => Array.from({ length: Math.round(CORONA_MAX / CORONA_STEP) + 1 }, (_, i) => i * CORONA_STEP);
export const antiAngles = () => Array.from({ length: Math.round(ANTI_MAX / ANTI_STEP) + 1 }, (_, i) => i * ANTI_STEP);

// Angular profiles of one wavelength for a narrow size distribution (three radii a(1 ∓ w), a with
// weights ¼, ½, ¼), normalised per drop cross-section and solid angle: I(θ)/(k²πa²).
export function dropProfiles(lam, a, w) {
  const m = nWater(lam), k = (2 * Math.PI) / (lam * 1e-3); // a in µm, k in 1/µm
  const cor = coronaAngles(), anti = antiAngles();
  const mu = new Float64Array(cor.length + anti.length);
  cor.forEach((th, i) => (mu[i] = Math.cos(th * D2R)));
  anti.forEach((th, i) => (mu[cor.length + i] = Math.cos(Math.PI - th * D2R)));
  const out = new Float64Array(mu.length);
  const radii = w > 0 ? [[a * (1 - w), 0.25], [a, 0.5], [a * (1 + w), 0.25]] : [[a, 1]];
  let qsca = 0;
  for (const [r, wt] of radii) {
    const res = mie(k * r, m, mu), norm = 1 / (k * k * Math.PI * r * r);
    for (let j = 0; j < mu.length; j++) out[j] += wt * res.I[j] * norm;
    qsca += wt * res.qsca;
  }
  return { corona: out.slice(0, cor.length), anti: out.slice(cor.length), qsca };
}

// Blur a profile sampled every `step` degrees by the solar disc (radius 0.266°): the 1-D kernel is
// the disc's chord length, √(R² − x²).
export function sunSmear(p, step) {
  const R = 0.266, h = Math.ceil(R / step), ker = [];
  let s = 0;
  for (let i = -h; i <= h; i++) { const v = Math.sqrt(Math.max(0, R * R - (i * step) ** 2)); ker.push(v); s += v; }
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) {
    let a = 0, ws = 0;
    for (let k = -h; k <= h; k++) { const j = i + k; if (j < 0 || j >= p.length) continue; a += p[j] * ker[k + h]; ws += ker[k + h]; }
    out[i] = a / ws;
  }
  return s ? out : p;
}

// XYZ along a profile from per-wavelength profiles (rows of `prof`, one per DROP_LAMS entry),
// weighting each wavelength by sunlight (a 5800 K blackbody) and the colour-matching functions.
export function profileXYZ(prof) {
  const n = prof[0].length, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  DROP_LAMS.forEach((lam, li) => {
    const l = lam * 1e-9, sun = 1 / (l ** 5 * (Math.exp(1.4388e-2 / (l * 5800)) - 1)) / 1e31, c = cmf(lam);
    for (let i = 0; i < n; i++) { const v = prof[li][i] * sun; X[i] += v * c[0]; Y[i] += v * c[1]; Z[i] += v * c[2]; }
  });
  return { X, Y, Z };
}
