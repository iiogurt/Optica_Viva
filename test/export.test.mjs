// Export: chart data as CSV in long format, with quoting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plotsToCSV } from '../js/lib/ui.js';

test('plotted series become chart, series, x, y rows', () => {
  const csv = plotsToCSV([{ title: 'MTF', x: 'cycles/mm', y: 'MTF', series: [{ label: 'system', data: [[0, 1], [10, 0.5], [20, NaN]] }, { label: 'pixel, ideal', data: [[0, 1]] }] }]);
  assert.equal(csv, 'chart,series,x: cycles/mm,y: MTF\nMTF,system,0,1\nMTF,system,10,0.5\nMTF,"pixel, ideal",0,1\n');
});

test('slider glide: the easing starts and ends at rest and rises monotonically', async () => {
  const { ease } = await import('../js/lib/ui.js');
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(0.5), 0.5);
  let last = 0;
  for (let x = 0.01; x <= 1; x += 0.01) { const y = ease(x); assert.ok(y >= last, `monotone at ${x}`); last = y; }
  assert.ok(ease(0.02) < 0.001 && 1 - ease(0.98) < 0.001, 'zero slope at both ends');
});
