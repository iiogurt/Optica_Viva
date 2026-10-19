// Geometry for the 3-D views (js/lib/mesh3d.js) and the ray tracer's 3-D scene (js/lib/lens3d.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lathe, lensSolid, sphere, quad, heightField, merge, bounds } from '../js/lib/mesh3d.js';
import { lensScene } from '../js/lib/lens3d.js';
import { LENSES, paraxial, autoSemiDiameters } from '../js/lib/raytrace.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e} ± ${tol}`);
const unitNormals = (m) => { for (let i = 0; i < m.normals.length; i += 3) near(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]), 1, 1e-5, 'unit normal'); };
const indicesValid = (m) => { const n = m.positions.length / 3; for (const i of m.indices) assert.ok(i < n, 'index in range'); };

test('lathe: rings × segments vertices, two triangles per quad, unit normals', () => {
  const m = lathe([[0, 0], [5, 1], [10, 4]], 32);
  assert.equal(m.positions.length / 3, 3 * 33);
  assert.equal(m.indices.length / 3, 2 * 2 * 32);
  unitNormals(m); indicesValid(m);
  near(bounds([m]).max[0], 10, 1e-6, 'outer radius');
});

test('lens solid follows its sags and closes at the edge', () => {
  const R1 = 50, R2 = -80, sag = (R) => (r) => R - Math.sign(R) * Math.sqrt(R * R - r * r);
  const m = lensSolid(sag(R1), 0, 12, sag(R2), 6, 12);
  const b = bounds([m]);
  near(b.min[2], 0, 1e-6, 'front vertex'); near(b.max[2], 6, 1e-6, 'back vertex');
  near(b.max[0], 12, 1e-6, 'edge radius');
  unitNormals(m); indicesValid(m);
});

test('sphere, quad, height field and merge', () => {
  const s = sphere(2, [1, 2, 3]);
  for (let i = 0; i < s.positions.length; i += 3) near(Math.hypot(s.positions[i] - 1, s.positions[i + 1] - 2, s.positions[i + 2] - 3), 2, 1e-5, 'on the sphere');
  unitNormals(s);
  const q = quad([0, 0, 5], [1, 0, 0], [0, 1, 0], 3, 2);
  assert.deepEqual([...q.normals.slice(0, 3)], [0, 0, 1]);
  const hf = heightField(21, 21, -1, 1, -1, 1, (x, z) => x * x + z * z);
  unitNormals(hf);
  near(bounds([hf]).max[1], 2, 1e-6, 'height at the corners');
  const m = merge([q, hf]);
  assert.equal(m.positions.length, q.positions.length + hf.positions.length);
  indicesValid(m);
});

test('ray tracer scene: real rays end on the image plane; a mirror stop has no iris ring', () => {
  const L = LENSES.cooke, par = paraxial(L), sd = autoSemiDiameters(L);
  const s = lensScene(L, { sd, par, zImg: par.zImage, fields: [0, L.field] });
  const rays = s.lines.filter((l) => l.width > 1);
  assert.ok(rays.length >= 2 * 20, `${rays.length} rays`);
  const ending = rays.filter((l) => Math.abs(l.points.at(-1)[2] - par.zImage) < 1e-6);
  assert.ok(ending.length >= rays.length * 0.9, 'nearly all rays reach the image plane (a few are vignetted)');
  assert.ok(s.frame && s.frame.size > 0, 'camera frame');
  assert.equal(s.meshes.filter((m) => m.glass && m.opacity === 0.2).length, 3, 'three glass elements');
  const T = LENSES.tma, pt = paraxial(T), st = lensScene(T, { sd: autoSemiDiameters(T), par: pt, zImg: pt.zImage, fields: [0] });
  assert.equal(st.meshes.filter((m) => !m.glass && m.opacity === undefined).length, 0, 'no opaque iris ring for the mirror stop');
});
