// Colour science: CCT, CIE 13.3 colour rendering, daylight, CIEDE2000 against published values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xyz, chromaticity, cct, cri, daylight, blackbody, deltaE00, lab, adapt, D65_XYZ, sampleSRGB } from '../js/lib/colorsci.js';
import { ILLUMINANTS, TCS } from '../js/lib/colordata.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);

test('correlated colour temperature of illuminant A and D65', () => {
  near(cct(xyz(ILLUMINANTS.A.spd)).T, 2856, 1, 'illuminant A');
  near(Math.abs(cct(xyz(ILLUMINANTS.A.spd)).duv), 0, 1e-5, 'A lies on the Planckian locus');
  // D65 is 6504 K with c2 = 1.4388e-2 relative to the 1.438e-2 used when it was defined (6500 × 1.4388/1.438)
  near(cct(xyz(daylight(6504))).T, 6504, 3, 'D-series at 6504 K');
  const [x, y] = chromaticity(xyz(daylight(6504)));
  near(x, 0.3127, 2e-4, 'D65 x'); near(y, 0.3290, 2e-4, 'D65 y');
});

test('CIE 13.3 colour rendering index reproduces the published FL-series values', () => {
  // CIE 13.3 / CIE 15 tabulated Ra of the fluorescent illuminants
  for (const [k, Ra] of [['FL1', 76], ['FL2', 64], ['FL4', 51], ['FL7', 90], ['FL8', 95], ['FL10', 81], ['FL11', 83], ['FL12', 83]]) {
    near(cri(ILLUMINANTS[k].spd).Ra, Ra, 0.6, `${k} Ra`);
  }
  near(cri(ILLUMINANTS.A.spd).Ra, 100, 0.01, 'a black body renders like itself');
  near(cri(daylight(5500)).Ra, 100, 0.05, 'daylight renders like itself');
  assert.ok(cri(ILLUMINANTS['LED-B3'].spd).R[8] < 30 && cri(ILLUMINANTS['LED-BH1'].spd).R[8] > 60, 'red phosphor rescues R9');
});

test('CIEDE2000 matches the Sharma, Wu & Dalal (2005) test data', () => {
  near(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485]), 2.0425, 1e-4, 'pair 1');
  near(deltaE00([50, 0, 0], [50, -1, 2]), 2.3669, 1e-4, 'pair 7');
  near(deltaE00([50, 2.5, 0], [73, 25, -18]), 27.1492, 1e-4, 'pair 17');
  near(deltaE00([50, 2.5, 0], [50, 3.1736, 0.5854]), 1.0, 1e-4, 'pair 3');
});

test('chromatic adaptation and display rendering', () => {
  // Bradford maps the source white exactly onto the destination white
  const Aw = xyz(ILLUMINANTS.A.spd), Wn = Aw.map((q) => (q * 100) / Aw[1]);
  adapt(Wn, Wn, D65_XYZ).forEach((q, i) => near(q, D65_XYZ[i], 1e-4, 'white → white (7-digit Bradford inverse)'));
  // a perfect white reflector renders as display white under any illuminant
  sampleSRGB(new Array(81).fill(1), ILLUMINANTS.FL11.spd).forEach((q) => near(q, 1, 2e-3, 'white sample'));
  // CIELAB of the reference white
  lab(D65_XYZ).forEach((q, i) => near(q, i ? 0 : 100, 1e-9, 'L*a*b* of white'));
  assert.equal(TCS.length, 14);
  near(blackbody(5000)[34], 100, 1e-9, 'black body normalised at 550 nm');
});

test('camera colour: the Luther–Ives camera is exact; real filters are not; WB and matrix matter', async () => {
  const { CAMERAS, EXTRA_PATCHES, cameraColour, lutherResidual, wbGains } = await import('../js/lib/colorsci.js');
  const P = [...TCS, ...EXTRA_PATCHES.map((p) => p.r)], D65 = daylight(6504), A = ILLUMINANTS.A.spd;
  near(lutherResidual(CAMERAS.luther.sens), 0, 1e-12, 'CMF camera satisfies the Luther condition');
  near(cameraColour({ sens: CAMERAS.luther.sens, spd: A, patches: P }).max, 0, 1e-4, 'Luther camera, matrix fitted under A: exact (to rounding of the Bradford matrices)');
  const cmos = cameraColour({ sens: CAMERAS.cmos.sens, spd: D65, patches: P }), narrow = cameraColour({ sens: CAMERAS.narrow.sens, spd: D65, patches: P });
  assert.ok(cmos.mean < 2 && narrow.mean > cmos.mean, `mean ΔE00: cmos ${cmos.mean}, narrow ${narrow.mean}`);
  // the white-preserving constraint holds exactly
  const white = cameraColour({ sens: CAMERAS.cmos.sens, spd: D65, patches: [new Array(81).fill(1)], matrix: cmos.M });
  near(white.dE[0], 0, 1e-4, 'perfect white maps to white');
  // daylight white balance under tungsten leaves a strong cast
  assert.ok(cameraColour({ sens: CAMERAS.cmos.sens, spd: A, patches: P, matrix: cmos.M, gains: wbGains(D65, CAMERAS.cmos.sens) }).mean > 10, 'wrong white balance');
});

test('metamers match under the design illuminant and separate under others', async () => {
  const { metamer } = await import('../js/lib/colorsci.js');
  const D65 = daylight(6504), r1 = TCS[12], r2 = metamer(r1, D65, 1);
  const obs = (r, spd) => { const W = xyz(spd), k = 100 / W[1]; return lab(adapt(xyz(spd.map((s, i) => s * r[i])).map((q) => q * k), W.map((q) => q * k), D65_XYZ)); };
  near(deltaE00(obs(r1, D65), obs(r2, D65)), 0, 1e-9, 'metameric match in daylight');
  assert.ok(deltaE00(obs(r1, ILLUMINANTS.FL11.spd), obs(r2, ILLUMINANTS.FL11.spd)) > 5, 'mismatch under a tri-band lamp');
  assert.ok(Math.min(...r2) >= 0.0099 && Math.max(...r2) <= 0.9901, 'physically valid reflectance');
});
