// Page scaffolding shared by every module.
import { h, prose, section, copyLink } from './ui.js';

const TAG = { photo: 'Photography', video: 'Cinematography', space: 'Astronomy & space' };

export function header(meta) {
  return h('header.mod-head', {},
    h('div.eyebrow', {}, meta.group),
    h('h1', {}, meta.title),
    meta.lede ? h('p.lede', {}, meta.lede) : null,
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
  return h('div.lab' + (wide ? '.wide-ctl' : ''), { 'data-rung': 'sim' }, mainEl, h('div.lab-side', {}, ...side));
}

// ── Explanation ladder ───────────────────────────────────────────────────────────────────
// A page reads from simple to exact: ① the idea in plain words (with things to try), the
// simulation, ② a rule of thumb that says where it stops working, ③ the full model, ④ references.
// Every rung is visible; ladder() adds the numbers and a strip to jump between them.
export function idea(html, tries = []) {
  return h('section.block.rung-idea', { 'data-rung': 'idea' }, h('h2', {}, 'The idea'),
    h('div.idea', {}, prose(html, 'idea-text'),
      tries.length ? h('div.try', {}, h('div.calc-title', {}, 'Try it'), h('ol', {}, ...tries.map((t) => h('li', { html: t })))) : null));
}

export function rule(html, limits) {
  return h('section.block.rung-rule', { 'data-rung': 'rule' }, h('h2', {}, 'Rule of thumb'),
    prose(html + (limits ? `<div class="callout blue"><strong>Where it stops working.</strong> ${limits}</div>` : '')));
}

export function theory(title, html) {
  const el = section(title, prose(html));
  el.dataset.rung = 'full';
  return el;
}

export function references(items) {
  const el = section('References', h('ol.refs', {}, ...items.map((r) => h('li', { html: r }))));
  el.dataset.rung = 'refs';
  return el;
}

const RUNGS = { idea: 'The idea', sim: 'Simulation', rule: 'Rule of thumb', full: 'Full model', refs: 'References' };
// Numbers the rungs and inserts the jump strip under the header. Returns a cleanup function.
export function ladder(page) {
  const seen = new Set();
  const rungs = [...page.querySelectorAll('[data-rung]')].filter((el) => !seen.has(el.dataset.rung) && seen.add(el.dataset.rung));
  if (!rungs.some((el) => el.dataset.rung === 'idea')) return () => {};
  let n = 0;
  const items = rungs.map((el) => {
    const k = el.dataset.rung, num = k === 'sim' ? null : String(++n);
    const h2 = el.querySelector(':scope > h2');
    if (num && h2) h2.prepend(h('span.rung-n', { 'aria-hidden': 'true' }, num));
    const b = h('button', { type: 'button', onClick: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      num ? h('span.rung-n', { 'aria-hidden': 'true' }, num) : h('span.rung-n.sim', { 'aria-hidden': 'true' }, '▶'), RUNGS[k]);
    return { el, b };
  });
  const nav = h('nav.ladder', { 'aria-label': 'From the simple idea to the full model' },
    h('span.ladder-k', {}, 'Simple → exact'), ...items.map((i) => i.b));
  page.querySelector('.mod-head')?.after(nav);
  if (typeof IntersectionObserver !== 'function') return () => {};
  const vis = new Map();
  const io = new IntersectionObserver((es) => {
    for (const e of es) vis.set(e.target, e.isIntersecting);
    const cur = items.find((i) => vis.get(i.el));
    for (const i of items) i.b.classList.toggle('on', i === cur);
  }, { rootMargin: '-20% 0px -55% 0px' });
  for (const i of items) io.observe(i.el);
  return () => io.disconnect();
}

// Live-calculation card: returns {el, set(tex)}
import { setTex } from './ui.js';
// say(html) puts the result in plain words above the equations.
export function liveCalc(title = 'Live calculation') {
  const words = h('p.calc-say'), body = h('div');
  const el = h('div.card.calc', {}, h('div.calc-title', {}, title), words, body);
  return { el, set: (src) => setTex(body, src, true), say: (html) => { words.innerHTML = html; } };
}

// ── Missions ─────────────────────────────────────────────────────────────────────────────
// One step of a mission: the answer first, then why, the formula it comes from and the
// laboratory that explores it. Returns {el, set({answer, why, tex})}.
export function missionStep(n, title, lab, labTitle) {
  const answer = h('div.mstep-answer'), why = h('p.mstep-why'), eq = h('div.mstep-eq');
  const el = h('section.mstep', {}, h('div.mstep-head', {}, h('span.mstep-n', { 'aria-hidden': 'true' }, String(n)), h('h3', {}, title)),
    answer, why, eq, lab ? h('a.mstep-lab', { href: '#/' + lab }, 'Explore: ' + labTitle + ' →') : null);
  return { el, set: ({ answer: a, why: w, tex: t }) => { answer.innerHTML = a; why.innerHTML = w; if (t) setTex(eq, t, true); else eq.replaceChildren(); } };
}

// Misconception check: a question answered before the explanation is shown. Inserted after the
// idea on laboratories listed in misconceptions.js.
export function misconception(page, id, checks) {
  const c = checks[id];
  const idea = page.querySelector('.rung-idea');
  if (!c || !idea) return;
  const why = h('p.check-why'), list = h('div.check-options');
  c.options.forEach((o, i) => list.append(h('button.check-option', { type: 'button', onClick: (e) => {
    list.querySelectorAll('button').forEach((b, j) => { b.disabled = true; b.classList.toggle('right', j === c.answer); });
    if (i !== c.answer) e.currentTarget.classList.add('wrong');
    why.innerHTML = (i === c.answer ? '<strong>Right.</strong> ' : '<strong>Not quite.</strong> ') + c.why;
  } }, o)));
  idea.after(h('section.block.check', { 'aria-label': 'Check your intuition' }, h('div.check-k', {}, 'Check your intuition'), h('p.check-q', {}, c.q), list, why));
}
