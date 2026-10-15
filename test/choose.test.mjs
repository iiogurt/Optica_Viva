// Mission "Choose a camera or telescope": equivalence of pupils, depth of field, telescope limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camera, telescope, stops } from '../js/lib/choose.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const shot = { Feq: 50, s: 3 };

test('full frame vs Micro Four Thirds at f/1.8: two stops of light, twice the depth of field', () => {
  const ff = camera({ sensor: 'ff', N: 1.8, mp: 24 }, shot), m43 = camera({ sensor: 'mft', N: 1.8, mp: 20 }, shot);
  near(stops(ff.light, m43.light), 2, 0.01, 'stops');
  near(m43.dof / ff.dof, 2, 0.01, 'depth of field');
});

test('equal entrance pupils give equal light and depth of field', () => {
  const ff = camera({ sensor: 'ff', N: 1.8, mp: 24 }, shot), m43 = camera({ sensor: 'mft', N: 0.9, mp: 20 }, shot);
  near(stops(ff.light, m43.light), 0, 0.01, 'light');
  near(m43.dof / ff.dof, 1, 0.01, 'depth of field');
});

test('telescopes: Rayleigh and Dawes limits, light grasp, limiting magnitude', () => {
  const t = telescope({ D: 200, f: 1000 });
  near(t.rayleigh, 0.692, 0.002, 'Rayleigh at 550 nm');
  near(t.dawes, 0.58, 1e-12, 'Dawes');
  near(t.mlim, 14.0, 0.01, 'limiting magnitude');
  near(stops(telescope({ D: 200, f: 1 }).grasp, telescope({ D: 100, f: 1 }).grasp), 2, 1e-9, 'twice the aperture, two stops');
});
