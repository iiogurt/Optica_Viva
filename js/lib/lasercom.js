// Free-space laser communication: the link budget of a beam sent across the solar system, and how
// many bits each detected photon can carry. Pure functions; SI units unless named.
//
// Transmitter: a Gaussian beam from an unobscured aperture D_t, truncated at the optimum of Klein &
// Degnan (1974), has the on-axis gain G_t = η_KD (πD_t/λ)², η_KD = 0.8145. Its far field is close to
// a Gaussian, I(θ) ∝ exp(−2θ²/θ₀²); matching the on-axis gain (G = 8/θ₀² for a Gaussian) gives the
// 1/e² half-angle θ₀ = √(8/G_t). Random pointing jitter σ per axis (two-dimensional Gaussian) costs on
// average  ⟨exp(−2r²/θ₀²)⟩ = 1 / (1 + 4σ²/θ₀²).
// Received power: P_r = P_t G_t/(4πR²) · A_r · η, with A_r = π D_r²/4 (1 − ε²) for a central
// obstruction ε and η the product of optics, atmosphere and detector efficiencies.
// Detection: M-ary pulse-position modulation (PPM): one pulse in one of M slots of length T_s.
// Photon counts are Poisson, n_s + n_b in the pulse slot and n_b in the others. With the likelihood
// ratio L = 1 + n_s/n_b, the capacity per symbol is (e.g. Moision & Hamkins 2003)
//   C = log₂M − E[ log₂ Σ_j L^(k_j − k_1) ]  bits,
// evaluated here by Monte Carlo with common random numbers; with no background it becomes the erasure
// channel, C = (1 − e^(−n_s)) log₂ M.
import { makeRng } from './random.js';

export const C = 299792458, H = 6.62607015e-34, KB = 1.380649e-23, AU = 1.495978707e11, KM = 1e3;
export const ETA_KD = 0.8145, R_EARTH = 6.371e6;
// fixed assumptions: transmitter optics, receiver optics, detector efficiency, clear-sky zenith transmission
export const ETA = { tx: 0.5, rx: 0.5, det: 0.5, zenith: 0.9 };
export const CODE_GAP_DB = 1; // a good code (SCPPM) works about 1 dB above capacity

export const PRESETS = {
  dsoc: { R: 386e9, P: 4, Dt: 0.22, Dr: 5.1, obs: 0.36, jitter: 1, lambda: 1550, M: 128, Ts: 0.5, nb: 0.002, el: 40 },
  llcd: { R: 384.4e6, P: 0.5, Dt: 0.1, Dr: 0.8, obs: 0, jitter: 2, lambda: 1550, M: 16, Ts: 0.2, nb: 0.001, el: 40 },
  mars: { R: 55e9, P: 4, Dt: 0.22, Dr: 5.1, obs: 0.36, jitter: 1, lambda: 1550, M: 16, Ts: 0.5, nb: 0.002, el: 40 },
};

export const gainTx = (D, lambda) => ETA_KD * (Math.PI * D / lambda) ** 2;
export const divergence = (D, lambda) => Math.sqrt(8 / gainTx(D, lambda));
export const pointingLoss = (sigma, theta0) => 1 / (1 + (4 * sigma * sigma) / (theta0 * theta0));
export const airmass = (elDeg) => 1 / Math.sin((Math.max(5, elDeg) * Math.PI) / 180);
export const atmosphere = (elDeg, zenith = ETA.zenith) => zenith ** airmass(elDeg);

// The whole budget. p: { R (m), P (W), Dt, Dr (m), obs, jitter (µrad), lambda (nm), el (deg) }
export function budget(p) {
  const lam = p.lambda * 1e-9, G = gainTx(p.Dt, lam), th = Math.sqrt(8 / G), Ar = (Math.PI * p.Dr * p.Dr / 4) * (1 - p.obs * p.obs);
  const Lp = pointingLoss(p.jitter * 1e-6, th), Ta = atmosphere(p.el);
  const irr = (p.P * G) / (4 * Math.PI * p.R * p.R), Pr = irr * Ar * ETA.tx * Lp * Ta * ETA.rx, eph = (H * C) / lam;
  const rate = (Pr / eph) * ETA.det; // detected signal photons per second
  const Gr = (Math.PI * p.Dr / lam) ** 2 * (1 - p.obs * p.obs), Ls = (lam / (4 * Math.PI * p.R)) ** 2;
  return { G, Gr, Ls, theta: th, footprint: 2 * th * p.R, Ar, Lp, Ta, irr, Pr, eph, rate, catch: Ar / ((Math.PI / 2) * (th * p.R) ** 2) };
}

