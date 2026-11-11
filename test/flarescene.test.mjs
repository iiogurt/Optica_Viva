import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScene, radiance, aces, HORIZON } from '../js/lib/flarescene.js';

test('flare scene: finite non-negative radiance, the brightest sky round the sun, a mirroring lake', () => {
  const S = makeScene(), o = [0, 0, 0], sun = [0.68, 0.3], asp = 1.5;
  let peak = 0, at = null;
  for (let j = 0; j < 60; j++) for (let i = 0; i < 90; i++) {
    const u = (i + 0.5) / 90, v = (j + 0.5) / 60;
    radiance(S, u, v, sun[0], sun[1], asp, o);
    for (const c of o) assert.ok(Number.isFinite(c) && c >= 0, `radiance at ${u}, ${v}`);
    if (v < HORIZON && o[1] > peak) { peak = o[1]; at = [u, v]; }
  }
  assert.ok(Math.hypot((at[0] - sun[0]) * asp, at[1] - sun[1]) < 0.05, `sky brightest at the sun, found ${at}`);
  // far from the glitter path the lake shows the scene above, dimmed by the water's reflectance
  const up = [...radiance(S, 0.12, HORIZON - 0.2, ...sun, asp, o)], dn = [...radiance(S, 0.12, HORIZON + 0.2, ...sun, asp, o)];
  for (let c = 0; c < 3; c++) assert.ok(dn[c] < up[c] && dn[c] > 0.15 * up[c], `reflection, channel ${c}: ${dn[c]} vs ${up[c]}`);
  // the near ridge is far darker than the sky low over the hills
  const sky = radiance(S, 0.3, 0.5, ...sun, asp, o)[1], rock = radiance(S, 0.3, HORIZON - 0.006, ...sun, asp, o)[1];
  assert.ok(rock < 0.2 * sky, `foreground ${rock} against sky ${sky}`);
  // the same seed gives the same scene
  assert.deepEqual(radiance(makeScene(), 0.4, 0.5, ...sun, asp, [0, 0, 0]), radiance(S, 0.4, 0.5, ...sun, asp, [0, 0, 0]));
});

test('filmic tone curve: 0 → 0, rising, saturating at 1', () => {
  assert.equal(aces(0), 0); assert.equal(aces(100), 1);
  let last = 0;
  for (let x = 0.01; x < 20; x *= 1.2) { const y = aces(x); assert.ok(y >= last); last = y; }
  assert.ok(aces(0.18) > 0.2 && aces(0.18) < 0.35, 'mid grey stays mid-dark');
});
