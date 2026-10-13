// Polarisation: Stokes vectors and Mueller matrices, Fresnel reflection/transmission in Mueller
// form, a single-scattering Rayleigh sky (radiance and polarisation), and a polarised render of a
// lake seen through a rotating linear polariser.
//
// Conventions. A Stokes vector S = [I, Q, U, V] is referred to a transverse frame (e1, e2) with
// e1 × e2 = k̂ (propagation direction): Q = I(e1) − I(e2), U = I(+45°) − I(−45°), V > 0 for
// right-handed circular light as seen by the receiver. Angles of optical elements are measured
// from e1 towards e2.
import { spectralBasis, linspace, gamutClip } from './color.js';

// ── Mueller algebra ─────────────────────────────────────────────────────────────────────────
export const mmul = (A, B) => A.map((r) => [0, 1, 2, 3].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j] + r[3] * B[3][j]));
export const mapply = (M, S) => M.map((r) => r[0] * S[0] + r[1] * S[1] + r[2] * S[2] + r[3] * S[3]);

// Rotation of the reference frame by ψ (new e1 = cosψ e1 + sinψ e2).
export function rotator(psi) {
  const c = Math.cos(2 * psi), s = Math.sin(2 * psi);
  return [[1, 0, 0, 0], [0, c, s, 0], [0, -s, c, 0], [0, 0, 0, 1]];
}

// Linear diattenuator (polariser) with principal intensity transmittances k1 (along the axis) and
// k2 (across it), axis at angle θ. Ideal polariser: k1 = 1, k2 = 0.
export function polariser(theta, k1 = 1, k2 = 0) {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta), a = (k1 + k2) / 2, b = (k1 - k2) / 2, g = Math.sqrt(k1 * k2);
  return [
    [a, b * c, b * s, 0],
    [b * c, a * c * c + g * s * s, (a - g) * c * s, 0],
    [b * s, (a - g) * c * s, a * s * s + g * c * c, 0],
    [0, 0, 0, g],
  ];
}

// Linear retarder of retardance δ (slow-axis phase lag) with its fast axis at angle θ.
export function retarder(delta, theta) {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta), cd = Math.cos(delta), sd = Math.sin(delta);
  return [
    [1, 0, 0, 0],
    [0, c * c + s * s * cd, c * s * (1 - cd), -s * sd],
    [0, c * s * (1 - cd), s * s + c * c * cd, c * sd],
    [0, s * sd, -c * sd, cd],
  ];
}

// Degree of polarisation, azimuth ψ of the polarisation ellipse and ellipticity angle χ.
export function ellipse(S) {
  const Ip = Math.hypot(S[1], S[2], S[3]);
  return { dop: S[0] > 0 ? Ip / S[0] : 0, psi: 0.5 * Math.atan2(S[2], S[1]), chi: Ip > 0 ? 0.5 * Math.asin(Math.max(-1, Math.min(1, S[3] / Ip))) : 0, Ip };
}

// ── Fresnel equations ───────────────────────────────────────────────────────────────────────
// Amplitude coefficients at a dielectric interface n1 → n2, incidence angle θ1 (rad), for the
// field triad (ŝ, p̂ = ŝ × k̂, k̂): rp = rs = (n1 − n2)/(n1 + n2) up to sign at normal incidence.
// Returns null beyond the critical angle (total internal reflection, not needed here).
export function fresnelAmp(n1, n2, th1) {
  const s2 = (n1 / n2) * Math.sin(th1);
  if (s2 >= 1) return null;
  const c1 = Math.cos(th1), c2 = Math.sqrt(1 - s2 * s2);
  const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2), rp = (n2 * c1 - n1 * c2) / (n2 * c1 + n1 * c2);
  return { rs, rp, Rs: rs * rs, Rp: rp * rp, Ts: 1 - rs * rs, Tp: 1 - rp * rp, th2: Math.asin(s2) };
}

export const brewster = (n1, n2) => Math.atan2(n2, n1);

