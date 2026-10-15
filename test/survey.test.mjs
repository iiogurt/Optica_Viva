// Mission "Security camera or drone survey": pixel density, DORI distances, GSD and motion limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DORI, security, drone } from '../js/lib/survey.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('IEC 62676-4 levels and a 4 MP camera at 10 m', () => {
  assert.deepEqual(DORI.map((d) => d[1]), [25, 62.5, 125, 250]);
  const r = security({ nx: 2560, w: 5.6e-3, f: 4e-3, d: 10 });
  near(r.width, 14, 1e-9, 'field width');
  near(r.ppm, 182.86, 0.01, 'pixels per metre');
  assert.equal(r.level, 'Recognition');
  near(r.maxDist[3][1], 7.31, 0.01, 'identification distance');
  near(security({ nx: 2560, w: 5.6e-3, f: 12e-3, d: 10 }).maxDist[2][1] / r.maxDist[2][1], 3, 1e-9, 'three times the focal length');
});

test('drone: GSD, half-pixel shutter limit and photo interval', () => {
  const r = drone({ A: 80, p: 2.4e-6, f: 8.8e-3, sw: 13.2e-3, sh: 8.8e-3, v: 8, overlap: 0.75 });
  near(r.gsd * 100, 2.18, 0.01, 'GSD in cm');
  near(r.tMax, r.gsd / 16, 1e-12, 'GSD/(2v)');
  near(r.interval, (80 * (1 - 0.75)) / 8, 1e-9, 'interval');
});
