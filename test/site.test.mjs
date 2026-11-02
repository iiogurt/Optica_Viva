// The deployable site (scripts/site.mjs): complete, and the check catches what an incomplete copy lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assemble, verify } from '../scripts/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the assembled site holds every runtime file and nothing from development', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optica-site-'));
  try {
    assemble(dir);
    assert.deepEqual(verify(dir), []);
    assert.throws(() => assemble(dir), /not empty/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a copy of only index.html, css, js, vendor and docs (the old Pages step) is reported incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optica-site-'));
  try {
    for (const f of ['index.html', 'css', 'js', 'vendor', 'docs']) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
    const p = verify(dir).join('\n');
    for (const f of ['sw.js', 'precache.json', 'package.json', 'manifest.webmanifest', 'icons/icon-192.png', 'img/gallery/eht-m87.webp']) assert.match(p, new RegExp(`^${f.replace(/\./g, '\\.')} missing`, 'm'), f);
    assert.match(p, /docs must not be deployed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
