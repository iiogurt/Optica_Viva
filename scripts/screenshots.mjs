#!/usr/bin/env node
// Regenerate the README screenshots (docs/screenshots/*.webp) with real-time headless Chrome.
// Usage: npm run screenshots [-- page …]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/screenshots');
// page → crop box [left, top, right, bottom] in CSS px at 1440 px width (sidebar is 268 px)
const LAB = [296, 290, 1412, 1110];
const PAGES = {
  home: ['', [268, 0, 1440, 680]], foundations: ['foundations', [296, 0, 1412, 760]], catalogue: ['catalogue', [296, 250, 1412, 1070]],
  raytracer: ['raytracer', LAB], dof: ['dof', LAB], sensor: ['sensor', LAB], projection: ['projection', LAB], perspective: ['perspective', LAB],
  tiltshift: ['tiltshift', LAB], vignetting: ['vignetting', LAB], psf: ['psf', [296, 264, 1412, 1084]], zernike: ['zernike', LAB],
  mtf: ['mtf', [296, 264, 1412, 1084]], chromatic: ['chromatic', [296, 300, 1412, 1120]], bokeh: ['bokeh', LAB], flare: ['flare', LAB],
  sampling: ['sampling', LAB], noise: ['noise', LAB], motion: ['motion', LAB], seeing: ['seeing', [296, 316, 1412, 1136]],
  telescope: ['telescope', [296, 1220, 1412, 2040]], lensing: ['lensing', LAB], polarisation: ['polarisation', LAB], macro: ['macro', LAB], colour: ['colour', LAB], wfs: ['wfs', LAB], spectro: ['spectro', LAB], panorama: ['panorama', LAB],
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
mkdirSync(OUT, { recursive: true });
const site = await serve(ROOT);
const page = await launch({ width: 1440, height: 1400 });
try {
  for (const key of wanted) {
    const [route, [l, t, r, b]] = PAGES[key];
    await page.size(1440, Math.max(1400, b + 40));
    await page.goto(site.url + '#/' + route, 7000);
    const img = await page.screenshot({ clip: { x: l, y: t, width: r - l, height: b - t } });
    writeFileSync(resolve(OUT, key + '.webp'), img);
    console.log(`docs/screenshots/${key}.webp  ${Math.round(img.length / 1024)} KB`);
  }
} finally { await page.close(); site.stop(); }
