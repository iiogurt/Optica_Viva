// Mission "Design an Earth-observation satellite": from a target ground sample distance to focal
// length, mirror, TDI stages and data rate, using the models of the Earth-observation laboratory.
import { orbitSpeed, signal, mtfDiff } from './earthobs.js';

const LAM = 550e-9;

export function designFor({ gsd, H, p, Q = 1, snrTarget = 100, swathKm = 15, bits = 11, el = 45, rho = 0.2 }) {
  const f = (H * p) / gsd; // focal length for the GSD
  const D = (LAM * f) / (Q * p); // mirror for the chosen Q = λf/(Dp)
  const o = orbitSpeed(H), t = gsd / o.ground; // time per line
  // TDI stages for the SNR target (signal from the laboratory's sunlit-ground model)
  // panchromatic band of about 300 nm (450–750 nm); TDI sensors come with a few fixed stage counts
  const STAGES = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 256];
  let N = 1, s = null;
  for (N of STAGES) { s = signal({ rho, el, band: 300, D, gsdM: gsd, H, t, N }); if (s.snr >= snrTarget) break; }
  const pixelsAcross = (swathKm * 1000) / gsd, lineRate = 1 / t;
  const dataRate = pixelsAcross * lineRate * bits; // bit/s, one panchromatic band
  const nyq = 1 / (2 * p), nuC = D / (LAM * f), mtf = mtfDiff(nyq / nuC) * (2 / Math.PI) ** 2;
  return { f, D, N, e: s.e, snr: s.snr, t, lineRate, pixelsAcross, dataRate, mtf, ground: o.ground, diffGround: (1.22 * LAM * H) / D };
}
