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

test('wavefront and PSF surfaces: heights scale to the extremes; the PSF peak is the summit', async () => {
  const { wavefrontMesh, psfMesh } = await import('../js/lib/surf3d.js');
  const { TASKS } = await import('../js/lib/tasks.js');
  const r = TASKS.zernikeLab({ coeffs: { 8: 0.25 }, n: 128, Dpx: 32 }).result;
  const w = wavefrontMesh(r.W, r.n, r.Dpx, { height: 0.5 });
  let hi = -Infinity, lo = Infinity;
  for (let i = 1; i < w.mesh.positions.length; i += 3) { hi = Math.max(hi, w.mesh.positions[i]); lo = Math.min(lo, w.mesh.positions[i]); }
  near(Math.max(hi, -lo), 0.5, 1e-6, 'largest |W| drawn at the full height');
  assert.ok(w.wmax > 0.25 && w.wmax < 1, `coma 0.25 λ RMS peaks near ±${w.wmax.toFixed(2)} λ`);
  assert.equal(w.mesh.colors.length, w.mesh.positions.length, 'a colour per vertex');
  // a perfect lens: the peak sits on the axis (coma would move it)
  const r0 = TASKS.zernikeLab({ coeffs: {}, n: 128, Dpx: 32 }).result;
  const p = psfMesh(r0.I, r0.n, { crop: 32, height: 0.9, res: 32 });
  let top = 0, at = -1;
  for (let i = 1; i < p.positions.length; i += 3) if (p.positions[i] > top) { top = p.positions[i]; at = i; }
  near(top, 0.9, 0.02, 'the PSF peak reaches the full height');
  near(Math.hypot(p.positions[at - 1], p.positions[at + 1]), 0, 0.15, 'near the centre');
});

test('polarisation 3-D: the field tip is a flat wave for linear light and a helix of constant radius for circular', async () => {
  const { fieldTip, poincareScene } = await import('../js/lib/pol3d.js');
  const lin = fieldTip([1, 1, 0, 0], 0, 2), circ = fieldTip([1, 0, 0, 1], 0, 2);
  for (const p of lin) near(p[1], 0, 1e-12, 'horizontal linear light stays in the x–z plane');
  // same intensity: linear light peaks at √I, circular light keeps |E| = √(I/2) all along
  near(Math.max(...lin.map((p) => Math.abs(p[0]))), 1, 1e-3, 'linear amplitude √I');
  for (const p of circ) near(Math.hypot(p[0], p[1]), Math.SQRT1_2, 1e-12, 'circular |E| = √(I/2)');
  const half = fieldTip([0.5, 0, 0, 0.5], 0, 1);
  for (const p of half) near(Math.hypot(p[0], p[1]), 0.5, 1e-12, 'half the intensity: √(0.5/2)');
  const s = poincareScene([[1, 0, 0, 0], [0.5, 0.5, 0, 0], [0.5, 0, 0, 0.5]]);
  const centres = s.meshes.slice(1).map((m) => bounds([m.mesh]).centre);
  near(Math.hypot(...centres[0]), 0, 1e-3, 'unpolarised light at the centre');
  near(centres[1][0], 1, 1e-3, 'horizontal linear at S₁ = +1');
  near(centres[2][1], 1, 1e-3, 'circular at the pole S₃ = +1');
});

test('Scheimpflug 3-D: the plane of focus passes through the Scheimpflug line and the hinge line', async () => {
  const { planeOfFocus, scheimpflugScene, townScene } = await import('../js/lib/tilt3d.js');
  const { tiltedLens } = await import('../js/lib/optics.js');
  for (const st of [{ f: 65, alpha: 8, s: 52, N: 2.8 }, { f: 90, alpha: -3, s: 30, N: 8 }]) {
    const G = tiltedLens(st.f / 1000, st.alpha, st.s, st.N), L = planeOfFocus(st);
    const yAt = (z) => L.p[0] + ((z - L.p[1]) / L.d[1]) * L.d[0];
    near(yAt(-G.v), G.v / Math.tan(G.a), 1e-6, `Scheimpflug line (sensor ∩ lens plane) at α = ${st.alpha}°`);
    near(yAt(0), G.f / Math.sin(G.a), 1e-6, `hinge line J = f / sin α at α = ${st.alpha}°`);
    const s = scheimpflugScene(st);
    assert.ok(s.labels.some((l) => l.text.startsWith('hinge line')) && s.labels.some((l) => l.text === 'Scheimpflug line'));
  }
  assert.ok(townScene({ f: 65, alpha: 8, s: 52, N: 2.8 }).meshes.length >= 3, 'town, camera and plane of focus');
});

