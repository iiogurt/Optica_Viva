// Guided tours: short narratives that move a laboratory's controls step by step and say what to
// look at. A step's `set` adds to the settings of the steps before it, so Back restores a state
// exactly. Start a tour from its laboratory or with a link: #/<lab>?tour=<id>.
import { h, setControl, bindUrlParam } from './ui.js';

export const TOURS = [
  {
    id: 'stop-down', lab: 'mtf', title: 'Why stopping down stops helping',
    blurb: 'Close the aperture one stop at a time and watch lens errors give way to diffraction.',
    steps: [
      { say: 'A fast lens wide open at f/2, with the spherical aberration a real lens has: rays through the edge of the glass focus a little short. The MTF curve (how much contrast survives at each size of detail) sags early.', set: { N: 2, sa: 1.2, defocus: 0, lam: 'white', p: 4.3, ff: 0.95, olpf: 0 } },
      { say: 'One stop down, f/2.8. The iris blocks the edge rays, and spherical aberration falls with the fourth power of the opening, so one stop cuts it to a quarter. Fine detail gains a lot of contrast.', set: { N: 2.8, sa: 0.31 } },
      { say: 'Another stop, f/4. The aberration is a quarter again and nearly gone, while diffraction is still small. Most lenses are at their sharpest around here.', set: { N: 4, sa: 0.08 } },
      { say: 'At f/8 the lens errors have vanished and the curve is set by diffraction alone: light spreads after passing through a small opening. From now on each stop moves the cutoff, the finest detail passed at all, inward.', set: { N: 8, sa: 0 } },
      { say: 'At f/16 the diffraction cutoff for green light (about 114 cycles per millimetre) has reached the sensor\'s own limit for 4.3 µm pixels (116 per millimetre). Stopping down further only throws detail away.', set: { N: 16 } },
      { say: 'At f/32 the whole image is soft. Stopping down buys depth of field, not sharpness: past the sweet spot every stop costs resolution.', set: { N: 32 } },
    ],
  },
  {
    id: 'depth-of-field', lab: 'dof', title: 'What really sets depth of field',
    blurb: 'Aperture, focal length, distance and sensor size: which ones matter once the picture is framed the same?',
    steps: [
      { say: 'A head-and-shoulders portrait: an 85 mm lens at f/1.8, 2.2 m away, on a full-frame camera. The zone that looks sharp is only about seven centimetres deep.', set: { sensor: 'ff', f: 85, N: 1.8, s: 2.2, coc: '1500', diff: true } },
      { say: 'Stop down to f/5.6, a little over three stops. Depth of field grows in proportion to the f-number, to about 21 cm.', set: { N: 5.6 } },
      { say: 'Back to f/1.8, now with a 35 mm lens from 0.91 m so the face fills the frame just as before. The depth of field is almost the same: at equal framing it depends on the f-number, not the focal length. What changes is the perspective and how big the background looks.', set: { N: 1.8, f: 35, s: 0.91 } },
      { say: 'Now a smaller APS-C sensor with a 56 mm lens from 2.2 m: the same picture again. At the same f/1.8 the depth of field is about one and a half times deeper.', set: { sensor: 'apsc', f: 56, s: 2.2 } },
      { say: 'Open up to f/1.2 and the APS-C picture matches full frame at f/1.8. Dividing the f-number by the crop factor (1.8 ÷ 1.53 ≈ 1.2) gives the "equivalent aperture".', set: { N: 1.2 } },
    ],
  },
  {
    id: 'spikes', lab: 'psf', title: 'Where diffraction spikes come from',
    blurb: 'From a perfect round lens to the James Webb Space Telescope: straight edges make spikes.',
    steps: [
      { say: 'A perfect round opening. A star becomes a bright core with faint rings around it, the Airy pattern, and no spikes at all.', set: { preset: 'circle', band: 'mono', defocus: 0 } },
      { say: 'A six-blade iris has straight edges. Each straight edge spreads light at right angles to itself, and opposite edges are parallel, so six blades give six spikes.', set: { preset: 'hex' } },
      { say: 'With five blades no two edges are parallel, so every edge throws its own pair of spikes: five blades, ten spikes.', set: { preset: 'five' } },
      { say: 'The James Webb Space Telescope: the edges of its 18 hexagonal mirror segments run in three directions and make six big spikes. The vertical strut holding the secondary mirror adds two smaller horizontal ones.', set: { preset: 'jwst' } },
      { say: 'Real starlight mixes many wavelengths. Each colour draws the pattern at its own scale, so the rings smear out while the spikes, which come from the edges, stay.', set: { band: 'nir' } },
    ],
  },
  {
    id: 'coatings', lab: 'flare', title: 'Why lens coatings matter',
    blurb: 'Ghosts need two reflections, so cutting each reflection pays twice.',
    steps: [
      { say: 'An uncoated Double-Gauss lens facing a bright light. Every glass surface reflects about 4 % of the light; light reflected twice, off two surfaces, reaches the sensor as a ghost.', set: { lens: 'double-gauss', coat: 'none', stopdown: 2, ev: 4.5 } },
      { say: 'A single quarter-wave layer of magnesium fluoride. Light reflected from its top and bottom cancels, cutting each reflection from about 4.5 % to about 0.5 % in green light. A ghost needs two reflections, so the gain counts twice: all the ghosts together fall from about 9 % of the image light to about 0.1 %.', set: { coat: 'mgf2' } },
      { say: 'A three-layer broadband coating keeps reflection low across the whole visible range, so the ghosts fade further and lose most of their colour.', set: { coat: 'qhq' } },
      { say: 'Now make the light source 3.5 stops brighter, like the Sun in the frame. Even good coatings cannot hide ghosts from a source this bright.', set: { ev: 8 } },
      { say: 'Stop the lens down. Ghosts that are images of the iris take its polygon shape and shrink with it.', set: { stopdown: 4 } },
    ],
  },
  {
    id: 'colour-fringes', lab: 'chromatic', title: 'Taming colour fringes',
    blurb: 'From a single lens to an apochromat: how glass pairs cancel each other\'s colour errors.',
    steps: [
      { say: 'A single lens of ordinary glass. Blue light bends more than red, so the colours come to focus at different distances and out-of-focus edges grow coloured fringes.', set: { show: 'singlet', glass: 'N-BK7', N: 2, dz: 0.08 } },
      { say: 'An achromat cements a weakly dispersing glass to a strongly dispersing one. Their colour errors cancel for red and blue; the small error left over is called the secondary spectrum.', set: { show: 'achromat' } },
      { say: 'An apochromat adds a third glass, here calcium fluoride, and brings three colours to the same focus. What is left is tiny.', set: { show: 'apo' } },
      { say: 'Back to the single lens, stopped down to f/8. The colours still focus at different distances, but each colour\'s blur shrinks with the opening, so the fringes become much thinner.', set: { show: 'singlet', N: 8 } },
    ],
  },
];