// Mueller matrices of reflection and transmission in the frames (ŝ, k̂ × ŝ) before and after.
export function reflectionMueller(n1, n2, th) {
  const f = fresnelAmp(n1, n2, th);
  const a = (f.Rs + f.Rp) / 2, b = (f.Rs - f.Rp) / 2, c = f.rs * f.rp;
  return [[a, b, 0, 0], [b, a, 0, 0], [0, 0, c, 0], [0, 0, 0, c]];
}
export function transmissionMueller(n1, n2, th) {
  const f = fresnelAmp(n1, n2, th);
  const a = (f.Ts + f.Tp) / 2, b = (f.Ts - f.Tp) / 2, c = Math.sqrt(f.Ts * f.Tp);
  return [[a, b, 0, 0], [b, a, 0, 0], [0, 0, c, 0], [0, 0, 0, c]];
}

// ── Rayleigh sky ────────────────────────────────────────────────────────────────────────────
// Rayleigh optical depth of the whole atmosphere at sea level, λ in nm (Hansen & Travis 1974).
export function rayleighTau(lam) {
  const l = lam / 1000, l2 = 1 / (l * l);
  return 0.008569 * l2 * l2 * (1 + 0.0113 * l2 + 0.00013 * l2 * l2);
}

// Single-scattering degree of polarisation at scattering angle γ, scaled by the peak value pmax
// (pure Rayleigh with the depolarisation factor of air gives 0.94; real skies reach 0.7–0.8
// because of multiple scattering, aerosols and ground reflection).
export const rayleighDoP = (cosG, pmax = 1) => pmax * (1 - cosG * cosG) / (1 + cosG * cosG);

// Diffuse radiance seen from the ground in direction μv = cos(zenith angle) of a homogeneous
// single-scattering slab of optical depth τ lit by a sun at μs, per unit solar irradiance F0 and
// per unit Rayleigh phase function P(γ) = ¾(1 + cos²γ) (Chandrasekhar 1950):
//   L = F0 P(γ)/4π · μs/(μs − μv) · (e^{−τ/μs} − e^{−τ/μv}).
export function slabFactor(tau, mus, muv) {
  if (Math.abs(mus - muv) < 1e-6) return (tau / mus) * Math.exp(-tau / mus) / (4 * Math.PI);
  return (mus / (mus - muv)) * (Math.exp(-tau / mus) - Math.exp(-tau / muv)) / (4 * Math.PI);
}

// narrow spectra (deep water) fall outside sRGB: desaturate towards grey at equal luminance
const clipRow = (A, o) => { const c = gamutClip([A[o], A[o + 1], A[o + 2]]); A[o] = c[0]; A[o + 1] = c[1]; A[o + 2] = c[2]; };

const LAMS = linspace(400, 700, 16);
const BASIS = spectralBasis(LAMS);
// Solar spectrum outside the atmosphere approximated by a 5778 K black body, normalised to 1 at 550 nm.
const planck = (l) => 1 / (l ** 5 * (Math.exp(1.4388e7 / (l * 5778)) - 1));
const SUN = LAMS.map((l) => planck(l) / planck(550));
// Pure-water absorption coefficient (m⁻¹), Pope & Fry (1997) rounded, 400–700 nm.
const AW_L = [400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600, 620, 640, 660, 680, 700];
const AW = [0.0066, 0.0045, 0.0064, 0.0092, 0.0150, 0.0204, 0.0474, 0.0507, 0.0619, 0.0896, 0.2224, 0.2755, 0.317, 0.41, 0.455, 0.624];
export const waterAbsorption = (lam) => {
  const t = Math.min(AW_L.length - 1.001, Math.max(0, (lam - 400) / 20)), i = Math.floor(t), f = t - i;
  return AW[i] * (1 - f) + AW[i + 1] * f;
};

