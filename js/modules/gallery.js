// Phenomena in the wild: real photographs, each explained and linked to the laboratories that
// simulate what it shows.
import { h } from '../lib/ui.js';
import { header } from '../lib/page.js';
import { GALLERY } from '../lib/gallery.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Real photographs in which the physics of this site is plain to see. Each one says what you are looking at, why it looks that way, and which laboratories let you reproduce it.', domains: ['photo', 'space'] }));
  root.append(h('section.block.gallery', {}, ...GALLERY.map((g) => h('article.gcard', { id: 'g-' + g.id },
    h('figure', {}, h('img', { src: g.img, alt: g.alt, loading: 'lazy' }),
      h('figcaption', {}, `${g.credit} · ${g.licence} · `, h('a', { href: g.source, target: '_blank', rel: 'noopener' }, 'source'))),
    h('div.gtext', {},
      h('h2', {}, g.title),
      h('div.gk', {}, 'What you see'), h('p', {}, g.see),
      h('div.gk', {}, 'The physics'), h('p', {}, g.physics),
      h('div.glabs', {}, ...g.labs.map(([href, label]) => h('a.btn', { href: '#/' + href }, label + ' →')))),
  ))));
  return () => {};
}
