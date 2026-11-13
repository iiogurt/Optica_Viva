#!/usr/bin/env node
// Capture the home page's card pictures (img/thumbs/<lab>.webp) from the running laboratories:
// each is the lab's first picture (its first figure that is not a plain chart, else its first
// chart, unless PICK names another), cropped to 16:10 and scaled to 400 × 250 px (featured laboratories 800 × 500).
// Real-time headless Chrome.
// Usage: npm run thumbs [-- lab …]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './lib/browser.mjs';
import { NO_THUMB, FEATURED } from '../js/lib/thumbs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'img/thumbs');
export const TW = 400, TH = 250;
// lab → CSS selector of the figure to show, when the first picture is not the telling one
const PICK = {
  gallery: '.gallery img, .block img',
};
// lab → which picture (0 = the first) when a later one shows the laboratory better
const NTH = { thermal: 1, detectors: 4, zernike: 3, gear: 1, trails: 3, hdrdisplay: 2 };
const ALL = 'figure.stage canvas:not(.stage-over)';
// lab → extra milliseconds to wait, for pictures that build up over several passes
const SETTLE = { atmospheric: 9000 };
// the cards on the home page: laboratories in READY with a blurb (js/app.js needs a browser, so it
// is read as text)
const APP = readFileSync(resolve(ROOT, 'js/app.js'), 'utf8');
const READY = new Set([...APP.match(/READY = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));
export const THUMBED = [...APP.matchAll(/\{ id: '([a-z0-9-]+)'[^\n]*\bblurb:/g)].map((m) => m[1]).filter((id) => READY.has(id) && !NO_THUMB.has(id));

if (import.meta.url === `file://${process.argv[1]}`) {
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : THUMBED;
  mkdirSync(OUT, { recursive: true });
  const site = await serve(ROOT);
  const page = await launch({ width: 1440, height: 1100 });
  try {
    for (const id of wanted) {
      await page.goto(site.url + '#/' + id, 7000);
      // a picture if there is one, otherwise the first chart
      const nth = +(process.env.THUMB_NTH ?? NTH[id] ?? 0);
      const sel = PICK[id] || (nth ? ALL : null) || await page.eval(`['.lab figure.stage:not(.plain) canvas:not(.stage-over)', 'figure.stage:not(.plain) canvas:not(.stage-over)', 'figure.stage canvas:not(.stage-over)'].find((q) => document.querySelector(q))`) || 'figure.stage canvas';
      // hide captions and tools; bring the picture into view and let it finish refining
      const box = await page.eval(`(() => {
        const s = document.createElement('style'); s.textContent = 'figcaption, .stage-tools { display: none !important }'; document.head.append(s);
        const el = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        return true; })()`);
      if (!box) { console.log(`${id}: no picture (${sel})`); continue; }
      await new Promise((r) => setTimeout(r, 2500 + (SETTLE[id] || 0)));
      const r = await page.eval(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel)})[${nth}].getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
      // the largest 16:10 window, centred
      let w = r.w, hgt = (r.w * TH) / TW;
      if (hgt > r.h) { hgt = r.h; w = (r.h * TW) / TH; }
      const k = FEATURED.includes(id) ? 2 : 1, clip = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - hgt) / 2, width: w, height: hgt, scale: (k * TW) / w };
      const shot = await page.cdp('Page.captureScreenshot', { format: 'webp', quality: 74, clip });
      const img = Buffer.from(shot.result.data, 'base64');
      writeFileSync(process.env.THUMB_OUT ? `${process.env.THUMB_OUT}-${id}-${nth}.webp` : resolve(OUT, id + '.webp'), img);
      console.log(`img/thumbs/${id}.webp  ${Math.round(img.length / 1024)} KB`);
    }
  } finally { await page.close(); site.stop(); }
}