// Linear-RGB sky radiance factor G(μv) (to be multiplied by the phase function ¾(1+cos²γ)) and
// linear-RGB direct sun radiance attenuated along the slant path, for a sun at elevation e.
export function skyTables(sunEl, N = 512) {
  const mus = Math.max(Math.sin(sunEl), 0.02), taus = LAMS.map(rayleighTau);
  const G = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const muv = Math.max(1e-3, i / (N - 1));
    for (let k = 0; k < LAMS.length; k++) {
      const v = SUN[k] * slabFactor(taus[k], mus, muv);
      for (let c = 0; c < 3; c++) G[i * 3 + c] += v * BASIS[k][c];
    }
    clipRow(G, i * 3);
  }
  const sunT = [0, 0, 0], skyE = [0, 0, 0];
  for (let k = 0; k < LAMS.length; k++) {
    const d = SUN[k] * Math.exp(-taus[k] / mus);
    // irradiance on the ground: direct + diffuse (half of the singly scattered flux goes down)
    const e = mus * SUN[k] * Math.exp(-taus[k] / mus) + 0.5 * mus * SUN[k] * (1 - Math.exp(-taus[k] / mus));
    for (let c = 0; c < 3; c++) { sunT[c] += d * BASIS[k][c]; skyE[c] += e * BASIS[k][c]; }
  }
  return { N, G, sunT, skyE, mus, taus };
}
const lookupG = (T, muv, out) => {
  const t = Math.max(0, Math.min(T.N - 1.001, muv * (T.N - 1))), i = Math.floor(t), f = t - i, a = i * 3, b = a + 3;
  out[0] = T.G[a] * (1 - f) + T.G[b] * f; out[1] = T.G[a + 1] * (1 - f) + T.G[b + 1] * f; out[2] = T.G[a + 2] * (1 - f) + T.G[b + 2] * f;
};

// Absorption by coloured dissolved organic matter (CDOM): a_g(λ) = a_g(440) e^{−0.015(λ−440)}
// (Bricaud et al. 1981), the usual reason why lakes look green or brown rather than blue.
export const cdomAbsorption = (lam, ag440) => ag440 * Math.exp(-0.015 * (lam - 440));

// Spectral transmission of a water path ℓ (m) for a sun-lit grey seabed: linear-RGB weights of
// E_d(λ)·exp(−a(λ)ℓ) on a table over ℓ ∈ [0, Lmax], with a = a_water + a_CDOM.
function waterTable(mus, ag, N = 256, Lmax = 40) {
  const T = new Float32Array(N * 3), taus = LAMS.map(rayleighTau);
  for (let i = 0; i < N; i++) {
    const l = (i / (N - 1)) * Lmax;
    for (let k = 0; k < LAMS.length; k++) {
      const e = (mus * Math.exp(-taus[k] / mus) + 0.5 * mus * (1 - Math.exp(-taus[k] / mus))) * SUN[k] * Math.exp(-(waterAbsorption(LAMS[k]) + cdomAbsorption(LAMS[k], ag)) * l);
      for (let c = 0; c < 3; c++) T[i * 3 + c] += e * BASIS[k][c];
    }
    clipRow(T, i * 3);
  }
  return { T, N, Lmax };
}

// Sky radiance (linear RGB, 'out') and polarisation for a view direction r (unit, z up) and a sun
// direction s. Returns the degree of polarisation; the E-vector is perpendicular to the plane
// containing r and s.
export function skyRadiance(T, r, s, pmax, out) {
  const cg = r[0] * s[0] + r[1] * s[1] + r[2] * s[2];
  lookupG(T, Math.max(r[2], 0), out);
  const ph = 0.75 * (1 + cg * cg);
  out[0] *= ph; out[1] *= ph; out[2] *= ph;
  return rayleighDoP(cg, pmax);
}

// ── Lake scene ──────────────────────────────────────────────────────────────────────────────
// integer hash of a lattice cell → [0, 1)
const hash = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Pebble seabed: Worley cells with per-stone albedo (linear RGB) and dark gaps.
function seabed(x, y, out) {
  const sc = 7, X = x * sc, Y = y * sc, ix = Math.floor(X), iy = Math.floor(Y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h0 = hash(ix + i, iy + j), cx = ix + i + 0.15 + 0.7 * h0, cy = iy + j + 0.15 + 0.7 * ((h0 * 4096) % 1);
    const d = Math.sqrt((X - cx) * (X - cx) + (Y - cy) * (Y - cy));
    if (d < d1) { d2 = d1; d1 = d; id = (h0 * 65536) % 1; } else if (d < d2) d2 = d;
  }
  const gap = Math.min(1, Math.max(0, (d2 - d1) * 6)), sh = 0.55 + 0.45 * gap;
  const tone = id < 0.35 ? [0.32, 0.27, 0.2] : id < 0.7 ? [0.22, 0.21, 0.19] : id < 0.9 ? [0.36, 0.3, 0.26] : [0.16, 0.15, 0.15];
  const v = (0.8 + 0.4 * ((id * 97) % 1)) * sh;
  out[0] = tone[0] * v; out[1] = tone[1] * v; out[2] = tone[2] * v;
}

