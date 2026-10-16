// Embed mode: the embed flag is added to or removed from the hash query, and the iframe code is escaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withEmbed, embedCode } from '../js/lib/ui.js';

test('embed flag in the hash query', () => {
  const u = 'https://iiogurt.github.io/Optica_Viva/#/dof?N=4&s=2';
  assert.equal(withEmbed(u, true), 'https://iiogurt.github.io/Optica_Viva/#/dof?N=4&s=2&embed=1');
  assert.equal(withEmbed(withEmbed(u, true), false), u);
  assert.equal(withEmbed('http://x/#/mtf', true), 'http://x/#/mtf?embed=1');
  assert.equal(withEmbed('http://x/#/mtf?embed=1', false), 'http://x/#/mtf');
});

test('iframe code escapes the URL and title', () => {
  const c = embedCode('http://x/#/dof?N=4', 'Depth "of" field');
  assert.match(c, /^<iframe src="http:\/\/x\/#\/dof\?N=4&amp;embed=1" title="Depth &quot;of&quot; field \(Optica Viva\)"/);
  assert.match(c, /loading="lazy"><\/iframe>$/);
});
