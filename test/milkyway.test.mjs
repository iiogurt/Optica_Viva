// Mission "Photograph the Milky Way": trailing limit, published rules, ISO invariance and frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailLimit, rule500, ruleNPF, invarianceISO, readNoise, plan, SIDEREAL } from '../js/lib/milkyway.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('sidereal rate is one turn per sidereal day', () => near(SIDEREAL, (2 * Math.PI) / 86164.1, 1e-8, 'ω'));

test('trailing limit: two pixels at fω cos δ, halved by doubling the focal length', () => {
  const a = trailLimit(20, 2.8, 4.4, -29);
  near(a.t, 0.0088 / (20 * SIDEREAL * Math.cos((29 * Math.PI) / 180)), 1e-9, '20 mm at −29°');
  near(a.t, 6.9, 0.05, 'about 7 s');
  near(trailLimit(40, 2.8, 4.4, -29).t, a.t / 2, 1e-9, 'twice the focal length');
  near(trailLimit(20, 2.8, 4.4, 0).t, a.t * Math.cos((29 * Math.PI) / 180), 1e-9, 'equator is the worst case');
  // at f/8 the Airy diameter (10.7 µm) exceeds two 4.4 µm pixels and sets the allowed trail
  near(trailLimit(20, 8, 4.4, 0).allowed, 2.44 * 0.55e-3 * 8, 1e-12, 'Airy-limited');
});

test('500 and NPF rules as published', () => {
  near(rule500(20, 1), 25, 1e-12, '500 rule');
  near(rule500(20, 1.5), 500 / 30, 1e-12, '500 rule with crop');
  near(ruleNPF(20, 2.8, 4.4), (35 * 2.8 + 30 * 4.4) / 20, 1e-12, 'NPF');
});

test('ISO invariance: read noise within 10 % of the pre-amplifier floor', () => {
  const iso = invarianceISO(1.6, 12);
  near(readNoise(iso, 1.6, 12), 1.1 * 1.6, 1e-9, 'definition');
  assert.ok(readNoise(iso / 4, 1.6, 12) > 1.5 * 1.6, 'two stops lower is much noisier');
});

test('frames reach the target SNR, and a brighter sky needs more of them', () => {
  const r = plan({ bortle: 4, mu: 23 });
  assert.ok(Math.sqrt(r.frames) * r.s1 >= 5 && Math.sqrt(r.frames - 1) * r.s1 < 5, 'smallest N with SNR ≥ 5');
  assert.ok(r.t <= r.trail.t, 'standard shutter speed below the limit');
  const bright = plan({ bortle: 8, mu: 23 });
  assert.ok(bright.frames > 3 * r.frames, 'Bortle 8 needs several times more frames');
  assert.ok(r.frames1 <= r.frames, 'a pristine sky never needs more');
});
