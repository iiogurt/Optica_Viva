// Axis tick labels: neighbouring ticks never share a label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickLabel } from '../js/lib/plot.js';

test('exponent tick labels keep the digits that tell ticks apart', () => {
  assert.equal(tickLabel(-15000), '-1.5e+4');
  assert.equal(tickLabel(-20000), '-2e+4');
  assert.equal(tickLabel(25000), '2.5e+4');
  assert.equal(tickLabel(1e6), '1e+6');
  assert.equal(tickLabel(0.0025), '2.5e-3');
  assert.equal(tickLabel(5000), '5000');
  assert.equal(tickLabel(0), '0');
  // ticks as the axis code produces them (accumulated steps) stay distinct
  const labels = []; for (let v = -25000; v <= 5000; v += 5000) labels.push(tickLabel(v));
  assert.equal(new Set(labels).size, labels.length, labels.join(' '));
});
