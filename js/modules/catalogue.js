import { h, tex } from '../lib/ui.js';
import { header } from '../lib/page.js';
import { GROUPS, COUNT } from '../lib/phenomena.js';
import { MODULES } from '../app.js';

const DOM = { p: ['photo', 'Photography'], v: ['video', 'Cinematography'], s: ['space', 'Astronomy & space'] };

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: `${COUNT} optical phenomena and real-world imaging challenges across photography, cinematography and astronomy, each with its governing relation. Entries marked with a laboratory link are simulated interactively elsewhere in Optica Viva.`, domains: ['photo', 'video', 'space'] }));

  const search = h('input', { type: 'search', placeholder: 'Search phenomena, e.g. "coma", "Bayer", "JWST", "flicker"…', 'aria-label': 'Search phenomena' });
  let domain = 'all', onlyLab = false;
  const segBtns = [['all', 'All'], ['p', 'Photography'], ['v', 'Cinematography'], ['s', 'Astronomy & space']].map(([k, t]) => {
    const b = h('button', { type: 'button', class: k === 'all' ? 'on' : '' }, t);
    b.addEventListener('click', () => { domain = k; segBtns.forEach((x) => x.classList.remove('on')); b.classList.add('on'); filter(); });
    return b;
  });
  const labToggle = h('label.ctl.ctl-toggle', {}, h('input', { type: 'checkbox', onChange: (e) => { onlyLab = e.target.checked; filter(); } }), h('span.switch'), h('span.ctl-label', {}, 'Only simulated'));
  const countEl = h('span.note');
  root.append(h('div.cat-tools', {}, search, h('div.seg', {}, ...segBtns), labToggle, countEl));
  search.addEventListener('input', () => filter());

  const titleOf = (id) => MODULES.find((m) => m.id === id)?.title || id;
  const entries = [];
  for (const g of GROUPS) {
    const list = h('div.cat-list');
    const sec = h('div.cat-group', {}, h('h3', {}, g.title), h('p', {}, g.intro), list);
    root.append(sec);
    for (const [name, labId, doms, desc, eq] of g.items) {
      const el = h('article.entry', {},
        h('h4', {}, name, labId ? h('a', { href: '#/' + labId, title: 'Open laboratory: ' + titleOf(labId) }, '→ ' + titleOf(labId)) : null),
        h('p', {}, desc),
        h('div.eq', {}, tex('\\displaystyle ' + eq, false)),
        h('div.domains', {}, ...doms.split('').map((d) => h('span.tag.' + DOM[d][0], {}, DOM[d][1]))),
      );
      list.append(el);
      entries.push({ el, sec, text: (name + ' ' + desc + ' ' + g.title + ' ' + (labId || '')).toLowerCase(), doms, labId });
    }
  }

  function filter() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    const visibleBySec = new Map();
    for (const e of entries) {
      const ok = (!q || q.split(/\s+/).every((w) => e.text.includes(w))) && (domain === 'all' || e.doms.includes(domain)) && (!onlyLab || e.labId);
      e.el.style.display = ok ? '' : 'none';
      if (ok) { shown++; visibleBySec.set(e.sec, true); }
    }
    for (const e of entries) e.sec.style.display = visibleBySec.get(e.sec) ? '' : 'none';
    countEl.textContent = `${shown} of ${COUNT}`;
  }
  filter();
}