// Render the lake through a polariser. o = { W, H, hfov (rad), pitch (rad, negative = down),
// height (m), sunEl, sunAz (rad, azimuth from the view direction, clockwise), pmax, n (water),
// depth (m), cdom (a_g(440), m⁻¹), ripple (RMS slope), pol (bool), polAngle (rad, from image horizontal), k1, k2 }.
// Returns { rgb: Float32Array W·H·3 (linear, exposure-normalised), stats }.
// The per-pixel loop is written with scalars only (no temporary vectors): it runs ~10⁵ times.
export function renderLake(o) {
  const { W, H } = o, n = o.n || 1.333, pmax = o.pmax, pol = !!o.pol;
  const T = skyTables(o.sunEl), WT = waterTable(T.mus, o.cdom || 0), G = T.G, GN = T.N, WTT = WT.T;
  const sx = Math.cos(o.sunEl) * Math.sin(o.sunAz), sy = Math.cos(o.sunEl) * Math.cos(o.sunAz), sz = Math.sin(o.sunEl);
  // camera: forward (0, cos p, sin p), right (1, 0, 0), up (0, −sin p, cos p)
  const fy = Math.cos(o.pitch), fz = Math.sin(o.pitch), uy = -fz, uz = fy;
  const tx = Math.tan(o.hfov / 2), ty = (tx * H) / W, pixA = (2 * tx) / W;
  const sunR = 0.0047, sunCos = Math.cos(sunR), sunK = 1 / (Math.PI * sunR * sunR);
  const sunL0 = T.sunT[0] * sunK, sunL1 = T.sunT[1] * sunK, sunL2 = T.sunT[2] * sunK;
  // ripples: a few directional sine waves (m), slopes scaled to the requested RMS slope
  const waves = [[3.1, 0.6, 0.0], [5.3, -1.1, 1.7], [8.7, 2.3, 4.1], [13.1, -0.4, 2.2], [21, 1.4, 0.9]].map(([k, dir, ph], i) => {
    const amp = 1 / (k * Math.pow(1.6, i));
    return { kx: k * Math.cos(dir), ky: k * Math.sin(dir), k, ph, amp };
  });
  const slope0 = Math.sqrt(waves.reduce((a, w) => a + 0.5 * (w.amp * w.k) ** 2, 0));
  waves.forEach((w) => (w.amp *= (o.ripple || 0) / slope0));
  const NW = waves.length, wkx = waves.map((w) => w.kx), wky = waves.map((w) => w.ky), wk = waves.map((w) => w.k), wph = waves.map((w) => w.ph), wamp = waves.map((w) => w.amp);
  const k1 = o.k1 ?? 0.8, k2 = o.k2 ?? 0.002, kp = (k1 + k2) / 2, km = (k1 - k2) / 2;
  // polariser axis in the camera: image horizontal rotated by polAngle (a fixed 3-D vector)
  const ca = Math.cos(o.polAngle || 0), sa = Math.sin(o.polAngle || 0), ax = ca, ay = sa * uy, az = sa * uz;
  // sun transmission into the water (unpolarised) and the refracted sun path cosine
  const cs = Math.sin(o.sunEl), ss2 = 1 - cs * cs, cw = Math.sqrt(1 - ss2 / (n * n));
  const rsS = (cs - n * cw) / (cs + n * cw), rpS = (n * cs - cw) / (n * cs + cw), tIn = 1 - (rsS * rsS + rpS * rpS) / 2;
  const depth = o.depth, sunW = cw, bed = [0, 0, 0];
  const rgb = new Float32Array(W * H * 3), I0 = new Float32Array(W * H);
  let glare = 0, glareP = 0, lg = 0, cGlare = 1;
  const ic = W >> 1, jc = H >> 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = ((i + 0.5) / W * 2 - 1) * tx, py = (1 - (j + 0.5) / H * 2) * ty;
    let vx = px, vy = fy + py * uy, vz = fz + py * uz;
    const vl = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz); vx *= vl; vy *= vl; vz *= vl;
    let R, Gc, B, unpol;
    if (vz > 0) {
      // sky: E-vector ⟂ (sun, view) plane. Frame e1 = s × v / |…|, e2 = k × e1 with k = −v.
      const cg = vx * sx + vy * sy + vz * sz;
      const t = Math.min(GN - 1.001, vz * (GN - 1)), ti = Math.floor(t), tf = t - ti, gi = ti * 3, ph = 0.75 * (1 + cg * cg);
      const L0 = (G[gi] * (1 - tf) + G[gi + 3] * tf) * ph, L1 = (G[gi + 1] * (1 - tf) + G[gi + 4] * tf) * ph, L2 = (G[gi + 2] * (1 - tf) + G[gi + 5] * tf) * ph;
      let f = 1;
      if (pol) {
        const P = (pmax * (1 - cg * cg)) / (1 + cg * cg);
        let e1x = sy * vz - sz * vy, e1y = sz * vx - sx * vz, e1z = sx * vy - sy * vx;
        const el = 1 / (Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1); e1x *= el; e1y *= el; e1z *= el;
        // e2 = (−v) × e1
        const e2x = -(vy * e1z - vz * e1y), e2y = -(vz * e1x - vx * e1z), e2z = -(vx * e1y - vy * e1x);
        const p1 = ax * e1x + ay * e1y + az * e1z, p2 = ax * e2x + ay * e2y + az * e2z, m = p1 * p1 + p2 * p2 || 1;
        f = kp + km * P * (p1 * p1 - p2 * p2) / m;
      }
      R = L0 * f; Gc = L1 * f; B = L2 * f; unpol = (L0 + L1 + L2) / 3;
      if (cg > sunCos) { const g = pol ? kp : 1; R += sunL0 * g; Gc += sunL1 * g; B += sunL2 * g; unpol += (sunL0 + sunL1 + sunL2) / 3; }
    } else {
      const t = o.height / -vz, X = t * vx, Y = t * vy;
      // surface normal from the ripple gradient; waves finer than the pixel footprint are averaged out
      const foot = (t * pixA) / Math.max(0.05, -vz);
      let gx = 0, gy = 0;
      for (let q = 0; q < NW; q++) {
        const kf = wk[q] * foot;
        if (kf > 3.7) continue;
        const c = wamp[q] * Math.exp(-0.5 * kf * kf) * Math.cos(wkx[q] * X + wky[q] * Y + wph[q]);
        gx += c * wkx[q]; gy += c * wky[q];
      }
      const nl = 1 / Math.sqrt(gx * gx + gy * gy + 1), nx = -gx * nl, ny = -gy * nl, nz = nl;
      const ci = Math.max(1e-4, -(vx * nx + vy * ny + vz * nz)), si2 = 1 - ci * ci, ct = Math.sqrt(1 - si2 / (n * n));
      const rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct), Rs = rs * rs, Rp = rp * rp;
      const a = (Rs + Rp) / 2, b = (Rs - Rp) / 2, cc = rs * rp;
      // reflected view direction (kept above the horizon)
      let rx = vx + 2 * ci * nx, ry = vy + 2 * ci * ny, rz = Math.max(0.002, vz + 2 * ci * nz);
      const rl = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz); rx *= rl; ry *= rl; rz *= rl;
      // ŝ = kIn × n with kIn = −r (perpendicular to the plane of incidence)
      let shx = -(ry * nz - rz * ny), shy = -(rz * nx - rx * nz), shz = -(rx * ny - ry * nx);
      const shl = Math.sqrt(shx * shx + shy * shy + shz * shz);
      if (shl < 1e-9) { shx = 1; shy = 0; shz = 0; } else { shx /= shl; shy /= shl; shz /= shl; }
      // skylight in direction r
      const cg = rx * sx + ry * sy + rz * sz;
      const tt = Math.min(GN - 1.001, rz * (GN - 1)), ti = Math.floor(tt), tf = tt - ti, gi = ti * 3, ph = 0.75 * (1 + cg * cg);
      const L0 = (G[gi] * (1 - tf) + G[gi + 3] * tf) * ph, L1 = (G[gi + 1] * (1 - tf) + G[gi + 4] * tf) * ph, L2 = (G[gi + 2] * (1 - tf) + G[gi + 5] * tf) * ph;
      const P = (pmax * (1 - cg * cg)) / (1 + cg * cg);
      // sky frame e⊥ = s × r, e2 = kIn × e⊥; rotation to (ŝ, kIn × ŝ): cos ψ = ŝ·e⊥, sin ψ = ŝ·e2
      let ex = sy * rz - sz * ry, ey = sz * rx - sx * rz, ez = sx * ry - sy * rx;
      const elen = 1 / (Math.sqrt(ex * ex + ey * ey + ez * ez) || 1); ex *= elen; ey *= elen; ez *= elen;
      const fx = -(ry * ez - rz * ey), fyy = -(rz * ex - rx * ez), fzz = -(rx * ey - ry * ex);
      const cps = shx * ex + shy * ey + shz * ez, sps = shx * fx + shy * fyy + shz * fzz;
      const Q1 = (cps * cps - sps * sps) * P, U1 = -2 * cps * sps * P;
      const S0r = a + b * Q1, S1r = b + a * Q1, S2r = cc * U1; // per unit sky radiance
      // camera-side frame (ŝ, k_out × ŝ) with k_out = −v; polariser projections
      let c2a = 1, s2a = 0;
      if (pol) {
        const e2x = -(vy * shz - vz * shy), e2y = -(vz * shx - vx * shz), e2z = -(vx * shy - vy * shx);
        const p1 = ax * shx + ay * shy + az * shz, p2 = ax * e2x + ay * e2y + az * e2z, m = p1 * p1 + p2 * p2 || 1;
        c2a = (p1 * p1 - p2 * p2) / m; s2a = (2 * p1 * p2) / m;
      }
      const fRef = pol ? kp * S0r + km * (S1r * c2a + S2r * s2a) : S0r;
      R = L0 * fRef; Gc = L1 * fRef; B = L2 * fRef;
      const refl = (L0 + L1 + L2) / 3;
      unpol = refl * S0r;
      // sun glint (unpolarised sun, Fresnel-polarised by the reflection)
      if (cg > sunCos) {
        const g = pol ? kp * a + km * b * c2a : a;
        R += sunL0 * g; Gc += sunL1 * g; B += sunL2 * g; unpol += ((sunL0 + sunL1 + sunL2) / 3) * a;
      }
      // light from the seabed: refracted view ray to depth D, sunlit pebbles, water absorption
      // on the way down (sun) and up (view), Fresnel transmission out (radiance ÷ n²)
      const tdx = (vx + ci * nx) / n - ct * nx, tdy = (vy + ci * ny) / n - ct * ny, dz = Math.max(0.05, -((vz + ci * nz) / n - ct * nz));
      seabed(X + (tdx / dz) * depth, Y + (tdy / dz) * depth, bed);
      const path = depth / dz + depth / sunW;
      const q = Math.min(WT.N - 1.001, (path / WT.Lmax) * (WT.N - 1)), qi = Math.floor(q), qf = q - qi, wi = qi * 3;
      const ta = 1 - a, tb = -b, tU = (ta * tIn) / (Math.PI * n * n);
      const fT = (pol ? kp + km * (tb / ta) * c2a : 1) * tU;
      const w0 = (WTT[wi] * (1 - qf) + WTT[wi + 3] * qf) * bed[0], w1 = (WTT[wi + 1] * (1 - qf) + WTT[wi + 4] * qf) * bed[1], w2 = (WTT[wi + 2] * (1 - qf) + WTT[wi + 5] * qf) * bed[2];
      R += w0 * fT; Gc += w1 * fT; B += w2 * fT;
      unpol += ((w0 + w1 + w2) / 3) * tU;
      glare += refl * fRef; glareP += refl * S0r;
      if (i === ic && j === jc) cGlare = fRef / (S0r * (pol ? kp : 1));
    }
    const k = j * W + i;
    rgb[k * 3] = R; rgb[k * 3 + 1] = Gc; rgb[k * 3 + 2] = B; I0[k] = unpol;
    lg += Math.log(1e-6 + Math.min(unpol, 50));
  }
  // exposure: metered on the unfiltered scene (log-average), with the filter factor compensated
  // as a TTL meter would, so rotating the polariser changes only the polarised content
  const key = Math.exp(lg / (W * H)), ff = pol ? kp : 1;
  const ex = 0.2 / (key * ff);
  for (let k = 0; k < rgb.length; k++) rgb[k] *= ex;
  // reflected-glare change through the polariser, relative to a neutral filter of the same factor
  return { rgb, W, H, stats: { glareRatio: glareP > 0 ? glare / (glareP * ff) : 1, centreGlare: cGlare, filterEV: Math.log2(1 / ff), key } };
}

