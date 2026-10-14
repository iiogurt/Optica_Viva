// Lighting: a round area light (bare bulb to large softbox) on a head-sized sphere in front of a
// wall. Irradiance by quadrature over the light's disc with shadow rays (exact for a Lambertian
// emitter), mirror reflections of the light for catchlights, inverse-square falloff and flash
// exposure from the guide number. Pure functions; vectors are [x, y, z] in metres.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Penumbra on a wall a distance b behind an occluder of radius r lit by a source of diameter S at
// distance d (similar triangles): each soft edge is S b / d wide; the umbra shrinks to nothing when
// the source is larger than the occluder by enough.
export function shadowGeometry(S, d, b, r) {
  const pen = (S * b) / d;
  const umbra = 2 * r - ((S - 2 * r) * b) / d;
  const outer = 2 * r + ((S + 2 * r) * b) / d;
  return { pen, umbra: Math.max(0, umbra), outer };
}
export const stops = (ratio) => Math.log2(ratio);
// Flash: aperture for a correct exposure at distance d from the guide number (metres, ISO 100).
export const flashAperture = (GN, d, iso = 100) => (GN * Math.sqrt(iso / 100)) / d;
// Normal-incidence reflectance of a dielectric (skin and the cornea, n ≈ 1.376).
export const fresnel0 = (n) => ((n - 1) / (n + 1)) ** 2;

// A light: centre c, unit normal nl pointing at the scene, radius a, radiance L.
export function makeLight(dist, azDeg, elDeg, diameter, target = [0, 0, 0]) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const c = add(target, [dist * Math.sin(az) * Math.cos(el), dist * Math.sin(el), dist * Math.cos(az) * Math.cos(el)]);
  const nl = norm(sub(target, c));
  const u = norm(cross(Math.abs(nl[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], nl)), v = cross(nl, u);
  return { c, nl, u, v, a: diameter / 2 };
}
// Stratified points on the light's disc (concentric rings), weights = area fraction.
export function lightSamples(light, rings = 6, spin = 0) {
  const pts = [];
  for (let i = 0; i < rings; i++) {
    const rm = Math.sqrt((i + 0.5) / rings), k = 4 + 6 * i; // area-median radius of the ring
    for (let j = 0; j < k; j++) {
      const t = ((j + 0.5 * (i % 2) + spin) / k) * 2 * Math.PI, rr = rm * light.a;
      pts.push({ p: add(add(light.c, light.u, rr * Math.cos(t)), light.v, rr * Math.sin(t)), w: 1 / rings / k });
    }
  }
  return pts;
}
// Ray–sphere: distance along unit direction d from o, or Infinity.
export function hitSphere(o, d, centre, R) {
  const oc = sub(o, centre), b = dot(oc, d), c = dot(oc, oc) - R * R, disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s;
  return t0 > 1e-6 ? t0 : t1 > 1e-6 ? t1 : Infinity;
}
// Irradiance at point x with normal n from the light (radiance L = 1), with an optional occluding
// sphere: E = Σ L A w cos θ cos θ' / r² · V.
export function irradiance(x, n, light, samples, occ) {
  const A = Math.PI * light.a * light.a;
  let E = 0;
  for (const s of samples) {
    const dv = sub(s.p, x), r2 = dot(dv, dv), r = Math.sqrt(r2), dir = [dv[0] / r, dv[1] / r, dv[2] / r];
    const ci = dot(n, dir), co = -dot(light.nl, dir);
    if (ci <= 0 || co <= 0) continue;
    if (occ && hitSphere(x, dir, occ.c, occ.R) < r) continue;
    E += (A * s.w * ci * co) / r2;
  }
  return E;
}
// Exact on-axis irradiance of a Lambertian disc of radius a at distance d (radiance 1).
export const discOnAxis = (a, d) => (Math.PI * a * a) / (a * a + d * d);
// Does the ray from o along d hit the light's disc?
export function hitLight(o, d, light) {
  const den = dot(d, light.nl);
  if (den >= 0) return false;
  const t = dot(sub(light.c, o), light.nl) / den;
  if (t <= 0) return false;
  const q = sub(add(o, d, t), light.c);
  return dot(q, q) <= light.a * light.a;
}