// Capacity (bits per PPM symbol) of the Poisson PPM channel, Monte Carlo with `trials` symbols.
// Noise photons in the M−1 empty slots: their total is Poisson((M−1) n_b) and they fall uniformly
// into the slots (an exact equivalent of M−1 independent Poisson draws), so a trial costs O(1 + counts).
export function capacity(M, ns, nb, trials = 3000, seed = 7) {
  if (ns <= 0) return 0;
  if (nb <= 0) return (1 - Math.exp(-ns)) * Math.log2(M);
  const rng = makeRng(seed), lnL = Math.log1p(ns / nb), cnt = new Uint16Array(M - 1), hit = new Int32Array(M - 1);
  let acc = 0;
  for (let t = 0; t < trials; t++) {
    const k1 = rng.poisson(ns + nb), nTot = rng.poisson((M - 1) * nb);
    let nh = 0, kmax = 0;
    for (let i = 0; i < nTot; i++) { const j = Math.floor(rng.u() * (M - 1)); if (cnt[j]++ === 0) hit[nh++] = j; if (cnt[j] > kmax) kmax = cnt[j]; }
    // Σ_j L^(k_j − k1): the pulse slot gives 1, the empty slots L^(−k1); summed relative to the largest term
    const top = Math.max(kmax, k1);
    let s = Math.exp((k1 - top) * lnL) + (M - 1 - nh) * Math.exp(-top * lnL);
    for (let i = 0; i < nh; i++) { s += Math.exp((cnt[hit[i]] - top) * lnL); cnt[hit[i]] = 0; }
    acc += ((top - k1) * lnL + Math.log(s)) / Math.LN2;
  }
  return Math.max(0, Math.log2(M) - acc / trials);
}

// Data rate (bit/s) with a code CODE_GAP_DB from capacity. rate: detected photons/s; Ts in ns.
export function dataRate(rate, M, Ts, nb, trials = 3000) {
  const Tsym = M * Ts * 1e-9, ns = rate * Tsym / 10 ** (CODE_GAP_DB / 10);
  const c = capacity(M, ns, nb, trials);
  return { ns: rate * Tsym, bitsPerSymbol: c, rate: c / Tsym, perPhoton: c / (rate * Tsym), max: Math.log2(M) / Tsym };
}

// The rate against distance (with the best of M = 4…256 at each distance)
export const ORDERS = [4, 8, 16, 32, 64, 128, 256];
export function rateCurve(p, R0 = 3e8, R1 = 3e12, n = 36, trials = 600) {
  const out = [], best = [];
  for (let i = 0; i < n; i++) {
    const R = R0 * (R1 / R0) ** (i / (n - 1)), b = budget({ ...p, R });
    const fixed = dataRate(b.rate, p.M, p.Ts, p.nb, trials).rate;
    let top = 0; for (const M of ORDERS) top = Math.max(top, dataRate(b.rate, M, p.Ts, p.nb, trials).rate);
    out.push([R, fixed]); best.push([R, top]);
  }
  return { fixed: out, best };
}

// Radio for comparison: Ka band (32 GHz), dishes with aperture efficiency 0.6, a receiver of system
// noise temperature T and a bandwidth B, with a turbo code needing Eb/N0 ≈ 1 dB when power is scarce,
// and at most `se` bit/s per hertz (practical modulations) when it is plentiful:
//   rate = B · min(se, log₂(1 + P_r ln2 / (k T B · Eb/N0))),  → P_r / (k T · Eb/N0) for small P_r.
export const KA = { f: 32e9, P: 35, Dt: 2, Dr: 34, eff: 0.6, T: 30, ebn0Db: 1, B: 500e6, se: 2 };
export function radioRate(R, k = KA) {
  const lam = C / k.f, Gt = k.eff * (Math.PI * k.Dt / lam) ** 2, Gr = k.eff * (Math.PI * k.Dr / lam) ** 2, Pr = k.P * Gt * Gr * (lam / (4 * Math.PI * R)) ** 2;
  return { Pr, rate: k.B * Math.min(k.se, Math.log2(1 + (Pr * Math.LN2) / (KB * k.T * k.B * 10 ** (k.ebn0Db / 10)))), footprint: 1.02 * (lam / k.Dt) * R };
}

// Detected photons in `rows` PPM symbols (for the picture): counts[r*M + j], pulse slot pos[r], decoded dec[r] (−1 = erasure)
export function photonFrames(M, ns, nb, rows, seed) {
  const rng = makeRng(seed), counts = new Uint16Array(rows * M), pos = new Int32Array(rows), dec = new Int32Array(rows);
  for (let r = 0; r < rows; r++) {
    pos[r] = Math.floor(rng.u() * M);
    for (let j = 0; j < M; j++) counts[r * M + j] = rng.poisson(nb + (j === pos[r] ? ns : 0));
    let best = 0, who = -1, ties = 0;
    for (let j = 0; j < M; j++) { const k = counts[r * M + j]; if (k > best) { best = k; who = j; ties = 1; } else if (k === best && k > 0) ties++; }
    dec[r] = ties > 1 ? -1 : who;
  }
  return { counts, pos, dec };
}
