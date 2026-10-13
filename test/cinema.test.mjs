// Cinema optics: anamorphic aspect, focus breathing, T-stops and streak colour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anamorphicAspect, ovalRatio, angleOfView, breathing, surfaceReflectance, transmission, tStop, streakColour, IF_DESIGN } from '../js/lib/cinema.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('anamorphic squeeze: 2× on a 1.2 : 1 gate gives 2.39 : 1; bokeh ovals of ratio s', () => {
  near(anamorphicAspect(22.3, 18.66, 2), 2.39, 0.005, 'aspect');
  near(anamorphicAspect(16, 9, 1.33), 2.364, 0.001, '1.33× on 16:9');
  assert.equal(ovalRatio(1.8), 1.8);
});

test('focus breathing: unit focusing narrows by 1/(1+m); the internal-focus design breathes less', () => {
  const f = 50, u = 450, w = 36, m = f / (u - f);
  near(Math.tan(angleOfView('unit', f, u, w) / 2) / Math.tan(angleOfView('unit', f, Infinity, w) / 2), 1 / (1 + m), 1e-12, 'tan(θ/2) ∝ 1/(1+m)');
  near(1 / (1 / IF_DESIGN.f1 + 1 / IF_DESIGN.f2 - IF_DESIGN.d / (IF_DESIGN.f1 * IF_DESIGN.f2)), 50, 1e-9, 'IF design is 50 mm at infinity');
  near(angleOfView('rear', f, Infinity, w), angleOfView('unit', f, Infinity, w), 1e-9, 'same angle of view at infinity');
  assert.ok(Math.abs(breathing('rear', f, u, w)) < Math.abs(breathing('unit', f, u, w)) / 2, 'internal focus breathes less');
  near(breathing('ideal', f, u, w), 0, 0, 'compensated');
});

test('T-stops from surface reflectance', () => {
  near(surfaceReflectance('none', 1.6), (0.6 / 2.6) ** 2, 1e-9, 'uncoated Fresnel reflectance at n = 1.6');
  const tau = transmission('none', 20, 1.6, 1);
  near(tau, (1 - (0.6 / 2.6) ** 2) ** 20, 1e-12, 'τ = (1 − R)^k');
  near(tStop(2, tau), 2 / Math.sqrt(tau), 1e-12, 'T = N/√τ');
  assert.ok(Math.log2(1 / transmission('qhq', 20)) < 0.15, 'a multicoated 20-surface lens loses < 0.15 EV');
});

test('streak colour: multicoatings leave a blue streak, uncoated glass a near-white one', () => {
  const q = streakColour('qhq').rgb, n = streakColour('none').rgb;
  assert.ok(q[2] === 1 && q[0] < 0.5, `QHQ streak ${q}`);
  assert.ok(Math.min(...n) > 0.6, `uncoated streak ${n}`);
  assert.ok(streakColour('none').strength > 100 * streakColour('qhq').strength, 'coating dims the streak by > 100×');
});
