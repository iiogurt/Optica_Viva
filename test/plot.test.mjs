// Axis tick labels: neighbouring ticks never share a label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickLabel, legendRows, readout, readoutLabel, LEGEND_MARK } from '../js/lib/plot.js';

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

test('legend entries flow into rows that fit the width, in order', () => {
  assert.deepEqual(legendRows([], 300), []);
  const rows = legendRows([60, 60, 60, 200, 40], 200);
  assert.deepEqual(rows.map((r) => r.map((e) => e.i)), [[0, 1], [2], [3], [4]]);
  for (const r of rows) assert.equal(r[0].x, 0);
  assert.equal(rows[0][1].x, LEGEND_MARK + 60 + 14);
  // an entry wider than the row still gets a row of its own
  assert.equal(legendRows([500], 100).length, 1);
});

test('hover readout: interpolates one-way series, picks the nearest point of others, null outside', () => {
  const geo = { pad: { l: 50, r: 10, t: 20, b: 30 }, w: 260, h: 150, x: { min: 0, max: 10 }, y: { min: 0, max: 100 } };
  const line = { data: [[0, 0], [10, 100]] }, back = { data: [[10, 50], [0, 50]] }, loop = { data: [[2, 20], [8, 20], [8, 80], [2, 80], [2, 20]] }, dots = { data: [[5, 90]], points: true };
  const p = { ...geo, series: [line, back, loop, dots] };
  assert.equal(readout(p, 20, 60), null, 'left of the plot area');
  assert.equal(readout(p, 100, 140), null, 'below the plot area');
  // x = 5 is at px 150; the line there is y = 50 at py 70
  const r = readout(p, 150, 70);
  assert.ok(Math.abs(r.x - 5) < 1e-9 && Math.abs(r.y - 50) < 1e-9);
  const [a, b] = r.rows;
  assert.ok(a.i === 0 && !a.at && Math.abs(a.y - 50) < 1e-9 && Math.abs(a.py - 70) < 1e-9);
  assert.ok(b.i === 1 && Math.abs(b.y - 50) < 1e-9, 'a series running right to left is interpolated too');
  assert.equal(r.rows.length, 2, 'the loop and the dot are farther than the reach');
  // near the loop's corner (8, 80): px 210, py 40
  const c = readout(p, 206, 44).rows.find((q) => q.i === 2);
  assert.ok(c.at && c.x === 8 && c.y === 80);
  // the scattered point (5, 90) at px 150, py 30
  assert.ok(readout(p, 152, 33).rows.some((q) => q.i === 3 && q.at && q.y === 90));
  // logarithmic axes
  const lg = { ...geo, x: { min: 1, max: 100, log: true }, y: { min: 1, max: 1e4, log: true }, series: [{ data: [[1, 1], [100, 1e4]] }] };
  const m = readout(lg, 150, 70);
  assert.ok(Math.abs(m.x - 10) < 1e-9 && Math.abs(m.rows[0].y - 100) < 1e-6, 'x = 10, y = 100 on the log-log line');
  // a series outside the visible range gives no row; non-finite points are skipped
  assert.equal(readout({ ...geo, series: [{ data: [[0, 500], [10, 500]] }, { data: [[NaN, 1], [3, Infinity]] }] }, 150, 70).rows.length, 0);
});

test('readout values: four significant digits, exponents for very large and small, the axis formatter if any', () => {
  assert.equal(readoutLabel(0), '0');
  assert.equal(readoutLabel(12.3456), '12.35');
  assert.equal(readoutLabel(0.000123456), '1.23e-4');
  assert.equal(readoutLabel(1234567), '1.23e+6');
  assert.equal(readoutLabel(2, { fmt: (v) => v + ' x' }), '2 x');
});
