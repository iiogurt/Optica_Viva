// The generated glass catalogue (SCHOTT, OHARA, CDGM Sellmeier fits): data-sheet values, glass
// codes, lookup by name in the tracer and in lens import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index, abbe, partialDispersion, glassData, glassCode, glassTable, GLASS_NAMES, LINES } from '../js/lib/glass.js';
import { CATALOGUE } from '../js/lib/glasscat.js';
import { resolveGlass, validateLens } from '../js/lib/lensio.js';

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e} ± ${tol}`);

test('catalogue: three makers, over 400 glasses, every fit physical across the visible', () => {
  const makers = new Set(Object.values(CATALOGUE).map((c) => c[0]));
  assert.deepEqual([...makers].sort(), ['CDGM', 'OHARA', 'SCHOTT']);
  assert.ok(Object.keys(CATALOGUE).length > 400);
  for (const name of Object.keys(CATALOGUE)) {
    const n4 = index(name, 400), n7 = index(name, 700);
    assert.ok(n4 > n7 && n7 > 1.4 && n4 < 2.2, `${name}: normal dispersion, 1.4 < n < 2.2`);
  }
});

test('every catalogue glass reproduces its maker\'s n_d and V_d; SCHOTT also its ΔP_g,F', () => {
  let n = 0;
  for (const [name, c] of Object.entries(CATALOGUE)) {
    if (c[9] == null) continue;
    near(index(name, LINES.d), c[9], 1e-5, `${name} n_d`);
    near(abbe(name), c[10], 0.01, `${name} V_d`);
    // SCHOTT quotes ΔP_g,F from the same normal line (through K7 and F2) as glassTable()
    if (c[0] === 'SCHOTT' && c[11] != null) near(partialDispersion(name) - (0.6438 - 0.001682 * abbe(name)), c[11], 3e-4, `${name} ΔP_g,F`);
    n++;
  }
  assert.ok(n > 400, `${n} glasses checked`);
  // a few familiar ones by name (data sheets)
  for (const [g, nd, vd] of [['N-BK7', 1.51680, 64.17], ['S-FPL53', 1.43875, 94.95], ['S-LAH79', 2.00330, 28.27], ['H-K9L', 1.51680, 64.20]]) {
    near(index(g, LINES.d), nd, 1e-5, `${g} n_d`);
    near(abbe(g), vd, 0.01, `${g} V_d`);
  }
});

test('glass codes and the crown/flint family', () => {
  assert.equal(glassCode('N-BK7'), '517642');
  assert.equal(glassCode('S-LAH79'), '003283', 'n_d above 2 keeps the decimals');
  assert.equal(glassData('S-FPL51').type, 'crown');
  assert.equal(glassData('H-ZF52').type, 'flint');
  assert.equal(glassData('S-FPL51').maker, 'OHARA');
  const t = glassTable();
  assert.equal(t.length, GLASS_NAMES.length);
  assert.ok(t.filter((g) => g.dpgf > 0.02).some((g) => g.name === 'S-FPL53'), 'fluorophosphate crowns show anomalous partial dispersion');
});

test('catalogue glasses work in lens import and validation', () => {
  assert.deepEqual(resolveGlass('S-LAH79'), { glass: 'S-LAH79' });
  assert.deepEqual(resolveGlass('n-lak9'), { glass: 'N-LAK9' });
  const lens = { epd: 10, field: 5, surfaces: [{ R: 50, t: 4, glass: 'H-ZF52', stop: true }, { R: -200, t: 90, glass: 'air' }] };
  assert.deepEqual(validateLens(lens), []);
  assert.ok(validateLens({ ...lens, surfaces: [{ ...lens.surfaces[0], glass: 'NOPE-1' }, lens.surfaces[1]] }).length);
});
