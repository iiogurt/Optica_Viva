#!/usr/bin/env node
// Regenerate the README screenshots (docs/screenshots/*.webp) with real-time headless Chrome.
// Usage: npm run screenshots [-- page …]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/screenshots');
// page → crop box [left, top, right, bottom] in CSS px at 1440 px width (sidebar is 268 px).
// LAB crops are measured from the top of the page's first laboratory, which moves with the text above it.
const LAB = { lab: [296, -8, 1412, 812] };
const PAGES = {
  home: ['', [268, 0, 1440, 680]], foundations: ['foundations', [296, 0, 1412, 760]], catalogue: ['catalogue', [296, 250, 1412, 1070]], 'catalogue-entry': ['catalogue?g=diffraction-and-wave-optics&e=airy-disk', [296, 250, 1412, 1070]],
  raytracer: ['raytracer', LAB], dof: ['dof', LAB], 'dof-ladder': ['dof', [296, 20, 1412, 510]], sensor: ['sensor', LAB], projection: ['projection', LAB], perspective: ['perspective', LAB],
  tiltshift: ['tiltshift', LAB], vignetting: ['vignetting', LAB], psf: ['psf', LAB], zernike: ['zernike', LAB],
  mtf: ['mtf', LAB], chromatic: ['chromatic', LAB], bokeh: ['bokeh', LAB], flare: ['flare', LAB],
  sampling: ['sampling', LAB], noise: ['noise', LAB], motion: ['motion', LAB], seeing: ['seeing', LAB],
  telescope: ['telescope', [296, 1220, 1412, 2040]], lensing: ['lensing', LAB], polarisation: ['polarisation', LAB], macro: ['macro', LAB], colour: ['colour', LAB], wfs: ['wfs', LAB], spectro: ['spectro', LAB], panorama: ['panorama', LAB], cinema: ['cinema', LAB], hdr: ['hdr', LAB], shake: ['shake', LAB], eye: ['eye', LAB], film: ['film', LAB], vp: ['vp', LAB], interferometry: ['interferometry', LAB], detectors: ['detectors', LAB], adc: ['adc', LAB], lucky: ['lucky', LAB], stacking: ['stacking', LAB], starshade: ['starshade', LAB], fieldpsf: ['fieldpsf', LAB],
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
mkdirSync(OUT, { recursive: true });
const site = await serve(ROOT);
const page = await launch({ width: 1440, height: 1400 });
try {
  for (const key of wanted) {
    const [route, crop] = PAGES[key];
    let [l, t, r, b] = crop.lab || crop;
    if (crop.lab) {
      await page.size(1440, 2400);
      await page.goto(site.url + '#/' + route, 7000);
      const y = await page.eval("Math.round(document.querySelector('.lab').getBoundingClientRect().top + scrollY)");
      t += y; b += y;
    }
    await page.size(1440, Math.max(1400, b + 40));
    await page.goto(site.url + '#/' + route, 7000);
    const img = await page.screenshot({ clip: { x: l, y: t, width: r - l, height: b - t } });
    writeFileSync(resolve(OUT, key + '.webp'), img);
    console.log(`docs/screenshots/${key}.webp  ${Math.round(img.length / 1024)} KB`);
  }
} finally { await page.close(); site.stop(); }
