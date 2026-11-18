// TLCI-2012 (EBU Tech 3355): the transcribed tables against the document's printed sums, the
// reference lights, and the index against an independent instrument and the document's example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASIS, CMF2, PLANCK_LOCUS, DAYLIGHT_LOCUS, CHECKER, CAMERA, CAMERA_MATRIX } from '../js/lib/tlcidata.js';
import { tlci, cctEBU, planckEBU, daylightEBU, referenceEBU, fromQa, TLCI_WL } from '../js/lib/tlci.js';
import { ILLUMINANTS } from '../js/lib/colordata.js';
import { blackbody, daylight, tm30, cri } from '../js/lib/colorsci.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ± ${tol}`);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('the transcribed tables reproduce the sums printed in EBU Tech 3355', () => {
  [7140.45, 545.05, 201.55].forEach((s, k) => near(sum(BASIS[k]), s, 1e-6, `daylight vector S${k}`));
  CAMERA.forEach((c, k) => near(sum(c), 1, 1e-6, `camera responsivity ${'rgb'[k]}`));
  CAMERA_MATRIX.forEach((r, k) => near(sum(r), 1, 1e-9, `matrix row ${k}`));
  // Appendix 4's sum rows (the first table's printed row skips patch 8, Purplish blue)
  const printed = [12.447, 35.427, 14.953, 12.29, 28.328, 25.319, 25.876, null, 24.563, 12.442, 23.108, 30.89, 8.285, 9.857, 22.533, 37.356, 30.978, 14.543, 64.976, 43.228, 26.128, 14.2649, 6.4973, 2.25924];
  assert.equal(CHECKER.length, 24);
  CHECKER.forEach((r, i) => { assert.equal(r.length, 77); if (printed[i] !== null) near(sum(r), printed[i], 2e-3, `patch ${i + 1}`); });
});

test('the tabulated loci follow from the other appendices', () => {
  const xy = (s) => { const X = sum(s.map((v, i) => v * CMF2[0][i])), Y = sum(s.map((v, i) => v * CMF2[1][i])), Z = sum(s.map((v, i) => v * CMF2[2][i])); return [X / (X + Y + Z), Y / (X + Y + Z)]; };
  for (const [T, x, y] of PLANCK_LOCUS.filter((_, i) => i % 15 === 0)) {
    const [px, py] = xy(planckEBU(T)); near(px, x, 6e-5, `Planck x at ${T} K`); near(py, y, 6e-5, `Planck y at ${T} K`);
  }
  for (const [T, x, y] of DAYLIGHT_LOCUS.filter((_, i) => i % 10 === 0)) {
    const [px, py] = xy(daylightEBU(T)); near(px, x, 3e-4, `daylight x at ${T} K`); near(py, y, 3e-4, `daylight y at ${T} K`);
  }
});

test('reference lights score 100 and the reference is continuous at 3400 and 5000 K', () => {
  for (const T of [2000, 2856, 3300]) near(tlci(planckEBU(T)).Qa, 100, 1e-6, `Planckian ${T} K`);
  for (const T of [5600, 6500, 9000]) near(tlci(daylightEBU(T)).Qa, 100, 1e-6, `daylight ${T} K`);
  // the page's own black body and daylight differ slightly (c2 = 1.4388e-2, the CIE 5 nm vectors)
  for (let T = 1500; T <= 12000; T *= 1.1) assert.ok(tlci(blackbody(T)).Qa > 99.5, `page black body ${T.toFixed(0)} K`);
  for (let T = 4000; T <= 12000; T *= 1.1) assert.ok(tlci(daylight(T)).Qa > 99.5, `page daylight ${T.toFixed(0)} K`);
  for (const T of [3400, 5000]) {
    const a = referenceEBU(T - 1e-3), b = referenceEBU(T + 1e-3);
    assert.ok(Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < 1e-3, `continuous at ${T} K`);
  }
  near(fromQa(3.16), 50, 1e-12, 'ΔE*a = 3.16 is the watershed Qa = 50');
});

