// Imaging a black hole: light paths around a Schwarzschild black hole and the image of a thin
// accretion disk (Luminet 1979), in units G = c = M = 1. A photon of impact parameter b moves in a
// plane on the orbit u(φ), u = 1/r, with
//   d²u/dφ² = 3u² − u,   u(0) = 0, du/dφ(0) = 1/b   (traced back from the observer at φ = 0).
// It falls in if b < b_c = 3√3 (the shadow) and otherwise leaves again. Because the orbit depends
// only on b, it is tabulated once for many b; each pixel then reads where its plane meets the disk.

export const B_CRIT = 3 * Math.sqrt(3);
export const R_ISCO = 6;
const DPHI = 0.004;

// One orbit: samples of u every DPHI from φ = 0 until the photon is captured (u ≥ 1/2, inside the
// horizon) or escapes again (u back below 0 after periapsis). Returns { u, captured, phiEnd }.
export function orbit(b, phiMax = 8 * Math.PI) {
  const f = (u) => 3 * u * u - u;
  let u = 0, v = 1 / b, phi = 0;
  const out = [0];
  while (phi < phiMax) {
    // RK4 on (u, v = du/dφ)
    const k1u = v, k1v = f(u);
    const k2u = v + 0.5 * DPHI * k1v, k2v = f(u + 0.5 * DPHI * k1u);
    const k3u = v + 0.5 * DPHI * k2v, k3v = f(u + 0.5 * DPHI * k2u);
    const k4u = v + DPHI * k3v, k4v = f(u + DPHI * k3u);
    u += (DPHI / 6) * (k1u + 2 * k2u + 2 * k3u + k4u); v += (DPHI / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    phi += DPHI;
    if (u >= 0.5) return { u: Float32Array.from(out), captured: true, phiEnd: phi };
    if (u <= 0) return { u: Float32Array.from(out), captured: false, phiEnd: phi - DPHI * (u / (u - out[out.length - 1])) };
    out.push(u);
  }
  return { u: Float32Array.from(out), captured: true, phiEnd: phi };
}

// r at angle φ along the tabulated orbit (Infinity before the photon reaches it or after escape,
// 0 after capture).
function rAt(o, phi) {
  const x = phi / DPHI, i = Math.floor(x);
  if (i >= o.u.length - 1) return o.captured ? 0 : Infinity;
  const u = o.u[i] + (o.u[i + 1] - o.u[i]) * (x - i);
  return u > 0 ? 1 / u : Infinity;
}

// Impact parameters of the table: dense near b_c, where many images pile up.
export function orbitTable(bMax = 40) {
  const bs = [];
  for (let b = 0.2; b < bMax; b += b < B_CRIT - 0.5 || b > B_CRIT + 1.5 ? 0.06 : 0.004) bs.push(b);
  return { bs: Float64Array.from(bs), orbits: bs.map((b) => orbit(b)) };
}

// Page–Thorne flux of a thin disk around a Schwarzschild black hole (Luminet 1979, eq. 15), in
// arbitrary units; zero inside the innermost stable circular orbit r = 6.
export function diskFlux(r) {
  if (r <= R_ISCO) return 0;
  const s3 = Math.sqrt(3), s6 = Math.sqrt(6), sx = Math.sqrt(r);
  const log = Math.log(((sx + s3) * (s6 - s3)) / ((sx - s3) * (s6 + s3)));
  return (1 / ((r - 3) * r ** 2.5)) * (sx - s6 + (s3 / 3) * log);
}

// Image of the disk (inner edge 6, outer edge rOut) seen at inclination incl (rad, angle between
// the line of sight and the disk's axis), on an N×N grid spanning ±fov (in M), rows y0…y1.
// Each pixel's ray meets the disk plane at φ = φ0 + nπ; the first crossing inside the disk emits
// I = g⁴ F(r), with g = 1/(u^t (1 − Ω λ)) for gas on circular Keplerian orbits (Ω = r^(−3/2),
// u^t = (1 − 3/r)^(−1/2)) and λ the photon's angular momentum about the disk axis.
export function diskImage({ N, fov, incl, rOut = 20, table, y0 = 0, y1 = N, maxOrder = 3 }) {
  const out = new Float32Array((y1 - y0) * N), ci = Math.cos(incl), si = Math.sin(incl);
  const { bs, orbits } = table;
  for (let j = y0; j < y1; j++) for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N * 2 - 1) * fov, y = (1 - (j + 0.5) / N * 2) * fov, b = Math.hypot(x, y);
    if (b < 1e-6) continue;
    // nearest tabulated impact parameter (the table is sorted)
    let lo = 0, hi = bs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bs[m] < b) lo = m; else hi = m; }
    const o = orbits[b - bs[lo] < bs[hi] - b ? lo : hi];
    // the disk plane (normal tilted towards +y) meets the photon's plane where
    // cos φ · cos i + sin φ · (y/b) sin i = 0
    let phi0 = Math.atan2(-ci, (y / b) * si);
    if (phi0 <= 0) phi0 += Math.PI;
    let I = 0;
    for (let n = 0; n < maxOrder; n++) {
      const r = rAt(o, phi0 + n * Math.PI);
      if (r === 0 || r === Infinity) break;
      if (r > R_ISCO && r < rOut) {
        const lam = x * si, ut = 1 / Math.sqrt(1 - 3 / r), om = r ** -1.5, g = 1 / (ut * (1 - om * lam));
        I = g ** 4 * diskFlux(r);
        break;
      }
    }
    out[(j - y0) * N + i] = I;
  }
  return out;
}

// Angular size of one gravitational radius GM/c² for a mass (solar masses) at a distance (pc), µas.
export const muasPerM = (Msun, pc) => ((6.674e-11 * 1.989e30 * Msun) / 2.998e8 ** 2 / (pc * 3.0857e16)) * 206264.806e6;
export const TARGETS = { m87: { M: 6.5e9, D: 16.8e6, incl: 17 }, sgra: { M: 4.0e6, D: 8.18e3, incl: 30 } };
