// Phenomena in the wild: images present, licences allowed, laboratory links valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GALLERY } from '../js/lib/gallery.js';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('js/app.js', root), 'utf8');
const labs = new Set([...app.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]));
const notices = readFileSync(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8');

test('every gallery entry has its image, an allowed licence, a credit in the notices and valid links', () => {
  for (const g of GALLERY) {
    assert.ok(existsSync(new URL(g.img, root)), `${g.id}: image file`);
    assert.ok(['Public domain', 'CC BY 4.0'].includes(g.licence), `${g.id}: licence`);
    assert.ok(notices.includes(g.img.split('/').pop()) && notices.includes(g.credit), `${g.id}: listed in THIRD_PARTY_NOTICES.md`);
    assert.ok(g.labs.length >= 1, `${g.id}: at least one laboratory`);
    for (const [href] of g.labs) assert.ok(labs.has(href.split('?')[0]), `${g.id}: ${href}`);
    assert.ok(g.alt.length > 20, `${g.id}: alt text`);
  }
});
