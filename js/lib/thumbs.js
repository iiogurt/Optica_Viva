// Pictures on the home page's cards: img/thumbs/<lab>.webp, captured from the running laboratory
// by scripts/thumbs.mjs (npm run thumbs). Pages without a picture keep a text card; FEATURED
// laboratories are shown large at the top, captured at twice the size.
export const NO_THUMB = new Set(['foundations', 'catalogue']);
export const FEATURED = ['blackhole', 'psf', 'atmospheric'];
export const thumbOf = (id) => (NO_THUMB.has(id) ? null : `img/thumbs/${id}.webp`);
