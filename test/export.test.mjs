// Export: chart data as CSV in long format, with quoting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plotsToCSV } from '../js/lib/ui.js';

test('plotted series become chart, series, x, y rows', () => {
  const csv = plotsToCSV([{ title: 'MTF', x: 'cycles/mm', y: 'MTF', series: [{ label: 'system', data: [[0, 1], [10, 0.5], [20, NaN]] }, { label: 'pixel, ideal', data: [[0, 1]] }] }]);
  assert.equal(csv, 'chart,series,x: cycles/mm,y: MTF\nMTF,system,0,1\nMTF,system,10,0.5\nMTF,"pixel, ideal",0,1\n');
});