// The settings at step k: every earlier step's settings, then this step's.
export const stepSettings = (tour, k) => Object.assign({}, ...tour.steps.slice(0, k + 1).map((s) => s.set));

let player = null;
function stop() { if (player) { player.el.remove(); player = null; } }

function play(page, tour) {
  stop();
  let k = 0;
  const n = tour.steps.length;
  const count = h('span.tour-count'), text = h('p.tour-text');
  const back = h('button.tour-btn', { type: 'button', onClick: () => go(k - 1) }, '← Back');
  const next = h('button.tour-btn.primary', { type: 'button', onClick: () => (k < n - 1 ? go(k + 1) : end()) }, 'Next →');
  const el = h('aside.tour', { role: 'dialog', 'aria-label': 'Guided tour: ' + tour.title },
    h('div.tour-head', {}, h('span.tour-k', {}, 'Guided tour'), count,
      h('button.tour-x', { type: 'button', title: 'End the tour', 'aria-label': 'End the tour', onClick: () => end() }, '✕')),
    h('h3', {}, tour.title), h('div', { 'aria-live': 'polite' }, text), h('div.tour-nav', {}, back, next));
  const end = () => { stop(); bindUrlParam('tour', () => null); };
  function go(i) {
    k = Math.max(0, Math.min(n - 1, i));
    page.querySelectorAll('.tour-flash').forEach((r) => r.classList.remove('tour-flash'));
    for (const [key, v] of Object.entries(stepSettings(tour, k))) {
      const row = setControl(key, v);
      if (!row) { console.error(`tour ${tour.id}: no control "${key}" on #/${tour.lab}`); continue; }
      if (key in tour.steps[k].set) { void row.offsetWidth; row.classList.add('tour-flash'); }
    }
    count.textContent = `${k + 1} / ${n}`;
    text.textContent = tour.steps[k].say;
    back.disabled = k === 0;
    next.textContent = k < n - 1 ? 'Next →' : 'Finish';
  }
  player = { el };
  page.append(el);
  bindUrlParam('tour', () => (player ? tour.id : null));
  go(0);
  (page.querySelector('figure.stage') || page.querySelector('.controls'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Called by the router after a page mounts: offers the page's tours after the idea, and starts
// `wanted` (the link's ?tour=, read before mounting rewrote the URL). Returns a cleanup function.
export function tours(page, id, wanted) {
  const mine = TOURS.filter((t) => t.lab === id);
  if (!mine.length) return () => {};
  const box = h('section.block.tour-offer', { 'aria-label': 'Guided tours' }, h('div.check-k', {}, 'Guided tour'),
    ...mine.map((t) => h('div.tour-item', {}, h('div', {}, h('b', {}, t.title), h('span.note', {}, ' ' + t.blurb)),
      h('button.tour-btn.primary', { type: 'button', onClick: () => play(page, t) }, `Start (${t.steps.length} steps)`))));
  const anchor = page.querySelector('.check') || page.querySelector('.rung-idea') || page.querySelector('.mod-head');
  anchor?.after(box);
  const want = mine.find((t) => t.id === wanted);
  // let the controls and first results settle before the tour moves them
  const timer = want ? setTimeout(() => play(page, want), 300) : 0;
  return () => { clearTimeout(timer); stop(); };
}
