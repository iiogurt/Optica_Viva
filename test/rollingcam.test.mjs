// Rolling shutter on a live feed: each row shows the scene at its own time, interpolated between
// the buffered frames around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeRolling, framesNeeded } from '../js/lib/rollingcam.js';

const W = 4, H = 11;
// frame i is uniformly grey with value 10·i, captured at t = 10·i ms
const frames = Array.from({ length: 8 }, (_, i) => ({ t: 10 * i, data: new Uint8ClampedArray(W * H * 4).fill(10 * i) }));

test('row y shows the scene at t − (y/(H−1))·readout, interpolated between frames', () => {
  const out = composeRolling(frames, W, H, 70, 50);
  const row = (y) => out[y * W * 4];
  assert.equal(row(0), 70, 'top row: newest frame');
  assert.equal(row(H - 1), 20, 'bottom row: 50 ms earlier');
  assert.equal(row(5), 45, 'middle row: halfway, interpolated');
});

test('columns for a left-to-right readout, and times older than the buffer use the oldest frame', () => {
  const out = composeRolling(frames, W, H, 70, 30, 'right');
  assert.equal(out[0], 70); assert.equal(out[(W - 1) * 4], 40);
  const old = composeRolling(frames, W, H, 70, 500);
  assert.equal(old[(H - 1) * W * 4], 0);
});

test('the buffer spans the readout time', () => {
  assert.equal(framesNeeded(400, 33), 15);
  assert.equal(framesNeeded(5000, 10), 120, 'capped');
});