// A light measured with a Sekonic C-7000 (2° observer, 380–780 nm in 5 nm steps), attached to
// colour-science issue #974 (TRITESTING_001_02°_12071K.csv). The meter reported TLCI 99, TM-30
// Rf 94 and Rg 102, CRI Ra 95.6, Tcp 12071 K and Δuv −0.0003.
const SEKONIC = [0.000911858398, 0.000265562790, 0.000000000000, 0.000000000000, 0.000272534293, 0.000690163113, 0.001238569850, 0.002456067596, 0.005336065777, 0.011651802808, 0.025184715167, 0.051632288843, 0.088122479618, 0.111530445516, 0.103884659708, 0.075510680676, 0.053170271218, 0.039777036756, 0.032930731773, 0.032948087901, 0.038767468184, 0.046096470207, 0.051550906152, 0.053713139147, 0.053169019520, 0.050411630422, 0.046746730804, 0.043342463672, 0.040358494967, 0.038306374103, 0.036933384836, 0.035851966590, 0.034792609513, 0.033699672669, 0.032913830131, 0.032290693372, 0.031668774784, 0.031076774001, 0.030522091314, 0.029894335195, 0.029215255752, 0.028704997152, 0.028423722833, 0.028290884569, 0.028121165931, 0.027975050732, 0.027876984328, 0.027792843059, 0.027629269287, 0.027358382940, 0.026933910325, 0.026282200590, 0.025438565761, 0.024416808039, 0.023273734376, 0.021969966590, 0.020480578765, 0.019010037184, 0.017561301589, 0.016039151698, 0.014510836452, 0.012977464125, 0.011528717354, 0.010246563703, 0.008990255184, 0.007865033112, 0.006909644231, 0.006059318781, 0.005270529538, 0.004608396441, 0.004066246562, 0.003547253553, 0.003069134196, 0.002726005856, 0.002433153568, 0.002153193112, 0.001787868678, 0.001647686469, 0.001467542374, 0.001458303072, 0.001259884797];
test('an independent instrument: Sekonic C-7000 values for a measured 12 000 K light', () => {
  const q = tlci(SEKONIC);
  near(q.Qa, 99, 0.5, 'TLCI');
  assert.equal(q.locus, 'daylight');
  const f = tm30(SEKONIC), c = cri(SEKONIC);
  near(f.Rf, 94, 0.5, 'TM-30 Rf'); near(f.Rg, 102, 0.5, 'TM-30 Rg'); near(c.Ra, 95.6, 0.2, 'CRI Ra');
  near(c.duv, -0.0003, 0.0002, 'Duv');
});

test('CIE FL1 against the daylight-fluorescent example of Tech 3355, Figure 5', () => {
  // The figure reads "CCT = D6434 (−0.7), TLCI-2012: 50" for a measured daylight tube; CIE FL1 is the
  // standard daylight fluorescent, not necessarily the same spectrum, so the bounds are loose.
  const q = tlci(ILLUMINANTS.FL1.spd);
  assert.equal(q.locus, 'daylight');
  near(q.T, 6434, 15, 'CCT'); near(q.d, -0.7, 0.05, 'distance d'); near(q.Qa, 50, 4, 'Qa');
});

test('every light on the page gives a finite TLCI from all 18 coloured patches', () => {
  assert.equal(TLCI_WL.length, 77);
  for (const [k, v] of Object.entries(ILLUMINANTS)) {
    const q = tlci(v.spd);
    assert.ok(Number.isFinite(q.Qa) && q.Qa >= 0 && q.Qa <= 100, k);
    assert.equal(q.n, 18, `${k}: patches used`);
  }
  near(cctEBU(ILLUMINANTS.A.spd).T, 2856 * 1.435 / 1.4388, 1, 'illuminant A with the EBU c2');
});