test('colour solid: optimal colours pair up to white, contain every real surface, and start on the spectral locus', async () => {
  const { optimalColours, colourSolidScene, LOCUS, gamutCoverage, samplesOutside } = await import('../js/lib/colour3d.js');
  const { daylight, blackbody, xyz, adapt, D65_XYZ } = await import('../js/lib/colorsci.js');
  const { TCS, ILLUMINANTS } = await import('../js/lib/colordata.js');
  for (const spd of [daylight(6504), blackbody(2856), ILLUMINANTS.HP1.spd]) {
    const ring = optimalColours(spd), N = ring[0].length, W = ring[N][0];
    for (const v of [0, 1, 2]) near(W[v], D65_XYZ[v], 1e-3, 'the white reflector maps to D65, Y = 100');
    // a band and its complement add up to white
    for (const [a, L] of [[0, 1], [10, 30], [70, 25], [40, 80]]) {
      const P = ring[L][a], Q = ring[N - L][(a + L) % N];
      for (const v of [0, 1, 2]) near(P[v] + Q[v], W[v], 1e-6, `band (${a}, ${L}) + complement`);
    }
    // the solid is a zonoid: its support in direction n is Σ max(0, n·c_i); every reflectance in
    // [0, 1] (the test colour samples) lies inside it
    const c = ring[1], Wsrc = xyz(spd), k = 100 / Wsrc[1];
    for (const n of [[1, 0, 0], [0, -1, 0], [0.3, -0.8, 0.5], [-0.6, 0.2, 0.77], [0.1, 0.1, -1]]) {
      const h = c.reduce((s, q) => s + Math.max(0, n[0] * q[0] + n[1] * q[1] + n[2] * q[2]), 0);
      for (const r of TCS) {
        const p = adapt(xyz(spd.map((s, i) => s * r[i])).map((q) => q * k), Wsrc.map((q) => q * k), D65_XYZ);
        assert.ok(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] <= h + 1e-6, 'test sample inside the optimal solid');
      }
    }
  }
  // under D65 the one-sample bands are monochromatic: on the spectral locus
  const one = optimalColours(daylight(6504))[1];
  for (let i = 10; i < 60; i += 7) { const [X, Y, Z] = one[i], s = X + Y + Z; near(X / s, LOCUS[i][0], 2e-3, `x at ${380 + 5 * i} nm`); near(Y / s, LOCUS[i][1], 2e-3, `y at ${380 + 5 * i} nm`); }
  assert.ok(gamutCoverage('srgb') < gamutCoverage('p3') && gamutCoverage('p3') < gamutCoverage('rec2020') && gamutCoverage('rec2020') < 1, 'gamuts nest by area');
  assert.equal(samplesOutside(daylight(6504), 'rec2020'), 0, 'Rec. 2020 shows all 14 test colours in daylight');
  const s = colourSolidScene(daylight(6504), 'p3');
  const solid = s.meshes[0].mesh;
  assert.equal(solid.colors.length, solid.positions.length, 'a colour per vertex');
  unitNormals(solid); indicesValid(solid);
  near(bounds([solid]).max[1], 1.3, 1e-6, 'white at the top of the solid');
  assert.equal(s.meshes.filter((m) => !m.glass && m.opacity === undefined).length, 14, 'the 14 test colour samples');
});

