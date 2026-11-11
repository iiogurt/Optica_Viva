// Mirages: light in air whose temperature changes with height. The refractive index of air at
// 550 nm follows the gas law, (n − 1) = K·P/T with (n − 1) = 2.77·10⁻⁴ at 15 °C and 1013.25 hPa
// (dry air; Ciddor 1996 gives 2.77·10⁻⁴ there). Warm air is thinner and bends light less, so rays
// curve towards the colder, denser air: down over a cold sea, up over a hot road.
//
// The air is horizontally uniform, so a ray obeys the exact equation of a stratified medium,
//   d²z/dx² = (1 + (dz/dx)²) · (1/n) dn/dz,
// integrated by fourth-order Runge–Kutta in the horizontal distance x (it stays exact through the
// turning points of a mirage, where dz/dx changes sign). The Earth's curvature enters through the
// flat-Earth transformation n_eff(z) = n(z)·(1 + z/R_E): rays bent at exactly 1/R_E then stay at
// constant height above the surface.

export const RE = 6.371e6; // m
export const K = (2.77e-4 * 288.15) / 1013.25; // K/hPa, from (n − 1) at 15 °C, 1013.25 hPa
const G = 9.80665, RD = 287.05, LAPSE = -0.0065; // m/s², J/(kg K), K/m

// Refractive index of air (550 nm) at temperature T (K) and pressure P (hPa).
export const refractivity = (T, P) => (K * P) / T; // n − 1
export const dndT = (T, P) => -(K * P) / (T * T); // per kelvin

// Temperature profile, height z in metres above the surface: the air far above the surface at Ta
// (°C) with the standard lapse rate, plus a surface layer ΔT·e^(−z/h) (warmer than the air over a
// sunny road, colder over cold water), plus an optional warm layer (an inversion) of strength dI
// centred at height zi and width wi.
export function profile({ Ta = 15, dT = 0, h = 1, dI = 0, zi = 20, wi = 3 }) {
  return (z) => Ta + 273.15 + LAPSE * z + dT * Math.exp(-Math.max(0, z) / h) + (dI ? dI / (1 + Math.exp(-(z - zi) / wi)) : 0);
}
// Pressure from hydrostatic balance, with the scale height of the air's temperature at the surface.
export const pressure = (z, P0 = 1013.25, T0 = 288.15) => P0 * Math.exp((-G * z) / (RD * T0));

// The index n_eff(z) seen by a ray over a flat Earth (curvature folded in) and its gradient
// (analytic: dn/dz = K (P′T − P T′)/T² with P′ = −P g/(R_d T₀)), and `scale`, the thinnest layer, which
// limits the integration step.
export function medium(atm, { curved = true, P0 = 1013.25 } = {}) {
  const { Ta = 15, dT = 0, h = 1, dI = 0, zi = 20, wi = 3 } = atm;
  const T = profile(atm), T0 = T(0), Hs = (RD * T0) / G;
  const Tp = (z) => LAPSE - (dT / h) * Math.exp(-Math.max(0, z) / h) + (dI ? (dI / wi) * Math.exp(-(z - zi) / wi) / (1 + Math.exp(-(z - zi) / wi)) ** 2 : 0);
  const n = (z) => 1 + refractivity(T(z), pressure(z, P0, T0));
  const c = (z) => (curved ? 1 + z / RE : 1);
  const ne = (z) => n(z) * c(z);
  const grad = (z) => {
    const t = T(z), P = pressure(z, P0, T0), dn = (K * ((-P / Hs) * t - P * Tp(z))) / (t * t);
    return dn * c(z) + (curved ? n(z) / RE : 0);
  };
  return { T, n, ne, grad, scale: Math.min(h, dI ? wi : Infinity, 50) };
}

// One ray from height z0 with elevation angle a (rad, positive up), traced to the horizontal
// distance L (m); stops at the surface (z ≤ 0). The step is at most dx and small enough that the ray
// crosses at most a quarter of the thinnest layer per step. Returns { z: height at L (or 0), x:
// where it ended, ground: met the surface, p: final slope, path: [[x, z], …] when keep > 0 }.
export function ray(M, z0, a, L, { dx = 20, keep = 0 } = {}) {
  let x = 0, z = z0, p = Math.tan(a);
  const path = keep ? [[0, z0]] : null;
  const acc = (zz, pp) => (1 + pp * pp) * (M.grad(zz) / M.ne(zz));
  let k = 0;
  while (x < L) {
    const near = z < 4 * M.scale ? 0.25 * M.scale / Math.max(Math.abs(p), 1e-5) : Infinity;
    const s = Math.min(dx, L - x, Math.max(0.02, near));
    const k1z = p, k1p = acc(z, p);
    const k2z = p + 0.5 * s * k1p, k2p = acc(z + 0.5 * s * k1z, p + 0.5 * s * k1p);
    const k3z = p + 0.5 * s * k2p, k3p = acc(z + 0.5 * s * k2z, p + 0.5 * s * k2p);
    const k4z = p + s * k3p, k4p = acc(z + s * k3z, p + s * k3p);
    z += (s / 6) * (k1z + 2 * k2z + 2 * k3z + k4z); p += (s / 6) * (k1p + 2 * k2p + 2 * k3p + k4p); x += s;
    if (path && (++k % keep === 0)) path.push([x, z]);
    if (z <= 0) { if (path) path.push([x, 0]); return { z: 0, x, ground: true, p, path }; }
  }
  if (path && path[path.length - 1][0] !== x) path.push([x, z]);
  return { z, x, ground: false, p, path };
}

