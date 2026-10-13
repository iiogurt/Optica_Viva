// Film: Boolean-model density (Nutting), Selwyn granularity, speed scaling, DQE, reciprocity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stock, meanDensity, exposeFilm, granularity, selwyn, speedPoint, dqe, reciprocityCorrection, pDevelop } from '../js/lib/film.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('simulated emulsion matches the Boolean-model density and Selwyn granularity', () => {
  const f = stock(100, 0.05), W = 160, px = 0.25, H = new Float32Array(W * W).fill(150), D = exposeFilm(H, W, px, f, 3);
  const Dm = -Math.log10(D.reduce((a, v) => a + 10 ** -v, 0) / D.length);
  near(Dm / meanDensity(150, f), 1, 0.05, 'mean density');
  const g32 = granularity(D, W, 32) * 32 * px, g16 = granularity(D, W, 16) * 16 * px;
  near(g32 / selwyn(150, f), 1, 0.2, 'σ√A vs exact Boolean granularity');
  near(g32 / g16, 1, 0.2, "Selwyn's law: σ√A independent of the aperture");
});

test("Nutting's law at low coverage and speed ∝ grain area", () => {
  const f = { ...stock(100, 0.05), layers: 1, n: 0.2, fog: 0 }, H = 1e6; // all grains developed
  near(meanDensity(H, f), 0.4343 * 0.2 * Math.PI * f.r ** 2 * Math.exp(2 * 0.05 ** 2), 2e-3, 'D = 0.434 N a');
  near(speedPoint(stock(100)) / speedPoint(stock(400)), 4, 0.01, 'ISO 400 needs 4× less exposure');
  near(pDevelop(0, 0.2), 0, 1e-12, 'no light, no development');
});

test('film DQE is a few per cent; reciprocity correction', () => {
  const f = stock(400), H = speedPoint(f) * 10 ** 0.8, A = Math.PI * 24 * 24, s = selwyn(H, f) / Math.sqrt(A), q = dqe(H, f, s, A);
  assert.ok(q > 0.005 && q < 0.1, `DQE ${q}`);
  near(reciprocityCorrection(100, 0.8), 100 ** 1.25, 1e-9, 'Schwarzschild: t^(1/p)');
  near(reciprocityCorrection(0.5, 0.8), 0.5, 0, 'no correction below 1 s');
});