// ── Photoelasticity ─────────────────────────────────────────────────────────────────────────
// Plane-stress field of a disk of diameter D and thickness t under diametral compression P along
// y (Hertz 1883; Frocht 1948), at (x, y) from the centre. Units: N, m → Pa. Returns σx, σy, τxy.
export function diskStress(x, y, P, D, t) {
  const R = D / 2, a = R - y, b = R + y, r1 = x * x + a * a, r2 = x * x + b * b, k = (2 * P) / (Math.PI * t);
  return {
    sx: -k * ((a * x * x) / (r1 * r1) + (b * x * x) / (r2 * r2) - 1 / D),
    sy: -k * ((a * a * a) / (r1 * r1) + (b * b * b) / (r2 * r2) - 1 / D),
    txy: k * ((a * a * x) / (r1 * r1) - (b * b * x) / (r2 * r2)),
  };
}
// Principal-stress difference σ1 − σ2 ≥ 0 and the direction φ of σ1 from the x axis.
export function principal({ sx, sy, txy }) {
  return { ds: Math.sqrt((sx - sy) ** 2 + 4 * txy * txy), phi: 0.5 * Math.atan2(2 * txy, sx - sy) };
}
// Stress-optic law: retardation Γ = C t (σ1 − σ2) with C in brewsters (1 Br = 10⁻¹² Pa⁻¹).
export const retardation = (C, t, ds) => C * 1e-12 * t * ds;

