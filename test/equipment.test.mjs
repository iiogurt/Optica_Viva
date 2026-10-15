// Equipment presets: pixel pitches derived from sensor size and pixel count match the makers'
// published values, and presets feed the missions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERAS, TELESCOPES, ASTROCAMS, pitchOf, resolveCamera, cameraOptions } from '../js/lib/equipment.js';
import { plan } from '../js/lib/milkyway.js';
import { camera } from '../js/lib/choose.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('derived pixel pitches match published ones', () => {
  for (const [k, p] of [['a7iv', 5.12], ['a7siii', 8.4], ['r5', 4.39], ['z8', 4.35], ['gfx100ii', 3.76], ['xt5', 3.04], ['r7', 3.2], ['rx100', 2.4]]) near(pitchOf(CAMERAS[k]), p, 0.06, k);
});

test('presets are complete and resolvable', () => {
  for (const t of Object.values(TELESCOPES)) assert.ok(t.D > 0 && t.f > t.D, t.name);
  for (const c of Object.values(ASTROCAMS)) assert.ok(c.pitch > 1 && c.pitch < 10, c.name);
  assert.equal(resolveCamera('cam:r5').mp, 45);
  assert.equal(resolveCamera('ff').w, 36);
  assert.ok(cameraOptions(['ff']).length === 1 + Object.keys(CAMERAS).length);
});

test('missions accept a real camera', () => {
  near(plan({ sensor: CAMERAS.r5 }).pitch, 4.39, 0.02, 'Milky Way plan with an EOS R5');
  near(camera({ sensor: CAMERAS.xt5, N: 2, mp: 40.2 }, { Feq: 50, s: 3 }).k, 1.53, 0.01, 'X-T5 crop factor');
});
