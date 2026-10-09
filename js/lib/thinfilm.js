// Thin-film optics: Fresnel equations and the characteristic-matrix (transfer-matrix)
// method for lossless multilayer stacks at oblique incidence (Macleod's formulation).

// Fresnel power reflectances for a single interface n1 → n2 at incidence angle θ1 (rad).
export function fresnel(n1, n2, th1) {
  const s1 = (n1 / n2) * Math.sin(th1);
  if (s1 >= 1) return { Rs: 1, Rp: 1, R: 1 };
  const c1 = Math.cos(th1), c2 = Math.sqrt(1 - s1 * s1);
  const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2);
  const rp = (n2 * c1 - n1 * c2) / (n2 * c1 + n1 * c2);
  return { Rs: rs * rs, Rp: rp * rp, R: (rs * rs + rp * rp) / 2 };
}

// layers: [{n, d}] from the incident side; d in nm. Returns {Rs, Rp, R}.
export function stackReflectance(layers, n0, ns, lambda, th0 = 0) {
  const sin0 = n0 * Math.sin(th0);
  const out = {};
  for (const pol of ['s', 'p']) {
    const eta = (n) => { const c = Math.sqrt(Math.max(0, 1 - (sin0 / n) ** 2)); return pol === 's' ? n * c : n / c; };
    // M = Π [[cos δ, i sin δ / η], [i η sin δ, cos δ]] with complex entries (a + ib)
    let m11 = [1, 0], m12 = [0, 0], m21 = [0, 0], m22 = [1, 0];
    for (const L of layers) {
      const c = Math.sqrt(Math.max(0, 1 - (sin0 / L.n) ** 2));
      const d = (2 * Math.PI * L.n * L.d * c) / lambda;
      const e = eta(L.n), cd = Math.cos(d), sd = Math.sin(d);
      const a11 = [cd, 0], a12 = [0, sd / e], a21 = [0, e * sd], a22 = [cd, 0];
      const mul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
      const add = (x, y) => [x[0] + y[0], x[1] + y[1]];
      [m11, m12, m21, m22] = [add(mul(m11, a11), mul(m12, a21)), add(mul(m11, a12), mul(m12, a22)), add(mul(m21, a11), mul(m22, a21)), add(mul(m21, a12), mul(m22, a22))];
    }
    const es = eta(ns), e0 = eta(n0);
    const B = [m11[0] + m12[0] * es, m11[1] + m12[1] * es];
    const C = [m21[0] + m22[0] * es, m21[1] + m22[1] * es];
    const num = [e0 * B[0] - C[0], e0 * B[1] - C[1]], den = [e0 * B[0] + C[0], e0 * B[1] + C[1]];
    out['R' + pol] = (num[0] ** 2 + num[1] ** 2) / (den[0] ** 2 + den[1] ** 2);
  }
  out.R = (out.Rs + out.Rp) / 2;
  return out;
}

// Anti-reflection designs centred at λ0 = 550 nm (quarter-wave optical thickness = λ0/4n).
const QW = (n, l0 = 550) => l0 / (4 * n);
export const COATINGS = {
  none: { name: 'Uncoated', layers: () => [] },
  mgf2: { name: 'Single-layer MgF₂ (λ/4)', layers: () => [{ n: 1.38, d: QW(1.38) }] },
  qhq: { name: '3-layer QHQ broadband (MgF₂ / ZrO₂ / Al₂O₃)', layers: () => [{ n: 1.38, d: QW(1.38) }, { n: 2.05, d: 2 * QW(2.05) }, { n: 1.63, d: QW(1.63) }] },
  graded: {
    name: 'Graded-index nanostructure (moth-eye, 300 nm)',
    layers: (ns = 1.52) => {
      const N = 30, T = 300, out = [];
      for (let k = 0; k < N; k++) {
        const t = (k + 0.5) / N; // 0 at air, 1 at glass; quintic profile (Southwell 1983)
        const q = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
        out.push({ n: 1 + (ns - 1) * q, d: T / N });
      }
      return out;
    },
  },
};
