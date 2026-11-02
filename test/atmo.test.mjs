// Atmospheric optics: halo geometry, the Monte-Carlo halo, and Lorenz–Mie scattering by drops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nIce, nWater, minDeviation, rainbowAngle, parhelion, circumzenithal, haloImage, HALO_FOV, mie, logDerivCF, dropProfiles, coronaAngles, antiAngles, sunSmear } from '../js/lib/atmo.js';

const D = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('ice and water indices: Warren & Brandt and the usual water values', () => {
  near(nIce(589), 1.3098, 2e-4, 'ice at 589 nm'); near(nIce(400), 1.3194, 2e-4, 'ice at 400 nm');
  assert.ok(nIce(400) > nIce(700), 'ice is normally dispersive');
  near(nWater(589), 1.3331, 2e-4, 'water at 589 nm');
});

test('halo, rainbow, sundog and circumzenithal-arc geometry', () => {
  near(minDeviation(60 * D, 1.31) / D, 21.84, 0.01, '22° halo, n = 1.31');
  near(minDeviation(90 * D, 1.31) / D, 45.73, 0.01, '46° halo, n = 1.31');
  near(rainbowAngle(1.333, 1), 42.08, 0.01, 'primary rainbow');
  near(rainbowAngle(1.333, 2), 50.89, 0.01, 'secondary rainbow');
  // with the Sun on the horizon the sundogs coincide with the 22° halo and move out as it climbs
  near(parhelion(1.31, 0).daz, minDeviation(60 * D, 1.31) / D, 1e-9, 'sundog at h = 0');
  assert.ok(parhelion(1.31, 30 * D).daz > parhelion(1.31, 10 * D).daz);
  // the circumzenithal arc exists only while cos h > √(n² − 1)
  const limit = Math.acos(Math.sqrt(1.31 ** 2 - 1)) / D;
  near(limit, 32.2, 0.01, 'CZA limit');
  assert.ok(circumzenithal(1.31, (limit - 0.1) * D) && !circumzenithal(1.31, (limit + 0.1) * D));
});

test('Monte-Carlo halo: randomly oriented crystals light a ring with a sharp inner edge at 22°', () => {
  const N = 200, H = haloImage({ N, rays: 150000, seed: 5, h: 30 * D, mix: { random: 1, plate: 0, column: 0 } });
  const rad = new Float64Array(40);
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const x = ((ix + 0.5) / N * 2 - 1) * HALO_FOV, y = (1 - (iy + 0.5) / N * 2) * HALO_FOV, r = Math.hypot(x, y);
    if (r >= 2 && r < 40) rad[Math.floor(r)] += H.Y[iy * N + ix] / (2 * Math.PI * (Math.floor(r) + 0.5));
  }
  const inside = (rad[15] + rad[16] + rad[17] + rad[18] + rad[19]) / 5, peak = Math.max(...rad.slice(20, 30));
  const ip = rad.indexOf(peak);
  assert.ok(ip >= 21 && ip <= 23, `ring peak at ${ip}°`);
  assert.ok(peak > 4 * inside, `the ring (${peak}) stands out above the darker sky inside it (${inside})`);
});

test('Mie theory: Rayleigh limit, extinction paradox, rainbow and corona', () => {
  // small spheres: Q_sca = (8/3) x⁴ |(m² − 1)/(m² + 2)|², and forward/side intensity ratio 2 (1 + cos²θ)
  const x = 0.05, m = 1.33, r = mie(x, m, [1, 0]);
  near(r.qsca / ((8 / 3) * x ** 4 * ((m * m - 1) / (m * m + 2)) ** 2), 1, 1e-3, 'Rayleigh Q_sca');
  near(r.I[0] / r.I[1], 2, 0.01, 'Rayleigh 1 + cos²θ');
  // large spheres remove twice their geometric cross-section; van de Hulst: 2 + 1.99 x^(−2/3)
  const big = mie(1000, 1.33, [1]);
  near(big.qext, 2 + 1.992 * 1000 ** (-2 / 3), 0.01, 'extinction paradox');
  near(big.qsca, big.qext, 1e-6, 'no absorption: Q_sca = Q_ext');
  // 200 µm drops: the brightest part of the primary bow lies just inside the geometric angle (Airy)
  const lam = 550, k = (2 * Math.PI) / (lam * 1e-3), th = Array.from({ length: 300 }, (_, i) => 125 + i * 0.05);
  const rb = mie(k * 200, nWater(lam), th.map((q) => Math.cos(q * D)));
  let best = 0;
  th.forEach((q, i) => { if (q > 132 && rb.I[i] > rb.I[best]) best = i; });
  const radius = 180 - th[best], geo = rainbowAngle(nWater(lam), 1);
  assert.ok(radius < geo && geo - radius < 1, `Mie bow ${radius}° inside the geometric ${geo}°`);
  // 10 µm droplets: first corona minimum near the Fraunhofer value 1.22 λ/(2a)
  const tc = Array.from({ length: 400 }, (_, i) => i * 0.01), c = mie(k * 10, 1.333, tc.map((q) => Math.cos(q * D)));
  let mi = -1;
  for (let i = 5; i < 399 && mi < 0; i++) if (c.I[i] < c.I[i - 1] && c.I[i] < c.I[i + 1]) mi = i;
  near(tc[mi], (1.22 * 0.55) / 20 / D, 0.07 * 1.92, 'first corona minimum');
});

