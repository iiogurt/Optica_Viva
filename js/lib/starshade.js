// Starshades: Fresnel diffraction behind a circularly symmetric occulter that blocks a fraction
// A(r) ∈ [0, 1] of each circle of radius r (a petalled shade with petal width A(r)·2πr/N, in
// the azimuthally averaged approximation). In the scalar Fresnel approximation the field at
// distance z and radius ρ, relative to the unobstructed plane wave, is
//   E(ρ) = 1 + i (2π/λz) e^{ikρ²} ∫₀^R A(r) e^{ikr²} J₀(2krρ) r dr,   k = π/(λz).
// Petal corrections enter at azimuthal orders N, 2N, … through J_N(2krρ) and are negligible
// near the axis for N ≳ 16; they are not included. Lengths in metres.

// Bessel J₀ (Abramowitz & Stegun 9.4.1 and 9.4.3; |ε| < 5 × 10⁻⁸).
export function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const y = (x / 3) ** 2;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.00021)))));
  }
  const y = 3 / ax;
  const f0 = 0.79788456 + y * (-0.00000077 + y * (-0.0055274 + y * (-0.00009512 + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  const t0 = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return (f0 * Math.cos(t0)) / Math.sqrt(ax);
}

// Occulter profiles: A(r) and the radius beyond which A < 10⁻⁸.
// disk: opaque disk of radius R. hyper: Cash's hypergaussian, opaque to a, then exp(−((r−a)/b)ⁿ).
export const OCCULTERS = {
  disk: { A: (r, o) => (r <= o.R ? 1 : 0), Rmax: (o) => o.R },
  hyper: { A: (r, o) => (r <= o.a ? 1 : Math.exp(-(((r - o.a) / o.b) ** o.n))), Rmax: (o) => o.a + o.b * Math.pow(Math.log(1e8), 1 / o.n) },
};

// Complex fields [re, im] at radii ρs. The integral is taken in u = r², where the Fresnel phase
// e^{iku} is linear; each step integrates it exactly (Filon midpoint rule), so an opaque disk
// is exact and only A·J₀ is sampled. Off axis J₀ shifts the local frequency, which leaves an
// O(Δu²) error; one Richardson step (N and 2N) removes it.
export function shadowField(kind, o, lam, z, rhos, steps = 2000) {
  const a = filonField(kind, o, lam, z, rhos, steps), b = filonField(kind, o, lam, z, rhos, 2 * steps);
  return b.map(([x, y], i) => [(4 * x - a[i][0]) / 3, (4 * y - a[i][1]) / 3]);
}
function filonField(kind, o, lam, z, rhos, steps) {
  const occ = OCCULTERS[kind], Rm = occ.Rmax(o), U = Rm * Rm, du = U / steps, k = Math.PI / (lam * z);
  const wgt = Math.abs(k * du) < 1e-9 ? du : (2 * Math.sin((k * du) / 2)) / k, c = (2 * Math.PI) / (lam * z) / 2; // r dr = du/2
  const As = new Float64Array(steps), rs = new Float64Array(steps), cs = new Float64Array(steps), sn = new Float64Array(steps);
  for (let i = 0; i < steps; i++) { const u = (i + 0.5) * du; rs[i] = Math.sqrt(u); As[i] = occ.A(rs[i], o); cs[i] = Math.cos(k * u); sn[i] = Math.sin(k * u); }
  const out = [];
  for (const rho of rhos) {
    let re = 0, im = 0;
    const q = 2 * k * rho;
    for (let i = 0; i < steps; i++) {
      const a = As[i];
      if (a < 1e-12) continue;
      const g = a * (rho ? besselJ0(q * rs[i]) : 1);
      re += g * cs[i]; im += g * sn[i];
    }
    re *= wgt * c; im *= wgt * c;
    // E = 1 + i e^{ip}(re + i im)
    const p = k * rho * rho, er = Math.cos(p), ei = Math.sin(p), xr = er * re - ei * im, xi = er * im + ei * re;
    out.push([1 - xi, xr]);
  }
  return out;
}
export const intensity = (f) => f.map(([a, b]) => a * a + b * b);
export const fresnelNumber = (R, lam, z) => (R * R) / (lam * z);
// Geometric inner working angle (rad): the shade's tip radius seen from the telescope.
export const iwa = (Rtip, z) => Rtip / z;
// Axial intensity behind an opaque disk is exactly 1 (Poisson–Arago spot); behind a circular hole
// it is 4 sin²(πF/2).
export const holeAxial = (F) => 4 * Math.sin((Math.PI * F) / 2) ** 2;

// Mean suppression over a telescope aperture of diameter D (area-weighted shadow intensity),
// and the radial profile, for each wavelength. o = { kind, ...shape, z, D, lams (m), rhoMax, nr }.
export function shadowLab(o) {
  const nr = o.nr || 96, rhos = Array.from({ length: nr }, (_, i) => (i / (nr - 1)) * o.rhoMax);
  const prof = o.lams.map((l) => intensity(shadowField(o.kind, o, l, o.z, rhos, o.steps)));
  const na = 12, ar = Array.from({ length: na }, (_, i) => ((i + 0.5) / na) * (o.D / 2));
  const supp = o.lams.map((l) => { const I = intensity(shadowField(o.kind, o, l, o.z, ar, o.steps)); return I.reduce((s, v, i) => s + v * ar[i], 0) / ar.reduce((s, r) => s + r, 0); });
  return { rhos, prof, supp };
}
