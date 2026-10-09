// Page scaffolding shared by every module.
import { h, prose, section } from './ui.js';

const TAG = { photo: 'Photography', video: 'Cinematography', space: 'Astronomy & space' };

export function header(meta) {
  return h('header.mod-head', {},
    h('div.eyebrow', {}, meta.group),
    h('h1', {}, meta.title),
    h('p.lede', {}, meta.lede || ''),
    h('div.tags', {}, ...(meta.domains || []).map((d) => h('span.tag.' + d, {}, TAG[d] || d))),
  );
}

// Standard lab: main column (stages) + sticky side column (controls, readouts, live calc).
export function lab(main, side, wide = false) {
  return h('div.lab' + (wide ? '.wide-ctl' : ''), {}, h('div.lab-main', {}, ...main), h('div.lab-side', {}, ...side));
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
