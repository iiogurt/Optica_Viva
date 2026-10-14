// Mission "Image Jupiter": Nyquist focal ratio, coherence time, rotation limit and dispersion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalRatio, r0From, tau0, rotationLimit, plan, JUPITER_ROTATION } from '../js/lib/jupiter.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('Nyquist focal ratio: two pixels per cycle of the cut-off', () => {
  near(criticalRatio(2.9, 0.5), 11.6, 1e-12, '2.9 µm');
  // at that ratio the pixel equals half of λN
  near(2.9, (0.5 * criticalRatio(2.9, 0.5)) / 2, 1e-12, 'p = λN/2');
});

test('Fried parameter and coherence time', () => {
  near(r0From(1, 0.5), (0.98 * 0.5e-6) / (1 / 206264.806), 1e-12, 'r₀ from 1″ seeing');
  near(r0From(1, 1) / r0From(1, 0.5), 2 ** 1.2, 1e-12, 'λ^6/5');
  near(tau0(0.1, 10), 3.14e-3, 1e-12, 'τ₀');
});

test('rotation limit: about 2.4 minutes for 20 cm and a 45″ disc', () => {
  const r = rotationLimit(0.2, 0.55, 45);
  near(JUPITER_ROTATION, 9 * 3600 + 55 * 60 + 40.6, 1e-9, 'System II');
  near(r.t, 143.4, 0.5, 'seconds');
  near(rotationLimit(0.4, 0.55, 45).t, r.t / 2, 1e-9, 'halved by doubling the aperture');
});

test('dispersion grows towards the horizon and calls for a corrector', () => {
  const high = plan({ alt: 80 }), low = plan({ alt: 20 });
  assert.ok(low.disp > 5 * high.disp, 'tan z');
  assert.equal(high.adc, false);
  assert.equal(low.adc, true);
  near(plan({ alt: 45 }).disp, 1.4, 0.15, '400–700 nm at 45° near sea level');
});
