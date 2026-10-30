// Light as a wave: a 2-D finite-difference time-domain (FDTD) solution of Maxwell's equations on
// a Yee grid, TM_z polarisation (E along z, out of the picture; H in the plane). Units: the cell
// size is 1, the Courant number S = c·Δt/Δx = 0.5, so a wave moves half a cell per step.
// Materials: relative permittivity per cell (glass), perfect conductors (metal screens, Ez = 0),
// and a graded, matched absorbing layer on all four sides. Pure functions and plain arrays, so
// the simulation can live in a compute worker.

export const S = 0.5;
const ABS = 28; // absorbing layer, cells

// Scenes: each returns { eps, pec } masks for a grid nx × ny; λ, sizes and positions in cells.
// x0 is the column of the screen or the object's front.
export const SCENES = {
  single: (g, p) => screen(g, p, [[0, p.w]]),
  double: (g, p) => screen(g, p, [[-p.d / 2, p.w], [p.d / 2, p.w]]),
  grating: (g, p) => screen(g, p, Array.from({ length: 9 }, (_, i) => [(i - 4) * p.d, p.w])),
  edge: (g, p) => { for (let y = 0; y < g.ny; y++) if (y < g.ny / 2) for (let x = g.x0; x < g.x0 + 2; x++) g.pec[y * g.nx + x] = 1; },
  disc: (g, p) => fill(g, (x, y) => Math.hypot(x - g.x0 - p.w / 2, y - g.ny / 2) <= p.w / 2, 'pec'),
  lens: (g, p) => {
    // a symmetric biconvex lens of focal length ≈ p.f (lensmaker, thin): R = 2 (n − 1) f
    const n = p.n, R = 2 * (n - 1) * p.f, half = Math.min(R * 0.95, g.ny * 0.32);
    const sag = R - Math.sqrt(R * R - half * half);
    fill(g, (x, y) => { const dy = y - g.ny / 2; if (Math.abs(dy) > half) return false; const s = R - Math.sqrt(R * R - dy * dy), cx = g.x0 + sag; return Math.abs(x - cx) <= sag - s + 0.5; }, n * n);
  },
  interface: (g, p) => { const t = Math.tan((p.tilt * Math.PI) / 180); fill(g, (x, y) => x - g.x0 > (y - g.ny / 2) * t, p.n * p.n); },
  film: (g, p) => fill(g, (x) => x >= g.x0 && x < g.x0 + p.w, p.n * p.n),
};
function fill(g, inside, what) {
  for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) if (inside(x, y)) { const k = y * g.nx + x; if (what === 'pec') g.pec[k] = 1; else g.eps[k] = what; }
}
// a thin metal screen (2 cells) at x0 with openings [centre offset, width]
function screen(g, p, holes) {
  for (let y = 0; y < g.ny; y++) {
    const open = holes.some(([c, w]) => Math.abs(y + 0.5 - (g.ny / 2 + c)) < w / 2);
    if (!open) for (let x = g.x0; x < g.x0 + 2; x++) g.pec[y * g.nx + x] = 1;
  }
}

// A simulation: fields, update coefficients and the source. Options: nx, ny, lam (cells per
// vacuum wavelength), scene and its parameters, source 'plane' (a Gaussian-profiled line source)
// or 'point'.
export function makeSim({ nx, ny, lam, scene, p = {}, source = 'plane', x0 = Math.round(nx * 0.33) }) {
  const N = nx * ny, g = { nx, ny, x0, eps: new Float32Array(N).fill(1), pec: new Uint8Array(N) };
  SCENES[scene](g, p);
  // loss per cell: zero inside, growing as d³ into the absorbing layer (matched electric and
  // magnetic losses, so a wave meets no impedance step)
  const loss = new Float32Array(N);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const d = Math.max(ABS - x, x - (nx - 1 - ABS), ABS - y, y - (ny - 1 - ABS), 0) / ABS;
    loss[y * nx + x] = 0.35 * d * d * d;
  }
  const ca = new Float32Array(N), cb = new Float32Array(N), da = new Float32Array(N), db = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const l = loss[k] / g.eps[k];
    ca[k] = (1 - l) / (1 + l); cb[k] = S / g.eps[k] / (1 + l);
    da[k] = (1 - loss[k]) / (1 + loss[k]); db[k] = S / (1 + loss[k]);
  }
  return { nx, ny, lam, x0, source, srcX: ABS + 6, eps: g.eps, pec: g.pec, ca, cb, da, db, Ez: new Float32Array(N), Hx: new Float32Array(N), Hy: new Float32Array(N), I: new Float32Array(N), nI: 0, t: 0 };
}

