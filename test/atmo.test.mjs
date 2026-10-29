// Atmospheric optics: halo geometry, the Monte-Carlo halo, and Lorenz–Mie scattering by drops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nIce, nWater, minDeviation, rainbowAngle, parhelion, circumzenithal, haloImage, HALO_FOV, mie, dropProfiles, coronaAngles, antiAngles, sunSmear } from '../js/lib/atmo.js';

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