// Render the scene seen from a camera on the +z axis: a sphere of radius R at the origin and a wall
// at z = −b. Returns linear radiance (albedo ρ, plus Fresnel mirror reflection of the light on the
// sphere when glossy), normalised so that the brightest diffuse point of the sphere is 1. Pixels
// on the sphere's outline are supersampled 3 × 3 so its edge is not jagged.
export function renderScene({ W = 200, H = 140, light, R = 0.1, b = 1.5, rho = 0.6, wallRho = 0.6, glossy = true, F0 = fresnel0(1.376), cam = 1.6, fov = 0.75, rings = 6 }) {
  // four rotated copies of the sample pattern, alternated between pixels, turn quadrature banding
  // in soft shadows into fine dither
  const sets = [0, 0.25, 0.5, 0.75].map((spin) => lightSamples(light, rings, spin)), occ = { c: [0, 0, 0], R };
  let samples = sets[0];
  const img = new Float32Array(W * H), spec = new Uint8Array(W * H);
  const o = [0, 0.02, cam];
  const ray = (i, j) => norm([((i / W) - 0.5) * fov, (0.5 - j / H) * fov * (H / W), -1]);
  const radiance = (d) => {
    const ts = hitSphere(o, d, occ.c, R);
    if (ts < Infinity) {
      const p = add(o, d, ts), n = norm(p);
      const diff = (rho / Math.PI) * irradiance(p, n, light, samples, null);
      let sp = 0;
      if (glossy) { const rd = add(d, n, -2 * dot(d, n)); if (hitLight(p, rd, light)) sp = F0; }
      return { diff, sp, sphere: true };
    }
    const tw = (-b - o[2]) / d[2], p = add(o, d, tw);
    return { diff: (wallRho / Math.PI) * irradiance(p, [0, 0, 1], light, samples, occ), sp: 0, sphere: false };
  };
  // which pixel centres see the sphere, to find its outline
  const onSphere = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) onSphere[j * W + i] = hitSphere(o, ray(i + 0.5, j + 0.5), occ.c, R) < Infinity ? 1 : 0;
  const diffuse = new Float32Array(W * H);
  let peak = 1e-12;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const edge = (i > 0 && onSphere[k - 1] !== onSphere[k]) || (i < W - 1 && onSphere[k + 1] !== onSphere[k]) || (j > 0 && onSphere[k - W] !== onSphere[k]) || (j < H - 1 && onSphere[k + W] !== onSphere[k]);
    const sub = edge ? 3 : 1;
    samples = sets[(i + 2 * j) & 3];
    let dsum = 0, ssum = 0;
    for (let b2 = 0; b2 < sub; b2++) for (let a2 = 0; a2 < sub; a2++) {
      const r = radiance(ray(i + (a2 + 0.5) / sub, j + (b2 + 0.5) / sub));
      dsum += r.diff; ssum += r.sp;
      if (r.sphere && !edge) peak = Math.max(peak, r.diff);
    }
    diffuse[k] = dsum / (sub * sub);
    img[k] = (dsum + ssum) / (sub * sub);
    if (ssum > 0) spec[k] = 1;
  }
  for (let k = 0; k < img.length; k++) img[k] /= peak;
  return { img, spec, peak, W, H };
}

// Angular diameter of the light seen from the subject; it sets how gradually the face turns from
// lit to shadow (the terminator) and how soft the shadow edges are.
export const angularSize = (S, d) => 2 * Math.atan(S / (2 * d));
// Catchlight: the cornea (radius ≈ 7.8 mm) is a convex mirror of focal length R/2, so a light of
// size S at distance d appears as a virtual image S (R/2)/d across.
export const catchlight = (S, d, Rc = 0.0078) => (S * (Rc / 2)) / d;
// How much darker the wall directly behind the subject is than the subject, in stops (inverse
// square from the light's centre; both surfaces facing the camera).
export function falloff(light, b) {
  const ds = Math.hypot(...light.c), wall = [0, 0, -b];
  const dw = Math.hypot(light.c[0] - wall[0], light.c[1] - wall[1], light.c[2] - wall[2]);
  const cs = light.c[2] / ds, cw = (light.c[2] + b) / dw; // cosine of incidence on surfaces facing +z
  return { ds, dw, stops: Math.log2(((cs / (ds * ds)) / (cw / (dw * dw)))) };
}