// Advance n steps. Once the wave has crossed the grid (`settle` steps), accumulate the
// time-averaged intensity ⟨Ez²⟩ for the intensity view.
export function step(sim, n) {
  const { nx, ny, Ez, Hx, Hy, ca, cb, da, db, pec } = sim, w = (2 * Math.PI * S) / sim.lam;
  const settle = 2.2 * nx / S;
  for (let s = 0; s < n; s++) {
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx; x++) { const k = y * nx + x; Hx[k] = da[k] * Hx[k] - db[k] * (Ez[k + nx] - Ez[k]); }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx - 1; x++) { const k = y * nx + x; Hy[k] = da[k] * Hy[k] + db[k] * (Ez[k + 1] - Ez[k]); }
    for (let y = 1; y < ny; y++) for (let x = 1; x < nx; x++) {
      const k = y * nx + x;
      Ez[k] = pec[k] ? 0 : ca[k] * Ez[k] + cb[k] * (Hy[k] - Hy[k - 1] - Hx[k] + Hx[k - nx]);
    }
    // soft source with a smooth start over three periods
    const tt = sim.t, ramp = Math.min(1, tt / (3 * sim.lam / S)), a = Math.sin(w * tt) * ramp;
    if (sim.source === 'point') Ez[Math.round(ny / 2) * nx + sim.x0 - Math.round(4 * sim.lam)] += a;
    else {
      const sig = ny * 0.3;
      for (let y = 0; y < ny; y++) Ez[y * nx + sim.srcX] += 0.5 * a * Math.exp(-(((y - ny / 2) / sig) ** 2));
    }
    sim.t++;
    // every second step is enough to average over a period (at least 8 samples per period)
    if (sim.t > settle && sim.t % 2 === 0) { const I = sim.I; for (let k = 0; k < I.length; k++) I[k] += Ez[k] * Ez[k]; sim.nI++; }
  }
  return sim;
}

// Intensity along a column x (time-averaged), normalised to its maximum.
export function column(sim, x) {
  const out = new Float64Array(sim.ny);
  for (let y = 0; y < sim.ny; y++) out[y] = sim.nI ? sim.I[y * sim.nx + x] / sim.nI : 0;
  const m = Math.max(...out) || 1;
  return out.map((v) => v / m);
}

// The Huygens–Fresnel prediction for the same screen in 2-D: every point of the openings sends a
// cylindrical wave, amplitude ∝ e^{ikr}/√r with the obliquity factor (1 + cos θ)/2. Returns the
// normalised intensity at the cells y of the column x.
export function huygens({ nx, ny, lam, x0, holes, x }) {
  const k = (2 * Math.PI) / lam, out = new Float64Array(ny), dx = x - (x0 + 2);
  for (let y = 0; y < ny; y++) {
    let re = 0, im = 0;
    for (const [c, w] of holes) for (let s = -w / 2 + 0.125; s < w / 2; s += 0.25) {
      const yy = ny / 2 + c + s, r = Math.hypot(dx, y + 0.5 - yy), ob = (1 + dx / r) / 2, a = ob / Math.sqrt(r);
      re += a * Math.cos(k * r); im += a * Math.sin(k * r);
    }
    out[y] = re * re + im * im;
  }
  const m = Math.max(...out) || 1;
  return out.map((v) => v / m);
}
