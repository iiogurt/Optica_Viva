import { h, tex, prose, readUrlParam, bindUrlParam, syncUrl } from '../lib/ui.js';
import { header } from '../lib/page.js';
import { GROUPS, COUNT } from '../lib/phenomena.js';
import { DETAILS } from '../lib/phenomena-details.js';
import { MODULES } from '../app.js';
import { t, N_ } from '../lib/i18n.js';

const DOM = { p: ['photo', N_('Photography')], v: ['video', N_('Cinematography')], s: ['space', N_('Astronomy & space')] };
// one accent per group, cycling through the palette of the laboratory groups
const HUES = ['#ffd27a', '#ff9e7a', '#c58bff', '#6ad7ff', '#ffb547', '#ff7ab6', '#9be37a', '#7ab8ff', '#f2e36b', '#8fd8ff', '#b4a7ff', '#ffa86b', '#7af0d0'];
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Flatten the catalogue once: every entry knows its group and the other entries of its laboratory.
const ENTRIES = GROUPS.flatMap((g, gi) => g.items.map(([name, lab, doms, desc, eq]) => ({ name, id: slug(name), lab, doms, desc, eq, group: g, gi, more: DETAILS[name] })));
const byLab = new Map();
for (const e of ENTRIES) if (e.lab) byLab.set(e.lab, [...(byLab.get(e.lab) || []), e]);

