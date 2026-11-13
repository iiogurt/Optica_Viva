// A mechanically compensated zoom lens of four thin groups, + − + +: a fixed front group G1, a
// negative variator G2 moved linearly, a positive compensator G3 on a cam, and a fixed master group
// G4 holding the aperture stop. G2 and G3 keep the light leaving G3 parallel (an afocal zoom), so
// the image stays on the sensor at every focal length (parfocal) and the f-number stays constant.
// Positions in mm along the axis from G1; object at infinity.

export const DESIGN = { f1: 100, f2: -20, f3: 45, f4: 50, p4: 140, p2min: 6, p2max: 59 };

// The compensator position for variator position p2: G1's image at f1 is re-imaged by G2 to x2,
// and G3 must have x2 in its front focal plane.
export function cam(p2, d = DESIGN) {
  const s = d.f1 - p2, sp = 1 / (1 / d.f2 + 1 / s);
  return p2 + sp + d.f3;
}
// Paraxial trace of a ray (height y, angle u) entering at x0 through thin lenses [[position, f]];
// returns the ray at each lens (height, angle after it) and its final height and angle.
export function trace(lenses, y, u, x0 = 0) {
  const pts = [];
  let x = x0;
  for (const [p, f] of lenses) { y += u * (p - x); x = p; u -= y / f; pts.push([x, y, u]); }
  return { pts, y, u, x };
}
export const lensesAt = (p2, p3, d = DESIGN) => [[0, d.f1], [p2, d.f2], [p3, d.f3], [d.p4, d.f4]];
// Focal length, back focal distance (from G4), the afocal magnification of G1–G3 and the position of
// the image of a distant object.
export function state(p2, p3 = cam(p2), d = DESIGN) {
  const L = lensesAt(p2, p3, d), r = trace(L, 1, 0), efl = -1 / r.u, bfl = -r.y / r.u;
  const a = trace(L.slice(0, 3), 1, 0);
  return { p2, p3, efl, bfl, image: d.p4 + bfl, afocalOut: a.u, M: efl / d.f4 };
}
// The variator position that gives focal length f (bisection; efl rises with p2 over the range).
export function p2For(f, d = DESIGN) {
  let lo = d.p2min, hi = d.p2max;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (state(m, cam(m, d), d).efl < f) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const range = (d = DESIGN) => [state(d.p2min).efl, state(d.p2max).efl];

// The aperture stop in G4 of diameter f4/N: entrance pupil M·f4/N, so the f-number is f/D_EP = N
// at every focal length (a constant-aperture zoom); the front group must be as wide as the pupil.
export const pupil = (st, N, d = DESIGN) => (st.M * d.f4) / N;

// Rays for the drawing: the marginal ray of the axial beam (height D_EP/2) and the chief ray of the
// field edge, which crosses the axis at the stop (G4); rim rays are their sums (paraxial optics is linear).
export function rays(p2, p3, N, halfField, d = DESIGN) {
  const L = lensesAt(p2, p3, d), st = state(p2, p3, d), h = pupil(st, N, d) / 2;
  // chief ray: angle halfField in object space, height at G1 chosen so it crosses the axis at G4
  const a = trace(L.slice(0, 3), 1, 0), b = trace(L.slice(0, 3), 0, 1), yAtStop = (y1, u) => { const ya = a.y + a.u * (d.p4 - a.x), yb = b.y + b.u * (d.p4 - b.x); return y1 * ya + u * yb; };
  const y1 = -yAtStop(0, halfField) / yAtStop(1, 0);
  return { marginal: [h, 0], chief: [y1, halfField], lenses: L, st };
}

// Depth of focus for a circle of confusion c: ±N·c; blur-circle diameter |Δ|/N.
export const depthOfFocus = (N, c) => N * c;
export const blur = (defocus, N) => Math.abs(defocus) / N;
export const FULL_FRAME = { w: 36, h: 24, coc: 0.03 };
export const halfAngle = (f, w = FULL_FRAME.w) => Math.atan(w / 2 / f);