test('drop profiles cover both views, and the solar disc only smooths', () => {
  const p = dropProfiles(550, 20, 0.05);
  assert.equal(p.corona.length, coronaAngles().length); assert.equal(p.anti.length, antiAngles().length);
  assert.ok(p.corona[0] > 100 * p.anti[0], 'forward scattering dominates');
  const spike = new Float64Array(101); spike[50] = 1;
  const s = sunSmear(spike, 0.05);
  near(s.reduce((a, b) => a + b, 0), 1, 1e-9, 'the smear conserves light');
  assert.ok(s[50] < 1 && s[47] > 0 && s[44] === 0, 'spread over the 0.27° solar radius only');
});

// Independent references for i(θ) = (|S1|² + |S2|²)/2, the same n_stop = x + 4x^(1/3) + 2 terms:
// Bohren & Huffman eq. 4.53 at 40 digits (mpmath), with ψ_n(mx) by Miller's normalised downward
// recurrence from far above (no logarithmic derivative), spot-checked against J_{n+1/2}.
// θ = 180, 179.5, 175, 165, 142, 138, 90, 30°.
const MIE_REF = [
  [100, 1.333, [618.092808901, 628.893420726, 831.208441487, 572.29941559, 1125.11237818, 844.213752938, 95.4352400602, 5527.04366651]],
  [500, 1.333, [24906.901862, 27490.5418058, 9326.21708571, 10422.5129231, 13016.3020794, 30070.3814782, 2969.13104951, 277177.483253]],
  [1000, 1.333, [873619.056279, 32179.2621207, 59953.1878562, 19896.1302084, 36913.9992286, 192476.210799, 9473.83443275, 940420.73678]],
  [2000, 1.333, [24850.3491837, 139492.7871, 47770.7629687, 150662.095913, 216799.29337, 805845.210722, 23046.0148167, 4154410.68589]],
  [2000, 1.3363164591706695, [55472.6942053, 30372.2189446, 58119.1685416, 180835.424885, 538125.897899, 352982.539323, 23808.386171, 3089883.33449]],
];
const MIE_TH = [180, 179.5, 175, 165, 142, 138, 90, 30];

test('Mie angular scattering of large drops matches independent references (backscatter, glory, rainbow, side)', () => {
  const muOf = (th) => (th === 180 ? -1 : th === 90 ? 0 : Math.cos(th * D));
  for (const [x, m, I] of MIE_REF) {
    const r = mie(x, m, MIE_TH.map(muOf));
    I.forEach((v, j) => near(r.I[j] / v, 1, 1e-8, `x = ${x}, m = ${m}, θ = ${MIE_TH[j]}°`));
  }
  // the values of the validation report (#208), from SciPy's spherical Bessel functions
  const r = mie(2000, 1.333, [-1, -0.99, 0]);
  [24850.349182, 40184.942908, 23046.014817].forEach((v, j) => near(r.I[j] / v, 1, 1e-8, `report value ${j}`));
});

test('Mie logarithmic derivative: the continued fraction and downward recurrence agree over the supported drops', () => {
  // radii 1–300 µm (×1.2 for the size spread) at 405–705 nm: x up to about 5600
  for (const x of [0.05, 3, 20, 80, 300, 1000, 2500, 5600]) for (const m of [1.331, 1.345]) {
    const nstop = Math.round(x + 4 * Math.cbrt(x) + 2), z = m * x, Dn = new Float64Array(nstop + 1);
    Dn[nstop] = logDerivCF(nstop, z);
    for (let n = nstop; n > 1; n--) Dn[n - 1] = n / z - 1 / (Dn[n] + n / z);
    for (const n of [1, Math.ceil(nstop / 3), Math.ceil((3 * nstop) / 4)]) {
      const d = logDerivCF(n, z);
      near(Dn[n], d, 1e-10 * Math.max(1, Math.abs(d)), `x = ${x}, m = ${m}, n = ${n}`);
    }
  }
  // D_1(z) = −1/z + 1/(1/z − cot z) in closed form
  for (const z of [0.3, 2, 17.5]) near(logDerivCF(1, z), -1 / z + 1 / (1 / z - 1 / Math.tan(z)), 1e-12, `D_1(${z})`);
});
