// Mission "Film under LED light": flicker-free shutter angles, band contrast, wall distance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposureTime, sineBands, safeAngles, bandCount, plan } from '../js/lib/ledset.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('flicker-free angles: 172.8° at 24 fps, 180° at 25 fps under 50 Hz; 144° at 24 fps under 60 Hz', () => {
  assert.deepEqual(safeAngles(24, 100).map((a) => +a.toFixed(1)), [86.4, 172.8, 259.2, 345.6]);
  assert.ok(safeAngles(25, 100).some((a) => Math.abs(a - 180) < 1e-9));
  assert.ok(safeAngles(24, 120).some((a) => Math.abs(a - 144) < 1e-9));
});

test('band contrast vanishes for whole flicker periods and equals 2m for very short exposures', () => {
  near(sineBands(0.3, 100, exposureTime(24, 172.8)), 0, 1e-12, 'two periods');
  near(sineBands(0.3, 100, 1e-6), 0.6, 1e-6, 'instantaneous');
  near(bandCount(0.015, 100), 1.5, 1e-12, 'bands per frame');
});

test('defocusing the wall lowers moiré: focus on the actor beats focus on the wall', () => {
  const onActor = plan({ s: 3, Z: 6 }), onWall = plan({ s: 6, Z: 6 });
  assert.ok(onActor.moire.contrast < onWall.moire.contrast);
  assert.ok(onActor.safe !== null && onActor.safe < 30);
});
