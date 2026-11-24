// A dense primal simplex for small linear programs:
//   minimise cᵀx  subject to  Gx ≤ h,  x ≥ 0.
// Slack variables give the starting basis. Where h has negative entries, `enter` names a column whose
// coefficient is negative in every such row (a free bound, such as the level c of a minimax
// problem): pivoting it in on the most violated row makes every row feasible at once. Pivots follow
// Dantzig's largest-coefficient rule and fall back to Bland's rule after many steps without progress,
// which cannot cycle. Returns { x, value, y (the duals, ≥ 0, with Gᵀy + c ≥ 0 and value = −hᵀy),
// pivots } or throws if the problem is unbounded, infeasible from this start, or too long.
export function simplex(G, h, c, { enter = -1, maxPivots = 20000, eps = 1e-11, piv = 1e-9, tol = 1e-12 } = {}) {
  const m = G.length, n = c.length, W = n + m + 1; // columns: x, slacks, right-hand side
  const T = Array.from({ length: m }, (_, i) => { const r = new Float64Array(W); r.set(G[i]); r[n + i] = 1; r[W - 1] = h[i]; return r; });
  const z = new Float64Array(W); z.set(c); // objective row: reduced costs; z[W−1] = −value
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const pivot = (r, q) => {
    const R = T[r], p = R[q];
    for (let j = 0; j < W; j++) R[j] /= p;
    for (let i = 0; i < m; i++) { if (i === r) continue; const f = T[i][q]; if (f) { const Ti = T[i]; for (let j = 0; j < W; j++) Ti[j] -= f * R[j]; } }
    const f = z[q]; if (f) for (let j = 0; j < W; j++) z[j] -= f * R[j];
    basis[r] = q;
  };
  let worst = -1;
  for (let i = 0; i < m; i++) if (h[i] < -eps && (worst < 0 || h[i] < h[worst])) worst = i;
  if (worst >= 0) {
    if (enter < 0) throw new Error('simplex: infeasible start and no entering column');
    pivot(worst, enter);
    for (let i = 0; i < m; i++) if (T[i][W - 1] < -1e-9) throw new Error('simplex: the entering column does not make every row feasible');
  }
  let pivots = 0, stall = 0, last = Infinity, bland = false;
  for (;;) {
    // entering column
    let q = -1;
    for (let j = 0; j < n + m; j++) if (z[j] < -eps && (q < 0 || (bland ? false : z[j] < z[q]))) { q = j; if (bland) break; }
    if (q < 0) break;
    // ratio test (ties broken by the smallest basis index: Bland)
    // Harris's two passes: the smallest ratio with a little slack, then among the rows within it the
    // largest pivot (small pivots amplify rounding errors in a dense tableau)
    let best = Infinity;
    for (let i = 0; i < m; i++) { const a = T[i][q]; if (a > piv) best = Math.min(best, (Math.max(0, T[i][W - 1]) + tol) / a); }
    let r = -1, big = 0;
    for (let i = 0; i < m; i++) {
      const a = T[i][q];
      if (a > piv && Math.max(0, T[i][W - 1]) / a <= best && (a > big || (bland && a === big && basis[i] < basis[r]))) { big = a; r = i; }
    }
    if (r < 0) throw new Error('simplex: unbounded');
    pivot(r, q);
    if (++pivots > maxPivots) throw new Error('simplex: too many pivots');
    const v = -z[W - 1];
    if (v < last - 1e-13) { last = v; stall = 0; } else if (++stall > 50) bland = true;
  }
  const x = new Float64Array(n);
  basis.forEach((b, i) => { if (b < n) x[b] = T[i][W - 1]; });
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) y[i] = z[n + i];
  return { x, value: -z[W - 1], y, pivots };
}