// The transfer curve: for elevation angles from aLo to aHi (rad) the height reached at distance L
// (NaN where the ray met the surface first). An apparent image is upright where the curve rises,
// inverted where it falls; several branches over one height mean several images.
export function transfer(M, z0, L, aLo, aHi, n = 241, dx = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = aLo + ((aHi - aLo) * i) / (n - 1), r = ray(M, z0, a, L, { dx });
    out.push([a, r.ground ? NaN : r.z]);
  }
  return out;
}

// The gradient of temperature at which a horizontal ray curves like the Earth (dn/dz = −n/R_E): at
// that gradient light can follow the surface all the way round (ducting). From
// dn/dz = −(n − 1)/T·dT/dz − (n − 1)·g/(R_d T) (gas law with hydrostatic pressure).
export function criticalGradient(T = 288.15, P = 1013.25) {
  const N = refractivity(T, P), dndzP = (-N * G) / (RD * T);
  return ((1 / RE + dndzP) * T) / N; // K/m: dT/dz such that dn/dz = −1/R_E
}
// Curvature of a horizontal ray (1/m, positive towards the surface) for a temperature gradient
// dTdz (K/m), and its ratio to the Earth's curvature (the coefficient of refraction k).
export function rayCurvature(dTdz, T = 288.15, P = 1013.25) {
  const N = refractivity(T, P), dndz = (-N / T) * dTdz - (N * G) / (RD * T);
  return { kappa: -dndz, k: -dndz * RE };
}

// The directions in which the eye sees the object (height H at distance L): a coarse scan of
// ±12 mrad, then the range of elevations whose rays reach the object below 1.4 H, with a margin of
// sea or road below and sky above. Without such rays (the object is below the horizon) the window
// is centred on the horizon, the lowest direction whose ray clears the surface.
export function autoWindow(M, z0, L, H, dx) {
  const scan = transfer(M, z0, L, -0.012, 0.012, 241, dx * 2), hits = scan.filter(([, z]) => isFinite(z) && z <= 1.4 * H).map(([a]) => a);
  if (hits.length) {
    const lo = Math.min(...hits), hi = Math.max(...hits), pad = Math.max(0.3 * (hi - lo), (0.35 * H) / L, 2e-4);
    return [lo - 1.2 * pad, hi + pad];
  }
  const clear = scan.find(([, z]) => isFinite(z)), ah = clear ? clear[0] : 0, half = Math.max((1.5 * H) / L, 1e-3);
  return [ah - half, ah + half];
}

// Everything the laboratory draws, computed together (in the worker): the window of elevations, the
// transfer curve over it, and a fan of ray paths for the side view.
// p = { atm, curved, z0, L, H (object height), n, fan }
export function mirageScene(p) {
  const M = medium(p.atm, { curved: p.curved !== false }), dx = Math.max(2, p.L / 600);
  const [aLo, aHi] = autoWindow(M, p.z0, p.L, p.H, dx);
  const tr = transfer(M, p.z0, p.L, aLo, aHi, p.n || 241, dx);
  const paths = [], nf = p.fan || 25;
  for (let i = 0; i < nf; i++) {
    const a = aLo + ((aHi - aLo) * i) / (nf - 1);
    paths.push(ray(M, p.z0, a, p.L, { dx, keep: Math.max(1, Math.round(p.L / dx / 80)) }).path);
  }
  const zs = [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter((z) => z <= Math.max(2, 4 * (p.atm.h || 1), (p.atm.dI ? p.atm.zi : 0) * 2));
  return { aLo, aHi, a: tr.map((q) => q[0]), z: tr.map((q) => q[1]), paths, temp: zs.map((z) => [M.T(z) - 273.15, z]), gradSurface: (M.T(0.001) - M.T(0)) / 0.001 };
}
