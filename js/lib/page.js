// Page scaffolding shared by every module.
import { h, prose, section, copyLink } from './ui.js';

const TAG = { photo: 'Photography', video: 'Cinematography', space: 'Astronomy & space' };

export function header(meta) {
  return h('header.mod-head', {},
    h('div.eyebrow', {}, meta.group),
    h('h1', {}, meta.title),
    h('p.lede', {}, meta.lede || ''),
    h('div.tags', {}, ...(meta.domains || []).map((d) => h('span.tag.' + d, {}, TAG[d] || d)),
      h('button.tag.share', { type: 'button', title: 'Copy a link to this page with the current settings', onClick: (e) => copyLink(e.currentTarget.querySelector('span')),
        html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg><span>Copy link</span>' })),
  );
}

// Standard lab: main column (stages) + sticky side column (controls, readouts, live calc).
// On phones the card holding the controls becomes a bottom sheet (see .ctl-sheet in CSS), shown only
// while its own lab is on screen, so sliders and results are visible together.
export function lab(main, side, wide = false) {
  const mainEl = h('div.lab-main', {}, ...main);
  const card = side.find((n) => n.querySelector && n.querySelector('.controls'));
  if (card) {
    card.classList.add('ctl-sheet');
    const handle = h('button.sheet-handle', { type: 'button', 'aria-expanded': 'false' }, h('span', {}, '⚙ Controls'), h('span.chev', { 'aria-hidden': 'true' }, '▲'));
    handle.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      handle.setAttribute('aria-expanded', String(open));
    });
    card.prepend(handle);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(([e]) => card.classList.toggle('in-view', e.isIntersecting), { rootMargin: '-35% 0px -35% 0px' }).observe(mainEl);
    } else card.classList.add('in-view');
  }
  return h('div.lab' + (wide ? '.wide-ctl' : ''), {}, mainEl, h('div.lab-side', {}, ...side));
}

export function theory(title, html) { return section(title, prose(html)); }

export function references(items) {
  return section('References', h('ol.refs', {}, ...items.map((r) => h('li', { html: r }))));
}

// Live-calculation card: returns {el, set(tex)}
import { setTex } from './ui.js';
export function liveCalc(title = 'Live calculation') {
  const body = h('div');
  const el = h('div.card.calc', {}, h('div.calc-title', {}, title), body);
  return { el, set: (src) => setTex(body, src, true) };
}