test('depth-of-field 3-D: the frustum matches the photograph, and cards are green exactly inside the sharp zone', async () => {
  const { dofScene, section, sceneDepth, CARDS, CAM_H, HORIZON } = await import('../js/lib/dof3d.js');
  const { dofLimits, blurDiameter } = await import('../js/lib/optics.js');
  const sen = { w: 36, h: 24 };
  // cross-section at 10 m for 50 mm: 7.2 m wide; the bottom edge meets the ground where the
  // photograph's lowest row sees it, Z = h_c f / ((1 − horizon) h)
  const q = section(sen, 50, 10);
  near(q[1][0] - q[0][0], 7.2, 1e-9, 'width at 10 m');
  near(q[0][1], (10 * HORIZON * 24) / 50, 1e-9, 'top edge (shifted framing)');
  const zGround = (CAM_H * 50) / ((1 - HORIZON) * 24), g = section(sen, 50, zGround);
  near(g[3][1], -CAM_H, 1e-9, 'bottom edge reaches the ground');
  for (const [f, N, s] of [[85, 1.8, 2200], [24, 11, 4000], [200, 4, 20000]]) {
    const c = 0.029, { near: Dn, far: Df } = dofLimits(f, N, c, s);
    const sc = dofScene({ sen, f, N, s, c, Dn, Df }), D = sceneDepth(s / 1000, Df / 1000);
    const slab = sc.meshes.find((m) => m.glass && m.opacity === 0.16), z = [];
    for (let i = 2; i < slab.mesh.positions.length; i += 3) z.push(slab.mesh.positions[i]);
    near(Math.min(...z), Dn / 1000, 1e-6, `sharp zone starts at the near limit (f = ${f})`);
    near(Math.max(...z), Math.min(Df / 1000, D), 1e-6, 'and ends at the far limit or the scene depth');
    const fp = sc.meshes.find((m) => m.glass && m.opacity === 0.2);
    near(fp.mesh.positions[2], s / 1000, 1e-6, 'plane of focus at s');
    // the cards drawn (boxes with a colour per vertex, past the camera) are sharp iff blur ≤ c
    const cards = sc.meshes.filter((m) => m.mesh.colors && m.mesh.positions[2] > 0.3);
    assert.ok(cards.length >= 2, 'cards drawn');
    for (const k of cards) {
      const d = (k.mesh.positions[2] + 0.01) * 1000, gold = k.color[0] === 1 && k.color[1] === 0.71;
      if (gold) continue;
      const sharp = k.color[0] === 0.42 && k.color[1] === 0.89;
      assert.equal(sharp, blurDiameter(f, N, s, d) <= c, `card at ${d / 1000} m`);
      assert.ok(CARDS.some((x) => Math.abs(x * 1000 - d) < 0.01), 'a card from the photograph (float32 positions)');
    }
  }
  assert.ok(sceneDepth(100, 120) >= 100, 'a focus at 100 m stays in the scene');
});

test('projection 3-D: rectilinear is central projection onto the tangent plane, the field edge maps back to the sensor, circles drawn on the sensor only', async () => {
  const { tissotCircles, forward } = await import('../js/lib/projection.js');
  const { projectionScene, fieldEdge, onSensor } = await import('../js/lib/projection3d.js');
  const f = 10;
  // rectilinear: the image of a direction d is where the ray from the centre through d meets z = f
  for (const t of tissotCircles('rectilinear', f, 0, 0).filter((t) => t.img)) {
    const d = t.centre;
    assert.ok(Math.abs(t.img[0][0] - (f * d[0]) / d[2]) < 1e-9 && Math.abs(t.img[0][1] - (f * d[1]) / d[2]) < 1e-9);
  }
  // the field edge: each direction on it maps back onto the sensor outline
  const sw = 36, sh = 24;
  for (const [proj, fl] of [['rectilinear', 14], ['equisolid', 12], ['panini', 10]]) {
    const runs = fieldEdge(proj, fl, sw, sh);
    assert.ok(runs.length >= 1);
    for (const d of runs.flat()) {
      const [x, y] = forward(proj, d, fl);
      assert.ok(Math.abs(Math.abs(x) - sw / 2) < 1e-6 || Math.abs(Math.abs(y) - sh / 2) < 1e-6, `${proj}: ${x}, ${y} is not on the outline`);
    }
  }
  // the scene: the sphere has radius f, the image plane lies at z = f, and only circles that land on
  // the sensor are drawn there
  const sc = projectionScene({ proj: 'rectilinear', f: 14, sw, sh, yaw: 0, pitch: 0 });
  const sph = sc.meshes[0].mesh.positions;
  for (let i = 0; i < sph.length; i += 3) assert.ok(Math.abs(Math.hypot(sph[i], sph[i + 1], sph[i + 2]) - 14) < 1e-4);
  const image = sc.meshes.at(-1).mesh.positions;
  for (let i = 0; i < image.length; i += 3) {
    assert.ok(Math.abs(image[i + 2] - 14) < 0.05);
    assert.ok(onSensor([image[i], image[i + 1]], sw, sh));
  }
});

