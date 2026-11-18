// Colour science: CCT, CIE 13.3 colour rendering, daylight, CIEDE2000 against published values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xyz, chromaticity, cct, cri, daylight, blackbody, deltaE00, lab, adapt, D65_XYZ, sampleSRGB, tm30, cam02ucs, camState } from '../js/lib/colorsci.js';
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

// CIE 224:2017 and ANSI/IES TM-30: reference values computed with the official CIE TC1-90 and IES
// TM-30-18 spreadsheets, as quoted in the colour-science test suite
// (colour/quality/tests/test_cfi2017.py and test_tm3018.py, BSD-3-Clause), to 0.1 for the
// sample scores Ri and to whole numbers for the hue bins.
const CFI_SAMPLE = [0, 0, 0.001, 0.001, 0.002, 0.005, 0.01, 0.021, 0.042, 0.08, 0.14, 0.225, 0.337, 0.479, 0.604, 0.633, 0.551, 0.436, 0.346, 0.282, 0.237, 0.213, 0.21, 0.226, 0.26, 0.311, 0.372, 0.436, 0.499, 0.559, 0.612, 0.658, 0.698, 0.735, 0.771, 0.804, 0.836, 0.868, 0.898, 0.926, 0.952, 0.974, 0.989, 0.998, 1, 0.992, 0.978, 0.957, 0.927, 0.888, 0.844, 0.799, 0.75, 0.698, 0.644, 0.591, 0.539, 0.488, 0.44, 0.395, 0.354, 0.316, 0.281, 0.249, 0.22, 0.194, 0.171, 0.15, 0.131, 0.115, 0.1, 0.088, 0.077, 0.067, 0.059, 0.052, 0.046, 0.04, 0.035, 0.031, 0.027]; // a 3287 K test spectrum (Planckian reference)
const RI = {
  sample: [89.5, 80.5, 81.5, 79.4, 65.9, 79.4, 73.2, 68.5, 95.9, 76.3, 71.9, 71.8, 83.3, 93.0, 89.2, 72.9, 75.1, 85.8, 75.1, 63.4, 69.4, 71.4, 89.7, 76.8, 67.6, 75.5, 92.7, 87.7, 81.1, 95.0, 83.3, 74.4, 90.4, 80.4, 89.0, 86.9, 85.0, 95.7, 98.5, 96.3, 98.7, 88.4, 85.2, 99.6, 90.4, 88.6, 94.3, 85.3, 86.4, 90.0, 89.3, 88.0, 83.6, 89.6, 86.7, 81.4, 80.2, 80.6, 88.5, 89.7, 84.2, 84.2, 79.4, 71.3, 72.8, 65.8, 64.1, 71.7, 77.4, 68.0, 63.2, 87.1, 62.4, 92.7, 67.3, 67.6, 80.0, 70.4, 89.0, 87.0, 81.5, 94.2, 94.3, 89.4, 79.3, 76.6, 83.7, 87.7, 76.7, 88.6, 76.2, 68.5, 80.1, 65.3, 74.9, 83.9, 88.6, 84.2, 77.4],
  FL1: [85.1, 68.9, 73.9, 79.7, 51.6, 77.8, 52.1, 47.8, 95.3, 68.9, 67.3, 63.6, 71.3, 91.1, 79.0, 63.2, 72.8, 78.4, 75.2, 60.4, 68.0, 67.3, 88.6, 78.4, 68.7, 75.7, 91.0, 91.5, 78.3, 83.0, 82.3, 78.7, 85.8, 85.6, 92.3, 94.6, 88.3, 87.8, 97.4, 94.4, 95.4, 93.3, 90.5, 99.5, 88.9, 87.6, 94.3, 77.7, 88.0, 89.6, 91.0, 87.3, 81.3, 83.8, 85.2, 78.1, 78.2, 79.5, 86.9, 94.4, 87.4, 93.7, 88.6, 77.9, 74.5, 78.2, 77.2, 79.7, 86.3, 76.3, 81.6, 91.0, 73.3, 98.1, 81.9, 77.4, 86.9, 79.4, 90.2, 91.1, 80.6, 96.6, 95.1, 89.3, 84.2, 72.5, 78.6, 75.5, 74.4, 75.3, 91.4, 58.2, 74.6, 52.6, 67.0, 76.2, 88.9, 75.2, 55.5],
  FL2: [78.9, 59.0, 66.9, 65.7, 35.8, 66.1, 40.4, 34.7, 95.1, 53.5, 47.4, 44.6, 64.1, 86.6, 71.6, 48.8, 56.1, 68.9, 56.8, 43.9, 46.9, 46.5, 80.0, 62.6, 48.1, 58.4, 82.0, 84.6, 61.5, 69.6, 67.5, 62.3, 73.9, 73.6, 85.9, 87.5, 79.4, 76.0, 96.6, 92.8, 90.5, 89.1, 83.0, 99.4, 83.1, 80.7, 86.8, 66.1, 79.6, 80.7, 81.3, 76.1, 68.7, 76.8, 77.0, 66.1, 65.5, 67.4, 78.8, 90.1, 77.5, 86.9, 76.8, 59.7, 61.2, 57.9, 56.2, 62.0, 72.9, 57.7, 63.7, 84.0, 52.7, 96.2, 66.6, 56.6, 76.2, 63.3, 81.8, 84.5, 73.5, 93.9, 90.9, 85.7, 80.5, 63.5, 73.7, 69.0, 66.1, 67.5, 92.6, 51.3, 69.5, 40.7, 61.5, 70.2, 80.0, 67.0, 45.0],
};
test('CIE 2017 fidelity index reproduces the reference Rf and all 99 sample scores', () => {
  for (const [name, spd, Rf, T] of [['sample', CFI_SAMPLE, 81.6, 3287.5], ['FL1', ILLUMINANTS.FL1.spd, 80.6, null], ['FL2', ILLUMINANTS.FL2.spd, 70.1, 4225]]) {
    const r = tm30(spd);
    near(r.Rf, Rf, 0.1, `${name} Rf`);
    if (T) near(r.cct, T, 1, `${name} CCT`);
    r.Ri.forEach((x, i) => near(x, RI[name][i], 0.11, `${name} R${i + 1}`));
  }
  near(tm30(CFI_SAMPLE).duv, -0.0003, 0.0005, 'sample Duv');
  near(tm30(ILLUMINANTS.FL2.spd).duv, 0.0019, 0.001, 'FL2 Duv');
});
test('TM-30 gamut index and hue-bin measures of CIE FL2', () => {
  const r = tm30(ILLUMINANTS.FL2.spd);
  near(r.Rg, 86, 0.5, 'Rg');
  const Rf = [60, 61, 53, 68, 80, 88, 77, 73, 76, 62, 70, 77, 81, 71, 64, 65];
  const Rcs = [-25, -18, -9, 5, 11, 4, -8, -15, -17, -15, -4, 5, 11, 7, -6, -16];
  const Rhs = [-0.02, 0.14, 0.24, 0.2, 0.09, -0.07, -0.12, -0.08, 0.01, 0.17, 0.19, 0.11, -0.08, -0.15, -0.26, -0.17];
  r.hue.forEach((b, j) => {
    near(b.Rf, Rf[j], 0.75, `Rf,h${j + 1}`); near(b.Rcs, Rcs[j], 0.75, `Rcs,h${j + 1}`); near(b.Rhs, Rhs[j], 0.01, `Rhs,h${j + 1}`);
  });
  assert.equal(r.hue.reduce((n, b) => n + b.n, 0), 99, 'every sample in one bin');
});
test('a Planckian or daylight source renders exactly like its own reference', () => {
  for (const spd of [blackbody(2700), blackbody(3500), daylight(6500)]) {
    const r = tm30(spd);
    near(r.Rf, 100, 0.05, 'Rf'); near(r.Rg, 100, 0.05, 'Rg');
    r.hue.forEach((b) => near(b.Rcs, 0, 0.05, 'Rcs,h'));
  }
  // between 4000 and 5000 K the reference is a blend, so a pure black body there is no longer perfect
  assert.ok(tm30(blackbody(4500)).Rf < 99.5, 'black body at 4500 K differs from the mixed reference');
});
test('CAM02-UCS: the adopted white has J′ = 100 and no colourfulness', () => {
  const W = [95.047, 100, 108.883];
  const [Jp, a, b] = cam02ucs(W, camState(W));
  near(Jp, 100, 1e-9, 'J′'); near(Math.hypot(a, b), 0, 0.01, 'M′'); // not exactly 0: the published HPE matrix's first row sums to 1.00001
});
test('TM-30 is finite with all 16 hue bins filled for every light the page offers', () => {
  const lights = [...Object.values(ILLUMINANTS).map((v) => v.spd)];
  for (let T = 1500; T <= 12000; T *= 1.05) lights.push(blackbody(T));
  for (let T = 4000; T <= 12000; T *= 1.05) lights.push(daylight(T));
  for (const spd of lights) {
    const r = tm30(spd);
    assert.ok(r.hue.every((b) => b.n > 0), 'no empty hue bin');
    assert.ok([r.Rf, r.Rg, ...r.Ri, ...r.hue.flatMap((b) => [b.Rf, b.Rcs, b.Rhs, ...b.test])].every(Number.isFinite), 'finite');
  }
});
