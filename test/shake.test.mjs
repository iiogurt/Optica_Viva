// Camera shake: reciprocal rule, stabiliser servo and gyro random walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShake, safeShutter, sharpProbability, stabilise, rng, pathPSF, blurOf } from '../js/lib/shake.js';

const D = Math.PI / 180, o = { sigma: D, tau: 0.25, tremor: 0.6 * D, ftrem: 10 };
const raw = makeShake(o, null, 1);

test('the safe shutter time scales as 1/f (reciprocal rule)', () => {
  const ft = [24, 50, 200].map((f) => f * safeShutter(raw, f, 0.03, 0.5, 100));
  for (const v of ft) assert.ok(v > 0.8 && v < 2.5, `f·t = ${v} mm·s (rule of thumb: 1)`);
  assert.ok(Math.max(...ft) / Math.min(...ft) < 1.6, `nearly constant f·t: ${ft}`);
  assert.ok(sharpProbability(raw, 50, 1e-4, 0.03) === 1 && sharpProbability(raw, 50, 1, 0.03) < 0.05, 'very short always sharp, 1 s never');
});

test('type-2 stabiliser servo: residual falls as (f/fc)², gyro random walk limits it', () => {
  const dt = 5e-4, n = 40000, r = rng(3), fsig = 2, th = Float64Array.from({ length: n }, (_, i) => 1e-3 * Math.sin(2 * Math.PI * fsig * i * dt));
  const res = stabilise(th, dt, 40, 0, r);
  let a = 0; for (let i = n / 2; i < n; i++) a = Math.max(a, Math.abs(res[i]));
  const expected = 1e-3 * (fsig / 40) ** 2;
  assert.ok(a > 0.5 * expected && a < 2 * expected, `residual amplitude ${a} vs (f/fc)² ${expected}`);
  const good = makeShake(o, { fc: 30, arw: 1e-4 }, 1), poor = makeShake(o, { fc: 30, arw: 1e-3 }, 1);
  const tr = safeShutter(raw, 50, 0.03, 0.5, 100), tg = safeShutter(good, 50, 0.03, 0.5, 100), tp = safeShutter(poor, 50, 0.03, 0.5, 100);
  assert.ok(Math.log2(tg / tr) > 4, `good gyro gains > 4 EV: ${Math.log2(tg / tr)}`);
  assert.ok(tp < tg, 'a noisier gyro gains less');
});

test('blur path PSF conserves energy and matches the path extent', () => {
  const n = 200, i0 = 5000, P = pathPSF(raw.tx, raw.ty, i0, n, 50, 63, 0.0044);
  let s = 0; for (const v of P) s += v;
  assert.ok(Math.abs(s - 1) < 0.02, `PSF sum ${s}`);
  const b = blurOf(raw.tx, raw.ty, i0, n, 50);
  assert.ok(b.extent >= 2 * b.rms * 0.9, 'extent ≥ ~2 × RMS radius');
});
