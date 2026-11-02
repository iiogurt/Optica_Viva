// The vendored KaTeX: the files are the ones recorded in vendor/katex/SHA256SUMS (from the npm
// tarball), the version is past both 2026 advisories, and the app's options keep trust off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { TEX_OPTIONS } from '../js/lib/ui.js';

const dir = new URL('../vendor/katex/', import.meta.url);
const sandbox = {};
sandbox.self = sandbox;
runInNewContext(readFileSync(new URL('katex.min.js', dir), 'utf8'), sandbox);
const { katex } = sandbox;

test('vendored KaTeX files match their recorded checksums', () => {
  const sums = readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
  assert.ok(sums.length >= 23, 'katex.min.js, .css, auto-render, licence and 20 fonts');
  for (const [hash, file] of sums) assert.equal(createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex'), hash, file);
});

test('KaTeX is at least 0.18.2 (GHSA-cg87-wmx4-v546, GHSA-238p-pmpm-9mq7)', () => {
  const [maj, min, pat] = katex.version.split('.').map(Number);
  assert.ok(maj > 0 || min > 18 || (min === 18 && pat >= 2), katex.version);
  assert.match(readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'), new RegExp(`KaTeX ${katex.version.replace(/\./g, '\\.')}`), 'notice names the version');
});

test("the app's KaTeX options keep trust off: links, images and HTML attributes are refused, math renders", () => {
  assert.ok(!TEX_OPTIONS.trust, 'trust');
  const html = (src, display = false) => katex.renderToString(src, { ...TEX_OPTIONS, displayMode: display }).split('<annotation')[0];
  for (const src of ['\\href{javascript:alert(1)}{x}', '\\url{https://example.com}', '\\includegraphics{x.png}', '\\htmlData{onclick=1}{x}', '\\htmlClass{evil}{x}', '\\htmlId{evil}{x}', '\\htmlStyle{color:red}{x}']) {
    const out = html(src);
    assert.ok(!/<a |href=|<img|data-onclick|class="[^"]*evil|id="evil|style="color:red/.test(out), `${src} must not produce markup: ${out.slice(0, 200)}`);
  }
  const math = html('\\frac{\\lambda}{2\\,\\mathrm{NA}} \\approx \\sqrt{x^2}', true);
  assert.ok(/katex-display/.test(math) && /mfrac/.test(math) && !/katex-error/.test(math), 'ordinary math renders');
});