// Interference colours (Michel-Lévy): linear sRGB of white light (equal energy, 400–700 nm)
// transmitted by a retarder Γ between crossed (dark) or parallel (light) polarisers in a circular
// polariscope: I(λ) = sin²(πΓ/λ) or cos²(πΓ/λ). Table over Γ ∈ [0, Gmax] nm.
export function michelLevy(Gmax = 4000, N = 2001, light = false) {
  const lams = linspace(400, 700, 61), basis = spectralBasis(lams), T = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const G = (i / (N - 1)) * Gmax;
    for (let k = 0; k < lams.length; k++) {
      const s = Math.sin((Math.PI * G) / lams[k]) ** 2, v = light ? 1 - s : s;
      for (let c = 0; c < 3; c++) T[i * 3 + c] += v * basis[k][c];
    }
    clipRow(T, i * 3);
  }
  return { T, N, Gmax };
}

// ── Birefringent walk-off (optical low-pass filters) ────────────────────────────────────────
// Uniaxial crystals at 589 nm: ordinary and extraordinary indices.
export const CRYSTALS = {
  quartz: { name: 'Crystal quartz', no: 1.5443, ne: 1.5534 },
  linbo3: { name: 'Lithium niobate', no: 2.3007, ne: 2.2116 },
  calcite: { name: 'Calcite', no: 1.6584, ne: 1.4864 },
};
// Angle ρ between the extraordinary ray and the wave normal, for a wave normal at θ to the optic
// axis: tan ρ = (1 − r) tan θ / (1 + r tan²θ), r = no²/ne². Signed: > 0 away from the axis.
export function walkOff(no, ne, theta) {
  const r = (no * no) / (ne * ne), t = Math.tan(theta);
  return Math.atan(((r - 1) * t) / (1 + r * t * t));
}
// Maximum walk-off, at tan θ = ne/no: tan ρ = (no² − ne²)/(2 no ne).
export const maxWalkOff = (no, ne) => Math.atan((no * no - ne * ne) / (2 * no * ne));