test('lensing 3-D: every light path ends on the source, bends at the lens by the deflection, and the ring cone opens at θE', async () => {
  const { images, deflect } = await import('../js/lib/lensing.js');
  const { lensingScene, comoving, toScene } = await import('../js/lib/lensing3d.js');
  const P = { model: 'sie', b: 1.4, q: 0.7, pa: 0.5, gamma: 0.04, gpa: 1.7 }, src = [0.12, 0.06], zl = 0.3, zs = 2;
  const ims = images(P, src), sc = lensingScene({ P, zl, zs, src, R: 0.45, images: ims });
  const cl = comoving(zl), cs = comoving(zs), S = toScene(src[0], src[1], cs);
  const paths = sc.lines.filter((l) => l.points.length === 3 && l.points[0].every((v) => v === 0));
  assert.equal(paths.length, ims.length);
  paths.forEach(({ points: [, L, E] }, i) => {
    for (let a = 0; a < 3; a++) near(E[a], S[a], 1e-12, 'ends on the source');
    near(L[2], cl, 1e-12, 'bends in the lens plane');
    // slopes of the two legs (scene units per Gpc) differ by (χs/χls) α(θ), scaled like every angle
    const [ax, ay] = deflect(P, ims[i].x, ims[i].y), k = toScene(1, 1, 1);
    for (const [c, alpha] of [[0, ax * k[0]], [1, ay * k[1]]]) near(L[c] / cl - (E[c] - L[c]) / (cs - cl), (cs / (cs - cl)) * alpha, 1e-9, 'bend');
  });
  const ring = sc.lines.find((l) => l.points.length === 73);
  near(Math.hypot(ring.points[0][0], ring.points[0][1]), Math.abs(toScene(P.b, 0, cl)[0]), 1e-9, 'Einstein ring radius');
});

test('interferometry 3-D: the turning Earth projected onto the u-v plane reproduces the coverage of every array', async () => {
  const { ARRAYS, uvCoverage } = await import('../js/lib/interferometry.js');
  const { uvAt, hourAngles, skyAxes, stations, interfScene } = await import('../js/lib/interf3d.js');
  for (const [key, decDeg, hours] of [['eht', 12.39, 24], ['vla', 40, 8], ['vlti', -30, 6]]) {
    const arr = ARRAYS[key], dec = (decDeg * Math.PI) / 180;
    const got = uvCoverage(arr, dec, hours, 48).filter((_, i) => i % 2 === 0), mine = [];
    for (const H of hourAngles(arr, hours, 48)) for (const p of uvAt(arr, dec, H)) if (p.visible) mine.push([p.u, p.v]);
    assert.equal(mine.length, got.length, `${key}: number of u-v points`);
    got.forEach(([u, v], i) => near(Math.hypot(u - mine[i][0], v - mine[i][1]), 0, 1e-9 * Math.hypot(u, v), `${key}: u-v point ${i}`));
    // local arrays are drawn enlarged; the u-v points above are in wavelengths of the true array
    if (!arr.geo) assert.ok(stations(arr).k > 100, `${key}: enlarged`);
  }
  // the u-v plane is perpendicular to the source, u points east and v towards the pole
  for (const d of [-0.7, 0, 0.2, 1.1]) {
    const { s, u, v } = skyAxes(d), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    near(dot(s, u), 0, 1e-15, 's·u'); near(dot(s, v), 0, 1e-15, 's·v'); near(dot(u, v), 0, 1e-15, 'u·v');
    assert.ok(v[2] > 0, 'v towards the north pole');
  }
  // the scene: the Earth has unit radius and the source arrow leaves the plane along s
  const sc = interfScene({ array: 'eht', dec: 12, hours: 12, H: 1.5 });
  const E = sc.meshes[0].mesh.positions;
  for (let i = 0; i < E.length; i += 3) near(Math.hypot(E[i], E[i + 1], E[i + 2]), 1, 1e-6, 'Earth radius');
});

