// Geometry for the 3-D views (js/lib/gl3d.js): pure functions returning indexed triangle meshes
// { positions, normals, indices } (Float32Array, Float32Array, Uint32Array) and polylines
// (arrays of [x, y, z] points). The optical axis is z; y is up.

// Surface of revolution about the z axis from a profile [[r, z], …] (r ≥ 0), with `seg`
// segments around. Normals come from the profile's tangent; the profile is walked as given, so
// its direction decides which side the normals face (a closed profile walked counter-clockwise in
// the r–z plane gives outward normals).
export function lathe(profile, seg = 64) {
  const n = profile.length, positions = new Float32Array(n * (seg + 1) * 3), normals = new Float32Array(n * (seg + 1) * 3), idx = [];
  for (let i = 0; i < n; i++) {
    const [r, z] = profile[i];
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
    // tangent (dr, dz) → normal (dz, −dr) in the r–z plane
    let nr = b[1] - a[1], nz = -(b[0] - a[0]);
    const L = Math.hypot(nr, nz) || 1; nr /= L; nz /= L;
    for (let j = 0; j <= seg; j++) {
      const t = (2 * Math.PI * j) / seg, c = Math.cos(t), s = Math.sin(t), k = (i * (seg + 1) + j) * 3;
      positions[k] = r * c; positions[k + 1] = r * s; positions[k + 2] = z;
      normals[k] = nr * c; normals[k + 1] = nr * s; normals[k + 2] = nz;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

// A lens element between two surfaces: z = z1 + sag1(r) for r ≤ r1 (front) and z = z2 + sag2(r)
// for r ≤ r2 (back), closed by a cylindrical (or conical) edge. sag(r) is the surface sag in mm.
// Each face is its own lathe, so the edges stay sharp (separate normals).
export function lensSolid(sag1, z1, r1, sag2, z2, r2, seg = 72, rings = 24) {
  const front = [], back = [];
  for (let i = 0; i <= rings; i++) { const r = (r1 * i) / rings; front.push([r, z1 + sag1(r)]); }
  for (let i = rings; i >= 0; i--) { const r = (r2 * i) / rings; back.push([r, z2 + sag2(r)]); }
  const rim = [[r1, z1 + sag1(r1)], [r2, z2 + sag2(r2)]];
  // the renderer lights both sides of every face, so the normals' sign does not matter here
  return merge([lathe(front, seg), lathe(back, seg), lathe(rim, seg)]);
}
// A thin reflecting surface (mirror) z = z0 + sag(r) for rIn ≤ r ≤ rOut, as a single sheet.
export function mirrorSheet(sag, z0, rOut, rIn = 0, seg = 72, rings = 24) {
  const p = [];
  for (let i = 0; i <= rings; i++) { const r = rIn + ((rOut - rIn) * i) / rings; p.push([r, z0 + sag(r)]); }
  return lathe(p, seg);
}
// Reverse the winding and the normals of a mesh.
export function flip(m) {
  const idx = m.indices.slice();
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const nrm = m.normals.map((v) => -v);
  return { positions: m.positions, normals: nrm, indices: idx };
}

// Concatenate meshes into one (with per-vertex colours when every mesh has them).
export function merge(list) {
  const nv = list.reduce((s, m) => s + m.positions.length, 0), ni = list.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  const colors = list.length && list.every((m) => m.colors) ? new Float32Array(nv) : null;
  let pv = 0, pi = 0;
  for (const m of list) {
    positions.set(m.positions, pv); normals.set(m.normals, pv);
    if (colors) colors.set(m.colors, pv);
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + pv / 3;
    pv += m.positions.length; pi += m.indices.length;
  }
  return colors ? { positions, normals, colors, indices } : { positions, normals, indices };
}

// Annulus in the plane z = z0 (normal −z towards incoming light), radii rIn…rOut.
export function annulus(rIn, rOut, z0, seg = 72) { return flip(lathe([[rIn, z0], [rOut, z0]], seg)); }

// The same mesh with every vertex coloured rgb (for merging coloured meshes).
export const tint = (m, rgb) => ({ ...m, colors: new Float32Array(Array.from({ length: m.positions.length / 3 }, () => rgb).flat()) });

// Axis-aligned box from corner a to corner b (flat-shaded faces), optionally coloured.
export function box(a, b, rgb = null) {
  const P = [], N = [], I = [];
  const faces = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, base = P.length / 3;
    for (const [su, sv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = [0, 0, 0]; p[ax] = sg < 0 ? a[ax] : b[ax]; p[u] = su ? b[u] : a[u]; p[v] = sv ? b[v] : a[v];
      const n = [0, 0, 0]; n[ax] = sg;
      P.push(...p); N.push(...n);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const m = { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I) };
  if (rgb) m.colors = new Float32Array(Array.from({ length: P.length / 3 }, () => rgb).flat());
  return m;
}

// Sphere of radius r at c.
export function sphere(r, c = [0, 0, 0], seg = 32, rings = 16) {
  const positions = [], normals = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j <= seg; j++) {
      const ph = (2 * Math.PI * j) / seg, nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      positions.push(c[0] + r * nx, c[1] + r * ny, c[2] + r * nz); normals.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(idx) };
}

// Rectangle centred at c spanned by unit vectors u, v with half-sizes a, b (normal u × v).
export function quad(c, u, v, a, b) {
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const P = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([s, t]) => [c[0] + s * u[0] + t * v[0], c[1] + s * u[1] + t * v[1], c[2] + s * u[2] + t * v[2]]);
  return { positions: new Float32Array(P.flat()), normals: new Float32Array([...n, ...n, ...n, ...n]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}

// Height field over [x0, x1] × [y0, y1] in the x–z plane with height y = f(x, z) (row-major nx × nz
// samples), with normals from central differences.
export function heightField(nx, nz, x0, x1, z0, z1, f) {
  const positions = new Float32Array(nx * nz * 3), normals = new Float32Array(nx * nz * 3), idx = [];
  const X = (i) => x0 + ((x1 - x0) * i) / (nx - 1), Z = (j) => z0 + ((z1 - z0) * j) / (nz - 1);
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = f(X(i), Z(j));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, h = (ii, jj) => H[Math.min(nz - 1, Math.max(0, jj)) * nx + Math.min(nx - 1, Math.max(0, ii))];
    const dx = (h(i + 1, j) - h(i - 1, j)) / (X(Math.min(nx - 1, i + 1)) - X(Math.max(0, i - 1)));
    const dz = (h(i, j + 1) - h(i, j - 1)) / (Z(Math.min(nz - 1, j + 1)) - Z(Math.max(0, j - 1)));
    const L = Math.hypot(dx, 1, dz);
    positions[k * 3] = X(i); positions[k * 3 + 1] = H[k]; positions[k * 3 + 2] = Z(j);
    normals[k * 3] = -dx / L; normals[k * 3 + 1] = 1 / L; normals[k * 3 + 2] = -dz / L;
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + nx; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { positions, normals, indices: new Uint32Array(idx) };
}

// Axis-aligned bounds of meshes and polylines: { min, max, centre, size }.
export function bounds(meshes = [], lines = []) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const add = (x, y, z) => { if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z; if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z; };
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) add(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
  for (const l of lines) for (const p of l) add(p[0], p[1], p[2]);
  const centre = min.map((v, i) => (v + max[i]) / 2), size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return { min, max, centre, size };
}

// Smooth vertex normals of an indexed mesh: the area-weighted sum of the adjacent faces' normals
// (degenerate faces add nothing; a vertex with none gets +y).
export function normalsFrom(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let k = 0; k < n.length; k += 3) {
    const L = Math.hypot(n[k], n[k + 1], n[k + 2]);
    if (L > 0) { n[k] /= L; n[k + 1] /= L; n[k + 2] /= L; } else n[k + 1] = 1;
  }
  return n;
}