export default function mount(root, meta) {
  // search matches the English text and its translation
  for (const e of ENTRIES) e.text = [e.name, t(e.name), e.desc, t(e.desc), e.group.title, t(e.group.title), e.lab || '', e.more ? e.more.join(' ').replace(/<[^>]+>/g, '') : ''].join(' ').toLowerCase();
  const nLab = ENTRIES.filter((e) => e.lab).length, nLabs = new Set(ENTRIES.map((e) => e.lab).filter(Boolean)).size;
  root.append(header({ ...meta, lede: t('{n} optical phenomena and real-world imaging challenges across photography, cinematography and astronomy, in {g} groups. Each entry has its governing relation, a fuller explanation and a worked example; {sim} of them are simulated in {labs} laboratories.', { n: COUNT, g: GROUPS.length, sim: nLab, labs: nLabs }), domains: ['photo', 'video', 'space'] }));

  const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
  const state = { g: readUrlParam('g') || '', e: readUrlParam('e') || '', q: readUrlParam('q') || '', dom: readUrlParam('d') || 'all', lab: readUrlParam('lab') === '1' };
  if (state.g && !GROUPS.some((g) => g.id === state.g)) state.g = '';
  if (!['all', 'p', 'v', 's'].includes(state.dom)) state.dom = 'all';
  const hit = state.e && ENTRIES.find((x) => x.id === state.e);
  if (hit && !state.q) state.g = hit.group.id;
  for (const [k, get] of [['g', () => state.g || null], ['e', () => state.e || null], ['q', () => state.q || null], ['d', () => (state.dom === 'all' ? null : state.dom)], ['lab', () => (state.lab ? '1' : null)]]) bindUrlParam(k, get);

  // ── tools ──
  const search = h('input', { type: 'search', value: state.q, placeholder: t('Search all phenomena, e.g. "coma", "Bayer", "JWST", "flicker"…'), 'aria-label': t('Search phenomena') });
  const segBtns = [['all', N_('All')], ['p', N_('Photography')], ['v', N_('Cinematography')], ['s', N_('Astronomy & space')]].map(([k, label]) => {
    const b = h('button', { type: 'button', class: k === state.dom ? 'on' : '', 'aria-pressed': String(k === state.dom) }, t(label));
    b.addEventListener('click', () => { state.dom = k; segBtns.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); render(); });
    return b;
  });
  const labToggle = h('label.ctl.ctl-toggle', {}, h('input', { type: 'checkbox', checked: state.lab, onChange: (ev) => { state.lab = ev.target.checked; render(); } }), h('span.switch'), h('span.ctl-label', {}, t('Only simulated')));
  const countEl = h('span.note', { 'aria-live': 'polite' });
  root.append(h('div.cat-tools', {}, search, h('div.seg', {}, ...segBtns), labToggle, countEl));
  let typing = 0;
  search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { state.q = search.value.trim(); state.e = ''; render(); }, 120); });

  // ── layout: group navigator + main pane ──
  const nav = h('nav.cat-nav', { 'aria-label': t('Catalogue groups') });
  const pane = h('div.cat-main');
  const layout = h('div.cat-layout', {}, nav, pane);
  root.append(layout);

  const pass = (e) => (state.dom === 'all' || e.doms.includes(state.dom)) && (!state.lab || e.lab);
  const matches = (e) => !state.q || state.q.toLowerCase().split(/\s+/).every((w) => e.text.includes(w));
  const go = (g, e = '') => {
    state.g = g; state.e = e;
    if (state.q) { state.q = ''; search.value = ''; }
    render();
    const target = e ? document.getElementById('entry-' + e) : layout;
    if (target) target.scrollIntoView({ block: e ? 'center' : 'start', behavior: 'smooth' });
  };

  function renderNav() {
    const here = (id) => !state.q && state.g === id;
    const item = (id, label, color, n) => h('button.cat-nav-item' + (here(id) ? '.on' : '') + (n ? '' : '.empty'), { type: 'button', 'aria-current': here(id) ? 'true' : null, onClick: () => go(id) },
      h('span.cat-dot', { style: { background: color } }), h('span', {}, t(label)), h('b', {}, String(n)));
    nav.replaceChildren(item('', N_('Overview'), 'var(--fg-dim)', ENTRIES.filter(pass).length),
      ...GROUPS.map((g, i) => item(g.id, g.title, HUES[i % HUES.length], ENTRIES.filter((e) => e.gi === i && pass(e)).length)));
    // on phones the navigator is a horizontal strip: keep the current group in view
    const on = nav.querySelector('.on');
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  }

  // One expandable entry. Its details (equation, explanation, example, related) are built on first open.
  function entryEl(e, open) {
    const body = h('div.entry-body');
    const btn = h('button.entry-head', { type: 'button', 'aria-expanded': 'false' },
      h('span.entry-name', {}, t(e.name), e.lab ? h('span.entry-lab', { title: t('Simulated in: {lab}', { lab: titleOf(e.lab) }) }, t('simulated')) : null),
      h('span.entry-desc', {}, t(e.desc)),
      h('span.entry-doms', {}, ...e.doms.split('').map((d) => h('span.tag.' + DOM[d][0], {}, t(DOM[d][1])))));
    const el = h('article.entry', { id: 'entry-' + e.id, style: { '--c': HUES[e.gi % HUES.length] } }, btn, body);
    let built = false;
    const build = () => {
      if (built) return;
      built = true;
      const [more, example] = e.more || ['', ''];
      const related = (e.lab ? byLab.get(e.lab) : []).filter((x) => x !== e).slice(0, 6);
      body.append(
        // simple to exact: a worked example, the explanation, then the governing equation
        example ? h('div.entry-example', {}, h('span.k', {}, t('Example')), prose(example)) : '',
        prose(`<p>${more}</p>`),
        h('div.entry-eq', {}, h('span.k', {}, t('Equation')), h('div.eq', {}, tex('\\displaystyle ' + e.eq, true))),
        h('div.entry-foot', {},
          e.lab ? h('a.btn', { href: '#/' + e.lab }, t('Open laboratory: {lab} →', { lab: titleOf(e.lab) })) : h('span.note', {}, t('Not simulated in a laboratory yet.')),
          state.q ? h('button.linkish', { type: 'button', onClick: () => go(e.group.id, e.id) }, t('Show in its group: {g}', { g: t(e.group.title) })) : ''),
        related.length ? h('div.entry-related', {}, h('span.k', {}, t('Also in this laboratory')), ...related.map((x) => h('button.chip', { type: 'button', onClick: () => go(x.group.id, x.id) }, t(x.name)))) : '',
      );
    };
    const toggle = (on) => {
      if (on) build();
      el.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', String(on));
    };
    btn.addEventListener('click', () => { const on = !el.classList.contains('open'); toggle(on); state.e = on ? e.id : ''; syncUrl(); });
    if (open) toggle(true);
    return el;
  }

  function overview() {
    const shown = ENTRIES.filter(pass);
    const cards = GROUPS.map((g, i) => {
      const es = shown.filter((e) => e.gi === i);
      if (!es.length) return null;
      const sim = es.filter((e) => e.lab).length;
      return h('button.cat-card', { type: 'button', style: { '--c': HUES[i % HUES.length] }, onClick: () => go(g.id) },
        h('span.k', {}, t('{n} phenomena · {sim} simulated', { n: es.length, sim })),
        h('h3', {}, t(g.title)), h('p', {}, t(g.intro)),
        h('span.cat-bar', {}, h('i', { style: { width: (100 * sim) / es.length + '%' } })),
        h('span.cat-peek', {}, es.slice(0, 5).map((e) => t(e.name)).join(' · ') + (es.length > 5 ? ' …' : '')));
    }).filter(Boolean);
    return [cards.length ? h('div.cat-cards', {}, ...cards) : h('p.note', {}, t('No entries match the filters.'))];
  }

  function groupView(g) {
    const i = GROUPS.indexOf(g), es = ENTRIES.filter((e) => e.gi === i && pass(e));
    const prev = GROUPS[(i + GROUPS.length - 1) % GROUPS.length], next = GROUPS[(i + 1) % GROUPS.length];
    return [
      h('div.cat-ghead', { style: { '--c': HUES[i % HUES.length] } },
        h('span.k', {}, t('Group {i} of {n} · {m} phenomena · {sim} simulated', { i: i + 1, n: GROUPS.length, m: es.length, sim: es.filter((e) => e.lab).length })),
        h('h2', {}, t(g.title)), h('p', {}, t(g.intro)),
        es.length ? h('div.cat-actions', {}, h('button.linkish', { type: 'button', onClick: () => setAll(true) }, t('Expand all')), h('button.linkish', { type: 'button', onClick: () => setAll(false) }, t('Collapse all'))) : ''),
      es.length ? h('div.cat-entries', {}, ...es.map((e) => entryEl(e, e.id === state.e))) : h('p.note', {}, t('No entries in this group match the filters.')),
      h('div.cat-pager', {}, h('button.btn', { type: 'button', onClick: () => go(prev.id) }, '← ' + t(prev.title)), h('button.btn', { type: 'button', onClick: () => go(next.id) }, t(next.title) + ' →')),
    ];
  }

  function results() {
    const es = ENTRIES.filter((e) => pass(e) && matches(e));
    if (!es.length) return [h('p.note', {}, t('Nothing matches “{q}” with the current filters.', { q: state.q }))];
    const out = [];
    GROUPS.forEach((g, i) => {
      const gs = es.filter((e) => e.gi === i);
      if (gs.length) out.push(h('h3.cat-rhead', { style: { '--c': HUES[i % HUES.length] } }, t(g.title), h('span.note', {}, ` · ${gs.length}`)), h('div.cat-entries', {}, ...gs.map((e) => entryEl(e, es.length === 1 || e.id === state.e))));
    });
    return out;
  }

  function setAll(on) { pane.querySelectorAll('.entry-head').forEach((b) => { if ((b.getAttribute('aria-expanded') === 'true') !== on) b.click(); }); state.e = ''; syncUrl(); }

  function render() {
    renderNav();
    const g = GROUPS.find((x) => x.id === state.g);
    pane.replaceChildren(...(state.q ? results() : g ? groupView(g) : overview()));
    const n = state.q ? ENTRIES.filter((e) => pass(e) && matches(e)).length : ENTRIES.filter((e) => (!g || e.group === g) && pass(e)).length;
    countEl.textContent = t('{n} of {total}', { n, total: COUNT });
    syncUrl();
  }
  render();
  if (state.e) requestAnimationFrame(() => document.getElementById('entry-' + state.e)?.scrollIntoView({ block: 'center' }));
  return () => clearTimeout(typing);
}