test('Earth observation 3-D: the satellite flies at H, the swath is pixels × GSD, the strip is a minute of ground track', async () => {
  const { design, RE } = await import('../js/lib/earthobs.js');
  const { earthobsScene, onSphere } = await import('../js/lib/earthobs3d.js');
  const d = { H: 786e3, D: 0.15, f: 0.6, p: 7.5e-6 }, r = design(d);
  const sc = earthobsScene({ H: d.H, gsd: r.gsd, v: r.v, ground: r.ground });
  const R = RE / 1e6, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // the satellite marker sits at the orbit height above nadir
  const sat = sc.meshes[1].mesh.positions;
  let cy = 0; for (let i = 1; i < sat.length; i += 3) cy += sat[i];
  near(cy / (sat.length / 3), d.H / 1e6, 1e-6, 'satellite height (Mm)');
  // the detector line's footprint (the thickest line) spans 12 000 pixels × GSD
  const foot = sc.lines.reduce((a, l) => ((l.width || 0) > (a.width || 0) ? l : a));
  near(dist(...foot.points) * 1e6, 12000 * r.gsd, 1, 'swath (m)');
  // the strip's edges run along the ground for ground speed × 60 s, on the Earth's surface
  const edge = sc.lines.find((l) => l.points.length === 49);
  let len = 0; for (let i = 1; i < edge.points.length; i++) len += dist(edge.points[i], edge.points[i - 1]);
  near(len * 1e6, r.ground * 60, r.ground * 60 * 1e-3, 'strip length (m)');
  for (const p of edge.points) near(Math.hypot(p[0], p[1] + R, p[2]), R + 0.0015, 1e-9, 'on the ground');
  near(dist(onSphere(0, 0), [0, 0, 0]), 0, 1e-12, 'nadir at the origin');
});

test('transit 3-D: the planet crosses the sight lines at impact parameter b, and the chord lasts T14', async () => {
  const { orbit, REARTH, DAY } = await import('../js/lib/transit.js');
  const { transitScene, planetAt } = await import('../js/lib/transit3d.js');
  for (const b of [0, 0.51, 0.9]) {
    const o = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 15.2 * REARTH, b });
    const P0 = planetAt(0, o.aR, o.inc);
    near(Math.hypot(P0[0], P0[1]), b, 1e-12, 'projected distance at mid-transit');
    assert.ok(P0[2] < 0, 'in front of the star');
    near(Math.hypot(...P0), o.aR, 1e-9, 'orbit radius');
    // the chord's ends (projected distance 1 + k) lie T14/2 either side of mid-transit
    const phi = (Math.PI * o.T14) / (3.5247 * DAY), E = planetAt(phi, o.aR, o.inc);
    near(Math.hypot(E[0], E[1]), 1 + o.k, 1e-9, 'first/fourth contact');
    const sc = transitScene({ aR: o.aR, inc: o.inc, k: o.k, b });
    const chord = sc.lines.find((l) => (l.width || 0) === 2.4);
    for (const p of chord.points) assert.ok(Math.hypot(p[0], p[1]) < 1 + o.k && p[2] < 0);
  }
  const miss = orbit({ P: 3.5247, Mstar: 1.12, Rstar: 1.16, Rp: 15.2 * REARTH, b: 1.2 });
  assert.ok(!transitScene({ aR: miss.aR, inc: miss.inc, k: miss.k, b: 1.2 }).lines.some((l) => (l.width || 0) === 2.4), 'no chord when the planet misses');
});
