// Closed-form optics shared by laboratories and the test suite.

// ── Thin-lens depth of field (all lengths in the same unit, e.g. mm) ────────────────────
// Defocus blur diameter on the sensor for an object at d when focused at s.
export const blurDiameter = (f, N, s, d) => (f / N) * f * Math.abs(d - s) / (d * (s - f));
export const hyperfocal = (f, N, c) => (f * f) / (N * c) + f;
export function dofLimits(f, N, c, s) {
  const near = (s * f * f) / (f * f + N * c * (s - f));
  const den = f * f - N * c * (s - f);
  return { near, far: den > 0 ? (s * f * f) / den : Infinity };
}

// ── Tilted thin lens (Scheimpflug) in camera coordinates: y up, z forward, metres ───────
// The lens axis is tilted by α about x; the sensor sits at z = −v, refocused so that the
// sensor centre stays conjugate to distance s along the tilted axis.
export function tiltedLens(f, alphaDeg, s, N) {
  const a = (alphaDeg * Math.PI) / 180;
  const nL = [0, Math.sin(a), Math.cos(a)];
  const v = (f * s) / (s - f) / Math.cos(a);
  return { f, a, nL, v, A: f / N };
}
// object point → image point (null when the object is inside the focal length)
export function tiltedImage(G, p) {
  const u = p[1] * G.nL[1] + p[2] * G.nL[2];
  if (u <= G.f * 1.0001) return null;
  const up = (G.f * u) / (u - G.f), m = -up / u;
  const w = [p[0], p[1] - u * G.nL[1], p[2] - u * G.nL[2]];
  return [m * w[0], -up * G.nL[1] + m * w[1], -up * G.nL[2] + m * w[2]];
}
// image point → object point (the same law run backwards)
export function tiltedObject(G, q) {
  const up = -(q[1] * G.nL[1] + q[2] * G.nL[2]);
  if (up <= G.f * 1.0001) return null;
  const u = (G.f * up) / (up - G.f), m = -u / up;
  const w = [0, q[1] + up * G.nL[1], q[2] + up * G.nL[2]];
  return [0, u * G.nL[1] + m * w[1], u * G.nL[2] + m * w[2]];
}

// ── Cosmology: flat ΛCDM angular-diameter distance between z1 < z2 (Mpc) ─────────────────
export const C_KMS = 299792.458;
export function angularDiameterDistance(z1, z2, H0 = 70, Om = 0.3) {
  const E = (z) => Math.sqrt(Om * (1 + z) ** 3 + 1 - Om);
  const n = 400; let s = 0;
  for (let i = 0; i < n; i++) { const z = z1 + ((i + 0.5) * (z2 - z1)) / n; s += 1 / E(z); }
  return (C_KMS / H0) * s * ((z2 - z1) / n) / (1 + z2);
}
