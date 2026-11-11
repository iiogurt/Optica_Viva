import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { THUMBED, TW, TH } from '../scripts/thumbs.mjs';
import { FEATURED, NO_THUMB, thumbOf } from '../js/lib/thumbs.js';

// width and height of a lossy or lossless WebP (VP8 / VP8L / VP8X header)
function webpSize(buf) {
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  throw new Error('not a WebP: ' + kind);
}

test('every home-page card with a picture has its thumbnail, at the right size', () => {
  assert.ok(THUMBED.length > 50, 'the cards are found in js/app.js');
  for (const id of THUMBED) {
    const f = new URL('../' + thumbOf(id), import.meta.url);
    assert.ok(existsSync(f), `img/thumbs/${id}.webp is missing: run npm run thumbs -- ${id}`);
    const k = FEATURED.includes(id) ? 2 : 1;
    assert.deepEqual(webpSize(readFileSync(f)), [k * TW, k * TH], id);
  }
  for (const id of FEATURED) assert.ok(THUMBED.includes(id), `featured ${id} is a card with a picture`);
  for (const id of NO_THUMB) assert.equal(thumbOf(id), null);
});
