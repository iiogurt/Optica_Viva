// Underwater photography: absorption, white balance, ports and backscatter geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absorption, nWater, bandsLeft, patchColours, flatPort, domeImage, backscatterStart } from '../js/lib/underwater.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('red is absorbed far more than blue; organic matter absorbs blue', () => {
  assert.ok(absorption(650, 0) / absorption(450, 0) > 30, 'red vs blue in pure water');
  const deep = bandsLeft(11.5, 0);
  assert.ok(deep.red < 0.05 && deep.blue > 0.85, 'ocean at 11.5 m');
  const lake = bandsLeft(10, 1.2);
  assert.ok(lake.green > lake.blue, 'green lake');
});

test('water index and the white-balanced grey card', () => {
  near(nWater(589), 1.3331, 0.0003, 'D line');
  near(nWater(486) - nWater(656), 0.0059, 0.0004, 'F − C');
  const grey = patchColours({ z: 12, r: 1.5, wb: true })[14];
  grey.forEach((v) => near(v, 0.5, 1e-3, 'neutral grey'));
  const red = patchColours({ z: 12, r: 1.5 })[8], strobe = patchColours({ z: 12, r: 1.5, strobe: true })[8];
  assert.ok(strobe[0] > 2 * red[0], 'a strobe brings back red');
});

test('ports: flat-port magnification 1.33 on axis; dome virtual image at R/(n − 1)', () => {
  near(flatPort(2, 50).magnification, 1.333, 0.002, 'paraxial');
  near(domeImage(1e12, 0.1).v, 0.1 / (nWater(589) - 1), 1e-6, 'virtual image of infinity');
  near(backscatterStart(0.3, 45, 45), 0.15, 1e-12, 'strobes at 30 cm, 45° beams and field');
});
