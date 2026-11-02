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

test('exposure: the coherence time is the target, 2 ms the floor, and an unmet target is reported (#211)', () => {
  // good seeing, light wind: τ₀ = 3.6 ms lies in 2–20 ms and is used as it is
  const ok = plan({ fwhm: 1, wind: 10 });
  assert.ok(ok.frozen && Math.abs(ok.t - ok.tau) < 1e-12 && ok.t > 0.002, `τ₀ ${ok.tau}`);
  // the best the sliders allow (0.6″, 3 m/s) gives τ₀ = 19.8 ms; a little beyond, τ₀ exceeds 20 ms
  // and frames of 20 ms still freeze the air
  near(plan({ fwhm: 0.6, wind: 3 }).tau, 0.0198, 2e-4, 'best supported');
  const calm = plan({ fwhm: 0.5, wind: 3 });
  assert.ok(calm.tau > 0.02 && calm.t === 0.02 && calm.frozen);
  // the report's cases: 2″ and 4″ seeing with 40 m/s wind, τ₀ = 0.44 and 0.22 ms
  for (const [fwhm, smear] of [[2, 4.5], [4, 8.99]]) {
    const r = plan({ fwhm, wind: 40 });
    assert.equal(r.frozen, false); assert.equal(r.t, 0.002);
    near(r.smear, smear, 0.01, `t/τ₀ at ${fwhm}″`);
  }
});
