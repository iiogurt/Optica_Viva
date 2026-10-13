#!/usr/bin/env node
// Kernel benchmarks (Node, main thread). Prints a Markdown table; in GitHub Actions it is also
// appended to the job summary. Reference device for budgets: Raspberry Pi 4 (see ROADMAP.md).
import { appendFileSync } from 'node:fs';
import { fft2d } from '../js/lib/fft.js';
import { rasterAperture, psf, zernikeWavefront } from '../js/lib/pupil.js';
import { LENSES, paraxial, aimRay, trace } from '../js/lib/raytrace.js';
import { gaussianBlurRGBA } from '../js/lib/blur.js';
import { autoSemiDiameters } from '../js/lib/raytrace.js';
import { ghostSystem, renderGhosts } from '../js/lib/ghosts.js';
import { renderLake } from '../js/lib/polar.js';
import { spectralBasis, linspace } from '../js/lib/color.js';

const time = (f, reps = 3) => { f(); const t = performance.now(); for (let i = 0; i < reps; i++) f(); return (performance.now() - t) / reps; };
const rows = [];
for (const n of [256, 512]) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  rows.push([`2-D FFT ${n}²`, time(() => fft2d(re, im, n))]);
}
rows.push(['JWST pupil raster 512² (cold)', time(() => rasterAperture({ type: 'jwst', bench: Math.random() }, 512, 128, 4), 1)]);
rows.push(['JWST pupil raster 512² (cached)', time(() => rasterAperture({ type: 'jwst' }, 512, 128, 4))]);
const amp = rasterAperture({ type: 'circle' }, 512, 128, 4);
rows.push(['Monochrome PSF 512²', time(() => psf(amp, null, 512, 0.55))]);
const W = zernikeWavefront(512, 128, { 4: 0.3, 8: 0.2 });
rows.push(['Aberrated PSF 512² (one λ)', time(() => psf(amp, W, 512, 0.55))]);
const L = LENSES.cooke, p = paraxial(L);
rows.push(['1000 aimed rays, Cooke triplet', time(() => { for (let i = 0; i < 1000; i++) { const a = aimRay(L, 587.56, 14, 0, i / 500 - 1, p); trace(L, 587.56, a.p, a.d, { zv: p.zv }); } }, 1)]);
const DG = { ...LENSES['double-gauss'], epd: LENSES['double-gauss'].epd / 2 }, pg = paraxial(DG), lams = linspace(420, 680, 8);
const gsys = ghostSystem(DG, { lambdas: lams, coat: 'mgf2', sd: autoSemiDiameters(LENSES['double-gauss']), stopR: pg.stopR, blades: 7, zImg: pg.zImage });
for (const [label, grid, Wpx] of [['draft', 16, 240], ['refined', 32, 360]]) {
  rows.push([`Real-ray flare ghosts, Double-Gauss, 8 λ (${label})`, time(() => renderGhosts(gsys, { theta: [0.065, 0.048], basis: spectralBasis(lams), W: Wpx, grid, cull: 1e-6 }), 1)]);
}
const D = Math.PI / 180;
rows.push(['Polarised lake render 480×270 (Stokes per pixel)', time(() => renderLake({ W: 480, H: 270, hfov: 90 * D, pitch: -12 * D, height: 1.7, sunEl: 30 * D, sunAz: 160 * D, pmax: 0.75, depth: 1.5, cdom: 0.5, ripple: 0.03, pol: true, polAngle: 90 * D }), 2)]);
const rgba = new Uint8ClampedArray(640 * 427 * 4).fill(200);
rows.push(['Gaussian blur 640×427, σ = 8', time(() => gaussianBlurRGBA(rgba, 640, 427, 8))]);

const md = ['| Kernel | Time (ms) |', '|---|---:|', ...rows.map(([k, v]) => `| ${k} | ${v.toFixed(1)} |`)].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kernel benchmarks (${process.version}, ${process.arch})\n\n${md}\n`);
